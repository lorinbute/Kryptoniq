import { describe, expect, it } from 'vitest';
import { chartStyleSchema } from '../../shared/chart-style.ts';
import { fmtChange, statusLineOn, statusTitle } from '../components/ChartStatusLine.tsx';
import { barChange, chartPrecision, chartTimeZone, dayChange, fmtVolume, isTimeZone, prevDayCloses } from './chart-look.ts';

const look = (patch: unknown) => chartStyleSchema.parse(patch);

describe('the chart settings outside the chart (FD-CHARTSETTINGS)', () => {
  it("use the chart's own time zone only when the browser knows it", () => {
    expect(isTimeZone('Europe/Bucharest')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(chartTimeZone(look({}), 'Europe/Bucharest')).toBe('Europe/Bucharest');
    expect(chartTimeZone(look({ timezone: 'America/New_York' }), 'Europe/Bucharest')).toBe('America/New_York');
    expect(chartTimeZone(look({ timezone: 'Mars/Olympus' }), 'Europe/Bucharest')).toBe('Europe/Bucharest');
  });

  it("show the pair's decimals unless others are chosen", () => {
    expect(chartPrecision(look({}), 5)).toBe(5);
    expect(chartPrecision(look({ precision: 0 }), 5)).toBe(0);
    expect(chartPrecision(look({ precision: 8 }), 2)).toBe(8);
  });

  it("give the candle's change from the previous close (the first one: from its open)", () => {
    const cs = [
      { o: 100, c: 110 },
      { o: 111, c: 99 },
      { o: 0, c: 0 },
      { o: 0, c: 5 },
    ];
    expect(barChange(cs, 0)).toEqual({ abs: 10, pct: 10 });
    expect(barChange(cs, 1)).toEqual({ abs: -11, pct: -10 });
    // From 0: no percentage.
    expect(barChange(cs, 3)).toEqual({ abs: 5, pct: null });
    expect(barChange(cs, 9)).toBeNull();
  });

  it("find the day before's close in the chart's time zone", () => {
    // Hourly candles from 22:00 UTC on 1 Mar 2026: in Bucharest (UTC+2) the day turns at 22:00 UTC, in UTC at 00:00.
    const t0 = Date.UTC(2026, 2, 1, 21);
    const cs = [0, 1, 2, 3, 4].map((i) => ({ t: t0 + i * 3_600_000, c: 100 + i }));
    // UTC: 21, 22, 23 on 1 Mar (closes 100–102), 00, 01 on 2 Mar.
    expect(prevDayCloses(cs, 'UTC')).toEqual([null, null, null, 102, 102]);
    // Bucharest: 23:00 on 1 Mar, then 00:00… on 2 Mar.
    expect(prevDayCloses(cs, 'Europe/Bucharest')).toEqual([null, 100, 100, 100, 100]);
    const prev = prevDayCloses(cs, 'UTC');
    expect(dayChange(cs, prev, 4)).toEqual({ abs: 2, pct: (2 / 102) * 100 });
    expect(dayChange(cs, prev, 0)).toBeNull();
  });

  it('write volumes short, in Romanian', () => {
    expect(fmtVolume(950)).toBe('950');
    // Intl puts a no-break space before the unit.
    expect(fmtVolume(1_234_567)).toBe('1,23\u00a0mil.');
    expect(fmtVolume(Number.NaN)).toBe('—');
  });

  it('show the title as chosen and nothing when every part is off', () => {
    expect(statusTitle('symbol', 'BTC/USDT', 'Bitcoin')).toBe('BTC/USDT');
    expect(statusTitle('name', 'BTC/USDT', 'Bitcoin')).toBe('Bitcoin');
    expect(statusTitle('both', 'AAPL', 'Apple Inc.')).toBe('AAPL · Apple Inc.');
    // Without a name (or the same as the symbol): the symbol, once.
    expect(statusTitle('name', 'ETH/USDT', null)).toBe('ETH/USDT');
    expect(statusTitle('both', 'SPX', 'SPX')).toBe('SPX');
    expect(statusLineOn(look({}).status)).toBe(true);
    expect(statusLineOn(look({ status: { logo: false, title: false, volume: false } }).status)).toBe(false);
  });

  it('write a change with one minus sign for both numbers', () => {
    expect(fmtChange({ abs: 141.4, pct: 0.1698 }, 1)).toBe('+141,4 (+0,17%)');
    expect(fmtChange({ abs: -207.5, pct: -0.2531 }, 1)).toBe('−207,5 (−0,25%)');
    expect(fmtChange({ abs: 5, pct: null }, 2)).toBe('+5,00');
    expect(fmtChange({ abs: 0, pct: 0 }, 0)).toBe('0 (0,00%)');
  });
});
