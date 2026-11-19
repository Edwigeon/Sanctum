import { AudioPSG } from '../systems/AudioPSG.js';

const PAINTER_STEPS = 32;
const MIDI_MIN = 36; // C2 (~65 Hz)
const MIDI_MAX = 84; // C6 (~1046 Hz)
const MIDI_ROWS = MIDI_MAX - MIDI_MIN + 1; // 49 rows
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LAYER_COLORS = ['#F59E0B', '#38BDF8', '#F472B6'];
const LAYER_GHOSTS = ['rgba(245,158,11,0.28)', 'rgba(56,189,248,0.28)', 'rgba(244,114,182,0.28)'];

function midiToNoteName(midi) {
  if (!midi || midi <= 0) return '--';
  const name = NOTE_NAMES[midi % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

function freqToMidi(freq) {
  const f = Math.max(20, Number(freq) || 220);
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return Math.max(MIDI_MIN, Math.min(MIDI_MAX, m));
}

function sampleADSR(t, dur, env) {
  const a = Math.max(0.001, env?.attack ?? 0.005);
  const d = Math.max(0.001, env?.decay ?? 0.08);
  const s = Math.max(0, Math.min(1, env?.sustain_level ?? 0.5));
  const r = Math.max(0.001, env?.release ?? 0.05);
  const relStart = Math.max(0, dur - r);
  if (t >= relStart && r > 0) {
    return Math.max(0, s * (1 - (t - relStart) / r));
  }
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  return s;
}

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
    this.viewPainter = null; // Live painter data (either patch.painter or projected preview)
    this.paintingCanvas = null; // 'pitch' | 'vol' | null
    this.paintErase = false;

    this.scopeCanvas = document.getElementById('sfx-scope-canvas');
    this.scopeCtx = this.scopeCanvas.getContext('2d');
    this.pitchCanvas = document.getElementById('sfx-painter-pitch');
    this.pitchCtx = this.pitchCanvas.getContext('2d');
    this.volCanvas = document.getElementById('sfx-painter-vol');
    this.volCtx = this.volCanvas.getContext('2d');
  }

  createEmptyLayer(wave_type = 'square', duty_cycle = 0.5) {
    return {
      wave_type,
      duty_cycle,
      pitches: new Array(PAINTER_STEPS).fill(0),
      volumes: new Array(PAINTER_STEPS).fill(0)
    };
  }

  normalizePainter(painter, patch) {
    if (!Array.isArray(painter.layers)) painter.layers = [];
    while (painter.layers.length < 3) {
      const idx = painter.layers.length;
      const defaultWave = idx === 0
        ? (patch?.wave_type || 'square')
        : (idx === 1 ? (patch?.wave_type_2 || 'triangle') : 'noise');
      painter.layers.push(this.createEmptyLayer(defaultWave, patch?.duty_cycle ?? 0.5));
    }
    for (const layer of painter.layers) {
      if (!Array.isArray(layer.pitches) || layer.pitches.length < PAINTER_STEPS) {
        layer.pitches = Array.from({ length: PAINTER_STEPS }, (_, i) => layer.pitches?.[i] || 0);
      }
      if (!Array.isArray(layer.volumes) || layer.volumes.length < PAINTER_STEPS) {
        layer.volumes = Array.from({ length: PAINTER_STEPS }, (_, i) => layer.volumes?.[i] || 0);
      }
    }
    return painter;
  }

  /**
   * Projects a parametric patch's pitch sweep / notes + ADSR envelope onto the 32-step visual grid
   * so both halves always visualize and edit the exact same sound.
   */
  projectParametricToPainter(p) {
    const l1 = this.createEmptyLayer(p.wave_type || 'square', p.duty_cycle ?? 0.5);
    const l2 = this.createEmptyLayer('triangle', p.duty_cycle ?? 0.5);
    const l3 = this.createEmptyLayer('noise', 0.5);

    let stepMs = 30;
    let slide = false;

    if (Array.isArray(p.notes) && p.notes.length > 0) {
      const stepsPerNote = Math.max(1, Math.min(4, Math.floor(PAINTER_STEPS / p.notes.length)));
      const noteStepSec = p.step_duration ?? 0.09;
      stepMs = Math.max(15, Math.min(120, Math.round((noteStepSec * 1000) / stepsPerNote)));
      for (let ni = 0; ni < p.notes.length; ni++) {
        const midi = Math.max(MIDI_MIN, Math.min(MIDI_MAX, p.notes[ni]));
        for (let k = 0; k < stepsPerNote; k++) {
          const s = ni * stepsPerNote + k;
          if (s >= PAINTER_STEPS) break;
          const vol = Math.max(1, Math.min(7, Math.round((1 - (k / stepsPerNote) * 0.45) * 6)));
          l1.pitches[s] = midi;
          l1.volumes[s] = vol;
        }
      }
    } else {
      const dur = Math.max(0.04, p.duration ?? 0.2);
      const targetSteps = Math.max(6, Math.min(28, Math.round(dur / 0.025)));
      stepMs = Math.max(15, Math.min(120, Math.round((dur * 1000) / targetSteps)));
      const sf = p.pitch_sweep?.start_freq ?? p.freq ?? 220;
      const ef = p.pitch_sweep?.end_freq || sf;
      slide = Math.abs(ef - sf) > 1;

      for (let s = 0; s < targetSteps && s < PAINTER_STEPS; s++) {
        const frac = targetSteps > 1 ? s / (targetSteps - 1) : 0;
        const freq = sf + (ef - sf) * frac;
        const midi = freqToMidi(freq);
        const envVal = sampleADSR(frac * dur, dur, p.envelope);
        const vol = Math.max(1, Math.min(7, Math.round(envVal * 7)));
        l1.pitches[s] = midi;
        l1.volumes[s] = vol;
      }
    }

    return { step_ms: stepMs, slide, layers: [l1, l2, l3] };
  }

  /**
   * Ensures patch.painter exists (promoting the current projected grid seamlessly on first paint edit).
   */
  promoteToPainted(patch) {
    if (!patch.painter) {
      patch.painter = JSON.parse(JSON.stringify(this.viewPainter || this.projectParametricToPainter(patch)));
    }
    this.normalizePainter(patch.painter, patch);
    this.viewPainter = patch.painter;
    this.updateSourceBadge(patch);
    return patch.painter;
  }

  updateSourceBadge(patch) {
    const badge = document.getElementById('sfx-source-badge');
    if (!badge) return;
    if (patch?.painter) {
      badge.textContent = 'Painted Grid + FX';
      badge.className = 'text-[10px] px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-700/60';
    } else {
      badge.textContent = 'Parametric Curve';
      badge.className = 'text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700';
    }
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

  syncPainterControls() {
    if (!this.viewPainter) return;
    const layer = this.viewPainter.layers[this.activeLayer];
    document.getElementById('pt-wave').value = layer.wave_type || 'square';
    document.getElementById('pt-duty').value = layer.duty_cycle ?? 0.5;
    document.getElementById('v-pt-duty').textContent = Number(layer.duty_cycle ?? 0.5).toFixed(2);
    document.getElementById('pt-step-ms').value = this.viewPainter.step_ms ?? 30;
    document.getElementById('v-pt-step').textContent = String(this.viewPainter.step_ms ?? 30);
    document.getElementById('pt-slide').checked = !!this.viewPainter.slide;
  }

  renderBankList() {
    const list = document.getElementById('sfx-bank-list');
    list.innerHTML = '';
    for (const id of Object.keys(this.bank)) {
      const p = this.bank[id];
      const isSel = id === this.activeId;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `w-full flex items-center justify-between px-2.5 py-2 rounded border text-left transition ${
        isSel
          ? 'border-cyan-500 bg-cyan-950/30 text-cyan-200 font-bold'
          : 'border-slate-800 bg-slate-950/60 hover:border-slate-600 text-slate-300'
      }`;
      const badge = p.painter ? 'painted' : (p.wave_type || 'square');
      row.innerHTML = `<span class="truncate">${id}</span><span class="text-[9px] ${p.painter ? 'text-amber-400' : 'text-slate-500'}">${badge}</span>`;
      row.addEventListener('click', () => {
        this.selectPatch(id);
        this.playActive();
      });
      list.appendChild(row);
    }
  }

  selectPatch(id) {
    this.activeId = id;
    const p = this.bank[id];
    if (!p) return;

    const l1Wave = p.painter?.layers?.[0]?.wave_type || p.wave_type || 'square';
    const l1Duty = p.painter?.layers?.[0]?.duty_cycle ?? p.duty_cycle ?? 0.5;

    document.getElementById('sfx-active-id').textContent = id;
    document.getElementById('sfx-name').value = p.name || id;
    document.getElementById('sfx-wave1').value = l1Wave;
    document.getElementById('sfx-wave2').value = p.wave_type_2 || '';
    document.getElementById('sfx-mix').value = p.mix ?? 0;
    document.getElementById('v-mix').textContent = Number(p.mix ?? 0).toFixed(2);
    document.getElementById('sfx-duty').value = l1Duty;
    document.getElementById('v-duty').textContent = Number(l1Duty).toFixed(2);
    document.getElementById('sfx-dur').value = p.duration ?? 0.2;
    document.getElementById('sfx-gain').value = p.gain ?? 0.8;

    document.getElementById('sfx-sfreq').value = p.pitch_sweep?.start_freq ?? p.freq ?? 220;
    document.getElementById('sfx-efreq').value = p.pitch_sweep?.end_freq ?? 0;
    document.getElementById('sfx-notes').value = Array.isArray(p.notes) ? p.notes.join(',') : '';

    document.getElementById('sfx-att').value = p.envelope?.attack ?? 0.005;
    document.getElementById('sfx-dec').value = p.envelope?.decay ?? 0.08;
    document.getElementById('sfx-sus').value = p.envelope?.sustain_level ?? 0.5;
    document.getElementById('sfx-rel').value = p.envelope?.release ?? 0.05;

    document.getElementById('sfx-vib-spd').value = p.lfo?.vibrato_speed ?? 0;
    document.getElementById('sfx-vib-dep').value = p.lfo?.vibrato_depth ?? 0;
    document.getElementById('sfx-trem-spd').value = p.lfo?.tremolo_speed ?? 0;
    document.getElementById('sfx-trem-dep').value = p.lfo?.tremolo_depth ?? 0;

    document.getElementById('sfx-sat').value = p.saturation ?? 1.0;
    document.getElementById('v-sat').textContent = Number(p.saturation ?? 1.0).toFixed(1);
    document.getElementById('sfx-bits').value = p.bit_depth ?? 16;
    document.getElementById('v-bits').textContent = String(p.bit_depth ?? 16);

    document.getElementById('sfx-rm-freq').value = p.ring_mod?.freq ?? 0;
    document.getElementById('sfx-rm-mix').value = p.ring_mod?.mix ?? 0;
    document.getElementById('sfx-echo-del').value = p.echo?.delay_time ?? 0;
    document.getElementById('sfx-echo-fb').value = p.echo?.feedback ?? 0;
    document.getElementById('sfx-retrig').value = p.retrigger?.rate_hz ?? 0;

    if (p.painter) {
      this.viewPainter = this.normalizePainter(p.painter, p);
    } else {
      this.viewPainter = this.projectParametricToPainter(p);
    }

    this.updateSourceBadge(p);
    this.syncPainterControls();
    this.redrawPainter();
    this.renderBankList();
    this.lastSamples = this.audio.renderPatchToFloat32(p);
    this.redrawScope();
  }

  /**
   * Reads shared Timbre / LFO / FX / Gain fields into the active patch.
   * When `resetCurveFromParam` is true (user edited Pitch/Notes/Duration/ADSR),
   * re-projects the parametric curve onto the Visual Painter grid.
   */
  syncFromParametricForm({ resetCurveFromParam = false } = {}) {
    if (!this.activeId) return null;
    const prev = this.bank[this.activeId] || {};

    const p = {
      name: document.getElementById('sfx-name').value.trim() || this.activeId,
      wave_type: document.getElementById('sfx-wave1').value,
      duty_cycle: Number(document.getElementById('sfx-duty').value),
      duration: Number(document.getElementById('sfx-dur').value) || 0.2,
      gain: Number(document.getElementById('sfx-gain').value) || 0.8
    };

    const w2 = document.getElementById('sfx-wave2').value;
    const mix = Number(document.getElementById('sfx-mix').value);
    if (w2 && mix > 0) {
      p.wave_type_2 = w2;
      p.mix = mix;
    }

    const sf = Number(document.getElementById('sfx-sfreq').value) || 220;
    const ef = Number(document.getElementById('sfx-efreq').value) || 0;
    if (ef > 0) {
      p.pitch_sweep = { start_freq: sf, end_freq: ef };
    } else {
      p.freq = sf;
    }

    const notesRaw = document.getElementById('sfx-notes').value.trim();
    if (notesRaw) {
      const notes = notesRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
      if (notes.length > 0) {
        p.notes = notes;
        p.step_duration = 0.09;
        p.note_duration = Math.max(0.08, p.duration);
      }
    }

    p.envelope = {
      attack: Number(document.getElementById('sfx-att').value) || 0,
      decay: Number(document.getElementById('sfx-dec').value) || 0,
      sustain_level: Number(document.getElementById('sfx-sus').value) || 0,
      release: Number(document.getElementById('sfx-rel').value) || 0
    };

    const vibSpd = Number(document.getElementById('sfx-vib-spd').value) || 0;
    const vibDep = Number(document.getElementById('sfx-vib-dep').value) || 0;
    const tremSpd = Number(document.getElementById('sfx-trem-spd').value) || 0;
    const tremDep = Number(document.getElementById('sfx-trem-dep').value) || 0;
    if (vibDep > 0 || tremDep > 0) {
      p.lfo = {};
      if (vibDep > 0) { p.lfo.vibrato_speed = vibSpd; p.lfo.vibrato_depth = vibDep; }
      if (tremDep > 0) { p.lfo.tremolo_speed = tremSpd; p.lfo.tremolo_depth = tremDep; }
    }

    const sat = Number(document.getElementById('sfx-sat').value) || 1.0;
    if (sat > 1.0) p.saturation = sat;

    const bits = Number(document.getElementById('sfx-bits').value) || 16;
    if (bits < 16) p.bit_depth = bits;

    const rmFreq = Number(document.getElementById('sfx-rm-freq').value) || 0;
    const rmMix = Number(document.getElementById('sfx-rm-mix').value) || 0;
    if (rmMix > 0 && rmFreq > 0) p.ring_mod = { freq: rmFreq, mix: rmMix };

    const echoDel = Number(document.getElementById('sfx-echo-del').value) || 0;
    const echoFb = Number(document.getElementById('sfx-echo-fb').value) || 0;
    if (echoDel > 0 && echoFb > 0) p.echo = { delay_time: echoDel, feedback: echoFb, num_taps: 3 };

    const retrig = Number(document.getElementById('sfx-retrig').value) || 0;
    if (retrig > 0) p.retrigger = { rate_hz: retrig };

    if (!resetCurveFromParam && prev.painter) {
      // Preserve hand-painted grid and sync shared Wave 1 / Duty into L1
      p.painter = prev.painter;
      p.painter.layers[0].wave_type = p.wave_type;
      p.painter.layers[0].duty_cycle = p.duty_cycle;
      this.viewPainter = p.painter;
    } else {
      // Parametric curve drives the visual grid projection
      this.viewPainter = this.projectParametricToPainter(p);
    }

    this.bank[this.activeId] = p;
    this.updateSourceBadge(p);
    this.syncPainterControls();
    this.redrawPainter();
    return p;
  }

  playActive() {
    const p = this.bank[this.activeId];
    if (!p) return;
    this.lastSamples = this.audio.previewPatch(p);
    this.redrawScope();
  }

  redrawPainter() {
    const painter = this.viewPainter;
    if (!painter) return;

    const pw = this.pitchCanvas.width;
    const ph = this.pitchCanvas.height;
    const pCtx = this.pitchCtx;
    const colW = pw / PAINTER_STEPS;
    const rowH = ph / MIDI_ROWS;

    pCtx.fillStyle = '#020617';
    pCtx.fillRect(0, 0, pw, ph);

    for (let r = 0; r < MIDI_ROWS; r++) {
      const midi = MIDI_MAX - r;
      const semitone = midi % 12;
      const isSharp = semitone === 1 || semitone === 3 || semitone === 6 || semitone === 8 || semitone === 10;
      if (semitone === 0) {
        pCtx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        pCtx.fillRect(0, r * rowH, pw, rowH);
      } else if (isSharp) {
        pCtx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        pCtx.fillRect(0, r * rowH, pw, rowH);
      }
      if (semitone === 0) {
        pCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
        pCtx.beginPath();
        pCtx.moveTo(0, r * rowH);
        pCtx.lineTo(pw, r * rowH);
        pCtx.stroke();
      }
    }

    for (let c = 0; c < PAINTER_STEPS; c++) {
      pCtx.strokeStyle = (c % 4 === 0) ? 'rgba(100, 116, 139, 0.45)' : 'rgba(30, 41, 59, 0.35)';
      pCtx.beginPath();
      pCtx.moveTo(c * colW, 0);
      pCtx.lineTo(c * colW, ph);
      pCtx.stroke();
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let li = 0; li < painter.layers.length; li++) {
        const isAct = li === this.activeLayer;
        if ((pass === 0 && isAct) || (pass === 1 && !isAct)) continue;
        const layer = painter.layers[li];
        const fill = isAct ? LAYER_COLORS[li] : LAYER_GHOSTS[li];
        for (let s = 0; s < PAINTER_STEPS; s++) {
          const midi = layer.pitches[s] || 0;
          const vol = layer.volumes[s] || 0;
          if (midi < MIDI_MIN || midi > MIDI_MAX || vol <= 0) continue;
          const row = MIDI_MAX - midi;
          pCtx.fillStyle = fill;
          pCtx.fillRect(s * colW + 1, row * rowH, colW - 2, Math.max(3, rowH));
        }
      }
    }

    const vw = this.volCanvas.width;
    const vh = this.volCanvas.height;
    const vCtx = this.volCtx;
    const activeLayer = painter.layers[this.activeLayer];

    vCtx.fillStyle = '#020617';
    vCtx.fillRect(0, 0, vw, vh);

    for (let c = 0; c < PAINTER_STEPS; c++) {
      vCtx.strokeStyle = (c % 4 === 0) ? 'rgba(100, 116, 139, 0.4)' : 'rgba(30, 41, 59, 0.3)';
      vCtx.beginPath();
      vCtx.moveTo(c * colW, 0);
      vCtx.lineTo(c * colW, vh);
      vCtx.stroke();

      const vol = Math.max(0, Math.min(7, activeLayer.volumes[c] || 0));
      if (vol > 0) {
        const barH = (vol / 7) * (vh - 6);
        vCtx.fillStyle = LAYER_COLORS[this.activeLayer];
        vCtx.fillRect(c * colW + 2, vh - barH - 2, colW - 4, barH);
      }
    }
  }

  syncPaintedDurationReadout(patch) {
    if (!patch?.painter) return;
    let last = 0;
    for (const l of patch.painter.layers) {
      for (let s = 0; s < PAINTER_STEPS; s++) {
        if ((l.volumes[s] || 0) > 0 && (l.pitches[s] || 0) > 0 && s > last) last = s;
      }
    }
    const durSec = Number((((last + 1) * (patch.painter.step_ms || 30)) / 1000).toFixed(2));
    patch.duration = durSec;
    document.getElementById('sfx-dur').value = durSec;
  }

  paintPitchAtEvent(e, erase) {
    const p = this.bank[this.activeId];
    if (!p) return;
    const painter = this.promoteToPainted(p);
    const rect = this.pitchCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height));
    const step = Math.floor(nx * PAINTER_STEPS);
    const row = Math.floor(ny * MIDI_ROWS);
    const midi = MIDI_MAX - row;

    const layer = painter.layers[this.activeLayer];
    if (erase) {
      layer.pitches[step] = 0;
      layer.volumes[step] = 0;
    } else {
      layer.pitches[step] = midi;
      if ((layer.volumes[step] || 0) === 0) layer.volumes[step] = 5;
    }

    document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(midi)} (Vol ${layer.volumes[step]})`;
    this.syncPaintedDurationReadout(p);
    this.redrawPainter();
    this.renderBankList();
    this.lastSamples = this.audio.renderPatchToFloat32(p);
    this.redrawScope();
  }

  paintVolAtEvent(e, erase) {
    const p = this.bank[this.activeId];
    if (!p) return;
    const painter = this.promoteToPainted(p);
    const rect = this.volCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height));
    const step = Math.floor(nx * PAINTER_STEPS);
    const vol = erase ? 0 : Math.max(0, Math.min(7, Math.round((1 - ny) * 7)));

    const layer = painter.layers[this.activeLayer];
    layer.volumes[step] = vol;
    if (vol > 0 && (layer.pitches[step] || 0) === 0) {
      layer.pitches[step] = 60;
    }

    document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(layer.pitches[step])} (Vol ${vol})`;
    this.syncPaintedDurationReadout(p);
    this.redrawPainter();
    this.renderBankList();
    this.lastSamples = this.audio.renderPatchToFloat32(p);
    this.redrawScope();
  }

  redrawScope() {
    const ctx = this.scopeCtx;
    const w = this.scopeCanvas.width;
    const h = this.scopeCanvas.height;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const samples = this.lastSamples;
    if (!samples || samples.length === 0) return;

    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(samples.length / w));
    for (let x = 0; x < w; x++) {
      const idx = Math.min(samples.length - 1, Math.floor((x / w) * samples.length));
      let minV = samples[idx];
      let maxV = samples[idx];
      for (let j = 1; j < step && idx + j < samples.length; j++) {
        const v = samples[idx + j];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const y1 = h / 2 - maxV * (h * 0.44);
      const y2 = h / 2 - minV * (h * 0.44);
      ctx.moveTo(x, y1);
      ctx.lineTo(x, Math.max(y1 + 1, y2));
    }
    ctx.stroke();
  }

  bindEvents() {
    document.getElementById('btn-sfx-play').addEventListener('click', () => this.playActive());

    document.querySelectorAll('.pt-layer-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.selectLayer(Number(btn.dataset.layer)));
    });

    const updatePainterMeta = () => {
      const p = this.bank[this.activeId];
      if (!p) return;
      const painter = this.promoteToPainted(p);
      const layer = painter.layers[this.activeLayer];
      layer.wave_type = document.getElementById('pt-wave').value;
      layer.duty_cycle = Number(document.getElementById('pt-duty').value);
      painter.step_ms = Number(document.getElementById('pt-step-ms').value);
      painter.slide = document.getElementById('pt-slide').checked;
      document.getElementById('v-pt-duty').textContent = layer.duty_cycle.toFixed(2);
      document.getElementById('v-pt-step').textContent = String(painter.step_ms);

      // Keep shared Parametric Wave 1 / Duty controls in sync with L1
      if (this.activeLayer === 0) {
        p.wave_type = layer.wave_type;
        p.duty_cycle = layer.duty_cycle;
        document.getElementById('sfx-wave1').value = layer.wave_type;
        document.getElementById('sfx-duty').value = layer.duty_cycle;
        document.getElementById('v-duty').textContent = layer.duty_cycle.toFixed(2);
      }

      this.syncPaintedDurationReadout(p);
      this.renderBankList();
      this.lastSamples = this.audio.renderPatchToFloat32(p);
      this.redrawScope();
    };
    ['pt-wave', 'pt-duty', 'pt-step-ms', 'pt-slide'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updatePainterMeta);
    });

    document.getElementById('btn-pt-clear-layer').addEventListener('click', () => {
      const p = this.bank[this.activeId];
      if (!p) return;
      const painter = this.promoteToPainted(p);
      const layer = painter.layers[this.activeLayer];
      layer.pitches.fill(0);
      layer.volumes.fill(0);
      this.syncPaintedDurationReadout(p);
      this.redrawPainter();
      this.lastSamples = this.audio.renderPatchToFloat32(p);
      this.redrawScope();
    });

    this.pitchCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.volCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.pitchCanvas.addEventListener('mousedown', (e) => {
      this.paintingCanvas = 'pitch';
      this.paintErase = e.button === 2;
      this.paintPitchAtEvent(e, this.paintErase);
    });
    this.pitchCanvas.addEventListener('mousemove', (e) => {
      if (this.paintingCanvas === 'pitch') {
        this.paintPitchAtEvent(e, this.paintErase);
      } else {
        const rect = this.pitchCanvas.getBoundingClientRect();
        const step = Math.floor(Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width)) * PAINTER_STEPS);
        const midi = MIDI_MAX - Math.floor(Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height)) * MIDI_ROWS);
        document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(midi)}`;
      }
    });

    this.volCanvas.addEventListener('mousedown', (e) => {
      this.paintingCanvas = 'vol';
      this.paintErase = e.button === 2;
      this.paintVolAtEvent(e, this.paintErase);
    });
    this.volCanvas.addEventListener('mousemove', (e) => {
      if (this.paintingCanvas === 'vol') {
        this.paintVolAtEvent(e, this.paintErase);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.paintingCanvas) {
        this.paintingCanvas = null;
        this.playActive();
      }
    });

    // Shared Timbre / LFO / FX inputs (always preserve painted grid if present!)
    const sharedFxInputs = [
      'sfx-name', 'sfx-wave1', 'sfx-wave2', 'sfx-mix', 'sfx-duty', 'sfx-gain',
      'sfx-vib-spd', 'sfx-vib-dep', 'sfx-trem-spd', 'sfx-trem-dep', 'sfx-sat', 'sfx-bits',
      'sfx-rm-freq', 'sfx-rm-mix', 'sfx-echo-del', 'sfx-echo-fb', 'sfx-retrig'
    ];
    // Curve / Envelope inputs (re-project the parametric curve live onto the visual grid)
    const curveInputs = [
      'sfx-dur', 'sfx-sfreq', 'sfx-efreq', 'sfx-notes', 'sfx-att', 'sfx-dec', 'sfx-sus', 'sfx-rel'
    ];

    const onParamInput = (resetCurveFromParam, sourceId = '') => {
      // Auto-bump Osc2 Mix to 0.5 when picking a Wave 2 while Mix is 0 so dual-osc blend is audible immediately
      if (sourceId === 'sfx-wave2') {
        const w2Val = document.getElementById('sfx-wave2').value;
        const mixEl = document.getElementById('sfx-mix');
        if (w2Val && Number(mixEl.value) === 0) {
          mixEl.value = 0.5;
        } else if (!w2Val) {
          mixEl.value = 0;
        }
      }
      document.getElementById('v-mix').textContent = Number(document.getElementById('sfx-mix').value).toFixed(2);
      document.getElementById('v-duty').textContent = Number(document.getElementById('sfx-duty').value).toFixed(2);
      document.getElementById('v-sat').textContent = Number(document.getElementById('sfx-sat').value).toFixed(1);
      document.getElementById('v-bits').textContent = document.getElementById('sfx-bits').value;
      const p = this.syncFromParametricForm({ resetCurveFromParam });
      if (p) {
        this.renderBankList();
        this.lastSamples = this.audio.renderPatchToFloat32(p);
        this.redrawScope();
      }
    };

    for (const id of sharedFxInputs) {
      document.getElementById(id)?.addEventListener('input', () => onParamInput(false, id));
    }
    for (const id of curveInputs) {
      document.getElementById(id)?.addEventListener('input', () => onParamInput(true, id));
    }

    window.addEventListener('keydown', (e) => {
      if (!this.isTabActive()) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.playActive();
      }
    });

    document.getElementById('btn-sfx-new').addEventListener('click', () => {
      const id = document.getElementById('sfx-new-id').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (!id) return this.showToast('Enter an SFX ID first.', true);
      if (this.bank[id]) return this.showToast(`"${id}" already exists.`, true);
      this.bank[id] = {
        name: id,
        wave_type: 'square',
        duty_cycle: 0.5,
        duration: 0.18,
        gain: 0.75,
        pitch_sweep: { start_freq: 440, end_freq: 180 },
        envelope: { attack: 0.005, decay: 0.08, sustain_level: 0.3, release: 0.05 }
      };
      document.getElementById('sfx-new-id').value = '';
      this.selectPatch(id);
      this.playActive();
    });

    document.getElementById('btn-sfx-dup').addEventListener('click', () => {
      const p = this.bank[this.activeId];
      if (!p) return;
      const newId = `${this.activeId}_copy`;
      this.bank[newId] = JSON.parse(JSON.stringify(p));
      this.selectPatch(newId);
    });

    document.getElementById('btn-sfx-del').addEventListener('click', () => {
      if (!this.activeId || !confirm(`Delete SFX "${this.activeId}"?`)) return;
      delete this.bank[this.activeId];
      const keys = Object.keys(this.bank);
      if (keys.length > 0) this.selectPatch(keys[0]);
      else this.renderBankList();
    });

    document.getElementById('btn-sfx-copy-json').addEventListener('click', async () => {
      const p = this.bank[this.activeId];
      if (!p) return;
      await navigator.clipboard?.writeText(JSON.stringify({ [this.activeId]: p }, null, 2)).catch(() => {});
      this.showToast('Copied SFX patch JSON!');
    });

    document.getElementById('btn-sfx-save-disk').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/dev/sfx', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
          body: JSON.stringify(this.bank)
        });
        const data = await res.json();
        if (!res.ok) return this.showToast(data.error || 'Save failed', true);
        this.showToast('Saved data/sfx.json!');
      } catch {
        this.showToast('Network error saving sfx.json', true);
      }
    });
  }
}
