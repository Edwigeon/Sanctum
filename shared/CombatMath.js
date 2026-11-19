export class CombatMath {
  static calculateDamage({
    baseDmgMin,
    baseDmgMax,
    flatBonus = 0,
    primaryStat = 10,
    skillMult = 1.0,
    ngCycle = 0,
    critChance = 0.05,
    critMult = 1.5,
    targetArmor = 0,
    rng
  }) {
    const rollBase = rng ? rng.range(baseDmgMin, baseDmgMax) : (baseDmgMin + (baseDmgMax - baseDmgMin) / 2);
    const rawWeapon = rollBase + flatBonus;
    const statScalar = 1 + Math.max(0, (primaryStat - 10) * 0.02);
    const ngScalar = Math.pow(1.35, ngCycle);

    const rollCrit = rng ? rng.nextFloat() : Math.random();
    const isCrit = rollCrit < critChance;
    const finalCritMult = isCrit ? critMult : 1.0;

    let finalDamage = Math.floor(rawWeapon * statScalar * skillMult * ngScalar * finalCritMult);
    const reduction = targetArmor / (targetArmor + 50);
    finalDamage = Math.max(1, Math.floor(finalDamage * (1 - reduction)));

    return { damage: finalDamage, isCrit };
  }

  static getMonsterScale(baseHp, baseDmg, ngCycle = 0) {
    return {
      hp: Math.floor(baseHp * Math.pow(1.85, ngCycle)),
      dmg: Math.floor(baseDmg * Math.pow(1.45, ngCycle))
    };
  }
}
