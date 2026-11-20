/**
 * Cryptographic Invite Token / Code Parser & Invite Flow Handler
 */

import { GAME_MODES } from '../../../shared/Constants.js';

export function parseInviteInput(raw) {
  const s = (raw || '').trim();
  if (!s) return { token: '', code: '' };
  try {
    if (s.includes('invite=') || s.includes('join=')) {
      const u = new URL(s.startsWith('http') ? s : `http://dummy/${s}`, 'http://dummy');
      const param = u.searchParams.get('invite') || u.searchParams.get('join') || '';
      if (param.length > 12) {
        return { token: param, code: '' };
      }
      return { token: '', code: param.toUpperCase() };
    }
  } catch { /* ignore */ }
  if (s.length > 12) {
    return { token: s, code: '' };
  }
  return { token: '', code: s.toUpperCase() };
}

export function extractInviteCode(raw) {
  const parsed = parseInviteInput(raw);
  return parsed.token || parsed.code;
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
  const { token, code } = parseInviteInput(rawInput);
  if (!token && !code) return null;
  const query = token ? `token=${encodeURIComponent(token)}` : `code=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(`/api/invite?${query}`);
    if (!res.ok) {
      const banner = document.getElementById('invite-banner');
      document.getElementById('invite-banner-text').textContent = 'Invite is invalid or the game room has closed.';
      banner.classList.remove('hidden');
      sessionStorage.removeItem('sanctum_pending_invite');
      return null;
    }
    const { invite } = await res.json();
    menu.pendingInvite = {
      ...invite,
      inviteToken: token || '',
      inviteCode: code || ''
    };
    sessionStorage.setItem('sanctum_pending_invite', token || code);
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
    const code = menu.pendingInvite.inviteCode || '';
    const token = menu.pendingInvite.inviteToken || '';
    menu.stopLobbyPolling();
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', code, token);
    menu.screenChar.classList.add('hidden');
  });

  document.getElementById('btn-join-invite').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    const raw = document.getElementById('inp-invite-code').value;
    const { token, code } = parseInviteInput(raw);
    if (!char || (!token && !code)) return;
    menu.stopLobbyPolling();
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', code, token);
    menu.screenLobby.classList.add('hidden');
  });

  document.getElementById('btn-pause-invite').addEventListener('click', async () => {
    const errEl = document.getElementById('pause-invite-err');
    errEl.classList.add('hidden');
    const raw = document.getElementById('inp-pause-invite').value;
    const { token, code } = parseInviteInput(raw);
    if (!token && !code) return;
    const query = token ? `token=${encodeURIComponent(token)}` : `code=${encodeURIComponent(code)}`;
    const res = await fetch(`/api/invite?${query}`);
    if (!res.ok) {
      errEl.textContent = 'Invite is invalid or the game room has closed.';
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
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', invite.inviteCode, invite.inviteToken);
  });
}
