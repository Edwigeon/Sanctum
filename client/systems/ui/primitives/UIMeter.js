import { UIComponent } from '../UIComponent.js';
import { uiTheme } from '../UITheme.js';

/**
 * UIMeter — Reusable progress meter for XP, health, mana, stamina, and casting bars.
 * Features beveled recessed casing, animated fill bar, and segmented ticks.
 */
export class UIMeter extends UIComponent {
  constructor({
    id = 'meter',
    anchor,
    baseW = 120,
    baseH = 8,
    offsetX = 0,
    offsetY = 0,
    current = 0,
    max = 100,
    fillToken = 'XP_FILL',
    bgToken = 'XP_BG',
    showText = false,
    textFormat = null // (curr, max) => string
  } = {}) {
    super({ id, anchor, baseW, baseH, offsetX, offsetY });
    this.current = current;
    this.max = max;
    this.fillToken = fillToken;
    this.bgToken = bgToken;
    this.showText = showText;
    this.textFormat = textFormat || ((c, m) => `${c} / ${m}`);
    this.displayVal = current;
  }

  setValues(current, max) {
    this.current = current;
    this.max = Math.max(1, max);
  }

  draw(ctx, layout, animTime) {
    const { x, y, w, h } = this;
    const s = layout.scale;

    ctx.save();

    // Smoothly lerp display value
    this.displayVal += (this.current - this.displayVal) * 0.15;
    const frac = Math.max(0, Math.min(1, this.displayVal / Math.max(1, this.max)));

    // 1. Recessed background trough
    ctx.fillStyle = uiTheme.getHex(this.bgToken);
    ctx.fillRect(x, y, w, h);

    // 2. Filled bar
    const fillW = Math.round(w * frac);
    if (fillW > 0) {
      ctx.fillStyle = uiTheme.getHex(this.fillToken);
      ctx.fillRect(x, y, fillW, h);

      // Subtle top highlight strip
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x, y, fillW, Math.max(1, Math.round(h * 0.25)));
    }

    // 3. Beveled inset casing
    ctx.lineWidth = Math.max(1, Math.round(1 * s));
    ctx.strokeStyle = uiTheme.getHex('BUTTON_BORDER_DARK');
    ctx.strokeRect(x, y, w, h);

    // 4. Centered text overlay (if requested)
    if (this.showText) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.max(8, Math.round(9 * s))}px monospace`;
      const str = this.textFormat(Math.round(this.displayVal), this.max);
      ctx.fillStyle = '#000000';
      ctx.fillText(str, x + w / 2 + 1, y + Math.round(h * 0.75) + 1);
      ctx.fillStyle = uiTheme.getHex('TEXT_NORMAL');
      ctx.fillText(str, x + w / 2, y + Math.round(h * 0.75));
    }

    ctx.restore();
  }
}
