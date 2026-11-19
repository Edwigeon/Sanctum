import { PALETTE, PALETTE_INDEX, PALETTE_RGB } from '../../shared/Constants.js';
import { SHADE_U32, BAYER_4X4 } from '../systems/LightingSystem.js';

const PAL_NAMES = Object.keys(PALETTE_INDEX);
const HEX_CHARS = '0123456789abcdef';
const ANIM_STATES = ['idle', 'move', 'attack', 'cast', 'hurt', 'death'];

function u32ToHex(u32) {
  const r = (u32 & 255).toString(16).padStart(2, '0');
  const g = ((u32 >> 8) & 255).toString(16).padStart(2, '0');
  const b = ((u32 >> 16) & 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function nearestPaletteIndex(r, g, b) {
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

export class SpriteStudio {
  constructor({ getAuthHeaders, showToast }) {
    this.getAuthHeaders = getAuthHeaders;
    this.showToast = showToast;

    this.bank = { tiles: {}, entities: {}, objects: {}, items: {} };
    this.activeCat = 'tiles';
    this.activeId = 'floor_stone';
    this.activeState = 'idle';
    this.activeFrameIdx = 0;
    this.isTileMode = true;

    this.selectedColor = PALETTE_INDEX.ORANGE; // 0..15 or -1 for transparent
    this.tool = 'pencil';
    this.mirrorX = false;
    this.isDrawing = false;
    this.undoStack = [];

    this.previewMode = 'tile'; // 'tile' | 'rot'
    this.previewBand = 8;
    this.previewAngle = 0; // Snaps to 0, 90, 180, 270
    this.previewFlipX = false;
    this.animPlaying = false;
    this.animTimer = null;
    this.animFps = 4;
    this.animPingPong = false;
    this.animDir = 1;
    this.onionSkin = false;
    this.selectedFolder = 'ALL';
    this.bankViewMode = 'category'; // 'category' | 'folder'
    this.collapsedFolders = new Set();
    this.allKnownFolders = new Set(['common', 'crypt', 'cavern', 'overworld']);

    this.lastImportedImg = null;

    this.viewportEl = document.getElementById('sp-viewport');
    this.editorCanvas = document.getElementById('sp-editor-canvas');
    this.editorCtx = this.editorCanvas.getContext('2d');
    this.liveCanvas = document.getElementById('sp-live-preview');
    this.liveCtx = this.liveCanvas.getContext('2d');

    // Pan & Zoom state
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.isSpaceDown = false;
    this.startPanMouseX = 0;
    this.startPanMouseY = 0;
    this.startPanX = 0;
    this.startPanY = 0;
  }

  async init() {
    this.buildPaletteGrid();
    this.bindEvents();
    try {
      const res = await fetch('/api/dev/sprites');
      const data = await res.json();
      this.bank = {
        tiles: data.tiles || {},
        entities: data.entities || {},
        objects: data.objects || {},
        items: data.items || {}
      };

      // Seamlessly normalize variants and frames for all tiles and sprites
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        for (const [id, def] of Object.entries(this.bank[cat])) {
          if (def.variants && !def.frames && !def.states) {
            def.frames = def.variants;
          }
          if (def.frames && !def.variants && (cat === 'tiles' || def.isTile)) {
            def.variants = def.frames;
          }
          if (id.includes('/')) {
            this.allKnownFolders.add(id.split('/')[0]);
          }
        }
      }
    } catch {
      this.showToast('Failed to load sprites.json', true);
    }

    // Select first available sprite
    for (const cat of ['tiles', 'entities', 'objects', 'items']) {
      const keys = Object.keys(this.bank[cat]);
      if (keys.length > 0) {
        this.activeCat = cat;
        this.activeId = keys[0];
        break;
      }
    }

    this.syncFolderControls();
    this.renderBankList();
    this.selectSprite(this.activeCat, this.activeId);
  }

  getActiveSprite() {
    return this.bank[this.activeCat]?.[this.activeId] || null;
  }

  getActiveStateObj(sp = this.getActiveSprite()) {
    if (!sp) return null;
    if (sp.states && typeof sp.states === 'object') {
      if (!sp.states[this.activeState]) {
        this.activeState = sp.states.idle ? 'idle' : Object.keys(sp.states)[0];
      }
      const st = sp.states[this.activeState];
      if (!st.frames || st.frames.length === 0) {
        st.frames = [Array.from({ length: sp.h }, () => '.'.repeat(sp.w))];
      }
      return st;
    }
    // Seamless support for variants on tiles
    if (!sp.frames && sp.variants) {
      sp.frames = sp.variants;
    }
    if (!sp.variants && sp.frames && (this.activeCat === 'tiles' || sp.isTile)) {
      sp.variants = sp.frames;
    }
    if (!sp.frames || sp.frames.length === 0) {
      sp.frames = [Array.from({ length: sp.h }, () => '.'.repeat(sp.w))];
      if (this.activeCat === 'tiles' || sp.isTile) sp.variants = sp.frames;
    }
    return sp;
  }

  getActiveFrames(sp = this.getActiveSprite()) {
    if (!sp) return null;
    const st = this.getActiveStateObj(sp);
    return st?.frames || st?.variants || sp.variants || sp.frames || null;
  }

  selectOrCreateState(stateName) {
    const sp = this.getActiveSprite();
    if (!sp) return;
    if (!sp.states) {
      sp.states = {
        idle: {
          fps: sp.fps || 4,
          pingPong: !!sp.pingPong,
          frames: sp.frames || [Array.from({ length: sp.h }, () => '.'.repeat(sp.w))]
        }
      };
      delete sp.frames;
      delete sp.fps;
      delete sp.pingPong;
    }
    if (!sp.states[stateName]) {
      const seedFrame = sp.states.idle?.frames?.[0] || Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
      const defaultFps = stateName === 'attack' || stateName === 'cast' ? 10 : (stateName === 'move' ? 8 : 4);
      sp.states[stateName] = { fps: defaultFps, frames: [[...seedFrame]] };
    }
    this.activeState = stateName;
    this.activeFrameIdx = 0;
    this.animDir = 1;
    this.undoStack = [];
    this.syncStateTimingUI();
    this.renderBankList();
    this.refreshAll();
  }

  syncStateTimingUI() {
    const st = this.getActiveStateObj();
    this.animFps = st?.fps || 4;
    this.animPingPong = !!st?.pingPong;
    const fpsEl = document.getElementById('anim-fps');
    if (fpsEl) {
      fpsEl.value = this.animFps;
      document.getElementById('lbl-anim-fps').textContent = `${this.animFps} FPS`;
    }
    const ppEl = document.getElementById('anim-pingpong');
    if (ppEl) ppEl.checked = this.animPingPong;
    if (this.animPlaying) this.restartAnimTimer();
  }

  getActiveGrid() {
    const frames = this.getActiveFrames();
    if (!frames) return null;
    this.activeFrameIdx = Math.max(0, Math.min(frames.length - 1, this.activeFrameIdx));
    return frames[this.activeFrameIdx];
  }

  pushUndo() {
    const grid = this.getActiveGrid();
    if (!grid) return;
    this.undoStack.push([...grid]);
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  undo() {
    const frames = this.getActiveFrames();
    if (!frames || this.undoStack.length === 0) return;
    frames[this.activeFrameIdx] = this.undoStack.pop();
    this.refreshAll();
  }

  buildPaletteGrid() {
    const container = document.getElementById('sp-palette-grid');
    container.innerHTML = '';

    // Transparent swatch
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.dataset.pal = '-1';
    tBtn.title = 'Transparent (.)';
    tBtn.className = 'sp-swatch h-7 rounded checker-bg border-2 border-slate-700 text-[9px] font-bold text-slate-200';
    tBtn.textContent = '∅';
    tBtn.addEventListener('click', () => this.setColor(-1));
    container.appendChild(tBtn);

    for (let i = 0; i < 16; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.pal = String(i);
      btn.title = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
      btn.className = 'sp-swatch h-7 rounded border-2 border-slate-700 transition';
      btn.style.setProperty('background-color', PALETTE[i], 'important');
      btn.style.setProperty('background-image', 'none', 'important');
      btn.addEventListener('click', () => this.setColor(i));
      container.appendChild(btn);
    }
    this.setColor(this.selectedColor);
  }

  setColor(idx) {
    this.selectedColor = idx;
    document.querySelectorAll('.sp-swatch').forEach(el => {
      const isSel = Number(el.dataset.pal) === idx;
      el.style.borderColor = isSel ? '#FACC15' : '#334155';
      el.style.transform = isSel ? 'scale(1.08)' : '';
    });
    const lbl = document.getElementById('sp-cur-color-label');
    lbl.textContent = idx === -1 ? 'TRANSPARENT (.)' : `${idx}: ${PAL_NAMES[idx]} (${PALETTE[idx]})`;
  }

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('.sp-tool-btn').forEach(b => {
      const active = b.dataset.tool === tool;
      b.className = active
        ? 'sp-tool-btn px-2 py-1 rounded bg-amber-600 text-slate-950 font-bold text-[10px]'
        : 'sp-tool-btn px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]';
    });
  }

  syncFolderControls() {
    // Scan all folders in bank
    const folders = new Set(this.allKnownFolders);
    const countsByFolder = {};
    for (const f of folders) countsByFolder[f] = 0;

    for (const cat of ['tiles', 'entities', 'objects', 'items']) {
      for (const id of Object.keys(this.bank[cat] || {})) {
        const f = id.includes('/') ? id.split('/')[0] : 'common';
        folders.add(f);
        countsByFolder[f] = (countsByFolder[f] || 0) + 1;
      }
    }
    const sortedFolders = Array.from(folders).sort();

    // Populate Folder Filter
    const filterEl = document.getElementById('sp-folder-filter');
    if (filterEl) {
      const cur = this.selectedFolder;
      filterEl.innerHTML = '<option value="ALL">📁 All Folders</option>';
      for (const f of sortedFolders) {
        const opt = document.createElement('option');
        opt.value = f;
        const count = countsByFolder[f] || 0;
        opt.textContent = `📁 ${f} (${count})`;
        if (f === cur) opt.selected = true;
        filterEl.appendChild(opt);
      }
      const newOpt = document.createElement('option');
      newOpt.value = '__NEW__';
      newOpt.textContent = '+ New Folder / Biome...';
      filterEl.appendChild(newOpt);
    }

    // Populate New Sprite Folder Target
    const newFolderEl = document.getElementById('sp-new-folder');
    if (newFolderEl) {
      const cur = newFolderEl.value || (this.selectedFolder === 'ALL' ? 'common' : this.selectedFolder);
      newFolderEl.innerHTML = '';
      for (const f of sortedFolders) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = `📁 ${f}`;
        if (f === cur) opt.selected = true;
        newFolderEl.appendChild(opt);
      }
      const newOpt = document.createElement('option');
      newOpt.value = '__NEW__';
      newOpt.textContent = '+ New Folder...';
      newFolderEl.appendChild(newOpt);
    }

    // Update New Sprite Destination label
    const destLbl = document.getElementById('lbl-create-dest');
    if (destLbl) {
      const targetF = newFolderEl ? newFolderEl.value : (this.selectedFolder === 'ALL' ? 'common' : this.selectedFolder);
      destLbl.textContent = `in ${targetF}/`;
    }

    // Populate Move Modal Folder Target
    const moveFolderEl = document.getElementById('move-folder-select');
    if (moveFolderEl) {
      const cur = moveFolderEl.value;
      moveFolderEl.innerHTML = '';
      for (const f of sortedFolders) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = `📁 ${f}`;
        if (f === cur) opt.selected = true;
        moveFolderEl.appendChild(opt);
      }
    }
  }

  renderBankList() {
    const list = document.getElementById('sp-bank-list');
    if (!list) return;
    list.innerHTML = '';
    this.syncFolderControls();

    const folderFilter = this.selectedFolder;

    if (this.bankViewMode === 'folder') {
      // Group by Folder
      const folders = new Set(this.allKnownFolders);
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        for (const id of Object.keys(this.bank[cat] || {})) {
          const f = id.includes('/') ? id.split('/')[0] : 'common';
          folders.add(f);
        }
      }

      const activeFolders = Array.from(folders).sort().filter(f => {
        if (folderFilter === 'ALL') return true;
        return f === folderFilter;
      });

      for (const folder of activeFolders) {
        const items = [];
        for (const cat of ['tiles', 'entities', 'objects', 'items']) {
          for (const id of Object.keys(this.bank[cat] || {})) {
            const f = id.includes('/') ? id.split('/')[0] : 'common';
            if (f === folder) {
              items.push({ cat, id, sp: this.bank[cat][id] });
            }
          }
        }

        const isCollapsed = this.collapsedFolders.has(folder);

        const folderHeader = document.createElement('div');
        folderHeader.className = 'flex items-center justify-between px-2 py-1 bg-slate-950/80 border border-slate-800 rounded cursor-pointer hover:border-slate-700 select-none text-[11px] font-bold text-amber-300';
        folderHeader.innerHTML = `
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 text-[10px]">${isCollapsed ? '▶' : '▼'}</span>
            <span>📁 ${folder}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">${items.length}</span>
        `;
        folderHeader.addEventListener('click', () => {
          if (this.collapsedFolders.has(folder)) {
            this.collapsedFolders.delete(folder);
          } else {
            this.collapsedFolders.add(folder);
          }
          this.renderBankList();
        });
        list.appendChild(folderHeader);

        if (!isCollapsed) {
          if (items.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'text-[10px] text-slate-500 italic px-3 py-1';
            emptyEl.textContent = '(empty folder)';
            list.appendChild(emptyEl);
          } else {
            items.sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id));
            for (const { cat, id, sp } of items) {
              const isSel = cat === this.activeCat && id === this.activeId;
              const row = document.createElement('button');
              row.type = 'button';
              row.className = `w-full flex items-center justify-between px-2 py-1 rounded border text-left transition ${
                isSel
                  ? 'border-amber-500 bg-amber-950/30 text-amber-200 font-bold'
                  : 'border-slate-800/80 bg-slate-950/40 hover:border-slate-700 text-slate-300'
              }`;

              const isTile = cat === 'tiles';
              const stCount = sp.states ? Object.keys(sp.states).length : 0;
              const count = isTile
                ? (sp.variants?.length || sp.frames?.length || 1)
                : (sp.frames?.length || 1);
              const meta = isTile
                ? `${count}v`
                : (stCount > 0 ? `${stCount}st` : `${count}f`);

              const cleanName = id.includes('/') ? id.split('/')[1] : id;
              const catBadge = cat === 'tiles' ? 'tile' : (cat === 'entities' ? 'ent' : (cat === 'objects' ? 'obj' : 'item'));
              const catBadgeColor = cat === 'tiles' ? 'bg-cyan-950 text-cyan-400 border-cyan-800' : (cat === 'entities' ? 'bg-amber-950 text-amber-400 border-amber-800' : 'bg-slate-800 text-slate-300 border-slate-700');

              row.innerHTML = `
                <div class="flex items-center gap-1.5 truncate">
                  <span class="text-[9px] uppercase px-1 py-0.2 rounded border ${catBadgeColor} font-mono">${catBadge}</span>
                  <span class="truncate ${isSel ? 'text-amber-200 font-bold' : 'text-slate-100'}">${cleanName}</span>
                </div>
                <span class="text-[10px] text-amber-300 font-mono ml-1 shrink-0">${sp.w}×${sp.h} (${meta})</span>
              `;
              row.addEventListener('click', () => this.selectSprite(cat, id));
              list.appendChild(row);
            }
          }
        }
      }
    } else {
      // Category view
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        const allKeys = Object.keys(this.bank[cat] || {});
        const matchedKeys = allKeys.filter(id => {
          if (folderFilter === 'ALL') return true;
          if (!id.includes('/')) return folderFilter === 'common';
          return id.startsWith(`${folderFilter}/`);
        });
        if (matchedKeys.length === 0) continue;

        const header = document.createElement('div');
        header.className = 'text-[11px] uppercase tracking-wider text-amber-400 font-bold pt-2 pb-1 border-b border-slate-800 flex justify-between';
        header.innerHTML = `<span>${cat}</span><span class="text-slate-400">${matchedKeys.length}</span>`;
        list.appendChild(header);

        for (const id of matchedKeys) {
          const sp = this.bank[cat][id];
          const isSel = cat === this.activeCat && id === this.activeId;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = `w-full flex items-center justify-between px-2 py-1.5 rounded border text-left transition ${
            isSel
              ? 'border-amber-500 bg-amber-950/30 text-amber-200 font-bold'
              : 'border-slate-800 bg-slate-950/60 hover:border-slate-600 text-slate-300'
          }`;
          const isTile = cat === 'tiles';
          const stCount = sp.states ? Object.keys(sp.states).length : 0;
          const count = isTile
            ? (sp.variants?.length || sp.frames?.length || 1)
            : (sp.frames?.length || 1);
          const meta = isTile
            ? `${count}v`
            : (stCount > 0 ? `${stCount}st` : `${count}f`);
          
          let displayName = '';
          if (folderFilter === 'ALL' && id.includes('/')) {
            const [f, base] = id.split('/');
            displayName = `<span class="text-amber-400 font-normal">${f}/</span><span class="text-slate-100 font-semibold">${base}</span>`;
          } else {
            const base = id.includes('/') ? id.split('/')[1] : id;
            displayName = `<span class="text-slate-100 font-semibold">${base}</span>`;
          }

          row.innerHTML = `<span class="truncate">${displayName}</span><span class="text-[10px] text-amber-300 font-mono ml-1 shrink-0">${sp.w}×${sp.h} (${meta})</span>`;
          row.addEventListener('click', () => this.selectSprite(cat, id));
          list.appendChild(row);
        }
      }
    }
  }

  selectSprite(cat, id) {
    this.activeCat = cat;
    this.activeId = id;
    this.activeState = 'idle';
    this.activeFrameIdx = 0;
    this.animDir = 1;
    this.undoStack = [];
    this.previewMode = cat === 'tiles' ? 'tile' : 'rot';
    this.isTileMode = cat === 'tiles';

    const sp = this.getActiveSprite();
    const rotWrap = document.getElementById('wrap-tile-autorot');
    const rotChk = document.getElementById('sp-allow-rot');
    const flipWrap = document.getElementById('wrap-tile-autoflip');
    const flipChk = document.getElementById('sp-allow-flip');
    if (rotWrap && rotChk) {
      rotWrap.classList.toggle('hidden', cat !== 'tiles');
      rotChk.checked = !!sp?.allowRotate;
    }
    if (flipWrap && flipChk) {
      flipWrap.classList.toggle('hidden', cat !== 'tiles');
      flipChk.checked = !!sp?.allowFlip;
    }

    // Toggle Timeline label and controls between Animated Entities and Static Tile Variants
    const titleEl = document.getElementById('anim-section-title');
    const stateBarEl = document.getElementById('sp-state-bar');
    const speedControlsEl = document.getElementById('anim-speed-controls');
    const onionBtn = document.getElementById('btn-anim-onion');
    const playBtn = document.getElementById('btn-prev-anim');

    if (titleEl) {
      titleEl.textContent = this.isTileMode ? 'Tile Variants' : 'Animation Timeline';
    }
    if (stateBarEl) {
      stateBarEl.classList.toggle('hidden', this.isTileMode);
    }
    if (speedControlsEl) {
      speedControlsEl.classList.toggle('hidden', this.isTileMode);
    }
    if (onionBtn) {
      onionBtn.classList.toggle('hidden', this.isTileMode);
    }
    if (playBtn) {
      playBtn.classList.toggle('hidden', this.isTileMode);
    }

    if (this.isTileMode && this.animPlaying) {
      this.animPlaying = false;
      clearInterval(this.animTimer);
      if (playBtn) playBtn.textContent = '▶ Play';
    }

    this.syncStateTimingUI();
    this.syncPreviewButtons();
    this.updateEditorCanvasDimensions();
    this.renderBankList();
    this.refreshAll();
  }

  syncPreviewButtons() {
    const btnTile = document.getElementById('btn-prev-tile');
    const btnRot = document.getElementById('btn-prev-rot');
    btnTile.className = this.previewMode === 'tile'
      ? 'px-2 py-0.5 rounded bg-indigo-600 text-white font-bold'
      : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
    btnRot.className = this.previewMode === 'rot'
      ? 'px-2 py-0.5 rounded bg-indigo-600 text-white font-bold'
      : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
  }

  renderFrameBar() {
    const bar = document.getElementById('sp-frame-bar');
    const frames = this.getActiveFrames();
    bar.innerHTML = '';
    if (!frames) return;

    const prefix = this.isTileMode ? 'V' : 'F';
    frames.forEach((_, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = idx === this.activeFrameIdx
        ? 'px-2 py-0.5 rounded bg-cyan-600 text-slate-950 font-bold text-[10px]'
        : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]';
      b.textContent = `${prefix}${idx + 1}`;
      b.addEventListener('click', () => {
        this.activeFrameIdx = idx;
        this.undoStack = [];
        this.refreshAll();
      });
      bar.appendChild(b);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'px-1.5 py-0.5 rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 text-[10px]';
    addBtn.textContent = `+${prefix}`;
    addBtn.title = this.isTileMode ? 'Duplicate Current Variant' : 'Duplicate Current Frame';
    addBtn.addEventListener('click', () => {
      frames.push([...this.getActiveGrid()]);
      this.activeFrameIdx = frames.length - 1;
      this.renderBankList();
      this.refreshAll();
    });
    bar.appendChild(addBtn);

    if (frames.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'px-1.5 py-0.5 rounded bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-[10px]';
      delBtn.textContent = `-${prefix}`;
      delBtn.title = this.isTileMode ? 'Delete Current Variant' : 'Delete Current Frame';
      delBtn.addEventListener('click', () => {
        frames.splice(this.activeFrameIdx, 1);
        this.activeFrameIdx = Math.max(0, this.activeFrameIdx - 1);
        this.renderBankList();
        this.refreshAll();
      });
      bar.appendChild(delBtn);
    }
  }

  renderStateBar() {
    const bar = document.getElementById('sp-state-bar');
    const sp = this.getActiveSprite();
    if (!bar) return;
    bar.innerHTML = '';
    if (!sp) return;

    for (const stName of ANIM_STATES) {
      const hasState = sp.states ? !!sp.states[stName] : (stName === 'idle');
      const count = sp.states ? (sp.states[stName]?.frames?.length || 0) : (stName === 'idle' ? (sp.frames?.length || 1) : 0);
      const isAct = stName === this.activeState;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isAct
        ? 'px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold'
        : hasState
          ? 'px-2 py-0.5 rounded bg-slate-800 text-cyan-200 border border-cyan-800/70 hover:border-cyan-500'
          : 'px-2 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300 hover:border-slate-600';
      btn.textContent = hasState ? `${stName} (${count})` : `+ ${stName}`;
      btn.title = hasState ? `Edit "${stName}" animation` : `Create "${stName}" animation state`;
      btn.addEventListener('click', () => this.selectOrCreateState(stName));
      bar.appendChild(btn);
    }
  }

  refreshAll() {
    const sp = this.getActiveSprite();
    if (!sp) return;
    if (this.isTileMode || sp.variants) {
      const frames = this.getActiveFrames(sp);
      if (frames) sp.variants = frames;
    }
    document.getElementById('sp-active-title').textContent = `${this.activeCat} / ${this.activeId}`;
    document.getElementById('sp-active-dims').textContent = `${sp.w}×${sp.h}`;
    this.renderFrameBar();
    this.renderStateBar();
    this.renderAnimStrip();
    this.renderEditorCanvas();
    this.renderLivePreview();
    document.getElementById('sp-hex-output').value = JSON.stringify(this.getActiveGrid(), null, 2);
  }

  renderAnimStrip() {
    const strip = document.getElementById('sp-anim-strip');
    const sp = this.getActiveSprite();
    const frames = this.getActiveFrames(sp);
    if (!strip) return;
    strip.innerHTML = '';
    if (!sp || !frames) return;

    frames.forEach((grid, idx) => {
      const isAct = idx === this.activeFrameIdx;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `shrink-0 flex flex-col items-center p-1 rounded border transition ${
        isAct
          ? 'border-amber-400 bg-amber-950/30'
          : 'border-slate-800 bg-black hover:border-slate-600'
      }`;
      const thumb = document.createElement('canvas');
      thumb.width = sp.w;
      thumb.height = sp.h;
      thumb.className = 'pixelated w-11 h-11';
      const tCtx = thumb.getContext('2d');
      tCtx.imageSmoothingEnabled = false;
      tCtx.drawImage(this.renderGridToOffscreen(grid, sp.w, sp.h, this.previewBand), 0, 0);

      const lbl = document.createElement('span');
      lbl.className = `text-[9px] mt-0.5 ${isAct ? 'text-amber-300 font-bold' : 'text-slate-400'}`;
      lbl.textContent = `${this.isTileMode ? 'V' : 'F'}${idx + 1}`;

      card.appendChild(thumb);
      card.appendChild(lbl);
      card.addEventListener('click', () => {
        this.activeFrameIdx = idx;
        this.undoStack = [];
        this.refreshAll();
      });
      strip.appendChild(card);
    });
  }

  restartAnimTimer() {
    clearInterval(this.animTimer);
    this.animTimer = null;
    if (!this.animPlaying) return;
    const intervalMs = Math.max(40, Math.round(1000 / Math.max(1, this.animFps)));
    this.animTimer = setInterval(() => {
      const frames = this.getActiveFrames();
      if (!frames || frames.length <= 1) return;
      if (this.animPingPong) {
        let next = this.activeFrameIdx + this.animDir;
        if (next >= frames.length) {
          this.animDir = -1;
          next = Math.max(0, frames.length - 2);
        } else if (next < 0) {
          this.animDir = 1;
          next = Math.min(frames.length - 1, 1);
        }
        this.activeFrameIdx = next;
      } else {
        this.activeFrameIdx = (this.activeFrameIdx + 1) % frames.length;
      }
      this.refreshAll();
    }, intervalMs);
  }

  updateEditorCanvasDimensions() {
    const sp = this.getActiveSprite();
    if (!sp || !this.editorCanvas) return;
    const baseSize = 384;
    let canvasW, canvasH;
    if (sp.w >= sp.h) {
      canvasW = baseSize;
      canvasH = Math.max(1, Math.round((baseSize * sp.h) / sp.w));
    } else {
      canvasH = baseSize;
      canvasW = Math.max(1, Math.round((baseSize * sp.w) / sp.h));
    }
    if (this.editorCanvas.width !== canvasW || this.editorCanvas.height !== canvasH) {
      this.editorCanvas.width = canvasW;
      this.editorCanvas.height = canvasH;
    }
    this.updateViewportTransform();
  }

  updateViewportTransform() {
    if (!this.editorCanvas) return;
    this.editorCanvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    const lbl = document.getElementById('lbl-zoom-level');
    if (lbl) lbl.textContent = `${Math.round(this.zoomLevel * 100)}%`;
  }

  setZoom(newZoom, mouseX, mouseY) {
    newZoom = Math.max(0.25, Math.min(12.0, newZoom));
    if (Math.abs(newZoom - this.zoomLevel) < 0.001) return;

    if (mouseX !== undefined && mouseY !== undefined) {
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoomLevel);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoomLevel);
    }
    this.zoomLevel = newZoom;
    this.updateViewportTransform();
  }

  fitZoom() {
    const sp = this.getActiveSprite();
    if (!sp || !this.viewportEl || !this.editorCanvas) return;
    const vpW = this.viewportEl.clientWidth || 384;
    const vpH = this.viewportEl.clientHeight || 384;
    const baseW = this.editorCanvas.width || 384;
    const baseH = this.editorCanvas.height || 384;
    const scale = Math.min((vpW - 32) / baseW, (vpH - 32) / baseH);
    this.zoomLevel = Math.max(0.25, Math.min(6.0, scale));
    this.panX = 0;
    this.panY = 0;
    this.updateViewportTransform();
  }

  resetZoom() {
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateViewportTransform();
  }

  renderEditorCanvas() {
    const sp = this.getActiveSprite();
    const grid = this.getActiveGrid();
    if (!sp || !grid) return;

    this.updateEditorCanvasDimensions();

    const cw = this.editorCanvas.width;
    const ch = this.editorCanvas.height;
    const ctx = this.editorCtx;
    ctx.clearRect(0, 0, cw, ch);

    const cellW = cw / sp.w;
    const cellH = ch / sp.h;

    // Optional Onion Skin: ghost previous frame at 28% opacity underneath active frame
    const frames = this.getActiveFrames(sp);
    if (this.onionSkin && frames && frames.length > 1) {
      const prevIdx = (this.activeFrameIdx - 1 + frames.length) % frames.length;
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

    if (this.mirrorX) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cw / 2, 0);
      ctx.lineTo(cw / 2, ch);
      ctx.stroke();
    }
  }

  renderGridToOffscreen(grid, w, h, band = 8) {
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

  renderLivePreview() {
    const sp = this.getActiveSprite();
    const grid = this.getActiveGrid();
    if (!sp || !grid) return;

    const ctx = this.liveCtx;
    const cw = this.liveCanvas.width;
    const ch = this.liveCanvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    const stamp = this.renderGridToOffscreen(grid, sp.w, sp.h, this.previewBand);
    const rad = (this.previewAngle * Math.PI) / 180;
    const flip = this.previewFlipX;

    if (this.previewMode === 'tile') {
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

  setPixel(grid, x, y, charVal) {
    if (y < 0 || y >= grid.length) return;
    const row = grid[y];
    if (x < 0 || x >= row.length) return;
    grid[y] = row.slice(0, x) + charVal + row.slice(x + 1);
  }

  floodFill(grid, startX, startY, targetChar, replacementChar) {
    if (targetChar === replacementChar) return;
    const h = grid.length;
    const w = grid[0].length;
    const stack = [[startX, startY]];
    while (stack.length > 0) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (grid[y][x] !== targetChar) continue;
      this.setPixel(grid, x, y, replacementChar);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  applyToolAt(clientX, clientY, isInitialClick = false) {
    const sp = this.getActiveSprite();
    const grid = this.getActiveGrid();
    if (!sp || !grid) return;

    const rect = this.editorCanvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * sp.w);
    const y = Math.floor(((clientY - rect.top) / rect.height) * sp.h);
    if (x < 0 || x >= sp.w || y < 0 || y >= sp.h) return;

    if (this.tool === 'pick') {
      const ch = grid[y][x];
      this.setColor(ch === '.' ? -1 : parseInt(ch, 16));
      this.setTool('pencil');
      return;
    }

    const paintChar = this.tool === 'erase' || this.selectedColor === -1 ? '.' : HEX_CHARS[this.selectedColor];
    if (this.tool === 'fill') {
      if (!isInitialClick) return;
      this.pushUndo();
      this.floodFill(grid, x, y, grid[y][x], paintChar);
      this.refreshAll();
      return;
    }

    if (isInitialClick) this.pushUndo();
    this.setPixel(grid, x, y, paintChar);
    if (this.mirrorX) {
      this.setPixel(grid, sp.w - 1 - x, y, paintChar);
    }
    this.refreshAll();
  }

  digitizeImage(img) {
    const sp = this.getActiveSprite();
    if (!sp || !img) return;
    this.lastImportedImg = img;
    this.pushUndo();

    const w = sp.w;
    const h = sp.h;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const oCtx = off.getContext('2d');
    oCtx.clearRect(0, 0, w, h);

    // Aspect-preserving contain draw centered in W x H
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

    const frames = this.getActiveFrames(sp);
    if (frames) frames[this.activeFrameIdx] = newGrid;
    this.refreshAll();
    this.showToast(`Digitized image into ${w}×${h} 16-color grid!`);
  }

  loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => this.digitizeImage(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  bindEvents() {
    // Zoom & Pan viewport controls
    this.viewportEl?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.viewportEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.setZoom(this.zoomLevel * zoomFactor, mouseX, mouseY);
    }, { passive: false });

    // Spacebar to trigger Pan mode
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        if (!document.getElementById('view-sprites')?.classList.contains('hidden')) {
          e.preventDefault();
          this.isSpaceDown = true;
          if (this.viewportEl) this.viewportEl.style.cursor = 'grab';
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        if (this.viewportEl && !this.isPanning) this.viewportEl.style.cursor = '';
      }
    });

    const handleMouseDown = (e) => {
      e.preventDefault();
      // Middle-click or Space+Left-Click pans
      if (e.button === 1 || (e.button === 0 && this.isSpaceDown)) {
        this.isPanning = true;
        this.startPanMouseX = e.clientX;
        this.startPanMouseY = e.clientY;
        this.startPanX = this.panX;
        this.startPanY = this.panY;
        if (this.viewportEl) this.viewportEl.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0 || e.button === 2) {
        this.isDrawing = true;
        if (e.button === 2) {
          const prev = this.tool;
          this.tool = 'erase';
          this.applyToolAt(e.clientX, e.clientY, true);
          this.tool = prev;
        } else {
          this.applyToolAt(e.clientX, e.clientY, true);
        }
      }
    };

    this.editorCanvas.addEventListener('mousedown', handleMouseDown);
    this.viewportEl?.addEventListener('mousedown', (e) => {
      if (e.target === this.viewportEl && (e.button === 1 || (e.button === 0 && this.isSpaceDown))) {
        handleMouseDown(e);
      }
    });

    this.editorCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.viewportEl?.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = this.startPanX + (e.clientX - this.startPanMouseX);
        this.panY = this.startPanY + (e.clientY - this.startPanMouseY);
        this.updateViewportTransform();
        return;
      }
      if (this.isDrawing) {
        this.applyToolAt(e.clientX, e.clientY, false);
      }

      // Live hover coordinate inspection
      const sp = this.getActiveSprite();
      const coordEl = document.getElementById('lbl-editor-coords');
      if (sp && coordEl && this.editorCanvas) {
        const rect = this.editorCanvas.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * sp.w);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * sp.h);
        if (x >= 0 && x < sp.w && y >= 0 && y < sp.h) {
          const grid = this.getActiveGrid();
          const ch = grid?.[y]?.[x];
          const valDesc = ch === '.' ? '∅' : `${ch} (${PAL_NAMES[parseInt(ch, 16)] || ''})`;
          coordEl.textContent = `x: ${x}, y: ${y} [${valDesc}]`;
        } else {
          coordEl.textContent = 'x: -, y: -';
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        if (this.viewportEl) this.viewportEl.style.cursor = this.isSpaceDown ? 'grab' : '';
      }
      this.isDrawing = false;
    });

    // Zoom Buttons
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoomLevel * 1.25));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoomLevel / 1.25));
    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => this.resetZoom());
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.fitZoom());

    document.querySelectorAll('.sp-tool-btn').forEach(b => {
      b.addEventListener('click', () => this.setTool(b.dataset.tool));
    });

    document.getElementById('btn-sp-mirror').addEventListener('click', (e) => {
      this.mirrorX = !this.mirrorX;
      e.target.textContent = `Mirror X: ${this.mirrorX ? 'ON' : 'OFF'}`;
      e.target.className = this.mirrorX
        ? 'px-2 py-1 rounded bg-amber-600 text-slate-950 font-bold text-[10px]'
        : 'px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[10px]';
      this.renderEditorCanvas();
    });

    document.getElementById('btn-sp-rot90').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      const grid = this.getActiveGrid();
      if (!sp || !frames || !grid || sp.w !== sp.h) return;
      this.pushUndo();
      const n = sp.w;
      const rot = Array.from({ length: n }, (_, y) =>
        Array.from({ length: n }, (_, x) => grid[n - 1 - x][y]).join('')
      );
      frames[this.activeFrameIdx] = rot;
      this.refreshAll();
    });

    document.getElementById('btn-sp-fliph').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      const grid = this.getActiveGrid();
      if (!sp || !frames || !grid) return;
      this.pushUndo();
      frames[this.activeFrameIdx] = grid.map(r => r.split('').reverse().join(''));
      this.refreshAll();
    });

    document.getElementById('btn-sp-flipv').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      const grid = this.getActiveGrid();
      if (!sp || !frames || !grid) return;
      this.pushUndo();
      frames[this.activeFrameIdx] = [...grid].reverse();
      this.refreshAll();
    });

    document.getElementById('btn-sp-clear').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      if (!sp || !frames) return;
      this.pushUndo();
      frames[this.activeFrameIdx] = Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
      this.refreshAll();
    });

    document.getElementById('btn-sp-undo').addEventListener('click', () => this.undo());

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!document.getElementById('view-sprites').classList.contains('hidden')) {
          e.preventDefault();
          this.undo();
        }
      }
    });

    // Image Digitizer: Upload, Drag-and-Drop, and Ctrl+V Paste
    document.getElementById('sp-img-upload').addEventListener('change', (e) => {
      if (e.target.files?.[0]) this.loadImageFile(e.target.files[0]);
    });

    const dz = document.getElementById('sp-dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('border-amber-400'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('border-amber-400'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('border-amber-400');
      if (e.dataTransfer?.files?.[0]) this.loadImageFile(e.dataTransfer.files[0]);
    });

    window.addEventListener('paste', (e) => {
      if (document.getElementById('view-sprites').classList.contains('hidden')) return;
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          this.loadImageFile(item.getAsFile());
          break;
        }
      }
    });

    const reDigitize = () => {
      document.getElementById('lbl-dig-contrast').textContent = document.getElementById('dig-contrast').value;
      document.getElementById('lbl-dig-alpha').textContent = document.getElementById('dig-alpha').value;
      if (this.lastImportedImg) this.digitizeImage(this.lastImportedImg);
    };
    document.getElementById('dig-contrast').addEventListener('input', reDigitize);
    document.getElementById('dig-alpha').addEventListener('input', reDigitize);
    document.getElementById('dig-dither').addEventListener('change', reDigitize);

    // Live Preview controls
    document.getElementById('btn-prev-tile').addEventListener('click', () => {
      this.previewMode = 'tile';
      this.syncPreviewButtons();
      this.renderLivePreview();
    });
    document.getElementById('btn-prev-rot').addEventListener('click', () => {
      this.previewMode = 'rot';
      this.syncPreviewButtons();
      this.renderLivePreview();
    });
    document.getElementById('btn-prev-anim').addEventListener('click', (e) => {
      this.animPlaying = !this.animPlaying;
      e.target.textContent = this.animPlaying ? '⏸ Pause' : '▶ Play';
      e.target.className = this.animPlaying
        ? 'px-2.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold'
        : 'px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold';
      this.restartAnimTimer();
    });
    document.getElementById('btn-anim-onion').addEventListener('click', (e) => {
      this.onionSkin = !this.onionSkin;
      e.target.textContent = `Onion: ${this.onionSkin ? 'ON' : 'OFF'}`;
      e.target.className = this.onionSkin
        ? 'px-2 py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
        : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
      this.renderEditorCanvas();
    });
    document.getElementById('anim-fps').addEventListener('input', (e) => {
      this.animFps = Number(e.target.value) || 4;
      document.getElementById('lbl-anim-fps').textContent = `${this.animFps} FPS`;
      const st = this.getActiveStateObj();
      if (st) st.fps = this.animFps;
      if (this.animPlaying) this.restartAnimTimer();
    });
    document.getElementById('anim-pingpong').addEventListener('change', (e) => {
      this.animPingPong = e.target.checked;
      this.animDir = 1;
      const st = this.getActiveStateObj();
      if (st) st.pingPong = this.animPingPong;
    });
    document.getElementById('sp-allow-rot')?.addEventListener('change', (e) => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      sp.allowRotate = e.target.checked;
      this.renderLivePreview();
    });
    document.getElementById('sp-allow-flip')?.addEventListener('change', (e) => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      sp.allowFlip = e.target.checked;
      this.renderLivePreview();
    });

    document.getElementById('btn-prev-fliph')?.addEventListener('click', (e) => {
      this.previewFlipX = !this.previewFlipX;
      e.target.className = this.previewFlipX
        ? 'py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
        : 'py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
      this.renderLivePreview();
    });

    // Animation Timeline Frame Actions
    document.getElementById('btn-anim-add-blank').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      if (!sp || !frames) return;
      const blank = Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
      frames.splice(this.activeFrameIdx + 1, 0, blank);
      this.activeFrameIdx++;
      this.undoStack = [];
      this.renderBankList();
      this.refreshAll();
    });
    document.getElementById('btn-anim-dup').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      const frames = this.getActiveFrames(sp);
      if (!sp || !frames) return;
      frames.splice(this.activeFrameIdx + 1, 0, [...this.getActiveGrid()]);
      this.activeFrameIdx++;
      this.undoStack = [];
      this.renderBankList();
      this.refreshAll();
    });
    document.getElementById('btn-anim-left').addEventListener('click', () => {
      const frames = this.getActiveFrames();
      if (!frames || this.activeFrameIdx <= 0) return;
      const [moved] = frames.splice(this.activeFrameIdx, 1);
      this.activeFrameIdx--;
      frames.splice(this.activeFrameIdx, 0, moved);
      this.refreshAll();
    });
    document.getElementById('btn-anim-right').addEventListener('click', () => {
      const frames = this.getActiveFrames();
      if (!frames || this.activeFrameIdx >= frames.length - 1) return;
      const [moved] = frames.splice(this.activeFrameIdx, 1);
      this.activeFrameIdx++;
      frames.splice(this.activeFrameIdx, 0, moved);
      this.refreshAll();
    });
    document.getElementById('btn-anim-del').addEventListener('click', () => {
      const frames = this.getActiveFrames();
      if (!frames || frames.length <= 1) return;
      frames.splice(this.activeFrameIdx, 1);
      this.activeFrameIdx = Math.max(0, this.activeFrameIdx - 1);
      this.undoStack = [];
      this.renderBankList();
      this.refreshAll();
    });

    document.getElementById('prev-band').addEventListener('input', (e) => {
      this.previewBand = Number(e.target.value);
      document.getElementById('lbl-prev-band').textContent = `${this.previewBand}${this.previewBand === 8 ? ' (Full)' : ''}`;
      this.renderLivePreview();
      this.renderAnimStrip();
    });

    // 90-degree Snap Rotation buttons
    document.querySelectorAll('.sp-rot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.previewAngle = Number(btn.dataset.angle) || 0;
        document.querySelectorAll('.sp-rot-btn').forEach((b) => {
          const isAct = Number(b.dataset.angle) === this.previewAngle;
          b.className = isAct
            ? 'sp-rot-btn py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
            : 'sp-rot-btn py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
        });
        this.renderLivePreview();
      });
    });

    // Folder Filter change
    document.getElementById('sp-folder-filter')?.addEventListener('change', (e) => {
      if (e.target.value === '__NEW__') {
        const name = prompt('Enter new folder / biome name (e.g. cathedral, town):');
        const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
        if (clean) {
          this.allKnownFolders.add(clean);
          this.selectedFolder = clean;
        } else {
          e.target.value = this.selectedFolder;
          return;
        }
      } else {
        this.selectedFolder = e.target.value;
      }

      // If active sprite is not in this folder, pick first matching
      const activeMatch = this.selectedFolder === 'ALL' ||
        (this.activeId.includes('/') ? this.activeId.startsWith(`${this.selectedFolder}/`) : this.selectedFolder === 'common');
      if (!activeMatch) {
        let found = false;
        for (const cat of ['tiles', 'entities', 'objects', 'items']) {
          for (const id of Object.keys(this.bank[cat] || {})) {
            const matches = this.selectedFolder === 'ALL' ||
              (id.includes('/') ? id.startsWith(`${this.selectedFolder}/`) : this.selectedFolder === 'common');
            if (matches) {
              this.selectSprite(cat, id);
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      this.syncFolderControls();
      this.renderBankList();
    });

    // Add folder button
    document.getElementById('btn-sp-add-folder')?.addEventListener('click', () => {
      const name = prompt('Enter new folder / biome name (e.g. cathedral, town):');
      const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
      if (clean) {
        this.allKnownFolders.add(clean);
        this.selectedFolder = clean;
        this.syncFolderControls();
        this.renderBankList();
        this.showToast(`Folder "📁 ${clean}" ready!`);
      }
    });

    // View mode toggle
    const btnViewCat = document.getElementById('btn-view-by-category');
    const btnViewFold = document.getElementById('btn-view-by-folder');
    btnViewCat?.addEventListener('click', () => {
      this.bankViewMode = 'category';
      btnViewCat.className = 'px-2 py-0.5 rounded bg-amber-600 text-slate-950 font-bold';
      btnViewFold.className = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700';
      this.renderBankList();
    });
    btnViewFold?.addEventListener('click', () => {
      this.bankViewMode = 'folder';
      btnViewFold.className = 'px-2 py-0.5 rounded bg-amber-600 text-slate-950 font-bold';
      btnViewCat.className = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700';
      this.renderBankList();
    });

    // New Sprite Folder change updates label
    document.getElementById('sp-new-folder')?.addEventListener('change', (e) => {
      if (e.target.value === '__NEW__') {
        const name = prompt('Enter new folder name:');
        const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
        if (clean) {
          this.allKnownFolders.add(clean);
          this.syncFolderControls();
          document.getElementById('sp-new-folder').value = clean;
        }
      }
      const lbl = document.getElementById('lbl-create-dest');
      if (lbl) lbl.textContent = `in ${document.getElementById('sp-new-folder').value}/`;
    });

    // Move / Rename Modal
    const moveModal = document.getElementById('dev-move-modal');
    const moveCategory = document.getElementById('move-category');
    const moveFolderSelect = document.getElementById('move-folder-select');
    const moveFolderCustom = document.getElementById('move-folder-custom');
    const moveNewId = document.getElementById('move-new-id');
    const moveTargetName = document.getElementById('move-target-name');

    const openMoveModal = () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      moveTargetName.textContent = `${this.activeCat}/${this.activeId}`;
      moveCategory.value = this.activeCat;
      const [currentFolder, baseId] = this.activeId.includes('/')
        ? this.activeId.split('/')
        : ['common', this.activeId];
      this.syncFolderControls();
      moveFolderSelect.value = currentFolder;
      moveFolderCustom.value = '';
      moveNewId.value = baseId;
      moveModal.classList.remove('hidden');
      moveNewId.focus();
    };

    document.getElementById('btn-sp-move-folder')?.addEventListener('click', openMoveModal);
    document.getElementById('btn-move-close')?.addEventListener('click', () => moveModal.classList.add('hidden'));
    document.getElementById('btn-move-cancel')?.addEventListener('click', () => moveModal.classList.add('hidden'));

    document.getElementById('btn-move-apply')?.addEventListener('click', () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      const targetCat = moveCategory.value;
      const customF = moveFolderCustom.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const targetFolder = customF || moveFolderSelect.value || 'common';
      const cleanBase = moveNewId.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanBase) return this.showToast('Sprite ID cannot be empty', true);

      const targetPath = `${targetFolder}/${cleanBase}`;
      if (targetCat === this.activeCat && targetPath === this.activeId) {
        moveModal.classList.add('hidden');
        return;
      }
      if (this.bank[targetCat]?.[targetPath]) {
        return this.showToast(`"${targetPath}" already exists in ${targetCat}`, true);
      }

      delete this.bank[this.activeCat][this.activeId];
      this.bank[targetCat][targetPath] = sp;
      this.allKnownFolders.add(targetFolder);
      if (this.selectedFolder !== 'ALL') {
        this.selectedFolder = targetFolder;
      }
      moveModal.classList.add('hidden');
      this.syncFolderControls();
      this.selectSprite(targetCat, targetPath);
      this.showToast(`Moved to "${targetCat}/${targetPath}"`);
    });

    // Palette Recolor / Biome Clone Modal
    const recolorModal = document.getElementById('dev-recolor-modal');
    const recolorSrc = document.getElementById('recolor-src');
    const recolorDst = document.getElementById('recolor-dst');
    const recolorTargetName = document.getElementById('recolor-target-name');
    const recolorNewId = document.getElementById('recolor-new-id');
    const recolorCloneSuffix = document.getElementById('recolor-clone-suffix');
    const recolorSaveAsCopy = document.getElementById('recolor-save-as-copy');

    const openRecolorModal = () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      recolorTargetName.textContent = `${this.activeCat}/${this.activeId}`;
      recolorSrc.innerHTML = '';
      recolorDst.innerHTML = '';

      // Find which palette indices actually exist in this sprite
      const usedIndices = new Set();
      const checkGrid = (grid) => {
        if (!Array.isArray(grid)) return;
        for (const row of grid) {
          for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch && ch !== '.') {
              const val = parseInt(ch, 16);
              if (!Number.isNaN(val)) usedIndices.add(val);
            }
          }
        }
      };

      if (sp.states) {
        for (const st of Object.values(sp.states)) {
          for (const f of st.frames || []) checkGrid(f);
        }
      } else {
        for (const f of (sp.variants || sp.frames || [])) checkGrid(f);
      }

      for (let i = 0; i < 16; i++) {
        const optDst = document.createElement('option');
        optDst.value = String(i);
        optDst.textContent = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
        recolorDst.appendChild(optDst);

        if (usedIndices.has(i)) {
          const optSrc = document.createElement('option');
          optSrc.value = String(i);
          optSrc.textContent = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
          recolorSrc.appendChild(optSrc);
        }
      }

      const baseName = this.activeId.includes('/') ? this.activeId.split('/')[1] : this.activeId;
      recolorCloneSuffix.textContent = `cavern/${baseName}`;
      recolorNewId.value = `cavern/${baseName}`;
      recolorModal.classList.remove('hidden');
    };

    document.getElementById('btn-sp-recolor')?.addEventListener('click', openRecolorModal);
    document.getElementById('btn-recolor-close')?.addEventListener('click', () => recolorModal.classList.add('hidden'));
    document.getElementById('btn-recolor-cancel')?.addEventListener('click', () => recolorModal.classList.add('hidden'));

    document.getElementById('btn-recolor-apply')?.addEventListener('click', () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      const srcIdx = Number(recolorSrc.value);
      const dstIdx = Number(recolorDst.value);
      if (Number.isNaN(srcIdx) || Number.isNaN(dstIdx)) return;
      const srcHex = HEX_CHARS[srcIdx];
      const dstHex = HEX_CHARS[dstIdx];

      const swapGrid = (grid) => {
        if (!Array.isArray(grid)) return grid;
        return grid.map(row => {
          let s = '';
          for (let i = 0; i < row.length; i++) {
            s += (row[i] === srcHex ? dstHex : row[i]);
          }
          return s;
        });
      };

      const clone = JSON.parse(JSON.stringify(sp));
      if (clone.states) {
        for (const st of Object.values(clone.states)) {
          st.frames = (st.frames || []).map(swapGrid);
        }
      } else if (clone.variants) {
        clone.variants = clone.variants.map(swapGrid);
      } else if (clone.frames) {
        clone.frames = clone.frames.map(swapGrid);
      }

      const saveAsCopy = recolorSaveAsCopy.checked;
      if (saveAsCopy) {
        const newId = recolorNewId.value.trim().replace(/[^a-zA-Z0-9_\/-]/g, '');
        if (!newId) return this.showToast('Enter a valid new ID/path', true);
        this.bank[this.activeCat][newId] = clone;
        if (newId.includes('/')) {
          this.selectedFolder = newId.split('/')[0];
        }
        recolorModal.classList.add('hidden');
        this.selectSprite(this.activeCat, newId);
        this.showToast(`Created biome recolor "${newId}"!`);
      } else {
        this.pushUndo();
        this.bank[this.activeCat][this.activeId] = clone;
        recolorModal.classList.add('hidden');
        this.refreshAll();
        this.showToast(`Swapped color ${srcIdx} → ${dstIdx}!`);
      }
    });

    // Bank CRUD & Save
    document.getElementById('btn-sp-new').addEventListener('click', () => {
      const cat = document.getElementById('sp-new-cat').value;
      const rawId = document.getElementById('sp-new-id').value.trim().replace(/[^a-zA-Z0-9_\-\/]/g, '');
      const folderVal = document.getElementById('sp-new-folder')?.value || (this.selectedFolder === 'ALL' ? 'common' : this.selectedFolder);

      if (!rawId) return this.showToast('Enter a sprite ID first.', true);

      let fullId = rawId;
      if (!fullId.includes('/')) {
        fullId = `${folderVal}/${rawId}`;
      }
      const folder = fullId.split('/')[0];
      this.allKnownFolders.add(folder);

      const sizeVal = String(document.getElementById('sp-new-size').value || '12');
      let w = 12;
      let h = 12;
      if (sizeVal.includes('x')) {
        const parts = sizeVal.split('x').map(Number);
        w = parts[0] || 12;
        h = parts[1] || w;
      } else {
        w = h = Number(sizeVal) || 12;
      }
      if (this.bank[cat][fullId]) return this.showToast(`"${fullId}" already exists in ${cat}.`, true);
      const isHighRes = w >= 32 || h >= 32;
      const isTile = cat === 'tiles';
      const blank = Array.from({ length: h }, () => '.'.repeat(w));
      this.bank[cat][fullId] = {
        w,
        h,
        anchorX: Math.floor(w / 2),
        anchorY: Math.floor(h * 0.75),
        allowRotate: isTile,
        allowFlip: isTile,
        renderScale: isHighRes ? 0.5 : 1,
        frames: [blank],
        variants: isTile ? [blank] : undefined
      };
      document.getElementById('sp-new-id').value = '';
      if (this.selectedFolder !== 'ALL' && this.selectedFolder !== folder) {
        this.selectedFolder = folder;
      }
      this.syncFolderControls();
      this.selectSprite(cat, fullId);
      this.showToast(`Created ${cat}/${fullId}`);
    });

    document.getElementById('btn-sp-dup').addEventListener('click', () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      const newId = `${this.activeId}_copy`;
      this.bank[this.activeCat][newId] = JSON.parse(JSON.stringify(sp));
      this.selectSprite(this.activeCat, newId);
    });

    document.getElementById('btn-sp-del').addEventListener('click', () => {
      if (!confirm(`Delete "${this.activeCat}/${this.activeId}"?`)) return;
      delete this.bank[this.activeCat][this.activeId];
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        const keys = Object.keys(this.bank[cat]);
        if (keys.length > 0) {
          this.selectSprite(cat, keys[0]);
          return;
        }
      }
      this.renderBankList();
    });

    document.getElementById('btn-sp-copy-json').addEventListener('click', async () => {
      const sp = this.getActiveSprite();
      if (!sp) return;
      await navigator.clipboard?.writeText(JSON.stringify({ [this.activeId]: sp }, null, 2)).catch(() => {});
      this.showToast('Copied sprite JSON to clipboard!');
    });

    document.getElementById('btn-sp-save-disk').addEventListener('click', async () => {
      // Ensure all tiles have variants up to date
      for (const [id, sp] of Object.entries(this.bank.tiles || {})) {
        const frames = sp.frames || sp.variants;
        if (frames) {
          sp.variants = frames;
        }
      }
      try {
        const res = await fetch('/api/dev/sprites', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
          body: JSON.stringify(this.bank)
        });
        const data = await res.json();
        if (!res.ok) return this.showToast(data.error || 'Save failed', true);
        this.showToast('Saved data/sprites.json!');
      } catch {
        this.showToast('Network error saving sprites.json', true);
      }
    });
  }
}
