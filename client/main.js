/**
 * SANCTUM ARPG - SC-32 Fantasy Console Native Client
 * 
 * Runs inside QuickJS-NG on the SC-32 Virtual Hardware Platform.
 * Interacts with Plane 1 (240x144 World VRAM), Plane 3 (720x432 UI Canvas),
 * InputManager, and Lanthorn APU via "sanctum:engine".
 */

import { core, graphics, input, audio, storage, network } from 'sanctum:engine';
import { ENGINE, TILES, PALETTE_INDEX, PACKET_TYPES } from '../shared/Constants.js';
import { DungeonGen } from '../shared/DungeonGen.js';
import { Interpolator } from './systems/Interpolator.js';

// --- State & Hydration Pipeline ---
// The client holds no hardcoded game state.
// All state is hydrated from either:
// 1. Authoritative Server over WebSocket (Online mode)
// 2. SC-32 Persistent NVRAM Storage (Offline / standalone mode)
let dungeon = null;
let dungeonMapBuffer = null; // 480x360 unlit palette indices
const MAP_W = 40;
const MAP_H = 30;
const MAP_PX_W = MAP_W * 12; // 480
const MAP_PX_H = MAP_H * 12; // 360

let camera = { x: 0, y: 0 };
let player = null;
const TS = ENGINE.TILE_SIZE;
const DARK_PAL = [0, 0, 1, 1, 5, 1, 5, 6, 2, 4, 9, 3, 1, 5, 2, 13];

// Replicated world state (fed by WORLD_SNAPSHOT through the shared web Interpolator)
const interp = new Interpolator();
let lastEnts = { players: [], monsters: [], projectiles: [], loot: [] };
let heroList = [];
let spriteBank = {};
const entityAnim = new Map();
let animTime = 0;
let lastRenderMs = 0;
let floatTexts = [];
let clickMarker = null;
let holdMode = null;
let lockedMonsterId = null;
let lmbDown = false;
let hoveredLoot = null;
let hoveredMob = null;
let playerPrivate = null;
let currentFloor = 1;
let prevButtons = 0;
let camIntX = 0;
let camIntY = 0;
let activeRoomId = null;
let myPlayerId = null;
let sessionToken = null;

export let gameData = {
  classes: null,
  items: null,
  monsters: null,
  sprites: null,
  loadedCount: 0,
};
globalThis.gameData = gameData;

let lastTick = 0;
let uiDirty = true;
let animTimer = 0;
let playerAnimFrame = 0;

// Network State
let netStatus = 'OFFLINE (NVRAM)';
let netPingMs = 67;
let lastPingTime = 0;
let netConnected = false;

// Bayer 4x4 Dither Matrix for subpixel lighting attenuation
const BAYER_4X4 = [
  0.0,    0.5,    0.125,  0.625,
  0.75,   0.25,   0.875,  0.375,
  0.1875, 0.6875, 0.0625, 0.5625,
  0.9375, 0.4375, 0.8125, 0.3125
];

// Decoded Sprite Cache
let floorTileVariants = [];
let wallFrontTile = null;
let wallTopTile = null;
let heroSpriteFrames = [];

function parseHexGrid(rows, w = 12, h = 12) {
  const arr = new Uint8Array(w * h);
  arr.fill(255);
  if (!rows) return arr;
  for (let y = 0; y < h && y < rows.length; y++) {
    const r = rows[y];
    for (let x = 0; x < w && x < r.length; x++) {
      const ch = r[x];
      if (ch !== '.' && ch !== ' ') {
        arr[y * w + x] = parseInt(ch, 16);
      }
    }
  }
  return arr;
}

function loadGameData() {
  gameData.loadedCount = 0;

  // 1. Load Classes
  try {
    const rawCls = storage.readFile('data/classes.json') || storage.read('data/classes.json');
    if (rawCls) {
      gameData.classes = JSON.parse(rawCls);
      gameData.loadedCount++;
    }
  } catch (e) {}

  // 2. Load Items
  try {
    const rawItems = storage.readFile('data/items.json') || storage.read('data/items.json');
    if (rawItems) {
      gameData.items = JSON.parse(rawItems);
      gameData.loadedCount++;
    }
  } catch (e) {}

  // 3. Load Monsters
  try {
    const rawMon = storage.readFile('data/monsters.json') || storage.read('data/monsters.json');
    if (rawMon) {
      gameData.monsters = JSON.parse(rawMon);
      gameData.loadedCount++;
    }
  } catch (e) {}

  // 4. Load Sprites
  try {
    const rawSpr = storage.readFile('data/sprites.json') || storage.read('data/sprites.json');
    if (rawSpr) {
      gameData.sprites = JSON.parse(rawSpr);
      gameData.loadedCount++;

      // Decode floor stone variants
      const floorData = gameData.sprites.tiles?.['crypt/floor_stone'];
      if (floorData?.variants) {
        floorTileVariants = floorData.variants.map(v => parseHexGrid(v));
      }

      // Decode wall tiles
      const wallFrontData = gameData.sprites.tiles?.['crypt/wall_front'];
      if (wallFrontData?.variants) {
        wallFrontTile = parseHexGrid(wallFrontData.variants[0]);
      }
      const wallTopData = gameData.sprites.tiles?.['crypt/wall_top'];
      if (wallTopData?.frames) {
        wallTopTile = parseHexGrid(wallTopData.frames[0]);
      }

      // Decode hero vanguard frames
      const heroData = gameData.sprites.entities?.['common/hero_vanguard'];
      if (heroData?.states?.idle?.frames) {
        heroSpriteFrames = heroData.states.idle.frames.map(f => parseHexGrid(f));
      }
    }
  } catch (e) {}

  // Fallback procedural tiles if sprites.json not present
  if (floorTileVariants.length === 0) {
    const fb = new Uint8Array(144);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const isBorder = (x === 0 || y === 0 || x === 6 || y === 6);
        fb[y * 12 + x] = isBorder ? 1 : 13;
      }
    }
    floorTileVariants = [fb];
  }

  if (!wallFrontTile) {
    const wb = new Uint8Array(144);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const isMortar = (x === 0 || y === 0 || y === 6);
        wb[y * 12 + x] = isMortar ? 0 : (y < 4 ? 6 : 5);
      }
    }
    wallFrontTile = wb;
  }

  if (!wallTopTile) {
    const wt = new Uint8Array(144);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const isMortar = (x === 0 || y === 0);
        wt[y * 12 + x] = isMortar ? 0 : 6;
      }
    }
    wallTopTile = wt;
  }

  if (heroSpriteFrames.length === 0) {
    const hb = new Uint8Array(144);
    hb.fill(255);
    for (let y = 2; y < 10; y++) {
      for (let x = 3; x < 9; x++) {
        hb[y * 12 + x] = (y < 5) ? 7 : (y < 8 ? 6 : 1);
      }
    }
    heroSpriteFrames = [hb];
  }
}

function bakeDungeonWorld() {
  dungeonMapBuffer = new Uint8Array(MAP_PX_W * MAP_PX_H);

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const tile = dungeon.map[ty][tx];
      const startX = tx * 12;
      const startY = ty * 12;

      let srcTile = null;
      if (tile === TILES.FLOOR) {
        const varIdx = (tx * 31 + ty * 17) % floorTileVariants.length;
        srcTile = floorTileVariants[varIdx];
      } else {
        const tileBelow = ty < MAP_H - 1 ? dungeon.map[ty + 1][tx] : TILES.WALL;
        if (tileBelow === TILES.FLOOR) {
          srcTile = wallFrontTile;
        } else {
          srcTile = wallTopTile;
        }
      }

      for (let py = 0; py < 12; py++) {
        const row = (startY + py) * MAP_PX_W;
        const srcRow = py * 12;
        for (let px = 0; px < 12; px++) {
          dungeonMapBuffer[row + startX + px] = srcTile[srcRow + px];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Offline persistence (SC-32 NVRAM)
// ---------------------------------------------------------------------------
function loadOfflineCharacter() {
  try {
    const raw = storage.readFile('data/saves/character_save.json')
      || storage.read('character_save.json')
      || storage.read('save_slot_0.json');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.name || parsed.id) && typeof parsed.x === 'number') {
        return parsed;
      }
    }
  } catch (e) {}

  // Initial persistent template when NVRAM has no existing character record
  const template = {
    id: 'char_sc32_offline',
    name: 'Edwigeon',
    className: 'VANGUARD',
    classTitle: 'IRONCLAD STRIKER',
    classId: 'vanguard',
    mode: 'CLASSIC',
    level: 3,
    hp: 245,
    maxHp: 245,
    mp: 199,
    maxMp: 199,
    gold: 150,
    potions: 22,
    manaPotions: 14,
    stats: { might: 16, agility: 10, vitality: 16, focus: 8 },
    x: 126,
    y: 78,
    dungeonSeed: 1337,
    floor: 1
  };
  saveOfflineCharacter(template);
  return template;
}

function saveOfflineCharacter(charState) {
  if (!charState) return;
  try {
    const payload = JSON.stringify(charState);
    storage.write('character_save.json', payload);
    storage.write('save_slot_0.json', payload);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Entity sprite bank (decoded from data/sprites.json)
// ---------------------------------------------------------------------------
function decodeEntitySprite(def) {
  const w = def.w || 12;
  const h = def.h || 12;
  const scale = def.renderScale || 1;
  const spr = {
    w, h, scale,
    dw: Math.max(1, Math.round(w * scale)),
    dh: Math.max(1, Math.round(h * scale)),
    ax: Math.round((def.anchorX !== undefined ? def.anchorX : w / 2) * scale),
    ay: Math.round((def.anchorY !== undefined ? def.anchorY : h) * scale),
    states: {}
  };
  const states = def.states || { idle: { fps: def.fps || 4, frames: def.frames || [] } };
  for (const name of Object.keys(states)) {
    const st = states[name];
    spr.states[name] = {
      fps: st.fps || 4,
      pingPong: !!st.pingPong,
      frames: (st.frames || []).map(f => parseHexGrid(f, w, h))
    };
  }
  if (!spr.states.idle) {
    const first = Object.keys(spr.states)[0];
    if (first) spr.states.idle = spr.states[first];
  }
  return spr;
}

function buildSpriteBank() {
  spriteBank = {};
  const ents = gameData.sprites && gameData.sprites.entities;
  if (!ents) return;
  for (const key of Object.keys(ents)) {
    const short = key.indexOf('/') >= 0 ? key.slice(key.indexOf('/') + 1) : key;
    try {
      spriteBank[short] = decodeEntitySprite(ents[key]);
    } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Entity animation (port of Renderer.resolveEntityAnim)
// ---------------------------------------------------------------------------
function triggerEntityAnim(id, state, durationSec) {
  if (id === undefined || id === null) return;
  let rec = entityAnim.get(id);
  if (!rec) {
    rec = { x: null, y: null, facingLeft: false, moveHold: 0, actionState: null, actionTimer: 0 };
    entityAnim.set(id, rec);
  }
  rec.actionState = state;
  rec.actionTimer = durationSec || 0.28;
}

function resolveEntityAnim(id, rx, ry, dt, spr, isDead) {
  let rec = entityAnim.get(id);
  if (!rec) {
    rec = { x: rx, y: ry, facingLeft: false, moveHold: 0, actionState: null, actionTimer: 0 };
    entityAnim.set(id, rec);
  }
  if (rec.x !== null && rec.y !== null) {
    const dx = rx - rec.x;
    const dy = ry - rec.y;
    if (Math.sqrt(dx * dx + dy * dy) > 0.08) {
      rec.moveHold = 0.14;
      if (dx < -0.05) rec.facingLeft = true;
      else if (dx > 0.05) rec.facingLeft = false;
    } else if (rec.moveHold > 0) {
      rec.moveHold = Math.max(0, rec.moveHold - dt);
    }
  }
  rec.x = rx;
  rec.y = ry;

  if (rec.actionTimer > 0) {
    rec.actionTimer = Math.max(0, rec.actionTimer - dt);
    if (rec.actionTimer === 0) rec.actionState = null;
  }

  let state = 'idle';
  if (isDead) state = 'death';
  else if (rec.actionState) state = rec.actionState;
  else if (rec.moveHold > 0) state = 'move';

  const stObj = spr.states[state] || spr.states.idle;
  const fps = (stObj && stObj.fps) || 4;
  const count = (stObj && stObj.frames.length) || 1;
  let frameIdx = 0;
  if (count > 1) {
    if (stObj.pingPong && count > 2) {
      const span = count * 2 - 2;
      const step = Math.floor(animTime * fps) % span;
      frameIdx = step < count ? step : span - step;
    } else {
      frameIdx = Math.floor(animTime * fps) % count;
    }
  }
  return { state: stObj === spr.states[state] ? state : 'idle', frameIdx, flipX: rec.facingLeft };
}

// ---------------------------------------------------------------------------
// Server event processing (floating text, animation triggers, SFX)
// ---------------------------------------------------------------------------
const COL_WHITE = [255, 255, 255, 255];
const COL_YELLOW = [250, 204, 21, 255];
const COL_GREEN = [52, 211, 153, 255];
const COL_BLUE = [56, 189, 248, 255];
const COL_RED = [248, 113, 113, 255];
const COL_CRIMSON = [239, 68, 68, 255];

function addFloatingText(text, x, y, color, isCrit) {
  floatTexts.push({ text, x, y, vy: -24, alpha: 1.0, color, isCrit: !!isCrit });
  if (floatTexts.length > 64) floatTexts.shift();
}

function processEvents(events) {
  if (!events) return;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'DAMAGE') {
      addFloatingText(ev.isCrit ? `${ev.damage}! CRIT` : `${ev.damage}`, ev.x, ev.y, ev.isCrit ? COL_YELLOW : COL_WHITE, ev.isCrit);
      if (ev.attackerId) triggerEntityAnim(ev.attackerId, 'attack', 0.28);
      if (ev.id) triggerEntityAnim(ev.id, 'hurt', 0.2);
      if (ev.targetType === 'player' && ev.id === myPlayerId) audio.playSfx('player_hurt');
      else audio.playSfx(ev.isCrit ? 'crit' : 'hit');
    } else if (ev.type === 'HEAL') {
      addFloatingText(ev.isMana ? `+${ev.amount} MP` : `+${ev.amount} HP`, ev.x, ev.y, ev.isMana ? COL_BLUE : COL_GREEN, false);
      audio.playSfx('potion');
    } else if (ev.type === 'GOLD_PICKUP') {
      addFloatingText(`+${ev.amount} Gold`, ev.x, ev.y - 6, COL_YELLOW, false);
    } else if (ev.type === 'LEVEL_UP') {
      addFloatingText(`LEVEL ${ev.level}!`, ev.x, ev.y - 6, COL_YELLOW, true);
      audio.playSfx('level_up');
    } else if (ev.type === 'OVERBURDENED' && ev.id === myPlayerId) {
      addFloatingText('Too Heavy!', ev.x, ev.y - 6, COL_RED, false);
      audio.playSfx('overburdened');
    } else if (ev.type === 'PLAYER_DEATH') {
      if (ev.hardcore) addFloatingText(`${ev.name} HAS FALLEN!`, ev.x || 120, ev.y || 72, COL_CRIMSON, true);
      if (ev.id === myPlayerId || ev.hardcore) audio.playSfx('player_death');
    } else if (ev.type === 'PLAYER_RESPAWN') {
      addFloatingText('RESPAWNED', ev.x, ev.y - 6, COL_BLUE, true);
    } else if (ev.type === 'FLOOR_DESCENT') {
      currentFloor = ev.floor || currentFloor;
      audio.playSfx('floor_descent');
    }
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
function startDungeon(seed) {
  dungeon = DungeonGen.generate(seed, MAP_W, MAP_H);
  bakeDungeonWorld();
  entityAnim.clear();
  floatTexts.length = 0;
  interp.reset();
  lastEnts = { players: [], monsters: [], projectiles: [], loot: [] };
}

function spawnOfflinePlayer() {
  let sx = 10;
  let sy = 6;
  if (dungeon.spawnPoint) {
    sx = dungeon.spawnPoint.x;
    sy = dungeon.spawnPoint.y;
  } else if (dungeon.rooms && dungeon.rooms.length > 0) {
    sx = dungeon.rooms[0].cx;
    sy = dungeon.rooms[0].cy;
  }
  player.x = sx * TS + TS / 2;
  player.y = sy * TS + TS / 2;
  player.tx = player.x;
  player.ty = player.y;
}

export function init() {
  loadGameData();
  buildSpriteBank();

  // 1. Hydrate state from local persistent NVRAM / database
  player = loadOfflineCharacter();
  currentFloor = player.floor || 1;

  // 2. Generate initial world buffer from character progress
  startDungeon(player.dungeonSeed || 1337);
  spawnOfflinePlayer();
  camera.x = Math.max(0, Math.min(MAP_PX_W - 240, player.x - 120));
  camera.y = Math.max(0, Math.min(MAP_PX_H - 144, player.y - 58));
  lastRenderMs = Date.now();

  // 3. Connect to authoritative network (if available)
  try {
    netConnected = network.connect('127.0.0.1', 0);
    if (netConnected) {
      netStatus = 'AUTHENTICATING...';
      lastPingTime = Date.now();
      network.send(JSON.stringify({
        type: PACKET_TYPES.AUTH_LOGIN,
        data: { localConsole: true }
      }));
    } else {
      netStatus = 'OFFLINE (NVRAM)';
    }
  } catch (err) {
    netStatus = 'OFFLINE (NVRAM)';
  }
}

// ---------------------------------------------------------------------------
// Light model (shared by world shading, entity visibility and hit-testing)
// ---------------------------------------------------------------------------
const TORCH_RADIUS = 64;
let torchX = 0;
let torchY = 0;

function lightIntensityAt(wx, wy) {
  const dx = wx - torchX;
  const dy = wy - torchY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= TORCH_RADIUS) return 0;
  return (1.0 - d / TORCH_RADIUS) * 8.0;
}

function isWorldPointVisible(wx, wy) {
  return lightIntensityAt(wx, wy) > 1.0;
}

// ---------------------------------------------------------------------------
// Local player view (online: interpolated server entity, offline: NVRAM)
// ---------------------------------------------------------------------------
function getMe() {
  const e = lastEnts.players.find(p => p.id === myPlayerId);
  if (e && activeRoomId) {
    return {
      x: e.rx, y: e.ry, hp: e.hp, maxHp: e.maxHp, mp: e.mp, maxMp: e.maxMp,
      isDead: !!e.isDead, name: e.name || player.name, classId: e.classId || player.classId, id: e.id
    };
  }
  return {
    x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp,
    isDead: false, name: player.name, classId: player.classId, id: 'offline'
  };
}

function isOnline() {
  return netConnected && !!activeRoomId;
}

function sendPacket(obj) {
  if (!netConnected) return false;
  try {
    return network.send(JSON.stringify(obj));
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Simulation tick (15 Hz)
// ---------------------------------------------------------------------------
function handlePacket(packet) {
  const t = packet.type;
  if (t === 'PONG') {
    netPingMs = Math.max(1, Math.round(Date.now() - packet.t));
    if (activeRoomId) netStatus = `ONLINE (${netPingMs}ms)`;
  } else if (t === 'AUTH_SUCCESS') {
    sessionToken = packet.data && packet.data.token;
    netStatus = `AUTH OK (${(packet.data && packet.data.username) || 'CONSOLE'})`;
    const chars = packet.data && packet.data.characters;
    if (chars && chars.length > 0) {
      const dbChar = chars[0];
      player.id = dbChar.id;
      player.name = dbChar.name;
      player.className = (dbChar.classId || 'VANGUARD').toUpperCase();
      player.classTitle = `${player.className} HERO`;
      player.classId = (dbChar.classId || 'vanguard').toLowerCase();
      player.mode = dbChar.mode || 'CLASSIC';
      player.level = dbChar.level || 1;
      player.gold = dbChar.gold || 0;
      player.potions = dbChar.potions || 0;
      if (dbChar.stats) player.stats = dbChar.stats;
      player.floor = dbChar.highestFloor || 1;
      saveOfflineCharacter(player);
    }
    sendPacket({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: sessionToken, characterId: player.id, roomName: 'Cathedral Depths', joinType: 'solo' }
    });
  } else if (t === 'LOBBY_ERROR') {
    netStatus = 'OFFLINE (NVRAM)';
    netConnected = false;
    activeRoomId = null;
  } else if (t === 'ROOM_INIT') {
    const d = packet.data;
    if (d && d.seed) {
      myPlayerId = d.playerId;
      activeRoomId = d.roomId;
      currentFloor = d.floor || 1;
      startDungeon(d.seed);
      netStatus = `ONLINE (${netPingMs}ms)`;
      holdMode = null;
      lockedMonsterId = null;
      lmbDown = false;
    }
  } else if (t === 'WORLD_SNAPSHOT') {
    const snap = packet.data;
    if (snap) {
      interp.pushSnapshot(snap);
      processEvents(snap.events);
      const me = snap.players && snap.players.find(p => p.id === myPlayerId);
      if (me) {
        player.x = me.x;
        player.y = me.y;
        player.hp = me.hp;
        player.maxHp = me.maxHp;
        player.mp = me.mp;
        player.maxMp = me.maxMp;
      }
    }
  } else if (t === 'PLAYER_STATE_SYNC') {
    const s = packet.data;
    if (s) {
      playerPrivate = s;
      if (s.gold !== undefined) player.gold = s.gold;
      if (s.level !== undefined) player.level = s.level;
      if (s.potions !== undefined) player.potions = s.potions;
      if (s.manaPotions !== undefined) player.manaPotions = s.manaPotions;
      if (s.stats) player.stats = s.stats;
      player.inventory = s.inventory;
      player.equipment = s.equipment;
      saveOfflineCharacter(player);
    }
  }
}

function findLootAt(wx, wy) {
  const list = lastEnts.loot || [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (Math.abs(l.x - wx) <= 5 && Math.abs(l.y - wy) <= 5 && isWorldPointVisible(l.x, l.y)) return l;
  }
  return null;
}

function findMonsterAt(wx, wy) {
  const list = lastEnts.monsters || [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (Math.abs(m.rx - wx) <= 5 && Math.abs(m.ry - wy) <= 6 && isWorldPointVisible(m.rx, m.ry)) return m;
  }
  return null;
}

// Action belt / flask hit-testing in Plane 3 (720x432) coordinates
function hudHitTest(sx, sy) {
  if (sy >= 268 && sy <= 400) {
    if (sx >= 20 && sx <= 116) return 'hp';
    if (sx >= 604 && sx <= 700) return 'mp';
  }
  if (sy >= 362 && sy <= 406 && sx >= 196 && sx <= 524) {
    const rel = sx - 196;
    const slots = [8, 58, 108, 172, 222, 272];
    for (let i = 0; i < slots.length; i++) {
      if (rel >= slots[i] && rel <= slots[i] + 44) {
        return ['potion', 'strike', 'spark', 'char', 'inv', 'menu'][i];
      }
    }
    return 'belt';
  }
  if (sy >= 356 && sy <= 416 && sx >= 196 && sx <= 524) return 'belt';
  return null;
}

function usePotion(sub) {
  if (isOnline()) {
    sendPacket({ type: PACKET_TYPES.INPUT_POTION, subType: sub });
    return;
  }
  if (sub === 'hp' && player.potions > 0) {
    player.potions--;
    player.hp = Math.min(player.maxHp, player.hp + 50);
    addFloatingText('+50 HP', player.x, player.y, COL_GREEN, false);
    audio.playSfx('potion');
    saveOfflineCharacter(player);
  } else if (sub === 'mp' && (player.manaPotions || 0) > 0) {
    player.manaPotions--;
    player.mp = Math.min(player.maxMp, player.mp + 40);
    addFloatingText('+40 MP', player.x, player.y, COL_BLUE, false);
    audio.playSfx('potion');
    saveOfflineCharacter(player);
  }
}

function onLeftPress(sx, sy, me) {
  const hit = hudHitTest(sx, sy);
  if (hit) {
    if (hit === 'hp' || hit === 'potion') usePotion('hp');
    else if (hit === 'mp') usePotion('mp');
    return; // consumed by HUD (char / inv / menu panels arrive with the UI milestone)
  }
  if (me.isDead) {
    sendPacket({ type: PACKET_TYPES.INPUT_RESPAWN });
    return;
  }

  const wx = sx / 3 + camIntX;
  const wy = sy / 3 + camIntY;
  lmbDown = true;

  const loot = findLootAt(wx, wy);
  if (loot) {
    holdMode = null;
    lockedMonsterId = null;
    sendPacket({ type: PACKET_TYPES.PICKUP_LOOT, lootId: loot.id });
    return;
  }
  const mob = findMonsterAt(wx, wy);
  if (mob) {
    holdMode = 'attack';
    lockedMonsterId = mob.id;
    sendPacket({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: mob.id, hold: true });
    return;
  }

  holdMode = 'move';
  lockedMonsterId = null;
  clickMarker = { x: wx, y: wy, life: 0.25 };
  if (isOnline()) {
    sendPacket({ type: PACKET_TYPES.INPUT_MOVE, x: wx, y: wy });
  } else {
    player.tx = wx;
    player.ty = wy;
  }
}

function onRightPress(sx, sy, me) {
  if (hudHitTest(sx, sy) || me.isDead) return;
  const wx = sx / 3 + camIntX;
  const wy = sy / 3 + camIntY;
  if ((me.mp || 0) >= 10) audio.playSfx('spark');
  if (isOnline()) {
    sendPacket({ type: PACKET_TYPES.INPUT_SKILL, angle: Math.atan2(wy - me.y, wx - me.x) });
  }
}

function onLeftRelease() {
  if (!lmbDown) return;
  lmbDown = false;
  if (holdMode === 'attack' && lockedMonsterId !== null) {
    sendPacket({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: lockedMonsterId, hold: false });
  }
  holdMode = null;
  lockedMonsterId = null;
}

function isWalkableOffline(wx, wy) {
  const tx = Math.floor(wx / TS);
  const ty = Math.floor(wy / TS);
  return !!(dungeon.map[ty] && dungeon.map[ty][tx] === TILES.FLOOR);
}

function stepOfflineMovement(tick) {
  const dist = Math.sqrt((player.tx - player.x) * (player.tx - player.x) + (player.ty - player.y) * (player.ty - player.y));
  if (dist <= 2) return;
  const step = Math.min(3, dist);
  const dx = ((player.tx - player.x) / dist) * step;
  const dy = ((player.ty - player.y) / dist) * step;
  if (isWalkableOffline(player.x + dx, player.y + dy)) {
    player.x += dx;
    player.y += dy;
  } else if (isWalkableOffline(player.x + dx, player.y)) {
    player.x += dx;
  } else if (isWalkableOffline(player.x, player.y + dy)) {
    player.y += dy;
  }
  if (tick % 3 === 0) audio.playSfx('step_stone');
  if (tick % 30 === 0) saveOfflineCharacter(player);
}

export function _tick(dt, tick) {
  if (!dungeon || !player) {
    init();
  }
  lastTick = tick;

  // Poll incoming server network packets
  if (netConnected) {
    let msg;
    while ((msg = network.poll()) !== null) {
      try {
        handlePacket(JSON.parse(msg));
      } catch (e) {}
    }
    if (tick % 15 === 0) {
      lastPingTime = Date.now();
      sendPacket({ type: 'PING', t: lastPingTime });
    }
    if (network.status() === 'closed' || network.status() === 'error') {
      netConnected = false;
      activeRoomId = null;
      netStatus = 'OFFLINE (NVRAM)';
    }
  }

  const me = getMe();
  const ptr = input.getPointer();
  const buttons = input.getButtons(0);

  // Mouse-first ARPG controls (identical to the web client)
  if (ptr.leftClicked) onLeftPress(ptr.clickX, ptr.clickY, me);
  if (ptr.rightClicked) onRightPress(ptr.clickX, ptr.clickY, me);
  if (lmbDown && holdMode === 'move' && ptr.left) {
    const wx = ptr.screenX / 3 + camIntX;
    const wy = ptr.screenY / 3 + camIntY;
    if (isOnline()) {
      sendPacket({ type: PACKET_TYPES.INPUT_MOVE, x: wx, y: wy });
    } else {
      player.tx = wx;
      player.ty = wy;
    }
  }
  if (ptr.leftReleased || (lmbDown && !ptr.left)) onLeftRelease();

  // Belt hotkeys: 1 = health potion, 2 = mana potion (edge-detected)
  if ((buttons & 0x0040) && !(prevButtons & 0x0040)) usePotion('hp');
  if ((buttons & 0x0080) && !(prevButtons & 0x0080)) usePotion('mp');
  prevButtons = buttons;

  // D-pad / WASD nudge (console controller convenience)
  let dx = 0;
  let dy = 0;
  if (buttons & 0x0001) dy -= 1;
  if (buttons & 0x0002) dy += 1;
  if (buttons & 0x0004) dx -= 1;
  if (buttons & 0x0008) dx += 1;
  if ((dx !== 0 || dy !== 0) && !me.isDead) {
    const tx = me.x + dx * 24;
    const ty = me.y + dy * 24;
    if (isOnline()) {
      sendPacket({ type: PACKET_TYPES.INPUT_MOVE, x: tx, y: ty });
    } else {
      player.tx = tx;
      player.ty = ty;
    }
  }

  if (!isOnline()) stepOfflineMovement(tick);

  // Hover targets for next frame's brackets / tooltips
  const hwx = ptr.screenX / 3 + camIntX;
  const hwy = ptr.screenY / 3 + camIntY;
  hoveredLoot = hudHitTest(ptr.screenX, ptr.screenY) ? null : findLootAt(hwx, hwy);
  hoveredMob = (!hoveredLoot && holdMode !== 'move' && !hudHitTest(ptr.screenX, ptr.screenY)) ? findMonsterAt(hwx, hwy) : null;

  globalThis.__sc32 = { online: isOnline(), snaps: interp.snapshotBuffer.length, floor: currentFloor, players: 0, monsters: 0 };
}

// ---------------------------------------------------------------------------
// Presentation (60 FPS)
// ---------------------------------------------------------------------------
export function _render(alpha) {
  if (!dungeon || !dungeonMapBuffer || !player) return;

  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastRenderMs) / 1000));
  lastRenderMs = now;
  animTime += dt;

  lastEnts = interp.getInterpolatedEntities(dt);
  const me = getMe();

  // Camera tracks the local player exactly like the web renderer
  camera.x = Math.max(0, Math.min(MAP_PX_W - 240, me.x - 120));
  camera.y = Math.max(0, Math.min(MAP_PX_H - 144, me.y - 58));
  camIntX = Math.floor(camera.x);
  camIntY = Math.floor(camera.y);
  torchX = me.x;
  torchY = me.y;

  renderWorldPlane(me, dt);
  renderInterfacePlane(me, dt);

  if (globalThis.__sc32) {
    globalThis.__sc32.players = lastEnts.players.length;
    globalThis.__sc32.monsters = lastEnts.monsters.length;
  }
}

function fillBuf(buf, x0, y0, w, h, pal) {
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= 144) continue;
    const row = y * 240;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= 240) continue;
      buf[row + x] = pal;
    }
  }
}

function stampSprite(buf, spr, anim, wx, wy, intensity) {
  const st = spr.states[anim.state] || spr.states.idle;
  if (!st || st.frames.length === 0) return;
  const frame = st.frames[anim.frameIdx % st.frames.length];
  const dark = intensity < 4;
  const left = Math.round(wx - camIntX) - (anim.flipX ? spr.dw - spr.ax : spr.ax);
  const top = Math.round(wy - camIntY) - spr.ay;
  const inv = 1 / spr.scale;
  for (let py = 0; py < spr.dh; py++) {
    const dstY = top + py;
    if (dstY < 0 || dstY >= 144) continue;
    const srcY = Math.min(spr.h - 1, Math.floor(py * inv));
    const row = dstY * 240;
    for (let px = 0; px < spr.dw; px++) {
      const dstX = left + px;
      if (dstX < 0 || dstX >= 240) continue;
      const sxp = anim.flipX ? spr.dw - 1 - px : px;
      const srcX = Math.min(spr.w - 1, Math.floor(sxp * inv));
      const pal = frame[srcY * spr.w + srcX];
      if (pal !== 255) buf[row + dstX] = dark ? DARK_PAL[pal] : pal;
    }
  }
}

function drawShadow(buf, wx, wy) {
  const sx = Math.round(wx - camIntX);
  const sy = Math.round(wy - camIntY);
  fillBuf(buf, sx - 4, sy + 1, 8, 3, 40);
}

function renderWorldPlane(me, dt) {
  const buf = graphics.worldBuffer;
  if (!buf) return;

  const radiusSq = TORCH_RADIUS * TORCH_RADIUS;

  // 1. Evaluate 2D radial torchlight with world-locked Bayer 4x4 dither
  for (let y = 0; y < 144; y++) {
    const wy = camIntY + y;
    const ddy = wy - torchY;
    const dySq = ddy * ddy;
    const dstRow = y * 240;
    const srcRow = wy * MAP_PX_W;

    for (let x = 0; x < 240; x++) {
      const wx = camIntX + x;
      const ddx = wx - torchX;
      const distSq = ddx * ddx + dySq;

      if (distSq >= radiusSq) {
        buf[dstRow + x] = 40; // Void Black outside torch radius
        continue;
      }

      const basePal = dungeonMapBuffer[srcRow + wx];
      const dist = Math.sqrt(distSq);
      const intensity = (1.0 - dist / TORCH_RADIUS) * 8.0;
      const dither = BAYER_4X4[((wy & 3) << 2) + (wx & 3)];
      const band = (intensity + dither) | 0;

      if (band <= 1) {
        buf[dstRow + x] = 40;
      } else if (band < 4) {
        buf[dstRow + x] = (basePal === 13 || basePal === 6) ? 1 : (basePal === 5 ? 40 : basePal);
      } else {
        buf[dstRow + x] = basePal;
      }
    }
  }

  // 2. Ground loot (4x4 orange coin with 2x2 yellow core)
  const loot = lastEnts.loot || [];
  for (let i = 0; i < loot.length; i++) {
    const l = loot[i];
    const inten = lightIntensityAt(l.x, l.y);
    if (inten <= 1) continue;
    const sx = Math.round(l.x - camIntX);
    const sy = Math.round(l.y - camIntY);
    const dark = inten < 4;
    fillBuf(buf, sx - 2, sy - 2, 4, 4, dark ? DARK_PAL[9] : 9);
    fillBuf(buf, sx - 1, sy - 1, 2, 2, dark ? DARK_PAL[10] : 10);
  }

  // 3. Monsters
  const mobs = lastEnts.monsters || [];
  const defaultMob = spriteBank.monster_crawler;
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i];
    const inten = lightIntensityAt(m.rx, m.ry);
    if (inten <= 1) continue;
    const spr = (m.type && spriteBank['monster_' + m.type]) || defaultMob;
    if (spr) {
      const anim = resolveEntityAnim(m.id, m.rx, m.ry, dt, spr, false);
      stampSprite(buf, spr, anim, m.rx, m.ry, inten);
    } else {
      const sx = Math.round(m.rx - camIntX);
      const sy = Math.round(m.ry - camIntY);
      fillBuf(buf, sx - 3, sy - 4, 6, 8, 8);
      fillBuf(buf, sx - 2, sy - 3, 4, 2, 14);
    }
  }

  // 4. Projectiles (emissive)
  const projs = lastEnts.projectiles || [];
  for (let i = 0; i < projs.length; i++) {
    const pr = projs[i];
    const sx = Math.round(pr.rx - camIntX);
    const sy = Math.round(pr.ry - camIntY);
    fillBuf(buf, sx - 1, sy - 1, 3, 3, 12);
    fillBuf(buf, sx, sy, 1, 1, 7);
  }

  // 5. Players (local hero + remote party members)
  const heroes = [];
  const onlineMe = lastEnts.players.length > 0 && activeRoomId;
  if (onlineMe) {
    for (let i = 0; i < lastEnts.players.length; i++) {
      const p = lastEnts.players[i];
      heroes.push({
        id: p.id, x: p.rx, y: p.ry, classId: p.classId, isDead: !!p.isDead,
        isMe: p.id === myPlayerId
      });
    }
  } else {
    heroes.push({ id: 'offline', x: player.x, y: player.y, classId: player.classId, isDead: false, isMe: true });
  }
  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    const spr = spriteBank['hero_' + String(h.classId || 'vanguard').toLowerCase()] || spriteBank.hero_vanguard;
    const inten = h.isMe ? 8 : lightIntensityAt(h.x, h.y);
    if (!h.isMe && !h.isDead && inten <= 1) continue;
    if (!h.isDead) drawShadow(buf, h.x, h.y);
    if (spr) {
      const anim = resolveEntityAnim(h.id, h.x, h.y, dt, spr, h.isDead);
      stampSprite(buf, spr, anim, h.x, h.y, h.isDead ? Math.min(inten, 3) : inten);
    } else {
      const sx = Math.round(h.x - camIntX);
      const sy = Math.round(h.y - camIntY);
      fillBuf(buf, sx - 3, sy - 6, 6, 11, h.isMe ? 12 : 14);
    }
  }
  heroList = heroes;
}

function strokeRectPx(wx, wy, ox, oy, w, h, color) {
  const sx = Math.round((wx - camIntX) * 3 + ox * 3);
  const sy = Math.round((wy - camIntY) * 3 + oy * 3);
  graphics.strokeRect(sx, sy, w * 3, h * 3, color, 1);
}

function drawTextCentered(text, cx, y, scale, color) {
  const w = text.length * 8 * scale;
  const x = Math.round(cx - w / 2);
  graphics.drawText(text, x + 1, y + 1, scale, [0, 0, 0, 230]);
  graphics.drawText(text, x, y, scale, color);
}

const RARITY_COL = [[255, 255, 255, 255], [96, 165, 250, 255], [250, 204, 21, 255], [251, 146, 60, 255]];

function renderInterfacePlane(me, dt) {
  graphics.clearPlane(3);

  const gold = [255, 236, 39, 255];
  const border = [120, 65, 47, 255]; // Bronze
  const cyan = [103, 232, 249, 255];
  const pink = [244, 114, 182, 255];

  // 1. Bronze Presentation Frame enclosing viewport
  graphics.strokeRect(16, 12, 688, 408, border, 1);

  // 2. World-anchored overlays ------------------------------------------------
  if (clickMarker) {
    strokeRectPx(clickMarker.x, clickMarker.y, -2, -2, 4, 4, [0, 228, 54, 255]);
    clickMarker.life -= dt;
    if (clickMarker.life <= 0) clickMarker = null;
  }

  const loot = lastEnts.loot || [];
  for (let i = 0; i < loot.length; i++) {
    const l = loot[i];
    if (hoveredLoot && hoveredLoot.id === l.id) {
      strokeRectPx(l.x, l.y, -3, -3, 6, 6, gold);
    }
  }

  const mobs = lastEnts.monsters || [];
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i];
    const inten = lightIntensityAt(m.rx, m.ry);
    if (inten <= 1) continue;
    if ((hoveredMob && hoveredMob.id === m.id) || lockedMonsterId === m.id) {
      strokeRectPx(m.rx, m.ry, -4, -5, 8, 10, gold);
    }
    if (inten >= 2 || m.hp < m.maxHp) {
      const sx = Math.round((m.rx - camIntX) * 3);
      const sy = Math.round((m.ry - camIntY) * 3);
      const ratio = Math.max(0, Math.min(1, m.hp / m.maxHp));
      graphics.fillRect(sx - 12, sy - 21, 24, 6, [0, 0, 0, 255]);
      if (ratio > 0) graphics.fillRect(sx - 12, sy - 21, Math.max(1, Math.round(24 * ratio)), 6, [255, 0, 77, 255]);
    }
  }

  for (let i = 0; i < heroList.length; i++) {
    const h = heroList[i];
    if (h.isDead) continue;
    const sx = Math.round((h.x - camIntX) * 3);
    const sy = Math.round((h.y - camIntY) * 3);
    if (h.isMe) strokeRectPx(h.x, h.y, -4, 2, 8, 3, gold);
    let label = h.isMe ? me.name : null;
    if (!h.isMe) {
      const src = lastEnts.players.find(p => p.id === h.id);
      label = (src && src.name) || 'ALLY';
      if (lightIntensityAt(h.x, h.y) <= 1) continue;
    }
    drawTextCentered(String(label || 'YOU'), sx, sy - 38, 1, h.isMe ? cyan : pink);
  }

  // Floating combat text
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const ft = floatTexts[i];
    ft.y += ft.vy * dt;
    ft.alpha -= 1.2 * dt;
    if (ft.alpha <= 0) {
      floatTexts.splice(i, 1);
      continue;
    }
    const sx = Math.round((ft.x - camIntX) * 3);
    const sy = Math.round((ft.y - camIntY) * 3);
    const c = ft.color;
    drawTextCentered(ft.text, sx, sy, ft.isCrit ? 2 : 1, [c[0], c[1], c[2], Math.round(255 * Math.max(0, ft.alpha))]);
  }

  // Ground loot tooltip
  if (hoveredLoot) {
    const label = hoveredLoot.name || 'Item';
    const tw = label.length * 8;
    const cx = Math.round((hoveredLoot.x - camIntX) * 3);
    const cy = Math.round((hoveredLoot.y - camIntY) * 3) - 34;
    const rc = RARITY_COL[hoveredLoot.rarity] || RARITY_COL[0];
    graphics.drawPanel(cx - tw / 2 - 8, cy - 6, tw + 16, 22, rc, [15, 23, 42, 240]);
    graphics.drawText(label, Math.round(cx - tw / 2), cy, 1, rc);
  }

  // 3. Level banner + link status
  graphics.drawText('Floor ' + currentFloor + ' - Sanctum Depths', 26, 20, 1, [85, 172, 111, 255]);
  graphics.drawText(netStatus, 700 - netStatus.length * 8, 20, 1, [148, 163, 184, 255]);

  if (me.isDead) {
    drawTextCentered('YOU HAVE FALLEN', 360, 150, 3, COL_CRIMSON);
    drawTextCentered('CLICK TO RESPAWN', 360, 190, 1, COL_WHITE);
  }

  // 4/5. Diablo-style flasks, 6. Action belt
  drawHealthFlask(20, 268, Math.floor(me.hp || 0), Math.max(1, Math.floor(me.maxHp || 1)));
  drawManaFlask(604, 268, Math.floor(me.mp || 0), Math.max(1, Math.floor(me.maxMp || 1)));
  drawActionBelt(196, 356);
}

function drawHealthFlask(x, y, current, max) {
  const border = [120, 65, 47, 255];
  const cork = [171, 82, 54, 255];
  const redFluid = [222, 53, 60, 255];
  const darkFluid = [60, 12, 18, 255];
  const white = [248, 249, 250, 255];

  // Cork Stopper
  graphics.fillRect(x + 36, y + 2, 24, 10, cork);
  // Rolled Brass Collar
  graphics.fillRect(x + 28, y + 12, 40, 8, border);

  // Bulbous Glass Body
  graphics.fillRect(x + 12, y + 20, 72, 88, [12, 16, 24, 230]);
  graphics.strokeRect(x + 12, y + 20, 72, 88, border, 2);

  // Red Liquid Fill Level
  const ratio = Math.max(0, Math.min(1, current / max));
  const fillH = Math.round(84 * ratio);
  const fluidY = y + 22 + (84 - fillH);
  graphics.fillRect(x + 14, fluidY, 68, fillH, redFluid);
  graphics.fillRect(x + 14, y + 22, 68, 84 - fillH, darkFluid);

  // Curved glass specular highlight (left rim)
  graphics.fillRect(x + 16, y + 24, 4, 76, [255, 255, 255, 140]);

  // Heavy Iron Pedestal
  graphics.drawPanel(x + 4, y + 108, 88, 24, border, [24, 28, 36, 255]);

  // Numerical Value Overlay
  const hpStr = "" + current;
  const maxStr = "/" + max;
  graphics.drawText(hpStr, x + 24, y + 54, 2, white);
  graphics.drawText(maxStr, x + 30, y + 74, 1, [255, 180, 190, 255]);
}

function drawManaFlask(x, y, current, max) {
  const border = [120, 65, 47, 255];
  const cork = [171, 82, 54, 255];
  const blueFluid = [41, 173, 255, 255];
  const darkFluid = [10, 25, 45, 255];
  const white = [248, 249, 250, 255];

  // Cork Stopper
  graphics.fillRect(x + 36, y + 2, 24, 10, cork);
  // Rolled Brass Collar
  graphics.fillRect(x + 28, y + 12, 40, 8, border);

  // Bulbous Glass Body
  graphics.fillRect(x + 12, y + 20, 72, 88, [12, 16, 24, 230]);
  graphics.strokeRect(x + 12, y + 20, 72, 88, border, 2);

  // Blue Liquid Fill Level
  const ratio = Math.max(0, Math.min(1, current / max));
  const fillH = Math.round(84 * ratio);
  const fluidY = y + 22 + (84 - fillH);
  graphics.fillRect(x + 14, fluidY, 68, fillH, blueFluid);
  graphics.fillRect(x + 14, y + 22, 68, 84 - fillH, darkFluid);

  // Curved glass highlight
  graphics.fillRect(x + 16, y + 24, 4, 76, [255, 255, 255, 140]);

  // Heavy Iron Pedestal
  graphics.drawPanel(x + 4, y + 108, 88, 24, border, [24, 28, 36, 255]);

  // Numerical Value Overlay
  const mpStr = "" + current;
  const maxStr = "/" + max;
  graphics.drawText(mpStr, x + 24, y + 54, 2, white);
  graphics.drawText(maxStr, x + 30, y + 74, 1, [160, 220, 255, 255]);
}

function drawActionBelt(x, y) {
  const border = [120, 65, 47, 255];
  const gold = [255, 236, 39, 255];
  const white = [248, 249, 250, 255];
  const slate = [148, 163, 184, 255];
  const cerulean = [41, 173, 255, 255];

  // Dark hammered iron belt frame with 4 corner rivets
  graphics.drawPanel(x, y, 328, 56, border, [10, 12, 19, 250]);

  // Slot 1: Hotkey 1, Potion, count badge
  graphics.drawPanel(x + 8, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("1", x + 12, y + 10, 1, slate);
  graphics.drawSprite("potion_hp", x + 20, y + 16, 2);
  const potCount = player?.potions ?? 0;
  graphics.drawText("x" + potCount, x + 24, y + 38, 1, gold);

  // Slot 2: Hotkey LMB, Longsword Strike
  graphics.drawPanel(x + 58, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("LMB", x + 62, y + 10, 1, slate);
  graphics.drawSprite("longsword", x + 70, y + 16, 2);
  graphics.drawText("Strike", x + 62, y + 38, 1, white);

  // Slot 3: Hotkey RMB, Spark
  graphics.drawPanel(x + 108, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("RMB", x + 112, y + 10, 1, slate);
  graphics.drawSprite("might", x + 120, y + 16, 2);
  graphics.drawText("Spark", x + 112, y + 38, 1, cerulean);

  // Carved vertical groove separator
  graphics.fillRect(x + 162, y + 8, 2, 40, [40, 48, 64, 255]);

  // Slot 4: C (Char)
  graphics.drawPanel(x + 172, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("C", x + 176, y + 10, 1, slate);
  graphics.drawText("Char", x + 176, y + 26, 1, gold);

  // Slot 5: I (Inv)
  graphics.drawPanel(x + 222, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("I", x + 226, y + 10, 1, slate);
  graphics.drawText("Inv", x + 228, y + 26, 1, gold);

  // Slot 6: ESC (Menu)
  graphics.drawPanel(x + 272, y + 6, 44, 44, border, [6, 8, 14, 255]);
  graphics.drawText("ESC", x + 276, y + 10, 1, slate);
  graphics.drawText("Menu", x + 276, y + 26, 1, white);
}
