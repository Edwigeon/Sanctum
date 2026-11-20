import { GAME_MODES } from '../../shared/Constants.js';
import {
  parseInviteInput,
  clearPendingInvite,
  updateInviteBanner,
  resolvePendingInvite,
  bindInviteEvents
} from './menu/InviteHelper.js';
import {
  updateAuthUI,
  checkAuth,
  submitAuth,
  bindAuthEvents
} from './menu/AuthView.js';
import {
  loadCharacterRoster,
  renderRoster,
  bindCharacterRosterEvents
} from './menu/CharacterRosterView.js';
import {
  startLobbyPolling,
  stopLobbyPolling,
  loadLobbies,
  filterLobbies,
  renderSelectedLobby,
  bindLobbyBrowserEvents
} from './menu/LobbyBrowserView.js';

export { parseInviteInput };

export class MenuController {
  constructor({ onConnect, getCurrentInviteCode, audio = null }) {
    this.onConnect = onConnect;
    this.getCurrentInviteCode = getCurrentInviteCode;
    this.audio = audio;

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

    this.selectedLobby = null;
    this.cachedLobbies = [];
    this.currentLobbyTab = 'join';
    this.lobbyPollInterval = null;

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
    this.audio?.resetMacroState?.();
    this.stopLobbyPolling();
    this.screenMain.classList.remove('hidden');
  }

  showLobbyError(message, mode) {
    const errEl = document.getElementById('lobby-error');
    errEl.textContent = message || 'Unable to join room.';
    errEl.classList.remove('hidden');
    this.screenLobby.classList.remove('hidden');
    this.loadLobbies(mode);
    this.startLobbyPolling();
  }

  updateAuthUI() {
    updateAuthUI(this);
  }

  clearPendingInvite() {
    clearPendingInvite(this);
  }

  updateInviteBanner() {
    updateInviteBanner(this);
  }

  async resolvePendingInvite(rawInput) {
    return resolvePendingInvite(this, rawInput);
  }

  async checkAuth() {
    return checkAuth(this);
  }

  async submitAuth(endpoint) {
    return submitAuth(this, endpoint);
  }

  async loadCharacterRoster() {
    return loadCharacterRoster(this);
  }

  renderRoster() {
    renderRoster(this);
  }

  startLobbyPolling() {
    startLobbyPolling(this);
  }

  stopLobbyPolling() {
    stopLobbyPolling(this);
  }

  async loadLobbies(mode, silent = false) {
    return loadLobbies(this, mode, silent);
  }

  filterLobbies() {
    filterLobbies(this);
  }

  renderSelectedLobby() {
    renderSelectedLobby(this);
  }

  bindEvents() {
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

    bindInviteEvents(this);
    bindAuthEvents(this);
    bindCharacterRosterEvents(this);
    bindLobbyBrowserEvents(this);
  }
}
