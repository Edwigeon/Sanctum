/**
 * Cryptographic Invite Token Parser & Invite Flow Handler
 */

import { GAME_MODES } from '../../../shared/Constants.js';

const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return ''; }
}

export function parseInviteInput(raw) {
  const s = (raw || '').trim();
  if (!s) return { token: '' };
  let val = s;
  const hashIdx = s.indexOf('#');
  if (hashIdx !== -1) {
    const frag = s.slice(hashIdx + 1);
    const m = frag.match(/(?:^|[?&#])invite=([^&#\s]+)/);
    if (m) val = decodeURIComponentSafe(m[1]);
    else if (INVITE_TOKEN_RE.test(frag)) val = frag;
  } else {
    const m = s.match(/[?&]invite=([^&#\s]+)/);
    if (m) val = decodeURIComponentSafe(m[1]);
  }
  if (INVITE_TOKEN_RE.test(val)) {
    return { token: val };
  }
  return { token: '' };
}

export function extractInviteToken(raw) {
  return parseInviteInput(raw).token;
}

export function clearPendingInvite(menu) {
  menu.pendingInvite = null;
  sessionStorage.removeItem('sanctum_pending_invite');
  document.getElementById('invite-banner').classList.add('hidden');
  document.getElementById('btn-accept-invite').classList.add('hidden');
  if (!menu.screenChar.classList.contains('hidden')) menu.renderRoster();
}

export function updateInviteBanner(menu) {
  const banner = document.getElementById('invite-banner');
  const textEl = document.getElementById('invite-banner-text');
  if (!menu.pendingInvite) {
    banner.classList.add('hidden');
    return;
  }
  const hint = !menu.currentAccount
    ? 'Sign in or register to join!'
    : `Select a ${menu.pendingInvite.mode} hero to join!`;
  textEl.textContent = `Invite: "${menu.pendingInvite.name}" (${menu.pendingInvite.mode} • ${menu.pendingInvite.players}/${menu.pendingInvite.maxPlayers}) — ${hint}`;
  banner.classList.remove('hidden');
}

export async function resolvePendingInvite(menu, rawInput) {
  const { token } = parseInviteInput(rawInput);
  if (!token) {
    const banner = document.getElementById('invite-banner');
    if (banner) {
      document.getElementById('invite-banner-text').textContent = 'Invite link is invalid or expired.';
      banner.classList.remove('hidden');
    }
    sessionStorage.removeItem('sanctum_pending_invite');
    return null;
  }
  try {
    const res = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const banner = document.getElementById('invite-banner');
      if (banner) {
        document.getElementById('invite-banner-text').textContent = 'Invite link is invalid, expired, or the game room has closed.';
        banner.classList.remove('hidden');
      }
      sessionStorage.removeItem('sanctum_pending_invite');
      return null;
    }
    const { invite } = await res.json();
    menu.pendingInvite = {
      ...invite,
      inviteToken: token
    };
    sessionStorage.setItem('sanctum_pending_invite', token);
    if (invite.mode === GAME_MODES.HARDCORE) menu.btnHardcore.click();
    else menu.btnClassic.click();
    menu.updateInviteBanner();
    return invite;
  } catch {
    return null;
  }
}

export function bindInviteEvents(menu) {
  document.getElementById('btn-invite-dismiss').addEventListener('click', () => menu.clearPendingInvite());

  document.getElementById('btn-accept-invite').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (!char || !menu.pendingInvite || char.mode !== menu.pendingInvite.mode) return;
    const token = menu.pendingInvite.inviteToken || '';
    menu.stopLobbyPolling();
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', token);
    menu.screenChar.classList.add('hidden');
  });

  document.getElementById('btn-join-invite').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    const inp = document.getElementById('inp-invite-token') || document.getElementById('inp-invite-code');
    const raw = inp ? inp.value : '';
    const { token } = parseInviteInput(raw);
    if (!char || !token) return;
    menu.stopLobbyPolling();
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', token);
    menu.screenLobby.classList.add('hidden');
  });

  document.getElementById('btn-pause-invite').addEventListener('click', async () => {
    const errEl = document.getElementById('pause-invite-err');
    errEl.classList.add('hidden');
    const raw = document.getElementById('inp-pause-invite').value;
    const { token } = parseInviteInput(raw);
    if (!token) {
      errEl.textContent = 'Please enter a valid invite link or token.';
      errEl.classList.remove('hidden');
      return;
    }
    const res = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      errEl.textContent = 'Invite is invalid, expired, or the game room has closed.';
      errEl.classList.remove('hidden');
      return;
    }
    const { invite } = await res.json();
    if (invite.players >= invite.maxPlayers) {
      errEl.textContent = `Room "${invite.name}" is full (${invite.players}/${invite.maxPlayers}).`;
      errEl.classList.remove('hidden');
      return;
    }
    const char = menu.getSelectedCharacter();
    if (!char || char.mode !== invite.mode) {
      errEl.textContent = `Mode mismatch: requires a ${invite.mode} hero (exit to Hero Roster to switch).`;
      errEl.classList.remove('hidden');
      return;
    }
    document.getElementById('panel-pause').classList.add('hidden');
    document.getElementById('inp-pause-invite').value = '';
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', token);
  });
}
