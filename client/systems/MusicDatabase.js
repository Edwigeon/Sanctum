/**
 * MusicDatabase.js - Client-Side 16-Bit Packed Binary Audio Database for Project: Sanctum
 * Compresses Float32Array PCM samples into standard 16-bit signed integer PCM (Int16Array)
 * cutting IndexedDB disk footprint by 50% while preserving studio audio fidelity (96 dB SNR).
 */

const DB_NAME = 'sanctum_audio_db';
const DB_VERSION = 2; // Bumped to 2 for 16-bit packed PCM format
const STORE_PCM = 'rendered_pcm_16bit';
const STORE_SUITES = 'suite_data';

export class MusicDatabase {
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
          // Clean up legacy 32-bit store if upgrading from v1
          if (db.objectStoreNames.contains('rendered_pcm')) {
            db.deleteObjectStore('rendered_pcm');
          }
          if (!db.objectStoreNames.contains(STORE_PCM)) {
            db.createObjectStore(STORE_PCM);
          }
          if (!db.objectStoreNames.contains(STORE_SUITES)) {
            db.createObjectStore(STORE_SUITES);
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
   * Encodes a Float32Array (-1.0 to 1.0) into a compact 16-bit signed integer ArrayBuffer.
   * Reduces binary storage size by exactly 50%.
   */
  encodeFloat32ToInt16(f32) {
    const len = f32.length;
    const int16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1.0, Math.min(1.0, f32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16.buffer;
  }

  /**
   * Decodes an ArrayBuffer of 16-bit signed integers back into a Web Audio Float32Array.
   */
  decodeInt16ToFloat32(buffer) {
    const int16 = new Int16Array(buffer);
    const len = int16.length;
    const f32 = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const v = int16[i];
      f32[i] = v < 0 ? v / 0x8000 : v / 0x7FFF;
    }
    return f32;
  }

  async getPatternPCM(suiteName, patternId, sampleRate) {
    const db = await this.init();
    if (!db) return null;
    const key = `${suiteName}_${patternId}_${sampleRate}`;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_PCM], 'readonly');
        const store = tx.objectStore(STORE_PCM);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result) {
            try {
              const f32 = this.decodeInt16ToFloat32(req.result);
              resolve(f32);
            } catch {
              resolve(null);
            }
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

  async savePatternPCM(suiteName, patternId, sampleRate, float32Arr) {
    const db = await this.init();
    if (!db || !float32Arr) return false;
    const key = `${suiteName}_${patternId}_${sampleRate}`;

    try {
      // Pack into compact 16-bit Int16 PCM (50% storage reduction)
      const packedBuffer = float32Arr instanceof Float32Array 
        ? this.encodeFloat32ToInt16(float32Arr)
        : this.encodeFloat32ToInt16(new Float32Array(float32Arr));

      return new Promise((resolve) => {
        try {
          const tx = db.transaction([STORE_PCM], 'readwrite');
          const store = tx.objectStore(STORE_PCM);
          const req = store.put(packedBuffer, key);
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

  async getSuite(suiteName) {
    const db = await this.init();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SUITES], 'readonly');
        const store = tx.objectStore(STORE_SUITES);
        const req = store.get(suiteName);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveSuite(suiteName, data) {
    const db = await this.init();
    if (!db || !data) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SUITES], 'readwrite');
        const store = tx.objectStore(STORE_SUITES);
        const req = store.put(data, suiteName);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async clearAll() {
    const db = await this.init();
    if (!db) return;
    try {
      const tx = db.transaction([STORE_PCM, STORE_SUITES], 'readwrite');
      tx.objectStore(STORE_PCM).clear();
      tx.objectStore(STORE_SUITES).clear();
    } catch {}
  }
}
