/**
 * 16-Color Palette Swatch Manager & Redmean/Bayer Image Digitizer
 */

import { PALETTE, PALETTE_INDEX, PALETTE_RGB } from '../../../shared/Constants.js';
import { BAYER_4X4 } from '../../systems/LightingSystem.js';

export const PAL_NAMES = Object.keys(PALETTE_INDEX);
export const HEX_CHARS = '0123456789abcdef';
export const ANIM_STATES = ['idle', 'move', 'attack', 'cast', 'hurt', 'death'];

export function u32ToHex(u32) {
  const r = (u32 & 255).toString(16).padStart(2, '0');
  const g = ((u32 >> 8) & 255).toString(16).padStart(2, '0');
  const b = ((u32 >> 16) & 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function nearestPaletteIndex(r, g, b) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 16; i++) {
    const [pr, pg, pb] = PALETTE_RGB[i];
    // Perceptual weighted RGB distance (redmean-inspired)
    const rMean = (r + pr) * 0.5;
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function buildPaletteGrid(studio) {
  const container = document.getElementById('sp-palette-grid');
  container.innerHTML = '';

  const tBtn = document.createElement('button');
  tBtn.type = 'button';
  tBtn.dataset.pal = '-1';
  tBtn.title = 'Transparent (.)';
  tBtn.className = 'sp-swatch h-7 rounded checker-bg border-2 border-slate-700 text-[9px] font-bold text-slate-200';
  tBtn.textContent = '∅';
  tBtn.addEventListener('click', () => studio.setColor(-1));
  container.appendChild(tBtn);

  for (let i = 0; i < 16; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.pal = String(i);
    btn.title = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
    btn.className = 'sp-swatch h-7 rounded border-2 border-slate-700 transition';
    btn.style.setProperty('background-color', PALETTE[i], 'important');
    btn.style.setProperty('background-image', 'none', 'important');
    btn.addEventListener('click', () => studio.setColor(i));
    container.appendChild(btn);
  }
  studio.setColor(studio.selectedColor);
}

export function setColor(studio, idx) {
  studio.selectedColor = idx;
  document.querySelectorAll('.sp-swatch').forEach(el => {
    const isSel = Number(el.dataset.pal) === idx;
    el.style.borderColor = isSel ? '#FACC15' : '#334155';
    el.style.transform = isSel ? 'scale(1.08)' : '';
  });
  const lbl = document.getElementById('sp-cur-color-label');
  lbl.textContent = idx === -1 ? 'TRANSPARENT (.)' : `${idx}: ${PAL_NAMES[idx]} (${PALETTE[idx]})`;
}

export function digitizeImage(studio, img) {
  const sp = studio.getActiveSprite();
  if (!sp || !img) return;
  studio.lastImportedImg = img;
  studio.pushUndo();

  const w = sp.w;
  const h = sp.h;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const oCtx = off.getContext('2d');
  oCtx.clearRect(0, 0, w, h);

  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  oCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

  const data = oCtx.getImageData(0, 0, w, h).data;
  const contrast = Number(document.getElementById('dig-contrast').value) || 1.0;
  const alphaCut = Number(document.getElementById('dig-alpha').value) || 128;
  const useDither = document.getElementById('dig-dither').checked;

  const newGrid = [];
  for (let y = 0; y < h; y++) {
    let rowStr = '';
    for (let x = 0; x < w; x++) {
      const offIdx = (y * w + x) * 4;
      const a = data[offIdx + 3];
      if (a < alphaCut) {
        rowStr += '.';
        continue;
      }
      let r = (data[offIdx] - 128) * contrast + 128;
      let g = (data[offIdx + 1] - 128) * contrast + 128;
      let b = (data[offIdx + 2] - 128) * contrast + 128;

      if (useDither) {
        const bVal = (BAYER_4X4[((y & 3) << 2) + (x & 3)] - 0.5) * 32;
        r += bVal;
        g += bVal;
        b += bVal;
      }
      const palIdx = nearestPaletteIndex(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b))
      );
      rowStr += HEX_CHARS[palIdx];
    }
    newGrid.push(rowStr);
  }

  const frames = studio.getActiveFrames(sp);
  if (frames) frames[studio.activeFrameIdx] = newGrid;
  studio.refreshAll();
  studio.showToast(`Digitized image into ${w}×${h} 16-color grid!`);
}

export function loadImageFile(studio, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => studio.digitizeImage(img);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

export function bindDigitizerEvents(studio) {
  document.getElementById('sp-img-upload').addEventListener('change', (e) => {
    if (e.target.files?.[0]) studio.loadImageFile(e.target.files[0]);
  });

  const dz = document.getElementById('sp-dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('border-amber-400'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('border-amber-400'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('border-amber-400');
    if (e.dataTransfer?.files?.[0]) studio.loadImageFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('paste', (e) => {
    if (document.getElementById('view-sprites').classList.contains('hidden')) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        studio.loadImageFile(item.getAsFile());
        break;
      }
    }
  });

  const reDigitize = () => {
    document.getElementById('lbl-dig-contrast').textContent = document.getElementById('dig-contrast').value;
    document.getElementById('lbl-dig-alpha').textContent = document.getElementById('dig-alpha').value;
    if (studio.lastImportedImg) studio.digitizeImage(studio.lastImportedImg);
  };
  document.getElementById('dig-contrast').addEventListener('input', reDigitize);
  document.getElementById('dig-alpha').addEventListener('input', reDigitize);
  document.getElementById('dig-dither').addEventListener('change', reDigitize);
}
