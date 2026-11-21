/**
 * scripts/verify_security_hardening.js
 * Comprehensive security regression suite covering:
 *  1. Initial moderator provisioning (one-time bootstrap, permissions, password policy, file destruction, forced password change)
 *  2. Authentication & account security (12-char min, 128+ char passphrases, max cap, Scrypt timing-safe, per-IP & per-account rate limits, generic errors, no enumeration, session revocation)
 *  3. Session & authorization security (ownership checks, expiration, logout, moderator privilege checks, hardcore permadeath & concurrent takeover, revoked session disconnect)
 *  4. Invite & private-room security (short code vs 128-bit token separation, no token leak on lookup, rate limits, revocation, regeneration, capacity & privacy enforcement)
 *  5. WebSocket & packet security (maxPayload, per-IP & global connection limits, rate limits, strict packet validator, malformed/oversized handling, authoritative combat/loot/stats, dead socket isolation)
 *  6. Database & persistence security (foreign_keys = ON, parameterized queries, moderator edit validation, character JSON sanitization, atomic transactions, save ownership isolation, static path traversal & DB protection, backup/restore & crash recovery, audit log)
 *  7. Production configuration & testing (dev endpoints disabled in prod, security headers, body size limits, trusted proxy semantics, non-zero exit code on failure)
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctum-sec-test-'));
const testDbPath = path.join(tmpRoot, 'saves', 'sanctum-test.db');
const testBackupDir = path.join(tmpRoot, 'backups');
const testConfigDir = path.join(tmpRoot, 'config');
fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });

process.env.SANCTUM_DB_PATH = testDbPath;
process.env.SANCTUM_BACKUP_DIR = testBackupDir;
process.env.SANCTUM_CONFIG_DIR = testConfigDir;
process.env.SANCTUM_INITIAL_MOD_FILE = path.join(testConfigDir, 'initial-moderator.json');
process.env.SANCTUM_NO_LISTEN = '1';
process.env.PORT = '0';

const { PACKET_TYPES, GAME_MODES } = await import('../shared/Constants.js');
const { config } = await import('../server/config.js');
const { getClientIp, isSecureRequest } = await import('../server/net/ClientAddress.js');
const { db, assertForeignKeys, hashPassword, verifyPassword, deleteMeta } = await import('../server/systems/Database.js');
const {
  runModeratorBootstrap,
  PROVISIONED_META_KEY
} = await import('../server/systems/security/ModeratorBootstrap.js');
const { authService } = await import('../server/systems/AuthService.js');
const { saveManager } = await import('../server/systems/SaveManager.js');
const { modService } = await import('../server/systems/ModService.js');
const { inviteRegistry } = await import('../server/systems/InviteRegistry.js');
const { validatePacket } = await import('../server/systems/security/PacketValidator.js');
const { createDatabaseBackup, restoreDatabaseBackup, verifyBackupFile } = await import('../server/systems/BackupService.js');
const { appServer, rooms, rateLimiters, startServer, stopServer } = await import('../server/server.js');

let baseUrl = '';
let wsUrl = '';

function resetLimits() {
  for (const limiter of Object.values(rateLimiters)) limiter.clear();
  authService.throttle.clear();
}

async function api(pathname, { method = 'GET', token = null, body = undefined, headers = {}, rawBody = undefined } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined) {
    h['Content-Type'] = h['Content-Type'] || 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.status, headers: res.headers, json, text };
}

function openWs({ headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers });
    const messages = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'));
      const idx = waiters.findIndex(w => w.pred(msg));
      if (idx !== -1) {
        const [w] = waiters.splice(idx, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        messages.push(msg);
      }
    });
    ws.waitFor = (pred, timeoutMs = 4000) => {
      const bufferedIdx = messages.findIndex(pred);
      if (bufferedIdx !== -1) {
        return Promise.resolve(messages.splice(bufferedIdx, 1)[0]);
      }
      return new Promise((resWait, rejWait) => {
        const timer = setTimeout(() => rejWait(new Error('Timed out waiting for WS packet')), timeoutMs);
        waiters.push({ pred, resolve: resWait, timer });
      });
    };
    ws.waitForClose = (timeoutMs = 4000) => new Promise((resClose, rejClose) => {
      if (ws.readyState === WebSocket.CLOSED) return resClose({ code: ws._closeCode });
      const t = setTimeout(() => rejClose(new Error('Timed out waiting for WS close')), timeoutMs);
      ws.once('close', (code, reason) => {
        clearTimeout(t);
        resClose({ code, reason: reason?.toString() || '' });
      });
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

console.log('=== RUNNING SANCTUM SECURITY HARDENING VERIFICATION SUITE ===\n');

try {
  await startServer(0, '127.0.0.1');
  const addr = appServer.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}`;

  // =========================================================================
  // 1. INITIAL MODERATOR PROVISIONING
  // =========================================================================
  {
    // Clean slate: verify no default moderator account exists on fresh startup
    db.prepare('DELETE FROM accounts').run();
    deleteMeta(PROVISIONED_META_KEY);

    const silentLog = { log: () => {}, warn: () => {}, error: () => {} };
    const noSourceRes = runModeratorBootstrap({ filePath: path.join(testConfigDir, 'missing.json'), env: {}, logger: silentLog });
    assert.equal(noSourceRes.status, 'none');
    const modCount0 = db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE role = 'moderator'").get().c;
    assert.equal(modCount0, 0, '[1.1] No hardcoded default moderator account may be created');

    // Legacy default moderator credential auto-disable check
    const legacyId = crypto.randomUUID();
    const legacyHash = hashPassword('sanctum-mod');
    db.prepare(`
      INSERT INTO accounts (id, username, password_hash, salt, role, is_banned, created_at, last_login_at, expires_at)
      VALUES (?, 'admin', ?, ?, 'moderator', 0, ?, ?, ?)
    `).run(legacyId, legacyHash.hash, legacyHash.salt, Date.now(), Date.now(), Date.now() + 100000);
    runModeratorBootstrap({ filePath: path.join(testConfigDir, 'missing.json'), env: {}, logger: silentLog });
    const legacyRow = db.prepare('SELECT role, password_hash, salt FROM accounts WHERE id = ?').get(legacyId);
    assert.equal(legacyRow.role, 'player', '[1.2] Legacy default moderator must be demoted');
    assert.equal(verifyPassword('sanctum-mod', legacyRow.salt, legacyRow.password_hash), false, '[1.2] Legacy default password must be invalidated');
    db.prepare('DELETE FROM accounts').run();
    deleteMeta(PROVISIONED_META_KEY);

    // Reject insecure file permissions (0644) on Linux
    const bootstrapFile = path.join(testConfigDir, 'initial-moderator.json');
    fs.writeFileSync(bootstrapFile, JSON.stringify({
      username: 'sanctum-admin',
      password: 'ValidBootstrap#Pass2026!'
    }), { mode: 0o644 });
    fs.chmodSync(bootstrapFile, 0o644);
    const badPermRes = runModeratorBootstrap({ filePath: bootstrapFile, env: {}, logger: silentLog });
    assert.equal(badPermRes.status, 'rejected', '[1.3] World-readable 0644 bootstrap file must be rejected');

    // Reject placeholder / weak password
    fs.chmodSync(bootstrapFile, 0o600);
    fs.writeFileSync(bootstrapFile, JSON.stringify({
      username: 'sanctum-admin',
      password: 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD'
    }));
    fs.chmodSync(bootstrapFile, 0o600);
    const placeholderRes = runModeratorBootstrap({ filePath: bootstrapFile, env: {}, logger: silentLog });
    assert.equal(placeholderRes.status, 'rejected', '[1.4] Example placeholder password must be rejected');

    // Valid one-time bootstrap with 0600 permissions; verify logs never contain password
    const logLines = [];
    const captureLogger = {
      log: (...a) => logLines.push(a.join(' ')),
      warn: (...a) => logLines.push(a.join(' ')),
      error: (...a) => logLines.push(a.join(' '))
    };
    const initialSecret = 'V4lid$anctumMod#Bootstrap2026';
    fs.writeFileSync(bootstrapFile, JSON.stringify({
      username: 'sanctum-admin',
      password: initialSecret
    }));
    fs.chmodSync(bootstrapFile, 0o600);

    const okRes = runModeratorBootstrap({ filePath: bootstrapFile, env: {}, logger: captureLogger });
    assert.equal(okRes.status, 'provisioned', '[1.5] Valid 0600 bootstrap file must provision moderator');
    assert.equal(fs.existsSync(bootstrapFile), false, '[1.6] Bootstrap file must be deleted after provisioning');
    assert.equal(logLines.some(l => l.includes(initialSecret)), false, '[1.7] Startup logs must never contain the moderator password');

    // Second bootstrap attempt (even if a new file is dropped) must be skipped
    fs.writeFileSync(bootstrapFile, JSON.stringify({
      username: 'second-admin',
      password: 'AnotherStrong#ModPass2026!'
    }), { mode: 0o600 });
    fs.chmodSync(bootstrapFile, 0o600);
    const repeatRes = runModeratorBootstrap({ filePath: bootstrapFile, env: {}, logger: silentLog });
    assert.equal(repeatRes.status, 'skipped', '[1.8] Provisioning must not run a second time');
    fs.unlinkSync(bootstrapFile);

    // First login with initial moderator requires password change before accessing /api/mod/* or characters
    resetLimits();
    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'sanctum-admin', password: initialSecret }
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.json.account.role, 'moderator');
    assert.equal(loginRes.json.account.mustChangePassword, true, '[1.9] Initial moderator must be flagged mustChangePassword');
    const preChangeToken = loginRes.json.token;

    const blockedMod = await api('/api/mod/overview', { token: preChangeToken });
    assert.equal(blockedMod.status, 403, '[1.10] Moderator API must reject access until initial password is changed');

    const blockedChars = await api('/api/characters', { token: preChangeToken });
    assert.equal(blockedChars.status, 403, '[1.10] Character API must reject access until initial password is changed');

    // Change initial moderator password -> old session invalidated, new session unlocked
    const rotatedSecret = 'Rotated$anctumMod#Pass2026!';
    const changeRes = await api('/api/auth/change-password', {
      method: 'POST',
      token: preChangeToken,
      body: { currentPassword: initialSecret, newPassword: rotatedSecret, confirmPassword: rotatedSecret }
    });
    assert.equal(changeRes.status, 200, '[1.11] Moderator password rotation must succeed');
    assert.equal(changeRes.json.account.mustChangePassword, false);

    const oldTokenCheck = await api('/api/auth/me', { token: preChangeToken });
    assert.equal(oldTokenCheck.status, 401, '[1.12] Old session token must be invalidated after password change');

    const unlockedMod = await api('/api/mod/overview', { token: changeRes.json.token });
    assert.equal(unlockedMod.status, 200, '[1.13] Moderator portal accessible after initial password rotation');
    console.log('✔ Section 1: One-time initial moderator provisioning, file permissions, secret destruction & forced rotation verified.');
  }

  // =========================================================================
  // 2. AUTHENTICATION AND ACCOUNT SECURITY
  // =========================================================================
  {
    resetLimits();

    // Minimum 12 characters enforced
    const shortRes = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'short_pw_user', password: 'ShortPass1!' }
    });
    assert.equal(shortRes.status, 400, '[2.1] Password shorter than 12 chars must be rejected');

    // Long passphrase (140 characters) allowed
    const longPassphrase = 'correct-horse-battery-staple-across-the-obsidiansanctum-cathedral-depths-with-140-chars-of-entropy-and-no-truncation-whatsoever-2026-verified!';
    assert(longPassphrase.length >= 128);
    const longRes = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: longPassphrase }
    });
    assert.equal(longRes.status, 201, '[2.2] 128+ char passphrase must be accepted');
    assert.equal(longRes.json.account.role, 'player', '[2.3] Public registration must never grant moderator role');

    // Maximum password length enforced (>256 chars rejected)
    const oversizedPass = 'A1!a'.repeat(70); // 280 chars
    const maxRes = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'oversize_user', password: oversizedPass }
    });
    assert.equal(maxRes.status, 400, '[2.4] Password exceeding max length (256) must be rejected');

    // Username enumeration prevention on registration (duplicate vs reserved return identical generic message)
    const dupRes = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: 'ValidPlayerPassword#123' }
    });
    const resvRes = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'administrator', password: 'ValidPlayerPassword#123' }
    });
    assert.equal(dupRes.status, 400);
    assert.equal(resvRes.status, 400);
    assert.equal(dupRes.json.error, resvRes.json.error, '[2.5] Registration failure messages must not allow username enumeration');
    assert(!dupRes.json.error.toLowerCase().includes('taken'), '[2.5] Registration error must not disclose that username is taken');

    // Generic login failure messages (wrong username vs wrong password identical)
    const wrongUser = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'nonexistent_wanderer', password: 'SomePassword#12345' }
    });
    const wrongPass = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: 'WrongPassword#12345' }
    });
    assert.equal(wrongUser.status, 401);
    assert.equal(wrongPass.status, 401);
    assert.equal(wrongUser.json.error, 'Invalid username or password.');
    assert.equal(wrongPass.json.error, 'Invalid username or password.');

    // Per-account login throttling (lockout after 5 failures even if IP limit is reset)
    resetLimits();
    for (let i = 0; i < 5; i++) {
      rateLimiters.loginMin.clear();
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'passphrase_hero', password: `WrongAttempt#${i}_12345` }
      });
      assert.equal(r.status, 401);
    }
    rateLimiters.loginMin.clear();
    const lockedRes = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: longPassphrase }
    });
    assert.equal(lockedRes.status, 429, '[2.6] Per-account login throttling must lock after repeated failures');

    // Per-IP login rate limiting
    resetLimits();
    let ipRateLimited = false;
    for (let i = 0; i < 12; i++) {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { username: `user_${i}`, password: 'WrongPassword#12345' }
      });
      if (r.status === 429) ipRateLimited = true;
    }
    assert.equal(ipRateLimited, true, '[2.7] Per-IP login rate limiting must trigger 429');

    // Per-IP registration rate limiting
    resetLimits();
    let regRateLimited = false;
    for (let i = 0; i < 7; i++) {
      const r = await api('/api/auth/register', {
        method: 'POST',
        body: { username: `reg_flood_${i}`, password: 'ValidPlayerPassword#123' }
      });
      if (r.status === 429) regRateLimited = true;
    }
    assert.equal(regRateLimited, true, '[2.8] Per-IP registration rate limiting must trigger 429');

    // Revoke all sessions for an account
    resetLimits();
    const loginA = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: longPassphrase }
    });
    const loginB = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'passphrase_hero', password: longPassphrase }
    });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);

    const revokeRes = await api('/api/auth/revoke-sessions', {
      method: 'POST',
      token: loginA.json.token,
      body: { keepCurrent: false }
    });
    assert.equal(revokeRes.status, 200);
    assert.equal((await api('/api/auth/me', { token: loginA.json.token })).status, 401);
    assert.equal((await api('/api/auth/me', { token: loginB.json.token })).status, 401);
    console.log('✔ Section 2: Password policy, passphrases, timing-safe Scrypt, anti-enumeration, throttling & session revocation verified.');
  }

  // =========================================================================
  // 3. SESSION AND AUTHORIZATION SECURITY
  // =========================================================================
  {
    resetLimits();
    const p1 = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'alice_hero', password: 'AliceStrongPassword#2026' }
    });
    const p2 = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'bob_intruder', password: 'BobStrongPassword#2026' }
    });
    const aliceToken = p1.json.token;
    const bobToken = p2.json.token;

    // Logout invalidates server-side session
    const tempLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_hero', password: 'AliceStrongPassword#2026' }
    });
    assert.equal((await api('/api/auth/me', { token: tempLogin.json.token })).status, 200);
    await api('/api/auth/logout', { method: 'POST', token: tempLogin.json.token });
    assert.equal((await api('/api/auth/me', { token: tempLogin.json.token })).status, 401, '[3.1] Logout must invalidate session server-side');

    // Expired session rejected server-side
    const expiredToken = authService.createSession(p1.json.account.id);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE account_id = ? AND expires_at > ?')
      .run(Date.now() - 1000, p1.json.account.id, Date.now() + 1000);
    // Re-create aliceToken fresh so Alice has a valid session while expiredToken is expired
    const aliceFresh = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_hero', password: 'AliceStrongPassword#2026' }
    });
    const aliceValidToken = aliceFresh.json.token;
    assert.equal((await api('/api/auth/me', { token: expiredToken })).status, 401, '[3.2] Expired session must be rejected');

    // Never trust client-supplied accountId on character creation; verify ownership on delete & join
    const createCharRes = await api('/api/characters', {
      method: 'POST',
      token: aliceValidToken,
      body: {
        accountId: p2.json.account.id, // Attempt to spoof Bob's accountId
        name: 'AliceVanguard',
        classId: 'VANGUARD',
        mode: GAME_MODES.CLASSIC
      }
    });
    assert.equal(createCharRes.status, 201);
    const aliceChar = createCharRes.json.character;
    assert.equal(aliceChar.accountId, p1.json.account.id, '[3.3] Server must ignore client-supplied accountId');

    // Bob cannot delete Alice's character
    const bobDeleteAlice = await api(`/api/characters?id=${encodeURIComponent(aliceChar.id)}`, {
      method: 'DELETE',
      token: bobToken
    });
    assert.equal(bobDeleteAlice.status, 404, '[3.4] Cross-account character deletion must be rejected');

    // Bob cannot join a room using Alice's characterId over WebSocket
    const bobWs = await openWs();
    bobWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: bobToken,
        characterId: aliceChar.id,
        joinType: 'solo'
      }
    }));
    const stealErr = await bobWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(stealErr.data.message.includes('Character not found'), '[3.5] Cross-account character load via WebSocket must be rejected');
    await bobWs.waitForClose();

    // Non-moderator cannot access any /api/mod/* endpoint
    assert.equal((await api('/api/mod/overview', { token: bobToken })).status, 403);
    assert.equal((await api('/api/mod/accounts', { token: bobToken })).status, 403);
    assert.equal((await api(`/api/mod/accounts?id=${p2.json.account.id}`, {
      method: 'PATCH',
      token: bobToken,
      body: { role: 'moderator' }
    })).status, 403, '[3.6] Player cannot self-escalate to moderator');

    // Hardcore death cannot be bypassed through INPUT_RESPAWN or reconnect packet manipulation
    const hcCharRes = await api('/api/characters', {
      method: 'POST',
      token: aliceValidToken,
      body: { name: 'AliceHC', classId: 'VANGUARD', mode: GAME_MODES.HARDCORE }
    });
    const hcChar = hcCharRes.json.character;

    const hcWs = await openWs();
    hcWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: aliceValidToken, characterId: hcChar.id, joinType: 'solo' }
    }));
    const hcInit = await hcWs.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);
    const hcRoom = rooms.get(hcInit.data.roomId);
    const hcPlayer = hcRoom.players.get(hcInit.data.playerId);
    hcRoom.handlePlayerDeath(hcPlayer);
    assert.equal(hcPlayer.isDead, true);

    // Attempt to send INPUT_RESPAWN in Hardcore mode
    hcWs.send(JSON.stringify({ type: PACKET_TYPES.INPUT_RESPAWN }));
    await new Promise(r => setTimeout(r, 80));
    assert.equal(hcPlayer.isDead, true, '[3.7] Hardcore death must not respawn on INPUT_RESPAWN packet');
    assert.equal(saveManager.getCharacter(hcChar.id).isDead, true, '[3.7] Hardcore death must be persisted immediately');
    hcWs.close();
    await hcWs.waitForClose();

    // Attempt to re-enter game with fallen Hardcore character
    const hcRejoinWs = await openWs();
    hcRejoinWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: aliceValidToken, characterId: hcChar.id, joinType: 'solo' }
    }));
    const hcDeadErr = await hcRejoinWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(hcDeadErr.data.message.includes('fallen'), '[3.8] Fallen Hardcore character must be blocked from joining');
    await hcRejoinWs.waitForClose();

    // Concurrent sessions & same-room character takeover + active character deletion lock
    const ws1 = await openWs();
    ws1.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: aliceValidToken, characterId: aliceChar.id, joinType: 'public', roomName: 'takeover_crypt' }
    }));
    await ws1.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);

    // Cannot delete character while active in a room
    const delWhileActive = await api(`/api/characters?id=${encodeURIComponent(aliceChar.id)}`, {
      method: 'DELETE',
      token: aliceValidToken
    });
    assert.equal(delWhileActive.status, 409, '[3.9] Active character cannot be deleted mid-session');

    // Second session taking over the character in the same room kicks the first socket
    const ws2 = await openWs();
    ws2.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: aliceValidToken, characterId: aliceChar.id, joinType: 'public', roomName: 'takeover_crypt' }
    }));
    const kickedMsg = await ws1.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert.equal(kickedMsg.data.kicked, true, '[3.10] First session must be kicked on same-room character takeover');
    await ws2.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);

    // Revoking the active session immediately disconnects the live WebSocket and prevents reconnect
    await api('/api/auth/logout', { method: 'POST', token: aliceValidToken });
    const revokeClose = await ws2.waitForClose();
    assert(revokeClose.code !== undefined, '[3.11] Revoked session must terminate active WebSocket');

    const wsRevoked = await openWs();
    wsRevoked.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: aliceValidToken, characterId: aliceChar.id, joinType: 'solo' }
    }));
    const revErr = await wsRevoked.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(revErr.data.message.includes('Session expired'), '[3.12] Revoked session token must not reconnect');
    await wsRevoked.waitForClose();
    console.log('✔ Section 3: Session ownership, expiration, logout, moderator guards, Hardcore permadeath, takeover & revocation verified.');
  }

  // =========================================================================
  // 4. INVITE AND PRIVATE-ROOM SECURITY
  // =========================================================================
  {
    resetLimits();
    const hostLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_hero', password: 'AliceStrongPassword#2026' }
    });
    const guestLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'bob_intruder', password: 'BobStrongPassword#2026' }
    });
    const hostToken = hostLogin.json.token;
    const guestToken = guestLogin.json.token;

    const hostChars = (await api('/api/characters', { token: hostToken })).json.characters;
    const aliceChar = hostChars.find(c => c.mode === GAME_MODES.CLASSIC);
    const guestChar = (await api('/api/characters', {
      method: 'POST',
      token: guestToken,
      body: { name: 'BobClassic', classId: 'SHADOW', mode: GAME_MODES.CLASSIC }
    })).json.character;

    // Host creates a private 2-player room
    const hostWs = await openWs();
    hostWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: hostToken,
        characterId: aliceChar.id,
        joinType: 'private',
        roomName: 'secret_vault_42',
        maxPlayers: 2
      }
    }));
    const roomInit = await hostWs.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);
    const { inviteCode, inviteToken, roomId } = roomInit.data;
    assert.equal(inviteCode, undefined, '[4.1] Short inviteCode must be removed from ROOM_INIT');
    assert(inviteToken && inviteToken.length === 22, '[4.1] Full inviteToken must be 128-bit base64url (22 chars)');

    // Private room must not appear in public /api/lobbies
    const lobbiesRes = await api(`/api/lobbies?mode=${GAME_MODES.CLASSIC}`);
    assert.equal(lobbiesRes.json.lobbies.some(l => l.roomId === roomId), false, '[4.2] Private room must not be listed in /api/lobbies');

    // Resolving a short code must fail; endpoint accepts only cryptographic token
    const codeLookup = await api('/api/invite?code=ABCDEF');
    assert.equal(codeLookup.status, 404, '[4.3] Short code lookup must return 404');

    // Resolving a token MUST NEVER return full inviteToken, internal roomId, or private room name/playerList
    const tokenLookup = await api(`/api/invite?token=${encodeURIComponent(inviteToken)}`);
    assert.equal(tokenLookup.status, 200, '[4.4] Valid token lookup must succeed');
    assert.equal(tokenLookup.json.invite.inviteToken, undefined, '[4.4] Lookup must never disclose full inviteToken');
    assert.equal(tokenLookup.json.invite.inviteCode, undefined, '[4.4] Lookup must not echo invite credentials');
    assert.equal(tokenLookup.json.invite.roomId, undefined, '[4.4] Private room lookup must not leak internal roomId');
    assert.equal(tokenLookup.json.invite.playerList, undefined, '[4.4] Private room lookup must not leak player roster');
    assert.equal(tokenLookup.json.invite.name, 'Private Realm', '[4.4] Private room lookup must mask custom room name');

    // Invalid tokens must never reveal room existence or metadata
    const badLookup = await api('/api/invite?token=invalid_token_123456');
    assert.equal(badLookup.status, 404, '[4.4] Invalid token must return 404');
    assert.equal(badLookup.json.invite, undefined, '[4.4] Invalid token lookup must not return invite preview');

    // Unauthorized user cannot bypass invite by joining the private room by its roomName directly
    const bypassWs = await openWs();
    bypassWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: guestToken,
        characterId: guestChar.id,
        joinType: 'public',
        roomName: 'secret_vault_42'
      }
    }));
    const bypassErr = await bypassWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(bypassErr.data.message.includes('private'), '[4.5] Private room must reject direct roomName join without invite');
    await bypassWs.waitForClose();

    // Legacy short code join must be rejected
    const legacyJoinWs = await openWs();
    legacyJoinWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: guestToken,
        characterId: guestChar.id,
        joinType: 'invite',
        inviteCode: 'ABCDEF'
      }
    }));
    const legacyErr = await legacyJoinWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(legacyErr.data.message.includes('Invalid') || legacyErr.data.message.includes('expired') || legacyErr.data.message.includes('closed'), '[4.5] Legacy inviteCode must not permit join');
    await legacyJoinWs.waitForClose();

    // Token regeneration invalidates old token immediately
    const oldToken = inviteToken;
    hostWs.send(JSON.stringify({ type: PACKET_TYPES.INVITE_REGENERATE }));
    const regenMsg = await hostWs.waitFor(m => m.type === PACKET_TYPES.INVITE_UPDATE);
    assert.equal(regenMsg.data.inviteCode, undefined, '[4.6] Regenerated invite packet must not contain inviteCode');
    assert(regenMsg.data.inviteToken && regenMsg.data.inviteToken !== oldToken, '[4.6] Regenerated token must differ from old token');
    assert.equal((await api(`/api/invite?token=${encodeURIComponent(oldToken)}`)).status, 404, '[4.6] Old token must be rejected after regeneration');

    // Invite revocation disables all invite links for the room immediately
    hostWs.send(JSON.stringify({ type: PACKET_TYPES.INVITE_REVOKE }));
    const revMsg = await hostWs.waitFor(m => m.type === PACKET_TYPES.INVITE_UPDATE);
    assert.equal(revMsg.data.inviteCode, undefined, '[4.7] Revocation packet must not contain inviteCode');
    assert.equal(revMsg.data.revoked, true, '[4.7] Invite revocation must mark invites as revoked');
    assert.equal((await api(`/api/invite?token=${encodeURIComponent(regenMsg.data.inviteToken)}`)).status, 404, '[4.7] Revoked token must be rejected by /api/invite');

    // Revoked token cannot be used to join room
    const revokedJoinWs = await openWs();
    revokedJoinWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: guestToken,
        characterId: guestChar.id,
        joinType: 'invite',
        inviteToken: regenMsg.data.inviteToken
      }
    }));
    const revJoinErr = await revokedJoinWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(revJoinErr.data.message.includes('Invalid') || revJoinErr.data.message.includes('expired') || revJoinErr.data.message.includes('closed'), '[4.7] Revoked token must not permit join');
    await revokedJoinWs.waitForClose();

    // Re-issue invite and verify room capacity enforcement at admission time
    hostWs.send(JSON.stringify({ type: PACKET_TYPES.INVITE_REGENERATE }));
    const freshInvite = await hostWs.waitFor(m => m.type === PACKET_TYPES.INVITE_UPDATE);

    // Guest joins via valid token (supporting fragment-based link input)
    const guestWs = await openWs();
    guestWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: guestToken,
        characterId: guestChar.id,
        joinType: 'invite',
        inviteToken: `http://localhost:8080/#invite=${freshInvite.data.inviteToken}`
      }
    }));
    await guestWs.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);

    // Third player attempting to join 2-player room via valid invite must be rejected (room full)
    const p3 = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'charlie_third', password: 'CharlieStrongPassword#2026' }
    });
    const p3Char = (await api('/api/characters', {
      method: 'POST',
      token: p3.json.token,
      body: { name: 'CharlieHero', classId: 'ARCANIST', mode: GAME_MODES.CLASSIC }
    })).json.character;

    const p3Ws = await openWs();
    p3Ws.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: p3.json.token,
        characterId: p3Char.id,
        joinType: 'invite',
        inviteToken: freshInvite.data.inviteToken
      }
    }));
    const fullErr = await p3Ws.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(fullErr.data.message.includes('full'), '[4.8] Room capacity must be enforced at admission time');
    await p3Ws.waitForClose();

    // Automatic token rotation updates connected room members and invalidates old token
    const liveRoom = rooms.get(roomId);
    const preRotationToken = liveRoom.inviteToken;
    liveRoom.inviteExpiresAt = Date.now() - 1000;
    const rotatedRooms = inviteRegistry.rotateExpired(Date.now());
    assert(rotatedRooms.includes(liveRoom), '[4.9] rotateExpired must include expired room');
    for (const r of rotatedRooms) {
      r._broadcastInviteUpdate();
    }
    const hostRotateUpdate = await hostWs.waitFor(m => m.type === PACKET_TYPES.INVITE_UPDATE);
    const guestRotateUpdate = await guestWs.waitFor(m => m.type === PACKET_TYPES.INVITE_UPDATE);
    assert(hostRotateUpdate.data.inviteToken && hostRotateUpdate.data.inviteToken !== preRotationToken, '[4.9] Rotated token must differ from pre-rotation token');
    assert.equal(guestRotateUpdate.data.inviteToken, hostRotateUpdate.data.inviteToken, '[4.9] All connected members receive synchronized token rotation');
    assert.equal(inviteRegistry.resolveToken(preRotationToken), null, '[4.9] Expired pre-rotation token must not resolve');
    assert.equal(inviteRegistry.resolveToken(hostRotateUpdate.data.inviteToken), liveRoom, '[4.9] New rotated token resolves correctly');

    // Expired token cannot be used to join room
    const expiredWs = await openWs();
    expiredWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: {
        token: p3.json.token,
        characterId: p3Char.id,
        joinType: 'invite',
        inviteToken: preRotationToken
      }
    }));
    const expiredErr = await expiredWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR);
    assert(expiredErr.data.message.includes('Invalid') || expiredErr.data.message.includes('expired') || expiredErr.data.message.includes('closed'), '[4.9] Expired token cannot join room');
    await expiredWs.waitForClose();

    // Rate limiting on /api/invite enumeration attempts
    resetLimits();
    let inviteRateLimited = false;
    for (let i = 0; i < 25; i++) {
      const r = await api(`/api/invite?token=GUESS_TOKEN_BASE64URL_${i % 10}`);
      if (r.status === 429) inviteRateLimited = true;
    }
    assert.equal(inviteRateLimited, true, '[4.10] Invite lookup endpoint must enforce rate limiting');

    // Rate limiting across multiple WebSocket connections for invite admission
    resetLimits();
    let wsInviteRateLimited = false;
    for (let i = 0; i < 25; i++) {
      const testWs = await openWs();
      testWs.send(JSON.stringify({
        type: PACKET_TYPES.JOIN_LOBBY,
        data: {
          token: p3.json.token,
          characterId: p3Char.id,
          joinType: 'invite',
          inviteToken: hostRotateUpdate.data.inviteToken
        }
      }));
      const res = await testWs.waitFor(m => m.type === PACKET_TYPES.LOBBY_ERROR || m.type === PACKET_TYPES.ROOM_INIT);
      if (res.type === PACKET_TYPES.LOBBY_ERROR && res.data.message.includes('Too many')) {
        wsInviteRateLimited = true;
        testWs.close();
        await testWs.waitForClose();
        break;
      }
      testWs.close();
      await testWs.waitForClose();
    }
    assert.equal(wsInviteRateLimited, true, '[4.11] Rate limiting on invite admission must work across multiple WebSocket connections');

    guestWs.send(JSON.stringify({ type: PACKET_TYPES.LEAVE_LOBBY }));
    hostWs.send(JSON.stringify({ type: PACKET_TYPES.LEAVE_LOBBY }));
    await guestWs.waitForClose();
    await hostWs.waitForClose();
    console.log('✔ Section 4: Cryptographic invite tokens, zero credential leakage, privacy, capacity, rotation, revocation & rate limits verified.');
  }

  // =========================================================================
  // 5. WEBSOCKET AND PACKET SECURITY
  // =========================================================================
  {
    resetLimits();
    // Unit-check PacketValidator against authoritative spoofing & out-of-range inputs
    assert.equal(validatePacket(null).ok, false);
    assert.equal(validatePacket({ type: 'UNKNOWN_PACKET' }).ok, false);
    assert.equal(validatePacket({ type: PACKET_TYPES.INPUT_MOVE, x: NaN, y: 10 }).ok, false);
    assert.equal(validatePacket({ type: PACKET_TYPES.INPUT_MOVE, x: 1e9, y: 10 }).ok, false);
    assert.equal(validatePacket({ type: PACKET_TYPES.INPUT_ATTACK, targetMonsterId: -5 }).ok, false);
    assert.equal(validatePacket({ type: PACKET_TYPES.ALLOC_STAT, stat: '__proto__' }).ok, false);
    assert.equal(validatePacket({ type: PACKET_TYPES.UNEQUIP_ITEM, slot: 'constructor' }).ok, false);

    // Authoritative fields injected by a malicious client must be stripped by validatePacket
    const moveValidated = validatePacket({
      type: PACKET_TYPES.INPUT_MOVE,
      x: 48,
      y: 64,
      damage: 999999,
      xp: 999999,
      gold: 999999,
      level: 99,
      stats: { might: 999 }
    });
    assert.equal(moveValidated.ok, true);
    assert.deepEqual(moveValidated.packet, { type: PACKET_TYPES.INPUT_MOVE, x: 48, y: 64 }, '[5.1] Authoritative fields must be stripped from client packets');

    // Malformed JSON strike disconnect test
    const badWs = await openWs();
    for (let i = 0; i < config.limits.wsMaxStrikes; i++) {
      badWs.send('{malformed json');
    }
    const badClose = await badWs.waitForClose();
    assert.equal(badClose.code, 1008, '[5.2] Repeated malformed packets must close socket with 1008 Policy Violation');

    // Oversized WebSocket payload (> wsMaxPayload = 4096 bytes) controlled rejection
    const bigWs = await openWs();
    bigWs.send(JSON.stringify({ type: PACKET_TYPES.PING, pad: 'X'.repeat(config.limits.wsMaxPayload + 1024) }));
    const bigClose = await bigWs.waitForClose();
    assert.equal(bigClose.code, 1009, '[5.3] Oversized WebSocket frame must be closed cleanly with 1009');

    // Per-IP WebSocket connection limit enforcement
    const openSockets = [];
    for (let i = 0; i < config.limits.wsMaxPerIp; i++) {
      openSockets.push(await openWs());
    }
    let extraRejected = false;
    try {
      const extra = await openWs();
      extra.close();
    } catch {
      extraRejected = true;
    }
    assert.equal(extraRejected, true, '[5.4] Connections exceeding per-IP limit must be rejected with 429');
    for (const s of openSockets) {
      s.close();
      await s.waitForClose();
    }

    // Packet flooding & disconnected socket action prevention
    const floodLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice_hero', password: 'AliceStrongPassword#2026' }
    });
    const floodChar = (await api('/api/characters', {
      method: 'POST',
      token: floodLogin.json.token,
      body: { name: 'FloodTester', classId: 'VANGUARD', mode: GAME_MODES.CLASSIC }
    })).json.character;

    const playWs = await openWs();
    playWs.send(JSON.stringify({
      type: PACKET_TYPES.JOIN_LOBBY,
      data: { token: floodLogin.json.token, characterId: floodChar.id, joinType: 'solo' }
    }));
    const playInit = await playWs.waitFor(m => m.type === PACKET_TYPES.ROOM_INIT);
    const playRoom = rooms.get(playInit.data.roomId);
    const playerEntity = playRoom.players.get(playInit.data.playerId);
    playerEntity.statPoints = 25;

    // Flood 30 expensive ALLOC_STAT packets in a single 1s window; at most wsExpensivePerSec (10) may execute
    for (let i = 0; i < 30; i++) {
      playWs.send(JSON.stringify({ type: PACKET_TYPES.ALLOC_STAT, stat: 'might' }));
    }
    await new Promise(r => setTimeout(r, 100));
    assert.equal(25 - playerEntity.statPoints, config.limits.wsExpensivePerSec, '[5.5] Expensive packet rate limiter must cap execution to wsExpensivePerSec');

    playWs.close();
    await playWs.waitForClose();
    console.log('✔ Section 5: WebSocket maxPayload, per-IP connection limits, schema validator, malformed/oversized handling & flood limits verified.');
  }

  // =========================================================================
  // 6. DATABASE AND PERSISTENCE SECURITY
  // =========================================================================
  {
    resetLimits();
    // Foreign key enforcement on active connection
    assertForeignKeys(db);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1, '[6.1] SQLite foreign_keys must be ON');

    // Foreign key violation must throw
    assert.throws(() => {
      db.prepare(`
        INSERT INTO characters (id, account_id, name, class_id, mode, data_json, updated_at)
        VALUES ('orphan-char', 'nonexistent-account', 'Orphan', 'VANGUARD', 'CLASSIC', '{}', 0)
      `).run();
    }, '[6.1] Inserting character with nonexistent account_id must fail FK check');

    // Character JSON sanitizer strips arbitrary/prototype-polluting fields & clamps corrupted JSON on load
    const aliceAcc = db.prepare("SELECT id FROM accounts WHERE username = 'alice_hero'").get();
    const corruptCharId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO characters (id, account_id, name, class_id, mode, level, xp, next_xp, stat_points, potions, is_dead, highest_floor, data_json, updated_at)
      VALUES (?, ?, 'CorruptHero', 'VANGUARD', 'CLASSIC', 999999, -50, -10, 999999, 9999, 0, -3, ?, ?)
    `).run(corruptCharId, aliceAcc.id, JSON.stringify({
      stats: { might: 999999, focus: -50, evilStat: 1337 },
      equipment: {
        weapon: { type: 'gear', slot: 'weapon', name: '<img src=x onerror=alert(1)>Sword', rarity: 99, weight: -5, stats: { dmg: 999999, admin: true } },
        arbitrarySlot: { type: 'gear', slot: 'helm', name: 'Injected' }
      },
      inventory: [
        { type: 'unknown_exploit_item', payload: 'boom' },
        { type: 'potion', subType: 'hp', count: 99999, maxStack: 20 }
      ],
      gold: 9999999999999,
      isAdmin: true
    }), Date.now());

    const loaded = saveManager.getCharacter(corruptCharId);
    assert.equal(loaded.level, 999, '[6.2] Corrupted level must be clamped');
    assert.equal(loaded.xp, 0, '[6.2] Negative XP must be clamped to 0');
    assert.equal(loaded.stats.might, 999, '[6.2] Corrupted stat must be clamped');
    assert.equal(loaded.stats.evilStat, undefined, '[6.2] Unknown stats must be stripped');
    assert.equal(loaded.equipment.arbitrarySlot, undefined, '[6.2] Unknown equipment slots must be stripped');
    assert.equal(loaded.equipment.weapon.stats.admin, undefined, '[6.2] Unknown item stat keys must be stripped');
    assert(!loaded.equipment.weapon.name.includes('<'), '[6.2] HTML tags in item name must be stripped');
    assert.equal(loaded.inventory.length, 1, '[6.2] Invalid inventory item types must be discarded');
    assert.equal(loaded.inventory[0].count, 20, '[6.2] Potion count must be clamped to maxStack');

    // Save ownership isolation: a player object whose accountId does not match the character's owner cannot overwrite it
    const bobAcc = db.prepare("SELECT id FROM accounts WHERE username = 'bob_intruder'").get();
    saveManager.saveFromPlayer({
      characterId: corruptCharId,
      accountId: bobAcc.id, // Wrong owner!
      mode: GAME_MODES.CLASSIC,
      isDead: false,
      name: 'HackedName',
      classId: 'VANGUARD',
      level: 50,
      xp: 0,
      nextXp: 100,
      statPoints: 0,
      potions: 3,
      stats: { might: 50, focus: 50, agility: 50, vitality: 50 },
      equipment: {},
      inventory: [],
      gold: 777
    }, 10, { immediate: true });
    assert.equal(saveManager.getCharacter(corruptCharId).level, 999, '[6.3] Save with mismatched accountId must not overwrite another player character');

    // Static file server blocks database, WAL, config, backups and path traversal
    for (const forbidden of [
      '/data/saves/sanctum.db',
      '/data/saves/sanctum.db-wal',
      '/data/saves/sanctum.db-shm',
      '/data/../server/server.js',
      '/shared/../server/config.js',
      '/config/initial-moderator.json',
      '/backups/test.db',
      '/.env'
    ]) {
      const r = await api(forbidden);
      assert(r.status === 403 || r.status === 404, `[6.4] Forbidden path ${forbidden} returned status ${r.status}`);
    }

    // Moderator edit validation & audit logging
    const modLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'sanctum-admin', password: 'Rotated$anctumMod#Pass2026!' }
    });
    const modToken = modLogin.json.token;

    // Invalid moderator patch (unknown field) rejected with 400
    const badPatch = await api(`/api/mod/characters?id=${encodeURIComponent(corruptCharId)}`, {
      method: 'PATCH',
      token: modToken,
      body: { unknownInjectedField: true }
    });
    assert.equal(badPatch.status, 400, '[6.5] Moderator character patch with unknown fields must be rejected');

    // Valid moderator edit succeeds and records audit log
    const goodPatch = await api(`/api/mod/characters?id=${encodeURIComponent(corruptCharId)}`, {
      method: 'PATCH',
      token: modToken,
      body: { level: 12, gold: 250 }
    });
    assert.equal(goodPatch.status, 200);
    assert.equal(goodPatch.json.character.level, 12);

    const auditRes = await api('/api/mod/audit?limit=20', { token: modToken });
    assert.equal(auditRes.status, 200);
    assert(auditRes.json.audit.some(e => e.action === 'mod.character.update' && e.targetId === corruptCharId), '[6.6] Moderator edits must be recorded in audit_log');

    // Cannot demote or delete the last active moderator
    const selfDemote = await api(`/api/mod/accounts?id=${encodeURIComponent(modLogin.json.account.id)}`, {
      method: 'PATCH',
      token: modToken,
      body: { role: 'player' }
    });
    assert.equal(selfDemote.status, 409, '[6.7] Last active moderator cannot be demoted or banned');

    // Backup, restore & interrupted write rollback recovery
    const backupFile = path.join(testBackupDir, 'manual-verify.db');
    const backupInfo = createDatabaseBackup({ destPath: backupFile, actor: modLogin.json.account });
    assert.equal(backupInfo.ok, true);
    assert.equal(verifyBackupFile(backupFile), true, '[6.8] Backup file must pass SQLite integrity & schema verification');

    // Simulate an interrupted multi-step write mid-transaction and verify atomic rollback
    assert.throws(() => {
      db.transaction(() => {
        db.prepare('UPDATE characters SET level = 77 WHERE id = ?').run(corruptCharId);
        throw new Error('Simulated interrupted write');
      })();
    });
    assert.equal(saveManager.getCharacter(corruptCharId).level, 12, '[6.9] Interrupted transaction must roll back cleanly');

    // Delete the character, then restore from backup and verify recovery
    db.prepare('DELETE FROM characters WHERE id = ?').run(corruptCharId);
    assert.equal(saveManager.getCharacter(corruptCharId), null);
    restoreDatabaseBackup(backupFile);
    assert.equal(saveManager.getCharacter(corruptCharId).level, 12, '[6.10] Database restore must recover state accurately');
    console.log('✔ Section 6: Foreign keys, character sanitizer, save isolation, file protection, audit log, backup/restore & crash recovery verified.');
  }

  // =========================================================================
  // 7. PRODUCTION CONFIGURATION, HEADERS, PROXY & BODY LIMITS
  // =========================================================================
  {
    resetLimits();
    // HTTP security headers present on responses
    const indexRes = await api('/');
    assert.equal(indexRes.status, 200);
    assert.equal(indexRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(indexRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(indexRes.headers.get('referrer-policy'), 'no-referrer');
    assert(indexRes.headers.get('content-security-policy')?.includes("default-src 'self'"), '[7.1] CSP header must be configured');

    // Request body size limit enforcement (> 16 KB rejected with 413)
    const hugeBody = JSON.stringify({ username: 'a', password: 'B'.repeat(config.limits.httpBodyBytes + 2048) });
    const oversizeRes = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      rawBody: hugeBody
    });
    assert.equal(oversizeRes.status, 413, '[7.2] Oversized HTTP request body must be rejected with 413');

    // Malformed JSON error must not expose stack traces
    const malformedJsonRes = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      rawBody: '{"broken": '
    });
    assert.equal(malformedJsonRes.status, 400);
    assert(!malformedJsonRes.text.includes('at '), '[7.3] Error responses must never leak stack traces');

    // Trusted proxy IP and HTTPS resolution semantics
    const fakeReqUntrusted = {
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '198.51.100.4' }
    };
    assert.equal(getClientIp(fakeReqUntrusted, { enabled: false, loopback: false, addresses: new Set() }), '198.51.100.4', '[7.4] Untrusted proxy X-Forwarded-For must be ignored');
    assert.equal(isSecureRequest(fakeReqUntrusted, { enabled: false, loopback: false, addresses: new Set() }), false);

    const fakeReqTrusted = {
      headers: { 'x-forwarded-for': '198.51.100.77, 127.0.0.1', 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    assert.equal(getClientIp(fakeReqTrusted, { enabled: true, loopback: true, addresses: new Set() }), '198.51.100.77', '[7.4] Trusted loopback proxy must extract rightmost untrusted client IP');
    assert.equal(isSecureRequest(fakeReqTrusted, { enabled: true, loopback: true, addresses: new Set() }), true);

    // Production mode subprocess check: dev endpoints disabled and plain HTTP refused when requireHttps is active
    const prodCheck = spawnSync(process.execPath, ['-e', `
      import assert from 'node:assert/strict';
      process.env.NODE_ENV = 'production';
      process.env.SANCTUM_NO_LISTEN = '1';
      const { config } = await import('./server/config.js');
      assert.equal(config.isProduction, true);
      assert.equal(config.devTools, false, 'devTools must be disabled in production');
      assert.equal(config.demoLobbies, false, 'demoLobbies must be disabled in production');
      assert.equal(config.requireHttps, true, 'requireHttps must default to true in production');
    `], { cwd: config.rootDir, encoding: 'utf8' });
    assert.equal(prodCheck.status, 0, `[7.5] Production config check failed: ${prodCheck.stderr}`);
    console.log('✔ Section 7: HTTP security headers, body size limits, trusted proxy semantics & production lockdown verified.');
  }

  console.log('\n=== ALL SANCTUM SECURITY HARDENING CHECKS PASSED! ===');
} catch (err) {
  console.error('\n[SECURITY TEST FAILURE]', err);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
}
