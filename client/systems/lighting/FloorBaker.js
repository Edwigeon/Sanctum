/**
 * Dungeon Floor Palette Baker
 * Bakes 0..15 palette indices for walls (convex/concave masonry corners), stairs, and D4-permuted floors.
 */

import { ENGINE, TILES, PALETTE_INDEX } from '../../../shared/Constants.js';
import { CELL_PX } from './LightingTables.js';
import { buildMergedWallSegments } from './VisibilityOcclusion.js';

export function bakeDungeonFloor(state, dungeon, sprites = null) {
  state.clearStaticWorld();
  if (!dungeon) {
    state.mapIndices = null;
    state.opaqueTiles = null;
    state.lightGrid = null;
    state.wallSegments = [];
    return;
  }

  const ts = ENGINE.TILE_SIZE;
  state.tileCols = dungeon.width;
  state.tileRows = dungeon.height;
  state.mapIndexW = dungeon.width * ts;
  state.mapIndexH = dungeon.height * ts;
  state.mapIndices = new Uint8Array(state.mapIndexW * state.mapIndexH);
  state.opaqueTiles = new Uint8Array(state.tileCols * state.tileRows);

  state.gridCols = Math.ceil(state.mapIndexW / CELL_PX) + 1;
  state.gridRows = Math.ceil(state.mapIndexH / CELL_PX) + 1;
  const totalCells = state.gridCols * state.gridRows;
  state.lightGrid = new Float32Array(totalCells);
  state.lightR = new Float32Array(totalCells);
  state.lightG = new Float32Array(totalCells);
  state.lightB = new Float32Array(totalCells);

  const fillRectIdx = (x, y, w, h, palIdx) => {
    const xEnd = Math.min(state.mapIndexW, x + w);
    const yEnd = Math.min(state.mapIndexH, y + h);
    for (let py = Math.max(0, y); py < yEnd; py++) {
      const rowOff = py * state.mapIndexW;
      for (let px = Math.max(0, x); px < xEnd; px++) {
        state.mapIndices[rowOff + px] = palIdx;
      }
    }
  };

  const stampTileSprite = (tx, ty, spr, frameIdx = 0, rot90 = 0, flipX = false) => {
    const st = spr.getState ? spr.getState('idle') : spr;
    const frames = st?.frames || spr.frames;
    if (!frames || frames.length === 0) return;
    const frame = frames[frameIdx % frames.length];
    const sw = Math.min(ts, spr.w);
    const sh = Math.min(ts, spr.h);
    const rot = rot90 & 3;
    for (let py = 0; py < sh; py++) {
      const wy = ty + py;
      if (wy < 0 || wy >= state.mapIndexH) continue;
      const mapRow = wy * state.mapIndexW;
      for (let px = 0; px < sw; px++) {
        let sx = flipX ? (sw - 1 - px) : px;
        let sy = py;
        if (rot === 1) {
          const tmp = sx;
          sx = sy;
          sy = sw - 1 - tmp;
        } else if (rot === 2) {
          sx = sw - 1 - sx;
          sy = sh - 1 - sy;
        } else if (rot === 3) {
          const tmp = sx;
          sx = sh - 1 - sy;
          sy = tmp;
        }
        const palIdx = frame[sy * spr.w + sx];
        if (palIdx === 255) continue;
        const wx = tx + px;
        if (wx >= 0 && wx < state.mapIndexW) {
          state.mapIndices[mapRow + wx] = palIdx;
        }
      }
    }
  };

  const wallFrontSpr = sprites?.get('tiles', 'wall_front') || sprites?.get('tiles', 'wall_brick');
  const wallTopSpr = sprites?.get('tiles', 'wall_top') || wallFrontSpr;
  const wallSideSpr = sprites?.get('tiles', 'wall_side') || wallFrontSpr;
  const wallCornerSpr = sprites?.get('tiles', 'wall_corner') || wallFrontSpr;
  const floorSpr = sprites?.get('tiles', 'floor_stone');
  const stairsSpr = sprites?.get('tiles', 'stairs_down');

  const isOpenTile = (r, c) => {
    if (r < 0 || r >= dungeon.height || c < 0 || c >= dungeon.width) return false;
    const val = dungeon.map[r][c];
    return val !== TILES.WALL && val !== TILES.EMPTY;
  };

  for (let r = 0; r < dungeon.height; r++) {
    const row = dungeon.map[r];
    const rotRow = dungeon.tileRot?.[r];
    const ty = r * ts;
    const tileRowOff = r * state.tileCols;
    for (let c = 0; c < dungeon.width; c++) {
      const t = row[c];
      const tx = c * ts;
      const explicitRot = rotRow ? (rotRow[c] || 0) : -1;
      state.opaqueTiles[tileRowOff + c] = (t === TILES.WALL || t === TILES.EMPTY) ? 1 : 0;

      if (t === TILES.WALL) {
        if (wallFrontSpr?.frames?.length) {
          const openN = isOpenTile(r - 1, c);
          const openS = isOpenTile(r + 1, c);
          const openW = isOpenTile(r, c - 1);
          const openE = isOpenTile(r, c + 1);

          let chosenSpr = wallFrontSpr;
          let variant = 0;
          let rot = 0;
          let flip = false;

          if (openS && openE && !openN && !openW) {
            chosenSpr = wallCornerSpr || wallFrontSpr;
            variant = 0;
          } else if (openS && openW && !openN && !openE) {
            chosenSpr = wallCornerSpr || wallFrontSpr;
            variant = 1;
          } else if (openN && openE && !openS && !openW) {
            chosenSpr = wallCornerSpr || wallTopSpr;
            variant = 2;
          } else if (openN && openW && !openS && !openE) {
            chosenSpr = wallCornerSpr || wallTopSpr;
            variant = 3;
          } else if (openN && openS) {
            chosenSpr = wallFrontSpr;
            variant = (r * 13 + c * 29) % chosenSpr.frames.length;
          } else if (openS) {
            chosenSpr = wallFrontSpr;
            variant = (r * 13 + c * 29) % chosenSpr.frames.length;
          } else if (openN) {
            chosenSpr = wallTopSpr;
            variant = (r * 13 + c * 29) % chosenSpr.frames.length;
          } else if (openE) {
            chosenSpr = wallSideSpr;
            variant = (r * 13 + c * 29) % chosenSpr.frames.length;
            flip = false;
          } else if (openW) {
            chosenSpr = wallSideSpr;
            variant = (r * 13 + c * 29) % chosenSpr.frames.length;
            flip = true;
          } else {
            const openSE = isOpenTile(r + 1, c + 1);
            const openSW = isOpenTile(r + 1, c - 1);
            const openNE = isOpenTile(r - 1, c + 1);
            const openNW = isOpenTile(r - 1, c - 1);

            if (openSE) {
              chosenSpr = wallCornerSpr || wallFrontSpr;
              variant = 4;
            } else if (openSW) {
              chosenSpr = wallCornerSpr || wallFrontSpr;
              variant = 5;
            } else if (openNE) {
              chosenSpr = wallCornerSpr || wallTopSpr;
              variant = 6;
            } else if (openNW) {
              chosenSpr = wallCornerSpr || wallTopSpr;
              variant = 7;
            } else {
              chosenSpr = wallFrontSpr;
              variant = 0;
            }
          }

          if (explicitRot >= 0) {
            rot = explicitRot & 3;
            flip = (explicitRot & 4) !== 0;
          }

          const frameCount = chosenSpr.frames?.length || chosenSpr.variants?.length || 1;
          const finalVar = variant % frameCount;
          stampTileSprite(tx, ty, chosenSpr, finalVar, rot, flip);
        } else {
          fillRectIdx(tx, ty, ts, ts, PALETTE_INDEX.DARK_GRAY);
          fillRectIdx(tx, ty, ts - 1, 2, PALETTE_INDEX.INDIGO);
          fillRectIdx(tx, ty + 6, ts, 1, PALETTE_INDEX.DARK_BLUE);
          fillRectIdx(tx + ((r & 1) ? 5 : 3), ty + 2, 1, 4, PALETTE_INDEX.DARK_BLUE);
          fillRectIdx(tx + ((r & 1) ? 9 : 7), ty + 7, 1, 5, PALETTE_INDEX.DARK_BLUE);
        }
      } else if (t === TILES.STAIRS_DOWN) {
        if (stairsSpr?.frames?.length) {
          const rot = explicitRot >= 0 ? (explicitRot & 3) : (stairsSpr.allowRotate ? (((r * 37 + c * 73) ^ (r * 17)) & 3) : 0);
          const flip = explicitRot >= 0 ? ((explicitRot & 4) !== 0) : false;
          stampTileSprite(tx, ty, stairsSpr, 0, rot, flip);
        } else {
          fillRectIdx(tx, ty, ts, ts, PALETTE_INDEX.DARK_BLUE);
          fillRectIdx(tx + 2, ty + 2, ts - 4, ts - 4, PALETTE_INDEX.ORANGE);
          fillRectIdx(tx + 4, ty + 4, ts - 8, ts - 8, PALETTE_INDEX.YELLOW);
        }
      } else if (t !== TILES.EMPTY) {
        if (floorSpr?.frames?.length) {
          const rot = explicitRot >= 0 ? (explicitRot & 3) : (floorSpr.allowRotate ? (((r * 37 + c * 73) ^ (r * 17)) & 3) : 0);
          const flip = explicitRot >= 0 ? ((explicitRot & 4) !== 0) : (floorSpr.allowFlip ? (((r * 53 + c * 89) & 1) !== 0) : false);
          const variant = (r * 13 + c * 29) % floorSpr.frames.length;
          stampTileSprite(tx, ty, floorSpr, variant, rot, flip);
        } else {
          fillRectIdx(tx, ty, ts, ts, PALETTE_INDEX.INDIGO);
          const hash = (r * 37 + c * 73) & 7;
          if (hash === 0) {
            fillRectIdx(tx + 2, ty + 2, 3, 1, PALETTE_INDEX.DARK_GRAY);
          } else if (hash === 3) {
            fillRectIdx(tx + 7, ty + 8, 2, 1, PALETTE_INDEX.DARK_BLUE);
          } else if (hash === 5) {
            fillRectIdx(tx + 4, ty + 6, 1, 1, PALETTE_INDEX.BLACK);
          }
        }
      }
    }
  }

  buildMergedWallSegments(state);

  if (dungeon.exitPoint) {
    state.setStaticLight('stairs_down', {
      x: dungeon.exitPoint.x * ts + ts / 2,
      y: dungeon.exitPoint.y * ts + ts / 2,
      radius: 36,
      intensity: 6.5,
      color: PALETTE_INDEX.YELLOW,
      enabled: true,
      los: true
    });
  }
}
