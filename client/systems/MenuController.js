import { GAME_MODES } from '../../shared/Constants.js';

export function extractInviteCode(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    if (s.includes('join=')) {
      const u = new URL(s, window.location.origin);
      return (u.searchParams.get('join') || '').trim().toUpperCase();
    }
  } catch { /* ignore */ }
  return s.toUpperCase();
}

export class MenuController {
  constructor({ onConnect, getCurrentInviteCode }) {
    this.onConnect = onConnect;
    this.getCurrentInviteCode = getCurrentInviteCode;

    this.screenMain = document.getElementById('screen-main-menu');
    this.screenAuth = document.getElementById('screen-auth');
    this.screenChar = document.getElementById('screen-char-menu');
    this.screenLobby = document.getElementById('screen-lobby');
    this.btnClassic = document.getElementById('btn-mode-classic');
    this.btnHardcore = document.getElementById('btn-mode-hardcore');

    this.authToken = localStorage.getItem('sanctum_token') || null;
    this.currentAccount = null;
    this.savedCharacters = [];
    this.selectedCharacterId = null;
    this.selectedClass = 'VANGUARD';
    this.currentMode = GAME_MODES.CLASSIC;
    this.roomVisibility = 'public';
    this.pendingInvite = null;

    this.bindEvents();
    this.checkAuth();
  }

  getAuthToken() {
    return this.authToken;
  }

  getSelectedCharacter() {
    return this.savedCharacters.find(c => c.id === this.selectedCharacterId) || null;
  }

  authHeaders() {
    return this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {};
  }

  showMainMenu() {
    this.screenMain.classList.remove('hidden');
  }

  showLobbyError(message, mode) {
    const errEl = document.getElementById('lobby-error');
    errEl.textContent = message || 'Unable to join room.';
    errEl.classList.remove('hidden');
    this.screenLobby.classList.remove('hidden');
    this.loadLobbies(mode);
  }

  updateAuthUI() {
    const bar = document.getElementById('auth-status-bar');
    const modBtn = document.getElementById('btn-open-mod');
    if (this.currentAccount) {
      bar.classList.remove('hidden');
      document.getElementById('auth-user-label').textContent = this.currentAccount.username;
      const daysLeft = Math.max(0, Math.ceil((this.currentAccount.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      document.getElementById('auth-ttl-label').textContent = this.currentAccount.role === 'moderator' ? 'Moderator (Exempt)' : `Retention: ${daysLeft}d`;
      if (this.currentAccount.role === 'moderator') modBtn.classList.remove('hidden');
      else modBtn.classList.add('hidden');
    } else {
      bar.classList.add('hidden');
      modBtn.classList.add('hidden');
    }
  }

  clearPendingInvite() {
    this.pendingInvite = null;
    sessionStorage.removeItem('sanctum_pending_invite');
    document.getElementById('invite-banner').classList.add('hidden');
    document.getElementById('btn-accept-invite').classList.add('hidden');
    if (!this.screenChar.classList.contains('hidden')) this.renderRoster();
  }

  updateInviteBanner() {
    const banner = document.getElementById('invite-banner');
    const textEl = document.getElementById('invite-banner-text');
    if (!this.pendingInvite) {
      banner.classList.add('hidden');
      return;
    }
    const hint = !this.currentAccount
      ? 'Sign in or register to join!'
      : `Select a ${this.pendingInvite.mode} hero to join!`;
    textEl.textContent = `Invite: "${this.pendingInvite.name}" (${this.pendingInvite.mode} • ${this.pendingInvite.players}/${this.pendingInvite.maxPlayers}) — ${hint}`;
    banner.classList.remove('hidden');
  }

  async resolvePendingInvite(rawCode) {
    const code = extractInviteCode(rawCode);
    if (!code) return null;
    try {
      const res = await fetch(`/api/invite?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const banner = document.getElementById('invite-banner');
        document.getElementById('invite-banner-text').textContent = `Invite "${code}" is invalid or the room has closed.`;
        banner.classList.remove('hidden');
        sessionStorage.removeItem('sanctum_pending_invite');
        return null;
      }
      const { invite } = await res.json();
      this.pendingInvite = invite;
      sessionStorage.setItem('sanctum_pending_invite', invite.inviteCode);
      if (invite.mode === GAME_MODES.HARDCORE) this.btnHardcore.click();
      else this.btnClassic.click();
      this.updateInviteBanner();
      return invite;
    } catch {
      return null;
    }
  }

  async checkAuth() {
    if (!this.authToken) {
      this.currentAccount = null;
      this.updateAuthUI();
    } else {
      try {
        const res = await fetch('/api/auth/me', { headers: this.authHeaders() });
        if (res.ok) {
          const data = await res.json();
          this.currentAccount = data.account;
        } else {
          this.authToken = null;
          this.currentAccount = null;
          localStorage.removeItem('sanctum_token');
        }
      } catch {
        this.currentAccount = null;
      }
      this.updateAuthUI();
    }

    const urlCode = new URLSearchParams(window.location.search).get('join');
    const savedCode = sessionStorage.getItem('sanctum_pending_invite');
    const codeToResolve = urlCode || savedCode;
    if (urlCode) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (codeToResolve) {
      const inv = await this.resolvePendingInvite(codeToResolve);
      if (inv && this.currentAccount) {
        this.screenMain.classList.add('hidden');
        this.screenAuth.classList.add('hidden');
        this.screenChar.classList.remove('hidden');
        this.loadCharacterRoster();
      }
    }
  }

  async submitAuth(endpoint) {
    const errEl = document.getElementById('auth-error');
    errEl.classList.add('hidden');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        errEl.textContent = data.error || 'Authentication failed';
        errEl.classList.remove('hidden');
        return;
      }
      this.authToken = data.token;
      this.currentAccount = data.account;
      localStorage.setItem('sanctum_token', this.authToken);
      this.updateAuthUI();
      this.updateInviteBanner();
      this.screenAuth.classList.add('hidden');
      this.screenChar.classList.remove('hidden');
      this.loadCharacterRoster();
    } catch {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    }
  }

  async loadCharacterRoster() {
    if (!this.authToken) return;
    try {
      const res = await fetch('/api/characters', { headers: this.authHeaders() });
      if (res.status === 401) {
        this.authToken = null;
        this.currentAccount = null;
        localStorage.removeItem('sanctum_token');
        this.updateAuthUI();
        this.screenChar.classList.add('hidden');
        this.screenAuth.classList.remove('hidden');
        return;
      }
      const data = await res.json();
      this.savedCharacters = data.characters || [];
      const reqMode = this.pendingInvite?.mode || null;
      const isEligible = (c) => !(c.mode === GAME_MODES.HARDCORE && c.isDead) && (!reqMode || c.mode === reqMode);
      if (!this.selectedCharacterId || !this.savedCharacters.some(c => c.id === this.selectedCharacterId && isEligible(c))) {
        const preferred = this.savedCharacters.find(isEligible) || this.savedCharacters.find(c => !(c.mode === GAME_MODES.HARDCORE && c.isDead));
        this.selectedCharacterId = preferred ? preferred.id : null;
      }
      this.renderRoster();
    } catch (err) {
      console.error('Failed to load characters:', err);
    }
  }

  renderRoster() {
    const list = document.getElementById('char-roster-list');
    const btnSolo = document.getElementById('btn-enter-solo');
    const btnLobbies = document.getElementById('btn-open-lobbies');
    const btnInvite = document.getElementById('btn-accept-invite');
    list.innerHTML = '';

    if (this.savedCharacters.length === 0) {
      list.innerHTML = '<div class="text-[11px] font-mono text-slate-500 py-6 text-center">No heroes yet. Forge one on the right →</div>';
      btnSolo.disabled = true;
      btnLobbies.disabled = true;
      btnInvite.classList.add('hidden');
      return;
    }

    for (const c of this.savedCharacters) {
      const isFallen = c.mode === GAME_MODES.HARDCORE && c.isDead;
      const modeMismatch = !!this.pendingInvite && c.mode !== this.pendingInvite.mode;
      const isSelected = c.id === this.selectedCharacterId && !isFallen;
      const row = document.createElement('div');
      row.className = `flex items-center justify-between p-2 rounded-lg border text-xs transition ${
        isFallen
          ? 'border-rose-950 bg-rose-950/20 opacity-60 cursor-not-allowed'
          : modeMismatch
            ? 'border-slate-800 bg-slate-900/40 opacity-50 cursor-pointer'
            : isSelected
              ? 'border-amber-500 bg-amber-950/25 cursor-pointer'
              : 'border-slate-800 bg-slate-900/70 hover:border-slate-600 cursor-pointer'
      }`;

      const info = document.createElement('div');
      info.className = 'min-w-0 flex-1';
      const modeBadge = c.mode === GAME_MODES.HARDCORE
        ? '<span class="text-[9px] font-mono px-1 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800/60">HC</span>'
        : '<span class="text-[9px] font-mono px-1 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60">CL</span>';
      const fallenBadge = isFallen ? ' <span class="text-[9px] font-mono text-rose-400 font-bold">FALLEN</span>' : '';
      const mismatchBadge = modeMismatch ? ` <span class="text-[9px] font-mono text-amber-400">Needs ${this.pendingInvite.mode}</span>` : '';
      info.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-slate-100 truncate">${c.name}</span>
          ${modeBadge}${fallenBadge}${mismatchBadge}
        </div>
        <div class="text-[10px] font-mono text-slate-400">Lv ${c.level} ${c.classId} • Best Floor ${c.highestFloor || 1}</div>
      `;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ml-2 text-slate-500 hover:text-rose-400 font-mono text-xs px-1.5 py-0.5 rounded';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete Hero';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/characters?id=${encodeURIComponent(c.id)}`, { method: 'DELETE', headers: this.authHeaders() });
        if (this.selectedCharacterId === c.id) this.selectedCharacterId = null;
        await this.loadCharacterRoster();
      });

      if (!isFallen) {
        row.addEventListener('click', () => {
          this.selectedCharacterId = c.id;
          this.renderRoster();
        });
      }

      row.appendChild(info);
      row.appendChild(delBtn);
      list.appendChild(row);
    }

    const sel = this.getSelectedCharacter();
    const canPlay = !!sel && !(sel.mode === GAME_MODES.HARDCORE && sel.isDead);
    btnSolo.disabled = !canPlay;
    btnLobbies.disabled = !canPlay;

    if (this.pendingInvite) {
      btnInvite.classList.remove('hidden');
      const isFull = this.pendingInvite.players >= this.pendingInvite.maxPlayers;
      const modeOk = canPlay && sel.mode === this.pendingInvite.mode;
      btnInvite.disabled = !modeOk || isFull;
      btnInvite.textContent = isFull
        ? `Room Full (${this.pendingInvite.players}/${this.pendingInvite.maxPlayers})`
        : modeOk
          ? `Accept Invite & Join "${this.pendingInvite.name}"`
          : `Select or Forge a ${this.pendingInvite.mode} Hero`;
    } else {
      btnInvite.classList.add('hidden');
    }
  }

  async loadLobbies(mode) {
    const list = document.getElementById('lobby-list');
    list.innerHTML = '<div class="text-slate-500 py-4 text-center">Scanning realms...</div>';
    try {
      const res = await fetch(`/api/lobbies?mode=${encodeURIComponent(mode)}`);
      const { lobbies } = await res.json();
      list.innerHTML = '';
      if (!lobbies || lobbies.length === 0) {
        list.innerHTML = `<div class="text-slate-500 py-6 text-center">No active ${mode} games.<br>Create one on the right →</div>`;
        return;
      }
      const char = this.getSelectedCharacter();
      for (const l of lobbies) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2 rounded border border-slate-800 bg-slate-900/80 hover:border-indigo-500 transition';
        row.innerHTML = `
          <div class="min-w-0">
            <div class="font-bold text-slate-100 truncate">${l.hasPassword ? '🔒 ' : ''}${l.name}</div>
            <div class="text-[10px] text-slate-400">Floor ${l.floor} • Players: ${l.players}/${l.maxPlayers}</div>
          </div>
          <button type="button" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px]">Join</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
          if (!char) return;
          let pass = '';
          if (l.hasPassword) {
            pass = prompt(`Enter password for "${l.name}":`) || '';
          }
          this.onConnect(char.name, l.name, char.mode, char.classId, char.id, 'public', pass);
          this.screenLobby.classList.add('hidden');
        });
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="text-rose-400 py-4 text-center">Failed to load lobbies</div>';
    }
  }

  bindEvents() {
    document.getElementById('btn-invite-dismiss').addEventListener('click', () => this.clearPendingInvite());
    document.getElementById('btn-auth-login').addEventListener('click', () => this.submitAuth('/api/auth/login'));
    document.getElementById('btn-auth-register').addEventListener('click', () => this.submitAuth('/api/auth/register'));
    document.getElementById('btn-auth-back').addEventListener('click', () => {
      this.screenAuth.classList.add('hidden');
      this.screenMain.classList.remove('hidden');
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', headers: this.authHeaders() }).catch(() => {});
      this.authToken = null;
      this.currentAccount = null;
      localStorage.removeItem('sanctum_token');
      this.updateAuthUI();
    });

    document.getElementById('btn-menu-play').addEventListener('click', () => {
      this.screenMain.classList.add('hidden');
      if (this.currentAccount) {
        this.screenChar.classList.remove('hidden');
        this.loadCharacterRoster();
      } else {
        this.screenAuth.classList.remove('hidden');
      }
    });
    document.getElementById('btn-menu-controls').addEventListener('click', () => {
      document.getElementById('main-menu-controls').classList.toggle('hidden');
    });
    document.getElementById('btn-char-back').addEventListener('click', () => {
      this.screenChar.classList.add('hidden');
      this.screenMain.classList.remove('hidden');
    });

    document.querySelectorAll('.class-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectedClass = card.dataset.class;
        document.querySelectorAll('.class-card').forEach(c => {
          c.className = 'class-card text-left p-2 rounded-lg border border-slate-800 bg-slate-950/60 hover:border-slate-600 transition';
        });
        card.className = 'class-card text-left p-2 rounded-lg border-2 border-amber-500 bg-amber-950/20 transition';
      });
    });

    this.btnClassic.addEventListener('click', () => {
      this.currentMode = GAME_MODES.CLASSIC;
      this.btnClassic.className = 'border border-indigo-500 bg-indigo-950/40 text-indigo-200 py-1.5 rounded text-center font-bold';
      this.btnHardcore.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded text-center font-bold hover:border-rose-900 transition';
    });

    this.btnHardcore.addEventListener('click', () => {
      this.currentMode = GAME_MODES.HARDCORE;
      this.btnHardcore.className = 'border border-rose-600 bg-rose-950/40 text-rose-200 py-1.5 rounded text-center font-bold';
      this.btnClassic.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded text-center font-bold hover:border-indigo-900 transition';
    });

    document.getElementById('btn-create-char').addEventListener('click', async () => {
      const name = document.getElementById('inp-name').value.trim() || 'Wanderer';
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ name, classId: this.selectedClass, mode: this.currentMode })
      });
      const data = await res.json();
      if (data.character) {
        this.selectedCharacterId = data.character.id;
        await this.loadCharacterRoster();
      }
    });

    document.getElementById('btn-enter-solo').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      if (!char) return;
      this.onConnect(char.name, '', char.mode, char.classId, char.id, 'solo', '');
      this.screenChar.classList.add('hidden');
    });

    document.getElementById('btn-open-lobbies').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      if (!char) return;
      this.screenChar.classList.add('hidden');
      this.screenLobby.classList.remove('hidden');
      document.getElementById('lobby-error').classList.add('hidden');
      document.getElementById('lobby-hero-subtitle').textContent = `Hero: ${char.name} (${char.mode} Mode — strict partition)`;
      if (this.pendingInvite?.inviteCode) {
        document.getElementById('inp-invite-code').value = this.pendingInvite.inviteCode;
      }
      this.loadLobbies(char.mode);
    });

    document.getElementById('btn-lobby-back').addEventListener('click', () => {
      this.screenLobby.classList.add('hidden');
      this.screenChar.classList.remove('hidden');
    });

    document.getElementById('btn-lobby-refresh').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      if (char) this.loadLobbies(char.mode);
    });

    const btnVisPub = document.getElementById('btn-vis-public');
    const btnVisPriv = document.getElementById('btn-vis-private');
    btnVisPub.addEventListener('click', () => {
      this.roomVisibility = 'public';
      btnVisPub.className = 'border border-emerald-500 bg-emerald-950/30 text-emerald-200 py-1.5 rounded font-bold';
      btnVisPriv.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded font-bold';
    });
    btnVisPriv.addEventListener('click', () => {
      this.roomVisibility = 'private';
      btnVisPriv.className = 'border border-amber-500 bg-amber-950/30 text-amber-200 py-1.5 rounded font-bold';
      btnVisPub.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded font-bold';
    });

    document.getElementById('btn-accept-invite').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      if (!char || !this.pendingInvite || char.mode !== this.pendingInvite.mode) return;
      const code = this.pendingInvite.inviteCode;
      this.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', code);
      this.screenChar.classList.add('hidden');
    });

    document.getElementById('btn-join-invite').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      const code = extractInviteCode(document.getElementById('inp-invite-code').value);
      if (!char || !code) return;
      this.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', code);
      this.screenLobby.classList.add('hidden');
    });

    document.getElementById('btn-enter-multi').addEventListener('click', () => {
      const char = this.getSelectedCharacter();
      if (!char) return;
      const room = document.getElementById('inp-room').value.trim() || 'crypt_01';
      const pass = document.getElementById('inp-room-pass').value;
      this.onConnect(char.name, room, char.mode, char.classId, char.id, this.roomVisibility, pass);
      this.screenLobby.classList.add('hidden');
    });

    document.getElementById('btn-pause-invite').addEventListener('click', async () => {
      const errEl = document.getElementById('pause-invite-err');
      errEl.classList.add('hidden');
      const code = extractInviteCode(document.getElementById('inp-pause-invite').value);
      if (!code) return;
      if (code === this.getCurrentInviteCode()) {
        errEl.textContent = 'You are already in this room.';
        errEl.classList.remove('hidden');
        return;
      }
      const res = await fetch(`/api/invite?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        errEl.textContent = `Invite "${code}" not found or room closed.`;
        errEl.classList.remove('hidden');
        return;
      }
      const { invite } = await res.json();
      if (invite.players >= invite.maxPlayers) {
        errEl.textContent = `Room "${invite.name}" is full (${invite.players}/${invite.maxPlayers}).`;
        errEl.classList.remove('hidden');
        return;
      }
      const char = this.getSelectedCharacter();
      if (!char || char.mode !== invite.mode) {
        errEl.textContent = `Mode mismatch: requires a ${invite.mode} hero (exit to Hero Roster to switch).`;
        errEl.classList.remove('hidden');
        return;
      }
      document.getElementById('panel-pause').classList.add('hidden');
      document.getElementById('inp-pause-invite').value = '';
      this.onConnect(char.name, '', char.mode, char.classId, char.id, 'invite', '', invite.inviteCode);
    });
  }
}
