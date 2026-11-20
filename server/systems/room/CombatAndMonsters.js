/**
 * Monster Spawning, AI & Pathing, Combat Resolution, Projectiles & Loot Drops
 */

import { ENGINE, RARITY } from '../../../shared/Constants.js';
import { CombatMath } from '../../../shared/CombatMath.js';
import { dist } from '../../../shared/MathUtils.js';
import { dataRegistry } from '../DataRegistry.js';
import { LootGenerator } from '../LootGenerator.js';

export function spawnInitialMonsters(room) {
  const types = dataRegistry.getMonsterTypes();
  for (let i = 1; i < room.dungeon.rooms.length; i++) {
    const r = room.dungeon.rooms[i];
    const count = room.rng.range(2, 4);
    for (let j = 0; j < count; j++) {
      const mx = (r.x + 1 + (room.rng.next() % (r.w - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
      const my = (r.y + 1 + (room.rng.next() % (r.h - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
      const id = room.nextEntityId++;
      const type = types[room.rng.next() % types.length] || 'crawler';
      const def = dataRegistry.getMonster(type);
      const baseHp = def.baseHp + (room.floor - 1) * 6;
      const baseDmg = def.baseDmg + (room.floor - 1) * 2;
      const baseStats = CombatMath.getMonsterScale(baseHp, baseDmg, room.ngCycle);
      room.monsters.set(id, {
        id,
        type,
        xp: def.xp || 25,
        aggroRange: def.aggroRange || 90,
        x: mx,
        y: my,
        hp: baseStats.hp,
        maxHp: baseStats.hp,
        dmg: baseStats.dmg,
        speed: def.speed || 0.6,
        attackCooldown: 0
      });
    }
  }
}

export function handlePlayerAttack(room, p, monsterId) {
  if (p.attackCooldown > 0) return false;
  const m = room.monsters.get(monsterId);
  if (!m) return false;

  if (dist(p.x, p.y, m.x, m.y) <= 16) {
    const hit = CombatMath.calculateDamage({
      baseDmgMin: p.baseDmgMin, baseDmgMax: p.baseDmgMax,
      primaryStat: p.primaryStat, ngCycle: room.ngCycle,
      critChance: p.critChance || 0.15, targetArmor: 2, rng: room.rng
    });
    m.hp -= hit.damage;
    p.attackCooldown = 8;
    room.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, attackerId: p.id, x: m.x, y: m.y, damage: hit.damage, isCrit: hit.isCrit });
    if (m.hp <= 0) room.killMonster(m);
    return true;
  }
  return false;
}

export function handlePlayerSkill(room, p, angle) {
  if (p.mp < 10) return;
  p.mp -= 10;
  room.projectiles.push({
    id: room.nextEntityId++, ownerId: p.id,
    x: p.x, y: p.y, vx: Math.cos(angle) * 3.5, vy: Math.sin(angle) * 3.5,
    life: 40, damage: p.spellDmg || 18
  });
}

export function generateGearDrop(room, x, y) {
  return LootGenerator.generateDrop({
    id: room.nextEntityId++,
    x,
    y,
    floor: room.floor,
    ngCycle: room.ngCycle,
    rng: room.rng
  });
}

export function killMonster(room, m) {
  room.monsters.delete(m.id);
  room.grantXp(m.xp || (25 + (room.floor - 1) * 10));

  const roll = room.rng.next() % 100;
  if (roll < 35) {
    const amt = Math.max(5, Math.round(room.rng.range(5, 20) * (1 + (room.floor - 1) * 0.4)));
    room.groundLoot.push({
      id: room.nextEntityId++,
      type: 'gold',
      name: `${amt} Gold`,
      amount: amt,
      rarity: RARITY.NORMAL,
      x: m.x, y: m.y
    });
  } else if (roll < 60) {
    const isMana = room.rng.next() % 3 === 0;
    room.groundLoot.push({
      id: room.nextEntityId++,
      type: 'potion',
      subType: isMana ? 'mp' : 'hp',
      name: isMana ? 'Mana Potion' : 'Health Potion',
      count: 1,
      maxStack: 20,
      weight: 0.2,
      rarity: RARITY.MAGIC,
      x: m.x, y: m.y
    });
  } else {
    room.groundLoot.push(room.generateGearDrop(m.x, m.y));
  }
}

export function stepProjectiles(room) {
  for (let i = room.projectiles.length - 1; i >= 0; i--) {
    const proj = room.projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.life--;

    if (!room.isWalkable(proj.x, proj.y, 1)) {
      proj.life = 0;
    }

    for (const m of room.monsters.values()) {
      if (dist(proj.x, proj.y, m.x, m.y) < 10) {
        m.hp -= proj.damage;
        room.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, attackerId: proj.ownerId, x: m.x, y: m.y, damage: proj.damage, isCrit: true });
        if (m.hp <= 0) room.killMonster(m);
        proj.life = 0;
        break;
      }
    }
    if (proj.life <= 0) room.projectiles.splice(i, 1);
  }
}

export function stepMonsters(room) {
  for (const m of room.monsters.values()) {
    let closestP = null;
    const maxAggro = typeof m.aggroRange === 'number' ? m.aggroRange : 90;
    let closestDist = maxAggro;
    for (const p of room.players.values()) {
      if (p.isDead) continue;
      const d = dist(m.x, m.y, p.x, p.y);
      if (d < closestDist) {
        closestDist = d;
        closestP = p;
      }
    }
    if (closestP) {
      if (closestDist > 10) {
        const step = Math.min(m.speed, closestDist);
        const dx = ((closestP.x - m.x) / closestDist) * step;
        const dy = ((closestP.y - m.y) / closestDist) * step;

        if (room.isWalkable(m.x + dx, m.y + dy, 3)) {
          m.x += dx;
          m.y += dy;
        } else if (room.isWalkable(m.x + dx, m.y, 3)) {
          m.x += dx;
        } else if (room.isWalkable(m.x, m.y + dy, 3)) {
          m.y += dy;
        }
      } else if (m.attackCooldown <= 0) {
        const hit = CombatMath.calculateDamage({
          baseDmgMin: m.dmg - 2, baseDmgMax: m.dmg + 2,
          primaryStat: 10, targetArmor: closestP.armor, rng: room.rng
        });
        closestP.hp = Math.max(0, closestP.hp - hit.damage);
        m.attackCooldown = 18;
        room.events.push({ type: 'DAMAGE', targetType: 'player', id: closestP.id, attackerId: m.id, x: closestP.x, y: closestP.y, damage: hit.damage, isCrit: false });
        if (closestP.hp <= 0) room.handlePlayerDeath(closestP);
      }
    }
    if (m.attackCooldown > 0) m.attackCooldown--;
  }
}
