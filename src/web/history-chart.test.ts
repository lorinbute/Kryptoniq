// FD-HISTORYCHART: the 30 days chart's days, series, scale and lines.
import { describe, expect, it } from 'vitest';
import { byDay, chartScale, cnnDay, cryptoDay, daySlots, fearGreedLabel, joined, segments } from './history-chart.ts';

describe('the 30 days chart', () => {
  it('has one slot per day, oldest first, ending today', () => {
    const s = daySlots('2026-10-20', 30);
    expect(s).toHaveLength(30);
    expect(s[0]).toBe('2026-09-21');
    expect(s.at(-1)).toBe('2026-10-20');
  });

  it('puts each index on its own day: crypto on the UTC date, CNN on the New York trading day', () => {
    // alternative.me: 00:00 UTC of the day.
    expect(cryptoDay(Date.parse('2026-10-20T00:00:00Z'))).toBe('2026-10-20');
    // CNN: a close stamped in New York's afternoon is that New York day, also when it is already tomorrow in UTC.
    expect(cnnDay(Date.parse('2026-10-20T23:30:00Z'))).toBe('2026-10-20');
    const m = byDay(
      [
        { t: '2026-10-19', v: 40 },
        { t: '2026-10-20', v: 41 },
        { t: '2026-10-20', v: 42 },
        { t: '2026-10-18', v: Number.NaN },
      ],
      (p) => p.t,
      (p) => p.v,
    );
    expect([...m]).toEqual([
      ['2026-10-19', 40],
      ['2026-10-20', 42],
    ]);
  });

  it('zooms on what is shown, always with 50, at least 4 points, within 0–100', () => {
    // Sentiq's real days (47–49): a few points around them, 50 inside.
    expect(chartScale([47.2, 48.9])).toEqual({ lo: 46, hi: 51 });
    expect(chartScale([46.5, 52])).toEqual({ lo: 45, hi: 53 });
    // With Fear & Greed: its wider range, a tenth of it as margin.
    expect(chartScale([20, 81])).toEqual({ lo: 13, hi: 88 });
    expect(chartScale([2, 99])).toEqual({ lo: 0, hi: 100 });
    expect(chartScale([50, 50])).toEqual({ lo: 48, hi: 52 });
    expect(chartScale([])).toEqual({ lo: 48, hi: 52 });
  });

  it('breaks a line on a day without a value; or joins over it', () => {
    const slots = ['d1', 'd2', 'd3', 'd4', 'd5'];
    const v = new Map([
      ['d1', 48],
      ['d2', 49],
      ['d4', 47],
    ]);
    expect(segments(slots, v)).toEqual([
      [
        { i: 0, v: 48 },
        { i: 1, v: 49 },
      ],
      [{ i: 3, v: 47 }],
    ]);
    expect(joined(slots, v)).toEqual([
      { i: 0, v: 48 },
      { i: 1, v: 49 },
      { i: 3, v: 47 },
    ]);
    expect(segments(slots, new Map())).toEqual([]);
  });
});

describe('Fear & Greed in words', () => {
  it('by each index\'s own bands', () => {
    expect(['crypto', 'cnn'].map((k) => [10, 30, 45, 50, 60, 80].map((v) => fearGreedLabel(v, k as 'crypto' | 'cnn')))).toEqual([
      ['frică extremă', 'frică', 'frică', 'neutru', 'lăcomie', 'lăcomie extremă'],
      ['frică extremă', 'frică', 'neutru', 'neutru', 'lăcomie', 'lăcomie extremă'],
    ]);
    expect(fearGreedLabel(46, 'crypto')).toBe('frică');
    expect(fearGreedLabel(47, 'crypto')).toBe('neutru');
    expect(fearGreedLabel(55, 'cnn')).toBe('neutru');
    expect(fearGreedLabel(56, 'cnn')).toBe('lăcomie');
  });
});
