/**
 * MusicPlayer.js - Interactive Tracker Music Engine for Project: Sanctum
 * Multi-suite biome manager for Lanthorn-PSG v1.1 modular .csv projects.
 * Features dual-voice crossfading (zero clicks or jarring cuts), granular mood sections
 * (explore, combat, tension, descent), and beat-quantized state scheduling.
 */

import { noteToMidi, midiToFreq } from './AudioPSG.js';

export const TRACK_SUITES = {
  town: '/data/music/sanctum_town.csv',
  wilderness: '/data/music/sanctum_wilderness.csv',
  crypts: '/data/music/sanctum_crypts.csv',
  caverns: '/data/music/sanctum_caverns.csv',
  cathedral: '/data/music/sanctum_cathedral.csv',
  boss: '/data/music/sanctum_boss.csv'
};

export class MusicPlayer {
  constructor({ audio }) {
    this.audio = audio;
    this.ctx = null;

    // Multi-suite cache: suiteName -> { header, patches, orderList, patterns, patternBuffers }
    this.suiteCache = new Map();
    this.currentSuiteName = null;

    // Granular mood sections per suite
    this.suiteSections = {
      town: {
        explore: ['A', 'E', 'H'],
        combat: ['F'],
        tension: ['B', 'C', 'G'],
        descent: ['D']
      },
      wilderness: {
        explore: ['A', 'C', 'H'],
        combat: ['B', 'G'],
        tension: ['E', 'F'],
        descent: ['D']
      },
      crypts: {
        explore: ['A', 'C', 'H'],
        combat: ['B', 'G'],
        tension: ['E', 'F'],
        descent: ['D']
      },
      caverns: {
        explore: ['A', 'E', 'H'],
        combat: ['B', 'G'],
        tension: ['C', 'F'],
        descent: ['D']
      },
      cathedral: {
        explore: ['A', 'B', 'C', 'H'],
        combat: ['F', 'G'],
        tension: ['E'],
        descent: ['D'],
        resolution: ['I']
      },
      boss: {
        explore: ['C', 'E', 'H'],
        combat: ['A', 'B', 'D', 'G'],
        climax: ['F', 'I', 'J'],
        descent: ['K']
      }
    };

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
    if (this.suiteCache.has(suiteName)) {
      return this.suiteCache.get(suiteName);
    }
    const url = TRACK_SUITES[suiteName];
    if (!url) return null;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const text = await res.text();
      const suiteData = this.parseCSV(text);
      this.suiteCache.set(suiteName, suiteData);
      return suiteData;
    } catch (err) {
      console.warn(`[MusicPlayer] Failed to load suite '${suiteName}':`, err.message);
      return null;
    }
  }

  parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const patches = {};
    const orderList = [];
    const patterns = {};
    let projectHeader = null;
    let curPattern = null;

    for (const line of lines) {
      if (line.startsWith('LANTHORN_V1.1')) {
        const parts = line.split(',');
        projectHeader = {
          version: parts[0],
          numChannels: parseInt(parts[1], 10) || 8,
          numPatterns: parseInt(parts[2], 10) || 7,
          bpm: parseFloat(parts[3]) || 80,
          linesPerBeat: parseInt(parts[4], 10) || 4,
          key: parts[5]?.trim() || 'D',
          scale: parts[6]?.trim() || 'Phrygian',
          linesPerMeasure: parseInt(parts[7], 10) || 16
        };
      } else if (line.startsWith('PATCH,')) {
        const firstComma = line.indexOf(',');
        const secondComma = line.indexOf(',', firstComma + 1);
        const name = line.substring(firstComma + 1, secondComma).trim();
        let jsonStr = line.substring(secondComma + 1).trim();
        if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
          jsonStr = jsonStr.slice(1, -1).replace(/""/g, '"');
        }
        try {
          patches[name] = JSON.parse(jsonStr);
        } catch (_) {}
      } else if (line.startsWith('SEQ,')) {
        const parts = line.split(',');
        if (parts[2]) orderList.push(parts[2].trim());
      } else if (line.startsWith('PATTERN,')) {
        const parts = line.split(',');
        const id = parts[1].trim();
        curPattern = {
          id,
          numSteps: parseInt(parts[2], 10) || 64,
          bpm: parseFloat(parts[3]) || projectHeader?.bpm || 80,
          linesPerBeat: parseInt(parts[4], 10) || projectHeader?.linesPerBeat || 4,
          name: parts[8]?.trim() || id,
          events: []
        };
        patterns[id] = curPattern;
      } else if (line.startsWith('EVENT,')) {
        if (curPattern) {
          const parts = [];
          let cur = '';
          let inQuotes = false;
          for (let i = 6; i < line.length; i++) {
            const c = line[i];
            if (c === '"') inQuotes = !inQuotes;
            else if (c === ',' && !inQuotes) { parts.push(cur); cur = ''; }
            else cur += c;
          }
          parts.push(cur);
          curPattern.events.push({
            step: parseInt(parts[0], 10) || 0,
            channel: parseInt(parts[1], 10) || 0,
            notes: (parts[2] || '').replace(/"/g, '').split(','),
            patch: (parts[3] || '').trim(),
            volume: parseInt(parts[4], 10) || 128,
            duration: parseInt(parts[5], 10) || 4,
            fx: (parts[6] || '').trim(),
            pan: (parts[7] || '').trim()
          });
        }
      }
    }

    return {
      header: projectHeader,
      patches,
      orderList,
      patterns,
      patternBuffers: new Map()
    };
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
  }

  getCurrentSuiteData() {
    return this.suiteCache.get(this.currentSuiteName);
  }

  getPatternDuration(suiteData, patternId) {
    const p = suiteData?.patterns[patternId];
    if (!p) return 12.0;
    const bpm = p.bpm || suiteData.header?.bpm || 80;
    const lpb = p.linesPerBeat || suiteData.header?.linesPerBeat || 4;
    const stepSec = (60.0 / bpm) / lpb;
    return p.numSteps * stepSec;
  }

  renderPatternToBuffer(suiteData, patternId) {
    if (suiteData.patternBuffers.has(patternId)) {
      return suiteData.patternBuffers.get(patternId);
    }
    const pattern = suiteData.patterns[patternId];
    if (!pattern) return null;

    const ctx = this.audio.ensureContext();
    if (!ctx) return null;

    const sampleRate = this.audio.sampleRate;
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
        const voice = this.audio.renderSingleVoice(patch, freq, durSec);
        for (let i = 0; i < voice.length; i++) {
          const dest = startSample + i;
          if (dest < totalSamples) {
            mixed[dest] += voice[i] * vol * 0.45;
          }
        }
      }
    }

    // Disable brick-wall limiter across patterns for smooth seamless loops
    const buf = ctx.createBuffer(1, totalSamples, sampleRate);
    buf.copyToChannel(mixed, 0);
    suiteData.patternBuffers.set(patternId, buf);
    return buf;
  }

  playSection(sectionName, { immediate = false, fadeSec = 1.0, lockMs = 0 } = {}) {
    const sections = this.suiteSections[this.currentSuiteName] || this.suiteSections.crypts;
    if (!sections[sectionName]) sectionName = 'explore';
    if (this.currentSection === sectionName && this.isPlaying && !immediate) return;

    if (lockMs > 0) {
      this.lock(lockMs);
    }

    if (immediate || !this.isPlaying) {
      this.currentSection = sectionName;
      this.sectionIndex = 0;
      this.pendingSection = null;
      this.transitionToActiveSection(fadeSec);
    } else {
      // Beat-quantized transition: queue next section to start on the next pattern boundary
      this.pendingSection = sectionName;
    }
  }

  transitionToActiveSection(fadeSec = 1.0) {
    const ctx = this.ensureVoiceGraph();
    if (!ctx) return;

    const suiteData = this.getCurrentSuiteData();
    if (!suiteData) return;

    clearTimeout(this.scheduleTimer);
    const now = ctx.currentTime;

    // Crossfade between Voice 0 and Voice 1
    const oldIdx = this.activeVoiceIdx;
    const newIdx = 1 - oldIdx;
    this.activeVoiceIdx = newIdx;

    const oldGain = this.voiceGains[oldIdx];
    const newGain = this.voiceGains[newIdx];
    const oldSrc = this.voiceSources[oldIdx];

    // Ramp down outgoing voice smoothly
    if (oldGain && oldSrc) {
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      try { oldSrc.stop(now + fadeSec + 0.05); } catch (_) {}
      this.voiceSources[oldIdx] = null;
    }

    // Pick first pattern of new section
    const sections = this.suiteSections[this.currentSuiteName] || this.suiteSections.crypts;
    const patternList = sections[this.currentSection] || sections.explore;
    const patternId = patternList[this.sectionIndex % patternList.length];
    const buffer = this.renderPatternToBuffer(suiteData, patternId);
    const patternDur = this.getPatternDuration(suiteData, patternId);

    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(newGain);

      // Ramp in incoming voice smoothly
      newGain.gain.setValueAtTime(0.0001, now);
      newGain.gain.linearRampToValueAtTime(1.0, now + fadeSec);

      src.start(now);
      this.voiceSources[newIdx] = src;
      this.nextScheduledTime = now + patternDur;
    } else {
      this.nextScheduledTime = now + 4.0;
    }

    this.isPlaying = true;
    this.sectionIndex++;

    const delayMs = Math.max(50, (this.nextScheduledTime - now - 0.3) * 1000);
    this.scheduleTimer = setTimeout(() => this.scheduleNext(), delayMs);
  }

  scheduleNext() {
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
    const buffer = this.renderPatternToBuffer(suiteData, patternId);
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
  }
}
