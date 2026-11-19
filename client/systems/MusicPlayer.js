/**
 * MusicPlayer.js - Interactive Tracker Music Engine for Project: Sanctum
 * Parses Lanthorn-PSG v1.1 modular .csv tracker projects, renders pattern buffers without
 * brick-wall normalizer ducking, and schedules seamless beat-quantized transitions between
 * game-state sections (explore, combat, boss, descent).
 */

import { noteToMidi, midiToFreq } from './AudioPSG.js';

export class MusicPlayer {
  constructor({ audio }) {
    this.audio = audio;
    this.ctx = null;

    this.projectHeader = null;
    this.patches = {};
    this.orderList = [];
    this.patterns = {}; // id -> pattern
    this.patternBuffers = new Map(); // patternId -> AudioBuffer

    // Modular section definitions (event-driven playlists)
    this.sections = {
      explore: ['A', 'B', 'C', 'H'],
      combat: ['F', 'G'],
      boss: ['E', 'F'],
      descent: ['D'],
      resolution: ['I']
    };

    this.currentSection = null;
    this.sectionIndex = 0;
    this.isPlaying = false;
    this.activeSource = null;
    this.nextScheduledTime = 0;
    this.pendingSection = null;
    this.scheduleTimer = null;
  }

  async loadProject(url = '/data/music/sanctum_cathedral.csv') {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const text = await res.text();
      return this.parseCSV(text);
    } catch (err) {
      console.warn('[MusicPlayer] Failed to load project:', err.message);
      return false;
    }
  }

  parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    this.patches = {};
    this.orderList = [];
    this.patterns = {};
    let curPattern = null;

    for (const line of lines) {
      if (line.startsWith('LANTHORN_V1.1')) {
        const parts = line.split(',');
        this.projectHeader = {
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
          this.patches[name] = JSON.parse(jsonStr);
        } catch (_) {}
      } else if (line.startsWith('SEQ,')) {
        const parts = line.split(',');
        if (parts[2]) this.orderList.push(parts[2].trim());
      } else if (line.startsWith('PATTERN,')) {
        const parts = line.split(',');
        const id = parts[1].trim();
        curPattern = {
          id,
          numSteps: parseInt(parts[2], 10) || 64,
          bpm: parseFloat(parts[3]) || this.projectHeader?.bpm || 80,
          linesPerBeat: parseInt(parts[4], 10) || this.projectHeader?.linesPerBeat || 4,
          name: parts[8]?.trim() || id,
          events: []
        };
        this.patterns[id] = curPattern;
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

    return true;
  }

  getPatternDuration(patternId) {
    const p = this.patterns[patternId];
    if (!p) return 12.0;
    const bpm = p.bpm || this.projectHeader?.bpm || 80;
    const lpb = p.linesPerBeat || this.projectHeader?.linesPerBeat || 4;
    const stepSec = (60.0 / bpm) / lpb;
    return p.numSteps * stepSec;
  }

  renderPatternToBuffer(patternId) {
    if (this.patternBuffers.has(patternId)) {
      return this.patternBuffers.get(patternId);
    }
    const pattern = this.patterns[patternId];
    if (!pattern) return null;

    const ctx = this.audio.ensureContext();
    if (!ctx) return null;

    const sampleRate = this.audio.sampleRate;
    const bpm = pattern.bpm || this.projectHeader?.bpm || 80;
    const lpb = pattern.linesPerBeat || this.projectHeader?.linesPerBeat || 4;
    const stepSec = (60.0 / bpm) / lpb;
    const numSteps = pattern.numSteps || 64;

    const baseSamples = Math.floor(numSteps * stepSec * sampleRate);
    const tailSamples = Math.floor(1.2 * sampleRate);
    const totalSamples = baseSamples + tailSamples;
    const mixed = new Float32Array(totalSamples);

    for (const ev of pattern.events) {
      const patch = this.patches[ev.patch];
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
    this.patternBuffers.set(patternId, buf);
    return buf;
  }

  playSection(sectionName, { immediate = false } = {}) {
    if (!this.sections[sectionName]) sectionName = 'explore';
    if (this.currentSection === sectionName && this.isPlaying && !immediate) return;

    if (immediate || !this.isPlaying) {
      this.stop();
      this.currentSection = sectionName;
      this.sectionIndex = 0;
      this.pendingSection = null;
      this.startPlaybackLoop();
    } else {
      // Beat-quantized transition: queue next section to start on the next pattern seam
      this.pendingSection = sectionName;
    }
  }

  startPlaybackLoop() {
    const ctx = this.audio.ensureContext();
    if (!ctx) return;
    this.isPlaying = true;
    this.nextScheduledTime = ctx.currentTime + 0.05;
    this.scheduleNext();
  }

  scheduleNext() {
    if (!this.isPlaying) return;
    const ctx = this.audio.ensureContext();
    if (!ctx) return;

    if (this.pendingSection) {
      this.currentSection = this.pendingSection;
      this.sectionIndex = 0;
      this.pendingSection = null;
    }

    const patternList = this.sections[this.currentSection] || this.sections.explore;
    const patternId = patternList[this.sectionIndex % patternList.length];
    const buffer = this.renderPatternToBuffer(patternId);
    const patternDur = this.getPatternDuration(patternId);

    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.audio.musicGain);

      const startTime = Math.max(ctx.currentTime, this.nextScheduledTime);
      src.start(startTime);
      this.activeSource = src;
      this.nextScheduledTime = startTime + patternDur;
    } else {
      this.nextScheduledTime = ctx.currentTime + 2.0;
    }

    this.sectionIndex++;

    // Schedule next pattern handoff slightly before current pattern ends
    const delayMs = Math.max(50, (this.nextScheduledTime - ctx.currentTime - 0.25) * 1000);
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = setTimeout(() => this.scheduleNext(), delayMs);
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this.scheduleTimer);
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (_) {}
      this.activeSource = null;
    }
  }

  clearCache() {
    this.patternBuffers.clear();
  }
}
