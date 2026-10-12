import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createContext, type AppContext } from './context.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import { silentLogger } from './log.ts';
import { setFetchImpl } from './net/http.ts';
import { SecretBox, secretHint } from './secrets/crypto.ts';
import { hostnameOf, isLocalHost, isLocalOrigin } from './http/security.ts';
import { Scheduler } from './jobs/scheduler.ts';
import { Db } from './db/database.ts';
import type { NliScorer } from './sentiment/local.ts';
import { costBasis } from './exchange/cost-basis.ts';
import { hasRiskyPermissions, mapExchangeError, stopDirection, type ClientFactory } from './exchange/accounts.ts';
import { isRateLimitError, isTransientError, withRetry } from './exchange/retry.ts';
import { MarketData } from './market/market.ts';
import { deepMerge } from './settings.ts';
import ccxt from 'ccxt';

const H = { host: '127.0.0.1:4317' };
const M = { ...H, 'x-kryptoniq': '1', 'content-type': 'application/json' };

const fakeNli: NliScorer = {
  status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }),
  warmUp: () => {},
  score: async (t: string) => (/surge|rally/i.test(t) ? 0.8 : /hack|crash/i.test(t) ? -0.8 : 0),
  onReady: () => {},
};

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
      params?.type === 'main' ? { total: { USDT: 100 }, free: { USDT: 100 }, used: {} } : { total: { BTC: 0.5, USDT: 0 }, free: { BTC: 0.4 }, used: { BTC: 0.1 } },
    fetchPositions: async () => [
      { symbol: 'ETH/USDT:USDT', side: 'long', contracts: 2, contractSize: 0.01, entryPrice: 2500, markPrice: 2600, unrealizedPnl: 2, percentage: 4, liquidationPrice: 2000, leverage: 5, marginMode: 'isolated', notional: 52 },
      { symbol: 'XRP/USDT:USDT', side: 'long', contracts: 0 },
    ],
    fetchOpenOrders: async (_s?: string, _since?: number, _l?: number, params?: { trigger?: boolean }) =>
      params?.trigger ? [{ id: 'o1', symbol: 'BTC/USDT', type: 'limit', side: 'sell', price: 90000, triggerPrice: 89000, amount: 0.1, filled: 0, status: 'open', timestamp: 1 }] : [{ id: 'o1', symbol: 'BTC/USDT', type: 'limit', side: 'sell', price: 90000, amount: 0.1, filled: 0, status: 'open', timestamp: 1 }],
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

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'kq-test-'));
  const config = { ...loadConfig({ KRYPTONIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'no-web') };
  ctx = createContext(config, silentLogger, { nli: fakeNli, clientFactory: fakeClients(), box: new SecretBox(Buffer.alloc(32, 7)), retryDelaysMs: [0, 0] });
  app = await buildApp(ctx);
});

afterEach(async () => {
  setFetchImpl(null);
  await app.close();
  ctx.db.close();
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
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: H })).statusCode).toBe(200);
  });
  it('requires the CSRF header and JSON for mutations', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, 'x-kryptoniq': '1', 'content-type': 'text/plain' }, payload: 'timezone=UTC' })).statusCode).toBe(415);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { timezone: 'UTC' } })).statusCode).toBe(200);
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
  it('the exchange module has no order-placing or fund-moving calls', () => {
    const dirPath = fileURLToPath(new URL('./exchange/', import.meta.url));
    for (const f of readdirSync(dirPath)) {
      const p = path.join(dirPath, f);
      if (!statSync(p).isFile() || f.endsWith('.test.ts')) continue;
      expect(readFileSync(p, 'utf8')).not.toMatch(/\b(createOrder|cancelOrder|cancelAllOrders|editOrder|withdraw|transfer|setLeverage|setMarginMode)\s*\(/);
    }
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
    expect(s.claudeKeySet).toBe(false);
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
  it('stores the Claude key encrypted and only returns a hint', async () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const r = await app.inject({ method: 'PUT', url: '/api/settings/claude-key', headers: M, payload: { key } });
    expect(r.json()).toMatchObject({ claudeKeySet: true, claudeKeyHint: 'sk-a…wxyz' });
    expect(JSON.stringify(r.json())).not.toContain(key);
    const raw = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'claude_key'");
    expect(raw?.value).not.toContain('abcdefghij');
    expect(ctx.settings.getClaudeKey()).toBe(key);
    await app.inject({ method: 'PUT', url: '/api/settings/claude-key', headers: M, payload: { key: null } });
    expect(ctx.settings.getClaudeKey()).toBeNull();
  });
  it('remembers the chart settings and the LMA inputs (FD-CHARTUX)', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(s.charts).toEqual({ symbol: '', showPositions: true, showLma: true, lmaPane: 0.25 });
    expect(s.lma).toMatchObject({ preset: 'Default', period: 100, steepness: 2.5, maType: 'EMA', smooth: 10, colorBars: true });
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: M,
      payload: { charts: { symbol: 'SOL/USDT', showLma: false }, market: { defaultTf: '4h' }, lma: { preset: 'Scalping', maType: 'VWMA' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().charts).toEqual({ symbol: 'SOL/USDT', showPositions: true, showLma: false, lmaPane: 0.25 });
    expect(r.json().market.defaultTf).toBe('4h');
    expect(r.json().lma).toMatchObject({ preset: 'Scalping', maType: 'VWMA', period: 100 });
    for (const bad of [
      { charts: { symbol: '../etc/passwd' } },
      { charts: { symbol: 'sol/usdt' } },
      { charts: { lmaPane: 0.95 } },
      { lma: { period: 300 } },
      { lma: { shortThreshold: 0.5 } },
      { lma: { bullishColor: 'red' } },
    ]) {
      expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: bad })).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: M, payload: { charts: { symbol: '' } } })).json().charts.symbol).toBe('');
    // Settings saved by an older version (without charts / lma) still load, with the defaults for the new groups.
    ctx.db.run("UPDATE settings SET value = ? WHERE key = 'app'", [JSON.stringify({ timezone: 'UTC', market: { defaultTf: '15m' }, charts: { symbol: 42 } })]);
    (ctx.settings as unknown as { cached: unknown }).cached = null;
    const old = (await app.inject({ method: 'GET', url: '/api/settings', headers: H })).json();
    expect(old.market.defaultTf).toBe('15m');
    expect(old.charts.symbol).toBe('');
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
    expect(ctx.sentiment.pendingCount()).toBe(2);
    await ctx.sentiment.scorePending();
    expect(ctx.sentiment.pendingCount()).toBe(0);

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
    ctx.db.tx(() => {
      for (let i = 0; i < 7; i++) {
        ctx.db.run(
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
    const tz = ctx.settings.get().timezone;
    const { dayBounds, dayKey, addDays } = await import('../shared/time.ts');
    const now = Date.now();
    const yesterday = addDays(dayKey(now, tz), -1);
    const { start, end } = dayBounds(yesterday, tz);
    // Collection started yesterday; the feeds' backlog also carried one item from the day before.
    ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES (?, 'coindesk', 'Bitcoin surges', ?, ?, 'crypto', 1, 1, 'c1')`,
      ['a'.repeat(40), start + 3_600_000, start + 3_600_000],
    );
    ctx.db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES (?, 'coindesk', 'Solana rallies', ?, ?, 'crypto', 1, 1, 'c2')`,
      ['b'.repeat(40), start - 5 * 3_600_000, start + 3_600_000],
    );
    const final = () => ctx.db.get<{ final: number }>('SELECT final FROM daily_sentiment WHERE day = ? AND tz = ?', [yesterday, tz])?.final;
    const backlogDay = () => ctx.db.get('SELECT day FROM daily_sentiment WHERE day = ? AND tz = ?', [addDays(yesterday, -1), tz]);
    ctx.daily.refresh(end + 3 * 3_600_000);
    expect(final()).toBe(0); // the only news is still pending
    await ctx.sentiment.scorePending();
    ctx.daily.refresh(end + 30 * 60_000);
    expect(final()).toBe(0); // inside the 2 h grace period
    ctx.daily.refresh(end + 3 * 3_600_000);
    expect(final()).toBe(1);
    expect(backlogDay()).toBeUndefined(); // before the first collection day: not part of the history
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
  it('stores keys encrypted, warns on extra permissions and builds the portfolio', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789' } });
    expect(bad.statusCode).toBe(400); // passphrase required
    const r = await app.inject({ method: 'POST', url: '/api/accounts', headers: M, payload: { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' } });
    expect(r.statusCode).toBe(200);
    const acc = r.json();
    expect(acc).toMatchObject({ label: 'Main', keyHint: 'key-…6789', permissions: 'General,Spot', permissionWarning: true });
    expect(JSON.stringify(acc)).not.toContain('secret-123456789');
    const row = ctx.db.get<{ api_key: string; secret: string }>('SELECT api_key, secret FROM exchange_accounts');
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

    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${acc.id}/cost-basis/BTC`, headers: M, payload: { avgPrice: 50000 } })).statusCode).toBe(200);
    const p2 = (await app.inject({ method: 'GET', url: `/api/portfolio/${acc.id}`, headers: H })).json();
    expect(p2.balances.find((b: { asset: string }) => b.asset === 'BTC')).toMatchObject({ avgPrice: 50000, avgSource: 'manual' });
    expect((await app.inject({ method: 'PUT', url: `/api/portfolio/${acc.id}/cost-basis/BTC`, headers: M, payload: { avgPrice: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/portfolio/999', headers: H })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${acc.id}`, headers: M })).statusCode).toBe(200);
    expect(ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM cost_basis')?.n).toBe(0);
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
    for (const f of ['kryptoniq-2026-08-01.log', 'kryptoniq-2026-10-11.log', 'notes.txt', 'launcher.log']) writeFileSync(path.join(d, f), 'x');
    expect(pruneLogs(d, Date.parse('2026-09-12T00:00:00Z'))).toBe(1);
    expect(existsSync(path.join(d, 'kryptoniq-2026-08-01.log'))).toBe(false);
    expect(existsSync(path.join(d, 'kryptoniq-2026-10-11.log'))).toBe(true);
    expect(existsSync(path.join(d, 'notes.txt'))).toBe(true);
    expect(existsSync(path.join(d, 'launcher.log'))).toBe(true); // owned by scripts/kryptoniq.sh (TD-LAUNCH)
    expect(pruneLogs(path.join(d, 'missing'), Date.now())).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('coin logos (TD-ICONS)', () => {
  it('serves branded SVGs locally, resolves aliases and rejects unknown or unsafe symbols', async () => {
    const h = { host: '127.0.0.1:4317' };
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
    const c2 = createContext(config, silentLogger, { nli: fakeNli, clientFactory: fakeClients(), box: new SecretBox(Buffer.alloc(32, 7)), retryDelaysMs: [0, 0] });
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
      const api = await a2.inject({ url: '/api/nope', headers: { host: '127.0.0.1:4317' } });
      expect(api.statusCode).toBe(404);
      expect(api.json().error.code).toBe('NOT_FOUND');
    } finally {
      await a2.close();
      c2.db.close();
    }
  });
});

describe('background launcher (TD-LAUNCH)', () => {
  it('KRYPTONIQ_QUIET=1 keeps the logger off the console but still writes the daily file', async () => {
    const { createLogger } = await import('./log.ts');
    expect(loadConfig({} as NodeJS.ProcessEnv).quietConsole).toBe(false);
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
    const db = new Db(':memory:');
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
    const st = s.status().find((j) => j.name === 'boom');
    expect(st?.lastError).toBe('kaput');
    await s.stop();
    db.close();
  });
});
