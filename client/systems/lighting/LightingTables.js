/**
 * Precomputed Lighting Shade Tables, Bayer Dithering Matrix, and Color Packing Utilities
 */

import { ENGINE, PALETTE_INDEX, PALETTE_RGB } from '../../../shared/Constants.js';

export const MAX_LIGHT_BAND = 8;

// Sub-tile lighting grid spacing (3px world grid, bilinearly interpolated per 1x1 pixel)
export const CELL_PX = 3;
export const INV_CELL_PX = 1 / CELL_PX;
export const INV_TILE_SIZE = 1 / ENGINE.TILE_SIZE;

export function packABGR(r, g, b) {
  const cr = Math.max(0, Math.min(255, r | 0));
  const cg = Math.max(0, Math.min(255, g | 0));
  const cb = Math.max(0, Math.min(255, b | 0));
  return ((255 << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
}

export function parseHexRGB(hexStr, fallback = PALETTE_RGB[PALETTE_INDEX.ORANGE]) {
  if (!hexStr || typeof hexStr !== 'string') return fallback;
  const h = hexStr.startsWith('#') ? hexStr.slice(1) : hexStr;
  if (h.length !== 6) return fallback;
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0
  ];
}

/**
 * Resolves a light color from a 16-color palette index (0..15), palette name ('BLUE', 'YELLOW', etc.),
 * hex string ('#29ADFF'), or [r, g, b] array.
 */
export function resolveColorRGB(color) {
  if (typeof color === 'number' && color >= 0 && color < 16) {
    return PALETTE_RGB[color | 0];
  }
  if (Array.isArray(color) && color.length >= 3) {
    return color;
  }
  if (typeof color === 'string') {
    const idx = PALETTE_INDEX[color.toUpperCase()];
    if (idx !== undefined) return PALETTE_RGB[idx];
    return parseHexRGB(color, PALETTE_RGB[PALETTE_INDEX.ORANGE]);
  }
  return PALETTE_RGB[PALETTE_INDEX.ORANGE];
}

// Precomputed 9-band warm torchlight shade table (0 = Pitch Black .. 8 = Full Torch Core)
export const SHADE_U32 = Array.from({ length: MAX_LIGHT_BAND + 1 }, () => new Uint32Array(16));

for (let band = 0; band <= MAX_LIGHT_BAND; band++) {
  const t = band / MAX_LIGHT_BAND;
  for (let idx = 0; idx < 16; idx++) {
    if (band === 0 || idx === 0) {
      SHADE_U32[band][idx] = packABGR(0, 0, 0);
      continue;
    }
    const [br, bg, bb] = PALETTE_RGB[idx];
    const brightness = Math.pow(t, 0.92);
    const warmGlow = Math.pow(t, 2.0);
    const twilightTint = Math.sin(t * Math.PI);

    let r = br * brightness + warmGlow * 22 + twilightTint * 16;
    let g = bg * brightness + warmGlow * 10 + twilightTint * 3;
    let b = bb * brightness + warmGlow * 2 + twilightTint * 14;

    if (idx === PALETTE_INDEX.DARK_BLUE) {
      r += warmGlow * 16 + twilightTint * 8;
      g += warmGlow * 12 + twilightTint * 4;
      b += warmGlow * 18;
    }
    SHADE_U32[band][idx] = packABGR(r, g, b);
  }
}

// 4x4 Ordered Bayer Matrix (normalized 0..15 -> 0.0..0.9375) evaluated at 1x1 world-pixel resolution
export const BAYER_4X4 = new Float32Array([
   0 / 16,  8 / 16,  2 / 16, 10 / 16,
  12 / 16,  4 / 16, 14 / 16,  6 / 16,
   3 / 16, 11 / 16,  1 / 16,  9 / 16,
  15 / 16,  7 / 16, 13 / 16,  5 / 16
]);
