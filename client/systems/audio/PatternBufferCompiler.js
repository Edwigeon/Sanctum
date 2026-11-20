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
  const mixed = new Float32Array(totalSamples);

  for (const ev of pattern.events) {
    const patch = suiteData.patches[ev.patch];
    if (!patch) continue;
    const notes = ev.notes || [];
    const durSec = (ev.duration || 4) * stepSec;
    const startSample = Math.floor(ev.step * stepSec * sampleRate);
    const vol = (ev.volume ?? 128) / 128.0;

    for (const n of notes) {
      if (!n || n === '--' || n === '...') continue;
      const midi = noteToMidi(n);
      const freq = midiToFreq(midi);
      const voice = player.audio.renderSingleVoice(patch, freq, durSec);
      for (let i = 0; i < voice.length; i++) {
        const dest = startSample + i;
        if (dest < totalSamples) {
          mixed[dest] += voice[i] * vol * 0.45;
        }
      }
    }
  }

  const buf = ctx.createBuffer(1, totalSamples, sampleRate);
  buf.copyToChannel(mixed, 0);
  suiteData.patternBuffers.set(patternId, buf);

  if (player.db) {
    try {
      player.db.savePatternPCM(player.currentSuiteName, patternId, sampleRate, mixed).catch(() => {});
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
          const buf = ctx.createBuffer(1, floatArr.length, sampleRate);
          buf.copyToChannel(floatArr, 0);
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
  const processQueue = () => {
    if (queue.length === 0) return;
    const pid = queue.shift();
    player.ensurePatternBuffer(suiteData, pid).catch(() => {});
    if (queue.length > 0) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processQueue, { timeout: 1000 });
      } else {
        setTimeout(processQueue, 100);
      }
    }
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(processQueue, { timeout: 1000 });
  } else {
    setTimeout(processQueue, 50);
  }
}
