import crypto from 'crypto';
import { ENGINE, GAME_MODES, PACKET_TYPES, TILES } from '../../shared/Constants.js';
import { DungeonGen } from '../../shared/DungeonGen.js';
import { PRNG, dist } from '../../shared/MathUtils.js';
import { saveManager } from './SaveManager.js';

import {
  createPlayerEntity,
  recalculateStats,
  handleAllocStat,
  grantXp,
  handlePlayerDeath,
  handlePlayerRespawn
} from './room/PlayerState.js';
import {
  handleEquipItem,
  handleUnequipItem,
  handleUseItem,
  handleDropItem,
  handlePlayerPotion,
  handlePickupLoot
} from './room/InventoryActions.js';
import {
  spawnInitialMonsters,
  handlePlayerAttack,
  handlePlayerSkill,
  generateGearDrop,
  killMonster,
  stepProjectiles,
  stepMonsters
} from './room/CombatAndMonsters.js';
import { buildRoomSummary, broadcastRoomSnapshot } from './room/SnapshotSerializer.js';

export class GameRoom {
  constructor(roomId, mode = GAME_MODES.CLASSIC, ngCycle = 0, options = {}) {
    this.roomId = roomId;
    this.displayName = options.displayName || roomId;
    this.isPublic = options.isPublic !== false;
    this.maxPlayers = options.maxPlayers || 4;
    this.password = options.password || '';
    this.inviteCode = options.inviteCode || crypto.randomBytes(3).toString('hex').toUpperCase();
    this.inviteToken = options.inviteToken || crypto.randomBytes(16).toString('base64url');
    this.mode = mode;
    this.ngCycle = ngCycle;
    this.floor = 1;
    this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    this.rng = new PRNG(this.seed);
    this.dungeon = DungeonGen.generate(this.seed, 40, 30);

    this.players = new Map();
    this.monsters = new Map();
    this.projectiles = [];
    this.groundLoot = [];
    this.events = [];

    this.nextEntityId = 1;
    this.tick = 0;
    this.spawnInitialMonsters();
    this.tickInterval = null;
  }

  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.players.clear();
    this.monsters.clear();
    this.projectiles = [];
    this.groundLoot = [];
    this.events = [];
  }

  getSummary() {
    return buildRoomSummary(this);
  }

  isWalkable(x, y, radius = 3) {
    const minC = Math.floor((x - radius) / ENGINE.TILE_SIZE);
    const maxC = Math.floor((x + radius) / ENGINE.TILE_SIZE);
    const minR = Math.floor((y - radius) / ENGINE.TILE_SIZE);
    const maxR = Math.floor((y + radius) / ENGINE.TILE_SIZE);

    if (minC < 0 || maxC >= this.dungeon.width || minR < 0 || maxR >= this.dungeon.height) {
      return false;
    }

    for (let r = minR; r <= maxR; r++) {
      const row = this.dungeon.map[r];
      if (!row) return false;
      for (let c = minC; c <= maxC; c++) {
        const t = row[c];
        if (t === undefined || t === TILES.WALL || t === TILES.EMPTY) return false;
      }
    }
    return true;
  }

  spawnInitialMonsters() {
    spawnInitialMonsters(this);
  }

  addPlayer(socket, name = 'Wanderer', classId = 'VANGUARD', savedChar = null) {
    const player = createPlayerEntity(this, socket, name, classId, savedChar);
    this.players.set(player.id, player);
    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this.update(), ENGINE.TICK_INTERVAL_MS);
    }
    socket.send(JSON.stringify({
      type: PACKET_TYPES.ROOM_INIT,
      data: {
        roomId: this.roomId,
        mode: this.mode,
        seed: this.seed,
        ngCycle: this.ngCycle,
        floor: this.floor,
        playerId: player.id,
        inviteCode: this.inviteCode,
        inviteToken: this.inviteToken,
        maxPlayers: this.maxPlayers
      }
    }));
    this.broadcastSnapshot();
  }

  recalculateStats(p, fullRestore = false) {
    recalculateStats(p, fullRestore);
  }

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (p) saveManager.saveFromPlayer(p, this.floor);
    this.players.delete(playerId);
    if (this.players.size === 0 && this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  handlePlayerInput(playerId, packet) {
    if (!packet || typeof packet.type !== 'string') return;
    const p = this.players.get(playerId);
    if (!p) return;

    if (packet.type === PACKET_TYPES.INPUT_RESPAWN) {
      this.handlePlayerRespawn(p);
      return;
    }
    if (p.isDead) return;

    const maxW = this.dungeon.width * ENGINE.TILE_SIZE;
    const maxH = this.dungeon.height * ENGINE.TILE_SIZE;

    if (packet.type === PACKET_TYPES.INPUT_MOVE) {
      if (!Number.isFinite(packet.x) || !Number.isFinite(packet.y)) return;
      p.targetMonsterId = null;
      p.targetLootId = null;
      p.holdAttack = false;
      p.targetX = Math.max(0, Math.min(maxW, packet.x));
      p.targetY = Math.max(0, Math.min(maxH, packet.y));
    } else if (packet.type === PACKET_TYPES.INPUT_ATTACK) {
      if (!Number.isInteger(packet.targetMonsterId)) return;
      p.targetLootId = null;
      p.targetMonsterId = packet.targetMonsterId;
      p.holdAttack = !!packet.hold;
    } else if (packet.type === PACKET_TYPES.INPUT_SKILL) {
      if (!Number.isFinite(packet.angle)) return;
      this.handlePlayerSkill(p, packet.angle);
    } else if (packet.type === PACKET_TYPES.INPUT_POTION) {
      this.handlePlayerPotion(p, packet.subType || 'hp');
    } else if (packet.type === PACKET_TYPES.PICKUP_LOOT) {
      if (!Number.isInteger(packet.lootId)) return;
      this.handlePickupLoot(p, packet.lootId);
    } else if (packet.type === PACKET_TYPES.ALLOC_STAT) {
      this.handleAllocStat(p, packet.stat);
    } else if (packet.type === PACKET_TYPES.EQUIP_ITEM) {
      if (!Number.isInteger(packet.itemId)) return;
      this.handleEquipItem(p, packet.itemId);
    } else if (packet.type === PACKET_TYPES.UNEQUIP_ITEM) {
      if (typeof packet.slot !== 'string') return;
      this.handleUnequipItem(p, packet.slot);
    } else if (packet.type === PACKET_TYPES.USE_ITEM) {
      if (!Number.isInteger(packet.itemId)) return;
      this.handleUseItem(p, packet.itemId);
    } else if (packet.type === PACKET_TYPES.DROP_ITEM) {
      if (!Number.isInteger(packet.itemId)) return;
      this.handleDropItem(p, packet.itemId);
    }
  }

  handleAllocStat(p, stat) {
    handleAllocStat(this, p, stat);
  }

  handleEquipItem(p, itemId) {
    handleEquipItem(this, p, itemId);
  }

  handleUnequipItem(p, slot) {
    handleUnequipItem(this, p, slot);
  }

  handleUseItem(p, itemId) {
    handleUseItem(this, p, itemId);
  }

  handleDropItem(p, itemId) {
    handleDropItem(this, p, itemId);
  }

  handlePlayerAttack(p, monsterId) {
    return handlePlayerAttack(this, p, monsterId);
  }

  handlePlayerSkill(p, angle) {
    handlePlayerSkill(this, p, angle);
  }

  handlePlayerPotion(p, subType = 'hp') {
    handlePlayerPotion(this, p, subType);
  }

  handlePickupLoot(p, lootId) {
    return handlePickupLoot(this, p, lootId);
  }

  grantXp(amount) {
    grantXp(this, amount);
  }

  generateGearDrop(x, y) {
    return generateGearDrop(this, x, y);
  }

  killMonster(m) {
    killMonster(this, m);
  }

  update() {
    this.tick++;
    for (const p of this.players.values()) {
      if (p.isDead) continue;

      if (p.targetMonsterId !== null) {
        const m = this.monsters.get(p.targetMonsterId);
        if (!m) {
          p.targetMonsterId = null;
        } else if (dist(p.x, p.y, m.x, m.y) <= 16) {
          p.targetX = p.x;
          p.targetY = p.y;
          if (p.attackCooldown <= 0) {
            this.handlePlayerAttack(p, m.id);
            if (!p.holdAttack || !this.monsters.has(m.id)) {
              p.targetMonsterId = null;
            }
          }
        } else {
          p.targetX = m.x;
          p.targetY = m.y;
        }
      } else if (p.targetLootId !== null) {
        const item = this.groundLoot.find(l => l.id === p.targetLootId);
        if (!item) {
          p.targetLootId = null;
        } else if (dist(p.x, p.y, item.x, item.y) < 18) {
          this.handlePickupLoot(p, item.id);
          p.targetX = p.x;
          p.targetY = p.y;
        } else {
          p.targetX = item.x;
          p.targetY = item.y;
        }
      }

      const d = dist(p.x, p.y, p.targetX, p.targetY);
      if (d > 2) {
        const step = Math.min(p.speed, d);
        const dx = ((p.targetX - p.x) / d) * step;
        const dy = ((p.targetY - p.y) / d) * step;

        if (this.isWalkable(p.x + dx, p.y + dy)) {
          p.x += dx;
          p.y += dy;
        } else if (this.isWalkable(p.x + dx, p.y)) {
          p.x += dx;
        } else if (this.isWalkable(p.x, p.y + dy)) {
          p.y += dy;
        }
      }

      // Check stairs down trigger
      const exitPx = this.dungeon.exitPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
      const exitPy = this.dungeon.exitPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
      if (dist(p.x, p.y, exitPx, exitPy) <= 12) {
        this.advanceFloor();
        return;
      }

      if (p.attackCooldown > 0) p.attackCooldown--;
      if (p.mp < p.maxMp) p.mp = Math.min(p.maxMp, p.mp + 0.1);
    }

    stepProjectiles(this);
    stepMonsters(this);

    this.broadcastSnapshot();
    this.events = [];
  }

  advanceFloor() {
    this.floor++;
    this.seed = (this.rng.next() ^ (this.floor * 7919)) >>> 0;
    this.rng = new PRNG(this.seed);
    this.dungeon = DungeonGen.generate(this.seed, 40, 30);
    this.monsters.clear();
    this.projectiles = [];
    this.groundLoot = [];
    this.spawnInitialMonsters();

    const sx = this.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const sy = this.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;

    for (const p of this.players.values()) {
      p.x = sx;
      p.y = sy;
      p.targetX = sx;
      p.targetY = sy;
      saveManager.saveFromPlayer(p, this.floor);
      if (p.socket.readyState === 1) {
        p.socket.send(JSON.stringify({
          type: PACKET_TYPES.ROOM_INIT,
          data: {
            roomId: this.roomId,
            mode: this.mode,
            seed: this.seed,
            ngCycle: this.ngCycle,
            floor: this.floor,
            playerId: p.id,
            inviteCode: this.inviteCode,
            inviteToken: this.inviteToken,
            maxPlayers: this.maxPlayers
          }
        }));
      }
    }
    this.events.push({ type: 'FLOOR_DESCENT', floor: this.floor });
    this.broadcastSnapshot();
  }

  handlePlayerDeath(player) {
    handlePlayerDeath(this, player);
  }

  handlePlayerRespawn(player) {
    handlePlayerRespawn(this, player);
  }

  broadcastSnapshot() {
    broadcastRoomSnapshot(this);
  }
}
