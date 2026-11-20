/**
 * Append-only audit trail for moderator and security-relevant actions.
 * Callers must never pass credentials in `details`; known secret keys are stripped defensively.
 */
import { db } from './Database.js';

const SECRET_KEYS = /pass|token|secret|salt|hash/i;

function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

const insertStmt = db.prepare(`
  INSERT INTO audit_log (at, actor_id, actor_name, action, target_type, target_id, ip, details_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export function audit({ actor = null, action, targetType = null, targetId = null, ip = null, details = {} }) {
  let json = JSON.stringify(scrub(details) ?? {});
  if (json.length > 4000) json = JSON.stringify({ truncated: true });
  insertStmt.run(
    Date.now(),
    actor?.id ?? null,
    actor?.username ?? (actor ? null : 'system'),
    String(action),
    targetType,
    targetId === null || targetId === undefined ? null : String(targetId),
    ip,
    json
  );
}

export function listAudit({ limit = 100, action = '' } = {}) {
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100));
  const rows = action
    ? db.prepare('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id DESC LIMIT ?').all(`${String(action).slice(0, 64)}%`, lim)
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(lim);
  return rows.map(r => {
    let details = {};
    try { details = JSON.parse(r.details_json); } catch { /* keep empty */ }
    return {
      id: r.id, at: r.at, actorId: r.actor_id, actorName: r.actor_name, action: r.action,
      targetType: r.target_type, targetId: r.target_id, ip: r.ip, details
    };
  });
}
