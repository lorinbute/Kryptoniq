// FD-TRADING, TD-TRADING §8: the crypto trader. First Sentiq's own logic on simulated clients (rounding, minimums,
// stops, leverage and margin per exchange, hedge mode, TP / SL, errors), then the requests the real ccxt classes build
// from what Sentiq hands them (KuCoin futures and spot, Bybit, Bitget's unified account, Coinbase), captured instead of
// sent.
import { describe, expect, it } from 'vitest';
import ccxt, { type Exchange } from 'ccxt';
import { silentLogger } from '../../log.ts';
import type { OrderTicket } from '../../../shared/trading.ts';
import { CcxtTrader } from './crypto.ts';
import { clientIdOf, TradingError } from './types.ts';

const KEY = '0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f6';

interface FakeMarket {
  symbol: string;
  base: string;
  quote: string;
  spot?: boolean;
  contractSize?: number;
  amountStep: number;
  priceStep: number;
  minAmount?: number;
  minCost?: number;
  maxLeverage?: number;
}

function marketOf(m: FakeMarket) {
  const swap = !m.spot;
  return {
    id: m.symbol.replace(/[/:]/g, ''),
    symbol: m.symbol,
    base: m.base,
    quote: m.quote,
    settle: swap ? 'USDT' : undefined,
    type: swap ? 'swap' : 'spot',
    spot: !swap,
    swap,
    contract: swap,
    linear: swap ? true : undefined,
    active: true,
    contractSize: swap ? (m.contractSize ?? 1) : undefined,
    precision: { amount: m.amountStep, price: m.priceStep },
    limits: { amount: { min: m.minAmount }, cost: { min: m.minCost }, leverage: { max: m.maxLeverage } },
    info: {},
  };
}

const decimals = (step: number) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));

/** A ccxt-like client: markets, a price, balances, and what Sentiq asked it to do. */
function fakeClient(id: string, list: FakeMarket[], o: { last?: number; free?: Record<string, number>; hedged?: boolean; positionMode?: boolean; createError?: Error; posMode?: string; positions?: object[]; uta?: boolean } = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const markets = Object.fromEntries(list.map((m) => [m.symbol, marketOf(m)]));
  const ex = {
    id,
    markets: undefined as unknown,
    has: { fetchPositionMode: o.positionMode ?? false },
    async loadMarkets() {
      ex.markets = markets;
      return markets;
    },
    amountToPrecision(sym: string, v: number) {
      const step = markets[sym]!.precision.amount;
      return (Math.floor(v / step + 1e-9) * step).toFixed(decimals(step));
    },
    priceToPrecision(sym: string, v: number) {
      const step = markets[sym]!.precision.price;
      return (Math.round(v / step) * step).toFixed(decimals(step));
    },
    async fetchTicker() {
      return { last: o.last ?? 100, bid: (o.last ?? 100) - 0.5, ask: (o.last ?? 100) + 0.5 };
    },
    async fetchBalance(params?: unknown) {
      calls.push({ fn: 'fetchBalance', args: [params] });
      return { free: o.free ?? { USDT: 1000, BTC: 0.5 } };
    },
    async fetchPositions() {
      return o.positions ?? [];
    },
    async fetchPositionMode() {
      calls.push({ fn: 'fetchPositionMode', args: [] });
      return { hedged: o.hedged ?? false };
    },
    async privateMixGetV2MixAccountAccount(p: unknown) {
      calls.push({ fn: 'posMode', args: [p] });
      return { data: { posMode: o.posMode ?? 'one_way_mode' } };
    },
    async setLeverage(...args: unknown[]) {
      calls.push({ fn: 'setLeverage', args });
    },
    async setMarginMode(...args: unknown[]) {
      calls.push({ fn: 'setMarginMode', args });
    },
    async createOrder(...args: unknown[]) {
      calls.push({ fn: 'createOrder', args });
      if (o.createError) throw o.createError;
      return { id: `o${calls.filter((c) => c.fn === 'createOrder').length}`, status: 'open' };
    },
    async cancelOrder(...args: unknown[]) {
      calls.push({ fn: 'cancelOrder', args });
    },
    async isUTAEnabled() {
      return o.uta ?? false;
    },
  };
  return { ex: ex as unknown as Exchange, calls };
}

const BTC_SPOT: FakeMarket = { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', spot: true, amountStep: 0.0001, priceStep: 0.1, minAmount: 0.0001, minCost: 1 };
const BTC_PERP: FakeMarket = { symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', contractSize: 0.001, amountStep: 1, priceStep: 0.1, minAmount: 1, maxLeverage: 100 };
const ticket = (t: Partial<OrderTicket>): OrderTicket => ({ accountId: 1, idemKey: KEY, market: 'spot', symbol: 'BTC/USDT', side: 'buy', kind: 'market', amount: 0.01, amountIn: 'base', ...t });
const createArgs = (calls: { fn: string; args: unknown[] }[], i = 0) => calls.filter((c) => c.fn === 'createOrder')[i]?.args as [string, string, string, number, number | undefined, Record<string, unknown>];

describe('checking an order (FD-TRADING §2)', () => {
  it('rounds down to the step, converts a value into the asset and contracts, and says so', async () => {
    const { ex } = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000 });
    const spot = fakeClient('kucoin', [BTC_SPOT], { last: 60_000 });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: ex }, silentLogger);
    // 100 USDT of BTC at the ask (60 000.5) ≈ 0.001666 BTC → 0.0016 (step 0.0001).
    const p = await t.normalize(ticket({ amount: 100, amountIn: 'quote' }));
    expect(p).toMatchObject({ amount: 0.0016, contracts: null, errors: [] });
    expect(p.warnings.join(' ')).toMatch(/rotunjită la 0\.0016 BTC/);
    // Futures: 0.0255 BTC = 25.5 lots of 0.001 → 25 lots, and the minimum is one lot.
    const f = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.0255, leverage: 5 }));
    expect(f).toMatchObject({ contracts: 25, amount: 0.025, displaySymbol: 'BTC/USDT perpetuu', errors: [] });
    expect(f.margin).toBeCloseTo((0.025 * 60_000.5) / 5, 6);
    const tiny = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.0005 }));
    expect(tiny.errors.join(' ')).toMatch(/sub pasul minim.*un contract = 0\.001 BTC/);
  });

  it('refuses a stop on the wrong side, a TP / SL on the wrong side, too much leverage, and a pair that is not there', async () => {
    const { ex } = fakeClient('binance', [BTC_SPOT, { ...BTC_PERP, contractSize: 1, amountStep: 0.001, minAmount: 0.001, maxLeverage: 20 }], { last: 100 });
    const t = new CcxtTrader('binance', { spot: ex, futures: null }, silentLogger);
    expect((await t.normalize(ticket({ kind: 'stop_limit', triggerPrice: 90, price: 91 }))).errors.join(' ')).toMatch(/stop de cumpărare se declanșează peste/);
    expect((await t.normalize(ticket({ side: 'sell', kind: 'stop_limit', triggerPrice: 110, price: 109 }))).errors.join(' ')).toMatch(/stop de vânzare se declanșează sub/);
    // Binance spot has no stop-market order.
    expect((await t.normalize(ticket({ kind: 'stop', triggerPrice: 110 }))).errors.join(' ')).toMatch(/Tipul de ordin/);
    const fut = (x: Partial<OrderTicket>) => t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 1, ...x }));
    expect((await fut({ leverage: 50 })).errors.join(' ')).toMatch(/Levierul maxim pe BTC\/USDT:USDT e 20×/);
    expect((await fut({ stopLoss: 120 })).errors.join(' ')).toMatch(/Stop loss-ul trebuie să fie sub/);
    expect((await fut({ side: 'sell', takeProfit: 120 })).errors.join(' ')).toMatch(/Take profit-ul trebuie să fie sub/);
    // Binance sends TP / SL after a market entry only.
    expect((await fut({ kind: 'limit', price: 99, stopLoss: 90 })).errors.join(' ')).toMatch(/după o intrare la piață/);
    expect((await fut({ leverage: 15 })).warnings.join(' ')).toMatch(/Levier 15×/);
    await expect(t.normalize(ticket({ symbol: 'NOPE/USDT' }))).rejects.toThrow(/nu se tranzacționează/);
    // Kraken has no futures through Sentiq.
    await expect(new CcxtTrader('kraken', { spot: ex, futures: null }, silentLogger).normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT' }))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('warns about what is free: the quote to buy, the asset to sell, the margin for futures', async () => {
    const { ex } = fakeClient('okx', [BTC_SPOT, { ...BTC_PERP, contractSize: 0.01, amountStep: 1, minAmount: 1 }], { last: 100, free: { USDT: 50, BTC: 0.2 } });
    const t = new CcxtTrader('okx', { spot: ex, futures: null }, silentLogger);
    expect((await t.normalize(ticket({ amount: 1 }))).warnings.join(' ')).toMatch(/Disponibil: 50 USDT; ordinul cere 100\.5/);
    expect((await t.normalize(ticket({ side: 'sell', amount: 0.5 }))).warnings.join(' ')).toMatch(/Ai liber 0\.2 BTC; vinzi 0\.5/);
    expect((await t.normalize(ticket({ amount: 0.3 }))).warnings.join(' ')).toMatch(/peste jumătate din disponibil/);
  });
});

describe('sending an order (FD-TRADING §3)', () => {
  it('KuCoin futures: leverage with the order when isolated, set before when cross; TP / SL attached', async () => {
    const fut = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true });
    const spot = fakeClient('kucoin', [BTC_SPOT]);
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.02, leverage: 5, marginMode: 'isolated', stopLoss: 58_000, takeProfit: 65_000 }));
    expect(p.errors).toEqual([]);
    const r = await t.place(p);
    expect(r).toMatchObject({ status: 'open', orderId: 'o1' });
    const [sym, type, side, amount, , params] = createArgs(fut.calls);
    expect([sym, type, side, amount]).toEqual(['BTC/USDT:USDT', 'market', 'buy', 20]);
    expect(params).toMatchObject({ clientOrderId: clientIdOf(KEY), leverage: 5, marginMode: 'isolated', stopLoss: { triggerPrice: 58_000 }, takeProfit: { triggerPrice: 65_000 } });
    expect(fut.calls.some((c) => c.fn === 'setLeverage')).toBe(false);
    // Cross: the leverage is the position's, set before.
    const p2 = await t.normalize(ticket({ idemKey: KEY.replace('0f', '1f'), market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.02, leverage: 3, marginMode: 'cross' }));
    await t.place(p2);
    expect(fut.calls.find((c) => c.fn === 'setLeverage')?.args).toEqual([3, 'BTC/USDT:USDT', { marginMode: 'cross' }]);
    expect(createArgs(fut.calls, 1)[5]).toMatchObject({ marginMode: 'cross' });
    expect(createArgs(fut.calls, 1)[5]).not.toHaveProperty('leverage');
    // A unified (UTA) account: futures with cross margin only.
    const uta = fakeClient('kucoin', [BTC_SPOT, BTC_PERP], { last: 60_000 });
    (uta.ex as unknown as { isUTAEnabled: () => Promise<boolean> }).isUTAEnabled = async () => true;
    const tu = new CcxtTrader('kucoin', { spot: uta.ex, futures: fut.ex }, silentLogger);
    expect((await tu.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'isolated' }))).errors.join(' ')).toMatch(/doar cu marjă cross/);
    expect((await tu.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'cross' }))).errors).toEqual([]);
    // The account mode cannot be read: the exchange's error, in words, not a server error.
    const down = fakeClient('kucoin', [BTC_SPOT, BTC_PERP], { last: 60_000 });
    (down.ex as unknown as { isUTAEnabled: () => Promise<boolean> }).isUTAEnabled = async () => {
      throw new ccxt.NetworkError('kucoin GET /api/ua/v1/account/mode timed out');
    };
    const td = new CcxtTrader('kucoin', { spot: down.ex, futures: fut.ex }, silentLogger);
    await expect(td.instrument('futures', 'BTC/USDT:USDT')).rejects.toMatchObject({ code: 'REJECTED' });
    // Another exchange in hedge mode (FD-HEDGEALL): the order names its position too, and so do Binance's TP / SL after
    // the entry (ccxt: positionSide, without reduce-only).
    const hedged = fakeClient('binance', [BTC_SPOT, BTC_PERP], { last: 100, positionMode: true, hedged: true });
    const t2 = new CcxtTrader('binance', { spot: hedged.ex, futures: null }, silentLogger);
    const hp = await t2.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, stopLoss: 95 }));
    expect(hp).toMatchObject({ positionMode: 'hedge', errors: [] });
    await t2.place(hp);
    expect(createArgs(hedged.calls)[5]).toMatchObject({ hedged: true });
    expect(createArgs(hedged.calls, 1)[5]).toEqual({ stopLossPrice: 95, reduceOnly: true, hedged: true });
  });

  it('KuCoin futures in hedge mode (FD-KUCOINHEDGE): the long and the short apart, the position named with each order', async () => {
    const both = [
      { symbol: 'BTC/USDT:USDT', contracts: 10, side: 'long', entryPrice: 59_000, info: { positionSide: 'LONG' } },
      // KuCoin names the side: it is taken over the size's sign.
      { symbol: 'BTC/USDT:USDT', contracts: 20, side: 'long', entryPrice: 61_000, info: { positionSide: 'SHORT' } },
      { symbol: 'ETH/USDT:USDT', contracts: 5, side: 'short', entryPrice: 3_000, info: { positionSide: 'SHORT' } },
    ];
    const fut = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true, hedged: true, positions: both });
    const spot = fakeClient('kucoin', [BTC_SPOT]);
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    // The warnings about the position (not the market order's general note).
    const own = (w: string[]) => w.filter((x) => !x.startsWith('Un ordin la piață'));
    expect(await t.instrument('futures', 'BTC/USDT:USDT')).toMatchObject({
      positionMode: 'hedge',
      position: null,
      hedgePositions: { long: { side: 'long', amount: 0.01, entryPrice: 59_000 }, short: { side: 'short', amount: 0.02, entryPrice: 61_000 } },
    });
    // A short with a long open: a separate short, said so; it goes out with the position named (ccxt: SHORT).
    const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.005, leverage: 2, marginMode: 'isolated' }));
    expect(p).toMatchObject({ positionMode: 'hedge', errors: [] });
    expect(p.warnings.join(' ')).toContain('«Short» deschide un short separat, iar long-ul de 0.01 BTC rămâne deschis. Ca să-l închizi, bifează reduce-only («Închide long»).');
    await t.place(p);
    expect(createArgs(fut.calls)[5]).toMatchObject({ hedged: true, marginMode: 'isolated', leverage: 2 });
    // Closing the long (a reduce-only sell), more than it holds: KuCoin would cancel it, said so.
    const c = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.015, reduceOnly: true, marginMode: 'isolated' }));
    expect(own(c.warnings)).toEqual(['Închizi 0.015 BTC, iar poziția are 0.01 BTC: KuCoin anulează un ordin reduce-only mai mare decât poziția.']);
    await t.place(c);
    expect(createArgs(fut.calls, 1)[5]).toMatchObject({ hedged: true, reduceOnly: true, marginMode: 'isolated' });
    expect(createArgs(fut.calls, 1)[5]).not.toHaveProperty('leverage');
    // The mode was read once (kept 10 minutes).
    expect(fut.calls.filter((x) => x.fn === 'fetchPositionMode')).toHaveLength(1);

    // Only a long open: closing the short has nothing to close; a buy opens a long beside nothing (no warning).
    const one = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true, hedged: true, positions: [both[0]!] });
    const t1 = new CcxtTrader('kucoin', { spot: spot.ex, futures: one.ex }, silentLogger);
    expect(own((await t1.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.01, reduceOnly: true }))).warnings)).toEqual([
      'Nu e niciun short deschis pe BTC/USDT:USDT: «Închide short» nu are ce închide.',
    ]);
    expect(own((await t1.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.01, leverage: 2 }))).warnings)).toEqual([]);

    // One-way, as before: one position, the mode said; a reduce-only larger than the position warned (KuCoin).
    const ow = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true, positions: [{ ...both[0]!, info: { positionSide: 'BOTH' } }] });
    const tw = new CcxtTrader('kucoin', { spot: spot.ex, futures: ow.ex }, silentLogger);
    expect(await tw.instrument('futures', 'BTC/USDT:USDT')).toMatchObject({ positionMode: 'one-way', position: { side: 'long', amount: 0.01 } });
    expect(await tw.instrument('futures', 'BTC/USDT:USDT')).not.toHaveProperty('hedgePositions');
    const w = await tw.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.02, reduceOnly: true }));
    expect(w.positionMode).toBe('one-way');
    expect(own(w.warnings)).toEqual(['Închizi 0.02 BTC, iar poziția are 0.01 BTC: KuCoin anulează un ordin reduce-only mai mare decât poziția.']);
    // (A reduce-only buy does not close a long: no size compared.)
    expect(own((await tw.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.02, reduceOnly: true }))).warnings)).toEqual([]);
    await tw.place(w);
    expect(createArgs(ow.calls)[5]).not.toHaveProperty('hedged');
  });

  it('KuCoin hedge mode: the unified account is refused at the check; a mode changed since it was read is said, and read again', async () => {
    const uta = fakeClient('kucoin', [BTC_SPOT, BTC_PERP], { last: 60_000, positionMode: true, hedged: true, uta: true });
    const tu = new CcxtTrader('kucoin', { spot: uta.ex, futures: null }, silentLogger);
    const p = await tu.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'cross' }));
    expect(p.errors).toEqual([expect.stringMatching(/^Pe contul unificat KuCoin \(UTA\), API-ul KuCoin primește ordine futures doar în modul one-way/)]);
    await expect(tu.place(p)).rejects.toMatchObject({ code: 'HEDGE_MODE', message: expect.stringMatching(/contul unificat KuCoin/) });
    expect(uta.calls.some((c) => c.fn === 'createOrder')).toBe(false);

    // Read as one-way, switched to hedge on KuCoin meanwhile: refused there (330012); the mode is read again next time.
    const msg = 'kucoinfutures {"msg":"Your order is in One-Way Mode, while your account is set to Hedge Mode. Update your settings so they match and try again.","code":"330012"}';
    const fut = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true, createError: new ccxt.InvalidOrder(msg) });
    const t = new CcxtTrader('kucoin', { spot: fakeClient('kucoin', [BTC_SPOT]).ex, futures: fut.ex }, silentLogger);
    const q = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01 }));
    await expect(t.place(q)).rejects.toMatchObject({ code: 'REJECTED', message: 'Modul pozițiilor (one-way / hedge) s-a schimbat pe KuCoin: ordinul n-a fost primit. Trimite-l din nou.' });
    const reads = fut.calls.filter((c) => c.fn === 'fetchPositionMode').length;
    await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01 }));
    expect(fut.calls.filter((c) => c.fn === 'fetchPositionMode')).toHaveLength(reads + 1);
    // The unified account refused for the mode (it read as one-way): its own explanation, not "send it again".
    const um = fakeClient('kucoin', [BTC_SPOT, BTC_PERP], { last: 60_000, positionMode: true, uta: true, createError: new ccxt.InvalidOrder(msg) });
    const tum = new CcxtTrader('kucoin', { spot: um.ex, futures: null }, silentLogger);
    await expect(tum.place(await tum.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'cross' })))).rejects.toMatchObject({ code: 'HEDGE_MODE', message: expect.stringMatching(/contul unificat KuCoin/) });
    // Any exchange (FD-HEDGEALL): Binance's -4061, its name in the words, the mode read again.
    const bmsg = 'binance {"code":-4061,"msg":"Order\'s position side does not match user\'s setting."}';
    const bn = fakeClient('binance', [BTC_SPOT, BTC_PERP], { last: 100, positionMode: true, createError: new ccxt.InvalidOrder(bmsg) });
    const tb = new CcxtTrader('binance', { spot: bn.ex, futures: null }, silentLogger);
    await expect(tb.place(await tb.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01 })))).rejects.toMatchObject({ code: 'REJECTED', message: 'Modul pozițiilor (one-way / hedge) s-a schimbat pe Binance: ordinul n-a fost primit. Trimite-l din nou.' });
    const breads = bn.calls.filter((c) => c.fn === 'fetchPositionMode').length;
    await tb.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01 }));
    expect(bn.calls.filter((c) => c.fn === 'fetchPositionMode')).toHaveLength(breads + 1);
    // An answer lost after sending stays "unknown", whatever its words.
    const lost = fakeClient('kucoinfutures', [BTC_PERP], { last: 60_000, positionMode: true, createError: new ccxt.RequestTimeout('kucoinfutures POST /api/v1/orders hedge mode timed out') });
    const tl = new CcxtTrader('kucoin', { spot: fakeClient('kucoin', [BTC_SPOT]).ex, futures: lost.ex }, silentLogger);
    await expect(tl.place(await tl.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01 })))).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });

  it('a reduce-only close changes neither leverage nor margin (it only names the margin mode where asked)', async () => {
    for (const exchange of ['binance', 'okx', 'kucoin'] as const) {
      const c = fakeClient(exchange, [BTC_SPOT, BTC_PERP], { last: 100, positionMode: true });
      const t = new CcxtTrader(exchange, { spot: c.ex, futures: exchange === 'kucoin' ? c.ex : null }, silentLogger);
      const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, reduceOnly: true, marginMode: 'cross' }));
      expect(p.errors).toEqual([]);
      await t.place(p);
      expect(c.calls.some((x) => x.fn === 'setLeverage' || x.fn === 'setMarginMode'), exchange).toBe(false);
      const params = createArgs(c.calls)[5];
      expect(params, exchange).toMatchObject({ reduceOnly: true });
      expect(params, exchange).not.toHaveProperty('leverage');
      if (exchange !== 'binance') expect(params.marginMode, exchange).toBe('cross');
    }
  });

  it('Binance futures: margin mode and leverage before; TP / SL after a market entry, each reported', async () => {
    const perp = { ...BTC_PERP, contractSize: 1, amountStep: 0.001, minAmount: 0.001 };
    const c = fakeClient('binance', [BTC_SPOT, perp], { last: 100, positionMode: true });
    const t = new CcxtTrader('binance', { spot: c.ex, futures: null }, silentLogger);
    const r = await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.5, leverage: 4, marginMode: 'isolated', stopLoss: 95, takeProfit: 110 })));
    expect(c.calls.map((x) => x.fn).filter((f) => f !== 'fetchBalance')).toEqual(['fetchPositionMode', 'setMarginMode', 'setLeverage', 'createOrder', 'createOrder', 'createOrder']);
    expect(c.calls.find((x) => x.fn === 'setMarginMode')?.args).toEqual(['isolated', 'BTC/USDT:USDT']);
    expect(c.calls.find((x) => x.fn === 'setLeverage')?.args).toEqual([4, 'BTC/USDT:USDT']);
    expect(createArgs(c.calls, 0)[5]).not.toHaveProperty('stopLoss');
    expect(createArgs(c.calls, 1).slice(1, 4)).toEqual(['market', 'sell', 0.5]);
    expect(createArgs(c.calls, 1)[5]).toEqual({ stopLossPrice: 95, reduceOnly: true });
    expect(createArgs(c.calls, 2)[5]).toEqual({ takeProfitPrice: 110, reduceOnly: true });
    expect(r.followUps).toEqual([
      { what: 'stop-loss', ok: true, orderId: 'o2', message: null },
      { what: 'take-profit', ok: true, orderId: 'o3', message: null },
    ]);
  });

  it("Bitget: the account's position mode is read (one-way named, hedge sent as hedge), classic or unified; OKX names the margin per order", async () => {
    const bg = fakeClient('bitget', [BTC_SPOT, BTC_PERP], { last: 100 });
    const tb = new CcxtTrader('bitget', { spot: bg.ex, futures: null }, silentLogger);
    await tb.place(await tb.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, leverage: 2, marginMode: 'isolated' })));
    expect(bg.calls.find((x) => x.fn === 'posMode')?.args[0]).toEqual({ symbol: 'BTCUSDTUSDT', productType: 'USDT-FUTURES', marginCoin: 'USDT' });
    expect(createArgs(bg.calls)[5]).toMatchObject({ oneWayMode: true, marginMode: 'isolated' });
    expect(bg.calls.find((x) => x.fn === 'setLeverage')?.args).toEqual([2, 'BTC/USDT:USDT', { marginMode: 'isolated' }]);
    // Hedge (FD-HEDGEALL): no one-way flag (it would override), the side named on an isolated leverage.
    const hedge = fakeClient('bitget', [BTC_SPOT, BTC_PERP], { last: 100, posMode: 'hedge_mode' });
    const th = new CcxtTrader('bitget', { spot: hedge.ex, futures: null }, silentLogger);
    await th.place(await th.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, leverage: 3, marginMode: 'isolated', stopLoss: 110 })));
    expect(createArgs(hedge.calls)[5]).toMatchObject({ hedged: true, marginMode: 'isolated' });
    expect(createArgs(hedge.calls)[5]).not.toHaveProperty('oneWayMode');
    expect(hedge.calls.find((x) => x.fn === 'setLeverage')?.args).toEqual([3, 'BTC/USDT:USDT', { marginMode: 'isolated', holdSide: 'short' }]);
    // The unified account (the v3 settings answer): cross named "crossed", leverage without a mode, no one-way flag, the
    // hold mode read from the settings; no stop orders and no isolated margin from Sentiq.
    const unified = (holdMode: string) => {
      const c = fakeClient('bitget', [BTC_SPOT, BTC_PERP], { last: 100 });
      Object.assign(c.ex, { options: {}, privateUtaGetV3AccountSettings: async () => ({ data: { accountMode: 'unified', holdMode } }) });
      return { ...c, t: new CcxtTrader('bitget', { spot: c.ex, futures: null }, silentLogger) };
    };
    const u = unified('one_way_mode');
    expect((await u.t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'isolated' }))).errors.join(' ')).toMatch(/doar cu marjă cross/);
    expect((await u.t.normalize(ticket({ kind: 'stop', triggerPrice: 110 }))).errors.join(' ')).toMatch(/nu trimite ordine stop/);
    await u.t.place(await u.t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, leverage: 2, marginMode: 'cross' })));
    expect(u.calls.find((x) => x.fn === 'posMode')).toBeUndefined();
    expect(u.calls.find((x) => x.fn === 'setLeverage')?.args).toEqual([2, 'BTC/USDT:USDT']);
    expect(createArgs(u.calls)[5]).toMatchObject({ marginMode: 'crossed' });
    expect(createArgs(u.calls)[5]).not.toHaveProperty('oneWayMode');
    expect((u.ex as unknown as { options: { uta: boolean } }).options.uta).toBe(true);
    // Closing an isolated position opened on Bitget: its mode, in v3 words.
    await u.t.place(await u.t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, reduceOnly: true, marginMode: 'isolated' })));
    expect(createArgs(u.calls, 1)[5]).toMatchObject({ reduceOnly: true, marginMode: 'isolated' });
    const uh = unified('hedge_mode');
    await uh.t.place(await uh.t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, marginMode: 'cross' })));
    expect(createArgs(uh.calls)[5]).toMatchObject({ hedged: true, marginMode: 'crossed' });
    expect(createArgs(uh.calls)[5]).not.toHaveProperty('oneWayMode');
    // The settings cannot be read for a network failure: an error, not a guess that the account is classic.
    const down = fakeClient('bitget', [BTC_SPOT, BTC_PERP], { last: 100 });
    Object.assign(down.ex, {
      options: {},
      privateUtaGetV3AccountSettings: async () => {
        throw new ccxt.RequestTimeout('bitget timed out');
      },
    });
    await expect(new CcxtTrader('bitget', { spot: down.ex, futures: null }, silentLogger).normalize(ticket({}))).rejects.toMatchObject({ code: 'REJECTED' });
    const ok = fakeClient('okx', [BTC_SPOT, BTC_PERP], { last: 100, positionMode: true });
    const to = new CcxtTrader('okx', { spot: ok.ex, futures: null }, silentLogger);
    await to.place(await to.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, leverage: 3 })));
    expect(ok.calls.find((x) => x.fn === 'setLeverage')?.args).toEqual([3, 'BTC/USDT:USDT', { marginMode: 'cross' }]);
    expect(createArgs(ok.calls)[5]).toMatchObject({ marginMode: 'cross' });
  });

  it("names each exchange's stop the way it wants it (a buy above, a sell below the price)", async () => {
    const cases: [string, Partial<OrderTicket>, Record<string, unknown>, string[]][] = [
      ['kucoin', { kind: 'stop', triggerPrice: 110 }, { triggerPrice: 110, stop: 'entry' }, []],
      ['kucoin', { side: 'sell', kind: 'stop', triggerPrice: 90 }, { triggerPrice: 90, stop: 'loss' }, []],
      ['kraken', { kind: 'stop', triggerPrice: 110 }, { stopLossPrice: 110 }, ['triggerPrice']],
      ['coinbase', { kind: 'stop_limit', triggerPrice: 110, price: 111 }, { triggerPrice: 110, stop_direction: 'STOP_DIRECTION_STOP_UP' }, []],
      ['coinbase', { side: 'sell', kind: 'stop_limit', triggerPrice: 90, price: 89 }, { stop_direction: 'STOP_DIRECTION_STOP_DOWN' }, []],
      ['bybit', { kind: 'stop', triggerPrice: 110 }, { triggerPrice: 110 }, ['triggerDirection']],
      ['bybit', { market: 'futures', symbol: 'BTC/USDT:USDT', kind: 'stop', triggerPrice: 110 }, { triggerPrice: 110, triggerDirection: 'ascending' }, []],
    ];
    for (const [exchange, t0, want, absent] of cases) {
      const c = fakeClient(exchange, [BTC_SPOT, BTC_PERP], { last: 100 });
      const t = new CcxtTrader(exchange, { spot: c.ex, futures: null }, silentLogger);
      const p = await t.normalize(ticket({ amount: 1, ...t0 }));
      expect(p.errors, `${exchange} ${JSON.stringify(t0)}`).toEqual([]);
      await t.place(p);
      const [, type, , , price, params] = createArgs(c.calls);
      expect(params, exchange).toMatchObject(want);
      for (const k of absent) expect(params, exchange).not.toHaveProperty(k);
      expect(type).toBe(t0.kind === 'stop_limit' ? 'limit' : 'market');
      if (t0.kind === 'stop_limit') expect(price).toBe(t0.price);
    }
  });

  it('turns ccxt errors into words: no funds, a refusal, and an answer lost after sending (never retried)', async () => {
    const funds = fakeClient('okx', [BTC_SPOT], { createError: new ccxt.InsufficientFunds('okx {"msg":"Insufficient balance"}') });
    const t = new CcxtTrader('okx', { spot: funds.ex, futures: null }, silentLogger);
    await expect(t.place(await t.normalize(ticket({})))).rejects.toMatchObject({ code: 'INSUFFICIENT' });
    const lost = fakeClient('okx', [BTC_SPOT], { createError: new ccxt.RequestTimeout('okx timed out') });
    const t2 = new CcxtTrader('okx', { spot: lost.ex, futures: null }, silentLogger);
    const err = await t2.place(await t2.normalize(ticket({}))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradingError);
    expect(err).toMatchObject({ code: 'UNKNOWN_OUTCOME', message: expect.stringMatching(/Verifică ordinele deschise/) });
    expect(lost.calls.filter((c) => c.fn === 'createOrder')).toHaveLength(1);
    // An answer that cannot be read, or a failure while reading it: unknown too, not a refusal.
    for (const createError of [new ccxt.BadResponse('okx unexpected body'), new TypeError("Cannot read properties of undefined (reading 'ordId')")]) {
      const odd = fakeClient('okx', [BTC_SPOT], { createError });
      const to = new CcxtTrader('okx', { spot: odd.ex, futures: null }, silentLogger);
      await expect(to.place(await to.normalize(ticket({})))).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
    const denied = fakeClient('binance', [BTC_SPOT], { createError: new ccxt.DDoSProtection('binance {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}') });
    const tdn = new CcxtTrader('binance', { spot: denied.ex, futures: null }, silentLogger);
    await expect(tdn.place(await tdn.normalize(ticket({})))).rejects.toMatchObject({ code: 'PERMISSION' });
    const bad = fakeClient('okx', [BTC_SPOT], { createError: new ccxt.InvalidOrder('okx Order quantity too small') });
    await expect(new CcxtTrader('okx', { spot: bad.ex, futures: null }, silentLogger).place(await t2.normalize(ticket({})))).rejects.toMatchObject({ code: 'REJECTED' });
  });

  it('cancels, naming a trigger order (KuCoin classic spot: its stop orders)', async () => {
    const c = fakeClient('kucoin', [BTC_SPOT]);
    const t = new CcxtTrader('kucoin', { spot: c.ex, futures: null }, silentLogger);
    expect(await t.cancel({ orderId: 'x9', symbol: 'BTC/USDT', market: 'spot', trigger: true })).toMatchObject({ status: 'cancelled', orderId: 'x9' });
    expect(c.calls.find((x) => x.fn === 'cancelOrder')?.args).toEqual(['x9', 'BTC/USDT', { trigger: true, stop: true }]);
    const gone = fakeClient('okx', [BTC_SPOT]);
    (gone.ex as unknown as { cancelOrder: () => Promise<never> }).cancelOrder = async () => Promise.reject(new ccxt.OrderNotFound('okx order does not exist'));
    await expect(new CcxtTrader('okx', { spot: gone.ex, futures: null }, silentLogger).cancel({ orderId: 'y', symbol: 'BTC/USDT', market: 'spot', trigger: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------- the real ccxt classes

/** A real ccxt client with its markets set and its HTTP answered here, recording what it would send. */
function realClient(Ctor: new (cfg: object) => Exchange, cfg: object, markets: object[], answer: (url: string, method: string) => unknown, options: Record<string, unknown> = {}) {
  const ex = new Ctor({ ...cfg, enableRateLimit: false });
  Object.assign(ex.options, options);
  ex.setMarkets(markets as never);
  const sent: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  (ex as unknown as { fetch: (url: string, method?: string, headers?: unknown, body?: string) => Promise<unknown> }).fetch = async (url, method = 'GET', _h, body) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = body ? (JSON.parse(body) as Record<string, unknown>) : null;
    } catch {
      parsed = Object.fromEntries(new URLSearchParams(body ?? ''));
    }
    sent.push({ url, method, body: parsed });
    return answer(url, method);
  };
  return { ex, sent };
}

const ccxtMarket = (o: { id: string; symbol: string; base: string; quote: string; swap?: boolean; contractSize?: number; amount: number; price: number; min?: number; info?: object }) => ({
  id: o.id,
  symbol: o.symbol,
  base: o.base,
  quote: o.quote,
  settle: o.swap ? o.quote : undefined,
  baseId: o.base,
  quoteId: o.quote,
  settleId: o.swap ? o.quote : undefined,
  type: o.swap ? 'swap' : 'spot',
  spot: !o.swap,
  margin: false,
  swap: !!o.swap,
  future: false,
  option: false,
  contract: !!o.swap,
  linear: o.swap ? true : undefined,
  inverse: o.swap ? false : undefined,
  contractSize: o.swap ? (o.contractSize ?? 1) : undefined,
  active: true,
  precision: { amount: o.amount, price: o.price },
  limits: { amount: { min: o.min ?? o.amount }, price: {}, cost: {}, leverage: { max: 100 } },
  info: o.info ?? {},
});

describe('what the real ccxt sends (FD-TRADING, ccxt 4.5)', () => {
  it('FD-ORDEREDIT, Bybit: the position stop loss through trading-stop, a conditional stop amended with its trigger', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.001, price: 0.1, info: { category: 'linear' } });
    const order = (id: string, stopOrderType: string, trigger: string) => ({ orderId: id, orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', price: '0', qty: '0.01', triggerPrice: trigger, triggerDirection: 2, stopOrderType, reduceOnly: true, orderStatus: 'Untriggered', createdTime: '1700000000000', updatedTime: '1700000000000', positionIdx: 0, takeProfit: '', stopLoss: '', tpslMode: 'Full' });
    const answer = (url: string) => {
      if (url.includes('order/realtime')) return { retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [order('p1', 'StopLoss', '57000'), order('c1', 'Stop', '56000')] } };
      if (url.includes('position/list')) return { retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [{ symbol: 'BTCUSDT', side: 'Buy', size: '0.01', avgPrice: '59000', positionIdx: 0, tradeMode: 0, markPrice: '60000', leverage: '5' }] } };
      if (url.includes('tickers')) return { retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', lastPrice: '60000', bid1Price: '59999', ask1Price: '60001' }] } };
      if (url.includes('order/amend')) return { retCode: 0, retMsg: 'OK', result: { orderId: 'c1', orderLinkId: '' } };
      return { retCode: 0, retMsg: 'OK', result: {} };
    };
    const c = realClient(ccxt.bybit as never, { apiKey: 'k1234567', secret: 's1234567' }, [perp], answer, { enableUnifiedAccount: true, enableUnifiedMargin: false });
    const t = new CcxtTrader('bybit', { spot: c.ex, futures: null }, silentLogger);
    const go = async (changes: Parameters<CcxtTrader['normalizeModify']>[0]['changes']) => {
      const plan = await t.normalizeModify({ accountId: 1, idemKey: KEY, market: 'futures', symbol: 'BTC/USDT:USDT', position: { side: 'long' }, changes });
      expect(plan.preview.errors).toEqual([]);
      return t.modify(plan);
    };
    await go([{ what: 'sl', orderId: 'p1', level: 58_000 }]);
    await go([{ what: 'sl', orderId: 'c1', level: 57_500 }]);
    const writes = c.sent.filter((x) => x.method === 'POST');
    expect(writes[0]).toMatchObject({ url: expect.stringContaining('/v5/position/trading-stop'), body: { category: 'linear', symbol: 'BTCUSDT', tpslMode: 'Full', positionIdx: 0, stopLoss: '58000' } });
    expect(writes[1]).toMatchObject({ url: expect.stringContaining('/v5/order/amend'), body: { category: 'linear', symbol: 'BTCUSDT', orderId: 'c1', triggerPrice: '57500' } });
    expect(writes).toHaveLength(2);
  });

  it('FD-ORDEREDIT, OKX: the TP / SL algo orders read by their kinds, one leg of an oco amended', async () => {
    const perp = ccxtMarket({ id: 'BTC-USDT-SWAP', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.01, amount: 1, price: 0.1, info: { instType: 'SWAP' } });
    const answer = (url: string) => {
      if (url.includes('orders-algo-pending') && url.includes('conditional')) {
        return { code: '0', msg: '', data: [{ algoId: 'a1', instId: 'BTC-USDT-SWAP', instType: 'SWAP', ordType: 'oco', side: 'sell', posSide: 'net', sz: '10', slTriggerPx: '57000', slOrdPx: '-1', tpTriggerPx: '65000', tpOrdPx: '-1', reduceOnly: 'true', state: 'live', cTime: '1700000000000' }] };
      }
      if (url.includes('orders-algo-pending') || url.includes('orders-pending')) return { code: '0', msg: '', data: [] };
      if (url.includes('account/positions')) return { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', instType: 'SWAP', pos: '10', posSide: 'net', avgPx: '59000', mgnMode: 'cross', lever: '5', markPx: '60000' }] };
      if (url.includes('account/config')) return { code: '0', msg: '', data: [{ posMode: 'net_mode' }] };
      if (url.includes('market/ticker')) return { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', last: '60000', bidPx: '59999', askPx: '60001' }] };
      if (url.includes('amend-algos')) return { code: '0', msg: '', data: [{ algoId: 'a1', sCode: '0', sMsg: '' }] };
      return { code: '0', msg: '', data: [] };
    };
    const c = realClient(ccxt.okx as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer);
    const t = new CcxtTrader('okx', { spot: c.ex, futures: null }, silentLogger);
    const plan = await t.normalizeModify({ accountId: 1, idemKey: KEY, market: 'futures', symbol: 'BTC/USDT:USDT', position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'a1', level: 58_000 }] });
    expect(plan.preview).toMatchObject({ errors: [], steps: [{ how: 'amend', before: { stopLoss: 57_000, takeProfit: 65_000 }, after: { stopLoss: 58_000, takeProfit: 65_000 } }] });
    await t.modify(plan);
    const writes = c.sent.filter((x) => x.method === 'POST');
    expect(writes).toEqual([expect.objectContaining({ url: expect.stringContaining('/api/v5/trade/amend-algos'), body: { instId: 'BTC-USDT-SWAP', algoId: 'a1', newSlTriggerPx: '58000', newSlOrdPx: '-1' } })]);
  });

  it('FD-ORDEREDIT, KuCoin futures: a stop loss moved: read from the stop orders, the new one (stop down, reduce-only) first, then the old one cancelled', async () => {
    const perp = ccxtMarket({ id: 'XBTUSDTM', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.001, amount: 1, price: 0.1, min: 1 });
    const answer = (url: string, method: string) => {
      if (url.includes('getPositionMode')) return { code: '200000', data: { positionMode: 0 } };
      if (method === 'DELETE') return { code: '200000', data: { cancelledOrderIds: ['sl1'] } };
      if (url.includes('stopOrders')) {
        return { code: '200000', data: { currentPage: 1, pageSize: 50, totalNum: 1, totalPage: 1, items: [{ id: 'sl1', symbol: 'XBTUSDTM', type: 'market', side: 'sell', size: 10, stop: 'down', stopPriceType: 'TP', stopPrice: '57000', reduceOnly: true, status: 'open', isActive: true, marginMode: 'ISOLATED', leverage: '5', createdAt: 1_700_000_000_000, settleCurrency: 'USDT' }] } };
      }
      if (url.includes('/api/v1/positions')) return { code: '200000', data: [{ symbol: 'XBTUSDTM', currentQty: 10, avgEntryPrice: '59000', isOpen: true, crossMode: false, marginMode: 'ISOLATED', realLeverage: 5, markPrice: '60000', positionSide: 'BOTH', settleCurrency: 'USDT' }] };
      if (method === 'POST' && url.includes('/api/v1/orders')) return { code: '200000', data: { orderId: 'kf-new' } };
      if (url.includes('/api/v1/orders')) return { code: '200000', data: { currentPage: 1, pageSize: 50, totalNum: 0, totalPage: 0, items: [] } };
      return { code: '200000', data: { price: '60000', bestBidPrice: '59999', bestAskPrice: '60001', symbol: 'XBTUSDTM' } };
    };
    const fut = realClient(ccxt.kucoinfutures as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer, { uta: false });
    const spot = realClient(ccxt.kucoin as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [], answer, { uta: false });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    const plan = await t.normalizeModify({ accountId: 1, idemKey: KEY, market: 'futures', symbol: 'BTC/USDT:USDT', position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'sl1', level: 58_000 }] });
    expect(plan.preview).toMatchObject({ errors: [], steps: [{ how: 'place-then-cancel', before: { triggerPrice: 57_000 }, after: { triggerPrice: 58_000 } }] });
    expect((await t.modify(plan)).status).toBe('done');
    const writes = fut.sent.filter((x) => x.method !== 'GET');
    expect(writes[0]?.body).toMatchObject({ side: 'sell', symbol: 'XBTUSDTM', type: 'market', size: 10, stop: 'down', stopPrice: '58000', reduceOnly: true, marginMode: 'ISOLATED' });
    expect(writes[1]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('sl1') });
    expect(writes).toHaveLength(2);
  });

  it('KuCoin futures: lots, leverage, isolated margin and the client id in the order; one-way checked first', async () => {
    const perp = ccxtMarket({ id: 'XBTUSDTM', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.001, amount: 1, price: 0.1, min: 1 });
    const answer = (url: string) => {
      if (url.includes('getPositionMode')) return { code: '200000', data: { positionMode: 0 } };
      if (url.includes('/orders')) return { code: '200000', data: { orderId: 'kf-1' } };
      if (url.includes('ticker')) return { code: '200000', data: { price: '60000', bestBidPrice: '59999', bestAskPrice: '60001', symbol: 'XBTUSDTM' } };
      return { code: '200000', data: {} };
    };
    const fut = realClient(ccxt.kucoinfutures as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer, { uta: false });
    const spot = realClient(ccxt.kucoin as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [], answer, { uta: false });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.012, kind: 'limit', price: 59_500.04, leverage: 7, marginMode: 'isolated' }));
    expect(p).toMatchObject({ contracts: 12, price: 59_500, errors: [] });
    expect(await t.place(p)).toMatchObject({ orderId: 'kf-1' });
    const order = fut.sent.find((s) => s.method === 'POST' && /\/api\/v1\/orders$/.test(s.url));
    expect(order?.body).toMatchObject({ clientOid: clientIdOf(KEY), side: 'buy', symbol: 'XBTUSDTM', type: 'limit', size: 12, price: '59500', leverage: 7, marginMode: 'ISOLATED' });
    expect(fut.sent.findIndex((s) => s.url.includes('getPositionMode'))).toBeLessThan(fut.sent.indexOf(order!));
  });

  it('KuCoin futures with TP / SL: the take-profit-and-stop-loss endpoint, the trigger prices on the order', async () => {
    const perp = ccxtMarket({ id: 'XBTUSDTM', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.001, amount: 1, price: 0.1, min: 1 });
    const answer = (url: string) => (url.includes('getPositionMode') ? { code: '200000', data: { positionMode: 0 } } : url.includes('st-orders') ? { code: '200000', data: { orderId: 'kf-2' } } : { code: '200000', data: { price: '60000' } });
    const fut = realClient(ccxt.kucoinfutures as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer, { uta: false });
    const spot = realClient(ccxt.kucoin as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [], answer, { uta: false });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.005, leverage: 2, stopLoss: 58_000, takeProfit: 64_000 })));
    const order = fut.sent.find((s) => s.method === 'POST' && s.url.includes('st-orders'));
    expect(order?.body).toMatchObject({ type: 'market', size: 5, leverage: 2, triggerStopDownPrice: '58000', triggerStopUpPrice: '64000' });
  });

  it('KuCoin futures in hedge mode (FD-KUCOINHEDGE): each order names its position, the TP / SL one too', async () => {
    const perp = ccxtMarket({ id: 'XBTUSDTM', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.001, amount: 1, price: 0.1, min: 1 });
    const answer = (url: string) => {
      if (url.includes('getPositionMode')) return { code: '200000', data: { positionMode: 1 } };
      if (url.includes('st-orders')) return { code: '200000', data: { orderId: 'kf-st' } };
      if (url.includes('/orders')) return { code: '200000', data: { orderId: 'kf-h' } };
      return { code: '200000', data: { price: '60000' } };
    };
    const fut = realClient(ccxt.kucoinfutures as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer, { uta: false });
    const spot = realClient(ccxt.kucoin as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [], answer, { uta: false });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: fut.ex }, silentLogger);
    const send = async (o: Partial<OrderTicket>) => t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.005, marginMode: 'isolated', ...o })));
    await send({ side: 'buy', leverage: 3 });
    await send({ side: 'sell', leverage: 3 });
    await send({ side: 'sell', reduceOnly: true });
    await send({ side: 'buy', reduceOnly: true });
    await send({ side: 'sell', leverage: 2, stopLoss: 62_000, takeProfit: 55_000 });
    const orders = fut.sent.filter((x) => x.method === 'POST' && /\/api\/v1\/(st-)?orders$/.test(x.url)).map((x) => x.body);
    expect(orders.map((b) => [b?.side, b?.reduceOnly ?? false, b?.positionSide])).toEqual([
      ['buy', false, 'LONG'],
      ['sell', false, 'SHORT'],
      ['sell', true, 'LONG'],
      ['buy', true, 'SHORT'],
      ['sell', false, 'SHORT'],
    ]);
    expect(orders[4]).toMatchObject({ triggerStopUpPrice: '55000', triggerStopDownPrice: '62000', leverage: 2, marginMode: 'ISOLATED' });
    expect(fut.sent.filter((x) => x.url.includes('getPositionMode'))).toHaveLength(1);
  });

  it("KuCoin spot: a buy stop is a stop order of kind 'entry'", async () => {
    const m = ccxtMarket({ id: 'BTC-USDT', symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', amount: 0.00001, price: 0.1, info: { quoteIncrement: '0.000001' } });
    const spot = realClient(ccxt.kucoin as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [m], (url) => (url.includes('stop-order') ? { code: '200000', data: { orderId: 'ks-1' } } : { code: '200000', data: { price: '60000', bestBid: '59990', bestAsk: '60010' } }), { uta: false, hf: false });
    const t = new CcxtTrader('kucoin', { spot: spot.ex, futures: null }, silentLogger);
    await t.place(await t.normalize(ticket({ kind: 'stop', triggerPrice: 61_000, amount: 0.001 })));
    const order = spot.sent.find((s) => s.method === 'POST' && s.url.includes('stop-order'));
    expect(order?.body).toMatchObject({ side: 'buy', symbol: 'BTC-USDT', type: 'market', stop: 'entry', stopPrice: '61000', size: '0.001' });
  });

  it('Bybit futures: a buy stop triggers ascending (1); spot never names a direction', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.001, price: 0.1, info: { category: 'linear' } });
    const answer = (url: string) => {
      if (url.includes('order/create')) return { retCode: 0, retMsg: 'OK', result: { orderId: 'by-1', orderLinkId: '' } };
      if (url.includes('set-leverage')) return { retCode: 0, retMsg: 'OK', result: {} };
      if (url.includes('tickers')) return { retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', lastPrice: '60000', bid1Price: '59999', ask1Price: '60001' }] } };
      return { retCode: 0, result: {} };
    };
    const c = realClient(ccxt.bybit as never, { apiKey: 'k1234567', secret: 's1234567' }, [perp], answer, { enableUnifiedAccount: true, enableUnifiedMargin: false });
    const t = new CcxtTrader('bybit', { spot: c.ex, futures: null }, silentLogger);
    await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', kind: 'stop', triggerPrice: 61_000, amount: 0.01, leverage: 3 })));
    expect(c.sent.find((s) => s.url.includes('set-leverage'))?.body).toMatchObject({ symbol: 'BTCUSDT', buyLeverage: '3', sellLeverage: '3' });
    const order = c.sent.find((s) => s.url.includes('order/create'));
    expect(order?.body).toMatchObject({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.01', triggerPrice: '61000', triggerDirection: 1, orderLinkId: clientIdOf(KEY) });
  });

  it('Bitget unified account: the v3 order, cross named "crossed", no one-way flag; leverage set first', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.0001, price: 0.1 });
    const answer = (url: string) => {
      if (url.includes('/api/v3/account/settings')) return { code: '00000', data: { accountMode: 'unified', holdMode: 'one_way_mode' } };
      if (url.includes('set-leverage')) return { code: '00000', data: 'success' };
      if (url.includes('place-order')) return { code: '00000', data: { orderId: 'bg-1', clientOid: clientIdOf(KEY) } };
      return { code: '00000', data: [] };
    };
    const c = realClient(ccxt.bitget as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer);
    const t = new CcxtTrader('bitget', { spot: c.ex, futures: null }, silentLogger);
    const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', kind: 'limit', price: 60_000, amount: 0.01, leverage: 4, marginMode: 'cross' }));
    expect(p.errors).toEqual([]);
    expect(await t.place(p)).toMatchObject({ orderId: 'bg-1' });
    const lev = c.sent.find((s) => s.url.includes('set-leverage'));
    expect(lev?.url).toMatch(/\/api\/v3\/account\/set-leverage/);
    expect(lev?.body).toMatchObject({ symbol: 'BTCUSDT', leverage: '4', category: 'USDT-FUTURES' });
    expect(lev?.body).not.toHaveProperty('marginMode');
    const order = c.sent.find((s) => s.url.includes('place-order'));
    expect(order?.url).toMatch(/\/api\/v3\/trade\/place-order/);
    expect(order?.body).toMatchObject({ category: 'USDT-FUTURES', symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', qty: '0.01', price: '60000', marginMode: 'crossed', clientOid: clientIdOf(KEY) });
    expect(order?.body).not.toHaveProperty('oneWayMode');
    expect(c.sent.findIndex((s) => s.url.includes('set-leverage'))).toBeLessThan(c.sent.indexOf(order!));
  });

  it('hedge mode on Binance (FD-HEDGEALL): the position side on the entry and on the TP / SL after it, never reduce-only', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.001, price: 0.1, info: { orderTypes: ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET'] } });
    const answer = (url: string, method: string) => {
      if (url.includes('positionSide/dual')) return { dualSidePosition: true };
      if (method === 'POST' && /\/(order|algoOrder)\b/.test(url)) return { orderId: 77, algoId: 78, status: 'NEW', symbol: 'BTCUSDT' };
      if (url.includes('ticker')) return { symbol: 'BTCUSDT', lastPrice: '60000', bidPrice: '59999', askPrice: '60001' };
      return {};
    };
    const c = realClient(ccxt.binance as never, { apiKey: 'k1234567', secret: 's1234567' }, [perp], answer);
    const t = new CcxtTrader('binance', { spot: c.ex, futures: null }, silentLogger);
    const p = await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, leverage: 2, marginMode: 'isolated', stopLoss: 62_000, takeProfit: 55_000 }));
    expect(p).toMatchObject({ positionMode: 'hedge', errors: [] });
    const r = await t.place(p);
    expect(r.followUps.map((f) => f.ok)).toEqual([true, true]);
    const orders = c.sent.filter((s) => s.method === 'POST' && /\/(order|algoOrder)\b/.test(s.url)).map((s) => s.body ?? {});
    expect(orders.map((b) => [b.side, b.positionSide, 'reduceOnly' in b])).toEqual([
      ['SELL', 'SHORT', false],
      ['BUY', 'SHORT', false],
      ['BUY', 'SHORT', false],
    ]);
    // Closing the short (reduce-only buy): the short named, no reduce-only.
    await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.01, reduceOnly: true, idemKey: KEY.replace('0f', '3f') })));
    const close = c.sent.filter((s) => s.method === 'POST' && /\/order\b/.test(s.url)).at(-1)?.body ?? {};
    expect([close.side, close.positionSide, 'reduceOnly' in close]).toEqual(['BUY', 'SHORT', false]);
  });

  it('hedge mode on Bybit (FD-HEDGEALL): read per pair from its position list; positionIdx 1 / 2, reduce-only on the side closed', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.001, price: 0.1, info: { category: 'linear' } });
    let list = [{ symbol: 'BTCUSDT', positionIdx: 1, size: '0', side: '' }, { symbol: 'BTCUSDT', positionIdx: 2, size: '0', side: '' }];
    const answer = (url: string) => {
      if (url.includes('position/list')) return { retCode: 0, retMsg: 'OK', result: { category: 'linear', list } };
      if (url.includes('order/create')) return { retCode: 0, retMsg: 'OK', result: { orderId: 'by-h', orderLinkId: '' } };
      if (url.includes('set-leverage')) return { retCode: 0, retMsg: 'OK', result: {} };
      if (url.includes('tickers')) return { retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', lastPrice: '60000', bid1Price: '59999', ask1Price: '60001' }] } };
      return { retCode: 0, result: {} };
    };
    const c = realClient(ccxt.bybit as never, { apiKey: 'k1234567', secret: 's1234567' }, [perp], answer, { enableUnifiedAccount: true, enableUnifiedMargin: false });
    const t = new CcxtTrader('bybit', { spot: c.ex, futures: null }, silentLogger);
    const send = async (o: Partial<OrderTicket>, n: number) => t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, idemKey: KEY.replace('0f', `${n}f`), ...o })));
    expect(await t.instrument('futures', 'BTC/USDT:USDT')).toMatchObject({ positionMode: 'hedge' });
    await send({ side: 'buy', leverage: 2, stopLoss: 58_000 }, 1);
    await send({ side: 'sell', leverage: 2 }, 2);
    await send({ side: 'sell', reduceOnly: true }, 3);
    const orders = c.sent.filter((s) => s.url.includes('order/create')).map((s) => s.body ?? {});
    expect(orders.map((b) => [b.side, b.positionIdx, b.reduceOnly ?? null])).toEqual([
      ['Buy', 1, null],
      ['Sell', 2, null],
      ['Sell', 1, null],
    ]);
    expect(orders[0]).toMatchObject({ stopLoss: '58000' });
    // One-way (positionIdx 0): no position named; an empty list says nothing (sent one-way).
    list = [{ symbol: 'BTCUSDT', positionIdx: 0, size: '0', side: '' }];
    const ow = new CcxtTrader('bybit', { spot: c.ex, futures: null }, silentLogger);
    expect(await ow.instrument('futures', 'BTC/USDT:USDT')).toMatchObject({ positionMode: 'one-way' });
    list = [];
    const none = new CcxtTrader('bybit', { spot: c.ex, futures: null }, silentLogger);
    expect(await none.instrument('futures', 'BTC/USDT:USDT')).not.toHaveProperty('positionMode');
    await none.place(await none.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', amount: 0.01, idemKey: KEY.replace('0f', '9f') })));
    expect(c.sent.filter((s) => s.url.includes('order/create')).at(-1)?.body).not.toHaveProperty('positionIdx');
  });

  it('hedge mode on OKX (FD-HEDGEALL): posSide on the order and on an isolated leverage; reduce-only closes its side', async () => {
    const perp = ccxtMarket({ id: 'BTC-USDT-SWAP', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 0.01, amount: 1, price: 0.1 });
    const answer = (url: string) => {
      if (url.includes('account/config')) return { code: '0', data: [{ posMode: 'long_short_mode', acctLv: '2' }] };
      if (/trade\/(order|batch-orders)/.test(url)) return { code: '0', data: [{ ordId: 'ok-1', sCode: '0', sMsg: '' }] };
      if (url.includes('set-leverage')) return { code: '0', data: [{}] };
      if (url.includes('ticker')) return { code: '0', data: [{ instId: 'BTC-USDT-SWAP', last: '60000', bidPx: '59999', askPx: '60001' }] };
      return { code: '0', data: [] };
    };
    const c = realClient(ccxt.okx as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer);
    const t = new CcxtTrader('okx', { spot: c.ex, futures: null }, silentLogger);
    await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.05, leverage: 4, marginMode: 'isolated', stopLoss: 62_000 })));
    await t.place(await t.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.05, reduceOnly: true, marginMode: 'isolated', idemKey: KEY.replace('0f', '4f') })));
    expect(c.sent.find((s) => s.url.includes('set-leverage'))?.body).toMatchObject({ lever: 4, mgnMode: 'isolated', instId: 'BTC-USDT-SWAP', posSide: 'short' });
    // (ccxt sends OKX orders through the batch endpoint: one order in a list.)
    const orders = c.sent.filter((s) => /trade\/(order|batch-orders)/.test(s.url)).map((s) => (Array.isArray(s.body) ? s.body[0] : s.body) ?? {});
    expect(orders.map((b) => [b.side, b.posSide, b.tdMode, b.reduceOnly ?? null])).toEqual([
      ['sell', 'short', 'isolated', null],
      ['buy', 'short', 'isolated', null],
    ]);
  });

  it('hedge mode on Bitget, classic and unified (FD-HEDGEALL): open / close on the classic one, posSide on the unified one', async () => {
    const perp = ccxtMarket({ id: 'BTCUSDT', symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', swap: true, contractSize: 1, amount: 0.0001, price: 0.1 });
    const answer = (unified: boolean) => (url: string) => {
      if (url.includes('/api/v3/account/settings')) return unified ? { code: '00000', data: { accountMode: 'unified', holdMode: 'hedge_mode' } } : { code: '40084', msg: 'not unified' };
      if (url.includes('/api/v2/mix/account/account')) return { code: '00000', data: { posMode: 'hedge_mode', marginCoin: 'USDT' } };
      if (url.includes('set-leverage')) return { code: '00000', data: 'success' };
      if (url.includes('place-order')) return { code: '00000', data: { orderId: 'bg-h', clientOid: clientIdOf(KEY) } };
      return { code: '00000', data: [] };
    };
    const classic = realClient(ccxt.bitget as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer(false));
    const tc = new CcxtTrader('bitget', { spot: classic.ex, futures: null }, silentLogger);
    await tc.place(await tc.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.01, leverage: 5, marginMode: 'isolated' })));
    await tc.place(await tc.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, reduceOnly: true, marginMode: 'isolated', idemKey: KEY.replace('0f', '5f') })));
    expect(classic.sent.find((s) => s.url.includes('set-leverage'))?.body).toMatchObject({ symbol: 'BTCUSDT', leverage: '5', holdSide: 'long' });
    const co = classic.sent.filter((s) => s.url.includes('place-order')).map((s) => s.body ?? {});
    // Closing a long in hedge mode is a "buy" that closes (Bitget names the position's direction).
    expect(co.map((b) => [b.side, b.tradeSide, b.reduceOnly ?? null])).toEqual([
      ['buy', 'Open', null],
      ['buy', 'Close', null],
    ]);
    const unified = realClient(ccxt.bitget as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [perp], answer(true));
    const tu = new CcxtTrader('bitget', { spot: unified.ex, futures: null }, silentLogger);
    await tu.place(await tu.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'sell', amount: 0.01, marginMode: 'cross' })));
    await tu.place(await tu.normalize(ticket({ market: 'futures', symbol: 'BTC/USDT:USDT', side: 'buy', amount: 0.01, reduceOnly: true, marginMode: 'cross', idemKey: KEY.replace('0f', '6f') })));
    const uo = unified.sent.filter((s) => s.url.includes('place-order')).map((s) => s.body ?? {});
    expect(uo.map((b) => [b.side, b.posSide])).toEqual([
      ['sell', 'short'],
      ['buy', 'short'],
    ]);
  });

  it('Bitget unified account: a spot market buy names the quote sum the check showed (v3 reads `qty` in USDT there)', async () => {
    const doge = ccxtMarket({ id: 'DOGEUSDT', symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', amount: 1, price: 0.00001 });
    const answer = (url: string) => {
      if (url.includes('/api/v3/account/settings')) return { code: '00000', data: { accountMode: 'unified', holdMode: 'one_way_mode' } };
      if (url.includes('/api/v3/market/tickers')) return { code: '00000', data: [{ category: 'SPOT', symbol: 'DOGEUSDT', lastPrice: '0.1', bid1Price: '0.0999', ask1Price: '0.1001' }] };
      if (url.includes('place-order')) return { code: '00000', data: { orderId: 'bg-2', clientOid: clientIdOf(KEY) } };
      return { code: '00000', data: [] };
    };
    const c = realClient(ccxt.bitget as never, { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' }, [doge], answer);
    const t = new CcxtTrader('bitget', { spot: c.ex, futures: null }, silentLogger);
    const p = await t.normalize(ticket({ symbol: 'DOGE/USDT', amount: 1000 }));
    expect(p).toMatchObject({ errors: [], amount: 1000 });
    expect(p.value).toBeCloseTo(100.1, 6);
    await t.place(p);
    const order = c.sent.find((s) => s.url.includes('place-order'));
    expect(order?.body).toMatchObject({ category: 'SPOT', symbol: 'DOGEUSDT', side: 'buy', orderType: 'market', qty: '100.1' });
    // A sell (and a limit) stays in DOGE.
    await t.place(await t.normalize(ticket({ symbol: 'DOGE/USDT', side: 'sell', amount: 1000, idemKey: KEY.replace('0f', '2f') })));
    expect(c.sent.filter((s) => s.url.includes('place-order'))[1]?.body).toMatchObject({ side: 'sell', qty: '1000' });
  });

  it('Coinbase: a buy stop-limit is triggered on the way up', async () => {
    const m = ccxtMarket({ id: 'BTC-USD', symbol: 'BTC/USD', base: 'BTC', quote: 'USD', amount: 0.00000001, price: 0.01 });
    const c = realClient(ccxt.coinbase as never, { apiKey: 'k1234567', secret: 's1234567' }, [m], (url) =>
      url.includes('/orders') ? { success: true, success_response: { order_id: 'cb-1', product_id: 'BTC-USD', side: 'BUY' } } : { trades: [], best_bid: '59990', best_ask: '60010' },
    );
    const t = new CcxtTrader('coinbase', { spot: c.ex, futures: null }, silentLogger);
    const p = await t.normalize(ticket({ symbol: 'BTC/USD', kind: 'stop_limit', triggerPrice: 61_000, price: 61_100, amount: 0.002 }));
    expect(p.errors).toEqual([]);
    await t.place(p);
    const order = c.sent.find((s) => s.method === 'POST' && s.url.includes('/orders'));
    expect(order?.body).toMatchObject({ product_id: 'BTC-USD', side: 'BUY', order_configuration: { stop_limit_stop_limit_gtc: { base_size: '0.002', limit_price: '61100', stop_price: '61000', stop_direction: 'STOP_DIRECTION_STOP_UP' } } });
  });
});
