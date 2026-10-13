// The Claude connector over HTTP (FD-MCP, TD-MCP §4): discovery documents, the authorization server's endpoints,
// the MCP endpoint behind a Bearer token, and the API the consent page and the Security page use. Registered only
// when the connector is on; the API answers "off" otherwise.
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { me } from '../http/auth.ts';
import { readCookie, setCookie } from '../http/cookies.ts';
import { NotFoundError } from '../http/errors.ts';
import { OAuthError, REQUEST_TTL_MS, SCOPE, type OAuthService } from './oauth.ts';
import { buildMcpServer } from './server.ts';

/** The browser that started an authorization (FD-MCP §6): only it can answer the consent page. */
export const OAUTH_COOKIE = 'sentiq_oauth';
const EXPIRED = 'Cererea a expirat sau a pornit din alt browser. Pornește din nou conectarea din Claude.';

/** Routes that authenticate with a Bearer token or PKCE, never the session cookie: no CSRF header, forms allowed. */
export const BEARER_ROUTES = new Set(['/mcp', '/oauth/token', '/oauth/revoke', '/oauth/register']);

/** Requests per key in a fixed window (in memory; a restart clears it). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }
  /** Counts one request; false once `limit` is passed inside the window. */
  allow(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    h.count++;
    return h.count <= limit;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Sentiq's own page for a request it will not send back to the app (RFC 6749 §4.1.2.1). */
function errorPage(message: string): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sentiq</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e13;color:#e6e8ec;font:15px/1.5 system-ui,sans-serif}main{max-width:460px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{color:#9aa3b2;margin:0 0 8px}</style>
</head><body><main><h1>Conectarea nu a pornit</h1><p>${escapeHtml(message)}</p><p>Închide fereastra și pornește din nou conectarea din Claude.</p></main></body></html>`;
}

/** One value per parameter: a repeated one (`?a=1&a=2`) makes the request invalid (RFC 6749 §3.1). */
function single(params: unknown): Record<string, string | undefined> | null {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries((params ?? {}) as Record<string, unknown>)) {
    if (Array.isArray(v)) return null;
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

function oauthFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof OAuthError) return reply.code(err.status).header('Cache-Control', 'no-store').send({ error: err.error, error_description: err.message });
  throw err;
}

/** The connector's endpoints, when it is on. */
export async function registerMcp(app: FastifyInstance, ctx: AppContext, oauth: OAuthService): Promise<void> {
  const base = oauth.issuer;
  const prmUrl = `${base}/.well-known/oauth-protected-resource/mcp`;
  const limiter = new RateLimiter();
  const tooMany = (reply: FastifyReply) => reply.code(429).header('Retry-After', '60').send({ error: 'slow_down', error_description: 'Prea multe cereri. Încearcă peste un minut.' });

  const prm = () => ({ resource: oauth.resource, authorization_servers: [base], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Sentiq' });
  app.get('/.well-known/oauth-protected-resource', async () => prm());
  app.get('/.well-known/oauth-protected-resource/mcp', async () => prm());
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE, 'offline_access'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }));

  app.get('/oauth/authorize', async (req, reply) => {
    if (!limiter.allow(`authorize:${req.ip}`, 60, 60_000)) return tooMany(reply);
    const q = single(req.query);
    const outcome = q ? await oauth.authorize(q) : ({ kind: 'error-page', message: 'Cererea are un parametru repetat.' } as const);
    if (outcome.kind === 'error-page') return reply.code(400).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(errorPage(outcome.message));
    if (outcome.kind === 'redirect') return reply.header('Cache-Control', 'no-store').redirect(outcome.url, 302);
    setCookie(req, reply, OAUTH_COOKIE, outcome.binding, { maxAgeMs: REQUEST_TTL_MS });
    return reply.header('Cache-Control', 'no-store').redirect(`/oauth/consent?req=${encodeURIComponent(outcome.id)}`, 302);
  });

  // Token, revocation and registration: forms (RFC 6749) or JSON, in their own scope so the form parser stays here.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });

    scope.post('/oauth/token', async (req, reply) => {
      if (!limiter.allow(`token:${req.ip}`, 60, 60_000)) return tooMany(reply);
      const p = single(req.body);
      try {
        if (!p) throw new OAuthError('invalid_request', 'A parameter is repeated.');
        const tokens = oauth.token(p);
        return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send(tokens);
      } catch (err) {
        return oauthFailure(reply, err);
      }
    });

    scope.post('/oauth/revoke', async (req, reply) => {
      if (!limiter.allow(`token:${req.ip}`, 60, 60_000)) return tooMany(reply);
      const p = single(req.body);
      if (!p?.token) return oauthFailure(reply, new OAuthError('invalid_request', 'token is required.'));
      oauth.revokeToken(p.token);
      return reply.header('Cache-Control', 'no-store').send({});
    });

    scope.post('/oauth/register', async (req, reply) => {
      if (!limiter.allow(`register:${req.ip}`, 10, 3_600_000)) return tooMany(reply);
      try {
        return reply.code(201).header('Cache-Control', 'no-store').send(oauth.register(req.body));
      } catch (err) {
        return oauthFailure(reply, err);
      }
    });
  });

  // The MCP endpoint: a Bearer token for this server, then the SDK's stateless handler with this user's tools.
  const handler = createMcpHandler(({ authInfo }) => {
    const userId = Number(authInfo?.extra?.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('an MCP request without a verified user');
    return buildMcpServer(ctx, userId);
  }, {
    onerror: (err) => ctx.log.warn(`mcp: ${err.message}`),
  });
  const challenge = (error: boolean) => `Bearer ${error ? 'error="invalid_token", ' : ''}resource_metadata="${prmUrl}", scope="${SCOPE}"`;
  const serve = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const who = token ? oauth.verify(token) : null;
    if (!who) {
      if (!limiter.allow(`mcp-denied:${req.ip}`, 120, 60_000)) return tooMany(reply);
      return reply
        .code(401)
        .header('WWW-Authenticate', challenge(token !== undefined))
        .send({ error: 'invalid_token', error_description: token ? 'The token is not valid for this server.' : 'Sign in to Sentiq to use this connector.' });
    }
    if (!who.scopes.includes(SCOPE)) {
      return reply.code(403).header('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${SCOPE}", resource_metadata="${prmUrl}"`).send({ error: 'insufficient_scope' });
    }
    if (!limiter.allow(`mcp:${who.grantId}`, 300, 5 * 60_000)) return tooMany(reply);
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id']) {
      const v = req.headers[name];
      if (typeof v === 'string') headers.set(name, v);
    }
    const hasBody = req.method === 'POST' && req.body !== undefined;
    const request = new Request(oauth.resource, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined });
    const authInfo = { token: token as string, clientId: who.clientId, scopes: who.scopes, expiresAt: who.expiresAt, resource: new URL(who.resource), extra: { userId: who.userId, grantId: who.grantId } };
    const res = await handler.fetch(request, { authInfo, parsedBody: hasBody ? req.body : undefined });
    reply.code(res.status);
    res.headers.forEach((value, name) => {
      if (name !== 'content-length') reply.header(name, value);
    });
    return reply.send(res.body ? Readable.fromWeb(res.body as unknown as NodeReadableStream) : null);
  };
  app.route({ method: ['GET', 'POST', 'DELETE'], url: '/mcp', handler: serve });
  app.addHook('onClose', async () => {
    await handler.close();
  });
}

/** The API the pages use (sign-in required): answers "off" / 404 while the connector is off. */
export function registerMcpApi(app: FastifyInstance, oauth: OAuthService | null): void {
  const idParam = z.object({ id: z.coerce.number().int().positive() });
  const reqParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,40}$/) });

  app.get('/api/mcp/status', async (req) => {
    if (!oauth) return { enabled: false };
    return { enabled: true, url: oauth.resource, connections: oauth.connections(me(req).id) };
  });

  app.delete('/api/mcp/connections/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    if (!oauth || !oauth.revokeGrant(id, me(req).id)) throw new NotFoundError('Conexiunea nu există.');
    return { ok: true };
  });

  app.get('/api/oauth/requests/:id', async (req) => {
    const u = me(req);
    const { id } = reqParam.parse(req.params);
    const r = oauth?.request(id, readCookie(req, OAUTH_COOKIE));
    if (!r) throw new NotFoundError(EXPIRED);
    return {
      client: { name: r.client.name, host: r.client.host, kind: r.client.kind },
      redirectHost: r.redirectHost,
      loopback: r.loopback,
      scopes: r.scope.split(' '),
      account: { name: u.name, email: u.email },
    };
  });

  app.post('/api/oauth/requests/:id', async (req, reply) => {
    const u = me(req);
    const { id } = reqParam.parse(req.params);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    const out = oauth?.decide(id, u.id, approve, readCookie(req, OAUTH_COOKIE));
    if (!out) throw new NotFoundError(EXPIRED);
    setCookie(req, reply, OAUTH_COOKIE, null);
    return out;
  });
}
