import { UIPanel } from '../primitives/UIPanel.js';
import { UIButton } from '../primitives/UIButton.js';
import { uiTheme } from '../UITheme.js';
import { UI_ANCHOR } from '../UILayout.js';
import { PACKET_TYPES, RARITY_COLORS, GAME_MODES } from '../../../../shared/Constants.js';
import { drawBitSprite } from '../../BitSprites.js';
import {
  StatEngine,
  DAMAGE_TYPES,
  DAMAGE_TYPE_METADATA,
  RESISTANCE_TYPES,
  RESISTANCE_METADATA,
  AFFIX_REGISTRY
} from '../../../../shared/StatEngine.js';

/**
 * UICharacter — Medieval Leather-Bound Hero Chronicle / Character Grimoire.
 * Features categorized tab navigation (STATS, OFFENSE, DEFENSE) for comprehensive hero metrics,
 * interactive attribute allocation, and clean dual-grimoire docking with UIInventory.
 */
export class UICharacter extends UIPanel {
  constructor({ sendPacket, audio, onClose } = {}) {
    super({
      id: 'panel_character',
      title: '', // Styled leather tome cover with cast brass corners
      anchor: UI_ANCHOR.TOP_LEFT,
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

    // Active Category Tab: 'stats' | 'offense' | 'defense'
    this.activeTab = 'stats';

    // Player state cache
    this.charName = 'Hero';
    this.className = 'Vanguard';
    this.classId = 'VANGUARD';
    this.level = 1;
    this.xp = 0;
    this.nextXp = 100;
    this.statPoints = 0;
    this.mode = GAME_MODES.CLASSIC;
    this.floor = 1;
    this.potions = 3;
    this.manaPotions = 0;

    this.stats = {
      might: 10,
      focus: 10,
      agility: 10,
      vitality: 10
    };

    this.derived = {
      dmgMin: 4,
      dmgMax: 8,
      spellDmg: 0,
      armor: 4,
      crit: 5,
      speed: 1.0
    };

    this.vitals = {
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50
    };

    this.equipment = {};

    // Category Navigation Tabs
    const tabW = 78;
    const tabH = 22;
    this.tabStats = new UIButton({
      id: 'tab_stats',
      text: 'STATS',
      baseW: tabW,
      baseH: tabH,
      offsetX: 26,
      offsetY: 72,
      variant: 'primary',
      onClick: () => this.switchTab('stats')
    });

    this.tabOffense = new UIButton({
      id: 'tab_offense',
      text: 'OFFENSE',
      baseW: tabW,
      baseH: tabH,
      offsetX: 111,
      offsetY: 72,
      variant: 'default',
      onClick: () => this.switchTab('offense')
    });

    this.tabDefense = new UIButton({
      id: 'tab_defense',
      text: 'DEFENSE',
      baseW: tabW,
      baseH: tabH,
      offsetX: 196,
      offsetY: 72,
      variant: 'default',
      onClick: () => this.switchTab('defense')
    });

    this.tabs = [this.tabStats, this.tabOffense, this.tabDefense];
    for (const t of this.tabs) {
      this.addChild(t);
    }

    // Attribute Allocation [+] Buttons (active only on 'stats' tab when statPoints > 0)
    const btnSize = 18;
    this.btnMight = new UIButton({
      id: 'btn_alloc_might',
      text: '+',
      baseW: btnSize,
      baseH: btnSize,
      offsetX: 242,
      offsetY: 130,
      variant: 'primary',
      onClick: () => this.handleAlloc('might')
    });

    this.btnFocus = new UIButton({
      id: 'btn_alloc_focus',
      text: '+',
      baseW: btnSize,
      baseH: btnSize,
      offsetX: 242,
      offsetY: 168,
      variant: 'primary',
      onClick: () => this.handleAlloc('focus')
    });

    this.btnAgility = new UIButton({
      id: 'btn_alloc_agility',
      text: '+',
      baseW: btnSize,
      baseH: btnSize,
      offsetX: 242,
      offsetY: 206,
      variant: 'primary',
      onClick: () => this.handleAlloc('agility')
    });

    this.btnVitality = new UIButton({
      id: 'btn_alloc_vitality',
      text: '+',
      baseW: btnSize,
      baseH: btnSize,
      offsetX: 242,
      offsetY: 244,
      variant: 'primary',
      onClick: () => this.handleAlloc('vitality')
    });

    this.allocButtons = [this.btnMight, this.btnFocus, this.btnAgility, this.btnVitality];
    for (const b of this.allocButtons) {
      b.visible = false;
      this.addChild(b);
    }
  }

  switchTab(tabId) {
    if (this.activeTab === tabId) return;
    this.activeTab = tabId;
    this.audio?.play?.('paper', { pitchJitter: 0.05 }) || this.audio?.play?.('click');

    // Update Tab button visuals
    this.tabStats.variant = tabId === 'stats' ? 'primary' : 'default';
    this.tabOffense.variant = tabId === 'offense' ? 'primary' : 'default';
    this.tabDefense.variant = tabId === 'defense' ? 'primary' : 'default';

    this.updateButtonVisibility();
  }

  handleAlloc(statName) {
    if (this.statPoints <= 0) return;
    this.sendPacket?.({ type: PACKET_TYPES.ALLOC_STAT, stat: statName });
    this.audio?.play?.('click', { pitchJitter: 0.08 });
    this.statPoints = Math.max(0, this.statPoints - 1);
    if (this.stats[statName] !== undefined) {
      this.stats[statName]++;
    }
    this.updateButtonVisibility();
  }

  updateButtonVisibility() {
    const showAlloc = this.activeTab === 'stats' && this.statPoints > 0;
    for (const b of this.allocButtons) {
      b.visible = showAlloc;
      b.enabled = showAlloc;
    }
  }

  updateData(myP, priv, activeRoomMode = GAME_MODES.CLASSIC, floor = 1) {
    if (myP) {
      this.charName = myP.name || this.charName;
      this.vitals.hp = myP.hp ?? this.vitals.hp;
      this.vitals.maxHp = myP.maxHp ?? this.vitals.maxHp;
      this.vitals.mp = myP.mp ?? this.vitals.mp;
      this.vitals.maxMp = myP.maxMp ?? this.vitals.maxMp;
    }

    if (priv) {
      this.level = priv.level ?? this.level;
      this.className = priv.className || priv.classId || this.className;
      this.classId = (priv.classId || this.classId).toUpperCase();
      this.xp = priv.xp ?? this.xp;
      this.nextXp = priv.nextXp ?? 100;
      this.statPoints = priv.statPoints ?? 0;
      this.potions = priv.potions ?? 3;
      this.manaPotions = priv.manaPotions ?? 0;

      if (priv.stats) {
        this.stats.might = priv.stats.might ?? this.stats.might;
        this.stats.focus = priv.stats.focus ?? this.stats.focus;
        this.stats.agility = priv.stats.agility ?? this.stats.agility;
        this.stats.vitality = priv.stats.vitality ?? this.stats.vitality;
      }

      if (priv.derived) {
        this.derived.dmgMin = priv.derived.dmgMin ?? this.derived.dmgMin;
        this.derived.dmgMax = priv.derived.dmgMax ?? this.derived.dmgMax;
        this.derived.spellDmg = priv.derived.spellDmg ?? this.derived.spellDmg;
        this.derived.armor = priv.derived.armor ?? this.derived.armor;
        this.derived.crit = priv.derived.crit ?? this.derived.crit;
        this.derived.speed = priv.derived.speed ?? this.derived.speed;
      }
      if (priv.equipment) {
        this.equipment = priv.equipment;
      }
    }

    this.mode = activeRoomMode;
    this.floor = floor;

    // Unified single source of truth calculation via StatEngine
    this.statProfile = StatEngine.calculateCharacterStats({
      classId: this.classId,
      level: this.level,
      stats: this.stats,
      equipment: this.equipment,
      derivedOverrides: this.derived
    });

    this.updateButtonVisibility();
  }

  getGearBonuses() {
    if (this.statProfile?.gearBonuses) {
      return this.statProfile.gearBonuses;
    }
    return StatEngine.aggregateEquipmentBonuses(this.equipment);
  }

  getTotalStats() {
    if (this.statProfile?.totalStats) {
      return {
        ...this.statProfile.totalStats,
        gear: this.statProfile.gearBonuses
      };
    }
    const gear = this.getGearBonuses();
    return {
      might: (this.stats.might || 10) + gear.might,
      focus: (this.stats.focus || 10) + gear.focus,
      agility: (this.stats.agility || 10) + gear.agility,
      vitality: (this.stats.vitality || 10) + gear.vitality,
      gear
    };
  }

  updateLayout(layout) {
    if (layout.isCompact) {
      this.anchor = UI_ANCHOR.CENTER;
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      this.anchor = UI_ANCHOR.TOP_LEFT;
      this.offsetX = 14;
      this.offsetY = 10;
    }

    super.updateLayout(layout);

    // Sync tab buttons
    const s = layout.scale;
    const tabW = Math.round(78 * s);
    const tabH = Math.round(22 * s);
    const tabY = Math.round(this.y + 70 * s);

    this.tabStats.x = Math.round(this.x + 26 * s);
    this.tabStats.y = tabY;
    this.tabStats.w = tabW;
    this.tabStats.h = tabH;

    this.tabOffense.x = Math.round(this.x + 111 * s);
    this.tabOffense.y = tabY;
    this.tabOffense.w = tabW;
    this.tabOffense.h = tabH;

    this.tabDefense.x = Math.round(this.x + 196 * s);
    this.tabDefense.y = tabY;
    this.tabDefense.w = tabW;
    this.tabDefense.h = tabH;

    // Sync attribute allocation buttons
    const btnSize = Math.round(18 * s);
    const btnX = Math.round(this.x + 242 * s);
    const startY = Math.round(this.y + 130 * s);
    const rowStep = Math.round(38 * s);

    for (let i = 0; i < this.allocButtons.length; i++) {
      const b = this.allocButtons[i];
      b.w = btnSize;
      b.h = btnSize;
      b.x = btnX;
      b.y = startY + i * rowStep;
    }
  }

  hitTest(pxX, pxY, isTouch = false) {
    if (!this.visible || !this.enabled) return null;

    // 1. Check navigation tabs
    for (const t of this.tabs) {
      if (t.visible) {
        const hit = t.hitTest(pxX, pxY, isTouch);
        if (hit) return hit;
      }
    }

    // 2. Check allocation buttons (on 'stats' tab)
    if (this.activeTab === 'stats' && this.statPoints > 0) {
      for (const b of this.allocButtons) {
        if (b.visible) {
          const hit = b.hitTest(pxX, pxY, isTouch);
          if (hit) return hit;
        }
      }
    }

    // 3. Panel bounding box
    if (pxX >= this.x && pxX <= this.x + this.w && pxY >= this.y && pxY <= this.y + this.h) {
      return this;
    }

    return null;
  }

  render(ctx, layout, animTime = 0) {
    if (!this.visible) return;

    // 1. Base tome and manuscript page interior
    this.draw(ctx, layout, animTime);

    // 2. Navigation tabs
    for (const t of this.tabs) {
      if (t.visible) {
        t.draw(ctx, layout, animTime);
      }
    }

    // 3. Stat allocation buttons (if on stats tab with available points)
    if (this.activeTab === 'stats' && this.statPoints > 0) {
      for (const b of this.allocButtons) {
        if (b.visible) {
          b.draw(ctx, layout, animTime);
        }
      }
    }
  }

  draw(ctx, layout, animTime = 0) {
    super.draw(ctx, layout, animTime);

    const { x, y, w, h } = this;
    const s = layout.scale;

    ctx.save();

    // 1. Hero Heraldry & Crest Header (Top 55px)
    const crestX = x + Math.round(26 * s);
    const crestY = y + Math.round(20 * s);
    const crestSize = Math.round(28 * s);

    // Gilded medallion emblem socket
    ctx.fillStyle = '#06080e';
    ctx.fillRect(crestX, crestY, crestSize, crestSize);
    ctx.strokeStyle = '#dfa448';
    ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
    ctx.strokeRect(crestX, crestY, crestSize, crestSize);

    // Class emblem bit-sprite
    const emblemKey = this.classId === 'MAGE' ? 'orb' : (this.classId === 'ROGUE' ? 'dirk' : 'cuirass');
    const pScale = Math.max(1, Math.round(1.6 * s));
    drawBitSprite(ctx, emblemKey, crestX + Math.round(5 * s), crestY + Math.round(4 * s), pScale, uiTheme.palette);

    // Hero Name & Class/Level Title
    const titleX = crestX + crestSize + Math.round(10 * s);
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(11, Math.round(12.5 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(this.charName, titleX + 1, crestY + Math.round(12 * s) + 1);
    ctx.fillStyle = '#FFF1E8'; // Ivory
    ctx.fillText(this.charName, titleX, crestY + Math.round(12 * s));

    // Level and Class
    ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
    ctx.fillStyle = '#dfa448';
    ctx.fillText(`Level ${this.level} ${this.className}`, titleX, crestY + Math.round(24 * s));

    // Realm Mode Tag
    ctx.textAlign = 'right';
    ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
    const isHC = this.mode === GAME_MODES.HARDCORE;
    ctx.fillStyle = isHC ? '#f87171' : '#38bdf8';
    ctx.fillText(isHC ? 'HARDCORE' : 'CLASSIC', x + w - Math.round(26 * s), crestY + Math.round(12 * s));

    // Experience Progression Bar
    const xpY = crestY + crestSize + Math.round(5 * s);
    const barW = w - Math.round(52 * s);
    const barH = Math.round(5 * s);
    const xpPct = Math.min(1.0, Math.max(0.0, this.xp / (this.nextXp || 100)));

    // Recessed XP Bar
    ctx.fillStyle = '#06080e';
    ctx.fillRect(x + Math.round(26 * s), xpY, barW, barH);
    ctx.strokeStyle = '#2b3448';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + Math.round(26 * s), xpY, barW, barH);

    // Amethyst XP fill
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(x + Math.round(26 * s) + 1, xpY + 1, Math.round((barW - 2) * xpPct), barH - 2);

    // 2. Tab Navigation Underline Rail
    const tabRailY = y + Math.round(94 * s);
    ctx.strokeStyle = '#2b3448';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + Math.round(20 * s), tabRailY);
    ctx.lineTo(x + w - Math.round(20 * s), tabRailY);
    ctx.stroke();

    // Glowing highlight beneath the active tab
    const activeTabObj = this.activeTab === 'stats' ? this.tabStats : (this.activeTab === 'offense' ? this.tabOffense : this.tabDefense);
    ctx.strokeStyle = '#dfa448';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(activeTabObj.x, tabRailY);
    ctx.lineTo(activeTabObj.x + activeTabObj.w, tabRailY);
    ctx.stroke();

    // 3. Active Tab Content Rendering
    if (this.activeTab === 'stats') {
      this.drawStatsTab(ctx, x, y, w, s, animTime);
    } else if (this.activeTab === 'offense') {
      this.drawOffenseTab(ctx, x, y, w, s, animTime);
    } else {
      this.drawDefenseTab(ctx, x, y, w, s, animTime);
    }

    // 4. Clasp Footer (Dungeon Floor & Record)
    const claspW = Math.round(250 * s);
    const claspH = Math.round(28 * s);
    const claspX = x + Math.round((w - claspW) / 2);
    const claspY = y + h - claspH - Math.round(10 * s);

    ctx.fillStyle = '#1e120b';
    ctx.fillRect(claspX, claspY, claspW, claspH);
    ctx.strokeStyle = '#6e4917';
    ctx.lineWidth = Math.max(1, Math.round(1 * s));
    ctx.strokeRect(claspX, claspY, claspW, claspH);
    ctx.strokeStyle = '#dfa448';
    ctx.strokeRect(claspX + 1, claspY + 1, claspW - 2, claspH - 2);

    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
    ctx.fillStyle = '#dfa448';
    ctx.fillText(`DUNGEON FLOOR ${this.floor}`, claspX + Math.round(12 * s), claspY + Math.round(18 * s));

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`HERO OF SANCTUM`, claspX + claspW - Math.round(12 * s), claspY + Math.round(18 * s));

    ctx.restore();
  }

  /**
   * Tab 1: Primary Attributes & Allocation [+] Controls
   */
  drawStatsTab(ctx, x, y, w, s, animTime) {
    const startY = y + Math.round(102 * s);
    const contentW = w - Math.round(52 * s);
    const totals = this.getTotalStats();

    // Unspent Points Alert Banner
    if (this.statPoints > 0) {
      const pulse = Math.sin(animTime * 4.0) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(250, 204, 21, ${pulse * 0.18})`;
      ctx.fillRect(x + Math.round(26 * s), startY, contentW, Math.round(18 * s));
      ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + Math.round(26 * s), startY, contentW, Math.round(18 * s));

      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
      ctx.fillStyle = '#fef08a';
      ctx.fillText(`★ UNSPENT STAT POINTS: ${this.statPoints}`, x + w / 2, startY + Math.round(12 * s));
    } else {
      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
      ctx.fillStyle = '#dfa448';
      ctx.fillText('CORE ATTRIBUTES & SPECIALIZATION', x + Math.round(26 * s), startY + Math.round(12 * s));
    }

    // 4 Detailed Attribute Rows
    const rowsY = startY + Math.round(24 * s);
    const rowH = Math.round(38 * s);

    const attrDefs = [
      {
        key: 'might',
        label: 'Might',
        baseVal: this.stats.might,
        totalVal: totals.might,
        gearBonus: totals.gear.might,
        eff1: `+${Math.round(totals.might * 1.5)} Physical Attack Power`,
        eff2: `+${Math.floor(totals.might * 0.25)} Base Armor Defense`
      },
      {
        key: 'focus',
        label: 'Focus',
        baseVal: this.stats.focus,
        totalVal: totals.focus,
        gearBonus: totals.gear.focus,
        eff1: `+${totals.focus} Spell & Magic Potency`,
        eff2: `+${totals.focus * 3} Maximum Mana Pool`
      },
      {
        key: 'agility',
        label: 'Agility',
        baseVal: this.stats.agility,
        totalVal: totals.agility,
        gearBonus: totals.gear.agility,
        eff1: `+${(totals.agility * 0.4).toFixed(1)}% Critical Strike Chance`,
        eff2: `+${(totals.agility * 0.25).toFixed(1)}% Tactical Evasion`
      },
      {
        key: 'vitality',
        label: 'Vitality',
        baseVal: this.stats.vitality,
        totalVal: totals.vitality,
        gearBonus: totals.gear.vitality,
        eff1: `+${totals.vitality * 5} Maximum Health Pool`,
        eff2: `+${(totals.vitality * 0.2).toFixed(1)}/s Natural Health Regen`
      }
    ];

    for (let i = 0; i < attrDefs.length; i++) {
      const row = attrDefs[i];
      const curY = rowsY + i * rowH;

      // Card box background for each attribute
      ctx.fillStyle = '#080a11';
      ctx.fillRect(x + Math.round(26 * s), curY, contentW, Math.round(34 * s));
      ctx.strokeStyle = '#1e2536';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + Math.round(26 * s), curY, contentW, Math.round(34 * s));

      // Attribute bit-sprite icon
      const iconScale = Math.max(1, Math.round(1.5 * s));
      drawBitSprite(ctx, row.key, x + Math.round(32 * s), curY + Math.round(7 * s), iconScale, uiTheme.palette);

      // Stat Label
      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.max(9, Math.round(10 * s))}px monospace`;
      ctx.fillStyle = '#FFF1E8';
      ctx.fillText(row.label, x + Math.round(52 * s), curY + Math.round(12 * s));

      // Effect descriptions
      ctx.font = `${Math.max(7, Math.round(7.5 * s))}px monospace`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(row.eff1, x + Math.round(52 * s), curY + Math.round(21 * s));
      ctx.fillText(row.eff2, x + Math.round(52 * s), curY + Math.round(29 * s));

      // Stat Value
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.max(12, Math.round(13 * s))}px monospace`;
      ctx.fillStyle = '#fde047';
      const valX = this.statPoints > 0 ? (x + Math.round(236 * s)) : (x + w - Math.round(34 * s));

      if (row.gearBonus > 0) {
        ctx.fillText(`${row.totalVal}`, valX, curY + Math.round(15 * s));
        ctx.font = `${Math.max(6.5, Math.round(7.5 * s))}px monospace`;
        ctx.fillStyle = '#4ade80'; // Emerald gear bonus
        ctx.fillText(`(${row.baseVal} +${row.gearBonus})`, valX, curY + Math.round(26 * s));
      } else {
        ctx.fillText(`${row.totalVal}`, valX, curY + Math.round(18 * s));
      }
    }

    // Vitals Summary Line at Bottom
    const vitalsY = rowsY + 4 * rowH + Math.round(6 * s);
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
    ctx.fillStyle = '#fb7185';
    ctx.fillText(`Health: ${this.vitals.hp} / ${this.vitals.maxHp}`, x + Math.round(26 * s), vitalsY);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`Mana: ${this.vitals.mp} / ${this.vitals.maxMp}`, x + w - Math.round(26 * s), vitalsY);
  }

  /**
   * Tab 2: Offensive Combat Metrics & Multipliers
   */
  drawOffenseTab(ctx, x, y, w, s, animTime) {
    const startY = y + Math.round(102 * s);
    const contentW = w - Math.round(52 * s);
    const totals = this.getTotalStats();

    // Weapon & Attack Speed Resolution
    const weaponItem = this.equipment?.weapon;
    const weaponName = weaponItem?.name || 'Unarmed (Fists)';

    let baseAps = 1.20;
    if (weaponItem?.attackSpeed) {
      baseAps = weaponItem.attackSpeed;
    } else if (weaponItem?.speed && weaponItem.speed <= 3.0) {
      baseAps = weaponItem.speed;
    } else if (weaponItem?.baseStats?.speed && weaponItem.baseStats.speed <= 3.0) {
      baseAps = weaponItem.baseStats.speed;
    }

    // Agility Attack Speed modifier (0.5% per point of Agility above 10)
    const apsBonus = Math.max(0, (totals.agility - 10) * 0.005);
    const attackSpeed = Number((baseAps + apsBonus).toFixed(2));

    // Authoritative Combat Scaling & DPS
    const dmgMin = this.derived.dmgMin || 4;
    const dmgMax = this.derived.dmgMax || 8;
    const avgDmg = (dmgMin + dmgMax) / 2;

    const primStatVal = this.classId === 'ARCANIST' ? totals.focus : (this.classId === 'SHADOW' ? totals.agility : totals.might);
    const statScalar = 1 + Math.max(0, (primStatVal - 10) * 0.02);
    const critPct = this.derived.crit || 15;
    const critFactor = 1 + (critPct / 100) * 0.50; // 1.5x crit damage (+50% bonus)

    const dps = Math.round(avgDmg * statScalar * attackSpeed * critFactor);
    const boxH = Math.round(34 * s);

    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(x + Math.round(26 * s), startY, contentW, boxH);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + Math.round(26 * s), startY, contentW, boxH);

    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(16, Math.round(18 * s))}px monospace`;
    ctx.fillStyle = '#FFF1E8';
    ctx.fillText(`${dps}`, x + w / 2, startY + Math.round(18 * s));

    ctx.font = `bold ${Math.max(7.5, Math.round(8 * s))}px monospace`;
    ctx.fillStyle = '#f87171';
    ctx.fillText('ESTIMATED DAMAGE PER SECOND (DPS)', x + w / 2, startY + boxH - Math.round(5 * s));

    // Detailed Offensive Stats Table
    const tableY = startY + boxH + Math.round(8 * s);
    const stepY = Math.round(19 * s);

    const offStats = [
      { label: 'Attack Damage Range', val: `${dmgMin} – ${dmgMax}`, sub: 'Weapon & physical rolls' },
      { label: 'Main Hand Weapon',    val: weaponName,               sub: 'Equipped primary arm' },
      { label: 'Attack Speed',        val: `${attackSpeed.toFixed(2)} APS`, sub: 'Weapon swing velocity' },
      { label: 'Critical Strike Chance', val: `${critPct}%`,         sub: 'Base + Agility + Gear' },
      { label: 'Critical Damage Bonus',  val: '+50%',                sub: '150% base critical strike damage' },
      { label: 'Spell Power',          val: `+${this.derived.spellDmg || 0}`, sub: 'Arcane & magical potency' },
      { label: 'Primary Stat Scaling', val: `+${Math.round(Math.max(0, primStatVal - 10) * 2)}%`, sub: `Damage bonus from ${this.className} stat` },
      { label: 'Focus Magic Bonus',    val: `+${totals.focus}`,      sub: 'Added from total Focus' }
    ];

    for (let i = 0; i < offStats.length; i++) {
      const st = offStats[i];
      const curY = tableY + i * stepY;

      // Underline groove
      ctx.strokeStyle = '#181e2b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + Math.round(26 * s), curY + Math.round(16 * s));
      ctx.lineTo(x + w - Math.round(26 * s), curY + Math.round(16 * s));
      ctx.stroke();

      // Label & Subtitle
      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(st.label, x + Math.round(26 * s), curY + Math.round(9 * s));

      ctx.font = `${Math.max(6.5, Math.round(7 * s))}px monospace`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(st.sub, x + Math.round(26 * s), curY + Math.round(15 * s));

      // Value
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
      ctx.fillStyle = '#f87171';
      ctx.fillText(st.val, x + w - Math.round(26 * s), curY + Math.round(11 * s));
    }
  }

  /**
   * Tab 3: Defensive & Survival Metrics
   */
  drawDefenseTab(ctx, x, y, w, s, animTime) {
    const startY = y + Math.round(102 * s);
    const contentW = w - Math.round(52 * s);
    const totals = this.getTotalStats();

    // Primary Armor Rating Callout Banner (Using authoritative CombatMath reduction)
    const totalArmor = this.derived.armor || 0;
    const boxH = Math.round(34 * s);
    const drPct = Math.min(75, Math.round((totalArmor / (totalArmor + 50)) * 100));

    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(x + Math.round(26 * s), startY, contentW, boxH);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + Math.round(26 * s), startY, contentW, boxH);

    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(16, Math.round(18 * s))}px monospace`;
    ctx.fillStyle = '#FFF1E8';
    ctx.fillText(`${totalArmor}`, x + w / 2, startY + Math.round(18 * s));

    ctx.font = `bold ${Math.max(7.5, Math.round(8 * s))}px monospace`;
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`TOTAL ARMOR RATING • ~${drPct}% DAMAGE REDUCTION`, x + w / 2, startY + boxH - Math.round(5 * s));

    // Detailed Defensive Stats Table (Explicitly includes Total Armor & Character Sheet stats, no potions)
    const tableY = startY + boxH + Math.round(8 * s);
    const stepY = Math.round(19 * s);

    const isHC = this.mode === GAME_MODES.HARDCORE;
    const dodgePct = Math.min(35, Number((totals.agility * 0.25).toFixed(1)));
    const moveVelocity = this.derived.speed || 100;

    // Modular Elemental Resistances from StatEngine
    const activeRes = [];
    if (this.statProfile?.defense?.resistances) {
      for (const [rKey, rData] of Object.entries(this.statProfile.defense.resistances)) {
        if (rData.val > 0) {
          activeRes.push(`${rData.meta.damageType.slice(0, 1).toUpperCase()}: ${rData.pct}%`);
        }
      }
    }
    const resValStr = activeRes.length > 0 ? activeRes.join(' • ') : '0% Base';

    const defStats = [
      { label: 'Total Armor Rating',        val: `${totalArmor}`,                                sub: 'Base class + equipment + vitality' },
      { label: 'Physical Damage Reduction', val: `${drPct}%`,                                    sub: 'Mitigation against physical strikes' },
      { label: 'Elemental Resistances',     val: resValStr,                                      sub: 'Fire, Cold, Lightning & Poison mitigation' },
      { label: 'Maximum Health Pool',       val: `${this.vitals.maxHp} HP`,                      sub: '50 base + 5/Vit + 10/Lvl + gear' },
      { label: 'Health Regeneration',       val: `+${(totals.vitality * 0.2).toFixed(1)}/s`,     sub: 'Natural vitality recovery' },
      { label: 'Maximum Mana Pool',         val: `${this.vitals.maxMp} MP`,                      sub: '20 base + 3/Foc + 5/Lvl + gear' },
      { label: 'Mana Regeneration',         val: `+${(1.0 + totals.focus * 0.08).toFixed(1)}/s`, sub: 'Arcane focus replenishment' },
      { label: 'Tactical Evasion',          val: `${dodgePct}%`,                                 sub: 'Dodge chance from Agility' },
      { label: 'Movement Speed',            val: `${moveVelocity}`,                              sub: 'Tactical reposition velocity' },
      { label: 'Realm Survival Mode',       val: isHC ? 'PERMADEATH' : 'CLASSIC',                sub: isHC ? 'Permanent death on defeat' : '10% XP penalty on death' }
    ];

    for (let i = 0; i < defStats.length; i++) {
      const st = defStats[i];
      const curY = tableY + i * stepY;

      // Underline groove
      ctx.strokeStyle = '#181e2b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + Math.round(26 * s), curY + Math.round(16 * s));
      ctx.lineTo(x + w - Math.round(26 * s), curY + Math.round(16 * s));
      ctx.stroke();

      // Label & Subtitle
      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(st.label, x + Math.round(26 * s), curY + Math.round(9 * s));

      ctx.font = `${Math.max(6.5, Math.round(7 * s))}px monospace`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(st.sub, x + Math.round(26 * s), curY + Math.round(15 * s));

      // Value
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.max(8.5, Math.round(9 * s))}px monospace`;
      ctx.fillStyle = '#60a5fa';
      ctx.fillText(st.val, x + w - Math.round(26 * s), curY + Math.round(11 * s));
    }
  }
}
