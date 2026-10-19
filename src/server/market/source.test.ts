// FD-MARKETSRC: where each user's crypto prices come from (connected exchange, a choice among several, the admin's
// default), the per-pair fallback, the move of the exchange and history settings, and the routes that use them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContext, type AppContext } from '../context.ts';
import { loadConfig } from '../config.ts';
import { buildApp } from '../http/app.ts';
import { hashPassword } from '../auth/passwords.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { testDb } from '../test/db.ts';
import type { NliScorer } from '../sentiment/local.ts';
import { TIMEFRAMES, type Timeframe } from '../../shared/time.ts';
import type { MarketData } from './market.ts';
import { MarketSource, SOURCE_TTL_MS } from './source.ts';

const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };

/** Pairs and timeframes per exchange, as the checks of 14 Oct 2026 found them (8h missing on Bybit); OKX is "down". */
const LISTED: Record<string, string[]> = { kucoin: ['BTC/USDT', 'ETH/USDT', 'XYZ/USDT'], bybit: ['BTC/USDT', 'ETH/USDT'], binance: ['BTC/USDT', 'ETH/USDT'], bitget: ['BTC/USDT'] };
const NO_8H = TIMEFRAMES.filter((t) => t !== '8h');
const TFS: Record<string, Timeframe[]> = { kucoin: [...TIMEFRAMES], binance: [...TIMEFRAMES], bybit: NO_8H, okx: NO_8H, bitget: NO_8H };
let calls: string[];
const fakeMarket = {
  lists: async (id: string, symbol: string) => {
    if (id === 'okx') throw new Error('okx: nu se poate încărca lista de piețe');
    return LISTED[id]?.includes(symbol) ?? false;
  },
  timeframes: (id: string) => TFS[id] ?? [],
  candles: async (id: string, symbol: string, tf: Timeframe, count: number) => {
    calls.push(`${id}|${symbol}|${tf}|${count}`);
    return { exchange: id, symbol, tf, candles: [], pricePrecision: 2, lastClosedIndex: -1, fetchedAt: Date.now() };
  },
  searchSymbols: async (id: string, q: string) =>
    (LISTED[id] ?? []).filter((s) => s.startsWith(q)).map((symbol) => ({ symbol, base: symbol.split('/')[0], quote: 'USDT', type: 'spot' })),
} as unknown as MarketData;

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;

beforeEach(async () => {
  calls = [];
  dir = mkdtempSync(path.join(tmpdir(), 'sq-src-'));
  ctx = await createContext(loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), silentLogger, { db: await testDb(), nli: fakeNli, box: new SecretBox(Buffer.alloc(32, 5)), market: fakeMarket });
  // A signed-in admin needs an address and a password (an account without them cannot sign in), and two-factor (FD-2FA).
  await ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, totp_confirmed_at = 1 WHERE id = 1', ['admin@example.com', 'Admin', await hashPassword('Admin-password-1')]);
  app = await buildApp(ctx);
});
afterEach(async () => {
  await app.close();
  await ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const addAccount = (exchange: string, userId = 1) =>
  ctx.db.run("INSERT INTO exchange_accounts(exchange, label, api_key, secret, key_hint, created_at, user_id) VALUES (?, ?, N'x', N'x', N'…', 1, ?)", [exchange, exchange, userId]);
const page = async () => ({ host: 'localhost', cookie: `sentiq_session=${await ctx.sessions.create(1, 'full')}`, 'x-sentiq': '1', 'content-type': 'application/json' });
const get = async (url: string) => app.inject({ method: 'GET', url, headers: await page() });

describe('the exchange of a user (FD-MARKETSRC §2)', () => {
  it('is the connected one, the one chosen among several, otherwise the default', async () => {
    let t = 1_000_000;
    const src = new MarketSource(ctx.db, ctx.settings, fakeMarket, () => t);
    expect(await src.forUser(1)).toEqual({ exchange: 'kucoin', connected: [], defaultExchange: 'kucoin', candles: 1500 });
    // Kraken cannot give prices (FD-MARKETSRC §1): still the default.
    await addAccount('kraken');
    src.forget(1);
    expect((await src.forUser(1)).exchange).toBe('kucoin');
    await addAccount('bybit');
    // Kept 30 s: an account added on another instance shows after that.
    expect((await src.forUser(1)).exchange).toBe('kucoin');
    t += SOURCE_TTL_MS;
    expect(await src.forUser(1)).toMatchObject({ exchange: 'bybit', connected: ['bybit'] });
    // Two: the first added until one is chosen.
    await addAccount('binance');
    await addAccount('bybit');
    src.forget(1);
    expect(await src.forUser(1)).toMatchObject({ exchange: 'bybit', connected: ['bybit', 'binance'] });
    await ctx.settings.updateFor(1, true, { market: { exchange: 'binance' } });
    expect((await src.forUser(1)).exchange).toBe('binance');
    // The chosen one removed: the first that is left.
    await ctx.db.run("DELETE FROM exchange_accounts WHERE exchange = N'binance'");
    src.forget(1);
    expect((await src.forUser(1)).exchange).toBe('bybit');
    // The history is everyone's, set by the admin.
    await ctx.settings.updateFor(1, true, { marketData: { candles: 3000 } });
    expect((await src.forUser(1)).candles).toBe(3000);
  });

  it('uses the first added until the user chooses, even when the default exchange is among them', async () => {
    const src = new MarketSource(ctx.db, ctx.settings, fakeMarket);
    await addAccount('binance');
    await addAccount('kucoin');
    expect((await ctx.settings.forUser(1)).market.exchange).toBeUndefined();
    expect((await src.forUser(1)).exchange).toBe('binance');
    await ctx.settings.updateFor(1, true, { market: { exchange: 'kucoin' } });
    expect((await src.forUser(1)).exchange).toBe('kucoin');
  });

  it('takes a pair (or a timeframe) the user\'s exchange lacks from the default, never when it is only unreachable', async () => {
    const src = new MarketSource(ctx.db, ctx.settings, fakeMarket);
    await addAccount('bybit');
    expect(await src.forSymbol(1, 'BTC/USDT')).toBe('bybit');
    expect(await src.forSymbol(1, 'XYZ/USDT')).toBe('kucoin');
    // Listed nowhere: the user's exchange, whose error reaches the page.
    expect(await src.forSymbol(1, 'NOPE/USDT')).toBe('bybit');
    // 8h: not on Bybit, so from the default (FD-MARKETSRC §3, a scanner timeframe saved before).
    expect(await src.forSymbol(1, 'BTC/USDT', '8h')).toBe('kucoin');
    expect(await src.forSymbol(1, 'BTC/USDT', '4h')).toBe('bybit');
    // An exchange that cannot be read is not replaced.
    await ctx.db.run('DELETE FROM exchange_accounts');
    await addAccount('okx');
    src.forget(1);
    expect(await src.forSymbol(1, 'XYZ/USDT')).toBe('okx');
  });
});

describe('the scanner (TD-MARKETSRC §4)', () => {
  it('scans each favourite where its chart comes from, with everyone\'s history', async () => {
    await addAccount('bybit');
    ctx.marketSource.forget(1);
    await ctx.db.run('DELETE FROM watchlist WHERE user_id = 1');
    for (const [i, coin] of ['BTC', 'XYZ'].entries()) {
      await ctx.db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (1, ?, N'USDT', ?, N'[]', 1, N'crypto')", [coin, i]);
    }
    await ctx.settings.updateFor(1, true, { marketData: { candles: 3000 }, scanner: { tf: '4h' } });
    await ctx.scanner.run();
    expect(calls).toEqual(expect.arrayContaining(['bybit|BTC/USDT|4h|3000', 'kucoin|XYZ/USDT|4h|3000']));
    expect(ctx.scanner.result(1)?.exchange).toBe('bybit');
  });
});

describe('the exchange and the history become everyone\'s (FD-MARKETSRC §3)', () => {
  it('takes them once from the admin\'s own settings; old rows with market.candles still read', async () => {
    const write = async (key: string, value: object) => ctx.db.run('UPDATE settings SET value = ? WHERE [key] = ?', [JSON.stringify(value), key]);
    // As before FD-MARKETSRC: no marketData anywhere, the admin's own row with the exchange and the history.
    const global = JSON.parse((await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE [key] = N'app'"))!.value);
    delete global.marketData;
    await write('app', global);
    await ctx.db.run('DELETE FROM user_settings WHERE user_id = 1');
    await ctx.db.run('INSERT INTO user_settings(user_id, value) VALUES (1, ?)', [JSON.stringify({ timezone: 'UTC', market: { exchange: 'bybit', defaultTf: '4h', candles: 5000 } })]);
    const fresh = new SettingsService(ctx.db, ctx.box);
    await fresh.migrateMarketData(1);
    expect((await fresh.get()).marketData).toEqual({ exchange: 'bybit', candles: 5000 });
    expect((await fresh.forUser(1)).market).toEqual({ exchange: 'bybit', defaultTf: '4h' });
    // Once: later changes of the admin's own row do not move it again.
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 1', [JSON.stringify({ market: { exchange: 'okx', candles: 1500 } })]);
    await fresh.migrateMarketData(1);
    expect((await new SettingsService(ctx.db, ctx.box).get()).marketData).toEqual({ exchange: 'bybit', candles: 5000 });
    // Values no longer offered fall back to the defaults.
    delete global.marketData;
    await write('app', global);
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 1', [JSON.stringify({ market: { exchange: 'kraken', candles: 2000 } })]);
    const again = new SettingsService(ctx.db, ctx.box);
    await again.migrateMarketData(1);
    expect((await again.get()).marketData).toEqual({ exchange: 'kucoin', candles: 1500 });
  });
});

describe('the routes (TD-MARKETSRC §3)', () => {
  it('say where the prices come from and fetch each pair from there', async () => {
    expect((await get('/api/market/source')).json()).toEqual({ exchange: 'kucoin', userExchange: 'kucoin', connected: [], defaultExchange: 'kucoin', candles: 1500, timeframes: [...TIMEFRAMES] });
    await addAccount('bybit');
    await addAccount('kraken');
    ctx.marketSource.forget(1);
    expect((await get('/api/market/source')).json()).toMatchObject({ exchange: 'bybit', userExchange: 'bybit', connected: ['bybit'], timeframes: NO_8H });
    // A pair Bybit lacks: the default, for the source and for the candles.
    expect((await get('/api/market/source?symbol=XYZ/USDT')).json()).toMatchObject({ exchange: 'kucoin', userExchange: 'bybit', timeframes: [...TIMEFRAMES] });
    expect((await get('/api/market/candles?symbol=BTC/USDT&tf=1h')).statusCode).toBe(200);
    expect((await get('/api/market/candles?symbol=XYZ/USDT&tf=1h&limit=200')).statusCode).toBe(200);
    // An open tab from before names its exchange: still served.
    expect((await get('/api/market/candles?exchange=binance&symbol=BTC/USDT&tf=1h')).statusCode).toBe(200);
    expect(calls).toEqual(['bybit|BTC/USDT|1h|1500', 'kucoin|XYZ/USDT|1h|200', 'binance|BTC/USDT|1h|1500']);
    // The search covers the user's exchange and the default one, each pair once.
    expect((await get('/api/market/symbols?q=')).json().map((m: { symbol: string }) => m.symbol)).toEqual(['BTC/USDT', 'ETH/USDT', 'XYZ/USDT']);
    // Removing the account through the API: the prices go back to the default at once.
    const bybit = (await ctx.db.get<{ id: number }>("SELECT id FROM exchange_accounts WHERE exchange = N'bybit'"))!.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${bybit}`, headers: await page() })).statusCode).toBe(200);
    expect((await get('/api/market/source')).json()).toMatchObject({ exchange: 'kucoin', connected: [] });
    // The admin's history for everyone.
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers: await page(), payload: JSON.stringify({ marketData: { candles: 3000, exchange: 'binance' } }) })).statusCode).toBe(200);
    expect((await get('/api/market/source')).json()).toMatchObject({ exchange: 'binance', defaultExchange: 'binance', candles: 3000 });
  });
});
