import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PACKET_TYPES, GAME_MODES, LOBBY_RETENTION } from '../shared/Constants.js';
import { config } from './config.js';
import { getClientIp, isSecureRequest } from './net/ClientAddress.js';
import { RateLimiter } from './systems/security/RateLimiter.js';
import { runModeratorBootstrap } from './systems/security/ModeratorBootstrap.js';
import { validatePacket, COST } from './systems/security/PacketValidator.js';
import { db, startMaintenance } from './systems/Database.js';
import { GameRoom } from './systems/GameRoom.js';
import { authService } from './systems/AuthService.js';
import { saveManager } from './systems/SaveManager.js';
import { modService, ModError } from './systems/ModService.js';
import { inviteRegistry, parseInviteCredential } from './systems/InviteRegistry.js';
import { createDatabaseBackup } from './systems/BackupService.js';
import { seedDemoDatabase, seedDemoLobbies } from './systems/DemoSeeder.js';

process.stdout.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') return; });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../client');
const SHARED_DIR = path.resolve(__dirname, '../shared');
const DATA_DIR = path.resolve(__dirname, '../data');
const ROOT_DIR = path.resolve(__dirname, '..');

// --- Rate limiters ---
const L = config.limits;
export const rateLimiters = {
  registerMin: new RateLimiter({ limit: L.registerPerIpPerMin, windowMs: 60000 }),
  registerDay: new RateLimiter({ limit: L.registerPerIpPerDay, windowMs: 24 * 60 * 60 * 1000 }),
  loginMin: new RateLimiter({ limit: L.loginPerIpPerMin, windowMs: 60000 }),
  passwordMin: new RateLimiter({ limit: L.passwordChangePerIpPerMin, windowMs: 60000 }),
  inviteLookupMin: new RateLimiter({ limit: L.invitePerIpPerMin, windowMs: 60000 }),
  inviteJoinMin: new RateLimiter({ limit: L.invitePerIpPerMin, windowMs: 60000 }),
  roomPasswordMin: new RateLimiter({ limit: L.roomPasswordPerIpPerMin, windowMs: 60000 })
};

const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
});

function applySecurityHeaders(req, res, extra = {}) {
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }
  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  for (const [k, v] of Object.entries(extra)) {
    res.setHeader(k, v);
  }
}

function sendJson(req, res, status, data, extraHeaders = {}) {
  applySecurityHeaders(req, res, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function sendRateLimited(req, res, message, retryAfterMs = 60000) {
  const retrySec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return sendJson(req, res, 429, { error: message }, { 'Retry-After': String(retrySec) });
}

class BodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, maxBytes = L.httpBodyBytes) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct && !ct.includes('application/json')) {
      return reject(new BodyError(415, 'Content-Type must be application/json'));
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return reject(new BodyError(413, 'Request body too large'));
    }
    let bytes = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        aborted = true;
        reject(new BodyError(413, 'Request body too large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      if (bytes === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new BodyError(400, 'JSON body must be an object'));
        }
        resolve(parsed);
      } catch {
        reject(new BodyError(400, 'Invalid JSON'));
      }
    });
    req.on('error', () => {
      if (!aborted) reject(new BodyError(400, 'Request stream error'));
    });
  });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

function timingSafePasswordMatch(expected, actual) {
  const a = crypto.createHash('sha256').update(String(expected || '')).digest();
  const b = crypto.createHash('sha256').update(String(actual || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function isWithinDir(baseDir, candidatePath) {
  const rel = path.relative(baseDir, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isForbiddenAssetPath(relPath) {
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('..') || norm.includes('\0')) return true;
  const parts = norm.split('/').filter(Boolean);
  if (parts.some(p => p.startsWith('.'))) return true;
  if (parts[0] === 'saves' || parts[0] === 'config' || parts[0] === 'backups' || parts[0] === 'server') return true;
  if (/\.(db|sqlite|sqlite3|wal|shm|journal|bak|env|key|pem)$/i.test(norm)) return true;
  return false;
}

async function handleHttpRequest(req, res) {
  try {
    if (config.requireHttps && !isSecureRequest(req)) {
      return sendJson(req, res, 403, { error: 'HTTPS is required.' });
    }

    const parsedUrl = new URL(req.url || '/', `http://localhost:${config.port}`);
    let reqPath = decodeURIComponent(parsedUrl.pathname);
    const ip = getClientIp(req);

    // --- AUTH ENDPOINTS ---
    if (reqPath === '/api/auth/register' && req.method === 'POST') {
      const rMin = rateLimiters.registerMin.hit(ip);
      if (!rMin.allowed) return sendRateLimited(req, res, 'Too many registration attempts. Please wait a minute.', rMin.retryAfterMs);
      const rDay = rateLimiters.registerDay.hit(ip);
      if (!rDay.allowed) return sendRateLimited(req, res, 'Daily registration limit reached for this address.', rDay.retryAfterMs);

      const body = await readBody(req);
      const { username, password, confirmPassword } = body;
      if (confirmPassword !== undefined && password !== confirmPassword) {
        return sendJson(req, res, 400, { error: 'Passwords do not match.' });
      }
      const result = await authService.register(username, password, { ip });
      if (result.error) return sendJson(req, res, result.status || 400, { error: result.error });
      return sendJson(req, res, 201, result);
    }

    if (reqPath === '/api/auth/login' && req.method === 'POST') {
      const hit = rateLimiters.loginMin.hit(ip);
      if (!hit.allowed) return sendRateLimited(req, res, 'Too many login attempts. Please wait a minute.', hit.retryAfterMs);

      const { username, password } = await readBody(req);
      const result = await authService.login(username, password, { ip });
      if (result.error) {
        if (result.status === 429) {
          return sendRateLimited(req, res, result.error, result.retryAfterMs);
        }
        return sendJson(req, res, result.status || 401, { error: result.error });
      }
      return sendJson(req, res, 200, result);
    }

    if (reqPath === '/api/auth/me' && req.method === 'GET') {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const { sessionHash: _sh, ...publicAcc } = account;
      return sendJson(req, res, 200, { account: publicAcc });
    }

    if (reqPath === '/api/auth/logout' && req.method === 'POST') {
      authService.logout(getBearerToken(req));
      return sendJson(req, res, 200, { ok: true });
    }

    if (reqPath === '/api/auth/change-password' && req.method === 'POST') {
      const hit = rateLimiters.passwordMin.hit(ip);
      if (!hit.allowed) return sendRateLimited(req, res, 'Too many password change attempts. Please wait a minute.', hit.retryAfterMs);
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });

      const { currentPassword, newPassword, confirmPassword } = await readBody(req);
      if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        return sendJson(req, res, 400, { error: 'New passwords do not match.' });
      }
      const result = await authService.changePassword(account, currentPassword, newPassword, { ip });
      if (result.error) {
        if (result.status === 429) return sendRateLimited(req, res, result.error, result.retryAfterMs);
        return sendJson(req, res, result.status || 400, { error: result.error });
      }
      return sendJson(req, res, 200, result);
    }

    if (reqPath === '/api/auth/revoke-sessions' && req.method === 'POST') {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const keepCurrent = body.keepCurrent === true;
      const revoked = authService.revokeAllSessions(account.id, { exceptHash: keepCurrent ? account.sessionHash : null });
      return sendJson(req, res, 200, { ok: true, revoked });
    }

    // --- CHARACTER ROSTER ENDPOINTS ---
    if (reqPath === '/api/characters') {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });
      if (account.mustChangePassword) {
        return sendJson(req, res, 403, { error: 'Password change required before accessing characters.', mustChangePassword: true });
      }

      if (req.method === 'GET') {
        return sendJson(req, res, 200, { characters: saveManager.listByAccount(account.id) });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        // Never trust client-supplied accountId
        const result = saveManager.createCharacter({
          accountId: account.id,
          name: body.name,
          classId: body.classId,
          mode: body.mode
        });
        if (result.error) return sendJson(req, res, 400, { error: result.error });
        return sendJson(req, res, 201, { character: result.character });
      }
      if (req.method === 'DELETE') {
        const id = parsedUrl.searchParams.get('id');
        if (activeCharacters.has(id) || lingeringCharacters.has(id)) {
          return sendJson(req, res, 409, { error: 'Character is currently active in a game room.' });
        }
        const ok = saveManager.deleteCharacter(id, account.id);
        return sendJson(req, res, ok ? 200 : 404, { deleted: ok });
      }
      return sendJson(req, res, 405, { error: 'Method Not Allowed' });
    }

    if (reqPath === '/api/fallen' && req.method === 'GET') {
      return sendJson(req, res, 200, { fallen: saveManager.listFallenHeroes() });
    }

    if (reqPath === '/api/legends' && req.method === 'GET') {
      return sendJson(req, res, 200, { legends: saveManager.listLegends() });
    }

    if (reqPath === '/api/lobbies' && req.method === 'GET') {
      const mode = parsedUrl.searchParams.get('mode') === GAME_MODES.HARDCORE ? GAME_MODES.HARDCORE : GAME_MODES.CLASSIC;
      const lobbies = Array.from(rooms.values())
        .filter(r => r.isPublic && r.mode === mode && r.players.size > 0)
        .map(r => r.getSummary());
      return sendJson(req, res, 200, { lobbies });
    }

    if (reqPath === '/api/invite' && req.method === 'GET') {
      const hit = rateLimiters.inviteLookupMin.hit(ip);
      if (!hit.allowed) return sendRateLimited(req, res, 'Too many invite lookups. Please wait a moment.', hit.retryAfterMs);

      const rotated = inviteRegistry.rotateExpired();
      for (const r of rotated) {
        r._broadcastInviteUpdate();
      }
      const rawToken = (parsedUrl.searchParams.get('token') || '').trim();
      const room = rawToken ? inviteRegistry.resolveToken(rawToken) : null;

      if (!room || room.maxPlayers <= 1) {
        return sendJson(req, res, 404, { error: 'Invite link is invalid or the game room has closed.' });
      }
      return sendJson(req, res, 200, { invite: room.getInvitePreview() });
    }

    // --- ROOM INVITE MANAGEMENT (HTTP endpoint for room owner / members) ---
    if ((reqPath === '/api/invite/regenerate' || reqPath === '/api/invite/revoke') && req.method === 'POST') {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });
      if (account.mustChangePassword) return sendJson(req, res, 403, { error: 'Password change required.' });
      const { roomId } = await readBody(req);
      const room = typeof roomId === 'string' ? rooms.get(roomId) : null;
      if (!room || room.maxPlayers <= 1) return sendJson(req, res, 404, { error: 'Room not found.' });
      const isMember = Array.from(room.players.values()).some(p => p.accountId === account.id);
      const isAuthorized = (room.ownerAccountId && room.ownerAccountId === account.id) || (!room.ownerAccountId && isMember) || account.role === 'moderator';
      if (!isAuthorized) return sendJson(req, res, 403, { error: 'Only the room host can manage room invites.' });

      const out = reqPath.endsWith('/revoke') ? room.revokeInvite() : room.regenerateInvite();
      return sendJson(req, res, 200, out);
    }

    // --- MODERATOR PORTAL API ---
    if (reqPath.startsWith('/api/mod/')) {
      const account = authService.validateSession(getBearerToken(req));
      if (!account) return sendJson(req, res, 401, { error: 'Unauthorized' });
      if (account.role !== 'moderator') return sendJson(req, res, 403, { error: 'Moderator access required' });
      if (account.mustChangePassword) {
        return sendJson(req, res, 403, {
          error: 'You must change your initial moderator password before using the moderator portal.',
          mustChangePassword: true
        });
      }

      try {
        if (reqPath === '/api/mod/overview' && req.method === 'GET') {
          return sendJson(req, res, 200, modService.getOverview());
        }
        if (reqPath === '/api/mod/prune' && req.method === 'POST') {
          return sendJson(req, res, 200, modService.runPrune(account, { ip }));
        }
        if (reqPath === '/api/mod/audit' && req.method === 'GET') {
          const limit = parsedUrl.searchParams.get('limit') || '100';
          const action = parsedUrl.searchParams.get('action') || '';
          return sendJson(req, res, 200, { audit: modService.getAudit({ limit, action }) });
        }
        if (reqPath === '/api/mod/backup' && req.method === 'POST') {
          const result = createDatabaseBackup({ actor: account, ip });
          return sendJson(req, res, 200, { ok: true, bytes: result.bytes, createdAt: result.createdAt });
        }
        if (reqPath === '/api/mod/accounts') {
          const id = parsedUrl.searchParams.get('id');
          if (req.method === 'GET') {
            return sendJson(req, res, 200, { accounts: modService.searchAccounts(parsedUrl.searchParams.get('q') || '') });
          }
          if (req.method === 'PATCH' && id) {
            const patch = await readBody(req);
            const updated = modService.updateAccount(account, id, patch, { ip });
            return sendJson(req, res, updated ? 200 : 404, updated ? { account: updated } : { error: 'Account not found' });
          }
          if (req.method === 'DELETE' && id) {
            const deleted = modService.deleteAccount(account, id, { ip });
            return sendJson(req, res, deleted ? 200 : 404, { deleted });
          }
        }
        if (reqPath === '/api/mod/characters') {
          const id = parsedUrl.searchParams.get('id');
          if (req.method === 'GET') {
            const q = parsedUrl.searchParams.get('q') || '';
            const mode = parsedUrl.searchParams.get('mode') || '';
            return sendJson(req, res, 200, { characters: modService.searchCharacters(q, mode) });
          }
          if (req.method === 'PATCH' && id) {
            const patch = await readBody(req);
            const updated = modService.updateCharacter(account, id, patch, { ip });
            return sendJson(req, res, updated ? 200 : 404, updated ? { character: updated } : { error: 'Character not found' });
          }
          if (req.method === 'DELETE' && id) {
            const deleted = modService.deleteCharacter(account, id, { ip });
            return sendJson(req, res, deleted ? 200 : 404, { deleted });
          }
        }
        return sendJson(req, res, 404, { error: 'Not Found' });
      } catch (err) {
        if (err instanceof ModError || err instanceof BodyError) {
          return sendJson(req, res, err.status, { error: err.message });
        }
        throw err;
      }
    }

    // --- DEV ASSET & PSG STUDIO API (disabled in production unless explicitly enabled) ---
    if (reqPath === '/api/dev/sprites' || reqPath === '/api/dev/sfx') {
      if (!config.devTools) {
        return sendJson(req, res, 404, { error: 'Not Found' });
      }
      const filename = reqPath === '/api/dev/sprites' ? 'sprites.json' : 'sfx.json';
      const targetPath = path.join(DATA_DIR, filename);

      if (req.method === 'GET') {
        try {
          const raw = fs.readFileSync(targetPath, 'utf-8');
          return sendJson(req, res, 200, JSON.parse(raw));
        } catch {
          return sendJson(req, res, 200, {});
        }
      }

      if (req.method === 'PUT') {
        const account = authService.validateSession(getBearerToken(req));
        if (!account) return sendJson(req, res, 401, { error: 'Sign in as a moderator to save directly to disk.' });
        if (account.role !== 'moderator') return sendJson(req, res, 403, { error: 'Moderator role required to write data files.' });
        if (account.mustChangePassword) return sendJson(req, res, 403, { error: 'Password change required.' });
        const data = await readBody(req, L.devBodyBytes);
        fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
        return sendJson(req, res, 200, { ok: true, saved: filename });
      }
      return sendJson(req, res, 405, { error: 'Method Not Allowed' });
    }

    if (reqPath.startsWith('/api/')) {
      return sendJson(req, res, 404, { error: 'Not Found' });
    }

    // --- STATIC ASSETS ---
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.writeHead(405);
      return res.end('405 Method Not Allowed');
    }

    if ((reqPath === '/dev' || reqPath === '/dev.html' || reqPath === '/dev.js' || reqPath.startsWith('/dev/')) && !config.devTools) {
      applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.writeHead(404);
      return res.end('404 Not Found');
    }

    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    if (reqPath === '/mod') reqPath = '/mod.html';
    if (reqPath === '/dev') reqPath = '/dev.html';
    if (reqPath === '/roadmap') reqPath = '/roadmap.html';

    if (isForbiddenAssetPath(reqPath)) {
      applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.writeHead(403);
      return res.end('403 Forbidden');
    }

    let filePath;
    if (reqPath === '/roadmap.md') {
      filePath = path.join(ROOT_DIR, 'roadmap.md');
    } else if (reqPath.startsWith('/shared/')) {
      const candidate = path.resolve(SHARED_DIR, '.' + reqPath.slice('/shared'.length));
      if (!isWithinDir(SHARED_DIR, candidate)) {
        applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.writeHead(403);
        return res.end('403 Forbidden');
      }
      filePath = candidate;
    } else if (reqPath.startsWith('/data/')) {
      const candidate = path.resolve(DATA_DIR, '.' + reqPath.slice('/data'.length));
      if (!isWithinDir(DATA_DIR, candidate) || isWithinDir(path.join(DATA_DIR, 'saves'), candidate) || candidate === path.join(DATA_DIR, 'saves')) {
        applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.writeHead(403);
        return res.end('403 Forbidden');
      }
      filePath = candidate;
    } else {
      const candidate = path.resolve(CLIENT_DIR, '.' + reqPath);
      if (!isWithinDir(CLIENT_DIR, candidate)) {
        applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.writeHead(403);
        return res.end('403 Forbidden');
      }
      filePath = candidate;
    }

    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.csv': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8'
    };

    fs.readFile(filePath, (err, content) => {
      if (err) {
        applySecurityHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.writeHead(404);
        res.end('404 Not Found');
      } else {
        applySecurityHeaders(req, res, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.writeHead(200);
        res.end(req.method === 'HEAD' ? undefined : content);
      }
    });
  } catch (err) {
    if (err instanceof BodyError || err instanceof ModError) {
      return sendJson(req, res, err.status, { error: err.message });
    }
    if (err instanceof URIError) {
      return sendJson(req, res, 400, { error: 'Malformed URL' });
    }
    console.error('[Server] Internal request error');
    if (!res.headersSent) {
      return sendJson(req, res, 500, { error: 'Internal Server Error' });
    }
    res.end();
  }
}

const server = config.tls
  ? https.createServer({
      cert: fs.readFileSync(config.tls.cert),
      key: fs.readFileSync(config.tls.key)
    }, handleHttpRequest)
  : http.createServer(handleHttpRequest);

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: L.wsMaxPayload
});

export const rooms = new Map();
export const activeCharacters = new Map(); // characterId -> ws
export const lingeringCharacters = new Map(); // characterId -> { room, playerId }
const connectionsByIp = new Map(); // ip -> count
let nextSocketId = 1;

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.allowedOrigins.size > 0) return config.allowedOrigins.has(origin);
  if (!config.isProduction) return true;
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch {
    return false;
  }
}

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  if (config.requireHttps && !isSecureRequest(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!isOriginAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const ip = getClientIp(req);
  const currentForIp = connectionsByIp.get(ip) || 0;
  if (wss.clients.size >= L.wsMaxConnections || currentForIp >= L.wsMaxPerIp) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.clientIp = ip;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
    wss.emit('connection', ws, req);
  });
});

function sendLobbyError(ws, message, extra = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: PACKET_TYPES.LOBBY_ERROR, data: { message, ...extra } }));
  }
  ws.closed = true;
  ws.close();
}

// Terminate live sockets immediately when a session or account is revoked
authService.on('revoked', ({ accountId = null, exceptHash = null, sessionHashes = null }) => {
  const hashSet = sessionHashes ? new Set(sessionHashes) : null;
  for (const client of wss.clients) {
    const matchSession = hashSet && client.sessionHash && hashSet.has(client.sessionHash);
    const matchAccount = accountId && client.accountId === accountId && (!exceptHash || client.sessionHash !== exceptHash);
    if (matchSession || matchAccount) {
      client.revokedSession = true;
      client.cleanLeave = true;
      sendLobbyError(client, 'Your session has expired or been revoked. Please sign in again.', { kicked: true });
    }
  }
});

function handlePlayerExpired(characterId, room) {
  const entry = lingeringCharacters.get(characterId);
  if (entry && entry.room === room) {
    lingeringCharacters.delete(characterId);
  }
}

function getOrCreateRoom(roomId, mode, options = {}) {
  if (!rooms.has(roomId)) {
    console.log(`[Lobby] Creating new ${mode} room: ${roomId} (public=${options.isPublic !== false}, max=${options.maxPlayers || 4})`);
    rooms.set(roomId, new GameRoom(roomId, mode, 0, {
      ...options,
      onPlayerExpired: handlePlayerExpired
    }));
  }
  return rooms.get(roomId);
}

const roomSweepInterval = setInterval(() => {
  const now = Date.now();
  const rotated = inviteRegistry.rotateExpired(now);
  for (const r of rotated) {
    r._broadcastInviteUpdate();
  }
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.size === 0 && room.emptySince && (now - room.emptySince >= LOBBY_RETENTION.EMPTY_ROOM_MS)) {
      console.log(`[Lobby] Room ${roomId} retention expired, cleaning up`);
      room.destroy();
      rooms.delete(roomId);
    }
  }
}, 15000);
roomSweepInterval.unref();

const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    if (client.sessionHash && !authService.validateSessionHash(client.sessionHash)) {
      client.revokedSession = true;
      client.cleanLeave = true;
      sendLobbyError(client, 'Session expired. Please sign in again.', { kicked: true });
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 10000);
heartbeatInterval.unref();

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(roomSweepInterval);
});

wss.on('connection', (ws, req) => {
  ws.id = nextSocketId++;
  ws.clientIp = ws.clientIp || (req ? getClientIp(req) : 'unknown');
  ws.characterId = null;
  ws.accountId = null;
  ws.sessionHash = null;
  ws.currentRoom = null;
  ws.isAlive = true;
  ws.closed = false;
  ws.lastSeenAt = Date.now();
  ws.msgCount = 0;
  ws.expensiveCount = 0;
  ws.msgWindowStart = Date.now();
  ws.joinCount = 0;
  ws.joinWindowStart = Date.now();
  ws.lastJoinAt = 0;
  ws.strikes = 0;
  let currentRoom = null;

  // Disconnect idle unauthenticated sockets that never join a room
  const joinDeadline = setTimeout(() => {
    if (!ws.accountId && !ws.closed) {
      sendLobbyError(ws, 'Connection timed out before joining a room.');
    }
  }, L.wsJoinDeadlineMs);
  joinDeadline.unref();

  const addStrike = () => {
    ws.strikes++;
    if (ws.strikes >= L.wsMaxStrikes) {
      ws.closed = true;
      ws.close(1008, 'Policy Violation');
    }
  };

  ws.on('error', () => {
    ws.closed = true;
    try { ws.close(1009, 'Message Too Big'); } catch { /* ignore */ }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastSeenAt = Date.now();
  });

  ws.on('message', async (message, isBinary) => {
    if (ws.closed || ws.readyState !== 1) return;
    if (isBinary) {
      addStrike();
      return;
    }
    const byteLen = Buffer.isBuffer(message) ? message.length : Buffer.byteLength(String(message));
    if (byteLen > L.wsMaxPayload) {
      ws.closed = true;
      ws.close(1009, 'Message Too Big');
      return;
    }

    const now = Date.now();
    ws.isAlive = true;
    ws.lastSeenAt = now;
    if (now - ws.msgWindowStart >= 1000) {
      ws.msgWindowStart = now;
      ws.msgCount = 0;
      ws.expensiveCount = 0;
    }
    if (++ws.msgCount > L.wsMsgPerSec) return;

    let raw;
    try {
      raw = JSON.parse(typeof message === 'string' ? message : message.toString('utf8'));
    } catch {
      addStrike();
      return;
    }

    const validated = validatePacket(raw);
    if (!validated.ok) {
      addStrike();
      return;
    }
    const { packet, cost } = validated;

    if (cost === COST.EXPENSIVE) {
      if (++ws.expensiveCount > L.wsExpensivePerSec) return;
    } else if (cost === COST.JOIN) {
      if (now - ws.joinWindowStart >= 60000) {
        ws.joinWindowStart = now;
        ws.joinCount = 0;
      }
      if (++ws.joinCount > L.wsJoinPerMin) return;
    }

    if (packet.type === PACKET_TYPES.PING) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: PACKET_TYPES.PONG, t: packet.t }));
      }
      return;
    }

    if (packet.type === PACKET_TYPES.AUTH_LOGIN) {
      const { username, password, localConsole } = packet.data || {};
      const isLoopback = ws.clientIp === '127.0.0.1' || ws.clientIp === '::1' || ws.clientIp === '::ffff:127.0.0.1';

      let account = null;
      let token = null;

      if (localConsole && isLoopback) {
        account = db.prepare("SELECT * FROM accounts WHERE username = 'schahn'").get()
          || db.prepare("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1").get();
        if (!account) {
          const reg = await authService.register('sc32_user', 'ConsolePassword#2026', { ip: ws.clientIp });
          if (reg.account) {
            account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(reg.account.id);
            token = reg.token;
          }
        } else {
          token = authService.createSession(account.id);
        }
      } else if (username && password) {
        const loginRes = await authService.login(username, password, { ip: ws.clientIp });
        if (!loginRes.error) {
          token = loginRes.token;
          account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(loginRes.account.id);
        }
      }

      if (account && token) {
        let characters = saveManager.listByAccount(account.id);
        if (characters.length === 0) {
          const { character } = saveManager.createCharacter({
            accountId: account.id,
            name: account.username || 'ConsoleHero',
            classId: 'VANGUARD',
            mode: GAME_MODES.CLASSIC
          });
          if (character) {
            characters = [character];
          }
        }
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: PACKET_TYPES.AUTH_SUCCESS,
            data: {
              token,
              accountId: account.id,
              username: account.username,
              characters
            }
          }));
        }
      } else {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: PACKET_TYPES.AUTH_ERROR,
            data: { message: 'Authentication failed.' }
          }));
        }
      }
      return;
    }

    if (packet.type === PACKET_TYPES.JOIN_LOBBY) {
      if (ws.lastJoinAt && now - ws.lastJoinAt < L.wsJoinMinGapMs) return;
      ws.lastJoinAt = now;

      const { roomName, joinType, password, inviteToken, characterId, token, maxPlayers } = packet.data;
      const account = authService.validateSession(token);
      if (!account) return sendLobbyError(ws, 'Session expired. Please log in again.');
      if (account.mustChangePassword) {
        return sendLobbyError(ws, 'You must change your password before entering a realm.');
      }

      // Strictly scope character fetch to the authenticated account
      const savedChar = saveManager.getCharacterForAccount(characterId, account.id);
      if (!savedChar) {
        return sendLobbyError(ws, 'Character not found.');
      }
      if (savedChar.mode !== GAME_MODES.CLASSIC && savedChar.mode !== GAME_MODES.HARDCORE) {
        return sendLobbyError(ws, 'Account or character is not eligible for this game mode.');
      }
      if (savedChar.mode === GAME_MODES.HARDCORE && savedChar.isDead) {
        return sendLobbyError(ws, 'Hardcore hero has fallen and cannot enter.');
      }

      const existingSock = activeCharacters.get(savedChar.id);
      const targetMode = savedChar.mode;
      const linger = lingeringCharacters.get(savedChar.id);
      let targetRoom = null;

      const isSameRoomReattach = (room) => {
        if (linger && linger.room === room && room.players.has(linger.playerId)) return true;
        if (existingSock && existingSock !== ws && existingSock.currentRoom === room && room.players.has(existingSock.playerId || existingSock.id)) return true;
        return false;
      };

      if (joinType === 'solo') {
        const soloId = `${targetMode}_SOLO_${savedChar.id}`;
        targetRoom = getOrCreateRoom(soloId, targetMode, {
          displayName: `${savedChar.name}'s Realm`,
          isPublic: false,
          maxPlayers: 1,
          ownerAccountId: account.id
        });
        if (!isSameRoomReattach(targetRoom) && targetRoom.players.size >= targetRoom.maxPlayers) {
          return sendLobbyError(ws, `"${savedChar.name}" is already in a solo game on another session.`);
        }
      } else if (joinType === 'invite') {
        const invHit = rateLimiters.inviteJoinMin.hit(ws.clientIp);
        if (!invHit.allowed) {
          return sendLobbyError(ws, 'Too many invite join attempts. Please wait a moment.');
        }
        const rotated = inviteRegistry.rotateExpired();
        for (const r of rotated) {
          r._broadcastInviteUpdate();
        }
        const parsed = parseInviteCredential(inviteToken);
        const target = parsed.token ? inviteRegistry.resolveToken(parsed.token) : null;

        if (!target || target.maxPlayers <= 1) {
          return sendLobbyError(ws, 'Invite is invalid, expired, or the game room has closed.');
        }
        if (target.mode !== targetMode) {
          return sendLobbyError(ws, `Mode mismatch: invite is for ${target.mode} mode, but your hero is ${targetMode}.`);
        }
        if (!isSameRoomReattach(target) && target.players.size >= target.maxPlayers) {
          return sendLobbyError(ws, 'Game room is full.');
        }
        targetRoom = target;
      } else {
        const cleanRoom = (roomName || 'crypt_01').replace(/[^\w -]/g, '').trim().slice(0, 24) || 'crypt_01';
        const roomId = `${targetMode}_${cleanRoom}`;
        const existing = rooms.get(roomId);
        if (existing) {
          // Server-side room privacy check: non-public rooms cannot be entered by roomName lookup
          // unless reattaching an already-admitted character or the caller is the room creator.
          if (!existing.isPublic && !isSameRoomReattach(existing) && existing.ownerAccountId !== account.id) {
            return sendLobbyError(ws, 'This realm is private and requires a valid invite.');
          }
          if (!isSameRoomReattach(existing) && existing.players.size >= existing.maxPlayers) {
            return sendLobbyError(ws, `Room "${cleanRoom}" is full (${existing.maxPlayers}/${existing.maxPlayers}).`);
          }
          if (existing.password) {
            const pwHit = rateLimiters.roomPasswordMin.hit(ws.clientIp);
            if (!pwHit.allowed) {
              return sendLobbyError(ws, 'Too many room password attempts. Please wait a minute.');
            }
            if (!timingSafePasswordMatch(existing.password, password || '')) {
              return sendLobbyError(ws, `Incorrect password for "${cleanRoom}".`);
            }
          }
          targetRoom = existing;
        } else {
          const isPublic = joinType !== 'private' && joinType !== 'unlisted';
          const cap = Math.max(2, Math.min(4, Number(maxPlayers) || 4));
          targetRoom = getOrCreateRoom(roomId, targetMode, {
            displayName: cleanRoom,
            isPublic,
            maxPlayers: cap,
            password: password || '',
            ownerAccountId: account.id
          });
        }
      }

      if (existingSock && existingSock !== ws) {
        const oldPid = existingSock.playerId || existingSock.id;
        if (existingSock.currentRoom === targetRoom && targetRoom.players.has(oldPid)) {
          existingSock.replacedByTakeover = true;
          existingSock.closed = true;
          if (existingSock.readyState === 1) {
            existingSock.send(JSON.stringify({
              type: PACKET_TYPES.LOBBY_ERROR,
              data: { message: 'Your character was logged into from another session.', kicked: true }
            }));
            existingSock.close();
          } else {
            existingSock.terminate();
          }
          lingeringCharacters.delete(savedChar.id);
          clearTimeout(joinDeadline);
          currentRoom = targetRoom;
          ws.currentRoom = targetRoom;
          ws.characterId = savedChar.id;
          ws.accountId = account.id;
          ws.sessionHash = account.sessionHash;
          activeCharacters.set(savedChar.id, ws);
          currentRoom.reattachPlayer(ws, targetRoom.players.get(oldPid));
          return;
        }
        if (existingSock.readyState === 1) {
          const isStale = Date.now() - (existingSock.lastSeenAt || 0) > 5000;
          if (isStale) {
            existingSock.terminate();
            return sendLobbyError(ws, `"${savedChar.name}" is still disconnecting from "${existingSock.currentRoom?.displayName || 'another room'}". Please try again in a moment.`);
          }
          return sendLobbyError(ws, `"${savedChar.name}" is already active in another session.`);
        }
      }

      if (linger) {
        const lingerPlayer = linger.room.players.get(linger.playerId);
        if (linger.room !== targetRoom) {
          if (lingerPlayer && lingerPlayer.lingerUntil && lingerPlayer.lingerUntil > Date.now()) {
            const remSec = Math.max(1, Math.ceil((lingerPlayer.lingerUntil - Date.now()) / 1000));
            return sendLobbyError(ws, `"${savedChar.name}" is still disconnecting from "${linger.room.displayName}". Wait ${remSec}s or rejoin that room.`);
          }
          lingeringCharacters.delete(savedChar.id);
        }
      }

      clearTimeout(joinDeadline);
      currentRoom = targetRoom;
      ws.currentRoom = targetRoom;
      ws.characterId = savedChar.id;
      ws.accountId = account.id;
      ws.sessionHash = account.sessionHash;
      activeCharacters.set(savedChar.id, ws);

      const activeLinger = lingeringCharacters.get(savedChar.id);
      if (activeLinger && activeLinger.room === currentRoom && currentRoom.players.has(activeLinger.playerId)) {
        const existingPlayer = currentRoom.players.get(activeLinger.playerId);
        lingeringCharacters.delete(savedChar.id);
        currentRoom.reattachPlayer(ws, existingPlayer);
      } else {
        currentRoom.addPlayer(ws, savedChar.name, savedChar.classId, savedChar);
      }
      return;
    }

    if (packet.type === PACKET_TYPES.LEAVE_LOBBY) {
      ws.cleanLeave = true;
      ws.closed = true;
      ws.close();
      return;
    }

    // All gameplay packets require an active room AND a currently valid session
    if (!currentRoom || !ws.sessionHash || !ws.accountId) return;
    if (!ws.lastSessionCheckAt || now - ws.lastSessionCheckAt >= 2000 || cost === COST.EXPENSIVE || cost === COST.JOIN) {
      const liveAccount = authService.validateSessionHash(ws.sessionHash);
      if (!liveAccount || liveAccount.id !== ws.accountId || liveAccount.mustChangePassword) {
        ws.revokedSession = true;
        ws.cleanLeave = true;
        sendLobbyError(ws, 'Session expired or revoked.', { kicked: true });
        return;
      }
      ws.lastSessionCheckAt = now;
    }

    const pid = ws.playerId || ws.id;
    const player = currentRoom.players.get(pid);
    if (!player || player.socket !== ws || player.accountId !== ws.accountId) return;
    currentRoom.handlePlayerInput(pid, packet);
  });

  ws.on('close', () => {
    ws.closed = true;
    clearTimeout(joinDeadline);
    if (ws.clientIp) {
      const next = (connectionsByIp.get(ws.clientIp) || 1) - 1;
      if (next <= 0) connectionsByIp.delete(ws.clientIp);
      else connectionsByIp.set(ws.clientIp, next);
      ws.clientIp = null;
    }
    if (ws.replacedByTakeover) return;
    if (ws.characterId && activeCharacters.get(ws.characterId) === ws) {
      activeCharacters.delete(ws.characterId);
    }
    if (currentRoom) {
      const pid = ws.playerId || ws.id;
      const p = currentRoom.players.get(pid);
      const inCombat = p && (Date.now() - (p.lastCombatAt || 0) < LOBBY_RETENTION.COMBAT_COOLDOWN_MS);
      if (p && !p.isDead && (!ws.cleanLeave || inCombat) && !ws.revokedSession) {
        const lingered = currentRoom.lingerPlayer(pid, LOBBY_RETENTION.LINGER_MS);
        if (lingered && ws.characterId) {
          lingeringCharacters.set(ws.characterId, { room: currentRoom, playerId: lingered.id });
        }
      } else {
        currentRoom.removePlayer(pid);
        if (currentRoom.players.size === 0 && currentRoom.maxPlayers === 1) {
          currentRoom.destroy();
          rooms.delete(currentRoom.roomId);
        }
      }
    }
  });
});

// Run one-time moderator bootstrap and DB maintenance at startup
runModeratorBootstrap();
startMaintenance();

if (config.demoLobbies) {
  await seedDemoDatabase();
  seedDemoLobbies(rooms, GameRoom);
}

export function startServer(port = config.port, host = config.host) {
  return new Promise((resolve) => {
    if (server.listening) return resolve(server);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const proto = config.tls ? 'https' : 'http';
      if (process.env.SANCTUM_MANAGED === '1') {
        console.log(`SANCTUM_READY {"port": ${actualPort}}`);
      }
      console.log(`\n* PROJECT: SANCTUM running at ${proto}://localhost:${actualPort} (15 Hz authoritative)`);
      resolve(server);
    });
  });
}

export function stopServer() {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      try { client.terminate(); } catch { /* ignore */ }
    }
    for (const room of rooms.values()) {
      room.destroy();
    }
    rooms.clear();
    activeCharacters.clear();
    lingeringCharacters.clear();
    connectionsByIp.clear();
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

if (process.env.SANCTUM_NO_LISTEN !== '1') {
  await startServer();
}

if (process.env.SANCTUM_MANAGED === '1') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    try {
      const msg = JSON.parse(chunk.trim());
      if (msg.cmd === 'shutdown') {
        await stopServer();
        process.exit(0);
      }
    } catch {
      // Ignore malformed control messages
    }
  });
}

export { server as appServer, wss };
