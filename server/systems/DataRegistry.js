import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');

function loadJson(filename, fallback) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DataRegistry] Failed to load ${filename}:`, err.message);
    return fallback;
  }
}

class DataRegistry {
  constructor() {
    this.classes = loadJson('classes.json', {});
    this.monsters = loadJson('monsters.json', {});
    this.items = loadJson('items.json', { bases: {} });
    this.affixes = loadJson('affixes.json', { prefixes: [], suffixes: [] });
    this.validationErrors = [];
    this.validate();
  }

  validate() {
    this.validationErrors = [];

    // Validate classes
    if (!this.classes || typeof this.classes !== 'object' || Object.keys(this.classes).length === 0) {
      this.validationErrors.push('classes.json is empty or invalid');
    } else {
      for (const [id, cls] of Object.entries(this.classes)) {
        if (!cls.id || typeof cls.id !== 'string') this.validationErrors.push(`Class '${id}' missing valid string 'id'`);
        if (!cls.name || typeof cls.name !== 'string') this.validationErrors.push(`Class '${id}' missing valid string 'name'`);
        if (!cls.stats || typeof cls.stats !== 'object') {
          this.validationErrors.push(`Class '${id}' missing 'stats' object`);
        } else {
          for (const s of ['might', 'focus', 'agility', 'vitality']) {
            if (typeof cls.stats[s] !== 'number' || Number.isNaN(cls.stats[s])) {
              this.validationErrors.push(`Class '${id}' stat '${s}' must be a number`);
            }
          }
        }
        for (const numField of ['baseDmgMin', 'baseDmgMax', 'baseArmor', 'baseSpeed', 'baseCrit']) {
          if (typeof cls[numField] !== 'number' || Number.isNaN(cls[numField])) {
            this.validationErrors.push(`Class '${id}' field '${numField}' must be a number`);
          }
        }
      }
    }

    // Validate monsters
    if (!this.monsters || typeof this.monsters !== 'object' || Object.keys(this.monsters).length === 0) {
      this.validationErrors.push('monsters.json is empty or invalid');
    } else {
      for (const [type, m] of Object.entries(this.monsters)) {
        if (!m.id || typeof m.id !== 'string') this.validationErrors.push(`Monster '${type}' missing valid string 'id'`);
        if (!m.name || typeof m.name !== 'string') this.validationErrors.push(`Monster '${type}' missing valid string 'name'`);
        for (const f of ['baseHp', 'baseDmg', 'speed', 'aggroRange', 'xp']) {
          if (typeof m[f] !== 'number' || Number.isNaN(m[f]) || m[f] <= 0) {
            this.validationErrors.push(`Monster '${type}' field '${f}' must be a positive number`);
          }
        }
      }
    }

    // Validate items
    if (!this.items?.bases || typeof this.items.bases !== 'object') {
      this.validationErrors.push("items.json missing 'bases' object");
    } else {
      for (const [slot, list] of Object.entries(this.items.bases)) {
        if (!Array.isArray(list)) {
          this.validationErrors.push(`Item bases for slot '${slot}' must be an array`);
          continue;
        }
        for (const base of list) {
          if (!base.name || typeof base.name !== 'string') {
            this.validationErrors.push(`Item base in slot '${slot}' missing valid string 'name'`);
          }
          if (typeof base.weight !== 'number' || Number.isNaN(base.weight)) {
            this.validationErrors.push(`Item base '${base.name || slot}' weight must be a number`);
          }
        }
      }
    }

    // Validate affixes
    if (!Array.isArray(this.affixes?.prefixes) || !Array.isArray(this.affixes?.suffixes)) {
      this.validationErrors.push("affixes.json missing 'prefixes' or 'suffixes' arrays");
    } else {
      for (const group of ['prefixes', 'suffixes']) {
        for (const aff of this.affixes[group]) {
          if (!aff.name || typeof aff.name !== 'string') this.validationErrors.push(`Affix in '${group}' missing string 'name'`);
          if (!aff.stat || typeof aff.stat !== 'string') this.validationErrors.push(`Affix in '${group}' missing string 'stat'`);
          if (typeof aff.min !== 'number' || Number.isNaN(aff.min)) this.validationErrors.push(`Affix '${aff.name}' min must be a number`);
          if (typeof aff.max !== 'number' || Number.isNaN(aff.max)) this.validationErrors.push(`Affix '${aff.name}' max must be a number`);
        }
      }
    }

    if (this.validationErrors.length > 0) {
      console.warn(`[DataRegistry] Found ${this.validationErrors.length} validation issue(s):`);
      for (const err of this.validationErrors) {
        console.warn(`  - ${err}`);
      }
    } else {
      console.log('[DataRegistry] All content schemas validated successfully.');
    }
  }

  hasClass(id) {
    return Boolean(this.classes && id && this.classes[id]);
  }

  hasMonster(type) {
    return Boolean(this.monsters && type && this.monsters[type]);
  }

  getClass(id, allowFallback = true) {
    if (this.classes && id && this.classes[id]) {
      return this.classes[id];
    }
    if (!allowFallback) return null;
    const fallback = this.classes?.VANGUARD || (this.classes ? Object.values(this.classes)[0] : null);
    if (id) {
      console.warn(`[DataRegistry] Unknown class ID '${id}', falling back to '${fallback?.id || 'none'}'`);
    }
    return fallback;
  }

  getMonster(type, allowFallback = true) {
    if (this.monsters && type && this.monsters[type]) {
      return this.monsters[type];
    }
    if (!allowFallback) return null;
    const fallback = this.monsters?.crawler || (this.monsters ? Object.values(this.monsters)[0] : null);
    if (type) {
      console.warn(`[DataRegistry] Unknown monster type '${type}', falling back to '${fallback?.id || 'none'}'`);
    }
    return fallback;
  }

  getMonsterTypes() {
    return Object.keys(this.monsters);
  }

  getItemBases(slot) {
    return this.items.bases?.[slot] || [];
  }

  getSlots() {
    return Object.keys(this.items.bases || {});
  }

  getPrefixes() {
    return this.affixes.prefixes || [];
  }

  getSuffixes() {
    return this.affixes.suffixes || [];
  }
}

export const dataRegistry = new DataRegistry();
