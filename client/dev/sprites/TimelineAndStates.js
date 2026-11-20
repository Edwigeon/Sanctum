/**
 * Animation State Manager, Frame Timeline Strip & Live Preview Controls
 */

import { ANIM_STATES } from './PaletteAndDigitizer.js';

export function selectOrCreateState(studio, stateName) {
  const sp = studio.getActiveSprite();
  if (!sp) return;
  if (!sp.states) {
    sp.states = {
      idle: {
        fps: sp.fps || 4,
        pingPong: !!sp.pingPong,
        frames: sp.frames || [Array.from({ length: sp.h }, () => '.'.repeat(sp.w))]
      }
    };
    delete sp.frames;
    delete sp.fps;
    delete sp.pingPong;
  }
  if (!sp.states[stateName]) {
    const seedFrame = sp.states.idle?.frames?.[0] || Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
    const defaultFps = stateName === 'attack' || stateName === 'cast' ? 10 : (stateName === 'move' ? 8 : 4);
    sp.states[stateName] = { fps: defaultFps, frames: [[...seedFrame]] };
  }
  studio.activeState = stateName;
  studio.activeFrameIdx = 0;
  studio.animDir = 1;
  studio.undoStack = [];
  studio.syncStateTimingUI();
  studio.renderBankList();
  studio.refreshAll();
}

export function syncStateTimingUI(studio) {
  const st = studio.getActiveStateObj();
  studio.animFps = st?.fps || 4;
  studio.animPingPong = !!st?.pingPong;
  const fpsEl = document.getElementById('anim-fps');
  if (fpsEl) {
    fpsEl.value = studio.animFps;
    document.getElementById('lbl-anim-fps').textContent = `${studio.animFps} FPS`;
  }
  const ppEl = document.getElementById('anim-pingpong');
  if (ppEl) ppEl.checked = studio.animPingPong;
  if (studio.animPlaying) studio.restartAnimTimer();
}

export function syncPreviewButtons(studio) {
  const btnTile = document.getElementById('btn-prev-tile');
  const btnRot = document.getElementById('btn-prev-rot');
  btnTile.className = studio.previewMode === 'tile'
    ? 'px-2 py-0.5 rounded bg-indigo-600 text-white font-bold'
    : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
  btnRot.className = studio.previewMode === 'rot'
    ? 'px-2 py-0.5 rounded bg-indigo-600 text-white font-bold'
    : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
}

export function renderFrameBar(studio) {
  const bar = document.getElementById('sp-frame-bar');
  const frames = studio.getActiveFrames();
  bar.innerHTML = '';
  if (!frames) return;

  const prefix = studio.isTileMode ? 'V' : 'F';
  frames.forEach((_, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = idx === studio.activeFrameIdx
      ? 'px-2 py-0.5 rounded bg-cyan-600 text-slate-950 font-bold text-[10px]'
      : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]';
    b.textContent = `${prefix}${idx + 1}`;
    b.addEventListener('click', () => {
      studio.activeFrameIdx = idx;
      studio.undoStack = [];
      studio.refreshAll();
    });
    bar.appendChild(b);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'px-1.5 py-0.5 rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 text-[10px]';
  addBtn.textContent = `+${prefix}`;
  addBtn.title = studio.isTileMode ? 'Duplicate Current Variant' : 'Duplicate Current Frame';
  addBtn.addEventListener('click', () => {
    frames.push([...studio.getActiveGrid()]);
    studio.activeFrameIdx = frames.length - 1;
    studio.renderBankList();
    studio.refreshAll();
  });
  bar.appendChild(addBtn);

  if (frames.length > 1) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'px-1.5 py-0.5 rounded bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-[10px]';
    delBtn.textContent = `-${prefix}`;
    delBtn.title = studio.isTileMode ? 'Delete Current Variant' : 'Delete Current Frame';
    delBtn.addEventListener('click', () => {
      frames.splice(studio.activeFrameIdx, 1);
      studio.activeFrameIdx = Math.max(0, studio.activeFrameIdx - 1);
      studio.renderBankList();
      studio.refreshAll();
    });
    bar.appendChild(delBtn);
  }
}

export function renderStateBar(studio) {
  const bar = document.getElementById('sp-state-bar');
  const sp = studio.getActiveSprite();
  if (!bar) return;
  bar.innerHTML = '';
  if (!sp) return;

  for (const stName of ANIM_STATES) {
    const hasState = sp.states ? !!sp.states[stName] : (stName === 'idle');
    const count = sp.states ? (sp.states[stName]?.frames?.length || 0) : (stName === 'idle' ? (sp.frames?.length || 1) : 0);
    const isAct = stName === studio.activeState;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isAct
      ? 'px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold'
      : hasState
        ? 'px-2 py-0.5 rounded bg-slate-800 text-cyan-200 border border-cyan-800/70 hover:border-cyan-500'
        : 'px-2 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300 hover:border-slate-600';
    btn.textContent = hasState ? `${stName} (${count})` : `+ ${stName}`;
    btn.title = hasState ? `Edit "${stName}" animation` : `Create "${stName}" animation state`;
    btn.addEventListener('click', () => studio.selectOrCreateState(stName));
    bar.appendChild(btn);
  }
}

export function renderAnimStrip(studio) {
  const strip = document.getElementById('sp-anim-strip');
  const sp = studio.getActiveSprite();
  const frames = studio.getActiveFrames(sp);
  if (!strip) return;
  strip.innerHTML = '';
  if (!sp || !frames) return;

  frames.forEach((grid, idx) => {
    const isAct = idx === studio.activeFrameIdx;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `shrink-0 flex flex-col items-center p-1 rounded border transition ${
      isAct
        ? 'border-amber-400 bg-amber-950/30'
        : 'border-slate-800 bg-black hover:border-slate-600'
    }`;
    const thumb = document.createElement('canvas');
    thumb.width = sp.w;
    thumb.height = sp.h;
    thumb.className = 'pixelated w-11 h-11';
    const tCtx = thumb.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(studio.renderGridToOffscreen(grid, sp.w, sp.h, studio.previewBand), 0, 0);

    const lbl = document.createElement('span');
    lbl.className = `text-[9px] mt-0.5 ${isAct ? 'text-amber-300 font-bold' : 'text-slate-400'}`;
    lbl.textContent = `${studio.isTileMode ? 'V' : 'F'}${idx + 1}`;

    card.appendChild(thumb);
    card.appendChild(lbl);
    card.addEventListener('click', () => {
      studio.activeFrameIdx = idx;
      studio.undoStack = [];
      studio.refreshAll();
    });
    strip.appendChild(card);
  });
}

export function restartAnimTimer(studio) {
  clearInterval(studio.animTimer);
  studio.animTimer = null;
  if (!studio.animPlaying) return;
  const intervalMs = Math.max(40, Math.round(1000 / Math.max(1, studio.animFps)));
  studio.animTimer = setInterval(() => {
    const frames = studio.getActiveFrames();
    if (!frames || frames.length <= 1) return;
    if (studio.animPingPong) {
      let next = studio.activeFrameIdx + studio.animDir;
      if (next >= frames.length) {
        studio.animDir = -1;
        next = Math.max(0, frames.length - 2);
      } else if (next < 0) {
        studio.animDir = 1;
        next = Math.min(frames.length - 1, 1);
      }
      studio.activeFrameIdx = next;
    } else {
      studio.activeFrameIdx = (studio.activeFrameIdx + 1) % frames.length;
    }
    studio.refreshAll();
  }, intervalMs);
}

export function bindTimelineAndPreviewEvents(studio) {
  document.getElementById('btn-prev-tile').addEventListener('click', () => {
    studio.previewMode = 'tile';
    studio.syncPreviewButtons();
    studio.renderLivePreview();
  });
  document.getElementById('btn-prev-rot').addEventListener('click', () => {
    studio.previewMode = 'rot';
    studio.syncPreviewButtons();
    studio.renderLivePreview();
  });
  document.getElementById('btn-prev-anim').addEventListener('click', (e) => {
    studio.animPlaying = !studio.animPlaying;
    e.target.textContent = studio.animPlaying ? '⏸ Pause' : '▶ Play';
    e.target.className = studio.animPlaying
      ? 'px-2.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold'
      : 'px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold';
    studio.restartAnimTimer();
  });
  document.getElementById('btn-anim-onion').addEventListener('click', (e) => {
    studio.onionSkin = !studio.onionSkin;
    e.target.textContent = `Onion: ${studio.onionSkin ? 'ON' : 'OFF'}`;
    e.target.className = studio.onionSkin
      ? 'px-2 py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
      : 'px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
    studio.renderEditorCanvas();
  });
  document.getElementById('anim-fps').addEventListener('input', (e) => {
    studio.animFps = Number(e.target.value) || 4;
    document.getElementById('lbl-anim-fps').textContent = `${studio.animFps} FPS`;
    const st = studio.getActiveStateObj();
    if (st) st.fps = studio.animFps;
    if (studio.animPlaying) studio.restartAnimTimer();
  });
  document.getElementById('anim-pingpong').addEventListener('change', (e) => {
    studio.animPingPong = e.target.checked;
    studio.animDir = 1;
    const st = studio.getActiveStateObj();
    if (st) st.pingPong = studio.animPingPong;
  });
  document.getElementById('sp-allow-rot')?.addEventListener('change', (e) => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    sp.allowRotate = e.target.checked;
    studio.renderLivePreview();
  });
  document.getElementById('sp-allow-flip')?.addEventListener('change', (e) => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    sp.allowFlip = e.target.checked;
    studio.renderLivePreview();
  });

  document.getElementById('btn-prev-fliph')?.addEventListener('click', (e) => {
    studio.previewFlipX = !studio.previewFlipX;
    e.target.className = studio.previewFlipX
      ? 'py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
      : 'py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
    studio.renderLivePreview();
  });

  document.getElementById('btn-anim-add-blank').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    if (!sp || !frames) return;
    const blank = Array.from({ length: sp.h }, () => '.'.repeat(sp.w));
    frames.splice(studio.activeFrameIdx + 1, 0, blank);
    studio.activeFrameIdx++;
    studio.undoStack = [];
    studio.renderBankList();
    studio.refreshAll();
  });
  document.getElementById('btn-anim-dup').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    const frames = studio.getActiveFrames(sp);
    if (!sp || !frames) return;
    frames.splice(studio.activeFrameIdx + 1, 0, [...studio.getActiveGrid()]);
    studio.activeFrameIdx++;
    studio.undoStack = [];
    studio.renderBankList();
    studio.refreshAll();
  });
  document.getElementById('btn-anim-left').addEventListener('click', () => {
    const frames = studio.getActiveFrames();
    if (!frames || studio.activeFrameIdx <= 0) return;
    const [moved] = frames.splice(studio.activeFrameIdx, 1);
    studio.activeFrameIdx--;
    frames.splice(studio.activeFrameIdx, 0, moved);
    studio.refreshAll();
  });
  document.getElementById('btn-anim-right').addEventListener('click', () => {
    const frames = studio.getActiveFrames();
    if (!frames || studio.activeFrameIdx >= frames.length - 1) return;
    const [moved] = frames.splice(studio.activeFrameIdx, 1);
    studio.activeFrameIdx++;
    frames.splice(studio.activeFrameIdx, 0, moved);
    studio.refreshAll();
  });
  document.getElementById('btn-anim-del').addEventListener('click', () => {
    const frames = studio.getActiveFrames();
    if (!frames || frames.length <= 1) return;
    frames.splice(studio.activeFrameIdx, 1);
    studio.activeFrameIdx = Math.max(0, studio.activeFrameIdx - 1);
    studio.undoStack = [];
    studio.renderBankList();
    studio.refreshAll();
  });

  document.getElementById('prev-band').addEventListener('input', (e) => {
    studio.previewBand = Number(e.target.value);
    document.getElementById('lbl-prev-band').textContent = `${studio.previewBand}${studio.previewBand === 8 ? ' (Full)' : ''}`;
    studio.renderLivePreview();
    studio.renderAnimStrip();
  });

  document.querySelectorAll('.sp-rot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      studio.previewAngle = Number(btn.dataset.angle) || 0;
      document.querySelectorAll('.sp-rot-btn').forEach((b) => {
        const isAct = Number(b.dataset.angle) === studio.previewAngle;
        b.className = isAct
          ? 'sp-rot-btn py-0.5 rounded bg-cyan-600 text-slate-950 font-bold'
          : 'sp-rot-btn py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700';
      });
      studio.renderLivePreview();
    });
  });
}
