import { GAME_MODES, PACKET_TYPES } from '../shared/Constants.js';
import { DungeonGen } from '../shared/DungeonGen.js';
import { Interpolator } from './systems/Interpolator.js';
import { Renderer } from './systems/Renderer.js';
import { HUDController } from './systems/HUDController.js';
import { InputController } from './systems/InputController.js';
import { MenuController } from './systems/MenuController.js';
import { AudioPSG } from './systems/AudioPSG.js';
import { MusicPlayer } from './systems/MusicPlayer.js';
import { SpriteRegistry } from './systems/SpriteRegistry.js';
import { PerfOSD } from './systems/PerfOSD.js';

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionalExit = false;
let lastJoinParams = null;
let myPlayerId = null;
let dungeon = null;
let activeRoomMode = GAME_MODES.CLASSIC;
let latestSnapshot = null;
let myPrivateState = null;
let lastInterp = { players: [], monsters: [], projectiles: [], loot: [] };
let lastFrameTime = performance.now();
let lastCombatAt = 0;

const interpolator = new Interpolator();
const sprites = new SpriteRegistry();
const renderer = new Renderer({ sprites });
const audio = new AudioPSG();
const perfOSD = new PerfOSD();
window.__perfOSD = perfOSD;
audio.loadManifest('/data/sfx.json');
const music = new MusicPlayer({ audio });

// Music Pre-warm / Synthesizer Progress Feedback (especially critical on mobile like iPad A14)
const audioBanner = document.getElementById('audio-progress-banner');
const audioTitle = document.getElementById('audio-progress-title');
const audioText = document.getElementById('audio-progress-text');
const audioFill = document.getElementById('audio-progress-fill');
let audioHideTimer = null;

music.onProgress(({ suiteName, compiled, total, pct, done }) => {
  if (!audioBanner) return;
  if (audioHideTimer) {
    clearTimeout(audioHideTimer);
    audioHideTimer = null;
  }

  const name = suiteName ? suiteName.charAt(0).toUpperCase() + suiteName.slice(1) : 'Soundtrack';

  if (done) {
    audioBanner.classList.remove('hidden');
    audioBanner.style.opacity = '1';
    if (audioTitle) audioTitle.textContent = `${name} Ready`;
    if (audioText) audioText.textContent = '100%';
    if (audioFill) audioFill.style.width = '100%';
    audioHideTimer = setTimeout(() => {
      audioBanner.style.opacity = '0';
      audioHideTimer = setTimeout(() => {
        audioBanner.classList.add('hidden');
      }, 500);
    }, 1200);
  } else {
    audioBanner.classList.remove('hidden');
    audioBanner.style.opacity = '1';
    if (audioTitle) audioTitle.textContent = `Synthesizing ${name} (${compiled}/${total})...`;
    if (audioText) audioText.textContent = `${pct}%`;
    if (audioFill) audioFill.style.width = `${pct}%`;
  }
});

music.setBiome('cathedral', { immediate: false });

// Instant AudioContext Unlock on first user gesture (mouse, touch, keypress)
function unlockAudio() {
  const ctx = audio.ensureContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}
window.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
window.addEventListener('keydown', unlockAudio, { capture: true, once: true });
window.addEventListener('click', unlockAudio, { capture: true, once: true });
window.addEventListener('touchstart', unlockAudio, { capture: true, once: true });
sprites.load('/data/sprites.json').then((ok) => {
  if (ok && dungeon) renderer.bakeDungeonBuffer(dungeon);
});

function sendPacket(payload) {
  if (ws && ws.readyState === 1) {
    if (payload?.type === PACKET_TYPES.INPUT_SKILL) {
      perfOSD.log('CAST', `Spark sent (active proj=${lastInterp.projectiles?.length ?? 0})`);
    }
    const raw = JSON.stringify(payload);
    perfOSD.recordTxBytes(raw.length);
    ws.send(raw);
  }
}

const hud = new HUDController({
  renderer,
  audio,
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
  audio,
  onConnect: connect,
  getCurrentInviteToken: () => hud.currentInviteToken
});

function syncHUD() {
  const myP = latestSnapshot?.players.find(p => p.id === myPlayerId);
  hud.update({ myP, priv: myPrivateState, activeRoomMode });
}

function exitToMainMenu() {
  intentionalExit = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  lastJoinParams = null;
  sessionStorage.removeItem('sanctum_active_session');
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: PACKET_TYPES.LEAVE_LOBBY }));
    }
    ws.close();
    ws = null;
  }
  audio.resetMacroState();
  music.setBiome('cathedral', { fadeSec: 1.5 });
  myPlayerId = null;
  dungeon = null;
  latestSnapshot = null;
  myPrivateState = null;
  interpolator.reset();
  renderer.reset();
  input.reset();
  hud.reset();
  const netBadge = document.getElementById('badge-net');
  if (netBadge) {
    netBadge.textContent = 'Disconnected';
    netBadge.className = 'text-slate-400 font-mono text-[10px]';
  }
  menus.showMainMenu();
}

function connect(playerName, roomName, mode, playerClass, characterId, joinType = 'public', password = '', inviteToken = '', maxPlayers = 4) {
  intentionalExit = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  lastJoinParams = { playerName, roomName, mode, playerClass, characterId, joinType, password, inviteToken, maxPlayers };

  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.onclose = () => connect(playerName, roomName, mode, playerClass, characterId, joinType, password, inviteToken, maxPlayers);
    oldWs.close();
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host || 'localhost:8080'}`);

  ws.onopen = () => {
    const netBadge = document.getElementById('badge-net');
    if (netBadge) {
      netBadge.textContent = joinType === 'solo' ? 'Connected (Private)' : 'Connected (Host)';
      netBadge.className = 'text-emerald-400 font-mono text-[10px]';
    }
    const modeBadge = document.getElementById('badge-mode');
    if (modeBadge) {
      modeBadge.textContent = `${mode} Mode`;
    }
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
        inviteToken,
        maxPlayers,
        token: menus.getAuthToken()
      }
    });
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === 1) {
        sendPacket({ type: PACKET_TYPES.PING, t: performance.now() });
      }
    }, 1500);
  };

  ws.onmessage = (msg) => {
    if (typeof msg.data === 'string') perfOSD.recordRxBytes(msg.data.length);
    const packet = JSON.parse(msg.data);
    if (packet.type === PACKET_TYPES.PONG) {
      perfOSD.recordPong(packet.t);
      return;
    }
    if (packet.type === PACKET_TYPES.LOBBY_ERROR) {
      intentionalExit = true;
      sessionStorage.removeItem('sanctum_active_session');
      if (packet.data?.kicked) {
        exitToMainMenu();
      }
      menus.showLobbyError(packet.data?.message, mode);
      return;
    }
    if (packet.type === PACKET_TYPES.ROOM_INIT) {
      perfOSD.log('ROOM', `Joined ${packet.data.roomId} (Fl ${packet.data.floor || 1})`);
      reconnectAttempt = 0;
      if (lastJoinParams) {
        sessionStorage.setItem('sanctum_active_session', JSON.stringify(lastJoinParams));
      }
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
      hud.setInvite(packet.data.inviteToken || '');
      if (packet.data.floor) {
        hud.setFloorStatus(packet.data.floor);
      }
      // Keep cathedral theme playing seamlessly from title into dungeon
      if (!music.isPlaying) {
        music.setBiome('cathedral', { immediate: false, fadeSec: 1.5 });
      }
    } else if (packet.type === PACKET_TYPES.WORLD_SNAPSHOT) {
      const snap = packet.data;
      perfOSD.recordSnapshot(snap, typeof msg.data === 'string' ? msg.data.length : 0);
      latestSnapshot = snap;
      const me = snap.players?.find(p => p.id === myPlayerId);
      if (me) {
        hud.setCombatState(me.inCombatMs || 0, !!me.isDead);
        if (me.isDead && activeRoomMode === GAME_MODES.HARDCORE) {
          sessionStorage.removeItem('sanctum_active_session');
        }
      }
      interpolator.pushSnapshot(snap);
      processEvents(snap.events);
      syncHUD();
    } else if (packet.type === PACKET_TYPES.PLAYER_STATE_SYNC) {
      myPrivateState = packet.data;
      syncHUD();
    } else if (packet.type === PACKET_TYPES.INVITE_UPDATE) {
      hud.setInvite(packet.data?.inviteToken || '');
    }
  };

  ws.onclose = () => {
    ws = null;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    const netBadge = document.getElementById('badge-net');
    if (!intentionalExit && lastJoinParams && reconnectAttempt < 5) {
      const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttempt));
      reconnectAttempt++;
      if (netBadge) {
        netBadge.textContent = `Reconnecting (${reconnectAttempt}/5)...`;
        netBadge.className = 'text-amber-400 font-mono text-[10px]';
      }
      const params = lastJoinParams;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!intentionalExit) {
          connect(
            params.playerName,
            params.roomName,
            params.mode,
            params.playerClass,
            params.characterId,
            params.joinType,
            params.password,
            params.inviteToken,
            params.maxPlayers
          );
        }
      }, delay);
      return;
    }
    if (netBadge) {
      netBadge.textContent = 'Disconnected';
      netBadge.className = 'text-rose-400 font-mono text-[10px]';
    }
  };
}

function processEvents(events) {
  if (!events) return;
  for (const ev of events) {
    if (ev.type === 'DAMAGE') {
      renderer.addFloatingText(ev.isCrit ? `${ev.damage}! CRIT` : `${ev.damage}`, ev.x, ev.y, ev.isCrit ? '#FACC15' : '#FFFFFF', ev.isCrit);
      if (ev.attackerId) renderer.triggerEntityAnim(ev.attackerId, 'attack', 0.28);
      if (ev.id) renderer.triggerEntityAnim(ev.id, 'hurt', 0.2);
      if (ev.targetType === 'player' && ev.id === myPlayerId) {
        audio.play('player_hurt', { pan: 0, pitchJitter: 0.06 });
      } else {
        // Player proximity volume & stereo panning based on distance
        audio.play(ev.isCrit ? 'crit' : 'hit', { x: ev.x, y: ev.y, pitchJitter: 0.06 });
      }
    } else if (ev.type === 'HEAL') {
      const text = ev.isMana ? `+${ev.amount} MP` : `+${ev.amount} HP`;
      const col = ev.isMana ? '#38BDF8' : '#34D399';
      renderer.addFloatingText(text, ev.x, ev.y, col);
      audio.play('potion', { x: ev.x, y: ev.y, pitchJitter: 0.03 });
    } else if (ev.type === 'LEVEL_UP') {
      perfOSD.log('LEVEL', `Level up -> ${ev.level}`);
      renderer.addFloatingText(`LEVEL ${ev.level}!`, ev.x, ev.y - 6, '#FACC15', true);
      audio.play('level_up', { pitchJitter: 0 });
    } else if (ev.type === 'OVERBURDENED' && ev.id === myPlayerId) {
      renderer.addFloatingText('Too Heavy!', ev.x, ev.y - 6, '#F87171', false);
      audio.play('overburdened', { pitchJitter: 0 });
    } else if (ev.type === 'PLAYER_DEATH') {
      if (ev.hardcore) renderer.addFloatingText(`${ev.name} HAS FALLEN!`, ev.x || 120, ev.y || 72, '#EF4444', true);
      if (ev.id === myPlayerId) {
        audio.play('player_death', { pitchJitter: 0 });
      } else if (ev.hardcore) {
        audio.play('player_death', { x: ev.x, y: ev.y, pitchJitter: 0 });
      }
    } else if (ev.type === 'PLAYER_RESPAWN') {
      renderer.addFloatingText('RESPAWNED', ev.x, ev.y - 6, '#38BDF8', true);
    } else if (ev.type === 'FLOOR_DESCENT') {
      perfOSD.log('FLOOR', `Descended to floor ${ev.floor}`);
      hud.setFloorStatus(ev.floor);
      audio.play('floor_descent', { pitchJitter: 0 });
    }
  }
}

function render(now) {
  perfOSD.beginFrame();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  const tInterp0 = performance.now();
  const interp = interpolator.getInterpolatedEntities(dt);
  const interpMs = performance.now() - tInterp0;
  lastInterp = interp;

  // Continuously track player position as the listener for spatial audio
  const myP = interp.players.find(p => p.id === myPlayerId);
  if (myP) {
    audio.setListener(myP.rx ?? myP.x, myP.ry ?? myP.y);

    // Real-Time Macro FX: Low-Health Muffle (< 25% HP) and Cavern/Cathedral Environment Echo
    const isLowHp = (myP.maxHp > 0) && ((myP.hp / myP.maxHp) <= 0.25);
    const floor = latestSnapshot?.floor ?? 1;
    const env = (floor >= 3 && floor <= 4) ? 'cavern' : (floor >= 5 ? 'cathedral' : 'none');
    audio.setMacroState({ lowHealth: isLowHp, environment: env });

    // Adaptive Tonal System: Seamless transitions across Explore, Tension, and Combat
    if (!music.isLocked()) {
      let closeMob = false;
      let sensingMob = false;
      const monsters = interp.monsters;
      if (monsters) {
        const px = myP.rx;
        const py = myP.ry;
        for (let i = 0; i < monsters.length; i++) {
          const m = monsters[i];
          const dx = m.rx - px;
          const dy = m.ry - py;
          const dSq = dx * dx + dy * dy;
          if (dSq < 95 * 95) {
            closeMob = true;
            sensingMob = true;
            break;
          }
          if (dSq < 155 * 155) {
            sensingMob = true;
          }
        }
      }

      if (input.lockedMonsterId !== null || closeMob) {
        lastCombatAt = now;
      } else if (sensingMob) {
        music.prewarmSections(['combat', 'tension']);
      }

      if (now - lastCombatAt < 3500) {
        music.playSection('combat');
      } else if (sensingMob || isLowHp) {
        music.playSection('tension');
      } else {
        music.playSection('explore');
      }
    }
  }

  input.updateHoldMove(now);
  const { hoveredLoot, hoveredMob } = input.getHoverTargets(interp);

  const tDraw0 = performance.now();
  renderer.drawFrame({
    dt,
    dungeon,
    interp,
    myPlayerId,
    hoveredLoot,
    hoveredMob,
    lockedMonsterId: input.lockedMonsterId
  });
  const drawMs = performance.now() - tDraw0;

  perfOSD.endFrame({
    interpMs,
    lightMs: renderer.lastLightMs || 0,
    drawMs,
    interpolator,
    interp,
    audio
  });

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
