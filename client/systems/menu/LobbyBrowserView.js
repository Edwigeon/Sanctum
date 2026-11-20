/**
 * Multiplayer Realm Lobby Browser, Room Inspector & Matchmaking DOM View
 */

import { GAME_MODES } from '../../../shared/Constants.js';

export function startLobbyPolling(menu) {
  menu.stopLobbyPolling();
  menu.lobbyPollInterval = setInterval(() => {
    if (!menu.screenLobby.classList.contains('hidden') && menu.currentLobbyTab === 'join') {
      const char = menu.getSelectedCharacter();
      if (char) {
        menu.loadLobbies(char.mode, true);
      }
    }
  }, 3000);
}

export function stopLobbyPolling(menu) {
  if (menu.lobbyPollInterval) {
    clearInterval(menu.lobbyPollInterval);
    menu.lobbyPollInterval = null;
  }
}

export async function loadLobbies(menu, mode, silent = false) {
  const list = document.getElementById('lobby-list');
  if (!silent) {
    list.innerHTML = '<div class="text-slate-500 py-4 text-center">Scanning realms...</div>';
    menu.selectedLobby = null;
    menu.renderSelectedLobby();
  }

  try {
    const res = await fetch(`/api/lobbies?mode=${encodeURIComponent(mode)}`);
    const { lobbies } = await res.json();
    menu.cachedLobbies = lobbies || [];

    if (menu.selectedLobby) {
      const stillActive = menu.cachedLobbies.find(l => l.roomId === menu.selectedLobby.roomId);
      if (stillActive) {
        menu.selectedLobby = stillActive;
      } else if (!silent) {
        menu.selectedLobby = null;
      }
    }

    menu.filterLobbies();
  } catch {
    if (!silent) {
      list.innerHTML = '<div class="text-rose-400 py-4 text-center">Failed to scan realm lobbies</div>';
    }
  }
}

export function filterLobbies(menu) {
  const list = document.getElementById('lobby-list');
  const query = (document.getElementById('inp-filter-games')?.value || '').trim().toLowerCase();
  const mode = menu.getSelectedCharacter()?.mode || GAME_MODES.CLASSIC;

  let filtered = menu.cachedLobbies;
  if (query) {
    filtered = filtered.filter(l => l.name.toLowerCase().includes(query) || (l.biome && l.biome.toLowerCase().includes(query)));
  }

  list.innerHTML = '';
  if (!filtered || filtered.length === 0) {
    list.innerHTML = `<div class="text-slate-500 py-8 text-center text-xs">No active ${mode} games matching filter.<br>Forge a new realm under [Create Game]!</div>`;
    menu.selectedLobby = null;
    menu.renderSelectedLobby();
    return;
  }

  for (const l of filtered) {
    const row = document.createElement('div');
    const isSelected = menu.selectedLobby && menu.selectedLobby.roomId === l.roomId;
    row.className = `grid grid-cols-12 items-center p-2 rounded cursor-pointer border transition text-xs font-mono ${
      isSelected
        ? 'border-amber-500 bg-amber-950/40 text-amber-200 shadow-md ring-1 ring-amber-500/50'
        : 'border-slate-800 bg-slate-900/70 hover:border-slate-600 text-slate-200'
    }`;
    row.innerHTML = `
      <div class="col-span-6 flex items-center gap-1.5 truncate font-bold">
        ${l.hasPassword ? '<span class="text-amber-400 text-[10px]">🔒</span>' : ''}
        <span class="truncate">${l.name}</span>
      </div>
      <div class="col-span-3 text-center text-[11px] ${l.players >= l.maxPlayers ? 'text-rose-400' : 'text-emerald-400'}">
        ${l.players}/${l.maxPlayers}
      </div>
      <div class="col-span-3 text-right text-[10px] text-slate-400 truncate">
        F${l.floor} • ${l.biome || 'Crypts'}
      </div>
    `;

    row.addEventListener('click', () => {
      menu.selectedLobby = l;
      menu.filterLobbies();
      menu.renderSelectedLobby();
    });

    list.appendChild(row);
  }

  if (!menu.selectedLobby && filtered.length > 0) {
    menu.selectedLobby = filtered[0];
    menu.renderSelectedLobby();
  }
}

export function renderSelectedLobby(menu) {
  const l = menu.selectedLobby;
  const nameEl = document.getElementById('detail-game-name');
  const metaEl = document.getElementById('detail-game-meta');
  const lockEl = document.getElementById('detail-game-lock');
  const countEl = document.getElementById('detail-player-count');
  const rosterEl = document.getElementById('detail-player-list');
  const passBox = document.getElementById('detail-password-box');
  const joinBtn = document.getElementById('btn-detail-join');

  if (!l) {
    nameEl.textContent = 'Select a Game';
    metaEl.textContent = 'No game selected';
    lockEl.classList.add('hidden');
    countEl.textContent = '0/4';
    rosterEl.innerHTML = '<div class="text-slate-500 text-center py-4 text-[11px]">Click a game on the left to inspect</div>';
    passBox.classList.add('hidden');
    joinBtn.disabled = true;
    return;
  }

  nameEl.textContent = l.name;
  metaEl.textContent = `${l.mode} Mode • Floor ${l.floor} (${l.biome || 'Depths'})`;
  if (l.hasPassword) lockEl.classList.remove('hidden');
  else lockEl.classList.add('hidden');

  countEl.textContent = `${l.players}/${l.maxPlayers}`;
  const isFull = l.players >= l.maxPlayers;
  joinBtn.disabled = isFull;
  joinBtn.textContent = isFull ? 'Game Full' : 'Join Game';

  if (l.hasPassword && !isFull) {
    passBox.classList.remove('hidden');
  } else {
    passBox.classList.add('hidden');
  }

  rosterEl.innerHTML = '';
  const players = l.playerList || [];
  if (players.length === 0) {
    rosterEl.innerHTML = '<div class="text-slate-500 text-center py-2 text-[11px]">No active players inside</div>';
  } else {
    for (const p of players) {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between py-1 px-2 rounded bg-slate-950/70 border border-slate-800 text-[11px]';
      const classIcon = p.classId === 'VANGUARD' ? '🛡️' : (p.classId === 'ARCANIST' ? '⚡' : '🗡️');
      item.innerHTML = `
        <span class="font-bold text-slate-200 truncate flex items-center gap-1.5">
          <span>${classIcon}</span> ${p.name}
        </span>
        <span class="text-[10px] text-amber-300 font-mono">Lvl ${p.level} ${p.className || p.classId}</span>
      `;
      rosterEl.appendChild(item);
    }
  }
}

export function bindLobbyBrowserEvents(menu) {
  document.getElementById('btn-open-lobbies').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (!char) return;
    menu.screenChar.classList.add('hidden');
    menu.screenLobby.classList.remove('hidden');
    document.getElementById('lobby-error').classList.add('hidden');
    document.getElementById('lobby-hero-subtitle').textContent = `Hero: ${char.name} (${char.mode} Mode)`;
    const badgeEl = document.getElementById('lobby-mode-badge');
    if (badgeEl) {
      badgeEl.textContent = `${char.mode} Realm`;
      badgeEl.className = char.mode === GAME_MODES.HARDCORE
        ? 'px-2 py-0.5 rounded text-[10px] font-mono border border-rose-700/60 bg-rose-950/70 text-rose-300'
        : 'px-2 py-0.5 rounded text-[10px] font-mono border border-indigo-700/50 bg-indigo-950/60 text-indigo-300';
    }
    if (menu.pendingInvite?.inviteToken || menu.pendingInvite?.inviteCode) {
      document.getElementById('inp-invite-code').value = menu.pendingInvite.inviteToken || menu.pendingInvite.inviteCode;
    }

    menu.roomVisibility = 'public';
    const btnVisPub = document.getElementById('btn-vis-public');
    const btnVisPriv = document.getElementById('btn-vis-private');
    if (btnVisPub && btnVisPriv) {
      btnVisPub.className = 'btn-locked-pressed border border-emerald-500 bg-emerald-950/40 text-emerald-200 py-2 rounded font-bold text-center';
      btnVisPriv.className = 'border border-slate-800 bg-slate-900 text-slate-400 py-2 rounded font-bold text-center';
    }

    menu.loadLobbies(char.mode);
    menu.startLobbyPolling();
  });

  const tabJoin = document.getElementById('tab-btn-join');
  const tabCreate = document.getElementById('tab-btn-create');
  const contentJoin = document.getElementById('tab-join-content');
  const contentCreate = document.getElementById('tab-create-content');

  if (tabJoin && tabCreate) {
    tabJoin.addEventListener('click', () => {
      menu.currentLobbyTab = 'join';
      tabJoin.className = 'flex-1 py-2.5 border-b-2 border-amber-500 text-amber-300 bg-slate-900/90 transition text-center flex items-center justify-center gap-1.5';
      tabCreate.className = 'flex-1 py-2.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 bg-transparent transition text-center flex items-center justify-center gap-1.5';
      contentJoin?.classList.remove('hidden');
      contentCreate?.classList.add('hidden');
      const char = menu.getSelectedCharacter();
      if (char) menu.loadLobbies(char.mode, true);
    });

    tabCreate.addEventListener('click', () => {
      menu.currentLobbyTab = 'create';
      tabCreate.className = 'flex-1 py-2.5 border-b-2 border-amber-500 text-amber-300 bg-slate-900/90 transition text-center flex items-center justify-center gap-1.5';
      tabJoin.className = 'flex-1 py-2.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 bg-transparent transition text-center flex items-center justify-center gap-1.5';
      contentCreate?.classList.remove('hidden');
      contentJoin?.classList.add('hidden');
    });
  }

  document.getElementById('inp-filter-games')?.addEventListener('input', () => {
    menu.filterLobbies();
  });

  document.getElementById('btn-detail-join')?.addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    const l = menu.selectedLobby;
    if (!char || !l) return;
    const pass = document.getElementById('detail-inp-pass')?.value || '';
    menu.stopLobbyPolling();
    menu.onConnect(char.name, l.name, char.mode, char.classId, char.id, 'public', pass);
    menu.screenLobby.classList.add('hidden');
  });

  document.getElementById('btn-lobby-back').addEventListener('click', () => {
    menu.stopLobbyPolling();
    menu.screenLobby.classList.add('hidden');
    menu.screenChar.classList.remove('hidden');
  });

  document.getElementById('btn-lobby-refresh').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (char) menu.loadLobbies(char.mode);
  });

  const btnVisPub = document.getElementById('btn-vis-public');
  const btnVisPriv = document.getElementById('btn-vis-private');
  btnVisPub.addEventListener('click', () => {
    menu.roomVisibility = 'public';
    btnVisPub.className = 'btn-locked-pressed border border-emerald-500 bg-emerald-950/40 text-emerald-200 py-2 rounded font-bold text-center';
    btnVisPriv.className = 'border border-slate-800 bg-slate-900 text-slate-400 py-2 rounded font-bold text-center';
  });
  btnVisPriv.addEventListener('click', () => {
    menu.roomVisibility = 'private';
    btnVisPriv.className = 'btn-locked-pressed border border-amber-500 bg-amber-950/40 text-amber-200 py-2 rounded font-bold text-center';
    btnVisPub.className = 'border border-slate-800 bg-slate-900 text-slate-400 py-2 rounded font-bold text-center';
  });

  document.getElementById('btn-enter-multi').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (!char) return;
    const room = document.getElementById('inp-room').value.trim() || 'cathedral_01';
    const pass = document.getElementById('inp-room-pass').value;
    const maxPlayers = parseInt(document.getElementById('sel-max-players')?.value, 10) || 4;
    menu.stopLobbyPolling();
    menu.onConnect(char.name, room, char.mode, char.classId, char.id, menu.roomVisibility, pass, '', '', maxPlayers);
    menu.screenLobby.classList.add('hidden');
  });
}
