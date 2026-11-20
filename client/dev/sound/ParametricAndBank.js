/**
 * Parametric Synth Form Synchronization, SFX Bank List & Server Persistence
 */

export function updateSourceBadge(patch) {
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

export function syncPainterControls(lab) {
  if (!lab.viewPainter) return;
  const layer = lab.viewPainter.layers[lab.activeLayer];
  document.getElementById('pt-wave').value = layer.wave_type || 'square';
  document.getElementById('pt-duty').value = layer.duty_cycle ?? 0.5;
  document.getElementById('v-pt-duty').textContent = Number(layer.duty_cycle ?? 0.5).toFixed(2);
  document.getElementById('pt-step-ms').value = lab.viewPainter.step_ms ?? 30;
  document.getElementById('v-pt-step').textContent = String(lab.viewPainter.step_ms ?? 30);
  document.getElementById('pt-slide').checked = !!lab.viewPainter.slide;
}

export function renderBankList(lab) {
  const list = document.getElementById('sfx-bank-list');
  list.innerHTML = '';
  for (const id of Object.keys(lab.bank)) {
    const p = lab.bank[id];
    const isSel = id === lab.activeId;
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
      lab.selectPatch(id);
      lab.playActive();
    });
    list.appendChild(row);
  }
}

export function selectPatch(lab, id) {
  lab.activeId = id;
  const p = lab.bank[id];
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
    lab.viewPainter = lab.normalizePainter(p.painter, p);
  } else {
    lab.viewPainter = lab.projectParametricToPainter(p);
  }

  lab.updateSourceBadge(p);
  lab.syncPainterControls();
  lab.redrawPainter();
  lab.renderBankList();
  lab.lastSamples = lab.audio.renderPatchToFloat32(p);
  lab.redrawScope();
}

export function syncFromParametricForm(lab, { resetCurveFromParam = false } = {}) {
  if (!lab.activeId) return null;
  const prev = lab.bank[lab.activeId] || {};

  const p = {
    name: document.getElementById('sfx-name').value.trim() || lab.activeId,
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
    p.painter = prev.painter;
    p.painter.layers[0].wave_type = p.wave_type;
    p.painter.layers[0].duty_cycle = p.duty_cycle;
    lab.viewPainter = p.painter;
  } else {
    lab.viewPainter = lab.projectParametricToPainter(p);
  }

  lab.bank[lab.activeId] = p;
  lab.updateSourceBadge(p);
  lab.syncPainterControls();
  lab.redrawPainter();
  return p;
}

export function bindParametricAndBankEvents(lab) {
  document.getElementById('btn-sfx-play').addEventListener('click', () => lab.playActive());

  const sharedFxInputs = [
    'sfx-name', 'sfx-wave1', 'sfx-wave2', 'sfx-mix', 'sfx-duty', 'sfx-gain',
    'sfx-vib-spd', 'sfx-vib-dep', 'sfx-trem-spd', 'sfx-trem-dep', 'sfx-sat', 'sfx-bits',
    'sfx-rm-freq', 'sfx-rm-mix', 'sfx-echo-del', 'sfx-echo-fb', 'sfx-retrig'
  ];
  const curveInputs = [
    'sfx-dur', 'sfx-sfreq', 'sfx-efreq', 'sfx-notes', 'sfx-att', 'sfx-dec', 'sfx-sus', 'sfx-rel'
  ];

  const onParamInput = (resetCurveFromParam, sourceId = '') => {
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
    const p = lab.syncFromParametricForm({ resetCurveFromParam });
    if (p) {
      lab.renderBankList();
      lab.lastSamples = lab.audio.renderPatchToFloat32(p);
      lab.redrawScope();
    }
  };

  for (const id of sharedFxInputs) {
    document.getElementById(id)?.addEventListener('input', () => onParamInput(false, id));
  }
  for (const id of curveInputs) {
    document.getElementById(id)?.addEventListener('input', () => onParamInput(true, id));
  }

  window.addEventListener('keydown', (e) => {
    if (!lab.isTabActive()) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      lab.playActive();
    }
  });

  document.getElementById('btn-sfx-new').addEventListener('click', () => {
    const id = document.getElementById('sfx-new-id').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return lab.showToast('Enter an SFX ID first.', true);
    if (lab.bank[id]) return lab.showToast(`"${id}" already exists.`, true);
    lab.bank[id] = {
      name: id,
      wave_type: 'square',
      duty_cycle: 0.5,
      duration: 0.18,
      gain: 0.75,
      pitch_sweep: { start_freq: 440, end_freq: 180 },
      envelope: { attack: 0.005, decay: 0.08, sustain_level: 0.3, release: 0.05 }
    };
    document.getElementById('sfx-new-id').value = '';
    lab.selectPatch(id);
    lab.playActive();
  });

  document.getElementById('btn-sfx-dup').addEventListener('click', () => {
    const p = lab.bank[lab.activeId];
    if (!p) return;
    const newId = `${lab.activeId}_copy`;
    lab.bank[newId] = JSON.parse(JSON.stringify(p));
    lab.selectPatch(newId);
  });

  document.getElementById('btn-sfx-del').addEventListener('click', () => {
    if (!lab.activeId || !confirm(`Delete SFX "${lab.activeId}"?`)) return;
    delete lab.bank[lab.activeId];
    const keys = Object.keys(lab.bank);
    if (keys.length > 0) lab.selectPatch(keys[0]);
    else lab.renderBankList();
  });

  document.getElementById('btn-sfx-copy-json').addEventListener('click', async () => {
    const p = lab.bank[lab.activeId];
    if (!p) return;
    await navigator.clipboard?.writeText(JSON.stringify({ [lab.activeId]: p }, null, 2)).catch(() => {});
    lab.showToast('Copied SFX patch JSON!');
  });

  document.getElementById('btn-sfx-save-disk').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/dev/sfx', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...lab.getAuthHeaders() },
        body: JSON.stringify(lab.bank)
      });
      const data = await res.json();
      if (!res.ok) return lab.showToast(data.error || 'Save failed', true);
      lab.showToast('Saved data/sfx.json!');
    } catch {
      lab.showToast('Network error saving sfx.json', true);
    }
  });
}
