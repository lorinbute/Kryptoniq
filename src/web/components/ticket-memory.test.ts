// FD-TICKETMEMORY: what a new order form takes from the last choices of its account.
import { describe, expect, it } from 'vitest';
import { orderTicketMemorySchema, salvageOrderTicket, type OrderTicketMemory } from '../../shared/trading.ts';
import { accountPatch, initialAccount, rememberedFields, ticketPatch } from './ticket-memory.ts';

const memory: OrderTicketMemory = {
  lastAccount: { crypto: 7, stocks: 9 },
  accounts: { '7': { market: 'futures', side: 'sell', kind: 'limit', amountIn: 'quote', leverage: 10, marginMode: 'cross', reduceOnly: false, tif: 'gtc' }, '9': { kind: 'limit', tif: 'day', extendedHours: true } },
};

describe('the order form remembers its choices', () => {
  it('a new form takes the account’s last choices', () => {
    expect(rememberedFields(memory, 7, { kind: 'crypto', symbol: 'BTC/USDT' })).toEqual(memory.accounts['7']);
    expect(rememberedFields(memory, 9, {})).toEqual({ kind: 'limit', tif: 'day', extendedHours: true });
    // An account without a memory, or none at all: the form's own defaults.
    expect(rememberedFields(memory, 3, {})).toEqual({});
    expect(rememberedFields(undefined, 7, {})).toEqual({});
  });

  it('what the place it was opened from sets wins; closing a position ignores the memory', () => {
    // "Vinde" on a holding: spot, sell; the rest from the memory.
    expect(rememberedFields(memory, 7, { market: 'spot', side: 'sell', symbol: 'ETH/USDT' })).toEqual({ kind: 'limit', amountIn: 'quote', leverage: 10, marginMode: 'cross', reduceOnly: false, tif: 'gtc' });
    expect(rememberedFields(memory, 7, { orderKind: 'market', marginMode: 'isolated' })).not.toHaveProperty('kind');
    expect(rememberedFields(memory, 7, { reduceOnly: true, market: 'futures', side: 'buy' })).toEqual({});
    expect(rememberedFields(memory, 7, { close: { positionIds: ['1'] } })).toEqual({});
  });

  it('opens on the account asked for, else the one used last for that kind, if it can still trade', () => {
    expect(initialAccount(memory, { accountId: 4 }, [4, 7])).toBe(4);
    expect(initialAccount(memory, { kind: 'crypto' }, [4, 7])).toBe(7);
    expect(initialAccount(memory, { kind: 'crypto' }, [4])).toBeNull();
    expect(initialAccount(memory, {}, [4, 7])).toBeNull();
  });

  it('the patches: one account’s choices, the account used last', () => {
    expect(ticketPatch(7, { kind: 'stop' })).toEqual({ orderTicket: { accounts: { '7': { kind: 'stop' } } } });
    expect(accountPatch('stocks', 9)).toEqual({ orderTicket: { lastAccount: { stocks: 9 } } });
  });
});

describe('the stored memory', () => {
  it('accepts the choices, refuses what a form never sends', () => {
    expect(orderTicketMemorySchema.parse({})).toEqual({ lastAccount: {}, accounts: {} });
    expect(orderTicketMemorySchema.parse(memory)).toEqual(memory);
    for (const bad of [
      { accounts: { abc: {} } },
      { accounts: { '7': { leverage: 200 } } },
      { accounts: { '7': { leverage: 2.5 } } },
      { accounts: { '7': { kind: 'iceberg' } } },
      { accounts: { '7': { symbol: 'BTC/USDT' } } },
      { accounts: { '7': { amount: 1 } } },
      { accounts: { '7': { price: 1 } } },
      { lastAccount: { crypto: -1 } },
      { accounts: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [String(i + 1), {}])) },
    ]) expect(orderTicketMemorySchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
  });

  it('keeps what is valid of a memory that no longer parses whole', () => {
    expect(salvageOrderTicket({ lastAccount: { crypto: 7, stocks: 'x' }, accounts: { '7': { kind: 'limit' }, '8': { kind: 'iceberg' }, bad: {} } })).toEqual({ lastAccount: { crypto: 7 }, accounts: { '7': { kind: 'limit' } } });
    expect(salvageOrderTicket('nonsense')).toEqual({ lastAccount: {}, accounts: {} });
  });
});
