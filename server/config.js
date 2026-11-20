/**
 * Central server configuration. Every security-relevant knob lives here and is
 * driven by environment variables so production deployments never need code edits.
 */
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

function int(name, def, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`[Config] ${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function list(raw) {
  return (raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  const s = ip.trim();
  return s.startsWith('::ffff:') && net.isIPv4(s.slice(7)) ? s.slice(7) : s;
}

/**
 * SANCTUM_TRUST_PROXY:
 *   unset / "" / "0"  -> never trust X-Forwarded-* (direct exposure; default)
 *   "loopback"        -> trust a reverse proxy on 127.0.0.1 / ::1
 *   "10.0.0.2,..."    -> trust only these exact proxy addresses
 */
function parseTrustProxy(raw) {
  const v = (raw || '').trim();
  if (!v || v === '0' || v === 'false') return { enabled: false, loopback: false, addresses: new Set() };
  if (v === 'loopback') return { enabled: true, loopback: true, addresses: new Set() };
  const addresses = new Set(list(v).map(normalizeIp));
  for (const a of addresses) {
    if (!net.isIP(a)) throw new Error(`[Config] SANCTUM_TRUST_PROXY contains invalid IP '${a}'`);
  }
  return { enabled: true, loopback: false, addresses };
}

const isProduction = env.NODE_ENV === 'production';
const configDir = env.SANCTUM_CONFIG_DIR || path.join(ROOT_DIR, 'config');
const tlsCert = env.SANCTUM_TLS_CERT || '';
const tlsKey = env.SANCTUM_TLS_KEY || '';
if (!!tlsCert !== !!tlsKey) throw new Error('[Config] SANCTUM_TLS_CERT and SANCTUM_TLS_KEY must be set together');

export const config = Object.freeze({
  rootDir: ROOT_DIR,
  isProduction,
  port: int('PORT', 8080, 0, 65535),
  host: env.HOST || undefined,
  dbPath: env.SANCTUM_DB_PATH || path.join(ROOT_DIR, 'data/saves/sanctum.db'),
  configDir,
  initialModFile: env.SANCTUM_INITIAL_MOD_FILE || path.join(configDir, 'initial-moderator.json'),
  backupDir: env.SANCTUM_BACKUP_DIR || path.join(ROOT_DIR, 'backups'),
  devTools: !isProduction || env.SANCTUM_ENABLE_DEV_TOOLS === '1',
  demoLobbies: env.SANCTUM_DEMO_LOBBIES === '1' && !isProduction,
  trustProxy: parseTrustProxy(env.SANCTUM_TRUST_PROXY),
  tls: tlsCert ? { cert: tlsCert, key: tlsKey } : null,
  // In production, plain-HTTP requests are redirected / refused unless explicitly disabled.
  requireHttps: isProduction && env.SANCTUM_REQUIRE_HTTPS !== '0',
  allowedOrigins: new Set(list(env.SANCTUM_ALLOWED_ORIGINS)),
  limits: Object.freeze({
    httpBodyBytes: int('SANCTUM_HTTP_BODY_BYTES', 16 * 1024, 1024, 1024 * 1024),
    devBodyBytes: int('SANCTUM_DEV_BODY_BYTES', 1024 * 1024, 1024, 8 * 1024 * 1024),
    wsMaxPayload: int('SANCTUM_WS_MAX_PAYLOAD', 4096, 512, 65536),
    wsMaxConnections: int('SANCTUM_WS_MAX_CONNECTIONS', 500, 1, 100000),
    wsMaxPerIp: int('SANCTUM_WS_MAX_PER_IP', 8, 1, 1000),
    wsMsgPerSec: 60,
    wsExpensivePerSec: 10,
    wsJoinPerMin: 10,
    wsJoinMinGapMs: 750,
    wsJoinDeadlineMs: int('SANCTUM_WS_JOIN_DEADLINE_MS', 15000, 1000, 600000),
    wsMaxStrikes: 5,
    loginPerIpPerMin: 10,
    passwordChangePerIpPerMin: 10,
    registerPerIpPerMin: 5,
    registerPerIpPerDay: 20,
    invitePerIpPerMin: 20,
    roomPasswordPerIpPerMin: 10,
    accountFailThreshold: 5,
    accountLockBaseMs: int('SANCTUM_ACCOUNT_LOCK_BASE_MS', 30000, 100, 3600000),
    accountLockMaxMs: 15 * 60 * 1000,
    maxConcurrentHashes: 32,
    maxCharactersPerAccount: 12
  }),
  invite: Object.freeze({
    ttlMs: int('SANCTUM_INVITE_TTL_MS', 24 * 60 * 60 * 1000, 1000, 30 * 24 * 60 * 60 * 1000)
  })
});
