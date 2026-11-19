import { GAME_MODES, PACKET_TYPES } from '../shared/Constants.js';
import { DungeonGen } from '../shared/DungeonGen.js';
import { Interpolator } from './systems/Interpolator.js';
import { Renderer } from './systems/Renderer.js';
import { HUDController } from './systems/HUDController.js';
import { InputController } from './systems/InputController.js';
import { MenuController } from './systems/MenuController.js';
import { AudioPSG } from './systems/AudioPSG.js';
import { SpriteRegistry } from './systems/SpriteRegistry.js';

let ws = null;
let myPlayerId = null;
let dungeon = null;
let activeRoomMode = GAME_MODES.CLASSIC;
let latestSnapshot = null;
let myPrivateState = null;
let lastInterp = { players: [], monsters: [], projectiles: [], loot: [] };
let lastFrameTime = performance.now();

const interpolator = new Interpolator();
const sprites = new SpriteRegistry();
const renderer = new Renderer({ sprites });
const audio = new AudioPSG();
audio.loadManifest('/data/sfx.json');
sprites.load('/data/sprites.json').then((ok) => {
  if (ok && dungeon) renderer.bakeDungeonBuffer(dungeon);
});

function sendPacket(payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

const hud = new HUDController({
  sendPacket,
  onExitToMenu: exitToMainMenu
});

const input = new InputController({
  renderer,
  hud,
  audio,
  sendPacket,
  getState: () => ({ latestSnapshot, lastInterp, myPlayerId })
});

const menus = new MenuController({
  onConnect: connect,
  getCurrentInviteCode: () => hud.currentInviteCode
});

function syncHUD() {
  const myP = latestSnapshot?.players.find(p => p.id === myPlayerId);
  hud.update({ myP, priv: myPrivateState, activeRoomMode });
}

function exitToMainMenu() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  myPlayerId = null;
  dungeon = null;
  latestSnapshot = null;
  myPrivateState = null;
  interpolator.reset();
  renderer.reset();
  input.reset();
  hud.reset();
  document.getElementById('badge-net').textContent = 'Disconnected';
  document.getElementById('badge-net').className = 'text-slate-400 font-mono text-[10px]';
  menus.showMainMenu();
}

function connect(playerName, roomName, mode, playerClass, characterId, joinType = 'public', password = '', inviteCode = '') {
  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.onclose = () => connect(playerName, roomName, mode, playerClass, characterId, joinType, password, inviteCode);
    oldWs.close();
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host || 'localhost:8080'}`);

  ws.onopen = () => {
    document.getElementById('badge-net').textContent = joinType === 'solo' ? 'Connected (Private)' : 'Connected (Host)';
    document.getElementById('badge-net').className = 'text-emerald-400 font-mono text-[10px]';
    document.getElementById('badge-mode').textContent = `${mode} Mode`;
    sendPacket({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        playerName,
        roomName,
        mode,
        playerClass,
        characterId,
        joinType,
        password,
        inviteCode,
        token: menus.getAuthToken()
      }
    });
  };

  ws.onmessage = (msg) => {
    const packet = JSON.parse(msg.data);
    if (packet.type === PACKET_TYPES.LOBBY_ERROR) {
      menus.showLobbyError(packet.data?.message, mode);
      return;
    }
    if (packet.type === PACKET_TYPES.ROOM_INIT) {
      menus.clearPendingInvite();
      myPlayerId = packet.data.playerId;
      activeRoomMode = packet.data.mode || mode;
      dungeon = DungeonGen.generate(packet.data.seed, 40, 30);
      renderer.reset();
      renderer.bakeDungeonBuffer(dungeon);
      renderer.snapCameraToSpawn(dungeon);
      interpolator.reset();
      latestSnapshot = null;
      hud.reset();
      hud.setInviteCode(packet.data.inviteCode || '');
      if (packet.data.floor) {
        hud.setFloorStatus(packet.data.floor);
      }
    } else if (packet.type === PACKET_TYPES.WORLD_SNAPSHOT) {
      const snap = packet.data;
      latestSnapshot = snap;
      interpolator.pushSnapshot(snap);
      processEvents(snap.events);
      syncHUD();
    } else if (packet.type === PACKET_TYPES.PLAYER_STATE_SYNC) {
      myPrivateState = packet.data;
      syncHUD();
    }
  };

  ws.onclose = () => {
    document.getElementById('badge-net').textContent = 'Disconnected';
    document.getElementById('badge-net').className = 'text-rose-400 font-mono text-[10px]';
  };
}

function getStereoPan(worldX) {
  if (typeof worldX !== 'number') return 0;
  const centerX = renderer.camera.x + 120;
  return Math.max(-0.85, Math.min(0.85, (worldX - centerX) / 140));
}

function processEvents(events) {
  if (!events) return;
  for (const ev of events) {
    if (ev.type === 'DAMAGE') {
      renderer.addFloatingText(ev.isCrit ? `${ev.damage}! CRIT` : `${ev.damage}`, ev.x, ev.y, ev.isCrit ? '#FACC15' : '#FFFFFF', ev.isCrit);
      const pan = getStereoPan(ev.x);
      if (ev.attackerId) renderer.triggerEntityAnim(ev.attackerId, 'attack', 0.28);
      if (ev.id) renderer.triggerEntityAnim(ev.id, 'hurt', 0.2);
      if (ev.targetType === 'player' && ev.id === myPlayerId) {
        audio.play('player_hurt', { pan: 0, pitchJitter: 0.06 });
      } else {
        audio.play(ev.isCrit ? 'crit' : 'hit', { pan, pitchJitter: 0.06 });
      }
    } else if (ev.type === 'HEAL') {
      renderer.addFloatingText(`+${ev.amount} HP`, ev.x, ev.y, '#34D399');
      audio.play('potion', { pan: getStereoPan(ev.x), pitchJitter: 0.03 });
    } else if (ev.type === 'LEVEL_UP') {
      renderer.addFloatingText(`LEVEL ${ev.level}!`, ev.x, ev.y - 6, '#FACC15', true);
      audio.play('level_up', { pitchJitter: 0 });
    } else if (ev.type === 'OVERBURDENED' && ev.id === myPlayerId) {
      renderer.addFloatingText('Too Heavy!', ev.x, ev.y - 6, '#F87171', false);
      audio.play('overburdened', { pitchJitter: 0 });
    } else if (ev.type === 'PLAYER_DEATH') {
      if (ev.hardcore) renderer.addFloatingText(`${ev.name} HAS FALLEN!`, ev.x || 120, ev.y || 72, '#EF4444', true);
      if (ev.id === myPlayerId || ev.hardcore) audio.play('player_death', { pitchJitter: 0 });
    } else if (ev.type === 'PLAYER_RESPAWN') {
      renderer.addFloatingText('RESPAWNED', ev.x, ev.y - 6, '#38BDF8', true);
    } else if (ev.type === 'FLOOR_DESCENT') {
      hud.setFloorStatus(ev.floor);
      audio.play('floor_descent', { pitchJitter: 0 });
    }
  }
}

function render(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  const interp = interpolator.getInterpolatedEntities(dt);
  lastInterp = interp;

  input.updateHoldMove(now);
  const { hoveredLoot, hoveredMob } = input.getHoverTargets(interp);

  renderer.drawFrame({
    dt,
    dungeon,
    interp,
    myPlayerId,
    hoveredLoot,
    hoveredMob,
    lockedMonsterId: input.lockedMonsterId
  });

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
