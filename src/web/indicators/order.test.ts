// FD-PICKERSORT: the "Indicatori" window's lists, alphabetical by the name shown.
import { describe, expect, it } from 'vitest';
import { LMA_TITLE } from '../../shared/indicator/lma-params.ts';
import { SLINGSHOT_TITLE } from '../../shared/indicator/params.ts';
import { STUDY_META } from './catalog-meta.ts';
import { compareIndicatorNames } from './order.ts';

const sorted = (names: string[]) => [...names].sort(compareIndicatorNames);

describe('the order of the indicators', () => {
  it('ignores case, diacritics and punctuation; numbers go by value', () => {
    expect(sorted(['zeta', 'Alpha', 'ălfa', 'beta'])).toEqual(['Alpha', 'ălfa', 'beta', 'zeta']);
    expect(sorted([SLINGSHOT_TITLE, LMA_TITLE, 'Detrended Price Oscillator (DPO)', 'Bollinger Bands (BB)'])).toEqual([
      'Bollinger Bands (BB)',
      // "[DE] Logarithmic …" and "[DE] Slingshot …" read as "DE L…" and "DE S…": among the D's, before "Det…".
      LMA_TITLE,
      SLINGSHOT_TITLE,
      'Detrended Price Oscillator (DPO)',
    ]);
    expect(sorted(['EMA 10', 'EMA 2'])).toEqual(['EMA 2', 'EMA 10']);
  });

  it('sorts the whole catalog with the premium ones, losing none; "24-hour Volume" comes first', () => {
    const names = [...STUDY_META.map((m) => m.name), SLINGSHOT_TITLE, LMA_TITLE];
    const out = sorted(names);
    expect(out).toHaveLength(names.length);
    expect(new Set(out)).toEqual(new Set(names));
    expect(out[0]).toBe('24-hour Volume');
    for (let i = 1; i < out.length; i++) expect(compareIndicatorNames(out[i - 1] as string, out[i] as string)).toBeLessThanOrEqual(0);
  });
});
