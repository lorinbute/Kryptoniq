// FD-TRADESTATS: reading closed futures positions in the pieces each exchange allows, and counting them.
import { describe, expect, it } from 'vitest';
import type { Position } from 'ccxt';
import { fetchClosedPositions, periodStart, settleOf, STATS_WINDOW_MS, summarizeClosed, summarizeResults } from './trade-stats.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pos = (id: string, t: number, pnl: number, symbol = 'BTC/USDT:USDT') => ({ id, symbol, realizedPnl: pnl, lastUpdateTimestamp: t }) as unknown as Position;

describe('reading closed positions', () => {
  it('asks in windows of 7 days, halves a full one and keeps each position once, inside the period', async () => {
    const to = Date.UTC(2026, 9, 14, 12);
    const from = to - 20 * DAY;
    // 250 positions in the last day (more than KuCoin's 200 a request), a few older ones, one before the period.
    const all = [...Array.from({ length: 250 }, (_, i) => pos(`n${i}`, to - i * 5 * 60_000, i % 3 ? 1 : -1)), pos('old1', to - 10 * DAY, 2), pos('old2', to - 19 * DAY, -2), pos('before', from - HOUR, 5)];
    const calls: [number, number][] = [];
    const fetch = async (since: number | undefined, until: number | undefined, limit: number) => {
      calls.push([since as number, until as number]);
      // Overlapping answers on purpose (the exchange's own edges): a position may come twice.
      return all.filter((p) => (p.lastUpdateTimestamp as number) >= (since as number) - HOUR && (p.lastUpdateTimestamp as number) <= (until as number)).slice(0, limit);
    };
    const got = await fetchClosedPositions('kucoin', fetch, from, to);
    expect(got.map((p) => p.id).sort()).toEqual([...all.filter((p) => p.id !== 'before').map((p) => p.id)].sort());
    // Three windows of at most 7 days; the full newest one was halved.
    expect(calls.every(([s, u]) => u - s < STATS_WINDOW_MS)).toBe(true);
    expect(calls.length).toBeGreaterThan(3);
  });

  it('pages back on OKX until it passes the start of the period', async () => {
    const to = Date.UTC(2026, 9, 14, 12);
    const from = to - 30 * DAY;
    const all = Array.from({ length: 230 }, (_, i) => pos(`p${i}`, to - i * 4 * HOUR, 1));
    const afters: (number | undefined)[] = [];
    const fetch = async (_s: number | undefined, _u: number | undefined, limit: number, params: Record<string, unknown>) => {
      const after = params.after as number | undefined;
      afters.push(after);
      return all.filter((p) => after === undefined || (p.lastUpdateTimestamp as number) < after).slice(0, limit);
    };
    const got = await fetchClosedPositions('okx', fetch, from, to);
    // 30 days at one every 4 hours: 180 positions (+1 exactly at the start), found in two pages.
    expect(got).toHaveLength(181);
    expect(afters).toHaveLength(2);
    expect(await fetchClosedPositions('binance', fetch, from, to)).toEqual([]);
  });
});

describe('counting them', () => {
  it('splits wins, losses and zeros, rounds the success rate and converts coin-settled results', () => {
    const ps = [pos('a', 1, 10), pos('b', 1, 5), pos('c', 1, -3), pos('d', 1, 0), pos('e', 1, 0.002, 'BTC/USD:BTC'), pos('f', 1, -1, 'ETH/USD:ETH')];
    const s = summarizeClosed(ps, (c) => (c === 'BTC' ? 80000 : null));
    expect(s).toMatchObject({ wins: 3, losses: 2, breakeven: 1, successRate: 60, netPartial: true });
    // ETH has no price: counted, not in the sum.
    expect(s.net).toBeCloseTo(10 + 5 - 3 + 0.002 * 80000, 6);
    expect(summarizeClosed([pos('a', 1, 1), pos('b', 1, 1), pos('c', 1, -1)], () => null).successRate).toBe(66.7);
    expect(summarizeClosed([pos('z', 1, 0)], () => null)).toMatchObject({ wins: 0, losses: 0, successRate: null, net: 0 });
    // Bitget: its own net figure (after fees) over ccxt's gross `pnl`.
    expect(summarizeClosed([{ ...pos('g', 1, 5), info: { netProfit: '4.2' } } as unknown as Position], () => null).net).toBeCloseTo(4.2, 6);
    expect(settleOf(pos('x', 1, 1, 'BTC/USDT'))).toBe('USDT');
    expect(settleOf(pos('x', 1, 1, 'XBT/USD:XBT'))).toBe('XBT');
  });

  it('counts a broker\'s results (FD-BROKERSTATS): a result without a rate is counted, not summed', () => {
    expect(summarizeResults([{ pnl: 5, net: 4.5 }, { pnl: -2, net: -1.8 }, { pnl: 0, net: 0 }, { pnl: 7, net: null }])).toEqual({ wins: 2, losses: 1, breakeven: 1, successRate: 66.7, net: 2.7, netPartial: true });
    expect(summarizeResults([])).toEqual({ wins: 0, losses: 0, breakeven: 0, successRate: null, net: 0, netPartial: false });
  });

  it('starts "today" at midnight in the user\'s time zone', () => {
    const now = Date.UTC(2026, 9, 14, 10);
    expect(periodStart('today', now, 'Europe/Bucharest')).toBe(Date.UTC(2026, 9, 13, 21));
    expect(periodStart('7d', now, 'UTC')).toBe(now - 7 * DAY);
  });
});
