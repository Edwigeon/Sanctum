#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const catalogModule = await import('../client/systems/hud/BitSpriteCatalog.js');
  const sprites = catalogModule.BIT_SPRITES;

  const PALETTE = [
    [0x00, 0x00, 0x00, 0xFF], // 0: Black
    [0x1D, 0x2B, 0x53, 0xFF], // 1: Dark Blue
    [0x7E, 0x25, 0x53, 0xFF], // 2: Dark Purple
    [0x00, 0x87, 0x51, 0xFF], // 3: Dark Green
    [0xAB, 0x52, 0x36, 0xFF], // 4: Brown
    [0x5F, 0x57, 0x4F, 0xFF], // 5: Dark Gray
    [0xC2, 0xC3, 0xC7, 0xFF], // 6: Light Gray
    [0xFF, 0xF1, 0xE8, 0xFF], // 7: White
    [0xFF, 0x00, 0x4D, 0xFF], // 8: Red
    [0xFF, 0xA3, 0x00, 0xFF], // 9: Orange
    [0xFF, 0xEC, 0x27, 0xFF], // 10: Yellow
    [0x00, 0xE4, 0x36, 0xFF], // 11: Green
    [0x29, 0xAD, 0xFF, 0xFF], // 12: Blue
    [0x83, 0x76, 0x9C, 0xFF], // 13: Indigo
    [0xFF, 0x77, 0xA8, 0xFF], // 14: Pink
    [0xFF, 0xCC, 0xAA, 0xFF]  // 15: Peach
  ];

  const keys = Object.keys(sprites).sort();
  const count = keys.length;

  // 1. Header (72 bytes)
  const headerBuf = Buffer.alloc(72);
  headerBuf.write('SPRT', 0, 4, 'ascii');
  headerBuf.writeUInt16LE(1, 4); // version
  headerBuf.writeUInt16LE(count, 6);

  for (let i = 0; i < 16; i++) {
    const col = PALETTE[i];
    headerBuf[8 + i * 4 + 0] = col[0];
    headerBuf[8 + i * 4 + 1] = col[1];
    headerBuf[8 + i * 4 + 2] = col[2];
    headerBuf[8 + i * 4 + 3] = col[3];
  }

  // 2. Directory & Payload
  const dirEntrySize = 52;
  let payloadOffset = 72 + (count * dirEntrySize);

  const dirBuffers = [];
  const payloadBuffers = [];

  for (const key of keys) {
    const rows = sprites[key];
    const h = rows.length;
    const w = rows[0].length;
    const totalPixels = w * h;

    const maskLen = Math.ceil(totalPixels / 8);
    const nibbleLen = Math.ceil(totalPixels / 2);

    const maskBuf = Buffer.alloc(maskLen, 0);
    const nibbleBuf = Buffer.alloc(nibbleLen, 0);

    for (let r = 0; r < h; r++) {
      const row = rows[r];
      for (let c = 0; c < w; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;

        const val = parseInt(ch, 16);
        if (Number.isNaN(val) || val < 0 || val > 15) continue;

        const idx = r * w + c;
        // Set mask bit to 1 (opaque)
        maskBuf[Math.floor(idx / 8)] |= (1 << (idx % 8));

        // Set nibble
        if (idx % 2 === 0) {
          nibbleBuf[Math.floor(idx / 2)] |= (val & 0x0F);
        } else {
          nibbleBuf[Math.floor(idx / 2)] |= ((val & 0x0F) << 4);
        }
      }
    }

    // Directory entry
    const entryBuf = Buffer.alloc(dirEntrySize, 0);
    entryBuf.write(key.slice(0, 31), 0, 31, 'utf8');
    entryBuf.writeUInt16LE(w, 32);
    entryBuf.writeUInt16LE(h, 34);

    const maskOff = payloadOffset;
    entryBuf.writeUInt32LE(maskOff, 36);
    entryBuf.writeUInt32LE(maskLen, 40);
    payloadOffset += maskLen;
    payloadBuffers.push(maskBuf);

    const dataOff = payloadOffset;
    entryBuf.writeUInt32LE(dataOff, 44);
    entryBuf.writeUInt32LE(nibbleLen, 48);
    payloadOffset += nibbleLen;
    payloadBuffers.push(nibbleBuf);

    dirBuffers.push(entryBuf);
  }

  const finalBuffer = Buffer.concat([
    headerBuf,
    ...dirBuffers,
    ...payloadBuffers
  ]);

  const outDir = path.resolve(__dirname, '../data/sprites');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'bit_sprites.sprt');

  fs.writeFileSync(outPath, finalBuffer);
  console.log(`Successfully packed ${count} sprites into ${outPath} (${finalBuffer.length} bytes / ${(finalBuffer.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('Failed to pack bit-sprites:', err);
  process.exit(1);
});
