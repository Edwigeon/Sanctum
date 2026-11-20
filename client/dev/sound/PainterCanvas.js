/**
 * 3-Layer 32-Step Visual SFX Painter Grid, Parametric Curve Projection & Oscilloscope Renderer
 */

export const PAINTER_STEPS = 32;
export const MIDI_MIN = 36; // C2 (~65 Hz)
export const MIDI_MAX = 84; // C6 (~1046 Hz)
export const MIDI_ROWS = MIDI_MAX - MIDI_MIN + 1; // 49 rows
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const LAYER_COLORS = ['#F59E0B', '#38BDF8', '#F472B6'];
export const LAYER_GHOSTS = ['rgba(245,158,11,0.28)', 'rgba(56,189,248,0.28)', 'rgba(244,114,182,0.28)'];

export function midiToNoteName(midi) {
  if (!midi || midi <= 0) return '--';
  const name = NOTE_NAMES[midi % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

export function freqToMidi(freq) {
  const f = Math.max(20, Number(freq) || 220);
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return Math.max(MIDI_MIN, Math.min(MIDI_MAX, m));
}

export function sampleADSR(t, dur, env) {
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

export function createEmptyLayer(wave_type = 'square', duty_cycle = 0.5) {
  return {
    wave_type,
    duty_cycle,
    pitches: new Array(PAINTER_STEPS).fill(0),
    volumes: new Array(PAINTER_STEPS).fill(0)
  };
}

export function normalizePainter(painter, patch) {
  if (!Array.isArray(painter.layers)) painter.layers = [];
  while (painter.layers.length < 3) {
    const idx = painter.layers.length;
    const defaultWave = idx === 0
      ? (patch?.wave_type || 'square')
      : (idx === 1 ? (patch?.wave_type_2 || 'triangle') : 'noise');
    painter.layers.push(createEmptyLayer(defaultWave, patch?.duty_cycle ?? 0.5));
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

export function projectParametricToPainter(p) {
  const l1 = createEmptyLayer(p.wave_type || 'square', p.duty_cycle ?? 0.5);
  const l2 = createEmptyLayer('triangle', p.duty_cycle ?? 0.5);
  const l3 = createEmptyLayer('noise', 0.5);

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

export function promoteToPainted(lab, patch) {
  if (!patch.painter) {
    patch.painter = JSON.parse(JSON.stringify(lab.viewPainter || lab.projectParametricToPainter(patch)));
  }
  lab.normalizePainter(patch.painter, patch);
  lab.viewPainter = patch.painter;
  lab.updateSourceBadge(patch);
  return patch.painter;
}

export function syncPaintedDurationReadout(patch) {
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

export function redrawPainter(lab) {
  const painter = lab.viewPainter;
  if (!painter) return;

  const pw = lab.pitchCanvas.width;
  const ph = lab.pitchCanvas.height;
  const pCtx = lab.pitchCtx;
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
      const isAct = li === lab.activeLayer;
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

  const vw = lab.volCanvas.width;
  const vh = lab.volCanvas.height;
  const vCtx = lab.volCtx;
  const activeLayer = painter.layers[lab.activeLayer];

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
      vCtx.fillStyle = LAYER_COLORS[lab.activeLayer];
      vCtx.fillRect(c * colW + 2, vh - barH - 2, colW - 4, barH);
    }
  }
}

export function paintPitchAtEvent(lab, e, erase) {
  const p = lab.bank[lab.activeId];
  if (!p) return;
  const painter = lab.promoteToPainted(p);
  const rect = lab.pitchCanvas.getBoundingClientRect();
  const nx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height));
  const step = Math.floor(nx * PAINTER_STEPS);
  const row = Math.floor(ny * MIDI_ROWS);
  const midi = MIDI_MAX - row;

  const layer = painter.layers[lab.activeLayer];
  if (erase) {
    layer.pitches[step] = 0;
    layer.volumes[step] = 0;
  } else {
    layer.pitches[step] = midi;
    if ((layer.volumes[step] || 0) === 0) layer.volumes[step] = 5;
  }

  document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(midi)} (Vol ${layer.volumes[step]})`;
  lab.syncPaintedDurationReadout(p);
  lab.redrawPainter();
  lab.renderBankList();
  lab.lastSamples = lab.audio.renderPatchToFloat32(p);
  lab.redrawScope();
}

export function paintVolAtEvent(lab, e, erase) {
  const p = lab.bank[lab.activeId];
  if (!p) return;
  const painter = lab.promoteToPainted(p);
  const rect = lab.volCanvas.getBoundingClientRect();
  const nx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height));
  const step = Math.floor(nx * PAINTER_STEPS);
  const vol = erase ? 0 : Math.max(0, Math.min(7, Math.round((1 - ny) * 7)));

  const layer = painter.layers[lab.activeLayer];
  layer.volumes[step] = vol;
  if (vol > 0 && (layer.pitches[step] || 0) === 0) {
    layer.pitches[step] = 60;
  }

  document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(layer.pitches[step])} (Vol ${vol})`;
  lab.syncPaintedDurationReadout(p);
  lab.redrawPainter();
  lab.renderBankList();
  lab.lastSamples = lab.audio.renderPatchToFloat32(p);
  lab.redrawScope();
}

export function redrawScope(lab) {
  const ctx = lab.scopeCtx;
  const w = lab.scopeCanvas.width;
  const h = lab.scopeCanvas.height;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const samples = lab.lastSamples;
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

export function bindPainterCanvasEvents(lab) {
  document.querySelectorAll('.pt-layer-btn').forEach((btn) => {
    btn.addEventListener('click', () => lab.selectLayer(Number(btn.dataset.layer)));
  });

  const updatePainterMeta = () => {
    const p = lab.bank[lab.activeId];
    if (!p) return;
    const painter = lab.promoteToPainted(p);
    const layer = painter.layers[lab.activeLayer];
    layer.wave_type = document.getElementById('pt-wave').value;
    layer.duty_cycle = Number(document.getElementById('pt-duty').value);
    painter.step_ms = Number(document.getElementById('pt-step-ms').value);
    painter.slide = document.getElementById('pt-slide').checked;
    document.getElementById('v-pt-duty').textContent = layer.duty_cycle.toFixed(2);
    document.getElementById('v-pt-step').textContent = String(painter.step_ms);

    if (lab.activeLayer === 0) {
      p.wave_type = layer.wave_type;
      p.duty_cycle = layer.duty_cycle;
      document.getElementById('sfx-wave1').value = layer.wave_type;
      document.getElementById('sfx-duty').value = layer.duty_cycle;
      document.getElementById('v-duty').textContent = layer.duty_cycle.toFixed(2);
    }

    lab.syncPaintedDurationReadout(p);
    lab.renderBankList();
    lab.lastSamples = lab.audio.renderPatchToFloat32(p);
    lab.redrawScope();
  };
  ['pt-wave', 'pt-duty', 'pt-step-ms', 'pt-slide'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updatePainterMeta);
  });

  document.getElementById('btn-pt-clear-layer').addEventListener('click', () => {
    const p = lab.bank[lab.activeId];
    if (!p) return;
    const painter = lab.promoteToPainted(p);
    const layer = painter.layers[lab.activeLayer];
    layer.pitches.fill(0);
    layer.volumes.fill(0);
    lab.syncPaintedDurationReadout(p);
    lab.redrawPainter();
    lab.lastSamples = lab.audio.renderPatchToFloat32(p);
    lab.redrawScope();
  });

  lab.pitchCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  lab.volCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  lab.pitchCanvas.addEventListener('mousedown', (e) => {
    lab.paintingCanvas = 'pitch';
    lab.paintErase = e.button === 2;
    lab.paintPitchAtEvent(e, lab.paintErase);
  });
  lab.pitchCanvas.addEventListener('mousemove', (e) => {
    if (lab.paintingCanvas === 'pitch') {
      lab.paintPitchAtEvent(e, lab.paintErase);
    } else {
      const rect = lab.pitchCanvas.getBoundingClientRect();
      const step = Math.floor(Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width)) * PAINTER_STEPS);
      const midi = MIDI_MAX - Math.floor(Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height)) * MIDI_ROWS);
      document.getElementById('pt-cursor-info').textContent = `Step ${step + 1} • ${midiToNoteName(midi)}`;
    }
  });

  lab.volCanvas.addEventListener('mousedown', (e) => {
    lab.paintingCanvas = 'vol';
    lab.paintErase = e.button === 2;
    lab.paintVolAtEvent(e, lab.paintErase);
  });
  lab.volCanvas.addEventListener('mousemove', (e) => {
    if (lab.paintingCanvas === 'vol') {
      lab.paintVolAtEvent(e, lab.paintErase);
    }
  });

  window.addEventListener('mouseup', () => {
    if (lab.paintingCanvas) {
      lab.paintingCanvas = null;
      lab.playActive();
    }
  });
}
