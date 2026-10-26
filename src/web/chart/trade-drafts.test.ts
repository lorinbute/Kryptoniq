// FD-ORDEREDIT: which chart lines can be dragged, how a dragged one shows, and the changes a group's drafts make.
import { describe, expect, it } from 'vitest';
import type { AccountView, OrderRow, PositionRow } from '../../shared/api-types.ts';
import { tradeLinesOf } from './pnl.ts';
import { anchorOf, draftGroups, draftTicket, isDraggable, liveDrafts, sentLevels, withDrafts, withSent, type AccountLine } from './trade-drafts.ts';

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

const linesOf = (a: AccountView, orders: OrderRow[], positions = [pos()]): AccountLine[] =>
  tradeLinesOf({ base: 'INJ', quote: 'USDT', lastPrice: 7.7, positions, balances: [], orders, accountId: a.id }).lines.map((l) => ({ ...l, account: a }));

describe('isDraggable', () => {
  it('SL / TP and orders on an account trading that market; never the entry, liquidation or PnL', () => {
    const entry = order({ id: 'e1', type: 'limit', side: 'buy', price: 7, triggerPrice: null, reduceOnly: false, stop: null, stopLoss: 6.5 });
    const lines = linesOf(account(), [order(), entry]);
    expect(lines.filter((l) => isDraggable(l, l.account)).map((l) => l.role)).toEqual(['sl', 'order', 'order-sl']);
    const spotOnly = account({ trading: { supported: true, enabled: true, markets: ['spot'], reason: null } });
    expect(linesOf(spotOnly, [order()]).some((l) => isDraggable(l, l.account))).toBe(false);
    // eToro: its pending orders are not changed from here.
    const etoro = account({ exchange: 'etoro', kind: 'stocks', trading: { supported: true, enabled: true, markets: ['stock'], reason: null } });
    expect(linesOf(etoro, [entry]).some((l) => isDraggable(l, l.account))).toBe(false);
  });
});

describe('drafts', () => {
  const tp = order({ id: 'o2', type: 'limit', price: 8.36, triggerPrice: null, stop: null });
  const a = account();
  const lines = linesOf(a, [order(), tp]);
  const slId = '7|sl|futures:o1|trigger';
  const tpId = '7|tp|futures:o2|price';

  it('a dragged line shows dotted at its new level, with the PnL there', () => {
    const shown = withDrafts(lines, { [slId]: 7.5 });
    expect(shown.find((l) => l.id === slId)).toMatchObject({ price: 7.5, style: 'dotted', title: 'SL −0,60 USDT (−1,6%)' });
    expect(shown.find((l) => l.id === tpId)).toBe(lines.find((l) => l.id === tpId));
  });

  it("a position's SL and TP dragged: one ticket for the position; Confirm on its entry line", () => {
    const drafts = { [slId]: 7.5, [tpId]: 8.5 };
    const [group] = draftGroups(lines, drafts);
    expect(group).toBe('7|trade|INJ/USDT:USDT|LONG|');
    expect(anchorOf(group as string, lines)?.role).toBe('entry');
    expect(draftTicket(lines, drafts, group as string)).toEqual({
      accountId: 7,
      market: 'futures',
      symbol: 'INJ/USDT:USDT',
      position: { side: 'long' },
      changes: [
        { what: 'sl', orderId: 'o1', level: 7.5 },
        { what: 'tp', orderId: 'o2', level: 8.5 },
      ],
    });
  });

  it("an order's price and attached SL dragged: one change of that order; its SL's PnL follows the new price", () => {
    const entry = order({ id: 'e1', type: 'limit', side: 'buy', price: 7, triggerPrice: null, reduceOnly: false, stop: null, stopLoss: 6.5, contractSize: 1 });
    const ls = linesOf(a, [entry], []);
    const drafts = { '7|order|futures:e1|line': 7.1, '7|order|futures:e1|sl': 6.6 };
    expect(withDrafts(ls, drafts).find((l) => l.role === 'order-sl')?.title).toBe('SL ordin −2,50 USDT (−7,0%)');
    expect(draftTicket(ls, drafts, '7|order|futures:e1')).toEqual({ accountId: 7, market: 'futures', symbol: 'INJ/USDT:USDT', changes: [{ what: 'order', orderId: 'e1', trigger: false, price: 7.1, stopLoss: 6.6 }] });
  });

  it("eToro: a position's own SL dragged changes that position (its id), as a share", () => {
    const etoro = account({ id: 3, exchange: 'etoro', kind: 'stocks', trading: { supported: true, enabled: true, markets: ['stock'], reason: null } });
    const short = pos({ symbol: 'AAPL/USD', side: 'short', contracts: 1.5, size: 1.5, entryPrice: 205, markPrice: 200, liquidationPrice: null, ref: { positionIds: ['121'] } });
    const sl = order({ id: 'sl-121', symbol: 'AAPL/USD', side: 'buy', triggerPrice: 215, amount: 1.5, stop: 'up', cancellable: false });
    const ls = tradeLinesOf({ base: 'AAPL', quote: 'USD', lastPrice: 200, positions: [short], balances: [], orders: [sl], accountId: 3, stock: true }).lines.map((l) => ({ ...l, account: etoro }));
    const line = ls.find((l) => l.role === 'sl');
    expect(line && isDraggable(line, etoro)).toBe(true);
    expect(draftTicket(ls, { [line!.id]: 212 }, line!.group)).toEqual({ accountId: 3, market: 'stock', symbol: 'AAPL', position: { side: 'short', ref: '121' }, changes: [{ what: 'sl', orderId: 'sl-121', level: 212 }] });
  });

  it('a line gone (filled, cancelled) or no longer draggable takes its draft along', () => {
    const drafts = { [slId]: 7.5, [tpId]: 8.5 };
    expect(liveDrafts(lines, drafts)).toBe(drafts);
    expect(liveDrafts(linesOf(a, [tp]), drafts)).toEqual({ [tpId]: 8.5 });
    const off = account({ trading: { supported: true, enabled: false, markets: ['futures'], reason: null } });
    expect(liveDrafts(linesOf(off, [order(), tp]), drafts)).toEqual({});
  });
});

describe('levels just sent (FIX-SLTPDUP)', () => {
  const a = account();
  const tp = order({ id: 'o2', type: 'limit', price: 8.36, triggerPrice: null, stop: null });
  const lines = linesOf(a, [order(), tp]);
  const slId = '7|sl|futures:o1|trigger';
  const tpId = '7|tp|futures:o2|price';
  const group = '7|trade|INJ/USDT:USDT|LONG|';
  const drafts = { [slId]: 7.5, [tpId]: 8.5 };
  const ticket = draftTicket(lines, drafts, group)!;
  const done = { status: 'done' as const, steps: [] };
  const now = 1_000_000;

  it('the moved lines are the sent levels; on a partial result only the changes that went through', () => {
    expect(sentLevels(lines, drafts, group, ticket, done, now).map((s) => [s.line.id, s.price, s.until])).toEqual([
      [slId, 7.5, now + 60_000],
      [tpId, 8.5, now + 60_000],
    ]);
    const partial = { status: 'partial' as const, steps: [{ change: 0, what: 'ordin nou plasat', ok: true, orderId: 'n1', message: null }, { change: 1, what: 'eroare', ok: false, orderId: 'o2', message: 'refuzat' }] };
    expect(sentLevels(lines, drafts, group, ticket, partial, now).map((s) => s.line.id)).toEqual([slId]);
  });

  it('the platform still listing the old orders: the lines stay at the new levels, not draggable', () => {
    const sent = sentLevels(lines, drafts, group, ticket, done, now);
    const r = withSent(lines, sent, now + 1000);
    expect(r.waiting).toHaveLength(2);
    expect(r.lines.find((l) => l.id === slId)).toMatchObject({ price: 7.5, style: 'dashed', title: 'SL −0,60 USDT (−1,6%)' });
    expect(r.lines.find((l) => l.id === slId)?.order).toBeUndefined();
    expect(r.lines.filter((l) => isDraggable(l, l.account)).map((l) => l.id)).toEqual([]);
  });

  it('the new order listed beside the old one (place, then cancel): one line, at the new level', () => {
    const sent = sentLevels(lines, drafts, group, ticket, done, now);
    // Both listed: the old SL (o1) and the new one (n1) at 7.5.
    const both = linesOf(a, [order(), order({ id: 'n1', triggerPrice: 7.5 }), tp]);
    const r = withSent(both, sent, now + 1000);
    const sls = r.lines.filter((l) => l.role === 'sl');
    expect(sls.map((l) => [l.id, l.price])).toEqual([['7|sl|futures:n1|trigger', 7.5]]);
    // The old one still waits to go; the TP (not listed anew) still shows at its new level.
    expect(r.waiting.map((s) => s.line.id)).toEqual([slId, tpId]);
    // The old one gone, the new one listed: nothing more to wait for on the SL.
    const after = withSent(linesOf(a, [order({ id: 'n1', triggerPrice: 7.5 }), tp]), r.waiting, now + 2000);
    expect(after.waiting.map((s) => s.line.id)).toEqual([tpId]);
  });

  it('the old order already gone and the new not yet listed: the level is drawn alone; an amended order settles by its price; a minute at most', () => {
    const sent = sentLevels(lines, drafts, group, ticket, done, now);
    const r = withSent(linesOf(a, [tp]), sent.slice(0, 1), now + 1000);
    expect(r.lines.filter((l) => l.role === 'sl').map((l) => [l.id, l.price, l.order])).toEqual([[`${slId}|sent`, 7.5, undefined]]);
    // Amended in place (same id, new level): settled.
    const amended = withSent(linesOf(a, [order({ triggerPrice: 7.5 }), tp]), sent.slice(0, 1), now + 1000);
    expect(amended.waiting).toEqual([]);
    expect(withSent(lines, sent, now + 60_001)).toEqual({ lines, waiting: [] });
  });
});
