/**
 * Editor Canvas Viewport, Zoom/Pan, Drawing Tools & Live Lighting Preview
 */

import { PALETTE } from '../../../shared/Constants.js';
import { SHADE_U32 } from '../../systems/LightingSystem.js';
import { PAL_NAMES, HEX_CHARS } from './PaletteAndDigitizer.js';

export function updateEditorCanvasDimensions(studio) {
  const sp = studio.getActiveSprite();
  if (!sp || !studio.editorCanvas) return;
  const baseSize = 384;
  let canvasW, canvasH;
  if (sp.w >= sp.h) {
    canvasW = baseSize;
    canvasH = Math.max(1, Math.round((baseSize * sp.h) / sp.w));
  } else {
    canvasH = baseSize;
    canvasW = Math.max(1, Math.round((baseSize * sp.w) / sp.h));
  }
  if (studio.editorCanvas.width !== canvasW || studio.editorCanvas.height !== canvasH) {
    studio.editorCanvas.width = canvasW;
    studio.editorCanvas.height = canvasH;
  }
  studio.updateViewportTransform();
}

export function updateViewportTransform(studio) {
  if (!studio.editorCanvas) return;
  studio.editorCanvas.style.transform = `translate(${studio.panX}px, ${studio.panY}px) scale(${studio.zoomLevel})`;
  const lbl = document.getElementById('lbl-zoom-level');
  if (lbl) lbl.textContent = `${Math.round(studio.zoomLevel * 100)}%`;
}

export function setZoom(studio, newZoom, mouseX, mouseY) {
  newZoom = Math.max(0.25, Math.min(12.0, newZoom));
  if (Math.abs(newZoom - studio.zoomLevel) < 0.001) return;

  if (mouseX !== undefined && mouseY !== undefined) {
    studio.panX = mouseX - (mouseX - studio.panX) * (newZoom / studio.zoomLevel);
    studio.panY = mouseY - (mouseY - studio.panY) * (newZoom / studio.zoomLevel);
  }
  studio.zoomLevel = newZoom;
  studio.updateViewportTransform();
}

export function fitZoom(studio) {
  const sp = studio.getActiveSprite();
  if (!sp || !studio.viewportEl || !studio.editorCanvas) return;
  const vpW = studio.viewportEl.clientWidth || 384;
  const vpH = studio.viewportEl.clientHeight || 384;
  const baseW = studio.editorCanvas.width || 384;
  const baseH = studio.editorCanvas.height || 384;
  const scale = Math.min((vpW - 32) / baseW, (vpH - 32) / baseH);
  studio.zoomLevel = Math.max(0.25, Math.min(6.0, scale));
  studio.panX = 0;
  studio.panY = 0;
  studio.updateViewportTransform();
}

export function resetZoom(studio) {
  studio.zoomLevel = 1.0;
  studio.panX = 0;
  studio.panY = 0;
  studio.updateViewportTransform();
}

export function renderEditorCanvas(studio) {
  const sp = studio.getActiveSprite();
  const grid = studio.getActiveGrid();
  if (!sp || !grid) return;

  studio.updateEditorCanvasDimensions();

  const cw = studio.editorCanvas.width;
  const ch = studio.editorCanvas.height;
  const ctx = studio.editorCtx;
  ctx.clearRect(0, 0, cw, ch);

  const cellW = cw / sp.w;
  const cellH = ch / sp.h;

  // Optional Onion Skin: ghost previous frame at 28% opacity underneath active frame
  const frames = studio.getActiveFrames(sp);
  if (studio.onionSkin && frames && frames.length > 1) {
    const prevIdx = (studio.activeFrameIdx - 1 + frames.length) % frames.length;
    const prevGrid = frames[prevIdx];
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (let y = 0; y < sp.h; y++) {
      const row = prevGrid[y];
      for (let x = 0; x < sp.w; x++) {
        const chVal = row[x];
        if (chVal && chVal !== '.') {
          const idx = parseInt(chVal, 16);
          if (!Number.isNaN(idx) && PALETTE[idx]) {
            ctx.fillStyle = PALETTE[idx];
            ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
          }
        }
      }
    }
    ctx.restore();
  }

  for (let y = 0; y < sp.h; y++) {
    const row = grid[y];
    for (let x = 0; x < sp.w; x++) {
      const chVal = row[x];
      if (chVal && chVal !== '.') {
        const idx = parseInt(chVal, 16);
        if (!Number.isNaN(idx) && PALETTE[idx]) {
          ctx.fillStyle = PALETTE[idx];
          ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }
  }

  // Subtle pixel gridlines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= sp.w; x++) {
    ctx.moveTo(x * cellW + 0.5, 0);
    ctx.lineTo(x * cellW + 0.5, ch);
  }
  for (let y = 0; y <= sp.h; y++) {
    ctx.moveTo(0, y * cellH + 0.5);
    ctx.lineTo(cw, y * cellH + 0.5);
  }
  ctx.stroke();

  if (studio.mirrorX) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0);
    ctx.lineTo(cw / 2, ch);
    ctx.stroke();
  }
}

export function renderGridToOffscreen(grid, w, h, band = 8) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const u32 = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch && ch !== '.') {
        const idx = parseInt(ch, 16);
        if (!Number.isNaN(idx) && idx >= 0 && idx < 16) {
          u32[y * w + x] = SHADE_U32[band][idx];
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function renderLivePreview(studio) {
  const sp = studio.getActiveSprite();
  const grid = studio.getActiveGrid();
  if (!sp || !grid) return;

  const ctx = studio.liveCtx;
  const cw = studio.liveCanvas.width;
  const ch = studio.liveCanvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, cw, ch);

  const stamp = studio.renderGridToOffscreen(grid, sp.w, sp.h, studio.previewBand);
  const rad = (studio.previewAngle * Math.PI) / 180;
  const flip = studio.previewFlipX;

  if (studio.previewMode === 'tile') {
    const drawSize = Math.floor(cw / 3);
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const tileRad = sp.allowRotate
          ? ((((ty * 37 + tx * 73) ^ (ty * 17)) & 3) * Math.PI * 0.5)
          : rad;
        const tileFlip = sp.allowFlip
          ? ((((ty * 53 + tx * 89) & 1) !== 0))
          : flip;
        ctx.save();
        ctx.translate(tx * drawSize + drawSize / 2, ty * drawSize + drawSize / 2);
        if (tileFlip) ctx.scale(-1, 1);
        ctx.rotate(tileRad);
        ctx.drawImage(stamp, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
      }
    }
  } else {
    const scale = Math.max(2, Math.floor((cw * 0.65) / Math.max(sp.w, sp.h)));
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    if (flip) ctx.scale(-1, 1);
    ctx.rotate(rad);
    ctx.drawImage(stamp, -(sp.w * scale) / 2, -(sp.h * scale) / 2, sp.w * scale, sp.h * scale);
    ctx.restore();
  }
}

export function setPixel(grid, x, y, charVal) {
  if (y < 0 || y >= grid.length) return;
  const row = grid[y];
  if (x < 0 || x >= row.length) return;
  grid[y] = row.slice(0, x) + charVal + row.slice(x + 1);
}

export function floodFill(grid, startX, startY, targetChar, replacementChar) {
  if (targetChar === replacementChar) return;
  const h = grid.length;
  const w = grid[0].length;
  const stack = [[startX, startY]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    if (grid[y][x] !== targetChar) continue;
    setPixel(grid, x, y, replacementChar);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

export function applyToolAt(studio, clientX, clientY, isInitialClick = false) {
  const sp = studio.getActiveSprite();
  const grid = studio.getActiveGrid();
  if (!sp || !grid) return;

  const rect = studio.editorCanvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * sp.w);
  const y = Math.floor(((clientY - rect.top) / rect.height) * sp.h);
  if (x < 0 || x >= sp.w || y < 0 || y >= sp.h) return;

  if (studio.tool === 'pick') {
    const ch = grid[y][x];
    studio.setColor(ch === '.' ? -1 : parseInt(ch, 16));
    studio.setTool('pencil');
    return;
  }

  const paintChar = studio.tool === 'erase' || studio.selectedColor === -1 ? '.' : HEX_CHARS[studio.selectedColor];
  if (studio.tool === 'fill') {
    if (!isInitialClick) return;
    studio.pushUndo();
    studio.floodFill(grid, x, y, grid[y][x], paintChar);
    studio.refreshAll();
    return;
  }

  if (isInitialClick) studio.pushUndo();
  studio.setPixel(grid, x, y, paintChar);
  if (studio.mirrorX) {
    studio.setPixel(grid, sp.w - 1 - x, y, paintChar);
  }
  studio.refreshAll();
}

export function bindViewportAndToolEvents(studio) {
  studio.viewportEl?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = studio.viewportEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    studio.setZoom(studio.zoomLevel * zoomFactor, mouseX, mouseY);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      if (!document.getElementById('view-sprites')?.classList.contains('hidden')) {
        e.preventDefault();
        studio.isSpaceDown = true;
        if (studio.viewportEl) studio.viewportEl.style.cursor = 'grab';
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      studio.isSpaceDown = false;
      if (studio.viewportEl && !studio.isPanning) studio.viewportEl.style.cursor = '';
    }
  });

  const handleMouseDown = (e) => {
    e.preventDefault();
    if (e.button === 1 || (e.button === 0 && studio.isSpaceDown)) {
      studio.isPanning = true;
      studio.startPanMouseX = e.clientX;
      studio.startPanMouseY = e.clientY;
      studio.startPanX = studio.panX;
      studio.startPanY = studio.panY;
      if (studio.viewportEl) studio.viewportEl.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0 || e.button === 2) {
      studio.isDrawing = true;
      if (e.button === 2) {
        const prev = studio.tool;
        studio.tool = 'erase';
        studio.applyToolAt(e.clientX, e.clientY, true);
        studio.tool = prev;
      } else {
        studio.applyToolAt(e.clientX, e.clientY, true);
      }
    }
  };

  studio.editorCanvas.addEventListener('mousedown', handleMouseDown);
  studio.viewportEl?.addEventListener('mousedown', (e) => {
    if (e.target === studio.viewportEl && (e.button === 1 || (e.button === 0 && studio.isSpaceDown))) {
      handleMouseDown(e);
    }
  });

  studio.editorCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  studio.viewportEl?.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('mousemove', (e) => {
    if (studio.isPanning) {
      studio.panX = studio.startPanX + (e.clientX - studio.startPanMouseX);
      studio.panY = studio.startPanY + (e.clientY - studio.startPanMouseY);
      studio.updateViewportTransform();
      return;
    }
    if (studio.isDrawing) {
      studio.applyToolAt(e.clientX, e.clientY, false);
    }

    const sp = studio.getActiveSprite();
    const coordEl = document.getElementById('lbl-editor-coords');
    if (sp && coordEl && studio.editorCanvas) {
      const rect = studio.editorCanvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * sp.w);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * sp.h);
      if (x >= 0 && x < sp.w && y >= 0 && y < sp.h) {
        const grid = studio.getActiveGrid();
        const ch = grid?.[y]?.[x];
        const valDesc = ch === '.' ? '∅' : `${ch} (${PAL_NAMES[parseInt(ch, 16)] || ''})`;
        coordEl.textContent = `x: ${x}, y: ${y} [${valDesc}]`;
      } else {
        coordEl.textContent = 'x: -, y: -';
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (studio.isPanning) {
      studio.isPanning = false;
      if (studio.viewportEl) studio.viewportEl.style.cursor = studio.isSpaceDown ? 'grab' : '';
    }
    studio.isDrawing = false;
  });

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => studio.setZoom(studio.zoomLevel * 1.25));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => studio.setZoom(studio.zoomLevel / 1.25));
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => studio.resetZoom());
  document.getElementById('btn-zoom-fit')?.addEventListener('click', () => studio.fitZoom());

  document.querySelectorAll('.sp-tool-btn').forEach(b => {
    b.addEventListener('click', () => studio.setTool(b.dataset.tool));
  });

  document.getElementById('btn-sp-mirror').addEventListener('click', (e) => {
    studio.mirrorX = !studio.mirrorX;
    e.target.textContent = `Mirror X: ${studio.mirrorX ? 'ON' : 'OFF'}`;
    e.target.className = studio.mirrorX
      ? 'px-2 py-1 rounded bg-amber-600 text-slate-950 font-bold text-[10px]'
      : 'px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[10px]';
    studio.renderEditorCanvas();
  });

  document.getElementById('btn-sp-rot90').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    const grid = studio.getActiveGrid();
    if (!sp || !frames || !grid || sp.w !== sp.h) return;
    studio.pushUndo();
    const n = sp.w;
    const rot = Array.from({ length: n }, (_, y) =>
      Array.from({ length: n }, (_, x) => grid[n - 1 - x][y]).join('')
    );
    frames[studio.activeFrameIdx] = rot;
    studio.refreshAll();
  });

  document.getElementById('btn-sp-fliph').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    const grid = studio.getActiveGrid();
    if (!sp || !frames || !grid) return;
    studio.pushUndo();
    frames[studio.activeFrameIdx] = grid.map(r => r.split('').reverse().join(''));
    studio.refreshAll();
  });

  document.getElementById('btn-sp-flipv').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    const grid = studio.getActiveGrid();
    if (!sp || !frames || !grid) return;
    studio.pushUndo();
    frames[studio.activeFrameIdx] = [...grid].reverse();
    studio.refreshAll();
  });

  document.getElementById('btn-sp-clear').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    if (!sp || !frames) return;
    studio.pushUndo();
    frames[studio.activeFrameIdx] = Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
    studio.refreshAll();
  });

  document.getElementById('btn-sp-undo').addEventListener('click', () => studio.undo());

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (!document.getElementById('view-sprites').classList.contains('hidden')) {
        e.preventDefault();
        studio.undo();
      }
    }
  });
}
