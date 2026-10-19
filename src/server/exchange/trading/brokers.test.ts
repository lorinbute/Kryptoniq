// FD-TRADING, TD-TRADING §8: the brokers' orders over a simulated HTTP: what leaves (path, body, headers), what comes
// back, and how their refusals are explained.
import { afterEach, describe, expect, it } from 'vitest';
import { setFetchImpl } from '../../net/http.ts';
import type { OrderTicket } from '../../../shared/trading.ts';
import { AlpacaTrader } from './alpaca.ts';
import { closePlan, EtoroTrader, nthRequestId } from './etoro.ts';
import { resetTrading212Cache, Trading212Trader } from './trading212.ts';

const KEY = '0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const ticket = (t: Partial<OrderTicket>): OrderTicket => ({ accountId: 1, idemKey: KEY, market: 'stock', symbol: 'AAPL', side: 'buy', kind: 'market', amount: 2, amountIn: 'base', ...t });

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Answers by `METHOD path-fragment`; records every request. */
function serve(routes: [string, (s: Sent) => { status?: number; body?: unknown }][]): Sent[] {
  const sent: Sent[] = [];
  setFetchImpl((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const s: Sent = { url, method, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    sent.push(s);
    const hit = routes.find(([k]) => {
      const [m, frag] = k.split(' ');
      return m === method && url.includes(frag as string);
    });
    if (!hit) return new Response('{"message":"no route"}', { status: 404 });
    const r = hit[1](s);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch);
  return sent;
}

afterEach(() => {
  setFetchImpl(null);
  resetTrading212Cache();
});

describe('Trading 212 (FD-TRADING)', () => {
  const instruments = [
    { ticker: 'AAPL_US_EQ', shortName: 'AAPL', name: 'Apple', currencyCode: 'USD', isin: 'US0378331005', type: 'STOCK' },
    { ticker: 'VODl_EQ', shortName: 'VOD', name: 'Vodafone', currencyCode: 'GBX', isin: 'GB00BH4HKS39', type: 'STOCK' },
  ];
  const base = (extra: [string, (s: Sent) => { status?: number; body?: unknown }][] = []) =>
    serve([
      ['GET /equity/metadata/instruments', () => ({ body: instruments })],
      ['GET /equity/account/summary', () => ({ body: { currency: 'EUR', cash: { availableToTrade: 1000 } } })],
      ['GET /equity/positions', () => ({ body: [{ instrument: { ticker: 'AAPL_US_EQ' }, quantity: 5, quantityAvailableForTrading: 4, currentPrice: 200 }] })],
      ...extra,
    ]);

  it('finds the instrument, sells a held share with a limit (negative quantity), cancels by id', async () => {
    const sent = base([
      ['POST /equity/orders/limit', () => ({ body: { id: 123, status: 'NEW' } })],
      ['DELETE /equity/orders/123', () => ({ body: {} })],
    ]);
    const t = new Trading212Trader({ apiKey: 'key-1234', secret: 'sec-1234' }, 'demo');
    const ins = await t.instrument('stock', 'aapl');
    expect(ins).toMatchObject({ symbol: 'AAPL', ref: 'AAPL_US_EQ', currency: 'USD', availableQuote: 1000, availableBase: 4, last: 200 });
    const p = await t.normalize(ticket({ side: 'sell', kind: 'limit', amount: 3, price: 210, tif: 'gtc' }));
    expect(p).toMatchObject({ errors: [], amount: 3, value: 630, currency: 'USD' });
    expect(p.warnings.join(' ')).toMatch(/Instrumentul e în USD, contul în EUR/);
    expect(await t.place(p)).toMatchObject({ status: 'open', orderId: '123' });
    const order = sent.find((s) => s.method === 'POST')!;
    expect(order.url).toBe('https://demo.trading212.com/api/v0/equity/orders/limit');
    expect(order.body).toEqual({ ticker: 'AAPL_US_EQ', quantity: -3, limitPrice: 210, timeValidity: 'GOOD_TILL_CANCEL' });
    expect(order.headers.authorization).toBe(`Basic ${Buffer.from('key-1234:sec-1234').toString('base64')}`);
    expect(await t.cancel({ orderId: '123', symbol: 'AAPL', market: 'stock', trigger: false })).toMatchObject({ status: 'cancelled' });
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://demo.trading212.com/api/v0/equity/orders/123' });
    // The instrument list (1 request a minute) is read once; the summary and the positions once for checking and sending
    // (Trading 212 answers them once every few seconds).
    expect(sent.filter((s) => s.url.includes('instruments'))).toHaveLength(1);
    expect(sent.filter((s) => s.url.includes('account/summary'))).toHaveLength(1);
  });

  it('refuses selling more than is held, by value, TP / SL, and explains a key without "Orders: Execute"', async () => {
    base([['POST /equity/orders/market', () => ({ status: 403, body: { message: 'Scope(orders:execute) missing for API key' } })]]);
    const t = new Trading212Trader({ apiKey: 'k', secret: 's' }, 'live');
    expect((await t.normalize(ticket({ side: 'sell', amount: 5 }))).errors.join(' ')).toMatch(/Ai disponibil 4 AAPL; vinzi 5/);
    expect((await t.normalize(ticket({ symbol: 'VOD', side: 'sell', amount: 1 }))).errors.join(' ')).toMatch(/Nu deții VOD/);
    expect((await t.normalize(ticket({ amountIn: 'quote', amount: 100 }))).errors.join(' ')).toMatch(/doar pe cantitate/);
    expect((await t.normalize(ticket({ stopLoss: 150 }))).errors.join(' ')).toMatch(/TP \/ SL/);
    await expect(t.normalize(ticket({ symbol: 'ZZZZ' }))).rejects.toMatchObject({ code: 'INVALID' });
    const p = await t.normalize(ticket({ amount: 1, extendedHours: true }));
    await expect(t.place(p)).rejects.toMatchObject({ code: 'PERMISSION', message: expect.stringMatching(/Orders: Execute/) });
  });
});

describe('eToro (FD-TRADING)', () => {
  const portfolio = { clientPortfolio: { credit: 5000, positions: [
    { positionID: 111, instrumentID: 1001, units: 2, isBuy: true, leverage: 1, openRate: 180 },
    { positionID: 112, instrumentID: 1001, units: 3, isBuy: true, leverage: 1, openRate: 190 },
  ] } };
  const search = { items: [{ instrumentId: 1001, internalSymbolFull: 'AAPL', displayname: 'Apple' }] };

  it('opens by amount with the request id of the form, then reads the outcome (filled)', async () => {
    const sent = serve([
      ['GET /market-data/search', () => ({ body: search })],
      ['GET /trading/info/real/pnl', () => ({ body: portfolio })],
      ['GET /instruments/rates', () => ({ body: { rates: [{ instrumentId: 1001, ask: 200 }] } })],
      ['POST /api/v2/trading/execution/orders', () => ({ body: { orderId: 777, referenceId: KEY } })],
      ['GET /api/v2/trading/info/orders:lookup', () => ({ body: { orderId: 777, status: { id: 3 } } })],
    ]);
    const t = new EtoroTrader({ publicKey: 'pub-123', userKey: 'usr-123' }, 'real', async () => undefined);
    const p = await t.normalize(ticket({ amount: 500, amountIn: 'quote', takeProfit: 250 }));
    expect(p).toMatchObject({ errors: [], value: 500, amount: 2.5, available: 5000 });
    expect(await t.place(p)).toMatchObject({ status: 'filled', orderId: '777' });
    const order = sent.find((s) => s.method === 'POST')!;
    expect(order.headers['x-request-id']).toBe(KEY);
    expect(order.headers['x-api-key']).toBe('pub-123');
    expect(order.body).toEqual({ action: 'open', transaction: 'buy', instrumentId: 1001, orderType: 'mkt', leverage: 1, amount: 500, orderCurrency: 'usd', takeProfitRate: 250 });
  });

  it('lists each position of the instrument with its P/L, to pick the ones to close (FD-ETOROPICK)', async () => {
    const pf = { clientPortfolio: { credit: 5000, positions: [
      { positionID: 111, instrumentID: 1001, units: 2, isBuy: true, leverage: 1, openRate: 180, amount: 360, openDateTime: '2026-03-02T10:00:00Z', unrealizedPnL: { pnL: 40, closeRate: 200 } },
      { positionID: 112, instrumentID: 1001, units: 3, isBuy: true, leverage: 1, openRate: 210, amount: 630, openDateTime: '2026-01-15T10:00:00Z', unrealizedPnL: { pnL: -30, closeRate: 200 } },
      { positionID: 113, instrumentID: 1001, units: 1, isBuy: true, leverage: 1, openRate: 150, netProfit: 50 },
      { positionID: 200, instrumentID: 2002, units: 9, isBuy: true, leverage: 1, openRate: 5 },
    ] } }; // prettier-ignore
    serve([
      ['GET /market-data/search', () => ({ body: search })],
      ['GET /trading/info/real/pnl', () => ({ body: pf })],
      ['GET /instruments/rates', () => ({ body: { rates: [{ instrumentId: 1001, ask: 200 }] } })],
    ]);
    const t = new EtoroTrader({ publicKey: 'p', userKey: 'u' }, 'real', async () => undefined);
    const info = await t.instrument('stock', 'AAPL');
    expect(info.positions).toEqual([
      { id: '111', units: 2, isBuy: true, leverage: 1, openRate: 180, openedAt: Date.parse('2026-03-02T10:00:00Z'), pnl: 40, invested: 360 },
      { id: '112', units: 3, isBuy: true, leverage: 1, openRate: 210, openedAt: Date.parse('2026-01-15T10:00:00Z'), pnl: -30, invested: 630 },
      // No unrealizedPnL: its netProfit; no date, no amount.
      { id: '113', units: 1, isBuy: true, leverage: 1, openRate: 150, openedAt: null, pnl: 50, invested: null },
    ]);
    expect(info.availableBase).toBe(6);
  });

  it('asks for a stop loss with leverage or a short; reports a refusal read back; closes each position of a holding (demo)', async () => {
    const sent = serve([
      ['GET /market-data/search', () => ({ body: search })],
      ['GET /trading/info/demo/pnl', () => ({ body: portfolio })],
      ['GET /instruments/rates', () => ({ body: { rates: [{ ask: 200 }] } })],
      ['POST /api/v2/trading/execution/demo/orders', () => ({ body: { orderId: 778 } })],
      ['GET /api/v2/trading/info/demo/orders:lookup', () => ({ body: { orderId: 778, status: { id: 4, errorMessage: 'Market closed' } } })],
      ['POST /market-close-orders/positions/999', () => ({ status: 400, body: { message: 'Position not found' } })],
      ['POST /market-close-orders/positions/998', () => ({ status: 504, body: {} })],
      ['POST /market-close-orders/positions/', (s) => ({ body: { orderForClose: { orderID: Number(s.url.split('/').at(-1)) + 1000 } } })],
    ]);
    const t = new EtoroTrader({ publicKey: 'p', userKey: 'u' }, 'demo', async () => undefined);
    expect((await t.normalize(ticket({ leverage: 2 }))).errors.join(' ')).toMatch(/stop loss la un levier/);
    expect((await t.normalize(ticket({ side: 'sell' }))).errors.join(' ')).toMatch(/stop loss la o poziție short/);
    const short = await t.normalize(ticket({ side: 'sell', stopLoss: 220, amount: 1 }));
    expect(short.errors).toEqual([]);
    expect(await t.place(short)).toMatchObject({ status: 'rejected', message: 'Refuzat de eToro: Market closed' });
    expect(sent.find((s) => s.method === 'POST')!.body).toMatchObject({ transaction: 'sellShort', units: 1, stopLossRate: 220 });
    // Closing the holding: its two positions, one request id each.
    const close = await t.normalize(ticket({ side: 'sell', close: { positionIds: ['111', '112'] } }));
    expect(close).toMatchObject({ errors: [], amount: 5 });
    expect(await t.place(close)).toMatchObject({ status: 'sent', orderId: '1111, 1112' });
    const closes = sent.filter((s) => s.url.includes('market-close-orders'));
    expect(closes.map((s) => s.url.replace(/.*execution\//, ''))).toEqual(['demo/market-close-orders/positions/111', 'demo/market-close-orders/positions/112']);
    expect(closes.map((s) => s.headers['x-request-id'])).toEqual([KEY, nthRequestId(KEY, 1)]);
    expect(closes[0]!.body).toEqual({ InstrumentId: 1001, UnitsToDeduct: null });
    // A partial close, within the units: of one position, or of several (whole ones first, then part of the next).
    expect((await t.normalize(ticket({ close: { positionIds: ['111'], units: 3 } }))).errors.join(' ')).toMatch(/Poziția are 2 unități/);
    expect((await t.normalize(ticket({ close: { positionIds: ['111', '112'], units: 6 } }))).errors.join(' ')).toMatch(/Pozițiile au 5 unități/);
    const some = await t.normalize(ticket({ side: 'sell', close: { positionIds: ['111', '112'], units: 3 } }));
    expect(some).toMatchObject({ errors: [], amount: 3 });
    expect(some.warnings).toContain('Se închid complet 1 poziție și parțial poziția 112 (1 unitate).');
    const before = sent.length;
    expect(await t.place(some)).toMatchObject({ status: 'sent', orderId: '1111, 1112' });
    const split = sent.slice(before).filter((s) => s.url.includes('market-close-orders'));
    expect(split.map((s) => [s.url.split('/').at(-1), s.body])).toEqual([
      ['111', { InstrumentId: 1001, UnitsToDeduct: null }],
      ['112', { InstrumentId: 1001, UnitsToDeduct: 1 }],
    ]);
    expect((await t.normalize(ticket({ close: { positionIds: ['999'] } }))).errors.join(' ')).toMatch(/999 nu mai e deschisă/);
    await expect(t.cancel({ orderId: 'sl-111', symbol: 'AAPL', market: 'stock', trigger: true })).rejects.toThrow(/se schimbă din eToro/);
    // One position of a holding that fails does not hide the one closed (sent straight, past the check).
    const partial = await t.place({ ...close, ticket: { ...close.ticket, close: { positionIds: ['111', '999'] } } });
    expect(partial).toMatchObject({ status: 'sent', orderId: '1111' });
    expect(partial.message).toMatch(/NU s-au închis: 999 \(eToro a refuzat: Position not found\)/);
    await expect(t.place({ ...close, ticket: { ...close.ticket, close: { positionIds: ['999'] } } })).rejects.toMatchObject({ code: 'REJECTED' });
    // A close whose answer was lost is "not sure", not "not closed"; none received and one unsure → unknown.
    const unsure = await t.place({ ...close, ticket: { ...close.ticket, close: { positionIds: ['111', '998'] } } });
    expect(unsure.message).toMatch(/primită pentru 1 poziție; nu știm sigur dacă s-au închis \(verifică pe eToro\): 998/);
    await expect(t.place({ ...close, ticket: { ...close.ticket, close: { positionIds: ['999', '998'] } } })).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });
});

describe('Alpaca (FD-TRADING)', () => {
  const routes = (extra: [string, (s: Sent) => { status?: number; body?: unknown }][] = []): Sent[] =>
    serve([
      ['GET /v2/assets/AAPL', () => ({ body: { symbol: 'AAPL', name: 'Apple Inc.', class: 'us_equity', tradable: true, fractionable: true } })],
      ['GET /v2/assets/BTC%2FUSD', () => ({ body: { symbol: 'BTC/USD', name: 'Bitcoin', class: 'crypto', tradable: true, fractionable: true } })],
      ['GET /v2/account', () => ({ body: { buying_power: '10000', cash: '10000' } })],
      ['GET /v2/positions/', () => ({ status: 404, body: { message: 'position does not exist' } })],
      ['GET /v2/stocks/AAPL/trades/latest', () => ({ body: { trade: { p: 200 } } })],
      ['GET /v1beta3/crypto/us/latest/trades', () => ({ body: { trades: { 'BTC/USD': { p: 60000 } } } })],
      ...extra,
    ]);

  it('buys by dollar amount (market, day) with the form key as the client id; TP / SL as a bracket', async () => {
    const sent = routes([['POST /v2/orders', () => ({ body: { id: 'al-1', status: 'accepted' } })]]);
    const t = new AlpacaTrader({ keyId: 'kid', secret: 'sec' }, 'paper');
    const p = await t.normalize(ticket({ amount: 100, amountIn: 'quote' }));
    expect(p).toMatchObject({ errors: [], value: 100, amount: 0.5 });
    expect(await t.place(p)).toMatchObject({ status: 'pending', orderId: 'al-1' });
    expect(sent.find((s) => s.method === 'POST')).toMatchObject({ url: 'https://paper-api.alpaca.markets/v2/orders', body: { symbol: 'AAPL', side: 'buy', type: 'market', time_in_force: 'day', notional: '100', client_order_id: KEY } });
    const b = await t.normalize(ticket({ idemKey: KEY.replace('0f', '1f'), kind: 'limit', price: 199, tif: 'gtc', amount: 3, takeProfit: 220, stopLoss: 190 }));
    expect(b.errors).toEqual([]);
    await t.place(b);
    expect(sent.filter((s) => s.method === 'POST')[1]!.body).toMatchObject({ type: 'limit', limit_price: '199', time_in_force: 'gtc', qty: '3', order_class: 'bracket', take_profit: { limit_price: '220' }, stop_loss: { stop_price: '190' } });
  });

  it("keeps Alpaca's rules: fractional only for a day, no stop on crypto, extended hours only for limits (and without a bracket)", async () => {
    routes();
    const t = new AlpacaTrader({ keyId: 'kid', secret: 'sec' }, 'live');
    expect((await t.normalize(ticket({ kind: 'limit', price: 199, amount: 1.5, tif: 'gtc' }))).errors.join(' ')).toMatch(/Fracționat, Alpaca primește doar ordine valabile o zi/);
    expect((await t.normalize(ticket({ kind: 'limit', price: 199, amount: 1.5, tif: 'day' }))).errors).toEqual([]);
    // By value with a limit: the amount at the limit price.
    expect(await t.normalize(ticket({ kind: 'limit', price: 100, amount: 250, amountIn: 'quote', tif: 'day' }))).toMatchObject({ errors: [], amount: 2.5, value: 250 });
    expect((await t.normalize(ticket({ kind: 'limit', price: 199, amount: 2, extendedHours: true, takeProfit: 220 }))).errors.join(' ')).toMatch(/nu merg în afara orelor/);
    expect((await t.normalize(ticket({ symbol: 'BTC', kind: 'stop', triggerPrice: 61000, amount: 0.01 }))).errors.join(' ')).toMatch(/Pentru crypto/);
    expect((await t.normalize(ticket({ extendedHours: true }))).errors.join(' ')).toMatch(/În afara orelor/);
    expect((await t.normalize(ticket({ amount: 1.5, takeProfit: 220 }))).errors.join(' ')).toMatch(/bracket\) cer o cantitate întreagă/);
    const c = await t.normalize(ticket({ symbol: 'btc', amount: 0.01 }));
    expect(c).toMatchObject({ errors: [], ticket: { symbol: 'BTC/USD', tif: 'gtc' }, last: 60000 });
  });

  it('explains no buying power, and an order that can no longer be cancelled', async () => {
    routes([
      ['POST /v2/orders', () => ({ status: 403, body: { message: 'insufficient buying power' } })],
      ['DELETE /v2/orders/al-9', () => ({ status: 422, body: { message: 'order is not cancelable' } })],
    ]);
    const t = new AlpacaTrader({ keyId: 'kid', secret: 'sec' }, 'live');
    await expect(t.place(await t.normalize(ticket({})))).rejects.toMatchObject({ code: 'INSUFFICIENT' });
    await expect(t.cancel({ orderId: 'al-9', symbol: 'AAPL', market: 'stock', trigger: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('closing units of several eToro positions (FD-ETOROUNITS)', () => {
  const held = [
    { id: 'a', units: 2 },
    { id: 'b', units: 3 },
    { id: 'c', units: 1.5 },
  ];
  it('whole positions in the order given, then part of the next', () => {
    expect(closePlan(held, ['a', 'b', 'c'], undefined)).toEqual([{ id: 'a', units: null }, { id: 'b', units: null }, { id: 'c', units: null }]);
    expect(closePlan(held, ['a', 'b', 'c'], 1)).toEqual([{ id: 'a', units: 1 }]);
    expect(closePlan(held, ['a', 'b', 'c'], 2)).toEqual([{ id: 'a', units: null }]);
    expect(closePlan(held, ['a', 'b', 'c'], 4.2)).toEqual([{ id: 'a', units: null }, { id: 'b', units: 2.2 }]);
    expect(closePlan(held, ['c', 'a'], 3.5)).toEqual([{ id: 'c', units: null }, { id: 'a', units: null }]);
    // A position no longer held is left out; more units than held close everything there is.
    expect(closePlan(held, ['x', 'b'], 1)).toEqual([{ id: 'b', units: 1 }]);
    expect(closePlan(held, ['a', 'b'], 9)).toEqual([{ id: 'a', units: null }, { id: 'b', units: null }]);
    // Floating sums: 0.1 + 0.2 units of two positions closes both whole.
    expect(closePlan([{ id: 'p', units: 0.1 }, { id: 'q', units: 0.2 }], ['p', 'q'], 0.3)).toEqual([{ id: 'p', units: null }, { id: 'q', units: null }]);
  });
});

