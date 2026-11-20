/**
 * Real-Time 2D Shadowcast Lighting Coordinator
 * Delegates shade tables, dungeon floor baking, analytical wall raycasting, light grid propagation,
 * and Bayer-dithered subpixel rasterization to dedicated lighting submodules.
 */

import { PALETTE_INDEX } from '../../shared/Constants.js';
import {
  MAX_LIGHT_BAND,
  SHADE_U32,
  BAYER_4X4,
  packABGR,
  parseHexRGB,
  resolveColorRGB
} from './lighting/LightingTables.js';
import {
  isOpaqueRC,
  buildMergedWallSegments,
  getWallSurfaceDepth,
  checkStaticObjectOcclusion,
  computeVisibility
} from './lighting/VisibilityOcclusion.js';
import { bakeDungeonFloor } from './lighting/FloorBaker.js';
import { updateLightGrid } from './lighting/LightPropagator.js';
import {
  sampleLightAtWorld,
  getLightBandAtWorld,
  sampleLitPixelU32,
  drawLitEntityStamp,
  drawLitSpriteStamp,
  renderLitScene
} from './lighting/LitRasterizer.js';

export { MAX_LIGHT_BAND, SHADE_U32, BAYER_4X4, packABGR, parseHexRGB };

export class LightingSystem {
  constructor(viewWidth = 242, viewHeight = 146) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.imageData = new ImageData(viewWidth, viewHeight);
    this.pixelU32 = new Uint32Array(this.imageData.data.buffer);

    // Scratch offscreen canvas (up to 64x64 high-resolution entity size) for stamping dither-lit entities
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

  resolveColorRGB(color) {
    return resolveColorRGB(color);
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
    const rgb = resolveColorRGB(color);
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
    return isOpaqueRC(this, r, c);
  }

  buildMergedWallSegments() {
    buildMergedWallSegments(this);
  }

  bakeFloorIndices(dungeon, sprites = null) {
    bakeDungeonFloor(this, dungeon, sprites);
  }

  getWallSurfaceDepth(tx, ty, tc, tr) {
    return getWallSurfaceDepth(this, tx, ty, tc, tr);
  }

  checkStaticObjectOcclusion(sx, sy, tx, ty, dist) {
    return checkStaticObjectOcclusion(this, sx, sy, tx, ty, dist);
  }

  computeVisibility(sx, sy, tx, ty) {
    return computeVisibility(this, sx, sy, tx, ty);
  }

  updateLightGrid(params) {
    updateLightGrid(this, params);
  }

  sampleLitPixelU32(wx, wy, basePalIdx) {
    return sampleLitPixelU32(this, wx, wy, basePalIdx);
  }

  drawLitEntityStamp(hCtx, params) {
    drawLitEntityStamp(this, hCtx, params);
  }

  drawLitSpriteStamp(hCtx, params) {
    drawLitSpriteStamp(this, hCtx, params);
  }

  renderLitScene(params) {
    renderLitScene(this, params);
  }

  sampleLightAtWorld(wx, wy) {
    return sampleLightAtWorld(this, wx, wy);
  }

  getLightBandAtWorld(wx, wy) {
    return getLightBandAtWorld(this, wx, wy);
  }
}
