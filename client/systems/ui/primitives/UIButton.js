import { UIComponent } from '../UIComponent.js';
import { uiTheme } from '../UITheme.js';

/**
 * UIButton — Palette-indexed interactive button with tactile beveled edges,
 * hover/active highlights, hotkey badge support, and sound triggering.
 */
export class UIButton extends UIComponent {
  constructor({
    id = 'button',
    text = '',
    hotkey = '',
    anchor,
    baseW = 100,
    baseH = 26,
    offsetX = 0,
    offsetY = 0,
    variant = 'default', // 'default' | 'primary' | 'danger'
    onClick = null,
    soundFx = 'click'
  } = {}) {
    super({ id, anchor, baseW, baseH, offsetX, offsetY });
    this.text = text;
    this.hotkey = hotkey;
    this.variant = variant;
    this.onClickCallback = onClick;
    this.soundFx = soundFx;
  }

  draw(ctx, layout, animTime) {
    const { x, y, w, h, isHovered, isPressed, enabled } = this;
    const s = layout.scale;

    ctx.save();

    // 1. Determine palette tokens based on state
    let bgToken = 'BUTTON_BG';
    let borderLightToken = 'BUTTON_BORDER_LIGHT';
    let borderDarkToken = 'BUTTON_BORDER_DARK';
    let textToken = 'TEXT_NORMAL';

    if (!enabled) {
      bgToken = 'PANEL_BG';
      textToken = 'BUTTON_DISABLED_TEXT';
    } else if (isPressed) {
      bgToken = 'BUTTON_PRESSED_BG';
      // Invert bevel for tactile pressed sensation
      borderLightToken = 'BUTTON_BORDER_DARK';
      borderDarkToken = 'BUTTON_BORDER_LIGHT';
      textToken = 'TEXT_HIGHLIGHT';
    } else if (isHovered) {
      bgToken = this.variant === 'primary' ? 'BUTTON_HOVER_BG' : 'BUTTON_HOVER_BG';
      borderLightToken = 'BUTTON_HOVER_BORDER';
      textToken = 'TEXT_ACCENT';
    } else if (this.variant === 'primary') {
      bgToken = 'BUTTON_HOVER_BG';
    }

    // 2. Button Face
    ctx.fillStyle = uiTheme.getHex(bgToken);
    ctx.fillRect(x, y, w, h);

    // 3. Tactile 3D Beveled Edges
    const borderW = Math.max(1, Math.round(1 * s));
    ctx.lineWidth = borderW;

    // Highlight (Top + Left)
    ctx.strokeStyle = uiTheme.getHex(borderLightToken);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    // Shadow (Bottom + Right)
    ctx.strokeStyle = uiTheme.getHex(borderDarkToken);
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    // 4. Button Text & Drop Shadow
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(10, Math.round(11 * s))}px monospace`;

    const textX = x + w / 2;
    const textY = y + Math.round(h * 0.65) + (isPressed ? 1 : 0);

    // 1px Drop shadow
    ctx.fillStyle = '#000000';
    ctx.fillText(this.text, textX + 1, textY + 1);

    ctx.fillStyle = uiTheme.getHex(textToken);
    ctx.fillText(this.text, textX, textY);

    // 5. Hotkey Badge (if specified)
    if (this.hotkey) {
      ctx.textAlign = 'right';
      ctx.font = `${Math.max(8, Math.round(9 * s))}px monospace`;
      ctx.fillStyle = uiTheme.getHex('TEXT_MUTED');
      ctx.fillText(`[${this.hotkey}]`, x + w - Math.round(4 * s), y + Math.round(h * 0.4));
    }

    ctx.restore();
  }

  onClick(e) {
    if (!this.enabled) return true;
    if (this.onClickCallback) {
      this.onClickCallback(e);
    }
    return true;
  }
}
