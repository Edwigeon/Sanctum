import { RARITY } from '../../shared/Constants.js';
import { dataRegistry } from './DataRegistry.js';

export class LootGenerator {
  static generateDrop({ id, x, y, floor = 1, ngCycle = 0, rng }) {
    const slots = dataRegistry.getSlots();
    const slot = slots[rng.next() % slots.length];
    const bases = dataRegistry.getItemBases(slot);
    const base = bases[rng.next() % bases.length];

    const roll = rng.next() % 100;
    const rarity = roll < 5 ? RARITY.UNIQUE : (roll < 25 ? RARITY.RARE : (roll < 65 ? RARITY.MAGIC : RARITY.NORMAL));
    const scale = 1 + (floor - 1) * 0.35 + ngCycle * 0.5;

    const stats = {};
    for (const [k, v] of Object.entries(base.baseStats || {})) {
      if (k === 'crit') {
        stats[k] = Number((v * (1 + rarity * 0.25)).toFixed(2));
      } else {
        stats[k] = Math.max(1, Math.round(v * scale));
      }
    }

    const prefixes = dataRegistry.getPrefixes();
    const suffixes = dataRegistry.getSuffixes();
    let itemName = base.name;

    const addAffix = (affix, mult = 1) => {
      if (!affix) return;
      if (affix.isFloat) {
        const val = affix.min + ((rng.next() % 100) / 100) * (affix.max - affix.min);
        stats[affix.stat] = Number(((stats[affix.stat] || 0) + val * mult).toFixed(2));
      } else {
        const raw = rng.range(affix.min, affix.max);
        const val = Math.max(1, Math.round(raw * scale * mult));
        stats[affix.stat] = (stats[affix.stat] || 0) + val;
      }
    };

    if (rarity >= RARITY.MAGIC && prefixes.length > 0) {
      const p = prefixes[rng.next() % prefixes.length];
      itemName = `${p.name} ${itemName}`;
      addAffix(p, 1);
    }

    if (rarity >= RARITY.RARE && suffixes.length > 0) {
      const s = suffixes[rng.next() % suffixes.length];
      itemName = `${itemName} ${s.name}`;
      addAffix(s, rarity === RARITY.UNIQUE ? 1.5 : 1);
    }

    if (rarity === RARITY.UNIQUE) {
      itemName = `★ ${itemName}`;
    }

    return {
      id,
      type: 'gear',
      slot,
      name: itemName,
      rarity,
      weight: base.weight || 1.0,
      stats,
      x,
      y
    };
  }
}
