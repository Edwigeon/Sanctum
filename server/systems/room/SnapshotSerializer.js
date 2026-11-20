/**
 * Room Summary & 15 Hz Authoritative World Snapshot Serializer
 */

import { LOBBY_RETENTION, PACKET_TYPES } from '../../../shared/Constants.js';

export function buildRoomSummary(room) {
  const biome = room.floor <= 1 ? 'Crypts' : (room.floor <= 2 ? 'Caverns' : (room.floor <= 4 ? 'Cathedral' : 'Sanctum'));
  return {
    roomId: room.roomId,
    name: room.displayName,
    mode: room.mode,
    floor: room.floor,
    biome,
    ngCycle: room.ngCycle,
    players: room.players.size,
    maxPlayers: room.maxPlayers,
    hasPassword: !!room.password,
    inviteCode: room.inviteCode,
    inviteToken: room.inviteToken,
    playerList: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      classId: p.classId,
      className: p.className || p.classId,
      level: p.level || 1
    }))
  };
}

export function broadcastRoomSnapshot(room) {
  if (room.players.size === 0) return;

  const lootVersion = room.lootVersion ?? 1;
  let anyNeedsLoot = false;
  for (const p of room.players.values()) {
    if (p._lastLootVersion !== lootVersion) {
      anyNeedsLoot = true;
      break;
    }
  }

  const now = Date.now();
  const snapshotData = {
    tick: room.tick,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      classId: p.classId,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      hp: p.hp,
      maxHp: p.maxHp,
      mp: Math.floor(p.mp),
      maxMp: p.maxMp,
      isDead: p.isDead,
      isDisconnected: !p.socket,
      inCombatMs: Math.max(0, (p.lastCombatAt || 0) + LOBBY_RETENTION.COMBAT_COOLDOWN_MS - now)
    })),
    monsters: Array.from(room.monsters.values()).map(m => ({
      id: m.id,
      type: m.type,
      x: Math.round(m.x * 100) / 100,
      y: Math.round(m.y * 100) / 100,
      hp: m.hp,
      maxHp: m.maxHp
    })),
    projectiles: room.projectiles.map(p => ({
      id: p.id,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      vx: Math.round(p.vx * 100) / 100,
      vy: Math.round(p.vy * 100) / 100
    })),
    events: room.events
  };
  if (anyNeedsLoot) {
    snapshotData.loot = room.groundLoot;
  }

  const payload = JSON.stringify({
    type: PACKET_TYPES.WORLD_SNAPSHOT,
    data: snapshotData
  });

  for (const p of room.players.values()) {
    if (!p.socket || p.socket.readyState !== 1) continue;
    if (anyNeedsLoot) p._lastLootVersion = lootVersion;
    p.socket.send(payload);
    if (p.dirtyState) {
      p.dirtyState = false;
      p.socket.send(JSON.stringify({
        type: PACKET_TYPES.PLAYER_STATE_SYNC,
        data: {
          className: p.className,
          level: p.level,
          xp: p.xp,
          nextXp: p.nextXp,
          statPoints: p.statPoints,
          potions: p.potions,
          manaPotions: p.manaPotions || 0,
          gold: p.gold || 0,
          carryWeight: p.carryWeight,
          maxWeight: p.maxWeight,
          stats: p.stats,
          derived: {
            dmgMin: p.baseDmgMin,
            dmgMax: p.baseDmgMax,
            armor: p.armor,
            crit: Math.round((p.critChance || 0.15) * 100),
            speed: Math.round(p.speed * 100),
            spellDmg: p.spellDmg
          },
          equipment: p.equipment,
          inventory: p.inventory
        }
      }));
    }
  }
}
