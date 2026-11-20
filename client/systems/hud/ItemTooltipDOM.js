/**
 * DOM Item Inspection & Comparison Tooltip Renderer
 */

import { RARITY_COLORS } from '../../../shared/Constants.js';

export const PAPERDOLL_SLOTS = ['ring1', 'helm', 'amulet', 'weapon', 'armor', 'offhand', 'gloves', 'boots', 'ring2'];

export const STAT_LABELS = {
  dmg: 'Damage',
  armor: 'Armor',
  might: 'Might',
  focus: 'Focus',
  agility: 'Agility',
  vitality: 'Vitality',
  crit: 'Crit Chance',
  speed: 'Move Speed',
  spellDmg: 'Spell Power',
  hp: 'Health',
  mp: 'Mana'
};

export function formatItemStats(stats) {
  if (!stats) return '';
  return Object.entries(stats).map(([k, v]) => {
    if (k === 'crit') return `+${Math.round(v * 100)}% Crit`;
    return `+${v} ${k.charAt(0).toUpperCase() + k.slice(1)}`;
  }).join(' • ');
}

export function renderStatRow(statKey, hoverVal, eqVal) {
  const label = STAT_LABELS[statKey] || (statKey.charAt(0).toUpperCase() + statKey.slice(1));
  const isPercent = statKey === 'crit';
  const formatVal = (v) => isPercent ? `${Math.round(v * 100)}%` : `${v}`;

  if (hoverVal !== undefined && eqVal !== undefined) {
    const diff = isPercent ? Math.round((hoverVal - eqVal) * 100) : (hoverVal - eqVal);
    let deltaHtml = '';
    if (diff > 0) {
      deltaHtml = `<span class="stat-delta-pos ml-1.5">(+${diff}${isPercent ? '%' : ''})</span>`;
    } else if (diff < 0) {
      deltaHtml = `<span class="stat-delta-neg ml-1.5">(${diff}${isPercent ? '%' : ''})</span>`;
    } else {
      deltaHtml = `<span class="stat-delta-neu ml-1.5">(0)</span>`;
    }
    return `<div class="flex items-center justify-between text-[11px]">
      <span class="text-slate-300">+${formatVal(hoverVal)} ${label}</span>
      ${deltaHtml}
    </div>`;
  } else if (hoverVal !== undefined) {
    return `<div class="flex items-center justify-between text-[11px]">
      <span class="text-slate-300">+${formatVal(hoverVal)} ${label}</span>
      <span class="stat-delta-pos ml-1.5">(+${formatVal(hoverVal)})</span>
    </div>`;
  } else if (eqVal !== undefined) {
    return `<div class="flex items-center justify-between text-[11px] text-slate-500">
      <span>+0 ${label}</span>
      <span class="stat-delta-neg ml-1.5">(-${formatVal(eqVal)})</span>
    </div>`;
  }
  return '';
}

export function positionTooltip(tooltip, targetEl, panelInv = null) {
  if (!tooltip || !targetEl) return;
  const targetRect = targetEl.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const invRect = panelInv ? panelInv.getBoundingClientRect() : targetRect;

  let left = invRect.left - tooltipRect.width - 12;
  if (left < 10) {
    left = Math.min(window.innerWidth - tooltipRect.width - 10, targetRect.right + 12);
  }
  let top = Math.max(10, Math.min(window.innerHeight - tooltipRect.height - 10, targetRect.top));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

export function hideComparisonTooltip() {
  const tooltip = document.getElementById('tooltip-item-compare');
  if (tooltip) tooltip.classList.add('hidden');
}

export function showConsumableTooltip(item, targetEl, panelInv = null) {
  const tooltip = document.getElementById('tooltip-item-compare');
  if (!tooltip || !item) return;

  const eqCard = document.getElementById('compare-equipped-card');
  const hoverCard = document.getElementById('compare-hover-card');

  if (eqCard) eqCard.classList.add('hidden');
  if (hoverCard) {
    hoverCard.classList.remove('hidden');
    const col = RARITY_COLORS[item.rarity] || '#38bdf8';
    const badgeEl = document.getElementById('compare-hover-badge');
    if (badgeEl) badgeEl.textContent = 'CONSUMABLE';
    const slotEl = document.getElementById('compare-hover-slot');
    if (slotEl) slotEl.textContent = `STACK: ${item.count || 1} / ${item.maxStack || 20}`;
    const nameEl = document.getElementById('compare-hover-name');
    if (nameEl) {
      nameEl.textContent = item.name;
      nameEl.style.color = col;
    }
    hoverCard.style.borderColor = col;

    const typeEl = document.getElementById('compare-hover-type');
    const totalW = ((item.weight || 0.2) * (item.count || 1)).toFixed(1);
    if (typeEl) typeEl.textContent = `Consumable • ${totalW} lb total`;

    const statsEl = document.getElementById('compare-hover-stats');
    if (statsEl) {
      if (item.subType === 'mp' || item.name?.includes('Mana')) {
        statsEl.innerHTML = '<div class="text-sky-300 font-bold">+30 Mana Restored</div><div class="text-[10px] text-slate-400">Instantly restores spiritual energy</div>';
      } else {
        statsEl.innerHTML = '<div class="text-rose-400 font-bold">+40 Health Restored</div><div class="text-[10px] text-slate-400">Instantly restores life wounds</div>';
      }
    }

    const actionsEl = document.getElementById('compare-hover-actions');
    if (actionsEl) {
      actionsEl.innerHTML = `<span class="text-emerald-300 font-bold">[LMB] Consume</span><span class="text-slate-400">[RMB] Drop 1</span>`;
    }
  }

  tooltip.classList.remove('hidden');
  positionTooltip(tooltip, targetEl, panelInv);
}

export function showComparisonTooltip(hoverItem, equippedItem, targetEl, panelInv = null) {
  const tooltip = document.getElementById('tooltip-item-compare');
  if (!tooltip || !hoverItem) return;

  const eqCard = document.getElementById('compare-equipped-card');
  const hoverCard = document.getElementById('compare-hover-card');

  const hoverCol = RARITY_COLORS[hoverItem.rarity] || '#FFFFFF';
  const badgeEl = document.getElementById('compare-hover-badge');
  if (badgeEl) badgeEl.textContent = equippedItem ? 'COMPARISON' : 'INSPECTING';
  const slotEl = document.getElementById('compare-hover-slot');
  if (slotEl) slotEl.textContent = (hoverItem.slot || '').toUpperCase();

  const hoverNameEl = document.getElementById('compare-hover-name');
  if (hoverNameEl) {
    hoverNameEl.textContent = hoverItem.name;
    hoverNameEl.style.color = hoverCol;
  }
  if (hoverCard) hoverCard.style.borderColor = hoverCol;

  const wHover = (hoverItem.weight || 1).toFixed(1);
  let wSub = `${(hoverItem.name || '').split(' ')[0]} • ${wHover} lb`;
  if (equippedItem) {
    const wDiff = Number(((hoverItem.weight || 1) - (equippedItem.weight || 1)).toFixed(1));
    if (wDiff > 0) wSub += ` <span class="stat-delta-neg">(+${wDiff} lb)</span>`;
    else if (wDiff < 0) wSub += ` <span class="stat-delta-pos">(${wDiff} lb)</span>`;
  }
  const typeEl = document.getElementById('compare-hover-type');
  if (typeEl) typeEl.innerHTML = wSub;

  const statKeys = new Set([
    ...Object.keys(hoverItem.stats || {}),
    ...(equippedItem ? Object.keys(equippedItem.stats || {}) : [])
  ]);

  const hoverStatsEl = document.getElementById('compare-hover-stats');
  if (hoverStatsEl) {
    if (statKeys.size === 0) {
      hoverStatsEl.innerHTML = '<div class="text-slate-500 italic">No special properties</div>';
    } else {
      let html = '';
      for (const k of statKeys) {
        html += renderStatRow(k, hoverItem.stats?.[k], equippedItem?.stats?.[k]);
      }
      hoverStatsEl.innerHTML = html;
    }
  }

  if (equippedItem && eqCard) {
    eqCard.classList.remove('hidden');
    const eqCol = RARITY_COLORS[equippedItem.rarity] || '#FFFFFF';
    const eqSlotEl = document.getElementById('compare-eq-slot');
    if (eqSlotEl) eqSlotEl.textContent = (equippedItem.slot || '').toUpperCase();
    const eqNameEl = document.getElementById('compare-eq-name');
    if (eqNameEl) {
      eqNameEl.textContent = equippedItem.name;
      eqNameEl.style.color = eqCol;
    }
    eqCard.style.borderColor = eqCol;

    const eqTypeEl = document.getElementById('compare-eq-type');
    if (eqTypeEl) eqTypeEl.textContent = `${(equippedItem.name || '').split(' ')[0]} • ${(equippedItem.weight || 1).toFixed(1)} lb`;
    const eqStatsEl = document.getElementById('compare-eq-stats');
    if (eqStatsEl) {
      const eqEntries = Object.entries(equippedItem.stats || {});
      if (eqEntries.length === 0) {
        eqStatsEl.innerHTML = '<div class="text-slate-500 italic">No special properties</div>';
      } else {
        eqStatsEl.innerHTML = eqEntries.map(([k, v]) => {
          const label = STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
          const isPercent = k === 'crit';
          return `<div class="text-slate-300 text-[11px]">+${isPercent ? Math.round(v * 100) + '%' : v} ${label}</div>`;
        }).join('');
      }
    }
  } else if (eqCard) {
    eqCard.classList.add('hidden');
  }

  const actionsEl = document.getElementById('compare-hover-actions');
  if (actionsEl) {
    actionsEl.innerHTML = `<span>[LMB] Equip</span><span class="text-slate-400">[RMB] Drop</span>`;
  }

  tooltip.classList.remove('hidden');
  positionTooltip(tooltip, targetEl, panelInv);
}

export function showEquippedTooltip(item, targetEl, panelInv = null) {
  const tooltip = document.getElementById('tooltip-item-compare');
  if (!tooltip || !item) return;

  const eqCard = document.getElementById('compare-equipped-card');
  const hoverCard = document.getElementById('compare-hover-card');

  if (eqCard) eqCard.classList.add('hidden');
  if (hoverCard) {
    hoverCard.classList.remove('hidden');
    const col = RARITY_COLORS[item.rarity] || '#FFFFFF';
    const badgeEl = document.getElementById('compare-hover-badge');
    if (badgeEl) badgeEl.textContent = 'EQUIPPED';
    const slotEl = document.getElementById('compare-hover-slot');
    if (slotEl) slotEl.textContent = (item.slot || '').toUpperCase();
    const nameEl = document.getElementById('compare-hover-name');
    if (nameEl) {
      nameEl.textContent = item.name;
      nameEl.style.color = col;
    }
    hoverCard.style.borderColor = col;

    const typeEl = document.getElementById('compare-hover-type');
    if (typeEl) typeEl.textContent = `${(item.name || '').split(' ')[0]} • ${(item.weight || 1).toFixed(1)} lb`;

    const statsEl = document.getElementById('compare-hover-stats');
    if (statsEl) {
      const entries = Object.entries(item.stats || {});
      if (entries.length === 0) {
        statsEl.innerHTML = '<div class="text-slate-500 italic">No special properties</div>';
      } else {
        statsEl.innerHTML = entries.map(([k, v]) => {
          const label = STAT_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
          const isPercent = k === 'crit';
          return `<div class="text-slate-200 text-[11px]">+${isPercent ? Math.round(v * 100) + '%' : v} ${label}</div>`;
        }).join('');
      }
    }

    const actionsEl = document.getElementById('compare-hover-actions');
    if (actionsEl) {
      actionsEl.innerHTML = `<span class="text-amber-300">[LMB] Unequip</span><span class="text-rose-400">[RMB] Drop</span>`;
    }
  }

  tooltip.classList.remove('hidden');
  positionTooltip(tooltip, targetEl, panelInv);
}
