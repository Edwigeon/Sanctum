/**
 * Lanthorn-PSG Offline Patch Renderer
 * Pre-renders single voices, multi-note arpeggios, and 3-layer 32-step Visual SFX Painter patches
 * into Float32Arrays.
 */

import { PSG_CONSTANTS, midiToFreq } from './AudioMath.js';
import { Oscillator } from './Oscillator.js';
import { Modifiers } from './Modifiers.js';

export class PatchRenderer {
  constructor(sampleRate = PSG_CONSTANTS.DEFAULT_SAMPLE_RATE, osc = null, mod = null) {
    this.setSampleRate(sampleRate, osc, mod);
  }

  setSampleRate(sampleRate, osc = null, mod = null) {
    this.sampleRate = sampleRate;
    this.osc = osc || new Oscillator(sampleRate);
    this.mod = mod || new Modifiers(sampleRate);
  }

  /**
   * Renders a single note or event using a Lanthorn-PSG compatible JSON patch into a Float32Array.
   * Supports both legacy patch fields and modern sequential `fx_chain` with `!CMD XX` macro overrides.
   */
  renderSingleVoice(patch, freqOverride = null, durationOverride = null, macroOverrides = []) {
    const duration = durationOverride ?? patch.duration ?? 0.2;
    const baseFreq = freqOverride ?? patch.freq ?? (patch.midi ? midiToFreq(patch.midi) : 220);

    // 1. Frequency profile (Pitch Sweep / Portamento / Vibrato)
    let freqProfile = baseFreq;
    if (patch.pitch_sweep && patch.pitch_sweep.end_freq) {
      const sf = freqOverride ?? patch.pitch_sweep.start_freq ?? baseFreq;
      freqProfile = this.mod.generatePitchSweep(sf, patch.pitch_sweep.end_freq, duration);
    } else if (patch.portamento && patch.portamento.slide_time > 0 && patch.portamento.start_freq) {
      freqProfile = this.mod.generateSlideProfile(
        patch.portamento.start_freq,
        baseFreq,
        duration,
        patch.portamento.slide_time
      );
    }

    if (patch.lfo && patch.lfo.vibrato_depth > 0 && patch.lfo.vibrato_speed > 0) {
      freqProfile = this.mod.generateVibratoProfile(
        freqProfile,
        duration,
        patch.lfo.vibrato_speed,
        patch.lfo.vibrato_depth
      );
    }

    // 2. Duty cycle profile (static or PWM LFO)
    let duty = patch.duty_cycle ?? 0.5;
    if (patch.lfo && patch.lfo.pwm_depth > 0 && patch.lfo.pwm_speed > 0) {
      duty = this.mod.generatePWMProfile(duration, patch.lfo.pwm_speed, patch.lfo.pwm_depth, duty);
    }

    // 3. Dual Oscillator Generation & Mix
    const wave1 = this.osc.generate(patch.wave_type || 'square', freqProfile, duration, duty);
    let wave = wave1;
    if (patch.wave_type_2 && (patch.mix ?? 0) > 0) {
      const mix = Math.max(0, Math.min(1, patch.mix));
      const wave2 = this.osc.generate(patch.wave_type_2, freqProfile, duration, duty);
      wave = new Float32Array(wave1.length);
      for (let i = 0; i < wave1.length; i++) {
        wave[i] = (1.0 - mix) * wave1[i] + mix * wave2[i];
      }
    }

    // 4. Envelope (applied before non-linear FX like saturation or echo)
    if (patch.envelope) {
      const e = patch.envelope;
      wave = this.mod.applyADSR(wave, e.attack ?? 0.005, e.decay ?? 0.08, e.sustain_level ?? 0.5, e.release ?? 0.05);
    }

    // 5. Signal Processing Chain (sequential fx_chain or legacy modifier fields)
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
        if (cmd === 'SAT') {
          wave = this.mod.applySaturation(wave, parseFloat(parts[1]) || 1.2);
        } else if (cmd === 'BIT') {
          wave = this.mod.applyBitcrush(wave, parseInt(parts[1], 10) || 12);
        } else if (cmd === 'ECH') {
          wave = this.mod.applyEcho(wave, parseFloat(parts[1]) || 0.25, parseFloat(parts[2]) || 0.3, 3);
        } else if (cmd === 'RNG') {
          wave = this.mod.applyRingMod(wave, parseFloat(parts[1]) || 400, parseFloat(parts[2]) || 0.2);
        } else if (cmd === 'RET') {
          wave = this.mod.applyRetrigger(wave, parseFloat(parts[1]) || 10);
        } else if (cmd === 'TRM') {
          wave = this.mod.applyTremolo(wave, parseFloat(parts[1]) || 4.0, parseFloat(parts[2]) || 0.3);
        }
      }
    } else {
      wave = this.applyLegacyModifiers(wave, patch);
    }

    return wave;
  }

  /**
   * Renders a PICO-8 / Lanthorn-style 3-layer visual SFX Painter patch (`patch.painter`) into a Float32Array.
   * Each layer has 32 steps of MIDI pitch (0 = rest) and volume (0..7) with optional smooth pitch sliding.
   */
  renderPainterPatch(patch) {
    const painter = patch.painter;
    const stepMs = Math.max(8, painter.step_ms || 30);
    const stepSamples = Math.max(1, Math.floor((stepMs / 1000) * this.sampleRate));
    const slide = !!painter.slide;
    const layers = Array.isArray(painter.layers) ? painter.layers : [];

    // Find last active step across all layers so trailing silence is trimmed
    let lastActiveStep = 0;
    for (const layer of layers) {
      const vols = layer.volumes || [];
      const pitches = layer.pitches || [];
      for (let s = 0; s < Math.min(vols.length, pitches.length); s++) {
        if (vols[s] > 0 && pitches[s] > 0 && s > lastActiveStep) {
          lastActiveStep = s;
        }
      }
    }
    const numSteps = Math.max(1, lastActiveStep + 1);
    const totalSamples = numSteps * stepSamples;
    const mixed = new Float32Array(totalSamples);
    const invSR = 1.0 / this.sampleRate;
    const TWO_PI = Math.PI * 2;
    const vibSpeed = patch.lfo?.vibrato_speed || 0;
    const vibDepth = patch.lfo?.vibrato_depth || 0;
    const hasVib = vibSpeed > 0 && vibDepth > 0;
    const osc2Wave = patch.wave_type_2 || '';
    const osc2Mix = osc2Wave ? Math.max(0, Math.min(1, patch.mix ?? 0)) : 0;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const waveType = layer.wave_type || 'square';
      const dc = layer.duty_cycle ?? 0.5;
      const pitches = layer.pitches || [];
      const vols = layer.volumes || [];
      const blendOsc2 = (li === 0 && osc2Mix > 0);
      let phase = 0.0;
      let lfsr = 0xACE1;
      let phase2 = 0.0;
      let lfsr2 = 0xBEEF;

      for (let s = 0; s < numSteps; s++) {
        const midi0 = pitches[s] || 0;
        const vol0 = (vols[s] || 0) / 7.0;
        if (midi0 <= 0 || vol0 <= 0) continue;

        const f0 = midiToFreq(midi0);
        const nextMidi = (s + 1 < numSteps && pitches[s + 1] > 0 && vols[s + 1] > 0) ? pitches[s + 1] : midi0;
        const f1 = slide ? midiToFreq(nextMidi) : f0;
        const nextVol = (s + 1 < numSteps && pitches[s + 1] > 0) ? (vols[s + 1] || 0) / 7.0 : 0.0;
        const baseOff = s * stepSamples;

        for (let i = 0; i < stepSamples; i++) {
          const t = i / stepSamples;
          let freq = f0 + (f1 - f0) * t;
          if (hasVib) {
            const sampleTime = (baseOff + i) * invSR;
            freq *= Math.pow(2.0, (vibDepth * Math.sin(TWO_PI * vibSpeed * sampleTime)) / 12.0);
          }
          const vol = slide ? (vol0 + (nextVol - vol0) * t) : vol0;

          let sample = 0.0;
          if (waveType === 'noise') {
            phase += (freq * 16.0) * invSR;
            while (phase >= 1.0) {
              phase -= 1.0;
              const bit = ((lfsr >> 0) ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
              lfsr = (lfsr >> 1) | (bit << 15);
            }
            sample = ((lfsr & 0xFF) / 127.5) - 1.0;
          } else {
            phase += freq * invSR;
            const pFrac = phase - Math.floor(phase);
            if (waveType === 'sine') sample = Math.sin(TWO_PI * phase);
            else if (waveType === 'square') sample = pFrac < dc ? 1.0 : -1.0;
            else if (waveType === 'sawtooth') sample = 2.0 * pFrac - 1.0;
            else if (waveType === 'triangle') sample = 2.0 * Math.abs(2.0 * pFrac - 1.0) - 1.0;
          }

          if (blendOsc2) {
            let sample2 = 0.0;
            if (osc2Wave === 'noise') {
              phase2 += (freq * 16.0) * invSR;
              while (phase2 >= 1.0) {
                phase2 -= 1.0;
                const bit = ((lfsr2 >> 0) ^ (lfsr2 >> 2) ^ (lfsr2 >> 3) ^ (lfsr2 >> 5)) & 1;
                lfsr2 = (lfsr2 >> 1) | (bit << 15);
              }
              sample2 = ((lfsr2 & 0xFF) / 127.5) - 1.0;
            } else {
              phase2 += freq * invSR;
              const pFrac2 = phase2 - Math.floor(phase2);
              if (osc2Wave === 'sine') sample2 = Math.sin(TWO_PI * phase2);
              else if (osc2Wave === 'square') sample2 = pFrac2 < dc ? 1.0 : -1.0;
              else if (osc2Wave === 'sawtooth') sample2 = 2.0 * pFrac2 - 1.0;
              else if (osc2Wave === 'triangle') sample2 = 2.0 * Math.abs(2.0 * pFrac2 - 1.0) - 1.0;
            }
            sample = (1.0 - osc2Mix) * sample + osc2Mix * sample2;
          }

          // Micro-fade at final step boundary to prevent clicks
          const edgeFade = (s === numSteps - 1 && i > stepSamples - 32) ? (stepSamples - i) / 32 : 1.0;
          mixed[baseOff + i] += sample * vol * edgeFade * 0.65;
        }
      }
    }

    let wave = this.applyLegacyModifiers(mixed, patch);
    return this.normalizePeak(wave);
  }

  /**
   * Renders a full patch (visual painter, single voice, or multi-note arpeggio via `patch.notes`) to Float32Array.
   */
  renderPatchToFloat32(patch) {
    if (patch.painter && Array.isArray(patch.painter.layers)) {
      return this.renderPainterPatch(patch);
    }
    if (!Array.isArray(patch.notes) || patch.notes.length === 0) {
      return this.renderSingleVoice(patch);
    }

    const stepSec = patch.step_duration ?? 0.08;
    const noteDur = patch.note_duration ?? stepSec * 1.4;
    const voices = patch.notes.map((midi, idx) => ({
      offset: Math.floor(idx * stepSec * this.sampleRate),
      samples: this.renderSingleVoice(patch, midiToFreq(midi), noteDur)
    }));

    let totalLen = 0;
    for (const v of voices) {
      totalLen = Math.max(totalLen, v.offset + v.samples.length);
    }
    const mixed = new Float32Array(totalLen);
    for (const v of voices) {
      for (let i = 0; i < v.samples.length; i++) {
        mixed[v.offset + i] += v.samples[i];
      }
    }

    return this.normalizePeak(mixed);
  }

  applyLegacyModifiers(wave, patch) {
    let out = wave;
    if (patch.ring_mod && patch.ring_mod.mix > 0) {
      out = this.mod.applyRingMod(out, patch.ring_mod.freq || 500, patch.ring_mod.mix);
    }
    if (patch.retrigger && patch.retrigger.rate_hz > 0) {
      out = this.mod.applyRetrigger(out, patch.retrigger.rate_hz);
    }
    if (patch.lfo && patch.lfo.tremolo_depth > 0 && patch.lfo.tremolo_speed > 0) {
      out = this.mod.applyTremolo(out, patch.lfo.tremolo_speed, patch.lfo.tremolo_depth);
    }
    if (patch.saturation && patch.saturation > 1.0) {
      out = this.mod.applySaturation(out, patch.saturation);
    }
    if (patch.bit_depth && patch.bit_depth < 16) {
      out = this.mod.applyBitcrush(out, patch.bit_depth);
    }
    if (patch.echo && patch.echo.feedback > 0 && patch.echo.delay_time > 0) {
      out = this.mod.applyEcho(out, patch.echo.delay_time, patch.echo.feedback, patch.echo.num_taps || 3);
    }
    return out;
  }

  normalizePeak(wave) {
    let peak = 0;
    for (let i = 0; i < wave.length; i++) {
      const a = Math.abs(wave[i]);
      if (a > peak) peak = a;
    }
    if (peak > 1.0) {
      const inv = 1.0 / peak;
      for (let i = 0; i < wave.length; i++) wave[i] *= inv;
    }
    return wave;
  }
}
