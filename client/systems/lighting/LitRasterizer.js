/**
 * Lit Scene & Entity/Sprite Subpixel Rasterizer
 * Evaluates 1x1 world-locked Bayer dithering + bilinear additive RGB colored light interpolation.
 */

import { PALETTE_INDEX, PALETTE_RGB } from '../../../shared/Constants.js';
import { MAX_LIGHT_BAND, INV_CELL_PX, SHADE_U32, BAYER_4X4, packABGR } from './LightingTables.js';

export function sampleLightAtWorld(state, wx, wy) {
  if (!state.lightGrid) return 0;
  const gx = wx * INV_CELL_PX;
  const gy = wy * INV_CELL_PX;
  const cols = state.gridCols;
  const maxR = state.gridRows - 2;
  const maxC = cols - 2;

  if (gx < 0 || gx > cols - 1 || gy < 0 || gy > state.gridRows - 1) return state.ambientLight;

  let c0 = gx | 0;
  if (c0 > maxC) c0 = maxC;
  let r0 = gy | 0;
  if (r0 > maxR) r0 = maxR;

  const fx = gx - c0;
  const fy = gy - r0;
  const row0 = r0 * cols;
  const row1 = (r0 + 1) * cols;
  const grid = state.lightGrid;

  const top = grid[row0 + c0] + (grid[row0 + c0 + 1] - grid[row0 + c0]) * fx;
  const bot = grid[row1 + c0] + (grid[row1 + c0 + 1] - grid[row1 + c0]) * fx;
  return top + (bot - top) * fy;
}

export function getLightBandAtWorld(state, wx, wy) {
  const val = sampleLightAtWorld(state, wx, wy);
  if (val <= 0.35) return 0;
  return Math.min(MAX_LIGHT_BAND, Math.max(1, Math.round(val)));
}

export function sampleLitPixelU32(state, wx, wy, basePalIdx) {
  if (basePalIdx === 0) return SHADE_U32[0][0];
  const cols = state.gridCols;
  const maxR = state.gridRows - 2;
  const maxC = cols - 2;
  const grid = state.lightGrid;

  const gx = wx * INV_CELL_PX;
  const gy = wy * INV_CELL_PX;
  if (gx < 0 || gx > cols - 1 || gy < 0 || gy > state.gridRows - 1) return SHADE_U32[0][0];

  let c0 = gx | 0;
  if (c0 > maxC) c0 = maxC;
  let r0 = gy | 0;
  if (r0 > maxR) r0 = maxR;

  const fx = gx - c0;
  const fy = gy - r0;
  const i00 = r0 * cols + c0;
  const i10 = i00 + 1;
  const i01 = (r0 + 1) * cols + c0;
  const i11 = i01 + 1;

  const top = grid[i00] + (grid[i10] - grid[i00]) * fx;
  const bot = grid[i01] + (grid[i11] - grid[i01]) * fx;
  const lightVal = top + (bot - top) * fy;

  if (lightVal <= 0.12) return SHADE_U32[0][0];

  let band = lightVal | 0;
  const frac = lightVal - band;
  const ix = wx | 0;
  const iy = wy | 0;
  const threshold = BAYER_4X4[((iy & 3) << 2) + (ix & 3)];
  if (frac > threshold && band < MAX_LIGHT_BAND) {
    band++;
  }
  if (band <= 0) return SHADE_U32[0][0];
  if (band > MAX_LIGHT_BAND) band = MAX_LIGHT_BAND;

  const baseU32 = SHADE_U32[band][basePalIdx];
  const gridR = state.lightR;
  const gridG = state.lightG;
  const gridB = state.lightB;

  if (gridR[i00] === 0 && gridR[i10] === 0 && gridR[i01] === 0 && gridR[i11] === 0 &&
      gridG[i00] === 0 && gridG[i10] === 0 && gridG[i01] === 0 && gridG[i11] === 0 &&
      gridB[i00] === 0 && gridB[i10] === 0 && gridB[i01] === 0 && gridB[i11] === 0) {
    return baseU32;
  }

  const tr = gridR[i00] + (gridR[i10] - gridR[i00]) * fx;
  const br = gridR[i01] + (gridR[i11] - gridR[i01]) * fx;
  const cr = (tr + (br - tr) * fy) | 0;

  const tg = gridG[i00] + (gridG[i10] - gridG[i00]) * fx;
  const bg = gridG[i01] + (gridG[i11] - gridG[i01]) * fx;
  const cg = (tg + (bg - tg) * fy) | 0;

  const tb = gridB[i00] + (gridB[i10] - gridB[i00]) * fx;
  const bb = gridB[i01] + (gridB[i11] - gridB[i01]) * fx;
  const cb = (tb + (bb - tb) * fy) | 0;

  if ((cr | cg | cb) === 0) {
    return baseU32;
  }

  let r0Col = baseU32 & 255;
  let g0Col = (baseU32 >> 8) & 255;
  let b0Col = (baseU32 >> 16) & 255;

  const [br0, bg0, bb0] = PALETTE_RGB[basePalIdx];

  if (cb > cr + 15) {
    const coolFactor = Math.min(1.0, (cb - cr) / 80.0);
    r0Col = Math.max(br0 * 0.2, r0Col - coolFactor * 18) | 0;
    g0Col = Math.max(bg0 * 0.2, g0Col - coolFactor * 6) | 0;
  }

  const effR = cr * (0.32 + 0.68 * (br0 / 255.0));
  const effG = cg * (0.32 + 0.68 * (bg0 / 255.0));
  const effB = cb * (0.32 + 0.68 * (bb0 / 255.0));

  const r = Math.min(255, (r0Col + effR * Math.max(0.18, 1.0 - r0Col / 270.0)) | 0);
  const g = Math.min(255, (g0Col + effG * Math.max(0.18, 1.0 - g0Col / 270.0)) | 0);
  const b = Math.min(255, (b0Col + effB * Math.max(0.18, 1.0 - b0Col / 270.0)) | 0);

  return packABGR(r, g, b);
}

/**
 * Stamps a multi-part or sprite entity into the scratch ImageData buffer using per-pixel
 * Bayer-dithered + additive colored lighting, then blits onto hCtx at exact subpixel screen coords.
 */
export function drawLitEntityStamp(state, hCtx, { wx, wy, ox, oy, w, h, rects, camX, camY, scale }) {
  if (!state.lightGrid) return;
  const sw = Math.min(state.maxStampW, w);
  const sh = Math.min(state.maxStampH, h);
  const buf = state.stampU32;
  const stride = state.maxStampW;

  for (let py = 0; py < sh; py++) {
    buf.fill(0, py * stride, py * stride + sw);
  }

  for (let ri = 0; ri < rects.length; ri++) {
    const r = rects[ri];
    const xEnd = Math.min(sw, r.rx + r.rw);
    const yEnd = Math.min(sh, r.ry + r.rh);
    for (let py = Math.max(0, r.ry); py < yEnd; py++) {
      const worldY = wy + oy + py;
      const rowOff = py * stride;
      for (let px = Math.max(0, r.rx); px < xEnd; px++) {
        const worldX = wx + ox + px;
        const u32 = sampleLitPixelU32(state, worldX, worldY, r.palIdx);
        if (r.palIdx === PALETTE_INDEX.BLACK) {
          if (sampleLightAtWorld(state, worldX, worldY) > 0.12) {
            buf[rowOff + px] = SHADE_U32[0][0];
          }
        } else if (u32 !== SHADE_U32[0][0]) {
          buf[rowOff + px] = u32;
        }
      }
    }
  }

  state.stampCtx.putImageData(state.stampImageData, 0, 0, 0, 0, sw, sh);
  const screenX = (wx + ox - camX) * scale;
  const screenY = (wy + oy - camY) * scale;
  hCtx.drawImage(state.stampCanvas, 0, 0, sw, sh, screenX, screenY, sw * scale, sh * scale);
}

/**
 * Stamps a palette-indexed SpriteRegistry frame (with optional flipX and rotation) into the scratch
 * ImageData buffer using per-pixel Bayer-dithered + additive colored lighting, then blits onto hCtx
 * at exact subpixel screen coordinates.
 */
export function drawLitSpriteStamp(state, hCtx, { sprite, state: animState = 'idle', frameIdx = 0, wx, wy, camX, camY, scale, flipX = false, rot90 = 0, angleRad = 0 }) {
  if (!state.lightGrid || !sprite) return;
  const st = sprite.getState ? sprite.getState(animState) : sprite;
  const frames = st?.frames || sprite.frames;
  if (!frames || frames.length === 0) return;
  const frame = frames[frameIdx % frames.length];
  const sw = Math.min(state.maxStampW, sprite.w);
  const sh = Math.min(state.maxStampH, sprite.h);
  const stride = state.maxStampW;
  const buf = state.stampU32;
  const blackU32 = SHADE_U32[0][0];

  const renderScale = sprite.renderScale ?? (sprite.targetW ? sprite.targetW / sw : ((sw >= 32 || sh >= 32) ? 0.5 : 1));
  const destW = sw * renderScale;
  const destH = sh * renderScale;
  const anchorX = sprite.anchorX != null ? sprite.anchorX : Math.floor(sw / 2);
  const anchorY = sprite.anchorY != null ? sprite.anchorY : Math.floor(sh * 0.75);
  const ox = -anchorX * renderScale;
  const oy = -anchorY * renderScale;

  for (let py = 0; py < sh; py++) {
    buf.fill(0, py * stride, py * stride + sw);
  }

  const r90 = rot90 & 3;
  const hasRot = r90 === 0 && Math.abs(angleRad) > 1e-4;
  const cosA = hasRot ? Math.cos(-angleRad) : 1;
  const sinA = hasRot ? Math.sin(-angleRad) : 0;
  const cx = (sw - 1) * 0.5;
  const cy = (sh - 1) * 0.5;

  for (let py = 0; py < sh; py++) {
    const worldY = wy + oy + (py * renderScale);
    const rowOff = py * stride;
    for (let px = 0; px < sw; px++) {
      let sx = flipX ? (sw - 1 - px) : px;
      let sy = py;
      if (r90 === 1) {
        const tmp = sx;
        sx = sy;
        sy = sw - 1 - tmp;
      } else if (r90 === 2) {
        sx = sw - 1 - sx;
        sy = sh - 1 - sy;
      } else if (r90 === 3) {
        const tmp = sx;
        sx = sh - 1 - sy;
        sy = tmp;
      } else if (hasRot) {
        const dx = px - cx;
        const dy = py - cy;
        sx = Math.round(dx * cosA - dy * sinA + cx);
        sy = Math.round(dx * sinA + dy * cosA + cy);
        if (sx < 0 || sx >= sprite.w || sy < 0 || sy >= sprite.h) continue;
        if (flipX) sx = sprite.w - 1 - sx;
      }
      const palIdx = frame[sy * sprite.w + sx];
      if (palIdx === 255) continue;

      const worldX = wx + ox + (px * renderScale);
      if (palIdx === PALETTE_INDEX.BLACK) {
        if (sampleLightAtWorld(state, worldX, worldY) > 0.12) {
          buf[rowOff + px] = blackU32;
        }
      } else {
        const u32 = sampleLitPixelU32(state, worldX, worldY, palIdx);
        if (u32 !== blackU32) {
          buf[rowOff + px] = u32;
        }
      }
    }
  }

  state.stampCtx.putImageData(state.stampImageData, 0, 0, 0, 0, sw, sh);
  const screenX = (wx + ox - camX) * scale;
  const screenY = (wy + oy - camY) * scale;
  hCtx.drawImage(state.stampCanvas, 0, 0, sw, sh, screenX, screenY, destW * scale, destH * scale);
}

/**
 * Renders the lit static floor & walls onto pixelCanvas.
 */
export function renderLitScene(state, { pCtx, camIntX, camIntY }) {
  if (!state.mapIndices || !state.lightGrid) {
    state.pixelU32.fill(SHADE_U32[0][0]);
    pCtx.putImageData(state.imageData, 0, 0);
    return;
  }

  const vw = state.viewWidth;
  const vh = state.viewHeight;
  const mw = state.mapIndexW;
  const mh = state.mapIndexH;
  const mapIdx = state.mapIndices;
  const outU32 = state.pixelU32;
  const cols = state.gridCols;
  const maxR = state.gridRows - 2;
  const maxC = cols - 2;
  const blackU32 = SHADE_U32[0][0];
  const grid = state.lightGrid;
  const gridR = state.lightR;
  const gridG = state.lightG;
  const gridB = state.lightB;

  for (let sy = 0; sy < vh; sy++) {
    const wy = camIntY + sy;
    const outRow = sy * vw;
    if (wy < 0 || wy >= mh) {
      outU32.fill(blackU32, outRow, outRow + vw);
      continue;
    }

    const mapRow = wy * mw;
    const gy = wy * INV_CELL_PX;
    let r0 = gy | 0;
    if (r0 > maxR) r0 = maxR;
    const fy = gy - r0;
    const row0 = r0 * cols;
    const row1 = (r0 + 1) * cols;
    const bayerRow = (wy & 3) << 2;

    for (let sx = 0; sx < vw; sx++) {
      const wx = camIntX + sx;
      if (wx < 0 || wx >= mw) {
        outU32[outRow + sx] = blackU32;
        continue;
      }

      const gx = wx * INV_CELL_PX;
      let c0 = gx | 0;
      if (c0 > maxC) c0 = maxC;
      const fx = gx - c0;

      const i00 = row0 + c0;
      const i10 = i00 + 1;
      const i01 = row1 + c0;
      const i11 = i01 + 1;

      const top = grid[i00] + (grid[i10] - grid[i00]) * fx;
      const bot = grid[i01] + (grid[i11] - grid[i01]) * fx;
      const lightVal = top + (bot - top) * fy;

      if (lightVal <= 0.12) {
        outU32[outRow + sx] = blackU32;
        continue;
      }

      let band = lightVal | 0;
      const frac = lightVal - band;
      const threshold = BAYER_4X4[bayerRow + (wx & 3)];
      if (frac > threshold && band < MAX_LIGHT_BAND) {
        band++;
      }
      if (band <= 0) {
        outU32[outRow + sx] = blackU32;
        continue;
      }
      if (band > MAX_LIGHT_BAND) band = MAX_LIGHT_BAND;

      const basePalIdx = mapIdx[mapRow + wx];
      if (basePalIdx === 0) {
        outU32[outRow + sx] = blackU32;
        continue;
      }

      const baseU32 = SHADE_U32[band][basePalIdx];

      if (gridR[i00] === 0 && gridR[i10] === 0 && gridR[i01] === 0 && gridR[i11] === 0 &&
          gridG[i00] === 0 && gridG[i10] === 0 && gridG[i01] === 0 && gridG[i11] === 0 &&
          gridB[i00] === 0 && gridB[i10] === 0 && gridB[i01] === 0 && gridB[i11] === 0) {
        outU32[outRow + sx] = baseU32;
      } else {
        const tr = gridR[i00] + (gridR[i10] - gridR[i00]) * fx;
        const br = gridR[i01] + (gridR[i11] - gridR[i01]) * fx;
        const cr = (tr + (br - tr) * fy) | 0;

        const tg = gridG[i00] + (gridG[i10] - gridG[i00]) * fx;
        const bg = gridG[i01] + (gridG[i11] - gridG[i01]) * fx;
        const cg = (tg + (bg - tg) * fy) | 0;

        const tb = gridB[i00] + (gridB[i10] - gridB[i00]) * fx;
        const bb = gridB[i01] + (gridB[i11] - gridB[i01]) * fx;
        const cb = (tb + (bb - tb) * fy) | 0;

        if ((cr | cg | cb) === 0) {
          outU32[outRow + sx] = baseU32;
        } else {
          const r0Col = baseU32 & 255;
          const g0Col = (baseU32 >> 8) & 255;
          const b0Col = (baseU32 >> 16) & 255;

          const r = Math.min(255, (r0Col + cr * Math.max(0.2, 1.0 - r0Col / 280.0)) | 0);
          const g = Math.min(255, (g0Col + cg * Math.max(0.2, 1.0 - g0Col / 280.0)) | 0);
          const b = Math.min(255, (b0Col + cb * Math.max(0.2, 1.0 - b0Col / 280.0)) | 0);

          outU32[outRow + sx] = packABGR(r, g, b);
        }
      }
    }
  }

  pCtx.putImageData(state.imageData, 0, 0);
}
