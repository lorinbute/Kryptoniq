// Hardening (TD §2, TD-USERS §3): a Host allowlist (DNS-rebinding guard: localhost plus this Mac's own network
// addresses and names, FD-USERS §9), same-origin requests only, a CSRF header on mutations, CSP for HTML.
import { isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Behind Azure App Service's front end (TD-AZURE §7): it terminates HTTPS and says who the visitor is. */
export type ProxyMode = 'azure' | null;

declare module 'fastify' {
  interface FastifyRequest {
    /** The visitor's address: the front end's word for it behind Azure, the socket's otherwise. */
    clientIp: string;
    /** Reached over HTTPS (behind Azure: as the front end says, it terminates TLS). */
    viaHttps: boolean;
    /** Came through a reverse proxy (Azure): never "this Mac". */
    behindProxy: boolean;
  }
}

/** An address without its port (`1.2.3.4:5678`, `[::1]:443`), or null when it is not an IP address. */
export function bareIp(raw: string | undefined): string | null {
  let v = (raw ?? '').trim();
  if (!v) return null;
  if (v.startsWith('[')) v = v.slice(1, v.indexOf(']') > 0 ? v.indexOf(']') : undefined);
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  return isIP(v) ? v.toLowerCase() : null;
}

/** TD-AZURE §7: X-Client-IP (set and overwritten by the front end), else the last X-Forwarded-For hop, else the socket. */
export function clientIpOf(req: FastifyRequest, proxy: ProxyMode): string {
  const socket = req.socket.remoteAddress ?? '';
  if (proxy !== 'azure') return socket;
  const header = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(',') : v;
  };
  const fromClientIp = bareIp(header('x-client-ip'));
  if (fromClientIp) return fromClientIp;
  const hops = (header('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return bareIp(hops.at(-1)) ?? socket;
}

export function viaHttpsOf(req: FastifyRequest, proxy: ProxyMode): boolean {
  if (proxy !== 'azure') return req.protocol === 'https';
  const v = req.headers['x-forwarded-proto'];
  return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim().toLowerCase() === 'https';
}

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

/**
 * Is the request coming from this Mac itself (loopback)? The admin's first password can only be set from here. Never
 * behind a proxy: there every request arrives from the proxy (TD-AZURE §7).
 */
export function isLoopback(req: FastifyRequest): boolean {
  if (req.behindProxy) return false;
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

export function registerSecurity(app: FastifyInstance, hosts: HostAllowlist = new HostAllowlist(), opts: { proxy?: ProxyMode } = {}): void {
  const proxy = opts.proxy ?? null;
  app.decorateRequest('clientIp', '');
  app.decorateRequest('viaHttps', false);
  app.decorateRequest('behindProxy', false);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.behindProxy = proxy !== null;
    req.clientIp = clientIpOf(req, proxy);
    req.viaHttps = viaHttpsOf(req, proxy);
    // App Service's start-up probe (any answer means "up"): before the Host check, whatever name it uses.
    if (proxy === 'azure' && req.url === '/robots933456.txt') return reply.code(404).type('text/plain; charset=utf-8').send('');
    if (!hosts.allows(req.headers.host)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_HOST', message: proxy ? 'Sentiq nu răspunde pe această adresă' : 'Sentiq răspunde doar pe adresele acestui Mac' } });
    }
    const origin = req.headers.origin;
    if (origin && !sameOrigin(origin, req.headers.host)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cererile din alte site-uri nu sunt permise' } });
    }
    // Every change carries the header, whatever its path ("/%61pi/…" reaches the API too): only the API changes things.
    if (!SAFE_METHODS.has(req.method)) {
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

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Over HTTPS the browser keeps using HTTPS for this site (TD-AZURE §7).
    if (req.viaHttps) reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.includes('text/html')) reply.header('Content-Security-Policy', CSP);
    return payload;
  });
}
