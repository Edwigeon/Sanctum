import crypto from 'crypto';
import { GAME_MODES } from '../../shared/Constants.js';
import { dataRegistry } from './DataRegistry.js';
import { db } from './Database.js';

const DEFAULT_EQUIPMENT = {
  ring1: null,
  helm: null,
  amulet: null,
  weapon: null,
  armor: null,
  offhand: null,
  gloves: null,
  boots: null,
  ring2: null
};

function rowToCharacter(row) {
  if (!row) return null;
  let data = { stats: {}, equipment: {}, inventory: [], gold: 0 };
  try {
    data = JSON.parse(row.data_json);
  } catch { /* fallback */ }
  const equipment = Object.assign({ ...DEFAULT_EQUIPMENT }, data.equipment);
  if (data.equipment?.ring && !equipment.ring1) {
    equipment.ring1 = data.equipment.ring;
  }
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    classId: row.class_id,
    mode: row.mode,
    level: row.level,
    xp: row.xp,
    nextXp: row.next_xp,
    statPoints: row.stat_points,
    potions: row.potions,
    gold: data.gold || 0,
    isDead: !!row.is_dead,
    highestFloor: row.highest_floor,
    stats: data.stats || {},
    equipment,
    inventory: data.inventory || [],
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
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
    return rowToCharacter(row);
  }

  createCharacter({ accountId, name, classId, mode }) {
    const cls = dataRegistry.getClass(classId);
    const safeMode = mode === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;
    const id = crypto.randomUUID();
    const cleanName = (name || 'Wanderer').trim().slice(0, 16) || 'Wanderer';
    const now = Date.now();
    const dataJson = JSON.stringify({
      stats: { ...cls.stats },
      equipment: { ...DEFAULT_EQUIPMENT },
      inventory: [
        {
          id: 1,
          type: 'potion',
          subType: 'hp',
          name: 'Health Potion',
          rarity: 1,
          count: 3,
          maxStack: 20,
          weight: 0.2
        }
      ],
      gold: 50
    });

    db.prepare(`
      INSERT INTO characters (id, account_id, name, class_id, mode, level, xp, next_xp, stat_points, potions, is_dead, highest_floor, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 0, 100, 0, 3, 0, 1, ?, ?)
    `).run(id, accountId, cleanName, cls.id, safeMode, dataJson, now);

    return this.getCharacter(id);
  }

  saveFromPlayer(p, floor = 1, { immediate = false } = {}) {
    if (!p.characterId) return;
    if (!immediate) {
      if (!this._pendingSaves) this._pendingSaves = new Map();
      const existingTimer = this._pendingSaves.get(p.characterId);
      if (existingTimer) clearTimeout(existingTimer);
      // Snapshot mutable state immediately, coalesce rapid calls onto next event-loop turn
      const snapshot = {
        characterId: p.characterId,
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
    if (!p.characterId) return;
    const existing = db.prepare('SELECT highest_floor, is_dead, account_id FROM characters WHERE id = ?').get(p.characterId);
    if (!existing) return;

    const isDead = p.mode === GAME_MODES.HARDCORE ? (p.isDead ? 1 : 0) : 0;
    const highestFloor = Math.max(existing.highest_floor || 1, floor);
    const dataJson = JSON.stringify({
      stats: p.stats,
      equipment: p.equipment,
      inventory: p.inventory,
      gold: p.gold || 0
    });

    db.prepare(`
      UPDATE characters
      SET level = ?, xp = ?, next_xp = ?, stat_points = ?, potions = ?, is_dead = ?, highest_floor = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(p.level, p.xp, p.nextXp, p.statPoints, p.potions, isDead, highestFloor, dataJson, Date.now(), p.characterId);

    // Record Hardcore death in active-player Hall of Fallen Heroes (cascades on account prune)
    if (p.mode === GAME_MODES.HARDCORE && p.isDead && !existing.is_dead) {
      const acc = db.prepare('SELECT username FROM accounts WHERE id = ?').get(existing.account_id);
      const snapshotJson = JSON.stringify({ stats: p.stats, equipment: p.equipment });
      db.prepare(`
        INSERT INTO fallen_heroes (id, account_id, account_name, hero_name, class_id, level, floor, data_json, died_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), existing.account_id, acc?.username || 'Unknown', p.name, p.classId, p.level, floor, snapshotJson, Date.now());
    }
  }

  deleteCharacter(charId, accountId) {
    const res = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?').run(charId, accountId);
    return res.changes > 0;
  }

  listFallenHeroes(limit = 50) {
    return db.prepare('SELECT * FROM fallen_heroes ORDER BY died_at DESC LIMIT ?').all(limit);
  }

  listLegends(limit = 50) {
    return db.prepare('SELECT * FROM hall_of_legends ORDER BY inducted_at DESC LIMIT ?').all(limit);
  }
}

export const saveManager = new SaveManager();
