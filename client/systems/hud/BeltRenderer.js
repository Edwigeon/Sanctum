import { BIT_SPRITES, drawBitSprite } from '../BitSprites.js';
import { ACTION_SLOTS } from './HUDConfig.js';

export class BeltRenderer {
  drawBeltFrame(ctx, x, y, w, h, s) {
    ctx.save();

    // Soft backdrop drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - 2, y + 2, w + 4, h + 2);

    // Dark hammered iron plate background
    ctx.fillStyle = '#0a0c13';
    ctx.fillRect(x, y, w, h);

    // Inner panel texture / subtle gradient
    const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
    bgGrad.addColorStop(0, 'rgba(36, 42, 58, 0.45)');
    bgGrad.addColorStop(0.5, 'rgba(16, 19, 28, 0.7)');
    bgGrad.addColorStop(1, 'rgba(8, 10, 16, 0.9)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x, y, w, h);

    // Double Forged-Iron Beveled Borders
    ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
    ctx.strokeStyle = '#3d475f'; // Iron highlight
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    ctx.strokeStyle = '#05060a'; // Deep iron shadow
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    // Inner bronze border
    const inset = Math.max(1, Math.round(2 * s));
    ctx.strokeStyle = '#6e4917'; // Antique bronze
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

    // Corner Rivet Studs
    const rivetDist = Math.round(4 * s);
    const rivetSize = Math.max(1.5, 2 * s);
    const corners = [
      [x + rivetDist, y + rivetDist],
      [x + w - rivetDist, y + rivetDist],
      [x + rivetDist, y + h - rivetDist],
      [x + w - rivetDist, y + h - rivetDist]
    ];
    for (const [rx, ry] of corners) {
      ctx.fillStyle = '#dfa448'; // Brass highlight
      ctx.beginPath();
      ctx.arc(rx, ry, rivetSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#170f03';
      ctx.beginPath();
      ctx.arc(rx + 0.5, ry + 0.5, rivetSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawActionSlots(ctx, startX, startY, size, gap, sepW, s, animTime, state, boundsSlots, mouse, hoveredId) {
    boundsSlots.clear();

    let curX = startX;
    for (const def of ACTION_SLOTS) {
      if (def.id === 'SEP') {
        // Draw vertical carved separator
        ctx.strokeStyle = '#05060a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(curX + sepW / 2 - 0.5, startY + 2);
        ctx.lineTo(curX + sepW / 2 - 0.5, startY + size - 2);
        ctx.stroke();

        ctx.strokeStyle = '#353d52';
        ctx.beginPath();
        ctx.moveTo(curX + sepW / 2 + 0.5, startY + 2);
        ctx.lineTo(curX + sepW / 2 + 0.5, startY + size - 2);
        ctx.stroke();

        curX += sepW + gap;
        continue;
      }

      const slot = {
        id: def.id,
        key: def.key,
        title: def.title,
        sub: def.getSub ? def.getSub(state) : (def.sub || ''),
        color: def.color,
        badgeColor: def.badgeColor,
        type: def.type,
        isActive: def.isActive ? def.isActive(state) : false,
        hasNotif: def.hasNotif ? def.hasNotif(state) : false
      };

      boundsSlots.set(slot.id, { x: curX, y: startY, w: size, h: size });
      this.drawSingleSlot(ctx, curX, startY, size, slot, s, animTime, state, mouse, hoveredId === slot.id);
      curX += size + gap;
    }
  }

  drawSingleSlot(ctx, x, y, size, slot, s, animTime, state, mouse, isHovered) {
    ctx.save();
    const isPressed = slot.isActive || (mouse.pressedId === slot.id);

    // Inset slot background
    ctx.fillStyle = isPressed ? '#141824' : (isHovered ? '#1c2234' : '#0c0e16');
    ctx.fillRect(x, y, size, size);

    // Recessed bevel border (inner shadow)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isPressed ? '#dfa448' : '#06070c';
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    ctx.lineTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();

    ctx.strokeStyle = isPressed ? '#6e4917' : '#2b3348';
    ctx.beginPath();
    ctx.moveTo(x + size, y);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    if (isHovered) {
      ctx.strokeStyle = '#dfa448';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }

    // Draw Icon Silhouette / Glyph
    const cx = x + size / 2;
    const cy = y + size / 2 - Math.round(2 * s);
    const iconS = size * 0.42;

    this.drawSlotIcon(ctx, cx, cy, iconS, slot.type, slot.color, isPressed, s, state);

    // Hotkey badge (Top Left)
    ctx.font = `bold ${Math.max(8, Math.round(8.5 * s))}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = slot.badgeColor;
    ctx.fillText(slot.key, x + Math.round(3 * s), y + Math.round(9 * s));

    // Bottom Subtext (e.g. x3 or Strike)
    ctx.font = `bold ${Math.max(8, Math.round(8 * s))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = slot.id === 'potion' && state.potions === 0 ? '#94a3b8' : '#e2e8f0';
    ctx.fillText(slot.sub, cx, y + size - Math.round(3 * s));

    // Notification badge (e.g. Stat Points allocated on Character button)
    if (slot.hasNotif) {
      const pulse = Math.sin(animTime * 6) * 0.2 + 0.8;
      const bSize = Math.round(6 * s);
      const bx = x + size - bSize - 1;
      const by = y + 1;
      ctx.fillStyle = `rgba(245, 158, 11, ${pulse})`;
      ctx.beginPath();
      ctx.arc(bx + bSize / 2, by + bSize / 2, bSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${Math.max(7, Math.round(7.5 * s))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('+', bx + bSize / 2, by + bSize / 2 + 2.5);
    }

    ctx.restore();
  }

  drawSlotIcon(ctx, cx, cy, size, type, color, isPressed, s, state) {
    const sprKey = type === 'spell' ? 'spark' : (type === 'char' ? 'helmet' : (type === 'menu' ? 'portal' : type));
    const rows = BIT_SPRITES[sprKey];
    if (!rows) return;

    // Responsive integer pixel scaling for crisp bit-array rendering
    const pScale = Math.max(1, Math.round(1.6 * s));
    const sprW = rows[0].length * pScale;
    const sprH = rows.length * pScale;
    const startX = cx - sprW / 2;
    const startY = cy - sprH / 2 + (isPressed ? 1 : 0);

    ctx.save();
    if (type === 'flask' && state.potions === 0) {
      ctx.globalAlpha = 0.35;
    }
    drawBitSprite(ctx, sprKey, startX, startY, pScale);
    ctx.restore();
  }

  drawXPBar(ctx, x, y, w, h, s, state) {
    ctx.save();
    const pct = Math.max(0, Math.min(1, (state.xp || 0) / (state.nextXp || 100)));

    // Inset groove
    ctx.fillStyle = '#06070b';
    ctx.fillRect(x, y, w, h);

    // Bevel frame
    ctx.strokeStyle = '#22293a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Gold XP fill
    if (pct > 0) {
      const fillW = Math.round(w * pct);
      const xpGrad = ctx.createLinearGradient(x, y, x, y + h);
      xpGrad.addColorStop(0, '#fbbf24'); // Bright amber
      xpGrad.addColorStop(0.5, '#d97706'); // Copper gold
      xpGrad.addColorStop(1, '#78350f'); // Deep bronze
      ctx.fillStyle = xpGrad;
      ctx.fillRect(x + 0.5, y + 0.5, fillW, h - 1);

      // Specular highlight line on top
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(x + 0.5, y + 0.5, fillW, Math.max(1, h * 0.25));
    }

    // Tick markers at 25%, 50%, 75%
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    for (const tick of [0.25, 0.5, 0.75]) {
      const tx = Math.round(x + w * tick);
      ctx.beginPath();
      ctx.moveTo(tx, y);
      ctx.lineTo(tx, y + h);
      ctx.stroke();
    }

    ctx.restore();
  }
}
