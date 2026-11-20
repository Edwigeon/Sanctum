/**
 * Pause Menu, Audio Settings & Realm Invite Link DOM Controller
 */

export function syncAudioUI(settings) {
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
    lofi: 'Lo-Fi',
    standard: 'Standard',
    hifi: 'Hi-Fi'
  };
  const labelQuality = document.getElementById('label-audio-quality');
  if (labelQuality) labelQuality.textContent = qualityLabels[curQuality] || 'Standard';

  document.querySelectorAll('.btn-audio-quality').forEach(btn => {
    const q = btn.dataset.quality;
    if (q === curQuality) {
      btn.className = 'btn-audio-quality py-1 rounded bg-indigo-950/80 border border-indigo-700 text-indigo-300 font-bold transition cursor-pointer';
    } else {
      btn.className = 'btn-audio-quality py-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer';
    }
  });
}

export function updatePauseCodeDisplay(hud) {
  const pauseCode = document.getElementById('pause-my-code');
  const btnReveal = document.getElementById('btn-pause-reveal-code');
  if (!pauseCode) return;
  if (hud.isInviteCodeRevealed) {
    pauseCode.textContent = hud.currentInviteCode || (hud.currentInviteToken ? hud.currentInviteToken.slice(0, 8) + '...' : '—');
    if (btnReveal) btnReveal.textContent = 'Hide';
  } else {
    pauseCode.textContent = '••••••';
    if (btnReveal) btnReveal.textContent = 'Reveal';
  }
}

export function setInvite(hud, code, token = '') {
  hud.currentInviteCode = code || '';
  hud.currentInviteToken = token || '';
  hud.isInviteCodeRevealed = false;
  const invBtn = document.getElementById('btn-copy-invite');
  const pauseShare = document.getElementById('pause-share-box');
  if (hud.currentInviteCode || hud.currentInviteToken) {
    if (invBtn) {
      invBtn.textContent = 'Invite Link';
      invBtn.classList.remove('hidden');
    }
    pauseShare?.classList.remove('hidden');
    hud.updatePauseCodeDisplay();
  } else {
    invBtn?.classList.add('hidden');
    pauseShare?.classList.add('hidden');
  }
}

export function bindPauseAndAudioEvents(hud) {
  const btnReveal = document.getElementById('btn-pause-reveal-code');
  btnReveal?.addEventListener('click', () => {
    hud.isInviteCodeRevealed = !hud.isInviteCodeRevealed;
    hud.updatePauseCodeDisplay();
  });

  const btnCopyCode = document.getElementById('btn-pause-copy-code');
  btnCopyCode?.addEventListener('click', async () => {
    const code = hud.currentInviteCode || hud.currentInviteToken;
    if (!code) return;
    await navigator.clipboard?.writeText(code).catch(() => {});
    if (btnCopyCode) btnCopyCode.textContent = 'Copied!';
    setTimeout(() => {
      if (btnCopyCode) btnCopyCode.textContent = 'Copy Code';
    }, 1500);
  });

  const copyInvite = async () => {
    const token = hud.currentInviteToken;
    const code = hud.currentInviteCode;
    if (!token && !code) return;
    const link = token ? `${window.location.origin}/?invite=${token}` : `${window.location.origin}/?join=${code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    const btnTop = document.getElementById('btn-copy-invite');
    const btnPause = document.getElementById('btn-pause-copy-invite');
    if (btnTop) btnTop.textContent = 'Copied Link!';
    if (btnPause) btnPause.textContent = 'Copied Link!';
    setTimeout(() => {
      if (btnTop) btnTop.textContent = 'Invite Link';
      if (btnPause) btnPause.textContent = 'Copy Link';
    }, 1500);
  };

  document.getElementById('btn-copy-invite')?.addEventListener('click', copyInvite);
  document.getElementById('btn-pause-copy-invite')?.addEventListener('click', copyInvite);
  document.getElementById('btn-pause-regen-invite')?.addEventListener('click', () => {
    hud.sendPacket?.({ type: 'INVITE_REGENERATE' });
  });
  document.getElementById('btn-pause-revoke-invite')?.addEventListener('click', () => {
    hud.sendPacket?.({ type: 'INVITE_REVOKE' });
  });

  const toggleMute = () => {
    if (hud.audio) hud.audio.toggleMute();
  };
  document.getElementById('btn-quick-mute')?.addEventListener('click', toggleMute);
  document.getElementById('btn-pause-mute-toggle')?.addEventListener('click', toggleMute);

  document.getElementById('slider-vol-master')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    if (hud.audio) hud.audio.setMasterVolume(val);
    const lbl = document.getElementById('label-vol-master');
    if (lbl) lbl.textContent = `${e.target.value}%`;
  });

  document.getElementById('slider-vol-sfx')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    if (hud.audio) hud.audio.setSfxVolume(val);
    const lbl = document.getElementById('label-vol-sfx');
    if (lbl) lbl.textContent = `${e.target.value}%`;
  });

  document.getElementById('slider-vol-music')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    if (hud.audio) hud.audio.setMusicVolume(val);
    const lbl = document.getElementById('label-vol-music');
    if (lbl) lbl.textContent = `${e.target.value}%`;
  });

  document.getElementById('chk-spatial-audio')?.addEventListener('change', (e) => {
    if (hud.audio) hud.audio.setSpatialEnabled(e.target.checked);
  });

  document.querySelectorAll('.btn-audio-quality').forEach(btn => {
    btn.addEventListener('click', () => {
      if (hud.audio) hud.audio.setQuality(btn.dataset.quality);
    });
  });
}
