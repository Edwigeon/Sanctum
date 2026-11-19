import { ENGINE, TILES, RARITY_COLORS } from '../../shared/Constants.js';

export const PAL = {
  0: '#000000', 1: '#1D2B53', 2: '#7E2553', 3: '#008751',
  4: '#AB5236', 5: '#5F574F', 6: '#C2C3C7', 7: '#FFF1E8',
  8: '#FF004D', 9: '#FFA300', 10: '#FFEC27', 11: '#00E436',
  12: '#29ADFF', 13: '#83769C', 14: '#FF77A8', 15: '#FFCCAA'
};

export class Renderer {
  constructor() {
    this.pCanvas = document.getElementById('pixelCanvas');
    this.pCtx = this.pCanvas.getContext('2d', { alpha: false });
    this.hCanvas = document.getElementById('highResCanvas');
    this.hCtx = this.hCanvas.getContext('2d');
    this.stage = document.getElementById('game-stage');

    this.mapBufferCanvas = document.createElement('canvas');
    this.mapBufferCtx = this.mapBufferCanvas.getContext('2d', { alpha: false });
    this.mapBufferReady = false;
    this.lastCamIntX = null;
    this.lastCamIntY = null;
    this.lastTransformStr = '';

    this.stageScale = 3;
    this.stageW = 720;
    this.stageH = 432;

    this.camera = { x: 0, y: 0 };
    this.floatingTexts = [];
    this.clickMarker = null;

    window.addEventListener('resize', () => this.resizeStage());
    this.resizeStage();
  }

  resizeStage() {
    const container = this.stage?.parentElement;
    if (!container) return;
    const availW = container.clientWidth - 16;
    const availH = container.clientHeight - 16;
    const aspect = ENGINE.INTERNAL_WIDTH / ENGINE.INTERNAL_HEIGHT; // 240 / 144 = 5 / 3

    let w, h;
    if (availW / availH > aspect) {
      h = Math.floor(availH);
      w = Math.floor(h * aspect);
    } else {
      w = Math.floor(availW);
      h = Math.floor(w / aspect);
    }

    w = Math.max(480, w);
    h = Math.max(288, h);

    this.stageW = w;
    this.stageH = h;

    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;

    this.stageScale = w / ENGINE.INTERNAL_WIDTH;

    // Size pixelCanvas for 242x146 (2px subpixel scroll margin)
    this.pCanvas.style.width = `${(this.pCanvas.width / ENGINE.INTERNAL_WIDTH) * w}px`;
    this.pCanvas.style.height = `${(this.pCanvas.height / ENGINE.INTERNAL_HEIGHT) * h}px`;

    const dpr = window.devicePixelRatio || 1;
    this.hCanvas.width = Math.round(w * dpr);
    this.hCanvas.height = Math.round(h * dpr);
    this.hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.hCtx.imageSmoothingEnabled = false;
    this.pCtx.imageSmoothingEnabled = false;
    this.lastTransformStr = '';
  }

  bakeDungeonBuffer(d) {
    if (!d) {
      this.mapBufferReady = false;
      return;
    }
    const ts = ENGINE.TILE_SIZE;
    this.mapBufferCanvas.width = d.width * ts;
    this.mapBufferCanvas.height = d.height * ts;
    this.mapBufferCtx.fillStyle = PAL[0];
    this.mapBufferCtx.fillRect(0, 0, this.mapBufferCanvas.width, this.mapBufferCanvas.height);

    for (let r = 0; r < d.height; r++) {
      const row = d.map[r];
      const ty = r * ts;
      for (let c = 0; c < d.width; c++) {
        const t = row[c];
        const tx = c * ts;
        if (t === TILES.WALL) {
          this.mapBufferCtx.fillStyle = PAL[5];
          this.mapBufferCtx.fillRect(tx, ty, ts, ts);
          this.mapBufferCtx.fillStyle = PAL[13];
          this.mapBufferCtx.fillRect(tx, ty, ts - 1, 2);
        } else if (t === TILES.STAIRS_DOWN) {
          this.mapBufferCtx.fillStyle = PAL[1];
          this.mapBufferCtx.fillRect(tx, ty, ts, ts);
          this.mapBufferCtx.fillStyle = PAL[9];
          this.mapBufferCtx.fillRect(tx + 2, ty + 2, ts - 4, ts - 4);
          this.mapBufferCtx.fillStyle = PAL[10];
          this.mapBufferCtx.fillRect(tx + 4, ty + 4, ts - 8, ts - 8);
        } else if (t !== TILES.EMPTY) {
          this.mapBufferCtx.fillStyle = PAL[1];
          this.mapBufferCtx.fillRect(tx, ty, ts, ts);
        }
      }
    }
    this.mapBufferReady = true;
    this.lastCamIntX = null;
    this.lastCamIntY = null;
  }

  snapCameraToSpawn(dungeon) {
    if (!dungeon) return;
    const sx = dungeon.spawnPoint.x * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const sy = dungeon.spawnPoint.y * ENGINE.TILE_SIZE + ENGINE.TILE_SIZE / 2;
    const maxCamX = Math.max(0, dungeon.width * ENGINE.TILE_SIZE - ENGINE.INTERNAL_WIDTH);
    const maxCamY = Math.max(0, dungeon.height * ENGINE.TILE_SIZE - ENGINE.INTERNAL_HEIGHT);
    this.camera.x = Math.max(0, Math.min(maxCamX, sx - ENGINE.INTERNAL_WIDTH / 2));
    this.camera.y = Math.max(0, Math.min(maxCamY, sy - (ENGINE.INTERNAL_HEIGHT / 2 - 14)));
  }

  addFloatingText(text, x, y, color = '#FFFFFF', isCrit = false) {
    this.floatingTexts.push({ text, x, y, vy: -24, alpha: 1.0, color, isCrit });
  }

  setClickMarker(x, y, life = 0.25) {
    this.clickMarker = { x, y, life };
  }

  reset() {
    this.mapBufferReady = false;
    this.lastCamIntX = null;
    this.lastCamIntY = null;
    this.floatingTexts = [];
    this.clickMarker = null;
  }

  drawFrame({ dt, dungeon, interp, myPlayerId, hoveredLoot, hoveredMob, lockedMonsterId }) {
    const myP = interp.players.find(p => p.id === myPlayerId);
    if (myP && dungeon) {
      const targetCamX = myP.rx - ENGINE.INTERNAL_WIDTH / 2;
      const targetCamY = myP.ry - (ENGINE.INTERNAL_HEIGHT / 2 - 14);
      const maxCamX = Math.max(0, dungeon.width * ENGINE.TILE_SIZE - ENGINE.INTERNAL_WIDTH);
      const maxCamY = Math.max(0, dungeon.height * ENGINE.TILE_SIZE - ENGINE.INTERNAL_HEIGHT);
      this.camera.x = Math.max(0, Math.min(maxCamX, targetCamX));
      this.camera.y = Math.max(0, Math.min(maxCamY, targetCamY));
    }

    const camIntX = Math.floor(this.camera.x);
    const camIntY = Math.floor(this.camera.y);
    const fracX = this.camera.x - camIntX;
    const fracY = this.camera.y - camIntY;
    const txPx = Math.round(-fracX * this.stageScale * 100) / 100;
    const tyPx = Math.round(-fracY * this.stageScale * 100) / 100;
    const transformStr = `translate3d(${txPx}px, ${tyPx}px, 0)`;
    if (transformStr !== this.lastTransformStr) {
      this.lastTransformStr = transformStr;
      this.pCanvas.style.transform = transformStr;
    }

    if (camIntX !== this.lastCamIntX || camIntY !== this.lastCamIntY) {
      this.lastCamIntX = camIntX;
      this.lastCamIntY = camIntY;
      this.pCtx.fillStyle = PAL[0];
      this.pCtx.fillRect(0, 0, this.pCanvas.width, this.pCanvas.height);
      if (this.mapBufferReady) {
        this.pCtx.drawImage(
          this.mapBufferCanvas,
          camIntX, camIntY, this.pCanvas.width, this.pCanvas.height,
          0, 0, this.pCanvas.width, this.pCanvas.height
        );
      }
    }

    const hCtx = this.hCtx;
    const scale = this.stageScale;
    const camX = this.camera.x;
    const camY = this.camera.y;

    hCtx.clearRect(0, 0, this.stageW, this.stageH);

    const drawAnchoredRect = (ax, ay, ox, oy, w, h, color) => {
      const baseX = (ax - camX) * scale;
      const baseY = (ay - camY) * scale;
      const x0 = baseX + Math.round(ox * scale);
      const y0 = baseY + Math.round(oy * scale);
      const x1 = baseX + Math.round((ox + w) * scale);
      const y1 = baseY + Math.round((oy + h) * scale);
      hCtx.fillStyle = color;
      hCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const strokeAnchoredRect = (ax, ay, ox, oy, w, h, color) => {
      const baseX = (ax - camX) * scale;
      const baseY = (ay - camY) * scale;
      const x0 = baseX + Math.round(ox * scale);
      const y0 = baseY + Math.round(oy * scale);
      const x1 = baseX + Math.round((ox + w) * scale);
      const y1 = baseY + Math.round((oy + h) * scale);
      hCtx.strokeStyle = color;
      hCtx.lineWidth = Math.max(1, Math.round(scale * 0.4));
      hCtx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    };

    if (this.clickMarker) {
      strokeAnchoredRect(this.clickMarker.x, this.clickMarker.y, -2, -2, 4, 4, PAL[11]);
      this.clickMarker.life -= dt;
      if (this.clickMarker.life <= 0) this.clickMarker = null;
    }

    for (let i = 0; i < interp.loot.length; i++) {
      const l = interp.loot[i];
      drawAnchoredRect(l.x, l.y, -2, -2, 4, 4, PAL[9]);
      if (hoveredLoot && hoveredLoot.id === l.id) {
        strokeAnchoredRect(l.x, l.y, -3, -3, 6, 6, PAL[10]);
      }
    }

    for (let i = 0; i < interp.monsters.length; i++) {
      const m = interp.monsters[i];
      drawAnchoredRect(m.rx, m.ry, -3, -4, 6, 8, PAL[8]);
      if ((hoveredMob && hoveredMob.id === m.id) || lockedMonsterId === m.id) {
        strokeAnchoredRect(m.rx, m.ry, -4, -5, 8, 10, PAL[10]);
      }
      drawAnchoredRect(m.rx, m.ry, -4, -7, 8, 2, PAL[0]);
      drawAnchoredRect(m.rx, m.ry, -4, -7, 8 * Math.max(0, m.hp / m.maxHp), 2, PAL[8]);
    }

    for (let i = 0; i < interp.projectiles.length; i++) {
      const p = interp.projectiles[i];
      drawAnchoredRect(p.rx, p.ry, -1.5, -1.5, 3, 3, PAL[12]);
    }

    const nameSize = Math.max(10, Math.round(3.2 * scale));
    hCtx.font = `bold ${nameSize}px monospace`;
    hCtx.textAlign = 'center';

    for (let i = 0; i < interp.players.length; i++) {
      const p = interp.players[i];
      if (p.isDead) {
        drawAnchoredRect(p.rx, p.ry, -3, -4, 6, 8, PAL[5]);
      } else {
        const isMe = p.id === myPlayerId;
        if (isMe) {
          strokeAnchoredRect(p.rx, p.ry, -4, 2, 8, 3, PAL[10]);
        }
        drawAnchoredRect(p.rx, p.ry, -3, 3, 6, 2, PAL[0]);
        drawAnchoredRect(p.rx, p.ry, -2, 1, 4, 2, PAL[4]);
        drawAnchoredRect(p.rx, p.ry, -3, -2, 6, 3, isMe ? PAL[12] : PAL[14]);
        drawAnchoredRect(p.rx, p.ry, -2, -5, 4, 3, PAL[7]);
        drawAnchoredRect(p.rx, p.ry, -2, -6, 4, 1, PAL[10]);

        const hx = (p.rx - camX) * scale;
        const hy = (p.ry - camY) * scale - 24;
        const label = p.name || (isMe ? 'YOU' : 'ALLY');
        hCtx.fillStyle = 'rgba(0,0,0,0.9)';
        hCtx.fillText(label, hx + 1, hy + 1);
        hCtx.fillStyle = isMe ? '#67E8F9' : '#F472B6';
        hCtx.fillText(label, hx, hy);
      }
    }

    const baseFontSize = Math.max(11, Math.round(3.5 * scale));
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= 1.2 * dt;
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      hCtx.globalAlpha = Math.max(0, ft.alpha);
      hCtx.font = ft.isCrit ? `bold ${baseFontSize + 3}px monospace` : `bold ${baseFontSize}px monospace`;
      const sx = (ft.x - camX) * scale;
      const sy = (ft.y - camY) * scale;
      hCtx.fillStyle = 'rgba(0,0,0,0.85)';
      hCtx.fillText(ft.text, sx + 1, sy + 1);
      hCtx.fillStyle = ft.color;
      hCtx.fillText(ft.text, sx, sy);
    }
    hCtx.globalAlpha = 1.0;

    if (hoveredLoot) {
      const hx = (hoveredLoot.x - camX) * scale;
      const hy = (hoveredLoot.y - camY) * scale - 20;
      const tipSize = Math.max(11, Math.round(3.6 * scale));
      hCtx.font = `${tipSize}px system-ui, sans-serif`;
      const textW = hCtx.measureText(hoveredLoot.name).width;
      hCtx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      hCtx.strokeStyle = RARITY_COLORS[hoveredLoot.rarity] || '#94A3B8';
      hCtx.lineWidth = 1.5;
      hCtx.beginPath();
      hCtx.roundRect(hx - textW / 2 - 8, hy - tipSize, textW + 16, tipSize + 10, 4);
      hCtx.fill();
      hCtx.stroke();
      hCtx.fillStyle = RARITY_COLORS[hoveredLoot.rarity] || '#FFFFFF';
      hCtx.fillText(hoveredLoot.name, hx, hy);
    }
    hCtx.textAlign = 'start';
  }
}
