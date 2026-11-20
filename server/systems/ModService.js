/**
 * Moderator operations. Callers (HTTP layer) must already have verified the moderator role
 * for the current request; every mutation here is validated, transactional and audited.
 */
import { db, pruneExpiredData, RETENTION_MS } from './Database.js';
import { audit, listAudit } from './AuditLog.js';
import { authService } from './AuthService.js';
import { saveManager, isValidCharacterId } from './SaveManager.js';
import { BASE_STAT_KEYS, clampInt, sanitizeEquipment, sanitizeHeroName, sanitizeInventory } from './CharacterSanitizer.js';
import { GAME_MODES } from '../../shared/Constants.js';

const ACCOUNT_ID_RE = /^[0-9a-f-]{36}$/;
const ACCOUNT_PATCH_KEYS = new Set(['isBanned', 'role', 'extendRetention', 'revokeSessions', 'requirePasswordChange']);
const CHARACTER_PATCH_KEYS = new Set(['name', 'level', 'xp', 'nextXp', 'statPoints', 'potions', 'isDead', 'highestFloor', 'stats', 'equipment', 'inventory', 'gold']);

export class ModError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertPlainObject(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ModError(400, 'Patch must be a JSON object.');
}

function assertKnownKeys(patch, allowed) {
  const unknown = Object.keys(patch).filter(k => !allowed.has(k));
  if (unknown.length) throw new ModError(400, `Unknown field(s): ${unknown.slice(0, 5).join(', ')}`);
}

function activeModeratorCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE role = 'moderator' AND is_banned = 0").get().c;
}

const ACCOUNT_COLUMNS = 'id, username, role, is_banned, must_change_password, created_at, last_login_at, expires_at';

class ModService {
  getOverview() {
    const now = Date.now();
    const soon = now + 30 * 24 * 60 * 60 * 1000;
    return {
      totalAccounts: db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,
      totalCharacters: db.prepare('SELECT COUNT(*) AS c FROM characters').get().c,
      fallenHeroes: db.prepare('SELECT COUNT(*) AS c FROM fallen_heroes').get().c,
      expiringSoon: db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE expires_at < ? AND role != 'moderator'").get(soon).c
    };
  }

  searchAccounts(query = '') {
    const q = `%${String(query || '').trim().slice(0, 32).replace(/[%_\\]/g, '\\$&')}%`;
    return db.prepare(`
      SELECT a.id, a.username, a.role, a.is_banned, a.must_change_password, a.created_at, a.last_login_at, a.expires_at,
             COUNT(c.id) AS char_count
      FROM accounts a
      LEFT JOIN characters c ON c.account_id = a.id
      WHERE a.username LIKE ? ESCAPE '\\'
      GROUP BY a.id
      ORDER BY a.last_login_at DESC
      LIMIT 50
    `).all(q);
  }

  updateAccount(actorOrId, idOrPatch, maybePatch, maybeOpts = {}) {
    const hasActor = typeof actorOrId === 'object' && actorOrId !== null;
    const actor = hasActor ? actorOrId : null;
    const id = hasActor ? idOrPatch : actorOrId;
    const patch = hasActor ? (maybePatch || {}) : (idOrPatch || {});
    const { ip = null, strict = hasActor } = maybeOpts;

    if (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id)) {
      if (strict) throw new ModError(400, 'Invalid account id.');
      return null;
    }
    assertPlainObject(patch);
    if (strict) {
      assertKnownKeys(patch, ACCOUNT_PATCH_KEYS);
      if (patch.isBanned !== undefined && typeof patch.isBanned !== 'boolean') throw new ModError(400, 'isBanned must be boolean.');
      if (patch.role !== undefined && patch.role !== 'player' && patch.role !== 'moderator') throw new ModError(400, 'role must be "player" or "moderator".');
      for (const k of ['extendRetention', 'revokeSessions', 'requirePasswordChange']) {
        if (patch[k] !== undefined && typeof patch[k] !== 'boolean') throw new ModError(400, `${k} must be boolean.`);
      }
    }

    let revoke = false;
    const result = db.transaction(() => {
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      if (!acc) return null;
      const losesModAccess = acc.role === 'moderator' && !acc.is_banned &&
        (patch.isBanned === true || patch.role === 'player');
      if (losesModAccess && activeModeratorCount() <= 1) {
        throw new ModError(409, 'Cannot ban or demote the last active moderator.');
      }
      const changes = {};
      if (typeof patch.isBanned === 'boolean' && !!acc.is_banned !== patch.isBanned) {
        db.prepare('UPDATE accounts SET is_banned = ? WHERE id = ?').run(patch.isBanned ? 1 : 0, id);
        changes.isBanned = patch.isBanned;
        if (patch.isBanned) revoke = true;
      }
      if ((patch.role === 'player' || patch.role === 'moderator') && acc.role !== patch.role) {
        db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(patch.role, id);
        changes.role = patch.role;
        revoke = true; // privilege change: force re-authentication everywhere
      }
      if (patch.extendRetention === true) {
        db.prepare('UPDATE accounts SET expires_at = ? WHERE id = ?').run(Date.now() + RETENTION_MS, id);
        changes.extendRetention = true;
      }
      if (typeof patch.requirePasswordChange === 'boolean') {
        db.prepare('UPDATE accounts SET must_change_password = ? WHERE id = ?').run(patch.requirePasswordChange ? 1 : 0, id);
        changes.requirePasswordChange = patch.requirePasswordChange;
      }
      if (patch.revokeSessions === true) {
        changes.revokeSessions = true;
        revoke = true;
      }
      if (revoke) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      audit({ actor, action: 'mod.account.update', targetType: 'account', targetId: id, ip, details: { username: acc.username, changes } });
      return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id);
    })();
    if (result && revoke) authService.revokeAllSessions(id);
    return result;
  }

  deleteAccount(actorOrId, maybeId, maybeOpts = {}) {
    const hasActor = typeof actorOrId === 'object' && actorOrId !== null;
    const actor = hasActor ? actorOrId : null;
    const id = hasActor ? maybeId : actorOrId;
    const { ip = null, strict = hasActor } = maybeOpts;

    if (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id)) {
      if (strict) throw new ModError(400, 'Invalid account id.');
      return false;
    }
    if (actor && id === actor.id) throw new ModError(409, 'Moderators cannot delete their own account from the portal.');
    const deleted = db.transaction(() => {
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      if (!acc) return false;
      if (acc.role === 'moderator' && !acc.is_banned && activeModeratorCount() <= 1) {
        throw new ModError(409, 'Cannot delete the last active moderator.');
      }
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      audit({ actor, action: 'mod.account.delete', targetType: 'account', targetId: id, ip, details: { username: acc.username, role: acc.role } });
      return true;
    })();
    if (deleted) authService.revokeAllSessions(id);
    return deleted;
  }

  searchCharacters(query = '', mode = '') {
    const q = `%${String(query || '').trim().slice(0, 32).replace(/[%_\\]/g, '\\$&')}%`;
    const safeMode = mode === GAME_MODES.HARDCORE || mode === GAME_MODES.CLASSIC ? mode : '';
    const rows = safeMode
      ? db.prepare(`
          SELECT c.id, a.username AS owner_username FROM characters c JOIN accounts a ON a.id = c.account_id
          WHERE (c.name LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\') AND c.mode = ?
          ORDER BY c.updated_at DESC LIMIT 50
        `).all(q, q, safeMode)
      : db.prepare(`
          SELECT c.id, a.username AS owner_username FROM characters c JOIN accounts a ON a.id = c.account_id
          WHERE c.name LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\'
          ORDER BY c.updated_at DESC LIMIT 50
        `).all(q, q);
    return rows.map(r => ({ ...saveManager.getCharacter(r.id), ownerUsername: r.owner_username }));
  }

  updateCharacter(actorOrId, idOrPatch, maybePatch, maybeOpts = {}) {
    const hasActor = typeof actorOrId === 'object' && actorOrId !== null;
    const actor = hasActor ? actorOrId : null;
    const id = hasActor ? idOrPatch : actorOrId;
    const patch = hasActor ? (maybePatch || {}) : (idOrPatch || {});
    const { ip = null, strict = hasActor } = maybeOpts;

    if (!isValidCharacterId(id)) {
      if (strict) throw new ModError(400, 'Invalid character id.');
      return null;
    }
    assertPlainObject(patch);
    if (strict) {
      assertKnownKeys(patch, CHARACTER_PATCH_KEYS);
      if (patch.isDead !== undefined && typeof patch.isDead !== 'boolean') throw new ModError(400, 'isDead must be boolean.');
      if (patch.name !== undefined && typeof patch.name !== 'string') throw new ModError(400, 'name must be a string.');
      for (const k of ['level', 'xp', 'nextXp', 'statPoints', 'potions', 'highestFloor', 'gold']) {
        if (patch[k] !== undefined && (typeof patch[k] !== 'number' || !Number.isFinite(patch[k]))) {
          throw new ModError(400, `${k} must be a finite number.`);
        }
      }
      if (patch.stats !== undefined) {
        if (!patch.stats || typeof patch.stats !== 'object' || Array.isArray(patch.stats)) throw new ModError(400, 'stats must be an object.');
        const bad = Object.keys(patch.stats).filter(k => !BASE_STAT_KEYS.includes(k));
        if (bad.length) throw new ModError(400, `Unknown stat(s): ${bad.slice(0, 5).join(', ')}`);
        for (const k of Object.keys(patch.stats)) {
          if (typeof patch.stats[k] !== 'number' || !Number.isFinite(patch.stats[k])) {
            throw new ModError(400, `stats.${k} must be a finite number.`);
          }
        }
      }
      if (patch.inventory !== undefined && !Array.isArray(patch.inventory)) throw new ModError(400, 'inventory must be an array.');
      if (patch.equipment !== undefined && (!patch.equipment || typeof patch.equipment !== 'object' || Array.isArray(patch.equipment))) {
        throw new ModError(400, 'equipment must be an object.');
      }
    }

    return db.transaction(() => {
      const existing = saveManager.getCharacter(id);
      if (!existing) return null;
      const name = typeof patch.name === 'string' ? sanitizeHeroName(patch.name.replace(/[<>]/g, ''), existing.name) : existing.name;
      const level = clampInt(patch.level, 1, 999, existing.level);
      const xp = clampInt(patch.xp, 0, 2 ** 31 - 1, existing.xp);
      const nextXp = clampInt(patch.nextXp, 10, 2 ** 31 - 1, existing.nextXp);
      const statPoints = clampInt(patch.statPoints, 0, 9999, existing.statPoints);
      const potions = clampInt(patch.potions, 0, 99, existing.potions);
      const highestFloor = clampInt(patch.highestFloor, 1, 999, existing.highestFloor);
      const isDead = existing.mode === GAME_MODES.HARDCORE && (typeof patch.isDead === 'boolean' ? patch.isDead : existing.isDead) ? 1 : 0;
      const stats = { ...existing.stats };
      if (patch.stats && typeof patch.stats === 'object' && !Array.isArray(patch.stats)) {
        for (const k of BASE_STAT_KEYS) stats[k] = clampInt(patch.stats[k], 1, 999, existing.stats[k]);
      }
      const equipment = (patch.equipment && typeof patch.equipment === 'object' && !Array.isArray(patch.equipment))
        ? sanitizeEquipment({ ...existing.equipment, ...patch.equipment })
        : existing.equipment;
      const inventory = Array.isArray(patch.inventory) ? sanitizeInventory(patch.inventory) : existing.inventory;
      const gold = clampInt(patch.gold, 0, 1e9, existing.gold);

      db.prepare(`
        UPDATE characters
        SET name = ?, level = ?, xp = ?, next_xp = ?, stat_points = ?, potions = ?, is_dead = ?, highest_floor = ?, data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(name, level, xp, nextXp, statPoints, potions, isDead, highestFloor,
        JSON.stringify({ stats, equipment, inventory, gold }), Date.now(), id);

      audit({
        actor, action: 'mod.character.update', targetType: 'character', targetId: id, ip,
        details: { name: existing.name, ownerId: existing.accountId, fields: Object.keys(patch) }
      });
      return saveManager.getCharacter(id);
    })();
  }

  deleteCharacter(actorOrId, maybeId, maybeOpts = {}) {
    const hasActor = typeof actorOrId === 'object' && actorOrId !== null;
    const actor = hasActor ? actorOrId : null;
    const id = hasActor ? maybeId : actorOrId;
    const { ip = null, strict = hasActor } = maybeOpts;

    if (!isValidCharacterId(id)) {
      if (strict) throw new ModError(400, 'Invalid character id.');
      return false;
    }
    return db.transaction(() => {
      const existing = db.prepare('SELECT name, account_id FROM characters WHERE id = ?').get(id);
      if (!existing) return false;
      db.prepare('DELETE FROM characters WHERE id = ?').run(id);
      audit({ actor, action: 'mod.character.delete', targetType: 'character', targetId: id, ip, details: { name: existing.name, ownerId: existing.account_id } });
      return true;
    })();
  }

  runPrune(actor = null, { ip = null } = {}) {
    const result = pruneExpiredData();
    audit({ actor, action: 'mod.prune', ip, details: result });
    return result;
  }

  getAudit(opts) {
    return listAudit(opts);
  }
}

export const modService = new ModService();
