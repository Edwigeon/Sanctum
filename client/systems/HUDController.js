import { PACKET_TYPES } from '../../shared/Constants.js';
import { UIInventory } from './ui/containers/UIInventory.js';
import { UICharacter } from './ui/containers/UICharacter.js';
import {
  PAPERDOLL_SLOTS,
  STAT_LABELS,
  formatItemStats,
  renderStatRow,
  showConsumableTooltip,
  showComparisonTooltip,
  showEquippedTooltip,
  positionTooltip,
  hideComparisonTooltip
} from './hud/ItemTooltipDOM.js';
import {
  syncAudioUI,
  updatePauseInviteDisplay,
  setInvite,
  bindPauseAndAudioEvents
} from './hud/PauseAudioDOM.js';
import {
  initBitSpriteIcons,
  bindPaperdollEvents,
  updateVitalsAndDeathDOM,
  updateCharacterSheetDOM,
  updateInventoryAndPaperdollDOM
} from './hud/CharacterInventoryDOM.js';

export { PAPERDOLL_SLOTS, STAT_LABELS, formatItemStats, renderStatRow };

export class HUDController {
  constructor({ renderer, audio, sendPacket, onExitToMenu }) {
    this.renderer = renderer;
    this.audio = audio;
    this.sendPacket = sendPacket;
    this.onExitToMenu = onExitToMenu;

    this.panelChar = document.getElementById('panel-char');
    this.panelInv = document.getElementById('panel-inv');
    this.panelPause = document.getElementById('panel-pause');
    this.panelDeath = document.getElementById('panel-death');

    this.lastInvKey = '';
    this.lastVitalsKey = '';
    this.lastPrivRef = null;
    this.currentInviteToken = '';
    this.isInviteRevealed = false;
    this.combatRemainingMs = 0;
    this.isDead = false;

    this.bindEvents();
    this.initAudioSettings();
    this.initBitSpriteIcons();

    // Canvas-Native Inventory
    this.uiInventory = new UIInventory({
      sendPacket: this.sendPacket,
      audio: this.audio,
      onClose: () => this.toggleInv()
    });
    this.renderer.uiManager?.register(this.uiInventory);
    this.uiInventory.visible = false;

    // Canvas-Native Character Sheet
    this.uiCharacter = new UICharacter({
      sendPacket: this.sendPacket,
      audio: this.audio,
      onClose: () => this.toggleChar()
    });
    this.renderer.uiManager?.register(this.uiCharacter);
    this.uiCharacter.visible = false;
  }

  initBitSpriteIcons() {
    initBitSpriteIcons();
  }

  initAudioSettings() {
    if (!this.audio) return;
    this.syncAudioUI(this.audio.settings);
    this.audio.onSettingsChange((settings) => this.syncAudioUI(settings));
  }

  syncAudioUI(settings) {
    syncAudioUI(settings);
  }

  bindEvents() {
    document.getElementById('btn-toggle-char')?.addEventListener('click', () => this.toggleChar());
    document.getElementById('btn-close-char')?.addEventListener('click', () => {
      this.panelChar.classList.add('hidden');
      this.updateHUDButtonStates();
    });
    document.getElementById('btn-toggle-inv')?.addEventListener('click', () => this.toggleInv());
    document.getElementById('btn-close-inv')?.addEventListener('click', () => {
      this.panelInv.classList.add('hidden');
      this.hideComparisonTooltip();
      this.updateHUDButtonStates();
    });
    document.getElementById('btn-toggle-menu')?.addEventListener('click', () => this.togglePause());
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.hideCombatExitWarning();
      this.panelPause.classList.add('hidden');
      this.updateHUDButtonStates();
    });
    document.getElementById('btn-pause-quit')?.addEventListener('click', () => {
      if (this.combatRemainingMs > 0 && !this.isDead) {
        this.showCombatExitWarning();
      } else {
        this.onExitToMenu();
      }
    });
    document.getElementById('btn-pause-quit-force')?.addEventListener('click', () => {
      this.hideCombatExitWarning();
      this.onExitToMenu();
    });
    document.getElementById('btn-pause-quit-cancel')?.addEventListener('click', () => {
      this.hideCombatExitWarning();
    });
    document.getElementById('btn-death-quit')?.addEventListener('click', () => this.onExitToMenu());
    document.getElementById('btn-respawn')?.addEventListener('click', () => {
      this.sendPacket({ type: PACKET_TYPES.INPUT_RESPAWN });
    });
    document.getElementById('btn-pot')?.addEventListener('click', () => {
      this.sendPacket({ type: PACKET_TYPES.INPUT_POTION });
    });

    document.querySelectorAll('.btn-alloc-stat').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sendPacket({ type: PACKET_TYPES.ALLOC_STAT, stat: btn.dataset.stat });
      });
    });

    bindPaperdollEvents(this);
    bindPauseAndAudioEvents(this);
  }

  isPaused() {
    return !this.panelPause.classList.contains('hidden');
  }

  setCombatState(combatMs, isDead) {
    this.combatRemainingMs = combatMs || 0;
    this.isDead = !!isDead;
    const quitBtn = document.getElementById('btn-pause-quit');
    if (quitBtn) {
      if (this.combatRemainingMs > 0 && !this.isDead) {
        const sec = Math.max(1, Math.ceil(this.combatRemainingMs / 1000));
        quitBtn.textContent = `Exit to Main Menu (In Combat: ${sec}s)`;
      } else {
        quitBtn.textContent = 'Exit to Main Menu';
      }
    }
    const warn = document.getElementById('pause-combat-warn');
    if (warn && !warn.classList.contains('hidden')) {
      if (this.combatRemainingMs <= 0 || this.isDead) {
        this.hideCombatExitWarning();
      } else {
        const sec = Math.max(1, Math.ceil(this.combatRemainingMs / 1000));
        const txt = document.getElementById('pause-combat-warn-text');
        if (txt) {
          txt.textContent = `In combat! Safe exit in ${sec}s, or Leave Anyway (character remains vulnerable for 12s).`;
        }
      }
    }
  }

  showCombatExitWarning() {
    const warn = document.getElementById('pause-combat-warn');
    const quitBtn = document.getElementById('btn-pause-quit');
    const txt = document.getElementById('pause-combat-warn-text');
    const sec = Math.max(1, Math.ceil(this.combatRemainingMs / 1000));
    if (txt) {
      txt.textContent = `In combat! Safe exit in ${sec}s, or Leave Anyway (character remains vulnerable for 12s).`;
    }
    warn?.classList.remove('hidden');
    quitBtn?.classList.add('hidden');
  }

  hideCombatExitWarning() {
    document.getElementById('pause-combat-warn')?.classList.add('hidden');
    document.getElementById('btn-pause-quit')?.classList.remove('hidden');
  }

  updateHUDButtonStates() {
    const isCharOpen = Boolean(this.uiCharacter?.visible);
    const isInvOpen = Boolean(this.uiInventory?.visible);
    const isPauseOpen = this.panelPause && !this.panelPause.classList.contains('hidden');
    document.getElementById('btn-toggle-char')?.classList.toggle('btn-locked-pressed', isCharOpen);
    document.getElementById('btn-toggle-inv')?.classList.toggle('btn-locked-pressed', isInvOpen);
    document.getElementById('btn-toggle-menu')?.classList.toggle('btn-locked-pressed', isPauseOpen);
    this.renderer?.updateHUD({
      isCharOpen,
      isInvOpen,
      isPauseOpen
    });
  }

  toggleChar() {
    const willOpen = !this.uiCharacter.visible;
    this.uiCharacter.visible = willOpen;
    if (willOpen) {
      this.renderer.uiManager?.openModal(this.uiCharacter);
    } else {
      this.renderer.uiManager?.closeModal(this.uiCharacter);
    }
    if (this.panelChar) {
      this.panelChar.classList.add('hidden');
    }
    this.updateHUDButtonStates();
  }

  toggleInv() {
    const willOpen = !this.uiInventory.visible;
    this.uiInventory.visible = willOpen;
    if (willOpen) {
      this.renderer.uiManager?.openModal(this.uiInventory);
    } else {
      this.renderer.uiManager?.closeModal(this.uiInventory);
    }
    if (this.panelInv) {
      this.panelInv.classList.add('hidden');
      this.hideComparisonTooltip();
    }
    this.updateHUDButtonStates();
  }

  togglePause() {
    const isOpening = this.panelPause.classList.contains('hidden');
    if (isOpening) {
      this.isInviteRevealed = false;
      this.updatePauseInviteDisplay();
    }
    this.panelPause.classList.toggle('hidden');
    this.updateHUDButtonStates();
  }

  handleEscape() {
    this.hideComparisonTooltip();
    let handled = false;
    if (this.uiInventory?.visible) {
      this.renderer.uiManager?.closeModal(this.uiInventory);
      this.uiInventory.visible = false;
      handled = true;
    }
    if (this.panelChar && !this.panelChar.classList.contains('hidden')) {
      this.panelChar.classList.add('hidden');
      handled = true;
    }
    if (this.panelInv && !this.panelInv.classList.contains('hidden')) {
      this.panelInv.classList.add('hidden');
      handled = true;
    }
    if (!handled) {
      const isOpening = this.panelPause.classList.contains('hidden');
      if (isOpening) {
        this.isInviteRevealed = false;
        this.updatePauseInviteDisplay();
      }
      this.panelPause.classList.toggle('hidden');
    }
    this.updateHUDButtonStates();
  }

  updatePauseInviteDisplay() {
    updatePauseInviteDisplay(this);
  }

  setInvite(token = '') {
    setInvite(this, token);
  }

  setFloorStatus(floor) {
    const el = document.getElementById('status-line');
    if (el) {
      el.textContent = `Floor ${floor} — Sanctum Depths`;
    }
  }

  reset() {
    this.lastInvKey = '';
    this.lastVitalsKey = '';
    this.lastPrivRef = null;
    this.isInviteRevealed = false;
    this.setInvite('');
    this.panelChar.classList.add('hidden');
    this.panelInv.classList.add('hidden');
    this.panelPause.classList.add('hidden');
    this.panelDeath.classList.add('hidden');
    if (this.uiInventory) {
      this.renderer.uiManager?.closeModal(this.uiInventory);
      this.uiInventory.visible = false;
    }
    if (this.uiCharacter) {
      this.renderer.uiManager?.closeModal(this.uiCharacter);
      this.uiCharacter.visible = false;
    }
    this.updateHUDButtonStates();
    this.audio?.resetMacroState?.();
    this.renderer?.updateHUD({
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      isDead: false,
      potions: 3,
      xp: 0,
      nextXp: 100,
      level: 1,
      statPoints: 0,
      isCharOpen: false,
      isInvOpen: false,
      isPauseOpen: false
    });
  }

  update({ myP, priv, activeRoomMode }) {
    if (!myP) return;

    this.renderer?.updateHUD({
      hp: myP.hp,
      maxHp: myP.maxHp,
      mp: myP.mp,
      maxMp: myP.maxMp,
      isDead: !!myP.isDead,
      potions: priv?.potions ?? 3,
      manaPotions: priv?.manaPotions ?? 0,
      xp: priv?.xp || 0,
      nextXp: priv?.nextXp || 100,
      level: priv?.level || 1,
      statPoints: priv?.statPoints || 0,
      isCharOpen: Boolean(this.uiCharacter?.visible),
      isInvOpen: Boolean(this.uiInventory?.visible),
      isPauseOpen: this.panelPause && !this.panelPause.classList.contains('hidden')
    });

    updateVitalsAndDeathDOM(this, myP, activeRoomMode);

    if (this.uiCharacter) {
      this.uiCharacter.updateData(myP, priv, activeRoomMode, this.renderer.floor || 1);
    }

    if (!priv || priv === this.lastPrivRef) return;
    this.lastPrivRef = priv;

    updateCharacterSheetDOM(myP, priv);
    updateInventoryAndPaperdollDOM(this, priv);
    if (this.uiInventory) {
      this.uiInventory.updateData(priv);
    }
  }

  showConsumableTooltip(item, targetEl) {
    showConsumableTooltip(item, targetEl, this.panelInv);
  }

  showComparisonTooltip(hoverItem, equippedItem, targetEl) {
    showComparisonTooltip(hoverItem, equippedItem, targetEl, this.panelInv);
  }

  showEquippedTooltip(item, targetEl) {
    showEquippedTooltip(item, targetEl, this.panelInv);
  }

  positionTooltip(tooltip, targetEl) {
    positionTooltip(tooltip, targetEl, this.panelInv);
  }

  hideComparisonTooltip() {
    hideComparisonTooltip();
  }
}
