/**
 * Authentication Screen, Session Verification & Account Bar DOM View
 */

export function updateAuthUI(menu) {
  const bar = document.getElementById('auth-status-bar');
  const modBtn = document.getElementById('btn-open-mod');
  if (menu.currentAccount) {
    bar.classList.remove('hidden');
    document.getElementById('auth-user-label').textContent = menu.currentAccount.username;
    document.getElementById('auth-ttl-label').textContent = menu.currentAccount.role === 'moderator' ? 'Realm Moderator' : 'Account Active';
    if (menu.currentAccount.role === 'moderator') modBtn.classList.remove('hidden');
    else modBtn.classList.add('hidden');
  } else {
    bar.classList.add('hidden');
    modBtn.classList.add('hidden');
  }
}

export async function checkAuth(menu) {
  if (!menu.authToken) {
    menu.currentAccount = null;
    menu.updateAuthUI();
  } else {
    try {
      const res = await fetch('/api/auth/me', { headers: menu.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        menu.currentAccount = data.account;
      } else {
        menu.authToken = null;
        menu.currentAccount = null;
        localStorage.removeItem('sanctum_token');
      }
    } catch {
      menu.currentAccount = null;
    }
    menu.updateAuthUI();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('invite');
  const urlCode = urlParams.get('join');
  const savedCode = sessionStorage.getItem('sanctum_pending_invite');
  const toResolve = urlToken || urlCode || savedCode;
  if (urlToken || urlCode) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (toResolve) {
    const inv = await menu.resolvePendingInvite(toResolve);
    if (inv && menu.currentAccount) {
      menu.screenMain.classList.add('hidden');
      menu.screenAuth.classList.add('hidden');
      menu.screenChar.classList.remove('hidden');
      menu.loadCharacterRoster();
    }
  } else if (menu.currentAccount) {
    const rawSession = sessionStorage.getItem('sanctum_active_session');
    if (rawSession) {
      try {
        const s = JSON.parse(rawSession);
        if (s && s.characterId) {
          await menu.loadCharacterRoster();
          const char = menu.savedCharacters.find(c => c.id === s.characterId);
          if (char && !(char.mode === 'HARDCORE' && char.isDead)) {
            menu.screenMain.classList.add('hidden');
            menu.screenAuth.classList.add('hidden');
            menu.screenChar.classList.add('hidden');
            menu.screenLobby.classList.add('hidden');
            menu.onConnect(
              s.playerName,
              s.roomName,
              s.mode,
              s.playerClass,
              s.characterId,
              s.joinType,
              s.password,
              s.inviteCode,
              s.inviteToken,
              s.maxPlayers
            );
            return;
          }
        }
      } catch {}
      sessionStorage.removeItem('sanctum_active_session');
    }
  }
}

export async function submitAuth(menu, endpoint) {
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const confirmWrap = document.getElementById('auth-confirm-wrap');
  const confirmEl = document.getElementById('auth-password-confirm');
  const regBtn = document.getElementById('btn-auth-register');

  if (endpoint === '/api/auth/register') {
    if (confirmWrap && confirmWrap.classList.contains('hidden')) {
      confirmWrap.classList.remove('hidden');
      if (regBtn) regBtn.textContent = 'Create Account';
      confirmEl?.focus();
      return;
    }
    if (password.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.classList.remove('hidden');
      return;
    }
    if (confirmEl && password !== confirmEl.value) {
      errEl.textContent = 'Passwords do not match.';
      errEl.classList.remove('hidden');
      return;
    }
  } else if (confirmWrap && !confirmWrap.classList.contains('hidden')) {
    confirmWrap.classList.add('hidden');
    if (confirmEl) confirmEl.value = '';
    if (regBtn) regBtn.textContent = 'Register';
  }

  try {
    const body = endpoint === '/api/auth/register'
      ? { username, password, confirmPassword: confirmEl ? confirmEl.value : password }
      : { username, password };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      errEl.textContent = data.error || 'Authentication failed';
      errEl.classList.remove('hidden');
      return;
    }
    menu.authToken = data.token;
    menu.currentAccount = data.account;
    localStorage.setItem('sanctum_token', menu.authToken);
    menu.updateAuthUI();
    menu.updateInviteBanner();
    menu.screenAuth.classList.add('hidden');
    menu.screenChar.classList.remove('hidden');
    menu.loadCharacterRoster();
  } catch {
    errEl.textContent = 'Network error';
    errEl.classList.remove('hidden');
  }
}

export function bindAuthEvents(menu) {
  document.getElementById('btn-auth-login').addEventListener('click', () => menu.submitAuth('/api/auth/login'));
  document.getElementById('btn-auth-register').addEventListener('click', () => menu.submitAuth('/api/auth/register'));
  document.getElementById('btn-auth-back').addEventListener('click', () => {
    menu.screenAuth.classList.add('hidden');
    menu.screenMain.classList.remove('hidden');
  });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: menu.authHeaders() }).catch(() => {});
    menu.authToken = null;
    menu.currentAccount = null;
    localStorage.removeItem('sanctum_token');
    menu.updateAuthUI();
  });
}
