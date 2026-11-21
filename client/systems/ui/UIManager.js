import { uiLayout } from './UILayout.js';
import { uiTheme } from './UITheme.js';

/**
 * UIManager — Top-level coordinator for canvas-native UI in Sanctum.
 * Manages the component tree, modal stack, pointer event dispatching,
 * viewport resizing, and click-through prevention to the game world.
 */
export class UIManager {
  constructor() {
    this.components = []; // Root components
    this.modalStack = []; // Open modal panels (e.g. Inventory, Character, Pause Menu)
    this.hoveredComponent = null;
    this.pressedComponent = null;
    this.mouse = { x: -1, y: -1, isDown: false };
    this.pointerType = 'mouse'; // 'mouse' | 'touch' | 'pen'
  }

  /**
   * Registers a root component (such as CanvasHUD or a modal panel).
   */
  register(component) {
    if (!component || this.components.includes(component)) return;
    this.components.push(component);
    this.components.sort((a, b) => a.zOrder - b.zOrder);
    component.updateLayout(uiLayout);
  }

  unregister(component) {
    const idx = this.components.indexOf(component);
    if (idx !== -1) {
      this.components.splice(idx, 1);
    }
  }

  /**
   * Pushes a component onto the modal stack (prioritized for hit testing).
   */
  openModal(modal) {
    if (!modal) return;
    modal.visible = true;
    modal.updateLayout(uiLayout);
    if (!this.modalStack.includes(modal)) {
      this.modalStack.push(modal);
    }
  }

  closeModal(modal) {
    if (!modal) return;
    modal.visible = false;
    const idx = this.modalStack.indexOf(modal);
    if (idx !== -1) {
      this.modalStack.splice(idx, 1);
    }
  }

  isModalOpen() {
    return this.modalStack.length > 0;
  }

  /**
   * Handles canvas/stage resize events across all components.
   */
  onResize(stageW, stageH, dpr = 1) {
    uiLayout.update(stageW, stageH, dpr);
    for (const comp of this.components) {
      comp.updateLayout(uiLayout);
    }
    for (const modal of this.modalStack) {
      modal.updateLayout(uiLayout);
    }
  }

  /**
   * Evaluates top-most hit component under (pxX, pxY).
   */
  hitTest(pxX, pxY) {
    const isTouch = this.pointerType === 'touch';

    // 1. Check open modals (top of stack first)
    for (let i = this.modalStack.length - 1; i >= 0; i--) {
      const modal = this.modalStack[i];
      if (modal.visible) {
        const hit = modal.hitTest(pxX, pxY, isTouch);
        if (hit) return hit;
      }
    }

    // 2. Check root components in reverse z-order
    for (let i = this.components.length - 1; i >= 0; i--) {
      const comp = this.components[i];
      if (comp.visible) {
        const hit = comp.hitTest(pxX, pxY, isTouch);
        if (hit) return hit;
      }
    }

    return null;
  }

  /**
   * Dispatches pointer movement. Updates hover states and propagates to active drag handlers.
   */
  handlePointerMove(pxX, pxY, pointerType = 'mouse') {
    this.mouse.x = pxX;
    this.mouse.y = pxY;
    this.pointerType = pointerType;

    // Propagate pointer move to open modals (for drag tracking & scroll updates)
    for (const modal of this.modalStack) {
      if (modal.visible && typeof modal.onPointerMove === 'function') {
        modal.onPointerMove(pxX, pxY);
      }
    }

    const hit = this.hitTest(pxX, pxY);

    if (hit !== this.hoveredComponent) {
      if (this.hoveredComponent) {
        this.hoveredComponent.onPointerLeave();
      }
      this.hoveredComponent = hit;
      if (this.hoveredComponent) {
        this.hoveredComponent.onPointerEnter();
      }
    }

    return Boolean(hit); // True if UI swallowed pointer
  }

  /**
   * Dispatches pointer down (LMB / Touch).
   */
  handlePointerDown(pxX, pxY, button = 0, pointerType = 'mouse') {
    this.mouse.x = pxX;
    this.mouse.y = pxY;
    this.mouse.isDown = true;
    this.pointerType = pointerType;

    const hit = this.hitTest(pxX, pxY);
    if (hit && button === 0) {
      this.pressedComponent = hit;
      hit.onPointerDown({ x: pxX, y: pxY, button });
      return true; // Consumed by UI
    }

    return false;
  }

  /**
   * Dispatches pointer up. Resolves active drag-and-drop operations or click dispatches.
   */
  handlePointerUp(pxX, pxY, button = 0) {
    this.mouse.isDown = false;
    let consumed = false;

    // 1. Resolve active modal drag operations first
    for (const modal of this.modalStack) {
      if (modal.visible && modal.dragState?.active && typeof modal.handleDragEnd === 'function') {
        const dragHandled = modal.handleDragEnd(pxX, pxY, button);
        if (this.pressedComponent) {
          this.pressedComponent.isPressed = false;
          this.pressedComponent = null;
        }
        return dragHandled !== false;
      }
    }

    // 2. Normal click release
    if (this.pressedComponent) {
      this.pressedComponent.onPointerUp({ x: pxX, y: pxY, button });
      const hit = this.hitTest(pxX, pxY);
      if (hit === this.pressedComponent) {
        consumed = hit.onClick({ x: pxX, y: pxY, button });
      }
      this.pressedComponent = null;
    }

    return consumed;
  }

  /**
   * Dispatches right-click / context menu.
   */
  handleContextMenu(pxX, pxY) {
    const hit = this.hitTest(pxX, pxY);
    if (hit) {
      return hit.onContextMenu({ x: pxX, y: pxY });
    }
    return false;
  }

  /**
   * Dispatches mouse wheel events for scrolling lists & grids.
   */
  handleWheel(pxX, pxY, deltaY) {
    const hit = this.hitTest(pxX, pxY);
    if (hit) {
      let curr = hit;
      while (curr) {
        if (typeof curr.onWheel === 'function') {
          const consumed = curr.onWheel({ x: pxX, y: pxY, deltaY });
          if (consumed) return true;
        }
        curr = curr.parent;
      }
    }
    return false;
  }

  /**
   * Main UI render pass onto HighRes canvas.
   */
  render(ctx, animTime) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // 1. Draw registered root components (excluding open modals to prevent duplicate rendering)
    for (const comp of this.components) {
      if (comp.visible && !this.modalStack.includes(comp)) {
        comp.render(ctx, uiLayout, animTime);
      }
    }

    // 2. Draw open modals on top
    for (const modal of this.modalStack) {
      if (modal.visible) {
        modal.render(ctx, uiLayout, animTime);
      }
    }

    ctx.restore();
  }
}

export const uiManager = new UIManager();
