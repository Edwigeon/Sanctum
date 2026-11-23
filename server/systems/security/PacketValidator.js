/**
 * Strict schema validation for client -> server WebSocket packets.
 *
 * Returns a NEW object containing only whitelisted, type-checked, range-checked fields.
 * Anything a client might try to assert authoritatively (damage, xp, hp, loot, stats,
 * accountId, role, ...) is simply never copied, so game logic only ever sees intents.
 */
import { PACKET_TYPES } from '../../../shared/Constants.js';

export const COST = { CONTROL: 'control', CHEAP: 'cheap', EXPENSIVE: 'expensive', JOIN: 'join' };
const COORD_MAX = 100000;
const ID_MAX = 2 ** 31 - 1;
const EQUIP_SLOTS = new Set(['ring1', 'helm', 'amulet', 'weapon', 'armor', 'offhand', 'gloves', 'boots', 'ring2']);
const STATS = new Set(['might', 'focus', 'agility', 'vitality']);
const JOIN_TYPES = new Set(['solo', 'public', 'private', 'unlisted', 'invite']);

class Invalid extends Error {}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function num(v, max) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > max) throw new Invalid('number');
  return v;
}
function id(v) {
  if (!Number.isInteger(v) || v < 0 || v > ID_MAX) throw new Invalid('id');
  return v;
}
function str(v, maxLen, { optional = true, re = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw new Invalid('missing string');
  }
  if (typeof v !== 'string' || v.length > maxLen) throw new Invalid('string');
  if (re && !re.test(v)) throw new Invalid('format');
  return v;
}
function oneOf(v, set, def) {
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== 'string' || !set.has(v)) throw new Invalid('enum');
  return v;
}

const SCHEMAS = {
  [PACKET_TYPES.PING]: { cost: COST.CONTROL, parse: p => ({ t: typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : 0 }) },
  [PACKET_TYPES.AUTH_LOGIN]: {
    cost: COST.JOIN,
    parse: p => {
      if (!isObj(p.data)) throw new Invalid('data');
      return {
        data: {
          username: str(p.data.username, 64),
          password: str(p.data.password, 128),
          localConsole: p.data.localConsole === true
        }
      };
    }
  },
  [PACKET_TYPES.LEAVE_LOBBY]: { cost: COST.CONTROL, parse: () => ({}) },
  [PACKET_TYPES.JOIN_LOBBY]: {
    cost: COST.JOIN,
    parse: p => {
      if (!isObj(p.data)) throw new Invalid('data');
      const d = p.data;
      const out = {
        token: str(d.token, 64, { optional: false, re: /^[0-9a-f]{64}$/ }),
        characterId: str(d.characterId, 36, { optional: false, re: /^[0-9a-f-]{36}$/ }),
        joinType: oneOf(d.joinType, JOIN_TYPES, 'public'),
        roomName: str(d.roomName, 64),
        password: str(d.password, 64),
        inviteToken: str(d.inviteToken, 512)
      };
      if (d.maxPlayers !== undefined && d.maxPlayers !== null && d.maxPlayers !== '') {
        const mp = Number(d.maxPlayers);
        if (!Number.isInteger(mp) || mp < 2 || mp > 4) throw new Invalid('maxPlayers');
        out.maxPlayers = mp;
      }
      // playerName / mode / playerClass from the client are intentionally discarded:
      // all of those are derived server-side from the owned character record.
      return { data: out };
    }
  },
  [PACKET_TYPES.INPUT_MOVE]: { cost: COST.CHEAP, parse: p => ({ x: num(p.x, COORD_MAX), y: num(p.y, COORD_MAX) }) },
  [PACKET_TYPES.INPUT_ATTACK]: {
    cost: COST.CHEAP,
    parse: p => ({ targetMonsterId: id(p.targetMonsterId), hold: p.hold === true })
  },
  [PACKET_TYPES.INPUT_SKILL]: {
    cost: COST.EXPENSIVE,
    parse: p => ({ angle: Math.atan2(Math.sin(num(p.angle, 1000)), Math.cos(p.angle)) })
  },
  [PACKET_TYPES.INPUT_POTION]: { cost: COST.EXPENSIVE, parse: p => ({ subType: oneOf(p.subType, new Set(['hp', 'mp']), 'hp') }) },
  [PACKET_TYPES.PICKUP_LOOT]: { cost: COST.EXPENSIVE, parse: p => ({ lootId: id(p.lootId) }) },
  [PACKET_TYPES.ALLOC_STAT]: { cost: COST.EXPENSIVE, parse: p => ({ stat: oneOf(p.stat, STATS) }) },
  [PACKET_TYPES.EQUIP_ITEM]: { cost: COST.EXPENSIVE, parse: p => ({ itemId: id(p.itemId), slot: p.slot ? oneOf(p.slot, EQUIP_SLOTS) : undefined }) },
  [PACKET_TYPES.UNEQUIP_ITEM]: { cost: COST.EXPENSIVE, parse: p => ({ slot: oneOf(p.slot, EQUIP_SLOTS) }) },
  [PACKET_TYPES.USE_ITEM]: { cost: COST.EXPENSIVE, parse: p => ({ itemId: id(p.itemId) }) },
  [PACKET_TYPES.DROP_ITEM]: { cost: COST.EXPENSIVE, parse: p => ({ itemId: id(p.itemId) }) },
  [PACKET_TYPES.INPUT_RESPAWN]: { cost: COST.EXPENSIVE, parse: () => ({}) },
  [PACKET_TYPES.INVITE_REGENERATE]: { cost: COST.JOIN, parse: () => ({}) },
  [PACKET_TYPES.INVITE_REVOKE]: { cost: COST.JOIN, parse: () => ({}) }
};

/** @returns {{ok: true, packet: object, cost: string} | {ok: false, error: string}} */
export function validatePacket(raw) {
  if (!isObj(raw) || typeof raw.type !== 'string') return { ok: false, error: 'structure' };
  const schema = Object.prototype.hasOwnProperty.call(SCHEMAS, raw.type) ? SCHEMAS[raw.type] : null;
  if (!schema) return { ok: false, error: 'unknown type' };
  try {
    return { ok: true, packet: { type: raw.type, ...schema.parse(raw) }, cost: schema.cost };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}
