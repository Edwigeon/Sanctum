import { db, pruneExpiredData, RETENTION_MS } from './Database.js';
import { saveManager } from './SaveManager.js';

class ModService {
  getOverview() {
    const now = Date.now();
    const soon = now + 30 * 24 * 60 * 60 * 1000;
    const totalAccounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
    const totalCharacters = db.prepare('SELECT COUNT(*) AS c FROM characters').get().c;
    const fallenHeroes = db.prepare('SELECT COUNT(*) AS c FROM fallen_heroes').get().c;
    const expiringSoon = db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE expires_at < ? AND role != 'moderator'").get(soon).c;
    return { totalAccounts, totalCharacters, fallenHeroes, expiringSoon };
  }

  searchAccounts(query = '') {
    const q = `%${(query || '').trim()}%`;
    return db.prepare(`
      SELECT a.id, a.username, a.role, a.is_banned, a.created_at, a.last_login_at, a.expires_at,
             COUNT(c.id) AS char_count
      FROM accounts a
      LEFT JOIN characters c ON c.account_id = a.id
      WHERE a.username LIKE ?
      GROUP BY a.id
      ORDER BY a.last_login_at DESC
      LIMIT 50
    `).all(q);
  }

  updateAccount(id, patch = {}) {
    const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!acc) return null;

    if (typeof patch.isBanned === 'boolean') {
      db.prepare('UPDATE accounts SET is_banned = ? WHERE id = ?').run(patch.isBanned ? 1 : 0, id);
      if (patch.isBanned) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
    }
    if (patch.role === 'player' || patch.role === 'moderator') {
      db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(patch.role, id);
    }
    if (patch.extendRetention) {
      db.prepare('UPDATE accounts SET expires_at = ? WHERE id = ?').run(Date.now() + RETENTION_MS, id);
    }

    return db.prepare('SELECT id, username, role, is_banned, created_at, last_login_at, expires_at FROM accounts WHERE id = ?').get(id);
  }

  deleteAccount(id) {
    const res = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return res.changes > 0;
  }

  searchCharacters(query = '', mode = '') {
    const q = `%${(query || '').trim()}%`;
    const rows = mode
      ? db.prepare(`
          SELECT c.*, a.username AS owner_username
          FROM characters c
          JOIN accounts a ON a.id = c.account_id
          WHERE (c.name LIKE ? OR a.username LIKE ?) AND c.mode = ?
          ORDER BY c.updated_at DESC
          LIMIT 50
        `).all(q, q, mode)
      : db.prepare(`
          SELECT c.*, a.username AS owner_username
          FROM characters c
          JOIN accounts a ON a.id = c.account_id
          WHERE c.name LIKE ? OR a.username LIKE ?
          ORDER BY c.updated_at DESC
          LIMIT 50
        `).all(q, q);

    return rows.map(r => {
      const char = saveManager.getCharacter(r.id);
      return { ...char, ownerUsername: r.owner_username };
    });
  }

  updateCharacter(id, patch = {}) {
    const existing = saveManager.getCharacter(id);
    if (!existing) return null;

    const name = typeof patch.name === 'string' ? patch.name.trim().slice(0, 16) || existing.name : existing.name;
    const level = Number.isFinite(Number(patch.level)) ? Math.max(1, Math.floor(Number(patch.level))) : existing.level;
    const xp = Number.isFinite(Number(patch.xp)) ? Math.max(0, Math.floor(Number(patch.xp))) : existing.xp;
    const nextXp = Number.isFinite(Number(patch.nextXp)) ? Math.max(10, Math.floor(Number(patch.nextXp))) : existing.nextXp;
    const statPoints = Number.isFinite(Number(patch.statPoints)) ? Math.max(0, Math.floor(Number(patch.statPoints))) : existing.statPoints;
    const potions = Number.isFinite(Number(patch.potions)) ? Math.max(0, Math.floor(Number(patch.potions))) : existing.potions;
    const isDead = typeof patch.isDead === 'boolean' ? (patch.isDead ? 1 : 0) : (existing.isDead ? 1 : 0);
    const highestFloor = Number.isFinite(Number(patch.highestFloor)) ? Math.max(1, Math.floor(Number(patch.highestFloor))) : existing.highestFloor;

    const dataJson = JSON.stringify({
      stats: patch.stats && typeof patch.stats === 'object' ? patch.stats : existing.stats,
      equipment: patch.equipment && typeof patch.equipment === 'object' ? patch.equipment : existing.equipment,
      inventory: Array.isArray(patch.inventory) ? patch.inventory : existing.inventory
    });

    db.prepare(`
      UPDATE characters
      SET name = ?, level = ?, xp = ?, next_xp = ?, stat_points = ?, potions = ?, is_dead = ?, highest_floor = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(name, level, xp, nextXp, statPoints, potions, isDead, highestFloor, dataJson, Date.now(), id);

    return saveManager.getCharacter(id);
  }

  deleteCharacter(id) {
    const res = db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return res.changes > 0;
  }

  runPrune() {
    return pruneExpiredData();
  }
}

export const modService = new ModService();
