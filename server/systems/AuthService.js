/**
 * Account authentication, session lifecycle and revocation.
 *
 * - Bearer tokens are 256-bit random; only their SHA-256 is stored server-side.
 * - Login performs a full scrypt verification even for unknown usernames (no timing oracle)
 *   and always returns the same generic failure.
 * - Per-account throttling applies to ANY submitted username (existing or not), so lockouts
 *   cannot be used to enumerate accounts.
 * - Emits 'revoked' events so live WebSocket sessions are terminated immediately.
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import {
  db, hashPasswordAsync, verifyPasswordAsync, unusablePasswordHash, sha256Hex, RETENTION_MS, SESSION_TTL_MS
} from './Database.js';
import { audit } from './AuditLog.js';
import { validatePassword } from './security/PasswordPolicy.js';

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'moderator', 'mod', 'root', 'system', 'sanctum', 'support', 'staff']);
const GENERIC_LOGIN_ERROR = 'Invalid username or password.';
const GENERIC_THROTTLE_ERROR = 'Too many attempts. Please try again later.';
const ROLL_EXPIRY_AFTER_MS = 60 * 60 * 1000;
const DUMMY = unusablePasswordHash();

class AccountThrottle {
  constructor() {
    this.entries = new Map();
    setInterval(() => this.sweep(), 5 * 60 * 1000).unref();
  }
  key(username) {
    return String(username || '').trim().toLowerCase().slice(0, 64);
  }
  check(username) {
    const e = this.entries.get(this.key(username));
    if (e && e.lockedUntil > Date.now()) return { locked: true, retryAfterMs: e.lockedUntil - Date.now() };
    return { locked: false };
  }
  fail(username) {
    const k = this.key(username);
    const now = Date.now();
    const L = config.limits;
    const e = this.entries.get(k) || { failures: 0, lockedUntil: 0, lastAt: now };
    e.failures++;
    e.lastAt = now;
    if (e.failures >= L.accountFailThreshold) {
      const exp = Math.min(10, e.failures - L.accountFailThreshold);
      e.lockedUntil = now + Math.min(L.accountLockMaxMs, L.accountLockBaseMs * 2 ** exp);
    }
    if (this.entries.size < 200000) this.entries.set(k, e);
  }
  success(username) {
    this.entries.delete(this.key(username));
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.entries) {
      if (e.lockedUntil < now && now - e.lastAt > 60 * 60 * 1000) this.entries.delete(k);
    }
  }
  clear() {
    this.entries.clear();
  }
}

function publicAccount(row, expiresAt = row.expires_at) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    expiresAt
  };
}

class AuthService extends EventEmitter {
  constructor() {
    super();
    this.throttle = new AccountThrottle();
    this.inFlightHashes = 0;
  }

  async _withHashSlot(fn) {
    if (this.inFlightHashes >= config.limits.maxConcurrentHashes) {
      return { error: 'Server is busy. Please try again shortly.', status: 503 };
    }
    this.inFlightHashes++;
    try {
      return await fn();
    } finally {
      this.inFlightHashes--;
    }
  }

  async register(username, password, { ip = null } = {}) {
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    if (!USERNAME_RE.test(cleanUser)) {
      return { error: 'Username must be 3-20 letters, digits or underscores.', status: 400 };
    }
    const pwErr = validatePassword(password, { username: cleanUser });
    if (pwErr) return { error: pwErr, status: 400 };

    return this._withHashSlot(async () => {
      // Hash before the uniqueness check so taken / free usernames cost the same time.
      const { salt, hash } = await hashPasswordAsync(password);
      const now = Date.now();
      const id = crypto.randomUUID();
      const generic = { error: 'Unable to create an account with that username. Please choose another.', status: 400 };
      if (RESERVED_USERNAMES.has(cleanUser.toLowerCase())) return generic;
      try {
        // Role is hard-coded: public registration can never create a moderator.
        db.prepare(`
          INSERT INTO accounts (id, username, password_hash, salt, role, is_banned, created_at, last_login_at, expires_at, must_change_password, password_changed_at)
          VALUES (?, ?, ?, ?, 'player', 0, ?, ?, ?, 0, ?)
        `).run(id, cleanUser, hash, salt, now, now, now + RETENTION_MS, now);
      } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return generic;
        throw e;
      }
      audit({ actor: { id, username: cleanUser }, action: 'account.registered', targetType: 'account', targetId: id, ip });
      const token = this.createSession(id);
      return { token, account: { id, username: cleanUser, role: 'player', mustChangePassword: false, expiresAt: now + RETENTION_MS } };
    });
  }

  async login(username, password, { ip = null } = {}) {
    const cleanUser = typeof username === 'string' ? username.trim().slice(0, 64) : '';
    const pw = typeof password === 'string' && password.length <= 1024 ? password : '';
    const t = this.throttle.check(cleanUser);
    if (t.locked) return { error: GENERIC_THROTTLE_ERROR, status: 429, retryAfterMs: t.retryAfterMs };

    return this._withHashSlot(async () => {
      const acc = cleanUser ? db.prepare('SELECT * FROM accounts WHERE username = ?').get(cleanUser) : null;
      const ok = await verifyPasswordAsync(pw, acc ? acc.salt : DUMMY.salt, acc ? acc.password_hash : DUMMY.hash);
      if (!acc || !ok || !pw) {
        this.throttle.fail(cleanUser);
        return { error: GENERIC_LOGIN_ERROR, status: 401 };
      }
      this.throttle.success(cleanUser);
      if (acc.is_banned) return { error: 'Account is suspended.', status: 403 };

      const now = Date.now();
      const newExpires = now + RETENTION_MS;
      db.prepare('UPDATE accounts SET last_login_at = ?, expires_at = ? WHERE id = ?').run(now, newExpires, acc.id);
      const token = this.createSession(acc.id);
      if (acc.role === 'moderator') {
        audit({ actor: acc, action: 'moderator.login', targetType: 'account', targetId: acc.id, ip });
      }
      return { token, account: publicAccount(acc, newExpires) };
    });
  }

  createSession(accountId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256Hex(token), accountId, now, now + SESSION_TTL_MS);
    return token;
  }

  static hashToken(token) {
    return typeof token === 'string' && TOKEN_RE.test(token) ? sha256Hex(token) : null;
  }

  validateSession(token) {
    const h = AuthService.hashToken(token);
    return h ? this.validateSessionHash(h) : null;
  }

  /** Full server-side check: session exists, not expired, account not expired / banned. */
  validateSessionHash(tokenHash) {
    if (typeof tokenHash !== 'string' || tokenHash.length !== 64) return null;
    const now = Date.now();
    const row = db.prepare(`
      SELECT a.*, s.expires_at AS session_expires
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?
    `).get(tokenHash);
    if (!row) return null;
    if (row.session_expires < now || row.is_banned || (row.role !== 'moderator' && row.expires_at < now)) {
      if (row.session_expires < now) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    let expiresAt = row.expires_at;
    if (now - row.last_login_at > ROLL_EXPIRY_AFTER_MS) {
      expiresAt = now + RETENTION_MS;
      db.prepare('UPDATE accounts SET last_login_at = ?, expires_at = ? WHERE id = ?').run(now, expiresAt, row.id);
    }
    return { ...publicAccount(row, expiresAt), sessionHash: tokenHash };
  }

  logout(token) {
    const h = AuthService.hashToken(token);
    if (!h) return false;
    const res = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    if (res.changes > 0) this.emit('revoked', { sessionHashes: [h] });
    return res.changes > 0;
  }

  /** Revoke every session of an account (optionally keeping one). Kicks live sockets. */
  revokeAllSessions(accountId, { exceptHash = null } = {}) {
    const res = exceptHash
      ? db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?').run(accountId, exceptHash)
      : db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
    this.emit('revoked', { accountId, exceptHash });
    return res.changes;
  }

  async changePassword(account, currentPassword, newPassword, { ip = null } = {}) {
    const t = this.throttle.check(account.username);
    if (t.locked) return { error: GENERIC_THROTTLE_ERROR, status: 429, retryAfterMs: t.retryAfterMs };
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
    if (!row) return { error: 'Unauthorized', status: 401 };
    const pwErr = validatePassword(newPassword, { username: row.username, strong: row.role === 'moderator' });
    if (pwErr) return { error: pwErr, status: 400 };

    return this._withHashSlot(async () => {
      const cur = typeof currentPassword === 'string' && currentPassword.length <= 1024 ? currentPassword : '';
      if (!cur || !(await verifyPasswordAsync(cur, row.salt, row.password_hash))) {
        this.throttle.fail(row.username);
        return { error: 'Current password is incorrect.', status: 401 };
      }
      this.throttle.success(row.username);
      if (await verifyPasswordAsync(newPassword, row.salt, row.password_hash)) {
        return { error: 'New password must differ from the current password.', status: 400 };
      }
      const { salt, hash } = await hashPasswordAsync(newPassword);
      const now = Date.now();
      let token;
      db.transaction(() => {
        db.prepare('UPDATE accounts SET password_hash = ?, salt = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?')
          .run(hash, salt, now, row.id);
        // Every existing session (including the one used for this request) is invalidated.
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(row.id);
        token = this.createSession(row.id);
        audit({ actor: row, action: 'account.password_changed', targetType: 'account', targetId: row.id, ip });
      })();
      this.emit('revoked', { accountId: row.id, exceptHash: sha256Hex(token) });
      const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(row.id);
      return { token, account: publicAccount(fresh) };
    });
  }
}

export { AuthService };
export const authService = new AuthService();
