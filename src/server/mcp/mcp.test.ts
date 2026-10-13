// FD-MCP end to end: off unless configured, the discovery Claude reads, the authorization with consent, tokens with
// PKCE and rotation, the MCP tools through the SDK's own client, and access ending with the connection.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createContext, type AppContext } from '../context.ts';
import { loadConfig, parsePublicUrl } from '../config.ts';
import { buildApp } from '../http/app.ts';
import { silentLogger } from '../log.ts';
import { hashPassword } from '../auth/passwords.ts';
import { SecretBox } from '../secrets/crypto.ts';
import type { NliScorer } from '../sentiment/local.ts';
import { MarketError, type MarketData } from '../market/market.ts';
import { tfSeconds, type Timeframe } from '../../shared/time.ts';
import { classifyRedirect, docTtl, OAuthService, redirectMatches, REUSE_GRACE_MS, type DocFetcher } from './oauth.ts';

const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };

const BASE = 'https://sentiq.test';
const HOST = 'sentiq.test';
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
/** The documents Claude publishes (as fetched on 13 Oct 2026), and a forged one. */
const DOCS: Record<string, unknown> = {
  [CLAUDE]: { client_id: CLAUDE, client_name: 'Claude', client_uri: 'https://claude.ai', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  [CLAUDE_CODE]: { client_id: CLAUDE_CODE, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' },
  'https://claude.ai/oauth/forged': { client_id: CLAUDE, client_name: 'Claude', redirect_uris: [CALLBACK] },
};
let docFetches: string[];
const fakeDocs: DocFetcher = async (url) => {
  docFetches.push(url);
  const d = DOCS[url];
  return d ? { status: 200, body: JSON.stringify(d), cacheControl: 'public, max-age=300' } : { status: 404, body: 'not found', cacheControl: null };
};

/** A rising market with dips: enough candles for the Slingshot to say something. */
const fakeMarket = {
  candles: async (exchange: string, symbol: string, tf: Timeframe, count: number) => {
    if (symbol.startsWith('XYZ/')) throw new MarketError('UNKNOWN_SYMBOL', `Perechea ${symbol} nu există pe ${exchange}.`, ['XYZ/USDC', 'XYZ/BTC']);
    const step = tfSeconds(tf) * 1000;
    const start = Date.now() - count * step;
    const candles = Array.from({ length: count }, (_, i) => {
      const c = 100 + i * 0.2 + Math.sin(i / 6) * 3;
      return { t: start + i * step, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i };
    });
    return { exchange, symbol, tf, candles, pricePrecision: 2, lastClosedIndex: count - 2, fetchedAt: Date.now() };
  },
} as unknown as MarketData;

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;
let ana: number;
/** What a test opened, closed after it. */
let opened: { app?: FastifyInstance; ctx?: AppContext; dir?: string } = {};

async function start(env: Record<string, string> = { SENTIQ_PUBLIC_URL: BASE, SENTIQ_MCP: '1' }) {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-mcp-'));
  // A web build, so unknown addresses meet the page's fallback as in production.
  mkdirSync(path.join(dir, 'web'));
  writeFileSync(path.join(dir, 'web', 'index.html'), '<!doctype html><title>Sentiq</title>');
  ctx = createContext({ ...loadConfig({ SENTIQ_DATA_DIR: dir, ...env } as NodeJS.ProcessEnv), webDist: path.join(dir, 'web') }, silentLogger, {
    nli: fakeNli,
    box: new SecretBox(Buffer.alloc(32, 9)),
    fetchClientDoc: fakeDocs,
    market: fakeMarket,
  });
  const hash = await hashPassword('Admin-password-1');
  ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ? WHERE id = 1', ['admin@example.com', 'Lorin', hash]);
  ana = ctx.db.run("INSERT INTO users(email, name, password_hash, role, email_verified_at, created_at) VALUES ('ana@example.com', 'Ana', ?, 'user', 1, 1)", [hash]).lastInsertRowid;
  app = await buildApp(ctx);
  opened = { app, ctx, dir };
}

beforeEach(() => {
  docFetches = [];
});
afterEach(async () => {
  await opened.app?.close();
  opened.ctx?.db.close();
  if (opened.dir) rmSync(opened.dir, { recursive: true, force: true });
  opened = {};
});

/** The signed-in browser of a user (session cookie + the CSRF header the page sends). */
const page = (uid: number, oauthCookie?: string) => ({
  host: HOST,
  cookie: `sentiq_session=${ctx.sessions.create(uid, 'full')}${oauthCookie ? `; ${oauthCookie}` : ''}`,
  'x-sentiq': '1',
  'content-type': 'application/json',
});

/** The consent page's id and the cookie /authorize gave the browser. */
function consentOf(res: { headers: Record<string, unknown> }): { id: string; cookie: string } {
  const id = new URL(String(res.headers.location), BASE).searchParams.get('req') as string;
  const set = [res.headers['set-cookie']].flat().map(String).find((c) => c.startsWith('sentiq_oauth=')) ?? '';
  return { id, cookie: set.split(';')[0] as string };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeUrl(p: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined) q.set(k, v);
  return `/oauth/authorize?${q}`;
}

/** What Claude sends to /authorize. */
function claudeAuthorize(challenge: string, extra: Record<string, string | undefined> = {}) {
  return authorizeUrl({
    response_type: 'code',
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st-123',
    scope: 'sentiq:read offline_access',
    resource: `${BASE}/mcp`,
    ...extra,
  });
}

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { host: HOST, ...headers } });
const form = (url: string, body: Record<string, string>) =>
  app.inject({ method: 'POST', url, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(body).toString() });

/** Authorize → consent page → approve: the callback Claude receives. */
async function approve(uid: number, url: string): Promise<URL> {
  const a = await get(url);
  expect(a.statusCode).toBe(302);
  expect(new URL(String(a.headers.location), BASE).pathname).toBe('/oauth/consent');
  const { id, cookie } = consentOf(a);
  const d = await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: page(uid, cookie), payload: JSON.stringify({ approve: true }) });
  expect(d.statusCode).toBe(200);
  return new URL(d.json().redirect);
}

/** The whole connection of Claude for a user: its tokens. */
async function connect(uid: number) {
  const { verifier, challenge } = pkce();
  const cb = await approve(uid, claudeAuthorize(challenge));
  const t = await form('/oauth/token', { grant_type: 'authorization_code', code: cb.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier, resource: `${BASE}/mcp` });
  expect(t.statusCode).toBe(200);
  return t.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string };
}

/** The SDK's own client, talking to the app in memory. */
async function mcpClient(token: string) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    headers.host = HOST;
    headers.authorization = `Bearer ${token}`;
    const res = await app.inject({ method: req.method as 'POST', url: u.pathname + u.search, headers, payload: req.method === 'POST' ? await req.text() : undefined });
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    return new Response(res.rawPayload.length ? new Uint8Array(res.rawPayload) : null, { status: res.statusCode, headers: h });
  }) as typeof fetch;
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: fetchImpl }));
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '') as string;

describe('the switch (FD-MCP §2)', () => {
  it('needs an https public address (or localhost) without a path', () => {
    expect(parsePublicUrl('https://Sentiq.Example.com/')).toBe('https://sentiq.example.com');
    expect(parsePublicUrl('https://sentiq.example.com:8443')).toBe('https://sentiq.example.com:8443');
    expect(parsePublicUrl('http://localhost:4317')).toBe('http://localhost:4317');
    for (const bad of ['http://sentiq.example.com', 'https://sentiq.example.com/app', 'https://x.com/?a=1', 'https://u:p@x.com', 'ftp://x.com', 'nonsense', '', undefined]) {
      expect(parsePublicUrl(bad), String(bad)).toBeNull();
    }
    const half = loadConfig({ SENTIQ_MCP: '1' } as NodeJS.ProcessEnv).mcp;
    expect(half).toMatchObject({ requested: true, enabled: false, clientHosts: ['claude.ai', 'claude.com'] });
    expect(loadConfig({ SENTIQ_PUBLIC_URL: BASE } as NodeJS.ProcessEnv).mcp.enabled).toBe(false);
    const on = loadConfig({ SENTIQ_PUBLIC_URL: BASE, SENTIQ_MCP: '1' } as NodeJS.ProcessEnv);
    expect(on.mcp.enabled).toBe(true);
    expect(on.allowedHosts).toContain('sentiq.test');
  });

  it('adds nothing while it is off', async () => {
    await start({ SENTIQ_PUBLIC_URL: BASE });
    expect(ctx.oauth).toBeNull();
    for (const url of ['/mcp', '/mcp?x=1', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/oauth/authorize?client_id=x', '/oauth/token']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(404);
      expect(r.headers['content-type'], url).toMatch(/json/);
    }
    // The consent page is the app's page (it then says the request does not exist); other pages too.
    for (const url of ['/oauth/consent?req=abc', '/oauthx', '/mcpx', '/security']) expect((await get(url)).headers['content-type'], url).toMatch(/text\/html/);
    // Without the switch, the token endpoint is just another POST without the CSRF header.
    expect((await form('/oauth/token', { grant_type: 'authorization_code' })).statusCode).toBe(403);
    expect((await get('/api/mcp/status', page(1))).json()).toEqual({ enabled: false });
    expect((await get('/api/oauth/requests/abcdefghijklmnop', page(1))).statusCode).toBe(404);
  });
});

describe('discovery (TD-MCP §4)', () => {
  it('publishes what Claude reads and asks for a sign-in with a 401', async () => {
    await start();
    const prm = { resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ['sentiq:read'], bearer_methods_supported: ['header'], resource_name: 'Sentiq' };
    expect((await get('/.well-known/oauth-protected-resource/mcp')).json()).toEqual(prm);
    expect((await get('/.well-known/oauth-protected-resource')).json()).toEqual(prm);
    const as = (await get('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(as.scopes_supported).toContain('offline_access');
    const res = await app.inject({ method: 'POST', url: '/mcp', headers: { host: HOST, 'content-type': 'application/json' }, payload: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="sentiq:read"`);
    const bad = await app.inject({ method: 'POST', url: '/mcp', headers: { host: HOST, 'content-type': 'application/json', authorization: 'Bearer sq_at_nope' }, payload: '{}' });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token", resource_metadata=/);
  });
});

describe('connecting Claude (FD-MCP §4)', () => {
  it('goes through the consent page and serves that user’s data to the SDK client', async () => {
    await start();
    const { verifier, challenge } = pkce();
    const a = await get(claudeAuthorize(challenge));
    const { id, cookie } = consentOf(a);
    expect(cookie).toMatch(/^sentiq_oauth=[A-Za-z0-9_-]{20,}$/);
    expect(String([a.headers['set-cookie']].flat())).toMatch(/HttpOnly; SameSite=Strict; Max-Age=600/);
    // The consent page needs a signed-in user, and the browser that started the request (not a link sent by someone).
    expect((await get(`/api/oauth/requests/${id}`, { cookie })).statusCode).toBe(401);
    expect((await get(`/api/oauth/requests/${id}`, page(ana))).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: page(ana, 'sentiq_oauth=someone-elses-cookie-value'), payload: JSON.stringify({ approve: true }) })).statusCode).toBe(404);
    const info = (await get(`/api/oauth/requests/${id}`, page(ana, cookie))).json();
    expect(info).toEqual({ client: { name: 'Claude', host: 'claude.ai', kind: 'cimd' }, redirectHost: 'claude.ai', loopback: false, scopes: ['sentiq:read'], account: { name: 'Ana', email: 'ana@example.com' } });
    const d = await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: page(ana, cookie), payload: JSON.stringify({ approve: true }) });
    expect(String([d.headers['set-cookie']].flat())).toMatch(/sentiq_oauth=; .*Max-Age=0/);
    const cb = new URL(d.json().redirect);
    expect(`${cb.origin}${cb.pathname}`).toBe(CALLBACK);
    expect(cb.searchParams.get('state')).toBe('st-123');
    expect(cb.searchParams.get('iss')).toBe(BASE);
    // A request is answered once.
    expect((await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: page(ana, cookie), payload: JSON.stringify({ approve: true }) })).statusCode).toBe(404);
    const t = await form('/oauth/token', { grant_type: 'authorization_code', code: cb.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier, resource: `${BASE}/mcp` });
    expect(t.statusCode).toBe(200);
    expect(t.headers['cache-control']).toBe('no-store');
    const tokens = t.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'sentiq:read' });
    expect(tokens.access_token).toMatch(/^sq_at_/);
    expect(tokens.refresh_token).toMatch(/^sq_rt_/);
    // Nothing secret is stored in the clear.
    const stored = JSON.stringify(ctx.db.all('SELECT * FROM mcp_tokens')) + JSON.stringify(ctx.db.all('SELECT * FROM mcp_codes'));
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(cb.searchParams.get('code'));

    // Ana's data: her own calendar note, not the admin's.
    ctx.calendar.addCustom(ana, { title: 'Unlock ARB', ts: Date.now() + 3_600_000, impact: 'Low', note: 'watch the open interest' });
    ctx.calendar.addCustom(1, { title: 'Admin private', ts: Date.now() + 3_600_000, impact: 'High' });
    ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
       VALUES ('n1', 'coindesk', 'Bitcoin slides as CPI runs hot', ?, ?, 'crypto', 1, 3, 'c1', -0.6, 'negative', 'local')`,
      [Date.now() - 3_600_000, Date.now()],
    );
    const client = await mcpClient(tokens.access_token);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map((x) => x.name).sort()).toEqual(['get_calendar', 'get_chart', 'get_day_overview', 'get_economy', 'get_market_context', 'get_sentiment', 'get_watchlist', 'search_news']);
      expect(tools.every((x) => x.annotations?.readOnlyHint === true)).toBe(true);
      expect(tools.find((x) => x.name === 'get_day_overview')?.title).toBe('Ziua de azi');
      const cal = textOf(await client.callTool({ name: 'get_calendar', arguments: { impact: ['High', 'Medium', 'Low'] } }));
      expect(cal).toContain('Unlock ARB (the user’s own note: watch the open interest)');
      expect(cal).not.toContain('Admin private');
      expect(textOf(await client.callTool({ name: 'search_news', arguments: { query: 'CPI' } }))).toMatch(/Bitcoin slides as CPI runs hot — CoinDesk/);
      const sentiment = textOf(await client.callTool({ name: 'get_sentiment', arguments: { days: 3 } }));
      expect(sentiment).toMatch(/^Time zone: \S+\. Today \d{4}-\d\d-\d\d, as of \d\d:\d\d\.\nIndex [\d.]+ /);
      expect(sentiment).toContain('- (-0.6) Bitcoin slides as CPI runs hot [CoinDesk]');
      const day = textOf(await client.callTool({ name: 'get_day_overview', arguments: {} }));
      expect(day).toContain('## Sentimentul zilei');
      expect(day).not.toContain('Grafice disponibile');
      expect(textOf(await client.callTool({ name: 'get_watchlist', arguments: {} }))).toContain('has not finished its first run');
      expect(textOf(await client.callTool({ name: 'get_market_context', arguments: {} }))).toContain('Crypto Fear & Greed: not available.');
      const chart = textOf(await client.callTool({ name: 'get_chart', arguments: { symbol: 'btc/usdt', timeframe: '4h', bars: 12 } }));
      expect(chart).toMatch(/^BTC\/USDT on kucoin, 4h, \d+ candles loaded/);
      expect(chart).toContain('Slingshot System:');
      expect(chart.split('\n').filter((l) => /^\S+ \d\d \S+ \d\d:\d\d \d/.test(l) || /^\w+\.?,? \d\d/.test(l)).length).toBeGreaterThanOrEqual(12);
      const unknown = await client.callTool({ name: 'get_chart', arguments: { symbol: 'XYZ/USDT' } });
      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toBe('Eroare: Perechea XYZ/USDT nu există pe kucoin. Poate: XYZ/USDC, XYZ/BTC.');
      const wrong = await client.callTool({ name: 'get_chart', arguments: { symbol: 'not a symbol!' } });
      expect(wrong.isError).toBe(true);
      expect(textOf(wrong)).toMatch(/^Eroare: simbolul/);
      const tooBig = await client.callTool({ name: 'get_sentiment', arguments: { days: 500 } });
      expect(tooBig.isError).toBe(true);
      const prompts = (await client.listPrompts()).prompts;
      expect(prompts.map((p) => [p.name, p.title])).toEqual([
        ['day_summary', 'Rezumatul zilei'],
        ['analyze_symbol', 'Analiza unei monede sau acțiuni'],
      ]);
      const p = await client.getPrompt({ name: 'analyze_symbol', arguments: { symbol: 'SOL' } });
      expect(JSON.stringify(p.messages)).toContain('Analizează SOL cu Sentiq');
    } finally {
      await client.close();
    }
    // The Security page lists the connection.
    const status = (await get('/api/mcp/status', page(ana))).json();
    expect(status).toMatchObject({ enabled: true, url: `${BASE}/mcp`, connections: [{ clientName: 'Claude', clientHost: 'claude.ai', redirectHost: 'claude.ai' }] });
    expect((await get('/api/mcp/status', page(1))).json().connections).toEqual([]);
  });

  it('refuses untrusted apps and callbacks on its own page, and tells the app about the rest', async () => {
    await start();
    const { challenge } = pkce();
    const html = async (url: string) => {
      const r = await get(url);
      expect(r.statusCode, url).toBe(400);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.headers.location).toBeUndefined();
      return r.body;
    };
    expect(await html(claudeAuthorize(challenge, { client_id: 'https://evil.example/client.json' }))).toContain('evil.example');
    expect(await html(claudeAuthorize(challenge, { client_id: 'https://claude.ai/oauth/forged' }))).toContain('nu e validă');
    expect(await html(claudeAuthorize(challenge, { client_id: 'https://claude.ai/oauth/missing' }))).toContain('nu s-a putut citi');
    expect(await html(claudeAuthorize(challenge, { redirect_uri: 'https://claude.ai/elsewhere' }))).toContain('Adresa de întoarcere');
    expect(await html(claudeAuthorize(challenge, { redirect_uri: 'https://evil.example/cb' }))).toContain('Adresa de întoarcere');
    expect(await html(`${claudeAuthorize(challenge)}&state=again`)).toContain('repetat');
    expect(await html(authorizeUrl({ response_type: 'code' }))).toContain('ce aplicație');
    expect(await html(claudeAuthorize(challenge, { redirect_uri: undefined }))).toContain('Adresa de întoarcere');
    // The client document is read once and kept (its max-age).
    expect(docFetches.filter((u) => u === CLAUDE)).toHaveLength(1);

    const back = async (extra: Record<string, string | undefined>) => {
      const r = await get(claudeAuthorize(challenge, extra));
      expect(r.statusCode).toBe(302);
      const u = new URL(String(r.headers.location));
      expect(`${u.origin}${u.pathname}`).toBe(CALLBACK);
      expect(u.searchParams.get('state')).toBe('st-123');
      expect(u.searchParams.get('iss')).toBe(BASE);
      return u.searchParams.get('error');
    };
    expect(await back({ code_challenge: undefined })).toBe('invalid_request');
    expect(await back({ code_challenge_method: 'plain' })).toBe('invalid_request');
    expect(await back({ response_type: 'token' })).toBe('unsupported_response_type');
    expect(await back({ scope: 'admin' })).toBe('invalid_scope');
    expect(await back({ resource: 'https://other.example/mcp' })).toBe('invalid_target');
    // The resource may come with a trailing slash or upper-case host; no resource means this server.
    expect((await get(claudeAuthorize(challenge, { resource: 'https://SENTIQ.test/mcp/' }))).headers.location).toMatch(/^\/oauth\/consent\?req=/);
    expect((await get(claudeAuthorize(challenge, { resource: undefined }))).headers.location).toMatch(/^\/oauth\/consent\?req=/);

    // Refusing sends access_denied back.
    const refused = consentOf(await get(claudeAuthorize(challenge)));
    const d = await app.inject({ method: 'POST', url: `/api/oauth/requests/${refused.id}`, headers: page(ana, refused.cookie), payload: JSON.stringify({ approve: false }) });
    expect(new URL(d.json().redirect).searchParams.get('error')).toBe('access_denied');
    expect(ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM mcp_codes')?.n).toBe(0);
  });

  it('lets Claude Code come back to this computer on any port, with a warning on the page', async () => {
    await start();
    const { verifier, challenge } = pkce();
    const redirect = 'http://localhost:53118/callback';
    const { id, cookie } = consentOf(await get(claudeAuthorize(challenge, { client_id: CLAUDE_CODE, redirect_uri: redirect })));
    expect((await get(`/api/oauth/requests/${id}`, page(ana, cookie))).json()).toMatchObject({ client: { name: 'Claude Code', host: 'claude.ai' }, redirectHost: 'localhost', loopback: true });
    const cb = new URL((await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: page(ana, cookie), payload: JSON.stringify({ approve: true }) })).json().redirect);
    expect(cb.origin).toBe('http://localhost:53118');
    const t = await form('/oauth/token', { grant_type: 'authorization_code', code: cb.searchParams.get('code') as string, redirect_uri: redirect, client_id: CLAUDE_CODE, code_verifier: verifier });
    expect(t.statusCode).toBe(200);
    // Another path on localhost is not the registered callback.
    expect((await get(claudeAuthorize(challenge, { client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:53118/other' }))).statusCode).toBe(400);
  });
});

describe('tokens (TD-MCP §3)', () => {
  it('check the code, its verifier, client and callback; a code used twice withdraws what it gave', async () => {
    await start();
    const { verifier, challenge } = pkce();
    const code = async () => (await approve(ana, claudeAuthorize(challenge))).searchParams.get('code') as string;
    const exchange = (c: string, extra: Record<string, string> = {}) =>
      form('/oauth/token', { grant_type: 'authorization_code', code: c, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier, ...extra });
    const err = async (r: Awaited<ReturnType<typeof exchange>>) => {
      expect(r.statusCode).toBe(400);
      return r.json().error;
    };
    expect(await err(await exchange(await code(), { code_verifier: pkce().verifier }))).toBe('invalid_grant');
    expect(await err(await exchange(await code(), { redirect_uri: 'https://claude.ai/api/mcp/other' }))).toBe('invalid_grant');
    expect(await err(await exchange(await code(), { client_id: CLAUDE_CODE }))).toBe('invalid_grant');
    expect(await err(await exchange(await code(), { resource: 'https://other.example/mcp' }))).toBe('invalid_target');
    expect(await err(await form('/oauth/token', { grant_type: 'password' }))).toBe('unsupported_grant_type');
    expect(await err(await form('/oauth/token', { grant_type: 'authorization_code' }))).toBe('invalid_request');
    const c = await code();
    const first = await exchange(c);
    expect(first.statusCode).toBe(200);
    const access = first.json().access_token;
    expect(ctx.oauth?.verify(access)).toMatchObject({ userId: ana, clientId: CLAUDE, scopes: ['sentiq:read'] });
    expect(await err(await exchange(c))).toBe('invalid_grant');
    expect(ctx.oauth?.verify(access)).toBeNull();
    // JSON works too, and the token endpoint never needs the page's CSRF header.
    const j = await app.inject({ method: 'POST', url: '/oauth/token', headers: { host: HOST, 'content-type': 'application/json' }, payload: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'sq_rt_x' }) });
    expect(j.json().error).toBe('invalid_grant');
  });

  it('rotate the refresh token; a retry soon after is refused, a reuse later ends the connection', () => {
    let now = Date.UTC(2026, 9, 13, 12);
    dir = mkdtempSync(path.join(tmpdir(), 'sq-mcp-'));
    ctx = createContext({ ...loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'x') }, silentLogger, { nli: fakeNli, box: new SecretBox(Buffer.alloc(32, 9)) });
    opened = { ctx, dir };
    const oauth = new OAuthService({ db: ctx.db, log: silentLogger, issuer: BASE, clientHosts: ['claude.ai'], userActive: () => true, fetchDoc: fakeDocs, now: () => now });
    return (async () => {
      const { verifier, challenge } = pkce();
      const out = await oauth.authorize({ response_type: 'code', client_id: CLAUDE, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' });
      if (out.kind !== 'consent') throw new Error('no consent');
      expect(oauth.request(out.id, out.binding)).not.toBeNull();
      expect(oauth.request(out.id, 'x'.repeat(out.binding.length))).toBeNull();
      expect(oauth.request(out.id, undefined)).toBeNull();
      // Unanswered for 10 minutes: expired.
      now += 11 * 60_000;
      expect(oauth.request(out.id, out.binding)).toBeNull();
      const again = await oauth.authorize({ response_type: 'code', client_id: CLAUDE, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' });
      if (again.kind !== 'consent') throw new Error('no consent');
      const cb = new URL(oauth.decide(again.id, 1, true, again.binding)?.redirect as string);
      // A code lives one minute.
      now += 61_000;
      expect(() => oauth.token({ grant_type: 'authorization_code', code: cb.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier })).toThrow(/expired/);
      const fresh = await oauth.authorize({ response_type: 'code', client_id: CLAUDE, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' });
      if (fresh.kind !== 'consent') throw new Error('no consent');
      const cb2 = new URL(oauth.decide(fresh.id, 1, true, fresh.binding)?.redirect as string);
      const t1 = oauth.token({ grant_type: 'authorization_code', code: cb2.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier });
      // The access token lasts an hour.
      now += 3_601_000;
      expect(oauth.verify(t1.access_token)).toBeNull();
      const t2 = oauth.token({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: CLAUDE });
      expect(oauth.verify(t2.access_token)).toMatchObject({ userId: 1 });
      expect(t2.refresh_token).not.toBe(t1.refresh_token);
      // The old refresh token again, at once: refused, the connection lives (Claude retrying after a timeout).
      now += 5_000;
      expect(() => oauth.token({ grant_type: 'refresh_token', refresh_token: t1.refresh_token })).toThrow(/already used/);
      expect(oauth.verify(t2.access_token)).not.toBeNull();
      expect(() => oauth.token({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: CLAUDE_CODE })).toThrow(/another client/);
      // Later: a stolen copy; the whole connection ends.
      now += REUSE_GRACE_MS;
      expect(() => oauth.token({ grant_type: 'refresh_token', refresh_token: t1.refresh_token })).toThrow(/already used/);
      expect(oauth.verify(t2.access_token)).toBeNull();
      expect(() => oauth.token({ grant_type: 'refresh_token', refresh_token: t2.refresh_token })).toThrow();
      expect(oauth.connections(1)).toEqual([]);
      // A token issued for another resource is not accepted here.
      const other = new OAuthService({ db: ctx.db, log: silentLogger, issuer: 'https://other.test', clientHosts: ['claude.ai'], userActive: () => true, fetchDoc: fakeDocs, now: () => now });
      const o = await other.authorize({ response_type: 'code', client_id: CLAUDE, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' });
      if (o.kind !== 'consent') throw new Error('no consent');
      const oc = new URL(other.decide(o.id, 1, true, o.binding)?.redirect as string);
      const ot = other.token({ grant_type: 'authorization_code', code: oc.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: CLAUDE, code_verifier: verifier });
      expect(other.verify(ot.access_token)).not.toBeNull();
      expect(oauth.verify(ot.access_token)).toBeNull();
      // Old codes and tokens go; a connection without tokens goes after a day.
      now += 2 * 86_400_000;
      oauth.prune(now);
      expect(ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM mcp_codes')?.n).toBe(0);
    })();
  });
});

describe('access ends with the connection (FD-MCP §5)', () => {
  it('when the user disconnects, signs out everywhere, is disabled, or Claude revokes', async () => {
    await start();
    const t1 = await connect(ana);
    const id = (await get('/api/mcp/status', page(ana))).json().connections[0].id;
    // Not someone else's to end.
    expect((await app.inject({ method: 'DELETE', url: `/api/mcp/connections/${id}`, headers: page(1) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/mcp/connections/${id}`, headers: page(ana) })).statusCode).toBe(200);
    expect(ctx.oauth?.verify(t1.access_token)).toBeNull();
    expect((await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: t1.refresh_token })).json().error).toBe('invalid_grant');

    const t2 = await connect(ana);
    expect((await app.inject({ method: 'POST', url: '/api/account/logout-all', headers: page(ana), payload: '{}' })).statusCode).toBe(200);
    expect(ctx.oauth?.verify(t2.access_token)).toBeNull();

    const t3 = await connect(ana);
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${ana}/disable`, headers: page(1), payload: '{}' })).statusCode).toBe(200);
    expect(ctx.oauth?.verify(t3.access_token)).toBeNull();
    ctx.db.run('UPDATE users SET disabled_at = NULL WHERE id = ?', [ana]);
    expect(ctx.oauth?.verify(t3.access_token)).toBeNull();

    const t4 = await connect(ana);
    // A disabled account stops at once even before the grants are touched.
    ctx.db.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [ana]);
    expect(ctx.oauth?.verify(t4.access_token)).toBeNull();
    ctx.db.run('UPDATE users SET disabled_at = NULL WHERE id = ?', [ana]);
    expect(ctx.oauth?.verify(t4.access_token)).not.toBeNull();
    expect((await form('/oauth/revoke', { token: t4.refresh_token })).statusCode).toBe(200);
    expect(ctx.oauth?.verify(t4.access_token)).toBeNull();
    expect((await form('/oauth/revoke', { token: 'unknown' })).statusCode).toBe(200);

    // Deleting the user takes everything with it.
    await connect(ana);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${ana}`, headers: page(1) })).statusCode).toBe(200);
    expect(ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM mcp_grants WHERE user_id = ?', [ana])?.n).toBe(0);
  });
});

describe('registration and the HTTP guards', () => {
  it('registers only Claude-like public clients (DCR) and lets them connect', async () => {
    await start();
    const reg = (body: unknown) => app.inject({ method: 'POST', url: '/oauth/register', headers: { host: HOST, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
    expect((await reg({ redirect_uris: ['https://evil.example/cb'] })).json().error).toBe('invalid_redirect_uri');
    expect((await reg({ redirect_uris: [] })).json().error).toBe('invalid_redirect_uri');
    expect((await reg({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post' })).json().error).toBe('invalid_client_metadata');
    expect((await reg({ redirect_uris: [CALLBACK], grant_types: ['client_credentials'] })).json().error).toBe('invalid_client_metadata');
    const ok = await reg({ redirect_uris: [CALLBACK], client_name: 'Claude', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
    expect(ok.statusCode).toBe(201);
    const client = ok.json();
    expect(client).toMatchObject({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' });
    // A name cannot carry line breaks into the log (or anything else invisible onto the page).
    expect((await reg({ redirect_uris: [CALLBACK], client_name: 'Claude\n2026-10-13T00:00:00Z INFO users: fake\u2028x' })).json().client_name).toBe('Claude 2026-10-13T00:00:00Z INFO users: fake x');
    const { verifier, challenge } = pkce();
    const cb = await approve(ana, claudeAuthorize(challenge, { client_id: client.client_id }));
    const t = await form('/oauth/token', { grant_type: 'authorization_code', code: cb.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier });
    expect(t.statusCode).toBe(200);
    expect((await get(claudeAuthorize(challenge, { client_id: 'sq_dcr_unknown' }))).statusCode).toBe(400);
    // Eleven registrations an hour from one address are too many.
    for (let i = 0; i < 8; i++) await reg({ redirect_uris: [CALLBACK] });
    expect((await reg({ redirect_uris: [CALLBACK] })).statusCode).toBe(429);
  });

  it('keeps the Host and Origin checks on the connector and never reads a token from the URL', async () => {
    await start();
    const { access_token } = await connect(ana);
    const call = (headers: Record<string, string>, url = '/mcp') =>
      app.inject({ method: 'POST', url, headers: { host: HOST, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, payload: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    expect((await call({ authorization: `Bearer ${access_token}`, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call({ authorization: `Bearer ${access_token}`, host: 'evil.example' })).statusCode).toBe(403);
    expect((await call({}, `/mcp?access_token=${access_token}`)).statusCode).toBe(401);
    // The consent API is a page API: it still needs the CSRF header.
    const a = await get(claudeAuthorize(pkce().challenge));
    const id = new URL(String(a.headers.location), BASE).searchParams.get('req') as string;
    const { 'x-sentiq': _csrf, ...noCsrf } = page(ana);
    expect((await app.inject({ method: 'POST', url: `/api/oauth/requests/${id}`, headers: noCsrf, payload: JSON.stringify({ approve: true }) })).statusCode).toBe(403);
  });
});

describe('the helpers', () => {
  it('match callbacks the way RFC 8252 and the MCP spec ask', () => {
    expect(classifyRedirect(CALLBACK, ['claude.ai'])).toEqual({ host: 'claude.ai', loopback: false });
    expect(classifyRedirect('http://127.0.0.1:9/cb', ['claude.ai'])).toEqual({ host: '127.0.0.1', loopback: true });
    expect(classifyRedirect('http://claude.ai/api/mcp/auth_callback', ['claude.ai'])).toBeNull();
    expect(classifyRedirect('https://claude.ai.evil.example/cb', ['claude.ai'])).toBeNull();
    expect(classifyRedirect(`${CALLBACK}#x`, ['claude.ai'])).toBeNull();
    expect(redirectMatches('http://localhost:5000/callback', 'http://localhost/callback')).toBe(true);
    expect(redirectMatches('http://127.0.0.1:5000/callback', 'http://localhost/callback')).toBe(false);
    expect(redirectMatches('https://claude.ai:444/api/mcp/auth_callback', CALLBACK)).toBe(false);
    expect(docTtl('public, max-age=300')).toBe(300_000);
    expect(docTtl('max-age=5')).toBe(60_000);
    expect(docTtl('max-age=999999')).toBe(3_600_000);
    expect(docTtl(null)).toBe(300_000);
  });
});
