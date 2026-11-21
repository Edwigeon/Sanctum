import assert from 'node:assert/strict';
import { UICharacter } from '../client/systems/ui/containers/UICharacter.js';
import { UIInventory } from '../client/systems/ui/containers/UIInventory.js';
import { uiLayout, UI_ANCHOR } from '../client/systems/ui/UILayout.js';
import { PACKET_TYPES, GAME_MODES } from '../shared/Constants.js';

console.log('=== RUNNING SANCTUM CANVAS CHARACTER SHEET (PHASE 3) VERIFICATION ===\n');

// Mock packet dispatcher & audio
const sentPackets = [];
const sendPacket = (p) => sentPackets.push(p);
const audioPlayed = [];
const audio = { play: (name) => audioPlayed.push(name) };

const renderedTexts = [];
// Mock 2D canvas context
const mockCtx = {
  save() {},
  restore() {},
  beginPath() {},
  closePath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  rect() {},
  fill() {},
  stroke() {},
  fillRect() {},
  strokeRect() {},
  fillText(text) {
    if (text !== undefined && text !== null) {
      renderedTexts.push(String(text));
    }
  },
  measureText: (text) => ({ width: (text || '').length * 6 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  clip() {},
  setLineDash() {}
};

console.log('1. Testing UICharacter initialization and default state...');
const character = new UICharacter({ sendPacket, audio });
assert.equal(character.id, 'panel_character');
assert.equal(character.panelStyle, 'tome');
assert.equal(character.hasCloseButton, true);
assert.equal(character.allocButtons.length, 4);

uiLayout.update(960, 540, 1);
character.updateLayout(uiLayout);
assert.equal(character.anchor, UI_ANCHOR.TOP_LEFT);
assert.ok(character.w >= 250);
assert.ok(character.h >= 350);
console.log('✔ UICharacter: Responsive TOP_LEFT docking and tome styling verified.');

console.log('2. Testing data binding (Hero, Vitals, Attributes, Derived Combat Stats)...');
const mockPlayer = {
  name: 'Sir Roderick',
  hp: 120,
  maxHp: 150,
  mp: 40,
  maxMp: 60
};

const mockPriv = {
  level: 8,
  className: 'Vanguard',
  classId: 'VANGUARD',
  xp: 450,
  nextXp: 800,
  statPoints: 3,
  stats: {
    might: 22,
    focus: 12,
    agility: 15,
    vitality: 25
  },
  derived: {
    dmgMin: 14,
    dmgMax: 26,
    spellDmg: 4,
    armor: 38,
    crit: 8.5,
    speed: 193
  },
  equipment: {
    weapon: { name: 'Broadsword', slot: 'weapon', attackSpeed: 1.25, stats: { might: 4 } },
    armor: { name: 'Plate Cuirass', slot: 'armor', stats: { armor: 8, vitality: 3 } }
  }
};

character.updateData(mockPlayer, mockPriv, GAME_MODES.HARDCORE, 3);
assert.equal(character.charName, 'Sir Roderick');
assert.equal(character.level, 8);
assert.equal(character.className, 'Vanguard');
assert.equal(character.mode, GAME_MODES.HARDCORE);
assert.equal(character.floor, 3);
assert.equal(character.stats.might, 22);
assert.equal(character.derived.armor, 38);
assert.equal(character.statPoints, 3);

const totals = character.getTotalStats();
assert.equal(totals.might, 26, 'Total might must include gear bonus (22 + 4)');
assert.equal(totals.vitality, 28, 'Total vitality must include gear bonus (25 + 3)');
console.log('✔ UICharacter: Player vitals, attributes, gear bonuses, and derived statistics bound accurately.');

console.log('3. Testing interactive attribute allocation [+] buttons...');
// Buttons must be visible and enabled when statPoints > 0
assert.equal(character.btnMight.visible, true);
assert.equal(character.btnFocus.visible, true);

// Allocate 1 point to Might
sentPackets.length = 0;
character.handleAlloc('might');
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.ALLOC_STAT);
assert.equal(sentPackets[0].stat, 'might');
assert.equal(character.stats.might, 23);
assert.equal(character.statPoints, 2);

// Allocate 1 point to Focus
sentPackets.length = 0;
character.handleAlloc('focus');
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.ALLOC_STAT);
assert.equal(sentPackets[0].stat, 'focus');
assert.equal(character.stats.focus, 13);
assert.equal(character.statPoints, 1);

// Allocate last point to Vitality
character.handleAlloc('vitality');
assert.equal(character.statPoints, 0);
// With 0 points left, buttons must automatically hide
assert.equal(character.btnMight.visible, false);
assert.equal(character.btnFocus.visible, false);
console.log('✔ UICharacter: Stat point allocation packets and automatic button toggling verified.');

console.log('4. Testing Category Tabs Navigation (STATS, OFFENSE, DEFENSE)...');
assert.equal(character.activeTab, 'stats');
assert.equal(character.tabs.length, 3);

// Switch to OFFENSE tab
renderedTexts.length = 0;
character.switchTab('offense');
assert.equal(character.activeTab, 'offense');
assert.equal(character.tabOffense.variant, 'primary');
assert.equal(character.tabStats.variant, 'default');
assert.equal(character.btnMight.visible, false, 'Alloc buttons must be hidden on OFFENSE tab');
character.render(mockCtx, uiLayout, 0);

const offenseDrawn = renderedTexts.join(' ');
assert.ok(offenseDrawn.includes('APS'), 'Offense tab must display APS');
assert.ok(!offenseDrawn.includes('193 APS'), 'Attack speed must NOT use movement speed (193)!');
assert.ok(offenseDrawn.includes('Broadsword'), 'Offense tab must show equipped weapon name');
// Verify DPS is sane (around 30-50, definitely not 5000+)
const dpsMatch = renderedTexts.find(t => /^\d+$/.test(t) && Number(t) > 10 && Number(t) < 500);
assert.ok(dpsMatch, 'Offense tab must calculate realistic DPS (not thousands)');

// Switch to DEFENSE tab
renderedTexts.length = 0;
character.switchTab('defense');
assert.equal(character.activeTab, 'defense');
assert.equal(character.tabDefense.variant, 'primary');
assert.equal(character.btnMight.visible, false, 'Alloc buttons must be hidden on DEFENSE tab');
character.render(mockCtx, uiLayout, 0);

const defenseDrawn = renderedTexts.join(' ');
assert.ok(defenseDrawn.includes('Total Armor Rating'), 'Defense tab must include Total Armor Rating row');
assert.ok(defenseDrawn.includes('Tactical Evasion'), 'Defense tab must include Tactical Evasion');
assert.ok(!defenseDrawn.toLowerCase().includes('potion'), 'Potions do not belong on the character sheet defense tab!');

// Switch back to STATS tab
character.switchTab('stats');
assert.equal(character.activeTab, 'stats');
console.log('✔ UICharacter: Tab switching and category view rendering verified.');

console.log('5. Testing Dual-Grimoire wide layout (Character TOP_LEFT, Inventory TOP_RIGHT)...');
const inventory = new UIInventory({ sendPacket, audio });
uiLayout.update(1200, 720, 1.25);
character.updateLayout(uiLayout);
inventory.updateLayout(uiLayout);

assert.equal(character.anchor, UI_ANCHOR.TOP_LEFT);
assert.equal(inventory.anchor, UI_ANCHOR.TOP_RIGHT);
assert.ok(character.x < inventory.x);
assert.ok(inventory.x >= character.x + character.w + 100, 'Dual-grimoire layout must leave generous center playfield');
console.log('✔ Dual-Grimoire: Flanking TOP_LEFT / TOP_RIGHT wide screen docking verified.');

console.log('5. Testing Canvas 2D render pass...');
character.render(mockCtx, uiLayout, 0);
console.log('✔ UICharacter: Clean canvas render pass verified without runtime errors.');

console.log('\n=== ALL PHASE 3 CANVAS CHARACTER SHEET TESTS PASSED! ===');
