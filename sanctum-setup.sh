#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${1:-Sanctum}"
mkdir -p "$PROJECT_DIR"/{shared,server,client}
cd "$PROJECT_DIR"

cat << 'SANCTUM_EOF' > ".gitignore"
node_modules/
.DS_Store
*.log
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "package.json"
{
  "name": "project-sanctum-arpg",
  "version": "0.1.0-wip",
  "description": "Server-authoritative, microscopic dual-resolution ARPG engine",
  "type": "module",
  "main": "server/server.js",
  "scripts": {
    "start": "node server/server.js",
    "cluster": "node server/cluster.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "shared/Constants.js"
export const ENGINE = {
  TICK_RATE: 15,
  TICK_INTERVAL_MS: 1000 / 15,
  TILE_SIZE: 12,
  VIEW_TILES_X: 20,
  VIEW_TILES_Y: 12,
  INTERNAL_WIDTH: 240,
  INTERNAL_HEIGHT: 144,
  SUBPIXEL_SCALE: 100
};

export const GAME_MODES = {
  CLASSIC: 'CLASSIC',
  HARDCORE: 'HARDCORE'
};

export const TILES = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  STAIRS_DOWN: 4,
  PORTAL_TOWN: 5
};

export const RARITY = {
  NORMAL: 0,
  MAGIC: 1,
  RARE: 2,
  UNIQUE: 3
};

export const RARITY_COLORS = {
  [RARITY.NORMAL]: '#FFFFFF',
  [RARITY.MAGIC]: '#60A5FA',
  [RARITY.RARE]: '#FACC15',
  [RARITY.UNIQUE]: '#FB923C'
};

export const PACKET_TYPES = {
  JOIN_LOBBY: 'JOIN_LOBBY',
  INPUT_MOVE: 'INPUT_MOVE',
  INPUT_ATTACK: 'INPUT_ATTACK',
  INPUT_SKILL: 'INPUT_SKILL',
  INPUT_POTION: 'INPUT_POTION',
  PICKUP_LOOT: 'PICKUP_LOOT',
  LOBBY_STATE: 'LOBBY_STATE',
  ROOM_INIT: 'ROOM_INIT',
  WORLD_SNAPSHOT: 'WORLD_SNAPSHOT',
  COMBAT_EVENT: 'COMBAT_EVENT',
  PLAYER_DEATH: 'PLAYER_DEATH'
};
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "shared/MathUtils.js"
export class PRNG {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
  }

  next() {
    let t = (this.seed += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  nextFloat() {
    return (this.next() >>> 0) / 4294967296;
  }

  range(min, max) {
    const range = (max - min + 1) | 0;
    return (min + (this.next() % range)) | 0;
  }
}

export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "shared/DungeonGen.js"
import { TILES } from './Constants.js';
import { PRNG } from './MathUtils.js';

export class DungeonGen {
  static generate(seed, width = 40, height = 30) {
    const rng = new PRNG(seed);
    const map = Array.from({ length: height }, () => new Uint8Array(width).fill(TILES.WALL));
    const rooms = [];

    function carveRoom(rx, ry, rw, rh) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          if (y > 0 && y < height - 1 && x > 0 && x < width - 1) {
            map[y][x] = TILES.FLOOR;
          }
        }
      }
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: (rx + rw / 2) | 0, cy: (ry + rh / 2) | 0 });
    }

    function carveHCorridor(x1, x2, y) {
      const start = Math.min(x1, x2);
      const end = Math.max(x1, x2);
      for (let x = start; x <= end; x++) {
        if (y > 0 && y < height - 1) map[y][x] = TILES.FLOOR;
      }
    }

    function carveVCorridor(y1, y2, x) {
      const start = Math.min(y1, y2);
      const end = Math.max(y1, y2);
      for (let y = start; y <= end; y++) {
        if (x > 0 && x < width - 1) map[y][x] = TILES.FLOOR;
      }
    }

    const MAX_ROOMS = 8;
    for (let i = 0; i < 25; i++) {
      if (rooms.length >= MAX_ROOMS) break;
      const rw = rng.range(6, 11);
      const rh = rng.range(5, 8);
      const rx = rng.range(2, width - rw - 2);
      const ry = rng.range(2, height - rh - 2);

      let overlap = false;
      for (const r of rooms) {
        if (rx <= r.x + r.w + 1 && rx + rw + 1 >= r.x &&
            ry <= r.y + r.h + 1 && ry + rh + 1 >= r.y) {
          overlap = true;
          break;
        }
      }

      if (!overlap) {
        carveRoom(rx, ry, rw, rh);
      }
    }

    for (let i = 0; i < rooms.length - 1; i++) {
      const rA = rooms[i];
      const rB = rooms[i + 1];
      if (rng.next() % 2 === 0) {
        carveHCorridor(rA.cx, rB.cx, rA.cy);
        carveVCorridor(rA.cy, rB.cy, rB.cx);
      } else {
        carveVCorridor(rA.cy, rB.cy, rA.cx);
        carveHCorridor(rA.cx, rB.cx, rB.cy);
      }
    }

    const spawnPoint = { x: rooms[0].cx, y: rooms[0].cy };
    const exitPoint = { x: rooms[rooms.length - 1].cx, y: rooms[rooms.length - 1].cy };
    map[exitPoint.y][exitPoint.x] = TILES.STAIRS_DOWN;

    return { width, height, map, rooms, spawnPoint, exitPoint };
  }
}
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "shared/CombatMath.js"
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
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "server/GameRoom.js"
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
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "server/server.js"
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PACKET_TYPES, GAME_MODES } from '../shared/Constants.js';
import { GameRoom } from './GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '../client');
const SHARED_DIR = path.join(__dirname, '../shared');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = reqPath.startsWith('/shared/')
    ? path.join(SHARED_DIR, reqPath.replace('/shared/', ''))
    : path.join(CLIENT_DIR, reqPath);

  const ext = path.extname(filePath);
  const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextSocketId = 1;

function getOrCreateRoom(roomName, mode = GAME_MODES.CLASSIC) {
  const roomId = `${mode}_${roomName}`;
  if (!rooms.has(roomId)) {
    console.log(`[Lobby] Creating new ${mode} room: ${roomId}`);
    rooms.set(roomId, new GameRoom(roomId, mode));
  }
  return rooms.get(roomId);
}

wss.on('connection', (ws) => {
  ws.id = nextSocketId++;
  let currentRoom = null;
  console.log(`[Server] Client #${ws.id} connected`);

  ws.on('message', (message) => {
    try {
      const packet = JSON.parse(message);
      if (packet.type === PACKET_TYPES.JOIN_LOBBY) {
        const { roomName, mode, playerName } = packet.data;
        const targetMode = mode === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;
        currentRoom = getOrCreateRoom(roomName || 'sanctum_depths', targetMode);
        currentRoom.addPlayer(ws, playerName || `Player_${ws.id}`);
      } else if (currentRoom) {
        currentRoom.handlePlayerInput(ws.id, packet);
      }
    } catch (e) {
      console.error('[Server] Malformed packet:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client #${ws.id} disconnected`);
    if (currentRoom) currentRoom.removePlayer(ws.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n* PROJECT: SANCTUM running at http://localhost:${PORT} (15 Hz authoritative)`);
});
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "client/index.html"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PROJECT: SANCTUM (WIP Demake Engine)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { user-select: none; -webkit-user-select: none; }
    canvas.pixelated { image-rendering: pixelated; image-rendering: crisp-edges; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 p-2 font-sans antialiased overflow-hidden flex flex-col items-center">
  <div id="lobby-modal" class="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center">
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-md w-full shadow-2xl">
      <div class="flex items-center gap-2 mb-4">
        <span class="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
        <h1 class="font-bold text-lg text-slate-100 tracking-wider">PROJECT: SANCTUM</h1>
        <span class="text-[10px] font-mono bg-slate-800 text-indigo-300 px-2 py-0.5 rounded border border-indigo-900">v0.1.0-WIP</span>
      </div>
      <div class="space-y-4 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">Character Name</label>
          <input id="inp-name" type="text" value="Wanderer" class="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono">
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Game Mode</label>
          <div class="grid grid-cols-2 gap-2">
            <button id="btn-mode-classic" type="button" class="border border-indigo-500 bg-indigo-950/40 text-indigo-200 py-2 rounded text-center font-bold">
              Classic<span class="block text-[10px] font-normal text-slate-400">Normal Respawn</span>
            </button>
            <button id="btn-mode-hardcore" type="button" class="border border-slate-800 bg-slate-950/40 text-slate-400 py-2 rounded text-center font-bold hover:border-rose-900 transition">
              Hardcore<span class="block text-[10px] font-normal text-rose-400">Permadeath</span>
            </button>
          </div>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">Dungeon Room Code</label>
          <input id="inp-room" type="text" value="crypt_01" class="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono">
        </div>
        <button id="btn-enter" class="w-full bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold py-2.5 rounded shadow-lg transition">
          Enter Sanctum (Connect)
        </button>
      </div>
    </div>
  </div>

  <div class="w-full max-w-4xl flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 text-xs">
    <div class="flex items-center gap-3">
      <span class="font-bold tracking-wider text-slate-200">PROJECT: SANCTUM</span>
      <span id="badge-mode" class="bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded text-[10px] font-mono border border-indigo-700/50">Classic Mode</span>
      <span id="badge-net" class="text-slate-400 font-mono text-[10px]">Disconnected</span>
    </div>
    <div class="text-slate-400 font-mono text-[11px] flex gap-3">
      <span><strong class="text-amber-400">LMB:</strong> Move / Attack / Loot</span>
      <span><strong class="text-cyan-400">RMB:</strong> Cast Spell</span>
      <span><strong class="text-rose-400">1:</strong> Potion</span>
    </div>
  </div>

  <div id="game-stage" class="relative w-[720px] h-[432px] rounded-lg overflow-hidden border-2 border-slate-800 shadow-2xl bg-black cursor-crosshair">
    <canvas id="pixelCanvas" width="240" height="144" class="pixelated absolute inset-0 w-full h-full z-0"></canvas>
    <canvas id="highResCanvas" width="720" height="432" class="absolute inset-0 w-full h-full z-10 pointer-events-none"></canvas>
    <div class="absolute bottom-2 left-3 right-3 z-20 flex items-end justify-between pointer-events-auto">
      <div class="flex items-center gap-2 bg-slate-900/90 border border-red-900/60 rounded-full px-3 py-1 shadow-lg backdrop-blur-sm">
        <div class="w-7 h-7 rounded-full bg-gradient-to-t from-red-800 to-rose-500 border border-red-400/50 flex items-center justify-center shadow-inner">
          <span class="text-[10px] font-bold text-white drop-shadow">HP</span>
        </div>
        <div class="text-left font-mono">
          <div id="hud-hp" class="text-xs font-bold text-rose-300">100 / 100</div>
          <div class="text-[9px] text-slate-400 uppercase tracking-wider">Health</div>
        </div>
      </div>
      <div class="flex flex-col items-center gap-1">
        <div class="flex gap-1.5 bg-slate-900/90 border border-slate-700/60 p-1.5 rounded-lg shadow-lg backdrop-blur-sm">
          <button id="btn-pot" class="w-8 h-8 rounded bg-slate-800 border border-rose-700/60 flex flex-col items-center justify-center hover:bg-slate-700 transition">
            <span class="text-[9px] font-mono text-rose-400 font-bold">1</span>
            <span id="hud-pot" class="text-[10px] font-bold text-slate-200">x3</span>
          </button>
          <div class="w-8 h-8 rounded bg-slate-800 border border-amber-600/60 flex flex-col items-center justify-center">
            <span class="text-[8px] font-mono text-amber-300">LMB</span>
            <span class="text-[9px] text-slate-200 font-semibold">Strike</span>
          </div>
          <div class="w-8 h-8 rounded bg-slate-800 border border-cyan-600/60 flex flex-col items-center justify-center">
            <span class="text-[8px] font-mono text-cyan-300">RMB</span>
            <span class="text-[9px] text-slate-200 font-semibold">Spark</span>
          </div>
        </div>
        <div id="status-line" class="text-[10px] font-mono text-slate-300 bg-black/60 px-2 py-0.5 rounded">Connected to Authoritative 15 Hz Host.</div>
      </div>
      <div class="flex items-center gap-2 bg-slate-900/90 border border-blue-900/60 rounded-full px-3 py-1 shadow-lg backdrop-blur-sm">
        <div class="text-right font-mono">
          <div id="hud-mp" class="text-xs font-bold text-cyan-300">50 / 50</div>
          <div class="text-[9px] text-slate-400 uppercase tracking-wider">Mana</div>
        </div>
        <div class="w-7 h-7 rounded-full bg-gradient-to-t from-blue-800 to-cyan-400 border border-cyan-400/50 flex items-center justify-center shadow-inner">
          <span class="text-[10px] font-bold text-white drop-shadow">MP</span>
        </div>
      </div>
    </div>
  </div>
  <script type="module" src="app.js"></script>
</body>
</html>
SANCTUM_EOF

cat << 'SANCTUM_EOF' > "client/app.js"
import { ENGINE, GAME_MODES, PACKET_TYPES, TILES, RARITY_COLORS } from '../shared/Constants.js';
import { DungeonGen } from '../shared/DungeonGen.js';

const pCanvas = document.getElementById('pixelCanvas');
const pCtx = pCanvas.getContext('2d');
const hCanvas = document.getElementById('highResCanvas');
const hCtx = hCanvas.getContext('2d');
const stage = document.getElementById('game-stage');
const SCALE = 720 / ENGINE.INTERNAL_WIDTH;

const PAL = {
  0: '#000000', 1: '#1D2B53', 2: '#7E2553', 3: '#008751',
  4: '#AB5236', 5: '#5F574F', 6: '#C2C3C7', 7: '#FFF1E8',
  8: '#FF004D', 9: '#FFA300', 10: '#FFEC27', 11: '#00E436',
  12: '#29ADFF', 13: '#83769C', 14: '#FF77A8', 15: '#FFCCAA'
};

let ws = null, myPlayerId = null, dungeon = null, currentMode = GAME_MODES.CLASSIC;
let latestSnapshot = null, floatingTexts = [], mouse = { x: 0, y: 0 }, clickMarker = null;

const modal = document.getElementById('lobby-modal');
const btnClassic = document.getElementById('btn-mode-classic');
const btnHardcore = document.getElementById('btn-mode-hardcore');

btnClassic.addEventListener('click', () => {
  currentMode = GAME_MODES.CLASSIC;
  btnClassic.className = 'border border-indigo-500 bg-indigo-950/40 text-indigo-200 py-2 rounded text-center font-bold';
  btnHardcore.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-2 rounded text-center font-bold hover:border-rose-900 transition';
});

btnHardcore.addEventListener('click', () => {
  currentMode = GAME_MODES.HARDCORE;
  btnHardcore.className = 'border border-rose-600 bg-rose-950/40 text-rose-200 py-2 rounded text-center font-bold';
  btnClassic.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-2 rounded text-center font-bold hover:border-indigo-900 transition';
});

document.getElementById('btn-enter').addEventListener('click', () => {
  connect(document.getElementById('inp-name').value || 'Wanderer', document.getElementById('inp-room').value || 'crypt_01', currentMode);
  modal.classList.add('hidden');
});

function connect(playerName, roomName, mode) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host || 'localhost:8080'}`);
  ws.onopen = () => {
    document.getElementById('badge-net').textContent = 'Connected (Host)';
    document.getElementById('badge-net').className = 'text-emerald-400 font-mono text-[10px]';
    document.getElementById('badge-mode').textContent = `${mode} Mode`;
    ws.send(JSON.stringify({ type: PACKET_TYPES.JOIN_LOBBY, data: { playerName, roomName, mode } }));
  };
  ws.onmessage = (msg) => {
    const packet = JSON.parse(msg.data);
    if (packet.type === PACKET_TYPES.ROOM_INIT) {
      myPlayerId = packet.data.playerId;
      dungeon = DungeonGen.generate(packet.data.seed, 40, 30);
    } else if (packet.type === PACKET_TYPES.WORLD_SNAPSHOT) {
      latestSnapshot = packet.data;
      processEvents(packet.data.events);
      updateHUD();
    }
  };
  ws.onclose = () => {
    document.getElementById('badge-net').textContent = 'Disconnected';
    document.getElementById('badge-net').className = 'text-rose-400 font-mono text-[10px]';
  };
}

function processEvents(events) {
  if (!events) return;
  for (const ev of events) {
    if (ev.type === 'DAMAGE') addFloatingText(ev.isCrit ? `${ev.damage}! CRIT` : `${ev.damage}`, ev.x, ev.y, ev.isCrit ? '#FACC15' : '#FFFFFF', ev.isCrit);
    else if (ev.type === 'HEAL') addFloatingText(`+${ev.amount} HP`, ev.x, ev.y, '#34D399');
    else if (ev.type === 'PLAYER_DEATH' && ev.hardcore) addFloatingText(`${ev.name} HAS FALLEN!`, 120, 72, '#EF4444', true);
  }
}

function addFloatingText(text, x, y, color = '#FFFFFF', isCrit = false) {
  floatingTexts.push({ text, x: x * SCALE, y: y * SCALE, vy: -1.2, alpha: 1.0, color, isCrit });
}

stage.addEventListener('mousemove', (e) => {
  const rect = stage.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / SCALE;
  mouse.y = (e.clientY - rect.top) / SCALE;
});
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('mousedown', (e) => {
  if (!ws || ws.readyState !== 1 || !latestSnapshot) return;
  if (e.button === 2) {
    const myP = latestSnapshot.players.find(p => p.id === myPlayerId);
    if (myP) ws.send(JSON.stringify({ type: PACKET_TYPES.INPUT_SKILL, angle: Math.atan2(mouse.y - myP.y, mouse.x - myP.x) }));
    return;
  }
  const loot = latestSnapshot.loot.find(l => Math.hypot(l.x - mouse.x, l.y - mouse.y) < 12);
  if (loot) return ws.send(JSON.stringify({ type: PACKET_TYPES.PICKUP_LOOT, lootId: loot.id }));
  const mob = latestSnapshot.monsters.find(m => Math.hypot(m.x - mouse.x, m.y - mouse.y) < 10);
  if (mob) return ws.send(JSON.stringify({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: mob.id }));
  clickMarker = { x: mouse.x, y: mouse.y, life: 14 };
  ws.send(JSON.stringify({ type: PACKET_TYPES.INPUT_MOVE, x: mouse.x, y: mouse.y }));
});

window.addEventListener('keydown', (e) => { if (e.key === '1' && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: PACKET_TYPES.INPUT_POTION })); });
document.getElementById('btn-pot').addEventListener('click', () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: PACKET_TYPES.INPUT_POTION })); });

function updateHUD() {
  const myP = latestSnapshot?.players.find(p => p.id === myPlayerId);
  if (!myP) return;
  document.getElementById('hud-hp').textContent = `${myP.hp} / ${myP.maxHp}`;
  document.getElementById('hud-mp').textContent = `${myP.mp} / ${myP.maxMp}`;
  document.getElementById('hud-pot').textContent = `x${myP.potions}`;
  if (myP.isDead) {
    document.getElementById('status-line').textContent = currentMode === GAME_MODES.HARDCORE ? 'YOU HAVE FALLEN (Permadeath Ghost)' : 'You were slain!';
    document.getElementById('status-line').className = 'text-[10px] font-mono text-rose-400 bg-black/80 px-2 py-0.5 rounded';
  }
}

function render() {
  pCtx.fillStyle = PAL[0];
  pCtx.fillRect(0, 0, ENGINE.INTERNAL_WIDTH, ENGINE.INTERNAL_HEIGHT);
  if (dungeon) {
    for (let r = 0; r < dungeon.height; r++) {
      for (let c = 0; c < dungeon.width; c++) {
        const t = dungeon.map[r][c], tx = c * ENGINE.TILE_SIZE, ty = r * ENGINE.TILE_SIZE;
        if (t === TILES.WALL) {
          pCtx.fillStyle = PAL[5]; pCtx.fillRect(tx, ty, ENGINE.TILE_SIZE, ENGINE.TILE_SIZE);
          pCtx.fillStyle = PAL[13]; pCtx.fillRect(tx, ty, ENGINE.TILE_SIZE - 1, 2);
        } else if (t === TILES.STAIRS_DOWN) {
          pCtx.fillStyle = PAL[9]; pCtx.fillRect(tx + 2, ty + 2, ENGINE.TILE_SIZE - 4, ENGINE.TILE_SIZE - 4);
        } else {
          pCtx.fillStyle = PAL[1]; pCtx.fillRect(tx, ty, ENGINE.TILE_SIZE, ENGINE.TILE_SIZE);
        }
      }
    }
  }
  if (clickMarker) {
    pCtx.strokeStyle = PAL[11]; pCtx.strokeRect(clickMarker.x - 2, clickMarker.y - 2, 4, 4);
    if (--clickMarker.life <= 0) clickMarker = null;
  }
  if (latestSnapshot) {
    latestSnapshot.loot.forEach(l => { pCtx.fillStyle = PAL[9]; pCtx.fillRect(l.x - 2, l.y - 2, 4, 4); });
    latestSnapshot.monsters.forEach(m => {
      pCtx.fillStyle = PAL[8]; pCtx.fillRect(m.x - 3, m.y - 4, 6, 8);
      pCtx.fillStyle = PAL[0]; pCtx.fillRect(m.x - 4, m.y - 7, 8, 2);
      pCtx.fillStyle = PAL[8]; pCtx.fillRect(m.x - 4, m.y - 7, 8 * Math.max(0, m.hp / m.maxHp), 2);
    });
    latestSnapshot.projectiles.forEach(p => { pCtx.fillStyle = PAL[12]; pCtx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); });
    latestSnapshot.players.forEach(p => {
      pCtx.fillStyle = p.isDead ? PAL[5] : (p.id === myPlayerId ? PAL[12] : PAL[14]);
      pCtx.fillRect(p.x - 3, p.y - 4, 6, 8);
    });
  }

  hCtx.clearRect(0, 0, 720, 432);
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy; ft.alpha -= 0.025;
    if (ft.alpha <= 0) { floatingTexts.splice(i, 1); continue; }
    hCtx.save(); hCtx.globalAlpha = Math.max(0, ft.alpha);
    hCtx.font = ft.isCrit ? 'bold 15px monospace' : 'bold 12px monospace';
    hCtx.fillStyle = ft.color; hCtx.shadowColor = 'rgba(0,0,0,0.8)'; hCtx.shadowBlur = 4;
    hCtx.fillText(ft.text, ft.x - 10, ft.y); hCtx.restore();
  }
  const hoveredLoot = latestSnapshot?.loot.find(l => Math.hypot(l.x - mouse.x, l.y - mouse.y) < 12);
  if (hoveredLoot) {
    const hx = hoveredLoot.x * SCALE, hy = hoveredLoot.y * SCALE - 18;
    hCtx.font = '12px system-ui, sans-serif';
    const textW = hCtx.measureText(hoveredLoot.name).width;
    hCtx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    hCtx.strokeStyle = RARITY_COLORS[hoveredLoot.rarity] || '#94A3B8';
    hCtx.lineWidth = 1.5;
    hCtx.beginPath(); hCtx.roundRect(hx - textW / 2 - 8, hy - 14, textW + 16, 24, 4); hCtx.fill(); hCtx.stroke();
    hCtx.fillStyle = RARITY_COLORS[hoveredLoot.rarity] || '#FFFFFF';
    hCtx.fillText(hoveredLoot.name, hx - textW / 2, hy + 2);
  }
  requestAnimationFrame(render);
}
render();
SANCTUM_EOF

npm install
echo ""
echo "=== Starting Project: Sanctum on http://localhost:8080 ==="
npm start
