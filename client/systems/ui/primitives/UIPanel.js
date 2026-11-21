import { UIComponent } from '../UIComponent.js';
import { uiTheme } from '../UITheme.js';

/**
 * UIPanel — Coherent, high-detail dark-fantasy panel framework for Sanctum.
 * Features full HighRes canvas fidelity matching the resource globes.
 * Supports 'tome' (rich leather-bound grimoire with cast brass corners and aged vellum pages)
 * and 'iron' (hammered-iron slab with rivets).
 */
export class UIPanel extends UIComponent {
  constructor({
    id = 'panel',
    title = '',
    anchor,
    baseW = 300,
    baseH = 400,
    offsetX = 0,
    offsetY = 0,
    zOrder = 10,
    panelStyle = 'tome', // 'tome' | 'iron'
    hasRivets = true,
    hasCorners = true,
    hasCloseButton = false,
    hasBookmark = false,
    onClose = null
  } = {}) {
    super({ id, anchor, baseW, baseH, offsetX, offsetY, zOrder });
    this.title = title;
    this.panelStyle = panelStyle;
    this.hasRivets = hasRivets;
    this.hasCorners = hasCorners;
    this.hasCloseButton = hasCloseButton;
    this.hasBookmark = hasBookmark;
    this.onClose = onClose;

    this.headerH = title ? 28 : 0;
  }

  draw(ctx, layout, animTime = 0) {
    const { x, y, w, h } = this;
    const s = layout.scale;

    ctx.save();

    if (this.panelStyle === 'tome') {
      this.drawTomeCover(ctx, x, y, w, h, s, animTime);
    } else {
      this.drawIronSlab(ctx, x, y, w, h, s, animTime);
    }

    // Header Title (if specified)
    if (this.title) {
      this.drawHeaderTitle(ctx, x, y, w, s);
    }

    // Close Button [✕] (Styled as antique brass wax-seal clasp)
    if (this.hasCloseButton) {
      this.drawCloseButton(ctx, x, y, w, s);
    }

    ctx.restore();
  }

  /**
   * High-detail medieval leather-bound tome with cast brass corners,
   * embossed tooling, and layered aged vellum manuscript pages.
   */
  drawTomeCover(ctx, x, y, w, h, s, animTime) {
    // 1. Soft Physical Book Drop Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(x - 4, y + 4, w + 8, h + 6);

    // 2. Calfskin / Oxblood Leather Tome Base
    const leatherGrad = ctx.createLinearGradient(x, y, x, y + h);
    leatherGrad.addColorStop(0, '#2e1910'); // Rich oxblood
    leatherGrad.addColorStop(0.25, '#22130c');
    leatherGrad.addColorStop(0.75, '#160c07');
    leatherGrad.addColorStop(1, '#0e0704');
    ctx.fillStyle = leatherGrad;
    ctx.fillRect(x, y, w, h);

    // Outer Leather Rim Bevels
    const borderW = Math.max(1, Math.round(1.5 * s));
    ctx.lineWidth = borderW;

    // Specular chestnut leather highlight (Top & Left)
    ctx.strokeStyle = '#543220';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    // Deep cast leather shadow (Bottom & Right)
    ctx.strokeStyle = '#050302';
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    // 3. Embossed Leather Tooling Groove (Inset 6px)
    const toolInset = Math.max(4, Math.round(6 * s));
    ctx.strokeStyle = '#080402'; // Sunken groove
    ctx.lineWidth = 1;
    ctx.strokeRect(x + toolInset, y + toolInset, w - toolInset * 2, h - toolInset * 2);

    ctx.strokeStyle = '#3e2415'; // Stamped relief highlight
    ctx.strokeRect(x + toolInset + 1, y + toolInset + 1, w - (toolInset + 1) * 2, h - (toolInset + 1) * 2);

    // 4. Layered Parchment / Dark Vellum Page Inset (Inset 11px)
    const pageInset = Math.max(8, Math.round(11 * s));
    const pageX = x + pageInset;
    const pageY = y + pageInset;
    const pageW = w - pageInset * 2;
    const pageH = h - pageInset * 2;

    // Stacked Deckle Page Edges (Gives physical multi-page book thickness)
    ctx.fillStyle = '#5c4b33'; // Aged paper edge
    ctx.fillRect(pageX + 2, pageY + pageH, pageW - 2, Math.max(1, Math.round(2 * s)));
    ctx.fillStyle = '#7a6445'; // Paper highlight edge
    ctx.fillRect(pageX + 2, pageY + pageH + Math.max(1, Math.round(2 * s)), pageW - 4, 1);

    ctx.fillStyle = '#3a2e1d'; // Right paper edge
    ctx.fillRect(pageX + pageW, pageY + 2, Math.max(1, Math.round(2 * s)), pageH);
    ctx.fillStyle = '#5c4b33';
    ctx.fillRect(pageX + pageW + Math.max(1, Math.round(2 * s)), pageY + 4, 1, pageH - 4);

    // Dark Vellum Page Interior
    const vellumGrad = ctx.createLinearGradient(pageX, pageY, pageX, pageY + pageH);
    vellumGrad.addColorStop(0, '#171416');
    vellumGrad.addColorStop(0.5, '#110e11');
    vellumGrad.addColorStop(1, '#0b090c');
    ctx.fillStyle = vellumGrad;
    ctx.fillRect(pageX, pageY, pageW, pageH);

    // Illuminated Gold-Leaf Inner Manuscript Border
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(223, 164, 72, 0.45)'; // Gold leaf
    ctx.strokeRect(pageX + 2, pageY + 2, pageW - 4, pageH - 4);

    // Subtle corner fleur-de-lis flourishes on vellum
    const fSize = Math.round(6 * s);
    ctx.strokeStyle = '#dfa448';
    ctx.strokeRect(pageX + 4, pageY + 4, fSize, fSize);
    ctx.strokeRect(pageX + pageW - 4 - fSize, pageY + 4, fSize, fSize);
    ctx.strokeRect(pageX + 4, pageY + pageH - 4 - fSize, fSize, fSize);
    ctx.strokeRect(pageX + pageW - 4 - fSize, pageY + pageH - 4 - fSize, fSize, fSize);

    // 5. Cast Antique Brass Book Corners (4 Corners with Gothic Acanthus Filigree)
    if (this.hasCorners) {
      const cSize = Math.max(14, Math.round(18 * s));
      this.drawBrassCorner(ctx, x, y, cSize, 0, 0);                 // Top-Left
      this.drawBrassCorner(ctx, x + w, y, cSize, -1, 0);            // Top-Right
      this.drawBrassCorner(ctx, x, y + h, cSize, 0, -1);            // Bottom-Left
      this.drawBrassCorner(ctx, x + w, y + h, cSize, -1, -1);       // Bottom-Right
    }
  }

  /**
   * Draws an ornate cast-brass gothic book corner bracket with layered metallic relief.
   */
  drawBrassCorner(ctx, cx, cy, size, dirX, dirY) {
    const startX = dirX === -1 ? cx - size : cx;
    const startY = dirY === -1 ? cy - size : cy;

    ctx.save();
    // Shadow bevel
    ctx.fillStyle = '#1c0e04';
    ctx.fillRect(startX, startY, size, size);

    // Multi-shade metallic brass body
    ctx.fillStyle = '#dfa448'; // Antique Brass
    if (dirX === 0 && dirY === 0) {
      // Top-Left
      ctx.fillRect(startX, startY, size, 4);
      ctx.fillRect(startX, startY, 4, size);
      ctx.fillRect(startX + 4, startY + 4, 4, 4);
      // Gilded ridge specular glint
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(startX + 1, startY + 1, size - 2, 1);
      ctx.fillRect(startX + 1, startY + 1, 1, size - 2);
      // Bronze inner shadow
      ctx.fillStyle = '#8f4024';
      ctx.fillRect(startX + 4, startY + 3, size - 4, 1);
      ctx.fillRect(startX + 3, startY + 4, 1, size - 4);
    } else if (dirX === -1 && dirY === 0) {
      // Top-Right
      ctx.fillRect(startX, startY, size, 4);
      ctx.fillRect(startX + size - 4, startY, 4, size);
      ctx.fillRect(startX + size - 8, startY + 4, 4, 4);
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(startX + 1, startY + 1, size - 2, 1);
      ctx.fillRect(startX + size - 2, startY + 1, 1, size - 2);
      ctx.fillStyle = '#8f4024';
      ctx.fillRect(startX, startY + 3, size - 4, 1);
      ctx.fillRect(startX + size - 4, startY + 4, 1, size - 4);
    } else if (dirX === 0 && dirY === -1) {
      // Bottom-Left
      ctx.fillRect(startX, startY + size - 4, size, 4);
      ctx.fillRect(startX, startY, 4, size);
      ctx.fillRect(startX + 4, startY + size - 8, 4, 4);
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(startX + 1, startY + size - 2, size - 2, 1);
      ctx.fillRect(startX + 1, startY + 1, 1, size - 2);
      ctx.fillStyle = '#8f4024';
      ctx.fillRect(startX + 4, startY + size - 4, size - 4, 1);
      ctx.fillRect(startX + 3, startY, 1, size - 4);
    } else {
      // Bottom-Right
      ctx.fillRect(startX, startY + size - 4, size, 4);
      ctx.fillRect(startX + size - 4, startY, 4, size);
      ctx.fillRect(startX + size - 8, startY + size - 8, 4, 4);
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(startX + 1, startY + size - 2, size - 2, 1);
      ctx.fillRect(startX + size - 2, startY + 1, 1, size - 2);
      ctx.fillStyle = '#8f4024';
      ctx.fillRect(startX, startY + size - 4, size - 4, 1);
      ctx.fillRect(startX + size - 4, startY, 1, size - 4);
    }

    // Faceted Brass Dome Rivet
    const rivetX = dirX === -1 ? cx - 7 : cx + 7;
    const rivetY = dirY === -1 ? cy - 7 : cy + 7;
    ctx.fillStyle = '#fff1e8';
    ctx.beginPath();
    ctx.arc(rivetX, rivetY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#561e12';
    ctx.beginPath();
    ctx.arc(rivetX + 0.5, rivetY + 0.5, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Classic Forged-Iron Slab style (for Menu & Settings).
   */
  drawIronSlab(ctx, x, y, w, h, s, animTime) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - 2, y + 2, w + 4, h + 4);

    const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
    bgGrad.addColorStop(0, '#1a1d27');
    bgGrad.addColorStop(0.5, '#0d0f15');
    bgGrad.addColorStop(1, '#080a0f');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x, y, w, h);

    const borderW = Math.max(1, Math.round(1.5 * s));
    ctx.lineWidth = borderW;
    ctx.strokeStyle = '#3d475f';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    ctx.strokeStyle = '#05060a';
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    const inset = Math.max(2, Math.round(3 * s));
    ctx.strokeStyle = '#6e4917';
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  }

  drawHeaderTitle(ctx, x, y, w, s) {
    const pageInset = Math.max(8, Math.round(11 * s));
    const titleY = y + pageInset + Math.round(16 * s);

    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(11, Math.round(13 * s))}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.fillText(`~ ❖  ${this.title}  ❖ ~`, x + w / 2 + 1, titleY + 1);
    ctx.fillStyle = '#dfa448';
    ctx.fillText(`~ ❖  ${this.title}  ❖ ~`, x + w / 2, titleY);

    const divY = titleY + Math.round(8 * s);
    ctx.strokeStyle = 'rgba(110, 73, 23, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + pageInset + Math.round(12 * s), divY);
    ctx.lineTo(x + w - pageInset - Math.round(12 * s), divY);
    ctx.stroke();
  }

  drawCloseButton(ctx, x, y, w, s) {
    const pageInset = Math.max(8, Math.round(11 * s));
    const closeX = x + w - pageInset - Math.round(16 * s);
    const closeY = y + pageInset + Math.round(4 * s);
    const closeSize = Math.round(15 * s);

    // Wax-seal / brass button circle
    ctx.fillStyle = '#26160e';
    ctx.beginPath();
    ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#dfa448';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(9, Math.round(10 * s))}px monospace`;
    ctx.fillStyle = '#fff1e8';
    ctx.fillText('✕', closeX + closeSize / 2, closeY + closeSize * 0.72);
  }

  onClick(e) {
    if (this.hasCloseButton && this.onClose) {
      const s = uiTheme ? 1 : 1;
      const pageInset = Math.max(8, Math.round(11 * s));
      const closeX = this.x + this.w - pageInset - Math.round(16 * s);
      const closeY = this.y + pageInset + Math.round(4 * s);
      const closeSize = Math.round(15 * s);

      if (e.x >= closeX - 2 && e.x <= closeX + closeSize + 2 && e.y >= closeY - 2 && e.y <= closeY + closeSize + 2) {
        this.onClose();
        return true;
      }
    }
    return true;
  }
}
