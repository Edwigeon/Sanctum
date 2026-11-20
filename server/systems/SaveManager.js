import crypto from 'crypto';
import { GAME_MODES } from '../../shared/Constants.js';
import { config } from '../config.js';
import { dataRegistry } from './DataRegistry.js';
import { db } from './Database.js';
import { sanitizeCharacterData, sanitizeHeroName, sanitizeProgress } from './CharacterSanitizer.js';

const CHAR_ID_RE = /^[0-9a-f-]{36}$/;

export function isValidCharacterId(id) {
  return typeof id === 'string' && CHAR_ID_RE.test(id);
}

function rowToCharacter(row) {
  if (!row) return null;
  let raw = {};
  try {
    raw = JSON.parse(row.data_json);
  } catch { /* corrupted JSON falls back to sanitized defaults */ }
  const data = sanitizeCharacterData(raw, row.class_id);
  const prog = sanitizeProgress({
    level: row.level, xp: row.xp, nextXp: row.next_xp, statPoints: row.stat_points,
    potions: row.potions, highestFloor: row.highest_floor
  });
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    classId: row.class_id,
    mode: row.mode === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC,
    ...prog,
    gold: data.gold,
    isDead: !!row.is_dead,
    stats: data.stats,
    equipment: data.equipment,
    inventory: data.inventory,
    updatedAt: row.updated_at
  };
}

class SaveManager {
  listByAccount(accountId) {
    if (!accountId) return [];
    const rows = db.prepare('SELECT * FROM characters WHERE account_id = ? ORDER BY updated_at DESC').all(accountId);
    return rows.map(rowToCharacter);
  }

  getCharacter(charId) {
    if (!isValidCharacterId(charId)) return null;
    return rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(charId));
  }

  /** Ownership-scoped load: returns null unless the character belongs to accountId. */
  getCharacterForAccount(charId, accountId) {
    if (!isValidCharacterId(charId) || !accountId) return null;
    return rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ? AND account_id = ?').get(charId, accountId));
  }

  createCharacter({ accountId, name, classId, mode }) {
    if (!accountId) return { error: 'Unauthorized' };
    if (typeof classId !== 'string' || !dataRegistry.hasClass(classId)) return { error: 'Unknown class.' };
    if (mode !== GAME_MODES.HARDCORE && mode !== GAME_MODES.CLASSIC) return { error: 'Unknown game mode.' };
    const cls = dataRegistry.getClass(classId);
    const id = crypto.randomUUID();
    const cleanName = sanitizeHeroName(name);
    const now = Date.now();
    const dataJson = JSON.stringify({
      stats: { ...cls.stats },
      equipment: {},
      inventory: [{ id: 1, type: 'potion', subType: 'hp', name: 'Health Potion', rarity: 1, count: 3, maxStack: 20, weight: 0.2 }],
      gold: 50
    });

    const created = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) AS c FROM characters WHERE account_id = ?').get(accountId).c;
      if (count >= config.limits.maxCharactersPerAccount) return false;
      db.prepare(`
        INSERT INTO characters (id, account_id, name, class_id, mode, level, xp, next_xp, stat_points, potions, is_dead, highest_floor, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, 100, 0, 3, 0, 1, ?, ?)
      `).run(id, accountId, cleanName, cls.id, mode, dataJson, now);
      return true;
    })();
    if (!created) return { error: `Character limit reached (${config.limits.maxCharactersPerAccount}).` };
    return { character: this.getCharacter(id) };
  }

  saveFromPlayer(p, floor = 1, { immediate = false } = {}) {
    if (!p.characterId || !p.accountId) return;
    if (!immediate) {
      if (!this._pendingSaves) this._pendingSaves = new Map();
      const existingTimer = this._pendingSaves.get(p.characterId);
      if (existingTimer) clearTimeout(existingTimer);
      const snapshot = {
        characterId: p.characterId,
        accountId: p.accountId,
        mode: p.mode,
        isDead: p.isDead,
        name: p.name,
        classId: p.classId,
        level: p.level,
        xp: p.xp,
        nextXp: p.nextXp,
        statPoints: p.statPoints,
        potions: p.potions,
        stats: { ...p.stats },
        equipment: { ...p.equipment },
        inventory: [...p.inventory],
        gold: p.gold || 0
      };
      const timer = setTimeout(() => {
        this._pendingSaves.delete(snapshot.characterId);
        this._flushPlayerSave(snapshot, floor);
      }, 0);
      this._pendingSaves.set(p.characterId, timer);
      return;
    }
    if (this._pendingSaves?.has(p.characterId)) {
      clearTimeout(this._pendingSaves.get(p.characterId));
      this._pendingSaves.delete(p.characterId);
    }
    this._flushPlayerSave(p, floor);
  }

  _flushPlayerSave(p, floor = 1) {
    if (!p.characterId || !p.accountId) return;
    db.transaction(() => {
      // Ownership-scoped: a save can only ever touch the row owned by the player's account.
      const existing = db.prepare('SELECT highest_floor, is_dead, account_id, mode FROM characters WHERE id = ? AND account_id = ?')
        .get(p.characterId, p.accountId);
      if (!existing) return;

      const isHardcore = existing.mode === GAME_MODES.HARDCORE;
      // Hardcore death is permanent: a stale or replayed save can never resurrect a fallen hero.
      const isDead = isHardcore ? ((p.isDead || existing.is_dead) ? 1 : 0) : 0;
      const highestFloor = Math.max(existing.highest_floor || 1, Math.min(999, Math.floor(floor) || 1));
      const data = sanitizeCharacterData({ stats: p.stats, equipment: p.equipment, inventory: p.inventory, gold: p.gold }, p.classId);
      const prog = sanitizeProgress(p);

      db.prepare(`
        UPDATE characters
        SET level = ?, xp = ?, next_xp = ?, stat_points = ?, potions = ?, is_dead = ?, highest_floor = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND account_id = ?
      `).run(prog.level, prog.xp, prog.nextXp, prog.statPoints, prog.potions, isDead, highestFloor,
        JSON.stringify(data), Date.now(), p.characterId, p.accountId);

      if (isHardcore && isDead && !existing.is_dead) {
        const acc = db.prepare('SELECT username FROM accounts WHERE id = ?').get(existing.account_id);
        db.prepare(`
          INSERT INTO fallen_heroes (id, account_id, account_name, hero_name, class_id, level, floor, data_json, died_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), existing.account_id, acc?.username || 'Unknown', p.name, p.classId, prog.level, floor,
          JSON.stringify({ stats: data.stats, equipment: data.equipment }), Date.now());
      }
    })();
  }

  deleteCharacter(charId, accountId) {
    if (!isValidCharacterId(charId) || !accountId) return false;
    const res = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?').run(charId, accountId);
    return res.changes > 0;
  }

  listFallenHeroes(limit = 50) {
    return db.prepare(`
      SELECT id, account_name, hero_name, class_id, level, floor, data_json, died_at
      FROM fallen_heroes ORDER BY died_at DESC LIMIT ?
    `).all(limit);
  }

  listLegends(limit = 50) {
    return db.prepare('SELECT * FROM hall_of_legends ORDER BY inducted_at DESC LIMIT ?').all(limit);
  }
}

export const saveManager = new SaveManager();
