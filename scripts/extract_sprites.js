#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(ROOT_DIR, 'assets/sprites');

// 16-color PICO-8 palette in hex & RGBA
const PALETTE_HEX = [
  '#000000', // 0: BLACK
  '#1D2B53', // 1: DARK_BLUE
  '#7E2553', // 2: DARK_PURPLE
  '#008751', // 3: DARK_GREEN
  '#AB5236', // 4: BROWN
  '#5F574F', // 5: DARK_GRAY
  '#C2C3C7', // 6: LIGHT_GRAY
  '#FFF1E8', // 7: WHITE
  '#FF004D', // 8: RED
  '#FFA300', // 9: ORANGE
  '#FFEC27', // 10: YELLOW
  '#00E436', // 11: GREEN
  '#29ADFF', // 12: BLUE
  '#83769C', // 13: INDIGO
  '#FF77A8', // 14: PINK
  '#FFCCAA'  // 15: PEACH
];

const PALETTE_RGBA = PALETTE_HEX.map(hex => {
  const num = parseInt(hex.slice(1), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff, 255];
});

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPNG(width, height, rgbaBuffer) {
  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(width, 0);
  IHDR.writeUInt32BE(height, 4);
  IHDR[8] = 8; // 8 bits per channel
  IHDR[9] = 6; // color type 6: RGBA
  IHDR[10] = 0;
  IHDR[11] = 0;
  IHDR[12] = 0;

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0; // Filter type 0 (None)
    rgbaBuffer.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const IDAT = zlib.deflateSync(scanlines);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk('IHDR', IHDR),
    makeChunk('IDAT', IDAT),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Parses raw hex string rows into an RGBA Buffer scaled up by `scale`
 */
function renderSpriteToBuffer(rows, scale = 8, pad = 0, bgRgba = null) {
  if (!rows || rows.length === 0) return null;
  const h = rows.length;
  const w = rows[0].length;
  const outW = (w + pad * 2) * scale;
  const outH = (h + pad * 2) * scale;
  const buf = Buffer.alloc(outW * outH * 4);

  if (bgRgba) {
    for (let i = 0; i < outW * outH; i++) {
      buf[i * 4 + 0] = bgRgba[0];
      buf[i * 4 + 1] = bgRgba[1];
      buf[i * 4 + 2] = bgRgba[2];
      buf[i * 4 + 3] = bgRgba[3];
    }
  }

  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ' || ch === undefined) continue;
      const idx = parseInt(ch, 16);
      if (Number.isNaN(idx) || idx < 0 || idx >= 16) continue;

      const [pr, pg, pb, pa] = PALETTE_RGBA[idx];
      const startX = (c + pad) * scale;
      const startY = (r + pad) * scale;

      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const off = ((startY + sy) * outW + (startX + sx)) * 4;
          buf[off + 0] = pr;
          buf[off + 1] = pg;
          buf[off + 2] = pb;
          buf[off + 3] = pa;
        }
      }
    }
  }

  return { width: outW, height: outH, buffer: buf };
}

/**
 * Creates a composite showcase image with a tiled background, labeled or framed
 */
function createCompositeShowcase(spriteEntries, columns = 4, scale = 8, cellPadding = 2, margin = 4, bgHex = '#111116', frameHex = '#2c2538') {
  const cellW = (12 + cellPadding * 2) * scale;
  const cellH = (12 + cellPadding * 2) * scale;
  const rowsCount = Math.ceil(spriteEntries.length / columns);
  const outW = margin * 2 * scale + columns * cellW;
  const outH = margin * 2 * scale + rowsCount * cellH;

  const bgNum = parseInt(bgHex.slice(1), 16);
  const bgRgba = [(bgNum >> 16) & 0xff, (bgNum >> 8) & 0xff, bgNum & 0xff, 255];

  const frameNum = parseInt(frameHex.slice(1), 16);
  const frameRgba = [(frameNum >> 16) & 0xff, (frameNum >> 8) & 0xff, frameNum & 0xff, 255];

  const buf = Buffer.alloc(outW * outH * 4);

  // Fill background
  for (let i = 0; i < outW * outH; i++) {
    buf[i * 4 + 0] = bgRgba[0];
    buf[i * 4 + 1] = bgRgba[1];
    buf[i * 4 + 2] = bgRgba[2];
    buf[i * 4 + 3] = bgRgba[3];
  }

  // Draw cells
  for (let i = 0; i < spriteEntries.length; i++) {
    const { name, rows } = spriteEntries[i];
    const col = i % columns;
    const row = Math.floor(i / columns);

    const cellX = margin * scale + col * cellW;
    const cellY = margin * scale + row * cellH;

    // Draw subtle border around cell
    const borderInset = 2;
    for (let x = cellX + borderInset; x < cellX + cellW - borderInset; x++) {
      for (const y of [cellY + borderInset, cellY + cellH - borderInset - 1]) {
        const off = (y * outW + x) * 4;
        buf[off + 0] = frameRgba[0];
        buf[off + 1] = frameRgba[1];
        buf[off + 2] = frameRgba[2];
        buf[off + 3] = frameRgba[3];
      }
    }
    for (let y = cellY + borderInset; y < cellY + cellH - borderInset; y++) {
      for (const x of [cellX + borderInset, cellX + cellW - borderInset - 1]) {
        const off = (y * outW + x) * 4;
        buf[off + 0] = frameRgba[0];
        buf[off + 1] = frameRgba[1];
        buf[off + 2] = frameRgba[2];
        buf[off + 3] = frameRgba[3];
      }
    }

    // Center sprite in cell
    const spW = rows[0]?.length || 10;
    const spH = rows.length || 10;
    const offsetX = Math.floor((cellW - spW * scale) / 2);
    const offsetY = Math.floor((cellH - spH * scale) / 2);

    for (let r = 0; r < spH; r++) {
      const line = rows[r];
      for (let c = 0; c < spW; c++) {
        const ch = line[c];
        if (ch === '.' || ch === ' ' || ch === undefined) continue;
        const idx = parseInt(ch, 16);
        if (Number.isNaN(idx) || idx < 0 || idx >= 16) continue;

        const [pr, pg, pb, pa] = PALETTE_RGBA[idx];
        const startX = cellX + offsetX + c * scale;
        const startY = cellY + offsetY + r * scale;

        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const off = ((startY + sy) * outW + (startX + sx)) * 4;
            buf[off + 0] = pr;
            buf[off + 1] = pg;
            buf[off + 2] = pb;
            buf[off + 3] = pa;
          }
        }
      }
    }
  }

  return { width: outW, height: outH, buffer: buf };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const spritesJsonPath = path.resolve(ROOT_DIR, 'data/sprites.json');
  const spritesData = JSON.parse(fs.readFileSync(spritesJsonPath, 'utf8'));

  const catalogModule = await import(path.resolve(ROOT_DIR, 'client/systems/hud/BitSpriteCatalog.js'));
  const { HUD_BIT_SPRITES, ATTRIBUTE_BIT_SPRITES, GEAR_BIT_SPRITES, SLOT_SILHOUETTE_SPRITES } = catalogModule;

  console.log('Extracting and rendering micro-sprites...');

  function getTileRows(tileObj, idx = 0) {
    if (!tileObj) return null;
    if (tileObj.variants && tileObj.variants[idx]) return tileObj.variants[idx];
    if (tileObj.frames && tileObj.frames[idx]) return tileObj.frames[idx];
    if (tileObj.variants && tileObj.variants[0]) return tileObj.variants[0];
    if (tileObj.frames && tileObj.frames[0]) return tileObj.frames[0];
    return null;
  }

  const individualSprites = [
    // Heroes
    { name: 'hero_vanguard_idle', rows: spritesData.entities['common/hero_vanguard'].states.idle.frames[0], scale: 8 },
    { name: 'hero_vanguard_attack', rows: spritesData.entities['common/hero_vanguard'].states.attack.frames[1], scale: 8 },
    { name: 'hero_arcanist_idle', rows: spritesData.entities['common/hero_arcanist'].states.idle.frames[0], scale: 8 },
    { name: 'hero_arcanist_attack', rows: spritesData.entities['common/hero_arcanist'].states.attack.frames[1], scale: 8 },
    { name: 'hero_shadow_idle', rows: spritesData.entities['common/hero_shadow'].states.idle.frames[0], scale: 8 },
    { name: 'hero_shadow_attack', rows: spritesData.entities['common/hero_shadow'].states.attack.frames[1], scale: 8 },
    { name: 'hero_paladin', rows: spritesData.entities['common/hero_paladin'].states.idle.frames[0], scale: 4 },

    // Monsters
    { name: 'monster_crawler', rows: spritesData.entities['crypt/monster_crawler'].states.idle.frames[0], scale: 8 },
    { name: 'monster_crawler_attack', rows: spritesData.entities['crypt/monster_crawler'].states.attack.frames[1], scale: 8 },
    { name: 'monster_brute', rows: spritesData.entities['crypt/monster_brute'].states.idle.frames[0], scale: 8 },
    { name: 'monster_brute_attack', rows: spritesData.entities['crypt/monster_brute'].states.attack.frames[1], scale: 8 },
    { name: 'monster_overlord', rows: spritesData.entities['crypt/monster_overlord'].states.idle.frames[0], scale: 3 },

    // Objects & Tiles
    { name: 'chest_closed', rows: spritesData.objects['crypt/chest_closed'].states.idle.frames[0], scale: 8 },
    { name: 'chest_open', rows: spritesData.objects['crypt/chest_closed'].states.open.frames[0], scale: 8 },
    { name: 'shrine_arcane', rows: spritesData.objects['overworld/shrine_arcane'].states.idle.frames[0], scale: 8 },
    { name: 'stairs_down', rows: getTileRows(spritesData.tiles['common/stairs_down']), scale: 8 },
    { name: 'tile_crypt_floor', rows: getTileRows(spritesData.tiles['crypt/floor_stone'], 0), scale: 8 },
    { name: 'tile_crypt_wall', rows: getTileRows(spritesData.tiles['crypt/wall_front'], 0), scale: 8 },

    // BitSprite HUD & Gear
    { name: 'item_potion_hp', rows: HUD_BIT_SPRITES.potion_hp, scale: 8 },
    { name: 'item_potion_mp', rows: HUD_BIT_SPRITES.potion_mp, scale: 8 },
    { name: 'item_sword', rows: HUD_BIT_SPRITES.sword, scale: 8 },
    { name: 'item_spark', rows: HUD_BIT_SPRITES.spark, scale: 8 },
    { name: 'item_coin', rows: HUD_BIT_SPRITES.coin, scale: 8 },
    { name: 'item_scroll', rows: HUD_BIT_SPRITES.scroll, scale: 8 },
    { name: 'item_portal', rows: HUD_BIT_SPRITES.portal, scale: 8 },
    { name: 'gear_longsword', rows: GEAR_BIT_SPRITES.longsword, scale: 8 },
    { name: 'gear_wand', rows: GEAR_BIT_SPRITES.wand, scale: 8 },
    { name: 'gear_cleaver', rows: GEAR_BIT_SPRITES.cleaver, scale: 8 },
    { name: 'gear_cuirass', rows: GEAR_BIT_SPRITES.cuirass, scale: 8 },
    { name: 'gear_kiteshield', rows: GEAR_BIT_SPRITES.kiteshield, scale: 8 },
    { name: 'gear_crown', rows: GEAR_BIT_SPRITES.crown, scale: 8 },
    { name: 'gear_boots', rows: GEAR_BIT_SPRITES.boots, scale: 8 },
    { name: 'gear_signet', rows: GEAR_BIT_SPRITES.signet, scale: 8 },
    { name: 'attr_might', rows: ATTRIBUTE_BIT_SPRITES.might, scale: 8 },
    { name: 'attr_focus', rows: ATTRIBUTE_BIT_SPRITES.focus, scale: 8 },
    { name: 'attr_agility', rows: ATTRIBUTE_BIT_SPRITES.agility, scale: 8 },
    { name: 'attr_vitality', rows: ATTRIBUTE_BIT_SPRITES.vitality, scale: 8 }
  ];

  for (const item of individualSprites) {
    if (!item.rows) {
      console.warn(`Missing rows for ${item.name}`);
      continue;
    }
    const rendered = renderSpriteToBuffer(item.rows, item.scale, 1);
    const pngBuf = createPNG(rendered.width, rendered.height, rendered.buffer);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${item.name}.png`), pngBuf);
  }
  console.log(`Rendered ${individualSprites.length} individual sprite PNGs.`);

  // 1. Showcase: Hero Classes Strip
  const heroEntries = [
    { name: 'Vanguard (Idle)', rows: spritesData.entities['common/hero_vanguard'].states.idle.frames[0] },
    { name: 'Vanguard (Attack)', rows: spritesData.entities['common/hero_vanguard'].states.attack.frames[1] },
    { name: 'Arcanist (Idle)', rows: spritesData.entities['common/hero_arcanist'].states.idle.frames[0] },
    { name: 'Arcanist (Attack)', rows: spritesData.entities['common/hero_arcanist'].states.attack.frames[1] },
    { name: 'Shadow (Idle)', rows: spritesData.entities['common/hero_shadow'].states.idle.frames[0] },
    { name: 'Shadow (Attack)', rows: spritesData.entities['common/hero_shadow'].states.attack.frames[1] }
  ];
  const heroesShowcase = createCompositeShowcase(heroEntries, 6, 8, 3, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'showcase_heroes.png'), createPNG(heroesShowcase.width, heroesShowcase.height, heroesShowcase.buffer));

  // 2. Showcase: Monsters Strip
  const monsterEntries = [
    { name: 'Crawler (Idle)', rows: spritesData.entities['crypt/monster_crawler'].states.idle.frames[0] },
    { name: 'Crawler (Attack)', rows: spritesData.entities['crypt/monster_crawler'].states.attack.frames[1] },
    { name: 'Brute (Idle)', rows: spritesData.entities['crypt/monster_brute'].states.idle.frames[0] },
    { name: 'Brute (Attack)', rows: spritesData.entities['crypt/monster_brute'].states.attack.frames[1] },
    { name: 'Chest (Closed)', rows: spritesData.objects['crypt/chest_closed'].states.idle.frames[0] },
    { name: 'Chest (Open)', rows: spritesData.objects['crypt/chest_closed'].states.open.frames[0] }
  ];
  const monstersShowcase = createCompositeShowcase(monsterEntries, 6, 8, 3, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'showcase_monsters.png'), createPNG(monstersShowcase.width, monstersShowcase.height, monstersShowcase.buffer));

  // 3. Showcase: Gear & Item Grid
  const gearKeys = [
    'potion_hp', 'potion_mp', 'sword', 'spark', 'coin', 'scroll', 'portal', 'flask',
    'cleaver', 'wand', 'dirk', 'longsword', 'brigandine', 'shroud', 'cuirass', 'vestments',
    'spikegloves', 'gauntlets', 'bascinet', 'crown', 'talisman', 'buckler', 'kiteshield', 'tome',
    'orb', 'greaves', 'boots', 'signet', 'might', 'focus', 'agility', 'vitality'
  ];
  const gearEntries = gearKeys.map(k => {
    const rows = HUD_BIT_SPRITES[k] || GEAR_BIT_SPRITES[k] || ATTRIBUTE_BIT_SPRITES[k];
    return { name: k, rows };
  }).filter(e => !!e.rows);

  const gearShowcase = createCompositeShowcase(gearEntries, 8, 7, 2, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'showcase_gear_grid.png'), createPNG(gearShowcase.width, gearShowcase.height, gearShowcase.buffer));

  // 4. Showcase: Dungeon Tiles Strip
  const tileEntries = [
    { name: 'Crypt Floor 1', rows: getTileRows(spritesData.tiles['crypt/floor_stone'], 0) },
    { name: 'Crypt Floor 2', rows: getTileRows(spritesData.tiles['crypt/floor_stone'], 1) },
    { name: 'Crypt Wall Front', rows: getTileRows(spritesData.tiles['crypt/wall_front'], 0) },
    { name: 'Crypt Wall Top', rows: getTileRows(spritesData.tiles['crypt/wall_top'], 0) },
    { name: 'Crypt Wall Side', rows: getTileRows(spritesData.tiles['crypt/wall_side'], 0) },
    { name: 'Stairs Down', rows: getTileRows(spritesData.tiles['common/stairs_down'], 0) }
  ];
  const tilesShowcase = createCompositeShowcase(tileEntries, 6, 8, 2, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'showcase_tiles.png'), createPNG(tilesShowcase.width, tilesShowcase.height, tilesShowcase.buffer));

  console.log('Successfully generated all showcase banners and individual PNGs!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
