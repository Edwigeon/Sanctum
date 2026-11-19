import { HUD_LAYOUT } from './hud/HUDConfig.js';
import { PotionRenderer } from './hud/PotionRenderer.js';
import { BeltRenderer } from './hud/BeltRenderer.js';
import { TooltipRenderer } from './hud/TooltipRenderer.js';

export class CanvasHUD {
  constructor() {
    this.state = {
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      potions: 3,
      xp: 0,
      nextXp: 100,
      level: 1,
      statPoints: 0,
      isCharOpen: false,
      isInvOpen: false,
      isPauseOpen: false,
      isDead: false
    };

    this.mouse = { x: -1, y: -1, isDown: false, pressedId: null };
    this.hoveredId = null;
    this.bounds = {
      orbHp: null,
      orbMp: null,
      potionHp: null,
      potionMp: null,
      belt: null,
      slots: new Map(), // id -> { x, y, w, h }
      xpBar: null
    };

    this.potionRenderer = new PotionRenderer();
    this.beltRenderer = new BeltRenderer();
    this.tooltipRenderer = new TooltipRenderer();
  }

  updateState(partial) {
    Object.assign(this.state, partial);
  }

  setMousePos(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
  }

  setMouseDown(isDown) {
    this.mouse.isDown = isDown;
    if (!isDown) {
      this.mouse.pressedId = null;
    }
  }

  hitTest(x, y) {
    if (this.state.isDead) return null;

    // Check slots first
    for (const [id, box] of this.bounds.slots.entries()) {
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        return { id, box };
      }
    }

    // Check XP Bar
    if (this.bounds.xpBar) {
      const b = this.bounds.xpBar;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { id: 'xp', box: b };
      }
    }

    // Check Life Potion Flask
    if (this.bounds.potionHp) {
      const b = this.bounds.potionHp;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { id: 'hp', box: b };
      }
    } else if (this.bounds.orbHp) {
      const b = this.bounds.orbHp;
      const dist = Math.hypot(x - b.cx, y - b.cy);
      if (dist <= b.r) {
        return { id: 'hp', box: b };
      }
    }

    // Check Mana Potion Phial
    if (this.bounds.potionMp) {
      const b = this.bounds.potionMp;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { id: 'mp', box: b };
      }
    } else if (this.bounds.orbMp) {
      const b = this.bounds.orbMp;
      const dist = Math.hypot(x - b.cx, y - b.cy);
      if (dist <= b.r) {
        return { id: 'mp', box: b };
      }
    }

    // Check Belt Background
    if (this.bounds.belt) {
      const b = this.bounds.belt;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { id: 'belt_bg', box: b };
      }
    }

    return null;
  }

  render(ctx, stageW, stageH, dt, animTime) {
    if (this.state.isDead) return;

    // Calculate responsive HUD scale (normalized to base 720x432)
    const s = Math.max(HUD_LAYOUT.MIN_SCALE, Math.min(HUD_LAYOUT.MAX_SCALE, stageW / HUD_LAYOUT.BASE_WIDTH));

    // Update hovered element
    const hit = this.hitTest(this.mouse.x, this.mouse.y);
    this.hoveredId = hit ? hit.id : null;

    // 1. Compute Geometry (Flasks flanking belt)
    const potW = Math.round(HUD_LAYOUT.POTION_WIDTH * s);
    const potH = Math.round(HUD_LAYOUT.POTION_HEIGHT * s);
    const potMarginX = Math.round(HUD_LAYOUT.POTION_MARGIN_X * s);
    const potMarginBottom = Math.round(HUD_LAYOUT.POTION_MARGIN_BOTTOM * s);

    const hpX = potMarginX;
    const hpY = stageH - potMarginBottom - potH;
    this.bounds.potionHp = { x: hpX, y: hpY, w: potW, h: potH, id: 'hp' };
    this.bounds.orbHp = { cx: hpX + potW / 2, cy: hpY + potH / 2, r: Math.max(potW, potH) / 2, ...this.bounds.potionHp };

    const mpX = stageW - potMarginX - potW;
    const mpY = stageH - potMarginBottom - potH;
    this.bounds.potionMp = { x: mpX, y: mpY, w: potW, h: potH, id: 'mp' };
    this.bounds.orbMp = { cx: mpX + potW / 2, cy: mpY + potH / 2, r: Math.max(potW, potH) / 2, ...this.bounds.potionMp };

    // Center Belt
    const slotSize = Math.round(HUD_LAYOUT.SLOT_SIZE * s);
    const slotGap = Math.round(HUD_LAYOUT.SLOT_GAP * s);
    const numSlots = HUD_LAYOUT.NUM_SLOTS;
    const separatorW = Math.round(HUD_LAYOUT.SEPARATOR_WIDTH * s);

    const beltPadX = Math.round(HUD_LAYOUT.BELT_PAD_X * s);
    const beltPadTop = Math.round(HUD_LAYOUT.BELT_PAD_TOP * s);
    const xpBarH = Math.round(HUD_LAYOUT.XP_BAR_HEIGHT * s);
    const xpBarGap = Math.round(HUD_LAYOUT.XP_BAR_GAP * s);

    const beltContentW = (numSlots * slotSize) + ((numSlots - 2) * slotGap) + separatorW;
    const beltW = beltContentW + (beltPadX * 2);
    const beltH = beltPadTop + slotSize + xpBarGap + xpBarH + Math.round(6 * s);

    const beltX = Math.round((stageW - beltW) / 2);
    const beltY = stageH - beltH - Math.round(HUD_LAYOUT.BELT_MARGIN_BOTTOM * s);
    this.bounds.belt = { x: beltX, y: beltY, w: beltW, h: beltH };

    // Draw Central Belt Frame
    this.drawBeltFrame(ctx, beltX, beltY, beltW, beltH, s);

    // Draw Action Slots
    this.drawActionSlots(ctx, beltX + beltPadX, beltY + beltPadTop, slotSize, slotGap, separatorW, s, animTime);

    // Draw XP Bar
    const xpBarX = beltX + beltPadX;
    const xpBarY = beltY + beltPadTop + slotSize + xpBarGap;
    const xpBarW = beltContentW;
    this.bounds.xpBar = { x: xpBarX, y: xpBarY, w: xpBarW, h: xpBarH };
    this.drawXPBar(ctx, xpBarX, xpBarY, xpBarW, xpBarH, s);

    // Draw Visual Potions
    this.drawLifePotion(ctx, hpX, hpY, potW, potH, s, animTime);
    this.drawManaPotion(ctx, mpX, mpY, potW, potH, s, animTime);

    // Draw Active Tooltip (if hovering over a slot, potion, or xp bar)
    this.drawTooltip(ctx, stageW, stageH, s);
  }

  drawBeltFrame(ctx, x, y, w, h, s) {
    this.beltRenderer.drawBeltFrame(ctx, x, y, w, h, s);
  }

  drawActionSlots(ctx, startX, startY, size, gap, sepW, s, animTime) {
    this.beltRenderer.drawActionSlots(
      ctx,
      startX,
      startY,
      size,
      gap,
      sepW,
      s,
      animTime,
      this.state,
      this.bounds.slots,
      this.mouse,
      this.hoveredId
    );
  }

  drawSingleSlot(ctx, x, y, size, slot, s, animTime) {
    this.beltRenderer.drawSingleSlot(
      ctx,
      x,
      y,
      size,
      slot,
      s,
      animTime,
      this.state,
      this.mouse,
      this.hoveredId === slot.id
    );
  }

  drawSlotIcon(ctx, cx, cy, size, type, color, isPressed, s) {
    this.beltRenderer.drawSlotIcon(ctx, cx, cy, size, type, color, isPressed, s, this.state);
  }

  drawXPBar(ctx, x, y, w, h, s) {
    this.beltRenderer.drawXPBar(ctx, x, y, w, h, s, this.state);
  }

  drawHealthGlobe(ctx, cx, cy, r, s, animTime) {
    this.drawLifePotion(ctx, cx - r, cy - r, r * 2, r * 2, s, animTime);
  }

  drawManaGlobe(ctx, cx, cy, r, s, animTime) {
    this.drawManaPotion(ctx, cx - r, cy - r, r * 2, r * 2, s, animTime);
  }

  drawLifePotion(ctx, x, y, w, h, s, animTime) {
    this.potionRenderer.drawLifePotion(ctx, x, y, w, h, s, animTime, this.state);
  }

  drawManaPotion(ctx, x, y, w, h, s, animTime) {
    this.potionRenderer.drawManaPotion(ctx, x, y, w, h, s, animTime, this.state);
  }

  drawTooltip(ctx, stageW, stageH, s) {
    this.tooltipRenderer.drawTooltip(
      ctx,
      stageW,
      stageH,
      s,
      this.hoveredId,
      this.mouse.x,
      this.mouse.y,
      this.state
    );
  }
}
