/**
 * Lanthorn-PSG Modifiers & DSP Pipeline (ported from Lanthorn-PSG engine/modifiers.py)
 */

import { PSG_CONSTANTS } from './AudioMath.js';

export class Modifiers {
  constructor(sampleRate = PSG_CONSTANTS.DEFAULT_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  applyADSR(wave, attack = 0.01, decay = 0.1, sustainLevel = 0.7, release = 0.1) {
    if (attack <= 0 && decay <= 0 && release <= 0 && sustainLevel >= 1.0) {
      return wave;
    }
    const n = wave.length;
    const aSamples = Math.floor(attack * this.sampleRate);
    const dSamples = Math.floor(decay * this.sampleRate);
    const rSamples = Math.floor(release * this.sampleRate);
    const sSamples = Math.max(0, n - aSamples - dSamples - rSamples);

    const out = new Float32Array(n);
    const dEnd = aSamples + dSamples;
    const sEnd = dEnd + sSamples;

    for (let i = 0; i < n; i++) {
      let env = 0.0;
      if (i < aSamples) {
        env = aSamples > 0 ? i / aSamples : 1.0;
      } else if (i < dEnd) {
        const t = (i - aSamples) / Math.max(1, dSamples);
        env = 1.0 + (sustainLevel - 1.0) * t;
      } else if (i < sEnd) {
        env = sustainLevel;
      } else {
        const t = (i - sEnd) / Math.max(1, rSamples);
        env = Math.max(0.0, sustainLevel * (1.0 - t));
      }
      out[i] = wave[i] * env;
    }
    return out;
  }

  applyTremolo(wave, speedHz = 5.0, depth = 0.5) {
    if (depth <= 0.0 || speedHz <= 0.0) return wave;
    const n = wave.length;
    const out = new Float32Array(n);
    const factor = (Math.PI * 2 * speedHz) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      const lfo = 1.0 - depth * (0.5 * (1.0 + Math.sin(factor * i)));
      out[i] = wave[i] * lfo;
    }
    return out;
  }

  generateVibratoProfile(baseFreq, duration, speedHz = 5.0, depthSemitones = 0.5) {
    const n = Math.max(1, Math.floor(this.sampleRate * duration));
    const isArray = typeof baseFreq !== 'number';
    const out = new Float32Array(n);
    if (depthSemitones <= 0.0 || speedHz <= 0.0) {
      for (let i = 0; i < n; i++) {
        out[i] = isArray ? baseFreq[i < baseFreq.length ? i : baseFreq.length - 1] : baseFreq;
      }
      return out;
    }
    const factor = (Math.PI * 2 * speedHz) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      const f = isArray ? baseFreq[i < baseFreq.length ? i : baseFreq.length - 1] : baseFreq;
      const lfo = Math.sin(factor * i);
      out[i] = f * Math.pow(2.0, (lfo * depthSemitones) / 12.0);
    }
    return out;
  }

  generateSlideProfile(startFreq, endFreq, duration, slideTime = 0.1) {
    const n = Math.max(1, Math.floor(this.sampleRate * duration));
    const slideSamples = Math.min(n, Math.floor(this.sampleRate * slideTime));
    const out = new Float32Array(n);
    if (slideSamples <= 0) {
      out.fill(endFreq);
      return out;
    }
    for (let i = 0; i < n; i++) {
      if (i < slideSamples) {
        out[i] = startFreq + (endFreq - startFreq) * (i / slideSamples);
      } else {
        out[i] = endFreq;
      }
    }
    return out;
  }

  generatePitchSweep(startFreq, endFreq, duration) {
    const n = Math.max(1, Math.floor(this.sampleRate * duration));
    const sf = Math.max(1.0, startFreq);
    const ef = Math.max(1.0, endFreq);
    const ratio = ef / sf;
    const out = new Float32Array(n);
    const invN = n > 1 ? 1.0 / (n - 1) : 0;
    for (let i = 0; i < n; i++) {
      out[i] = sf * Math.pow(ratio, i * invN);
    }
    return out;
  }

  generatePWMProfile(duration, lfoSpeed = 0.5, depth = 0.4, baseWidth = 0.5) {
    const n = Math.max(1, Math.floor(this.sampleRate * duration));
    const out = new Float32Array(n);
    const factor = (Math.PI * 2 * lfoSpeed) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      out[i] = Math.max(0.05, Math.min(0.95, baseWidth + depth * 0.5 * Math.sin(factor * i)));
    }
    return out;
  }

  applySaturation(wave, gain = 1.2) {
    if (gain <= 1.0) return wave;
    const n = wave.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.tanh(wave[i] * gain);
    }
    return out;
  }

  applyBitcrush(wave, bits = 8) {
    if (bits >= 16) return wave;
    const n = wave.length;
    const qLevels = Math.pow(2, bits);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const norm = (wave[i] + 1.0) * 0.5;
      const crushed = Math.round(norm * qLevels) / qLevels;
      out[i] = crushed * 2.0 - 1.0;
    }
    return out;
  }

  applyRingMod(wave, carrierFreq = 500.0, mix = 1.0) {
    if (mix <= 0.0) return wave;
    const n = wave.length;
    const out = new Float32Array(n);
    const factor = (Math.PI * 2 * carrierFreq) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      const rm = wave[i] * Math.sin(factor * i);
      out[i] = wave[i] * (1.0 - mix) + rm * mix;
    }
    return out;
  }

  applyRetrigger(wave, rateHz = 16.0) {
    if (rateHz <= 0.0) return wave;
    const n = wave.length;
    const out = new Float32Array(n);
    const factor = (Math.PI * 2 * rateHz) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      const gate = Math.sin(factor * i) >= 0 ? 1.0 : 0.0;
      out[i] = wave[i] * gate;
    }
    return out;
  }

  applyEcho(wave, delayTime = 0.15, feedback = 0.4, numTaps = 4) {
    if (feedback <= 0.0 || delayTime <= 0.0) return wave;
    const delaySamples = Math.floor(delayTime * this.sampleRate);
    if (delaySamples <= 0) return wave;

    const tailLen = Math.min(this.sampleRate * 1.5, delaySamples * numTaps);
    const out = new Float32Array(wave.length + tailLen);
    out.set(wave, 0);

    for (let tap = 0; tap < numTaps; tap++) {
      const offset = delaySamples * (tap + 1);
      const gain = Math.pow(feedback, tap + 1);
      if (gain < 0.01) break;
      const maxLen = Math.min(wave.length, out.length - offset);
      for (let i = 0; i < maxLen; i++) {
        out[offset + i] += wave[i] * gain;
      }
    }

    return out;
  }
}
