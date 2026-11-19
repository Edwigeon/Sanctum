import { ENGINE } from '../../shared/Constants.js';

function interpolateList(prevList, currList, alpha) {
  const prevMap = new Map((prevList || []).map(e => [e.id, e]));
  return (currList || []).map(curr => {
    const prev = prevMap.get(curr.id);
    if (!prev || Math.hypot(curr.x - prev.x, curr.y - prev.y) > 36) {
      return { ...curr, rx: curr.x, ry: curr.y };
    }
    return {
      ...curr,
      rx: prev.x + (curr.x - prev.x) * alpha,
      ry: prev.y + (curr.y - prev.y) * alpha
    };
  });
}

export class Interpolator {
  constructor() {
    this.snapshotBuffer = [];
    this.renderTick = null;
  }

  reset() {
    this.snapshotBuffer = [];
    this.renderTick = null;
  }

  pushSnapshot(snap) {
    this.snapshotBuffer.push(snap);
    if (this.snapshotBuffer.length > 6) this.snapshotBuffer.shift();
    if (this.renderTick === null && typeof snap.tick === 'number') {
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
        loot: latest.loot || []
      };
    }

    const targetTick = latest.tick - 1.25;
    if (this.renderTick === null || Math.abs(targetTick - this.renderTick) > 3.0) {
      this.renderTick = targetTick;
    } else {
      this.renderTick += dt * ENGINE.TICK_RATE;
      const drift = targetTick - this.renderTick;
      // Gentle drift correction when within buffer, firmer only if falling near buffer edges
      const gain = Math.abs(drift) > 0.5 ? 3.0 : 0.8;
      this.renderTick += drift * Math.min(1, dt * gain);
    }

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
    const alpha = Math.max(0, Math.min(1.15, (this.renderTick - snapA.tick) / span));

    return {
      players: interpolateList(snapA.players, snapB.players, alpha),
      monsters: interpolateList(snapA.monsters, snapB.monsters, alpha),
      projectiles: interpolateList(snapA.projectiles, snapB.projectiles, alpha),
      loot: snapB.loot || []
    };
  }
}
