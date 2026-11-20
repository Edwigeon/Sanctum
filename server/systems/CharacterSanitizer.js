/**
 * Whitelist-based sanitization for persisted character state.
 * Applied when loading from the database, when saving, and to every moderator edit, so
 * corrupted or hand-edited JSON can never introduce unknown fields or out-of-range values.
 */
import { dataRegistry } from './DataRegistry.js';

export const EQUIP_SLOTS = ['ring1', 'helm', 'amulet', 'weapon', 'armor', 'offhand', 'gloves', 'boots', 'ring2'];
export const BASE_STAT_KEYS = ['might', 'focus', 'agility', 'vitality'];
const ITEM_STAT_LIMITS = {
  might: [-100, 1000], focus: [-100, 1000], agility: [-100, 1000], vitality: [-100, 1000],
  dmg: [-100, 5000], armor: [-100, 5000], hp: [-1000, 50000], mp: [-1000, 50000],
  crit: [0, 0.5], speed: [-1, 1], spellDmg: [-100, 5000]
};
export const MAX_INVENTORY = 40;
const MAX_LEVEL = 999;
const MAX_INT = 2 ** 31 - 1;

export function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (typeof v === 'boolean' || v === null || v === '' || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

export function sanitizeText(s, maxLen, fallback = '') {
  if (typeof s !== 'string') return fallback;
  const clean = s.normalize('NFC').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, maxLen);
  return clean || fallback;
}

/** Hero names: letters, digits, space, underscore, hyphen, apostrophe; 1-16 chars. */
export function sanitizeHeroName(name, fallback = 'Wanderer') {
  if (typeof name !== 'string') return fallback;
  const clean = name.normalize('NFC').replace(/[^\p{L}\p{N} _'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || fallback;
}

function itemSlots() {
  return new Set([...dataRegistry.getSlots(), 'ring']);
}

export function sanitizeItem(raw, { forSlot = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = Number.isInteger(raw.id) && raw.id > 0 && raw.id <= MAX_INT ? raw.id : undefined;
  const rarity = clampInt(raw.rarity, 0, 3, 0);
  if (raw.type === 'gear') {
    const valid = itemSlots();
    let slot = typeof raw.slot === 'string' && valid.has(raw.slot) ? raw.slot : null;
    if (forSlot) {
      // Equipped items always carry the slot they occupy (ring1/ring2 hold 'ring' items).
      const expected = forSlot === 'ring1' || forSlot === 'ring2' ? 'ring' : forSlot;
      slot = valid.has(expected) ? expected : null;
    }
    if (!slot) return null;
    const stats = {};
    if (raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)) {
      for (const [k, [lo, hi]] of Object.entries(ITEM_STAT_LIMITS)) {
        if (Object.prototype.hasOwnProperty.call(raw.stats, k)) {
          const v = clampNum(raw.stats[k], lo, hi, undefined);
          if (v !== undefined) stats[k] = v;
        }
      }
    }
    return {
      ...(id !== undefined ? { id } : {}),
      type: 'gear',
      slot,
      name: sanitizeText(raw.name, 48, slot),
      rarity,
      weight: clampNum(Number(raw.weight), 0, 100, 1),
      stats
    };
  }
  if (raw.type === 'potion' || raw.type === 'consumable') {
    const subType = raw.subType === 'mp' ? 'mp' : 'hp';
    const maxStack = clampInt(raw.maxStack, 1, 99, 20);
    return {
      ...(id !== undefined ? { id } : {}),
      type: 'potion',
      subType,
      name: subType === 'mp' ? 'Mana Potion' : 'Health Potion',
      rarity: clampInt(raw.rarity, 0, 3, 1),
      count: clampInt(raw.count, 1, maxStack, 1),
      maxStack,
      weight: 0.2
    };
  }
  return null;
}

export function sanitizeEquipment(raw) {
  const out = Object.fromEntries(EQUIP_SLOTS.map(s => [s, null]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const slot of EQUIP_SLOTS) {
    const src = raw[slot] ?? (slot === 'ring1' ? raw.ring : undefined);
    out[slot] = src ? sanitizeItem(src, { forSlot: slot }) : null;
  }
  return out;
}

export function sanitizeInventory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const it of raw) {
    if (out.length >= MAX_INVENTORY) break;
    const clean = sanitizeItem(it);
    if (clean) out.push(clean);
  }
  return out;
}

export function sanitizeBaseStats(raw, fallback = {}) {
  const out = {};
  for (const k of BASE_STAT_KEYS) {
    const fb = clampInt(fallback[k], 1, 999, 10);
    out[k] = raw && typeof raw === 'object' ? clampInt(raw[k], 1, 999, fb) : fb;
  }
  return out;
}

export function sanitizeCharacterData(data, classId) {
  const cls = dataRegistry.getClass(classId);
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    stats: sanitizeBaseStats(d.stats, cls?.stats || {}),
    equipment: sanitizeEquipment(d.equipment),
    inventory: sanitizeInventory(d.inventory),
    gold: clampInt(d.gold, 0, 1e9, 0)
  };
}

export function sanitizeProgress(p, fallback = {}) {
  return {
    level: clampInt(p.level, 1, MAX_LEVEL, fallback.level ?? 1),
    xp: clampInt(p.xp, 0, MAX_INT, fallback.xp ?? 0),
    nextXp: clampInt(p.nextXp, 10, MAX_INT, fallback.nextXp ?? 100),
    statPoints: clampInt(p.statPoints, 0, 9999, fallback.statPoints ?? 0),
    potions: clampInt(p.potions, 0, 999, fallback.potions ?? 0),
    highestFloor: clampInt(p.highestFloor, 1, 999, fallback.highestFloor ?? 1)
  };
}
