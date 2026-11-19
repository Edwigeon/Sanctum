import { ENGINE, GAME_MODES, PACKET_TYPES, TILES, RARITY } from '../shared/Constants.js';
import { DungeonGen } from '../shared/DungeonGen.js';
import { CombatMath } from '../shared/CombatMath.js';
import { PRNG, dist } from '../shared/MathUtils.js';

export class GameRoom {
  constructor(roomId, mode = GAME_MODES.CLASSIC, ngCycle = 0) {
    this.roomId = roomId;
    this.mode = mode;
    this.ngCycle = ngCycle;
    this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    this.rng = new PRNG(this.seed);
    this.dungeon = DungeonGen.generate(this.seed, 40, 30);

    this.players = new Map();
    this.monsters = new Map();
    this.projectiles = [];
    this.groundLoot = [];
    this.events = [];

    this.nextEntityId = 1;
    this.spawnInitialMonsters();
    this.tickInterval = setInterval(() => this.update(), ENGINE.TICK_INTERVAL_MS);
  }

  spawnInitialMonsters() {
    for (let i = 1; i < this.dungeon.rooms.length; i++) {
      const room = this.dungeon.rooms[i];
      const count = this.rng.range(2, 4);
      for (let j = 0; j < count; j++) {
        const mx = (room.x + 1 + (this.rng.next() % (room.w - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
        const my = (room.y + 1 + (this.rng.next() % (room.h - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
        const id = this.nextEntityId++;
        const baseStats = CombatMath.getMonsterScale(30, 8, this.ngCycle);
        this.monsters.set(id, {
          id,
          type: this.rng.next() % 2 === 0 ? 'crawler' : 'brute',
          x: mx,
          y: my,
          hp: baseStats.hp,
          maxHp: baseStats.hp,
          dmg: baseStats.dmg,
          speed: 0.6,
          attackCooldown: 0
        });
      }
    }
  }

  addPlayer(socket, name = 'Wanderer') {
    const id = socket.id;
    const sx = this.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const sy = this.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;

    const player = {
      id, name, socket,
      x: sx, y: sy, targetX: sx, targetY: sy,
      hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      potions: 3, speed: 1.4, isDead: false,
      primaryStat: 14, baseDmgMin: 6, baseDmgMax: 12,
      armor: 5, attackCooldown: 0
    };

    this.players.set(id, player);
    socket.send(JSON.stringify({
      type: PACKET_TYPES.ROOM_INIT,
      data: { roomId: this.roomId, mode: this.mode, seed: this.seed, ngCycle: this.ngCycle, playerId: id }
    }));
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.players.size === 0) clearInterval(this.tickInterval);
  }

  handlePlayerInput(playerId, packet) {
    const p = this.players.get(playerId);
    if (!p || p.isDead) return;

    if (packet.type === PACKET_TYPES.INPUT_MOVE) {
      p.targetX = packet.x;
      p.targetY = packet.y;
    } else if (packet.type === PACKET_TYPES.INPUT_ATTACK) {
      this.handlePlayerAttack(p, packet.targetMonsterId);
    } else if (packet.type === PACKET_TYPES.INPUT_SKILL) {
      this.handlePlayerSkill(p, packet.angle);
    } else if (packet.type === PACKET_TYPES.INPUT_POTION) {
      this.handlePlayerPotion(p);
    } else if (packet.type === PACKET_TYPES.PICKUP_LOOT) {
      this.handlePickupLoot(p, packet.lootId);
    }
  }

  handlePlayerAttack(p, monsterId) {
    if (p.attackCooldown > 0) return;
    const m = this.monsters.get(monsterId);
    if (!m) return;

    if (dist(p.x, p.y, m.x, m.y) <= 16) {
      const hit = CombatMath.calculateDamage({
        baseDmgMin: p.baseDmgMin, baseDmgMax: p.baseDmgMax,
        primaryStat: p.primaryStat, ngCycle: this.ngCycle,
        critChance: 0.15, targetArmor: 2, rng: this.rng
      });
      m.hp -= hit.damage;
      p.attackCooldown = 8;
      this.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, x: m.x, y: m.y, damage: hit.damage, isCrit: hit.isCrit });
      if (m.hp <= 0) this.killMonster(m);
    }
  }

  handlePlayerSkill(p, angle) {
    if (p.mp < 10) return;
    p.mp -= 10;
    this.projectiles.push({
      id: this.nextEntityId++, ownerId: p.id,
      x: p.x, y: p.y, vx: Math.cos(angle) * 3.5, vy: Math.sin(angle) * 3.5,
      life: 40, damage: 18
    });
  }

  handlePlayerPotion(p) {
    if (p.potions > 0 && p.hp < p.maxHp) {
      p.potions--;
      const heal = Math.min(p.maxHp - p.hp, 40);
      p.hp += heal;
      this.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: heal });
    }
  }

  handlePickupLoot(p, lootId) {
    const idx = this.groundLoot.findIndex(l => l.id === lootId);
    if (idx !== -1) {
      const item = this.groundLoot[idx];
      if (dist(p.x, p.y, item.x, item.y) < 18) {
        this.groundLoot.splice(idx, 1);
        if (item.type === 'potion') p.potions++;
      }
    }
  }

  killMonster(m) {
    this.monsters.delete(m.id);
    const dropPotion = this.rng.next() % 3 === 0;
    this.groundLoot.push({
      id: this.nextEntityId++,
      type: dropPotion ? 'potion' : 'gear',
      name: dropPotion ? 'Health Potion' : 'Reinforced Spikeglove',
      rarity: dropPotion ? RARITY.MAGIC : RARITY.RARE,
      x: m.x, y: m.y
    });
  }

  update() {
    for (const p of this.players.values()) {
      if (p.isDead) continue;
      const d = dist(p.x, p.y, p.targetX, p.targetY);
      if (d > 2) {
        const nx = p.x + ((p.targetX - p.x) / d) * p.speed;
        const ny = p.y + ((p.targetY - p.y) / d) * p.speed;
        const tc = Math.floor(nx / ENGINE.TILE_SIZE);
        const tr = Math.floor(ny / ENGINE.TILE_SIZE);
        if (this.dungeon.map[tr] && this.dungeon.map[tr][tc] !== TILES.WALL) {
          p.x = nx;
          p.y = ny;
        }
      }
      if (p.attackCooldown > 0) p.attackCooldown--;
      if (p.mp < p.maxMp) p.mp = Math.min(p.maxMp, p.mp + 0.1);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.life--;
      for (const m of this.monsters.values()) {
        if (dist(proj.x, proj.y, m.x, m.y) < 10) {
          m.hp -= proj.damage;
          this.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, x: m.x, y: m.y, damage: proj.damage, isCrit: true });
          if (m.hp <= 0) this.killMonster(m);
          proj.life = 0;
          break;
        }
      }
      if (proj.life <= 0) this.projectiles.splice(i, 1);
    }

    for (const m of this.monsters.values()) {
      let closestP = null;
      let closestDist = 90;
      for (const p of this.players.values()) {
        if (p.isDead) continue;
        const d = dist(m.x, m.y, p.x, p.y);
        if (d < closestDist) { closestDist = d; closestP = p; }
      }
      if (closestP) {
        if (closestDist > 10) {
          m.x += ((closestP.x - m.x) / closestDist) * m.speed;
          m.y += ((closestP.y - m.y) / closestDist) * m.speed;
        } else if (m.attackCooldown <= 0) {
          const hit = CombatMath.calculateDamage({
            baseDmgMin: m.dmg - 2, baseDmgMax: m.dmg + 2,
            primaryStat: 10, targetArmor: closestP.armor, rng: this.rng
          });
          closestP.hp = Math.max(0, closestP.hp - hit.damage);
          m.attackCooldown = 18;
          this.events.push({ type: 'DAMAGE', targetType: 'player', id: closestP.id, x: closestP.x, y: closestP.y, damage: hit.damage, isCrit: false });
          if (closestP.hp <= 0) this.handlePlayerDeath(closestP);
        }
      }
      if (m.attackCooldown > 0) m.attackCooldown--;
    }

    this.broadcastSnapshot();
    this.events = [];
  }

  handlePlayerDeath(player) {
    player.isDead = true;
    this.events.push({
      type: 'PLAYER_DEATH', id: player.id, name: player.name,
      hardcore: this.mode === GAME_MODES.HARDCORE
    });
  }

  broadcastSnapshot() {
    if (this.players.size === 0) return;
    const payload = JSON.stringify({
      type: PACKET_TYPES.WORLD_SNAPSHOT,
      data: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id, name: p.name, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
          hp: p.hp, maxHp: p.maxHp, mp: Math.floor(p.mp), maxMp: p.maxMp, potions: p.potions, isDead: p.isDead
        })),
        monsters: Array.from(this.monsters.values()).map(m => ({
          id: m.id, type: m.type, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, hp: m.hp, maxHp: m.maxHp
        })),
        projectiles: this.projectiles.map(p => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
        loot: this.groundLoot,
        events: this.events
      }
    });
    for (const p of this.players.values()) {
      if (p.socket.readyState === 1) p.socket.send(payload);
    }
  }
}
