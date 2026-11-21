import { UIPanel } from '../primitives/UIPanel.js';
import { UISlot } from '../primitives/UISlot.js';
import { UITooltip } from './UITooltip.js';
import { uiTheme } from '../UITheme.js';
import { UI_ANCHOR } from '../UILayout.js';
import { PACKET_TYPES, RARITY_COLORS } from '../../../../shared/Constants.js';
import { PAPERDOLL_SLOTS } from '../../hud/ItemTooltipDOM.js';
import { drawBitSprite, getItemSpriteKey } from '../../BitSprites.js';

/**
 * UIInventory — Medieval Leather-Bound Grimoire / Tome Inventory & Equipment System.
 * Features an anatomical paperdoll rack on aged vellum, alchemical connection lines,
 * gilded divider rail with pulsing soul-gem, a smooth-scrolling pack with antique brass rail,
 * and an embossed clasp currency & carry-weight footer.
 */
export class UIInventory extends UIPanel {
  constructor({ sendPacket, audio, onClose } = {}) {
    super({
      id: 'panel_inventory',
      title: '', // Intentionally clean: leather tome cover with cast brass corners
      anchor: UI_ANCHOR.TOP_RIGHT,
      baseW: 300,
      baseH: 400,
      offsetX: 14,
      offsetY: 10,
      zOrder: 20,
      panelStyle: 'tome',
      hasRivets: true,
      hasCorners: true,
      hasCloseButton: true,
      onClose
    });

    this.sendPacket = sendPacket;
    this.audio = audio;

    this.gold = 0;
    this.carryWeight = 0;
    this.maxWeight = 60;
    this.equipment = {};
    this.inventory = [];

    // Hero stat snapshot cache for unified tooltip comparisons
    this.classId = 'VANGUARD';
    this.level = 1;
    this.stats = { might: 16, focus: 8, agility: 10, vitality: 16 };
    this.derived = null;
    this.priv = null;

    // Drag and drop state
    this.dragState = {
      candidate: null,
      active: false,
      item: null,
      sourceSlot: null,
      sourceSlotKey: null,
      isEquipment: false,
      curX: 0,
      curY: 0
    };

    // Scrolling state for the pack grid
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.maxScrollY = 0;

    this.tooltip = new UITooltip();
    this.addChild(this.tooltip);

    // 1. Anatomical Paperdoll Equipment Sockets (Upper Vellum Page)
    this.paperdollSlots = new Map();
    this.initPaperdollSlots();

    // 2. Scrollable Pack Sockets (Lower Vellum Page)
    this.packSlots = [];
    this.initPackSlots();
  }

  /**
   * Anatomical Paperdoll Socket Layout:
   * Top:       [Helm: Center]  [Amulet: Top-Right]
   * Mid:       [Weapon: Left]  [Armor: Center]  [Offhand: Right]
   * Bottom:    [Gloves: Left]  [Ring 1] [Ring 2]  [Boots: Right]
   */
  initPaperdollSlots() {
    const slotCoords = {
      helm:    { x: 133, y: 20 },
      amulet:  { x: 180, y: 20 },
      weapon:  { x: 50,  y: 62 },
      armor:   { x: 133, y: 62 },
      offhand: { x: 216, y: 62 },
      gloves:  { x: 50,  y: 104 },
      ring1:   { x: 100, y: 104 },
      ring2:   { x: 166, y: 104 },
      boots:   { x: 216, y: 104 }
    };

    for (const slotKey of PAPERDOLL_SLOTS) {
      const coord = slotCoords[slotKey] || { x: 133, y: 62 };
      const slot = new UISlot({
        id: `slot_${slotKey}`,
        baseSize: 34,
        offsetX: coord.x,
        offsetY: coord.y,
        slotType: 'equipment',
        silhouetteKey: `slot_${slotKey}`,
        onClick: (item) => this.handleSlotClick(item, slotKey, true),
        onRightClick: (item) => this.handleSlotRightClick(item, slotKey, true)
      });
      slot.onPointerDownCallback = (e) => this.handleSlotPointerDown(slot, slotKey, true, e);
      this.paperdollSlots.set(slotKey, slot);
      this.addChild(slot);
    }
  }

  /**
   * Initializes the scrollable pack grid (5 columns wide).
   */
  initPackSlots() {
    this.rebuildPackSlots(this.inventory.length);
  }

  rebuildPackSlots(itemCount = 0) {
    for (const slot of this.packSlots) {
      this.removeChild(slot);
    }
    this.packSlots = [];

    const cols = 5;
    const totalSlots = Math.max(15, Math.ceil((itemCount + 5) / cols) * cols);
    const startX = 36;
    const startY = 160;
    const slotSize = 34;
    const slotGap = 8;
    const totalRows = Math.ceil(totalSlots / cols);

    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= totalSlots) break;

        const slot = new UISlot({
          id: `pack_${idx}`,
          baseSize: slotSize,
          offsetX: startX + c * (slotSize + slotGap),
          offsetY: startY + r * (slotSize + slotGap),
          slotType: 'inventory',
          onClick: (item) => this.handleSlotClick(item, idx, false),
          onRightClick: (item) => this.handleSlotRightClick(item, idx, false)
        });
        slot.onPointerDownCallback = (e) => this.handleSlotPointerDown(slot, idx, false, e);
        this.packSlots.push(slot);
        this.addChild(slot);
      }
    }
  }

  updateData(priv) {
    if (!priv) return;
    this.priv = priv;
    this.classId = priv.classId || this.classId;
    this.level = priv.level ?? this.level;
    this.stats = priv.stats || this.stats;
    this.derived = priv.derived || this.derived;
    this.gold = priv.gold ?? 0;
    this.carryWeight = priv.carryWeight ?? 0;
    this.maxWeight = priv.maxWeight ?? 60;
    this.equipment = priv.equipment || {};
    const newInv = priv.inventory || [];
    this.inventory = newInv;

    // Check if slot pool needs resizing
    if (this.packSlots.length < newInv.length + 5) {
      this.rebuildPackSlots(newInv.length);
    }

    // Sync Paperdoll
    for (const [slotKey, slotComp] of this.paperdollSlots.entries()) {
      const eqItem = this.equipment[slotKey] || null;
      slotComp.setItem(eqItem, 1);
    }

    // Sync Pack
    for (let i = 0; i < this.packSlots.length; i++) {
      const item = this.inventory[i] || null;
      this.packSlots[i].setItem(item, item?.count || 1);
    }
  }

  handleSlotPointerDown(slot, identifier, isEquipment, e) {
    if (!slot.item) return;
    this.dragState.candidate = {
      slot,
      identifier,
      isEquipment,
      item: slot.item,
      startX: e.x,
      startY: e.y
    };
  }

  /**
   * Tracks pointer movement for initiating drag sessions or dragging floating item icons.
   */
  onPointerMove(pxX, pxY) {
    if (this.dragState.candidate && !this.dragState.active) {
      const c = this.dragState.candidate;
      const d = Math.hypot(pxX - c.startX, pxY - c.startY);
      if (d >= 4 && c.item) {
        this.dragState.active = true;
        this.dragState.item = c.item;
        this.dragState.sourceSlot = c.slot;
        this.dragState.sourceSlotKey = c.identifier;
        this.dragState.isEquipment = c.isEquipment;
        this.dragState.curX = pxX;
        this.dragState.curY = pxY;
        c.slot.isGhost = true;
        this.tooltip.hide();
      }
    } else if (this.dragState.active) {
      this.dragState.curX = pxX;
      this.dragState.curY = pxY;
      this.tooltip.hide();
    }
  }

  /**
   * Handles dropping of dragged items onto equipment sockets, pack, or into the game world.
   */
  handleDragEnd(pxX, pxY, button = 0) {
    if (!this.dragState.active) {
      this.dragState.candidate = null;
      return false;
    }

    const item = this.dragState.item;
    const srcSlot = this.dragState.sourceSlot;
    const srcKey = this.dragState.sourceSlotKey;
    const isEq = this.dragState.isEquipment;

    if (srcSlot) {
      srcSlot.isGhost = false;
    }

    // 1. Check if dropped on an equipment socket
    let targetEqKey = null;
    for (const [key, eqSlot] of this.paperdollSlots.entries()) {
      if (eqSlot.hitTest(pxX, pxY)) {
        targetEqKey = key;
        break;
      }
    }

    if (targetEqKey) {
      const valid = (item.slot === targetEqKey) ||
                    (item.slot === 'ring' && (targetEqKey === 'ring1' || targetEqKey === 'ring2'));
      if (valid) {
        if (isEq && srcKey === targetEqKey) {
          // Re-dropped on same socket
        } else {
          this.sendPacket?.({ type: PACKET_TYPES.EQUIP_ITEM, itemId: item.id, slot: targetEqKey });
          this.audio?.play?.('click', { pitchJitter: 0.05 });
        }
      } else {
        this.audio?.play?.('error', { pitchJitter: 0.04 });
      }
    } else {
      // 2. Check if dropped inside the pack area
      const sScale = this.w / this.baseW;
      const packViewTop = this.y + Math.round(156 * sScale);
      const packViewH = Math.round(184 * sScale);
      const packViewLeft = this.x + Math.round(26 * sScale);
      const packViewW = Math.round(246 * sScale);
      const inPack = pxX >= packViewLeft && pxX <= packViewLeft + packViewW &&
                     pxY >= packViewTop && pxY <= packViewTop + packViewH;

      if (inPack) {
        if (isEq) {
          this.sendPacket?.({ type: PACKET_TYPES.UNEQUIP_ITEM, slot: srcKey });
          this.audio?.play?.('click', { pitchJitter: 0.05 });
        }
      } else {
        // 3. Check if dropped completely outside the Tome panel -> Drop item to ground!
        const inTome = pxX >= this.x && pxX <= this.x + this.w && pxY >= this.y && pxY <= this.y + this.h;
        if (!inTome) {
          this.sendPacket?.({ type: PACKET_TYPES.DROP_ITEM, itemId: item.id });
          this.audio?.play?.('drop', { pitchJitter: 0.08 });
        }
      }
    }

    this.dragState.active = false;
    this.dragState.candidate = null;
    this.dragState.item = null;
    this.dragState.sourceSlot = null;
    this.dragState.sourceSlotKey = null;
    this.tooltip.hide();
    return true;
  }

  handleSlotClick(item, identifier, isEquipment) {
    if (this.dragState.active) return;
    this.dragState.candidate = null;
    if (!item) return;

    if (isEquipment) {
      this.sendPacket?.({ type: PACKET_TYPES.UNEQUIP_ITEM, slot: identifier });
      this.audio?.play?.('click', { pitchJitter: 0.05 });
    } else {
      const isConsumable = item.type === 'potion' || item.type === 'consumable';
      if (isConsumable) {
        this.sendPacket?.({ type: PACKET_TYPES.USE_ITEM, itemId: item.id });
        this.audio?.play?.('potion', { pitchJitter: 0.04 });
      } else {
        this.sendPacket?.({ type: PACKET_TYPES.EQUIP_ITEM, itemId: item.id });
        this.audio?.play?.('click', { pitchJitter: 0.05 });
      }
    }
    this.tooltip.hide();
  }

  handleSlotRightClick(item, identifier, isEquipment) {
    if (!item) return;
    this.sendPacket?.({ type: PACKET_TYPES.DROP_ITEM, itemId: item.id });
    this.audio?.play?.('drop', { pitchJitter: 0.08 });
    this.tooltip.hide();
  }

  onWheel({ deltaY }) {
    this.targetScrollY = Math.max(0, Math.min(this.maxScrollY, this.targetScrollY + Math.sign(deltaY) * 36));
    this.syncPackSlotPositions();
    return true; // Swallowed by inventory scroll
  }

  /**
   * Synchronizes pack slot bounding boxes to match current scale and scroll position.
   * Guarantees 100% hit test and render accuracy without stale coordinate frames.
   */
  syncPackSlotPositions(s = (this.w / this.baseW)) {
    const scrollOffsetPx = Math.round(this.scrollY);
    const baseStartY = 160;
    const cols = 5;
    const startSlotX = 36;
    const slotSize = 34;
    const slotGap = 8;

    for (let i = 0; i < this.packSlots.length; i++) {
      const slot = this.packSlots[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      slot.w = Math.round(slotSize * s);
      slot.h = Math.round(slotSize * s);
      slot.x = Math.round(this.x + (startSlotX + c * (slotSize + slotGap)) * s);
      slot.y = Math.round(this.y + (baseStartY + r * (slotSize + slotGap)) * s - scrollOffsetPx);
    }
  }

  updateLayout(layout) {
    if (layout.isCompact) {
      this.anchor = UI_ANCHOR.CENTER;
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      this.anchor = UI_ANCHOR.TOP_RIGHT;
      this.offsetX = 14;
      this.offsetY = 10;
    }

    super.updateLayout(layout);

    // Compute max scroll
    const s = layout.scale;
    const cols = 5;
    const totalRows = Math.ceil(this.packSlots.length / cols);
    const contentH = totalRows * Math.round(42 * s);
    const viewH = Math.round(180 * s); // Visible pack window
    this.maxScrollY = Math.max(0, contentH - viewH);
    this.targetScrollY = Math.max(0, Math.min(this.maxScrollY, this.targetScrollY));

    this.syncPackSlotPositions(s);
  }

  /**
   * Overrides hit-testing so that slots in the scrollable pack match their scrolled positions.
   * Tooltip is omitted from hit testing to prevent any hover flickering.
   */
  hitTest(pxX, pxY, isTouch = false) {
    if (!this.visible || !this.enabled) return null;

    // 1. Paperdoll equipment sockets
    for (const slot of this.paperdollSlots.values()) {
      const hit = slot.hitTest(pxX, pxY, isTouch);
      if (hit) return hit;
    }

    // 2. Scrollable Pack Area Check
    this.syncPackSlotPositions();
    const sScale = this.w / this.baseW;
    const packViewTop = this.y + Math.round(156 * sScale);
    const packViewH = Math.round(184 * sScale);
    const packViewLeft = this.x + Math.round(26 * sScale);
    const packViewW = Math.round(246 * sScale);

    if (pxX >= packViewLeft && pxX <= packViewLeft + packViewW &&
        pxY >= packViewTop && pxY <= packViewTop + packViewH) {
      for (const slot of this.packSlots) {
        if (slot.visible) {
          const hit = slot.hitTest(pxX, pxY, isTouch);
          if (hit) return hit;
        }
      }
    }

    // 3. Panel Bounding Box
    if (pxX >= this.x && pxX <= this.x + this.w && pxY >= this.y && pxY <= this.y + this.h) {
      return this;
    }

    return null;
  }

  /**
   * Explicit render lifecycle: draws Tome cover, paperdoll sockets,
   * clipped scrollable pack grid, floating tooltip, and active dragged item.
   */
  render(ctx, layout, animTime = 0) {
    if (!this.visible) return;

    // 1. Draw Tome cover, vellum page, alchemical lines, clipped pack, scrollbar, and clasp
    this.draw(ctx, layout, animTime);

    // 2. Draw Paperdoll sockets on top of alchemical lines
    for (const slot of this.paperdollSlots.values()) {
      if (slot.visible) {
        slot.draw(ctx, layout, animTime);
      }
    }

    // 3. Draw Tooltip on top (suppressed during active dragging)
    if (this.tooltip.visible && !this.dragState.active) {
      this.tooltip.render(ctx, layout, animTime);
    }

    // 4. Draw Floating Dragged Item with Tactile Shadow and Rarity Aura
    if (this.dragState.active && this.dragState.item) {
      const item = this.dragState.item;
      const s = layout.scale;
      const pScale = Math.max(1, Math.round(2.2 * s));
      const spriteKey = item.spriteKey || getItemSpriteKey(item);
      const curX = this.dragState.curX;
      const curY = this.dragState.curY;

      ctx.save();
      // Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.arc(curX + 2, curY + 6, Math.round(14 * s), 0, Math.PI * 2);
      ctx.fill();

      // Floating Bit-Sprite
      const iconX = curX - Math.round(5 * pScale);
      const iconY = curY - Math.round(5 * pScale);
      drawBitSprite(ctx, spriteKey, iconX, iconY, pScale, uiTheme.palette);

      // Floating Rarity Border
      const rarityCol = RARITY_COLORS[item.rarity] || '#FFFFFF';
      ctx.strokeStyle = rarityCol;
      ctx.lineWidth = Math.max(1.5, Math.round(1.5 * s));
      ctx.strokeRect(curX - Math.round(16 * s), curY - Math.round(16 * s), Math.round(32 * s), Math.round(32 * s));

      ctx.restore();
    }
  }

  draw(ctx, layout, animTime = 0) {
    // Smooth scroll lerping
    this.scrollY += (this.targetScrollY - this.scrollY) * 0.3;
    if (Math.abs(this.targetScrollY - this.scrollY) < 0.2) {
      this.scrollY = this.targetScrollY;
    }

    const { x, y, w, h } = this;
    const s = layout.scale;

    // Synchronize slot positions for accurate hit-testing & rendering
    this.syncPackSlotPositions(s);

    // 1. Draw Leather Tome Cover & Vellum Interior
    super.draw(ctx, layout, animTime);

    ctx.save();

    // 2. Alchemical Constellation Connection Lines between Equipment Sockets
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110, 73, 23, 0.45)'; // Antique bronze constellation lines
    const helm = this.paperdollSlots.get('helm');
    const armor = this.paperdollSlots.get('armor');
    const weapon = this.paperdollSlots.get('weapon');
    const offhand = this.paperdollSlots.get('offhand');
    const gloves = this.paperdollSlots.get('gloves');
    const ring1 = this.paperdollSlots.get('ring1');
    const ring2 = this.paperdollSlots.get('ring2');
    const boots = this.paperdollSlots.get('boots');

    if (helm && armor && weapon && offhand && gloves && boots) {
      ctx.beginPath();
      // Helm -> Armor
      ctx.moveTo(helm.x + helm.w / 2, helm.y + helm.h);
      ctx.lineTo(armor.x + armor.w / 2, armor.y);
      // Armor -> Weapon & Offhand
      ctx.moveTo(armor.x, armor.y + armor.h / 2);
      ctx.lineTo(weapon.x + weapon.w, weapon.y + weapon.h / 2);
      ctx.moveTo(armor.x + armor.w, armor.y + armor.h / 2);
      ctx.lineTo(offhand.x, offhand.y + offhand.h / 2);
      // Weapon -> Gloves
      ctx.moveTo(weapon.x + weapon.w / 2, weapon.y + weapon.h);
      ctx.lineTo(gloves.x + gloves.w / 2, gloves.y);
      // Offhand -> Boots
      ctx.moveTo(offhand.x + offhand.w / 2, offhand.y + offhand.h);
      ctx.lineTo(boots.x + boots.w / 2, boots.y);
      // Armor -> Rings
      if (ring1 && ring2) {
        ctx.moveTo(armor.x + armor.w / 2, armor.y + armor.h);
        ctx.lineTo(ring1.x + ring1.w / 2, ring1.y);
        ctx.moveTo(armor.x + armor.w / 2, armor.y + armor.h);
        ctx.lineTo(ring2.x + ring2.w / 2, ring2.y);
      }
      ctx.stroke();
    }

    // 3. Gilded Page Divider with Pulsing Soul Gem
    const divY = y + Math.round(148 * s);
    const divPadX = Math.round(20 * s);

    // Double gilded rail
    ctx.strokeStyle = '#2b3448';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + divPadX, divY - 1);
    ctx.lineTo(x + w - divPadX, divY - 1);
    ctx.moveTo(x + divPadX, divY + 1);
    ctx.lineTo(x + w - divPadX, divY + 1);
    ctx.stroke();

    // Central inlaid bronze gem bezel
    const gemX = x + Math.round(w / 2);
    const gemR = Math.max(2.5, Math.round(3.5 * s));
    ctx.fillStyle = '#6e4917';
    ctx.beginPath();
    ctx.arc(gemX, divY, gemR + 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing Crimson Soul Gem
    const gemPulse = Math.sin(animTime * 3.5) * 0.4 + 0.6;
    ctx.fillStyle = `rgba(255, 0, 77, ${gemPulse})`;
    ctx.beginPath();
    ctx.arc(gemX, divY, gemR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF1E8';
    ctx.fillRect(gemX - 1, divY - 1, 1, 1);

    // 4. Scrollable Pack Grid Viewport (Clipped)
    const packViewX = x + Math.round(26 * s);
    const packViewY = y + Math.round(156 * s);
    const packViewW = Math.round(246 * s);
    const packViewH = Math.round(184 * s);

    ctx.save();
    ctx.beginPath();
    ctx.rect(packViewX, packViewY, packViewW, packViewH);
    ctx.clip();

    // Update scrolled pack slot positions & draw
    const scrollOffsetPx = Math.round(this.scrollY);
    const baseStartY = 160;
    const cols = 5;
    const startSlotX = 36;
    const slotSize = 34;
    const slotGap = 8;

    for (let i = 0; i < this.packSlots.length; i++) {
      const slot = this.packSlots[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      slot.x = Math.round(x + (startSlotX + c * (slotSize + slotGap)) * s);
      slot.y = Math.round(y + (baseStartY + r * (slotSize + slotGap)) * s - scrollOffsetPx);

      // Only draw if within visible viewport
      if (slot.y + slot.h >= packViewY && slot.y <= packViewY + packViewH) {
        slot.draw(ctx, layout, animTime);
      }
    }
    ctx.restore();

    // 5. Antique Brass Scrollbar Track (if content overflows)
    if (this.maxScrollY > 0) {
      const trackX = x + w - Math.round(24 * s);
      const trackY = packViewY + 2;
      const trackW = Math.round(5 * s);
      const trackH = packViewH - 4;

      // Recessed iron groove
      ctx.fillStyle = '#06080e';
      ctx.fillRect(trackX, trackY, trackW, trackH);
      ctx.strokeStyle = '#2b3448';
      ctx.lineWidth = 1;
      ctx.strokeRect(trackX, trackY, trackW, trackH);

      // Sliding Antique Brass Thumb
      const thumbFrac = Math.max(0.2, packViewH / (packViewH + this.maxScrollY));
      const thumbH = Math.max(16, Math.round(trackH * thumbFrac));
      const scrollFrac = this.maxScrollY > 0 ? (this.scrollY / this.maxScrollY) : 0;
      const thumbY = trackY + Math.round((trackH - thumbH) * scrollFrac);

      ctx.fillStyle = '#dfa448';
      ctx.fillRect(trackX + 1, thumbY, trackW - 2, thumbH);
      ctx.strokeStyle = '#fff1e8';
      ctx.strokeRect(trackX + 1, thumbY, trackW - 2, thumbH);
    }

    // 6. Tome Brass Clasp Footer (Gold & Weight Slab)
    const claspW = Math.round(250 * s);
    const claspH = Math.round(32 * s);
    const claspX = x + Math.round((w - claspW) / 2);
    const claspY = y + h - claspH - Math.round(10 * s);

    // Embossed Brass Clasp Plate
    ctx.fillStyle = '#1e120b';
    ctx.fillRect(claspX, claspY, claspW, claspH);
    ctx.strokeStyle = '#6e4917';
    ctx.lineWidth = Math.max(1, Math.round(1 * s));
    ctx.strokeRect(claspX, claspY, claspW, claspH);

    // Inner bronze rim
    ctx.strokeStyle = '#dfa448';
    ctx.strokeRect(claspX + 1, claspY + 1, claspW - 2, claspH - 2);

    // Animated Shimmering Gold Coin
    const coinPScale = Math.max(1, Math.round(1.7 * s));
    const coinX = claspX + Math.round(6 * s);
    const coinY = claspY + Math.round((claspH - 10 * coinPScale) / 2);

    drawBitSprite(ctx, 'coin', coinX, coinY, coinPScale, uiTheme.palette);

    // Specular Coin Twinkle
    if (Math.sin(animTime * 4.5) > 0.65) {
      ctx.fillStyle = '#FFF1E8';
      ctx.fillRect(coinX + 2, coinY + 2, 2, 2);
    }

    // Gold Text
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(10, Math.round(11 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(`${this.gold.toLocaleString()} G`, coinX + Math.round(22 * s) + 1, claspY + Math.round(20 * s) + 1);
    ctx.fillStyle = '#FFEC27';
    ctx.fillText(`${this.gold.toLocaleString()} G`, coinX + Math.round(22 * s), claspY + Math.round(20 * s));

    // Carry Weight Text & Progress Gauge
    const curW = this.carryWeight;
    const maxW = this.maxWeight;
    const wPct = Math.min(1.0, Math.max(0.0, curW / maxW));

    ctx.textAlign = 'right';
    ctx.font = `${Math.max(9, Math.round(9.5 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(`${curW.toFixed(1)} / ${maxW.toFixed(1)} lb`, claspX + claspW - Math.round(8 * s) + 1, claspY + Math.round(13 * s) + 1);
    ctx.fillStyle = wPct >= 0.9 ? '#FF004D' : (wPct >= 0.7 ? '#FFA300' : '#C2C3C7');
    ctx.fillText(`${curW.toFixed(1)} / ${maxW.toFixed(1)} lb`, claspX + claspW - Math.round(8 * s), claspY + Math.round(13 * s));

    // Weight bar
    const barW = Math.round(84 * s);
    const barH = Math.round(4 * s);
    const barX = claspX + claspW - barW - Math.round(8 * s);
    const barY = claspY + Math.round(18 * s);

    ctx.fillStyle = '#06080e';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = wPct >= 0.9 ? '#FF004D' : (wPct >= 0.7 ? '#FFA300' : '#29ADFF');
    ctx.fillRect(barX, barY, Math.round(barW * wPct), barH);
    ctx.strokeStyle = '#6e4917';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // 7. Update Hover Tooltip (Suppressed during active dragging)
    if (this.dragState.active) {
      this.tooltip.hide();
    } else {
      let hoveredSlot = null;
      for (const slot of [...this.paperdollSlots.values(), ...this.packSlots]) {
        if (slot.isHovered && slot.item) {
          hoveredSlot = slot;
          break;
        }
      }

      if (hoveredSlot && hoveredSlot.item) {
        const item = hoveredSlot.item;
        const isEq = hoveredSlot.slotType === 'equipment';
        const charState = {
          classId: this.classId,
          level: this.level,
          stats: this.stats,
          equipment: this.equipment,
          derived: this.derived
        };

        if (item.slot === 'ring') {
          if (isEq) {
            this.tooltip.show(item, { isEquippedSelf: true, slotKey: hoveredSlot.id, charState }, hoveredSlot, charState);
          } else {
            this.tooltip.show(item, { isDualRing: true, ring1: this.equipment.ring1, ring2: this.equipment.ring2, charState }, hoveredSlot, charState);
          }
        } else {
          const eqItem = this.equipment[item.slot] || null;
          this.tooltip.show(item, isEq ? { isEquippedSelf: true, slotKey: item.slot, charState } : eqItem, hoveredSlot, charState);
        }
      } else {
        this.tooltip.hide();
      }
    }

    ctx.restore();
  }
}
