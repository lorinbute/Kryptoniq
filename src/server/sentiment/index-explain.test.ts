// FD-INDEXWHY: "Cum s-a calculat?" tells the index step by step, from the same selection, weighing and cap: the same
// numbers as the index itself.
import { describe, expect, it } from 'vitest';
import { dayBounds } from '../../shared/time.ts';
import { computeIndex, DEFAULT_INDEX_PARAMS, effects, explainIndex, indexValue, type IndexItem } from './daily-index.ts';

const H = 3_600_000;
const day = dayBounds('2026-10-12', 'Europe/Bucharest');
const asOf = day.start + 12 * H;

let seq = 0;
function item(over: Partial<IndexItem> = {}): IndexItem {
  seq++;
  return {
    id: `n${seq}`,
    title: `t${seq}`,
    url: null,
    sourceId: `s${seq % 5}`,
    sourceName: `S${seq % 5}`,
    sourceWeight: 1,
    category: 'crypto',
    publishedAt: day.start + 10 * H,
    relevance: 1,
    impact: 1,
    flags: [],
    clusterId: `c${seq}`,
    sentiment: 0,
    ...over,
  };
}

/** A day with everything that weighs: a story from 3 sources, a noisy source, flags, old news, other categories, the unscored. */
function busyDay(): IndexItem[] {
  return [
    ...['a', 'b', 'c'].map((s) => item({ sentiment: -0.7, clusterId: 'story', sourceId: s, sourceName: s.toUpperCase(), impact: 3 })),
    ...Array.from({ length: 12 }, () => item({ sentiment: 0.6, sourceId: 'spam', sourceName: 'Spam' })),
    item({ sentiment: 0.9, flags: ['sponsored'], sourceId: 'd', sourceName: 'D' }),
    item({ sentiment: 0.4, flags: ['speculative'], sourceId: 'e', sourceName: 'E', sourceWeight: 1.2 }),
    item({ sentiment: -0.3, publishedAt: day.start + 1 * H, sourceId: 'f', sourceName: 'F' }),
    item({ sentiment: 0, category: 'macro', relevance: 0.8, sourceId: 'g', sourceName: 'G' }),
    item({ sentiment: -0.5, category: 'geopolitics', relevance: 0.8, impact: 3, sourceId: 'h', sourceName: 'H' }),
    item({ sentiment: 0.2, category: 'stocks', impact: 2, sourceId: 'i', sourceName: 'I' }),
    item({ sentiment: null }),
    item({ relevance: 0, sentiment: -1 }),
    item({ publishedAt: asOf + 1, sentiment: 1 }),
  ];
}

describe('explaining the daily index', () => {
  it('gives the same numbers as the index: mean, weight, index, confidence, counts, categories', () => {
    const items = busyDay();
    const r = computeIndex(items, day, asOf);
    const e = explainIndex(items, day, asOf);
    expect(e.total).toMatchObject({ raw: r.raw, weight: r.weight, index: r.index, confidence: r.confidence });
    expect(e.counts).toEqual(r.counts);
    expect(e.breakdown).toEqual(r.breakdown);
    // The step towards neutral, then the 0–100 scale, give the index.
    const p = DEFAULT_INDEX_PARAMS;
    expect(e.total.shrunk).toBeCloseTo((r.raw * r.weight) / (r.weight + p.shrinkK), 12);
    expect(Math.round((50 + 50 * Math.tanh(p.gamma * e.total.shrunk)) * 10) / 10).toBe(r.index);
  });

  it('every item counted, heaviest first: its terms multiply to its weight; contributions add up to the mean, shares to 1', () => {
    const e = explainIndex(busyDay(), day, asOf);
    expect(e.items).toHaveLength(e.counts.positive + e.counts.neutral + e.counts.negative);
    for (let k = 1; k < e.items.length; k++) expect(e.items[k - 1]!.weight).toBeGreaterThanOrEqual(e.items[k]!.weight);
    for (const it of e.items) {
      expect(it.relevance * it.impact * it.sourceWeight * it.spec * it.decay * it.cluster * it.cap).toBeCloseTo(it.weight, 12);
      expect(it.contribution).toBeCloseTo(it.share * it.sentiment, 12);
    }
    expect(e.items.reduce((a, it) => a + it.contribution, 0)).toBeCloseTo(e.total.raw, 12);
    expect(e.items.reduce((a, it) => a + it.share, 0)).toBeCloseTo(1, 12);
  });

  it('names each term: the story (3 sources), the flags, the freshness', () => {
    const e = explainIndex(busyDay(), day, asOf);
    const story = e.items.filter((it) => it.clusterN === 3);
    expect(story).toHaveLength(3);
    expect(story[0]!.cluster).toBeCloseTo((1 + 0.5 * Math.log2(3)) / 3, 12);
    expect(e.items.find((it) => it.flags.includes('sponsored'))?.spec).toBe(0.2);
    expect(e.items.find((it) => it.flags.includes('speculative'))?.spec).toBe(0.5);
    // 2 h old: 2^(−2/8); 11 h old: 2^(−11/8).
    expect(e.items.find((it) => it.source === 'F')?.decay).toBeCloseTo(Math.pow(0.5, 11 / 8), 12);
    expect(e.items.find((it) => it.source === 'A')?.decay).toBeCloseTo(Math.pow(0.5, 2 / 8), 12);
  });

  it('the source cap: with 4 or more sources the noisy one is cut to 25 %; under 4, untouched', () => {
    const e = explainIndex(busyDay(), day, asOf);
    expect(e.capActive).toBe(true);
    const spam = e.sources.find((s) => s.id === 'spam')!;
    expect(spam.count).toBe(12);
    expect(spam.weight).toBeLessThan(spam.base);
    expect(spam.weight / e.total.weight).toBeCloseTo(0.25, 6);
    expect(e.items.filter((it) => it.source === 'Spam').every((it) => it.cap < 1)).toBe(true);
    expect(e.sources.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(e.total.weight, 12);

    const few = explainIndex([item({ sentiment: 1, sourceId: 'x' }), item({ sentiment: 1, sourceId: 'x' }), item({ sentiment: -1, sourceId: 'y' })], day, asOf);
    expect(few.capActive).toBe(false);
    expect(few.items.every((it) => it.cap === 1)).toBe(true);
  });

  it('without news: nothing counted, 50 and low confidence', () => {
    const e = explainIndex([item({ sentiment: null }), item({ relevance: 0, sentiment: 1 })], day, asOf);
    expect(e.items).toEqual([]);
    expect(e.sources).toEqual([]);
    expect(e.total).toEqual({ raw: 0, weight: 0, shrunk: 0, index: 50, value: 50, confidence: 'low' });
    expect(e.counts).toMatchObject({ pending: 1, excluded: 1 });
  });
});

describe('the explanation, edge cases', () => {
  it('an item of a source weighing nothing: weight 0, last, and not "cut" by the cap', () => {
    const items = [...busyDay(), item({ sentiment: 0.5, sourceId: 'zero', sourceName: 'Zero', sourceWeight: 0 })];
    const e = explainIndex(items, day, asOf);
    const z = e.items.at(-1)!;
    expect(z).toMatchObject({ source: 'Zero', weight: 0, cap: 1, share: 0, contribution: 0 });
    expect(e.sources.find((s) => s.id === 'zero')).toMatchObject({ sourceWeight: 0, count: 1, base: 0, weight: 0 });
    expect(e.total.index).toBe(computeIndex(items, day, asOf).index);
  });
});

describe('how much one item moved the index (FD-WHYPLAIN)', () => {
  it('is the index computed again without it, unrounded: the same as the index of the day without that item', () => {
    const items = busyDay();
    const e = explainIndex(items, day, asOf);
    const ids = e.items.slice(0, 5).map((it) => it.id);
    const m = effects(items, day, asOf, ids);
    for (const id of ids) {
      const without = computeIndex(items.filter((it) => it.id !== id), day, asOf);
      expect(m.get(id)!.without).toBeCloseTo(indexValue(without.raw, without.weight, DEFAULT_INDEX_PARAMS), 12);
      expect(m.get(id)!.effect).toBeCloseTo(e.total.value - m.get(id)!.without, 12);
      expect(Math.round(m.get(id)!.without * 10) / 10).toBe(without.index);
    }
    // A bearish item pulled it down, a bullish one up (both of sources the cap did not cut).
    const bear = e.items.find((it) => it.sentiment < -0.5 && it.cap === 1)!;
    const bull = e.items.find((it) => it.sentiment > 0.3 && it.cap === 1)!;
    expect(effects(items, day, asOf, [bear.id]).get(bear.id)!.effect).toBeLessThan(0);
    expect(effects(items, day, asOf, [bull.id]).get(bull.id)!.effect).toBeGreaterThan(0);
  });

  it('an item of a source cut by the cap barely moves it: without it the source still weighs its 25 %', () => {
    const items = busyDay();
    const spam = explainIndex(items, day, asOf).items.find((it) => it.source === 'Spam')!;
    expect(spam.cap).toBeLessThan(1);
    // All of that source score the same here: its part of the mean does not change at all.
    expect(effects(items, day, asOf, [spam.id]).get(spam.id)!.effect).toBeCloseTo(0, 12);
  });

  it('a lone item: without it the day is neutral (50); an unknown id moves nothing', () => {
    const one = item({ sentiment: 0.8 });
    const m = effects([one], day, asOf, [one.id, 'nope']);
    expect(m.get(one.id)!.without).toBe(50);
    expect(m.get(one.id)!.effect).toBeGreaterThan(0);
    expect(m.get('nope')!.effect).toBe(0);
  });
});
