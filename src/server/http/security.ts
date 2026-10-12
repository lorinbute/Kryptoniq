// Local-only hardening (TD §2): DNS-rebinding guard, CSRF guard for mutations, CSP for HTML.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Hostname of a Host header / Origin URL without the port. */
export function hostnameOf(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith('[')) return v.slice(0, v.indexOf(']') + 1);
  const idx = v.lastIndexOf(':');
  return idx > -1 && v.indexOf(':') === idx ? v.slice(0, idx) : v;
}

export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(hostnameOf(host));
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isLocalHost(req.headers.host)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_HOST', message: 'Kryptoniq răspunde doar pe localhost' } });
    }
    const origin = req.headers.origin;
    if (origin && !isLocalOrigin(origin)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cererile din alte site-uri nu sunt permise' } });
    }
    if (!SAFE_METHODS.has(req.method) && req.url.startsWith('/api/')) {
      if (req.headers['x-kryptoniq'] !== '1') {
        return reply.code(403).send({ error: { code: 'CSRF', message: 'Lipsește header-ul X-Kryptoniq' } });
      }
      const ct = String(req.headers['content-type'] ?? '');
      const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
      if (hasBody && !ct.toLowerCase().startsWith('application/json')) {
        return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Folosește Content-Type: application/json' } });
      }
    }
    return undefined;
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.includes('text/html')) reply.header('Content-Security-Policy', CSP);
    return payload;
  });
}
