/**
 * Atomic SQLite backup and verified restore service.
 *
 * - Backup uses SQLite's online backup API (`db.backup(destPath)`) or `VACUUM INTO` into a
 *   temporary file with 0600 permissions, verifies `PRAGMA integrity_check`, and atomically
 *   renames it into the target location outside the public web root.
 * - Restore verifies the backup file's integrity and schema before replacing the active database.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { db, DB_PATH, assertForeignKeys, secureDatabaseFiles } from './Database.js';
import { audit } from './AuditLog.js';

const REQUIRED_TABLES = new Set(['accounts', 'sessions', 'characters', 'fallen_heroes', 'hall_of_legends', 'server_meta', 'audit_log']);

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
  }
}

function chmod600(filePath) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
  }
}

function escapeSqlPath(p) {
  return p.replace(/'/g, "''");
}

/**
 * Verifies a standalone SQLite database file for structural integrity and required Sanctum tables.
 */
export function verifyBackupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file does not exist: ${filePath}`);
  }
  const checkDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = checkDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${integrity}`);
    }
    const tables = new Set(
      checkDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)
    );
    for (const req of REQUIRED_TABLES) {
      if (!tables.has(req)) {
        throw new Error(`Backup file is missing required table '${req}'`);
      }
    }
    return true;
  } finally {
    checkDb.close();
  }
}

/**
 * Creates a consistent, verified backup of the live database.
 */
export function createDatabaseBackup({ destPath = null, actor = null, ip = null } = {}) {
  const backupDir = destPath ? path.dirname(path.resolve(destPath)) : config.backupDir;
  ensurePrivateDir(backupDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = destPath
    ? path.resolve(destPath)
    : path.join(backupDir, `sanctum-backup-${stamp}.db`);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    // Checkpoint WAL first and perform atomic VACUUM INTO snapshot
    db.pragma('wal_checkpoint(PASSIVE)');
    db.exec(`VACUUM INTO '${escapeSqlPath(tmpPath)}'`);
    chmod600(tmpPath);
    verifyBackupFile(tmpPath);
    fs.renameSync(tmpPath, finalPath);
    chmod600(finalPath);
    const stat = fs.statSync(finalPath);

    audit({
      actor,
      action: 'db.backup.created',
      targetType: 'database',
      targetId: path.basename(finalPath),
      ip,
      details: { bytes: stat.size }
    });

    return { ok: true, path: finalPath, bytes: stat.size, createdAt: Date.now() };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Restores a verified backup file into a target SQLite database path (defaults to DB_PATH).
 * When restoring over the live database file, uses SQLite backup / transactional copy or atomic file swap.
 */
export function restoreDatabaseBackup(backupPath, { targetPath = DB_PATH } = {}) {
  const resolvedBackup = path.resolve(backupPath);
  const resolvedTarget = path.resolve(targetPath);
  verifyBackupFile(resolvedBackup);

  ensurePrivateDir(path.dirname(resolvedTarget));

  // If restoring into the active in-process DB connection, copy contents transactionally
  if (resolvedTarget === path.resolve(DB_PATH) && db.open) {
    const src = new Database(resolvedBackup, { readonly: true, fileMustExist: true });
    try {
      db.pragma('foreign_keys = OFF');
      const tables = ['sessions', 'characters', 'fallen_heroes', 'hall_of_legends', 'accounts', 'server_meta', 'audit_log'];
      db.transaction(() => {
        for (const t of tables) {
          db.prepare(`DELETE FROM ${t}`).run();
        }
        // Copy in dependency order
        for (const t of ['accounts', 'sessions', 'characters', 'fallen_heroes', 'hall_of_legends', 'server_meta', 'audit_log']) {
          const rows = src.prepare(`SELECT * FROM ${t}`).all();
          if (!rows.length) continue;
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insert = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`);
          for (const r of rows) {
            insert.run(...cols.map(c => r[c]));
          }
        }
      })();
    } finally {
      db.pragma('foreign_keys = ON');
      assertForeignKeys(db);
      src.close();
    }
    const fkErrors = db.pragma('foreign_key_check');
    if (fkErrors.length > 0) {
      throw new Error(`Foreign key check failed after restore: ${JSON.stringify(fkErrors[0])}`);
    }
    secureDatabaseFiles();
    return { ok: true, targetPath: resolvedTarget };
  }

  // Offline / standalone file restore
  const tmpTarget = `${resolvedTarget}.restore-${process.pid}-${Date.now()}`;
  fs.copyFileSync(resolvedBackup, tmpTarget);
  chmod600(tmpTarget);
  verifyBackupFile(tmpTarget);
  for (const suffix of ['-wal', '-shm']) {
    try { if (fs.existsSync(resolvedTarget + suffix)) fs.unlinkSync(resolvedTarget + suffix); } catch { /* ignore */ }
  }
  fs.renameSync(tmpTarget, resolvedTarget);
  chmod600(resolvedTarget);
  return { ok: true, targetPath: resolvedTarget };
}
