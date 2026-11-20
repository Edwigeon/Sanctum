/**
 * Lanthorn-PSG v1.1 Tracker Suite Definitions, CSV Parser & Multi-Tier Loader
 */

export const TRACK_SUITES = {
  town: '/data/music/sanctum_town.csv',
  wilderness: '/data/music/sanctum_wilderness.csv',
  crypts: '/data/music/sanctum_crypts.csv',
  caverns: '/data/music/sanctum_caverns.csv',
  cathedral: '/data/music/sanctum_cathedral.csv',
  boss: '/data/music/sanctum_boss.csv'
};

export const SUITE_SECTIONS = {
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

export function parseTrackerCSV(text) {
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

export async function loadTrackerSuite(player, suiteName) {
  if (player.suiteCache.has(suiteName)) {
    return player.suiteCache.get(suiteName);
  }

  // 1. Fast path: Check IndexedDB database for pre-compiled suite
  if (player.db) {
    try {
      const cached = await player.db.getSuite(suiteName);
      if (cached && cached.patterns && cached.patches) {
        if (!cached.patternBuffers) cached.patternBuffers = new Map();
        player.suiteCache.set(suiteName, cached);
        return cached;
      }
    } catch (_) {}
  }

  // 2. Pre-packed soundtrack JSON bundle (/data/music/soundtrack.json)
  if (!player.soundtrackBundlePromise) {
    player.soundtrackBundlePromise = fetch('/data/music/soundtrack.json')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  const bundle = await player.soundtrackBundlePromise;
  if (bundle && bundle[suiteName]) {
    const suiteData = bundle[suiteName];
    suiteData.patternBuffers = new Map();
    player.suiteCache.set(suiteName, suiteData);
    if (player.db) player.db.saveSuite(suiteName, suiteData).catch(() => {});
    return suiteData;
  }

  // 3. Fallback: individual CSV fetch & parse
  const url = TRACK_SUITES[suiteName];
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    const suiteData = player.parseCSV(text);
    player.suiteCache.set(suiteName, suiteData);
    if (player.db) player.db.saveSuite(suiteName, suiteData).catch(() => {});
    return suiteData;
  } catch (err) {
    console.warn(`[MusicPlayer] Failed to load suite '${suiteName}':`, err.message);
    return null;
  }
}
