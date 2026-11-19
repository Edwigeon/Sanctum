import { GAME_MODES, PACKET_TYPES, RARITY_COLORS } from '../../shared/Constants.js';

function formatItemStats(stats) {
  if (!stats) return '';
  return Object.entries(stats).map(([k, v]) => {
    if (k === 'crit') return `+${Math.round(v * 100)}% Crit`;
    return `+${v} ${k.charAt(0).toUpperCase() + k.slice(1)}`;
  }).join(' • ');
}

export class HUDController {
  constructor({ audio, sendPacket, onExitToMenu }) {
    this.audio = audio;
    this.sendPacket = sendPacket;
    this.onExitToMenu = onExitToMenu;

    this.panelChar = document.getElementById('panel-char');
    this.panelInv = document.getElementById('panel-inv');
    this.panelPause = document.getElementById('panel-pause');
    this.panelDeath = document.getElementById('panel-death');

    this.lastInvKey = '';
    this.lastVitalsKey = '';
    this.lastPrivRef = null;
    this.currentInviteCode = '';
    this.currentInviteToken = '';

    this.bindEvents();
    this.initAudioSettings();
  }

  initAudioSettings() {
    if (!this.audio) return;
    this.syncAudioUI(this.audio.settings);
    this.audio.onSettingsChange((settings) => this.syncAudioUI(settings));
  }

  syncAudioUI(settings) {
    if (!settings) return;
    const isMuted = settings.muted;
    const iconQuick = document.getElementById('icon-quick-mute');
    const labelQuick = document.getElementById('label-quick-mute');
    if (iconQuick) iconQuick.textContent = isMuted ? '🔇' : '🔊';
    if (labelQuick) labelQuick.textContent = isMuted ? 'Muted' : 'Sound';

    const btnPauseMute = document.getElementById('btn-pause-mute-toggle');
    if (btnPauseMute) {
      btnPauseMute.textContent = isMuted ? '🔇 Muted (Click to Unmute)' : '🔊 Sound On';
      btnPauseMute.className = isMuted
        ? 'text-[11px] text-rose-400 hover:text-rose-300 font-semibold transition cursor-pointer'
        : 'text-[11px] text-amber-400 hover:text-amber-300 font-semibold transition cursor-pointer';
    }

    const sliderMaster = document.getElementById('slider-vol-master');
    const labelMaster = document.getElementById('label-vol-master');
    const masterVal = Math.round((settings.master ?? 0.8) * 100);
    if (sliderMaster && document.activeElement !== sliderMaster) sliderMaster.value = masterVal;
    if (labelMaster) labelMaster.textContent = `${masterVal}%`;

    const sliderSfx = document.getElementById('slider-vol-sfx');
    const labelSfx = document.getElementById('label-vol-sfx');
    const sfxVal = Math.round((settings.sfx ?? 0.8) * 100);
    if (sliderSfx && document.activeElement !== sliderSfx) sliderSfx.value = sfxVal;
    if (labelSfx) labelSfx.textContent = `${sfxVal}%`;

    const sliderMusic = document.getElementById('slider-vol-music');
    const labelMusic = document.getElementById('label-vol-music');
    const musicVal = Math.round((settings.music ?? 0.6) * 100);
    if (sliderMusic && document.activeElement !== sliderMusic) sliderMusic.value = musicVal;
    if (labelMusic) labelMusic.textContent = `${musicVal}%`;

    const chkSpatial = document.getElementById('chk-spatial-audio');
    if (chkSpatial) chkSpatial.checked = !!settings.spatial;

    const curQuality = settings.quality || 'standard';
    const qualityLabels = {
      lofi: 'Lo-Fi (11 kHz)',
      standard: 'Standard (22 kHz)',
      hifi: 'Hi-Fi (44 kHz)'
    };
    const labelQuality = document.getElementById('label-audio-quality');
    if (labelQuality) labelQuality.textContent = qualityLabels[curQuality] || 'Standard (22 kHz)';

    document.querySelectorAll('.btn-audio-quality').forEach(btn => {
      const q = btn.dataset.quality;
      if (q === curQuality) {
        btn.className = 'btn-audio-quality py-1 rounded bg-indigo-950/80 border border-indigo-700 text-indigo-300 font-bold transition cursor-pointer';
      } else {
        btn.className = 'btn-audio-quality py-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer';
      }
    });
  }

  bindEvents() {
    document.getElementById('btn-toggle-char').addEventListener('click', () => this.toggleChar());
    document.getElementById('btn-close-char').addEventListener('click', () => this.panelChar.classList.add('hidden'));
    document.getElementById('btn-toggle-inv').addEventListener('click', () => this.toggleInv());
    document.getElementById('btn-close-inv').addEventListener('click', () => this.panelInv.classList.add('hidden'));
    document.getElementById('btn-toggle-menu').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-pause-resume').addEventListener('click', () => this.panelPause.classList.add('hidden'));
    document.getElementById('btn-pause-quit').addEventListener('click', () => this.onExitToMenu());
    document.getElementById('btn-death-quit').addEventListener('click', () => this.onExitToMenu());
    document.getElementById('btn-respawn').addEventListener('click', () => {
      this.sendPacket({ type: PACKET_TYPES.INPUT_RESPAWN });
    });
    document.getElementById('btn-pot').addEventListener('click', () => {
      this.sendPacket({ type: PACKET_TYPES.INPUT_POTION });
    });

    document.querySelectorAll('.btn-alloc-stat').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sendPacket({ type: PACKET_TYPES.ALLOC_STAT, stat: btn.dataset.stat });
      });
    });

    const copyInvite = async () => {
      const token = this.currentInviteToken;
      const code = this.currentInviteCode;
      if (!token && !code) return;
      const link = token ? `${window.location.origin}/?invite=${token}` : `${window.location.origin}/?join=${code}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      const btnTop = document.getElementById('btn-copy-invite');
      const btnPause = document.getElementById('btn-pause-copy-invite');
      if (btnTop) btnTop.textContent = 'Copied Link!';
      if (btnPause) btnPause.textContent = 'Copied Secure Link!';
      setTimeout(() => {
        if (btnTop && this.currentInviteCode) btnTop.textContent = `Invite: ${this.currentInviteCode}`;
        if (btnPause) btnPause.textContent = 'Copy Invite Link';
      }, 1500);
    };

    document.getElementById('btn-copy-invite').addEventListener('click', copyInvite);
    document.getElementById('btn-pause-copy-invite')?.addEventListener('click', copyInvite);

    // Audio Controls & Volume Sliders
    const toggleMute = () => {
      if (this.audio) this.audio.toggleMute();
    };
    document.getElementById('btn-quick-mute')?.addEventListener('click', toggleMute);
    document.getElementById('btn-pause-mute-toggle')?.addEventListener('click', toggleMute);

    document.getElementById('slider-vol-master')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      if (this.audio) this.audio.setMasterVolume(val);
      const lbl = document.getElementById('label-vol-master');
      if (lbl) lbl.textContent = `${e.target.value}%`;
    });

    document.getElementById('slider-vol-sfx')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      if (this.audio) this.audio.setSfxVolume(val);
      const lbl = document.getElementById('label-vol-sfx');
      if (lbl) lbl.textContent = `${e.target.value}%`;
    });

    document.getElementById('slider-vol-music')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      if (this.audio) this.audio.setMusicVolume(val);
      const lbl = document.getElementById('label-vol-music');
      if (lbl) lbl.textContent = `${e.target.value}%`;
    });

    document.getElementById('chk-spatial-audio')?.addEventListener('change', (e) => {
      if (this.audio) this.audio.setSpatialEnabled(e.target.checked);
    });

    document.querySelectorAll('.btn-audio-quality').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.audio) this.audio.setQuality(btn.dataset.quality);
      });
    });
  }

  isPaused() {
    return !this.panelPause.classList.contains('hidden');
  }

  toggleChar() {
    this.panelChar.classList.toggle('hidden');
  }

  toggleInv() {
    this.panelInv.classList.toggle('hidden');
  }

  togglePause() {
    this.panelPause.classList.toggle('hidden');
  }

  handleEscape() {
    if (!this.panelChar.classList.contains('hidden') || !this.panelInv.classList.contains('hidden')) {
      this.panelChar.classList.add('hidden');
      this.panelInv.classList.add('hidden');
    } else {
      this.panelPause.classList.toggle('hidden');
    }
  }

  setInvite(code, token = '') {
    this.currentInviteCode = code || '';
    this.currentInviteToken = token || '';
    const invBtn = document.getElementById('btn-copy-invite');
    const pauseShare = document.getElementById('pause-share-box');
    const pauseCode = document.getElementById('pause-my-code');
    if (this.currentInviteCode || this.currentInviteToken) {
      invBtn.textContent = `Copy Invite: ${this.currentInviteCode || 'Link'}`;
      invBtn.classList.remove('hidden');
      pauseShare?.classList.remove('hidden');
      if (pauseCode) pauseCode.textContent = this.currentInviteCode || (this.currentInviteToken.slice(0, 8) + '...');
    } else {
      invBtn.classList.add('hidden');
      pauseShare?.classList.add('hidden');
    }
  }

  setInviteCode(code) {
    this.setInvite(code, '');
  }

  setFloorStatus(floor) {
    const el = document.getElementById('status-line');
    el.textContent = `Floor ${floor} — Sanctum Depths`;
    el.className = 'text-emerald-400 font-mono text-[10px] bg-slate-900 px-2 py-0.5 rounded border border-slate-700';
  }

  reset() {
    this.lastInvKey = '';
    this.lastVitalsKey = '';
    this.lastPrivRef = null;
    this.setInviteCode('');
    this.panelChar.classList.add('hidden');
    this.panelInv.classList.add('hidden');
    this.panelPause.classList.add('hidden');
    this.panelDeath.classList.add('hidden');
  }

  update({ myP, priv, activeRoomMode }) {
    if (!myP) return;

    const vitalsKey = `${myP.hp}|${myP.maxHp}|${myP.mp}|${myP.maxMp}|${myP.isDead}|${activeRoomMode}`;
    if (vitalsKey !== this.lastVitalsKey) {
      this.lastVitalsKey = vitalsKey;
      document.getElementById('hud-hp').textContent = `${myP.hp} / ${myP.maxHp}`;
      document.getElementById('hud-mp').textContent = `${myP.mp} / ${myP.maxMp}`;

      if (myP.isDead) {
        const isHC = activeRoomMode === GAME_MODES.HARDCORE;
        document.getElementById('status-line').textContent = isHC ? 'YOU HAVE FALLEN (Permadeath)' : 'You were slain!';
        document.getElementById('status-line').className = 'text-[10px] font-mono text-rose-400 bg-slate-900 px-2 py-0.5 rounded border border-rose-900';
        document.getElementById('death-title').textContent = isHC ? 'YOU HAVE FALLEN' : 'YOU WERE SLAIN';
        document.getElementById('death-subtitle').textContent = isHC
          ? 'Permadeath — Your deeds are etched in the Hall of Fallen Heroes.'
          : '10% XP penalty • Respawn at floor entrance';
        const btnRespawn = document.getElementById('btn-respawn');
        if (isHC) btnRespawn.classList.add('hidden');
        else btnRespawn.classList.remove('hidden');
        this.panelDeath.classList.remove('hidden');
      } else {
        this.panelDeath.classList.add('hidden');
      }
    }

    if (!priv || priv === this.lastPrivRef) return;
    this.lastPrivRef = priv;

    document.getElementById('hud-pot').textContent = `x${priv.potions ?? 3}`;
    const xpPct = Math.min(100, Math.round(((priv.xp || 0) / (priv.nextXp || 100)) * 100));
    document.getElementById('hud-xp-bar').style.width = `${xpPct}%`;

    const statBadge = document.getElementById('badge-stat-pts');
    if (priv.statPoints > 0) statBadge.classList.remove('hidden');
    else statBadge.classList.add('hidden');

    document.getElementById('char-name').textContent = myP.name;
    document.getElementById('char-sub').textContent = `Lv ${priv.level || 1} ${priv.className || 'Hero'}`;
    document.getElementById('char-xp-text').textContent = `${priv.xp || 0} / ${priv.nextXp || 100}`;
    document.getElementById('char-xp-bar').style.width = `${xpPct}%`;

    if (priv.stats) {
      document.getElementById('stat-might').textContent = priv.stats.might;
      document.getElementById('stat-focus').textContent = priv.stats.focus;
      document.getElementById('stat-agility').textContent = priv.stats.agility;
      document.getElementById('stat-vitality').textContent = priv.stats.vitality;
    }
    const ptsEl = document.getElementById('char-stat-pts');
    if (priv.statPoints > 0) {
      ptsEl.textContent = `${priv.statPoints} pts`;
      ptsEl.classList.remove('hidden');
    } else {
      ptsEl.classList.add('hidden');
    }
    document.querySelectorAll('.btn-alloc-stat').forEach(b => {
      if (priv.statPoints > 0) b.classList.remove('hidden');
      else b.classList.add('hidden');
    });

    if (priv.derived) {
      document.getElementById('der-dmg').textContent = `${priv.derived.dmgMin}–${priv.derived.dmgMax}`;
      document.getElementById('der-spell').textContent = priv.derived.spellDmg;
      document.getElementById('der-armor').textContent = priv.derived.armor;
      document.getElementById('der-crit').textContent = `${priv.derived.crit}%`;
      document.getElementById('der-speed').textContent = priv.derived.speed;
    }

    if (priv.equipment) {
      for (const slot of ['weapon', 'armor', 'gloves', 'ring']) {
        const el = document.getElementById(`slot-${slot}`);
        const item = priv.equipment[slot];
        const nameEl = el.querySelector('.slot-name');
        if (item) {
          const col = RARITY_COLORS[item.rarity] || '#FFFFFF';
          el.style.borderColor = col;
          nameEl.textContent = item.name;
          nameEl.style.color = col;
        } else {
          el.style.borderColor = '';
          nameEl.textContent = '—';
          nameEl.style.color = '';
        }
      }
    }

    const curW = priv.carryWeight ?? 0;
    const maxW = priv.maxWeight ?? 60;
    const wPct = Math.min(100, Math.round((curW / maxW) * 100));
    document.getElementById('inv-weight-text').textContent = `${curW.toFixed(1)} / ${maxW.toFixed(1)} lb`;
    const wBar = document.getElementById('inv-weight-bar');
    wBar.style.width = `${wPct}%`;
    wBar.className = `h-full transition-all ${wPct >= 90 ? 'bg-rose-500' : (wPct >= 70 ? 'bg-amber-400' : 'bg-indigo-400')}`;

    const inv = priv.inventory || [];
    const invKey = JSON.stringify(inv);
    if (invKey === this.lastInvKey) return;
    this.lastInvKey = invKey;

    const list = document.getElementById('inv-list');
    list.innerHTML = '';
    if (inv.length === 0) {
      list.innerHTML = '<div class="text-[10px] font-mono text-slate-500 py-4 text-center">Pack is empty</div>';
    } else {
      for (const item of inv) {
        const col = RARITY_COLORS[item.rarity] || '#FFFFFF';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'w-full text-left rounded bg-slate-900/90 border border-slate-800 px-2 py-1.5 hover:bg-slate-800 transition space-y-0.5';
        row.style.borderLeftWidth = '3px';
        row.style.borderLeftColor = col;
        row.innerHTML = `
          <div class="flex items-center justify-between gap-1 text-[11px] font-mono">
            <span class="font-bold truncate" style="color:${col}">${item.name}</span>
            <span class="text-[9px] text-slate-400 shrink-0">${(item.weight || 1).toFixed(1)} lb</span>
          </div>
          <div class="flex items-center justify-between text-[9px] font-mono">
            <span class="text-emerald-300 truncate">${formatItemStats(item.stats)}</span>
            <span class="text-slate-500 uppercase ml-1 shrink-0">${item.slot}</span>
          </div>
        `;
        row.addEventListener('click', () => {
          this.sendPacket({ type: PACKET_TYPES.EQUIP_ITEM, itemId: item.id });
        });
        row.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          this.sendPacket({ type: PACKET_TYPES.DROP_ITEM, itemId: item.id });
        });
        list.appendChild(row);
      }
    }
  }
}
