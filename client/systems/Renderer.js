import { ENGINE, PALETTE, PALETTE_INDEX, RARITY_COLORS } from '../../shared/Constants.js';
import { LightingSystem } from './LightingSystem.js';
import { CanvasHUD } from './CanvasHUD.js';
import { uiManager } from './ui/UIManager.js';

// Pre-allocated entity geometry templates (zero per-frame array allocations)
const LOOT_RECTS = [
  { rx: 0, ry: 0, rw: 4, rh: 4, palIdx: PALETTE_INDEX.ORANGE },
  { rx: 1, ry: 1, rw: 2, rh: 2, palIdx: PALETTE_INDEX.YELLOW }
];

const MOB_RECTS = [
  { rx: 0, ry: 0, rw: 6, rh: 8, palIdx: PALETTE_INDEX.RED },
  { rx: 1, ry: 1, rw: 4, rh: 2, palIdx: PALETTE_INDEX.PINK }
];

const PROJ_RECTS = [
  { rx: 0, ry: 0, rw: 3, rh: 3, palIdx: PALETTE_INDEX.BLUE },
  { rx: 1, ry: 1, rw: 1, rh: 1, palIdx: PALETTE_INDEX.WHITE }
];

const DEAD_RECTS = [
  { rx: 0, ry: 0, rw: 6, rh: 8, palIdx: PALETTE_INDEX.DARK_GRAY }
];

const PLAYER_SELF_RECTS = [
  { rx: 0, ry: 9, rw: 6, rh: 2, palIdx: PALETTE_INDEX.BLACK },
  { rx: 1, ry: 7, rw: 4, rh: 2, palIdx: PALETTE_INDEX.BROWN },
  { rx: 0, ry: 4, rw: 6, rh: 3, palIdx: PALETTE_INDEX.BLUE },
  { rx: 1, ry: 1, rw: 4, rh: 3, palIdx: PALETTE_INDEX.WHITE },
  { rx: 1, ry: 0, rw: 4, rh: 1, palIdx: PALETTE_INDEX.YELLOW }
];

const PLAYER_ALLY_RECTS = [
  { rx: 0, ry: 9, rw: 6, rh: 2, palIdx: PALETTE_INDEX.BLACK },
  { rx: 1, ry: 7, rw: 4, rh: 2, palIdx: PALETTE_INDEX.BROWN },
  { rx: 0, ry: 4, rw: 6, rh: 3, palIdx: PALETTE_INDEX.PINK },
  { rx: 1, ry: 1, rw: 4, rh: 3, palIdx: PALETTE_INDEX.WHITE },
  { rx: 1, ry: 0, rw: 4, rh: 1, palIdx: PALETTE_INDEX.YELLOW }
];

export class Renderer {
  constructor({ sprites = null } = {}) {
    this.sprites = sprites;
    this.pCanvas = document.getElementById('pixelCanvas');
    this.pCtx = this.pCanvas.getContext('2d', { alpha: false });
    this.hCanvas = document.getElementById('highResCanvas');
    this.hCtx = this.hCanvas.getContext('2d');
    this.stage = document.getElementById('game-stage');

    this.lighting = new LightingSystem(this.pCanvas.width, this.pCanvas.height);
    this.lastTransformStr = '';

    this.stageScale = 3;
    this.stageW = 720;
    this.stageH = 432;

    this.camera = { x: 0, y: 0 };
    this.animTime = 0;
    this.entityAnim = new Map(); // id -> { x, y, facingLeft, moveHold, actionState, actionTimer }
    this.floatingTexts = [];
    this.clickMarker = null;
    this.canvasHud = new CanvasHUD();
    this.uiManager = uiManager;

    window.addEventListener('resize', () => this.resizeStage());
    this.resizeStage();
  }

  updateHUD(partial) {
    if (this.canvasHud) {
      this.canvasHud.updateState(partial);
    }
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

    if (this.uiManager) {
      this.uiManager.onResize(w, h, dpr);
    }
  }

  bakeDungeonBuffer(d) {
    this.lighting.bakeFloorIndices(d, this.sprites);
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

  isWorldPointVisible(wx, wy) {
    return this.lighting.sampleLightAtWorld(wx, wy) > 0.25;
  }

  reset() {
    this.lighting.bakeFloorIndices(null);
    this.entityAnim.clear();
    this.floatingTexts = [];
    this.clickMarker = null;
  }

  /**
   * Triggers a timed animation state (e.g. 'attack', 'cast', 'hurt') on a player or monster entity.
   */
  triggerEntityAnim(id, state, durationSec = 0.28) {
    if (!id) return;
    let rec = this.entityAnim.get(id);
    if (!rec) {
      rec = { x: null, y: null, facingLeft: false, moveHold: 0, actionState: null, actionTimer: 0 };
      this.entityAnim.set(id, rec);
    }
    rec.actionState = state;
    rec.actionTimer = durationSec;
  }

  /**
   * Updates per-entity motion/facing and resolves the active animation state & frame index.
   */
  resolveEntityAnim(id, rx, ry, dt, sprite, isDead = false) {
    let rec = this.entityAnim.get(id);
    if (!rec) {
      rec = { x: rx, y: ry, facingLeft: false, moveHold: 0, actionState: null, actionTimer: 0 };
      this.entityAnim.set(id, rec);
    }
    if (rec.x !== null && rec.y !== null) {
      const dx = rx - rec.x;
      const dy = ry - rec.y;
      if (Math.hypot(dx, dy) > 0.08) {
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

    const stObj = sprite?.getState ? sprite.getState(state) : sprite;
    const fps = stObj?.fps || sprite?.fps || 4;
    const count = stObj?.frames?.length || 1;
    let frameIdx = 0;
    if (count > 1) {
      if (stObj?.pingPong && count > 2) {
        const span = count * 2 - 2;
        const step = Math.floor(this.animTime * fps) % span;
        frameIdx = step < count ? step : span - step;
      } else {
        frameIdx = Math.floor(this.animTime * fps) % count;
      }
    }
    return { state, frameIdx, flipX: rec.facingLeft };
  }

  drawFrame({ dt, dungeon, interp, myPlayerId, hoveredLoot, hoveredMob, lockedMonsterId }) {
    this.animTime += dt;
    const animFrame = Math.floor(this.animTime * 3.5);
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

    // 1. Evaluate analytical ray-segment lighting against merged continuous walls + render lit floor tiles on pixelCanvas
    const tLight0 = performance.now();
    this.lighting.updateLightGrid({
      dt,
      dungeon,
      camIntX,
      camIntY,
      interp,
      myPlayerId
    });
    this.lighting.renderLitScene({
      pCtx: this.pCtx,
      camIntX,
      camIntY
    });
    this.lastLightMs = performance.now() - tLight0;

    // 2. High-DPI Entity & UI layer (highResCanvas)
    const hCtx = this.hCtx;
    const scale = this.stageScale;
    const camX = this.camera.x;
    const camY = this.camera.y;

    hCtx.clearRect(0, 0, this.stageW, this.stageH);

    const drawUIRect = (ax, ay, ox, oy, w, h, color) => {
      const baseX = (ax - camX) * scale;
      const baseY = (ay - camY) * scale;
      const x0 = baseX + Math.round(ox * scale);
      const y0 = baseY + Math.round(oy * scale);
      const x1 = baseX + Math.round((ox + w) * scale);
      const y1 = baseY + Math.round((oy + h) * scale);
      hCtx.fillStyle = color;
      hCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const strokeUIRect = (ax, ay, ox, oy, w, h, color) => {
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
      strokeUIRect(this.clickMarker.x, this.clickMarker.y, -2, -2, 4, 4, PALETTE[PALETTE_INDEX.GREEN]);
      this.clickMarker.life -= dt;
      if (this.clickMarker.life <= 0) this.clickMarker = null;
    }

    for (let i = 0; i < interp.loot.length; i++) {
      const l = interp.loot[i];
      if (this.lighting.sampleLightAtWorld(l.x, l.y) <= 0.12) continue;
      this.lighting.drawLitEntityStamp(hCtx, {
        wx: l.x, wy: l.y, ox: -2, oy: -2, w: 4, h: 4,
        rects: LOOT_RECTS, camX, camY, scale
      });
      if (hoveredLoot && hoveredLoot.id === l.id) {
        strokeUIRect(l.x, l.y, -3, -3, 6, 6, PALETTE[PALETTE_INDEX.YELLOW]);
      }
    }

    const defaultMobSpr = this.sprites?.get('entities', 'monster_crawler');
    for (let i = 0; i < interp.monsters.length; i++) {
      const m = interp.monsters[i];
      if (this.lighting.sampleLightAtWorld(m.rx, m.ry) <= 0.12) continue;
      const mobSpr = (m.type && this.sprites?.get('entities', `monster_${m.type}`)) || defaultMobSpr;
      if (mobSpr?.frames?.length) {
        const anim = this.resolveEntityAnim(m.id, m.rx, m.ry, dt, mobSpr, false);
        this.lighting.drawLitSpriteStamp(hCtx, {
          sprite: mobSpr, state: anim.state, frameIdx: anim.frameIdx, flipX: anim.flipX,
          wx: m.rx, wy: m.ry, camX, camY, scale
        });
      } else {
        this.lighting.drawLitEntityStamp(hCtx, {
          wx: m.rx, wy: m.ry, ox: -3, oy: -4, w: 6, h: 8,
          rects: MOB_RECTS, camX, camY, scale
        });
      }

      const band = this.lighting.getLightBandAtWorld(m.rx, m.ry);
      if (band <= 0) continue;

      if ((hoveredMob && hoveredMob.id === m.id) || lockedMonsterId === m.id) {
        strokeUIRect(m.rx, m.ry, -4, -5, 8, 10, PALETTE[PALETTE_INDEX.YELLOW]);
      }
      if (band >= 2 || m.hp < m.maxHp) {
        drawUIRect(m.rx, m.ry, -4, -7, 8, 2, PALETTE[PALETTE_INDEX.BLACK]);
        drawUIRect(m.rx, m.ry, -4, -7, 8 * Math.max(0, m.hp / m.maxHp), 2, PALETTE[PALETTE_INDEX.RED]);
      }
    }

    for (let i = 0; i < interp.projectiles.length; i++) {
      const pr = interp.projectiles[i];
      this.lighting.drawLitEntityStamp(hCtx, {
        wx: pr.rx, wy: pr.ry, ox: -1.5, oy: -1.5, w: 3, h: 3,
        rects: PROJ_RECTS, camX, camY, scale
      });
    }

    const nameSize = Math.max(10, Math.round(3.2 * scale));
    hCtx.font = `bold ${nameSize}px monospace`;
    hCtx.textAlign = 'center';

    for (let i = 0; i < interp.players.length; i++) {
      const p = interp.players[i];
      const heroSpr = this.sprites?.get('entities', `hero_${(p.classId || 'vanguard').toLowerCase()}`) || this.sprites?.get('entities', 'hero_vanguard');
      if (p.isDead) {
        if (heroSpr?.states?.death?.frames?.length) {
          const anim = this.resolveEntityAnim(p.id, p.rx, p.ry, dt, heroSpr, true);
          this.lighting.drawLitSpriteStamp(hCtx, {
            sprite: heroSpr, state: 'death', frameIdx: anim.frameIdx, flipX: anim.flipX,
            wx: p.rx, wy: p.ry, camX, camY, scale
          });
        } else {
          this.lighting.drawLitEntityStamp(hCtx, {
            wx: p.rx, wy: p.ry, ox: -3, oy: -4, w: 6, h: 8,
            rects: DEAD_RECTS, camX, camY, scale
          });
        }
        continue;
      }
      const isMe = p.id === myPlayerId;
      if (!isMe && this.lighting.sampleLightAtWorld(p.rx, p.ry) <= 0.12) continue;

      if (isMe) {
        strokeUIRect(p.rx, p.ry, -4, 2, 8, 3, PALETTE[PALETTE_INDEX.YELLOW]);
      }

      if (heroSpr?.frames?.length) {
        const anim = this.resolveEntityAnim(p.id, p.rx, p.ry, dt, heroSpr, false);
        this.lighting.drawLitSpriteStamp(hCtx, {
          sprite: heroSpr, state: anim.state, frameIdx: anim.frameIdx, flipX: anim.flipX,
          wx: p.rx, wy: p.ry, camX, camY, scale
        });
      } else {
        this.lighting.drawLitEntityStamp(hCtx, {
          wx: p.rx, wy: p.ry, ox: -3, oy: -6, w: 6, h: 11,
          rects: isMe ? PLAYER_SELF_RECTS : PLAYER_ALLY_RECTS, camX, camY, scale
        });
      }

      const hx = (p.rx - camX) * scale;
      const hy = (p.ry - camY) * scale - 24;
      const label = p.name || (isMe ? 'YOU' : 'ALLY');
      hCtx.fillStyle = 'rgba(0,0,0,0.9)';
      hCtx.fillText(label, hx + 1, hy + 1);
      hCtx.fillStyle = isMe ? '#67E8F9' : '#F472B6';
      hCtx.fillText(label, hx, hy);
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

    // 3. Canvas-Native UI Framework & Modal Stack
    if (this.uiManager) {
      this.uiManager.render(hCtx, this.animTime);
    }

    // 4. Action Bar & Vitals HUD (Life/Mana Globes, Belt, XP Bar)
    if (this.canvasHud) {
      this.canvasHud.render(hCtx, this.stageW, this.stageH, dt, this.animTime);
    }
  }
}
