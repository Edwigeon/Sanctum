import crypto from 'crypto';
import { ENGINE, GAME_MODES, PACKET_TYPES, TILES, RARITY } from '../../shared/Constants.js';
import { DungeonGen } from '../../shared/DungeonGen.js';
import { CombatMath } from '../../shared/CombatMath.js';
import { PRNG, dist } from '../../shared/MathUtils.js';
import { dataRegistry } from './DataRegistry.js';
import { LootGenerator } from './LootGenerator.js';
import { saveManager } from './SaveManager.js';

export class GameRoom {
  constructor(roomId, mode = GAME_MODES.CLASSIC, ngCycle = 0, options = {}) {
    this.roomId = roomId;
    this.displayName = options.displayName || roomId;
    this.isPublic = options.isPublic !== false;
    this.maxPlayers = options.maxPlayers || 4;
    this.password = options.password || '';
    this.inviteCode = options.inviteCode || crypto.randomBytes(3).toString('hex').toUpperCase();
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
    this.tickInterval = setInterval(() => this.update(), ENGINE.TICK_INTERVAL_MS);
  }

  getSummary() {
    return {
      roomId: this.roomId,
      name: this.displayName,
      mode: this.mode,
      floor: this.floor,
      ngCycle: this.ngCycle,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      hasPassword: !!this.password
    };
  }

  isWalkable(x, y, radius = 3) {
    const minC = Math.floor((x - radius) / ENGINE.TILE_SIZE);
    const maxC = Math.floor((x + radius) / ENGINE.TILE_SIZE);
    const minR = Math.floor((y - radius) / ENGINE.TILE_SIZE);
    const maxR = Math.floor((y + radius) / ENGINE.TILE_SIZE);
    for (let r = minR; r <= maxR; r++) {
      if (!this.dungeon.map[r]) return false;
      for (let c = minC; c <= maxC; c++) {
        const t = this.dungeon.map[r][c];
        if (t === TILES.WALL || t === TILES.EMPTY) return false;
      }
    }
    return true;
  }

  spawnInitialMonsters() {
    const types = dataRegistry.getMonsterTypes();
    for (let i = 1; i < this.dungeon.rooms.length; i++) {
      const room = this.dungeon.rooms[i];
      const count = this.rng.range(2, 4);
      for (let j = 0; j < count; j++) {
        const mx = (room.x + 1 + (this.rng.next() % (room.w - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
        const my = (room.y + 1 + (this.rng.next() % (room.h - 2))) * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
        const id = this.nextEntityId++;
        const type = types[this.rng.next() % types.length] || 'crawler';
        const def = dataRegistry.getMonster(type);
        const baseHp = def.baseHp + (this.floor - 1) * 6;
        const baseDmg = def.baseDmg + (this.floor - 1) * 2;
        const baseStats = CombatMath.getMonsterScale(baseHp, baseDmg, this.ngCycle);
        this.monsters.set(id, {
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

  addPlayer(socket, name = 'Wanderer', classId = 'VANGUARD', savedChar = null) {
    const id = socket.id;
    const sx = this.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const sy = this.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const cls = dataRegistry.getClass(savedChar?.classId || classId);

    const player = {
      id,
      characterId: savedChar?.id || null,
      mode: savedChar?.mode || this.mode,
      name: savedChar?.name || name,
      socket,
      classId: cls.id,
      className: cls.name,
      level: savedChar?.level || 1,
      xp: savedChar?.xp || 0,
      nextXp: savedChar?.nextXp || 100,
      statPoints: savedChar?.statPoints || 0,
      gold: 0,
      stats: savedChar?.stats ? { ...savedChar.stats } : { ...cls.stats },
      equipment: savedChar?.equipment ? { ...savedChar.equipment } : { weapon: null, armor: null, gloves: null, ring: null },
      inventory: savedChar?.inventory ? [...savedChar.inventory] : [],
      x: sx, y: sy, targetX: sx, targetY: sy,
      targetMonsterId: null, targetLootId: null, holdAttack: false,
      hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      potions: savedChar?.potions ?? 3, speed: cls.baseSpeed, isDead: false,
      primaryStat: cls.stats.might, baseDmgMin: cls.baseDmgMin, baseDmgMax: cls.baseDmgMax,
      armor: cls.baseArmor, critChance: cls.baseCrit, spellDmg: 18,
      carryWeight: 0, maxWeight: 60, attackCooldown: 0,
      dirtyState: true
    };
    this.recalculateStats(player, true);

    this.players.set(id, player);
    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this.update(), ENGINE.TICK_INTERVAL_MS);
    }
    socket.send(JSON.stringify({
      type: PACKET_TYPES.ROOM_INIT,
      data: { roomId: this.roomId, mode: this.mode, seed: this.seed, ngCycle: this.ngCycle, floor: this.floor, playerId: id, inviteCode: this.inviteCode, maxPlayers: this.maxPlayers }
    }));
    this.broadcastSnapshot();
  }

  recalculateStats(p, fullRestore = false) {
    const cls = dataRegistry.getClass(p.classId);
    const eq = Object.values(p.equipment).filter(Boolean);
    const bonus = { might: 0, focus: 0, agility: 0, vitality: 0, dmg: 0, armor: 0, hp: 0, crit: 0 };
    let weightSum = 0;
    for (const item of eq) {
      weightSum += item.weight || 0;
      if (!item.stats) continue;
      for (const [k, v] of Object.entries(item.stats)) {
        if (bonus[k] !== undefined) bonus[k] += v;
      }
    }
    for (const item of p.inventory) {
      weightSum += item.weight || 0;
    }

    const totalMight = p.stats.might + bonus.might;
    const totalFocus = p.stats.focus + bonus.focus;
    const totalAgility = p.stats.agility + bonus.agility;
    const totalVitality = p.stats.vitality + bonus.vitality;

    p.maxHp = 50 + totalVitality * 5 + (p.level - 1) * 10 + bonus.hp;
    p.maxMp = 20 + totalFocus * 3 + (p.level - 1) * 5;
    p.baseDmgMin = cls.baseDmgMin + bonus.dmg;
    p.baseDmgMax = cls.baseDmgMax + bonus.dmg;
    p.primaryStat = p.classId === 'ARCANIST' ? totalFocus : (p.classId === 'SHADOW' ? totalAgility : totalMight);
    p.armor = cls.baseArmor + Math.floor(totalVitality * 0.25) + bonus.armor;
    p.critChance = Math.min(0.65, cls.baseCrit + totalAgility * 0.004 + bonus.crit);
    p.speed = Math.min(2.2, cls.baseSpeed + totalAgility * 0.01);
    p.spellDmg = Math.round(14 + totalFocus * 0.8 + bonus.dmg * 0.6);
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

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (p) saveManager.saveFromPlayer(p, this.floor);
    this.players.delete(playerId);
    if (this.players.size === 0) {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
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
      this.handlePlayerPotion(p);
    } else if (packet.type === PACKET_TYPES.PICKUP_LOOT) {
      if (!Number.isInteger(packet.lootId)) return;
      this.handlePickupLoot(p, packet.lootId);
    } else if (packet.type === PACKET_TYPES.ALLOC_STAT) {
      this.handleAllocStat(p, packet.stat);
    } else if (packet.type === PACKET_TYPES.EQUIP_ITEM) {
      if (!Number.isInteger(packet.itemId)) return;
      this.handleEquipItem(p, packet.itemId);
    } else if (packet.type === PACKET_TYPES.DROP_ITEM) {
      if (!Number.isInteger(packet.itemId)) return;
      this.handleDropItem(p, packet.itemId);
    }
  }

  handleAllocStat(p, stat) {
    if (p.statPoints <= 0) return;
    if (!['might', 'focus', 'agility', 'vitality'].includes(stat)) return;
    p.stats[stat]++;
    p.statPoints--;
    this.recalculateStats(p, false);
    p.dirtyState = true;
    saveManager.saveFromPlayer(p, this.floor);
  }

  handleEquipItem(p, itemId) {
    const idx = p.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    const item = p.inventory[idx];
    if (!item.slot || !(item.slot in p.equipment)) return;
    const prev = p.equipment[item.slot];
    p.equipment[item.slot] = item;
    p.inventory.splice(idx, 1);
    if (prev) p.inventory.push(prev);
    this.recalculateStats(p, false);
    p.dirtyState = true;
    saveManager.saveFromPlayer(p, this.floor);
  }

  handleDropItem(p, itemId) {
    const idx = p.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    const [item] = p.inventory.splice(idx, 1);
    this.groundLoot.push({ ...item, x: p.x, y: p.y });
    this.recalculateStats(p, false);
    p.dirtyState = true;
    saveManager.saveFromPlayer(p, this.floor);
  }

  handlePlayerAttack(p, monsterId) {
    if (p.attackCooldown > 0) return;
    const m = this.monsters.get(monsterId);
    if (!m) return;

    if (dist(p.x, p.y, m.x, m.y) <= 16) {
      const hit = CombatMath.calculateDamage({
        baseDmgMin: p.baseDmgMin, baseDmgMax: p.baseDmgMax,
        primaryStat: p.primaryStat, ngCycle: this.ngCycle,
        critChance: p.critChance || 0.15, targetArmor: 2, rng: this.rng
      });
      m.hp -= hit.damage;
      p.attackCooldown = 8;
      this.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, attackerId: p.id, x: m.x, y: m.y, damage: hit.damage, isCrit: hit.isCrit });
      if (m.hp <= 0) this.killMonster(m);
      return true;
    }
    return false;
  }

  handlePlayerSkill(p, angle) {
    if (p.mp < 10) return;
    p.mp -= 10;
    this.projectiles.push({
      id: this.nextEntityId++, ownerId: p.id,
      x: p.x, y: p.y, vx: Math.cos(angle) * 3.5, vy: Math.sin(angle) * 3.5,
      life: 40, damage: p.spellDmg || 18
    });
  }

  handlePlayerPotion(p) {
    if (p.potions > 0 && p.hp < p.maxHp) {
      p.potions--;
      const heal = Math.min(p.maxHp - p.hp, 40);
      p.hp += heal;
      p.dirtyState = true;
      this.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: heal });
    }
  }

  handlePickupLoot(p, lootId) {
    const idx = this.groundLoot.findIndex(l => l.id === lootId);
    if (idx === -1) return false;
    const item = this.groundLoot[idx];
    if (dist(p.x, p.y, item.x, item.y) < 18) {
      if (item.type === 'gear') {
        const w = item.weight || 1;
        if (p.carryWeight + w > p.maxWeight) {
          p.targetLootId = null;
          this.events.push({ type: 'OVERBURDENED', id: p.id, x: p.x, y: p.y });
          return false;
        }
      }
      this.groundLoot.splice(idx, 1);
      if (item.type === 'potion') {
        p.potions++;
      } else if (item.type === 'gear') {
        p.inventory.push(item);
        this.recalculateStats(p, false);
      }
      p.targetLootId = null;
      p.dirtyState = true;
      saveManager.saveFromPlayer(p, this.floor);
      return true;
    }
    // Walk to loot if out of range
    p.targetMonsterId = null;
    p.targetLootId = lootId;
    p.targetX = item.x;
    p.targetY = item.y;
    return false;
  }

  grantXp(amount) {
    for (const p of this.players.values()) {
      if (p.isDead) continue;
      p.xp += amount;
      p.dirtyState = true;
      let leveled = false;
      while (p.xp >= p.nextXp) {
        p.xp -= p.nextXp;
        p.level++;
        p.nextXp = Math.round(p.nextXp * 1.45);
        p.statPoints += 3;
        this.recalculateStats(p, true);
        this.events.push({ type: 'LEVEL_UP', id: p.id, level: p.level, x: p.x, y: p.y });
        leveled = true;
      }
      if (leveled) saveManager.saveFromPlayer(p, this.floor);
    }
  }

  generateGearDrop(x, y) {
    return LootGenerator.generateDrop({
      id: this.nextEntityId++,
      x,
      y,
      floor: this.floor,
      ngCycle: this.ngCycle,
      rng: this.rng
    });
  }

  killMonster(m) {
    this.monsters.delete(m.id);
    this.grantXp(m.xp || (25 + (this.floor - 1) * 10));
    const dropPotion = this.rng.next() % 3 === 0;
    if (dropPotion) {
      this.groundLoot.push({
        id: this.nextEntityId++,
        type: 'potion',
        name: 'Health Potion',
        rarity: RARITY.MAGIC,
        x: m.x, y: m.y
      });
    } else {
      this.groundLoot.push(this.generateGearDrop(m.x, m.y));
    }
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

        // Attempt full diagonal move, or slide along X or Y
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

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.life--;

      // Projectiles stop at walls
      if (!this.isWalkable(proj.x, proj.y, 1)) {
        proj.life = 0;
      }

      for (const m of this.monsters.values()) {
        if (dist(proj.x, proj.y, m.x, m.y) < 10) {
          m.hp -= proj.damage;
          this.events.push({ type: 'DAMAGE', targetType: 'monster', id: m.id, attackerId: proj.ownerId, x: m.x, y: m.y, damage: proj.damage, isCrit: true });
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
          const step = Math.min(m.speed, closestDist);
          const dx = ((closestP.x - m.x) / closestDist) * step;
          const dy = ((closestP.y - m.y) / closestDist) * step;

          // Monsters respect walls with sliding
          if (this.isWalkable(m.x + dx, m.y + dy, 3)) {
            m.x += dx;
            m.y += dy;
          } else if (this.isWalkable(m.x + dx, m.y, 3)) {
            m.x += dx;
          } else if (this.isWalkable(m.x, m.y + dy, 3)) {
            m.y += dy;
          }
        } else if (m.attackCooldown <= 0) {
          const hit = CombatMath.calculateDamage({
            baseDmgMin: m.dmg - 2, baseDmgMax: m.dmg + 2,
            primaryStat: 10, targetArmor: closestP.armor, rng: this.rng
          });
          closestP.hp = Math.max(0, closestP.hp - hit.damage);
          m.attackCooldown = 18;
          this.events.push({ type: 'DAMAGE', targetType: 'player', id: closestP.id, attackerId: m.id, x: closestP.x, y: closestP.y, damage: hit.damage, isCrit: false });
          if (closestP.hp <= 0) this.handlePlayerDeath(closestP);
        }
      }
      if (m.attackCooldown > 0) m.attackCooldown--;
    }

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
          data: { roomId: this.roomId, mode: this.mode, seed: this.seed, ngCycle: this.ngCycle, floor: this.floor, playerId: p.id, inviteCode: this.inviteCode, maxPlayers: this.maxPlayers }
        }));
      }
    }
    this.broadcastSnapshot();
    this.events.push({ type: 'FLOOR_DESCENT', floor: this.floor });
  }

  handlePlayerDeath(player) {
    player.isDead = true;
    player.targetMonsterId = null;
    player.targetLootId = null;
    player.holdAttack = false;
    saveManager.saveFromPlayer(player, this.floor);
    this.events.push({
      type: 'PLAYER_DEATH', id: player.id, name: player.name, x: player.x, y: player.y,
      hardcore: this.mode === GAME_MODES.HARDCORE
    });
  }

  handlePlayerRespawn(player) {
    if (!player.isDead || this.mode === GAME_MODES.HARDCORE) return;
    const sx = this.dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const sy = this.dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
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
    if (player.potions < 1) player.potions = 1;
    player.dirtyState = true;
    saveManager.saveFromPlayer(player, this.floor);
    this.events.push({ type: 'PLAYER_RESPAWN', id: player.id, x: sx, y: sy });
  }

  broadcastSnapshot() {
    if (this.players.size === 0) return;
    const payload = JSON.stringify({
      type: PACKET_TYPES.WORLD_SNAPSHOT,
      data: {
        tick: this.tick,
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          classId: p.classId,
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          hp: p.hp,
          maxHp: p.maxHp,
          mp: Math.floor(p.mp),
          maxMp: p.maxMp,
          isDead: p.isDead
        })),
        monsters: Array.from(this.monsters.values()).map(m => ({
          id: m.id, type: m.type, x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, hp: m.hp, maxHp: m.maxHp
        })),
        projectiles: this.projectiles.map(p => ({ id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
        loot: this.groundLoot,
        events: this.events
      }
    });
    for (const p of this.players.values()) {
      if (p.socket.readyState !== 1) continue;
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
}
