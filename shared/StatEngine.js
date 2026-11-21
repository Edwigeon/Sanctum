/**
 * StatEngine.js — Unified Authoritative Character & Item Stat Engine for Sanctum.
 * Single source of truth for:
 * 1. Base Class & Attribute Scaling
 * 2. Equipment Aggregation & Modular Damage Types (Physical, Fire, Cold, Lightning, etc.)
 * 3. Elemental Resistances & Mitigation Curves
 * 4. Special Attributes (Life on Hit, Thorns, Crit Mult, Evasion, etc.)
 * 5. Simulation & Differential Comparison (D3 style DPS & Toughness Deltas)
 */

export const DAMAGE_TYPES = Object.freeze({
  PHYSICAL: 'physical',
  FIRE: 'fire',
  COLD: 'cold',
  LIGHTNING: 'lightning',
  POISON: 'poison',
  ARCANE: 'arcane',
  HOLY: 'holy',
  SHADOW: 'shadow'
});

export const DAMAGE_TYPE_METADATA = Object.freeze({
  [DAMAGE_TYPES.PHYSICAL]:  { name: 'Physical',  color: '#c2c3c7', icon: 'cuirass', desc: 'Crushing kinetic impact' },
  [DAMAGE_TYPES.FIRE]:      { name: 'Fire',      color: '#ff004d', icon: 'flame',   desc: 'Ignites and burns foes' },
  [DAMAGE_TYPES.COLD]:      { name: 'Cold',      color: '#29adff', icon: 'frost',   desc: 'Chills and slows motion' },
  [DAMAGE_TYPES.LIGHTNING]: { name: 'Lightning', color: '#ffec27', icon: 'spark',   desc: 'Discharges high-voltage crits' },
  [DAMAGE_TYPES.POISON]:    { name: 'Poison',    color: '#00e436', icon: 'venom',   desc: 'Corrodes flesh over time' },
  [DAMAGE_TYPES.ARCANE]:    { name: 'Arcane',    color: '#83769c', icon: 'orb',     desc: 'Raw celestial power' },
  [DAMAGE_TYPES.HOLY]:      { name: 'Holy',      color: '#fff1e8', icon: 'sun',     desc: 'Radiant celestial blessing' },
  [DAMAGE_TYPES.SHADOW]:    { name: 'Shadow',    color: '#7e2553', icon: 'skull',   desc: 'Corruptive dark magic' }
});

export const RESISTANCE_TYPES = Object.freeze({
  FIRE: 'fireRes',
  COLD: 'coldRes',
  LIGHTNING: 'lightningRes',
  POISON: 'poisonRes',
  ARCANE: 'arcaneRes',
  SHADOW: 'shadowRes'
});

export const RESISTANCE_METADATA = Object.freeze({
  [RESISTANCE_TYPES.FIRE]:      { label: 'Fire Resistance',      damageType: DAMAGE_TYPES.FIRE,      color: '#ff004d' },
  [RESISTANCE_TYPES.COLD]:      { label: 'Cold Resistance',      damageType: DAMAGE_TYPES.COLD,      color: '#29adff' },
  [RESISTANCE_TYPES.LIGHTNING]: { label: 'Lightning Resistance', damageType: DAMAGE_TYPES.LIGHTNING, color: '#ffec27' },
  [RESISTANCE_TYPES.POISON]:    { label: 'Poison Resistance',    damageType: DAMAGE_TYPES.POISON,    color: '#00e436' },
  [RESISTANCE_TYPES.ARCANE]:    { label: 'Arcane Resistance',    damageType: DAMAGE_TYPES.ARCANE,    color: '#83769c' },
  [RESISTANCE_TYPES.SHADOW]:    { label: 'Shadow Resistance',    damageType: DAMAGE_TYPES.SHADOW,    color: '#7e2553' }
});

export const SPECIAL_ATTRIBUTES = Object.freeze({
  ATTACK_SPEED: 'attackSpeed',
  CAST_SPEED: 'castSpeed',
  CRIT_CHANCE: 'crit',
  CRIT_MULT: 'critMult',
  LIFE_ON_HIT: 'lifeOnHit',
  LIFE_STEAL: 'lifeSteal',
  THORNS: 'thorns',
  COOLDOWN_REDUCTION: 'cooldownReduction',
  EVASION: 'evasion',
  BLOCK_CHANCE: 'blockChance',
  BLOCK_AMOUNT: 'blockAmount',
  HP_REGEN: 'hpRegen',
  MP_REGEN: 'mpRegen',
  MAGIC_FIND: 'magicFind'
});

export const AFFIX_REGISTRY = Object.freeze({
  might:       { label: 'Might', category: 'attribute', isPct: false, desc: 'Increases physical power and armor' },
  focus:       { label: 'Focus', category: 'attribute', isPct: false, desc: 'Increases spell power and mana pool' },
  agility:     { label: 'Agility', category: 'attribute', isPct: false, desc: 'Increases critical chance, attack speed & evasion' },
  vitality:    { label: 'Vitality', category: 'attribute', isPct: false, desc: 'Increases maximum health and regeneration' },
  dmg:         { label: 'Base Damage', category: 'offense', isPct: false, desc: 'Flat bonus to weapon damage' },
  armor:       { label: 'Armor Rating', category: 'defense', isPct: false, desc: 'Reduces incoming physical damage' },
  hp:          { label: 'Maximum Health', category: 'defense', isPct: false, desc: 'Flat maximum hit points bonus' },
  mp:          { label: 'Maximum Mana', category: 'utility', isPct: false, desc: 'Flat maximum mana points bonus' },
  crit:        { label: 'Critical Strike Chance', category: 'offense', isPct: true, desc: 'Chance to deal a critical hit' },
  critMult:    { label: 'Critical Strike Damage', category: 'offense', isPct: true, desc: 'Bonus damage multiplier on critical strike' },
  speed:       { label: 'Movement Speed', category: 'utility', isPct: false, desc: 'Tactical movement reposition velocity' },
  attackSpeed: { label: 'Attack Speed', category: 'offense', isPct: false, desc: 'Attacks per second (APS)' },
  spellDmg:    { label: 'Spell Power', category: 'offense', isPct: false, desc: 'Bonus arcane and magical projectile damage' },
  fireDmg:     { label: 'Fire Damage', category: 'offense', isPct: false, desc: 'Adds bonus Fire damage to attacks' },
  coldDmg:     { label: 'Cold Damage', category: 'offense', isPct: false, desc: 'Adds bonus Cold damage to attacks' },
  lightningDmg:{ label: 'Lightning Damage', category: 'offense', isPct: false, desc: 'Adds bonus Lightning damage to attacks' },
  poisonDmg:   { label: 'Poison Damage', category: 'offense', isPct: false, desc: 'Adds bonus Poison damage over time' },
  fireRes:     { label: 'Fire Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Fire damage' },
  coldRes:     { label: 'Cold Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Cold damage' },
  lightningRes:{ label: 'Lightning Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Lightning damage' },
  poisonRes:   { label: 'Poison Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Poison damage' },
  arcaneRes:   { label: 'Arcane Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Arcane damage' },
  shadowRes:   { label: 'Shadow Resistance', category: 'resistance', isPct: false, desc: 'Mitigates incoming Shadow damage' },
  lifeOnHit:   { label: 'Life on Hit', category: 'defense', isPct: false, desc: 'Restores health on every successful strike' },
  thorns:      { label: 'Thorns', category: 'defense', isPct: false, desc: 'Reflects damage back to melee attackers' },
  evasion:     { label: 'Tactical Evasion', category: 'defense', isPct: true, desc: 'Chance to completely dodge attacks' }
});

export const CLASS_BASE_PROFILES = Object.freeze({
  VANGUARD: {
    primaryStat: 'might',
    baseHp: 50,
    baseMp: 20,
    baseDmgMin: 8,
    baseDmgMax: 14,
    baseArmor: 6,
    baseCrit: 0.12,
    baseSpeed: 1.4,
    baseStats: { might: 16, focus: 8, agility: 10, vitality: 16 }
  },
  ARCANIST: {
    primaryStat: 'focus',
    baseHp: 50,
    baseMp: 20,
    baseDmgMin: 5,
    baseDmgMax: 10,
    baseArmor: 3,
    baseCrit: 0.15,
    baseSpeed: 1.4,
    baseStats: { might: 8, focus: 18, agility: 12, vitality: 12 }
  },
  SHADOW: {
    primaryStat: 'agility',
    baseHp: 50,
    baseMp: 20,
    baseDmgMin: 7,
    baseDmgMax: 13,
    baseArmor: 4,
    baseCrit: 0.25,
    baseSpeed: 1.6,
    baseStats: { might: 12, focus: 10, agility: 18, vitality: 10 }
  }
});

export class StatEngine {
  /**
   * Sums all gear affixes and properties across an equipment record.
   */
  static aggregateEquipmentBonuses(equipment = {}) {
    const bonuses = {
      might: 0, focus: 0, agility: 0, vitality: 0,
      dmg: 0, armor: 0, hp: 0, mp: 0, crit: 0, critMult: 0,
      speed: 0, attackSpeed: 0, spellDmg: 0,
      fireDmg: 0, coldDmg: 0, lightningDmg: 0, poisonDmg: 0,
      fireRes: 0, coldRes: 0, lightningRes: 0, poisonRes: 0, arcaneRes: 0, shadowRes: 0,
      lifeOnHit: 0, thorns: 0, evasion: 0, blockChance: 0,
      weight: 0
    };

    if (!equipment) return bonuses;

    for (const item of Object.values(equipment)) {
      if (!item) continue;
      bonuses.weight += item.weight || 0;

      // Extract base stats if present
      if (item.baseStats) {
        for (const [k, v] of Object.entries(item.baseStats)) {
          if (typeof v === 'number') {
            bonuses[k] = (bonuses[k] || 0) + v;
          }
        }
      }

      // Extract magic/rare affixes
      if (item.stats) {
        for (const [k, v] of Object.entries(item.stats)) {
          if (typeof v === 'number') {
            bonuses[k] = (bonuses[k] || 0) + v;
          }
        }
      }
    }

    return bonuses;
  }

  /**
   * Evaluates weapon properties and base damage ranges.
   */
  static resolveWeaponMetrics(weapon) {
    if (!weapon) {
      return {
        name: 'Unarmed (Fists)',
        isEquipped: false,
        minDmg: 4,
        maxDmg: 8,
        attackSpeed: 1.20,
        elementalDmg: {}
      };
    }

    let minDmg = weapon.minDmg ?? weapon.baseDmgMin ?? weapon.baseDamage?.min ?? (Array.isArray(weapon.baseDamage) ? weapon.baseDamage[0] : null);
    let maxDmg = weapon.maxDmg ?? weapon.baseDmgMax ?? weapon.baseDamage?.max ?? (Array.isArray(weapon.baseDamage) ? weapon.baseDamage[1] : null);

    if (minDmg === null && maxDmg === null) {
      const flatDmg = weapon.baseDamage ?? weapon.baseStats?.dmg ?? weapon.stats?.dmg ?? 4;
      minDmg = Math.max(1, Math.round(flatDmg * 0.8));
      maxDmg = Math.max(minDmg + 1, Math.round(flatDmg * 1.2));
    }

    let attackSpeed = 1.20;
    if (weapon.attackSpeed) {
      attackSpeed = weapon.attackSpeed;
    } else if (weapon.speed && weapon.speed <= 3.0) {
      attackSpeed = weapon.speed;
    } else if (weapon.baseStats?.speed && weapon.baseStats.speed <= 3.0) {
      attackSpeed = weapon.baseStats.speed;
    }

    // Elemental damage ranges if embedded on weapon
    const elementalDmg = {};
    for (const dt of Object.values(DAMAGE_TYPES)) {
      if (dt === DAMAGE_TYPES.PHYSICAL) continue;
      const key = `${dt}Dmg`;
      const val = weapon.stats?.[key] || weapon.baseStats?.[key] || 0;
      if (val > 0) {
        elementalDmg[dt] = val;
      }
    }

    return {
      name: weapon.name || 'Weapon',
      isEquipped: true,
      minDmg: Math.max(1, Math.round(minDmg)),
      maxDmg: Math.max(2, Math.round(maxDmg)),
      attackSpeed: Number(attackSpeed.toFixed(2)),
      elementalDmg
    };
  }

  /**
   * Calculates comprehensive character stats, derived combat attributes,
   * damage types, and resistances.
   */
  static calculateCharacterStats({
    classId = 'VANGUARD',
    level = 1,
    stats = {},
    equipment = {},
    derivedOverrides = null
  } = {}) {
    const normClassId = (classId || 'VANGUARD').toUpperCase();
    const profile = CLASS_BASE_PROFILES[normClassId] || CLASS_BASE_PROFILES.VANGUARD;

    // 1. Aggregate Gear
    const gear = this.aggregateEquipmentBonuses(equipment);

    // 2. Primary Attributes
    const baseStats = {
      might: stats.might ?? profile.baseStats.might,
      focus: stats.focus ?? profile.baseStats.focus,
      agility: stats.agility ?? profile.baseStats.agility,
      vitality: stats.vitality ?? profile.baseStats.vitality
    };

    const totalStats = {
      might: baseStats.might + gear.might,
      focus: baseStats.focus + gear.focus,
      agility: baseStats.agility + gear.agility,
      vitality: baseStats.vitality + gear.vitality
    };

    // 3. Weapon & Physical Rolls
    const weaponMetrics = this.resolveWeaponMetrics(equipment.weapon);
    const flatDmgBonus = gear.dmg;

    let dmgMin = derivedOverrides?.dmgMin ?? (weaponMetrics.isEquipped ? weaponMetrics.minDmg + flatDmgBonus : profile.baseDmgMin + flatDmgBonus);
    let dmgMax = derivedOverrides?.dmgMax ?? (weaponMetrics.isEquipped ? weaponMetrics.maxDmg + flatDmgBonus : profile.baseDmgMax + flatDmgBonus);
    dmgMin = Math.max(1, dmgMin);
    dmgMax = Math.max(dmgMin + 1, dmgMax);
    const avgDmg = (dmgMin + dmgMax) / 2;

    // Agility Attack Speed modifier (+0.5% per point of Agility above 10)
    const agiApsBonus = Math.max(0, (totalStats.agility - 10) * 0.005);
    const attackSpeed = Number((weaponMetrics.attackSpeed + agiApsBonus).toFixed(2));

    // Primary Stat Scaling (Vanguard = Might, Shadow = Agility, Arcanist = Focus)
    const primStatKey = profile.primaryStat;
    const primStatVal = totalStats[primStatKey];
    const statScalar = 1 + Math.max(0, (primStatVal - 10) * 0.02);

    // Critical Chance & Multiplier
    const baseCrit = derivedOverrides?.crit !== undefined ? (derivedOverrides.crit / 100) : profile.baseCrit;
    const critChance = Math.min(0.75, Math.max(0.05, baseCrit + (totalStats.agility * 0.004) + gear.crit));
    const critMult = 1.50 + gear.critMult;

    // Damage Breakdown by Type
    const damageByType = {
      [DAMAGE_TYPES.PHYSICAL]: { min: dmgMin, max: dmgMax, avg: avgDmg }
    };
    let elementalAvgSum = 0;
    for (const [dt, val] of Object.entries(weaponMetrics.elementalDmg)) {
      damageByType[dt] = { min: val, max: val, avg: val };
      elementalAvgSum += val;
    }

    // Effective DPS
    const totalAvgDmg = avgDmg + elementalAvgSum;
    const critFactor = 1 + (critChance * (critMult - 1));
    const dps = Number((totalAvgDmg * statScalar * attackSpeed * critFactor).toFixed(1));

    // 4. Defense, Armor & Resistances
    const totalArmor = derivedOverrides?.armor ?? (profile.baseArmor + Math.floor(totalStats.vitality * 0.25) + gear.armor);
    // Authoritative CombatMath mitigation: R = Armor / (Armor + 50)
    const armorDr = totalArmor / (totalArmor + 50);
    const armorDrPct = Math.min(75, Math.round(armorDr * 100));

    // Resistances & Mitigation Curves: Res / (Res + 50)
    const resistances = {};
    for (const [resKey, meta] of Object.entries(RESISTANCE_METADATA)) {
      const val = gear[resKey] || 0;
      const dr = val / (val + 50);
      resistances[resKey] = {
        val,
        pct: Math.min(75, Math.round(dr * 100)),
        meta
      };
    }

    // Evasion / Dodge: derived from Agility (0.25% per point) + gear
    const evasionPct = Math.min(40, Number((totalStats.agility * 0.25 + gear.evasion * 100).toFixed(1)));

    // 5. Vitals & Regeneration
    const maxHp = 50 + totalStats.vitality * 5 + (level - 1) * 10 + gear.hp;
    const maxMp = 20 + totalStats.focus * 3 + (level - 1) * 5 + gear.mp;
    const hpRegen = Number((totalStats.vitality * 0.2 + (gear.hpRegen || 0)).toFixed(1));
    const mpRegen = Number((1.0 + totalStats.focus * 0.08 + (gear.mpRegen || 0)).toFixed(1));

    // Effective Health Pool (Toughness): MaxHP / (1 - ArmorDR)
    const toughness = Math.round(maxHp / Math.max(0.10, 1 - armorDr));

    // Spell Power
    const spellDmg = derivedOverrides?.spellDmg ?? Math.round(14 + totalStats.focus * 0.8 + flatDmgBonus * 0.6 + gear.spellDmg);

    // Movement Velocity
    const moveVelocity = derivedOverrides?.speed ?? Math.round(profile.baseSpeed * 100 + totalStats.agility);

    return {
      classId: normClassId,
      level,
      profile,
      baseStats,
      totalStats,
      gearBonuses: gear,
      weapon: weaponMetrics,
      offense: {
        dmgMin,
        dmgMax,
        avgDmg,
        totalAvgDmg,
        damageByType,
        attackSpeed,
        statScalar,
        critChance,
        critChancePct: Math.round(critChance * 100),
        critMult,
        critMultPct: Math.round(critMult * 100),
        spellDmg,
        dps
      },
      defense: {
        totalArmor,
        armorDr,
        armorDrPct,
        resistances,
        evasionPct,
        toughness
      },
      vitals: {
        maxHp,
        maxMp,
        hpRegen,
        mpRegen
      },
      mobility: {
        moveVelocity
      }
    };
  }

  /**
   * Simulates replacing an equipment slot with an inspected item
   * and computes authoritative differential deltas for Diablo 3 style comparison.
   */
  static simulateEquipDiff({
    characterState = {},
    inspectedItem = null,
    targetSlot = null
  } = {}) {
    const slot = targetSlot || inspectedItem?.slot;
    const currEquipment = characterState.equipment || {};

    // 1. Current Stats
    const currentStats = this.calculateCharacterStats({
      classId: characterState.classId,
      level: characterState.level,
      stats: characterState.stats,
      equipment: currEquipment,
      derivedOverrides: characterState.derived
    });

    if (!inspectedItem) {
      return {
        current: currentStats,
        simulated: currentStats,
        dpsDelta: 0,
        dpsPct: 0,
        armorDelta: 0,
        armorDrDelta: 0,
        toughnessDelta: 0,
        toughnessPct: 0,
        hpDelta: 0,
        mpDelta: 0,
        statDeltas: { might: 0, focus: 0, agility: 0, vitality: 0 },
        isUpgrade: false
      };
    }

    // 2. Simulated Equipment Copy
    const simEquipment = { ...currEquipment };
    if (slot) {
      simEquipment[slot] = inspectedItem;
    }

    // 3. Simulated Stats
    const simulatedStats = this.calculateCharacterStats({
      classId: characterState.classId,
      level: characterState.level,
      stats: characterState.stats,
      equipment: simEquipment,
      derivedOverrides: null // Recalculate cleanly without stale overrides
    });

    // 4. Authoritative Differential Calculations
    const dpsDelta = Number((simulatedStats.offense.dps - currentStats.offense.dps).toFixed(1));
    const dpsPct = currentStats.offense.dps > 0
      ? Number(((dpsDelta / currentStats.offense.dps) * 100).toFixed(1))
      : (dpsDelta > 0 ? 100 : 0);

    const armorDelta = simulatedStats.defense.totalArmor - currentStats.defense.totalArmor;
    const armorDrDelta = simulatedStats.defense.armorDrPct - currentStats.defense.armorDrPct;

    const toughnessDelta = simulatedStats.defense.toughness - currentStats.defense.toughness;
    const toughnessPct = currentStats.defense.toughness > 0
      ? Number(((toughnessDelta / currentStats.defense.toughness) * 100).toFixed(1))
      : (toughnessDelta > 0 ? 100 : 0);

    const hpDelta = simulatedStats.vitals.maxHp - currentStats.vitals.maxHp;
    const mpDelta = simulatedStats.vitals.maxMp - currentStats.vitals.maxMp;

    const statDeltas = {
      might: simulatedStats.totalStats.might - currentStats.totalStats.might,
      focus: simulatedStats.totalStats.focus - currentStats.totalStats.focus,
      agility: simulatedStats.totalStats.agility - currentStats.totalStats.agility,
      vitality: simulatedStats.totalStats.vitality - currentStats.totalStats.vitality
    };

    // Resistance Deltas
    const resDeltas = {};
    for (const resKey of Object.values(RESISTANCE_TYPES)) {
      const simVal = simulatedStats.defense.resistances[resKey]?.val || 0;
      const currVal = currentStats.defense.resistances[resKey]?.val || 0;
      resDeltas[resKey] = simVal - currVal;
    }

    const isUpgrade = dpsDelta >= 0 && toughnessDelta >= 0 && (dpsDelta > 0 || toughnessDelta > 0 || hpDelta > 0);

    return {
      current: currentStats,
      simulated: simulatedStats,
      dpsDelta,
      dpsPct,
      armorDelta,
      armorDrDelta,
      toughnessDelta,
      toughnessPct,
      hpDelta,
      mpDelta,
      statDeltas,
      resDeltas,
      isUpgrade
    };
  }

  /**
   * Evaluates comparison for rings where the player has two sockets (ring1 and ring2).
   */
  static simulateDualRingDiff({ characterState = {}, inspectedRing = null }) {
    const diffR1 = this.simulateEquipDiff({
      characterState,
      inspectedItem: inspectedRing,
      targetSlot: 'ring1'
    });

    const diffR2 = this.simulateEquipDiff({
      characterState,
      inspectedItem: inspectedRing,
      targetSlot: 'ring2'
    });

    // Recommend replacing empty ring first, or the one yielding the higher net upgrade
    const r1Empty = !characterState.equipment?.ring1;
    const r2Empty = !characterState.equipment?.ring2;

    let recommendedSlot = 'ring1';
    if (r2Empty && !r1Empty) {
      recommendedSlot = 'ring2';
    } else if (!r1Empty && !r2Empty) {
      const scoreR1 = diffR1.dpsDelta * 2 + diffR1.armorDelta * 3;
      const scoreR2 = diffR2.dpsDelta * 2 + diffR2.armorDelta * 3;
      recommendedSlot = scoreR2 > scoreR1 ? 'ring2' : 'ring1';
    }

    return {
      diffR1,
      diffR2,
      recommendedSlot
    };
  }
}
