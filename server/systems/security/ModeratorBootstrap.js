/**
 * One-time initial moderator provisioning.
 *
 * Sources (first match wins):
 *   1. config/initial-moderator.json  (override path with SANCTUM_INITIAL_MOD_FILE)
 *   2. SANCTUM_INITIAL_MOD_USERNAME + SANCTUM_INITIAL_MOD_PASSWORD environment variables
 *
 * Provisioning only runs when no moderator exists AND it has never completed before.
 * The account is created in a single transaction, flagged must_change_password, and the
 * source secret is destroyed afterwards. Credentials are never logged.
 */
import crypto from 'crypto';
import fs from 'fs';
import { config } from '../../config.js';
import { db, getMeta, setMeta, hashPassword, verifyPassword, unusablePasswordHash, RETENTION_MS } from '../Database.js';
import { audit } from '../AuditLog.js';
import { validatePassword } from './PasswordPolicy.js';

export const PROVISIONED_META_KEY = 'moderator_bootstrap';
export const MOD_USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const LEGACY_DEFAULT_PASSWORDS = ['sanctum-mod'];
const ENV_USER = 'SANCTUM_INITIAL_MOD_USERNAME';
const ENV_PASS = 'SANCTUM_INITIAL_MOD_PASSWORD';
const MAX_FILE_BYTES = 4096;

class BootstrapError extends Error {}

/**
 * Older builds created `admin` / `sanctum-mod` automatically. Any moderator still using a
 * known default password is locked (random password), demoted and logged out.
 */
export function disableLegacyDefaultModerators(logger = console) {
  const mods = db.prepare("SELECT id, salt, password_hash FROM accounts WHERE role = 'moderator'").all();
  let disabled = 0;
  for (const m of mods) {
    if (!LEGACY_DEFAULT_PASSWORDS.some(pw => verifyPassword(pw, m.salt, m.password_hash))) continue;
    const { salt, hash } = unusablePasswordHash();
    db.transaction(() => {
      db.prepare(`UPDATE accounts SET role = 'player', password_hash = ?, salt = ?, must_change_password = 1 WHERE id = ?`)
        .run(hash, salt, m.id);
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(m.id);
      audit({ action: 'security.default_moderator_disabled', targetType: 'account', targetId: m.id });
    })();
    disabled++;
  }
  if (disabled > 0) {
    logger.warn(`[Bootstrap] Disabled ${disabled} legacy moderator account(s) that used built-in default credentials.`);
  }
  if (process.env.SANCTUM_MOD_USER || process.env.SANCTUM_MOD_PASS) {
    logger.warn('[Bootstrap] SANCTUM_MOD_USER / SANCTUM_MOD_PASS are no longer supported and were ignored. Use config/initial-moderator.json or SANCTUM_INITIAL_MOD_* instead.');
    delete process.env.SANCTUM_MOD_PASS;
  }
  return disabled;
}

function readConfigFile(filePath) {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new BootstrapError('bootstrap file could not be inspected');
  }
  if (!st.isFile()) throw new BootstrapError('bootstrap path is not a regular file (symlinks are refused)');
  if (st.size > MAX_FILE_BYTES) throw new BootstrapError('bootstrap file is too large');
  if (process.platform !== 'win32') {
    if ((st.mode & 0o077) !== 0) {
      throw new BootstrapError(`bootstrap file permissions are too open (${(st.mode & 0o777).toString(8)}); run: chmod 600 <file>`);
    }
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new BootstrapError('bootstrap file must be owned by the server account');
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new BootstrapError('bootstrap file is not valid JSON');
  }
  return parsed;
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new BootstrapError('configuration must be a JSON object');
  const keys = Object.keys(cfg);
  const unknown = keys.filter(k => k !== 'username' && k !== 'password');
  if (unknown.length) throw new BootstrapError(`unknown configuration key(s): ${unknown.join(', ')}`);
  if (typeof cfg.username !== 'string' || !MOD_USERNAME_RE.test(cfg.username)) {
    throw new BootstrapError('username must be 3-24 characters of letters, digits, "_" or "-"');
  }
  const pwErr = validatePassword(cfg.password, { username: cfg.username, strong: true });
  if (pwErr) throw new BootstrapError(`password rejected: ${pwErr}`);
  return { username: cfg.username, password: cfg.password };
}

/** Overwrite then unlink. If unlink is impossible, the zeroed file is left (disabled). */
function destroyFile(filePath, logger) {
  try {
    const size = fs.statSync(filePath).size;
    const fd = fs.openSync(filePath, 'r+');
    try {
      fs.writeSync(fd, Buffer.alloc(Math.max(size, 1), 0), 0, Math.max(size, 1), 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* fall through to unlink */ }
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    logger.warn('[Bootstrap] Could not delete the bootstrap file; its contents were wiped. Remove it manually.');
    return false;
  }
}

export function isBootstrapCompleted() {
  return getMeta(PROVISIONED_META_KEY) !== null;
}

export function runModeratorBootstrap({ filePath = config.initialModFile, env = process.env, logger = console } = {}) {
  disableLegacyDefaultModerators(logger);

  const fileExists = fs.existsSync(filePath);
  const envPresent = Boolean(env[ENV_USER] || env[ENV_PASS]);
  const source = fileExists ? 'file' : (envPresent ? 'env' : null);
  const scrubEnv = () => { delete env[ENV_USER]; delete env[ENV_PASS]; };

  const modCount = db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE role = 'moderator'").get().c;

  if (isBootstrapCompleted() || modCount > 0) {
    if (!isBootstrapCompleted()) {
      setMeta(PROVISIONED_META_KEY, JSON.stringify({ at: Date.now(), source: 'pre-existing-moderator' }));
    }
    if (source) {
      logger.warn(`[Bootstrap] Moderator provisioning already completed; ignoring initial moderator ${source === 'file' ? 'file' : 'environment variables'}. Remove it.`);
    }
    scrubEnv();
    return { status: 'skipped', reason: 'already-provisioned' };
  }

  if (!source) {
    logger.warn('[Bootstrap] No moderator account exists. Create config/initial-moderator.json (chmod 600) or set SANCTUM_INITIAL_MOD_USERNAME / SANCTUM_INITIAL_MOD_PASSWORD, then restart.');
    return { status: 'none', reason: 'no-source' };
  }

  let creds;
  try {
    const raw = source === 'file' ? readConfigFile(filePath) : { username: env[ENV_USER], password: env[ENV_PASS] };
    creds = validateConfig(raw);
  } catch (e) {
    scrubEnv();
    const reason = e instanceof BootstrapError ? e.message : 'unexpected error reading configuration';
    logger.error(`[Bootstrap] Initial moderator ${source} rejected: ${reason}. No account was created.`);
    return { status: 'rejected', reason };
  }

  const { salt, hash } = hashPassword(creds.password);
  creds.password = null;
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM accounts WHERE role = 'moderator' LIMIT 1").get()) throw new BootstrapError('a moderator already exists');
      if (getMeta(PROVISIONED_META_KEY) !== null) throw new BootstrapError('provisioning already completed');
      if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(creds.username)) {
        throw new BootstrapError('username is already in use by another account');
      }
      db.prepare(`
        INSERT INTO accounts (id, username, password_hash, salt, role, is_banned, created_at, last_login_at, expires_at, must_change_password, password_changed_at)
        VALUES (?, ?, ?, ?, 'moderator', 0, ?, ?, ?, 1, ?)
      `).run(id, creds.username, hash, salt, now, now, now + RETENTION_MS, now);
      setMeta(PROVISIONED_META_KEY, JSON.stringify({ at: now, source, accountId: id }));
      audit({ action: 'security.moderator_bootstrapped', targetType: 'account', targetId: id, details: { source } });
    })();
  } catch (e) {
    scrubEnv();
    const reason = e instanceof BootstrapError ? e.message : 'database error';
    logger.error(`[Bootstrap] Initial moderator provisioning failed: ${reason}.`);
    return { status: 'rejected', reason };
  }

  if (source === 'file') destroyFile(filePath, logger);
  scrubEnv();
  logger.log(`[Bootstrap] Initial moderator account provisioned from ${source}. A password change is required at first sign-in.`);
  return { status: 'provisioned', accountId: id, source };
}
