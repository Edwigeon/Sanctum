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
