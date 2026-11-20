/**
 * Character Sheet, Paperdoll Equipment, Vitals/Death Overlay & Inventory Pack DOM Renderer
 */

import { GAME_MODES, PACKET_TYPES, RARITY_COLORS } from '../../../shared/Constants.js';
import { getBitSpriteDataUrl, getItemSpriteKey } from '../BitSprites.js';
import { PAPERDOLL_SLOTS, formatItemStats } from './ItemTooltipDOM.js';

export function initBitSpriteIcons() {
  const mightEl = document.getElementById('icon-stat-might');
  if (mightEl) mightEl.src = getBitSpriteDataUrl('might', 2);
  const focusEl = document.getElementById('icon-stat-focus');
  if (focusEl) focusEl.src = getBitSpriteDataUrl('focus', 2);
  const agiEl = document.getElementById('icon-stat-agility');
  if (agiEl) agiEl.src = getBitSpriteDataUrl('agility', 2);
  const vitEl = document.getElementById('icon-stat-vitality');
  if (vitEl) vitEl.src = getBitSpriteDataUrl('vitality', 2);

  for (const slot of PAPERDOLL_SLOTS) {
    const el = document.getElementById(`slot-${slot}`);
    const iconEl = el?.querySelector('.slot-icon');
    if (iconEl) iconEl.src = getBitSpriteDataUrl('slot_' + slot, 2);
  }

  const goldEl = document.getElementById('icon-inv-gold');
  if (goldEl) goldEl.src = getBitSpriteDataUrl('coin', 2);
}

export function bindPaperdollEvents(hud) {
  for (const slot of PAPERDOLL_SLOTS) {
    const el = document.getElementById(`slot-${slot}`);
    if (!el) continue;
    el.addEventListener('click', () => {
      const item = hud.lastPrivRef?.equipment?.[slot];
      if (item) {
        hud.sendPacket({ type: PACKET_TYPES.UNEQUIP_ITEM, slot });
        hud.hideComparisonTooltip();
      }
    });
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const item = hud.lastPrivRef?.equipment?.[slot];
      if (item) {
        hud.sendPacket({ type: PACKET_TYPES.DROP_ITEM, itemId: item.id });
        hud.hideComparisonTooltip();
      }
    });
    el.addEventListener('mouseenter', () => {
      const item = hud.lastPrivRef?.equipment?.[slot];
      if (item) {
        hud.showEquippedTooltip(item, el);
      }
    });
    el.addEventListener('mouseleave', () => {
      hud.hideComparisonTooltip();
    });
  }
}

export function updateVitalsAndDeathDOM(hud, myP, activeRoomMode) {
  const vitalsKey = `${myP.hp}|${myP.maxHp}|${myP.mp}|${myP.maxMp}|${myP.isDead}|${activeRoomMode}`;
  if (vitalsKey === hud.lastVitalsKey) return;
  hud.lastVitalsKey = vitalsKey;

  const elHp = document.getElementById('hud-hp');
  if (elHp) elHp.textContent = `${myP.hp} / ${myP.maxHp}`;
  const elMp = document.getElementById('hud-mp');
  if (elMp) elMp.textContent = `${myP.mp} / ${myP.maxMp}`;

  if (myP.isDead) {
    const isHC = activeRoomMode === GAME_MODES.HARDCORE;
    const statusEl = document.getElementById('status-line');
    if (statusEl) {
      statusEl.textContent = isHC ? 'YOU HAVE FALLEN (Permadeath)' : 'You were slain!';
      statusEl.className = 'text-[10px] font-mono text-rose-400 bg-slate-900 px-2 py-0.5 rounded border border-rose-900';
    }
    document.getElementById('death-title').textContent = isHC ? 'YOU HAVE FALLEN' : 'YOU WERE SLAIN';
    document.getElementById('death-subtitle').textContent = isHC
      ? 'Permadeath — Your deeds are etched in the Hall of Fallen Heroes.'
      : '10% XP penalty • Respawn at floor entrance';
    const btnRespawn = document.getElementById('btn-respawn');
    if (isHC) btnRespawn.classList.add('hidden');
    else btnRespawn.classList.remove('hidden');
    hud.panelDeath.classList.remove('hidden');
  } else {
    hud.panelDeath.classList.add('hidden');
  }
}

export function updateCharacterSheetDOM(myP, priv) {
  const elPot = document.getElementById('hud-pot');
  if (elPot) elPot.textContent = `x${priv.potions ?? 3}`;
  const xpPct = Math.min(100, Math.round(((priv.xp || 0) / (priv.nextXp || 100)) * 100));
  const elXpBar = document.getElementById('hud-xp-bar');
  if (elXpBar) elXpBar.style.width = `${xpPct}%`;

  const statBadge = document.getElementById('badge-stat-pts');
  if (priv.statPoints > 0) statBadge.classList.remove('hidden');
  else statBadge.classList.add('hidden');

  document.getElementById('char-name').textContent = myP.name;
  document.getElementById('char-sub').textContent = `Lv ${priv.level || 1} ${priv.className || 'Hero'}`;
  document.getElementById('char-xp-text').textContent = `${priv.xp || 0} / ${priv.nextXp || 100}`;
  document.getElementById('char-xp-bar').style.width = `${xpPct}%`;

  if (priv.stats) {
    document.getElementById('stat-might').textContent = priv.stats.might;
    document.getElementById('stat-focus').textContent = priv.stats.focus;
    document.getElementById('stat-agility').textContent = priv.stats.agility;
    document.getElementById('stat-vitality').textContent = priv.stats.vitality;
  }
  const ptsEl = document.getElementById('char-stat-pts');
  if (priv.statPoints > 0) {
    ptsEl.textContent = `${priv.statPoints} pts`;
    ptsEl.classList.remove('hidden');
  } else {
    ptsEl.classList.add('hidden');
  }
  document.querySelectorAll('.btn-alloc-stat').forEach(b => {
    if (priv.statPoints > 0) b.classList.remove('hidden');
    else b.classList.add('hidden');
  });

  if (priv.derived) {
    document.getElementById('der-dmg').textContent = `${priv.derived.dmgMin}–${priv.derived.dmgMax}`;
    document.getElementById('der-spell').textContent = priv.derived.spellDmg;
    document.getElementById('der-armor').textContent = priv.derived.armor;
    document.getElementById('der-crit').textContent = `${priv.derived.crit}%`;
    document.getElementById('der-speed').textContent = priv.derived.speed;
  }
}

export function updateInventoryAndPaperdollDOM(hud, priv) {
  const crestClass = document.getElementById('crest-class');
  if (crestClass) crestClass.textContent = (priv.className || priv.classId || 'HERO').toUpperCase();
  const crestLvl = document.getElementById('crest-level');
  if (crestLvl) crestLvl.textContent = `LVL ${priv.level || 1}`;

  if (priv.equipment) {
    for (const slot of PAPERDOLL_SLOTS) {
      const el = document.getElementById(`slot-${slot}`);
      if (!el) continue;
      const item = priv.equipment[slot];
      const iconEl = el.querySelector('.slot-icon');
      if (item) {
        const col = RARITY_COLORS[item.rarity] || '#FFFFFF';
        el.style.borderColor = col;
        el.classList.add('socket-occupied');
        if (iconEl) {
          iconEl.src = getBitSpriteDataUrl(getItemSpriteKey(item), 2);
        }
      } else {
        el.style.borderColor = '';
        el.classList.remove('socket-occupied');
        if (iconEl) {
          iconEl.src = getBitSpriteDataUrl('slot_' + slot, 2);
        }
      }
    }
  }

  const goldTextEl = document.getElementById('inv-gold-text');
  if (goldTextEl) goldTextEl.textContent = (priv.gold ?? 0).toLocaleString();

  const curW = priv.carryWeight ?? 0;
  const maxW = priv.maxWeight ?? 60;
  const wPct = Math.min(100, Math.round((curW / maxW) * 100));
  document.getElementById('inv-weight-text').textContent = `${curW.toFixed(1)} / ${maxW.toFixed(1)} lb`;
  const wBar = document.getElementById('inv-weight-bar');
  wBar.style.width = `${wPct}%`;
  wBar.className = `h-full transition-all ${wPct >= 90 ? 'bg-rose-500' : (wPct >= 70 ? 'bg-amber-400' : 'bg-indigo-400')}`;

  const inv = priv.inventory || [];
  const invKey = JSON.stringify(inv);
  if (invKey === hud.lastInvKey) return;
  hud.lastInvKey = invKey;

  const list = document.getElementById('inv-list');
  list.innerHTML = '';
  if (inv.length === 0) {
    list.innerHTML = '<div class="text-[10px] font-mono text-slate-500 py-4 text-center">Pack is empty</div>';
  } else {
    for (const item of inv) {
      const isConsumable = item.type === 'potion' || item.type === 'consumable';
      const col = RARITY_COLORS[item.rarity] || (isConsumable ? '#38bdf8' : '#FFFFFF');
      const sprKey = getItemSpriteKey(item);
      const sprUrl = getBitSpriteDataUrl(sprKey, 2);

      const countBadge = (item.count && item.count > 1) || isConsumable
        ? `<span class="bg-amber-950/90 border border-amber-600/70 text-amber-300 font-bold px-1.5 py-0.2 rounded text-[10px] shrink-0 font-mono">x${item.count || 1}</span>`
        : '';

      const subtitleText = isConsumable
        ? (item.subType === 'mp' || item.name?.includes('Mana') ? 'Restores 30 Mana' : 'Restores 40 Health')
        : formatItemStats(item.stats);

      const typeLabel = isConsumable ? 'CONSUMABLE' : (item.slot || 'GEAR');

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'w-full text-left rounded bg-slate-900/90 border border-slate-800 p-1.5 hover:bg-slate-800 transition flex items-center gap-2 cursor-pointer';
      row.style.borderLeftWidth = '3px';
      row.style.borderLeftColor = col;
      row.innerHTML = `
        <img src="${sprUrl}" class="w-6 h-6 pixelated shrink-0 bg-slate-950/80 p-0.5 rounded border border-slate-800" alt="${item.name}">
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex items-center justify-between gap-1 text-[11px] font-mono">
            <span class="font-bold truncate" style="color:${col}">${item.name}</span>
            <div class="flex items-center gap-1.5 shrink-0">
              ${countBadge}
              <span class="text-[9px] text-slate-400">${((item.weight || 0.2) * (item.count || 1)).toFixed(1)} lb</span>
            </div>
          </div>
          <div class="flex items-center justify-between text-[9px] font-mono">
            <span class="text-emerald-300 truncate">${subtitleText}</span>
            <span class="text-slate-500 uppercase ml-1 shrink-0">${typeLabel}</span>
          </div>
        </div>
      `;
      row.addEventListener('mouseenter', () => {
        if (isConsumable) {
          hud.showConsumableTooltip(item, row);
        } else {
          const eqMap = hud.lastPrivRef?.equipment;
          const targetSlot = item.slot === 'ring'
            ? (!eqMap?.ring1 ? 'ring1' : (!eqMap?.ring2 ? 'ring2' : 'ring1'))
            : item.slot;
          const eq = eqMap?.[targetSlot] || null;
          hud.showComparisonTooltip(item, eq, row);
        }
      });
      row.addEventListener('mouseleave', () => {
        hud.hideComparisonTooltip();
      });
      row.addEventListener('click', () => {
        if (isConsumable) {
          hud.sendPacket({ type: PACKET_TYPES.USE_ITEM, itemId: item.id });
        } else {
          hud.sendPacket({ type: PACKET_TYPES.EQUIP_ITEM, itemId: item.id });
        }
        hud.hideComparisonTooltip();
      });
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        hud.sendPacket({ type: PACKET_TYPES.DROP_ITEM, itemId: item.id });
        hud.hideComparisonTooltip();
      });
      list.appendChild(row);
    }
  }
}
