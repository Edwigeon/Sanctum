/**
 * Client address / protocol resolution with explicit trusted-proxy semantics.
 * X-Forwarded-* headers are honored ONLY when the direct peer is a configured proxy.
 */
import net from 'net';
import { config, normalizeIp } from '../config.js';

export function isTrustedProxy(ip, trust = config.trustProxy) {
  if (!trust.enabled) return false;
  if (trust.loopback) return ip === '127.0.0.1' || ip === '::1';
  return trust.addresses.has(ip);
}

export function getClientIp(req, trust = config.trustProxy) {
  const remote = normalizeIp(req.socket?.remoteAddress || '') || 'unknown';
  if (!isTrustedProxy(remote, trust)) return remote;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff !== 'string' || !xff) return remote;
  const hops = xff.split(',').map(s => normalizeIp(s)).filter(Boolean);
  // Walk right-to-left, skipping our own proxies; the first untrusted hop is the client.
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i], trust)) return net.isIP(hops[i]) ? hops[i] : remote;
  }
  return net.isIP(hops[0]) ? hops[0] : remote;
}

export function isSecureRequest(req, trust = config.trustProxy) {
  if (req.socket?.encrypted) return true;
  const remote = normalizeIp(req.socket?.remoteAddress || '');
  if (!isTrustedProxy(remote, trust)) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || proto === 'wss';
}
