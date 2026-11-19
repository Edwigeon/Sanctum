import { PALETTE } from '../../shared/Constants.js';

export const BIT_SPRITES = {
  // HUD Action Icons (10x10)
  flask: [
    '...55.....',
    '...44.....',
    '..6776....',
    '.688886...',
    '.687886...',
    '.688886...',
    '.688886...',
    '..6886....',
    '...66.....',
    '..........'
  ],
  sword: [
    '........67',
    '.......676',
    '......676.',
    '.....676..',
    '....676...',
    '..a.676...',
    '.4aa6.....',
    '.44a......',
    '44........',
    '..........'
  ],
  spark: [
    '....cc7...',
    '...c77c...',
    '..c77c....',
    '..777ccc..',
    '...cccc...',
    '....c77...',
    '...c7c....',
    '..c7c.....',
    '.cc.......',
    '..........'
  ],
  helmet: [
    '...aa.....',
    '..a66a....',
    '.a6776a...',
    '.676676...',
    '.660066...',
    '.607706...',
    '.660066...',
    '..6776....',
    '...66.....',
    '..........'
  ],
  satchel: [
    '...4444...',
    '..444444..',
    '.44444444.',
    '.444aa444.',
    '.444aa444.',
    '.44444444.',
    '.45555554.',
    '..444444..',
    '..........',
    '..........'
  ],
  portal: [
    '...5665...',
    '..567765..',
    '.56111165.',
    '.51c11c15.',
    '.511cc115.',
    '.51cccc15.',
    '.511cc115.',
    '.56111165.',
    '.56655665.',
    '..........'
  ],

  // Attribute Icons (8x8)
  might: [
    '..8888..',
    '.88e788.',
    '.888888.',
    '.888888.',
    '..8448..',
    '..4444..',
    '..4..4..',
    '........'
  ],
  focus: [
    '...cc...',
    '.c1771c.',
    'c17cc71c',
    'c7c00c7c',
    'c7c00c7c',
    'c17cc71c',
    '.c1771c.',
    '...cc...'
  ],
  agility: [
    '....bb..',
    '..bb7b..',
    '.b7bb...',
    'bb7b.bb.',
    'b7b.bb..',
    'bbb7b...',
    '.bb7bb..',
    '..bbbb..'
  ],
  vitality: [
    '.88..88.',
    '87888788',
    '88888888',
    '88888888',
    '.888888.',
    '..8888..',
    '...88...',
    '....8...'
  ],

  // Weapons (10x10)
  cleaver: [
    '....66666.',
    '...6667766',
    '..66666666',
    '..6666666.',
    '..6666....',
    '...44.....',
    '....44....',
    '.....44...',
    '......4...',
    '..........'
  ],
  wand: [
    '......cc7.',
    '.....c77c.',
    '....c1cc..',
    '....44....',
    '...44.....',
    '..44......',
    '.44.......',
    '44........',
    '..........',
    '..........'
  ],
  dirk: [
    '.......67.',
    '......676.',
    '.....676..',
    '....676...',
    '...676....',
    '..a.a.....',
    '.a44a.....',
    '..44......',
    '...4......',
    '..........'
  ],
  longsword: [
    '........76',
    '.......76.',
    '......76..',
    '.....76...',
    '....76....',
    '..a.a.....',
    '.aaaaa....',
    '...44.....',
    '....44....',
    '.....a....'
  ],

  // Armor (10x10)
  brigandine: [
    '.4......4.',
    '.44a..a44.',
    '.44444444.',
    '.4a4444a4.',
    '.444aa444.',
    '.444aa444.',
    '.4a4444a4.',
    '.44444444.',
    '..444444..',
    '..........'
  ],
  shroud: [
    '...222...',
    '..22222..',
    '.22d7d22.',
    '.2222222.',
    '.2d222d2.',
    '222222222',
    '22d222d22',
    '222222222',
    '.22...22.',
    '..........'
  ],
  cuirass: [
    '.6......6.',
    '.66....66.',
    '.66666666.',
    '.66777766.',
    '.66677666.',
    '.66666666.',
    '.66666666.',
    '.66666666.',
    '..666666..',
    '..........'
  ],
  vestments: [
    '...dd....',
    '..d11d...',
    '.dd77dd..',
    '.d1aa1d..',
    '.d1111d..',
    'dd1aa1dd.',
    'dd1111dd.',
    'dd1aa1dd.',
    'ddd11ddd.',
    '.........'
  ],

  // Gloves (10x10)
  spikegloves: [
    '7.7.7.....',
    '.6666.....',
    '.66666....',
    '.66666....',
    '..4444....',
    '..4444....',
    '...44.....',
    '..........',
    '..........',
    '..........'
  ],
  gauntlets: [
    '...666....',
    '..66766...',
    '..66766...',
    '..66666...',
    '..66666...',
    '..66666...',
    '...666....',
    '..........',
    '..........',
    '..........'
  ],
  bracers: [
    '...444....',
    '..44a44...',
    '..44444...',
    '..44a44...',
    '..44444...',
    '...444....',
    '..........',
    '..........',
    '..........',
    '..........'
  ],
  grips: [
    '.4.4.4.4..',
    '.4444444..',
    '.4444444..',
    '..44444...',
    '..44444...',
    '...444....',
    '..........',
    '..........',
    '..........',
    '..........'
  ],

  // Rings (10x10)
  signet: [
    '...88.....',
    '..8aa8....',
    '.a8aa8a...',
    '.a....a...',
    '.a....a...',
    '..a..a....',
    '...aa.....',
    '..........',
    '..........',
    '..........'
  ],
  band: [
    '...666....',
    '..67776...',
    '.67...76..',
    '.6.....6..',
    '.67...76..',
    '..67776...',
    '...666....',
    '..........',
    '..........',
    '..........'
  ],
  loop: [
    '...ccc....',
    '..c771c...',
    '.c1...1c..',
    '.c.....c..',
    '.c1...1c..',
    '..c117c...',
    '...ccc....',
    '..........',
    '..........',
    '..........'
  ],
  seal: [
    '...55.....',
    '..5005....',
    '.507705...',
    '.500005...',
    '.5....5...',
    '..5..5....',
    '...55.....',
    '..........',
    '..........',
    '..........'
  ],

  // Slot Placeholders (Empty socket silhouettes)
  slot_weapon: [
    '.....5....',
    '....555...',
    '...55.55..',
    '..55...55.',
    '.55.....55',
    '..55...55.',
    '...55.55..',
    '....555...',
    '.....5....',
    '..........'
  ],
  slot_armor: [
    '.5......5.',
    '.55....55.',
    '.55555555.',
    '.55555555.',
    '.55555555.',
    '.55555555.',
    '.55555555.',
    '..555555..',
    '..........',
    '..........'
  ],
  slot_gloves: [
    '...555....',
    '..55555...',
    '..55555...',
    '..55555...',
    '..55555...',
    '...555....',
    '..........',
    '..........',
    '..........',
    '..........'
  ],
  slot_ring: [
    '...555....',
    '..55.55...',
    '.55...55..',
    '.55...55..',
    '..55.55...',
    '...555....',
    '..........',
    '..........',
    '..........',
    '..........'
  ]
};

const DATA_URL_CACHE = new Map();

/**
 * Renders a bit-array sprite directly onto a canvas context with integer pixel scaling.
 */
export function drawBitSprite(ctx, spriteKey, x, y, pixelScale = 2, palette = PALETTE) {
  const rows = BIT_SPRITES[spriteKey];
  if (!rows) return;

  const h = rows.length;
  const w = rows[0].length;
  const startX = Math.round(x);
  const startY = Math.round(y);
  const pSize = Math.max(1, Math.round(pixelScale));

  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const colIdx = parseInt(ch, 16);
      if (!Number.isNaN(colIdx) && palette[colIdx]) {
        ctx.fillStyle = palette[colIdx];
        ctx.fillRect(startX + c * pSize, startY + r * pSize, pSize, pSize);
      }
    }
  }
}

/**
 * Returns a base64 Data URL for a bit-array sprite, memoized for instant DOM rendering.
 */
export function getBitSpriteDataUrl(spriteKey, pixelScale = 2) {
  const cacheKey = `${spriteKey}_${pixelScale}`;
  if (DATA_URL_CACHE.has(cacheKey)) {
    return DATA_URL_CACHE.get(cacheKey);
  }

  const rows = BIT_SPRITES[spriteKey];
  if (!rows) return '';

  const h = rows.length;
  const w = rows[0].length;
  const pSize = Math.max(1, Math.round(pixelScale));

  const canvas = document.createElement('canvas');
  canvas.width = w * pSize;
  canvas.height = h * pSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const colIdx = parseInt(ch, 16);
      if (!Number.isNaN(colIdx) && PALETTE[colIdx]) {
        ctx.fillStyle = PALETTE[colIdx];
        ctx.fillRect(c * pSize, r * pSize, pSize, pSize);
      }
    }
  }

  const url = canvas.toDataURL();
  DATA_URL_CACHE.set(cacheKey, url);
  return url;
}

/**
 * Maps an item or item base name to its bit sprite key.
 */
export function getItemSpriteKey(item) {
  if (!item) return 'slot_weapon';
  const name = (item.name || item.base || '').toLowerCase();
  for (const key of Object.keys(BIT_SPRITES)) {
    if (name.includes(key)) return key;
  }
  // Fallback by slot
  const slot = (item.slot || '').toLowerCase();
  if (slot === 'weapon') return 'longsword';
  if (slot === 'armor') return 'cuirass';
  if (slot === 'gloves') return 'gauntlets';
  if (slot === 'ring') return 'signet';
  return 'cleaver';
}
