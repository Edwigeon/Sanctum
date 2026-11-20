import { PALETTE_INDEX } from '../../shared/Constants.js';
import {
  u32ToHex,
  nearestPaletteIndex,
  buildPaletteGrid,
  setColor,
  digitizeImage,
  loadImageFile,
  bindDigitizerEvents
} from './sprites/PaletteAndDigitizer.js';
import {
  updateEditorCanvasDimensions,
  updateViewportTransform,
  setZoom,
  fitZoom,
  resetZoom,
  renderEditorCanvas,
  renderGridToOffscreen,
  renderLivePreview,
  setPixel,
  floodFill,
  applyToolAt,
  bindViewportAndToolEvents
} from './sprites/CanvasToolsAndViewport.js';
import {
  selectOrCreateState,
  syncStateTimingUI,
  syncPreviewButtons,
  renderFrameBar,
  renderStateBar,
  renderAnimStrip,
  restartAnimTimer,
  bindTimelineAndPreviewEvents
} from './sprites/TimelineAndStates.js';
import {
  syncFolderControls,
  renderBankList,
  bindBankAndModalEvents
} from './sprites/BankAndModals.js';

export { u32ToHex, nearestPaletteIndex };

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

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('.sp-tool-btn').forEach(b => {
      const active = b.dataset.tool === tool;
      b.className = active
        ? 'sp-tool-btn px-2 py-1 rounded bg-amber-600 text-slate-950 font-bold text-[10px]'
        : 'sp-tool-btn px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]';
    });
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

    const titleEl = document.getElementById('anim-section-title');
    const stateBarEl = document.getElementById('sp-state-bar');
    const speedControlsEl = document.getElementById('anim-speed-controls');
    const onionBtn = document.getElementById('btn-anim-onion');
    const playBtn = document.getElementById('btn-prev-anim');

    if (titleEl) titleEl.textContent = this.isTileMode ? 'Tile Variants' : 'Animation Timeline';
    if (stateBarEl) stateBarEl.classList.toggle('hidden', this.isTileMode);
    if (speedControlsEl) speedControlsEl.classList.toggle('hidden', this.isTileMode);
    if (onionBtn) onionBtn.classList.toggle('hidden', this.isTileMode);
    if (playBtn) playBtn.classList.toggle('hidden', this.isTileMode);

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

  // Delegated Palette & Digitizer methods
  buildPaletteGrid() { buildPaletteGrid(this); }
  setColor(idx) { setColor(this, idx); }
  digitizeImage(img) { digitizeImage(this, img); }
  loadImageFile(file) { loadImageFile(this, file); }

  // Delegated Canvas Tools & Viewport methods
  updateEditorCanvasDimensions() { updateEditorCanvasDimensions(this); }
  updateViewportTransform() { updateViewportTransform(this); }
  setZoom(newZoom, mouseX, mouseY) { setZoom(this, newZoom, mouseX, mouseY); }
  fitZoom() { fitZoom(this); }
  resetZoom() { resetZoom(this); }
  renderEditorCanvas() { renderEditorCanvas(this); }
  renderGridToOffscreen(grid, w, h, band = 8) { return renderGridToOffscreen(grid, w, h, band); }
  renderLivePreview() { renderLivePreview(this); }
  setPixel(grid, x, y, charVal) { setPixel(grid, x, y, charVal); }
  floodFill(grid, startX, startY, targetChar, replacementChar) { floodFill(grid, startX, startY, targetChar, replacementChar); }
  applyToolAt(clientX, clientY, isInitialClick = false) { applyToolAt(this, clientX, clientY, isInitialClick); }

  // Delegated Timeline & State methods
  selectOrCreateState(stateName) { selectOrCreateState(this, stateName); }
  syncStateTimingUI() { syncStateTimingUI(this); }
  syncPreviewButtons() { syncPreviewButtons(this); }
  renderFrameBar() { renderFrameBar(this); }
  renderStateBar() { renderStateBar(this); }
  renderAnimStrip() { renderAnimStrip(this); }
  restartAnimTimer() { restartAnimTimer(this); }

  // Delegated Bank & Modal methods
  syncFolderControls() { syncFolderControls(this); }
  renderBankList() { renderBankList(this); }

  bindEvents() {
    bindViewportAndToolEvents(this);
    bindDigitizerEvents(this);
    bindTimelineAndPreviewEvents(this);
    bindBankAndModalEvents(this);
  }
}
