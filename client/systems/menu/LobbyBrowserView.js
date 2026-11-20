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
    const isFull = l.players >= l.maxPlayers;
    const statusOrb = isFull ? '🔴' : (l.hasPassword ? '🔒' : '🟢');
    row.className = `grid grid-cols-12 items-center p-2.5 rounded cursor-pointer border transition text-xs font-mono ${
      isSelected
        ? 'border-amber-500 bg-amber-950/50 text-amber-200 shadow-md ring-1 ring-amber-500/60'
        : 'border-slate-800 bg-slate-900/70 hover:border-slate-600 hover:bg-slate-900/90 text-slate-200'
    }`;
    row.innerHTML = `
      <div class="col-span-6 flex items-center gap-1.5 truncate font-bold">
        ${l.hasPassword ? '<span class="text-amber-400 text-[10px]">🔒</span>' : '<span class="text-amber-500/80 text-[10px]">⚔</span>'}
        <span class="truncate">${l.name}</span>
      </div>
      <div class="col-span-3 text-center text-[11px] font-bold flex items-center justify-center gap-1.5 ${isFull ? 'text-rose-400' : 'text-emerald-400'}">
        <span class="text-[9px]">${statusOrb}</span>
        <span>${l.players}/${l.maxPlayers}</span>
      </div>
      <div class="col-span-3 text-right text-[10px] text-slate-400 truncate">
        F${l.floor} • ${l.biome || 'Cathedral'}
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
    if (menu.pendingInvite?.inviteToken) {
      const inp = document.getElementById('inp-invite-token') || document.getElementById('inp-invite-code');
      if (inp) inp.value = menu.pendingInvite.inviteToken;
    }

    const tabJoin = document.getElementById('tab-btn-join');
    const tabCreate = document.getElementById('tab-btn-create');
    const contentJoin = document.getElementById('tab-join-content');
    const contentCreate = document.getElementById('tab-create-content');
    tabJoin?.classList.add('d2-tab-active');
    tabCreate?.classList.remove('d2-tab-active');
    contentJoin?.classList.remove('hidden');
    contentCreate?.classList.add('hidden');
    menu.currentLobbyTab = 'join';

    const modeSummary = document.getElementById('create-mode-summary');
    if (modeSummary) {
      modeSummary.textContent = `${char.mode} Mode • ${char.mode === GAME_MODES.HARDCORE ? 'Permadeath' : 'Normal Respawn'}`;
    }

    menu.roomVisibility = 'public';
    const btnVisPub = document.getElementById('btn-vis-public');
    const btnVisPriv = document.getElementById('btn-vis-private');
    const descEl = document.getElementById('create-vis-description');
    if (btnVisPub && btnVisPriv) {
      btnVisPub.classList.add('btn-locked-pressed');
      btnVisPriv.classList.remove('btn-locked-pressed');
      if (descEl) {
        descEl.className = 'text-[11px] text-emerald-300/90 bg-emerald-950/20 border border-emerald-900/50 rounded p-2.5';
        descEl.textContent = 'Public realm: Broadcast in the browser for any adventurer to inspect and join.';
      }
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
      tabJoin.classList.add('d2-tab-active');
      tabCreate.classList.remove('d2-tab-active');
      contentJoin?.classList.remove('hidden');
      contentCreate?.classList.add('hidden');
      const char = menu.getSelectedCharacter();
      if (char) menu.loadLobbies(char.mode, true);
    });

    tabCreate.addEventListener('click', () => {
      menu.currentLobbyTab = 'create';
      tabCreate.classList.add('d2-tab-active');
      tabJoin.classList.remove('d2-tab-active');
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

  const exitLobby = () => {
    menu.stopLobbyPolling();
    menu.screenLobby.classList.add('hidden');
    menu.screenChar.classList.remove('hidden');
  };
  document.getElementById('btn-lobby-back')?.addEventListener('click', exitLobby);
  document.getElementById('btn-lobby-exit-join')?.addEventListener('click', exitLobby);
  document.getElementById('btn-lobby-exit-create')?.addEventListener('click', exitLobby);

  document.getElementById('btn-lobby-refresh')?.addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (char) menu.loadLobbies(char.mode);
  });

  const btnVisPub = document.getElementById('btn-vis-public');
  const btnVisPriv = document.getElementById('btn-vis-private');
  const descEl = document.getElementById('create-vis-description');
  if (btnVisPub && btnVisPriv) {
    btnVisPub.addEventListener('click', () => {
      menu.roomVisibility = 'public';
      btnVisPub.classList.add('btn-locked-pressed');
      btnVisPriv.classList.remove('btn-locked-pressed');
      if (descEl) {
        descEl.className = 'text-[11px] text-emerald-300/90 bg-emerald-950/20 border border-emerald-900/50 rounded p-2.5';
        descEl.textContent = 'Public realm: Broadcast in the browser for any adventurer to inspect and join.';
      }
    });
    btnVisPriv.addEventListener('click', () => {
      menu.roomVisibility = 'private';
      btnVisPriv.classList.add('btn-locked-pressed');
      btnVisPub.classList.remove('btn-locked-pressed');
      if (descEl) {
        descEl.className = 'text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/50 rounded p-2.5';
        descEl.textContent = 'Unlisted realm: Hidden from the realm browser. Adventurers can only enter via direct invite link or 6-digit code.';
      }
    });
  }

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
