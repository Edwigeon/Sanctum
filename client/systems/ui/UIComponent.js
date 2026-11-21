import { UI_ANCHOR, UI_LAYOUT_CONFIG } from './UILayout.js';

/**
 * UIComponent — Base class for all canvas-native UI elements in Sanctum.
 */
export class UIComponent {
  constructor({
    id = '',
    anchor = UI_ANCHOR.CUSTOM,
    baseW = 0,
    baseH = 0,
    offsetX = 0,
    offsetY = 0,
    zOrder = 0,
    visible = true,
    enabled = true
  } = {}) {
    this.id = id;
    this.anchor = anchor;
    this.baseW = baseW;
    this.baseH = baseH;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.zOrder = zOrder;
    this.visible = visible;
    this.enabled = enabled;

    // Computed screen bounds (snapped to whole pixels)
    this.x = 0;
    this.y = 0;
    this.w = baseW;
    this.h = baseH;

    // Interaction states
    this.isHovered = false;
    this.isPressed = false;
    this.isFocused = false;

    // Component tree
    this.parent = null;
    this.children = [];
  }

  addChild(child) {
    if (!child || this.children.includes(child)) return;
    child.parent = this;
    this.children.push(child);
    this.children.sort((a, b) => a.zOrder - b.zOrder);
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
  }

  /**
   * Recalculates position and dimensions using the layout engine.
   */
  updateLayout(layout) {
    const s = layout.scale;
    this.w = Math.round(this.baseW * s);
    this.h = Math.round(this.baseH * s);

    if (this.parent) {
      // Relative to parent
      this.x = Math.round(this.parent.x + this.offsetX * s);
      this.y = Math.round(this.parent.y + this.offsetY * s);
    } else {
      // Relative to screen anchor
      const pos = layout.resolveAnchor(this.anchor, this.w, this.h, this.offsetX, this.offsetY);
      this.x = pos.x;
      this.y = pos.y;
    }

    for (const child of this.children) {
      child.updateLayout(layout);
    }
  }

  /**
   * Evaluates if a pointer position hits this component.
   * On touch devices, automatically expands the hit area to meet ergonomics requirements.
   */
  hitTest(pxX, pxY, isTouch = false) {
    if (!this.visible || !this.enabled) return null;

    let hitW = this.w;
    let hitH = this.h;
    let hitX = this.x;
    let hitY = this.y;

    if (isTouch) {
      const minHit = UI_LAYOUT_CONFIG.MIN_TOUCH_HITBOX;
      if (hitW < minHit) {
        const diff = minHit - hitW;
        hitX -= Math.round(diff / 2);
        hitW = minHit;
      }
      if (hitH < minHit) {
        const diff = minHit - hitH;
        hitY -= Math.round(diff / 2);
        hitH = minHit;
      }
    }

    // Check children first (top-down in reverse z-order)
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      const childHit = child.hitTest(pxX, pxY, isTouch);
      if (childHit) return childHit;
    }

    if (pxX >= hitX && pxX <= hitX + hitW && pxY >= hitY && pxY <= hitY + hitH) {
      return this;
    }

    return null;
  }

  // Event callbacks (return true if event was consumed)
  onPointerEnter() { this.isHovered = true; }
  onPointerLeave() { this.isHovered = false; this.isPressed = false; }
  onPointerDown(e) { this.isPressed = true; return true; }
  onPointerUp(e) { this.isPressed = false; return true; }
  onClick(e) { return true; }
  onContextMenu(e) { return true; }

  /**
   * Standard render pass. Override in subclass to draw specific visuals.
   */
  render(ctx, layout, animTime) {
    if (!this.visible) return;

    this.draw(ctx, layout, animTime);

    for (const child of this.children) {
      if (child.visible) {
        child.render(ctx, layout, animTime);
      }
    }
  }

  /**
   * Subclass drawing logic.
   */
  draw(ctx, layout, animTime) {
    // Override in subclass
  }
}
