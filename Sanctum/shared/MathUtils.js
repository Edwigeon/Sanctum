export class PRNG {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
  }

  next() {
    let t = (this.seed += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  nextFloat() {
    return (this.next() >>> 0) / 4294967296;
  }

  range(min, max) {
    const range = (max - min + 1) | 0;
    return (min + (this.next() % range)) | 0;
  }
}

export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
