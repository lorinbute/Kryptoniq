// FD-ORDEREDIT: what "SL / TP" and "Modifică" open from the Trades page, and the PnL each planned change shows.
import { describe, expect, it } from 'vitest';
import type { AccountView, BalanceRow, OrderRow, PositionRow } from '../../shared/api-types.ts';
import type { ModifyStepPlan, ModifyValues } from '../../shared/trading.ts';
import { holdingSeed, orderSeed, positionSeed, stepImpact } from './modify-seeds.ts';

const account = (over: Partial<AccountView> = {}): AccountView => ({
  id: 7, exchange: 'kucoin', kind: 'crypto', env: 'live', label: 'Main', keyHint: '…', createdAt: 0, lastOkAt: null, lastError: null, permissions: null, permissionWarning: false, fundsRisk: false,
  trading: { supported: true, enabled: true, markets: ['spot', 'futures'], reason: null }, ...over,
}); // prettier-ignore
const pos = (over: Partial<PositionRow> = {}): PositionRow => ({
  symbol: 'INJ/USDT:USDT', side: 'long', contracts: 5, size: 5, entryPrice: 7.62, markPrice: 7.7, unrealizedPnl: 0.4, percentage: 1, liquidationPrice: 5.1, leverage: 5, marginMode: 'isolated', notional: 38, ...over,
}); // prettier-ignore
const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1', market: 'futures', symbol: 'INJ/USDT:USDT', type: 'market', side: 'sell', price: null, triggerPrice: 7.392, amount: 5, filled: 0, status: 'open', timestamp: 1, reduceOnly: true, stop: 'down', ...over,
}); // prettier-ignore
const bal = (over: Partial<BalanceRow> = {}): BalanceRow => ({
  asset: 'AAPL', account: 'etoro', total: 2, free: 2, used: 0, price: 210, value: 420, avgPrice: 200, avgSource: 'broker', pnl: 20, pnlPct: 5, ...over,
}); // prettier-ignore
const vals = (over: Partial<ModifyValues> = {}): ModifyValues => ({ price: null, triggerPrice: null, amount: null, stopLoss: null, takeProfit: null, ...over });
const step = (over: Partial<ModifyStepPlan>): ModifyStepPlan => ({ change: 0, how: 'amend', orderId: 'o1', side: 'sell', kind: 'sl', before: vals(), after: vals(), removes: false, ...over });

describe('positionSeed', () => {
  it("a futures position: its SL / TP orders with what each closes, and a TP to add", () => {
    const tp = order({ id: 'o2', type: 'limit', price: 8.36, triggerPrice: null, stop: null, amount: 2 });
    const seed = positionSeed(account(), { orders: [order(), tp, order({ id: 'x', symbol: 'BTC/USDT:USDT' })] }, pos());
    expect(seed).toMatchObject({ kind: 'protection', market: 'futures', symbol: 'INJ/USDT:USDT', position: { side: 'long' }, add: true, title: 'SL / TP INJ/USDT:USDT' });
    if (seed?.kind !== 'protection') throw new Error('protection');
    expect(seed.rows.map((r) => [r.what, r.orderId, r.level, r.basis?.qty])).toEqual([
      ['sl', 'o1', 7.392, 5],
      // The TP closes 2 of the 5 contracts.
      ['tp', 'o2', 8.36, 2],
    ]);
    expect(seed.basis).toEqual({ long: true, entry: 7.62, qty: 5, quote: 'USDT' });
  });

  it('none without trading on that market, or with nothing to change where nothing can be added', () => {
    expect(positionSeed(account({ trading: { supported: true, enabled: true, markets: ['spot'], reason: null } }), { orders: [order()] }, pos())).toBeNull();
    expect(positionSeed(account({ trading: { supported: true, enabled: false, markets: ['futures'], reason: null } }), { orders: [order()] }, pos())).toBeNull();
    // Alpaca: a short's SL / TP are orders; none there, none to add.
    const alpaca = account({ exchange: 'alpaca', kind: 'stocks', trading: { supported: true, enabled: true, markets: ['stock'], reason: null } });
    expect(positionSeed(alpaca, { orders: [] }, pos({ symbol: 'TSLA/USD', side: 'short', contracts: 3, size: 3, entryPrice: 250 }))).toBeNull();
  });

  it('eToro: one position at a time, its own levels only (two positions on one instrument stay apart)', () => {
    const etoro = account({ exchange: 'etoro', kind: 'stocks', trading: { supported: true, enabled: true, markets: ['stock'], reason: null } });
    const p1 = pos({ symbol: 'TSLA/USD', side: 'short', contracts: 3, size: 3, entryPrice: 250, ref: { positionIds: ['111'] } });
    const orders = [
      order({ id: 'sl-111', symbol: 'TSLA/USD', side: 'buy', triggerPrice: 270, amount: 3, stop: 'up', cancellable: false }),
      order({ id: 'sl-222', symbol: 'TSLA/USD', side: 'buy', triggerPrice: 280, amount: 1, stop: 'up', cancellable: false }),
    ];
    const seed = positionSeed(etoro, { orders }, p1);
    expect(seed).toMatchObject({ kind: 'protection', market: 'stock', symbol: 'TSLA', position: { side: 'short', ref: '111' }, add: true });
    if (seed?.kind !== 'protection') throw new Error('protection');
    expect(seed.rows.map((r) => r.orderId)).toEqual(['sl-111']);
  });
});

describe('holdingSeed and orderSeed', () => {
  const etoro = account({ exchange: 'etoro', kind: 'stocks', trading: { supported: true, enabled: true, markets: ['stock'], reason: null } });
  it('an eToro holding of one position: its SL / TP; of several: none (each from its orders)', () => {
    const tp = order({ id: 'tp-9', market: 'spot', symbol: 'AAPL/USD', type: 'limit', price: 240, triggerPrice: null, amount: 2, stop: null, cancellable: false });
    expect(holdingSeed(etoro, { orders: [tp], balances: [bal({ ref: { positionIds: ['9'] } })] }, bal({ ref: { positionIds: ['9'] } }))).toMatchObject({ kind: 'protection', symbol: 'AAPL', position: { side: 'long', ref: '9' } });
    expect(holdingSeed(etoro, { orders: [tp], balances: [bal({ ref: { positionIds: ['9', '10'] } })] }, bal({ ref: { positionIds: ['9', '10'] } }))).toBeNull();
    // Its `tp-` row opens the position's levels; of a holding of several, that position's alone, without a PnL.
    const several = { orders: [tp], positions: [], balances: [bal({ ref: { positionIds: ['9', '10'] } })] };
    expect(orderSeed(etoro, several, tp)).toMatchObject({ kind: 'protection', position: { side: 'long', ref: '9' }, rows: [{ what: 'tp', orderId: 'tp-9', level: 240, basis: null }], basis: null });
  });

  it("an order: what it closes (a position's SL) or what it opens (an entry); none where the platform cannot change it", () => {
    const sl = order();
    const seed = orderSeed(account(), { orders: [sl], positions: [pos()], balances: [] }, sl);
    expect(seed).toMatchObject({ kind: 'order', market: 'futures', closes: true, basis: { long: true, entry: 7.62, qty: 5 } });
    const entry = order({ id: 'e1', type: 'limit', side: 'buy', price: 7, triggerPrice: null, reduceOnly: false, stop: null, amount: 3, contractSize: 0.1 });
    expect(orderSeed(account(), { orders: [entry], positions: [], balances: [] }, entry)).toMatchObject({ kind: 'order', closes: false, basis: { long: true, entry: 7, qty: 0.30000000000000004, quote: 'USDT' } });
    // eToro: a pending order is not changed from here.
    expect(orderSeed(etoro, { orders: [], positions: [], balances: [] }, order({ id: '555', symbol: 'AAPL/USD', reduceOnly: false }))).toBeNull();
    // A KuCoin unified account lists a perpetual's order with spot: it is futures, where trading may be off.
    const spotOnly = account({ trading: { supported: true, enabled: true, markets: ['spot'], reason: null } });
    expect(orderSeed(spotOnly, { orders: [sl], positions: [], balances: [] }, { ...sl, market: 'spot' })).toBeNull();
  });
});

describe('stepImpact', () => {
  const basis = { long: true, entry: 100, qty: 2, quote: 'USDT' };
  it("a position's SL moved, added, removed", () => {
    const ctx = { kind: 'protection' as const, basisOf: () => basis };
    expect(stepImpact(step({ before: vals({ triggerPrice: 90 }), after: vals({ triggerPrice: 95 }) }), ctx)).toBe('−10,00 USDT (−5,0%) · înainte −20,00 USDT (−10,0%) · +10,00 USDT');
    expect(stepImpact(step({ how: 'place', orderId: null, after: vals({ stopLoss: 95, amount: 2 }) }), ctx)).toBe('−10,00 USDT (−5,0%)');
    expect(stepImpact(step({ how: 'cancel', before: vals({ triggerPrice: 90 }), after: vals({ triggerPrice: null }), removes: true }), ctx)).toBe('fără nivel (era −20,00 USDT (−10,0%))');
    // An OKX oco: the leg is its own level, not the (absent) trigger.
    expect(stepImpact(step({ kind: 'tp', before: vals({ stopLoss: 90, takeProfit: 120 }), after: vals({ stopLoss: 90, takeProfit: 125 }) }), ctx)).toBe('+50,00 USDT (+25,0%) · înainte +40,00 USDT (+20,0%) · +10,00 USDT');
  });

  it("an entry's TP / SL from its new price and amount; a closing order's level for its new amount", () => {
    const entry = { kind: 'order' as const, basis, closes: false, amount: 2 };
    expect(stepImpact(step({ kind: 'limit', before: vals({ price: 100, amount: 2, takeProfit: 110 }), after: vals({ price: 100, amount: 4, takeProfit: 110 }) }), entry)).toBe('la TP +40,00 USDT (+10,0%) · înainte +20,00 USDT (+10,0%) · +20,00 USDT');
    const closing = { kind: 'order' as const, basis, closes: true, amount: 2 };
    expect(stepImpact(step({ before: vals({ triggerPrice: 90, amount: 2 }), after: vals({ triggerPrice: 90, amount: 1 }) }), closing)).toBe('−10,00 USDT (−10,0%) · înainte −20,00 USDT (−10,0%) · +10,00 USDT');
  });
});
