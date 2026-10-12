import { describe, expect, it } from 'vitest';
import type { BalanceRow, OrderRow, PositionRow } from '../../shared/api-types.ts';
import { PNL_COLORS, pnlLines, pnlText } from './pnl.ts';

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
});
