import { UIComponent } from '../UIComponent.js';
import { uiTheme } from '../UITheme.js';
import { UI_LAYOUT_CONFIG } from '../UILayout.js';
import { drawBitSprite, getItemSpriteKey } from '../../BitSprites.js';
import { RARITY, RARITY_COLORS } from '../../../../shared/Constants.js';

/**
 * UISlot — Tactile ARPG socket primitive for equipment slots and pack grids.
 * Features recessed iron/velvet cavities, animated rarity gleams, empty silhouettes,
 * tactile hover lifts, and crisp stack badges.
 */
export class UISlot extends UIComponent {
  constructor({
    id = 'slot',
    anchor,
    baseSize = 34,
    offsetX = 0,
    offsetY = 0,
    slotType = 'inventory', // 'inventory' | 'equipment' | 'skill'
    silhouetteKey = '',
    item = null,
    rarity = RARITY.NORMAL,
    stackCount = 0,
    onHover = null,
    onClick = null,
    onRightClick = null
  } = {}) {
    super({ id, anchor, baseW: baseSize, baseH: baseSize, offsetX, offsetY });
    this.slotType = slotType;
    this.silhouetteKey = silhouetteKey;
    this.item = item;
    this.rarity = rarity;
    this.stackCount = stackCount;
    this.isGhost = false; // Set to true when item is actively dragged out
    this.onHoverCallback = onHover;
    this.onClickCallback = onClick;
    this.onRightClickCallback = onRightClick;
    this.onPointerDownCallback = null;
  }

  /**
   * Generous hit-testing with 2px tolerance padding for crisp slot detection
   * without edge flicker, plus automatic touch target enlargement.
   */
  hitTest(pxX, pxY, isTouch = false) {
    if (!this.visible || !this.enabled) return null;

    const pad = isTouch ? 0 : 2;
    let hitX = this.x - pad;
    let hitY = this.y - pad;
    let hitW = this.w + pad * 2;
    let hitH = this.h + pad * 2;

    if (isTouch) {
      const minHit = UI_LAYOUT_CONFIG.MIN_TOUCH_HITBOX;
      if (hitW < minHit) {
        hitX -= Math.round((minHit - hitW) / 2);
        hitW = minHit;
      }
      if (hitH < minHit) {
        hitY -= Math.round((minHit - hitH) / 2);
        hitH = minHit;
      }
    }

    if (pxX >= hitX && pxX <= hitX + hitW && pxY >= hitY && pxY <= hitY + hitH) {
      return this;
    }

    return null;
  }

  setItem(item, stackCount = 0) {
    this.item = item;
    this.rarity = item?.rarity ?? RARITY.NORMAL;
    this.stackCount = stackCount || item?.count || 1;
  }

  draw(ctx, layout, animTime = 0) {
    const { x, y, w, h, isHovered, isPressed } = this;
    const s = layout.scale;

    ctx.save();

    // 1. Recessed Cavity Background (Dark Velvet / Hammered Iron Depth)
    const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
    bgGrad.addColorStop(0, '#06080e');
    bgGrad.addColorStop(0.5, '#0b0e17');
    bgGrad.addColorStop(1, '#0e121e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x, y, w, h);

    // 2. Beveled 3D Inset Borders
    const borderW = Math.max(1, Math.round(1 * s));
    ctx.lineWidth = borderW;

    // Dark inset shadow (Top + Left)
    ctx.strokeStyle = '#040508';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    // Subdued metallic rim (Bottom + Right)
    ctx.strokeStyle = '#2b3448';
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    // 3. Empty Silhouette (when unoccupied)
    if (!this.item && this.silhouetteKey) {
      const pScale = Math.max(1, Math.round(2 * s));
      const iconX = x + Math.round((w - 10 * pScale) / 2);
      const iconY = y + Math.round((h - 10 * pScale) / 2);
      // Subtle ambient breathing alpha for empty paperdoll silhouettes
      const breath = Math.sin(animTime * 1.5 + x * 0.1) * 0.12 + 0.65;
      ctx.globalAlpha = breath;
      drawBitSprite(ctx, this.silhouetteKey, iconX, iconY, pScale, uiTheme.palette);
      ctx.globalAlpha = 1.0;
    }

    // 4. Item Micro-Sprite (when occupied)
    if (this.item) {
      if (this.isGhost) {
        ctx.globalAlpha = 0.35;
      }
      const spriteKey = this.item.spriteKey || getItemSpriteKey(this.item);
      const pScale = Math.max(1, Math.round(2 * s));
      const iconX = x + Math.round((w - 10 * pScale) / 2);
      // 1px tactile buoyant lift when hovered (unless dragging ghost)
      const liftY = (!this.isGhost && isHovered) ? -1 : (isPressed ? 1 : 0);
      const iconY = y + Math.round((h - 10 * pScale) / 2) + liftY;

      // Draw 16-color item bit-sprite
      drawBitSprite(ctx, spriteKey, iconX, iconY, pScale, uiTheme.palette);

      // Rarity Border
      const rarityCol = RARITY_COLORS[this.rarity] || '#FFFFFF';
      ctx.strokeStyle = rarityCol;
      ctx.lineWidth = borderW;
      if (this.isGhost) {
        ctx.setLineDash([3, 3]);
      }
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (this.isGhost) {
        ctx.setLineDash([]);
      }

      // 5. Animated Rarity Aura & Corner Glint
      if (!this.isGhost && this.rarity >= RARITY.MAGIC) {
        const pulse = (Math.sin(animTime * 3.0 + (x + y) * 0.05) * 0.5 + 0.5);

        if (this.rarity === RARITY.MAGIC) {
          // Soft cyan breathing aura
          ctx.fillStyle = `rgba(41, 173, 255, ${pulse * 0.16})`;
          ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        } else if (this.rarity === RARITY.RARE) {
          // Shimmering gold sheen across corner
          ctx.fillStyle = `rgba(255, 236, 39, ${pulse * 0.22})`;
          ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
          // Glint spark on top-left corner
          ctx.fillStyle = '#FFF1E8';
          ctx.fillRect(x + 2, y + 2, Math.max(1, Math.round(2 * s)), Math.max(1, Math.round(2 * s)));
        } else if (this.rarity === RARITY.UNIQUE) {
          // Fiery amber aura
          ctx.fillStyle = `rgba(255, 163, 0, ${pulse * 0.28})`;
          ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
          ctx.fillStyle = '#FFF1E8';
          ctx.fillRect(x + 2, y + 2, Math.max(1, Math.round(2 * s)), Math.max(1, Math.round(2 * s)));
          ctx.fillRect(x + w - 4, y + 2, Math.max(1, Math.round(2 * s)), Math.max(1, Math.round(2 * s)));
        }
      }

      // 6. Stack Count Pill Badge
      if (this.stackCount > 1) {
        const badgeFont = `bold ${Math.max(9, Math.round(9.5 * s))}px monospace`;
        ctx.font = badgeFont;
        const countStr = `x${this.stackCount}`;
        const textW = ctx.measureText(countStr).width;
        const badgeW = textW + Math.round(6 * s);
        const badgeH = Math.round(11 * s);
        const badgeX = x + w - badgeW - 1;
        const badgeY = y + h - badgeH - 1;

        // Dark pill background with bronze rim
        ctx.fillStyle = 'rgba(6, 8, 14, 0.9)';
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeStyle = '#6e4917';
        ctx.lineWidth = 1;
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#000000';
        ctx.fillText(countStr, x + w - 2, y + h - 2);
        ctx.fillStyle = '#fde047'; // Bright gold text
        ctx.fillText(countStr, x + w - 3, y + h - 3);
      }
    }

    // 7. Tactical Hover Glow & Corner Brackets
    if (isHovered) {
      ctx.strokeStyle = '#dfa448'; // Antique Gold
      ctx.lineWidth = Math.max(1.5, Math.round(1.5 * s));
      ctx.strokeRect(x, y, w, h);

      // Subtle inner gold wash
      ctx.fillStyle = 'rgba(223, 164, 72, 0.12)';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }

    ctx.restore();
  }

  onPointerDown(e) {
    this.isPressed = true;
    if (this.onPointerDownCallback) {
      this.onPointerDownCallback(e, this);
    }
    return true;
  }

  onClick(e) {
    if (this.onClickCallback) {
      this.onClickCallback(this.item, this);
    }
    return true;
  }

  onContextMenu(e) {
    if (this.onRightClickCallback) {
      this.onRightClickCallback(this.item, this);
    }
    return true;
  }
}
