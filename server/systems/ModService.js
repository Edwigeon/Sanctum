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

    const name = typeof patch.name === 'string'
      ? patch.name.trim().replace(/[<>]/g, '').slice(0, 16) || existing.name
      : existing.name;
    const level = Number.isFinite(Number(patch.level)) ? Math.max(1, Math.min(999, Math.floor(Number(patch.level)))) : existing.level;
    const xp = Number.isFinite(Number(patch.xp)) ? Math.max(0, Math.floor(Number(patch.xp))) : existing.xp;
    const nextXp = Number.isFinite(Number(patch.nextXp)) ? Math.max(10, Math.floor(Number(patch.nextXp))) : existing.nextXp;
    const statPoints = Number.isFinite(Number(patch.statPoints)) ? Math.max(0, Math.min(9999, Math.floor(Number(patch.statPoints)))) : existing.statPoints;
    const potions = Number.isFinite(Number(patch.potions)) ? Math.max(0, Math.min(99, Math.floor(Number(patch.potions)))) : existing.potions;
    const isDead = typeof patch.isDead === 'boolean' ? (patch.isDead ? 1 : 0) : (existing.isDead ? 1 : 0);
    const highestFloor = Number.isFinite(Number(patch.highestFloor)) ? Math.max(1, Math.min(999, Math.floor(Number(patch.highestFloor)))) : existing.highestFloor;

    // Sanitize stats to prevent malformed or prototype-injected fields
    const safeStats = { ...existing.stats };
    if (patch.stats && typeof patch.stats === 'object' && !Array.isArray(patch.stats)) {
      for (const key of ['might', 'focus', 'agility', 'vitality']) {
        if (Number.isFinite(Number(patch.stats[key]))) {
          safeStats[key] = Math.max(1, Math.min(999, Math.floor(Number(patch.stats[key]))));
        }
      }
    }

    // Sanitize equipment to valid gear slots
    const safeEquipment = { ...existing.equipment };
    if (patch.equipment && typeof patch.equipment === 'object' && !Array.isArray(patch.equipment)) {
      for (const slot of ['ring1', 'helm', 'amulet', 'weapon', 'armor', 'offhand', 'gloves', 'boots', 'ring2', 'ring']) {
        if (patch.equipment[slot] === null) {
          safeEquipment[slot] = null;
        } else if (patch.equipment[slot] && typeof patch.equipment[slot] === 'object') {
          const item = patch.equipment[slot];
          safeEquipment[slot] = {
            id: item.id || `eq_${slot}`,
            name: String(item.name || slot).slice(0, 32),
            slot,
            weight: Number.isFinite(Number(item.weight)) ? Math.max(0, Number(item.weight)) : 1,
            rarity: Number.isFinite(Number(item.rarity)) ? Math.max(0, Math.min(4, Math.floor(Number(item.rarity)))) : 0,
            stats: (item.stats && typeof item.stats === 'object') ? item.stats : {}
          };
        }
      }
    }

    // Sanitize inventory (cap length at 40 items)
    let safeInventory = existing.inventory;
    if (Array.isArray(patch.inventory)) {
      safeInventory = patch.inventory.slice(0, 40).filter(it => it && typeof it === 'object');
    }

    const dataJson = JSON.stringify({
      stats: safeStats,
      equipment: safeEquipment,
      inventory: safeInventory
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
