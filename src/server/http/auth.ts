// Who is asking (FD-USERS §1, TD-USERS §3). Every /api route needs a signed-in, active user, except the few that
// sign people in; a handful are the admin's alone. The pages themselves (the SPA) are public: they show the
// sign-in screen.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { FULL_SESSION_MS, SESSION_COOKIE } from '../auth/sessions.ts';
import type { Role, UserRow } from '../auth/users.ts';
import { readCookie, setCookie } from './cookies.ts';

export interface AuthUser {
  id: number;
  role: Role;
  email: string | null;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, or null (set for every /api request). */
    user: AuthUser | null;
  }
}

/** Routes anybody may call: they sign people in (or tell the page whether somebody is). */
const PUBLIC = new Set([
  'GET /api/ping',
  'GET /api/auth/state',
  'POST /api/auth/setup',
  'POST /api/auth/request-account',
  'POST /api/auth/activate/check',
  'POST /api/auth/activate',
  'POST /api/auth/login',
  'POST /api/auth/login/2fa',
  'POST /api/auth/logout',
  'POST /api/auth/forgot',
  'POST /api/auth/reset/check',
  'POST /api/auth/reset',
  'POST /api/auth/passkey/options',
  'POST /api/auth/passkey',
]);

/** The admin's routes (FD-USERS §2): everything that changes what all users get, and the server's internals. */
const ADMIN_ONLY: { method: string; re: RegExp }[] = [
  { method: '*', re: /^\/api\/admin(\/|$)/ },
  { method: 'GET', re: /^\/api\/health$/ },
  { method: 'POST', re: /^\/api\/sources(\/|$)/ },
  { method: 'PUT', re: /^\/api\/sources\// },
  { method: 'DELETE', re: /^\/api\/sources\// },
  { method: 'POST', re: /^\/api\/sentiment\/(rescore|recompute-history)$/ },
  { method: 'PUT', re: /^\/api\/settings\/(claude-key|twelvedata-key|resend)$/ },
  { method: 'POST', re: /^\/api\/settings\/twelvedata-plan$/ },
];

const asGet = (method: string) => (method === 'HEAD' ? 'GET' : method);

/**
 * `route`: the pattern the router matched (`req.routeOptions.url`, e.g. '/api/admin/users/:id/verify'), never the
 * raw URL: the router decodes "%61dmin" to "admin", so a check on the raw URL could be walked around.
 */
export function isPublicRoute(method: string, route: string | undefined): boolean {
  return route !== undefined && PUBLIC.has(`${asGet(method)} ${route}`);
}

export function isAdminRoute(method: string, route: string | undefined): boolean {
  return route !== undefined && ADMIN_ONLY.some((r) => (r.method === '*' || r.method === asGet(method)) && r.re.test(route));
}

/**
 * An API request: by the route matched ("/%61pi/…" is routed to the API too) or by its path (an unknown /api/ URL is
 * matched by the static files' wildcard, and still gets "sign in" rather than "no such route").
 */
export function isApiRequest(req: FastifyRequest): boolean {
  return req.routeOptions.url?.startsWith('/api/') === true || req.url.startsWith('/api/');
}

/** Can this account be used right now? (The admin is always verified; a disabled account never is.) */
export function isActive(u: UserRow | undefined): u is UserRow {
  return !!u && u.disabled_at === null && (u.role === 'admin' || u.email_verified_at !== null) && u.password_hash !== null;
}

export const toAuthUser = (u: UserRow): AuthUser => ({ id: u.id, role: u.role, email: u.email, name: u.name });

/** The session cookie's token (only the request's own cookie; never a query parameter). */
export const sessionToken = (req: FastifyRequest) => readCookie(req, SESSION_COOKIE);

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isApiRequest(req)) return undefined;
    const route = req.routeOptions.url;
    req.user = null;
    const token = sessionToken(req);
    const session = token ? await ctx.sessions.read(token) : null;
    if (session?.kind === 'full') {
      const u = await ctx.users.byId(session.user_id);
      // A disabled (or deleted) account's sessions end at its next request.
      if (isActive(u)) {
        req.user = toAuthUser(u);
        // 30 days from the last use (FD-USERS §5): the browser's cookie is renewed with the server's expiry.
        if (session.slid && token) setCookie(req, reply, SESSION_COOKIE, token, { maxAgeMs: FULL_SESSION_MS });
      } else await ctx.sessions.destroyAll(session.user_id);
    }
    if (isPublicRoute(req.method, route)) return undefined;
    if (!req.user) return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Intră în cont ca să continui.' } });
    if (req.user.role !== 'admin' && isAdminRoute(req.method, route)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Doar adminul poate face asta.' } });
    }
    return undefined;
  });
}

/** The signed-in user of a protected route (the hook already refused anybody else). */
export function me(req: FastifyRequest): AuthUser {
  if (!req.user) throw Object.assign(new Error('Intră în cont ca să continui.'), { statusCode: 401, code: 'AUTH_REQUIRED' });
  return req.user;
}
