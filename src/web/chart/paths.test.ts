import { describe, expect, it } from 'vitest';
import { CHART_SYMBOL_RE } from '../../shared/settings.ts';
import { chartPathOf, rememberedPath, stockChartPath, nearestTimeframe } from './paths.ts';

describe('chart addresses (FD-SENTIQ §4.3)', () => {
  it('pairs and stocks have their own addresses', () => {
    expect(chartPathOf({ kind: 'crypto', coin: 'BTC', quote: 'USDT' })).toBe('/charts/BTC/USDT');
    expect(chartPathOf({ coin: 'ETH', quote: 'USDT' })).toBe('/charts/ETH/USDT');
    expect(chartPathOf({ kind: 'stock', coin: 'BRK.B', quote: 'USD' })).toBe('/charts/s/BRK.B');
    expect(stockChartPath('AAPL')).toBe('/charts/s/AAPL');
    expect(rememberedPath('stock:AAPL')).toBe('/charts/s/AAPL');
    expect(rememberedPath('SOL/USDT')).toBe('/charts/SOL/USDT');
  });

  it('the remembered chart can be a pair or a stock', () => {
    for (const ok of ['BTC/USDT', 'stock:AAPL', 'stock:BRK.B']) expect(CHART_SYMBOL_RE.test(ok)).toBe(true);
    for (const bad of ['stock:', 'stock:aapl', 'stock:1AB', 'AAPL']) expect(CHART_SYMBOL_RE.test(bad)).toBe(false);
  });

  it('a stock chart shows the closest timeframe its source has', () => {
    const noKey = ['1d', '1w'] as const;
    const key = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'] as const;
    expect(nearestTimeframe('1h', noKey)).toBe('1d');
    expect(nearestTimeframe('1w', noKey)).toBe('1w');
    expect(nearestTimeframe('1h', key)).toBe('1h');
    // A tie goes to the longer one; 6h / 8h / 12h are closer to 4h than to a day.
    expect(nearestTimeframe('3m', key)).toBe('5m');
    expect(nearestTimeframe('6h', key)).toBe('4h');
    expect(nearestTimeframe('12h', key)).toBe('4h');
    expect(nearestTimeframe('1h', [])).toBe('1d');
  });
});
