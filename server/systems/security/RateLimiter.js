/**
 * Fixed-window rate limiter with bounded memory.
 * Keys are swept periodically; if the key table is saturated (e.g. an address-spraying
 * attack), new keys are refused (fail closed) instead of growing memory without bound.
 */
const registry = new Set();

export class RateLimiter {
  constructor({ limit, windowMs, maxKeys = 100000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
    registry.add(this);
  }

  hit(key, cost = 1) {
    const now = Date.now();
    let e = this.entries.get(key);
    if (!e || now - e.start >= this.windowMs) {
      if (!e && this.entries.size >= this.maxKeys) {
        this.sweep(now);
        if (this.entries.size >= this.maxKeys) {
          return { allowed: false, retryAfterMs: this.windowMs };
        }
      }
      e = { start: now, count: 0 };
      this.entries.set(key, e);
    }
    e.count += cost;
    const allowed = e.count <= this.limit;
    return { allowed, retryAfterMs: allowed ? 0 : Math.max(0, e.start + this.windowMs - now) };
  }

  reset(key) {
    this.entries.delete(key);
  }

  sweep(now = Date.now()) {
    for (const [k, e] of this.entries) {
      if (now - e.start >= this.windowMs) this.entries.delete(k);
    }
  }

  clear() {
    this.entries.clear();
  }
}

setInterval(() => {
  for (const l of registry) l.sweep();
}, 60000).unref();
