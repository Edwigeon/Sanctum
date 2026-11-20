/**
 * Player Inventory, Equipment, Consumable & Ground Loot Pickup Actions
 */

import { dist } from '../../../shared/MathUtils.js';
import { saveManager } from '../SaveManager.js';

export function handleEquipItem(room, p, itemId) {
  const idx = p.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const item = p.inventory[idx];
  let targetSlot = item.slot;
  if (targetSlot === 'ring') {
    targetSlot = !p.equipment.ring1 ? 'ring1' : (!p.equipment.ring2 ? 'ring2' : 'ring1');
  }
  if (!targetSlot || !(targetSlot in p.equipment)) return;
  const prev = p.equipment[targetSlot];
  p.equipment[targetSlot] = item;
  p.inventory.splice(idx, 1);
  if (prev) p.inventory.push(prev);
  room.recalculateStats(p, false);
  p.dirtyState = true;
  saveManager.saveFromPlayer(p, room.floor);
}

export function handleUnequipItem(room, p, slot) {
  if (!slot || !(slot in p.equipment)) return;
  const item = p.equipment[slot];
  if (!item) return;
  if (p.inventory.length >= 40) return;
  p.equipment[slot] = null;
  p.inventory.push(item);
  room.recalculateStats(p, false);
  p.dirtyState = true;
  saveManager.saveFromPlayer(p, room.floor);
}

export function handleUseItem(room, p, itemId) {
  const idx = p.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const item = p.inventory[idx];
  if (item.type === 'potion' || item.type === 'consumable') {
    if (item.subType === 'mp' || item.name?.includes('Mana')) {
      if (p.mp >= p.maxMp) return;
      item.count = (item.count || 1) - 1;
      if (item.count <= 0) p.inventory.splice(idx, 1);
      const restore = Math.min(p.maxMp - p.mp, 30);
      p.mp += restore;
      room.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: restore });
    } else {
      if (p.hp >= p.maxHp) return;
      item.count = (item.count || 1) - 1;
      if (item.count <= 0) p.inventory.splice(idx, 1);
      const heal = Math.min(p.maxHp - p.hp, 40);
      p.hp += heal;
      room.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: heal });
    }
    room.recalculateStats(p, false);
    p.dirtyState = true;
    saveManager.saveFromPlayer(p, room.floor);
  }
}

export function handleDropItem(room, p, itemId) {
  const idx = p.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const item = p.inventory[idx];
  if (item.count && item.count > 1) {
    item.count--;
    room.groundLoot.push({ ...item, id: room.nextEntityId++, count: 1, x: p.x, y: p.y });
  } else {
    p.inventory.splice(idx, 1);
    room.groundLoot.push({ ...item, x: p.x, y: p.y });
  }
  room.recalculateStats(p, false);
  p.dirtyState = true;
  saveManager.saveFromPlayer(p, room.floor);
}

export function handlePlayerPotion(room, p, subType = 'hp') {
  if (subType === 'mp') {
    if (p.mp >= p.maxMp) return;
    const potIdx = p.inventory.findIndex(i => i.type === 'potion' && (i.subType === 'mp' || i.name?.includes('Mana')));
    if (potIdx === -1) return;
    const pot = p.inventory[potIdx];
    pot.count = (pot.count || 1) - 1;
    if (pot.count <= 0) {
      p.inventory.splice(potIdx, 1);
    }
    const restore = Math.min(p.maxMp - p.mp, 30);
    p.mp += restore;
    room.recalculateStats(p, false);
    p.dirtyState = true;
    room.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: restore, isMana: true });
    saveManager.saveFromPlayer(p, room.floor);
    return;
  }

  if (p.hp >= p.maxHp) return;
  const potIdx = p.inventory.findIndex(i => i.type === 'potion' && (!i.subType || i.subType === 'hp' || i.name?.includes('Health')));
  if (potIdx === -1 && p.potions <= 0) return;

  if (potIdx !== -1) {
    const pot = p.inventory[potIdx];
    pot.count = (pot.count || 1) - 1;
    if (pot.count <= 0) {
      p.inventory.splice(potIdx, 1);
    }
  }
  const heal = Math.min(p.maxHp - p.hp, 40);
  p.hp += heal;
  room.recalculateStats(p, false);
  p.dirtyState = true;
  room.events.push({ type: 'HEAL', targetType: 'player', id: p.id, x: p.x, y: p.y, amount: heal, isMana: false });
  saveManager.saveFromPlayer(p, room.floor);
}

export function handlePickupLoot(room, p, lootId) {
  const idx = room.groundLoot.findIndex(l => l.id === lootId);
  if (idx === -1) return false;
  const item = room.groundLoot[idx];
  if (dist(p.x, p.y, item.x, item.y) < 18) {
    if (item.type === 'gold') {
      room.groundLoot.splice(idx, 1);
      p.gold = (p.gold || 0) + (item.amount || 10);
      room.events.push({ type: 'GOLD_PICKUP', id: p.id, x: p.x, y: p.y, amount: item.amount || 10 });
      p.targetLootId = null;
      p.dirtyState = true;
      saveManager.saveFromPlayer(p, room.floor);
      return true;
    }

    const w = (item.weight || (item.type === 'potion' ? 0.2 : 1)) * (item.count || 1);
    if (p.carryWeight + w > p.maxWeight) {
      p.targetLootId = null;
      room.events.push({ type: 'OVERBURDENED', id: p.id, x: p.x, y: p.y });
      return false;
    }
    room.groundLoot.splice(idx, 1);
    if (item.type === 'potion' || item.stackable) {
      const existing = p.inventory.find(i => i.type === 'potion' && i.name === item.name && (i.count || 1) < (i.maxStack || 20));
      if (existing) {
        existing.count = Math.min(existing.maxStack || 20, (existing.count || 1) + (item.count || 1));
      } else {
        p.inventory.push({
          id: item.id || room.nextEntityId++,
          type: item.type,
          subType: item.subType || (item.name?.includes('Mana') ? 'mp' : 'hp'),
          name: item.name || 'Health Potion',
          count: item.count || 1,
          maxStack: 20,
          weight: 0.2,
          rarity: item.rarity ?? 1
        });
      }
      room.recalculateStats(p, false);
    } else if (item.type === 'gear') {
      p.inventory.push(item);
      room.recalculateStats(p, false);
    }
    p.targetLootId = null;
    p.dirtyState = true;
    saveManager.saveFromPlayer(p, room.floor);
    return true;
  }
  // Walk to loot if out of range
  p.targetMonsterId = null;
  p.targetLootId = lootId;
  p.targetX = item.x;
  p.targetY = item.y;
  return false;
}
