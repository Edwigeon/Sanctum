/**
 * Data-Driven 16-Color Micro-Sprite Registry (/data/sprites.json)
 * Decodes compact hex-grid rows ('0'-'f' -> 0..15, '.' -> 255 transparent) into fast Uint8Array frames,
 * supporting both single-strip (`frames`) and multi-state (`states: { idle, move, attack, ... }`) sprites.
 */
export class SpriteRegistry {
  constructor() {
    this.bank = { tiles: {}, entities: {}, objects: {}, items: {} };
    this.loaded = false;
  }

  decodeFrame(rows, w, h) {
    const out = new Uint8Array(w * h);
    out.fill(255); // 255 = transparent
    if (!Array.isArray(rows)) return out;
    for (let y = 0; y < h && y < rows.length; y++) {
      const row = rows[y];
      if (typeof row !== 'string') continue;
      const rowOff = y * w;
      for (let x = 0; x < w && x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const idx = parseInt(ch, 16);
        if (!Number.isNaN(idx) && idx >= 0 && idx < 16) {
          out[rowOff + x] = idx;
        }
      }
    }
    return out;
  }

  async load(url = '/data/sprites.json') {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const raw = await res.json();
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        this.bank[cat] = {};
        const group = raw[cat] || {};
        for (const [id, def] of Object.entries(group)) {
          const w = def.w || 12;
          const h = def.h || 12;
          const defaultFps = def.fps || 4;
          const states = {};

          if (def.states && typeof def.states === 'object') {
            for (const [stName, stDef] of Object.entries(def.states)) {
              const rawFrames = Array.isArray(stDef?.frames) ? stDef.frames : (Array.isArray(stDef) ? stDef : []);
              if (rawFrames.length === 0) continue;
              states[stName] = {
                fps: stDef?.fps || defaultFps,
                pingPong: !!stDef?.pingPong,
                frames: rawFrames.map(f => this.decodeFrame(f, w, h))
              };
            }
          }

          // Backward-compatible fallback: legacy `def.frames`, `def.variants`, or `def.rows` maps to `states.idle`
          if (!states.idle) {
            const rawFrames = Array.isArray(def.variants) && def.variants.length > 0
              ? def.variants
              : (Array.isArray(def.frames) && def.frames.length > 0
                ? def.frames
                : (Array.isArray(def.rows) ? [def.rows] : []));
            if (rawFrames.length > 0) {
              states.idle = {
                fps: defaultFps,
                pingPong: !!def.pingPong,
                frames: rawFrames.map(f => this.decodeFrame(f, w, h))
              };
            }
          }

          const firstState = states.idle || Object.values(states)[0] || { fps: defaultFps, pingPong: false, frames: [] };
          const sprite = {
            id,
            w,
            h,
            isTile: cat === 'tiles' || !!def.variants,
            fps: firstState.fps,
            allowRotate: def.allowRotate === true,
            allowFlip: def.allowFlip === true,
            renderScale: def.renderScale ?? (def.targetW ? def.targetW / w : ((w >= 32 || h >= 32) ? 0.5 : 1)),
            targetW: def.targetW,
            targetH: def.targetH,
            anchorX: def.anchorX ?? Math.floor(w / 2),
            anchorY: def.anchorY ?? Math.floor(h * 0.75),
            states,
            frames: firstState.frames,
            variants: firstState.frames,
            getState(stateName = 'idle') {
              return this.states[stateName] || this.states.idle || firstState;
            }
          };
          this.bank[cat][id] = sprite;
        }
      }
      this.loaded = true;
      return true;
    } catch (err) {
      console.warn('[SpriteRegistry] Failed to load sprites.json:', err.message);
      return false;
    }
  }

  get(category, id) {
    if (!id) return null;
    const catGroup = this.bank[category];
    if (!catGroup) return null;
    // Direct match (e.g. 'crypt/floor_stone' or 'common/hero_vanguard')
    if (catGroup[id]) return catGroup[id];
    // Suffix match (e.g. requesting 'floor_stone' finds 'crypt/floor_stone' or 'common/floor_stone')
    for (const key of Object.keys(catGroup)) {
      if (key.endsWith(`/${id}`)) {
        return catGroup[key];
      }
    }
    return null;
  }
}
