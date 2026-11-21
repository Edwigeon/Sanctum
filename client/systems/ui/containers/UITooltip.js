import { UIComponent } from '../UIComponent.js';
import { uiTheme } from '../UITheme.js';
import { RARITY, RARITY_COLORS } from '../../../../shared/Constants.js';
import { STAT_LABELS } from '../../hud/ItemTooltipDOM.js';
import {
  StatEngine,
  DAMAGE_TYPES,
  DAMAGE_TYPE_METADATA,
  RESISTANCE_TYPES,
  RESISTANCE_METADATA,
  AFFIX_REGISTRY
} from '../../../../shared/StatEngine.js';

/**
 * Modular Item Stat & Damage Resolver.
 * Future-proofed for weapon base damage ranges, attack speed, base armor,
 * magical affixes, and D3 comparative power scores.
 */
export function resolveItemMetrics(item) {
  if (!item) {
    return {
      primaryValue: '0',
      primaryLabel: 'EMPTY',
      subProperty: null,
      baseDmgMin: 0,
      baseDmgMax: 0,
      attackSpeed: 1.0,
      baseArmor: 0,
      affixes: [],
      d3Power: { damage: 0, toughness: 0, utility: 0 }
    };
  }

  const isPotion = item.type === 'potion' || item.type === 'consumable';
  if (isPotion) {
    const isMp = item.subType === 'mp' || item.name?.includes('Mana');
    const amount = item.restoreAmount || (isMp ? 30 : 40);
    return {
      primaryValue: `+${amount}`,
      primaryLabel: isMp ? 'MANA RESTORED' : 'HEALTH RESTORED',
      subProperty: isMp ? 'Mana Restorative Draught' : 'Health Restorative Draught',
      baseDmgMin: 0,
      baseDmgMax: 0,
      attackSpeed: 1.0,
      baseArmor: 0,
      affixes: [],
      d3Power: { damage: 0, toughness: 0, utility: amount }
    };
  }

  // 1. Weapon Metrics (Modular support for base damage range and attack speed via StatEngine)
  if (item.slot === 'weapon') {
    const wMetrics = StatEngine.resolveWeaponMetrics(item);
    const minDmg = wMetrics.minDmg;
    const maxDmg = wMetrics.maxDmg;
    const attackSpeed = wMetrics.attackSpeed;
    const avgDmg = (minDmg + maxDmg) / 2;
    const dps = Number((avgDmg * attackSpeed).toFixed(1));

    const affixes = [];
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        const meta = AFFIX_REGISTRY[k];
        const isPct = meta ? meta.isPct : (k === 'crit' || k.includes('Pct'));
        const label = meta ? meta.label : (STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)));
        affixes.push({ key: k, val: v, isPct, label, meta });
      }
    }

    // Add elemental damage subproperties if present
    const elemEntries = Object.entries(wMetrics.elementalDmg);
    const elemSub = elemEntries.length > 0
      ? ` • ${elemEntries.map(([dt, v]) => `+${v} ${DAMAGE_TYPE_METADATA[dt]?.name || dt}`).join(', ')}`
      : '';

    return {
      primaryValue: `${dps}`,
      primaryLabel: 'DAMAGE PER SECOND',
      subProperty: `${minDmg} - ${maxDmg} Damage • ${attackSpeed.toFixed(2)} APS${elemSub}`,
      baseDmgMin: minDmg,
      baseDmgMax: maxDmg,
      attackSpeed,
      baseArmor: 0,
      affixes,
      d3Power: {
        damage: Math.round(dps + (item.stats?.might || 0) * 2 + (item.stats?.crit || 0) * 100 * 0.5 + (item.stats?.spellDmg || 0)),
        toughness: (item.stats?.armor || 0) * 2 + (item.stats?.vitality || 0) * 2,
        utility: (item.stats?.agility || 0) + (item.stats?.focus || 0)
      }
    };
  }

  // 2. Armor Pieces (Helm, Armor, Boots, Gloves, Offhand Shield)
  if (['armor', 'helm', 'boots', 'gloves', 'offhand'].includes(item.slot)) {
    const armor = item.baseArmor ?? item.baseStats?.armor ?? item.stats?.armor ?? (item.slot === 'armor' ? 4 : 2);
    const affixes = [];
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        if (k !== 'armor') {
          const meta = AFFIX_REGISTRY[k];
          const isPct = meta ? meta.isPct : (k === 'crit' || k.includes('Pct'));
          const label = meta ? meta.label : (STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)));
          affixes.push({ key: k, val: v, isPct, label, meta });
        }
      }
    }

    const vit = item.stats?.vitality || 0;
    const hp = item.stats?.hp || 0;
    const might = item.stats?.might || 0;

    return {
      primaryValue: `${armor}`,
      primaryLabel: 'ARMOR RATING',
      subProperty: `${item.slot.toUpperCase()} PROTECTION`,
      baseDmgMin: 0,
      baseDmgMax: 0,
      attackSpeed: 1.0,
      baseArmor: armor,
      affixes,
      d3Power: {
        damage: (item.stats?.dmg || 0) + might * 1.5,
        toughness: armor * 3 + vit * 2 + hp,
        utility: (item.stats?.agility || 0) * 2 + (item.stats?.focus || 0)
      }
    };
  }

  // 3. Jewelry Metrics (Amulet, Ring)
  if (item.slot === 'amulet' || item.slot === 'ring') {
    const affixes = [];
    let topStat = null;
    let maxVal = -1;

    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        const meta = AFFIX_REGISTRY[k];
        const isPct = meta ? meta.isPct : (k === 'crit' || k.includes('Pct'));
        const label = meta ? meta.label : (STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)));
        affixes.push({ key: k, val: v, isPct, label, meta });
        if (typeof v === 'number' && v > maxVal && k !== 'crit') {
          maxVal = v;
          topStat = { key: k, val: v, label };
        }
      }
    }

    const primaryVal = topStat ? `+${topStat.val}` : (item.stats?.crit ? `+${Math.round(item.stats.crit * 100)}%` : '+1');
    const primaryLbl = topStat ? `${topStat.label.toUpperCase()} POWER` : `${item.slot.toUpperCase()} POWER`;

    return {
      primaryValue: primaryVal,
      primaryLabel: primaryLbl,
      subProperty: item.slot === 'amulet' ? 'AMULET ENCHANTMENT' : 'RING ENCHANTMENT',
      baseDmgMin: 0,
      baseDmgMax: 0,
      attackSpeed: 1.0,
      baseArmor: 0,
      affixes,
      d3Power: {
        damage: (item.stats?.dmg || 0) + (item.stats?.might || 0) * 2 + (item.stats?.crit || 0) * 100 * 0.5,
        toughness: (item.stats?.armor || 0) * 3 + (item.stats?.vitality || 0) * 2,
        utility: (item.stats?.focus || 0) * 2 + (item.stats?.agility || 0) * 2
      }
    };
  }

  // 4. Generic Gear
  const affixes = [];
  if (item.stats) {
    for (const [k, v] of Object.entries(item.stats)) {
      const meta = AFFIX_REGISTRY[k];
      const isPct = meta ? meta.isPct : (k === 'crit' || k.includes('Pct'));
      const label = meta ? meta.label : (STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)));
      affixes.push({ key: k, val: v, isPct, label, meta });
    }
  }
  return {
    primaryValue: '★',
    primaryLabel: 'EQUIPMENT',
    subProperty: null,
    baseDmgMin: 0,
    baseDmgMax: 0,
    attackSpeed: 1.0,
    baseArmor: 0,
    affixes,
    d3Power: { damage: 0, toughness: 0, utility: 0 }
  };
}

/**
 * UITooltip — Comprehensive Diablo III Style Comparative Item Inspection System.
 * Features:
 * - Side-by-side comparison with [CURRENTLY EQUIPPED] as the LEFTMOST panel.
 * - Perfectly aligned card heights, divider rails, big numbers, and action footers.
 * - Modular damage engine supporting weapon base damage ranges, attack speed, and armor.
 * - Glowing diamond bullets `◆`, inline comparison deltas, and D3 power meters.
 */
export class UITooltip extends UIComponent {
  constructor() {
    super({ id: 'item_tooltip', baseW: 210, baseH: 200, zOrder: 100, visible: false });
    this.item = null;
    this.equippedItem = null;
    this.targetBox = null;
    this.isConsumable = false;
    this.characterState = null;
  }

  show(item, equippedItem = null, targetBox = null, characterState = null) {
    this.item = item;
    this.equippedItem = equippedItem;
    this.targetBox = targetBox;
    this.characterState = characterState || equippedItem?.charState || null;
    this.isConsumable = item?.type === 'potion' || item?.type === 'consumable';
    this.visible = Boolean(item);
  }

  hide() {
    this.visible = false;
    this.item = null;
    this.equippedItem = null;
    this.targetBox = null;
    this.characterState = null;
  }

  hitTest(pxX, pxY, isTouch = false) {
    return null; // Pure overlay: never steals pointer focus
  }

  calcCardHeight(item, s, { isEquippedCard = false, isCompact = false, showD3Deltas = false, comparedTo = null } = {}) {
    if (!item) return Math.round(100 * s);
    const metrics = resolveItemMetrics(item);
    const isPotion = item.type === 'potion' || item.type === 'consumable';

    // Header (ribbon, title, subtitle, ornate divider): ~68px
    let baseH = 70;

    // Big Primary Stat Box: ~38px
    baseH += isCompact ? 30 : 38;

    // Affixes
    baseH += metrics.affixes.length * 15;

    // Missing affixes from equipped item
    if (!isEquippedCard && comparedTo?.stats) {
      for (const k of Object.keys(comparedTo.stats)) {
        if (!item.stats || item.stats[k] === undefined) {
          baseH += 15;
        }
      }
    }

    if (isPotion) {
      baseH += 18;
    }

    // D3 Delta Summary Box
    if (showD3Deltas) {
      baseH += 36;
    }

    // Bottom Action Bar
    baseH += 24;

    return Math.round(baseH * s);
  }

  draw(ctx, layout, animTime = 0) {
    if (!this.visible || !this.item) return;

    const s = layout.scale;
    const cardW = Math.round(205 * s);
    const gap = Math.round(8 * s);

    const item = this.item;
    const isConsumable = this.isConsumable;
    const isEquippedSelf = Boolean(this.equippedItem?.isEquippedSelf);
    const isDualRing = Boolean(this.equippedItem?.isDualRing);

    // Comparison Mode Detection
    const showComparison = !isConsumable && !isEquippedSelf && Boolean(this.equippedItem);
    let columns = 1;

    let eqItem1 = null;
    let eqItem2 = null;

    if (showComparison) {
      if (isDualRing) {
        eqItem1 = this.equippedItem.ring1 || null;
        eqItem2 = this.equippedItem.ring2 || null;
        if (eqItem1 || eqItem2) {
          columns = 2;
        }
      } else if (this.equippedItem?.name) {
        eqItem1 = this.equippedItem;
        columns = 2;
      }
    }

    // Calculate Heights
    const hoverRawH = this.calcCardHeight(item, s, {
      isEquippedCard: false,
      showD3Deltas: showComparison,
      comparedTo: eqItem1
    });

    let eq1RawH = 0;
    let eq2RawH = 0;
    let unifiedH = hoverRawH;

    if (columns === 2) {
      if (isDualRing) {
        eq1RawH = eqItem1 ? this.calcCardHeight(eqItem1, s, { isEquippedCard: true, isCompact: Boolean(eqItem2) }) : 0;
        eq2RawH = eqItem2 ? this.calcCardHeight(eqItem2, s, { isEquippedCard: true, isCompact: Boolean(eqItem1) }) : 0;
        const totalEqH = eq1RawH + (eqItem2 ? gap + eq2RawH : 0);
        unifiedH = Math.max(hoverRawH, totalEqH);
      } else if (eqItem1) {
        eq1RawH = this.calcCardHeight(eqItem1, s, { isEquippedCard: true });
        // UNIFIED HEIGHT: Both side-by-side cards share identical height for clean alignment
        unifiedH = Math.max(hoverRawH, eq1RawH);
      }
    }

    // Total width across columns
    const totalW = columns === 2 ? (cardW * 2 + gap) : cardW;

    // Positioning: Place adjacent to targetBox
    let startX = 10;
    let startY = 10;

    if (this.targetBox) {
      // Place to the LEFT of target box/inventory panel
      startX = this.targetBox.x - totalW - Math.round(12 * s);
      if (startX < 8) {
        // If left screen border overflows, flip to the RIGHT of target box
        startX = this.targetBox.x + this.targetBox.w + Math.round(12 * s);
        if (startX + totalW > layout.stageW - 8) {
          startX = Math.max(8, layout.stageW - totalW - 8);
        }
      }

      // Vertical clamping
      startY = Math.max(8, Math.min(layout.stageH - unifiedH - 8, this.targetBox.y - Math.round(10 * s)));
    }

    ctx.save();

    if (columns === 2) {
      // ORDERING: EQUIPPED IS THE LEFTMOST PANEL, INSPECTED IS ON THE RIGHT (CLOSEST TO INVENTORY)
      const eqX = startX;
      const hoverX = startX + cardW + gap;

      // Authoritative simulation diffs using StatEngine
      let equipDiff = null;
      let dualRingDiff = null;

      const activeCharState = this.characterState || {
        classId: 'VANGUARD',
        level: 1,
        stats: { might: 16, focus: 8, agility: 10, vitality: 16 },
        equipment: isDualRing ? { ring1: eqItem1, ring2: eqItem2 } : { [item.slot]: eqItem1 }
      };

      if (isDualRing) {
        dualRingDiff = StatEngine.simulateDualRingDiff({
          characterState: activeCharState,
          inspectedRing: item
        });
      } else if (eqItem1) {
        equipDiff = StatEngine.simulateEquipDiff({
          characterState: activeCharState,
          inspectedItem: item,
          targetSlot: item.slot
        });
      }

      // 1. Draw Leftmost Panel: Currently Equipped Item(s)
      if (isDualRing) {
        let curEqY = startY;
        if (eqItem1) {
          const h1 = eqItem2 ? Math.round((unifiedH - gap) / 2) : unifiedH;
          this.drawD3Card(ctx, eqItem1, eqX, curEqY, cardW, h1, s, animTime, {
            isEquippedCard: true,
            isCompact: Boolean(eqItem2),
            ribbonText: 'EQUIPPED (SLOT 1)',
            ribbonColor: '#4ade80',
            actionHintLMB: '[LMB] Unequip',
            actionHintRMB: null
          });
          curEqY += h1 + gap;
        }
        if (eqItem2) {
          const h2 = startY + unifiedH - curEqY;
          this.drawD3Card(ctx, eqItem2, eqX, curEqY, cardW, h2, s, animTime, {
            isEquippedCard: true,
            isCompact: Boolean(eqItem1),
            ribbonText: 'EQUIPPED (SLOT 2)',
            ribbonColor: '#4ade80',
            actionHintLMB: '[LMB] Unequip',
            actionHintRMB: null
          });
        }
      } else if (eqItem1) {
        this.drawD3Card(ctx, eqItem1, eqX, startY, cardW, unifiedH, s, animTime, {
          isEquippedCard: true,
          ribbonText: 'CURRENTLY EQUIPPED',
          ribbonColor: '#4ade80',
          actionHintLMB: '[LMB] Unequip',
          actionHintRMB: null
        });
      }

      // 2. Draw Right Panel: Inspected Pack Item (Adjacent to Inventory)
      this.drawD3Card(ctx, item, hoverX, startY, cardW, unifiedH, s, animTime, {
        isEquippedCard: false,
        ribbonText: 'INSPECTED ITEM',
        ribbonColor: '#dfa448',
        comparedTo: eqItem1,
        showD3Deltas: true,
        equipDiff,
        dualRingDiff,
        isDualRing,
        ring1: eqItem1,
        ring2: eqItem2,
        actionHintLMB: '[LMB] Equip / Drag',
        actionHintRMB: '[RMB] Drop'
      });
    } else {
      // Single Card Mode (Equipped paperdoll item or Consumable potion)
      this.drawD3Card(ctx, item, startX, startY, cardW, unifiedH, s, animTime, {
        isEquippedCard: isEquippedSelf,
        ribbonText: isConsumable ? 'CONSUMABLE' : (isEquippedSelf ? 'EQUIPPED GEAR' : 'ITEM INSPECTION'),
        ribbonColor: isEquippedSelf ? '#4ade80' : (isConsumable ? '#38bdf8' : '#dfa448'),
        comparedTo: null,
        showD3Deltas: false,
        actionHintLMB: isConsumable ? '[LMB] Consume' : (isEquippedSelf ? '[LMB] Unequip / Drag' : '[LMB] Equip / Drag'),
        actionHintRMB: '[RMB] Drop'
      });
    }

    ctx.restore();
  }

  /**
   * Renders a single Diablo III style card with unified vertical alignment.
   */
  drawD3Card(ctx, item, cardX, cardY, cardW, cardH, s, animTime, {
    isEquippedCard = false,
    isCompact = false,
    ribbonText = 'GEAR',
    ribbonColor = '#dfa448',
    comparedTo = null,
    showD3Deltas = false,
    equipDiff = null,
    dualRingDiff = null,
    isDualRing = false,
    ring1 = null,
    ring2 = null,
    actionHintLMB = '[LMB] Equip',
    actionHintRMB = '[RMB] Drop'
  } = {}) {
    if (!item) return;

    const rarity = item.rarity ?? RARITY.NORMAL;
    const col = RARITY_COLORS[rarity] || '#FFFFFF';
    const metrics = resolveItemMetrics(item);
    const isPotion = item.type === 'potion' || item.type === 'consumable';

    // 1. Heavy Diablo Drop Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(cardX - 3, cardY + 3, cardW + 6, cardH + 6);

    // 2. Diablo Slate Vignette Background
    const slateGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
    slateGrad.addColorStop(0, '#111522');
    slateGrad.addColorStop(0.25, '#0b0e17');
    slateGrad.addColorStop(1, '#05070a');
    ctx.fillStyle = slateGrad;
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // 3. Beveled Metallic Rarity Border
    const borderW = Math.max(1, Math.round(1.5 * s));
    ctx.lineWidth = borderW;
    ctx.strokeStyle = col;
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    // Inner subtle bronze rim
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110, 73, 23, 0.45)';
    ctx.strokeRect(cardX + 2, cardY + 2, cardW - 4, cardH - 4);

    // 4. Gothic Cast Brass Corner Rivets
    const rSize = Math.max(2, Math.round(2.5 * s));
    ctx.fillStyle = '#dfa448';
    ctx.fillRect(cardX + 2, cardY + 2, rSize, rSize);
    ctx.fillRect(cardX + cardW - 2 - rSize, cardY + 2, rSize, rSize);
    ctx.fillRect(cardX + 2, cardY + cardH - 2 - rSize, rSize, rSize);
    ctx.fillRect(cardX + cardW - 2 - rSize, cardY + cardH - 2 - rSize, rSize, rSize);

    // 5. Header Ribbon (Category / Status Badge & Weight)
    let curY = cardY + Math.round(15 * s);
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
    ctx.fillStyle = ribbonColor;
    ctx.fillText(ribbonText, cardX + Math.round(10 * s), curY);

    if (item.weight !== undefined) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      const wVal = (item.weight * (item.count || 1)).toFixed(1);
      ctx.fillText(`${wVal} lb`, cardX + cardW - Math.round(10 * s), curY);
    }

    // Integrated Ornate Divider
    curY += Math.round(6 * s);
    this.drawOrnateDivider(ctx, cardX + Math.round(8 * s), curY, cardW - Math.round(16 * s), s);

    // 6. Item Name & Subtitle
    curY += Math.round(14 * s);
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(11, Math.round(12.5 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(item.name, cardX + Math.round(10 * s) + 1, curY + 1);
    ctx.fillStyle = col;
    ctx.fillText(item.name, cardX + Math.round(10 * s), curY);

    // Subtitle
    curY += Math.round(12 * s);
    ctx.font = `${Math.max(8.5, Math.round(9 * s))}px monospace`;
    ctx.fillStyle = '#94a3b8';
    const sub = metrics.subProperty || (isPotion
      ? (item.subType === 'mp' ? 'Mana Restorative Draught' : 'Health Restorative Draught')
      : `${(item.rarityName || 'Item')} ${item.slot ? item.slot.charAt(0).toUpperCase() + item.slot.slice(1) : ''}`);
    ctx.fillText(sub, cardX + Math.round(10 * s), curY);

    // 7. Diablo 3 Big Number Primary Attribute Callout Box
    curY += Math.round(6 * s);
    const boxH = Math.round((isCompact ? 28 : 34) * s);
    const boxX = cardX + Math.round(8 * s);
    const boxW = cardW - Math.round(16 * s);

    // Recessed dark iron cavity
    ctx.fillStyle = '#06080e';
    ctx.fillRect(boxX, curY, boxW, boxH);
    ctx.strokeStyle = '#2b3448';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, curY, boxW, boxH);

    // Big Primary Number
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(16, Math.round((isCompact ? 16 : 20) * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(metrics.primaryValue, boxX + boxW / 2 + 1, curY + Math.round((isCompact ? 15 : 18) * s) + 1);
    ctx.fillStyle = '#FFF1E8'; // Ivory
    ctx.fillText(metrics.primaryValue, boxX + boxW / 2, curY + Math.round((isCompact ? 15 : 18) * s));

    // Big Number Label
    ctx.font = `bold ${Math.max(7, Math.round(7.5 * s))}px monospace`;
    ctx.fillStyle = '#dfa448'; // Antique Gold
    ctx.fillText(metrics.primaryLabel, boxX + boxW / 2, curY + boxH - Math.round(4 * s));

    curY += boxH + Math.round(7 * s);

    // 8. Properties / Affixes List (Diablo Diamond Bullets `◆`)
    const renderedKeys = new Set();
    for (const affix of metrics.affixes) {
      renderedKeys.add(affix.key);
      const label = STAT_LABELS[affix.key] || (affix.key.charAt(0).toUpperCase() + affix.key.slice(1));
      const str = `+${affix.isPct ? Math.round(affix.val * 100) + '%' : affix.val} ${label}`;

      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
      ctx.fillStyle = '#dfa448';
      ctx.fillText('◆', cardX + Math.round(10 * s), curY);

      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(str, cardX + Math.round(20 * s), curY);

      // Inline delta vs compared item
      if (!isEquippedCard && comparedTo?.stats) {
        const eqVal = comparedTo.stats[affix.key] || 0;
        const diff = affix.isPct ? Math.round((affix.val - eqVal) * 100) : (affix.val - eqVal);
        if (diff !== 0) {
          ctx.textAlign = 'right';
          ctx.fillStyle = diff > 0 ? '#4ade80' : '#f87171';
          const sign = diff > 0 ? `+${diff}` : `${diff}`;
          ctx.fillText(`(${sign}${affix.isPct ? '%' : ''})`, cardX + cardW - Math.round(10 * s), curY);
        } else {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#64748b';
          ctx.fillText('(0)', cardX + cardW - Math.round(10 * s), curY);
        }
      }

      curY += Math.round(14 * s);
    }

    // Missing Affixes (stats present on equipped item that inspected item lacks)
    if (!isEquippedCard && comparedTo?.stats) {
      for (const [eqKey, eqVal] of Object.entries(comparedTo.stats)) {
        if (!renderedKeys.has(eqKey)) {
          const label = STAT_LABELS[eqKey] || (eqKey.charAt(0).toUpperCase() + eqKey.slice(1));
          const isPct = eqKey === 'crit';

          ctx.textAlign = 'left';
          ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
          ctx.fillStyle = '#7f1d1d'; // Crimson bullet
          ctx.fillText('◆', cardX + Math.round(10 * s), curY);

          ctx.fillStyle = '#94a3b8';
          ctx.fillText(`+0 ${label}`, cardX + Math.round(20 * s), curY);

          ctx.textAlign = 'right';
          ctx.fillStyle = '#f87171'; // Red delta penalty
          ctx.fillText(`(-${isPct ? Math.round(eqVal * 100) + '%' : eqVal})`, cardX + cardW - Math.round(10 * s), curY);

          curY += Math.round(14 * s);
        }
      }
    }

    // 9. Diablo 3 Stat Delta Summary Block (on inspected item)
    if (showD3Deltas) {
      // Anchor D3 delta box consistently above the action bar
      const summaryY = cardY + cardH - Math.round(52 * s);
      this.drawOrnateDivider(ctx, cardX + Math.round(8 * s), summaryY, cardW - Math.round(16 * s), s);

      const textY = summaryY + Math.round(12 * s);

      if (isDualRing) {
        if (dualRingDiff) {
          const formatRingDiff = (d, label) => {
            if (!d) return { text: `vs ${label}: Direct Upgrade`, col: '#4ade80' };
            const dpsStr = `${d.dpsDelta >= 0 ? '+' : ''}${d.dpsDelta} DPS`;
            const armStr = `${d.armorDelta >= 0 ? '+' : ''}${d.armorDelta} Armor`;
            const col = (d.dpsDelta > 0 || d.armorDelta > 0) ? '#4ade80' : (d.dpsDelta < 0 && d.armorDelta < 0 ? '#f87171' : '#94a3b8');
            return { text: `vs ${label}: ${dpsStr}, ${armStr}`, col };
          };

          const s1 = formatRingDiff(dualRingDiff.diffR1, 'Ring 1');
          ctx.textAlign = 'left';
          ctx.font = `bold ${Math.max(7.5, Math.round(8 * s))}px monospace`;
          ctx.fillStyle = s1.col;
          ctx.fillText(s1.text, cardX + Math.round(10 * s), textY);

          const s2 = formatRingDiff(dualRingDiff.diffR2, 'Ring 2');
          ctx.fillStyle = s2.col;
          ctx.fillText(s2.text, cardX + Math.round(10 * s), textY + Math.round(11 * s));
        } else {
          const calcSummary = (eq) => {
            if (!eq) return { text: 'Direct Upgrade (Empty)', col: '#4ade80' };
            const gains = [];
            for (const aff of metrics.affixes) {
              const diff = aff.val - (eq.stats?.[aff.key] || 0);
              if (diff > 0) gains.push(`+${aff.isPct ? Math.round(diff * 100) + '%' : diff} ${aff.key}`);
            }
            if (gains.length === 0) return { text: 'No Stat Gain', col: '#94a3b8' };
            return { text: `▲ ${gains.slice(0, 2).join(', ')}`, col: '#4ade80' };
          };

          const s1 = calcSummary(ring1);
          ctx.textAlign = 'left';
          ctx.font = `${Math.max(7.5, Math.round(8 * s))}px monospace`;
          ctx.fillStyle = s1.col;
          ctx.fillText(`vs R1: ${s1.text}`, cardX + Math.round(10 * s), textY);

          const s2 = calcSummary(ring2);
          ctx.fillStyle = s2.col;
          ctx.fillText(`vs R2: ${s2.text}`, cardX + Math.round(10 * s), textY + Math.round(11 * s));
        }
      } else if (equipDiff) {
        // Authoritative StatEngine comparison (exact match to Character Sheet!)
        const dpsSign = equipDiff.dpsDelta >= 0 ? '+' : '';
        const armSign = equipDiff.armorDelta >= 0 ? '+' : '';
        const dpsPctStr = `(${equipDiff.dpsPct >= 0 ? '+' : ''}${equipDiff.dpsPct}%)`;
        const toughPctStr = `(${equipDiff.toughnessPct >= 0 ? '+' : ''}${equipDiff.toughnessPct}%)`;

        const dpsCol = equipDiff.dpsDelta > 0 ? '#4ade80' : (equipDiff.dpsDelta < 0 ? '#f87171' : '#94a3b8');
        const dpsArrow = equipDiff.dpsDelta > 0 ? '▲' : (equipDiff.dpsDelta < 0 ? '▼' : '—');

        const armCol = equipDiff.armorDelta > 0 ? '#4ade80' : (equipDiff.armorDelta < 0 ? '#f87171' : '#94a3b8');
        const armArrow = equipDiff.armorDelta > 0 ? '▲' : (equipDiff.armorDelta < 0 ? '▼' : '—');

        ctx.textAlign = 'left';
        ctx.font = `bold ${Math.max(7.5, Math.round(8 * s))}px monospace`;
        ctx.fillStyle = dpsCol;
        ctx.fillText(`${dpsArrow} ${dpsSign}${equipDiff.dpsDelta} DPS ${dpsPctStr}`, cardX + Math.round(10 * s), textY);

        ctx.textAlign = 'right';
        ctx.fillStyle = armCol;
        ctx.fillText(`${armArrow} ${armSign}${equipDiff.armorDelta} Armor ${toughPctStr}`, cardX + cardW - Math.round(10 * s), textY);
      } else if (comparedTo) {
        const compMetrics = resolveItemMetrics(comparedTo);
        const dmgDiff = metrics.d3Power.damage - compMetrics.d3Power.damage;
        const toughDiff = metrics.d3Power.toughness - compMetrics.d3Power.toughness;

        ctx.textAlign = 'left';
        ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;

        // Damage Delta
        const dmgCol = dmgDiff > 0 ? '#4ade80' : (dmgDiff < 0 ? '#f87171' : '#94a3b8');
        const dmgArrow = dmgDiff > 0 ? '▲' : (dmgDiff < 0 ? '▼' : '—');
        ctx.fillStyle = dmgCol;
        ctx.fillText(`${dmgArrow} ${dmgDiff >= 0 ? '+' : ''}${dmgDiff} Damage`, cardX + Math.round(10 * s), textY);

        // Toughness Delta
        const toughCol = toughDiff > 0 ? '#4ade80' : (toughDiff < 0 ? '#f87171' : '#94a3b8');
        const toughArrow = toughDiff > 0 ? '▲' : (toughDiff < 0 ? '▼' : '—');
        ctx.textAlign = 'right';
        ctx.fillStyle = toughCol;
        ctx.fillText(`${toughArrow} ${toughDiff >= 0 ? '+' : ''}${toughDiff} Toughness`, cardX + cardW - Math.round(10 * s), textY);
      } else {
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('▲ DIRECT UPGRADE (SLOT EMPTY)', cardX + cardW / 2, textY);
      }
    }

    // 10. Bottom Action Bar (Pinned cleanly to bottom of card)
    const actionY = cardY + cardH - Math.round(9 * s);
    ctx.strokeStyle = 'rgba(61, 71, 95, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + Math.round(8 * s), actionY - Math.round(8 * s));
    ctx.lineTo(cardX + cardW - Math.round(8 * s), actionY - Math.round(8 * s));
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = `${Math.max(8, Math.round(8.5 * s))}px monospace`;
    ctx.fillStyle = '#dfa448';
    ctx.fillText(actionHintLMB, cardX + Math.round(10 * s), actionY);

    if (actionHintRMB) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(actionHintRMB, cardX + cardW - Math.round(10 * s), actionY);
    }
  }

  /**
   * Renders an integrated metallic horizontal divider with a cast bronze diamond flourish.
   */
  drawOrnateDivider(ctx, startX, y, width, s) {
    ctx.save();
    // Dark recessed groove
    ctx.strokeStyle = '#182030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + width, y);
    ctx.stroke();

    // Metallic bronze highlight rail
    ctx.strokeStyle = 'rgba(110, 73, 23, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX + Math.round(8 * s), y);
    ctx.lineTo(startX + width - Math.round(8 * s), y);
    ctx.stroke();

    // Inlaid central bronze diamond
    const midX = startX + width / 2;
    const dSize = Math.max(1.8, Math.round(2 * s));
    ctx.fillStyle = '#dfa448';
    ctx.beginPath();
    ctx.moveTo(midX, y - dSize);
    ctx.lineTo(midX + dSize, y);
    ctx.lineTo(midX, y + dSize);
    ctx.lineTo(midX - dSize, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
