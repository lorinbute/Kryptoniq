// FD-INDICATORS §5, TD-INDICATORS §7: what an indicator's request for other bars becomes in Sentiq.
import { describe, expect, it } from 'vitest';
import type { Bar } from 'oakscriptjs';
import type { ChartInfo } from './compute.ts';
import { candlesFor, monthlyBars, planRun, resolveRequest, resolveSymbol, type LoadState, type ResolveEnv } from './extra-bars.ts';

const crypto: ChartInfo = { kind: 'crypto', exchange: 'kucoin', symbol: 'BTC/USDT', tf: '1h', precision: 1 };
const stock: ChartInfo = { kind: 'stock', exchange: 'stock', symbol: 'AAPL', tf: '1d', precision: 2 };
const env = (info: ChartInfo, over: Partial<ResolveEnv> = {}): ResolveEnv => ({ info, spanSec: 1500 * 3600, chartLimit: 1500, chartTfs: null, stockTfs: null, ...over });

describe('the symbol a request names', () => {
  it('the chart symbol, however it is written', () => {
    for (const s of ['KUCOIN:BTCUSDT', 'BTCUSDT', 'btcusdt', 'BINANCE:BTCUSDT', 'BTC/USDT']) expect(resolveSymbol(s, crypto), s).toEqual({ asset: 'chart' });
    expect(resolveSymbol('NASDAQ:AAPL', stock)).toEqual({ asset: 'chart' });
  });

  it('another crypto pair: USD becomes USDT', () => {
    expect(resolveSymbol('ETH/USDT', crypto)).toEqual({ asset: 'crypto', symbol: 'ETH/USDT' });
    expect(resolveSymbol('BINANCE:ETHUSDT', crypto)).toEqual({ asset: 'crypto', symbol: 'ETH/USDT' });
    expect(resolveSymbol('BTCUSD', crypto)).toEqual({ asset: 'crypto', symbol: 'BTC/USDT' });
    expect(resolveSymbol('SOLUSDC', stock)).toEqual({ asset: 'crypto', symbol: 'SOL/USDC' });
    // A major coin with its quote is the coin on any chart (TradingView's lists name "BTCUSD"); another ticker ending in
    // USD is a stock on a stock chart.
    expect(resolveSymbol('BTCUSD', stock)).toEqual({ asset: 'crypto', symbol: 'BTC/USDT' });
    expect(resolveSymbol('ABCUSD', stock)).toEqual({ asset: 'stock', symbol: 'ABCUSD' });
    expect(resolveSymbol('ABCUSD', crypto)).toEqual({ asset: 'crypto', symbol: 'ABC/USDT' });
  });

  it('a stock; nothing for forex, futures or other markets', () => {
    expect(resolveSymbol('AAPL', crypto)).toEqual({ asset: 'stock', symbol: 'AAPL' });
    expect(resolveSymbol('NASDAQ:AMZN', crypto)).toEqual({ asset: 'stock', symbol: 'AMZN' });
    expect(resolveSymbol('NYSE:BRK.B', stock)).toEqual({ asset: 'stock', symbol: 'BRK.B' });
    for (const s of ['ES1!', 'FX:EURUSD', 'EURUSD', 'GBPJPY', 'OANDA:XAUUSD', 'CME_MINI:ES1!', 'TVC:DXY', '']) expect(resolveSymbol(s, stock), s).toBeNull();
    // On a coin chart too: a currency pair is not a coin.
    expect(resolveSymbol('EURUSD', crypto)).toBeNull();
  });
});

describe('a request → a load', () => {
  it('the chart symbol on a higher timeframe: enough candles for the chart history', () => {
    const r = resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '1D' }, env(crypto));
    expect(r).toMatchObject({ chartSymbol: true, load: { asset: 'crypto', exchange: 'kucoin', symbol: 'BTC/USDT', tf: '1d', monthly: false, sameSymbol: true, limit: candlesFor(1500 * 3600, '1d', 1500) } });
    expect(r.load?.limit).toBe(113);
  });

  it('the month: daily bars grouped', () => {
    expect(resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '1M' }, env(crypto)).load).toMatchObject({ tf: '1d', monthly: true, limit: 1500 });
  });

  it('nothing for a lower timeframe, one the source lacks, seconds, or an unknown market', () => {
    expect(resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '1' }, env(crypto))).toMatchObject({ load: null, chartSymbol: true });
    expect(resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '480' }, env(crypto, { chartTfs: ['1h', '4h', '1d'] })).load).toBeNull();
    expect(resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '1S' }, env(crypto)).load).toBeNull();
    expect(resolveRequest({ symbol: 'EURUSD', timeframe: '1D' }, env(stock))).toMatchObject({ load: null, chartSymbol: false });
    // A stock intraday needs the user's own key (FD-TDKEYS): only the timeframes they have.
    expect(resolveRequest({ symbol: 'MSFT', timeframe: '60' }, env(crypto, { stockTfs: ['1d', '1w'] })).load).toBeNull();
    expect(resolveRequest({ symbol: 'MSFT', timeframe: '1D' }, env(crypto, { stockTfs: ['1d', '1w'] })).load).toMatchObject({ asset: 'stock', symbol: 'MSFT', tf: '1d' });
  });

  it('the chart timeframe when the request names none', () => {
    expect(resolveRequest({ symbol: 'ETHUSDT', timeframe: '' }, env(crypto)).load).toMatchObject({ symbol: 'ETH/USDT', tf: '1h' });
  });
});

describe('monthly bars', () => {
  it('group daily bars by calendar month in the time zone', () => {
    const day = (iso: string, o: number, h: number, l: number, c: number, v: number): Bar => ({ time: Date.parse(iso) / 1000, open: o, high: h, low: l, close: c, volume: v });
    // 31 Jan 23:00 UTC is already 1 Feb in Bucharest, still January in New York.
    const bars = [day('2026-01-30T00:00:00Z', 10, 12, 9, 11, 1), day('2026-01-31T23:00:00Z', 11, 15, 10, 14, 2), day('2026-02-02T00:00:00Z', 14, 16, 13, 13, 3)];
    expect(monthlyBars(bars, 'America/New_York').map((b) => [b.open, b.high, b.low, b.close, b.volume])).toEqual([
      [10, 15, 9, 14, 3],
      [14, 16, 13, 13, 3],
    ]);
    expect(monthlyBars(bars, 'Europe/Bucharest')).toHaveLength(2);
    expect(monthlyBars(bars, 'Europe/Bucharest')[1]).toMatchObject({ open: 11, close: 13, volume: 5 });
  });
});

describe('how an indicator with requests runs', () => {
  const bars = [{ time: 1, open: 1, high: 1, low: 1, close: 1 }] as Bar[];
  const same = resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '1D' }, env(crypto));
  const month = resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: 'M' }, env(crypto));
  const lower = resolveRequest({ symbol: 'KUCOIN:BTCUSDT', timeframe: '5' }, env(crypto));
  const other = resolveRequest({ symbol: 'AAPL', timeframe: '1D' }, env(crypto));
  const fx = resolveRequest({ symbol: 'EURUSD', timeframe: '1D' }, env(stock));
  const loaded = (...keys: (string | undefined)[]) => new Map<string, LoadState>(keys.map((k) => [k as string, { bars }]));

  it('with the bars once everything is there', () => {
    const plan = planRun([same, month], loaded(same.load?.key, month.load?.key));
    expect(plan.mode).toBe('bars');
    if (plan.mode === 'bars') {
      expect(plan.bars('KUCOIN:BTCUSDT', '1D')).toBe(bars);
      expect(plan.bars('KUCOIN:BTCUSDT', '60')).toBeUndefined();
    }
  });

  it('from the chart bars when only the chart symbol is asked and something is missing or loading', () => {
    expect(planRun([same, lower], loaded(same.load?.key)).mode).toBe('approximate');
    expect(planRun([same], new Map()).mode).toBe('approximate');
  });

  it('waits for another symbol, then runs with what is there (the indicator names what it misses)', () => {
    expect(planRun([same, other], loaded(same.load?.key)).mode).toBe('wait');
    const failed = new Map<string, LoadState>([[same.load?.key as string, { bars }], [other.load?.key as string, 'failed']]);
    expect(planRun([same, other], failed).mode).toBe('bars');
    expect(planRun([fx], new Map()).mode).toBe('bars');
  });
});
