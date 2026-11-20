import { AudioPSG } from '../systems/AudioPSG.js';
import {
  midiToNoteName,
  freqToMidi,
  sampleADSR,
  createEmptyLayer,
  normalizePainter,
  projectParametricToPainter,
  promoteToPainted,
  syncPaintedDurationReadout,
  redrawPainter,
  paintPitchAtEvent,
  paintVolAtEvent,
  redrawScope,
  bindPainterCanvasEvents
} from './sound/PainterCanvas.js';
import {
  updateSourceBadge,
  syncPainterControls,
  renderBankList,
  selectPatch,
  syncFromParametricForm,
  bindParametricAndBankEvents
} from './sound/ParametricAndBank.js';

export { midiToNoteName, freqToMidi, sampleADSR };

export class SoundLab {
  constructor({ getAuthHeaders, showToast, isTabActive }) {
    this.getAuthHeaders = getAuthHeaders;
    this.showToast = showToast;
    this.isTabActive = isTabActive;

    this.audio = new AudioPSG();
    this.bank = {};
    this.activeId = '';
    this.lastSamples = null;

    this.activeLayer = 0;
    this.viewPainter = null;
    this.paintingCanvas = null; // 'pitch' | 'vol' | null
    this.paintErase = false;

    this.scopeCanvas = document.getElementById('sfx-scope-canvas');
    this.scopeCtx = this.scopeCanvas.getContext('2d');
    this.pitchCanvas = document.getElementById('sfx-painter-pitch');
    this.pitchCtx = this.pitchCanvas.getContext('2d');
    this.volCanvas = document.getElementById('sfx-painter-vol');
    this.volCtx = this.volCanvas.getContext('2d');
  }

  async init() {
    this.bindEvents();
    try {
      const res = await fetch('/api/dev/sfx');
      this.bank = await res.json();
    } catch {
      this.showToast('Failed to load sfx.json', true);
    }

    const keys = Object.keys(this.bank);
    if (keys.length > 0) {
      this.selectPatch(keys[0]);
    }
    this.renderBankList();
  }

  selectLayer(idx) {
    this.activeLayer = Math.max(0, Math.min(2, idx));
    document.querySelectorAll('.pt-layer-btn').forEach((btn) => {
      const l = Number(btn.dataset.layer);
      const isAct = l === this.activeLayer;
      btn.className = isAct
        ? 'pt-layer-btn px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-[10px]'
        : 'pt-layer-btn px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]';
    });
    this.syncPainterControls();
    this.redrawPainter();
  }

  playActive() {
    const p = this.bank[this.activeId];
    if (!p) return;
    this.lastSamples = this.audio.previewPatch(p);
    this.redrawScope();
  }

  // Delegated Painter & Scope methods
  createEmptyLayer(wave_type = 'square', duty_cycle = 0.5) { return createEmptyLayer(wave_type, duty_cycle); }
  normalizePainter(painter, patch) { return normalizePainter(painter, patch); }
  projectParametricToPainter(p) { return projectParametricToPainter(p); }
  promoteToPainted(patch) { return promoteToPainted(this, patch); }
  syncPaintedDurationReadout(patch) { syncPaintedDurationReadout(patch); }
  redrawPainter() { redrawPainter(this); }
  paintPitchAtEvent(e, erase) { paintPitchAtEvent(this, e, erase); }
  paintVolAtEvent(e, erase) { paintVolAtEvent(this, e, erase); }
  redrawScope() { redrawScope(this); }

  // Delegated Parametric & Bank methods
  updateSourceBadge(patch) { updateSourceBadge(patch); }
  syncPainterControls() { syncPainterControls(this); }
  renderBankList() { renderBankList(this); }
  selectPatch(id) { selectPatch(this, id); }
  syncFromParametricForm(options = {}) { return syncFromParametricForm(this, options); }

  bindEvents() {
    bindPainterCanvasEvents(this);
    bindParametricAndBankEvents(this);
  }
}
