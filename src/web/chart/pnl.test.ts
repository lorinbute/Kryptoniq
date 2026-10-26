import { describe, expect, it } from 'vitest';
import type { BalanceRow, OrderRow, PositionRow } from '../../shared/api-types.ts';
import { PNL_COLORS, PNL_COLORS_LIGHT, pnlAtLevel, pnlImpact, pnlLines, pnlText, tradeLinesOf } from './pnl.ts';

const pos = (over: Partial<PositionRow> = {}): PositionRow => ({
  symbol: 'INJ/USDT:USDT', side: 'long', contracts: 5, size: 5, entryPrice: 7.62, markPrice: 7.7, unrealizedPnl: 0.4, percentage: 1, liquidationPrice: 5.1, leverage: 5, marginMode: 'isolated', notional: 38, ...over,
}); // prettier-ignore
const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1', market: 'futures', symbol: 'INJ/USDT:USDT', type: 'market', side: 'sell', price: null, triggerPrice: 7.392, amount: 5, filled: 0, status: 'open', timestamp: 1, reduceOnly: true, stop: 'down', ...over,
}); // prettier-ignore
const bal = (over: Partial<BalanceRow> = {}): BalanceRow => ({
  asset: 'INJ', account: 'trade', total: 10, free: 10, used: 0, price: 7.7, value: 77, avgPrice: 7, avgSource: 'fills', pnl: 7, pnlPct: 10, ...over,
}); // prettier-ignore
const titles = (r: ReturnType<typeof pnlLines>) => r.lines.map((l) => `${l.title} @${l.price}`);

describe('pnlText', () => {
  it('writes the amount and the price move with explicit signs, Romanian style', () => {
    expect(pnlText(31.45, 383.5, 'USDT')).toBe('+31,45 USDT (+8,2%)');
    expect(pnlText(-11.4, 380, 'USDT')).toBe('−11,40 USDT (−3,0%)');
    expect(pnlText(0, 100, 'USDC')).toBe('0,00 USDC (0,0%)');
  });
});

describe('pnlLines', () => {
  it('long futures: SL from a stop that fires downwards, TP from a limit, PnL now at the last price', () => {
    const r = pnlLines({
      base: 'INJ',
      quote: 'USDT',
      lastPrice: 7.727,
      positions: [pos()],
      balances: [],
      orders: [order(), order({ id: 'o2', type: 'limit', price: 8.359, triggerPrice: null, stop: null })],
    });
    expect(titles(r)).toEqual([
      'Intrare LONG 5 INJ @7.62',
      'Lichidare @5.1',
      'SL −1,14 USDT (−3,0%) @7.392',
      'TP +3,69 USDT (+9,7%) @8.359', // 0.739 × 5 = 3.6949… in binary
      'PnL +0,54 USDT (+1,4%) @7.727', // 0.107 × 5 = 0.53500…1
    ]);
    expect(r.lines.find((l) => l.title.startsWith('SL'))?.color).toBe(PNL_COLORS.sl);
    const now = r.lines.at(-1);
    expect(now).toMatchObject({ color: PNL_COLORS.tp, lineVisible: false });
    expect(now?.axisLabelVisible).toBeUndefined();
    expect([...r.usedOrders]).toEqual(['futures:o1', 'futures:o2']);
  });

  it('short futures: a stop that fires upwards is the SL, one that fires downwards is a TP; losses are red', () => {
    const r = pnlLines({
      base: 'INJ',
      quote: 'USDT',
      lastPrice: 7.9,
      positions: [pos({ side: 'short', liquidationPrice: null })],
      balances: [],
      orders: [order({ side: 'buy', triggerPrice: 8.1, stop: 'up' }), order({ id: 'o2', side: 'buy', triggerPrice: 7.0, stop: 'down' }), order({ id: 'o3', side: 'sell', triggerPrice: 7.0 })],
    });
    expect(titles(r)).toEqual(['Intrare SHORT 5 INJ @7.62', 'SL −2,40 USDT (−6,3%) @8.1', 'TP +3,10 USDT (+8,1%) @7', 'PnL −1,40 USDT (−3,7%) @7.9']);
    expect(r.lines.at(-1)?.color).toBe(PNL_COLORS.sl);
    // the sell order does not close a short: it is not part of the trade
    expect(r.usedOrders.has('futures:o3')).toBe(false);
  });

  it('partial take-profit realises only its own quantity; contracts are converted to coins', () => {
    const r = pnlLines({
      base: 'INJ',
      quote: 'USDT',
      lastPrice: 7.7,
      positions: [pos({ contracts: 50, size: 5 })], // 0.1 INJ per contract
      balances: [],
      orders: [order({ type: 'limit', price: 8.62, triggerPrice: null, stop: null, amount: 20 })],
    });
    // 20 contracts = 2 INJ: (8.62 - 7.62) × 2
    expect(r.lines.find((l) => l.title.startsWith('TP'))?.title).toBe('TP +2,00 USDT (+13,1%)');
  });

  it('without a direction from the exchange, the trigger is compared with the current price', () => {
    const r = pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [pos()], balances: [], orders: [order({ stop: null, triggerPrice: 7.3 }), order({ id: 'o2', stop: null, triggerPrice: 8.2 })] });
    expect(r.lines.filter((l) => /^(SL|TP)/.test(l.title)).map((l) => l.title.slice(0, 2))).toEqual(['SL', 'TP']);
  });

  it('spot holding at its average price; spot sell orders are its SL / TP; both trades are tagged', () => {
    const r = pnlLines({
      base: 'INJ',
      quote: 'USDT',
      lastPrice: 7.7,
      positions: [pos()],
      balances: [bal(), bal({ account: 'main', total: 5 })],
      orders: [order({ id: 's1', market: 'spot', symbol: 'INJ/USDT', triggerPrice: 6.5, stop: 'down', amount: null })],
    });
    expect(titles(r)).toContain('Intrare spot 15 INJ @7');
    expect(titles(r)).toContain('SL spot −7,50 USDT (−7,1%) @6.5');
    expect(titles(r)).toContain('PnL spot +10,50 USDT (+10,0%) @7.7');
    expect(titles(r)).toContain('PnL futures +0,40 USDT (+1,0%) @7.7');
  });

  it('shares at a broker: their entry is just shares, their stop and limit sells are SL / TP (FD-SENTIQ)', () => {
    const r = pnlLines({
      base: 'AAPL',
      quote: 'USD',
      lastPrice: 340.97,
      stock: true,
      positions: [],
      balances: [bal({ asset: 'AAPL', total: 3, avgPrice: 320, price: 340.97, value: 1022.91 })],
      orders: [
        order({ id: 'sl', market: 'spot', symbol: 'AAPL/USD', type: 'stop', price: null, triggerPrice: 310, stop: 'down', amount: 3 }),
        order({ id: 'tp', market: 'spot', symbol: 'AAPL/USD', type: 'limit', price: 365, triggerPrice: null, stop: null, amount: 3 }),
      ],
    });
    expect(r.lines.map((l) => l.title)).toEqual(['Intrare 3 AAPL', 'SL −30,00 USD (−3,1%)', 'TP +135,00 USD (+14,1%)', 'PnL +62,91 USD (+6,6%)']);
  });

  it('hedge mode (FD-KUCOINHEDGE): a long and a short on the pair, each with its own orders, told apart by side', () => {
    const r = pnlLines({
      base: 'INJ',
      quote: 'USDT',
      lastPrice: 7.6,
      positions: [pos({ liquidationPrice: null }), pos({ side: 'short', contracts: 3, size: 3, entryPrice: 8, liquidationPrice: null })],
      balances: [],
      orders: [
        order({ positionSide: 'long' }),
        // A sell limit that grows the short is no take-profit of the long.
        order({ id: 'o2', type: 'limit', price: 8.5, triggerPrice: null, stop: null, reduceOnly: false, positionSide: 'short' }),
        order({ id: 'o3', side: 'buy', triggerPrice: 8.4, stop: 'up', amount: 3, positionSide: 'short' }),
      ],
    });
    expect(titles(r)).toEqual([
      'Intrare LONG futures 5 INJ @7.62',
      'SL LONG −1,14 USDT (−3,0%) @7.392',
      'PnL LONG −0,10 USDT (−0,3%) @7.6',
      'Intrare SHORT futures 3 INJ @8',
      'SL SHORT −1,20 USDT (−5,0%) @8.4',
      'PnL SHORT +1,20 USDT (+5,0%) @7.6',
    ]);
    expect([...r.usedOrders]).toEqual(['futures:o1', 'futures:o3']);
  });

  it('names the account when several are shown', () => {
    const r = pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [pos({ liquidationPrice: null })], balances: [], orders: [order()], account: 'Main' });
    expect(r.lines.map((l) => l.title)).toEqual(['Intrare LONG 5 INJ (Main)', 'SL (Main) −1,14 USDT (−3,0%)', 'PnL (Main) +0,40 USDT (+1,0%)']);
  });

  it('ignores spot dust (worth under 1 USDT)', () => {
    expect(pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [], balances: [bal({ total: 0.1 })], orders: [] }).lines).toEqual([]);
    expect(pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [], balances: [bal({ total: 0.2 })], orders: [] }).lines).toHaveLength(2);
  });

  it('no PnL without an average price or a trade on this coin', () => {
    expect(pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [], balances: [bal({ avgPrice: null })], orders: [order({ market: 'spot', symbol: 'INJ/USDT' })] }).lines).toEqual([]);
    expect(pnlLines({ base: 'BTC', quote: 'USDT', lastPrice: 80000, positions: [pos()], balances: [bal()], orders: [order()] }).lines).toEqual([]);
  });

  it('draws in the light palette when asked (FD-THEME §1)', () => {
    const input = { base: 'INJ', quote: 'USDT', lastPrice: 7.727, positions: [pos()], balances: [], orders: [order(), order({ id: 'o2', type: 'limit', price: 8.359, triggerPrice: null, stop: null })] };
    const r = pnlLines(input, PNL_COLORS_LIGHT);
    expect(r.lines.map((l) => l.color)).toEqual([PNL_COLORS_LIGHT.entry, PNL_COLORS_LIGHT.liquidation, PNL_COLORS_LIGHT.sl, PNL_COLORS_LIGHT.tp, PNL_COLORS_LIGHT.tp]);
    expect(pnlLines(input).lines.map((l) => l.color)).toEqual([PNL_COLORS.entry, PNL_COLORS.liquidation, PNL_COLORS.sl, PNL_COLORS.tp, PNL_COLORS.tp]);
  });
});

describe('the trade lines with what moving them changes (FD-ORDEREDIT)', () => {
  it('each line has its id, role, group and order; the SL / TP carry their PnL basis and their position', () => {
    const r = tradeLinesOf({ base: 'INJ', quote: 'USDT', lastPrice: 7.727, positions: [pos()], balances: [], orders: [order(), order({ id: 'o2', type: 'limit', price: 8.359, triggerPrice: null, stop: null })], accountId: 7 });
    expect(r.lines.map((l) => [l.role, l.id])).toEqual([
      ['entry', '7|trade|INJ/USDT:USDT|LONG||entry'],
      ['liquidation', '7|trade|INJ/USDT:USDT|LONG||liq'],
      ['sl', '7|sl|futures:o1|trigger'],
      ['tp', '7|tp|futures:o2|price'],
      ['pnl', '7|trade|INJ/USDT:USDT|LONG||pnl'],
    ]);
    const sl = r.lines.find((l) => l.role === 'sl');
    expect(sl).toMatchObject({ group: '7|trade|INJ/USDT:USDT|LONG|', leg: 'trigger', order: { id: 'o1' }, basis: { long: true, entry: 7.62, qty: 5, quote: 'USDT' }, position: { side: 'long', symbol: 'INJ/USDT:USDT', market: 'futures' } });
    // The same lines the chart drew before (FD-PNL).
    expect(pnlLines({ base: 'INJ', quote: 'USDT', lastPrice: 7.727, positions: [pos()], balances: [], orders: [order()] }).lines.map((l) => l.title)).toEqual(r.lines.filter((l) => l.role !== 'tp').map((l) => l.title));
  });

  it("OKX's oco (TP and SL in one order, no trigger of its own): two lines of the same order", () => {
    const oco = order({ id: 'a1', triggerPrice: null, stop: null, stopLoss: 7.3, takeProfit: 8.2 });
    const r = tradeLinesOf({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [pos()], balances: [], orders: [oco] });
    expect(r.lines.filter((l) => l.order).map((l) => [l.role, l.leg, l.price, l.title])).toEqual([
      ['sl', 'sl', 7.3, 'SL −1,60 USDT (−4,2%)'],
      ['tp', 'tp', 8.2, 'TP +2,90 USDT (+7,6%)'],
    ]);
    expect([...r.usedOrders]).toEqual(['futures:a1']);
  });

  it('a pending entry order: its own line and its attached TP / SL, priced from its entry and contracts', () => {
    const entry = order({ id: 'e1', side: 'buy', type: 'limit', price: 7.5, triggerPrice: null, stop: null, reduceOnly: false, amount: 100, contractSize: 0.1, takeProfit: 8, stopLoss: 7.2 });
    const r = tradeLinesOf({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [], balances: [], orders: [entry], accountId: 3 });
    expect(r.lines.map((l) => [l.role, l.id, l.price, l.title])).toEqual([
      ['order', '3|order|futures:e1|line', 7.5, 'buy limit'],
      ['order-sl', '3|order|futures:e1|sl', 7.2, 'SL ordin −3,00 USDT (−4,0%)'],
      ['order-tp', '3|order|futures:e1|tp', 8, 'TP ordin +5,00 USDT (+6,7%)'],
    ]);
    expect(new Set(r.lines.map((l) => l.group))).toEqual(new Set(['3|order|futures:e1']));
  });

  it("a perpetual's stop listed with the spot orders (KuCoin's unified account) is still the position's stop loss", () => {
    const r = tradeLinesOf({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions: [pos()], balances: [], orders: [order({ market: 'spot' })], accountId: 7 });
    expect(r.lines.filter((l) => l.role === 'sl').map((l) => [l.order?.id, l.price])).toEqual([['o1', 7.392]]);
  });

  it('the PnL at a level and what moving it changes', () => {
    const b = { long: true, entry: 100, qty: 2, quote: 'USDT' };
    expect(pnlAtLevel(b, 95)).toMatchObject({ pnl: -10, text: '−10,00 USDT (−5,0%)' });
    expect(pnlAtLevel({ ...b, long: false }, 95).pnl).toBe(10);
    expect(pnlImpact(b, 95, 97)).toBe('−6,00 USDT (−3,0%) · înainte −10,00 USDT (−5,0%) · +4,00 USDT');
    expect(pnlImpact(b, null, 97)).toBe('−6,00 USDT (−3,0%)');
    expect(pnlImpact(b, 95, null)).toBe('fără nivel (era −10,00 USDT (−5,0%))');
    expect(pnlImpact(b, 95, 95)).toBe('−10,00 USDT (−5,0%)');
  });
});
