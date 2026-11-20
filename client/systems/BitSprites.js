import { PALETTE } from '../../shared/Constants.js';
import { SpriteDatabase } from './SpriteDatabase.js';
import {
  BIT_SPRITES,
  HUD_BIT_SPRITES,
  ATTRIBUTE_BIT_SPRITES,
  GEAR_BIT_SPRITES,
  SLOT_SILHOUETTE_SPRITES
} from './hud/BitSpriteCatalog.js';

export {
  BIT_SPRITES,
  HUD_BIT_SPRITES,
  ATTRIBUTE_BIT_SPRITES,
  GEAR_BIT_SPRITES,
  SLOT_SILHOUETTE_SPRITES
};

export const spriteDb = new SpriteDatabase();
const DECODED_SPRITE_CACHE = new Map();
const DATA_URL_CACHE = new Map();
let dbInitPromise = null;

function computeCatalogSignature() {
  let hash = 0x811c9dc5;
  const keys = Object.keys(BIT_SPRITES);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const rows = BIT_SPRITES[key];
    if (Array.isArray(rows)) {
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          hash ^= row.charCodeAt(c);
          hash = Math.imul(hash, 0x01000193);
        }
      }
    }
  }
  return `${keys.length}:${(hash >>> 0).toString(16)}`;
}

function decodeBitRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const h = rows.length;
  const w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w === 0) return null;

  const pixels = new Uint8Array(w * h);
  pixels.fill(255);

  for (let r = 0; r < h; r++) {
    const row = rows[r];
    if (typeof row !== 'string') continue;
    const rowOff = r * w;
    for (let c = 0; c < w && c < row.length; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const colIdx = parseInt(ch, 16);
      if (!Number.isNaN(colIdx) && colIdx >= 0 && colIdx < 16) {
        pixels[rowOff + c] = colIdx;
      }
    }
  }

  return { w, h, pixels };
}

function getDecodedBitSprite(spriteKey) {
  let frame = DECODED_SPRITE_CACHE.get(spriteKey);
  if (frame) return frame;

  const rows = BIT_SPRITES[spriteKey];
  if (!rows) return null;

  frame = decodeBitRows(rows);
  if (frame) {
    DECODED_SPRITE_CACHE.set(spriteKey, frame);
    spriteDb.saveBitSprite(spriteKey, frame).catch(() => {});
  }
  return frame;
}

/**
 * Hydrates in-memory bit-sprite and Data URL caches from IndexedDB,
 * or pre-packs and persists the catalog if the signature is missing/stale.
 */
export async function initBitSpriteDatabase() {
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = (async () => {
    const db = await spriteDb.init();
    if (!db) return false;

    const sig = computeCatalogSignature();
    const storedSig = await spriteDb.getMeta('catalog_sig');

    if (storedSig === sig) {
      const [cachedFrames, cachedUrls] = await Promise.all([
        spriteDb.getAllBitSprites(),
        spriteDb.getAllDataUrls()
      ]);
      if (cachedFrames) {
        for (const [key, frame] of cachedFrames) {
          if (!DECODED_SPRITE_CACHE.has(key)) {
            DECODED_SPRITE_CACHE.set(key, frame);
          }
        }
      }
      if (cachedUrls) {
        for (const [key, url] of cachedUrls) {
          if (!DATA_URL_CACHE.has(key)) {
            DATA_URL_CACHE.set(key, url);
          }
        }
      }
      return true;
    }

    await spriteDb.clearBitSprites();
    const batch = [];
    for (const [key, rows] of Object.entries(BIT_SPRITES)) {
      let frame = DECODED_SPRITE_CACHE.get(key);
      if (!frame) {
        frame = decodeBitRows(rows);
        if (frame) DECODED_SPRITE_CACHE.set(key, frame);
      }
      if (frame) batch.push([key, frame]);
    }
    await spriteDb.saveBitSpriteBatch(batch);
    await spriteDb.setMeta('catalog_sig', sig);
    return true;
  })().catch(() => false);

  return dbInitPromise;
}

if (typeof indexedDB !== 'undefined') {
  initBitSpriteDatabase();
}

/**
 * Renders a bit-array sprite directly onto a canvas context with integer pixel scaling.
 */
export function drawBitSprite(ctx, spriteKey, x, y, pixelScale = 2, palette = PALETTE) {
  const frame = getDecodedBitSprite(spriteKey);
  if (!frame) return;

  const { w, h, pixels } = frame;
  const startX = Math.round(x);
  const startY = Math.round(y);
  const pSize = Math.max(1, Math.round(pixelScale));

  for (let r = 0; r < h; r++) {
    const rowOff = r * w;
    for (let c = 0; c < w; c++) {
      const colIdx = pixels[rowOff + c];
      if (colIdx !== 255 && palette[colIdx]) {
        ctx.fillStyle = palette[colIdx];
        ctx.fillRect(startX + c * pSize, startY + r * pSize, pSize, pSize);
      }
    }
  }
}

/**
 * Returns a base64 Data URL for a bit-array sprite, memoized in memory and persisted in IndexedDB.
 */
export function getBitSpriteDataUrl(spriteKey, pixelScale = 2) {
  const cacheKey = `${spriteKey}_${pixelScale}`;
  if (DATA_URL_CACHE.has(cacheKey)) {
    return DATA_URL_CACHE.get(cacheKey);
  }

  const frame = getDecodedBitSprite(spriteKey);
  if (!frame) return '';

  const { w, h, pixels } = frame;
  const pSize = Math.max(1, Math.round(pixelScale));

  const canvas = document.createElement('canvas');
  canvas.width = w * pSize;
  canvas.height = h * pSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < h; r++) {
    const rowOff = r * w;
    for (let c = 0; c < w; c++) {
      const colIdx = pixels[rowOff + c];
      if (colIdx !== 255 && PALETTE[colIdx]) {
        ctx.fillStyle = PALETTE[colIdx];
        ctx.fillRect(c * pSize, r * pSize, pSize, pSize);
      }
    }
  }

  const url = canvas.toDataURL();
  DATA_URL_CACHE.set(cacheKey, url);
  spriteDb.saveDataUrl(cacheKey, url).catch(() => {});
  return url;
}

/**
 * Maps an item or item base name to its bit sprite key.
 */
export function getItemSpriteKey(item) {
  if (!item) return 'slot_weapon';
  const name = (item.name || item.base || '').toLowerCase();
  const type = (item.type || '').toLowerCase();

  // Consumables & Currencies
  if (type === 'gold' || name.includes('gold')) return 'coin';
  if (type === 'potion' || name.includes('potion')) {
    if (item.subType === 'mp' || name.includes('mana')) return 'potion_mp';
    return 'potion_hp';
  }
  if (name.includes('scroll') || name.includes('portal')) return 'scroll';

  for (const key of Object.keys(BIT_SPRITES)) {
    if (name.includes(key)) return key;
  }
  // Fallback by slot
  const slot = (item.slot || '').toLowerCase();
  if (slot === 'helm') return 'bascinet';
  if (slot === 'amulet') return 'talisman';
  if (slot === 'weapon') return 'longsword';
  if (slot === 'armor') return 'cuirass';
  if (slot === 'offhand') return 'buckler';
  if (slot === 'gloves') return 'gauntlets';
  if (slot === 'boots') return 'greaves';
  if (slot === 'ring') return 'signet';
  return 'cleaver';
}
