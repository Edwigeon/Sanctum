/**
 * MusicDatabase.js - Client-Side Binary Audio Database for Project: Sanctum
 * Utilizes browser IndexedDB to persist pre-rendered binary PCM buffers (Float32Array)
 * and pre-compiled tracker projects, achieving sub-millisecond instant playback on page load.
 */

const DB_NAME = 'sanctum_audio_db';
const DB_VERSION = 1;
const STORE_PCM = 'rendered_pcm';
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

  async getPatternPCM(suiteName, patternId, sampleRate) {
    const db = await this.init();
    if (!db) return null;
    const key = `${suiteName}_${patternId}_${sampleRate}`;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_PCM], 'readonly');
        const store = tx.objectStore(STORE_PCM);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async savePatternPCM(suiteName, patternId, sampleRate, arrayBuffer) {
    const db = await this.init();
    if (!db || !arrayBuffer) return false;
    const key = `${suiteName}_${patternId}_${sampleRate}`;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_PCM], 'readwrite');
        const store = tx.objectStore(STORE_PCM);
        const req = store.put(arrayBuffer, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
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
