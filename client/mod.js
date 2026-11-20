let token = localStorage.getItem('sanctum_token') || null;
let editingChar = null;

function authHeaders() {
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function init() {
  const loginBox = document.getElementById('mod-login-box');
  const changeBox = document.getElementById('mod-change-pass-box');
  const dash = document.getElementById('mod-dashboard');
  const badge = document.getElementById('mod-user-badge');

  if (!token) {
    loginBox.classList.remove('hidden');
    dash.classList.add('hidden');
    return;
  }

  try {
    const { account } = await api('/api/auth/me');
    if (account.role !== 'moderator') {
      badge.textContent = `${account.username} (Not a Moderator)`;
      loginBox.classList.remove('hidden');
      dash.classList.add('hidden');
      return;
    }
    if (account.mustChangePassword) {
      badge.textContent = `${account.username} (Password Change Required)`;
      loginBox.classList.remove('hidden');
      changeBox?.classList.remove('hidden');
      dash.classList.add('hidden');
      return;
    }
    changeBox?.classList.add('hidden');
    badge.textContent = `Signed in: ${account.username}`;
    loginBox.classList.add('hidden');
    dash.classList.remove('hidden');
    await Promise.all([loadOverview(), searchCharacters(), searchAccounts()]);
  } catch {
    loginBox.classList.remove('hidden');
    dash.classList.add('hidden');
  }
}

document.getElementById('btn-mod-change-pass')?.addEventListener('click', async () => {
  const errEl = document.getElementById('mod-login-err');
  errEl.classList.add('hidden');
  const currentPassword = document.getElementById('mod-login-pass').value;
  const newPassword = document.getElementById('mod-new-pass').value;
  const confirmPassword = document.getElementById('mod-new-pass-confirm').value;
  try {
    const data = await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    token = data.token;
    localStorage.setItem('sanctum_token', token);
    document.getElementById('mod-login-pass').value = '';
    document.getElementById('mod-new-pass').value = '';
    document.getElementById('mod-new-pass-confirm').value = '';
    await init();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('btn-mod-login').addEventListener('click', async () => {
  const errEl = document.getElementById('mod-login-err');
  errEl.classList.add('hidden');
  const username = document.getElementById('mod-login-user').value.trim();
  const password = document.getElementById('mod-login-pass').value;
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.account.role !== 'moderator') {
      errEl.textContent = 'Account does not have moderator privileges.';
      errEl.classList.remove('hidden');
      return;
    }
    token = data.token;
    localStorage.setItem('sanctum_token', token);
    await init();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

async function loadOverview() {
  const data = await api('/api/mod/overview');
  document.getElementById('stat-accounts').textContent = data.totalAccounts;
  document.getElementById('stat-chars').textContent = data.totalCharacters;
  document.getElementById('stat-fallen').textContent = data.fallenHeroes;
  document.getElementById('stat-expiring').textContent = data.expiringSoon;
}

document.getElementById('btn-prune').addEventListener('click', async () => {
  const res = await api('/api/mod/prune', { method: 'POST' });
  alert(`Pruned ${res.prunedAccounts} expired account(s) and ${res.prunedSessions} expired session(s).`);
  await Promise.all([loadOverview(), searchAccounts(), searchCharacters()]);
});

// Tabs
const tabChars = document.getElementById('tab-chars');
const tabAccounts = document.getElementById('tab-accounts');
const viewChars = document.getElementById('view-chars');
const viewAccounts = document.getElementById('view-accounts');

tabChars.addEventListener('click', () => {
  tabChars.className = 'px-3 py-1.5 rounded bg-indigo-600 text-white font-bold';
  tabAccounts.className = 'px-3 py-1.5 rounded bg-slate-900 text-slate-300 border border-slate-800';
  viewChars.classList.remove('hidden');
  viewAccounts.classList.add('hidden');
});

tabAccounts.addEventListener('click', () => {
  tabAccounts.className = 'px-3 py-1.5 rounded bg-indigo-600 text-white font-bold';
  tabChars.className = 'px-3 py-1.5 rounded bg-slate-900 text-slate-300 border border-slate-800';
  viewAccounts.classList.remove('hidden');
  viewChars.classList.add('hidden');
});

// Characters Search & Edit
async function searchCharacters() {
  const q = document.getElementById('search-char-q').value.trim();
  const mode = document.getElementById('search-char-mode').value;
  const { characters } = await api(`/api/mod/characters?q=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}`);
  const tbody = document.getElementById('tbody-chars');
  tbody.innerHTML = '';

  for (const c of characters) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40';
    tr.innerHTML = `
      <td class="p-2.5 font-bold text-slate-100">${escapeHtml(c.name)}</td>
      <td class="p-2.5 text-slate-300">${escapeHtml(c.ownerUsername)}</td>
      <td class="p-2.5">${escapeHtml(c.classId)} <span class="text-[10px] px-1 rounded ${c.mode === 'HARDCORE' ? 'bg-rose-950 text-rose-300' : 'bg-indigo-950 text-indigo-300'}">${escapeHtml(c.mode)}</span></td>
      <td class="p-2.5">Lv ${Number(c.level) || 1} • Fl ${Number(c.highestFloor) || 1}</td>
      <td class="p-2.5">${c.isDead ? '<span class="text-rose-400">FALLEN</span>' : '<span class="text-emerald-400">ALIVE</span>'}</td>
      <td class="p-2.5 text-right space-x-1.5">
        <button class="btn-edit px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[10px]">Edit</button>
        <button class="btn-del px-2 py-1 rounded bg-rose-900/70 hover:bg-rose-800 text-rose-200 text-[10px]">Delete</button>
      </td>
    `;
    tr.querySelector('.btn-edit').addEventListener('click', () => openEditor(c));
    tr.querySelector('.btn-del').addEventListener('click', async () => {
      if (!confirm(`Delete character "${c.name}"?`)) return;
      await api(`/api/mod/characters?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      await Promise.all([loadOverview(), searchCharacters()]);
    });
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-search-chars').addEventListener('click', searchCharacters);

function openEditor(c) {
  editingChar = c;
  document.getElementById('ed-name').value = c.name;
  document.getElementById('ed-level').value = c.level;
  document.getElementById('ed-xp').value = c.xp;
  document.getElementById('ed-statpts').value = c.statPoints;
  document.getElementById('ed-potions').value = c.potions;
  document.getElementById('ed-floor').value = c.highestFloor;
  document.getElementById('ed-might').value = c.stats?.might ?? 10;
  document.getElementById('ed-focus').value = c.stats?.focus ?? 10;
  document.getElementById('ed-agility').value = c.stats?.agility ?? 10;
  document.getElementById('ed-vitality').value = c.stats?.vitality ?? 10;
  document.getElementById('ed-dead').checked = !!c.isDead;
  document.getElementById('ed-inv').value = JSON.stringify(c.inventory || [], null, 2);
  document.getElementById('ed-err').classList.add('hidden');
  document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-edit-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
  editingChar = null;
});

document.getElementById('btn-edit-save').addEventListener('click', async () => {
  if (!editingChar) return;
  const errEl = document.getElementById('ed-err');
  errEl.classList.add('hidden');
  let inv;
  try {
    inv = JSON.parse(document.getElementById('ed-inv').value);
    if (!Array.isArray(inv)) throw new Error('Inventory must be a JSON array.');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    return;
  }

  await api(`/api/mod/characters?id=${encodeURIComponent(editingChar.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: document.getElementById('ed-name').value,
      level: Number(document.getElementById('ed-level').value),
      xp: Number(document.getElementById('ed-xp').value),
      statPoints: Number(document.getElementById('ed-statpts').value),
      potions: Number(document.getElementById('ed-potions').value),
      highestFloor: Number(document.getElementById('ed-floor').value),
      isDead: document.getElementById('ed-dead').checked,
      stats: {
        might: Number(document.getElementById('ed-might').value),
        focus: Number(document.getElementById('ed-focus').value),
        agility: Number(document.getElementById('ed-agility').value),
        vitality: Number(document.getElementById('ed-vitality').value)
      },
      inventory: inv
    })
  });

  document.getElementById('edit-modal').classList.add('hidden');
  editingChar = null;
  await searchCharacters();
});

// Accounts Search & Actions
async function searchAccounts() {
  const q = document.getElementById('search-acc-q').value.trim();
  const { accounts } = await api(`/api/mod/accounts?q=${encodeURIComponent(q)}`);
  const tbody = document.getElementById('tbody-accs');
  tbody.innerHTML = '';

  for (const a of accounts) {
    const daysLeft = Math.max(0, Math.ceil((a.expires_at - Date.now()) / (24 * 60 * 60 * 1000)));
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40';
    tr.innerHTML = `
      <td class="p-2.5 font-bold text-slate-100">${escapeHtml(a.username)}</td>
      <td class="p-2.5">${a.role === 'moderator' ? '<span class="text-amber-300">moderator</span>' : 'player'}</td>
      <td class="p-2.5">${Number(a.char_count) || 0}</td>
      <td class="p-2.5">${a.role === 'moderator' ? 'Exempt' : `${daysLeft}d`}</td>
      <td class="p-2.5">${a.is_banned ? '<span class="text-rose-400">BANNED</span>' : '<span class="text-emerald-400">ACTIVE</span>'}</td>
      <td class="p-2.5 text-right space-x-1">
        <button class="btn-extend px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]">+180d</button>
        <button class="btn-ban px-2 py-1 rounded ${a.is_banned ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-800 text-amber-100'} text-[10px]">${a.is_banned ? 'Unban' : 'Ban'}</button>
        <button class="btn-role px-2 py-1 rounded bg-indigo-900 text-indigo-200 text-[10px]">${a.role === 'moderator' ? 'Demote' : 'Make Mod'}</button>
        <button class="btn-del px-2 py-1 rounded bg-rose-900/70 hover:bg-rose-800 text-rose-200 text-[10px]">Delete</button>
      </td>
    `;
    tr.querySelector('.btn-extend').addEventListener('click', async () => {
      await api(`/api/mod/accounts?id=${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ extendRetention: true }) });
      await searchAccounts();
    });
    tr.querySelector('.btn-ban').addEventListener('click', async () => {
      await api(`/api/mod/accounts?id=${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ isBanned: !a.is_banned }) });
      await searchAccounts();
    });
    tr.querySelector('.btn-role').addEventListener('click', async () => {
      const nextRole = a.role === 'moderator' ? 'player' : 'moderator';
      await api(`/api/mod/accounts?id=${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ role: nextRole }) });
      await searchAccounts();
    });
    tr.querySelector('.btn-del').addEventListener('click', async () => {
      if (!confirm(`Delete account "${a.username}" and all its characters?`)) return;
      await api(`/api/mod/accounts?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      await Promise.all([loadOverview(), searchAccounts(), searchCharacters()]);
    });
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-search-accs').addEventListener('click', searchAccounts);

init();
