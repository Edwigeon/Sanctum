import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['client', 'shared', 'config', 'data'];
const IGNORE_EXTS = new Set(['.csv', '.md', '.sqlite', '.db', '.sqlite-wal', '.sqlite-shm']);

function calcEntropy(buf) {
  if (!buf.length) return 0;
  const freq = new Uint32Array(256);
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function analyzeFile(fullPath) {
  const rel = path.relative(ROOT, fullPath);
  const buf = fs.readFileSync(fullPath);
  const raw = buf.length;
  if (raw === 0) return null;

  const br = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

  let zeroBytes = 0;
  let longestZeroRun = 0;
  let currentRun = 0;

  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x00) {
      zeroBytes++;
      currentRun++;
      if (currentRun > longestZeroRun) longestZeroRun = currentRun;
    } else {
      currentRun = 0;
    }
  }

  const entropy = calcEntropy(buf);
  const zeroPct = (zeroBytes / raw) * 100;
  const ratio = (1 - br / raw) * 100;

  let diagnosis = 'Balanced';
  if (entropy < 3.5 && raw > 2048) diagnosis = 'Sparse / RLE-ready';
  else if (zeroPct > 35) diagnosis = 'Heavy 0x00 padding';
  else if (entropy > 7.4) diagnosis = 'Dense / Pre-packed';
  else if (ratio > 75) diagnosis = 'High text/JSON redundancy';

  return { rel, raw, br, ratio, entropy, zeroPct, longestZeroRun, diagnosis };
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORE_EXTS.has(ext)) {
        const res = analyzeFile(full);
        if (res) results.push(res);
      }
    }
  }
  return results;
}

const files = TARGET_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .sort((a, b) => b.raw - a.raw);

console.log('\nFile                                  | Raw      | Brotli   | Saved  | Entropy | 0x00 % | MaxZeroRun | Diagnosis');
console.log('--------------------------------------|----------|----------|--------|---------|--------|------------|--------------------------');

for (const f of files.slice(0, 20)) {
  console.log(
    `${f.rel.slice(0, 37).padEnd(37)} | ` +
    `${(f.raw / 1024).toFixed(1).padStart(5)} KB | ` +
    `${(f.br / 1024).toFixed(1).padStart(5)} KB | ` +
    `${f.ratio.toFixed(0).padStart(5)}% | ` +
    `${f.entropy.toFixed(2).padStart(5)}/8 | ` +
    `${f.zeroPct.toFixed(1).padStart(5)}% | ` +
    `${String(f.longestZeroRun).padStart(8)} B | ` +
    `${f.diagnosis}`
  );
}
console.log('');
EOF
