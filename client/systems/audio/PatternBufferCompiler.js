/**
 * Tracker Pattern to Web Audio AudioBuffer Synthesizer, Prewarmer & IndexedDB PCM Cache
 */

import { noteToMidi, midiToFreq } from './AudioMath.js';

export function getPatternDuration(suiteData, patternId) {
  const p = suiteData?.patterns[patternId];
  if (!p) return 12.0;
  const bpm = p.bpm || suiteData.header?.bpm || 80;
  const lpb = p.linesPerBeat || suiteData.header?.linesPerBeat || 4;
  const stepSec = (60.0 / bpm) / lpb;
  return p.numSteps * stepSec;
}

export function renderPatternToBuffer(player, suiteData, patternId) {
  if (suiteData.patternBuffers.has(patternId)) {
    return suiteData.patternBuffers.get(patternId);
  }
  const pattern = suiteData.patterns[patternId];
  if (!pattern) return null;

  const ctx = player.audio.ensureContext();
  if (!ctx) return null;

  const sampleRate = player.audio.sampleRate;
  const bpm = pattern.bpm || suiteData.header?.bpm || 80;
  const lpb = pattern.linesPerBeat || suiteData.header?.linesPerBeat || 4;
  const stepSec = (60.0 / bpm) / lpb;
  const numSteps = pattern.numSteps || 64;

  const baseSamples = Math.floor(numSteps * stepSec * sampleRate);
  const tailSamples = Math.floor(1.2 * sampleRate);
  const totalSamples = baseSamples + tailSamples;
  const mixedL = new Float32Array(totalSamples);
  const mixedR = new Float32Array(totalSamples);

  for (const ev of pattern.events) {
    const patch = suiteData.patches[ev.patch];
    if (!patch) continue;
    const notes = ev.notes || [];
    const durSec = (ev.duration || 4) * stepSec;
    const startSample = Math.floor(ev.step * stepSec * sampleRate);
    const vol = (ev.volume ?? 128) / 128.0;

    // 1. Equal-power stereo panning from ev.pan ('PAN 0' .. 'PAN 255', default 128 = center)
    let panNorm = 0.5;
    if (ev.pan && ev.pan !== '--') {
      const m = ev.pan.match(/PAN\s+(\d+)/i);
      if (m) {
        panNorm = Math.max(0, Math.min(1, parseInt(m[1], 10) / 255.0));
      } else {
        const num = parseFloat(ev.pan);
        if (!isNaN(num)) panNorm = Math.max(0, Math.min(1, num / 255.0));
      }
    }
    const panAngle = panNorm * (Math.PI * 0.5);
    const gainL = Math.cos(panAngle);
    const gainR = Math.sin(panAngle);

    // 2. Pass ev.fx as macroOverrides (e.g. 'SDN 10', 'PRT 40', 'ARP 4', 'ECH 65')
    const macroOverrides = (ev.fx && ev.fx !== '--') ? [ev.fx] : [];

    for (const n of notes) {
      if (!n || n === '--' || n === '...') continue;
      const midi = noteToMidi(n);
      const freq = midiToFreq(midi);

      // Translate SDN <semitones> into downward pitch sweep: end_freq = freq * 2^(-semitones/12)
      let currentPatch = patch;
      if (ev.fx && ev.fx.startsWith('SDN')) {
        const semitones = parseFloat(ev.fx.split(/\s+/)[1]) || 12;
        currentPatch = {
          ...patch,
          pitch_sweep: {
            start_freq: freq,
            end_freq: freq * Math.pow(2.0, -semitones / 12.0)
          }
        };
      }

      const voice = player.audio.renderSingleVoice(currentPatch, freq, durSec, macroOverrides);
      for (let i = 0; i < voice.length; i++) {
        const dest = startSample + i;
        if (dest < totalSamples) {
          const s = voice[i] * vol * 0.45;
          mixedL[dest] += s * gainL;
          mixedR[dest] += s * gainR;
        }
      }
    }
  }

  // Soft-limiter (Math.tanh) on master pattern mix preserves dynamic headroom without clipping
  for (let i = 0; i < totalSamples; i++) {
    mixedL[i] = Math.tanh(mixedL[i]);
    mixedR[i] = Math.tanh(mixedR[i]);
  }

  const buf = ctx.createBuffer(2, totalSamples, sampleRate);
  buf.copyToChannel(mixedL, 0);
  buf.copyToChannel(mixedR, 1);
  suiteData.patternBuffers.set(patternId, buf);

  if (player.db) {
    try {
      const interleaved = new Float32Array(totalSamples * 2);
      for (let i = 0; i < totalSamples; i++) {
        interleaved[i * 2] = mixedL[i];
        interleaved[i * 2 + 1] = mixedR[i];
      }
      player.db.savePatternPCM(player.currentSuiteName, patternId, sampleRate, interleaved).catch(() => {});
    } catch (_) {}
  }

  return buf;
}

export async function ensurePatternBuffer(player, suiteData, patternId) {
  if (suiteData.patternBuffers.has(patternId)) {
    return suiteData.patternBuffers.get(patternId);
  }

  const sampleRate = player.audio.sampleRate;
  if (player.db) {
    try {
      const floatArr = await player.db.getPatternPCM(player.currentSuiteName, patternId, sampleRate);
      if (floatArr && floatArr.length > 0) {
        const ctx = player.audio.ensureContext();
        if (ctx) {
          const isStereo = floatArr.length % 2 === 0;
          const totalSamples = isStereo ? floatArr.length / 2 : floatArr.length;
          const buf = ctx.createBuffer(2, totalSamples, sampleRate);
          if (isStereo) {
            const left = new Float32Array(totalSamples);
            const right = new Float32Array(totalSamples);
            for (let i = 0; i < totalSamples; i++) {
              left[i] = floatArr[i * 2];
              right[i] = floatArr[i * 2 + 1];
            }
            buf.copyToChannel(left, 0);
            buf.copyToChannel(right, 1);
          } else {
            buf.copyToChannel(floatArr, 0);
            buf.copyToChannel(floatArr, 1);
          }
          suiteData.patternBuffers.set(patternId, buf);
          return buf;
        }
      }
    } catch (_) {}
  }

  return player.renderPatternToBuffer(suiteData, patternId);
}

export function prewarmSections(player, sectionNames) {
  const suiteData = player.getCurrentSuiteData();
  if (!suiteData) return;
  const sections = player.suiteSections[player.currentSuiteName] || player.suiteSections.crypts;

  const patternsToWarm = new Set();
  for (const s of sectionNames) {
    const list = sections[s] || [];
    for (const pid of list) {
      if (!suiteData.patternBuffers.has(pid)) {
        patternsToWarm.add(pid);
      }
    }
  }

  const queue = Array.from(patternsToWarm);
  const total = queue.length;
  if (total === 0) {
    player.notifyProgress?.({
      suiteName: player.currentSuiteName,
      compiled: 0,
      total: 0,
      pct: 100,
      done: true
    });
    return;
  }

  let completed = 0;
  player.notifyProgress?.({
    suiteName: player.currentSuiteName,
    compiled: 0,
    total,
    pct: 0,
    done: false
  });

  const processNext = async () => {
    if (queue.length === 0) {
      player.notifyProgress?.({
        suiteName: player.currentSuiteName,
        compiled: total,
        total,
        pct: 100,
        done: true
      });
      return;
    }

    const pid = queue.shift();
    try {
      await player.ensurePatternBuffer(suiteData, pid);
    } catch (_) {}
    completed++;
    const pct = Math.round((completed / total) * 100);
    player.notifyProgress?.({
      suiteName: player.currentSuiteName,
      compiled: completed,
      total,
      pct,
      done: completed >= total
    });

    if (queue.length > 0) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processNext, { timeout: 1000 });
      } else {
        setTimeout(processNext, 20);
      }
    }
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(processNext, { timeout: 1000 });
  } else {
    setTimeout(processNext, 20);
  }
}
