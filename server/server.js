import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PACKET_TYPES, GAME_MODES } from '../shared/Constants.js';
import { GameRoom } from './systems/GameRoom.js';
import { authService } from './systems/AuthService.js';
import { saveManager } from './systems/SaveManager.js';
import { modService } from './systems/ModService.js';
import { seedDemoDatabase, seedDemoLobbies } from './systems/DemoSeeder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '../client');
const SHARED_DIR = path.join(__dirname, '../shared');
const DATA_DIR = path.join(__dirname, '../data');
const PORT = process.env.PORT || 8080;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 131072) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > maxBytes) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let reqPath = parsedUrl.pathname;

  // --- AUTH ENDPOINTS ---
  if (reqPath === '/api/auth/register' && req.method === 'POST') {
    try {
      const { username, password } = await readBody(req);
      const result = authService.register(username, password);
      return sendJson(res, result.error ? 400 : 201, result);
    } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  }

  if (reqPath === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await readBody(req);
      const result = authService.login(username, password);
      return sendJson(res, result.error ? 401 : 200, result);
    } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  }

  if (reqPath === '/api/auth/me' && req.method === 'GET') {
    const account = authService.validateSession(getBearerToken(req));
    if (!account) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { account });
  }

  if (reqPath === '/api/auth/logout' && req.method === 'POST') {
    authService.logout(getBearerToken(req));
    return sendJson(res, 200, { ok: true });
  }

  // --- CHARACTER ROSTER ENDPOINTS ---
  if (reqPath === '/api/characters') {
    const account = authService.validateSession(getBearerToken(req));
    if (!account) return sendJson(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET') {
      return sendJson(res, 200, { characters: saveManager.listByAccount(account.id) });
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const character = saveManager.createCharacter({ ...body, accountId: account.id });
        return sendJson(res, 201, { character });
      } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    }
    if (req.method === 'DELETE') {
      const id = parsedUrl.searchParams.get('id');
      const ok = saveManager.deleteCharacter(id, account.id);
      return sendJson(res, ok ? 200 : 404, { deleted: ok });
    }
  }

  if (reqPath === '/api/fallen' && req.method === 'GET') {
    return sendJson(res, 200, { fallen: saveManager.listFallenHeroes() });
  }

  if (reqPath === '/api/legends' && req.method === 'GET') {
    return sendJson(res, 200, { legends: saveManager.listLegends() });
  }

  if (reqPath === '/api/lobbies' && req.method === 'GET') {
    const mode = parsedUrl.searchParams.get('mode') === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;
    const lobbies = Array.from(rooms.values())
      .filter(r => r.isPublic && r.mode === mode && r.players.size > 0)
      .map(r => r.getSummary());
    return sendJson(res, 200, { lobbies });
  }

  if (reqPath === '/api/invite' && req.method === 'GET') {
    const token = (parsedUrl.searchParams.get('token') || '').trim();
    const code = (parsedUrl.searchParams.get('code') || '').trim().toUpperCase();
    const room = Array.from(rooms.values()).find(r =>
      (token && r.inviteToken === token) ||
      (code && r.inviteCode === code)
    );
    if (!room || room.maxPlayers <= 1) {
      return sendJson(res, 404, { error: 'Invite link or code is invalid or the game room has closed.' });
    }
    return sendJson(res, 200, {
      invite: {
        ...room.getSummary(),
        inviteCode: room.inviteCode,
        inviteToken: room.inviteToken
      }
    });
  }

  // --- MODERATOR PORTAL API ---
  if (reqPath.startsWith('/api/mod/')) {
    const account = authService.validateSession(getBearerToken(req));
    if (!account) return sendJson(res, 401, { error: 'Unauthorized' });
    if (account.role !== 'moderator') return sendJson(res, 403, { error: 'Moderator access required' });

    if (reqPath === '/api/mod/overview' && req.method === 'GET') {
      return sendJson(res, 200, modService.getOverview());
    }
    if (reqPath === '/api/mod/prune' && req.method === 'POST') {
      return sendJson(res, 200, modService.runPrune());
    }
    if (reqPath === '/api/mod/accounts') {
      const id = parsedUrl.searchParams.get('id');
      if (req.method === 'GET') {
        return sendJson(res, 200, { accounts: modService.searchAccounts(parsedUrl.searchParams.get('q') || '') });
      }
      if (req.method === 'PATCH' && id) {
        try {
          const patch = await readBody(req);
          const updated = modService.updateAccount(id, patch);
          return sendJson(res, updated ? 200 : 404, { account: updated });
        } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      }
      if (req.method === 'DELETE' && id) {
        return sendJson(res, 200, { deleted: modService.deleteAccount(id) });
      }
    }
    if (reqPath === '/api/mod/characters') {
      const id = parsedUrl.searchParams.get('id');
      if (req.method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const mode = parsedUrl.searchParams.get('mode') || '';
        return sendJson(res, 200, { characters: modService.searchCharacters(q, mode) });
      }
      if (req.method === 'PATCH' && id) {
        try {
          const patch = await readBody(req);
          const updated = modService.updateCharacter(id, patch);
          return sendJson(res, updated ? 200 : 404, { character: updated });
        } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      }
      if (req.method === 'DELETE' && id) {
        return sendJson(res, 200, { deleted: modService.deleteCharacter(id) });
      }
    }
    return sendJson(res, 404, { error: 'Not Found' });
  }

  // --- DEV ASSET & PSG STUDIO API ---
  if (reqPath === '/api/dev/sprites' || reqPath === '/api/dev/sfx') {
    const filename = reqPath === '/api/dev/sprites' ? 'sprites.json' : 'sfx.json';
    const targetPath = path.join(DATA_DIR, filename);

    if (req.method === 'GET') {
      try {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        return sendJson(res, 200, JSON.parse(raw));
      } catch {
        return sendJson(res, 200, {});
      }
    }

    if (req.method === 'PUT') {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(res, 401, { error: 'Sign in as a moderator to save directly to disk.' });
      if (account.role !== 'moderator') return sendJson(res, 403, { error: 'Moderator role required to write data files.' });
      try {
        const data = await readBody(req, 1048576);
        fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
        return sendJson(res, 200, { ok: true, saved: filename });
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON payload' });
      }
    }
  }

  // --- STATIC ASSETS ---
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  if (reqPath === '/mod') reqPath = '/mod.html';
  if (reqPath === '/dev') reqPath = '/dev.html';

  let filePath;
  if (reqPath.startsWith('/shared/')) {
    filePath = path.join(SHARED_DIR, reqPath.replace('/shared/', ''));
  } else if (reqPath.startsWith('/data/')) {
    const rel = reqPath.replace('/data/', '');
    if (rel.startsWith('saves/') || rel.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Forbidden');
    }
    filePath = path.join(DATA_DIR, rel);
  } else {
    filePath = path.join(CLIENT_DIR, reqPath);
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.csv': 'text/plain'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
const activeCharacters = new Map(); // characterId -> ws
let nextSocketId = 1;

function sendLobbyError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: PACKET_TYPES.LOBBY_ERROR, data: { message } }));
  }
  ws.close();
}

function getOrCreateRoom(roomId, mode, options = {}) {
  if (!rooms.has(roomId)) {
    console.log(`[Lobby] Creating new ${mode} room: ${roomId} (public=${options.isPublic !== false}, max=${options.maxPlayers || 4})`);
    rooms.set(roomId, new GameRoom(roomId, mode, 0, options));
  }
  return rooms.get(roomId);
}

wss.on('connection', (ws) => {
  ws.id = nextSocketId++;
  ws.characterId = null;
  ws.msgCount = 0;
  ws.msgWindowStart = Date.now();
  let currentRoom = null;
  console.log(`[Server] Client #${ws.id} connected`);

  ws.on('message', (message) => {
    const now = Date.now();
    if (now - ws.msgWindowStart >= 1000) {
      ws.msgWindowStart = now;
      ws.msgCount = 0;
    }
    if (++ws.msgCount > 60) return; // Per-socket rate limit

    try {
      const packet = JSON.parse(message);
      if (packet.type === PACKET_TYPES.JOIN_LOBBY) {
        const { roomName, joinType, password, inviteCode, characterId, token } = packet.data || {};
        const account = authService.validateSession(token);
        if (!account) return sendLobbyError(ws, 'Session expired. Please log in again.');

        const savedChar = characterId ? saveManager.getCharacter(characterId) : null;
        if (!savedChar || savedChar.accountId !== account.id) {
          return sendLobbyError(ws, 'Character not found.');
        }
        if (savedChar.mode === GAME_MODES.HARDCORE && savedChar.isDead) {
          return sendLobbyError(ws, 'Hardcore hero has fallen and cannot enter.');
        }

        const existingSock = activeCharacters.get(savedChar.id);
        if (existingSock && existingSock !== ws && existingSock.readyState === 1) {
          return sendLobbyError(ws, `"${savedChar.name}" is already active in another session.`);
        }

        const targetMode = savedChar.mode === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;

        if (joinType === 'solo') {
          const soloId = `${targetMode}_SOLO_${savedChar.id}`;
          currentRoom = getOrCreateRoom(soloId, targetMode, {
            displayName: `${savedChar.name}'s Realm`,
            isPublic: false,
            maxPlayers: 4
          });
        } else if (joinType === 'invite') {
          const rawToken = (packet.data?.inviteToken || '').trim();
          const rawCode = (inviteCode || '').trim();
          let token = rawToken;
          let code = rawCode.toUpperCase();
          if (rawCode.includes('invite=')) {
            token = rawCode.split('invite=')[1].split('&')[0];
          } else if (rawCode.includes('join=')) {
            const val = rawCode.split('join=')[1].split('&')[0];
            if (val.length > 12) token = val;
            else code = val.toUpperCase();
          } else if (rawCode.length > 12) {
            token = rawCode;
          }

          const target = Array.from(rooms.values()).find(r =>
            (token && r.inviteToken === token) ||
            (code && r.inviteCode === code)
          );
          if (!target || target.maxPlayers <= 1) {
            return sendLobbyError(ws, 'Invite is invalid or the game room has closed.');
          }
          if (target.mode !== targetMode) {
            return sendLobbyError(ws, `Mode mismatch: invite is for ${target.mode} mode, but your hero is ${targetMode}.`);
          }
          if (target.players.size >= target.maxPlayers) {
            return sendLobbyError(ws, `Game room "${target.displayName}" is full (${target.maxPlayers}/${target.maxPlayers}).`);
          }
          currentRoom = target;
        } else {
          const cleanRoom = (roomName || 'crypt_01').trim().slice(0, 24) || 'crypt_01';
          const roomId = `${targetMode}_${cleanRoom}`;
          const existing = rooms.get(roomId);
          if (existing) {
            if (existing.players.size >= existing.maxPlayers) {
              return sendLobbyError(ws, `Room "${cleanRoom}" is full (${existing.maxPlayers}/${existing.maxPlayers}).`);
            }
            if (existing.password && existing.password !== (password || '')) {
              return sendLobbyError(ws, `Incorrect password for "${cleanRoom}".`);
            }
            currentRoom = existing;
          } else {
            const isPublic = joinType !== 'private' && joinType !== 'unlisted';
            const maxPlayers = Math.max(2, Math.min(4, Number(packet.data?.maxPlayers) || 4));
            currentRoom = getOrCreateRoom(roomId, targetMode, {
              displayName: cleanRoom,
              isPublic,
              maxPlayers,
              password: password || ''
            });
          }
        }

        ws.characterId = savedChar.id;
        activeCharacters.set(savedChar.id, ws);
        currentRoom.addPlayer(ws, savedChar.name, savedChar.classId, savedChar);
      } else if (currentRoom) {
        currentRoom.handlePlayerInput(ws.id, packet);
      }
    } catch (e) {
      console.error('[Server] Malformed packet:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client #${ws.id} disconnected`);
    if (ws.characterId && activeCharacters.get(ws.characterId) === ws) {
      activeCharacters.delete(ws.characterId);
    }
    if (currentRoom) {
      currentRoom.removePlayer(ws.id);
      if (currentRoom.players.size === 0) {
        console.log(`[Lobby] Room ${currentRoom.roomId} empty, cleaning up`);
        currentRoom.destroy();
        rooms.delete(currentRoom.roomId);
      }
    }
  });
});

if (process.env.SANCTUM_DEMO_LOBBIES === '1') {
  seedDemoDatabase();
  seedDemoLobbies(rooms, GameRoom);
}

server.listen(PORT, () => {
  console.log(`\n* PROJECT: SANCTUM running at http://localhost:${PORT} (15 Hz authoritative)`);
});
