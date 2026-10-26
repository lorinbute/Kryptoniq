import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createContext, type AppContext } from './context.ts';
import { testDb } from './test/db.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import { silentLogger } from './log.ts';
import { setFetchImpl } from './net/http.ts';
import { SecretBox, secretHint } from './secrets/crypto.ts';
import { hostnameOf, isLocalHost, isLocalOrigin } from './http/security.ts';
import { Scheduler } from './jobs/scheduler.ts';
import type { NliScorer } from './sentiment/local.ts';
import { costBasis } from './exchange/cost-basis.ts';
import { BrokerError } from './exchange/brokers.ts';
import { hasRiskyPermissions, keyPermissions, mapExchangeError, orderPositionSide, positionSideOf, stopDirection, type ClientFactory } from './exchange/accounts.ts';
import { isRateLimitError, isTransientError, withRetry } from './exchange/retry.ts';
import { MarketData } from './market/market.ts';
import { deepMerge } from './settings.ts';
import ccxt from 'ccxt';
import { hashPassword } from './auth/passwords.ts';

// Every API route needs a signed-in user (FD-USERS): H / M carry the admin's session cookie, set in beforeEach.
const H: Record<string, string> = { host: '127.0.0.1:4317' };
const M: Record<string, string> = { ...H, 'x-sentiq': '1', 'content-type': 'application/json' };
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin-password-1';
let adminHash = '';
beforeAll(async () => {
  adminHash = await hashPassword(ADMIN_PASSWORD);
});

const fakeNli: NliScorer = {
  status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }),
  warmUp: () => {},
  score: async (t: string) => (/surge|rally/i.test(t) ? 0.8 : /hack|crash/i.test(t) ? -0.8 : 0),
  onReady: () => {},
};

/** Calls to the fake closed-position history, and switches for its failures (FD-TRADESTATS). */
const history = { calls: 0, fail: false, futuresFail: false, orderReads: 0 };

/** Minimal fake of the ccxt calls used by the portfolio. */
function fakeClients(): ClientFactory {
  const spot = {
    options: {} as Record<string, unknown>,
    markets: { 'BTC/USDT': {} },
    isUTAEnabled: async () => false,
    loadMigrationStatus: async function (this: { options: Record<string, unknown> }) {
      this.options.hf = false;
    },
    fetchBalance: async (params?: { type?: string }) =>
      params?.type === 'main'
        ? { total: { USDT: 100 }, free: { USDT: 100 }, used: {} }
        : params?.type === 'contract'
          ? history.futuresFail
            ? Promise.reject(new ccxt.PermissionDenied('kucoin {"code":"400007","msg":"Access denied, require more permission."}'))
            : { total: { USDT: 300 }, free: { USDT: 250 }, used: { USDT: 50 } }
          : { total: { BTC: 0.5, USDT: 0 }, free: { BTC: 0.4 }, used: { BTC: 0.1 } },
    // FD-TRADESTATS: two wins (one in BTC), one loss, one at zero, all closed an hour ago.
    fetchPositionsHistory: async () => {
      history.calls++;
      if (history.fail) throw new ccxt.NetworkError('kucoin ETIMEDOUT');
      return [
      { id: 'c1', symbol: 'ETH/USDT:USDT', realizedPnl: 12.5, lastUpdateTimestamp: Date.now() - 3_600_000 },
      { id: 'c2', symbol: 'XRP/USDT:USDT', realizedPnl: -4, lastUpdateTimestamp: Date.now() - 3_600_000 },
      { id: 'c3', symbol: 'SOL/USDT:USDT', realizedPnl: 0, lastUpdateTimestamp: Date.now() - 3_600_000 },
      { id: 'c4', symbol: 'BTC/USD:BTC', realizedPnl: 0.001, lastUpdateTimestamp: Date.now() - 3_600_000 },
      ];
    },
    fetchTicker: async (symbol: string) => ({ symbol, last: symbol === 'BTC/USDT' ? 82000 : undefined }),
    fetchPositions: async () => [
      { symbol: 'ETH/USDT:USDT', side: 'long', contracts: 2, contractSize: 0.01, entryPrice: 2500, markPrice: 2600, unrealizedPnl: 2, percentage: 4, liquidationPrice: 2000, leverage: 5, marginMode: 'isolated', notional: 52 },
      { symbol: 'XRP/USDT:USDT', side: 'long', contracts: 0 },
    ],
    fetchOpenOrders: async (_s?: string, _since?: number, _l?: number, params?: { trigger?: boolean }) =>
      (history.orderReads++, params?.trigger) ? [{ id: 'o1', symbol: 'BTC/USDT', type: 'limit', side: 'sell', price: 90000, triggerPrice: 89000, amount: 0.1, filled: 0, status: 'open', timestamp: 1 }] : [{ id: 'o1', symbol: 'BTC/USDT', type: 'limit', side: 'sell', price: 90000, amount: 0.1, filled: 0, status: 'open', timestamp: 1 }],
    fetchMyTrades: async () => [
      { id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 60000, amount: 0.3, cost: 18000, fee: { cost: 18, currency: 'USDT' }, timestamp: Date.now() - 86_400_000 },
      { id: 't2', symbol: 'BTC/USDT', side: 'buy', price: 80000, amount: 0.2, cost: 16000, fee: { cost: 16, currency: 'USDT' }, timestamp: Date.now() - 3_600_000 },
    ],
    fetchTickers: async () => ({ 'BTC/USDT': { last: 82000 } }),
    privateGetUserApiKey: async () => ({ data: { permission: 'General,Spot' } }),
  };
  const futures = { fetchOpenOrders: async () => [], fetchMyTrades: async () => [] };
  return () => ({ spot: spot as never, futures: futures as never });
}

/**
 * The AI providers' model lists (FD-AIKEYS): a key with "refused" in it is refused, Anthropic cannot be reached.
 * Nothing leaves the machine.
 */
const aiFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.hostname === 'api.openai.com' && url.pathname === '/v1/models') {
    if (headers.get('authorization')?.includes('refused')) return json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
    return json(200, { data: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-7-nova', 'gpt-4o', 'gpt-6-luna-2026-09-01', 'tts-1'].map((id) => ({ id, object: 'model' })) });
  }
  if (url.hostname === 'generativelanguage.googleapis.com') {
    if (headers.get('x-goog-api-key')?.includes('refused')) return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
    return json(200, { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
  }
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}) as typeof fetch;

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'kq-test-'));
  const config = { ...loadConfig({ KRYPTONIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'no-web') };
  ctx = await createContext(config, silentLogger, {
    nli: fakeNli,
    clientFactory: fakeClients(),
    box: new SecretBox(Buffer.alloc(32, 7)),
    retryDelaysMs: [0, 0],
    db: await testDb(),
    ai: { http: { fetch: aiFetch, sleep: async () => {} } },
  });
  app = await buildApp(ctx);
  // FD-2FA: a session reaches the app only for an account with two-factor.
  await ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, totp_confirmed_at = 1 WHERE id = 1', [ADMIN_EMAIL, 'Admin', adminHash]);
  H.cookie = M.cookie = `sentiq_session=${await ctx.sessions.create(1, 'full')}`;
});

afterEach(async () => {
  setFetchImpl(null);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('security', () => {
  it('host / origin helpers', () => {
    expect(hostnameOf('localhost:4317')).toBe('localhost');
    expect(hostnameOf('[::1]:4317')).toBe('[::1]');
    expect(isLocalHost('127.0.0.1:5317')).toBe(true);
    expect(isLocalHost('evil.com')).toBe(false);
    expect(isLocalHost('localhost.evil.com:80')).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
    expect(isLocalOrigin('http://127.0.0.1:5317')).toBe(true);
    expect(isLocalOrigin('https://evil.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
  it('rejects foreign Host headers (DNS rebinding) and foreign origins', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { ...H, origin: 'https://evil.com' } })).statusCode).toBe(403);
    const health = await app.inject({ method: 'GET', url: '/api/health', headers: H });
    expect(health.statusCode).toBe(200);
    // FD-AIKEYS: the common score is local; nobody has their own AI score the news yet; no key of Sentiq's to count.
    expect(health.json().sentiment).toMatchObject({ engine: 'local', aiUsers: 0 });
    expect(health.json()).not.toHaveProperty('claudeUsage');
  });
  it('requires the CSRF header and JSON for mutations', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'x-sentiq': '1', 'content-type': 'text/plain' }, payload: 'timezone=UTC' })).statusCode).toBe(415);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { timezone: 'UTC' } })).statusCode).toBe(200);
    // A tab opened before the rename still sends X-Kryptoniq (FD-SENTIQ §1).
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'x-kryptoniq': '1', 'content-type': 'application/json' }, payload: { timezone: 'UTC' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'x-sentiq': '0', 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(403);
  });
  it('reads SENTIQ_* settings and falls back to the KRYPTONIQ_* names; an existing kryptoniq.db is kept', () => {
    expect(loadConfig({ SENTIQ_PORT: '5000' } as NodeJS.ProcessEnv).port).toBe(5000);
    expect(loadConfig({ KRYPTONIQ_PORT: '5001' } as NodeJS.ProcessEnv).port).toBe(5001);
    expect(loadConfig({ SENTIQ_PORT: '5000', KRYPTONIQ_PORT: '5001' } as NodeJS.ProcessEnv).port).toBe(5000);
    const d = mkdtempSync(path.join(tmpdir(), 'sq-cfg-'));
    try {
      expect(path.basename(loadConfig({ SENTIQ_DATA_DIR: d } as NodeJS.ProcessEnv).legacyDbPath)).toBe('sentiq.db');
      writeFileSync(path.join(d, 'kryptoniq.db'), '');
      expect(path.basename(loadConfig({ SENTIQ_DATA_DIR: d } as NodeJS.ProcessEnv).legacyDbPath)).toBe('kryptoniq.db');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('sets hardening headers and returns JSON 404 for unknown API routes', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/nope', headers: H });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const page = await app.inject({ method: 'GET', url: '/charts/BTC/USDT', headers: H });
    expect(page.statusCode).toBe(404); // no web build in tests
    expect(page.body).toMatch(/web build missing/);
  });
  it('nothing moves funds; orders (and their changes), leverage and margin only in exchange/trading/ (FD-TRADING, FD-ORDEREDIT, TD §2.7)', () => {
    const root = fileURLToPath(new URL('./', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);
    const tradingDir = path.join(root, 'exchange', 'trading') + path.sep;
    for (const p of files) {
      const text = readFileSync(p, 'utf8');
      const rel = path.relative(root, p);
      // Withdrawals, transfers and the blanket calls exist nowhere.
      expect(text, rel).not.toMatch(/\b(withdraw|transfer|cancelAllOrders|closeAllPositions)\s*\(/);
      if (p.startsWith(tradingDir)) continue;
      expect(text, rel).not.toMatch(/\b(createOrder|cancelOrder|editOrder|setLeverage|setMarginMode)\s*\(/);
      // The other exchange / broker modules only read.
      if (rel.startsWith(`exchange${path.sep}`)) expect(text, rel).not.toMatch(/'(POST|DELETE|PUT|PATCH)'/);
    }
  });
});

describe('the removed AI connector (FD-MCPREMOVE)', () => {
  it('its addresses no longer exist: a plain 404, never the page, and no token', async () => {
    for (const url of ['/mcp', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/oauth/consent', '/oauth/authorize?client_id=x']) {
      const r = await app.inject({ method: 'GET', url, headers: H });
      expect(r.statusCode, url).toBe(404);
      expect(r.json().error.code, url).toBe('NOT_FOUND');
    }
    const token = await app.inject({ method: 'POST', url: '/oauth/token', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'grant_type=refresh_token&refresh_token=x' });
    expect([403, 404]).toContain(token.statusCode);
    expect(JSON.stringify(token.json())).not.toContain('access_token');
    expect((await app.inject({ method: 'GET', url: '/api/mcp/status', headers: H })).statusCode).toBe(404);
  });
});

describe('secrets', () => {
  it('round-trips and detects tampering', () => {
    const box = new SecretBox(Buffer.alloc(32, 1));
    const sealed = box.encrypt('my-secret');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(box.decrypt(sealed)).toBe('my-secret');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 2)).decrypt(sealed)).toThrow();
  });
  it('creates a 0600 master key file once', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'kq-key-'));
    const a = SecretBox.load(d, {} as NodeJS.ProcessEnv);
    const b = SecretBox.load(d, {} as NodeJS.ProcessEnv);
    expect(b.decrypt(a.encrypt('x'))).toBe('x');
    expect(statSync(path.join(d, 'master.key')).mode & 0o777).toBe(0o600);
    rmSync(d, { recursive: true, force: true });
  });
  it('hints never reveal more than 8 characters', () => {
    expect(secretHint('abcdefghijklmnop')).toBe('abcd…mnop');
    expect(secretHint('short')).toBe('••••');
  });
});

describe('settings API', () => {
  it('returns defaults and merges partial updates with validation', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(s.indicator.lenFastEma).toBe(38);
    expect(s.aiKeys).toEqual({ anthropic: { set: false, hint: null }, openai: { set: false, hint: null }, gemini: { set: false, hint: null } });
    expect(s.ai).toEqual({ provider: 'anthropic', scoring: false });
    const r = await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { indicator: { lenFastEma: 21 }, scanner: { tf: '4h' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().indicator).toMatchObject({ lenFastEma: 21, lenSlowEma: 62 });
    expect(r.json().scanner.tf).toBe('4h');
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { timezone: 'Mars/Olympus' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { indicator: { lenFastEma: -3 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { retentionDays: 3 } })).statusCode).toBe(400);
    // nothing partially saved
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json().indicator.lenFastEma).toBe(21);
  });
  it("stores the user's own AI key encrypted once its provider accepts it, and only returns a hint (FD-AIKEYS)", async () => {
    const put = (provider: string, key: string | null) => app.inject({ method: 'PUT', url: '/api/ai/key', headers: M, payload: { provider, key } });
    const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
    const r = await put('openai', key);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ aiKeys: { openai: { set: true, hint: 'sk-p…wxyz' }, anthropic: { set: false } }, aiKeyWarning: null });
    expect(JSON.stringify(r.json())).not.toContain(key);
    const raw = await ctx.db.get<{ secret: string }>("SELECT secret FROM user_keys WHERE user_id = 1 AND name = 'openai'");
    expect(raw?.secret).not.toContain('abcdefghij');
    expect((await ctx.settings.getAiKeys(1)).openai).toBe(key);
    // The models the key can use: Sentiq's current ones first, then the others; no audio, old or dated ones.
    expect((await app.inject({ url: '/api/ai/models?provider=openai', headers: H })).json()).toEqual({ models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-7-nova'], source: 'key', error: null });
    expect((await app.inject({ url: '/api/ai/models?provider=gemini', headers: H })).json()).toMatchObject({ source: 'default', models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'] });
    // A key the provider refuses is not saved; a malformed one is never sent.
    const bad = await put('gemini', 'AIzaSy-refused-key-0123456789');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('Google nu a acceptat cheia: cheia API Google nu este validă.');
    expect((await put('gemini', 'two words')).statusCode).toBe(400);
    expect((await ctx.settings.getAiKeys(1)).gemini).toBeUndefined();
    // A provider that cannot be reached now: the key is saved, with a warning.
    const offline = await put('anthropic', 'sk-ant-api03-offline-abcdefghijklmnop');
    expect(offline.statusCode).toBe(200);
    expect(offline.json().aiKeyWarning).toMatch(/^Cheia s-a salvat, dar nu a putut fi verificată acum \(nu se poate conecta la Anthropic \(ECONNREFUSED\)\)\.$/);
    // The user's AI: the provider chosen (Anthropic by default), its key; the scores stay local until they choose.
    const status = async () => (await app.inject({ url: '/api/ai/status', headers: H })).json();
    expect(await status()).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', keySet: true, scoring: false, scorer: null, usage: { summary: { calls: 0 } }, progress: null });
    expect((await app.inject({ method: 'POST', url: '/api/ai/rescore', headers: M, payload: {} })).statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { provider: 'openai', model: 'gpt-6-luna', scoring: true } } });
    expect(await status()).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', keySet: true, scoring: true, scorer: { provider: 'openai', model: 'gpt-6-luna', lastError: null } });
    // FD-AISLOW §4: how far it got with the last 48 hours, while it scores.
    expect((await status()).progress).toEqual({ total: expect.any(Number), scored: 0, lastAt: null });
    expect((await app.inject({ method: 'POST', url: '/api/ai/rescore', headers: M, payload: {} })).json()).toEqual({ reset: 0 });
    // A model of another provider is not used: the provider's default is.
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { model: 'claude-haiku-5-5' } } });
    expect((await status()).model).toBe('gpt-6.1-sol');
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { model: 'Bad Model!' } } })).statusCode).toBe(400);
    // Removed: the scores go back to the local model, the summary waits for a key.
    expect((await put('openai', null)).json().aiKeys.openai).toEqual({ set: false, hint: null });
    expect(await status()).toMatchObject({ keySet: false, scorer: null, progress: null });
    // The old admin-only route is gone.
    expect((await app.inject({ method: 'PUT', url: '/api/settings/claude-key', headers: M, payload: { key: null } })).statusCode).toBe(404);
  });
  it('a key or AI choice saved again lifts the pause of the AI scoring, on any instance (FD-AIQUOTA §2)', async () => {
    const state = JSON.stringify({ sig: 'anthropic|claude-opus-5-5|x', lastError: { at: 1, message: 'm', permanent: false }, pausedUntil: Date.now() + 1_800_000 });
    const paused = async () => {
      await ctx.db.run("DELETE FROM market_cache WHERE [key] = N'ai:scorer:1'");
      await ctx.db.run("INSERT INTO market_cache([key], value, fetched_at) VALUES (N'ai:scorer:1', ?, 1)", [state]);
    };
    const stored = async () => (await ctx.db.get("SELECT 1 AS x FROM market_cache WHERE [key] = N'ai:scorer:1'")) !== undefined;
    const put = (provider: string, key: string | null) => app.inject({ method: 'PUT', url: '/api/ai/key', headers: M, payload: { provider, key } });
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { provider: 'anthropic', scoring: false } } });
    await paused();
    // The key of another provider than the one in use: the pause stays.
    expect((await put('openai', 'sk-proj-abcdefghijklmnopqrstuvwxyz')).statusCode).toBe(200);
    expect(await stored()).toBe(true);
    // The key of the AI in use, even one that could not be checked: tried again at once.
    expect((await put('anthropic', 'sk-ant-api03-offline-abcdefghijklmnop')).statusCode).toBe(200);
    expect(await stored()).toBe(false);
    // Another AI choice: the same; a setting that is not the AI's: not.
    await paused();
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { indicator: { lenFastEma: 22 } } });
    expect(await stored()).toBe(true);
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { scoring: true } } });
    expect(await stored()).toBe(false);
    await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { ai: { scoring: false } } });
    await put('openai', null);
    await put('anthropic', null);
  });
  it('remembers the chart settings and the LMA inputs (FD-CHARTUX)', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(s.charts).toEqual({ symbol: '', showPositions: true, showLma: true, showSlingshot: true, slingshotHidden: false, lmaHidden: false, lmaPane: 0.25, logScale: false, listId: null });
    expect(s.lma).toMatchObject({ preset: 'Default', period: 100, steepness: 2.5, maType: 'EMA', smooth: 10, colorBars: true });
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: M,
      payload: { charts: { symbol: 'SOL/USDT', showLma: false, showSlingshot: false, logScale: true }, market: { defaultTf: '4h' }, lma: { preset: 'Scalping', maType: 'VWMA' } },
    });
    expect(r.statusCode).toBe(200);
    // Both indicators off: a chart with candles only (FD-CHARTFAV §1). The price scale stays logarithmic (FD-CHARTTV §4).
    expect(r.json().charts).toEqual({ symbol: 'SOL/USDT', showPositions: true, showLma: false, showSlingshot: false, slingshotHidden: false, lmaHidden: false, lmaPane: 0.25, logScale: true, listId: null });
    expect(r.json().market.defaultTf).toBe('4h');
    expect(r.json().lma).toMatchObject({ preset: 'Scalping', maType: 'VWMA', period: 100 });
    for (const bad of [
      { charts: { symbol: '../etc/passwd' } },
      { charts: { symbol: 'sol/usdt' } },
      { charts: { lmaPane: 0.95 } },
      { charts: { showSlingshot: 'no' } },
      { charts: { logScale: 'yes' } },
      { lma: { period: 300 } },
      { lma: { shortThreshold: 0.5 } },
      { lma: { bullishColor: 'red' } },
    ]) {
      expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: bad })).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { charts: { symbol: '' } } })).json().charts.symbol).toBe('');
    // Settings saved by an older version (without charts / lma) still load, with the defaults for the new groups.
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 1', [JSON.stringify({ timezone: 'UTC', market: { defaultTf: '15m' }, charts: { symbol: 42 } })]);
    ctx.settings.forget();
    const old = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(old.market.defaultTf).toBe('15m');
    expect(old.charts.symbol).toBe('');
    expect(old.charts.logScale).toBe(false);
    expect(old.lma.period).toBe(100);
  });
  it('deepMerge ignores prototype keys', () => {
    const out = deepMerge({ a: { b: 1 } }, JSON.parse('{"__proto__": {"polluted": true}, "a": {"c": 2}}')) as Record<string, unknown>;
    expect(out).toEqual({ a: { b: 1, c: 2 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('watchlist & sources API', () => {
  it('seeds a default watchlist and supports add / reorder / aliases / delete', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/watchlist', headers: H })).json();
    expect(list.map((w: { coin: string }) => w.coin)).toEqual(['BTC', 'ETH', 'SOL']);
    const added = await app.inject({ method: 'POST', url: '/api/watchlist', headers: M, payload: { coin: 'rndr', aliases: ['Render Network'] } });
    expect(added.statusCode).toBe(200);
    expect(added.json().at(-1)).toMatchObject({ coin: 'RNDR', quote: 'USDT', aliases: ['Render Network'] });
    expect((await app.inject({ method: 'POST', url: '/api/watchlist', headers: M, payload: { coin: 'RNDR' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/watchlist', headers: M, payload: { coin: 'BAD COIN' } })).statusCode).toBe(400);
    const ordered = await app.inject({ method: 'PUT', url: '/api/watchlist/order', headers: M, payload: { coins: ['SOL', 'BTC', 'ETH', 'RNDR'] } });
    expect(ordered.json().map((w: { coin: string }) => w.coin)).toEqual(['SOL', 'BTC', 'ETH', 'RNDR']);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/RNDR', headers: M })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/RNDR', headers: M })).statusCode).toBe(404);
  });

  it('adds stocks next to coins (FD-SENTIQ §4.1): default aliases, one symbol per kind, its own Nasdaq feed', async () => {
    const add = (payload: object) => app.inject({ method: 'POST', url: '/api/watchlist', headers: M, payload });
    const r = await add({ kind: 'stock', coin: 'brk.b', name: 'Berkshire Hathaway Inc. Class B', exchange: 'nyse' });
    expect(r.statusCode).toBe(200);
    expect(r.json().at(-1)).toEqual({ coin: 'BRK.B', quote: 'USD', position: 3, aliases: ['Berkshire Hathaway'], kind: 'stock', name: 'Berkshire Hathaway Inc. Class B', exchange: 'NYSE' });
    // FD-WATCHLISTS: the older route adds to the first list ("Favorite").
    expect((await add({ kind: 'stock', coin: 'BRK.B' })).json().error.message).toBe('BRK.B e deja în Favorite');
    expect((await add({ kind: 'crypto', coin: 'BTC' })).json().error.message).toBe('BTC e deja în Favorite');
    expect((await add({ kind: 'stock', coin: 'BTC' })).statusCode).toBe(409);
    expect((await add({ kind: 'stock', coin: '1ABC' })).statusCode).toBe(400);
    expect((await add({ kind: 'bond', coin: 'X' })).statusCode).toBe(400);
    const feeds = await ctx.db.all<{ id: string; auto: string }>("SELECT id, auto FROM sources WHERE auto IS NOT NULL");
    expect(feeds).toEqual([{ id: 'nasdaq-brk-b', auto: 'nasdaq:BRK.B' }]);
    // Dotted tickers work in the addresses of the other routes too.
    expect((await app.inject({ method: 'PUT', url: '/api/watchlist/BRK.B', headers: M, payload: { aliases: ['Buffett'] } })).json().at(-1).aliases).toEqual(['Buffett']);
    expect((await app.inject({ method: 'PUT', url: '/api/watchlist/BRK.B', headers: M, payload: { quote: 'EUR' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/watchlist/order', headers: M, payload: { coins: ['BRK.B', 'BTC', 'ETH', 'SOL'] } })).json()[0].coin).toBe('BRK.B');
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/BRK.B', headers: M })).statusCode).toBe(200);
    expect(await ctx.db.all('SELECT id FROM sources WHERE auto IS NOT NULL')).toEqual([]);
  });

  it('adds indices (FD-INDICES): by symbol or id, kept under the id, next to a coin of the same ticker', async () => {
    const add = (payload: object) => app.inject({ method: 'POST', url: '/api/watchlist', headers: M, payload });
    await ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES ('n-spx', 'coindesk', 'S&P 500 closes at a record', ?, ?, 'macro', 1, 1, 'c-spx')`,
      [Date.now() - 60_000, Date.now()],
    );
    const r = await add({ kind: 'index', coin: 'spx' });
    expect(r.statusCode).toBe(200);
    // The recent news are tagged again with the new favourite's aliases (in the background, FD-WATCHLISTS).
    await ctx.retag.idle();
    expect(await ctx.db.all("SELECT coin FROM news_coins WHERE news_id = 'n-spx'")).toEqual([{ coin: '^SPX' }]);
    expect(r.json().at(-1)).toMatchObject({ coin: '^SPX', quote: 'USD', aliases: ['S&P 500', 'S&P500', 'SPX'], kind: 'index', name: 'S&P 500', exchange: null });
    expect((await add({ kind: 'index', coin: '^SPX' })).json().error.message).toBe('SPX e deja în Favorite');
    // SPX6900, the coin, is another symbol for Sentiq.
    expect((await add({ kind: 'crypto', coin: 'SPX' })).statusCode).toBe(200);
    const unknown = await add({ kind: 'index', coin: 'DAX' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.message).toMatch(/Indice necunoscut/);
    // An index has no feed of its own (FD-AUTOFEED is for shares).
    expect(await ctx.db.all('SELECT id FROM sources WHERE auto IS NOT NULL')).toEqual([]);
    // The "^" in the addresses of the other routes.
    const aliased = await app.inject({ method: 'PUT', url: '/api/watchlist/%5ESPX', headers: M, payload: { aliases: ['S&P 500', 'Wall Street'] } });
    expect(aliased.json().find((w: { coin: string }) => w.coin === '^SPX').aliases).toEqual(['S&P 500', 'Wall Street']);
    const quote = await app.inject({ method: 'PUT', url: '/api/watchlist/%5ESPX', headers: M, payload: { quote: 'EUR' } });
    expect(quote.json().error.message).toBe('Indicii sunt cotați în USD');
    const ordered = await app.inject({ method: 'PUT', url: '/api/watchlist/order', headers: M, payload: { coins: ['^SPX', 'SPX', 'BTC', 'ETH', 'SOL'] } });
    expect(ordered.json().map((w: { coin: string; kind: string }) => `${w.kind}:${w.coin}`).slice(0, 2)).toEqual(['index:^SPX', 'crypto:SPX']);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/%5ESPX', headers: M })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/%5ESPX', headers: M })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/SPX', headers: M })).statusCode).toBe(200);
    // FD-INDEXNEWS §7: the S&P 500 is one of the filter indices, named for everybody's filter, in the favourites or not.
    await ctx.retag.idle();
    expect(await ctx.db.all("SELECT coin FROM news_coins WHERE news_id = 'n-spx'")).toEqual([{ coin: '^SPX' }]);
    await ctx.db.run("DELETE FROM news WHERE id = 'n-spx'");
  });

  it('lists sources, protects built-ins and adds a tested custom feed', async () => {
    const sources = (await app.inject({ method: 'GET', url: '/api/sources', headers: H })).json();
    expect(sources.length).toBeGreaterThan(20);
    expect((await app.inject({ method: 'DELETE', url: '/api/sources/coindesk', headers: M })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/api/sources/coindesk', headers: M, payload: { name: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/sources/coindesk', headers: M, payload: { enabled: false, weight: 0.5 } })).json()).toMatchObject({ enabled: 0, weight: 0.5 });
    setFetchImpl(async () => new Response('<rss><channel><item><title>Hello</title><link>https://x.com/1</link></item></channel></rss>', { status: 200 }));
    const test = await app.inject({ method: 'POST', url: '/api/sources/test', headers: M, payload: { url: 'https://example.com/feed' } });
    expect(test.json()).toMatchObject({ ok: true, count: 1, sample: ['Hello'] });
    const added = await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'Example', url: 'https://example.com/feed', category: 'crypto' } });
    expect(added.statusCode).toBe(200);
    const id = added.json().id as string;
    expect(id.startsWith('custom-')).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'Again', url: 'https://example.com/feed', category: 'crypto' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${id}`, headers: M })).statusCode).toBe(200);
    setFetchImpl(async () => new Response('<html>blocked</html>', { status: 200 }));
    expect((await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'Bad', url: 'https://bad.example/feed', category: 'macro' } })).statusCode).toBe(400);
  });

  it('adds a general source (FD-MULTICAT), refuses one without a category, and reclassifies its news when they change', async () => {
    setFetchImpl(async () => new Response('<rss><channel><item><title>Hello</title><link>https://x.com/1</link></item></channel></rss>', { status: 200 }));
    const none = await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'None', url: 'https://none.example/feed', categories: [] } });
    expect(none.statusCode).toBe(400);
    expect(none.json().error.message).toMatch(/Alege cel puțin o categorie/);
    expect((await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'None', url: 'https://none.example/feed' } })).statusCode).toBe(400);
    const added = await app.inject({ method: 'POST', url: '/api/sources', headers: M, payload: { name: 'Benzinga', url: 'https://benzinga.example/feed', categories: ['geopolitics', 'macro', 'stocks', 'crypto'] } });
    expect(added.json()).toMatchObject({ category: 'crypto', categories: 'crypto,stocks,macro,geopolitics' });
    const id = added.json().id as string;
    const at = Date.now() - 60_000;
    await ctx.db.run(
      "INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES ('bz1', ?, 'Fed holds interest rates steady', ?, ?, 'crypto', 0, 1, 'bz1')",
      [id, at, at],
    );
    // Crypto and stocks only: a Fed story is about neither (relevance 0); with macro again, it is macro.
    const narrowed = await app.inject({ method: 'PUT', url: `/api/sources/${id}`, headers: M, payload: { categories: ['stocks', 'crypto'] } });
    expect(narrowed.json()).toMatchObject({ category: 'crypto', categories: 'crypto,stocks' });
    expect(await ctx.db.get("SELECT category, relevance FROM news WHERE id = 'bz1'")).toEqual({ category: 'crypto', relevance: 0 });
    await app.inject({ method: 'PUT', url: `/api/sources/${id}`, headers: M, payload: { categories: ['macro', 'crypto'] } });
    expect(await ctx.db.get("SELECT category, relevance FROM news WHERE id = 'bz1'")).toEqual({ category: 'macro', relevance: 1 });
    // One category again: every item takes it.
    const one = await app.inject({ method: 'PUT', url: `/api/sources/${id}`, headers: M, payload: { categories: ['stocks'] } });
    expect(one.json()).toMatchObject({ category: 'stocks', categories: null });
    expect(await ctx.db.get("SELECT category FROM news WHERE id = 'bz1'")).toEqual({ category: 'stocks' });
    // Built-in sources keep their category.
    expect((await app.inject({ method: 'PUT', url: '/api/sources/coindesk', headers: M, payload: { categories: ['crypto', 'macro'] } })).statusCode).toBe(400);
  });
});

describe('news & sentiment API', () => {
  it('ingests, scores and serves news; filters never change the daily index', async () => {
    const now = Date.now();
    const rss = (items: string[]) =>
      `<rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>https://n.example/${encodeURIComponent(t)}-${i}</link><pubDate>${new Date(now - (i + 1) * 60_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
    setFetchImpl(async (url) =>
      String(url).includes('coindesk')
        ? new Response(rss(['Bitcoin surges to a record', 'Solana exchange hacked, funds stolen']), { status: 200 })
        : new Response(rss([]), { status: 200 }),
    );
    const { fetchDueSources } = await import('./news/fetcher.ts');
    await fetchDueSources(ctx.db, ctx.coins, silentLogger);
    expect(await ctx.sentiment.pendingCount()).toBe(2);
    await ctx.sentiment.scorePending();
    expect(await ctx.sentiment.pendingCount()).toBe(0);

    const all = (await app.inject({ method: 'GET', url: '/api/news?range=24h', headers: H })).json();
    expect(all.items).toHaveLength(2);
    const btc = all.items.find((i: { title: string }) => i.title.startsWith('Bitcoin'));
    expect(btc.coins).toEqual(['BTC']);
    expect(btc.sentiment.label).toBe('positive');

    const fav = (await app.inject({ method: 'GET', url: '/api/news?range=24h&favorites=1&coins=SOL', headers: H })).json();
    expect(fav.items.map((i: { title: string }) => i.title)).toEqual(['Solana exchange hacked, funds stolen']);
    expect((await app.inject({ method: 'GET', url: '/api/news?range=24h&sentiment=negative', headers: H })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/news?range=24h&q=%25', headers: H })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/news?range=forever', headers: H })).statusCode).toBe(400);

    const today = (await app.inject({ method: 'GET', url: '/api/sentiment/today', headers: H })).json();
    expect(today.counts).toMatchObject({ positive: 1, negative: 1, pending: 0 });
    // Drivers carry their category and coins, for the topic icon (FD-ICONS).
    expect(today.drivers.positive[0]).toMatchObject({ title: 'Bitcoin surges to a record', category: 'crypto', coins: ['BTC'] });
    expect(today.drivers.negative[0]).toMatchObject({ title: 'Solana exchange hacked, funds stolen', category: 'crypto', coins: ['SOL'] });
    // The index ignores news filters: it is the same object no matter what the news list shows.
    const again = (await app.inject({ method: 'GET', url: '/api/sentiment/today', headers: H })).json();
    expect(again.index).toBe(today.index);

    const rescore = await app.inject({ method: 'POST', url: '/api/sentiment/rescore', headers: M, payload: { hours: 24 } });
    expect(rescore.json().reset).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/api/sentiment/history?days=500', headers: H })).statusCode).toBe(400);
  });

  it('pagination with cursor returns disjoint pages', async () => {
    const now = Date.now();
    await ctx.db.tx(async () => {
      for (let i = 0; i < 7; i++) {
        await ctx.db.run(
          `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES (?, 'coindesk', ?, ?, ?, 'crypto', 1, 1, ?)`,
          [`${String(i).padStart(40, '0')}`, `Story ${i}`, now - i * 1000, now, `c${i}`],
        );
      }
    });
    const p1 = (await app.inject({ method: 'GET', url: '/api/news?limit=3', headers: H })).json();
    const p2 = (await app.inject({ method: 'GET', url: `/api/news?limit=3&cursor=${p1.nextCursor}`, headers: H })).json();
    expect(p1.items.map((i: { title: string }) => i.title)).toEqual(['Story 0', 'Story 1', 'Story 2']);
    expect(p2.items.map((i: { title: string }) => i.title)).toEqual(['Story 3', 'Story 4', 'Story 5']);
  });
});

describe('daily snapshots', () => {
  it('freezes a day only after the grace period and once its news are scored', async () => {
    const tz = (await ctx.settings.get()).timezone;
    const { dayBounds, dayKey, addDays } = await import('../shared/time.ts');
    const now = Date.now();
    const yesterday = addDays(dayKey(now, tz), -1);
    const { start, end } = dayBounds(yesterday, tz);
    // Collection started yesterday; the feeds' backlog also carried one item from the day before.
    await ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES (?, 'coindesk', 'Bitcoin surges', ?, ?, 'crypto', 1, 1, 'c1')`,
      ['a'.repeat(40), start + 3_600_000, start + 3_600_000],
    );
    await ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES (?, 'coindesk', 'Solana rallies', ?, ?, 'crypto', 1, 1, 'c2')`,
      ['b'.repeat(40), start - 5 * 3_600_000, start + 3_600_000],
    );
    const final = async () => (await ctx.db.get<{ final: number }>('SELECT final FROM daily_sentiment WHERE day = ? AND tz = ?', [yesterday, tz]))?.final;
    const backlogDay = () => ctx.db.get('SELECT day FROM daily_sentiment WHERE day = ? AND tz = ?', [addDays(yesterday, -1), tz]);
    await ctx.daily.refresh(end + 3 * 3_600_000);
    expect(await final()).toBe(0); // the only news is still pending
    await ctx.sentiment.scorePending();
    await ctx.daily.refresh(end + 30 * 60_000);
    expect(await final()).toBe(0); // inside the 2 h grace period
    await ctx.daily.refresh(end + 3 * 3_600_000);
    expect(await final()).toBe(1);
    expect(await backlogDay()).toBeUndefined(); // before the first collection day: not part of the history
  });
});

describe('calendar API', () => {
  it('validates ranges and manages custom events', async () => {
    const from = Date.now();
    expect((await app.inject({ method: 'GET', url: `/api/calendar?from=${from}&to=${from - 1}`, headers: H })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/calendar?from=${from}&to=${from + 90 * 86_400_000}`, headers: H })).statusCode).toBe(400);
    const add = await app.inject({ method: 'POST', url: '/api/calendar/custom', headers: M, payload: { title: 'ETH upgrade', ts: from + 3_600_000, impact: 'High' } });
    expect(add.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: `/api/calendar?from=${from}&to=${from + 86_400_000}&impact=High`, headers: H })).json();
    expect(list.events).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/calendar/custom/${add.json().id}`, headers: M })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/calendar/custom/${add.json().id}`, headers: M })).statusCode).toBe(404);
  });
});

describe('accounts & portfolio', () => {
  it('after a trading action: a read started before it is not kept; the orders taken off stay hidden (FIX-SLTPDUP)', async () => {
    const acc = (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' } })).json();
    expect((await ctx.accounts.portfolio(acc.id)).orders.map((o) => o.id)).toEqual(['o1']);
    // A read on its way when the order changes: its answer may be the old one, so the next read goes to the platform.
    const before = ctx.accounts.portfolio(acc.id, true);
    ctx.accounts.invalidate(acc.id);
    await before;
    const reads = history.orderReads;
    await ctx.accounts.portfolio(acc.id);
    expect(history.orderReads).toBeGreaterThan(reads);
    // The platform still lists a cancelled order for a moment: hidden, from the cache too.
    ctx.accounts.forgetOrders(acc.id, ['o1']);
    expect((await ctx.accounts.portfolio(acc.id)).orders).toEqual([]);
    expect((await ctx.accounts.portfolio(acc.id, true)).orders).toEqual([]);
  });


  it('stores keys encrypted, warns on extra permissions and builds the portfolio', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789' } });
    expect(bad.statusCode).toBe(400); // passphrase required
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' } });
    expect(r.statusCode).toBe(200);
    const acc = r.json();
    expect(acc).toMatchObject({ label: 'Main', keyHint: 'key-…6789', permissions: 'General,Spot', permissionWarning: true });
    expect(JSON.stringify(acc)).not.toContain('secret-123456789');
    const row = await ctx.db.get<{ api_key: string; secret: string }>('SELECT api_key, secret FROM exchange_accounts');
    expect(row?.secret).not.toContain('secret-123');

    const p = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}`, headers: H })).json();
    expect(p.mode).toBe('classic');
    const btc = p.balances.find((b: { asset: string }) => b.asset === 'BTC');
    // 0.3 @ 60k + 0.2 @ 80k (+ 34 USDT fees) → 68 068 avg
    expect(btc).toMatchObject({ total: 0.5, used: 0.1, price: 82000, avgSource: 'fills' });
    expect(btc.avgPrice).toBeCloseTo((18000 + 16000 + 34) / 0.5, 6);
    expect(p.positions).toHaveLength(1);
    expect(p.positions[0]).toMatchObject({ symbol: 'ETH/USDT:USDT', size: 0.02, leverage: 5 });
    expect(p.orders).toHaveLength(1); // the same order from the normal and the trigger listing counts once
    expect(p.totals.spotValue).toBeCloseTo(0.5 * 82000 + 100, 6);
    // FD-TRADESTATS: the free USDT of the futures account.
    expect(p.totals.futuresAvailable).toBe(250);
    const stats = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?period=7d`, headers: H })).json();
    expect(stats).toMatchObject({ period: '7d', supported: true, wins: 2, losses: 1, breakeven: 1, successRate: 66.7, netPartial: false, error: null });
    expect(stats.net).toBeCloseTo(12.5 - 4 + 0.001 * 82000, 6);
    expect((await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?period=1y`, headers: H })).statusCode).toBe(400);
    // Kept 5 minutes; "force" (Reîmprospătează) reads again; a failure is shown, not kept.
    const calls = history.calls;
    await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?period=7d`, headers: H });
    expect(history.calls).toBe(calls);
    history.fail = true;
    const failed = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?period=7d&force=1`, headers: H })).json();
    expect(failed).toMatchObject({ supported: true, wins: null, net: null, error: { code: 'NETWORK' } });
    history.fail = false;
    expect((await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?period=7d`, headers: H })).json()).toMatchObject({ wins: 2, error: null });
    // The futures account unreadable: no number, the error kept apart from the sections' warnings.
    history.futuresFail = true;
    const pf = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}?force=1`, headers: H })).json();
    expect(pf.totals.futuresAvailable).toBeNull();
    // ccxt's PermissionDenied is an AuthenticationError: shown as a key problem.
    expect(pf.errors.futures).toMatchObject({ code: 'AUTH' });
    history.futuresFail = false;
    // Kraken: no futures here, no closed-position history.
    const kr = (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kraken', label: 'K', apiKey: 'key-123456789', secret: 'secret-123456789' } })).json();
    expect((await app.inject({ method: 'GET', url: `/api/portfolio/${kr.id}`, headers: H })).json().totals.futuresAvailable).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/portfolio/${kr.id}/stats`, headers: H })).json()).toMatchObject({ period: '30d', supported: false, wins: null });
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${kr.id}`, headers: M })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/portfolio/999/stats', headers: H })).statusCode).toBe(404);

    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${acc.id}/cost-basis/BTC`, headers: M, payload: { avgPrice: 50000 } })).statusCode).toBe(200);
    const p2 = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}`, headers: H })).json();
    expect(p2.balances.find((b: { asset: string }) => b.asset === 'BTC')).toMatchObject({ avgPrice: 50000, avgSource: 'manual' });
    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${acc.id}/cost-basis/BTC`, headers: M, payload: { avgPrice: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/portfolio/999', headers: H })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${acc.id}`, headers: M })).statusCode).toBe(200);
    expect((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM cost_basis'))?.n).toBe(0);
  });

  it('keeps the last good section data (marked stale) when a refresh of that section fails', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' } });
    const id = r.json().id as number;
    const first = (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();
    expect(first.positions).toHaveLength(1);
    expect(first.stale).toEqual({});
    // Make positions fail from now on.
    const clients = (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: { fetchPositions: () => Promise<unknown> } } }> }).clients;
    clients.get(id)!.clients.spot.fetchPositions = async () => {
      throw new ccxt.NetworkError('down');
    };
    const second = (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();
    expect(second.errors.positions.code).toBe('NETWORK');
    expect(second.positions).toHaveLength(1);
    expect(second.stale.positions).toBe(first.fetchedAt);
    expect(second.stale.balances).toBeUndefined();
  });

  it('maps ccxt errors and flags risky permissions', () => {
    expect(mapExchangeError(new ccxt.AuthenticationError('x')).code).toBe('AUTH');
    expect(mapExchangeError(new ccxt.RateLimitExceeded('x')).code).toBe('RATE_LIMIT');
    expect(mapExchangeError(new ccxt.RequestTimeout('x')).code).toBe('NETWORK');
    expect(mapExchangeError(new Error('x')).code).toBe('EXCHANGE');
    expect(hasRiskyPermissions('General')).toBe(false);
    expect(hasRiskyPermissions('General,Spot')).toBe(true);
    expect(hasRiskyPermissions(null)).toBe(false);
    // KuCoin stop direction (FD-PNL): futures down/up, spot loss/entry
    expect(stopDirection({ stop: 'down' })).toBe('down');
    expect(stopDirection({ stop: 'loss' })).toBe('down');
    expect(stopDirection({ stop: 'up' })).toBe('up');
    expect(stopDirection({ stop: 'entry' })).toBe('up');
    expect(stopDirection({ stop: '' })).toBeNull();
    expect(stopDirection(undefined)).toBeNull();
    // FD-KUCOINHEDGE: the side KuCoin names in hedge mode wins over the size's sign; one-way (BOTH) keeps ccxt's.
    expect(positionSideOf({ side: 'long', info: { positionSide: 'SHORT' } })).toBe('short');
    expect(positionSideOf({ side: 'short', info: { positionSide: 'long' } })).toBe('long');
    expect(positionSideOf({ side: 'short', info: { positionSide: 'BOTH' } })).toBe('short');
    expect(positionSideOf({ side: undefined, info: {} })).toBeNull();
    expect(orderPositionSide({ positionSide: 'SHORT' })).toBe('short');
    expect(orderPositionSide({ positionSide: 'BOTH' })).toBeNull();
    expect(orderPositionSide(undefined)).toBeNull();
    // FD-HEDGEALL: OKX / Bitget `posSide` (net in one-way), Bybit `positionIdx` (0 in one-way).
    expect(orderPositionSide({ posSide: 'long' })).toBe('long');
    expect(orderPositionSide({ posSide: 'net' })).toBeNull();
    expect(orderPositionSide({ positionIdx: 2 })).toBe('short');
    expect(orderPositionSide({ positionIdx: '1' })).toBe('long');
    expect(orderPositionSide({ positionIdx: 0 })).toBeNull();
    expect(positionSideOf({ side: 'long', info: { positionIdx: 2 } })).toBe('short');
  });
});

describe('exchange rate limits (TD-RATELIMIT)', () => {
  const kucoin429 = () => new ccxt.ExchangeError('kucoin {"code":"429000","msg":"Too many requests. System-level rate limit exceeded."}');
  type FakeSpot = {
    markets: Record<string, { id?: string }> | undefined;
    loadMarkets?: (reload?: boolean) => Promise<unknown>;
    fetchTickers: () => Promise<unknown>;
    fetchTicker?: (symbol: string) => Promise<unknown>;
    publicGetMarketOrderbookLevel1?: (p: { symbol: string }) => Promise<unknown>;
  };
  const addAccount = async (label = 'Main'): Promise<number> =>
    (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label, apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' } })).json().id as number;
  const spotOf = (id: number) => (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: FakeSpot } }> }).clients.get(id)!.clients.spot;
  const snapshots = () => (ctx.accounts as unknown as { snapshots: Map<string, { at: number }> }).snapshots;
  const load = async (id: number) => (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();
  const btcOf = (p: { balances: { asset: string; price: number | null }[] }) => p.balances.find((b) => b.asset === 'BTC');

  it('recognises KuCoin 429000 and retries only passing failures', async () => {
    expect(isRateLimitError(kucoin429())).toBe(true);
    expect(mapExchangeError(kucoin429()).code).toBe('RATE_LIMIT');
    expect(isRateLimitError(new ccxt.ExchangeError('kucoin {"code":"400100","msg":"bad"}'))).toBe(false);
    expect(isTransientError(new ccxt.NetworkError('reset'))).toBe(true);
    expect(isTransientError(new ccxt.RequestTimeout('slow'))).toBe(false);
    expect(isTransientError(new ccxt.OnMaintenance('later'))).toBe(false);
    expect(isTransientError(new ccxt.AuthenticationError('bad key'))).toBe(false);

    let n = 0;
    const flaky = async () => {
      n++;
      if (n < 3) throw kucoin429();
      return 'ok';
    };
    await expect(withRetry(flaky, { delaysMs: [0, 0] })).resolves.toBe('ok');
    expect(n).toBe(3);
    n = 0;
    const refused = async () => {
      n++;
      throw kucoin429();
    };
    await expect(withRetry(refused, { delaysMs: [0, 0] })).rejects.toThrow('429000');
    expect(n).toBe(3);
    n = 0;
    const badKey = async () => {
      n++;
      throw new ccxt.AuthenticationError('bad key');
    };
    await expect(withRetry(badKey, { delaysMs: [0, 0] })).rejects.toThrow('bad key');
    expect(n).toBe(1);
    const waits: number[] = [];
    n = 0;
    const net = async () => {
      n++;
      if (n < 3) throw new ccxt.NetworkError('reset');
      return 1;
    };
    await withRetry(net, { delaysMs: [1000, 4000], sleep: async (ms) => void waits.push(ms) });
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(750);
    expect(waits[0]).toBeLessThanOrEqual(1250);
    expect(waits[1]).toBeGreaterThanOrEqual(3000);
    expect(waits[1]).toBeLessThanOrEqual(5000);
  });

  it('retries a refused ticker list and shares it between accounts', async () => {
    const a = await addAccount('A');
    const b = await addAccount('B');
    const spot = spotOf(a);
    const real = spot.fetchTickers;
    let calls = 0;
    spot.fetchTickers = async () => {
      calls++;
      if (calls === 1) throw kucoin429();
      return real();
    };
    const pa = await load(a);
    expect(btcOf(pa)?.price).toBe(82000);
    expect(pa.errors.prices).toBeUndefined();
    expect(calls).toBe(2);
    const pb = await load(b);
    expect(btcOf(pb)?.price).toBe(82000);
    expect(calls).toBe(2); // the list is kept 15 s for every account
  });

  it('prices held coins one by one when the list is refused, then leaves the list alone for a minute', async () => {
    const id = await addAccount();
    const spot = spotOf(id);
    let listCalls = 0;
    spot.fetchTickers = async () => {
      listCalls++;
      throw kucoin429();
    };
    spot.fetchTicker = async () => ({ last: 81000 });
    const p = await load(id);
    expect(btcOf(p)?.price).toBe(81000);
    expect(p.errors.prices).toBeUndefined();
    expect(p.stale.prices).toBeUndefined();
    expect(listCalls).toBe(3);

    // KuCoin: the light best-bid/ask call with the exchange's own market id.
    spot.markets = { 'BTC/USDT': { id: 'BTC-USDT' } };
    const asked: string[] = [];
    spot.publicGetMarketOrderbookLevel1 = async ({ symbol }) => {
      asked.push(symbol);
      return { data: { price: '80500' } };
    };
    const p2 = await load(id);
    expect(btcOf(p2)?.price).toBe(80500);
    expect(asked).toEqual(['BTC-USDT']);
    expect(listCalls).toBe(3); // cooldown: the refused list is not asked again right away
  });

  it('asks again for a market list that failed to load (ccxt would replay the old error)', async () => {
    const id = await addAccount();
    const spot = spotOf(id);
    const markets = spot.markets;
    spot.markets = undefined;
    const loads: (boolean | undefined)[] = [];
    spot.loadMarkets = async (reload) => {
      loads.push(reload);
      spot.markets = markets;
      return markets;
    };
    expect(btcOf(await load(id))?.price).toBe(82000);
    expect(loads).toEqual([true]);
    await load(id);
    expect(loads).toEqual([true]); // loaded now: not asked again
  });

  it('does not retry reads on a client whose market list failed (ccxt replays that error at once)', async () => {
    const id = await addAccount();
    const spot = spotOf(id) as FakeSpot & { fetchPositions: () => Promise<unknown> };
    spot.markets = undefined;
    let loads = 0;
    spot.loadMarkets = async () => {
      loads++;
      throw kucoin429();
    };
    let positions = 0;
    spot.fetchPositions = async () => {
      positions++;
      throw kucoin429();
    };
    const p = await load(id);
    expect(loads).toBe(3);
    expect(positions).toBe(1);
    expect(p.errors.positions.code).toBe('RATE_LIMIT');
  });

  it('treats an empty ticker list as a failure', async () => {
    const id = await addAccount();
    const spot = spotOf(id);
    spot.fetchTickers = async () => ({});
    spot.fetchTicker = async () => ({ last: 79000 });
    expect(btcOf(await load(id))?.price).toBe(79000);
  });

  it('falls back to the last good prices (marked stale), then to none after an hour', async () => {
    const id = await addAccount();
    const first = await load(id);
    expect(btcOf(first)?.price).toBe(82000);
    const snap = snapshots().get('kucoin')!;
    snap.at -= 20_000;
    const spot = spotOf(id);
    spot.fetchTickers = async () => {
      throw kucoin429();
    };
    spot.fetchTicker = async () => {
      throw kucoin429();
    };
    const p = await load(id);
    expect(btcOf(p)?.price).toBe(82000);
    expect(p.errors.prices.code).toBe('RATE_LIMIT');
    expect(p.stale.prices).toBe(snap.at);

    snap.at -= 3_700_000;
    const p2 = await load(id);
    expect(btcOf(p2)?.price).toBeNull();
    expect(p2.errors.prices.code).toBe('RATE_LIMIT');
    expect(p2.stale.prices).toBeUndefined();
    expect(p2.totals.spotValue).toBe(100);
  });

  it('retries a refused candle request and explains a lasting limit in words', async () => {
    const markets = { 'BTC/USDT': { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', spot: true, precision: { price: 0.1 } } };
    let calls = 0;
    const fake = {
      id: 'kucoin',
      markets,
      timeframes: { '1h': '1hour' },
      precisionMode: ccxt.TICK_SIZE,
      loadMarkets: async () => markets,
      fetchOHLCV: async (_s: string, _tf: string, since: number) => {
        calls++;
        if (calls === 1) throw kucoin429();
        return [[since, 1, 2, 0.5, 1.5, 10]];
      },
    };
    const md = new MarketData({ factory: () => fake as never, retryDelaysMs: [0, 0] });
    const r = await md.candles('kucoin', 'BTC/USDT', '1h', 3);
    expect(calls).toBeGreaterThan(1);
    expect(r.candles.length).toBeGreaterThan(0);

    const refused = { ...fake, fetchOHLCV: async () => Promise.reject(kucoin429()) };
    const md2 = new MarketData({ factory: () => refused as never, retryDelaysMs: [0, 0] });
    await expect(md2.candles('kucoin', 'BTC/USDT', '1h', 3)).rejects.toThrow('kucoin: exchange-ul limitează temporar cererile');

    // Like ccxt: without `reload`, a failed market load is replayed instead of asked again.
    let loads = 0;
    let lastLoad: Promise<unknown> | undefined;
    const replaying = {
      ...fake,
      markets: undefined as unknown,
      loadMarkets(this: { markets: unknown }, reload?: boolean) {
        if (!reload && lastLoad) return lastLoad;
        loads++;
        lastLoad = loads <= 3 ? Promise.reject(kucoin429()) : Promise.resolve((this.markets = markets));
        return lastLoad;
      },
      fetchOHLCV: async (_s: string, _tf: string, since: number) => [[since, 1, 2, 0.5, 1.5, 10]],
    };
    const md3 = new MarketData({ factory: () => replaying as never, retryDelaysMs: [0, 0] });
    await expect(md3.candles('kucoin', 'BTC/USDT', '1h', 3)).rejects.toThrow('nu se poate încărca lista de piețe (exchange-ul limitează temporar cererile');
    expect(loads).toBe(3);
    expect((await md3.candles('kucoin', 'BTC/USDT', '1h', 3)).candles.length).toBeGreaterThan(0);
    expect(loads).toBe(4);
  });

  it('keeps the old market list when the daily refresh fails and tries again after 5 minutes', async () => {
    const markets = { 'BTC/USDT': { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', spot: true, precision: { price: 0.1 } } };
    let t = Date.now();
    let loads = 0;
    let failing = false;
    const fake = {
      id: 'kucoin',
      markets: undefined as unknown,
      timeframes: { '1h': '1hour' },
      precisionMode: ccxt.TICK_SIZE,
      async loadMarkets(this: { markets: unknown }) {
        loads++;
        if (failing) throw kucoin429();
        return (this.markets = markets);
      },
      fetchOHLCV: async (_s: string, _tf: string, since: number) => [[since, 1, 2, 0.5, 1.5, 10]],
    };
    const md = new MarketData({ factory: () => fake as never, retryDelaysMs: [0, 0], now: () => t });
    await md.candles('kucoin', 'BTC/USDT', '1h', 3);
    expect(loads).toBe(1);
    t += 25 * 3_600_000;
    failing = true;
    expect((await md.candles('kucoin', 'BTC/USDT', '1h', 3)).candles.length).toBeGreaterThan(0); // old list still used
    expect(loads).toBe(4); // one refresh, retried twice
    t += 60_000;
    await md.candles('kucoin', 'BTC/USDT', '1h', 3);
    expect(loads).toBe(4); // not on every request
    t += 5 * 60_000;
    failing = false;
    await md.candles('kucoin', 'BTC/USDT', '1h', 3);
    expect(loads).toBe(5);
  });
});

describe('accounts through the wizard (FD-SENTIQ §2)', () => {
  const t212 = { exchange: 'trading212', label: 'T212', env: 'demo', credentials: { apiKey: 'KEY1234567890', secret: 'SECRET12345' } };
  const route = (handler: (u: URL) => { status?: number; body: unknown } | undefined) =>
    setFetchImpl((async (input: string | URL | Request) => {
      const u = new URL(String(input));
      const r = handler(u);
      if (!r) throw new Error(`unexpected ${u}`);
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch);

  it("validates each provider's own fields and refuses unknown platforms (FD-NOAPI: XTB is no longer listed)", async () => {
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload });
    expect((await post({ exchange: 'xtb', label: 'x', credentials: {} })).json().error.message).toBe('Platformă necunoscută: xtb');
    expect((await post({ exchange: 'nope', label: 'x', credentials: {} })).statusCode).toBe(400);
    expect((await post({ exchange: 'ibkr', label: 'IB', credentials: { token: 'abc', queryId: '123' } })).json().error.message).toContain('doar cifre');
    expect((await post({ exchange: 'coinbase', label: 'CB', credentials: { apiKey: 'not-a-cdp-name', secret: 'x'.repeat(40) } })).json().error.message).toContain('organizations/');
    expect((await post({ ...t212, env: 'paper' })).statusCode).toBe(400);
    expect((await post({ exchange: 'okx', label: 'OKX', credentials: { apiKey: 'k1234567', secret: 's1234567' } })).json().error.message).toContain('Passphrase');
    expect((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM exchange_accounts'))?.n).toBe(0);
  });

  it('keeps an account only when the first read works, and stores its fields encrypted', async () => {
    route((u) => (u.pathname.endsWith('/account/summary') ? { status: 401, body: 'Bad API key' } : undefined));
    const bad = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: t212 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('Trading 212');
    expect((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM exchange_accounts'))?.n).toBe(0);

    route((u) => {
      if (u.pathname.endsWith('/account/summary')) return { body: { currency: 'EUR', cash: { availableToTrade: 50 } } };
      if (u.pathname.endsWith('/equity/positions')) return { body: [{ instrument: { ticker: 'AAPL_US_EQ', currency: 'USD', name: 'Apple' }, quantity: 2, averagePricePaid: 100, currentPrice: 120, walletImpact: { currency: 'EUR', currentValue: 220, totalCost: 185, unrealizedProfitLoss: 35 } }] };
      if (u.pathname.endsWith('/equity/orders')) return { body: [] };
      if (u.pathname.endsWith('/history/orders')) return { body: { items: [] } };
      return undefined;
    });
    const ok = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: t212 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ exchange: 'trading212', kind: 'stocks', env: 'demo', label: 'T212', keyHint: 'KEY1…7890', lastError: null });
    const row = await ctx.db.get<{ credentials: string; api_key: string }>('SELECT credentials, api_key FROM exchange_accounts');
    expect(row?.credentials).not.toContain('SECRET12345');
    expect(row?.api_key).toBe('');
    const p = (await app.inject({ method: 'GET', url: `/api/portfolio/${ok.json().id}`, headers: H })).json();
    expect(p).toMatchObject({ kind: 'stocks', currency: 'EUR', cash: 50, asOf: null });
    expect(p.balances[0]).toMatchObject({ asset: 'AAPL', avgSource: 'broker', priceCurrency: 'USD', currency: 'EUR' });
    // A price set by hand still wins over the broker's.
    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${ok.json().id}/cost-basis/AAPL`, headers: M, payload: { avgPrice: 90 } })).statusCode).toBe(200);
    const p2 = (await app.inject({ method: 'GET', url: `/api/portfolio/${ok.json().id}`, headers: H })).json();
    expect(p2.balances[0]).toMatchObject({ avgPrice: 90, avgSource: 'manual', pnl: null });
    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${ok.json().id}/cost-basis/BRK.B`, headers: M, payload: { avgPrice: 400 } })).statusCode).toBe(200);
  });

  it("a broker's closed trades: one history serves every period, in the account's currency (FD-BROKERSTATS)", async () => {
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const now = Date.now();
    const sold = (id: number, ago: number, pnl: number) => ({ order: { id, ticker: 'AAPL_US_EQ', side: 'SELL' }, fill: { id: id * 10, type: 'TRADE', filledAt: new Date(now - ago).toISOString(), quantity: -1, price: 100, walletImpact: { currency: 'EUR', realisedProfitLoss: pnl } } });
    let history = 0;
    route((u) => {
      if (u.pathname.endsWith('/account/summary')) return { body: { currency: 'EUR', cash: { availableToTrade: 50 } } };
      if (u.pathname.endsWith('/equity/positions') || u.pathname.endsWith('/equity/orders')) return { body: [] };
      if (u.pathname.endsWith('/history/orders')) {
        history++;
        return { body: { items: [sold(5, HOUR, 12), sold(4, 2 * DAY, -3), sold(3, 3 * DAY, 0), sold(2, 20 * DAY, 40), sold(1, 100 * DAY, 1)] } };
      }
      return undefined;
    });
    const acc = (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: t212 })).json();
    const stats = async (q: string) => (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}/stats?${q}`, headers: H })).json();
    const before = history;
    expect(await stats('period=7d')).toMatchObject({ period: '7d', supported: true, wins: 1, losses: 1, breakeven: 1, successRate: 50, net: 9, netPartial: false, currency: 'EUR', limited: false, unknownResults: 0, asOf: null, error: null });
    expect(await stats('period=30d')).toMatchObject({ wins: 2, losses: 1, breakeven: 1, net: 49, currency: 'EUR' });
    // One read of the history for both periods; "Reîmprospătează" reads it again.
    expect(history - before).toBe(1);
    await stats('period=30d&force=1');
    expect(history - before).toBe(2);

    // A broker whose report ends before the period (IBKR, „Azi”): no numbers, with the day the data ends.
    const brokers = (ctx.accounts as unknown as { brokers: Map<number, { adapter: unknown; at: number }> }).brokers;
    const asOf = now - 2 * DAY;
    const fake = (extra: object) => brokers.set(acc.id, { adapter: { test: async () => {}, load: async () => ({ currency: 'USD', balances: [], positions: [], orders: [], fills: [], cash: null, errors: {} }), ...extra }, at: Date.now() });
    fake({ closedTrades: async () => ({ currency: 'USD', trades: [{ id: 'x', closedAt: now - 3 * DAY, pnl: 5, net: 5 }, { id: 'y', closedAt: now - 3 * DAY, pnl: null, net: null }], coveredFrom: now - 4 * DAY, asOf }) });
    expect(await stats('period=today&force=1')).toMatchObject({ supported: true, wins: null, net: null, asOf, error: null });
    // Counted where the report reaches; a period longer than the history read is marked.
    expect(await stats('period=7d&force=1')).toMatchObject({ wins: 1, net: 5, currency: 'USD', asOf, limited: true, unknownResults: 1 });
    fake({ closedTrades: async () => Promise.reject(new BrokerError('PERMISSION', 'Trading 212: activează permisiunea „history:orders” la cheia API')) });
    expect(await stats('period=7d&force=1')).toMatchObject({ supported: true, wins: null, error: { code: 'PERMISSION' } });
    // An adapter without a closed-trade history.
    fake({});
    expect(await stats('period=7d&force=1')).toMatchObject({ supported: false, wins: null });
  });

  it('a crypto exchange that needs a symbol for fills is read pair by pair', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'binance', label: 'BN', credentials: { apiKey: 'k1234567', secret: 's1234567' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ exchange: 'binance', kind: 'crypto', env: 'live' });
    const id = r.json().id as number;
    const spot = (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: Record<string, unknown> } }> }).clients.get(id)!.clients.spot;
    const asked: (string | undefined)[] = [];
    const realTrades = spot.fetchMyTrades as (...a: unknown[]) => Promise<unknown>;
    spot.fetchMyTrades = async (sym?: string, ...rest: unknown[]) => {
      asked.push(sym);
      if (sym === undefined) throw new ccxt.ArgumentsRequired('binance fetchMyTrades() requires a symbol argument');
      return realTrades(sym, ...rest);
    };
    const p = (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();
    expect(asked).toEqual([undefined, 'BTC/USDT']);
    expect(p.errors.fills).toBeUndefined();
    expect(p.fills.length).toBeGreaterThan(0);
    expect(p).toMatchObject({ kind: 'crypto', currency: 'USDT', mode: 'unknown' });
    expect(p.balances.map((b: { account: string }) => b.account)).toEqual(expect.arrayContaining(['spot']));
  });
});

describe('open orders of the other exchanges (FD-TRADING §4)', () => {
  type Params = Record<string, unknown> | undefined;
  const add = async (exchange: string) =>
    (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange, label: exchange, credentials: { apiKey: 'k1234567', secret: 's1234567' } } })).json().id as number;
  const spotOf = (id: number) => (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: Record<string, unknown> } }> }).clients.get(id)!.clients.spot;
  const order = (id: string, symbol: string, extra: object = {}) => ({ id, symbol, type: 'limit', side: 'buy', price: 60000, amount: 0.01, filled: 0, status: 'open', timestamp: 1, ...extra });
  const portfolio = async (id: number) => (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();

  it('lists futures and stop orders too, each under its market; a key without futures keeps the spot ones, without an error', async () => {
    const bn = await add('binance');
    const asked: Params[] = [];
    spotOf(bn).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      asked.push(params);
      if (params?.type === 'swap') return [params.trigger ? order('f2', 'BTC/USDT:USDT', { type: 'market', side: 'sell', price: null, triggerPrice: 70000 }) : order('f1', 'BTC/USDT:USDT')];
      return [order('s1', 'BTC/USDT')];
    };
    const p = await portfolio(bn);
    expect(p.errors.orders).toBeUndefined();
    expect(p.orders.map((o: { market: string; id: string }) => `${o.market}:${o.id}`).sort()).toEqual(['futures:f1', 'futures:f2', 'spot:s1']);
    expect(asked).toEqual(expect.arrayContaining([{}, { type: 'swap', subType: 'linear' }, { type: 'swap', subType: 'linear', trigger: true }]));
    spotOf(bn).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      if (params?.type === 'swap') throw new ccxt.PermissionDenied('binance {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}');
      return [order('s1', 'BTC/USDT')];
    };
    const p2 = await portfolio(bn);
    expect(p2.errors.orders).toBeUndefined();
    expect(p2.orders.map((o: { id: string }) => o.id)).toEqual(['s1']);
    // Not asked again for a while; "Testează" asks again.
    let asks = 0;
    spotOf(bn).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      if (params?.type === 'swap') asks++;
      return [order('s1', 'BTC/USDT')];
    };
    await portfolio(bn);
    expect(asks).toBe(0);
    await app.inject({ method: 'POST', url: `/api/accounts/${bn}/test`, headers: M });
    await portfolio(bn);
    expect(asks).toBe(2);
    // Binance's -2015 once a call has succeeded (ccxt raises it as DDoSProtection): skipped at once, not retried.
    let tries = 0;
    const bn2 = await add('binance');
    spotOf(bn2).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      if (params?.type === 'swap') {
        tries++;
        throw new ccxt.DDoSProtection('binance {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}');
      }
      return [order('s1', 'BTC/USDT')];
    };
    expect((await portfolio(bn2)).errors.orders).toBeUndefined();
    expect(tries).toBe(2);
    // Any other failure marks the section, as for the plain listing.
    const bn3 = await add('binance');
    spotOf(bn3).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      if (params?.type === 'swap') throw new ccxt.ExchangeNotAvailable('binance 503');
      return [order('s1', 'BTC/USDT')];
    };
    expect((await portfolio(bn3)).errors.orders).toBeDefined();
  });

  it('FD-ORDEREDIT: OKX and Bitget TP / SL orders read in their own listings, with their levels', async () => {
    const withPass = async (exchange: string) =>
      (await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange, label: exchange, credentials: { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' } } })).json().id as number;
    const ok = await withPass('okx');
    const asked: Params[] = [];
    spotOf(ok).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      asked.push(params);
      // OKX's oco: both levels in one order, no trigger of its own.
      if (params?.ordType === 'conditional,oco') return [order('a1', 'BTC/USDT:USDT', { type: 'market', side: 'sell', price: null, stopLossPrice: 57000, takeProfitPrice: 65000, reduceOnly: true })];
      return [];
    };
    const p = await portfolio(ok);
    expect(asked).toEqual(expect.arrayContaining([{ method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' }]));
    expect(p.orders).toEqual([expect.objectContaining({ id: 'a1', market: 'futures', triggerPrice: null, stopLoss: 57000, takeProfit: 65000, reduceOnly: true })]);
    const bg = await withPass('bitget');
    const bgAsked: Params[] = [];
    spotOf(bg).fetchOpenOrders = async (_s?: string, _since?: number, _l?: number, params?: Params) => {
      bgAsked.push(params);
      if (params?.planType === 'profit_loss') return [order('t1', 'BTC/USDT:USDT', { type: 'market', side: 'sell', price: null, triggerPrice: 57000, reduceOnly: true })];
      return [];
    };
    const q = await portfolio(bg);
    expect(bgAsked).toEqual(expect.arrayContaining([{ type: 'swap', productType: 'USDT-FUTURES', planType: 'profit_loss' }]));
    expect(q.orders).toEqual([expect.objectContaining({ id: 't1', market: 'futures', triggerPrice: 57000 })]);
  });

  it('Bybit: the plain listings ask for spot (its client defaults to linear); the linear orders come on their own', async () => {
    const by = await add('bybit');
    const orders: unknown[] = [];
    const fills: unknown[] = [];
    spotOf(by).fetchOpenOrders = async (_s?: string, _since?: number, limit?: number, params?: Params) => {
      orders.push({ limit, ...params });
      return params?.type === 'spot' ? [order('s1', 'BTC/USDT')] : [order('f1', 'BTC/USDT:USDT')];
    };
    spotOf(by).fetchMyTrades = async (_s?: string, _since?: number, limit?: number, params?: Params) => {
      fills.push({ limit, ...params });
      const symbol = params?.type === 'spot' ? 'BTC/USDT' : 'BTC/USDT:USDT';
      return [{ id: `x-${symbol}`, symbol, side: 'buy', price: 60000, amount: 0.01, cost: 600, timestamp: Date.now() - 3_600_000 }];
    };
    const p = await portfolio(by);
    expect(orders).toHaveLength(2);
    expect(orders).toEqual(expect.arrayContaining([{ limit: 50, type: 'spot' }, { limit: 50, type: 'swap', subType: 'linear', settleCoin: 'USDT' }]));
    expect(fills).toEqual([{ limit: 100, type: 'spot' }, { limit: 100, type: 'swap', subType: 'linear' }]);
    expect(p.orders.map((o: { market: string; id: string }) => `${o.market}:${o.id}`).sort()).toEqual(['futures:f1', 'spot:s1']);
    // A perpetual's fill is never a spot one (it does not count toward a spot cost).
    expect(p.fills.map((f: { market: string; symbol: string }) => `${f.market}:${f.symbol}`).sort()).toEqual(['futures:BTC/USDT:USDT', 'spot:BTC/USDT']);
  });
});

describe('key permissions of the other exchanges (FD-SENTIQ §2)', () => {
  const client = (methods: Record<string, () => Promise<unknown>>) => methods as never;
  it('reads what a key may do and warns beyond reading', async () => {
    const bn = await keyPermissions('binance', client({ sapiGetAccountApiRestrictions: async () => ({ enableReading: true, enableWithdrawals: true, enableSpotAndMarginTrading: false }) }));
    expect(bn).toBe('read,withdraw');
    expect(hasRiskyPermissions(bn)).toBe(true);
    expect(hasRiskyPermissions(await keyPermissions('binance', client({ sapiGetAccountApiRestrictions: async () => ({ enableReading: true, enableFixReadOnly: true }) })))).toBe(false);
    expect(await keyPermissions('bybit', client({ privateGetV5UserQueryApi: async () => ({ result: { readOnly: 1, permissions: { Spot: ['SpotTrade'] } } }) }))).toBe('read');
    const by = await keyPermissions('bybit', client({ privateGetV5UserQueryApi: async () => ({ result: { readOnly: 0, permissions: { Spot: ['SpotTrade'], Wallet: [] } } }) }));
    expect(by).toBe('Spot:SpotTrade');
    expect(hasRiskyPermissions(by)).toBe(true);
    expect(await keyPermissions('okx', client({ privateGetAccountConfig: async () => ({ data: [{ perm: 'read_only' }] }) }))).toBe('read_only');
    expect(hasRiskyPermissions('read_only,trade')).toBe(true);
    // Bitget: only names we know count; an unknown code never raises a false alarm.
    expect(await keyPermissions('bitget', client({ privateSpotGetV2SpotAccountInfo: async () => ({ data: { authorities: ['readonly', 'xyz'] } }) }))).toBe('readonly');
    expect(await keyPermissions('bitget', client({ privateSpotGetV2SpotAccountInfo: async () => ({ data: { authorities: ['xyz'] } }) }))).toBeNull();
    // A refused or missing endpoint gives no verdict.
    expect(await keyPermissions('okx', client({ privateGetAccountConfig: async () => Promise.reject(new Error('50113')) }))).toBeNull();
    expect(await keyPermissions('kraken', client({}))).toBeNull();
  });

  it('a connected Binance key with withdrawals shows the warning', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'binance', label: 'BN', credentials: { apiKey: 'k1234567', secret: 's1234567' } } });
    const id = r.json().id as number;
    const spot = (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: Record<string, unknown> } }> }).clients.get(id)!.clients.spot;
    spot.sapiGetAccountApiRestrictions = async () => ({ enableReading: true, enableWithdrawals: true });
    const t = (await app.inject({ method: 'POST', url: `/api/accounts/${id}/test`, headers: M })).json();
    expect(t).toMatchObject({ permissions: 'read,withdraw', permissionWarning: true });
  });
});

describe('crypto exchanges priced in USD (FD-SENTIQ)', () => {
  it('values a coin listed only against USD (Kraken, Coinbase)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kraken', label: 'KR', credentials: { apiKey: 'k1234567', secret: 's1234567' } } });
    expect(r.statusCode).toBe(200);
    const id = r.json().id as number;
    const spot = (ctx.accounts as unknown as { clients: Map<number, { clients: { spot: Record<string, unknown> } }> }).clients.get(id)!.clients.spot;
    spot.markets = { 'BTC/USD': {} };
    spot.fetchTickers = async () => ({ 'BTC/USD': { last: 81000 } });
    const p = (await app.inject({ method: 'GET', url: `/api/portfolio/${id}?force=1`, headers: H })).json();
    expect(p.balances.find((b: { asset: string }) => b.asset === 'BTC')).toMatchObject({ price: 81000, value: 81000 * 0.5 });
  });
});

describe('costBasis', () => {
  it('uses the average-cost method and needs the fills to cover the holding', () => {
    const fills = [
      { symbol: 'SOL/USDT', side: 'buy' as const, price: 100, amount: 10, timestamp: 1 },
      { symbol: 'SOL/USDT', side: 'sell' as const, price: 150, amount: 5, timestamp: 2 },
      { symbol: 'SOL/USDT', side: 'buy' as const, price: 130, amount: 5, timestamp: 3 },
      { symbol: 'SOL/BTC', side: 'buy' as const, price: 0.001, amount: 100, timestamp: 4 },
    ];
    expect(costBasis('SOL', 10, fills).avgPrice).toBeCloseTo(115, 9); // (5×100 + 5×130) / 10
    expect(costBasis('SOL', 20, fills)).toMatchObject({ avgPrice: null, complete: false });
    expect(costBasis('SOL', 0, fills).avgPrice).toBeNull();
    expect(costBasis('SOL', 9.9, [{ symbol: 'SOL/USDT', side: 'buy', price: 100, amount: 10, timestamp: 1, fee: { cost: 0.1, currency: 'SOL' } }]).avgPrice).toBeCloseTo(1000 / 9.9, 9);
  });
});

describe('log retention', () => {
  it('deletes only daily log files older than the cutoff', async () => {
    const { pruneLogs } = await import('./jobs/register.ts');
    const { writeFileSync, existsSync } = await import('node:fs');
    const d = mkdtempSync(path.join(tmpdir(), 'kq-logs-'));
    for (const f of ['kryptoniq-2026-08-01.log', 'kryptoniq-2026-10-11.log', 'sentiq-2026-08-02.log', 'sentiq-2026-10-12.log', 'notes.txt', 'launcher.log']) writeFileSync(path.join(d, f), 'x');
    expect(pruneLogs(d, Date.parse('2026-09-12T00:00:00Z'))).toBe(2);
    expect(existsSync(path.join(d, 'kryptoniq-2026-08-01.log'))).toBe(false);
    expect(existsSync(path.join(d, 'kryptoniq-2026-10-11.log'))).toBe(true);
    expect(existsSync(path.join(d, 'sentiq-2026-08-02.log'))).toBe(false);
    expect(existsSync(path.join(d, 'sentiq-2026-10-12.log'))).toBe(true);
    expect(existsSync(path.join(d, 'notes.txt'))).toBe(true);
    expect(existsSync(path.join(d, 'launcher.log'))).toBe(true); // owned by scripts/sentiq.sh (TD-LAUNCH)
    expect(pruneLogs(path.join(d, 'missing'), Date.now())).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('coin logos (TD-ICONS)', () => {
  it('serves branded SVGs locally, resolves aliases and rejects unknown or unsafe symbols', async () => {
    // Behind the sign-in like the rest of the API (FD-USERS).
    expect((await app.inject({ url: '/api/logo/btc', headers: { host: '127.0.0.1:4317' } })).statusCode).toBe(401);
    const h = H;
    const btc = await app.inject({ url: '/api/logo/btc', headers: h });
    expect(btc.statusCode).toBe(200);
    expect(btc.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(btc.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(btc.headers['cache-control']).toBe('public, max-age=86400');
    expect(btc.body.startsWith('<svg')).toBe(true);
    // Render Network trades as RENDER; the icon set still files it under RNDR.
    expect((await app.inject({ url: '/api/logo/RENDER', headers: h })).statusCode).toBe(200);
    const unknown = await app.inject({ url: '/api/logo/NOTACOIN123', headers: h });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers['cache-control']).toBe('public, max-age=86400');
    for (const bad of ['..%2Fpackage', 'BTC.svg', 'a-b', 'X'.repeat(16)]) {
      expect((await app.inject({ url: `/api/logo/${bad}`, headers: h })).statusCode, bad).toBe(404);
    }
  });
});

describe('web build serving (TD-STATIC)', () => {
  it('serves files added after start, 404s missing files and never caches the page', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const web = path.join(dir, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(web, 'assets', 'old-1.js'), 'export const a = 1;');
    const config = { ...loadConfig({ KRYPTONIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: web };
    const c2 = await createContext(config, silentLogger, { nli: fakeNli, clientFactory: fakeClients(), box: new SecretBox(Buffer.alloc(32, 7)), retryDelaysMs: [0, 0], db: ctx.db });
    const a2 = await buildApp(c2);
    try {
      const old = await a2.inject({ url: '/assets/old-1.js', headers: { host: '127.0.0.1:4317' } });
      expect(old.statusCode).toBe(200);
      expect(old.headers['content-type']).toMatch(/javascript/);
      expect(old.headers['cache-control']).toContain('immutable');
      // A rebuild while the server runs: the new chunk is served without a restart.
      writeFileSync(path.join(web, 'assets', 'new-2.js'), 'export const b = 2;');
      const fresh = await a2.inject({ url: '/assets/new-2.js', headers: { host: '127.0.0.1:4317' } });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.body).toContain('b = 2');
      const missing = await a2.inject({ url: '/assets/gone-3.js', headers: { host: '127.0.0.1:4317' } });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers['content-type']).toMatch(/text\/plain/);
      expect(missing.body).not.toContain('<div id="root">');
      expect(missing.headers['cache-control']).toBe('no-store');
      for (const url of ['/', '/news', '/charts/BTC/USDT', '/news?q=a.b']) {
        const page = await a2.inject({ url, headers: { host: '127.0.0.1:4317' } });
        expect(page.statusCode, url).toBe(200);
        expect(page.headers['content-type'], url).toMatch(/text\/html/);
        expect(page.headers['cache-control'], url).toBe('no-store');
        expect(page.body, url).toContain('<div id="root">');
      }
      // Signed out, an unknown API route is just "sign in" (the API's map is nobody else's business).
      expect((await a2.inject({ url: '/api/nope', headers: { host: '127.0.0.1:4317' } })).statusCode).toBe(401);
      const api = await a2.inject({ url: '/api/nope', headers: H });
      expect(api.statusCode).toBe(404);
      expect(api.json().error.code).toBe('NOT_FOUND');
    } finally {
      await a2.close();
    }
  });
});

describe('background launcher (TD-LAUNCH)', () => {
  it('SENTIQ_QUIET=1 (or KRYPTONIQ_QUIET=1) keeps the logger off the console but still writes the daily file', async () => {
    const { createLogger } = await import('./log.ts');
    expect(loadConfig({} as NodeJS.ProcessEnv).quietConsole).toBe(false);
    expect(loadConfig({ SENTIQ_QUIET: '1' } as NodeJS.ProcessEnv).quietConsole).toBe(true);
    expect(loadConfig({ KRYPTONIQ_QUIET: '1' } as NodeJS.ProcessEnv).quietConsole).toBe(true);
    const d = mkdtempSync(path.join(tmpdir(), 'kq-quiet-'));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = createLogger(d, true);
      log.info('hello');
      log.error('boom');
      expect(spy).not.toHaveBeenCalled();
      expect(spyErr).not.toHaveBeenCalled();
      const files = readdirSync(d);
      expect(files).toHaveLength(1);
      expect(readFileSync(path.join(d, files[0]!), 'utf8')).toMatch(/INFO hello\n.*ERROR boom\n$/s);
    } finally {
      spy.mockRestore();
      spyErr.mockRestore();
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('scheduler', () => {
  it('never overlaps runs, records errors and honours nudges made while running', async () => {
    const db = await testDb();
    const s = new Scheduler(db, silentLogger);
    let running = 0;
    let maxConcurrent = 0;
    let calls = 0;
    s.add({
      name: 'slow',
      everyMs: 60_000,
      run: async () => {
        calls++;
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
      },
    });
    s.add({ name: 'boom', everyMs: 60_000, run: async () => Promise.reject(new Error('kaput')) });
    await Promise.all([s.trigger('slow'), s.trigger('slow'), s.trigger('slow')]);
    expect(maxConcurrent).toBe(1);
    expect(calls).toBe(1);
    await s.trigger('boom');
    const st = (await s.status()).find((j) => j.name === 'boom');
    expect(st?.lastError).toBe('kaput');
    await s.stop();
  });
});

describe('the master key (FD-AZURE §2)', () => {
  it('is never made anew next to secrets saved with another one', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sq-key-'));
    try {
      const config = { ...loadConfig({ SENTIQ_DATA_DIR: d } as NodeJS.ProcessEnv), webDist: path.join(d, 'x') };
      const db = await testDb();
      await db.run("INSERT INTO exchange_accounts(user_id, exchange, label, api_key, secret, key_hint, created_at, credentials) VALUES (1, 'kucoin', 'Main', '', '', 'k', 1, 'v1:x')");
      await expect(createContext(config, silentLogger, { nli: fakeNli, db })).rejects.toThrow(/Cheia master lipsește/);
      expect(readdirSync(d)).not.toContain('master.key');
      // Nothing encrypted yet (a new database): the key is made, as before.
      await db.run('DELETE FROM exchange_accounts');
      await createContext(config, silentLogger, { nli: fakeNli, db });
      expect(readdirSync(d)).toContain('master.key');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('the jobs on one instance (TD-AZURE §6)', () => {
  it('only the holder of the lease runs them; another takes over when it stops', async () => {
    const db = await testDb();
    let runs: string[] = [];
    const make = (host: string) => {
      const s = new Scheduler(db, silentLogger, { host, leaseTtlMs: 1500, renewMs: 300 });
      s.add({ name: 'tick', everyMs: 100, runOnStart: true, run: async () => void runs.push(host) });
      return s;
    };
    const a = make('mac');
    const b = make('azure');
    await a.start();
    await b.start();
    expect(a.leaderInfo()).toEqual({ host: 'mac', self: true });
    expect(b.leaderInfo()).toEqual({ host: 'mac', self: false });
    const waitFor = async (cond: () => boolean) => {
      for (const end = performance.now() + 15_000; !cond(); ) {
        if (performance.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await waitFor(() => runs.length >= 2);
    expect(new Set(runs)).toEqual(new Set(['mac']));
    // Stopping hands the lease over at once (expires_at = 0): the other takes it at its next renewal.
    await a.stop();
    runs = [];
    await waitFor(() => b.leaderInfo().self && runs.length >= 2);
    expect(b.leaderInfo()).toEqual({ host: 'azure', self: true });
    expect(new Set(runs)).toEqual(new Set(['azure']));
    await b.stop();
  });
});

describe('stocks API (FD-SENTIQ §4)', () => {
  const nasdaq = (u: URL) => {
    if (u.hostname !== 'api.nasdaq.com') return null;
    if (u.pathname === '/api/market-info') return { data: { marketIndicator: 'Market Open', marketOpeningTime: 'Oct 13, 2026 09:30 AM ET', marketClosingTime: 'Oct 13, 2026 04:00 PM ET' } };
    if (u.pathname === '/api/quote/AAPL/info') return { data: { companyName: 'Apple Inc. Common Stock', marketStatus: 'Open', primaryData: { lastSalePrice: '$340.97', netChange: '+4.33', percentageChange: '+1.29%' } } };
    if (u.pathname.endsWith('/info')) return { data: null };
    if (u.pathname === '/api/quote/AAPL/historical')
      return { data: { tradesTable: { rows: Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$2/$3/$1'), open: '$1.00', high: '$2.00', low: '$0.50', close: '$1.50', volume: '1,000' })) } } };
    if (u.pathname === '/api/quote/AAPL/chart') return { data: { chart: [] } };
    if (u.pathname.startsWith('/api/autocomplete')) return { data: [{ symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ-GS', asset: 'STOCKS' }, { symbol: 'AAPL.XX', name: 'odd', asset: 'FUTURES' }] };
    return { data: null };
  };
  const td = (ok: boolean) => (u: URL) =>
    u.hostname === 'api.twelvedata.com' ? (ok ? { values: [{ datetime: '2026-10-12', open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' }], status: 'ok' } : { code: 401, message: 'invalid api key', status: 'error' }) : null;
  const serveJson = (...routes: ((u: URL) => unknown)[]) =>
    setFetchImpl((async (input: string | URL | Request) => {
      const u = new URL(String(input));
      for (const r of routes) {
        const body = r(u);
        if (body) return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);

  it('serves daily candles without a key and asks for one on intraday', async () => {
    serveJson(nasdaq);
    const d = await app.inject({ method: 'GET', url: '/api/market/candles?asset=stock&symbol=aapl&tf=1d&limit=100', headers: H });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ exchange: 'nasdaq', symbol: 'AAPL', tf: '1d' });
    expect(d.json().candles).toHaveLength(100);
    const h = await app.inject({ method: 'GET', url: '/api/market/candles?asset=stock&symbol=AAPL&tf=1h&limit=100', headers: H });
    expect(h.statusCode).toBe(400);
    expect(h.json().error.message).toMatch(/cheia ta Twelve Data \(Setări → Ale mele → Date pentru acțiuni/);
    expect((await app.inject({ method: 'GET', url: '/api/market/candles?asset=stock&symbol=aa%20pl&tf=1d', headers: H })).statusCode).toBe(400);
    const info = (await app.inject({ method: 'GET', url: '/api/stocks/info', headers: H })).json();
    expect(info).toMatchObject({ timeframes: ['1d', '1w'], hasKey: false, market: { state: 'open' }, budget: { used: 0, perDay: 800 } });
  });

  it('quotes several symbols, with an error row for an unknown one', async () => {
    serveJson(nasdaq);
    const r = (await app.inject({ method: 'GET', url: '/api/stocks/quotes?symbols=AAPL,zzzz,AAPL', headers: H })).json();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ symbol: 'AAPL', last: 340.97, changePct: 1.29 });
    expect(r[1]).toMatchObject({ symbol: 'ZZZZ', last: null, error: 'ZZZZ nu e listat la Nasdaq / NYSE' });
    expect((await app.inject({ method: 'GET', url: '/api/stocks/search?q=apple', headers: H })).json()).toEqual([{ symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ-GS', type: 'Acțiune' }]);
  });

  it('checks the Twelve Data key before saving it', async () => {
    let asked = 0;
    serveJson((u) => (u.hostname === 'api.twelvedata.com' ? (asked++, null) : null));
    const malformed = await app.inject({ method: 'PUT', url: '/api/settings/twelvedata-key', headers: M, payload: { key: 'not a key' } });
    expect(malformed.json().error.message).toMatch(/nu pare validă/);
    expect(asked).toBe(0);
    serveJson(td(false), nasdaq);
    const bad = await app.inject({ method: 'PUT', url: '/api/settings/twelvedata-key', headers: M, payload: { key: 'a'.repeat(32) } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/cheia nu e validă/);
    // FD-TDPLAN: the saved key's plan is read at once (Grow: 55 a minute, no daily limit).
    const grow = (u: URL) => (u.hostname === 'api.twelvedata.com' && u.pathname === '/api_usage' ? { timestamp: 'x', current_usage: 0, plan_limit: 55, plan_category: 'grow' } : null);
    serveJson(grow, td(true), nasdaq);
    const ok = await app.inject({ method: 'PUT', url: '/api/settings/twelvedata-key', headers: M, payload: { key: 'b'.repeat(32) } });
    expect(ok.json()).toMatchObject({ twelveDataKeySet: true });
    expect(JSON.stringify(ok.json())).not.toContain('b'.repeat(32));
    const info = (await app.inject({ method: 'GET', url: '/api/stocks/info', headers: H })).json();
    expect(info.timeframes).toContain('1h');
    expect(info.budget).toMatchObject({ perMinute: 55, perDay: null, plan: { category: 'grow', assumed: false } });
    // FD-TDKEYS: the key and its credits are the user's; the health page only counts who has one.
    // The new key's day: its check, then its plan (the refused key's check is not its).
    expect(info.budget.used).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: H })).json().twelveData).toEqual({ users: 1 });
    expect(await ctx.db.get("SELECT 1 AS x FROM user_keys WHERE user_id = 1 AND name = N'twelvedata'")).toBeDefined();
    // Read again on request (after an upgrade).
    serveJson((u) => (u.pathname === '/api_usage' ? { timestamp: 'x', current_usage: 0, plan_limit: 610, plan_category: 'pro' } : null));
    const reread = await app.inject({ method: 'POST', url: '/api/settings/twelvedata-plan', headers: M });
    expect(reread.json().budget).toMatchObject({ perMinute: 610, plan: { category: 'pro' } });
    const cleared = await app.inject({ method: 'PUT', url: '/api/settings/twelvedata-key', headers: M, payload: { key: null } });
    expect(cleared.json()).toMatchObject({ twelveDataKeySet: false });
    expect((await app.inject({ method: 'GET', url: '/api/stocks/info', headers: H })).json().budget).toMatchObject({ perMinute: 8, perDay: 800, plan: { assumed: true } });
    expect((await app.inject({ method: 'POST', url: '/api/settings/twelvedata-plan', headers: M })).json().error.message).toBe('Cheia ta Twelve Data lipsește');
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: H })).json().twelveData).toEqual({ users: 0 });
  });

  it('serves an index: daily candles, quotes and the spark line (FD-INDICES)', async () => {
    const cboe = (u: URL) => {
      if (u.hostname !== 'cdn-api.cboe.com') return null;
      if (u.pathname === '/api/global/delayed_quotes/charts/historical/_SPX.json')
        return { data: Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().slice(0, 10), open: '7000', high: '7100', low: '6900', close: '7050', volume: '0.0' })) };
      if (u.pathname === '/api/global/delayed_quotes/quotes/_SPX.json')
        return { data: { current_price: 7752.88, price_change: -52.57, price_change_percent: -0.67, open: 7774.18, high: 7789.15, low: 7747.46, last_trade_time: '2026-10-14T10:48:27' } };
      return null;
    };
    // CNBC down (every other address answers 404 here): the daily bars and the quote come from Cboe.
    serveJson(cboe, nasdaq);
    const d = await app.inject({ method: 'GET', url: '/api/market/candles?asset=index&symbol=spx&tf=1d&limit=100', headers: H });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ exchange: 'cboe', symbol: '^SPX', tf: '1d' });
    expect(d.json().candles).toHaveLength(100);
    expect(d.json().candles.at(-1)).toMatchObject({ o: 7774.18, c: 7752.88 });
    const h = await app.inject({ method: 'GET', url: '/api/market/candles?asset=index&symbol=%5ESPX&tf=6h&limit=100', headers: H });
    expect(h.statusCode).toBe(400);
    expect(h.json().error.message).toBe('Indicii nu au 6h');
    expect((await app.inject({ method: 'GET', url: '/api/market/candles?asset=index&symbol=DAX&tf=1d', headers: H })).statusCode).toBe(400);
    const q = (await app.inject({ method: 'GET', url: '/api/stocks/quotes?symbols=%5Espx,AAPL,%5EDAX', headers: H })).json();
    expect(q[0]).toMatchObject({ symbol: '^SPX', name: 'S&P 500', last: 7752.88, changePct: -0.67, delayed: true });
    expect(q[1]).toMatchObject({ symbol: 'AAPL', last: 340.97 });
    expect(q[2]).toMatchObject({ symbol: '^DAX', last: null, error: 'Indice necunoscut: DAX' });
    expect((await app.inject({ method: 'GET', url: '/api/stocks/spark?symbol=%5ESPX', headers: H })).json().closes).toHaveLength(60);
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload });
    expect((await put({ charts: { symbol: 'index:SPX' } })).json().charts.symbol).toBe('index:SPX');
    expect((await put({ charts: { symbol: 'index:spx' } })).statusCode).toBe(400);
  });

  it('serves an index on 1h from CNBC, with its real-time quote (FD-INDEXINTRA)', async () => {
    const cnbc = (u: URL) => {
      if (u.hostname === 'quote.cnbc.com')
        return { FormattedQuoteResult: { FormattedQuote: [{ symbol: '.NDX', last: '29,919.56', change: '-649.92', change_pct: '-2.13%', open: '30,316.03', high: '30,436.60', low: '29,900.10', last_time: '2026-10-14T14:00:00.000-0400', realTime: 'true' }] } };
      if (u.hostname === 'ts-api.cnbc.com' && u.pathname.startsWith('/harmony/app/bars/.NDX/1H/')) {
        const priceBars = [];
        for (let d = 0; d < 20; d++)
          for (const h of [9, 10, 11, 12, 13, 14, 15, 16]) {
            const day = new Date(Date.UTC(2026, 8, 14 + d)).toISOString().slice(0, 10);
            priceBars.push({ open: '30000', high: '30100', low: '29900', close: '30050', tradeTime: `${day.replace(/-/g, '')}${String(h).padStart(2, '0')}0000`, tradeTimeinMills: Date.parse(`${day}T${String(h + 4).padStart(2, '0')}:00:00Z`) });
          }
        return { barData: { priceBars } };
      }
      return null;
    };
    serveJson(cnbc, nasdaq);
    const r = await app.inject({ method: 'GET', url: '/api/market/candles?asset=index&symbol=NDX&tf=1h&limit=100', headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ exchange: 'cnbc', symbol: '^NDX', tf: '1h' });
    // 7 session bars a day (the 16:00 print is after the close): 140, the last 100 asked.
    expect(r.json().candles).toHaveLength(100);
    const q = (await app.inject({ method: 'GET', url: '/api/stocks/quotes?symbols=%5ENDX', headers: H })).json();
    expect(q[0]).toMatchObject({ symbol: '^NDX', last: 29919.56, changePct: -2.13, delayed: false });
  });

  it('accepts a stock as the remembered chart and the earnings switch of the calendar', async () => {
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload });
    expect((await put({ charts: { symbol: 'stock:BRK.B' } })).json().charts.symbol).toBe('stock:BRK.B');
    expect((await put({ charts: { symbol: 'stock:brk' } })).statusCode).toBe(400);
    expect((await put({ calendar: { earnings: false } })).json().calendar).toMatchObject({ earnings: false, impacts: ['High', 'Medium'] });
    const cal = await app.inject({ method: 'GET', url: `/api/calendar?from=1&to=${86_400_000}&earnings=2`, headers: H });
    expect(cal.statusCode).toBe(400);
  });
});


describe('watch lists API (FD-WATCHLISTS)', () => {
  const view = async () => (await app.inject({ url: '/api/watchlists', headers: H })).json() as { lists: { id: number; name: string; coins: string[] }[] };
  const union = async () => ((await app.inject({ url: '/api/watchlist', headers: H })).json() as { coin: string }[]).map((w) => w.coin);
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: M, payload });
  const feeds = async () => (await ctx.db.all<{ auto: string }>('SELECT auto FROM sources WHERE auto IS NOT NULL ORDER BY auto')).map((r) => r.auto);

  it('the favourites are the list "Favorite"; lists made, filled, copied, moved, emptied; the rest of the app follows them all together', async () => {
    const v0 = await view();
    expect(v0.lists).toEqual([{ id: expect.any(Number), name: 'Favorite', coins: ['BTC', 'ETH', 'SOL'] }]);
    const fav = v0.lists[0]?.id as number;
    const made = await post('/api/watchlists', { name: '  Tech   AI ' });
    expect(made.statusCode).toBe(200);
    const tech = made.json().id as number;
    expect(made.json().lists.map((l: { name: string }) => l.name)).toEqual(['Favorite', 'Tech AI']);
    expect((await post('/api/watchlists', { name: 'tech ai' })).json().error.message).toBe('Ai deja o listă „Tech AI”');
    expect((await post('/api/watchlists', { name: '   ' })).statusCode).toBe(400);
    expect((await post('/api/watchlists', { name: 'x'.repeat(41) })).statusCode).toBe(400);
    // A stock new to the user: followed, with its own feed.
    const aapl = (await post(`/api/watchlists/${tech}/items`, { kind: 'stock', coin: 'aapl', name: 'Apple Inc. Common Stock' })).json();
    expect(aapl).toMatchObject({ added: [{ coin: 'AAPL', kind: 'stock' }], gone: [], note: null });
    expect(await feeds()).toEqual(['nasdaq:AAPL']);
    // BTC with another pair: the same BTC (its pair is the same in every list), told so.
    const btc = (await post(`/api/watchlists/${tech}/items`, { kind: 'crypto', coin: 'BTC', quote: 'USDC' })).json();
    expect(btc).toMatchObject({ added: [], note: 'BTC e deja urmărit ca BTC/USDT; perechea e aceeași în toate listele.' });
    expect((await post(`/api/watchlists/${tech}/items`, { kind: 'crypto', coin: 'BTC' })).json().error.message).toBe('BTC e deja în Tech AI');
    expect((await post(`/api/watchlists/${tech}/items`, { kind: 'stock', coin: 'ETH' })).json().error.message).toBe('ETH e deja urmărit ca monedă');
    expect(await union()).toEqual(['BTC', 'ETH', 'SOL', 'AAPL']);
    // Copy ETH and BTC: ETH copied, BTC was there; move SOL.
    expect((await post(`/api/watchlists/${fav}/items/copy`, { coins: ['ETH', 'BTC', 'DOGE'], to: tech })).json()).toMatchObject({ done: 1, already: 1, missing: 1 });
    const moved = (await post(`/api/watchlists/${fav}/items/move`, { coins: ['SOL'], to: tech })).json();
    expect(moved).toMatchObject({ done: 1, already: 0 });
    expect(moved.lists).toEqual([
      { id: fav, name: 'Favorite', coins: ['BTC', 'ETH'] },
      { id: tech, name: 'Tech AI', coins: ['AAPL', 'BTC', 'ETH', 'SOL'] },
    ]);
    expect((await post(`/api/watchlists/${fav}/items/move`, { coins: ['BTC'], to: fav })).statusCode).toBe(400);
    // The order of the lists makes the common order.
    expect((await app.inject({ method: 'PUT', url: '/api/watchlists/order', headers: M, payload: { ids: [tech, fav] } })).statusCode).toBe(200);
    expect(await union()).toEqual(['AAPL', 'BTC', 'ETH', 'SOL']);
    await app.inject({ method: 'PUT', url: `/api/watchlists/${tech}/items/order`, headers: M, payload: { coins: ['SOL', 'ETH', 'BTC', 'AAPL'] } });
    expect(await union()).toEqual(['SOL', 'ETH', 'BTC', 'AAPL']);
    // Out of its only list, a stock stops being followed: its feed goes.
    expect((await post(`/api/watchlists/${tech}/items/delete`, { coins: ['AAPL'] })).json()).toMatchObject({ done: 1, gone: ['AAPL'] });
    expect(await feeds()).toEqual([]);
    // A list deleted: what was only in it stops being followed; the last one stays.
    const rm = (await app.inject({ method: 'DELETE', url: `/api/watchlists/${tech}`, headers: M })).json();
    expect(rm.gone).toEqual(['SOL']);
    expect(await union()).toEqual(['BTC', 'ETH']);
    expect((await app.inject({ method: 'DELETE', url: `/api/watchlists/${fav}`, headers: M })).json().error.message).toBe('Păstrează cel puțin o listă; o poți goli');
    expect((await app.inject({ method: 'PUT', url: `/api/watchlists/${fav}`, headers: M, payload: { name: 'Principala' } })).json().lists[0].name).toBe('Principala');
    // Another user's list, or a deleted one: not found.
    expect((await post(`/api/watchlists/${tech}/items`, { kind: 'crypto', coin: 'DOGE' })).json().error.message).toBe('Lista nu mai există');
  });

  it('a symbol added or removed by an older Sentiq is put right at the next read; the older routes work on the lists', async () => {
    await ctx.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (1, N'XRP', N'USDT', 9, N'[]', 1, N'crypto')");
    await ctx.db.run("DELETE FROM watchlist WHERE user_id = 1 AND coin = N'ETH'");
    expect((await view()).lists[0]?.coins).toEqual(['BTC', 'SOL', 'XRP']);
    // The older add goes into the first list; the older delete takes it out of all of them.
    const two = (await post('/api/watchlists', { name: 'Două' })).json().id as number;
    await post(`/api/watchlists/${two}/items`, { kind: 'crypto', coin: 'XRP' });
    expect((await post('/api/watchlist', { kind: 'crypto', coin: 'ADA' })).json().map((w: { coin: string }) => w.coin)).toEqual(['BTC', 'SOL', 'XRP', 'ADA']);
    expect((await app.inject({ method: 'DELETE', url: '/api/watchlist/XRP', headers: M })).statusCode).toBe(200);
    expect((await view()).lists.map((l) => l.coins)).toEqual([['BTC', 'SOL', 'ADA'], []]);
  });

  it('at most 50 different symbols in all the lists, and 20 lists', async () => {
    const fav = (await view()).lists[0]?.id as number;
    for (let i = 0; i < 47; i++) await ctx.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (1, ?, N'USDT', ?, N'[]', 1, N'crypto')", [`C${i}`, 10 + i]);
    expect((await view()).lists[0]?.coins).toHaveLength(50);
    expect((await post(`/api/watchlists/${fav}/items`, { kind: 'crypto', coin: 'DOGE' })).json().error.message).toBe('Listele au împreună cel mult 50 de simboluri diferite');
    // A symbol followed already still goes into another list.
    const other = (await post('/api/watchlists', { name: 'Alta' })).json().id as number;
    expect((await post(`/api/watchlists/${other}/items`, { kind: 'crypto', coin: 'C3' })).statusCode).toBe(200);
    for (let i = 3; i <= 20; i++) await post('/api/watchlists', { name: `L${i}` });
    expect((await view()).lists).toHaveLength(20);
    expect((await post('/api/watchlists', { name: 'A 21-a' })).json().error.message).toBe('Poți avea cel mult 20 de liste');
  });

  it('the "Date financiare" of a symbol: an index without asking anyone; a stock from Nasdaq and TradingView; no translation without a key', async () => {
    const idx = (await app.inject({ url: '/api/symbols/profile?kind=index&symbol=%5ESPX', headers: H })).json();
    expect(idx).toMatchObject({ kind: 'index', name: 'S&P 500', description: { source: 'Sentiq', lang: 'ro' }, quarters: [] });
    const asked: string[] = [];
    setFetchImpl((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      asked.push(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes('company-profile')) return json({ data: { CompanyName: { value: 'Tesla, Inc. ' }, CompanyDescription: { value: 'Tesla makes electric cars.' }, Sector: { value: 'Industrials' }, Industry: { value: 'Auto Manufacturing' } } });
      if (url.includes('scanner.tradingview.com')) {
        expect(JSON.parse(String(init?.body)).filter[0].right).toEqual(['TSLA']);
        return json({ data: [{ s: 'NASDAQ:TSLA', d: ['TSLA', true, 'stock', [28e9, 22e9], [4.7e9, 4.7e9], [3e9, 2e9], [1.1e9, 0.5e9], [0.31, 0.13], [-1e9, 1e9], 1782777600, 1792540800, 12, 1, 0.45, 'Consumer Durables', 'Motor Vehicles'] }] });
      }
      return new Response('no', { status: 404 });
    }) as typeof fetch);
    const tsla = (await app.inject({ url: '/api/symbols/profile?kind=stock&symbol=TSLA', headers: H })).json();
    expect(tsla).toMatchObject({
      kind: 'stock',
      name: 'Tesla, Inc.',
      description: { text: 'Tesla makes electric cars.', source: 'Nasdaq', lang: 'en' },
      translated: null,
      facts: [
        { label: 'Sector', value: 'Industrials' },
        { label: 'Industrie', value: 'Auto Manufacturing' },
      ],
      next: { day: '2026-10-21', time: 'after', confirmed: true, eps: 0.45 },
      problems: [],
    });
    expect(tsla.quarters.map((q: { end: string }) => q.end)).toEqual(['2026-06-30', '2026-03-31']);
    // Kept: a second opening asks nobody.
    const n = asked.length;
    await app.inject({ url: '/api/symbols/profile?kind=stock&symbol=TSLA', headers: H });
    expect(asked).toHaveLength(n);
    expect((await post('/api/symbols/translate', { kind: 'stock', symbol: 'TSLA' })).json().error.message).toBe('Fără o cheie AI, descrierea rămâne în engleză');
    expect((await post('/api/symbols/translate', { kind: 'index', symbol: '^SPX' })).json().error.message).toBe('Nu e nimic de tradus');
    expect((await app.inject({ url: '/api/symbols/profile?kind=bond&symbol=X', headers: H })).statusCode).toBe(400);
  });
});
