import { GAME_MODES } from '../../shared/Constants.js';
import { db } from './Database.js';
import { authService } from './AuthService.js';
import { saveManager } from './SaveManager.js';

export async function seedDemoDatabase() {
  const existing = db.prepare("SELECT id FROM accounts WHERE username = 'kael_test'").get();
  if (existing) return;

  const a1 = await authService.register('kael_test', 'DemoHeroPass#2026');
  const a2 = await authService.register('lyra_test', 'DemoHeroPass#2026');
  const a3 = await authService.register('vex_test', 'DemoHeroPass#2026');

  if (a1.account) {
    const { character: c1 } = saveManager.createCharacter({ accountId: a1.account.id, name: 'Kaelen', classId: 'VANGUARD', mode: GAME_MODES.CLASSIC });
    db.prepare('UPDATE characters SET level = 7, highest_floor = 4 WHERE id = ?').run(c1.id);
    const { character: c2 } = saveManager.createCharacter({ accountId: a1.account.id, name: 'IronVow', classId: 'VANGUARD', mode: GAME_MODES.HARDCORE });
    db.prepare('UPDATE characters SET level = 11, highest_floor = 6, is_dead = 1 WHERE id = ?').run(c2.id);
    db.prepare(`
      INSERT INTO fallen_heroes (id, account_id, account_name, hero_name, class_id, level, floor, data_json, died_at)
      VALUES (?, ?, 'kael_test', 'IronVow', 'VANGUARD', 11, 6, ?, ?)
    `).run('demo-fallen-1', a1.account.id, JSON.stringify({ stats: { might: 28, focus: 8, agility: 14, vitality: 26 }, equipment: { weapon: { name: 'Blood Cleaver', rarity: 2 }, armor: null, gloves: null, ring: null } }), Date.now() - 86400000);
  }

  if (a2.account) {
    const { character: c3 } = saveManager.createCharacter({ accountId: a2.account.id, name: 'Lyra', classId: 'ARCANIST', mode: GAME_MODES.CLASSIC });
    db.prepare('UPDATE characters SET level = 14, highest_floor = 8 WHERE id = ?').run(c3.id);
  }

  if (a3.account) {
    const { character: c4 } = saveManager.createCharacter({ accountId: a3.account.id, name: 'Vexia', classId: 'SHADOW', mode: GAME_MODES.HARDCORE });
    db.prepare('UPDATE characters SET level = 5, highest_floor = 3 WHERE id = ?').run(c4.id);
  }

  console.log('[DemoSeeder] Seeded dummy accounts (kael_test, lyra_test, vex_test) and characters.');
}

function makeMockSocket(id) {
  return { id, readyState: 0, send: () => {} };
}

export function seedDemoLobbies(rooms, GameRoom) {
  const specs = [
    { id: 'CLASSIC_crypt_01', name: 'crypt_01', mode: GAME_MODES.CLASSIC, isPublic: true, floor: 1, bots: [{ name: 'Kaelen', cls: 'VANGUARD' }] },
    { id: 'CLASSIC_obsidian_vault', name: 'obsidian_vault', mode: GAME_MODES.CLASSIC, isPublic: true, floor: 3, bots: [{ name: 'Lyra', cls: 'ARCANIST' }, { name: 'Aldric', cls: 'SHADOW' }] },
    { id: 'HARDCORE_iron_gauntlet', name: 'iron_gauntlet', mode: GAME_MODES.HARDCORE, isPublic: true, floor: 2, bots: [{ name: 'Vexia', cls: 'SHADOW' }] },
    { id: 'CLASSIC_secret_sanctum', name: 'secret_sanctum', mode: GAME_MODES.CLASSIC, isPublic: false, floor: 1, bots: [{ name: 'Kaelen', cls: 'VANGUARD' }] }
  ];

  let mockId = -1;
  for (const s of specs) {
    if (rooms.has(s.id)) continue;
    const room = new GameRoom(s.id, s.mode, 0, {
      displayName: s.name,
      isPublic: s.isPublic,
      maxPlayers: 4
    });
    room.floor = s.floor;
    for (const b of s.bots) {
      room.addPlayer(makeMockSocket(mockId--), b.name, b.cls);
    }
    rooms.set(s.id, room);
  }
  console.log('[DemoSeeder] Spawned live demo lobbies (Classic: crypt_01, obsidian_vault | Hardcore: iron_gauntlet | Private Invite: DEMO99)');
}
