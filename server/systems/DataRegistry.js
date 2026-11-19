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
  }

  getClass(id) {
    return this.classes[id] || this.classes.VANGUARD || Object.values(this.classes)[0];
  }

  getMonster(type) {
    return this.monsters[type] || this.monsters.crawler || Object.values(this.monsters)[0];
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
