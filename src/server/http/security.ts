// Hardening (TD §2, TD-USERS §3): a Host allowlist (DNS-rebinding guard: localhost plus this Mac's own network
// addresses and names, FD-USERS §9), same-origin requests only, a CSRF header on mutations, CSP for HTML.
import { hostname, networkInterfaces } from 'node:os';
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

/** Is the request coming from this Mac itself (loopback)? The admin's first password can only be set from here. */
export function isLoopback(req: FastifyRequest): boolean {
  const a = (req.socket.remoteAddress ?? '').toLowerCase();
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/**
 * The names this server answers to: localhost, the Mac's IPv4 / IPv6 addresses, its host name (with and without
 * `.local`) and `SENTIQ_ALLOWED_HOSTS`. Re-read every minute (Wi-Fi changes address). Anything else is refused, so a
 * hostile page that rebinds its own domain to this Mac's address still cannot talk to it.
 */
export class HostAllowlist {
  private names = new Set<string>();
  private readAt = 0;
  private readonly extra: string[];
  constructor(extra: string[] = []) {
    this.extra = extra.map((h) => h.trim().toLowerCase()).filter(Boolean);
  }
  private refresh(): void {
    const names = new Set(LOCAL_HOSTS);
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.family === 'IPv4') names.add(a.address);
        else if (!a.address.startsWith('fe80')) names.add(`[${a.address.toLowerCase()}]`);
      }
    }
    const h = hostname().toLowerCase();
    if (h) {
      names.add(h);
      names.add(h.endsWith('.local') ? h : `${h}.local`);
    }
    for (const e of this.extra) names.add(e);
    this.names = names;
    this.readAt = Date.now();
  }
  allows(host: string | undefined): boolean {
    if (!host) return false;
    if (Date.now() - this.readAt > 60_000) this.refresh();
    return this.names.has(hostnameOf(host));
  }
}

/** Same origin: the Origin header, when sent, must name exactly the host (and port) the request was sent to. */
export function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!host && u.host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * `bearerRoutes`: route patterns that never read the session cookie (the Claude connector, FD-MCP §7): a CSRF header
 * protects nothing there, and OAuth's token endpoint takes forms. Host and Origin are checked as everywhere.
 */
export function registerSecurity(app: FastifyInstance, hosts: HostAllowlist = new HostAllowlist(), opts: { bearerRoutes?: ReadonlySet<string> } = {}): void {
  const bearer = opts.bearerRoutes ?? new Set<string>();
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hosts.allows(req.headers.host)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_HOST', message: 'Sentiq răspunde doar pe adresele acestui Mac' } });
    }
    const origin = req.headers.origin;
    if (origin && !sameOrigin(origin, req.headers.host)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cererile din alte site-uri nu sunt permise' } });
    }
    // Every change carries the header, whatever its path ("/%61pi/…" reaches the API too): only the API changes things.
    // By the pattern the router matched, never the raw URL (TD-USERS §3).
    if (!SAFE_METHODS.has(req.method) && !(req.routeOptions.url !== undefined && bearer.has(req.routeOptions.url))) {
      // X-Kryptoniq: a tab opened before the rename (FD-SENTIQ §1) can still save.
      if (req.headers['x-sentiq'] !== '1' && req.headers['x-kryptoniq'] !== '1') {
        return reply.code(403).send({ error: { code: 'CSRF', message: 'Lipsește header-ul X-Sentiq' } });
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
