import { ENGINE, TILES, PALETTE, PALETTE_INDEX, PALETTE_RGB } from '../../shared/Constants.js';

export const MAX_LIGHT_BAND = 8;

function packABGR(r, g, b) {
  const cr = Math.max(0, Math.min(255, r | 0));
  const cg = Math.max(0, Math.min(255, g | 0));
  const cb = Math.max(0, Math.min(255, b | 0));
  return ((255 << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
}

function parseHexRGB(hexStr, fallback = PALETTE_RGB[PALETTE_INDEX.ORANGE]) {
  if (!hexStr || typeof hexStr !== 'string') return fallback;
  const h = hexStr.startsWith('#') ? hexStr.slice(1) : hexStr;
  if (h.length !== 6) return fallback;
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0
  ];
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

// Sub-tile lighting grid spacing (3px world grid, bilinearly interpolated per 1x1 pixel)
const CELL_PX = 3;
const INV_CELL_PX = 1 / CELL_PX;
const INV_TILE_SIZE = 1 / ENGINE.TILE_SIZE;

export class LightingSystem {
  constructor(viewWidth = 242, viewHeight = 146) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.imageData = new ImageData(viewWidth, viewHeight);
    this.pixelU32 = new Uint32Array(this.imageData.data.buffer);

    // Scratch offscreen canvas (up to 64x64 high-resolution entity size) for stamping dither-lit entities onto highResCanvas
    // at exact subpixel screen coordinates with zero internal grid seams and zero low-res snapping jitter
    this.maxStampW = 64;
    this.maxStampH = 64;
    this.stampCanvas = document.createElement('canvas');
    this.stampCanvas.width = this.maxStampW;
    this.stampCanvas.height = this.maxStampH;
    this.stampCtx = this.stampCanvas.getContext('2d');
    this.stampImageData = this.stampCtx.createImageData(this.maxStampW, this.maxStampH);
    this.stampU32 = new Uint32Array(this.stampImageData.data.buffer);

    this.gridCols = 0;
    this.gridRows = 0;
    this.lightGrid = null;
    this.lightR = null;
    this.lightG = null;
    this.lightB = null;

    this.activeMinC = 0;
    this.activeMaxC = 0;
    this.activeMinR = 0;
    this.activeMaxR = 0;

    this.tileCols = 0;
    this.tileRows = 0;
    this.opaqueTiles = null;

    // Merged continuous wall boundary segments & static object occluders
    this.wallSegments = [];
    this.staticOccluders = new Map();

    this.mapIndexW = 0;
    this.mapIndexH = 0;
    this.mapIndices = null;

    this.ambientLight = 0.0;
    this.targetAmbientLight = 0.0;
    this.playerTorchEnabled = true;
    this.flickerTime = 0.0;
    this.staticLights = new Map();
  }

  /**
   * Resolves a light color from a 16-color palette index (0..15), palette name ('BLUE', 'YELLOW', etc.),
   * hex string ('#29ADFF'), or [r, g, b] array.
   */
  resolveColorRGB(color) {
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

  setAmbientLight(level, immediate = false) {
    this.targetAmbientLight = Math.max(0, Math.min(MAX_LIGHT_BAND, level));
    if (immediate) this.ambientLight = this.targetAmbientLight;
  }

  togglePlayerTorch(forceState) {
    this.playerTorchEnabled = typeof forceState === 'boolean' ? forceState : !this.playerTorchEnabled;
    return this.playerTorchEnabled;
  }

  setStaticLight(id, { x, y, radius = 48, intensity = 6.8, color = PALETTE_INDEX.ORANGE, enabled = true, los = true }) {
    const rgb = this.resolveColorRGB(color);
    const isColored = color !== PALETTE_INDEX.ORANGE && color !== 'ORANGE';
    this.staticLights.set(id, { id, x, y, radius, intensity, rgb, isColored, enabled, los });
  }

  toggleStaticLight(id, enabled) {
    const l = this.staticLights.get(id);
    if (!l) return false;
    l.enabled = typeof enabled === 'boolean' ? enabled : !l.enabled;
    return l.enabled;
  }

  setStaticOccluder(id, { x, y, radius = 4.5, enabled = true }) {
    this.staticOccluders.set(id, { id, x, y, radius, enabled });
  }

  toggleStaticOccluder(id, enabled) {
    const occ = this.staticOccluders.get(id);
    if (!occ) return false;
    occ.enabled = typeof enabled === 'boolean' ? enabled : !occ.enabled;
    return occ.enabled;
  }

  clearStaticWorld() {
    this.staticLights.clear();
    this.staticOccluders.clear();
  }

  isOpaqueRC(r, c) {
    if (r < 0 || r >= this.tileRows || c < 0 || c >= this.tileCols) return 1;
    return this.opaqueTiles[r * this.tileCols + c];
  }

  /**
   * Merges all exposed edges of adjacent 12x12 wall tiles into single continuous mathematical line segments.
   */
  buildMergedWallSegments() {
    this.wallSegments = [];
    const ts = ENGINE.TILE_SIZE;
    const rows = this.tileRows;
    const cols = this.tileCols;

    for (let r = 0; r < rows; r++) {
      if (r > 0) {
        let runStart = -1;
        for (let c = 0; c <= cols; c++) {
          const isEdge = c < cols && this.isOpaqueRC(r, c) === 1 && this.isOpaqueRC(r - 1, c) === 0;
          if (isEdge && runStart === -1) {
            runStart = c;
          } else if (!isEdge && runStart !== -1) {
            const x1 = runStart * ts;
            const x2 = c * ts;
            const y = r * ts;
            this.wallSegments.push({ x1, y1: y, x2, y2: y, nx: 0, ny: -1, minX: x1, maxX: x2, minY: y, maxY: y });
            runStart = -1;
          }
        }
      }
      if (r < rows - 1) {
        let runStart = -1;
        for (let c = 0; c <= cols; c++) {
          const isEdge = c < cols && this.isOpaqueRC(r, c) === 1 && this.isOpaqueRC(r + 1, c) === 0;
          if (isEdge && runStart === -1) {
            runStart = c;
          } else if (!isEdge && runStart !== -1) {
            const x1 = runStart * ts;
            const x2 = c * ts;
            const y = (r + 1) * ts;
            this.wallSegments.push({ x1, y1: y, x2, y2: y, nx: 0, ny: 1, minX: x1, maxX: x2, minY: y, maxY: y });
            runStart = -1;
          }
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      if (c > 0) {
        let runStart = -1;
        for (let r = 0; r <= rows; r++) {
          const isEdge = r < rows && this.isOpaqueRC(r, c) === 1 && this.isOpaqueRC(r, c - 1) === 0;
          if (isEdge && runStart === -1) {
            runStart = r;
          } else if (!isEdge && runStart !== -1) {
            const y1 = runStart * ts;
            const y2 = r * ts;
            const x = c * ts;
            this.wallSegments.push({ x1: x, y1, x2: x, y2, nx: -1, ny: 0, minX: x, maxX: x, minY: y1, maxY: y2 });
            runStart = -1;
          }
        }
      }
      if (c < cols - 1) {
        let runStart = -1;
        for (let r = 0; r <= rows; r++) {
          const isEdge = r < rows && this.isOpaqueRC(r, c) === 1 && this.isOpaqueRC(r, c + 1) === 0;
          if (isEdge && runStart === -1) {
            runStart = r;
          } else if (!isEdge && runStart !== -1) {
            const y1 = runStart * ts;
            const y2 = r * ts;
            const x = (c + 1) * ts;
            this.wallSegments.push({ x1: x, y1, x2: x, y2, nx: 1, ny: 0, minX: x, maxX: x, minY: y1, maxY: y2 });
            runStart = -1;
          }
        }
      }
    }
  }

  /**
   * Bakes the floor's 0..15 palette indices (using SpriteRegistry tiles when loaded) and builds merged wall segments.
   */
  bakeFloorIndices(dungeon, sprites = null) {
    this.clearStaticWorld();
    if (!dungeon) {
      this.mapIndices = null;
      this.opaqueTiles = null;
      this.lightGrid = null;
      this.wallSegments = [];
      return;
    }

    const ts = ENGINE.TILE_SIZE;
    this.tileCols = dungeon.width;
    this.tileRows = dungeon.height;
    this.mapIndexW = dungeon.width * ts;
    this.mapIndexH = dungeon.height * ts;
    this.mapIndices = new Uint8Array(this.mapIndexW * this.mapIndexH);
    this.opaqueTiles = new Uint8Array(this.tileCols * this.tileRows);

    this.gridCols = Math.ceil(this.mapIndexW / CELL_PX) + 1;
    this.gridRows = Math.ceil(this.mapIndexH / CELL_PX) + 1;
    const totalCells = this.gridCols * this.gridRows;
    this.lightGrid = new Float32Array(totalCells);
    this.lightR = new Float32Array(totalCells);
    this.lightG = new Float32Array(totalCells);
    this.lightB = new Float32Array(totalCells);

    const fillRectIdx = (x, y, w, h, palIdx) => {
      const xEnd = Math.min(this.mapIndexW, x + w);
      const yEnd = Math.min(this.mapIndexH, y + h);
      for (let py = Math.max(0, y); py < yEnd; py++) {
        const rowOff = py * this.mapIndexW;
        for (let px = Math.max(0, x); px < xEnd; px++) {
          this.mapIndices[rowOff + px] = palIdx;
        }
      }
    };

    const stampTileSprite = (tx, ty, spr, frameIdx = 0, rot90 = 0, flipX = false) => {
      const state = spr.getState ? spr.getState('idle') : spr;
      const frames = state?.frames || spr.frames;
      if (!frames || frames.length === 0) return;
      const frame = frames[frameIdx % frames.length];
      const sw = Math.min(ts, spr.w);
      const sh = Math.min(ts, spr.h);
      const rot = rot90 & 3;
      for (let py = 0; py < sh; py++) {
        const wy = ty + py;
        if (wy < 0 || wy >= this.mapIndexH) continue;
        const mapRow = wy * this.mapIndexW;
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
          if (wx >= 0 && wx < this.mapIndexW) {
            this.mapIndices[mapRow + wx] = palIdx;
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
      const tileRowOff = r * this.tileCols;
      for (let c = 0; c < dungeon.width; c++) {
        const t = row[c];
        const tx = c * ts;
        const explicitRot = rotRow ? (rotRow[c] || 0) : -1;
        this.opaqueTiles[tileRowOff + c] = (t === TILES.WALL || t === TILES.EMPTY) ? 1 : 0;

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

            // Smart Wall Selection & Zero-Rotation Corners:
            // Masonry courses ALWAYS remain horizontal (rot = 0).
            // Convex Corners: Left Pier (var 0), Right Pier (var 1), Bottom-Left Pier (var 2), Bottom-Right Pier (var 3).
            // Concave Corners: Top-Left Interior (var 4), Top-Right Interior (var 5), Bottom-Left Interior (var 6), Bottom-Right Interior (var 7).
            if (openS && openE && !openN && !openW) {
              // Left Door Pier / Convex corner facing South and East
              chosenSpr = wallCornerSpr || wallFrontSpr;
              variant = 0;
            } else if (openS && openW && !openN && !openE) {
              // Right Door Pier / Convex corner facing South and West
              chosenSpr = wallCornerSpr || wallFrontSpr;
              variant = 1;
            } else if (openN && openE && !openS && !openW) {
              // Bottom-Left Door Pier / Convex corner facing North and East
              chosenSpr = wallCornerSpr || wallTopSpr;
              variant = 2;
            } else if (openN && openW && !openS && !openE) {
              // Bottom-Right Door Pier / Convex corner facing North and West
              chosenSpr = wallCornerSpr || wallTopSpr;
              variant = 3;
            } else if (openN && openS) {
              // Wall separating two rooms vertically (front wall with open floor on both sides)
              chosenSpr = wallFrontSpr;
              variant = (r * 13 + c * 29) % chosenSpr.frames.length;
            } else if (openS) {
              // Wall above a room (facing South into the floor - classic front face)
              chosenSpr = wallFrontSpr;
              variant = (r * 13 + c * 29) % chosenSpr.frames.length;
            } else if (openN) {
              // Wall below a room (facing North into the floor - horizontal top cap)
              chosenSpr = wallTopSpr;
              variant = (r * 13 + c * 29) % chosenSpr.frames.length;
            } else if (openE) {
              // Wall on left-hand side of floor -> faces East into room
              chosenSpr = wallSideSpr;
              variant = (r * 13 + c * 29) % chosenSpr.frames.length;
              flip = false; // Shadow on left (x=0..3), stone face, bevel on right (x=10..11)
            } else if (openW) {
              // Wall on right-hand side of floor -> faces West into room
              chosenSpr = wallSideSpr;
              variant = (r * 13 + c * 29) % chosenSpr.frames.length;
              flip = true; // Flipped: bevel on left (x=0..1), stone face, shadow on right (x=8..11)
            } else {
              // Check Concave (Interior Room) Corners
              const openSE = isOpenTile(r + 1, c + 1);
              const openSW = isOpenTile(r + 1, c - 1);
              const openNE = isOpenTile(r - 1, c + 1);
              const openNW = isOpenTile(r - 1, c - 1);

              if (openSE) {
                // Top-Left inside corner of a room: front wall meets left side wall
                chosenSpr = wallCornerSpr || wallFrontSpr;
                variant = 4;
              } else if (openSW) {
                // Top-Right inside corner of a room: front wall meets right side wall
                chosenSpr = wallCornerSpr || wallFrontSpr;
                variant = 5;
              } else if (openNE) {
                // Bottom-Left inside corner of a room: bottom cap wall meets left side wall
                chosenSpr = wallCornerSpr || wallTopSpr;
                variant = 6;
              } else if (openNW) {
                // Bottom-Right inside corner of a room: bottom cap wall meets right side wall
                chosenSpr = wallCornerSpr || wallTopSpr;
                variant = 7;
              } else {
                // Fully interior hidden wall or void border
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
            // Full D4 dihedral symmetry (8-way permutation) for natural stone texture variety
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

    this.buildMergedWallSegments();

    if (dungeon.exitPoint) {
      this.setStaticLight('stairs_down', {
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

  getWallSurfaceDepth(tx, ty, tc, tr) {
    const ts = ENGINE.TILE_SIZE;
    const localX = tx - tc * ts;
    const localY = ty - tr * ts;
    let minDepth = 16.0;

    if (!this.isOpaqueRC(tr + 1, tc)) minDepth = Math.min(minDepth, ts - localY);
    if (!this.isOpaqueRC(tr - 1, tc)) minDepth = Math.min(minDepth, localY);
    if (!this.isOpaqueRC(tr, tc + 1)) minDepth = Math.min(minDepth, ts - localX);
    if (!this.isOpaqueRC(tr, tc - 1)) minDepth = Math.min(minDepth, localX);

    if (minDepth > 12.0) {
      if (!this.isOpaqueRC(tr + 1, tc + 1)) minDepth = Math.min(minDepth, Math.hypot(ts - localX, ts - localY));
      if (!this.isOpaqueRC(tr + 1, tc - 1)) minDepth = Math.min(minDepth, Math.hypot(localX, ts - localY));
      if (!this.isOpaqueRC(tr - 1, tc + 1)) minDepth = Math.min(minDepth, Math.hypot(ts - localX, localY));
      if (!this.isOpaqueRC(tr - 1, tc - 1)) minDepth = Math.min(minDepth, Math.hypot(localX, localY));
    }
    return minDepth;
  }

  checkStaticObjectOcclusion(sx, sy, tx, ty, dist) {
    if (this.staticOccluders.size === 0 || dist < 4) return 1.0;
    const dirX = (tx - sx) / dist;
    const dirY = (ty - sy) / dist;

    for (const occ of this.staticOccluders.values()) {
      if (!occ.enabled) continue;
      const vx = occ.x - sx;
      const vy = occ.y - sy;
      const proj = vx * dirX + vy * dirY;
      if (proj <= occ.radius || proj >= dist - occ.radius * 0.5) continue;

      const perp = Math.abs(vx * dirY - vy * dirX);
      if (perp < occ.radius) {
        if (perp > occ.radius * 0.65) {
          return (perp - occ.radius * 0.65) / (occ.radius * 0.35);
        }
        return 0.0;
      }
    }
    return 1.0;
  }

  /**
   * Exact Analytical Ray-Segment Visibility against Merged Continuous Wall Segments.
   */
  computeVisibility(sx, sy, tx, ty) {
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) return 1.0;

    const targetCol = (tx * INV_TILE_SIZE) | 0;
    const targetRow = (ty * INV_TILE_SIZE) | 0;
    const targetIsWall = this.isOpaqueRC(targetRow, targetCol) === 1;

    let wallSurfaceFade = 1.0;
    if (targetIsWall) {
      const surfaceDepth = this.getWallSurfaceDepth(tx, ty, targetCol, targetRow);
      if (surfaceDepth > 11.0) return 0.0;
      wallSurfaceFade = 1.0 - Math.max(0, (surfaceDepth - 3.0) / 8.0);
      if (wallSurfaceFade <= 0.0) return 0.0;
    }

    const objVis = this.checkStaticObjectOcclusion(sx, sy, tx, ty, dist);
    if (objVis <= 0.0) return 0.0;

    const rayMinX = sx < tx ? sx : tx;
    const rayMaxX = sx > tx ? sx : tx;
    const rayMinY = sy < ty ? sy : ty;
    const rayMaxY = sy > ty ? sy : ty;

    const selfWallMinT = targetIsWall ? Math.max(0, 1.0 - 15.0 / dist) : 1.0;
    const segs = this.wallSegments;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.maxX < rayMinX || seg.minX > rayMaxX || seg.maxY < rayMinY || seg.minY > rayMaxY) {
        continue;
      }

      if (seg.ny !== 0) {
        if (Math.abs(dy) < 1e-5) continue;
        const t = (seg.y1 - sy) / dy;
        if (t <= 0.001 || t >= 0.999) continue;
        const ix = sx + t * dx;
        if (ix < seg.x1 - 0.01 || ix > seg.x2 + 0.01) continue;

        if (!targetIsWall) return 0.0;
        if (dy * seg.ny > 0 || t < selfWallMinT) return 0.0;
      } else {
        if (Math.abs(dx) < 1e-5) continue;
        const t = (seg.x1 - sx) / dx;
        if (t <= 0.001 || t >= 0.999) continue;
        const iy = sy + t * dy;
        if (iy < seg.y1 - 0.01 || iy > seg.y2 + 0.01) continue;

        if (!targetIsWall) return 0.0;
        if (dx * seg.nx > 0 || t < selfWallMinT) return 0.0;
      }
    }

    return wallSurfaceFade * objVis;
  }

  /**
   * Evaluates the world-anchored lightGrid + additive RGB light accumulators within the active viewport.
   */
  updateLightGrid({ dt, dungeon, camIntX, camIntY, interp, myPlayerId }) {
    if (this.ambientLight !== this.targetAmbientLight) {
      const step = dt * 2.5;
      if (Math.abs(this.targetAmbientLight - this.ambientLight) <= step) {
        this.ambientLight = this.targetAmbientLight;
      } else {
        this.ambientLight += Math.sign(this.targetAmbientLight - this.ambientLight) * step;
      }
    }

    if (!dungeon || !this.lightGrid) return;

    const cols = this.gridCols;
    const rows = this.gridRows;

    this.activeMinC = Math.max(0, ((camIntX * INV_CELL_PX) | 0) - 2);
    this.activeMaxC = Math.min(cols - 1, (((camIntX + this.viewWidth) * INV_CELL_PX) | 0) + 2);
    this.activeMinR = Math.max(0, ((camIntY * INV_CELL_PX) | 0) - 2);
    this.activeMaxR = Math.min(rows - 1, (((camIntY + this.viewHeight) * INV_CELL_PX) | 0) + 2);

    const amb = this.ambientLight;
    for (let r = this.activeMinR; r <= this.activeMaxR; r++) {
      const start = r * cols + this.activeMinC;
      const end = r * cols + this.activeMaxC + 1;
      this.lightGrid.fill(amb, start, end);
      this.lightR.fill(0, start, end);
      this.lightG.fill(0, start, end);
      this.lightB.fill(0, start, end);
    }

    const lights = [];
    this.flickerTime = (this.flickerTime || 0) + (dt || 0.016);
    const ft = this.flickerTime;

    // 1. Players & Co-op Allies (default warm ORANGE torchlight, or custom p.lightColor)
    for (let i = 0; i < interp.players.length; i++) {
      const p = interp.players[i];
      if (p.isDead) continue;
      const isMe = p.id === myPlayerId;
      const rgb = this.resolveColorRGB(p.lightColor ?? PALETTE_INDEX.ORANGE);
      if (isMe && !this.playerTorchEnabled) {
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
        rgb: this.resolveColorRGB(pr.lightColor ?? PALETTE_INDEX.BLUE),
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
          rgb: this.resolveColorRGB(m.lightColor ?? PALETTE_INDEX.RED),
          isColored: true,
          los: true
        });
      }
    }

    // 4. Static & Interactive World Objects (Stairs, Shrines, Braziers, Portals)
    for (const s of this.staticLights.values()) {
      if (!s.enabled) continue;
      // Gentle subtle breathing on static light sources
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
          rgb: this.resolveColorRGB(l.lightColor ?? defaultColor),
          isColored: true,
          los: true
        });
      }
    }

    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      const rad = L.radius;
      const rSq = rad * rad;
      const [lr, lg, lb] = L.rgb;

      const lMinC = Math.max(this.activeMinC, ((L.x - rad) * INV_CELL_PX) | 0);
      const lMaxC = Math.min(this.activeMaxC, (((L.x + rad) * INV_CELL_PX) | 0) + 1);
      const lMinR = Math.max(this.activeMinR, ((L.y - rad) * INV_CELL_PX) | 0);
      const lMaxR = Math.min(this.activeMaxR, (((L.y + rad) * INV_CELL_PX) | 0) + 1);
      if (lMinC > lMaxC || lMinR > lMaxR) continue;

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

          const norm = 1.0 - Math.sqrt(distSq) / rad;
          const rawContrib = L.intensity * Math.pow(norm, 1.32);
          const idx = rowOffset + c;
          if (rawContrib <= 0.05) continue;

          const vis = L.los ? this.computeVisibility(L.x, L.y, wx, wy) : 1.0;
          if (vis <= 0.0) continue;

          const contrib = rawContrib * vis;
          const prevL = this.lightGrid[idx];
          this.lightGrid[idx] = Math.min(MAX_LIGHT_BAND + 1.5, prevL + contrib * Math.max(0.35, 1.0 - prevL / (MAX_LIGHT_BAND + 2.0)));

          if (L.isColored) {
            const cScale = (contrib / MAX_LIGHT_BAND) * 0.48;
            this.lightR[idx] += lr * cScale;
            this.lightG[idx] += lg * cScale;
            this.lightB[idx] += lb * cScale;
          }
        }
      }
    }
  }

  sampleLitPixelU32(wx, wy, basePalIdx) {
    if (basePalIdx === 0) return SHADE_U32[0][0];
    const cols = this.gridCols;
    const maxR = this.gridRows - 2;
    const maxC = cols - 2;
    const grid = this.lightGrid;

    const gx = wx * INV_CELL_PX;
    const gy = wy * INV_CELL_PX;
    if (gx < 0 || gx > cols - 1 || gy < 0 || gy > this.gridRows - 1) return SHADE_U32[0][0];

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
    const gridR = this.lightR;
    const gridG = this.lightG;
    const gridB = this.lightB;

    // Early-out if none of the 4 contributing grid nodes have colored light (avoid float bitwise operations)
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

    // Retrieve unlit base palette color
    const [br0, bg0, bb0] = PALETTE_RGB[basePalIdx];

    // Dampen artificial warm torch glow when illuminated by cool colored light (e.g. blue Spark)
    if (cb > cr + 15) {
      const coolFactor = Math.min(1.0, (cb - cr) / 80.0);
      r0Col = Math.max(br0 * 0.2, r0Col - coolFactor * 18) | 0;
      g0Col = Math.max(bg0 * 0.2, g0Col - coolFactor * 6) | 0;
    }

    // Chromatic diffuse modulation: surface reflects light matching its own pigmentation,
    // preserving rich saturation instead of washing out into flat pastel chalk
    const effR = cr * (0.32 + 0.68 * (br0 / 255.0));
    const effG = cg * (0.32 + 0.68 * (bg0 / 255.0));
    const effB = cb * (0.32 + 0.68 * (bb0 / 255.0));

    // Soft-add highlight compression prevents high-end clipping blowout to flat white
    const r = Math.min(255, (r0Col + effR * Math.max(0.18, 1.0 - r0Col / 270.0)) | 0);
    const g = Math.min(255, (g0Col + effG * Math.max(0.18, 1.0 - g0Col / 270.0)) | 0);
    const b = Math.min(255, (b0Col + effB * Math.max(0.18, 1.0 - b0Col / 270.0)) | 0);

    return packABGR(r, g, b);
  }

  /**
   * Stamps a multi-part or sprite entity into the 24x24 scratch ImageData buffer using per-pixel
   * Bayer-dithered + additive colored lighting, then blits onto hCtx at exact subpixel screen coords.
   */
  drawLitEntityStamp(hCtx, { wx, wy, ox, oy, w, h, rects, camX, camY, scale }) {
    if (!this.lightGrid) return;
    const sw = Math.min(this.maxStampW, w);
    const sh = Math.min(this.maxStampH, h);
    const buf = this.stampU32;
    const stride = this.maxStampW;

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
          const u32 = this.sampleLitPixelU32(worldX, worldY, r.palIdx);
          if (r.palIdx === PALETTE_INDEX.BLACK) {
            if (this.sampleLightAtWorld(worldX, worldY) > 0.12) {
              buf[rowOff + px] = SHADE_U32[0][0];
            }
          } else if (u32 !== SHADE_U32[0][0]) {
            buf[rowOff + px] = u32;
          }
        }
      }
    }

    this.stampCtx.putImageData(this.stampImageData, 0, 0, 0, 0, sw, sh);
    const screenX = (wx + ox - camX) * scale;
    const screenY = (wy + oy - camY) * scale;
    hCtx.drawImage(this.stampCanvas, 0, 0, sw, sh, screenX, screenY, sw * scale, sh * scale);
  }

  /**
   * Stamps a palette-indexed SpriteRegistry frame (with optional flipX and rotation) into the scratch
   * ImageData buffer using per-pixel Bayer-dithered + additive colored lighting, then blits onto hCtx
   * at exact subpixel screen coordinates. Supports scaled high-res sprites (32x32, 32x64) with 2x subpixel density.
   */
  drawLitSpriteStamp(hCtx, { sprite, state = 'idle', frameIdx = 0, wx, wy, camX, camY, scale, flipX = false, rot90 = 0, angleRad = 0 }) {
    if (!this.lightGrid || !sprite) return;
    const st = sprite.getState ? sprite.getState(state) : sprite;
    const frames = st?.frames || sprite.frames;
    if (!frames || frames.length === 0) return;
    const frame = frames[frameIdx % frames.length];
    const sw = Math.min(this.maxStampW, sprite.w);
    const sh = Math.min(this.maxStampH, sprite.h);
    const stride = this.maxStampW;
    const buf = this.stampU32;
    const blackU32 = SHADE_U32[0][0];

    // Compute scaled destination size & offsets
    // Sprites with 32x32 or 32x64 default to renderScale: 0.5 (scaled down to 16x16 or 16x32 world units)
    // allowing double retro pixel density with crisp subpixel lighting & zero collision desync
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
          if (this.sampleLightAtWorld(worldX, worldY) > 0.12) {
            buf[rowOff + px] = blackU32;
          }
        } else {
          const u32 = this.sampleLitPixelU32(worldX, worldY, palIdx);
          if (u32 !== blackU32) {
            buf[rowOff + px] = u32;
          }
        }
      }
    }

    this.stampCtx.putImageData(this.stampImageData, 0, 0, 0, 0, sw, sh);
    const screenX = (wx + ox - camX) * scale;
    const screenY = (wy + oy - camY) * scale;
    hCtx.drawImage(this.stampCanvas, 0, 0, sw, sh, screenX, screenY, destW * scale, destH * scale);
  }

  /**
   * Renders the lit static floor & walls onto pixelCanvas.
   */
  renderLitScene({ pCtx, camIntX, camIntY }) {
    if (!this.mapIndices || !this.lightGrid) {
      this.pixelU32.fill(SHADE_U32[0][0]);
      pCtx.putImageData(this.imageData, 0, 0);
      return;
    }

    const vw = this.viewWidth;
    const vh = this.viewHeight;
    const mw = this.mapIndexW;
    const mh = this.mapIndexH;
    const mapIdx = this.mapIndices;
    const outU32 = this.pixelU32;
    const cols = this.gridCols;
    const maxR = this.gridRows - 2;
    const maxC = cols - 2;
    const blackU32 = SHADE_U32[0][0];
    const grid = this.lightGrid;
    const gridR = this.lightR;
    const gridG = this.lightG;
    const gridB = this.lightB;

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

        // Early-out if none of the 4 contributing grid nodes have colored light (avoid float bitwise operations)
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

    pCtx.putImageData(this.imageData, 0, 0);
  }

  sampleLightAtWorld(wx, wy) {
    if (!this.lightGrid) return 0;
    const gx = wx * INV_CELL_PX;
    const gy = wy * INV_CELL_PX;
    const cols = this.gridCols;
    const maxR = this.gridRows - 2;
    const maxC = cols - 2;

    if (gx < 0 || gx > cols - 1 || gy < 0 || gy > this.gridRows - 1) return this.ambientLight;

    let c0 = gx | 0;
    if (c0 > maxC) c0 = maxC;
    let r0 = gy | 0;
    if (r0 > maxR) r0 = maxR;

    const fx = gx - c0;
    const fy = gy - r0;
    const row0 = r0 * cols;
    const row1 = (r0 + 1) * cols;
    const grid = this.lightGrid;

    const top = grid[row0 + c0] + (grid[row0 + c0 + 1] - grid[row0 + c0]) * fx;
    const bot = grid[row1 + c0] + (grid[row1 + c0 + 1] - grid[row1 + c0]) * fx;
    return top + (bot - top) * fy;
  }

  getLightBandAtWorld(wx, wy) {
    const val = this.sampleLightAtWorld(wx, wy);
    if (val <= 0.35) return 0;
    return Math.min(MAX_LIGHT_BAND, Math.max(1, Math.round(val)));
  }
}
