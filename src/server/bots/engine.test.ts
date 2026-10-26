// FD-BOT, TD-BOT §7: the bots end to end, through the API and the engine's looks, on simulated prices and a simulated
// platform (never a real order): the simulation, the period, the pause, the stop, the loss limits, the real orders
// (the key saved before an order leaves, sent again after a network error), a problem, a deleted account, a position
// closed outside the bot, Slingshot Premium's checks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContext, type AppContext } from '../context.ts';
import { testDb } from '../test/db.ts';
import { loadConfig } from '../config.ts';
import { buildApp } from '../http/app.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { hashPassword } from '../auth/passwords.ts';
import { newSecret } from '../auth/totp.ts';
import type { NliScorer } from '../sentiment/local.ts';
import type { ClientFactory, Portfolio } from '../exchange/accounts.ts';
import type { TraderFactory } from '../exchange/trading/service.ts';
import { TradingError, type Trader } from '../exchange/trading/types.ts';
import type { MarketData } from '../market/market.ts';
import type { Candle, SlingshotResult, SlingshotSignal } from '../../shared/indicator/slingshot.ts';
import type { OrderTicket } from '../../shared/trading.ts';
import { DEFAULT_WEIGHTS, type BotCheck, type BotDetail, type BotView } from '../../shared/bot.ts';
import { BotEngine, type Bar } from './engine.ts';
import type { BotState } from './state.ts';
import { tfSeconds } from '../../shared/time.ts';

const BOX = new SecretBox(Buffer.alloc(32, 7));
const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };
const MIN = 60_000;

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;
let H: Record<string, string>;
let clock: number;
let px: Record<string, number>;
let placed: OrderTicket[];
let placeError: Error | null;
/** What the simulated platform says is wrong with an order (it refuses it). */
let normalizeErrors: string[];
let positions: Portfolio['positions'];
/** What Slingshot says on each closed bar (an hour each); null: no bar. */
let barSpec: { signals: Partial<SlingshotSignal>[]; alerts?: SlingshotResult['alerts'] } | null;
const HOUR = 60 * MIN;
let mood: { index: number; area: number; areaCount: number };
let aiAnswer: { decision: 'enter' | 'skip'; confidence: number; reason: string; risks: string[] } | null;
/** What the AI was asked (FD-BOTSLRR: no R:R in it). */
let aiAsked: { system: string; prompt: string }[] = [];
let keyN = 0;
let engine: BotEngine;

const candles = (p: number): Candle[] => [
  { t: clock - 2 * MIN, o: p, h: p, l: p, c: p, v: 1 },
  { t: clock - MIN, o: p, h: p, l: p, c: p, v: 1 },
];
const fakeMarket = {
  timeframes: () => ['1m', '5m', '1h', '1d'],
  lists: async () => true,
  candles: async (exchange: string, symbol: string, tf: string) => {
    const p = px[symbol];
    if (p === undefined) throw new Error(`fără ${symbol}`);
    return { exchange, symbol, tf, candles: candles(p), pricePrecision: 2, lastClosedIndex: 0, fetchedAt: clock };
  },
} as unknown as MarketData;

const fakeClients: ClientFactory = () => ({ spot: { privateGetUserApiKey: async () => ({ data: { permission: 'General,Spot,Futures' } }) } as never, futures: null });
/** FD-BOT §10: the shares held at the simulated brokers, and eToro's positions (each apart, with its id). */
let shares: Record<string, number>;
let etoroPositions: { id: string; units: number; isBuy: boolean; openedAt: number }[];
/** eToro shows a new position only at the next reading (the order still being processed). */
let etoroLate: boolean;
let etoroLateList: typeof etoroPositions;
let etoroN = 0;
const t212Trader = (): Trader => ({
  symbols: async () => [],
  instrument: async (market, symbol) => ({ market, symbol, ref: null, name: null, currency: 'USD', base: symbol, last: px[symbol] ?? null, amountStep: null, minAmount: null, minCost: null, priceStep: null, contractSize: null, maxLeverage: null, availableQuote: 10_000, availableBase: shares[symbol] ?? 0, position: null }),
  normalize: async (ticket) => {
    const errors: string[] = [];
    if (ticket.side === 'sell' && ticket.amount > (shares[ticket.symbol] ?? 0) + 1e-9) errors.push('Trading 212 nu vinde în lipsă.');
    return { ticket, displaySymbol: ticket.symbol, amount: ticket.amount, contracts: null, price: null, triggerPrice: null, last: px[ticket.symbol] ?? null, value: null, margin: null, available: 10_000, currency: 'USD', env: 'live', warnings: [], errors };
  },
  place: async (p) => {
    placed.push(p.ticket);
    shares[p.ticket.symbol] = (shares[p.ticket.symbol] ?? 0) + (p.ticket.side === 'buy' ? 1 : -1) * p.ticket.amount;
    return { status: 'filled', orderId: `t${placed.length}`, message: null, followUps: [] };
  },
  cancel: async () => ({ status: 'cancelled', orderId: null, message: null, followUps: [] }),
  normalizeModify: async () => {
    throw new Error('not used');
  },
  modify: async () => {
    throw new Error('not used');
  },
});
const etoroTrader = (): Trader => ({
  ...t212Trader(),
  instrument: async (market, symbol) => {
    // What was opened while "processing" shows once eToro is done with it.
    if (!etoroLate) etoroPositions.push(...etoroLateList.splice(0));
    return { market, symbol, ref: '1001', name: null, currency: 'USD', base: symbol, last: px[symbol] ?? null, amountStep: null, minAmount: null, minCost: null, priceStep: null, contractSize: null, maxLeverage: null, availableQuote: 10_000, availableBase: etoroPositions.filter((p) => p.isBuy).reduce((a, p) => a + p.units, 0), position: null, positions: etoroPositions.map((p) => ({ ...p, openRate: null, pnl: null, invested: null, leverage: 1 })) };
  },
  normalize: async (ticket) => {
    const errors: string[] = [];
    if (!ticket.close && ticket.side === 'sell' && ticket.stopLoss === undefined) errors.push('eToro cere stop loss la o poziție short.');
    for (const id of ticket.close?.positionIds ?? []) if (!etoroPositions.some((p) => p.id === id)) errors.push(`Poziția ${id} nu mai e deschisă.`);
    return { ticket, displaySymbol: ticket.symbol, amount: ticket.amount, contracts: null, price: null, triggerPrice: null, last: px[ticket.symbol] ?? null, value: null, margin: null, available: 10_000, currency: 'USD', env: 'live', warnings: [], errors };
  },
  place: async (p) => {
    const t = p.ticket;
    placed.push(t);
    if (t.close) {
      let left = t.close.units ?? Infinity;
      for (const id of t.close.positionIds) {
        const pos = etoroPositions.find((x) => x.id === id);
        if (!pos || left <= 0) continue;
        const take = Math.min(pos.units, left);
        pos.units -= take;
        left -= take;
      }
      etoroPositions = etoroPositions.filter((x) => x.units > 1e-9);
    } else (etoroLate ? etoroLateList : etoroPositions).push({ id: `e${++etoroN}`, units: t.amount, isBuy: t.side === 'buy', openedAt: clock });
    return { status: 'filled', orderId: `o${placed.length}`, message: null, followUps: [] };
  },
});
const fakeTrader: TraderFactory = (a) => (a.exchange === 'trading212' ? t212Trader() : a.exchange === 'etoro' ? etoroTrader() : cryptoTrader());
const cryptoTrader = () => {
  const t: Trader = {
    symbols: async () => [],
    instrument: async (market, symbol) => ({ market, symbol, ref: null, name: null, currency: 'USDT', base: 'BTC', last: px['BTC/USDT'] ?? 100, amountStep: 0.0001, minAmount: 0.0001, minCost: 1, priceStep: 0.01, contractSize: null, maxLeverage: 50, availableQuote: 10_000, availableBase: 10, position: null }),
    normalize: async (ticket) => ({ ticket, displaySymbol: ticket.symbol, amount: ticket.amount, contracts: null, price: null, triggerPrice: null, last: 100, value: ticket.amount * 100, margin: null, available: 10_000, currency: 'USDT', env: 'live', warnings: [], errors: [...normalizeErrors] }),
    place: async (p) => {
      // The bot's key is saved before the order leaves (TD-BOT §4).
      const row = await ctx.db.get<{ state: string }>('SELECT TOP (1) state FROM bots ORDER BY id DESC');
      const st = JSON.parse(row?.state ?? '{}') as BotState;
      expect(st.pending?.key).toBe(p.ticket.idemKey);
      if (placeError) {
        const e = placeError;
        placeError = null;
        throw e;
      }
      placed.push(p.ticket);
      return { status: 'filled', orderId: `o${placed.length}`, message: null, followUps: [] };
    },
    cancel: async () => ({ status: 'cancelled', orderId: null, message: null, followUps: [] }),
    normalizeModify: async () => {
      throw new Error('not used');
    },
    modify: async () => {
      throw new Error('not used');
    },
  };
  return t;
};

/** A simulated US market, open. */
const fakeStocks = {
  confirmedStatus: async () => ({ state: 'open', label: 'Deschisă', opensAt: null, closesAt: null, fetchedAt: clock }),
  quote: async (sym: string) => {
    const p = px[sym];
    if (p === undefined) throw new Error(`fără ${sym}`);
    return { symbol: sym, name: null, last: p, change: null, changePct: null, status: 'Market Open', fetchedAt: clock };
  },
};

const post = (url: string, body?: unknown) => app.inject({ method: 'POST', url, headers: H, payload: body === undefined ? '{}' : JSON.stringify(body) });
const put = (url: string, body: unknown) => app.inject({ method: 'PUT', url, headers: H, payload: JSON.stringify(body) });
const get = (url: string) => app.inject({ method: 'GET', url, headers: H });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers: H });
const detail = async (id: number) => (await get(`/api/bots/${id}`)).json() as BotDetail;
const look = async (ms = 30_000) => {
  clock += ms;
  await engine.run();
};

const common = {
  name: 'Test',
  exec: 'paper',
  accountId: null,
  market: 'spot',
  symbols: ['BTC/USDT'],
  tf: '1h',
  maxAmount: 1000,
  leverage: 1,
  startsAt: null,
  endsAt: null,
  endAction: 'close',
  dailyLoss: null,
  lossStop: null,
  fee: 0.1,
};
const grid = { lower: 90, upper: 110, grids: 4, spacing: 'arithmetic', direction: 'long', stopBelow: null, stopAbove: null, trigger: null };
const dca = { direction: 'long', baseOrder: 100, safetyOrders: 2, safetyOrder: 100, volumeScale: 1, deviation: 2, stepScale: 1, takeProfit: 2, stopLoss: null, slAction: 'stop', repeat: true, maxCycles: null, cooldownMin: 0 };
const premium = {
  direction: 'long',
  sizing: 'fixed',
  amount: 100,
  riskPct: 1,
  maxPerTrade: null,
  levels: 'slingshot',
  slPct: 1,
  tpPct: 2,
  exitOnTpSignal: true,
  exitOnFlip: true,
  exitOnOpposite: true,
  longMin: 50,
  shortMax: 50,
  areaVeto: true,
  newsWindowMin: 0,
  weights: DEFAULT_WEIGHTS,
  ai: 'off',
  aiFallback: 'skip',
  maxOpen: 1,
  cooldownMin: 0,
};
const make = async (body: Record<string, unknown>) => {
  const r = await post('/api/bots', body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as BotDetail;
};

/** A Slingshot result with the given signals and alerts; the closed bar is 10, opened at `closedTime`. */
const slingshot = (signals: Partial<SlingshotSignal>[], alerts: SlingshotResult['alerts'] = [], closedTime = clock - HOUR): Bar => ({
  r: {
    emaFast: [],
    emaSlow: [],
    uptrend: Array.from({ length: 12 }, () => true),
    markers: [],
    signals: signals.map((s) => ({ side: 'long', bar: 8, time: 8000, confirmBar: 10, confirmTime: 10_000, entry: 95, sl: 90, tp: 115, breakout: 100, outcome: 'active', provisional: false, ...s })),
    alerts,
    atr: null,
    atrShort: null,
    ms: null,
    last: null,
    warnings: [],
  },
  closed: 10,
  closedTime,
  close: px['BTC/USDT'] ?? 100,
});

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-bots-'));
  const config = { ...loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'no-web') };
  ctx = await createContext(config, silentLogger, { nli: fakeNli, market: fakeMarket, clientFactory: fakeClients, traderFactory: fakeTrader, box: BOX, retryDelaysMs: [0, 0], db: await testDb() });
  app = await buildApp(ctx);
  await ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, totp_secret = ?, totp_confirmed_at = 1 WHERE id = 1', ['admin@example.com', 'Admin', await hashPassword('Admin-password-1'), BOX.encrypt(newSecret())]);
  H = { host: 'localhost:4317', 'x-sentiq': '1', 'content-type': 'application/json', cookie: `sentiq_session=${await ctx.sessions.create(1, 'full')}` };
  clock = Date.now();
  px = { 'BTC/USDT': 101, 'ETH/USDT': 2000 };
  placed = [];
  placeError = null;
  normalizeErrors = [];
  shares = {};
  etoroPositions = [];
  etoroLate = false;
  etoroLateList = [];
  etoroN = 0;
  positions = [];
  barSpec = null;
  mood = { index: 50, area: 50, areaCount: 20 };
  aiAnswer = null;
  aiAsked = [];
  keyN = 0;
  const d = ctx.botEngine.deps;
  engine = new BotEngine({
    ...d,
    now: () => clock,
    uuid: () => `0f3c2a1e-5b6d-4c7e-8f90-${String(++keyN).padStart(12, '0')}`,
    stocks: fakeStocks as never,
    // The closed bar of the bot's timeframe (an hour, a day for shares without a Twelve Data key).
    bars: async (_u, input, _s, now) => {
      const tf = tfSeconds(input.tf) * 1000;
      return barSpec ? slingshot(barSpec.signals, barSpec.alerts, Math.floor(now / tf) * tf - tf) : null;
    },
    accounts: Object.assign(Object.create(Object.getPrototypeOf(d.accounts)), d.accounts, {
      portfolio: async (id: number) => ({ accountId: id, exchange: 'kucoin', kind: 'crypto', currency: 'USDT', cash: null, asOf: null, mode: 'classic', balances: [{ asset: 'USDT', account: 'trade', total: 10_000, free: 10_000, used: 0, price: 1, value: 10_000, avgPrice: null, avgSource: null, pnl: null, pnlPct: null }, ...Object.entries(shares).map(([asset, total]) => ({ asset, account: 'invest', total, free: total, used: 0, price: null, value: null, avgPrice: null, avgSource: null, pnl: null, pnlPct: null })), ...(etoroPositions.some((p) => p.isBuy) ? [{ asset: 'AAPL', account: 'etoro', total: etoroPositions.filter((p) => p.isBuy).reduce((a, p) => a + p.units, 0), free: 0, used: 0, price: null, value: null, avgPrice: null, avgSource: null, pnl: null, pnlPct: null }] : [])] as never, positions: [...positions, ...etoroPositions.filter((p) => !p.isBuy).map((p) => ({ symbol: 'AAPL/USD', side: 'short', contracts: p.units, size: p.units, entryPrice: null, markPrice: null, unrealizedPnl: null, percentage: null, liquidationPrice: null, leverage: 1, marginMode: null, notional: null }))], orders: [], fills: [], totals: { spotValue: 0, unrealizedPnl: 0, futuresAvailable: 10_000 }, errors: {}, stale: {}, fetchedAt: clock }) as Portfolio,
    }),
    daily: Object.assign(Object.create(Object.getPrototypeOf(d.daily)), d.daily, {
      scopeFor: async () => null,
      today: async () => ({ index: mood.index, confidence: 'high', counts: { positive: 10, neutral: 5, negative: 5, pending: 0, excluded: 0 }, breakdown: { crypto: { index: mood.area, raw: 0, weight: 1, count: mood.areaCount }, stocks: { index: 50, raw: 0, weight: 1, count: 5 }, macro: { index: 50, raw: 0, weight: 1, count: 5 }, geopolitics: { index: 50, raw: 0, weight: 1, count: 5 } }, drivers: { positive: [], negative: [] } }),
      history: async () => [{ day: 'x', index: mood.index, confidence: 'high', count: 10, final: true }],
      coinItems: async () => [],
    }),
    ai: Object.assign(Object.create(Object.getPrototypeOf(d.ai)), d.ai, {
      config: async () => ({ provider: 'anthropic', model: 'claude-test', scoring: false, key: 'sk-test' }),
      client: () => ({
        provider: 'anthropic',
        model: 'claude-test',
        generate: async (req: { system: string; prompt: string }) => {
          aiAsked.push(req);
          return aiAnswer ? { parsed: aiAnswer, stop: 'done', usage: { input: 100, output: 20 } } : Promise.reject(new Error('timeout'));
        },
      }),
    }),
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a simulated grid, end to end (FD-BOT §4)', () => {
  it('checks, starts, buys low and sells high, shows itself, stops closing everything, is deleted', async () => {
    const check = (await post('/api/bots/check', { strategy: 'grid', ...common, grid })).json();
    expect(check.errors).toEqual([]);
    expect(check.price).toBe(101);
    expect(check.grid.atStart).toBe(2);
    expect(check.summary[0]).toMatch(/^Între 90 și 110, 4 grile aritmetice/);
    const bot = await make({ strategy: 'grid', ...common, grid });
    expect(bot).toMatchObject({ status: 'running', exec: 'paper', currency: 'USDT', committed: 0 });
    expect(bot.events[0]?.message).toMatch(/a pornit, în simulare/);

    await look();
    let d = await detail(bot.id);
    expect(d.grid?.slots.map((s) => s.entry)).toEqual([null, null, 101, 101]);
    const q = d.grid?.qty as number;
    expect(q * (90 + 95 + 100 + 105)).toBeCloseTo(1000, 6);
    expect(d.positions).toHaveLength(1);
    expect(d.positions[0]).toMatchObject({ side: 'long', entry: 101 });
    expect(d.committed).toBeCloseTo(2 * q * 101, 6);

    px['BTC/USDT'] = 105;
    await look();
    d = await detail(bot.id);
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ side: 'long', entry: 101, exit: 105, reason: 'grid' });
    expect(d.history[0]?.pnl).toBeCloseTo(q * 4 - q * 101 * 0.001 - q * 105 * 0.001, 9);
    expect(d.grid?.slots.map((s) => s.entry)).toEqual([null, null, null, 101]);

    px['BTC/USDT'] = 94;
    await look();
    d = await detail(bot.id);
    expect(d.grid?.slots.map((s) => s.entry)).toEqual([null, 94, 94, 101]);
    expect(d.events.find((e) => e.kind === 'enter')?.message).toMatch(/Grila la 94: 2 intervale umplute/);

    // Grids cannot be finished; stopping closes them.
    expect((await post(`/api/bots/${bot.id}/stop`, { action: 'finish' })).statusCode).toBe(400);
    expect((await del(`/api/bots/${bot.id}`)).statusCode).toBe(409);
    expect((await post(`/api/bots/${bot.id}/stop`, { action: 'close' })).json().status).toBe('ending');
    await look();
    d = await detail(bot.id);
    expect(d.status).toBe('ended');
    expect(d.positions).toEqual([]);
    expect(d.history.filter((t) => t.reason === 'stop')).toHaveLength(3);
    expect(d.trades).toBe(4);
    expect((await put(`/api/bots/${bot.id}`, { name: 'x', endsAt: null, endAction: 'close', dailyLoss: null, lossStop: null, fee: 0.1 })).statusCode).toBe(409);
    expect((await del(`/api/bots/${bot.id}`)).json()).toEqual({ ok: true });
    expect((await get('/api/bots')).json()).toEqual([]);
  });

  it('a start price waits; "Oprește sub" closes everything and ends the bot', async () => {
    const bot = await make({ strategy: 'grid', ...common, grid: { ...grid, trigger: 103, stopBelow: 85 } });
    await look();
    expect((await detail(bot.id)).grid).toMatchObject({ armed: true, trigger: 103 });
    px['BTC/USDT'] = 103.5;
    await look();
    let d = await detail(bot.id);
    expect(d.grid?.armed).toBe(false);
    // Started at 103.5: the grids above it (100–105, 105–110) bought at the market.
    expect(d.grid?.slots.map((s) => s.entry)).toEqual([null, null, 103.5, 103.5]);
    px['BTC/USDT'] = 84;
    await look();
    d = await detail(bot.id);
    expect(d.history.at(0)?.reason).toBe('grid_stop');
    await look();
    d = await detail(bot.id);
    expect(d).toMatchObject({ status: 'ended', statusReason: expect.stringMatching(/Oprește sub/) });
  });
});

describe('DCA, the period, the pause and the loss limits (FD-BOT §3, §5)', () => {
  it('scheduled → running → the period ends → finishes the open cycle → ended', async () => {
    const start = Date.now() + 2 * MIN;
    const bot = await make({ strategy: 'dca', ...common, startsAt: start, endsAt: start + 10 * MIN, endAction: 'finish', dca });
    expect(bot.status).toBe('scheduled');
    await look();
    expect((await detail(bot.id)).status).toBe('scheduled');
    clock = start;
    await look(1);
    let d = await detail(bot.id);
    expect(d.status).toBe('running');
    expect(d.dca?.deal).toMatchObject({ basePrice: 101, filled: 0 });
    // Both safety orders at once (2% and 4% down).
    px['BTC/USDT'] = 96;
    await look();
    d = await detail(bot.id);
    expect(d.dca?.deal?.filled).toBe(2);
    expect(d.events.find((e) => e.kind === 'enter')?.message).toMatch(/Ordinele de siguranță 1, 2 la 96/);
    // The period ends: no new cycle, the open one goes on to its take profit.
    clock = start + 10 * MIN;
    await look(1);
    d = await detail(bot.id);
    expect(d.status).toBe('ending');
    px['BTC/USDT'] = (d.dca?.deal?.tp as number) + 0.01;
    await look();
    d = await detail(bot.id);
    expect(d.status).toBe('ended');
    expect(d.history[0]).toMatchObject({ reason: 'tp' });
    expect(d.history[0]?.pnl).toBeGreaterThan(0);
  });

  it('a pause opens nothing new but takes the profit; "Reia" starts the next cycle', async () => {
    const bot = await make({ strategy: 'dca', ...common, dca });
    await look();
    expect((await post(`/api/bots/${bot.id}/pause`)).json().status).toBe('paused');
    expect((await post(`/api/bots/${bot.id}/pause`)).statusCode).toBe(409);
    px['BTC/USDT'] = 103.1;
    await look();
    let d = await detail(bot.id);
    expect(d.history).toHaveLength(1);
    expect(d.dca?.deal).toBeNull();
    await look();
    expect((await detail(bot.id)).dca?.deal).toBeNull();
    expect((await post(`/api/bots/${bot.id}/resume`)).json().status).toBe('running');
    await look();
    d = await detail(bot.id);
    expect(d.dca?.deal?.basePrice).toBe(103.1);
    expect(d.dca?.cycle).toBe(2);
  });

  it('no price for 10 minutes is a problem that passes by itself when the price is back', async () => {
    const bot = await make({ strategy: 'dca', ...common, dca });
    await look();
    delete px['BTC/USDT'];
    for (let i = 0; i < 21; i++) await look();
    let d = await detail(bot.id);
    expect(d).toMatchObject({ status: 'problem', statusReason: 'Prețul nu se poate citi de 10 minute.' });
    px['BTC/USDT'] = 101;
    await look();
    d = await detail(bot.id);
    expect(d.status).toBe('running');
    expect(d.events[0]?.message).toMatch(/Prețul se citește din nou/);
  });

  it('the daily loss stops the entries until the next day; the exits go on', async () => {
    const bot = await make({ strategy: 'dca', ...common, dailyLoss: 5, dca: { ...dca, safetyOrders: 0, stopLoss: 3, slAction: 'restart' } });
    await look();
    // −3%: the stop loss closes the cycle; the next opens at the next look.
    px['BTC/USDT'] = 97.9;
    await look();
    let d = await detail(bot.id);
    expect(d.history[0]?.reason).toBe('sl');
    expect(d.dca?.deal).toBeNull();
    await look();
    expect((await detail(bot.id)).dca?.deal?.basePrice).toBe(97.9);
    // Down 3% again: more than 5 lost today; the stop loss still closes, no new cycle opens.
    px['BTC/USDT'] = 94.9;
    await look();
    d = await detail(bot.id);
    expect(d.history).toHaveLength(2);
    expect(d.events.filter((e) => /Pierderea maximă pe zi/.test(e.message))).toHaveLength(1);
    await look();
    d = await detail(bot.id);
    expect(d.dca?.deal).toBeNull();
    expect(d.dca?.cycle).toBe(2);
  });

  it('the loss that stops the bot closes everything at once and ends it', async () => {
    const bot = await make({ strategy: 'dca', ...common, lossStop: 5, dca: { ...dca, safetyOrders: 0 } });
    await look();
    px['BTC/USDT'] = 95;
    await look();
    const d = await detail(bot.id);
    expect(d).toMatchObject({ status: 'ended', statusReason: 'Pierderea la care se oprește a fost atinsă.' });
    expect(d.history[0]).toMatchObject({ reason: 'loss_limit', exit: 95 });
  });
});

describe('real orders (FD-BOT §2, §8, §9)', () => {
  let account: number;
  beforeEach(async () => {
    account = (await ctx.accounts.create(1, { exchange: 'kucoin', label: 'KuCoin', credentials: { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' } })).id;
    await ctx.accounts.setTrading(account, ['spot', 'futures']);
  });

  it('sends a market order with the saved key; after a network error, the same key again; one real bot per symbol', async () => {
    const body = { strategy: 'dca', ...common, exec: 'real', accountId: account, market: 'futures', leverage: 5, dca };
    const check = (await post('/api/bots/check', body)).json();
    expect(check.errors).toEqual([]);
    expect(check.warnings[0]).toMatch(/Botul trimite ordine reale/);
    const bot = await make(body);
    expect((await post('/api/bots', body)).json().error.message).toMatch(/tranzacționează deja BTC\/USDT pe acest cont/);
    placeError = new Error('socket hang up');
    await look();
    let st = JSON.parse((await ctx.db.get<{ state: string }>('SELECT state FROM bots WHERE id = ?', [bot.id]))!.state) as BotState;
    expect(st.pending?.key).toBe('0f3c2a1e-5b6d-4c7e-8f90-000000000001');
    expect(placed).toHaveLength(0);
    await look();
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ idemKey: '0f3c2a1e-5b6d-4c7e-8f90-000000000001', market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', kind: 'market', amountIn: 'base', leverage: 5 });
    // 100 × 5 / 101, rounded down to the step.
    expect(placed[0]?.amount).toBe(4.9504);
    st = JSON.parse((await ctx.db.get<{ state: string }>('SELECT state FROM bots WHERE id = ?', [bot.id]))!.state) as BotState;
    expect(st.pending).toBeNull();
    expect(st.dca?.deal?.qty).toBe(4.9504);
    // The bot's orders are in the trading journal: the one cut off by the network, then the one sent.
    expect((await get('/api/trading/log')).json().filter((r: { action: string }) => r.action === 'order').map((r: { status: string }) => r.status).sort()).toEqual(['error', 'sent']);
  });

  it('an order whose fate is unknown is a problem; "Reia" forgets it; a deleted account ends the bot', async () => {
    const bot = await make({ strategy: 'dca', ...common, exec: 'real', accountId: account, market: 'futures', leverage: 2, dca });
    placeError = new TradingError('UNKNOWN_OUTCOME', 'Nu știm sigur dacă ordinul a ajuns.');
    await look();
    let d = await detail(bot.id);
    expect(d).toMatchObject({ status: 'problem', statusReason: expect.stringMatching(/Nu știm sigur/) });
    await look();
    expect(placed).toHaveLength(0);
    expect((await post(`/api/bots/${bot.id}/resume`)).json().status).toBe('running');
    await look();
    expect(placed).toHaveLength(1);
    await ctx.db.run('DELETE FROM exchange_accounts WHERE id = ?', [account]);
    await look();
    d = await detail(bot.id);
    expect(d).toMatchObject({ status: 'ended', statusReason: expect.stringMatching(/Contul a fost șters/), account: null });
  });

  it('a position closed outside the bot is booked "din afară"; a foreign position keeps the bot out', async () => {
    positions = [{ symbol: 'BTC/USDT:USDT', side: 'long', contracts: 1, size: 1, entryPrice: 90, markPrice: 101, unrealizedPnl: 11, percentage: null, liquidationPrice: null, leverage: 2, marginMode: 'cross', notional: 101 }];
    const bot = await make({ strategy: 'dca', ...common, exec: 'real', accountId: account, market: 'futures', leverage: 2, dca });
    await look();
    let d = await detail(bot.id);
    expect(placed).toHaveLength(0);
    expect(d.events[0]?.message).toMatch(/Există deja o poziție pe BTC\/USDT:USDT care nu e a botului/);
    positions = [];
    await look();
    expect(placed).toHaveLength(1);
    const qty = placed[0]?.amount as number;
    positions = [{ symbol: 'BTC/USDT:USDT', side: 'long', contracts: qty, size: qty, entryPrice: 101, markPrice: 101, unrealizedPnl: 0, percentage: null, liquidationPrice: null, leverage: 2, marginMode: 'cross', notional: 101 * qty }];
    await look(2 * MIN);
    expect((await detail(bot.id)).history).toHaveLength(0);
    // Closed by hand on the platform.
    positions = [];
    px['BTC/USDT'] = 102;
    await look();
    d = await detail(bot.id);
    expect(d.history[0]).toMatchObject({ reason: 'external', exit: 102 });
    expect(d.events.some((e) => /nu mai e în cont/.test(e.message))).toBe(true);
  });

  it('a refused entry waits 5 minutes, said once; a problem sends nothing and cannot be paused', async () => {
    const bot = await make({ strategy: 'dca', ...common, exec: 'real', accountId: account, market: 'futures', leverage: 2, dca });
    normalizeErrors = ['Fonduri insuficiente.'];
    await look();
    await look();
    let d = await detail(bot.id);
    expect(d.events.filter((e) => /Intrarea a fost refuzată: Fonduri insuficiente\. Botul mai încearcă peste 5 minute/.test(e.message))).toHaveLength(1);
    expect(d.dca?.deal ?? null).toBeNull();
    normalizeErrors = [];
    await look();
    expect((await detail(bot.id)).dca?.deal ?? null).toBeNull();
    await look(5 * MIN);
    d = await detail(bot.id);
    expect(d.dca?.deal?.filled).toBe(0);
    expect(placed).toHaveLength(1);
    const q = placed[0]?.amount as number;
    positions = [{ symbol: 'BTC/USDT:USDT', side: 'long', contracts: q, size: q, entryPrice: 101, markPrice: 101, unrealizedPnl: 0, percentage: null, liquidationPrice: null, leverage: 2, marginMode: 'cross', notional: 101 * q }];
    // A problem: no order, not even the take profit, until "Reia"; "Pauză" is not offered.
    placeError = new TradingError('PERMISSION', 'Cheia nu are dreptul de tranzacționare.');
    px['BTC/USDT'] = 96;
    await look();
    expect((await detail(bot.id)).status).toBe('problem');
    expect((await post(`/api/bots/${bot.id}/pause`)).statusCode).toBe(409);
    px['BTC/USDT'] = 110;
    await look();
    expect(placed).toHaveLength(1);
    expect((await detail(bot.id)).events.filter((e) => e.kind === 'problem')).toHaveLength(1);
    await post(`/api/bots/${bot.id}/resume`);
    await look();
    d = await detail(bot.id);
    expect(placed).toHaveLength(2);
    expect(d.history[0]?.reason).toBe('tp');
  });

  it("a real grid's unit is whole steps of the platform, so the account holds what the bot thinks", async () => {
    const bot = await make({ strategy: 'grid', ...common, exec: 'real', accountId: account, market: 'futures', leverage: 2, grid });
    await look();
    const d = await detail(bot.id);
    // 1000 × 2 / (90 + 95 + 100 + 105) = 5.128… → 5.1282 (step 0.0001); two grids at the start.
    expect(d.grid?.qty).toBe(5.1282);
    expect(placed[0]).toMatchObject({ symbol: 'BTC/USDT:USDT', side: 'buy', amount: 10.2564 });
    positions = [{ symbol: 'BTC/USDT:USDT', side: 'long', contracts: 10.2564, size: 10.2564, entryPrice: 101, markPrice: 101, unrealizedPnl: 0, percentage: null, liquidationPrice: null, leverage: 2, marginMode: 'cross', notional: 1035 }];
    await look(2 * MIN);
    expect((await detail(bot.id)).status).toBe('running');
  });

  it('refuses shares on an exchange account, an account without trading, the 11th active bot', async () => {
    // An exchange account for shares: refused (a broker's account is needed).
    expect((await post('/api/bots/check', { strategy: 'premium', ...common, exec: 'real', accountId: account, market: 'stock', symbols: ['AAPL'], premium })).json().errors).toContain('KuCoin nu e un cont de acțiuni.');
    await ctx.accounts.setTrading(account, null);
    expect((await post('/api/bots', { strategy: 'dca', ...common, exec: 'real', accountId: account, dca })).json().error.message).toMatch(/Tranzacționarea e oprită pe contul KuCoin/);
    for (let i = 0; i < 10; i++) await make({ strategy: 'dca', ...common, name: `B${i}`, dca });
    expect((await post('/api/bots', { strategy: 'dca', ...common, dca })).json().error.message).toMatch(/Cel mult 10 boți activi/);
  });
});

describe('real bots on shares (FD-BOT §10)', () => {
  let t212: number;
  let etoro: number;
  // Shares without a Twelve Data key: 1d.
  const stock = { strategy: 'premium', ...common, exec: 'real', market: 'stock', symbols: ['AAPL'], tf: '1d', premium };
  const DAY = 24 * HOUR;
  beforeEach(async () => {
    px.AAPL = 200;
    t212 = (await ctx.accounts.create(1, { exchange: 'trading212', label: 'T212', credentials: { apiKey: 'k1234567', secret: 's1234567' } })).id;
    await ctx.accounts.setTrading(t212, ['stock']);
    etoro = (await ctx.accounts.create(1, { exchange: 'etoro', label: 'eToro', credentials: { publicKey: 'pub-12345678', userKey: 'usr-12345678' } })).id;
    await ctx.accounts.setTrading(etoro, ['stock']);
  });
  const firstBar = async () => {
    clock = Math.ceil(clock / DAY) * DAY + 15 * HOUR;
    barSpec = { signals: [] };
    await look(1);
  };
  const nextBar = async (spec: NonNullable<typeof barSpec>) => {
    barSpec = spec;
    await look(DAY);
  };

  it("Trading 212: buys on a signal and sells only what it bought (the user's own shares stay); no short there", async () => {
    expect((await post('/api/bots/check', { ...stock, accountId: t212, premium: { ...premium, direction: 'both' } })).json().errors).toContain('La Trading 212, botul face doar long: short pe acțiuni doar la eToro.');
    shares.AAPL = 5;
    const bot = await make({ ...stock, accountId: t212 });
    await firstBar();
    await nextBar({ signals: [{ entry: 195, sl: 190, tp: 215 }] });
    expect(placed[0]).toMatchObject({ market: 'stock', symbol: 'AAPL', side: 'buy', kind: 'market', amountIn: 'base', amount: 0.5 });
    expect(placed[0]).not.toHaveProperty('reduceOnly');
    expect(placed[0]).not.toHaveProperty('leverage');
    expect(shares.AAPL).toBe(5.5);
    px.AAPL = 189;
    await look();
    expect(placed[1]).toMatchObject({ side: 'sell', amount: 0.5 });
    expect(shares.AAPL).toBeCloseTo(5, 9);
    expect((await detail(bot.id)).history[0]).toMatchObject({ reason: 'sl', exit: 189 });
  });

  it('eToro: notes its own positions and closes only them; a short goes with its stop loss; a position shown late is found', async () => {
    // The user's own position on the same share.
    etoroPositions.push({ id: 'u1', units: 3, isBuy: true, openedAt: clock - HOUR });
    const bot = await make({ ...stock, accountId: etoro, premium: { ...premium, direction: 'both' } });
    await firstBar();
    await nextBar({ signals: [{ entry: 195, sl: 190, tp: 215 }] });
    expect(placed[0]).toMatchObject({ side: 'buy', amount: 0.5 });
    let st = JSON.parse((await ctx.db.get<{ state: string }>('SELECT state FROM bots WHERE id = ?', [bot.id]))!.state) as BotState;
    expect(st.refs.AAPL).toEqual({ long: ['e1'], short: [] });
    px.AAPL = 216;
    await look();
    expect(placed[1]).toMatchObject({ side: 'sell', close: { positionIds: ['e1'] } });
    expect(placed[1]?.close).not.toHaveProperty('units');
    expect(etoroPositions).toEqual([{ id: 'u1', units: 3, isBuy: true, openedAt: expect.any(Number) }]);
    // A short, with the trade's stop loss; eToro shows it only later.
    etoroLate = true;
    await nextBar({ signals: [{ side: 'short', time: 9000, entry: 220, sl: 230, tp: 180 }] });
    // 100 USD at 216.
    expect(placed[2]).toMatchObject({ side: 'sell', stopLoss: 230 });
    expect(placed[2]?.amount).toBeCloseTo(100 / 216, 9);
    expect(placed[2]).not.toHaveProperty('close');
    st = JSON.parse((await ctx.db.get<{ state: string }>('SELECT state FROM bots WHERE id = ?', [bot.id]))!.state) as BotState;
    expect(st.refsWait.AAPL).toMatchObject({ side: 'short' });
    etoroLate = false;
    px.AAPL = 179;
    await look();
    expect(placed[3]).toMatchObject({ side: 'buy', close: { positionIds: ['e2'] } });
    const d = await detail(bot.id);
    expect(d.history.map((t) => t.reason)).toEqual(['tp', 'tp']);
    expect(etoroPositions.map((p) => p.id)).toEqual(['u1']);
  });

  it("eToro: the bot's position closed by hand is found by its id, though the user holds more of the share", async () => {
    etoroPositions.push({ id: 'u1', units: 3, isBuy: true, openedAt: clock - HOUR });
    const bot = await make({ ...stock, accountId: etoro });
    await firstBar();
    await nextBar({ signals: [{ entry: 195, sl: 190, tp: 215 }] });
    expect((await detail(bot.id)).positions).toHaveLength(1);
    etoroPositions = etoroPositions.filter((p) => p.id !== 'e1');
    await look(2 * MIN);
    const d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.history[0]).toMatchObject({ reason: 'external' });
    expect(placed).toHaveLength(1);
  });

  it('eToro shorts need a stop loss: the DCA cycle\'s, the grid\'s "Oprește peste"', async () => {
    const dcaShort = { strategy: 'dca', ...common, exec: 'real', accountId: etoro, market: 'stock', symbols: ['AAPL'], dca: { ...dca, direction: 'short' } };
    expect((await post('/api/bots/check', dcaShort)).json().errors).toContain('eToro cere stop loss la un short: pune stop loss-ul ciclului.');
    expect((await post('/api/bots/check', { ...dcaShort, dca: { ...dca, direction: 'short', stopLoss: 10 } })).json().errors).toEqual([]);
    const gridShort = { strategy: 'grid', ...common, exec: 'real', accountId: etoro, market: 'stock', symbols: ['AAPL'], grid: { ...grid, lower: 190, upper: 210, direction: 'short' } };
    expect((await post('/api/bots/check', gridShort)).json().errors[0]).toMatch(/pune „Oprește peste”/);
    // A DCA short at eToro opens with the cycle's stop loss.
    await make({ ...dcaShort, dca: { ...dca, direction: 'short', stopLoss: 10 } });
    await look();
    expect(placed[0]).toMatchObject({ side: 'sell', market: 'stock' });
    expect(placed[0]?.stopLoss).toBeCloseTo(220, 9);
  });
});

describe('Slingshot Premium (FD-BOT §6)', () => {
  /** The first look notes the closed bar it finds; only the bars that close after it are acted on. */
  const firstBar = async () => {
    clock = Math.ceil(clock / HOUR) * HOUR + 10 * MIN;
    barSpec = { signals: [] };
    await look(1);
  };
  /** The next hour's bar, with what Slingshot says on it. */
  const nextBar = async (spec: NonNullable<typeof barSpec>) => {
    barSpec = spec;
    await look(HOUR);
  };

  it('enters on a fresh signal with its levels; exits at the stop loss; the journal has the score', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    await firstBar();
    await nextBar({ signals: [{}] });
    let d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long', entry: 101, sl: 90, tp: 115, margin: 100 });
    const enter = d.events.find((e) => e.kind === 'enter');
    expect(enter?.message).toMatch(/^LONG la 101: SL 90, TP 115, scor/);
    expect(enter?.detail?.score?.parts.map((p) => p.key)).toEqual(['day', 'area', 'general', 'symbol', 'slingshot']);
    // The same signal on the next bar is not a new one.
    await nextBar({ signals: [] });
    expect((await detail(bot.id)).positions).toHaveLength(1);
    px['BTC/USDT'] = 89.9;
    await look();
    d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.history[0]).toMatchObject({ reason: 'sl', exit: 89.9 });
  });

  it("FD-BOTSLRR: enters late with Slingshot's levels whatever the R:R from the price now; a bot saved with a minimum R:R runs", async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    // Saved before FD-BOTSLRR: a stop loss and a take profit chosen apart, a minimum R:R of 5 and R as one number.
    const { levels: _l, tpPct: _t, ...rest } = premium;
    const row = await ctx.db.get<{ config: string }>('SELECT config FROM bots WHERE id = ?', [bot.id]);
    const old = { ...JSON.parse(row!.config), premium: { ...rest, sl: 'slingshot', slPct: 2, tp: 'slingshot', minRr: 5, rr: 3 } };
    await ctx.db.run('UPDATE bots SET config = ? WHERE id = ?', [JSON.stringify(old), bot.id]);
    await firstBar();
    // Entry 95, SL 90, TP 115, the price at 113: 2 of reward for 23 of risk from here; the signal's levels all the same.
    px['BTC/USDT'] = 113;
    await nextBar({ signals: [{}] });
    const d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long', entry: 113, sl: 90, tp: 115 });
    const enter = d.events.find((e) => e.kind === 'enter');
    expect(enter?.message).toMatch(/^LONG la 113: SL 90, TP 115, scor/);
    expect(enter?.detail).not.toHaveProperty('rr');
    expect(enter?.detail?.score?.parts.find((p) => p.key === 'slingshot')?.note).not.toMatch(/R:R/);
    expect(d.input).toMatchObject({ premium: { levels: 'slingshot', slPct: 2, tpPct: 6 } });
    const kept = d.input.strategy === 'premium' ? d.input.premium : {};
    expect(['minRr', 'rr', 'sl', 'tp'].filter((k) => k in kept)).toEqual([]);
  });

  it('FD-BOTSLRR: past the stop loss nothing is entered; the AI gets the levels and where they come from, no R:R', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium: { ...premium, ai: 'confirm', aiFallback: 'rules' } });
    await firstBar();
    px['BTC/USDT'] = 89;
    await nextBar({ signals: [{}] });
    let d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.events[0]?.message).toBe('LONG: Prețul a trecut deja de stop loss.');
    expect(aiAsked).toHaveLength(0);
    px['BTC/USDT'] = 114;
    aiAnswer = { decision: 'enter', confidence: 70, reason: 'Nimic împotrivă.', risks: [] };
    await nextBar({ signals: [{ time: 9500 }] });
    d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ entry: 114, sl: 90, tp: 115 });
    expect(aiAsked).toHaveLength(1);
    const asked = aiAsked[0]!;
    expect(asked.prompt).toContain('Stop loss: 90.0000. Take profit: 115.0000 (ale semnalului Slingshot).');
    expect(asked.prompt).not.toMatch(/R:R/);
    expect(asked.system).toContain('Nu judeca stop loss-ul, take profit-ul sau raportul risc / câștig');
    expect(asked.system).not.toContain('nivelurile nu au sens');
  });

  it('FD-BOTPCT: "Risc / câștig" enters at the percents from the entry; the check says them and the ratio; out of limits refused', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium: { ...premium, levels: 'percent', slPct: 1, tpPct: 2, ai: 'confirm', aiFallback: 'rules' } });
    await firstBar();
    px['BTC/USDT'] = 100;
    aiAnswer = { decision: 'enter', confidence: 70, reason: 'Nimic împotrivă.', risks: [] };
    // The signal's levels (SL 90, TP 115) are not used.
    await nextBar({ signals: [{}] });
    const d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long', entry: 100 });
    expect(d.positions[0]?.sl).toBeCloseTo(99, 9);
    expect(d.positions[0]?.tp).toBeCloseTo(102, 9);
    expect(aiAsked[0]?.prompt).toContain('(procentele utilizatorului de la intrare)');
    const check = (await post('/api/bots/check', { strategy: 'premium', ...common, premium: { ...premium, levels: 'percent', slPct: 1.5, tpPct: 3 } })).json() as BotCheck;
    expect(check.summary.join(' ')).toContain('SL 1,5% și TP 3% de la intrare (risc : câștig 1:2).');
    const slingshot = (await post('/api/bots/check', { strategy: 'premium', ...common, premium })).json() as BotCheck;
    expect(slingshot.summary.join(' ')).toContain('SL și TP: ale semnalului Slingshot.');
    const far = await post('/api/bots', { strategy: 'premium', ...common, premium: { ...premium, levels: 'percent', slPct: 1, tpPct: 20 } });
    expect(far.statusCode).toBe(400);
    expect(far.json().error.message).toContain('Raportul risc : câștig 1:20 iese din limite');
    // A tab with an older form (a stop and a take profit chosen apart, a ratio): saved the new way, the same levels.
    const { levels: _l, tpPct: _t, ...rest } = premium;
    const base = { name: 'Test', endsAt: null, endAction: 'finish', dailyLoss: null, lossStop: null, fee: 0.1 };
    const old = await put(`/api/bots/${bot.id}`, { ...base, premium: { ...rest, sl: 'percent', slPct: 2, tp: 'rr', rrRisk: 2, rrReward: 3 } });
    expect(old.statusCode, old.body).toBe(200);
    expect((old.json() as BotDetail).input).toMatchObject({ premium: { levels: 'percent', slPct: 2, tpPct: 3 } });
  });

  it('FD-BOTDIR: the market score is low for a negative market: a short enters under its maximum, a long stays out under its minimum; the other way round when positive', async () => {
    const bot = await make({ strategy: 'premium', ...common, market: 'futures', leverage: 3, premium: { ...premium, direction: 'both', longMin: 55, shortMax: 45, areaVeto: false } });
    await firstBar();
    // 50 + 50 × (20 × −0.6 + 30 × −0.4 + 15 × −0.6) / 85 (no news about the symbol, no break of structure) = 30.6.
    mood = { index: 20, area: 30, areaCount: 20 };
    await nextBar({ signals: [{ side: 'short', time: 9000, sl: 110, tp: 90 }] });
    let d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'short', sl: 110, tp: 90 });
    const enter = d.events.find((e) => e.kind === 'enter');
    expect(enter?.message).toBe('SHORT la 101 3×: SL 110, TP 90, scor 30,6.');
    expect(enter?.detail?.score).toMatchObject({ score: 30.6, limit: { side: 'short', value: 45 } });
    expect(enter?.detail?.score?.min).toBeUndefined();
    expect(enter?.detail?.score?.parts.find((p) => p.key === 'area')).toMatchObject({ value: 30, a: -0.4 });
    // A long on the same market: the short closes on the opposite signal, the long stays out.
    await nextBar({ signals: [{ time: 9100 }] });
    d = await detail(bot.id);
    expect(d.history[0]?.reason).toBe('opposite');
    expect(d.positions).toEqual([]);
    expect(d.events[0]?.message).toBe('LONG: scorul pieței 30,6 e sub minimul pentru long (55).');
    expect(d.events[0]?.detail?.score?.limit).toEqual({ side: 'long', value: 55 });
    // A positive market: 50 + 50 × (12 + 3 + 9) / 85 = 64.1.
    mood = { index: 80, area: 55, areaCount: 20 };
    await nextBar({ signals: [{ side: 'short', time: 9200, sl: 110, tp: 90 }] });
    d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.events[0]?.message).toBe('SHORT: scorul pieței 64,1 e peste maximul pentru short (45).');
    await nextBar({ signals: [{ time: 9300 }] });
    d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long' });
    expect(d.events.find((e) => e.kind === 'enter')?.message).toMatch(/^LONG la 101 3×: .*, scor 64,1\.$/);
  });

  it('FD-BOTDIR: two signals on one bar, both within their thresholds: the side the market favours first, only it asks the AI; the check says the thresholds', async () => {
    const bot = await make({ strategy: 'premium', ...common, market: 'futures', leverage: 3, premium: { ...premium, direction: 'both', longMin: 0, shortMax: 100, areaVeto: false, ai: 'confirm' } });
    await firstBar();
    mood = { index: 20, area: 30, areaCount: 20 };
    aiAnswer = { decision: 'enter', confidence: 70, reason: 'Piața e negativă.', risks: [] };
    await nextBar({ signals: [{ time: 9000 }, { side: 'short', time: 9100, sl: 110, tp: 90 }] });
    const d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'short' });
    expect(d.events.map((e) => e.message)).toContain('LONG: botul a intrat deja pe semnalul celălalt.');
    expect(aiAsked).toHaveLength(1);
    expect(aiAsked[0]?.prompt).toContain('Scorul pieței (0–100, 50 neutru; peste 50 favorizează long-ul, sub 50 short-ul): 30.6. Un SHORT intră până la 100.');
    expect(aiAsked[0]?.prompt).toContain('- Aria: 30 (negativ, 20 știri), pondere 30.');
    const futures = { strategy: 'premium', ...common, market: 'futures', leverage: 3 };
    const say = async (p: Record<string, unknown>) => (await post('/api/bots/check', { ...futures, premium: { ...premium, ...p } })).json() as BotCheck;
    expect((await say({ direction: 'both', longMin: 39, shortMax: 61 })).summary.join(' ')).toContain('Intră pe semnalele Slingshot long și short de pe 1h: long când scorul pieței e cel puțin 39, short când e cel mult 61.');
    expect((await say({ direction: 'short', ai: 'confirm' })).summary.join(' ')).toContain('Intră pe semnalele Slingshot short de pe 1h, când scorul pieței e cel mult 50. AI-ul confirmă fiecare intrare.');
    const never = await say({ direction: 'both', longMin: 95, shortMax: 5 });
    expect(never.warnings).toContain('Cu ponderile alese, scorul pieței ajunge cel mult la 94: cu minimul 95, botul nu intră niciodată long.');
    expect(never.warnings).toContain('Cu ponderile alese, scorul pieței coboară cel mult până la 6: cu maximul 5, botul nu intră niciodată short.');
    expect((await say({ direction: 'long', longMin: 94, shortMax: 5 })).warnings.filter((w) => w.includes('niciodată'))).toEqual([]);
  });

  it('the area against, a short on a long-only bot: no entry, with the reason; a signal before the start is not taken', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    clock = Math.ceil(clock / HOUR) * HOUR + 10 * MIN;
    // The bar closed before the bot's first look: noted, not taken.
    barSpec = { signals: [{}] };
    await look(1);
    expect((await detail(bot.id)).positions).toEqual([]);
    mood.area = 30;
    await nextBar({ signals: [{ time: 8500 }, { side: 'short', time: 9000, sl: 110, tp: 90 }] });
    const d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    const msgs = d.events.map((e) => e.message);
    expect(msgs).toContain('LONG: aria Crypto e negativă (30).');
    expect(msgs).toContain('SHORT: botul face doar long.');
  });

  it('the AI can refuse; when it does not answer, the fallback decides; the take profit signal closes', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium: { ...premium, ai: 'confirm', aiFallback: 'rules' } });
    await firstBar();
    aiAnswer = { decision: 'skip', confidence: 80, reason: 'Știrile simbolului sunt negative.', risks: [] };
    await nextBar({ signals: [{}] });
    let d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.events[0]?.message).toBe('LONG: AI-ul a spus nu (80%): Știrile simbolului sunt negative.');
    expect(d.events[0]?.detail?.ai?.decision).toBe('skip');
    aiAnswer = null;
    await nextBar({ signals: [{ time: 9500 }] });
    d = await detail(bot.id);
    expect(d.positions).toHaveLength(1);
    expect(d.events.some((e) => /AI-ul nu a răspuns .* intrarea merge după reguli/.test(e.message))).toBe(true);
    await nextBar({ signals: [], alerts: [{ bar: 10, time: 10_000, type: 'takeProfitSignal', provisional: false }] });
    d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.history[0]?.reason).toBe('tp_signal');
    expect((await ctx.ai.usage.today(1)).bot.calls).toBe(1);
  });

  it('the trend turning closes; a signal the other way closes and, allowed, opens the other side', async () => {
    const bot = await make({ strategy: 'premium', ...common, market: 'futures', leverage: 3, premium: { ...premium, direction: 'both' } });
    await firstBar();
    await nextBar({ signals: [{}] });
    expect((await detail(bot.id)).positions[0]).toMatchObject({ side: 'long', leverage: 3, margin: 100 });
    await nextBar({ signals: [{ outcome: 'invalidated', outcomeReason: 'trendFlip', closedBar: 10, confirmBar: 9 }] });
    let d = await detail(bot.id);
    expect(d.history[0]?.reason).toBe('flip');
    await nextBar({ signals: [{ time: 9100 }] });
    await nextBar({ signals: [{ time: 9100, confirmBar: 8 }, { side: 'short', time: 9200, sl: 110, tp: 90 }] });
    d = await detail(bot.id);
    expect(d.history[0]?.reason).toBe('opposite');
    expect(d.positions[0]).toMatchObject({ side: 'short', sl: 110, tp: 90 });
  });

  it('edits the filter for the trades to come; refuses what a started bot cannot change', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    const base = { name: 'Nou', endsAt: null, endAction: 'finish', dailyLoss: null, lossStop: null, fee: 0.2 };
    const r = await put(`/api/bots/${bot.id}`, { ...base, premium: { ...premium, longMin: 70 } });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as BotDetail).input).toMatchObject({ name: 'Nou', fee: 0.2, premium: { longMin: 70, shortMax: 50 } });
    expect((await put(`/api/bots/${bot.id}`, { ...base, endsAt: Date.now() - 1000 })).json().error.message).toBe('Sfârșitul e în trecut.');
    const g = await make({ strategy: 'grid', ...common, grid });
    expect((await put(`/api/bots/${g.id}`, { ...base, endAction: 'close', maxAmount: 2000 })).json().error.message).toMatch(/Suma unei grile/);
    const list = (await get('/api/bots')).json() as BotView[];
    expect(list.map((b) => b.name)).toEqual(['Test', 'Nou']);
  });
});

describe("the signals' timeframe changed on a started bot (FD-BOTTF)", () => {
  const H4 = 4 * HOUR;
  /** The first look on 1h, 2 h into a 4h bar: the 1h bar it notes opened 1 h after the 4h one. */
  const firstBar = async () => {
    clock = Math.ceil(clock / H4) * H4 + 2 * HOUR + 10 * MIN;
    barSpec = { signals: [] };
    await look(1);
  };
  const base = { name: 'Test', endsAt: null, endAction: 'finish', dailyLoss: null, lossStop: null, fee: 0.1 };
  const retf = (id: number, tf: string, more: Record<string, unknown> = { premium }) => put(`/api/bots/${id}`, { ...base, ...more, tf });
  const stateOf = async (id: number) => JSON.parse((await ctx.db.get<{ state: string }>('SELECT state FROM bots WHERE id = ?', [id]))!.state) as BotState;
  const NOTE = 'Timeframe-ul semnalelor e acum 4h (era 1h): botul ia semnalele de pe lumânările de 4h care se închid de acum.';
  const KEEPS = ' Pozițiile deschise își păstrează SL / TP-ul; semnalul de 1h pe care au intrat nu se mai urmărește.';

  it('takes only the 4h bars that close after the change, the first one too (it opened before the last 1h bar read)', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    await firstBar();
    const r = await retf(bot.id, '4h');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json() as BotDetail).toMatchObject({ tf: '4h', input: { tf: '4h' } });
    expect(((await get('/api/bots')).json() as BotView[])[0]?.tf).toBe('4h');
    // The 4h bar closed already, with a signal: only noted, as at the start.
    barSpec = { signals: [{}] };
    await look();
    let d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.events.some((e) => e.message.startsWith('LONG'))).toBe(false);
    expect(d.events[0]?.message).toBe(NOTE);
    expect((await stateOf(bot.id)).premium?.tf).toBe('4h');
    // The 4h bar that closes next opened before the last 1h bar read: it is taken all the same.
    barSpec = { signals: [{ time: 9000 }] };
    await look(2 * HOUR);
    d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long', sl: 90, tp: 115 });
  });

  it('an open position keeps its levels; a signal of the same time on 4h is not its own; the 4h take profit signal closes it', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    await firstBar();
    barSpec = { signals: [{}] };
    await look(HOUR);
    expect((await detail(bot.id)).positions).toHaveLength(1);
    expect((await stateOf(bot.id)).premium?.positions[0]?.signalTime).toBe(8000);
    expect((await retf(bot.id, '4h')).statusCode).toBe(200);
    // On 4h, a signal with the position's time is invalidated by the trend: not the position's signal.
    const flip = () => ({ signals: [{ outcome: 'invalidated' as const, outcomeReason: 'trendFlip' as const, closedBar: 10, confirmBar: 9 }] });
    barSpec = flip();
    await look();
    barSpec = flip();
    await look(2 * H4);
    let d = await detail(bot.id);
    expect(d.positions[0]).toMatchObject({ side: 'long', sl: 90, tp: 115 });
    expect(d.history).toEqual([]);
    expect(d.events.some((e) => e.message === NOTE + KEEPS)).toBe(true);
    expect((await stateOf(bot.id)).premium?.positions[0]?.signalTime).toBeUndefined();
    barSpec = { signals: [], alerts: [{ bar: 10, time: 10_000, type: 'takeProfitSignal', provisional: false }] };
    await look(H4);
    d = await detail(bot.id);
    expect(d.positions).toEqual([]);
    expect(d.history[0]?.reason).toBe('tp_signal');
  });

  it('there and back before the bot looks: nothing changes for it; a state from before keeps its bars', async () => {
    const bot = await make({ strategy: 'premium', ...common, premium });
    await firstBar();
    const before = await stateOf(bot.id);
    expect(before.premium?.tf).toBe('1h');
    expect((await retf(bot.id, '4h')).statusCode).toBe(200);
    expect((await retf(bot.id, '1h')).statusCode).toBe(200);
    barSpec = { signals: [] };
    await look();
    let st = await stateOf(bot.id);
    expect(st.premium?.lastBar).toEqual(before.premium?.lastBar);
    expect(st.premium?.nextRead).toEqual(before.premium?.nextRead);
    expect((await detail(bot.id)).events.some((e) => e.message.startsWith('Timeframe-ul semnalelor'))).toBe(false);
    // A state written before FD-BOTTF has no timeframe: the bot's own is taken, the bars stay.
    const { tf: _tf, ...old } = st.premium!;
    await ctx.db.run('UPDATE bots SET state = ? WHERE id = ?', [JSON.stringify({ ...st, premium: old }), bot.id]);
    await look();
    st = await stateOf(bot.id);
    expect(st.premium?.tf).toBe('1h');
    expect(st.premium?.lastBar).toEqual(before.premium?.lastBar);
    expect((await detail(bot.id)).events.some((e) => e.message.startsWith('Timeframe-ul semnalelor'))).toBe(false);
  });

  it('a real entry still being retried when the timeframe changes opens without the old signal', async () => {
    const account = (await ctx.accounts.create(1, { exchange: 'kucoin', label: 'KuCoin', credentials: { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' } })).id;
    await ctx.accounts.setTrading(account, ['spot', 'futures']);
    const bot = await make({ strategy: 'premium', ...common, exec: 'real', accountId: account, premium });
    await firstBar();
    placeError = new Error('socket hang up');
    barSpec = { signals: [{}] };
    await look(HOUR);
    expect(placed).toHaveLength(0);
    expect((await stateOf(bot.id)).pending).toMatchObject({ purpose: { kind: 'p_open', signalTime: 8000 } });
    expect((await retf(bot.id, '4h')).statusCode).toBe(200);
    barSpec = { signals: [] };
    await look();
    expect(placed).toHaveLength(1);
    const st = await stateOf(bot.id);
    expect(st.pending).toBeNull();
    expect(st.premium?.positions).toHaveLength(1);
    expect(st.premium?.positions[0]?.signalTime).toBeUndefined();
    expect((await detail(bot.id)).events.some((e) => e.message === NOTE + KEEPS)).toBe(true);
  });

  it('refuses it on a grid and a DCA, and on shares without a Twelve Data key below 1d', async () => {
    const g = await make({ strategy: 'grid', ...common, grid });
    expect((await retf(g.id, '4h', { endAction: 'close' })).json().error.message).toBe('Timeframe-ul contează doar la un bot Slingshot.');
    // The same timeframe is no change.
    expect((await retf(g.id, '1h', { endAction: 'close' })).statusCode).toBe(200);
    const d = await make({ strategy: 'dca', ...common, symbols: ['ETH/USDT'], dca });
    expect((await retf(d.id, '4h', {})).json().error.message).toBe('Timeframe-ul contează doar la un bot Slingshot.');
    px.AAPL = 200;
    const s = await make({ strategy: 'premium', ...common, market: 'stock', symbols: ['AAPL'], tf: '1d', premium });
    expect((await retf(s.id, '1h')).json().error.message).toBe('AAPL pe 1h cere cheia ta Twelve Data (Setări → Date acțiuni); fără ea, botul merge pe 1d și 1w.');
    expect((await detail(s.id)).tf).toBe('1d');
    const r = await retf(s.id, '1w');
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as BotDetail).input.tf).toBe('1w');
  });
});
