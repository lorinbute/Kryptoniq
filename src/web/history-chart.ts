// FD-HISTORYCHART: the 30 days chart: the days, each series by day, the zoomed scale, the pieces of a broken line.
import { addDays, dayKey } from '../shared/time.ts';

/** The `n` days ending with `today`, oldest first. */
export function daySlots(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, k) => addDays(today, k - (n - 1)));
}

/** A series by day: the day of each point in its own clock (the last value of a day wins). */
export function byDay<T>(points: readonly T[], dayOf: (p: T) => string, valueOf: (p: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    const v = valueOf(p);
    if (Number.isFinite(v)) out.set(dayOf(p), v);
  }
  return out;
}

/** Crypto Fear & Greed (alternative.me): one value a day, stamped 00:00 UTC of the day it is for. */
export const cryptoDay = (timestamp: number) => dayKey(timestamp, 'UTC');
/** CNN Fear & Greed: one value per trading day, the day of New York. */
export const cnnDay = (timestamp: number) => dayKey(timestamp, 'America/New_York');

/**
 * The scale of what is shown, zoomed: from a little under the lowest value to a little over the highest (a tenth of the
 * range, at least a point), always with 50; at least 4 points between the ends, within 0–100.
 */
export function chartScale(values: readonly number[]): { lo: number; hi: number } {
  const all = [...values, 50];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = Math.max(1, (max - min) * 0.1);
  let lo = Math.max(0, Math.floor(min - pad));
  let hi = Math.min(100, Math.ceil(max + pad));
  if (hi - lo < 4) {
    const mid = (lo + hi) / 2;
    lo = Math.max(0, Math.floor(mid - 2));
    hi = Math.min(100, lo + 4);
  }
  return { lo, hi };
}

/** The continuous pieces of a series over the days (a day without a value breaks the line). */
export function segments(slots: readonly string[], values: ReadonlyMap<string, number>): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  slots.forEach((day, i) => {
    const v = values.get(day);
    if (v === undefined) {
      if (run.length) out.push(run);
      run = [];
    } else run.push({ i, v });
  });
  if (run.length) out.push(run);
  return out;
}

/** The points of a series over the days, gaps skipped (one line through them: CNN has no weekends). */
export function joined(slots: readonly string[], values: ReadonlyMap<string, number>): { i: number; v: number }[] {
  return slots.flatMap((day, i) => {
    const v = values.get(day);
    return v === undefined ? [] : [{ i, v }];
  });
}

/**
 * A Fear & Greed value in words, by each index's own bands: alternative.me (crypto) 0–24 / 25–46 / 47–54 / 55–75 /
 * 76–100, CNN 0–24 / 25–44 / 45–55 / 56–75 / 76–100.
 */
export function fearGreedLabel(v: number, kind: 'crypto' | 'cnn'): string {
  const [fear, neutral, greed] = kind === 'crypto' ? [25, 47, 55] : [25, 45, 56];
  if (v < fear) return 'frică extremă';
  if (v < neutral) return 'frică';
  if (v < greed) return 'neutru';
  if (v < 76) return 'lăcomie';
  return 'lăcomie extremă';
}
