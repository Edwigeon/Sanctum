import { uiTheme } from '../UITheme.js';

/**
 * UIText — Pixel-crisp text rendering utilities.
 * Handles integer snapping, drop shadows, and palette-indexed colors.
 */
export class UIText {
  /**
   * Renders single-line text with an authentic 1px drop shadow.
   */
  static draw(ctx, text, x, y, {
    font = '11px monospace',
    colorToken = 'TEXT_NORMAL',
    align = 'left',
    baseline = 'alphabetic',
    dropShadow = true,
    shadowColor = '#000000'
  } = {}) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    const snapX = Math.round(x);
    const snapY = Math.round(y);

    if (dropShadow) {
      ctx.fillStyle = shadowColor;
      ctx.fillText(text, snapX + 1, snapY + 1);
    }

    ctx.fillStyle = uiTheme.getHex(colorToken);
    ctx.fillText(text, snapX, snapY);
    ctx.restore();
  }

  /**
   * Measures text width given a specific font.
   */
  static measureWidth(ctx, text, font = '11px monospace') {
    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return Math.round(w);
  }
}
