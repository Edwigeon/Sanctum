import { TOOLTIP_DEFINITIONS } from './HUDConfig.js';

export class TooltipRenderer {
  drawTooltip(ctx, stageW, stageH, s, hoveredId, mouseX, mouseY, state) {
    if (!hoveredId) return;

    const resolver = TOOLTIP_DEFINITIONS[hoveredId];
    if (!resolver) return;

    const tip = resolver(state);
    if (!tip || !tip.title) return;

    const title = tip.title;
    const desc = tip.desc || '';
    const hotkey = tip.hotkey || '';
    const color = tip.color || '#dfa448';

    ctx.save();
    const tipFontTitle = `bold ${Math.max(10, Math.round(11 * s))}px monospace`;
    const tipFontDesc = `${Math.max(9, Math.round(9.5 * s))}px system-ui, sans-serif`;

    ctx.font = tipFontTitle;
    const titleW = ctx.measureText(title + (hotkey ? `  ${hotkey}` : '')).width;
    ctx.font = tipFontDesc;
    const descW = ctx.measureText(desc).width;
    const boxW = Math.max(titleW, descW) + Math.round(20 * s);
    const boxH = Math.round(38 * s);

    let boxX = mouseX - boxW / 2;
    let boxY = mouseY - boxH - Math.round(14 * s);

    // Keep on stage bounds
    boxX = Math.max(8, Math.min(stageW - boxW - 8, boxX));
    boxY = Math.max(8, boxY);

    // Dark parchment / iron tooltip frame
    ctx.fillStyle = 'rgba(6, 8, 14, 0.95)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Corner rivets
    ctx.fillStyle = color;
    ctx.fillRect(boxX - 1, boxY - 1, 3, 3);
    ctx.fillRect(boxX + boxW - 2, boxY - 1, 3, 3);
    ctx.fillRect(boxX - 1, boxY + boxH - 2, 3, 3);
    ctx.fillRect(boxX + boxW - 2, boxY + boxH - 2, 3, 3);

    // Title
    ctx.textAlign = 'left';
    ctx.font = tipFontTitle;
    ctx.fillStyle = color;
    ctx.fillText(title, boxX + Math.round(8 * s), boxY + Math.round(14 * s));

    if (hotkey) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(hotkey, boxX + boxW - Math.round(8 * s), boxY + Math.round(14 * s));
    }

    // Description
    ctx.textAlign = 'left';
    ctx.font = tipFontDesc;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(desc, boxX + Math.round(8 * s), boxY + Math.round(28 * s));

    ctx.restore();
  }
}
