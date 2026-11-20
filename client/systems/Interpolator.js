import { ENGINE } from '../../shared/Constants.js';

function interpolateList(prevList, currList, alpha, prevMap, outList) {
  prevMap.clear();
  if (prevList) {
    for (let i = 0; i < prevList.length; i++) {
      prevMap.set(prevList[i].id, prevList[i]);
    }
  }

  outList.length = 0;
  if (!currList) return outList;

  const maxSnapDistSq = 36 * 36;
  for (let i = 0; i < currList.length; i++) {
    const curr = currList[i];
    const prev = prevMap.get(curr.id);

    if (!prev) {
      // Back-extrapolate newly spawned projectiles using server velocity so they don't freeze for 1 tick
      if (typeof curr.vx === 'number' && typeof curr.vy === 'number') {
        const px = curr.x - curr.vx;
        const py = curr.y - curr.vy;
        outList.push({
          ...curr,
          rx: px + curr.vx * alpha,
          ry: py + curr.vy * alpha
        });
      } else {
        outList.push({ ...curr, rx: curr.x, ry: curr.y });
      }
      continue;
    }

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    if (dx * dx + dy * dy > maxSnapDistSq) {
      outList.push({ ...curr, rx: curr.x, ry: curr.y });
    } else {
      outList.push({
        ...curr,
        rx: prev.x + dx * alpha,
        ry: prev.y + dy * alpha
      });
    }
  }
  return outList;
}

export class Interpolator {
  constructor() {
    this.snapshotBuffer = [];
    this.renderTick = null;
    this.jitterMs = 0;
    this.delayTicks = 1.35;
    this.underrun = false;
    this._lastPushAt = 0;
    this._prevMap = new Map();
    this._outPlayers = [];
    this._outMonsters = [];
    this._outProjectiles = [];
    this._lastLoot = [];
    this.stats = { skipped: 0, ooo: 0, stale: 0, dup: 0 };
  }

  reset() {
    this.snapshotBuffer = [];
    this.renderTick = null;
    this.jitterMs = 0;
    this.delayTicks = 1.35;
    this.underrun = false;
    this._lastPushAt = 0;
    this._lastLoot = [];
    this.stats.skipped = 0;
    this.stats.ooo = 0;
    this.stats.stale = 0;
    this.stats.dup = 0;
  }

  pushSnapshot(snap) {
    if (!snap || typeof snap.tick !== 'number') return;
    if (Array.isArray(snap.loot)) {
      this._lastLoot = snap.loot;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const buf = this.snapshotBuffer;
    const len = buf.length;

    // Fast path: incoming tick is strictly greater than latest
    if (len === 0 || snap.tick > buf[len - 1].tick) {
      if (len > 0) {
        const gap = snap.tick - buf[len - 1].tick;
        if (gap > 1) this.stats.skipped += gap - 1;
        if (this._lastPushAt > 0) {
          const iat = now - this._lastPushAt;
          const dev = Math.abs(iat - ENGINE.TICK_INTERVAL_MS);
          this.jitterMs = this.jitterMs * 0.85 + dev * 0.15;
        }
      }
      this._lastPushAt = now;
      buf.push(snap);
      if (buf.length > 6) buf.shift();
    } else {
      // Discard stale packets older than the oldest tracked in buffer
      if (snap.tick < buf[0].tick) {
        this.stats.stale++;
        return;
      }

      // Discard duplicate ticks
      for (let i = 0; i < len; i++) {
        if (buf[i].tick === snap.tick) {
          this.stats.dup++;
          return;
        }
      }

      // Out-of-order arrival: insert in sorted ascending order
      this.stats.ooo++;
      let insertIdx = 0;
      while (insertIdx < len && buf[insertIdx].tick < snap.tick) {
        insertIdx++;
      }
      buf.splice(insertIdx, 0, snap);
      while (buf.length > 6) buf.shift();
    }

    if (this.renderTick === null) {
      this.renderTick = snap.tick;
    }
  }

  getInterpolatedEntities(dt) {
    if (this.snapshotBuffer.length === 0) {
      return { players: [], monsters: [], projectiles: [], loot: [] };
    }

    const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    if (this.snapshotBuffer.length === 1 || typeof latest.tick !== 'number') {
      return {
        players: latest.players.map(p => ({ ...p, rx: p.x, ry: p.y })),
        monsters: latest.monsters.map(m => ({ ...m, rx: m.x, ry: m.y })),
        projectiles: (latest.projectiles || []).map(pr => ({ ...pr, rx: pr.x, ry: pr.y })),
        loot: Array.isArray(latest.loot) ? latest.loot : this._lastLoot
      };
    }

    const targetDelayTicks = Math.max(1.35, Math.min(3.0, 1.35 + (this.jitterMs * 1.5) / ENGINE.TICK_INTERVAL_MS));
    this.delayTicks += (targetDelayTicks - this.delayTicks) * Math.min(1, dt * 2.5);
    const targetTick = latest.tick - this.delayTicks;
    if (this.renderTick === null || Math.abs(targetTick - this.renderTick) > 3.5) {
      this.renderTick = targetTick;
    } else {
      this.renderTick += dt * ENGINE.TICK_RATE;
      const drift = targetTick - this.renderTick;
      // Gentle drift correction when within buffer, firmer only if falling near buffer edges
      const gain = Math.abs(drift) > 0.5 ? 3.0 : 0.8;
      this.renderTick += drift * Math.min(1, dt * gain);
    }
    this.underrun = this.renderTick > latest.tick;

    let snapA = this.snapshotBuffer[0];
    let snapB = latest;
    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (this.snapshotBuffer[i].tick <= this.renderTick && this.snapshotBuffer[i + 1].tick >= this.renderTick) {
        snapA = this.snapshotBuffer[i];
        snapB = this.snapshotBuffer[i + 1];
        break;
      }
    }

    if (this.renderTick >= latest.tick) {
      snapA = this.snapshotBuffer[this.snapshotBuffer.length - 2];
      snapB = latest;
    }

    const span = Math.max(1, snapB.tick - snapA.tick);
    const alpha = Math.max(0, Math.min(1.5, (this.renderTick - snapA.tick) / span));

    return {
      players: interpolateList(snapA.players, snapB.players, alpha, this._prevMap, this._outPlayers),
      monsters: interpolateList(snapA.monsters, snapB.monsters, alpha, this._prevMap, this._outMonsters),
      projectiles: interpolateList(snapA.projectiles, snapB.projectiles, alpha, this._prevMap, this._outProjectiles),
      loot: Array.isArray(snapB.loot) ? snapB.loot : this._lastLoot
    };
  }
}
