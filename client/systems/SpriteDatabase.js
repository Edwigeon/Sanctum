/**
 * SpriteDatabase.js - Client-Side Binary Bit-Array Sprite Database for Project: Sanctum
 * Packs 16-color hex-grid bit-array sprites ('0'-'f' -> 0..15, '.' -> 255 transparent)
 * into compact binary ArrayBuffers ([uint16 w, uint16 h, ...uint8 pixels]) in IndexedDB,
 * alongside pre-rendered Data URLs and decoded SpriteRegistry banks for instant startup.
 */

const DB_NAME = 'sanctum_sprite_db';
const DB_VERSION = 1;
const STORE_BIT_SPRITES = 'bit_sprites_bin';
const STORE_DATA_URLS = 'bit_sprite_urls';
const STORE_BANKS = 'sprite_banks';
const STORE_META = 'sprite_meta';

export class SpriteDatabase {
  constructor() {
    this.db = null;
    this.initPromise = null;
    this.isSupported = typeof indexedDB !== 'undefined';
  }

  async init() {
    if (!this.isSupported) return null;
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_BIT_SPRITES)) {
            db.createObjectStore(STORE_BIT_SPRITES);
          }
          if (!db.objectStoreNames.contains(STORE_DATA_URLS)) {
            db.createObjectStore(STORE_DATA_URLS);
          }
          if (!db.objectStoreNames.contains(STORE_BANKS)) {
            db.createObjectStore(STORE_BANKS);
          }
          if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META);
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => {
          this.isSupported = false;
          resolve(null);
        };
      } catch {
        this.isSupported = false;
        resolve(null);
      }
    });

    return this.initPromise;
  }

  /**
   * Encodes hex-grid string rows (or an existing { w, h, pixels } frame) into a compact
   * binary ArrayBuffer: 4-byte Uint16 header [w, h] + (w * h) Uint8 pixel indices (0..15, 255 = transparent).
   */
  encodeFrameToBinary(rowsOrFrame) {
    let w = 0;
    let h = 0;
    let pixels = null;

    if (rowsOrFrame && rowsOrFrame.pixels instanceof Uint8Array) {
      w = rowsOrFrame.w || 0;
      h = rowsOrFrame.h || 0;
      pixels = rowsOrFrame.pixels;
    } else if (Array.isArray(rowsOrFrame) && rowsOrFrame.length > 0) {
      h = rowsOrFrame.length;
      w = typeof rowsOrFrame[0] === 'string' ? rowsOrFrame[0].length : 0;
      pixels = new Uint8Array(w * h);
      pixels.fill(255);
      for (let r = 0; r < h; r++) {
        const row = rowsOrFrame[r];
        if (typeof row !== 'string') continue;
        const rowOff = r * w;
        for (let c = 0; c < w && c < row.length; c++) {
          const ch = row[c];
          if (ch === '.' || ch === ' ') continue;
          const idx = parseInt(ch, 16);
          if (!Number.isNaN(idx) && idx >= 0 && idx < 16) {
            pixels[rowOff + c] = idx;
          }
        }
      }
    } else {
      return new ArrayBuffer(4);
    }

    const buffer = new ArrayBuffer(4 + w * h);
    const header = new Uint16Array(buffer, 0, 2);
    header[0] = w;
    header[1] = h;
    new Uint8Array(buffer, 4).set(pixels.subarray(0, w * h));
    return buffer;
  }

  /**
   * Decodes a packed binary ArrayBuffer back into { w, h, pixels: Uint8Array }.
   */
  decodeBinaryToFrame(buffer) {
    if (!buffer || buffer.byteLength < 4) return null;
    const header = new Uint16Array(buffer, 0, 2);
    const w = header[0];
    const h = header[1];
    const expectedLen = w * h;
    if (buffer.byteLength < 4 + expectedLen) return null;
    const pixels = new Uint8Array(buffer, 4, expectedLen);
    return { w, h, pixels };
  }

  async getMeta(key) {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_META], 'readonly');
        const req = tx.objectStore(STORE_META).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async setMeta(key, value) {
    const db = await this.init();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_META], 'readwrite');
        const req = tx.objectStore(STORE_META).put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async getBitSprite(spriteKey) {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BIT_SPRITES], 'readonly');
        const req = tx.objectStore(STORE_BIT_SPRITES).get(spriteKey);
        req.onsuccess = () => {
          if (req.result) {
            resolve(this.decodeBinaryToFrame(req.result));
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveBitSprite(spriteKey, rowsOrFrame) {
    const db = await this.init();
    if (!db || !rowsOrFrame) return false;
    try {
      const packed = this.encodeFrameToBinary(rowsOrFrame);
      return new Promise((resolve) => {
        try {
          const tx = db.transaction([STORE_BIT_SPRITES], 'readwrite');
          const req = tx.objectStore(STORE_BIT_SPRITES).put(packed, spriteKey);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  async getAllBitSprites() {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BIT_SPRITES], 'readonly');
        const store = tx.objectStore(STORE_BIT_SPRITES);
        const result = new Map();
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const frame = this.decodeBinaryToFrame(cursor.value);
            if (frame) result.set(cursor.key, frame);
            cursor.continue();
          } else {
            resolve(result);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveBitSpriteBatch(entries) {
    const db = await this.init();
    if (!db || !entries) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BIT_SPRITES], 'readwrite');
        const store = tx.objectStore(STORE_BIT_SPRITES);
        for (const [key, rowsOrFrame] of entries) {
          store.put(this.encodeFrameToBinary(rowsOrFrame), key);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async getDataUrl(cacheKey) {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_DATA_URLS], 'readonly');
        const req = tx.objectStore(STORE_DATA_URLS).get(cacheKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveDataUrl(cacheKey, dataUrl) {
    const db = await this.init();
    if (!db || !dataUrl) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_DATA_URLS], 'readwrite');
        const req = tx.objectStore(STORE_DATA_URLS).put(dataUrl, cacheKey);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async getAllDataUrls() {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_DATA_URLS], 'readonly');
        const store = tx.objectStore(STORE_DATA_URLS);
        const result = new Map();
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            result.set(cursor.key, cursor.value);
            cursor.continue();
          } else {
            resolve(result);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async getSpriteBank(bankKey) {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BANKS], 'readonly');
        const req = tx.objectStore(STORE_BANKS).get(bankKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveSpriteBank(bankKey, bankData) {
    const db = await this.init();
    if (!db || !bankData) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BANKS], 'readwrite');
        const req = tx.objectStore(STORE_BANKS).put(bankData, bankKey);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async clearBitSprites() {
    const db = await this.init();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BIT_SPRITES, STORE_DATA_URLS], 'readwrite');
        tx.objectStore(STORE_BIT_SPRITES).clear();
        tx.objectStore(STORE_DATA_URLS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clearAll() {
    const db = await this.init();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_BIT_SPRITES, STORE_DATA_URLS, STORE_BANKS, STORE_META], 'readwrite');
        tx.objectStore(STORE_BIT_SPRITES).clear();
        tx.objectStore(STORE_DATA_URLS).clear();
        tx.objectStore(STORE_BANKS).clear();
        tx.objectStore(STORE_META).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
