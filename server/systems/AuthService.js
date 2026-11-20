import crypto from 'crypto';
import { db, hashPassword, verifyPassword, RETENTION_MS, SESSION_TTL_MS } from './Database.js';

class AuthService {
  register(username, password) {
    const cleanUser = (username || '').trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUser)) {
      return { error: 'Username must be 3-20 alphanumeric/underscore characters.' };
    }
    if (!password || password.length < 8 || password.length > 100) {
      return { error: 'Password must be 8-100 characters.' };
    }

    const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(cleanUser);
    if (existing) {
      return { error: 'Username is already taken.' };
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const { salt, hash } = hashPassword(password);
    db.prepare(`
      INSERT INTO accounts (id, username, password_hash, salt, role, is_banned, created_at, last_login_at, expires_at)
      VALUES (?, ?, ?, ?, 'player', 0, ?, ?, ?)
    `).run(id, cleanUser, hash, salt, now, now, now + RETENTION_MS);

    const token = this.createSession(id);
    return {
      token,
      account: { id, username: cleanUser, role: 'player', expiresAt: now + RETENTION_MS }
    };
  }

  login(username, password) {
    const cleanUser = (username || '').trim();
    const acc = db.prepare('SELECT * FROM accounts WHERE username = ?').get(cleanUser);
    if (!acc || !verifyPassword(password || '', acc.salt, acc.password_hash)) {
      return { error: 'Invalid username or password.' };
    }
    if (acc.is_banned) {
      return { error: 'Account is suspended.' };
    }

    // Refresh 6-month rolling expiration on login
    const now = Date.now();
    const newExpires = now + RETENTION_MS;
    db.prepare('UPDATE accounts SET last_login_at = ?, expires_at = ? WHERE id = ?').run(now, newExpires, acc.id);

    const token = this.createSession(acc.id);
    return {
      token,
      account: { id: acc.id, username: acc.username, role: acc.role, expiresAt: newExpires }
    };
  }

  createSession(accountId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)').run(token, accountId, now + SESSION_TTL_MS);
    return token;
  }

  validateSession(token) {
    if (!token) return null;
    const now = Date.now();
    const row = db.prepare(`
      SELECT a.id, a.username, a.role, a.is_banned, a.expires_at, s.expires_at AS session_expires
      FROM sessions s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ?
    `).get(token);

    if (!row || row.session_expires < now || row.is_banned) return null;

    // Roll forward 6-month retention on active session use
    db.prepare('UPDATE accounts SET last_login_at = ?, expires_at = ? WHERE id = ?').run(now, now + RETENTION_MS, row.id);
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      expiresAt: now + RETENTION_MS
    };
  }

  logout(token) {
    if (!token) return;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

export const authService = new AuthService();
