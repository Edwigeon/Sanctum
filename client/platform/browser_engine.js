/**
 * Sanctum SC-32 Browser Platform Engine Adapter
 * 
 * Provides the identical "sanctum:engine" API surface for Web Browser clients
 * by wrapping HTML5 Canvas 2D, Web Audio API, DOM input events, and WebSockets.
 */

import { ENGINE, PALETTE, PALETTE_RGB } from '../../shared/Constants.js';

class BrowserCore {
  constructor() {
    this.tick = 0;
    this.simTimeMs = 0;
    this.delta = 1.0 / ENGINE.TICK_RATE;
    this.frameAlpha = 0.0;
  }

  getTick() { return this.tick; }
  getTime() { return this.simTimeMs; }
  getDelta() { return this.delta; }
  getFrameAlpha() { return this.frameAlpha; }
}

class BrowserGraphics {
  constructor() {
    // 240x144 Plane 1 World Buffer (Indexed 8-bit palette entries)
    this.worldBuffer = new Uint8Array(ENGINE.INTERNAL_WIDTH * ENGINE.INTERNAL_HEIGHT);
    this.activeBatches = [];
  }

  drawSpriteBatch(layerId, spriteDataArray, spriteCount) {
    this.activeBatches.push({ layerId, spriteDataArray, spriteCount });
  }

  setLight(id, x, y, radius, colorIdx, intensity) {
    // Forwarded to active lighting system
  }

  clearPlane(planeId) {
    if (planeId === 1) {
      this.worldBuffer.fill(40); // Void black default
    }
  }
}

class BrowserAudio {
  constructor() {
    this.masterVolume = 1.0;
    this.sfxVolume = 1.0;
    this.musicVolume = 1.0;
  }

  playSfx(sfxId, options = {}) {
    // Web Audio trigger hook
  }

  playMusic(trackId, options = {}) {
    // Web Audio / HTML5 audio music sequencing
  }

  stopMusic(options = {}) {}

  setMasterVolume(vol) { this.masterVolume = vol; }
  setSfxVolume(vol) { this.sfxVolume = vol; }
  setMusicVolume(vol) { this.musicVolume = vol; }
}

class BrowserInput {
  constructor() {
    this.pointerConsumed = false;
    this.pointerState = {
      screenX: 0,
      screenY: 0,
      worldX: 0.0,
      worldY: 0.0,
      left: false,
      right: false,
      middle: false
    };
    this.buttonMask = 0;
  }

  getPointer() {
    return { ...this.pointerState };
  }

  consumePointer() {
    this.pointerConsumed = true;
  }

  isPointerConsumed() {
    return this.pointerConsumed;
  }

  resetPointerConsumption() {
    this.pointerConsumed = false;
  }

  getButtons(playerIndex = 0) {
    return this.buttonMask;
  }
}

class BrowserStorage {
  read(key) {
    try {
      return localStorage.getItem(`sanctum_${key}`);
    } catch {
      return null;
    }
  }

  write(key, value) {
    try {
      localStorage.setItem(`sanctum_${key}`, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      localStorage.removeItem(`sanctum_${key}`);
    } catch {}
  }
}

class BrowserNetwork {
  constructor() {
    this.socket = null;
    this.messageHandlers = new Set();
  }

  send(packet) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(typeof packet === 'string' ? packet : JSON.stringify(packet));
    }
  }

  onMessage(callback) {
    this.messageHandlers.add(callback);
  }
}

class BrowserWorld {
  constructor() {
    this.residentChunks = new Map();
  }

  getChunk(chunkX, chunkY) {
    return this.residentChunks.get(`${chunkX},${chunkY}`) || null;
  }
}

export const core = new BrowserCore();
export const graphics = new BrowserGraphics();
export const audio = new BrowserAudio();
export const input = new BrowserInput();
export const storage = new BrowserStorage();
export const world = new BrowserWorld();
export const network = new BrowserNetwork();

export default {
  core,
  graphics,
  audio,
  input,
  storage,
  world,
  network
};
