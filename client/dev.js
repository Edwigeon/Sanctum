import { SpriteStudio } from './dev/SpriteStudio.js';
import { SoundLab } from './dev/SoundLab.js';

let authToken = localStorage.getItem('sanctum_token') || null;
let currentAccount = null;

function getAuthHeaders() {
  return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

function showToast(msg, isError = false) {
  const el = document.getElementById('dev-toast');
  el.textContent = msg;
  el.className = isError
    ? 'text-rose-200 bg-rose-950/90 border border-rose-700 px-2.5 py-0.5 rounded'
    : 'text-emerald-300 bg-emerald-950/70 border border-emerald-700/60 px-2.5 py-0.5 rounded';
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

async function checkAuth() {
  const badge = document.getElementById('dev-auth-badge');
  const btn = document.getElementById('btn-dev-signin');
  if (!authToken) {
    badge.textContent = 'Read-Only (Sign in to save)';
    btn.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (res.ok) {
      const { account } = await res.json();
      currentAccount = account;
      if (account.role === 'moderator') {
        badge.textContent = `Mod: ${account.username}`;
        badge.className = 'text-emerald-400';
        btn.classList.add('hidden');
      } else {
        badge.textContent = `${account.username} (Not Mod)`;
        badge.className = 'text-amber-400';
        btn.classList.remove('hidden');
      }
    } else {
      authToken = null;
      localStorage.removeItem('sanctum_token');
      badge.textContent = 'Read-Only';
      btn.classList.remove('hidden');
    }
  } catch {
    badge.textContent = 'Offline';
  }
}

// Mod sign-in modal
const authModal = document.getElementById('dev-auth-modal');
document.getElementById('btn-dev-signin').addEventListener('click', () => authModal.classList.remove('hidden'));
document.getElementById('btn-dev-auth-close').addEventListener('click', () => authModal.classList.add('hidden'));
document.getElementById('btn-dev-login-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('dev-login-err');
  errEl.classList.add('hidden');
  const username = document.getElementById('dev-login-user').value.trim();
  const password = document.getElementById('dev-login-pass').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      errEl.textContent = data.error || 'Login failed';
      errEl.classList.remove('hidden');
      return;
    }
    if (data.account.role !== 'moderator') {
      errEl.textContent = 'Moderator role required.';
      errEl.classList.remove('hidden');
      return;
    }
    authToken = data.token;
    localStorage.setItem('sanctum_token', authToken);
    authModal.classList.add('hidden');
    await checkAuth();
    showToast(`Signed in as ${data.account.username}`);
  } catch {
    errEl.textContent = 'Network error';
    errEl.classList.remove('hidden');
  }
});

// Top Tab Switcher
const btnSprites = document.getElementById('tab-btn-sprites');
const btnAudio = document.getElementById('tab-btn-audio');
const viewSprites = document.getElementById('view-sprites');
const viewAudio = document.getElementById('view-audio');

let activeTab = 'sprites';
btnSprites.addEventListener('click', () => {
  activeTab = 'sprites';
  btnSprites.className = 'px-3 py-1 rounded bg-amber-600 text-slate-950 font-bold transition';
  btnAudio.className = 'px-3 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500 transition';
  viewSprites.classList.remove('hidden');
  viewAudio.classList.add('hidden');
});

btnAudio.addEventListener('click', () => {
  activeTab = 'audio';
  btnAudio.className = 'px-3 py-1 rounded bg-cyan-600 text-slate-950 font-bold transition';
  btnSprites.className = 'px-3 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500 transition';
  viewAudio.classList.remove('hidden');
  viewSprites.classList.add('hidden');
  soundLab.redrawScope();
});

const spriteStudio = new SpriteStudio({ getAuthHeaders, showToast });
const soundLab = new SoundLab({ getAuthHeaders, showToast, isTabActive: () => activeTab === 'audio' });

checkAuth();
spriteStudio.init();
soundLab.init();
