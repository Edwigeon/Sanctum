/**
 * Player Entity Creation, Derived Stat Calculation, Progression & Lifecycle
 */

import { ENGINE, GAME_MODES } from '../../../shared/Constants.js';
import { dataRegistry } from '../DataRegistry.js';
import { saveManager } from '../SaveManager.js';

export function createPlayerEntity(room, socket, name = 'Wanderer', classId = 'VANGUARD', savedChar = null) {
  const id = socket.id;
  const sx = room.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
  const sy = room.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
  const cls = dataRegistry.getClass(savedChar?.classId || classId);

  const player = {
    id,
    characterId: savedChar?.id || null,
    accountId: savedChar?.accountId || socket?.accountId || null,
    mode: savedChar?.mode || room.mode,
    name: savedChar?.name || name,
    socket,
    classId: cls.id,
    className: cls.name,
    level: savedChar?.level || 1,
    xp: savedChar?.xp || 0,
    nextXp: savedChar?.nextXp || 100,
    statPoints: savedChar?.statPoints || 0,
    gold: savedChar?.gold ?? 50,
    stats: savedChar?.stats ? { ...savedChar.stats } : { ...cls.stats },
    equipment: savedChar?.equipment
      ? (() => {
          const eq = Object.assign(
            { ring1: null, helm: null, amulet: null, weapon: null, armor: null, offhand: null, gloves: null, boots: null, ring2: null },
            savedChar.equipment
          );
          if (eq.ring && !eq.ring1) eq.ring1 = eq.ring;
          delete eq.ring;
          for (const slot of Object.keys(eq)) {
            if (eq[slot] && typeof eq[slot] === 'object') {
              eq[slot] = { ...eq[slot], id: room.nextEntityId++ };
            }
          }
          return eq;
        })()
      : { ring1: null, helm: null, amulet: null, weapon: null, armor: null, offhand: null, gloves: null, boots: null, ring2: null },
    inventory: savedChar?.inventory
      ? savedChar.inventory.map(item => (item && typeof item === 'object' ? { ...item, id: room.nextEntityId++ } : item)).filter(Boolean)
      : [],
    x: sx, y: sy, targetX: sx, targetY: sy,
    targetMonsterId: null, targetLootId: null, holdAttack: false,
    hp: 100, maxHp: 100, mp: 50, maxMp: 50,
    potions: savedChar?.potions ?? 3, speed: cls.baseSpeed, isDead: Boolean(savedChar?.isDead),
    primaryStat: cls.stats.might, baseDmgMin: cls.baseDmgMin, baseDmgMax: cls.baseDmgMax,
    armor: cls.baseArmor, critChance: cls.baseCrit, spellDmg: 18,
    carryWeight: 0, maxWeight: 60, attackCooldown: 0,
    lastCombatAt: 0, lingerUntil: null, disconnectedAt: null,
    dirtyState: true
  };

  const hasHpPot = player.inventory.some(i => i.type === 'potion' && (!i.subType || i.subType === 'hp' || i.name?.includes('Health')));
  if (!hasHpPot && player.potions > 0) {
    player.inventory.push({
      id: room.nextEntityId++,
      type: 'potion',
      subType: 'hp',
      name: 'Health Potion',
      rarity: 1,
      count: player.potions,
      maxStack: 20,
      weight: 0.2
    });
  }

  const hasMpPot = player.inventory.some(i => i.type === 'potion' && (i.subType === 'mp' || i.name?.includes('Mana')));
  if (!hasMpPot && (!savedChar || player.inventory.length === 0)) {
    player.inventory.push({
      id: room.nextEntityId++,
      type: 'potion',
      subType: 'mp',
      name: 'Mana Potion',
      rarity: 1,
      count: 2,
      maxStack: 20,
      weight: 0.2
    });
  }

  recalculateStats(player, true);
  return player;
}

export function recalculateStats(p, fullRestore = false) {
  const cls = dataRegistry.getClass(p.classId);
  const eq = Object.values(p.equipment).filter(Boolean);
  const bonus = { might: 0, focus: 0, agility: 0, vitality: 0, dmg: 0, armor: 0, hp: 0, mp: 0, crit: 0, speed: 0, spellDmg: 0 };
  let weightSum = 0;
  for (const item of eq) {
    weightSum += item.weight || 0;
    if (!item.stats) continue;
    for (const [k, v] of Object.entries(item.stats)) {
      if (bonus[k] !== undefined) bonus[k] += v;
    }
  }
  for (const item of p.inventory) {
    weightSum += (item.weight || 0) * (item.count || 1);
  }

  const hpPotions = p.inventory.filter(i => i.type === 'potion' && (!i.subType || i.subType === 'hp' || i.name?.includes('Health')));
  p.potions = hpPotions.reduce((acc, curr) => acc + (curr.count || 1), 0);
  const mpPotions = p.inventory.filter(i => i.type === 'potion' && (i.subType === 'mp' || i.name?.includes('Mana')));
  p.manaPotions = mpPotions.reduce((acc, curr) => acc + (curr.count || 1), 0);

  const totalMight = p.stats.might + bonus.might;
  const totalFocus = p.stats.focus + bonus.focus;
  const totalAgility = p.stats.agility + bonus.agility;
  const totalVitality = p.stats.vitality + bonus.vitality;

  p.maxHp = 50 + totalVitality * 5 + (p.level - 1) * 10 + bonus.hp;
  p.maxMp = 20 + totalFocus * 3 + (p.level - 1) * 5 + bonus.mp;
  p.baseDmgMin = cls.baseDmgMin + bonus.dmg;
  p.baseDmgMax = cls.baseDmgMax + bonus.dmg;
  p.primaryStat = p.classId === 'ARCANIST' ? totalFocus : (p.classId === 'SHADOW' ? totalAgility : totalMight);
  p.armor = cls.baseArmor + Math.floor(totalVitality * 0.25) + bonus.armor;
  p.critChance = Math.min(0.65, cls.baseCrit + totalAgility * 0.004 + bonus.crit);
  p.speed = Math.min(2.2, cls.baseSpeed + totalAgility * 0.01 + bonus.speed);
  p.spellDmg = Math.round(14 + totalFocus * 0.8 + bonus.dmg * 0.6 + bonus.spellDmg);
  p.maxWeight = 30 + totalMight * 2;
  p.carryWeight = Math.round(weightSum * 10) / 10;

  if (fullRestore) {
    p.hp = p.maxHp;
    p.mp = p.maxMp;
  } else {
    p.hp = Math.min(p.hp, p.maxHp);
    p.mp = Math.min(p.mp, p.maxMp);
  }
}

export function handleAllocStat(room, p, stat) {
  if (p.statPoints <= 0) return;
  if (!['might', 'focus', 'agility', 'vitality'].includes(stat)) return;
  p.stats[stat]++;
  p.statPoints--;
  room.recalculateStats(p, false);
  p.dirtyState = true;
  saveManager.saveFromPlayer(p, room.floor);
}

export function grantXp(room, amount) {
  for (const p of room.players.values()) {
    if (p.isDead) continue;
    p.xp += amount;
    p.dirtyState = true;
    let leveled = false;
    while (p.xp >= p.nextXp) {
      p.xp -= p.nextXp;
      p.level++;
      p.nextXp = Math.round(p.nextXp * 1.45);
      p.statPoints += 3;
      room.recalculateStats(p, true);
      room.events.push({ type: 'LEVEL_UP', id: p.id, level: p.level, x: p.x, y: p.y });
      leveled = true;
    }
    if (leveled) saveManager.saveFromPlayer(p, room.floor);
  }
}

export function handlePlayerDeath(room, player) {
  player.isDead = true;
  player.targetMonsterId = null;
  player.targetLootId = null;
  player.holdAttack = false;
  // Immediate flush for Hardcore permadeath so disconnect/crash cannot roll back death state
  saveManager.saveFromPlayer(player, room.floor, { immediate: room.mode === GAME_MODES.HARDCORE });
  room.events.push({
    type: 'PLAYER_DEATH', id: player.id, name: player.name, x: player.x, y: player.y,
    hardcore: room.mode === GAME_MODES.HARDCORE
  });
}

export function handlePlayerRespawn(room, player) {
  if (!player.isDead || room.mode === GAME_MODES.HARDCORE) return;
  const sx = room.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
  const sy = room.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
  player.x = sx;
  player.y = sy;
  player.targetX = sx;
  player.targetY = sy;
  player.targetMonsterId = null;
  player.targetLootId = null;
  player.holdAttack = false;
  player.isDead = false;
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  player.xp = Math.max(0, player.xp - Math.round(player.nextXp * 0.1));
  if (player.potions < 1 && player.inventory.length < 40) {
    player.inventory.push({
      id: room.nextEntityId++,
      type: 'potion',
      subType: 'hp',
      name: 'Health Potion',
      rarity: 1,
      count: 1,
      maxStack: 20,
      weight: 0.2
    });
    room.recalculateStats(player, false);
  }
  player.dirtyState = true;
  saveManager.saveFromPlayer(player, room.floor);
  room.events.push({ type: 'PLAYER_RESPAWN', id: player.id, x: sx, y: sy });
}
