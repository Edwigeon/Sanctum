/**
 * Hero Roster, Character Creation & Class/Mode Selection DOM View
 */

import { GAME_MODES } from '../../../shared/Constants.js';

export async function loadCharacterRoster(menu) {
  if (!menu.authToken) return;
  try {
    const res = await fetch('/api/characters', { headers: menu.authHeaders() });
    if (res.status === 401) {
      menu.authToken = null;
      menu.currentAccount = null;
      localStorage.removeItem('sanctum_token');
      menu.updateAuthUI();
      menu.screenChar.classList.add('hidden');
      menu.screenAuth.classList.remove('hidden');
      return;
    }
    const data = await res.json();
    menu.savedCharacters = data.characters || [];
    const reqMode = menu.pendingInvite?.mode || null;
    const isEligible = (c) => !(c.mode === GAME_MODES.HARDCORE && c.isDead) && (!reqMode || c.mode === reqMode);
    if (!menu.selectedCharacterId || !menu.savedCharacters.some(c => c.id === menu.selectedCharacterId && isEligible(c))) {
      const preferred = menu.savedCharacters.find(isEligible) || menu.savedCharacters.find(c => !(c.mode === GAME_MODES.HARDCORE && c.isDead));
      menu.selectedCharacterId = preferred ? preferred.id : null;
    }
    menu.renderRoster();
  } catch (err) {
    console.error('Failed to load characters:', err);
  }
}

export function renderRoster(menu) {
  const list = document.getElementById('char-roster-list');
  const btnSolo = document.getElementById('btn-enter-solo');
  const btnLobbies = document.getElementById('btn-open-lobbies');
  const btnInvite = document.getElementById('btn-accept-invite');
  list.innerHTML = '';

  if (menu.savedCharacters.length === 0) {
    list.innerHTML = '<div class="text-[11px] font-mono text-slate-500 py-6 text-center">No heroes yet. Forge one on the right →</div>';
    btnSolo.disabled = true;
    btnLobbies.disabled = true;
    btnInvite.classList.add('hidden');
    return;
  }

  for (const c of menu.savedCharacters) {
    const isFallen = c.mode === GAME_MODES.HARDCORE && c.isDead;
    const modeMismatch = !!menu.pendingInvite && c.mode !== menu.pendingInvite.mode;
    const isSelected = c.id === menu.selectedCharacterId && !isFallen;
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
    const mismatchBadge = modeMismatch ? ` <span class="text-[9px] font-mono text-amber-400">Needs ${menu.pendingInvite.mode}</span>` : '';
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
      await fetch(`/api/characters?id=${encodeURIComponent(c.id)}`, { method: 'DELETE', headers: menu.authHeaders() });
      if (menu.selectedCharacterId === c.id) menu.selectedCharacterId = null;
      await menu.loadCharacterRoster();
    });

    if (!isFallen) {
      row.addEventListener('click', () => {
        menu.selectedCharacterId = c.id;
        menu.renderRoster();
      });
    }

    row.appendChild(info);
    row.appendChild(delBtn);
    list.appendChild(row);
  }

  const sel = menu.getSelectedCharacter();
  const canPlay = !!sel && !(sel.mode === GAME_MODES.HARDCORE && sel.isDead);
  btnSolo.disabled = !canPlay;
  btnLobbies.disabled = !canPlay;

  if (menu.pendingInvite) {
    btnInvite.classList.remove('hidden');
    const isFull = menu.pendingInvite.players >= menu.pendingInvite.maxPlayers;
    const modeOk = canPlay && sel.mode === menu.pendingInvite.mode;
    btnInvite.disabled = !modeOk || isFull;
    btnInvite.textContent = isFull
      ? `Room Full (${menu.pendingInvite.players}/${menu.pendingInvite.maxPlayers})`
      : modeOk
        ? `Accept Invite & Join "${menu.pendingInvite.name}"`
        : `Select or Forge a ${menu.pendingInvite.mode} Hero`;
  } else {
    btnInvite.classList.add('hidden');
  }
}

export function bindCharacterRosterEvents(menu) {
  document.getElementById('btn-char-back').addEventListener('click', () => {
    menu.screenChar.classList.add('hidden');
    menu.screenMain.classList.remove('hidden');
  });

  document.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('click', () => {
      menu.selectedClass = card.dataset.class;
      document.querySelectorAll('.class-card').forEach(c => {
        c.classList.remove('btn-locked-pressed');
        c.className = 'class-card text-left p-2 rounded-lg border border-slate-800 bg-slate-950/60 hover:border-slate-600 transition';
      });
      card.classList.add('btn-locked-pressed');
      card.className = 'class-card btn-locked-pressed text-left p-2 rounded-lg border-2 border-amber-500 bg-amber-950/20 transition';
    });
  });

  menu.btnClassic.addEventListener('click', () => {
    menu.currentMode = GAME_MODES.CLASSIC;
    menu.btnClassic.className = 'btn-locked-pressed border border-amber-500 bg-amber-950/40 text-amber-200 py-1.5 rounded text-center font-bold';
    menu.btnHardcore.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded text-center font-bold hover:border-rose-900 transition';
  });

  menu.btnHardcore.addEventListener('click', () => {
    menu.currentMode = GAME_MODES.HARDCORE;
    menu.btnHardcore.className = 'btn-locked-pressed border border-rose-600 bg-rose-950/40 text-rose-200 py-1.5 rounded text-center font-bold';
    menu.btnClassic.className = 'border border-slate-800 bg-slate-950/40 text-slate-400 py-1.5 rounded text-center font-bold hover:border-amber-900 transition';
  });

  document.getElementById('btn-create-char').addEventListener('click', async () => {
    const name = document.getElementById('inp-name').value.trim() || 'Wanderer';
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...menu.authHeaders() },
      body: JSON.stringify({ name, classId: menu.selectedClass, mode: menu.currentMode })
    });
    const data = await res.json();
    if (data.character) {
      menu.selectedCharacterId = data.character.id;
      await menu.loadCharacterRoster();
    }
  });

  document.getElementById('btn-enter-solo').addEventListener('click', () => {
    const char = menu.getSelectedCharacter();
    if (!char) return;
    menu.onConnect(char.name, '', char.mode, char.classId, char.id, 'solo', '');
    menu.screenChar.classList.add('hidden');
  });
}
