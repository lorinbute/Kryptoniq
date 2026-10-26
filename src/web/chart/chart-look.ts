// FD-CHARTSETTINGS: what the chart's settings decide outside the chart itself: its time zone and decimals, and the
// status line's numbers (the candle's change, the day's change, the volume).
import type { ChartStyle } from '../../shared/chart-style.ts';

/** Whether the browser knows the zone (an IANA name such as "Europe/Bucharest"). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The chart's time zone: its own when it has one the browser knows, else the account's. */
export const chartTimeZone = (look: ChartStyle, accountTz: string): string => (look.timezone && isTimeZone(look.timezone) ? look.timezone : accountTz);

/** The decimals shown: the pair's, or the ones chosen. */
export const chartPrecision = (look: ChartStyle, pair: number): number => (look.precision === 'default' ? pair : look.precision);

/** A change: by how much and in % of where it started (null when it started at 0). */
export interface Change {
  abs: number;
  pct: number | null;
}

const changeOf = (from: number, to: number): Change => ({ abs: to - from, pct: from !== 0 ? ((to - from) / from) * 100 : null });

/** The candle's change, as TradingView's status line shows it: from the previous candle's close (the first one: its open). */
export function barChange(candles: readonly { o: number; c: number }[], i: number): Change | null {
  const bar = candles[i];
  if (!bar) return null;
  const prev = candles[i - 1];
  return changeOf(prev ? prev.c : bar.o, bar.c);
}

/**
 * For each candle, the close of the day before its own (the last candle of the previous calendar day in `tz`), or null
 * when the history starts that day. Only for candles shorter than a day: a daily or weekly candle's change is its own.
 */
export function prevDayCloses(candles: readonly { t: number; c: number }[], tz: string): (number | null)[] {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let key = '';
  let prevClose: number | null = null;
  let lastClose: number | null = null;
  candles.forEach((k, i) => {
    const d = day.format(k.t);
    if (d !== key) {
      // A new day: the day before ends with the candle just seen.
      prevClose = key === '' ? null : lastClose;
      key = d;
    }
    out[i] = prevClose;
    lastClose = k.c;
  });
  return out;
}

/** The change of candle `i`'s close from the day before's close, or null. */
export function dayChange(candles: readonly { c: number }[], prevDay: readonly (number | null)[], i: number): Change | null {
  const bar = candles[i];
  const from = prevDay[i];
  return bar && from != null ? changeOf(from, bar.c) : null;
}

const volumeFmt = new Intl.NumberFormat('ro-RO', { notation: 'compact', maximumFractionDigits: 2 });
/** A volume, short: "12,35 K", "1,23 mil.". */
export const fmtVolume = (v: number): string => (Number.isFinite(v) ? volumeFmt.format(v) : '—');
