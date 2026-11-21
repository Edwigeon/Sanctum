import assert from 'node:assert/strict';
import {
  StatEngine,
  DAMAGE_TYPES,
  DAMAGE_TYPE_METADATA,
  RESISTANCE_TYPES,
  RESISTANCE_METADATA,
  SPECIAL_ATTRIBUTES,
  AFFIX_REGISTRY
} from '../shared/StatEngine.js';

console.log('=== RUNNING SANCTUM STAT ENGINE & DATA SYNC VERIFICATION ===\n');

// 1. Verify Extensible Enums & Metadata Registry
console.log('1. Testing Damage Types, Resistances & Affix Registry...');
assert.equal(DAMAGE_TYPES.FIRE, 'fire');
assert.equal(DAMAGE_TYPES.COLD, 'cold');
assert.equal(DAMAGE_TYPES.LIGHTNING, 'lightning');
assert.equal(DAMAGE_TYPES.POISON, 'poison');
assert.ok(DAMAGE_TYPE_METADATA[DAMAGE_TYPES.FIRE].color);
assert.ok(DAMAGE_TYPE_METADATA[DAMAGE_TYPES.COLD].color);

assert.equal(RESISTANCE_TYPES.FIRE, 'fireRes');
assert.equal(RESISTANCE_TYPES.COLD, 'coldRes');
assert.equal(RESISTANCE_METADATA[RESISTANCE_TYPES.FIRE].damageType, DAMAGE_TYPES.FIRE);

assert.ok(AFFIX_REGISTRY.might);
assert.ok(AFFIX_REGISTRY.fireRes);
assert.ok(AFFIX_REGISTRY.crit);
assert.equal(AFFIX_REGISTRY.crit.isPct, true);
console.log('✔ StatEngine: Extensible enums and affix registries validated.');

// 2. Base Character Stat Calculation
console.log('2. Testing Base Character Stats Calculation...');
const vanguardStats = StatEngine.calculateCharacterStats({
  classId: 'VANGUARD',
  level: 5,
  stats: { might: 20, focus: 10, agility: 12, vitality: 18 },
  equipment: {
    weapon: { name: 'Iron Longsword', slot: 'weapon', baseDamage: [12, 20], attackSpeed: 1.20, stats: { might: 2 } },
    armor: { name: 'Iron Cuirass', slot: 'armor', stats: { armor: 10, vitality: 4, fireRes: 15 } }
  }
});

assert.equal(vanguardStats.classId, 'VANGUARD');
assert.equal(vanguardStats.totalStats.might, 22, 'Total might must include weapon might (20 + 2)');
assert.equal(vanguardStats.totalStats.vitality, 22, 'Total vitality must include armor vitality (18 + 4)');
assert.ok(vanguardStats.offense.dps > 0, 'DPS must be positive');
assert.ok(vanguardStats.offense.attackSpeed >= 1.20, 'Attack speed must be at least base weapon APS');
assert.ok(vanguardStats.defense.totalArmor > 10, 'Total armor must include base + vitality + gear');
assert.equal(vanguardStats.defense.resistances.fireRes.val, 15, 'Fire resistance must be aggregated from gear');
assert.ok(vanguardStats.defense.resistances.fireRes.pct > 0, 'Fire mitigation percentage must be calculated');
console.log(`✔ StatEngine: Base stats calculated (Might: ${vanguardStats.totalStats.might}, Armor: ${vanguardStats.defense.totalArmor}, DPS: ${vanguardStats.offense.dps}, Fire Res: ${vanguardStats.defense.resistances.fireRes.pct}%).`);

// 3. Modular Elemental Damage Resolution on Weapons
console.log('3. Testing Modular Elemental Weapon Affixes...');
const fireSword = {
  name: 'Flame Brand',
  slot: 'weapon',
  baseDamage: [14, 22],
  attackSpeed: 1.25,
  stats: { fireDmg: 6, might: 3 }
};
const fireMetrics = StatEngine.resolveWeaponMetrics(fireSword);
assert.equal(fireMetrics.elementalDmg.fire, 6, 'Fire damage must be extracted into elemental metrics');
assert.equal(fireMetrics.attackSpeed, 1.25);
console.log('✔ StatEngine: Modular elemental weapon damage types verified.');

// 4. Authoritative Simulation & Comparative Diff (Diablo 3 Tooltip parity)
console.log('4. Testing simulateEquipDiff for Accurate Tooltip Parity...');
const characterState = {
  classId: 'VANGUARD',
  level: 5,
  stats: { might: 20, focus: 10, agility: 12, vitality: 18 },
  equipment: {
    weapon: { name: 'Iron Longsword', slot: 'weapon', baseDamage: [12, 20], attackSpeed: 1.20, stats: { might: 2 } },
    armor: { name: 'Iron Cuirass', slot: 'armor', stats: { armor: 10, vitality: 4 } }
  }
};

const upgradeArmor = {
  name: 'Ornate Cuirass of the Hearth',
  slot: 'armor',
  stats: { armor: 16, vitality: 6, fireRes: 25 }
};

const diff = StatEngine.simulateEquipDiff({
  characterState,
  inspectedItem: upgradeArmor,
  targetSlot: 'armor'
});

// Armor delta: +6 from gear armor + 1 from vitality scaling (24 vs 22 vit * 0.25) = +7!
assert.equal(diff.armorDelta, 7, 'Armor delta must accurately include +6 gear armor + 1 from vitality scaling');
assert.equal(diff.statDeltas.vitality, 2, 'Vitality delta must be exactly +2 (6 vs 4)');
assert.equal(diff.resDeltas.fireRes, 25, 'Fire resistance delta must be exactly +25');
assert.ok(diff.toughnessDelta > 0, 'Toughness delta must be positive');
assert.equal(diff.isUpgrade, true, 'Upgrade flag must be true');

// Verify that when the character actually equips the item, its stats match the simulation exactly!
const equippedState = {
  ...characterState,
  equipment: {
    ...characterState.equipment,
    armor: upgradeArmor
  }
};
const newCharStats = StatEngine.calculateCharacterStats(equippedState);
assert.equal(newCharStats.defense.totalArmor - vanguardStats.defense.totalArmor, diff.armorDelta, 'Tooltip simulated armor delta MUST match real character sheet armor gain!');
assert.equal(newCharStats.totalStats.vitality - vanguardStats.totalStats.vitality, diff.statDeltas.vitality, 'Tooltip simulated vitality delta MUST match real character sheet vitality gain!');
console.log('✔ StatEngine: Tooltip comparisons and character sheet stats are 100% backed by the same engine!');

// 5. Dual Ring Comparison Simulation
console.log('5. Testing Dual Ring Comparison Simulation...');
const dualRingCharState = {
  classId: 'VANGUARD',
  level: 5,
  stats: { might: 20, focus: 10, agility: 12, vitality: 18 },
  equipment: {
    ring1: { name: 'Copper Band', slot: 'ring', stats: { might: 1 } },
    ring2: null // Empty ring slot!
  }
};

const newRing = {
  name: 'Gold Signet',
  slot: 'ring',
  stats: { might: 4, armor: 3 }
};

const dualDiff = StatEngine.simulateDualRingDiff({
  characterState: dualRingCharState,
  inspectedRing: newRing
});

assert.ok(dualDiff.diffR1, 'diffR1 must exist');
assert.ok(dualDiff.diffR2, 'diffR2 must exist');
// Slot 2 is empty, so it should recommend replacing ring2!
assert.equal(dualDiff.recommendedSlot, 'ring2', 'Should recommend replacing the empty ring slot');
assert.ok(dualDiff.diffR2.dpsDelta > 0);
assert.ok(dualDiff.diffR2.armorDelta > 0);
console.log('✔ StatEngine: Dual-ring comparative simulation and smart socket recommendation verified.');

console.log('\n=== ALL STAT ENGINE TESTS PASSED! ===');
