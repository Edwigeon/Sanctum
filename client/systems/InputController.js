import { PACKET_TYPES } from '../../shared/Constants.js';

export class InputController {
  constructor({ renderer, hud, audio, sendPacket, getState }) {
    this.renderer = renderer;
    this.hud = hud;
    this.audio = audio;
    this.sendPacket = sendPacket;
    this.getState = getState;

    this.mouse = { screenX: 0, screenY: 0, worldX: 0, worldY: 0 };
    this.lmbDown = false;
    this.holdMode = null;
    this.lockedMonsterId = null;
    this.lastMoveSentAt = 0;

    this.bindEvents();
  }

  reset() {
    this.lmbDown = false;
    this.holdMode = null;
    this.lockedMonsterId = null;
  }

  findLootAt(wx, wy, lootList) {
    return (lootList || []).find(l =>
      Math.abs(l.x - wx) <= 5 &&
      Math.abs(l.y - wy) <= 5 &&
      this.renderer.isWorldPointVisible(l.x, l.y)
    );
  }

  findMonsterAt(wx, wy, monsterList) {
    return (monsterList || []).find(m =>
      Math.abs(m.rx - wx) <= 5 &&
      Math.abs(m.ry - wy) <= 6 &&
      this.renderer.isWorldPointVisible(m.rx, m.ry)
    );
  }

  getHoverTargets(interp) {
    const curWorldX = this.mouse.screenX + this.renderer.camera.x;
    const curWorldY = this.mouse.screenY + this.renderer.camera.y;
    const hoveredLoot = this.findLootAt(curWorldX, curWorldY, interp.loot);
    const hoveredMob = !hoveredLoot && this.holdMode !== 'move'
      ? this.findMonsterAt(curWorldX, curWorldY, interp.monsters)
      : null;
    return { hoveredLoot, hoveredMob };
  }

  updateHoldMove(now) {
    if (this.lmbDown && this.holdMode === 'move' && now - this.lastMoveSentAt >= 66) {
      this.lastMoveSentAt = now;
      const wx = this.mouse.screenX + this.renderer.camera.x;
      const wy = this.mouse.screenY + this.renderer.camera.y;
      this.sendPacket({ type: PACKET_TYPES.INPUT_MOVE, x: wx, y: wy });
    }
  }

  bindEvents() {
    const stage = this.renderer.stage;

    stage.addEventListener('mousemove', (e) => {
      const rect = stage.getBoundingClientRect();
      this.mouse.screenX = (e.clientX - rect.left) / this.renderer.stageScale;
      this.mouse.screenY = (e.clientY - rect.top) / this.renderer.stageScale;
      this.mouse.worldX = this.mouse.screenX + this.renderer.camera.x;
      this.mouse.worldY = this.mouse.screenY + this.renderer.camera.y;
    });

    stage.addEventListener('contextmenu', (e) => e.preventDefault());

    stage.addEventListener('mousedown', (e) => {
      if (e.target !== stage && e.target !== this.renderer.pCanvas && e.target !== this.renderer.hCanvas) return;
      const { latestSnapshot, lastInterp, myPlayerId } = this.getState();
      if (!latestSnapshot || this.hud.isPaused()) return;

      const rect = stage.getBoundingClientRect();
      const screenX = (e.clientX - rect.left) / this.renderer.stageScale;
      const screenY = (e.clientY - rect.top) / this.renderer.stageScale;
      const wx = screenX + this.renderer.camera.x;
      const wy = screenY + this.renderer.camera.y;

      if (e.button === 2) {
        const myP = lastInterp.players.find(p => p.id === myPlayerId) || latestSnapshot.players.find(p => p.id === myPlayerId);
        if (myP) {
          const px = myP.rx !== undefined ? myP.rx : myP.x;
          const py = myP.ry !== undefined ? myP.ry : myP.y;
          if ((myP.mp ?? 0) >= 10) this.audio?.play('spark', { pitchJitter: 0.05 });
          this.sendPacket({ type: PACKET_TYPES.INPUT_SKILL, angle: Math.atan2(wy - py, wx - px) });
        }
        return;
      }
      if (e.button !== 0) return;

      this.lmbDown = true;
      const loot = this.findLootAt(wx, wy, lastInterp.loot);
      if (loot) {
        this.holdMode = null;
        this.lockedMonsterId = null;
        this.sendPacket({ type: PACKET_TYPES.PICKUP_LOOT, lootId: loot.id });
        return;
      }

      const mob = this.findMonsterAt(wx, wy, lastInterp.monsters);
      if (mob) {
        this.holdMode = 'attack';
        this.lockedMonsterId = mob.id;
        this.sendPacket({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: mob.id, hold: true });
        return;
      }

      this.holdMode = 'move';
      this.lockedMonsterId = null;
      this.renderer.setClickMarker(wx, wy, 0.25);
      this.lastMoveSentAt = performance.now();
      this.sendPacket({ type: PACKET_TYPES.INPUT_MOVE, x: wx, y: wy });
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.lmbDown) return;
      this.lmbDown = false;
      if (this.holdMode === 'attack' && this.lockedMonsterId !== null) {
        this.sendPacket({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: this.lockedMonsterId, hold: false });
      }
      this.holdMode = null;
      this.lockedMonsterId = null;
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const { myPlayerId } = this.getState();
      if (!myPlayerId) return;
      const k = e.key.toLowerCase();
      if (k === '1') {
        this.sendPacket({ type: PACKET_TYPES.INPUT_POTION });
      } else if (k === 't') {
        const on = this.renderer.lighting.togglePlayerTorch();
        this.audio?.play('torch_toggle', { pitchJitter: 0.08 });
        this.renderer.addFloatingText(on ? 'Torch Lit' : 'Torch Snuffed', this.mouse.worldX, this.mouse.worldY - 8, on ? '#FACC15' : '#94A3B8');
      } else if (k === 'm') {
        const muted = this.audio?.toggleMute();
        this.renderer.addFloatingText(muted ? 'Audio Muted' : 'Audio On', this.mouse.worldX, this.mouse.worldY - 8, muted ? '#94A3B8' : '#34D399');
      } else if (k === 'l') {
        const nextAmb = this.renderer.lighting.targetAmbientLight > 0 ? 0.0 : 5.5;
        this.renderer.lighting.setAmbientLight(nextAmb);
        this.renderer.addFloatingText(nextAmb > 0 ? 'Daylight Preview' : 'Dungeon Darkness', this.mouse.worldX, this.mouse.worldY - 8, '#38BDF8');
      } else if (k === 'c') {
        this.hud.toggleChar();
      } else if (k === 'i') {
        this.hud.toggleInv();
      } else if (e.key === 'Escape') {
        this.hud.handleEscape();
      }
    });
  }
}
