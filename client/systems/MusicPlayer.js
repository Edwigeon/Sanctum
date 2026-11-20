/**
 * MusicPlayer.js - Interactive Tracker Music Engine for Project: Sanctum
 * Multi-suite biome manager for Lanthorn-PSG v1.1 modular .csv projects.
 * Features dual-voice crossfading (zero clicks or jarring cuts), granular mood sections
 * (explore, combat, tension, descent), and beat-quantized state scheduling.
 */

import { MusicDatabase } from './MusicDatabase.js';
import {
  TRACK_SUITES,
  SUITE_SECTIONS,
  parseTrackerCSV,
  loadTrackerSuite
} from './audio/TrackerSuiteLoader.js';
import {
  getPatternDuration,
  renderPatternToBuffer,
  ensurePatternBuffer,
  prewarmSections
} from './audio/PatternBufferCompiler.js';

export { TRACK_SUITES, SUITE_SECTIONS };

export class MusicPlayer {
  constructor({ audio }) {
    this.audio = audio;
    this.ctx = null;
    this.db = new MusicDatabase();
    this.soundtrackBundlePromise = null;

    // Multi-suite cache: suiteName -> { header, patches, orderList, patterns, patternBuffers }
    this.suiteCache = new Map();
    this.currentSuiteName = null;
    this.suiteSections = { ...SUITE_SECTIONS };

    // Crossfading voice channels (Voice 0 and Voice 1)
    this.voiceGains = [null, null];
    this.voiceSources = [null, null];
    this.activeVoiceIdx = 0;

    this.currentSection = 'explore';
    this.sectionIndex = 0;
    this.isPlaying = false;
    this.nextScheduledTime = 0;
    this.pendingSection = null;
    this.scheduleTimer = null;

    // Locked state timer (e.g. while descent cue is playing)
    this.lockedUntilTime = 0;
  }

  ensureVoiceGraph() {
    const ctx = this.audio.ensureContext();
    if (!ctx) return null;
    if (!this.voiceGains[0]) {
      this.voiceGains[0] = ctx.createGain();
      this.voiceGains[0].gain.value = 1.0;
      this.voiceGains[0].connect(this.audio.musicGain);

      this.voiceGains[1] = ctx.createGain();
      this.voiceGains[1].gain.value = 0.0;
      this.voiceGains[1].connect(this.audio.musicGain);
    }
    return ctx;
  }

  async loadSuite(suiteName) {
    return loadTrackerSuite(this, suiteName);
  }

  parseCSV(text) {
    return parseTrackerCSV(text);
  }

  isLocked() {
    return performance.now() < this.lockedUntilTime;
  }

  lock(durationMs) {
    this.lockedUntilTime = performance.now() + durationMs;
  }

  async setBiome(suiteName, { immediate = false, fadeSec = 1.2 } = {}) {
    if (!TRACK_SUITES[suiteName]) suiteName = 'crypts';
    if (this.currentSuiteName === suiteName && this.isPlaying) return;

    const suiteData = await this.loadSuite(suiteName);
    if (!suiteData) return;

    this.currentSuiteName = suiteName;
    this.playSection('explore', { immediate, fadeSec });
    this.prewarmSections(['combat', 'tension', 'explore']);
  }

  prewarmSections(sectionNames) {
    prewarmSections(this, sectionNames);
  }

  getCurrentSuiteData() {
    return this.suiteCache.get(this.currentSuiteName);
  }

  getPatternDuration(suiteData, patternId) {
    return getPatternDuration(suiteData, patternId);
  }

  async ensurePatternBuffer(suiteData, patternId) {
    return ensurePatternBuffer(this, suiteData, patternId);
  }

  renderPatternToBuffer(suiteData, patternId) {
    return renderPatternToBuffer(this, suiteData, patternId);
  }

  playSection(sectionName, { immediate = false, fadeSec = 1.0, lockMs = 0 } = {}) {
    const sections = this.suiteSections[this.currentSuiteName] || this.suiteSections.crypts;
    if (!sections[sectionName]) sectionName = 'explore';
    if (this.currentSection === sectionName && this.isPlaying && !immediate) return;

    if (lockMs > 0) {
      this.lock(lockMs);
    }

    if (immediate || !this.isPlaying) {
      const isFirstPlay = !this.isPlaying;
      this.currentSection = sectionName;
      this.sectionIndex = 0;
      this.pendingSection = null;
      const attackSec = isFirstPlay ? 0.05 : fadeSec;
      this.transitionToActiveSection(attackSec);
    } else {
      this.pendingSection = sectionName;
    }
  }

  async transitionToActiveSection(fadeSec = 1.0) {
    const ctx = this.ensureVoiceGraph();
    if (!ctx) return;

    const suiteData = this.getCurrentSuiteData();
    if (!suiteData) return;

    clearTimeout(this.scheduleTimer);
    const now = ctx.currentTime;

    const oldIdx = this.activeVoiceIdx;
    const newIdx = 1 - oldIdx;
    this.activeVoiceIdx = newIdx;

    const oldGain = this.voiceGains[oldIdx];
    const newGain = this.voiceGains[newIdx];
    const oldSrc = this.voiceSources[oldIdx];

    if (oldGain && oldSrc) {
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      try { oldSrc.stop(now + fadeSec + 0.05); } catch (_) {}
      this.voiceSources[oldIdx] = null;
    }

    const sections = this.suiteSections[this.currentSuiteName] || this.suiteSections.crypts;
    const patternList = sections[this.currentSection] || sections.explore;
    const patternId = patternList[this.sectionIndex % patternList.length];

    const buffer = await this.ensurePatternBuffer(suiteData, patternId);
    const patternDur = this.getPatternDuration(suiteData, patternId);

    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(newGain);

      const playNow = ctx.currentTime;
      newGain.gain.setValueAtTime(0.0001, playNow);
      newGain.gain.linearRampToValueAtTime(1.0, playNow + fadeSec);

      src.start(playNow);
      this.voiceSources[newIdx] = src;
      this.nextScheduledTime = playNow + patternDur;
    } else {
      this.nextScheduledTime = ctx.currentTime + 4.0;
    }

    this.isPlaying = true;
    this.sectionIndex++;

    const delayMs = Math.max(50, (this.nextScheduledTime - ctx.currentTime - 0.3) * 1000);
    this.scheduleTimer = setTimeout(() => this.scheduleNext(), delayMs);

    const nextPatternId = patternList[this.sectionIndex % patternList.length];
    this.ensurePatternBuffer(suiteData, nextPatternId).catch(() => {});
  }

  async scheduleNext() {
    if (!this.isPlaying) return;
    const ctx = this.ensureVoiceGraph();
    if (!ctx) return;

    const suiteData = this.getCurrentSuiteData();
    if (!suiteData) return;

    if (this.pendingSection) {
      this.currentSection = this.pendingSection;
      this.sectionIndex = 0;
      this.pendingSection = null;
    }

    const sections = this.suiteSections[this.currentSuiteName] || this.suiteSections.crypts;
    const patternList = sections[this.currentSection] || sections.explore;
    const patternId = patternList[this.sectionIndex % patternList.length];
    const buffer = await this.ensurePatternBuffer(suiteData, patternId);
    const patternDur = this.getPatternDuration(suiteData, patternId);

    if (buffer) {
      const activeGain = this.voiceGains[this.activeVoiceIdx];
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(activeGain);

      const startTime = Math.max(ctx.currentTime, this.nextScheduledTime);
      src.start(startTime);
      this.voiceSources[this.activeVoiceIdx] = src;
      this.nextScheduledTime = startTime + patternDur;
    } else {
      this.nextScheduledTime = ctx.currentTime + 4.0;
    }

    this.sectionIndex++;

    const delayMs = Math.max(50, (this.nextScheduledTime - ctx.currentTime - 0.3) * 1000);
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = setTimeout(() => this.scheduleNext(), delayMs);

    const nextPatternId = patternList[this.sectionIndex % patternList.length];
    this.ensurePatternBuffer(suiteData, nextPatternId).catch(() => {});
  }

  stop({ fadeSec = 0.8 } = {}) {
    clearTimeout(this.scheduleTimer);
    this.isPlaying = false;
    this.pendingSection = null;

    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        if (this.voiceGains[i]) {
          this.voiceGains[i].gain.setValueAtTime(this.voiceGains[i].gain.value, now);
          this.voiceGains[i].gain.linearRampToValueAtTime(0.0001, now + fadeSec);
        }
        if (this.voiceSources[i]) {
          try { this.voiceSources[i].stop(now + fadeSec); } catch (_) {}
          this.voiceSources[i] = null;
        }
      }
    }
  }

  clearCache() {
    for (const s of this.suiteCache.values()) {
      s.patternBuffers.clear();
    }
    if (this.db) {
      this.db.clearAll().catch(() => {});
    }
  }
}
