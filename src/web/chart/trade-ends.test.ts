import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../../shared/api-types.ts';
import { endedTrades, tradeKeys } from './trade-ends.ts';

type Pos = Portfolio['positions'][number];
type Bal = Portfolio['balances'][number];
const pos = (symbol: string, side: string, contracts: number, ids?: string[]): Pos => ({ symbol, side, contracts, size: contracts, entryPrice: 1, markPrice: 1, unrealizedPnl: 0, percentage: 0, liquidationPrice: null, leverage: 5, marginMode: 'isolated', notional: 1, ...(ids ? { ref: { positionIds: ids } } : {}) });
const bal = (asset: string, total: number, value: number | null, ids?: string[]): Bal => ({ asset, account: 'spot', total, free: total, used: 0, price: null, value, avgPrice: null, avgSource: null, pnl: null, pnlPct: null, ...(ids ? { ref: { positionIds: ids } } : {}) });
const pf = (positions: Pos[], balances: Bal[] = [], extra: Partial<Portfolio> = {}): Portfolio =>
  ({ accountId: 1, exchange: 'kucoin', kind: 'crypto', currency: 'USDT', cash: null, asOf: null, mode: 'unknown', balances, positions, orders: [], fills: [], totals: { spotValue: 0, unrealizedPnl: 0, futuresAvailable: null }, errors: {}, stale: {}, fetchedAt: 0, ...extra }) as Portfolio;
const ended = (a: Portfolio, b: Portfolio) => endedTrades(tradeKeys(a, 1), tradeKeys(b, 2));

describe('the trades that ended between two readings (FD-TRADESOUND)', () => {
  it('FIX-COINSOUND2: only the trades of the chart on screen (its asset: positions on any of its pairs, its holding)', () => {
    const a = pf(
      [pos('SOL/USDT:USDT', 'long', 9), pos('BTC/USDT:USDT', 'short', 1), pos('SOLV/USDT:USDT', 'long', 3)],
      [bal('SOL', 4, 500), bal('BTC', 1, 80_000)],
    );
    const sol = (p: Portfolio, at: number) => tradeKeys(p, at, 'SOL');
    // BTC closed (position and holding), SOLV closed: the SOL chart stays silent.
    expect(endedTrades(sol(a, 1), sol(pf([pos('SOL/USDT:USDT', 'long', 9)], [bal('SOL', 4, 500)]), 2))).toEqual([]);
    // The SOL position closed, and the SOL holding sold.
    expect(endedTrades(sol(a, 1), sol(pf([pos('BTC/USDT:USDT', 'short', 1)], [bal('BTC', 1, 80_000)]), 2))).toEqual(['SOL/USDT:USDT|long', 'bal:SOL']);
    // A share (eToro position ids): TSLA's chart hears TSLA only.
    const e = pf([pos('TSLA/USD', 'long', 2, ['11']), pos('AMD/USD', 'long', 1, ['12'])], [bal('NVDA', 3, 500, ['13'])]);
    expect(endedTrades(tradeKeys(e, 1, 'TSLA'), tradeKeys(pf([]), 2, 'TSLA'))).toEqual(['pos:11']);
    expect([...tradeKeys(e, 1, 'TSLA').trades.keys()]).toEqual(['pos:11']);
  });

  it('readings too far apart were not made while watching: nothing ended for the sound (FIX-COINSOUND)', () => {
    const before = tradeKeys(pf([pos('SOL/USDT:USDT', 'long', 9)]), 1_000_000);
    const after = (dt: number) => tradeKeys(pf([]), 1_000_000 + dt);
    // 20 s apart (the page's rhythm), or 3 s after a trading action: compared.
    expect(endedTrades(before, after(20_000))).toEqual(['SOL/USDT:USDT|long']);
    expect(endedTrades(before, after(50_000))).toEqual(['SOL/USDT:USDT|long']);
    // The laptop asleep, the phone's app in the background for hours: silent.
    expect(endedTrades(before, after(50_001))).toEqual([]);
    expect(endedTrades(before, after(6 * 3_600_000))).toEqual([]);
  });

  it('a position gone has ended (stop loss, take profit, closed by hand, liquidated); one still open has not', () => {
    expect(ended(pf([pos('BTC/USDT:USDT', 'long', 2), pos('ETH/USDT:USDT', 'short', 1)]), pf([pos('ETH/USDT:USDT', 'short', 1)]))).toEqual(['BTC/USDT:USDT|long']);
    // Partly closed: still a trade.
    expect(ended(pf([pos('BTC/USDT:USDT', 'long', 2)]), pf([pos('BTC/USDT:USDT', 'long', 1)]))).toEqual([]);
    // Reversed (⇅): the long ended, a short began.
    expect(ended(pf([pos('BTC/USDT:USDT', 'long', 2)]), pf([pos('BTC/USDT:USDT', 'short', 2)]))).toEqual(['BTC/USDT:USDT|long']);
    // A new position is not an end.
    expect(ended(pf([]), pf([pos('BTC/USDT:USDT', 'long', 2)]))).toEqual([]);
  });

  it('each eToro position on its own: one closed of several has ended', () => {
    expect(ended(pf([], [bal('AAPL', 3, 600, ['11', '12'])]), pf([], [bal('AAPL', 1, 200, ['12'])]))).toEqual(['pos:11']);
    expect(ended(pf([pos('AAPL', 'short', 2, ['21', '22'])]), pf([pos('AAPL', 'short', 1, ['22'])]))).toEqual(['pos:21']);
  });

  it('a holding sold (at most 1 % left) has ended; partly sold, dust, cash and stablecoins never count', () => {
    expect(ended(pf([], [bal('SOL', 10, 1000)]), pf([], [bal('SOL', 0.05, 5)]))).toEqual(['bal:SOL']);
    expect(ended(pf([], [bal('SOL', 10, 1000)]), pf([], []))).toEqual(['bal:SOL']);
    expect(ended(pf([], [bal('SOL', 10, 1000)]), pf([], [bal('SOL', 4, 400)]))).toEqual([]);
    // Worth less than 1 before: dust.
    expect(ended(pf([], [bal('PEPE', 1000, 0.5)]), pf([], []))).toEqual([]);
    // The price fell under 1, the coins are still there: not sold.
    expect(ended(pf([], [bal('XYZ', 10, 1.2)]), pf([], [bal('XYZ', 10, 0.9)]))).toEqual([]);
    expect(ended(pf([], [bal('USDT', 500, 500), bal('EUR', 100, 110)]), pf([], []))).toEqual([]);
  });

  it('a section the platform did not answer for is not compared', () => {
    const before = pf([pos('BTC/USDT:USDT', 'long', 2)], [bal('SOL', 10, 1000)]);
    expect(ended(before, pf([], [bal('SOL', 10, 1000)], { errors: { positions: { code: 'NETWORK', message: 'x' } } }))).toEqual([]);
    expect(ended(before, pf([pos('BTC/USDT:USDT', 'long', 2)], [], { stale: { balances: 1 } }))).toEqual([]);
    // The reading before was the one in error: nothing to compare with either.
    expect(ended(pf([pos('BTC/USDT:USDT', 'long', 2)], [], { errors: { positions: { code: 'NETWORK', message: 'x' } } }), pf([]))).toEqual([]);
  });
});
