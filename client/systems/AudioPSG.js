/**
 * Lanthorn-PSG Core (JavaScript ES Module Port for Project: Sanctum)
 * Ported from Edwigeon/Lanthorn-PSG (engine/oscillator.py, engine/modifiers.py, engine/constants.py)
 *
 * Pre-renders mathematical waveforms & DSP modifiers into Float32Arrays and caches them as
 * Web Audio AudioBuffers for zero-CPU runtime playback. 100% compatible with Lanthorn-PSG JSON presets.
 */

export const PSG_CONSTANTS = {
  HIFI_SAMPLE_RATE: 44100,
  LOFI_SAMPLE_RATE: 11025,
  DEFAULT_SAMPLE_RATE: 22050,
  ROOT_A4_FREQ: 440.0
};

export function midiToFreq(midi) {
  return PSG_CONSTANTS.ROOT_A4_FREQ * Math.pow(2, (midi - 69) / 12);
}

// --- OSCILLATOR (ported from Lanthorn-PSG engine/oscillator.py) ---

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

// --- MODIFIERS (ported from Lanthorn-PSG engine/modifiers.py) ---

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

    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const a = Math.abs(out[i]);
      if (a > peak) peak = a;
    }
    if (peak > 1.0) {
      const inv = 1.0 / peak;
      for (let i = 0; i < out.length; i++) out[i] *= inv;
    }
    return out;
  }
}

// --- AUDIO PSG ENGINE & PRESET PLAYER ---

export class AudioPSG {
  constructor(sampleRate = PSG_CONSTANTS.DEFAULT_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
    this.osc = new Oscillator(sampleRate);
    this.mod = new Modifiers(sampleRate);

    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    // Load persisted settings
    this.settings = this.loadSettings();

    // Listener coordinates for 2D spatial audio
    this.listenerX = 0;
    this.listenerY = 0;

    this.patches = {};
    this.bufferCache = new Map(); // name -> AudioBuffer
    this.lastPlayedAt = new Map(); // name -> ms timestamp (anti-spam throttle)
    this.listeners = new Set(); // Change event listeners
  }

  loadSettings() {
    const defaults = {
      master: 0.8,
      sfx: 0.8,
      music: 0.6,
      muted: false,
      spatial: true
    };
    try {
      const raw = localStorage.getItem('sanctum_audio_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          master: typeof parsed.master === 'number' ? Math.max(0, Math.min(1, parsed.master)) : defaults.master,
          sfx: typeof parsed.sfx === 'number' ? Math.max(0, Math.min(1, parsed.sfx)) : defaults.sfx,
          music: typeof parsed.music === 'number' ? Math.max(0, Math.min(1, parsed.music)) : defaults.music,
          muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaults.muted,
          spatial: typeof parsed.spatial === 'boolean' ? parsed.spatial : defaults.spatial
        };
      }
    } catch (_) {}
    return defaults;
  }

  saveSettings() {
    try {
      localStorage.setItem('sanctum_audio_settings', JSON.stringify(this.settings));
    } catch (_) {}
    this.notifyListeners();
  }

  onSettingsChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyListeners() {
    for (const fn of this.listeners) {
      try { fn(this.settings); } catch (_) {}
    }
  }

  get volume() {
    return this.settings.master;
  }

  set volume(v) {
    this.setMasterVolume(v);
  }

  get muted() {
    return this.settings.muted;
  }

  set muted(m) {
    this.setMuted(m);
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      // Audio Graph: SFX Gain & Music Gain -> Master Gain -> Destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.muted ? 0 : this.settings.master;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.settings.sfx;
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.settings.music;
      this.musicGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted) {
    this.settings.muted = !!muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.settings.muted ? 0 : this.settings.master, this.ctx.currentTime);
    }
    this.saveSettings();
    return this.settings.muted;
  }

  toggleMute() {
    return this.setMuted(!this.settings.muted);
  }

  setMasterVolume(vol) {
    this.settings.master = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.settings.muted) {
      this.masterGain.gain.setValueAtTime(this.settings.master, this.ctx.currentTime);
    }
    this.saveSettings();
  }

  setVolume(vol) {
    this.setMasterVolume(vol);
  }

  setSfxVolume(vol) {
    this.settings.sfx = Math.max(0, Math.min(1, vol));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.settings.sfx, this.ctx.currentTime);
    }
    this.saveSettings();
  }

  setMusicVolume(vol) {
    this.settings.music = Math.max(0, Math.min(1, vol));
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(this.settings.music, this.ctx.currentTime);
    }
    this.saveSettings();
  }

  setSpatialEnabled(enabled) {
    this.settings.spatial = !!enabled;
    this.saveSettings();
  }

  setListener(x, y) {
    if (typeof x === 'number') this.listenerX = x;
    if (typeof y === 'number') this.listenerY = y;
  }

  /**
   * Calculates distance attenuation & stereo panning relative to listener (player).
   */
  calculateSpatial(sourceX, sourceY, maxDist = 260) {
    if (!this.settings.spatial) {
      return { gain: 1.0, pan: 0.0, audible: true };
    }
    if (typeof sourceX !== 'number' || typeof sourceY !== 'number') {
      return { gain: 1.0, pan: 0.0, audible: true };
    }
    const dx = sourceX - this.listenerX;
    const dy = sourceY - this.listenerY;
    const dist = Math.hypot(dx, dy);

    if (dist >= maxDist) {
      return { gain: 0, pan: 0, audible: false };
    }

    // Distance attenuation: natural dropoff with punchy center
    const norm = 1.0 - (dist / maxDist);
    const gain = Math.pow(norm, 1.4);

    // Stereo panning based on X offset (-0.85 to +0.85)
    const pan = Math.max(-0.85, Math.min(0.85, dx / 150));

    return { gain, pan, audible: true };
  }

  async loadManifest(url = '/data/sfx.json') {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      this.patches = data || {};
      this.bufferCache.clear();
    } catch (err) {
      console.warn('[AudioPSG] Failed to load SFX manifest:', err.message);
    }
  }

  /**
   * Renders a single note or event using a Lanthorn-PSG compatible JSON patch into a Float32Array.
   */
  renderSingleVoice(patch, freqOverride = null, durationOverride = null) {
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

    // 4. Signal Processing Chain (Modifiers)
    if (patch.ring_mod && patch.ring_mod.mix > 0) {
      wave = this.mod.applyRingMod(wave, patch.ring_mod.freq || 500, patch.ring_mod.mix);
    }
    if (patch.retrigger && patch.retrigger.rate_hz > 0) {
      wave = this.mod.applyRetrigger(wave, patch.retrigger.rate_hz);
    }
    if (patch.envelope) {
      const e = patch.envelope;
      wave = this.mod.applyADSR(wave, e.attack ?? 0.005, e.decay ?? 0.08, e.sustain_level ?? 0.5, e.release ?? 0.05);
    }
    if (patch.lfo && patch.lfo.tremolo_depth > 0 && patch.lfo.tremolo_speed > 0) {
      wave = this.mod.applyTremolo(wave, patch.lfo.tremolo_speed, patch.lfo.tremolo_depth);
    }
    if (patch.saturation && patch.saturation > 1.0) {
      wave = this.mod.applySaturation(wave, patch.saturation);
    }
    if (patch.bit_depth && patch.bit_depth < 16) {
      wave = this.mod.applyBitcrush(wave, patch.bit_depth);
    }
    if (patch.echo && patch.echo.feedback > 0 && patch.echo.delay_time > 0) {
      wave = this.mod.applyEcho(wave, patch.echo.delay_time, patch.echo.feedback, patch.echo.num_taps || 3);
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

    let wave = mixed;
    if (patch.ring_mod && patch.ring_mod.mix > 0) {
      wave = this.mod.applyRingMod(wave, patch.ring_mod.freq || 500, patch.ring_mod.mix);
    }
    if (patch.retrigger && patch.retrigger.rate_hz > 0) {
      wave = this.mod.applyRetrigger(wave, patch.retrigger.rate_hz);
    }
    if (patch.lfo && patch.lfo.tremolo_depth > 0 && patch.lfo.tremolo_speed > 0) {
      wave = this.mod.applyTremolo(wave, patch.lfo.tremolo_speed, patch.lfo.tremolo_depth);
    }
    if (patch.saturation && patch.saturation > 1.0) {
      wave = this.mod.applySaturation(wave, patch.saturation);
    }
    if (patch.bit_depth && patch.bit_depth < 16) {
      wave = this.mod.applyBitcrush(wave, patch.bit_depth);
    }
    if (patch.echo && patch.echo.feedback > 0 && patch.echo.delay_time > 0) {
      wave = this.mod.applyEcho(wave, patch.echo.delay_time, patch.echo.feedback, patch.echo.num_taps || 3);
    }

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

    // Normalize softly to prevent clipping on overlapping arpeggio tails
    let peak = 0;
    for (let i = 0; i < mixed.length; i++) {
      const a = Math.abs(mixed[i]);
      if (a > peak) peak = a;
    }
    if (peak > 1.0) {
      const inv = 1.0 / peak;
      for (let i = 0; i < mixed.length; i++) mixed[i] *= inv;
    }
    return mixed;
  }

  float32ToAudioBuffer(ctx, samples) {
    const buf = ctx.createBuffer(1, samples.length, this.sampleRate);
    buf.copyToChannel(samples, 0);
    return buf;
  }

  /**
   * Plays a named SFX from the loaded manifest (caching its AudioBuffer on first play).
   * Supports player-relative proximity attenuation & stereo panning if { x, y } are provided.
   */
  play(name, {
    gain = 1.0,
    pitchJitter = 0.04,
    pan = 0.0,
    minIntervalMs = 35,
    x = null,
    y = null,
    maxDistance = 260
  } = {}) {
    if (this.settings.muted) return;
    const patch = this.patches[name];
    if (!patch) return;

    // Spatial proximity & stereo panning if position provided
    let spatialGain = 1.0;
    let spatialPan = pan;
    if (typeof x === 'number' && typeof y === 'number') {
      const spatial = this.calculateSpatial(x, y, maxDistance);
      if (!spatial.audible || spatial.gain <= 0.002) return; // Out of hearing range
      spatialGain = spatial.gain;
      spatialPan = spatial.pan;
    }

    const now = performance.now();
    const last = this.lastPlayedAt.get(name) || 0;
    if (now - last < minIntervalMs) return;
    this.lastPlayedAt.set(name, now);

    const ctx = this.ensureContext();
    if (!ctx) return;

    let buffer = this.bufferCache.get(name);
    if (!buffer) {
      const samples = this.renderPatchToFloat32(patch);
      buffer = this.float32ToAudioBuffer(ctx, samples);
      this.bufferCache.set(name, buffer);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (pitchJitter > 0) {
      src.playbackRate.value = 1.0 + (Math.random() * 2 - 1) * pitchJitter;
    }

    const gNode = ctx.createGain();
    gNode.gain.value = (patch.gain ?? 0.8) * gain * spatialGain;

    const targetBus = this.sfxGain || this.masterGain;

    if (spatialPan !== 0 && ctx.createStereoPanner) {
      const pNode = ctx.createStereoPanner();
      pNode.pan.value = Math.max(-1, Math.min(1, spatialPan));
      src.connect(gNode);
      gNode.connect(pNode);
      pNode.connect(targetBus);
    } else {
      src.connect(gNode);
      gNode.connect(targetBus);
    }

    src.start();
  }

  /**
   * Renders and immediately plays an arbitrary patch object (used by /dev PSG Synth Studio).
   */
  previewPatch(patch) {
    const ctx = this.ensureContext();
    if (!ctx || !patch) return null;
    const samples = this.renderPatchToFloat32(patch);
    const buffer = this.float32ToAudioBuffer(ctx, samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gNode = ctx.createGain();
    gNode.gain.value = patch.gain ?? 0.8;
    const targetBus = this.sfxGain || this.masterGain;
    src.connect(gNode);
    gNode.connect(targetBus);
    src.start();
    return samples;
  }
}
