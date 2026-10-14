// Minimal cookie parsing / writing (two cookies: the session and the WebAuthn challenge).
import type { FastifyReply, FastifyRequest } from 'fastify';

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{1,200}$/.test(v) ? v : undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeMs?: number;
  path?: string;
}

/** HttpOnly, SameSite=Strict, Secure on HTTPS. `value: null` deletes it. */
export function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string | null, opts: CookieOptions = {}): void {
  const parts = [`${name}=${value ?? ''}`, `Path=${opts.path ?? '/'}`, 'HttpOnly', 'SameSite=Strict'];
  if (req.viaHttps) parts.push('Secure');
  if (value === null) parts.push('Max-Age=0');
  else if (opts.maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  const prev = reply.getHeader('set-cookie');
  const list = Array.isArray(prev) ? prev.map(String) : prev ? [String(prev)] : [];
  reply.header('set-cookie', [...list.filter((c) => !c.startsWith(`${name}=`)), parts.join('; ')]);
}
