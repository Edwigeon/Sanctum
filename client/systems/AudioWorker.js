/**
 * AudioWorker.js - Background DSP Thread for Project: Sanctum
 * Offloads mathematical waveform rendering and tracker pattern synthesis from the 60 FPS main thread.
 * Uses zero-copy Transferable ArrayBuffers for instant handoff.
 */

import { Oscillator, Modifiers, midiToFreq, noteToMidi, PSG_CONSTANTS } from './AudioPSG.js';

let sampleRate = PSG_CONSTANTS.DEFAULT_SAMPLE_RATE;
let osc = new Oscillator(sampleRate);
let mod = new Modifiers(sampleRate);

function renderSingleVoice(patch, freqOverride = null, durationOverride = null, macroOverrides = []) {
  const duration = durationOverride ?? patch.duration ?? 0.2;
  const baseFreq = freqOverride ?? patch.freq ?? (patch.midi ? midiToFreq(patch.midi) : 220);

  let freqProfile = baseFreq;
  if (patch.pitch_sweep && patch.pitch_sweep.end_freq) {
    const sf = freqOverride ?? patch.pitch_sweep.start_freq ?? baseFreq;
    freqProfile = mod.generatePitchSweep(sf, patch.pitch_sweep.end_freq, duration);
  } else if (patch.portamento && patch.portamento.slide_time > 0 && patch.portamento.start_freq) {
    freqProfile = mod.generateSlideProfile(
      patch.portamento.start_freq,
      baseFreq,
      duration,
      patch.portamento.slide_time
    );
  }

  if (patch.lfo && patch.lfo.vibrato_depth > 0 && patch.lfo.vibrato_speed > 0) {
    freqProfile = mod.generateVibratoProfile(
      freqProfile,
      duration,
      patch.lfo.vibrato_speed,
      patch.lfo.vibrato_depth
    );
  }

  let duty = patch.duty_cycle ?? 0.5;
  if (patch.lfo && patch.lfo.pwm_depth > 0 && patch.lfo.pwm_speed > 0) {
    duty = mod.generatePWMProfile(duration, patch.lfo.pwm_speed, patch.lfo.pwm_depth, duty);
  }

  const wave1 = osc.generate(patch.wave_type || 'square', freqProfile, duration, duty);
  let wave = wave1;
  if (patch.wave_type_2 && (patch.mix ?? 0) > 0) {
    const mix = Math.max(0, Math.min(1, patch.mix));
    const wave2 = osc.generate(patch.wave_type_2, freqProfile, duration, duty);
    wave = new Float32Array(wave1.length);
    for (let i = 0; i < wave1.length; i++) {
      wave[i] = (1.0 - mix) * wave1[i] + mix * wave2[i];
    }
  }

  if (patch.envelope) {
    const e = patch.envelope;
    wave = mod.applyADSR(wave, e.attack ?? 0.005, e.decay ?? 0.08, e.sustain_level ?? 0.5, e.release ?? 0.05);
  }

  if (Array.isArray(patch.fx_chain) && patch.fx_chain.length > 0) {
    const chain = [...patch.fx_chain];
    if (Array.isArray(macroOverrides)) {
      for (const ov of macroOverrides) {
        if (!ov || typeof ov !== 'string') continue;
        const clean = ov.trim();
        const cmd = clean.startsWith('!') ? clean.slice(1).split(/\s+/)[0] : clean.split(/\s+/)[0];
        const rep = clean.startsWith('!') ? clean.slice(1) : clean;
        const idx = chain.findIndex(c => c.trim().split(/\s+/)[0] === cmd);
        if (idx !== -1) chain[idx] = rep;
        else chain.push(rep);
      }
    }

    for (const entry of chain) {
      const parts = entry.trim().split(/\s+/);
      const cmd = parts[0]?.toUpperCase();
      if (cmd === 'SAT') wave = mod.applySaturation(wave, parseFloat(parts[1]) || 1.2);
      else if (cmd === 'BIT') wave = mod.applyBitcrush(wave, parseInt(parts[1], 10) || 12);
      else if (cmd === 'ECH') wave = mod.applyEcho(wave, parseFloat(parts[1]) || 0.25, parseFloat(parts[2]) || 0.3, 3);
      else if (cmd === 'RNG') wave = mod.applyRingMod(wave, parseFloat(parts[1]) || 400, parseFloat(parts[2]) || 0.2);
      else if (cmd === 'RET') wave = mod.applyRetrigger(wave, parseFloat(parts[1]) || 10);
      else if (cmd === 'TRM') wave = mod.applyTremolo(wave, parseFloat(parts[1]) || 4.0, parseFloat(parts[2]) || 0.3);
    }
  } else {
    if (patch.ring_mod && patch.ring_mod.mix > 0) wave = mod.applyRingMod(wave, patch.ring_mod.freq || 500, patch.ring_mod.mix);
    if (patch.retrigger && patch.retrigger.rate_hz > 0) wave = mod.applyRetrigger(wave, patch.retrigger.rate_hz);
    if (patch.lfo && patch.lfo.tremolo_depth > 0 && patch.lfo.tremolo_speed > 0) wave = mod.applyTremolo(wave, patch.lfo.tremolo_speed, patch.lfo.tremolo_depth);
    if (patch.saturation && patch.saturation > 1.0) wave = mod.applySaturation(wave, patch.saturation);
    if (patch.bit_depth && patch.bit_depth < 16) wave = mod.applyBitcrush(wave, patch.bit_depth);
    if (patch.echo && patch.echo.feedback > 0 && patch.echo.delay_time > 0) wave = mod.applyEcho(wave, patch.echo.delay_time, patch.echo.feedback, 3);
  }

  return wave;
}

function renderPattern(pattern, patches, bpm = 80, stepsPerBeat = 16) {
  const stepSec = 60.0 / (bpm * stepsPerBeat);
  const numSteps = pattern.numSteps || 64;
  const baseSamples = Math.floor(numSteps * stepSec * sampleRate);
  // Add 1.2s tail for ringing echo/reverb
  const tailSamples = Math.floor(1.2 * sampleRate);
  const totalSamples = baseSamples + tailSamples;
  const mixed = new Float32Array(totalSamples);

  for (const ev of pattern.events || []) {
    const patch = patches[ev.patch];
    if (!patch) continue;
    const notes = Array.isArray(ev.notes) ? ev.notes : [ev.notes];
    const durSec = (ev.duration || 4) * stepSec;
    const startSample = Math.floor(ev.step * stepSec * sampleRate);
    const vol = (ev.volume ?? 128) / 128.0;

    for (const n of notes) {
      if (!n || n === '--' || n === '...') continue;
      const midi = noteToMidi(n);
      const freq = midiToFreq(midi);
      const voice = renderSingleVoice(patch, freq, durSec);
      for (let i = 0; i < voice.length; i++) {
        const dest = startSample + i;
        if (dest < totalSamples) {
          mixed[dest] += voice[i] * vol * 0.45;
        }
      }
    }
  }

  return mixed;
}

self.onmessage = (e) => {
  const { id, type, sampleRate: newSR, name, patch, pattern, patches, bpm, stepsPerBeat } = e.data || {};

  if (type === 'SET_SAMPLE_RATE' && newSR) {
    sampleRate = newSR;
    osc = new Oscillator(sampleRate);
    mod = new Modifiers(sampleRate);
  } else if (type === 'RENDER_SFX' && patch) {
    const samples = renderSingleVoice(patch);
    self.postMessage({ id, type: 'SFX_READY', name, samples }, [samples.buffer]);
  } else if (type === 'RENDER_PATTERN' && pattern && patches) {
    const samples = renderPattern(pattern, patches, bpm, stepsPerBeat);
    self.postMessage({ id, type: 'PATTERN_READY', patternId: pattern.id, samples }, [samples.buffer]);
  }
};
