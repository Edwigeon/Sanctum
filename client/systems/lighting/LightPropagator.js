/**
 * Light Grid Propagator
 * Collects dynamic & static light sources and evaluates the world-anchored 3px sub-tile lighting grid.
 */

import { PALETTE_INDEX } from '../../../shared/Constants.js';
import { MAX_LIGHT_BAND, CELL_PX, INV_CELL_PX, resolveColorRGB } from './LightingTables.js';
import { computeVisibility } from './VisibilityOcclusion.js';

const FALLOFF_LUT_SIZE = 256;
const FALLOFF_LUT = new Float32Array(FALLOFF_LUT_SIZE + 1);
for (let i = 0; i <= FALLOFF_LUT_SIZE; i++) {
  FALLOFF_LUT[i] = Math.pow(i / FALLOFF_LUT_SIZE, 1.32);
}
const _nearbySegs = [];

export function collectDynamicLights(state, { interp, myPlayerId }) {
  const lights = [];
  const ft = state.flickerTime;

  // 1. Players & Co-op Allies (default warm ORANGE torchlight, or custom p.lightColor)
  for (let i = 0; i < interp.players.length; i++) {
    const p = interp.players[i];
    if (p.isDead) continue;
    const isMe = p.id === myPlayerId;
    const rgb = resolveColorRGB(p.lightColor ?? PALETTE_INDEX.ORANGE);
    if (isMe && !state.playerTorchEnabled) {
      lights.push({ x: p.rx, y: p.ry, radius: 18, intensity: 3.2, rgb, isColored: false, los: true });
      continue;
    }
    if (p.torchEnabled === false) continue;

    // Subtle organic flame flicker (multi-harmonic non-repeating sine wander)
    const pt = ft + i * 2.37;
    const f1 = Math.sin(pt * 6.8);
    const f2 = Math.sin(pt * 13.4 + 1.4);
    const f3 = Math.sin(pt * 25.1 + 3.1);
    const flicker = f1 * 0.52 + f2 * 0.32 + f3 * 0.16;

    const baseRadius = p.lightRadius || (isMe ? 116 : 96);
    const baseIntensity = p.lightIntensity || 8.8;
    const radius = Math.max(20, baseRadius + flicker * 3.2);
    const intensity = Math.max(2.0, baseIntensity + flicker * 0.35);

    // Micro-sway of the torch flame position (< 0.55px) for authentic living shadows
    const swayX = Math.cos(pt * 4.3) * 0.55;
    const swayY = Math.sin(pt * 5.7) * 0.55;

    lights.push({
      x: p.rx + swayX,
      y: p.ry + swayY,
      radius,
      intensity,
      rgb,
      isColored: p.lightColor !== undefined && p.lightColor !== PALETTE_INDEX.ORANGE && p.lightColor !== 'ORANGE',
      los: true
    });
  }

  // 2. Flying Projectiles (Spark defaults to PALETTE_INDEX.BLUE #29ADFF)
  for (let i = 0; i < interp.projectiles.length; i++) {
    const pr = interp.projectiles[i];
    if (pr.lightEnabled === false) continue;
    lights.push({
      x: pr.rx,
      y: pr.ry,
      radius: pr.lightRadius || 44,
      intensity: pr.lightIntensity || 5.8,
      rgb: resolveColorRGB(pr.lightColor ?? PALETTE_INDEX.BLUE),
      isColored: true,
      los: true
    });
  }

  // 3. Monster / Entity Light Sources (default PALETTE_INDEX.RED)
  for (let i = 0; i < interp.monsters.length; i++) {
    const m = interp.monsters[i];
    if (m.lightRadius > 0 && m.lightEnabled !== false) {
      lights.push({
        x: m.rx,
        y: m.ry,
        radius: m.lightRadius,
        intensity: m.lightIntensity || 5.5,
        rgb: resolveColorRGB(m.lightColor ?? PALETTE_INDEX.RED),
        isColored: true,
        los: true
      });
    }
  }

  // 4. Static & Interactive World Objects (Stairs, Shrines, Braziers, Portals)
  for (const s of state.staticLights.values()) {
    if (!s.enabled) continue;
    const sFlicker = Math.sin(ft * 3.7 + s.x * 0.1 + s.y * 0.2) * 0.25;
    lights.push({
      x: s.x,
      y: s.y,
      radius: s.radius + sFlicker * 1.5,
      intensity: s.intensity + sFlicker * 0.15,
      rgb: s.rgb,
      isColored: s.isColored,
      los: s.los !== false
    });
  }

  // 5. Ground Loot Beacons (Unique ★ = YELLOW, Rare = PINK)
  for (let i = 0; i < interp.loot.length; i++) {
    const l = interp.loot[i];
    if (l.rarity >= 2 || l.lightRadius > 0) {
      const defaultColor = l.rarity >= 3 ? PALETTE_INDEX.YELLOW : PALETTE_INDEX.PINK;
      lights.push({
        x: l.x,
        y: l.y,
        radius: l.lightRadius || (l.rarity >= 3 ? 22 : 14),
        intensity: l.lightIntensity || (l.rarity >= 3 ? 3.2 : 1.8),
        rgb: resolveColorRGB(l.lightColor ?? defaultColor),
        isColored: true,
        los: true
      });
    }
  }

  return lights;
}

export function updateLightGrid(state, { dt, dungeon, camIntX, camIntY, interp, myPlayerId }) {
  if (state.ambientLight !== state.targetAmbientLight) {
    const step = dt * 2.5;
    if (Math.abs(state.targetAmbientLight - state.ambientLight) <= step) {
      state.ambientLight = state.targetAmbientLight;
    } else {
      state.ambientLight += Math.sign(state.targetAmbientLight - state.ambientLight) * step;
    }
  }

  if (!dungeon || !state.lightGrid) return;

  const cols = state.gridCols;
  const rows = state.gridRows;

  state.activeMinC = Math.max(0, ((camIntX * INV_CELL_PX) | 0) - 2);
  state.activeMaxC = Math.min(cols - 1, (((camIntX + state.viewWidth) * INV_CELL_PX) | 0) + 2);
  state.activeMinR = Math.max(0, ((camIntY * INV_CELL_PX) | 0) - 2);
  state.activeMaxR = Math.min(rows - 1, (((camIntY + state.viewHeight) * INV_CELL_PX) | 0) + 2);

  const amb = state.ambientLight;
  for (let r = state.activeMinR; r <= state.activeMaxR; r++) {
    const start = r * cols + state.activeMinC;
    const end = r * cols + state.activeMaxC + 1;
    state.lightGrid.fill(amb, start, end);
    state.lightR.fill(0, start, end);
    state.lightG.fill(0, start, end);
    state.lightB.fill(0, start, end);
  }

  state.flickerTime = (state.flickerTime || 0) + (dt || 0.016);
  const lights = collectDynamicLights(state, { interp, myPlayerId });

  for (let li = 0; li < lights.length; li++) {
    const L = lights[li];
    const rad = L.radius;
    const rSq = rad * rad;
    const [lr, lg, lb] = L.rgb;

    const lMinC = Math.max(state.activeMinC, ((L.x - rad) * INV_CELL_PX) | 0);
    const lMaxC = Math.min(state.activeMaxC, (((L.x + rad) * INV_CELL_PX) | 0) + 1);
    const lMinR = Math.max(state.activeMinR, ((L.y - rad) * INV_CELL_PX) | 0);
    const lMaxR = Math.min(state.activeMaxR, (((L.y + rad) * INV_CELL_PX) | 0) + 1);
    if (lMinC > lMaxC || lMinR > lMaxR) continue;

    // Pre-filter wall segments to only those overlapping this light's radius
    let activeSegs = state.wallSegments;
    if (L.los && activeSegs.length > 0) {
      _nearbySegs.length = 0;
      const bMinX = L.x - rad;
      const bMaxX = L.x + rad;
      const bMinY = L.y - rad;
      const bMaxY = L.y + rad;
      for (let si = 0; si < activeSegs.length; si++) {
        const s = activeSegs[si];
        if (s.maxX >= bMinX && s.minX <= bMaxX && s.maxY >= bMinY && s.minY <= bMaxY) {
          _nearbySegs.push(s);
        }
      }
      activeSegs = _nearbySegs;
    }

    const invRad = 1.0 / rad;
    for (let r = lMinR; r <= lMaxR; r++) {
      const wy = r * CELL_PX;
      const dy = wy - L.y;
      const dySq = dy * dy;
      const rowOffset = r * cols;

      for (let c = lMinC; c <= lMaxC; c++) {
        const wx = c * CELL_PX;
        const dx = wx - L.x;
        const distSq = dx * dx + dySq;
        if (distSq >= rSq) continue;

        const norm = 1.0 - Math.sqrt(distSq) * invRad;
        const lutIdx = (norm * FALLOFF_LUT_SIZE) | 0;
        const rawContrib = L.intensity * FALLOFF_LUT[lutIdx];
        const idx = rowOffset + c;
        if (rawContrib <= 0.05) continue;

        const vis = L.los ? computeVisibility(state, L.x, L.y, wx, wy, activeSegs) : 1.0;
        if (vis <= 0.0) continue;

        const contrib = rawContrib * vis;
        const prevL = state.lightGrid[idx];
        state.lightGrid[idx] = Math.min(MAX_LIGHT_BAND + 1.5, prevL + contrib * Math.max(0.35, 1.0 - prevL / (MAX_LIGHT_BAND + 2.0)));

        if (L.isColored) {
          const cScale = (contrib / MAX_LIGHT_BAND) * 0.48;
          state.lightR[idx] += lr * cScale;
          state.lightG[idx] += lg * cScale;
          state.lightB[idx] += lb * cScale;
        }
      }
    }
  }
}
