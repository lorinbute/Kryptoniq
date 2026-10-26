// FD-ORDEREDIT, TD-ORDEREDIT: changing open orders and a position's stop loss / take profit on the crypto exchanges, on
// simulated clients that record what Sentiq asked: in place where the exchange can (Bybit, OKX, Binance's limit
// orders), else a replacement in the safe order (a stop loss: the new one first; an entry: the old one cancelled first).
import { describe, expect, it } from 'vitest';
import ccxt, { type Exchange } from 'ccxt';
import { silentLogger } from '../../log.ts';
import type { ModifyTicket } from '../../../shared/trading.ts';
import { CcxtTrader } from './crypto.ts';

const KEY = '0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const PERP = 'BTC/USDT:USDT';
const SPOT = 'BTC/USDT';

const market = (symbol: string) => {
  const swap = symbol.includes(':');
  return {
    id: symbol.replace(/[/:]/g, ''),
    symbol,
    base: 'BTC',
    quote: 'USDT',
    settle: swap ? 'USDT' : undefined,
    type: swap ? 'swap' : 'spot',
    spot: !swap,
    swap,
    contract: swap,
    linear: swap ? true : undefined,
    active: true,
    contractSize: swap ? 0.001 : undefined,
    precision: { amount: swap ? 1 : 0.0001, price: 0.1 },
    limits: { amount: { min: swap ? 1 : 0.0001 }, cost: {}, leverage: { max: 100 } },
    info: {},
  };
};

interface Opts {
  last?: number;
  orders?: object[];
  positions?: object[];
  hedged?: boolean;
  failCreate?: Error;
  failCancel?: Error;
  /** The stop orders' listing fails (a timeout). */
  failTrigger?: boolean;
  uta?: boolean;
}

/** A ccxt-like client with open orders and positions; every request recorded. */
function client(id: string, o: Opts = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const markets = { [PERP]: market(PERP), [SPOT]: market(SPOT) };
  const ex = {
    id,
    markets: undefined as unknown,
    options: {},
    has: { fetchPositionMode: true },
    async loadMarkets() {
      ex.markets = markets;
      return markets;
    },
    amountToPrecision: (_s: string, v: number) => String(Math.floor(v + 1e-9)),
    priceToPrecision: (_s: string, v: number) => (Math.round(v * 10) / 10).toFixed(1),
    async fetchTicker() {
      return { last: o.last ?? 60000 };
    },
    async fetchOpenOrders(...args: unknown[]) {
      calls.push({ fn: 'fetchOpenOrders', args });
      const params = (args[3] ?? {}) as Record<string, unknown>;
      if (o.failTrigger && params.trigger) throw new ccxt.RequestTimeout('timed out');
      // Each listing gives its own kind: plain orders, stops (trigger), OKX's TP / SL (ordType).
      return (o.orders ?? []).filter((x) => {
        const r = x as { triggerPrice?: number | null; info?: { algoId?: string; ordType?: string } };
        if (params.ordType) return r.info?.ordType === 'conditional' || r.info?.ordType === 'oco';
        if (params.trigger) return r.triggerPrice != null && !(r.info?.ordType === 'conditional' || r.info?.ordType === 'oco');
        return r.triggerPrice == null && !(r.info?.ordType === 'conditional' || r.info?.ordType === 'oco') || id === 'bybit';
      });
    },
    async fetchPositions() {
      return o.positions ?? [];
    },
    async fetchPositionMode() {
      return { hedged: o.hedged ?? false };
    },
    // Bybit tells the mode per pair from its position list (positionIdx 0: one-way; 1 / 2: hedge).
    async privateGetV5PositionList() {
      return { result: { list: o.hedged ? [{ positionIdx: 1 }, { positionIdx: 2 }] : [{ positionIdx: 0 }] } };
    },
    async setLeverage(...args: unknown[]) {
      calls.push({ fn: 'setLeverage', args });
    },
    async setMarginMode(...args: unknown[]) {
      calls.push({ fn: 'setMarginMode', args });
    },
    async createOrder(...args: unknown[]) {
      calls.push({ fn: 'createOrder', args });
      if (o.failCreate) throw o.failCreate;
      return { id: 'new1', status: 'open' };
    },
    async cancelOrder(...args: unknown[]) {
      calls.push({ fn: 'cancelOrder', args });
      if (o.failCancel) throw o.failCancel;
    },
    async editOrder(...args: unknown[]) {
      calls.push({ fn: 'editOrder', args });
      return { id: args[0] };
    },
    async privatePostV5PositionTradingStop(p: unknown) {
      calls.push({ fn: 'tradingStop', args: [p] });
    },
    async privatePostTradeAmendAlgos(p: unknown) {
      calls.push({ fn: 'amendAlgos', args: [p] });
    },
    async privatePostTradeAmendOrder(p: unknown) {
      calls.push({ fn: 'amendOrder', args: [p] });
    },
    async isUTAEnabled() {
      return o.uta ?? false;
    },
  };
  return { ex: ex as unknown as Exchange, calls };
}

const trader = (exchange: string, o: Opts = {}) => {
  const c = client(exchange, o);
  // KuCoin's classic account keeps futures on their own client; the others trade both on one.
  const t = new CcxtTrader(exchange, { spot: c.ex, futures: exchange === 'kucoin' ? c.ex : null }, silentLogger);
  return { t, calls: c.calls };
};
const sent = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => !['fetchOpenOrders', 'setLeverage', 'setMarginMode'].includes(c.fn)).map((c) => [c.fn, ...c.args]);
const ticket = (changes: ModifyTicket['changes'], extra: Partial<ModifyTicket> = {}): ModifyTicket => ({ accountId: 1, idemKey: KEY, market: 'futures', symbol: PERP, position: { side: 'long' }, changes, ...extra });
const longPos = { symbol: PERP, side: 'long', contracts: 10, entryPrice: 59000, marginMode: 'isolated', info: {} };
const slOrder = { id: 'sl1', symbol: PERP, type: 'market', side: 'sell', price: null, triggerPrice: 57000, amount: 10, reduceOnly: true, info: { stop: 'down' } };

describe('a position stop loss on KuCoin futures: a replacement, the new one first (FD-ORDEREDIT)', () => {
  it('moves the stop loss: the new order (reduce-only, the position margin) first, then the old one cancelled', async () => {
    const { t, calls } = trader('kucoin', { orders: [slOrder], positions: [longPos] });
    const plan = await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 58000.04 }]));
    expect(plan.preview.errors).toEqual([]);
    expect(plan.preview.steps).toMatchObject([{ how: 'place-then-cancel', orderId: 'sl1', before: { triggerPrice: 57000 }, after: { triggerPrice: 58000 }, removes: false }]);
    const r = await t.modify(plan);
    expect(r.status).toBe('done');
    expect(sent(calls)).toEqual([
      ['createOrder', PERP, 'market', 'sell', 10, undefined, { stopLossPrice: 58000, reduceOnly: true, marginMode: 'isolated' }],
      ['cancelOrder', 'sl1', PERP, { trigger: true }],
    ]);
    expect(r.steps.map((s) => [s.what, s.ok])).toEqual([
      ['ordin nou plasat', true],
      ['ordin vechi anulat', true],
    ]);
    // FIX-SLTPDUP: the step says which order left the platform (hidden at once, even while KuCoin still lists it).
    expect(r.steps.map((s) => s.cancelled)).toEqual([undefined, 'sl1']);
  });

  it('a stop loss over the price now (a long) is refused before anything goes out; an unchanged level sends nothing', async () => {
    const { t, calls } = trader('kucoin', { orders: [slOrder], positions: [longPos] });
    const plan = await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 61000 }]));
    expect(plan.preview.errors.join(' ')).toMatch(/sub prețul de acum.*imediat/);
    expect((await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 57000 }]))).preview.errors).toEqual(['Nimic nu se schimbă: valorile sunt cele de acum.']);
    expect(sent(calls)).toEqual([]);
  });

  it('the old one not cancelled: both stay, and the message says so', async () => {
    const { t } = trader('kucoin', { orders: [slOrder], positions: [longPos], failCancel: new Error('busy') });
    const r = await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 58000 }])));
    expect(r.status).toBe('partial');
    expect(r.steps[1]).toMatchObject({ ok: false, message: expect.stringMatching(/acum sunt amândouă/) });
    // Not cancelled: still shown.
    expect(r.steps[1]?.cancelled).toBeUndefined();
  });

  it('adds a missing take profit for the position size; removes a stop loss by cancelling it', async () => {
    const { t, calls } = trader('kucoin', { orders: [slOrder], positions: [longPos] });
    const r = await t.modify(await t.normalizeModify(ticket([{ what: 'tp', orderId: null, level: 65000 }, { what: 'sl', orderId: 'sl1', level: null }])));
    expect(r.status).toBe('done');
    expect(sent(calls)).toEqual([
      ['createOrder', PERP, 'market', 'sell', 10, undefined, { takeProfitPrice: 65000, reduceOnly: true, marginMode: 'isolated' }],
      ['cancelOrder', 'sl1', PERP, { trigger: true }],
    ]);
  });

  it('a position no longer open, or an order no longer there, is told before anything goes out', async () => {
    const { t } = trader('kucoin', { orders: [], positions: [] });
    const p = await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 58000 }]));
    expect(p.preview.errors).toEqual(expect.arrayContaining(['Poziția nu mai e deschisă.', expect.stringMatching(/nu mai e deschis/)]));
  });
});

describe('an entry order replaced: the old one cancelled first (FD-ORDEREDIT)', () => {
  const entry = { id: 'e1', symbol: PERP, type: 'limit', side: 'buy', price: 58000, triggerPrice: null, amount: 5, reduceOnly: false, info: { leverage: '5', marginMode: 'ISOLATED' } };

  it('KuCoin: cancels, then places the copy with its leverage, margin and the TP / SL written in the form', async () => {
    const { t, calls } = trader('kucoin', { orders: [entry] });
    const plan = await t.normalizeModify(ticket([{ what: 'order', orderId: 'e1', trigger: false, price: 57500, stopLoss: 56000 }], { position: undefined }));
    expect(plan.preview.steps[0]).toMatchObject({ how: 'cancel-then-place', after: { price: 57500, stopLoss: 56000 } });
    expect(plan.preview.warnings.join(' ')).toMatch(/o clipă, ordinul nu există/);
    await t.modify(plan);
    expect(sent(calls)).toEqual([
      ['cancelOrder', 'e1', PERP, {}],
      ['createOrder', PERP, 'limit', 'buy', 5, 57500, { marginMode: 'isolated', leverage: 5, stopLoss: { triggerPrice: 56000 } }],
    ]);
  });

  it('a stop loss of an entry over its price is refused; a leverage that cannot be read stops it before the cancel', async () => {
    const { t } = trader('kucoin', { orders: [entry, { ...entry, id: 'e2', info: {} }] });
    expect((await t.normalizeModify(ticket([{ what: 'order', orderId: 'e1', trigger: false, stopLoss: 59000 }], { position: undefined }))).preview.errors.join(' ')).toMatch(/Stop loss-ul trebuie să fie sub/);
    expect((await t.normalizeModify(ticket([{ what: 'order', orderId: 'e2', trigger: false, price: 57000 }], { position: undefined }))).preview.errors.join(' ')).toMatch(/Levierul ordinului nu se poate citi/);
  });

  it('the new one refused after the old one was cancelled: the message says the old one is gone', async () => {
    // A refusal (a ccxt error): the outcome is known, unlike a failure that may have reached the exchange.
    const { t } = trader('kucoin', { orders: [entry], failCreate: new ccxt.InsufficientFunds('balance') });
    const r = await t.modify(await t.normalizeModify(ticket([{ what: 'order', orderId: 'e1', trigger: false, price: 57500 }], { position: undefined })));
    expect(r.status).toBe('partial');
    expect(r.steps[1]).toMatchObject({ ok: false, message: expect.stringMatching(/Ordinul vechi a fost anulat, dar cel nou a fost refuzat/) });
  });

  it('Binance: a limit order in place (amount and price both sent); a futures stop loss replaced, the new one first', async () => {
    const stop = { ...slOrder, id: 's9' };
    const { t, calls } = trader('binance', { orders: [entry, stop], positions: [longPos] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'order', orderId: 'e1', trigger: false, price: 57500 }], { position: undefined })));
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 's9', level: 58000 }])));
    expect(sent(calls)).toEqual([
      ['editOrder', 'e1', PERP, 'limit', 'buy', 5, 57500, {}],
      ['createOrder', PERP, 'market', 'sell', 10, undefined, { stopLossPrice: 58000, reduceOnly: true }],
      ['cancelOrder', 's9', PERP, { trigger: true }],
    ]);
  });
});

describe('Bybit: the whole position TP / SL through trading-stop, other orders amended (FD-ORDEREDIT)', () => {
  const bybitSl = { ...slOrder, id: 'b1', info: { stopOrderType: 'StopLoss' } };
  const conditional = { ...slOrder, id: 'b2', triggerPrice: 56000, info: { stopOrderType: 'Stop' } };

  it('moves and removes the position stop loss (0), in the position slot (hedge: 1 for a long)', async () => {
    const { t, calls } = trader('bybit', { orders: [bybitSl], positions: [longPos] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'b1', level: 58000 }])));
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'b1', level: null }])));
    const hedged = trader('bybit', { orders: [bybitSl], positions: [longPos], hedged: true });
    await hedged.t.modify(await hedged.t.normalizeModify(ticket([{ what: 'tp', orderId: null, level: 65000 }])));
    expect(sent(calls)).toEqual([
      ['tradingStop', { category: 'linear', symbol: 'BTCUSDTUSDT', tpslMode: 'Full', positionIdx: 0, stopLoss: '58000.0' }],
      ['tradingStop', { category: 'linear', symbol: 'BTCUSDTUSDT', tpslMode: 'Full', positionIdx: 0, stopLoss: '0' }],
    ]);
    expect(sent(hedged.calls)).toEqual([['tradingStop', { category: 'linear', symbol: 'BTCUSDTUSDT', tpslMode: 'Full', positionIdx: 1, takeProfit: '65000.0' }]]);
  });

  it('a conditional reduce-only stop: amended with its new trigger', async () => {
    const { t, calls } = trader('bybit', { orders: [conditional], positions: [longPos] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'b2', level: 57000 }])));
    expect(sent(calls)).toEqual([['editOrder', 'b2', PERP, 'market', 'sell', undefined, undefined, { triggerPrice: '57000.0' }]]);
  });
});

describe('OKX: TP / SL algo orders amended, one leg of an oco at a time (FD-ORDEREDIT)', () => {
  const oco = { id: 'a1', symbol: PERP, type: 'market', side: 'sell', price: null, triggerPrice: null, stopLossPrice: 57000, takeProfitPrice: 65000, amount: 10, reduceOnly: true, info: { algoId: 'a1', ordType: 'oco' } };
  const single = { ...oco, id: 'a2', takeProfitPrice: undefined, info: { algoId: 'a2', ordType: 'conditional' } };
  const limit = { id: 'l1', symbol: PERP, type: 'limit', side: 'buy', price: 58000, triggerPrice: null, takeProfitPrice: 62000, amount: 5, reduceOnly: false, info: { leverage: '5', attachAlgoOrds: [{ attachAlgoId: 'att1' }] } };

  it('reads the TP / SL algo listing; moves the stop loss of an oco, removes one leg with 0, cancels a lone conditional', async () => {
    const { t, calls } = trader('okx', { orders: [oco, single], positions: [longPos] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'a1', level: 58000 }])));
    await t.modify(await t.normalizeModify(ticket([{ what: 'tp', orderId: 'a1', level: null }])));
    await t.modify(await t.normalizeModify(ticket([{ what: 'sl', orderId: 'a2', level: null }])));
    expect(calls.filter((c) => c.fn === 'fetchOpenOrders').some((c) => JSON.stringify(c.args[3]) === JSON.stringify({ method: 'privateGetTradeOrdersAlgoPending', ordType: 'conditional,oco' }))).toBe(true);
    expect(sent(calls)).toEqual([
      ['amendAlgos', { instId: 'BTCUSDTUSDT', algoId: 'a1', newSlTriggerPx: '58000.0', newSlOrdPx: '-1' }],
      ['amendAlgos', { instId: 'BTCUSDTUSDT', algoId: 'a1', newTpTriggerPx: '0', newTpOrdPx: '0' }],
      ['cancelOrder', 'a2', PERP, { trigger: true }],
    ]);
  });

  it('a pending order: its price and its attached take profit amended (attachAlgoOrds with the attached id)', async () => {
    const { t, calls } = trader('okx', { orders: [limit] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'order', orderId: 'l1', trigger: false, price: 57500, takeProfit: 63000 }], { position: undefined })));
    expect(sent(calls)).toEqual([['amendOrder', { instId: 'BTCUSDTUSDT', ordId: 'l1', newPx: '57500.0', attachAlgoOrds: [{ attachAlgoId: 'att1', newTpTriggerPx: '63000.0', newTpOrdPx: '-1' }] }]]);
  });
});

describe('spot protection orders and a holding: copies of themselves, the old one cancelled first (FD-ORDEREDIT)', () => {
  it('KuCoin spot: a stop sell moved: cancelled (as a stop) then placed again with its direction', async () => {
    const stopSell = { id: 'ss1', symbol: SPOT, type: 'market', side: 'sell', price: null, triggerPrice: 55000, amount: 0.05, reduceOnly: false, info: { stop: 'loss' } };
    const { t, calls } = trader('kucoin', { orders: [stopSell] });
    const plan = await t.normalizeModify(ticket([{ what: 'sl', orderId: 'ss1', level: 56000 }], { market: 'spot', symbol: SPOT }));
    expect(plan.preview.steps[0]).toMatchObject({ how: 'cancel-then-place' });
    await t.modify(plan);
    expect(sent(calls)).toEqual([
      ['cancelOrder', 'ss1', SPOT, { trigger: true, stop: true }],
      ['createOrder', SPOT, 'market', 'sell', 0.05, undefined, { triggerPrice: 56000, stop: 'loss' }],
    ]);
  });
});

describe('a replaced trigger fires the way the old one did (FD-ORDEREDIT)', () => {
  // A long's take profit as a trigger order: a sell that fires on a rise (KuCoin's "up").
  const tpTrigger = { id: 'tp1', symbol: PERP, type: 'market', side: 'sell', price: null, triggerPrice: 65000, amount: 10, reduceOnly: true, info: { stop: 'up' } };

  it("KuCoin: a long's take profit changed from its order form goes out as a take profit, in its position's margin mode", async () => {
    const { t, calls } = trader('kucoin', { orders: [tpTrigger], positions: [longPos] });
    const plan = await t.normalizeModify(ticket([{ what: 'order', orderId: 'tp1', trigger: true, triggerPrice: 66000 }], { position: undefined }));
    expect(plan.preview.errors).toEqual([]);
    await t.modify(plan);
    // As a plain trigger, KuCoin would make a sell fire on a fall, at once (the price is under 66000).
    expect(sent(calls)).toEqual([
      ['createOrder', PERP, 'market', 'sell', 10, undefined, { reduceOnly: true, marginMode: 'isolated', takeProfitPrice: 66000 }],
      ['cancelOrder', 'tp1', PERP, { trigger: true }],
    ]);
  });

  it('a trigger moved across the price now is refused (it would fire at once), amended or replaced', async () => {
    const k = trader('kucoin', { orders: [tpTrigger], positions: [longPos] });
    expect((await k.t.normalizeModify(ticket([{ what: 'order', orderId: 'tp1', trigger: true, triggerPrice: 59000 }], { position: undefined }))).preview.errors.join(' ')).toMatch(/sub prețul de acum.*la urcare: s-ar executa imediat/);
    const b = trader('bybit', { orders: [{ ...slOrder, id: 'b3', info: { stopOrderType: 'Stop' } }], positions: [longPos] });
    expect((await b.t.normalizeModify(ticket([{ what: 'order', orderId: 'b3', trigger: true, triggerPrice: 61000 }], { position: undefined }))).preview.errors.join(' ')).toMatch(/peste prețul de acum.*la coborâre/);
    expect(sent(k.calls).concat(sent(b.calls))).toEqual([]);
  });

  it('a futures buy stop that fires on a fall cannot keep its way as a new order: refused before the cancel', async () => {
    const dip = { id: 'd1', symbol: PERP, type: 'market', side: 'buy', price: null, triggerPrice: 55000, amount: 5, reduceOnly: false, info: { stop: 'down', leverage: '5' } };
    const { t, calls } = trader('kucoin', { orders: [dip] });
    expect((await t.normalizeModify(ticket([{ what: 'order', orderId: 'd1', trigger: true, triggerPrice: 54000 }], { position: undefined }))).preview.errors.join(' ')).toMatch(/aceeași direcție/);
    expect(sent(calls)).toEqual([]);
  });

  it("a position's limit take profit stays a reduce-only limit when replaced", async () => {
    const limitTp = { id: 'lt1', symbol: PERP, type: 'limit', side: 'sell', price: 65000, triggerPrice: null, amount: 10, reduceOnly: true, info: {} };
    const { t, calls } = trader('kucoin', { orders: [limitTp], positions: [longPos] });
    await t.modify(await t.normalizeModify(ticket([{ what: 'tp', orderId: 'lt1', level: 66000 }])));
    expect(sent(calls)).toEqual([
      ['createOrder', PERP, 'limit', 'sell', 10, 66000, { reduceOnly: true, marginMode: 'isolated' }],
      ['cancelOrder', 'lt1', PERP, {}],
    ]);
  });

  it("an order that is not the position's stop loss (it fires on a rise, or opens instead of closing) is left alone", async () => {
    const opening = { ...slOrder, id: 'o9', side: 'buy', reduceOnly: false, info: { stop: 'up', leverage: '5' } };
    const { t, calls } = trader('kucoin', { orders: [tpTrigger, opening], positions: [longPos] });
    expect((await t.normalizeModify(ticket([{ what: 'sl', orderId: 'tp1', level: 58000 }]))).preview.errors.join(' ')).toMatch(/nu e stop loss-ul poziției/);
    expect((await t.normalizeModify(ticket([{ what: 'sl', orderId: 'o9', level: 58000 }]))).preview.errors).toEqual(['Ordinul nu închide această poziție.']);
    expect(sent(calls)).toEqual([]);
  });

  it('spot: KuCoin keeps a take profit stop rising (entry); Bitget cannot name the way, so it is refused', async () => {
    const tpSpot = { id: 'st1', symbol: SPOT, type: 'market', side: 'sell', price: null, triggerPrice: 65000, amount: 0.05, reduceOnly: false, info: { stop: 'entry' } };
    const k = trader('kucoin', { orders: [tpSpot] });
    await k.t.modify(await k.t.normalizeModify(ticket([{ what: 'tp', orderId: 'st1', level: 66000 }], { market: 'spot', symbol: SPOT })));
    expect(sent(k.calls)).toEqual([
      ['cancelOrder', 'st1', SPOT, { trigger: true, stop: true }],
      ['createOrder', SPOT, 'market', 'sell', 0.05, undefined, { triggerPrice: 66000, stop: 'entry' }],
    ]);
    const g = trader('bitget', { orders: [{ ...tpSpot, info: {} }] });
    expect((await g.t.normalizeModify(ticket([{ what: 'tp', orderId: 'st1', level: 66000 }], { market: 'spot', symbol: SPOT }))).preview.errors.join(' ')).toMatch(/aceeași direcție/);
  });

  it('a listing that could not be read: an order not found is not said to be gone', async () => {
    const { t } = trader('kucoin', { orders: [slOrder], positions: [longPos], failTrigger: true });
    expect((await t.normalizeModify(ticket([{ what: 'sl', orderId: 'sl1', level: 58000 }]))).preview.errors.join(' ')).toMatch(/nu s-a găsit, iar o parte din ordine nu s-a putut citi/);
  });
});

describe('a futures position turned the other way (FD-REVERSE)', () => {
  const reverseTicket = (side: 'long' | 'short' = 'long') => ({ accountId: 1, idemKey: KEY, symbol: PERP, side });
  const long = { ...longPos, contractSize: 0.001, leverage: 5 };

  it('closes it (reduce-only), opens the opposite one with its leverage and margin, then cancels its stop loss', async () => {
    const { t, calls } = trader('kucoin', { orders: [slOrder], positions: [long] });
    const plan = await t.normalizeReverse(reverseTicket());
    expect(plan.preview).toMatchObject({ from: { side: 'long', amount: 0.01 }, to: { side: 'short', amount: 0.01 }, leverage: 5, marginMode: 'isolated', cancels: 1, hedged: false, errors: [] });
    expect(plan.preview.warnings.join(' ')).toMatch(/întâi se închide poziția, apoi se deschide cea opusă/);
    const r = await t.reverse(plan);
    expect(r.status).toBe('done');
    const sentNow = sent(calls);
    expect(sentNow.map((c) => c[0])).toEqual(['createOrder', 'createOrder', 'cancelOrder']);
    // The close: reduce-only, sized as the position; the opposite: not reduce-only, the position's leverage; each its own client id.
    // (A market order carries the price now, as every market order Sentiq places: ccxt turns the amount into a quote sum with it where an exchange wants one.)
    expect(sentNow[0]).toMatchObject(['createOrder', PERP, 'market', 'sell', 10, 60000, { reduceOnly: true, marginMode: 'isolated' }]);
    expect(sentNow[1]).toMatchObject(['createOrder', PERP, 'market', 'sell', 10, 60000, { marginMode: 'isolated', leverage: 5 }]);
    expect((sentNow[1]?.[6] as Record<string, unknown>).reduceOnly).toBeUndefined();
    expect((sentNow[0]?.[6] as Record<string, unknown>).clientOid ?? (sentNow[0]?.[6] as Record<string, unknown>).clientOrderId).not.toBe((sentNow[1]?.[6] as Record<string, unknown>).clientOid ?? (sentNow[1]?.[6] as Record<string, unknown>).clientOrderId);
    expect(sentNow[2]).toEqual(['cancelOrder', 'sl1', PERP, { trigger: true }]);
  });

  it('the opposite one refused: the position stays closed, and the message says so', async () => {
    const { t } = trader('kucoin', { orders: [], positions: [long] });
    const plan = await t.normalizeReverse(reverseTicket());
    // The second order refused, the first went through.
    let n = 0;
    const ex = (t as unknown as { clients: { futures: { createOrder: (...a: unknown[]) => Promise<unknown> } } }).clients.futures;
    const real = ex.createOrder.bind(ex);
    ex.createOrder = async (...a: unknown[]) => {
      if (++n === 2) throw new ccxt.InsufficientFunds('margin');
      return real(...a);
    };
    const r = await t.reverse(plan);
    expect(r.status).toBe('partial');
    expect(r.steps[1]).toMatchObject({ ok: false, message: expect.stringMatching(/Poziția a fost închisă, dar cea opusă n-a putut fi deschisă/) });
  });

  it('hedge mode: the long closed and a short opened beside the short already there; only the long\'s stop loss cancelled', async () => {
    const hl = { ...long, info: { positionSide: 'LONG' } };
    const hs = { ...long, side: 'short', contracts: 4, info: { positionSide: 'SHORT' } };
    const slLong = { ...slOrder, info: { stop: 'down', positionSide: 'LONG' } };
    const slShort = { ...slOrder, id: 'sl2', side: 'buy', triggerPrice: 63000, info: { stop: 'up', positionSide: 'SHORT' } };
    const { t, calls } = trader('kucoin', { orders: [slLong, slShort], positions: [hl, hs], hedged: true });
    const plan = await t.normalizeReverse(reverseTicket());
    expect(plan.preview).toMatchObject({ hedged: true, cancels: 1, from: { amount: 0.01 } });
    expect(plan.preview.warnings.join(' ')).not.toMatch(/rămâne deschis/);
    await t.reverse(plan);
    const sentNow = sent(calls);
    const opts = (c: unknown[]) => c[c.length - 1] as Record<string, unknown>;
    expect(sentNow.slice(0, 2).map((c) => [c[0], c[3], opts(c).hedged ?? null, opts(c).reduceOnly ?? null])).toEqual([
      ['createOrder', 'sell', true, true],
      ['createOrder', 'sell', true, null],
    ]);
    expect(sentNow.slice(2)).toEqual([['cancelOrder', 'sl1', PERP, { trigger: true }]]);
  });

  it('no position: refused before anything goes out', async () => {
    const { t, calls } = trader('kucoin', { orders: [], positions: [] });
    const plan = await t.normalizeReverse(reverseTicket('short'));
    expect(plan.preview.errors).toContain('Poziția nu mai e deschisă.');
    expect(sent(calls)).toEqual([]);
  });
});
