import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const DB_PATH = config.dbPath;
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 6 months (180 days)
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Scrypt parameters (unchanged from the original implementation so existing hashes verify).
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// --- Filesystem hardening: database directory and files are private to the server account ---
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
function chmodQuiet(p, mode) {
  try { if (fs.existsSync(p)) fs.chmodSync(p, mode); } catch { /* non-POSIX or not owner */ }
}
export function secureDatabaseFiles() {
  if (process.platform === 'win32') return;
  chmodQuiet(path.dirname(DB_PATH), 0o700);
  for (const suffix of ['', '-wal', '-shm', '-journal']) chmodQuiet(DB_PATH + suffix, 0o600);
}

const prevUmask = process.platform === 'win32' ? null : process.umask(0o077);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');
if (prevUmask !== null) process.umask(prevUmask);

/** Hard guarantee: refuse to run if FK enforcement is not active on this connection. */
export function assertForeignKeys(conn = db) {
  if (conn.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('[DB] SQLite foreign_keys enforcement is not enabled');
  }
}
assertForeignKeys();

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    is_banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    next_xp INTEGER NOT NULL DEFAULT 100,
    stat_points INTEGER NOT NULL DEFAULT 0,
    potions INTEGER NOT NULL DEFAULT 3,
    is_dead INTEGER NOT NULL DEFAULT 0,
    highest_floor INTEGER NOT NULL DEFAULT 1,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);

  CREATE TABLE IF NOT EXISTS fallen_heroes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    hero_name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    floor INTEGER NOT NULL,
    data_json TEXT DEFAULT '{}',
    died_at INTEGER NOT NULL
  );

  -- Shell table for permanent Hall of Legends (induction criteria TBD)
  CREATE TABLE IF NOT EXISTS hall_of_legends (
    id TEXT PRIMARY KEY,
    account_name TEXT NOT NULL,
    hero_name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    level INTEGER NOT NULL,
    highest_floor INTEGER NOT NULL,
    epitaph TEXT DEFAULT '',
    meta_json TEXT DEFAULT '{}',
    inducted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Append-only moderator / security audit trail. No FK so entries survive account deletion.
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    ip TEXT,
    details_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

// --- Migrations ---
const accCols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
if (!accCols.includes('must_change_password')) {
  db.exec('ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}
if (!accCols.includes('password_changed_at')) {
  db.exec('ALTER TABLE accounts ADD COLUMN password_changed_at INTEGER NOT NULL DEFAULT 0');
}

// Sessions store only a SHA-256 of the bearer token. Legacy plaintext-token tables are
// replaced (forces a one-time re-login) so a leaked database cannot be replayed as sessions.
const sessCols = db.prepare("SELECT name FROM pragma_table_info('sessions')").all().map(c => c.name);
if (sessCols.length && !sessCols.includes('token_hash')) {
  db.exec('DROP TABLE sessions');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
`);

const fhCols = db.prepare('PRAGMA table_info(fallen_heroes)').all();
if (!fhCols.some(c => c.name === 'account_id')) {
  db.exec(`
    DROP TABLE fallen_heroes;
    CREATE TABLE fallen_heroes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      account_name TEXT NOT NULL,
      hero_name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      floor INTEGER NOT NULL,
      data_json TEXT DEFAULT '{}',
      died_at INTEGER NOT NULL
    );
  `);
} else if (!fhCols.some(c => c.name === 'data_json')) {
  db.exec("ALTER TABLE fallen_heroes ADD COLUMN data_json TEXT DEFAULT '{}'");
}
secureDatabaseFiles();

// --- Password hashing (salted scrypt, timing-safe verification) ---
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return { salt, hash };
}

export function hashPasswordAsync(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err);
      else resolve({ salt, hash: key.toString('hex') });
    });
  });
}

function safeEqualHex(hexA, hexB) {
  const a = Buffer.from(hexA, 'hex');
  const b = Buffer.from(String(hexB || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(password, salt, expectedHash) {
  return safeEqualHex(hashPassword(password, salt).hash, expectedHash);
}

export async function verifyPasswordAsync(password, salt, expectedHash) {
  const { hash } = await hashPasswordAsync(password, salt);
  return safeEqualHex(hash, expectedHash);
}

/** A password hash nobody knows: used to lock accounts and to equalize timing for unknown users. */
export function unusablePasswordHash() {
  return hashPassword(crypto.randomBytes(32).toString('hex'));
}

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// --- Server metadata ---
export function getMeta(key) {
  return db.prepare('SELECT value FROM server_meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(key, value) {
  db.prepare(`
    INSERT INTO server_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), Date.now());
}
export function deleteMeta(key) {
  db.prepare('DELETE FROM server_meta WHERE key = ?').run(key);
}

// --- Retention ---
// Non-moderator accounts expire after 180 days of inactivity; deletion cascades to sessions,
// characters and fallen-hero entries via foreign keys. Moderator accounts are exempt.
export function pruneExpiredData() {
  const now = Date.now();
  const run = db.transaction(() => {
    const resAcc = db.prepare("DELETE FROM accounts WHERE expires_at < ? AND role != 'moderator'").run(now);
    const resSess = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return { prunedAccounts: resAcc.changes, prunedSessions: resSess.changes };
  });
  const result = run();
  if (result.prunedAccounts > 0 || result.prunedSessions > 0) {
    console.log(`[DB] Retention sweep: pruned ${result.prunedAccounts} expired account(s), ${result.prunedSessions} expired session(s)`);
  }
  return result;
}

let maintenanceTimer = null;
export function startMaintenance() {
  pruneExpiredData();
  if (!maintenanceTimer) {
    maintenanceTimer = setInterval(pruneExpiredData, 6 * 60 * 60 * 1000);
    maintenanceTimer.unref();
  }
}

export { db };
