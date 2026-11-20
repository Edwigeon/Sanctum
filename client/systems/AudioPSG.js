/**
 * Lanthorn-PSG Core (JavaScript ES Module Port for Project: Sanctum)
 * Ported from Edwigeon/Lanthorn-PSG (engine/oscillator.py, engine/modifiers.py, engine/constants.py)
 *
 * Pre-renders mathematical waveforms & DSP modifiers into Float32Arrays and caches them as
 * Web Audio AudioBuffers for zero-CPU runtime playback. 100% compatible with Lanthorn-PSG JSON presets.
 */

import { PSG_CONSTANTS, midiToFreq, NOTE_OFFSETS, noteToMidi } from './audio/AudioMath.js';
import { Oscillator } from './audio/Oscillator.js';
import { Modifiers } from './audio/Modifiers.js';
import { PatchRenderer } from './audio/PatchRenderer.js';

export { PSG_CONSTANTS, midiToFreq, NOTE_OFFSETS, noteToMidi, Oscillator, Modifiers, PatchRenderer };

export class AudioPSG {
  constructor(sampleRateOverride = null) {
    // Load persisted settings first to know quality preference
    this.settings = this.loadSettings();

    const qualityRates = {
      hifi: PSG_CONSTANTS.HIFI_SAMPLE_RATE,
      lofi: PSG_CONSTANTS.LOFI_SAMPLE_RATE,
      standard: PSG_CONSTANTS.DEFAULT_SAMPLE_RATE
    };

    this.sampleRate = sampleRateOverride ?? qualityRates[this.settings.quality] ?? PSG_CONSTANTS.DEFAULT_SAMPLE_RATE;
    this.osc = new Oscillator(this.sampleRate);
    this.mod = new Modifiers(this.sampleRate);
    this.patchRenderer = new PatchRenderer(this.sampleRate, this.osc, this.mod);

    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    // Macro FX Nodes
    this.lowHealthFilter = null;
    this.submixBus = null;
    this.envDelay = null;
    this.envFeedback = null;
    this.envDelayGain = null;

    this.macroState = {
      lowHealth: false,
      environment: 'normal',
      poisoned: false
    };

    // Listener coordinates for 2D spatial audio
    this.listenerX = 0;
    this.listenerY = 0;

    this.patches = {};
    this.pcmCache = new Map(); // name -> Float32Array (pre-synthesized PCM)
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
      spatial: true,
      quality: 'standard' // 'hifi' (44.1k), 'standard' (22k), 'lofi' (11k)
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
          spatial: typeof parsed.spatial === 'boolean' ? parsed.spatial : defaults.spatial,
          quality: ['hifi', 'standard', 'lofi'].includes(parsed.quality) ? parsed.quality : defaults.quality
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

  setQuality(quality) {
    if (!['hifi', 'standard', 'lofi'].includes(quality)) quality = 'standard';
    if (this.settings.quality === quality) return;
    this.settings.quality = quality;

    const rates = {
      hifi: PSG_CONSTANTS.HIFI_SAMPLE_RATE,
      lofi: PSG_CONSTANTS.LOFI_SAMPLE_RATE,
      standard: PSG_CONSTANTS.DEFAULT_SAMPLE_RATE
    };
    this.sampleRate = rates[quality] ?? PSG_CONSTANTS.DEFAULT_SAMPLE_RATE;
    this.osc = new Oscillator(this.sampleRate);
    this.mod = new Modifiers(this.sampleRate);
    this.patchRenderer.setSampleRate(this.sampleRate, this.osc, this.mod);

    // Discard old sample-rate buffers
    this.pcmCache.clear();
    this.bufferCache.clear();
    this.saveSettings();
    this.prewarmCommonPatches();
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      // Master Gain -> Destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.muted ? 0 : this.settings.master;
      this.masterGain.connect(this.ctx.destination);

      // Low-Health / Tense Muffle Filter (BiquadFilter lowpass)
      this.lowHealthFilter = this.ctx.createBiquadFilter();
      this.lowHealthFilter.type = 'lowpass';
      this.lowHealthFilter.frequency.value = 22000;
      this.lowHealthFilter.Q.value = 0.7;
      this.lowHealthFilter.connect(this.masterGain);

      // Submix Bus (Dry signal path -> Low Health Filter)
      this.submixBus = this.ctx.createGain();
      this.submixBus.gain.value = 1.0;
      this.submixBus.connect(this.lowHealthFilter);

      // Environmental Delay / Echo (Wet send path for Cathedrals / Caverns)
      this.envDelay = this.ctx.createDelay();
      this.envDelay.delayTime.value = 0.22; // 220ms slapback echo

      this.envFeedback = this.ctx.createGain();
      this.envFeedback.gain.value = 0.35; // 35% feedback loop

      this.envDelayGain = this.ctx.createGain();
      this.envDelayGain.gain.value = 0.0; // Dry by default

      this.envDelay.connect(this.envFeedback);
      this.envFeedback.connect(this.envDelay);
      this.envDelay.connect(this.envDelayGain);
      this.envDelayGain.connect(this.lowHealthFilter);

      // SFX Bus
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.settings.sfx;
      this.sfxGain.connect(this.submixBus);
      this.sfxGain.connect(this.envDelay);

      // Music Bus
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.settings.music;
      this.musicGain.connect(this.submixBus);
      this.musicGain.connect(this.envDelay);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMacroState({ lowHealth = null, environment = null, poisoned = null } = {}) {
    if (lowHealth !== null) this.macroState.lowHealth = !!lowHealth;
    if (environment !== null) this.macroState.environment = environment;
    if (poisoned !== null) this.macroState.poisoned = !!poisoned;

    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Low Health Tension Macro (muffled heartbeat filter)
    if (this.lowHealthFilter) {
      if (this.macroState.lowHealth) {
        this.lowHealthFilter.frequency.setTargetAtTime(450, now, 0.08);
        this.lowHealthFilter.Q.setTargetAtTime(2.2, now, 0.08);
      } else {
        this.lowHealthFilter.frequency.setTargetAtTime(22000, now, 0.12);
        this.lowHealthFilter.Q.setTargetAtTime(0.7, now, 0.12);
      }
    }

    // 2. Environmental Echo / Reverb Macro (Cavern / Cathedral)
    if (this.envDelayGain) {
      const isWetEnv = this.macroState.environment === 'cathedral' || this.macroState.environment === 'cavern';
      this.envDelayGain.gain.setTargetAtTime(isWetEnv ? 0.35 : 0.0, now, 0.1);
    }
  }

  resetMacroState() {
    this.macroState = {
      lowHealth: false,
      environment: 'cathedral',
      poisoned: false
    };

    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.lowHealthFilter) {
      try {
        this.lowHealthFilter.frequency.cancelScheduledValues(now);
        this.lowHealthFilter.frequency.setValueAtTime(22000, now);
        this.lowHealthFilter.Q.cancelScheduledValues(now);
        this.lowHealthFilter.Q.setValueAtTime(0.7, now);
      } catch {
        this.lowHealthFilter.frequency.value = 22000;
        this.lowHealthFilter.Q.value = 0.7;
      }
    }

    if (this.envDelayGain) {
      try {
        this.envDelayGain.gain.cancelScheduledValues(now);
        this.envDelayGain.gain.setValueAtTime(0.0, now);
      } catch {
        this.envDelayGain.gain.value = 0.0;
      }
    }
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

  prewarmCommonPatches(names = ['spark', 'hit', 'crit', 'player_hurt', 'potion']) {
    for (const name of names) {
      const patch = this.patches[name];
      if (!patch || this.pcmCache.has(name)) continue;
      this.pcmCache.set(name, this.renderPatchToFloat32(patch));
    }
  }

  async loadManifest(url = '/data/sfx.json') {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      this.patches = data || {};
      this.pcmCache.clear();
      this.bufferCache.clear();
      this.prewarmCommonPatches();
    } catch (err) {
      console.warn('[AudioPSG] Failed to load SFX manifest:', err.message);
    }
  }

  renderSingleVoice(patch, freqOverride = null, durationOverride = null, macroOverrides = []) {
    return this.patchRenderer.renderSingleVoice(patch, freqOverride, durationOverride, macroOverrides);
  }

  renderPainterPatch(patch) {
    return this.patchRenderer.renderPainterPatch(patch);
  }

  renderPatchToFloat32(patch) {
    return this.patchRenderer.renderPatchToFloat32(patch);
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
      let samples = this.pcmCache.get(name);
      if (!samples) {
        samples = this.renderPatchToFloat32(patch);
        this.pcmCache.set(name, samples);
      }
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
