import assert from 'node:assert/strict';
import { uiTheme, UITheme } from '../client/systems/ui/UITheme.js';
import { uiLayout, UILayout, UI_ANCHOR, UI_SCALE_TIER } from '../client/systems/ui/UILayout.js';
import { UIComponent } from '../client/systems/ui/UIComponent.js';
import { UIPanel } from '../client/systems/ui/primitives/UIPanel.js';
import { UIButton } from '../client/systems/ui/primitives/UIButton.js';
import { UISlot } from '../client/systems/ui/primitives/UISlot.js';
import { UIMeter } from '../client/systems/ui/primitives/UIMeter.js';
import { UIText } from '../client/systems/ui/primitives/UIText.js';
import { uiManager, UIManager } from '../client/systems/ui/UIManager.js';
import { PALETTE_INDEX } from '../shared/Constants.js';

console.log('=== RUNNING SANCTUM UI FRAMEWORK PHASE 1 VERIFICATION ===\n');

// 1. UITheme verification
console.log('Testing UITheme palette-indexed color resolution...');
assert.equal(typeof uiTheme.getHex('PANEL_BG'), 'string');
assert.equal(uiTheme.getHex(PALETTE_INDEX.BLACK), '#000000');
assert.equal(uiTheme.getRgb(PALETTE_INDEX.BLACK)[0], 0);
assert.equal(uiTheme.getRgba('HEALTH_FILL', 0.5), 'rgba(255, 0, 77, 0.5)');

// Palette swap verification
const customTheme = new UITheme();
const altPalette = [...uiTheme.palette];
altPalette[PALETTE_INDEX.BLACK] = '#111111';
customTheme.setPalette(altPalette);
assert.equal(customTheme.getHex(PALETTE_INDEX.BLACK), '#111111');
console.log('✔ UITheme: Palette index lookup, token resolution, and palette swapping verified.');

// 2. UILayout & Scaling Tiers verification
console.log('Testing UILayout resolution, scale tiers, and responsive anchoring...');
const layout = new UILayout();

// 720x432 (Standard Desktop/Tablet baseline)
layout.update(720, 432, 1);
assert.equal(layout.tier, UI_SCALE_TIER.STANDARD);
assert.equal(layout.scale, 1.0);

// Compact Viewport (Mobile / 480x300)
layout.update(480, 288, 1);
assert.equal(layout.tier, UI_SCALE_TIER.COMPACT);
assert.ok(layout.scale < 1.0);

// Large Viewport (1080p Desktop)
layout.update(1440, 864, 1);
assert.equal(layout.tier, UI_SCALE_TIER.LARGE);
assert.equal(layout.scale, 1.25);

// Ultra Viewport (4K / Ultrawide)
layout.update(2160, 1296, 1);
assert.equal(layout.tier, UI_SCALE_TIER.ULTRA);
assert.equal(layout.scale, 1.5);

// Safe Zone calculation on Ultrawide (2560x1080 -> aspect 2.37 > 16:9)
layout.update(2560, 1080, 1);
assert.ok(layout.safeZone.w < 2560, 'Ultrawide safe zone should be constrained');
assert.ok(layout.safeZone.x > 0, 'Ultrawide safe zone should be centered');

// Anchor resolution
layout.update(720, 432, 1);
const blPos = layout.resolveAnchor(UI_ANCHOR.BOTTOM_LEFT, 100, 100, 10, 10);
assert.equal(blPos.x, 10);
assert.equal(blPos.y, 432 - 100 - 10);

const brPos = layout.resolveAnchor(UI_ANCHOR.BOTTOM_RIGHT, 100, 100, 10, 10);
assert.equal(brPos.x, 720 - 100 - 10);
assert.equal(brPos.y, 432 - 100 - 10);

const centerPos = layout.resolveAnchor(UI_ANCHOR.CENTER, 200, 200, 0, 0);
assert.equal(centerPos.x, Math.round((720 - 200) / 2));
assert.equal(centerPos.y, Math.round((432 - 200) / 2));
console.log('✔ UILayout: Standard, Compact, Large, Ultra tiers, safe zones, and anchors verified.');

// 3. UIComponent Hierarchy & Hit-Testing
console.log('Testing UIComponent hierarchy and touch hitbox expansion...');
const parentComp = new UIComponent({ id: 'parent', baseW: 200, baseH: 200, anchor: UI_ANCHOR.CENTER });
const childComp = new UIComponent({ id: 'child', baseW: 50, baseH: 50, offsetX: 10, offsetY: 10 });
parentComp.addChild(childComp);

layout.update(720, 432, 1);
parentComp.updateLayout(layout);

assert.equal(parentComp.w, 200);
assert.equal(childComp.x, parentComp.x + 10);
assert.equal(childComp.y, parentComp.y + 10);

// Hit-test on child
const hitChild = parentComp.hitTest(parentComp.x + 15, parentComp.y + 15, false);
assert.equal(hitChild?.id, 'child');

// Touch hit-testing padding (small 20x20 button expands to minimum 36px)
const tinyButton = new UIComponent({ id: 'tiny', baseW: 20, baseH: 20 });
tinyButton.updateLayout(layout);
// Mouse hit test at edge outside 20px should be null
assert.equal(tinyButton.hitTest(25, 25, false), null);
// Touch hit test with padding should hit
assert.equal(tinyButton.hitTest(25, 25, true)?.id, 'tiny');
console.log('✔ UIComponent: Hierarchy, layout recursion, and touch ergonomics verified.');

// 4. Primitives Verification
console.log('Testing primitives (UIPanel, UIButton, UISlot, UIMeter)...');
let closed = false;
const panel = new UIPanel({ id: 'test_panel', title: 'Inventory', hasCloseButton: true, onClose: () => { closed = true; } });
panel.updateLayout(layout);
assert.equal(panel.title, 'Inventory');

let clicked = false;
const button = new UIButton({ id: 'btn_test', text: 'PLAY', hotkey: 'ENTER', onClick: () => { clicked = true; } });
button.updateLayout(layout);
button.onClick({});
assert.equal(clicked, true);

const slot = new UISlot({ id: 'slot_helm', slotType: 'equipment', silhouetteKey: 'slot_helm' });
slot.updateLayout(layout);
slot.setItem({ id: 'iron_helm', name: 'Iron Helm', rarity: 1 }, 1);
assert.equal(slot.rarity, 1);

const meter = new UIMeter({ id: 'xp_bar', current: 50, max: 100 });
meter.updateLayout(layout);
meter.setValues(75, 100);
assert.equal(meter.current, 75);
console.log('✔ Primitives: UIPanel, UIButton, UISlot, UIMeter initializations and states verified.');

// 5. UIManager & Modal Stack / Event Routing
console.log('Testing UIManager modal stack, hit-testing priority, and click-through prevention...');
const manager = new UIManager();
manager.onResize(720, 432, 1);

const hudComp = new UIComponent({ id: 'hud_belt', baseW: 300, baseH: 50, anchor: UI_ANCHOR.BOTTOM_CENTER, zOrder: 0 });
manager.register(hudComp);

// When no modal is open, hudComp is hit
const hitBefore = manager.hitTest(hudComp.x + 10, hudComp.y + 10);
assert.equal(hitBefore?.id, 'hud_belt');

// Open modal overlapping hudComp
const modalPanel = new UIPanel({ id: 'modal_inv', baseW: 400, baseH: 300, anchor: UI_ANCHOR.CENTER, zOrder: 50 });
manager.openModal(modalPanel);

// Pointer over modal consumes event
const hitModal = manager.hitTest(modalPanel.x + 50, modalPanel.y + 50);
assert.equal(hitModal?.id, 'modal_inv');

// Pointer down and click-through prevention
const swallowed = manager.handlePointerDown(modalPanel.x + 50, modalPanel.y + 50, 0);
assert.equal(swallowed, true, 'Modal must swallow pointer down to prevent game world actions');

manager.closeModal(modalPanel);
assert.equal(manager.isModalOpen(), false);
console.log('✔ UIManager: Modal stack priority, event swallowing, and click-through prevention verified.');

console.log('\n=== ALL PHASE 1 UI FRAMEWORK TESTS PASSED! ===');
