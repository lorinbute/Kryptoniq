// FD-WHYPLAIN: the explanations in words.
import { describe, expect, it } from 'vitest';
import { effectLine, fmtPoints, weighLine, type Weighs } from './why-text.ts';

const H = 3_600_000;
const base: Weighs = { relevance: 1, impact: 3, sourceWeight: 1.2, spec: 1, flags: [], decay: 0.68, clusterN: 1, cap: 1, share: 0.0038 };

describe('how much a news item moved the index', () => {
  it('in points, signed, with two decimals', () => {
    expect(fmtPoints(0.1)).toBe('+0,10 puncte');
    expect(fmtPoints(-0.204)).toBe('−0,20 puncte');
    expect(fmtPoints(0.004)).toBe('0,00 puncte');
    expect(fmtPoints(-0.001)).toBe('0,00 puncte');
  });

  it('the index without it, against the index now', () => {
    // The index as on the card ("47.9"), the points in the page's style.
    expect(effectLine(47.9, 47.8, 0.1)).toBe('Fără ea, indicele ar fi 47.8 (acum 47.9): +0,10 puncte.');
    expect(effectLine(47.9, 48.1, -0.2)).toBe('Fără ea, indicele ar fi 48.1 (acum 47.9): −0,20 puncte.');
    // Too small to show at one decimal: "tot".
    expect(effectLine(47.9, 47.87, 0.03)).toBe('Fără ea, indicele ar fi tot 47.9: +0,03 puncte.');
  });
});

describe('why it weighs what it weighs', () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  it('against an ordinary item of the day, with its importance, source and age', () => {
    expect(weighLine(base, 1147, 'CoinDesk', now - 4 * H, now, 'Claude')).toBe(
      'Cântărește de 4,4 ori cât o știre obișnuită de azi: importanță 3 (Claude), sursa CoinDesk are greutatea 1,2, e de acum 4 h (mai contează 68%).',
    );
  });

  it('says only the terms that change something: relevance, the story, the flags, the cap', () => {
    const s = weighLine({ ...base, relevance: 0.8, clusterN: 3, spec: 0.5, flags: ['speculative'], cap: 0.6, share: 0.0005 }, 1147, 'Investing.com', now - 35 * 60_000, now, 'cuvinte-cheie');
    expect(s).toBe(
      'Cântărește cât 57% dintr-o știre obișnuită de azi: importanță 3 (cuvinte-cheie), sursa Investing.com are greutatea 1,2, e de acum 35 min (mai contează 68%), relevanță 0,8, preluată de 3 surse (povestea contează aproape o dată), factor 0,5 (speculativ). Sursa ei e tăiată de plafon, deci fiecare știre a ei cântărește cu 40% mai puțin.',
    );
  });
});
