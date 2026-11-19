import fs from 'fs';
import path from 'path';

function parseCSV(text) {
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
      try { patches[name] = JSON.parse(jsonStr); } catch (_) {}
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

  return { header: projectHeader, patches, orderList, patterns };
}

const bundle = {};
const suites = ['cathedral', 'town', 'wilderness', 'crypts', 'caverns', 'boss'];
const musicDir = path.resolve('data/music');

for (const s of suites) {
  const filePath = path.join(musicDir, `sanctum_${s}.csv`);
  if (fs.existsSync(filePath)) {
    bundle[s] = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  }
}

const outPath = path.join(musicDir, 'soundtrack.json');
fs.writeFileSync(outPath, JSON.stringify(bundle));
console.log(`[Pack] Pre-compiled soundtrack bundle -> ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
