// FD-ORDEREDIT: the changes' form (the page and the server check it alike) and how each platform changes an order.
import { describe, expect, it } from 'vitest';
import { etoroProtectionOf, modifyTicketSchema, orderEditFields, orderEditMode, reverseTicketSchema, subKey, type EditableOrderLike } from './trading.ts';

const KEY = '0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f6';
const base = { accountId: 1, idemKey: KEY, market: 'futures', symbol: 'BTC/USDT:USDT' };

describe('the changes form (FD-ORDEREDIT)', () => {
  it('accepts a SL moved, a TP added, a TP removed, and an order changed', () => {
    expect(modifyTicketSchema.safeParse({ ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'o1', level: 58000 }, { what: 'tp', orderId: null, level: 65000 }] }).success).toBe(true);
    expect(modifyTicketSchema.safeParse({ ...base, position: { side: 'short', ref: '111' }, changes: [{ what: 'tp', orderId: 'o2', level: null }] }).success).toBe(true);
    expect(modifyTicketSchema.safeParse({ ...base, changes: [{ what: 'order', orderId: 'e1', trigger: false, price: 57000, stopLoss: null }] }).success).toBe(true);
    // An order holding both levels (OKX's oco): its stop loss and take profit move together.
    expect(modifyTicketSchema.safeParse({ ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'a1', level: 58000 }, { what: 'tp', orderId: 'a1', level: 66000 }] }).success).toBe(true);
  });

  it('refuses what a page never sends', () => {
    const bad = [
      { ...base, changes: [] },
      { ...base, changes: [{ what: 'sl', orderId: 'o1', level: 58000 }] }, // no position
      { ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: null, level: null }] }, // added without a level
      { ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'o1', level: -1 }] },
      { ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'o1', level: 1 }, { what: 'sl', orderId: 'o1', level: 2 }] }, // one level twice
      { ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: 'o1', level: 1 }, { what: 'order', orderId: 'o1', trigger: true, triggerPrice: 2 }] }, // an order and its level
      { ...base, position: { side: 'long' }, changes: Array.from({ length: 5 }, (_, i) => ({ what: 'sl', orderId: `o${i}`, level: 1 })) },
      { ...base, position: { side: 'long' }, changes: [{ what: 'sl', orderId: null, level: 1 }, { what: 'sl', orderId: null, level: 2 }] },
      { ...base, changes: [{ what: 'order', orderId: 'e1', price: 1 }] }, // trigger missing
      { ...base, changes: [{ what: 'order', orderId: 'e1', trigger: false, other: 1 }] },
      { ...base, idemKey: 'x', changes: [{ what: 'order', orderId: 'e1', trigger: false }] },
      { ...base, extra: true, changes: [{ what: 'order', orderId: 'e1', trigger: false }] },
    ];
    for (const b of bad) expect(modifyTicketSchema.safeParse(b).success, JSON.stringify(b).slice(0, 120)).toBe(false);
  });
});

describe('how an order changes on its platform (FD-ORDEREDIT)', () => {
  const o = (over: Partial<EditableOrderLike> = {}): EditableOrderLike => ({ id: 'o1', market: 'futures', type: 'limit', price: 100, triggerPrice: null, reduceOnly: false, ...over });
  it('in place, by a replacement, or not at all', () => {
    expect(['bybit', 'okx', 'kraken', 'alpaca'].map((x) => orderEditMode(x, o({ type: 'market', price: null, triggerPrice: 90 })))).toEqual(['amend', 'amend', 'amend', 'amend']);
    // Binance futures: a limit order in place, a stop replaced; spot: cancel-replace in one request.
    expect([orderEditMode('binance', o()), orderEditMode('binance', o({ type: 'market', price: null, triggerPrice: 90 })), orderEditMode('binance', o({ market: 'spot', triggerPrice: 90 }))]).toEqual(['amend', 'replace', 'amend']);
    expect([orderEditMode('coinbase', o({ market: 'spot' })), orderEditMode('coinbase', o({ market: 'spot', triggerPrice: 90 }))]).toEqual(['amend', 'replace']);
    expect(['kucoin', 'bitget', 'trading212'].map((x) => orderEditMode(x, o()))).toEqual(['replace', 'replace', 'replace']);
    // eToro: a position's SL / TP in place; a pending order not from here; IBKR: nothing.
    expect([orderEditMode('etoro', o({ id: 'sl-111', cancellable: false })), orderEditMode('etoro', o({ id: '555' })), orderEditMode('ibkr', o())]).toEqual(['amend', null, null]);
    expect(etoroProtectionOf({ id: 'tp-111', cancellable: false })).toEqual({ what: 'tp', positionId: '111' });
    expect(etoroProtectionOf({ id: 'tp-111' })).toBeNull();
  });

  it('the form offers what the order has, and TP / SL on a futures entry where the platform attaches them', () => {
    expect(orderEditFields('kucoin', o())).toEqual({ price: true, triggerPrice: false, amount: true, tpsl: true });
    expect(orderEditFields('binance', o())).toMatchObject({ tpsl: false });
    expect(orderEditFields('kucoin', o({ reduceOnly: true, type: 'market', price: null, triggerPrice: 90 }))).toEqual({ price: false, triggerPrice: true, amount: true, tpsl: false });
    // An order that carries TP / SL (Bybit, OKX) shows them whatever the platform's rule.
    expect(orderEditFields('binance', { ...o(), stopLoss: 80 })).toMatchObject({ tpsl: true });
    // A stop loss order repeating its own level as "stop loss" (Bybit) is no entry with one attached.
    expect(orderEditFields('bybit', { ...o({ reduceOnly: true, type: 'market', price: null, triggerPrice: 90 }), stopLoss: 90 })).toMatchObject({ tpsl: false });
  });
});

describe('a position turned the other way (FD-REVERSE)', () => {
  it('its form names the position; each of its orders gets its own key, the same for the same reversal', () => {
    expect(reverseTicketSchema.safeParse({ accountId: 1, idemKey: KEY, symbol: 'BTC/USDT:USDT', side: 'long' }).success).toBe(true);
    expect(reverseTicketSchema.safeParse({ accountId: 1, idemKey: KEY, symbol: 'BTC/USDT:USDT', side: 'flat' }).success).toBe(false);
    expect(reverseTicketSchema.safeParse({ accountId: 1, idemKey: KEY, symbol: 'BTC/USDT:USDT', side: 'long', amount: 1 }).success).toBe(false);
    expect([subKey(KEY, 1), subKey(KEY, 2)]).toEqual(['0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f7', '0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f8']);
    expect(subKey('0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5ff', 1)).toBe('0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e500');
  });
});
