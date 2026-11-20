/**
 * In-Game Performance OSD Monitor & Rolling Diagnostic Logger
 * Toggle with F3 (and F4 or header button for log drawer).
 */

export class PerfOSD {
  constructor({ maxLogs = 80 } = {}) {
    this.visible = false;
    this.showLogs = true;
    this.paused = false;
    this.maxLogs = maxLogs;
    this.logs = [];

    // Frame timing ring buffer (60 frames)
    this.historyLen = 60;
    this.frameHistory = new Float32Array(this.historyLen);
    this.rafHistory = new Float32Array(this.historyLen);
    this.historyIdx = 0;

    this._frameStart = 0;
    this._lastRafAt = 0;
    this._lastUpdateUi = 0;

    this.metrics = {
      fps: 0,
      frameMs: 0,
      avgFrameMs: 0,
      maxFrameMs: 0,
      interpMs: 0,
      lightMs: 0,
      drawMs: 0,
      netHz: 0,
      rttMs: null,
      jitterMs: 0,
      maxIatMs: 0,
      rxKBps: 0,
      txKBps: 0,
      lastSnapBytes: 0,
      avgSnapBytes: 0,
      latestTick: 0,
      renderTick: 0,
      bufLen: 0,
      pktSkipped: 0,
      pktOoo: 0,
      pktStale: 0,
      players: 0,
      monsters: 0,
      projectiles: 0,
      loot: 0,
      sfxBuffers: 0,
      sfxPcm: 0
    };

    // Network tracking
    this._snapCount = 0;
    this._snapBytesSum = 0;
    this._rxBytesSum = 0;
    this._txBytesSum = 0;
    this._iatWindowMax = 0;
    this._lastNetWindowAt = typeof performance !== 'undefined' ? performance.now() : 0;
    this._lastSnapAt = 0;
    this._lastSnapTick = null;
    this._lastUnderrunLogAt = 0;

    this.root = null;
    this.statsEl = null;
    this.logEl = null;
    this.canvas = null;
    this.ctx = null;

    if (typeof document !== 'undefined') {
      this._mountDOM();
      this._bindKeys();
    }
  }

  _mountDOM() {
    const root = document.createElement('div');
    root.id = 'perf-osd';
    root.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:9999',
      'width:310px',
      'background:rgba(9,13,22,0.88)',
      'border:1px solid rgba(56,189,248,0.35)',
      'border-radius:6px',
      'padding:8px',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
      'font-size:10px',
      'line-height:1.35',
      'color:#e2e8f0',
      'backdrop-filter:blur(4px)',
      'box-shadow:0 8px 24px rgba(0,0,0,0.55)',
      'pointer-events:auto',
      'display:none',
      'user-select:text'
    ].join(';');

    const btnStyle = 'all:unset;box-sizing:border-box;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:3px;padding:2px 5px;cursor:pointer;font-size:9px;line-height:1;font-family:inherit;white-space:nowrap;';
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;border-bottom:1px solid rgba(148,163,184,0.2);padding-bottom:4px;">
        <span style="font-weight:700;color:#38bdf8;letter-spacing:0.03em;white-space:nowrap;">PERF OSD <span style="color:#64748b;font-weight:400;">[F3]</span></span>
        <div style="display:flex;gap:3px;flex-shrink:0;">
          <button id="osd-btn-logs" style="${btnStyle}">Logs</button>
          <button id="osd-btn-copy" style="${btnStyle}">Copy</button>
          <button id="osd-btn-clear" style="${btnStyle}">Clear</button>
          <button id="osd-btn-close" style="${btnStyle}color:#f87171;">×</button>
        </div>
      </div>
      <canvas id="osd-spark" width="294" height="32" style="display:block;width:100%;height:32px;background:#020617;border-radius:3px;margin-bottom:6px;"></canvas>
      <div id="osd-stats" style="white-space:pre;color:#cbd5e1;"></div>
      <div id="osd-log-wrap" style="margin-top:6px;border-top:1px solid rgba(148,163,184,0.2);padding-top:4px;">
        <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:9px;margin-bottom:3px;">
          <span>EVENT / SPIKE LOG</span>
          <span id="osd-log-count">0</span>
        </div>
        <div id="osd-logs" style="max-height:130px;overflow-y:auto;font-size:9px;line-height:1.3;color:#cbd5e1;"></div>
      </div>
    `;

    document.body.appendChild(root);
    this.root = root;
    this.statsEl = root.querySelector('#osd-stats');
    this.logEl = root.querySelector('#osd-logs');
    this.logWrapEl = root.querySelector('#osd-log-wrap');
    this.logCountEl = root.querySelector('#osd-log-count');
    this.canvas = root.querySelector('#osd-spark');
    this.ctx = this.canvas?.getContext('2d') || null;

    root.querySelector('#osd-btn-close')?.addEventListener('click', () => this.toggle(false));
    root.querySelector('#osd-btn-clear')?.addEventListener('click', () => {
      this.logs.length = 0;
      this._renderLogs();
    });
    root.querySelector('#osd-btn-logs')?.addEventListener('click', () => {
      this.showLogs = !this.showLogs;
      if (this.logWrapEl) this.logWrapEl.style.display = this.showLogs ? 'block' : 'none';
    });
    root.querySelector('#osd-btn-copy')?.addEventListener('click', () => {
      const text = this.dump();
      navigator.clipboard?.writeText(text).catch(() => {});
      this.log('OSD', 'Copied diagnostics to clipboard');
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force) {
    this.visible = typeof force === 'boolean' ? force : !this.visible;
    if (this.root) {
      this.root.style.display = this.visible ? 'block' : 'none';
    }
    if (this.visible) {
      this._renderUI(performance.now());
      this._renderLogs();
    }
    return this.visible;
  }

  log(tag, message, level = 'info') {
    const ts = new Date().toISOString().slice(11, 23);
    this.logs.unshift({ ts, tag, message, level });
    if (this.logs.length > this.maxLogs) this.logs.length = this.maxLogs;
    if (this.visible && this.showLogs) {
      this._renderLogs();
    }
  }

  recordRxBytes(bytes) {
    this._rxBytesSum += bytes || 0;
  }

  recordTxBytes(bytes) {
    this._txBytesSum += bytes || 0;
  }

  recordPong(sentAt) {
    if (typeof sentAt !== 'number') return;
    const rtt = Math.max(0, performance.now() - sentAt);
    this.metrics.rttMs = this.metrics.rttMs === null ? rtt : (this.metrics.rttMs * 0.7 + rtt * 0.3);
  }

  recordSnapshot(snap, byteLen = 0) {
    const now = performance.now();
    this._snapCount++;
    this._snapBytesSum += byteLen;
    this.metrics.lastSnapBytes = byteLen;
    this.metrics.latestTick = snap?.tick ?? 0;

    if (this._lastSnapAt > 0) {
      const gap = now - this._lastSnapAt;
      if (gap > this._iatWindowMax) this._iatWindowMax = gap;
      const dev = Math.abs(gap - 66.67);
      this.metrics.jitterMs = this.metrics.jitterMs * 0.8 + dev * 0.2;
      if (gap > 220) {
        this.log('NET_GAP', `Snapshot gap ${gap.toFixed(1)}ms (tick ${snap?.tick})`, 'warn');
      }
    }
    if (this._lastSnapTick !== null && typeof snap?.tick === 'number') {
      const dtTick = snap.tick - this._lastSnapTick;
      if (dtTick > 1) {
        this.log('TICK_JUMP', `Skipped ${dtTick - 1} tick(s) -> ${snap.tick}`, 'warn');
      }
    }
    this._lastSnapAt = now;
    if (typeof snap?.tick === 'number') this._lastSnapTick = snap.tick;

    const winMs = now - this._lastNetWindowAt;
    if (winMs >= 1000) {
      const winSec = winMs / 1000;
      this.metrics.netHz = this._snapCount / winSec;
      this.metrics.avgSnapBytes = this._snapCount > 0 ? this._snapBytesSum / this._snapCount : 0;
      this.metrics.rxKBps = this._rxBytesSum / 1024 / winSec;
      this.metrics.txKBps = this._txBytesSum / 1024 / winSec;
      this.metrics.maxIatMs = this._iatWindowMax;
      this._snapCount = 0;
      this._snapBytesSum = 0;
      this._rxBytesSum = 0;
      this._txBytesSum = 0;
      this._iatWindowMax = 0;
      this._lastNetWindowAt = now;
    }
  }

  beginFrame() {
    const now = performance.now();
    if (this._lastRafAt > 0) {
      this.rafHistory[this.historyIdx] = now - this._lastRafAt;
    }
    this._lastRafAt = now;
    this._frameStart = now;
  }

  endFrame({ interpMs = 0, lightMs = 0, drawMs = 0, interpolator = null, interp = null, audio = null } = {}) {
    const now = performance.now();
    const frameMs = now - this._frameStart;

    this.frameHistory[this.historyIdx] = frameMs;
    this.historyIdx = (this.historyIdx + 1) % this.historyLen;

    this.metrics.frameMs = frameMs;
    this.metrics.interpMs = interpMs;
    this.metrics.lightMs = lightMs;
    this.metrics.drawMs = drawMs;

    if (interpolator) {
      this.metrics.renderTick = interpolator.renderTick ?? 0;
      this.metrics.bufLen = interpolator.snapshotBuffer?.length ?? 0;
      if (interpolator.stats) {
        this.metrics.pktSkipped = interpolator.stats.skipped;
        this.metrics.pktOoo = interpolator.stats.ooo;
        this.metrics.pktStale = interpolator.stats.stale;
      }
      if (interpolator.underrun && now - this._lastUnderrunLogAt > 1000) {
        this._lastUnderrunLogAt = now;
        const lag = (this.metrics.latestTick - this.metrics.renderTick).toFixed(2);
        this.log('NET_UNDERRUN', `Interpolation buffer underrun (lag ${lag}t)`, 'warn');
      }
    }
    if (interp) {
      this.metrics.players = interp.players?.length ?? 0;
      this.metrics.monsters = interp.monsters?.length ?? 0;
      this.metrics.projectiles = interp.projectiles?.length ?? 0;
      this.metrics.loot = interp.loot?.length ?? 0;
    }
    if (audio) {
      this.metrics.sfxBuffers = audio.bufferCache?.size ?? 0;
      this.metrics.sfxPcm = audio.pcmCache?.size ?? 0;
    }

    if (frameMs > 25) {
      this.log(
        'SPIKE',
        `${frameMs.toFixed(1)}ms (draw:${drawMs.toFixed(1)} light:${lightMs.toFixed(1)} interp:${interpMs.toFixed(1)})`,
        frameMs > 40 ? 'err' : 'warn'
      );
    }

    if (!this.visible) return;
    if (now - this._lastUpdateUi >= 120) {
      this._lastUpdateUi = now;
      this._renderUI(now);
    }
  }

  _renderUI() {
    let sum = 0;
    let max = 0;
    let count = 0;
    let rafSum = 0;
    let rafCount = 0;
    for (let i = 0; i < this.historyLen; i++) {
      const v = this.frameHistory[i];
      if (v > 0) {
        sum += v;
        if (v > max) max = v;
        count++;
      }
      const rv = this.rafHistory[i];
      if (rv > 0) {
        rafSum += rv;
        rafCount++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    const avgRaf = rafCount > 0 ? rafSum / rafCount : 0;
    this.metrics.avgFrameMs = avg;
    this.metrics.maxFrameMs = max;
    this.metrics.fps = avgRaf > 0 ? 1000 / avgRaf : 0;

    if (this.ctx && this.canvas) {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const ctx = this.ctx;
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);

      // 16.6ms (60fps) reference line
      const refY = h - Math.min(h - 2, (16.67 / 40) * h);
      ctx.strokeStyle = 'rgba(56,189,248,0.28)';
      ctx.beginPath();
      ctx.moveTo(0, refY);
      ctx.lineTo(w, refY);
      ctx.stroke();

      const barW = w / this.historyLen;
      for (let i = 0; i < this.historyLen; i++) {
        const idx = (this.historyIdx + i) % this.historyLen;
        const v = this.frameHistory[idx];
        if (v <= 0) continue;
        const bh = Math.max(1, Math.min(h, (v / 40) * h));
        ctx.fillStyle = v > 33.3 ? '#f87171' : (v > 16.7 ? '#facc15' : '#34d399');
        ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 1), bh);
      }
    }

    if (this.statsEl) {
      const m = this.metrics;
      const mem = performance?.memory
        ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)}/${(performance.memory.totalJSHeapSize / 1048576).toFixed(0)}MB`
        : 'n/a';
      const lag = (m.latestTick - m.renderTick).toFixed(2);
      const pingStr = m.rttMs === null ? '--' : `${m.rttMs.toFixed(0)}ms`;
      this.statsEl.textContent =
        `FPS: ${m.fps.toFixed(0).padStart(3)} | Frame: ${m.avgFrameMs.toFixed(1)}ms (max ${m.maxFrameMs.toFixed(1)})\n` +
        `Draw: ${m.drawMs.toFixed(1)}ms | Light: ${m.lightMs.toFixed(1)}ms | Interp: ${m.interpMs.toFixed(2)}ms\n` +
        `Net: ${m.netHz.toFixed(1)}Hz | Ping: ${pingStr} | Jit: ${m.jitterMs.toFixed(1)}ms (max ${m.maxIatMs.toFixed(0)})\n` +
        `BW: ↓${m.rxKBps.toFixed(1)} ↑${m.txKBps.toFixed(1)}KB/s | Snap: ${(m.lastSnapBytes / 1024).toFixed(1)}KB (avg ${(m.avgSnapBytes / 1024).toFixed(1)})\n` +
        `Tick: ${m.latestTick} (lag ${lag}t, buf ${m.bufLen}/6) | Pkt: s${m.pktSkipped}/o${m.pktOoo}/d${m.pktStale}\n` +
        `Ent: P:${m.players} M:${m.monsters} Proj:${m.projectiles} Loot:${m.loot}\n` +
        `Mem: ${mem} | SFX: ${m.sfxBuffers}buf/${m.sfxPcm}pcm`;
    }
  }

  _renderLogs() {
    if (!this.logEl) return;
    if (this.logCountEl) this.logCountEl.textContent = String(this.logs.length);
    this.logEl.innerHTML = this.logs
      .map((l) => {
        const col = l.level === 'err' ? '#f87171' : (l.level === 'warn' ? '#facc15' : '#94a3b8');
        return `<div style="border-bottom:1px solid rgba(30,41,59,0.7);padding:1px 0;"><span style="color:#64748b;">${l.ts}</span> <span style="color:${col};font-weight:700;">[${l.tag}]</span> ${l.message}</div>`;
      })
      .join('');
  }

  dump() {
    const header = this.statsEl ? this.statsEl.textContent : JSON.stringify(this.metrics);
    const lines = this.logs.map((l) => `${l.ts} [${l.tag}] ${l.message}`);
    return `=== SANCTUM PERF OSD ===\n${header}\n\n=== LOGS ===\n${lines.join('\n')}`;
  }
}
