import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../../data/saves/sanctum.db');

export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 6 months (180 days)
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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
`);

// Ensure fallen_heroes has account_id and data_json columns
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

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ensureDefaultModerator() {
  const modExists = db.prepare("SELECT id FROM accounts WHERE role = 'moderator' LIMIT 1").get();
  if (!modExists) {
    const username = process.env.SANCTUM_MOD_USER || 'admin';
    const password = process.env.SANCTUM_MOD_PASS || 'sanctum-mod';
    const now = Date.now();
    const { salt, hash } = hashPassword(password);
    db.prepare(`
      INSERT INTO accounts (id, username, password_hash, salt, role, is_banned, created_at, last_login_at, expires_at)
      VALUES (?, ?, ?, ?, 'moderator', 0, ?, ?, ?)
    `).run(crypto.randomUUID(), username, hash, salt, now, now, now + RETENTION_MS);
    console.log(`[DB] Bootstrapped default moderator account: username="${username}" password="${password}"`);
  }
}

export function pruneExpiredData() {
  const now = Date.now();
  const resAcc = db.prepare("DELETE FROM accounts WHERE expires_at < ? AND role != 'moderator'").run(now);
  const resSess = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  if (resAcc.changes > 0 || resSess.changes > 0) {
    console.log(`[DB] Retention sweep: pruned ${resAcc.changes} expired account(s), ${resSess.changes} expired session(s)`);
  }
  return { prunedAccounts: resAcc.changes, prunedSessions: resSess.changes };
}

ensureDefaultModerator();
pruneExpiredData();
setInterval(pruneExpiredData, 24 * 60 * 60 * 1000).unref();

export { db };
