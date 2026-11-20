/**
 * Lanthorn-PSG Oscillator (ported from Lanthorn-PSG engine/oscillator.py)
 */

import { PSG_CONSTANTS } from './AudioMath.js';

export class Oscillator {
  constructor(sampleRate = PSG_CONSTANTS.DEFAULT_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  /**
   * Generates a raw Float32Array waveform using continuous phase integration.
   * Supports: 'sine', 'square' (static or array PWM duty_cycle), 'sawtooth', 'triangle', 'noise'.
   */
  generate(waveType, frequency, duration, dutyCycle = 0.5) {
    const totalSamples = Math.max(1, Math.floor(this.sampleRate * duration));
    const out = new Float32Array(totalSamples);

    if (waveType === 'noise') {
      // Deterministic LFSR-style retro noise for consistent crispness
      let lfsr = 0xACE1;
      for (let i = 0; i < totalSamples; i++) {
        const bit = ((lfsr >> 0) ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
        lfsr = (lfsr >> 1) | (bit << 15);
        out[i] = ((lfsr & 0xFF) / 127.5) - 1.0;
      }
      return out;
    }

    const isFreqArray = typeof frequency !== 'number';
    const isDutyArray = typeof dutyCycle !== 'number';
    const invSR = 1.0 / this.sampleRate;
    const TWO_PI = Math.PI * 2;
    let phase = 0.0;

    for (let i = 0; i < totalSamples; i++) {
      const freq = isFreqArray
        ? frequency[i < frequency.length ? i : frequency.length - 1]
        : frequency;

      // Continuous phase integration prevents clicks during pitch sweeps / vibrato
      phase += freq * invSR;
      const pFrac = phase - Math.floor(phase);

      if (waveType === 'sine') {
        out[i] = Math.sin(TWO_PI * phase);
      } else if (waveType === 'square') {
        const dc = isDutyArray
          ? dutyCycle[i < dutyCycle.length ? i : dutyCycle.length - 1]
          : dutyCycle;
        out[i] = pFrac < dc ? 1.0 : -1.0;
      } else if (waveType === 'sawtooth') {
        out[i] = 2.0 * pFrac - 1.0;
      } else if (waveType === 'triangle') {
        const saw = 2.0 * pFrac - 1.0;
        out[i] = 2.0 * Math.abs(saw) - 1.0;
      } else {
        out[i] = 0.0;
      }
    }

    return out;
  }
}
