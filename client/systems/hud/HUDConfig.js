export const HUD_LAYOUT = {
  BASE_WIDTH: 720,
  BASE_HEIGHT: 432,
  MIN_SCALE: 0.72,
  MAX_SCALE: 1.5,
  POTION_WIDTH: 112,
  POTION_HEIGHT: 156,
  POTION_MARGIN_X: 16,
  POTION_MARGIN_BOTTOM: 10,
  SLOT_SIZE: 34,
  SLOT_GAP: 4,
  SEPARATOR_WIDTH: 6,
  BELT_PAD_X: 8,
  BELT_PAD_TOP: 7,
  XP_BAR_HEIGHT: 6,
  XP_BAR_GAP: 4,
  BELT_MARGIN_BOTTOM: 8,
  NUM_SLOTS: 6
};

export const ACTION_SLOTS = [
  {
    id: 'potion',
    key: '1',
    title: 'Health Potion',
    getSub: (state) => `x${state.potions}`,
    color: '#f43f5e',
    badgeColor: '#fb7185',
    type: 'flask'
  },
  {
    id: 'strike',
    key: 'LMB',
    title: 'Melee Strike',
    getSub: () => 'Strike',
    color: '#f59e0b',
    badgeColor: '#fcd34d',
    type: 'sword'
  },
  {
    id: 'spark',
    key: 'RMB',
    title: 'Spark Spell',
    getSub: () => 'Spark',
    color: '#06b6d4',
    badgeColor: '#67e8f9',
    type: 'spell'
  },
  { id: 'SEP' },
  {
    id: 'char',
    key: 'C',
    title: 'Character Sheet',
    getSub: () => 'Char',
    color: '#dfa448',
    badgeColor: '#fde047',
    isActive: (state) => Boolean(state.isCharOpen),
    hasNotif: (state) => (state.statPoints || 0) > 0,
    type: 'char'
  },
  {
    id: 'inv',
    key: 'I',
    title: 'Inventory',
    getSub: () => 'Inv',
    color: '#818cf8',
    badgeColor: '#a5b4fc',
    isActive: (state) => Boolean(state.isInvOpen),
    type: 'inv'
  },
  {
    id: 'menu',
    key: 'ESC',
    title: 'Game Menu',
    getSub: () => 'Menu',
    color: '#94a3b8',
    badgeColor: '#cbd5e1',
    isActive: (state) => Boolean(state.isPauseOpen),
    type: 'menu'
  }
];

export const TOOLTIP_DEFINITIONS = {
  hp: (state) => ({
    title: 'Life Elixir Flask',
    desc: `${state.hp} / ${state.maxHp} Health [Click to Drink (1)]`,
    color: '#f43f5e'
  }),
  mp: (state) => ({
    title: 'Mana Crystal Phial',
    desc: `${state.mp} / ${state.maxMp} Mana`,
    color: '#06b6d4'
  }),
  xp: (state) => {
    const pct = Math.round(((state.xp || 0) / (state.nextXp || 100)) * 100);
    return {
      title: 'Experience',
      desc: `${state.xp || 0} / ${state.nextXp || 100} (${pct}%) • Level ${state.level || 1}`,
      color: '#fbbf24'
    };
  },
  potion: (state) => ({
    title: 'Healing Potion',
    desc: `Restores 40 HP instantly • Stock: ${state.potions}`,
    hotkey: '[1] / Click',
    color: '#f43f5e'
  }),
  strike: () => ({
    title: 'Melee Strike',
    desc: 'Execute primary weapon attack',
    hotkey: '[LMB] / Hold',
    color: '#f59e0b'
  }),
  spark: () => ({
    title: 'Spark Spell',
    desc: 'Cast lightning bolt piercing target',
    hotkey: '[RMB]',
    color: '#22d3ee'
  }),
  char: (state) => ({
    title: 'Character Sheet',
    desc: state.statPoints > 0
      ? `View attributes • ${state.statPoints} unallocated points!`
      : 'View stats, attributes & derived powers',
    hotkey: '[C] / Click',
    color: '#dfa448'
  }),
  inv: () => ({
    title: 'Inventory & Equipment',
    desc: 'Manage gear, pack weight & equip items',
    hotkey: '[I] / Click',
    color: '#818cf8'
  }),
  menu: () => ({
    title: 'Game Menu',
    desc: 'Audio settings, invite link & surrender',
    hotkey: '[ESC] / Click',
    color: '#cbd5e1'
  })
};
