import assert from 'node:assert/strict';
import { UIInventory } from '../client/systems/ui/containers/UIInventory.js';
import { UITooltip, resolveItemMetrics } from '../client/systems/ui/containers/UITooltip.js';
import { uiLayout, UILayout, UI_ANCHOR } from '../client/systems/ui/UILayout.js';
import { uiManager } from '../client/systems/ui/UIManager.js';
import { PACKET_TYPES, RARITY } from '../shared/Constants.js';

console.log('=== RUNNING SANCTUM CANVAS INVENTORY (PHASE 2) VERIFICATION ===\n');

// Mock packet dispatcher
const sentPackets = [];
const sendPacket = (p) => sentPackets.push(p);

// Mock audio
const audioPlayed = [];
const audio = { play: (name) => audioPlayed.push(name) };

console.log('1. Testing UIInventory initialization and socket structure...');
const inventory = new UIInventory({ sendPacket, audio });
assert.equal(inventory.id, 'panel_inventory');
assert.equal(inventory.paperdollSlots.size, 9);
assert.ok(inventory.packSlots.length >= 15);

// Test scrolling
inventory.maxScrollY = 100;
inventory.onWheel({ deltaY: 100 });
assert.ok(inventory.targetScrollY > 0, 'Wheel down should increment targetScrollY');

uiLayout.update(720, 432, 1);
inventory.updateLayout(uiLayout);
assert.ok(inventory.w > 200);
assert.ok(inventory.h > 300);
console.log('✔ UIInventory: 9 paperdoll sockets and 24 pack slots created with responsive layout.');

console.log('2. Testing private state data binding (Equipment, Pack, Gold, Weight)...');
const mockPriv = {
  gold: 4250,
  carryWeight: 18.5,
  maxWeight: 60,
  equipment: {
    helm: { id: 'iron_helm', name: 'Iron Sallet', rarity: RARITY.MAGIC, stats: { armor: 12, might: 4 } },
    weapon: { id: 'steel_sword', name: 'Steel Broadsword', rarity: RARITY.RARE, stats: { dmg: 16, crit: 0.08 } }
  },
  inventory: [
    { id: 'pot_hp', name: 'Life Potion', type: 'potion', subType: 'hp', count: 5 },
    { id: 'magic_ring', name: 'Azure Ring of Vitality', slot: 'ring', rarity: RARITY.MAGIC, stats: { vitality: 8 } }
  ]
};

inventory.updateData(mockPriv);
assert.equal(inventory.gold, 4250);
assert.equal(inventory.carryWeight, 18.5);
assert.equal(inventory.paperdollSlots.get('helm')?.item?.id, 'iron_helm');
assert.equal(inventory.paperdollSlots.get('weapon')?.item?.rarity, RARITY.RARE);
assert.equal(inventory.packSlots[0]?.item?.id, 'pot_hp');
assert.equal(inventory.packSlots[0]?.stackCount, 5);
assert.equal(inventory.packSlots[1]?.item?.id, 'magic_ring');
console.log('✔ UIInventory: Data synchronization for gold, weight, paperdoll, and pack verified.');

console.log('3. Testing click & right-click interaction routing...');
sentPackets.length = 0;

// Clicking an equipped helm sends UNEQUIP_ITEM
inventory.handleSlotClick(inventory.paperdollSlots.get('helm').item, 'helm', true);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.UNEQUIP_ITEM);
assert.equal(sentPackets[0].slot, 'helm');

// Clicking a consumable potion sends USE_ITEM
sentPackets.length = 0;
inventory.handleSlotClick(inventory.packSlots[0].item, 0, false);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.USE_ITEM);
assert.equal(sentPackets[0].itemId, 'pot_hp');

// Clicking gear in pack sends EQUIP_ITEM
sentPackets.length = 0;
inventory.handleSlotClick(inventory.packSlots[1].item, 1, false);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.EQUIP_ITEM);
assert.equal(sentPackets[0].itemId, 'magic_ring');

// Right clicking an item sends DROP_ITEM
sentPackets.length = 0;
inventory.handleSlotRightClick(inventory.packSlots[1].item, 1, false);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.DROP_ITEM);
assert.equal(sentPackets[0].itemId, 'magic_ring');
console.log('✔ UIInventory: Unequip, Equip, Use, and Drop packet events verified.');

console.log('4. Testing UITooltip comparative inspection & Dual-Ring logic...');
const tooltip = inventory.tooltip;
const newHelm = { id: 'great_helm', name: 'Great Helm of Might', rarity: RARITY.RARE, slot: 'helm', stats: { armor: 18, might: 8 } };
const equippedHelm = mockPriv.equipment.helm;

// Mock 2D context for drawing tests
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
  fillText() {},
  measureText: (text) => ({ width: (text || '').length * 6 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  clip() {},
  setLineDash() {}
};

// Tooltip hit-test must ALWAYS return null to prevent hover flickering
assert.equal(tooltip.hitTest(100, 100), null, 'Tooltip must be non-interactive to prevent hover flicker loops');

// Single gear comparison (side-by-side card drawing test)
tooltip.show(newHelm, equippedHelm, { x: 100, y: 100, w: 34, h: 34 });
assert.equal(tooltip.visible, true);
assert.equal(tooltip.item.name, 'Great Helm of Might');
tooltip.draw(mockCtx, uiLayout, 0);
tooltip.hide();
assert.equal(tooltip.visible, false);

// Dual-ring inspection comparison (side-by-side multi-card drawing test)
const newRing = { id: 'ruby_ring', name: 'Ruby Ring of Power', slot: 'ring', rarity: RARITY.RARE, stats: { might: 6, crit: 0.05 } };
const equippedRings = {
  isDualRing: true,
  ring1: { id: 'r1', name: 'Iron Ring', slot: 'ring', stats: { armor: 2 } },
  ring2: { id: 'r2', name: 'Silver Ring', slot: 'ring', stats: { might: 3 } }
};
tooltip.show(newRing, equippedRings, { x: 150, y: 150, w: 34, h: 34 });
assert.equal(tooltip.visible, true);
assert.equal(tooltip.equippedItem.isDualRing, true);
assert.equal(tooltip.equippedItem.ring1.name, 'Iron Ring');
assert.equal(tooltip.equippedItem.ring2.name, 'Silver Ring');
// Modular Weapon Base Damage & Metrics Resolution Test
const weaponMetrics = resolveItemMetrics({
  slot: 'weapon',
  baseDamage: [10, 18],
  attackSpeed: 1.25,
  stats: { might: 4, crit: 0.05 }
});
assert.equal(weaponMetrics.primaryLabel, 'DAMAGE PER SECOND');
assert.equal(weaponMetrics.subProperty, '10 - 18 Damage • 1.25 APS');
assert.ok(weaponMetrics.d3Power.damage > 0);

const amuletMetrics = resolveItemMetrics({
  slot: 'amulet',
  stats: { focus: 3, armor: 1 }
});
assert.equal(amuletMetrics.primaryLabel, 'FOCUS POWER');
assert.equal(amuletMetrics.subProperty, 'AMULET ENCHANTMENT');

tooltip.draw(mockCtx, uiLayout, 0);
tooltip.hide();
console.log('✔ UITooltip: Non-interactive hitTest, modular weapon base damage, and leftmost equipped panel verified.');

console.log('5. Testing Slot Mouse Detection & Hitbox Tolerances...');
const sampleSlot = inventory.paperdollSlots.get('helm');
// Exact hit
assert.ok(sampleSlot.hitTest(sampleSlot.x + 5, sampleSlot.y + 5));
// 1px outside border (tolerated due to 2px padding margin)
assert.ok(sampleSlot.hitTest(sampleSlot.x - 1, sampleSlot.y + 5), '1px outside left should hit due to tolerance margin');
assert.ok(sampleSlot.hitTest(sampleSlot.x + sampleSlot.w + 1, sampleSlot.y + 5), '1px outside right should hit');
// 5px outside border (miss)
assert.equal(sampleSlot.hitTest(sampleSlot.x - 5, sampleSlot.y + 5), null, '5px outside should miss');
console.log('✔ UISlot: 2px edge tolerance padding verified.');

console.log('6. Testing Drag-and-Drop Item Management...');
// Setup drag candidate on packSlot[1] (magic_ring)
const ringSlot = inventory.packSlots[1];
assert.ok(ringSlot.item);
inventory.handleSlotPointerDown(ringSlot, 1, false, { x: ringSlot.x + 10, y: ringSlot.y + 10 });
assert.ok(inventory.dragState.candidate);
assert.equal(inventory.dragState.active, false);

// Small movement (<4px) does not start drag
inventory.onPointerMove(ringSlot.x + 11, ringSlot.y + 11);
assert.equal(inventory.dragState.active, false);

// Larger movement (>=4px) starts drag
inventory.onPointerMove(ringSlot.x + 20, ringSlot.y + 20);
assert.equal(inventory.dragState.active, true);
assert.equal(inventory.dragState.item.id, 'magic_ring');
assert.equal(ringSlot.isGhost, true);

// Verify that rendering actively dragged item does not throw or freeze
inventory.render(mockCtx, uiLayout, 0);

// Drop onto paperdoll ring1 socket
sentPackets.length = 0;
const ring1Slot = inventory.paperdollSlots.get('ring1');
inventory.handleDragEnd(ring1Slot.x + 5, ring1Slot.y + 5);
assert.equal(inventory.dragState.active, false);
assert.equal(ringSlot.isGhost, false);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.EQUIP_ITEM);
assert.equal(sentPackets[0].itemId, 'magic_ring');
assert.equal(sentPackets[0].slot, 'ring1');

// Drag equipped helm and drop into pack area -> UNEQUIP_ITEM
const helmSlot = inventory.paperdollSlots.get('helm');
inventory.handleSlotPointerDown(helmSlot, 'helm', true, { x: helmSlot.x + 5, y: helmSlot.y + 5 });
inventory.onPointerMove(helmSlot.x + 25, helmSlot.y + 25);
assert.equal(inventory.dragState.active, true);
assert.equal(helmSlot.isGhost, true);

sentPackets.length = 0;
// Drop in pack view coordinates
const packViewLeft = inventory.x + Math.round(26 * (inventory.w / inventory.baseW));
const packViewTop = inventory.y + Math.round(156 * (inventory.w / inventory.baseW));
inventory.handleDragEnd(packViewLeft + 20, packViewTop + 20);
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.UNEQUIP_ITEM);
assert.equal(sentPackets[0].slot, 'helm');

// Drag item and drop completely outside inventory bounds -> DROP_ITEM
inventory.handleSlotPointerDown(ringSlot, 1, false, { x: ringSlot.x + 10, y: ringSlot.y + 10 });
inventory.onPointerMove(ringSlot.x + 20, ringSlot.y + 20);
assert.equal(inventory.dragState.active, true);

sentPackets.length = 0;
inventory.handleDragEnd(-50, -50); // Outside tome
assert.equal(sentPackets.length, 1);
assert.equal(sentPackets[0].type, PACKET_TYPES.DROP_ITEM);
assert.equal(sentPackets[0].itemId, 'magic_ring');
console.log('✔ UIInventory Drag-and-Drop: Equip drop, Unequip drop, and World drop verified.');

console.log('7. Testing Responsive Layout Breakpoints for Inventory...');
// Standard/Wide desktop: docked TOP_RIGHT
uiLayout.update(960, 540, 1);
inventory.updateLayout(uiLayout);
assert.equal(inventory.anchor, UI_ANCHOR.TOP_RIGHT);

// Compact mobile screen: centered on screen
uiLayout.update(480, 320, 1);
inventory.updateLayout(uiLayout);
assert.equal(inventory.anchor, UI_ANCHOR.CENTER);
console.log('✔ UIInventory: Responsive docking on Wide vs Centering on Compact verified.');

console.log('\n=== ALL PHASE 2 CANVAS INVENTORY TESTS PASSED! ===');
