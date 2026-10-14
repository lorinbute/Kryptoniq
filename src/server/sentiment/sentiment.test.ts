import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dayBounds } from '../../shared/time.ts';
import { combine, labelFor } from './engine.ts';
import { capSourceShares, computeIndex, DEFAULT_INDEX_PARAMS, intradaySeries, toIndex, type IndexItem } from './daily-index.ts';
import { LocalEngine, type NliScorer } from './local.ts';
import { applyRules } from './rules.ts';

const headlines = JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/headlines.json', import.meta.url)), 'utf8')) as [string, number][];
const lab = (s: number) => (s > 0.2 ? 1 : s < -0.2 ? -1 : 0);

describe('domain rules', () => {
  it('never inverts the polarity of the labelled headline set and labels ≥ 44/50 exactly', () => {
    let exact = 0;
    const flips: string[] = [];
    for (const [title, gold] of headlines) {
      const p = lab(applyRules(title).score);
      if (p === gold) exact++;
      else if (p !== 0 && gold !== 0) flips.push(title);
    }
    expect(flips).toEqual([]);
    expect(exact).toBeGreaterThanOrEqual(44);
  });

  it('handles negation', () => {
    const r = applyRules('Bitcoin fails to break above $90K');
    expect(r.hits[0]).toMatchObject({ id: 'risk-up', negated: true });
    expect(r.score).toBeLessThan(0);
  });

  it('specific rules win over generic ones (span consumption)', () => {
    const r = applyRules('Treasury yields jump while bitcoin hits lowest level since 2023');
    expect(r.hits.map((h) => h.id)).toEqual(['yields-up', 'capitulation']);
    expect(applyRules('Powell: no hurry to cut rates').score).toBe(-0.6);
    expect(applyRules('Bank of Japan raises rates, yen surges').score).toBeLessThan(-0.5);
    expect(applyRules('SEC denies approval of spot XRP ETF').score).toBeLessThan(0);
  });

  it('returns 0 without hits', () => {
    expect(applyRules('Lorem ipsum dolor sit amet')).toEqual({ score: 0, hits: [] });
  });
});

describe('engine combination', () => {
  it('rules dominate when they fire, model alone otherwise, rules alone without model', () => {
    expect(combine(0.5, -0.5, 1)).toBeCloseTo(-0.1, 10);
    expect(combine(0.5, 0, 0)).toBe(0.5);
    expect(combine(null, -0.7, 2)).toBe(-0.7);
    expect(combine(null, 0, 0)).toBe(0);
    expect(combine(5, 5, 1)).toBe(1);
  });
  it('labels with ±0.2 thresholds', () => {
    expect([0.21, 0.2, -0.2, -0.21].map(labelFor)).toEqual(['positive', 'neutral', 'neutral', 'negative']);
  });
  it('LocalEngine falls back to rules when the model is unavailable', async () => {
    const nli: NliScorer = {
      status: () => ({ state: 'failed', progress: null, error: 'offline', model: 'x' }),
      warmUp: () => {},
      score: async () => null,
      onReady: () => {},
    };
    const [r] = await new LocalEngine(nli).score([{ id: 'a', title: 'Exchange hacked, $10M stolen', summary: '' }]);
    expect(r).toMatchObject({ id: 'a', engine: 'rules', label: 'negative' });
    const withModel: NliScorer = { ...nli, score: async () => 0.9 };
    const [m] = await new LocalEngine(withModel).score([{ id: 'b', title: 'Nothing matches here', summary: '' }]);
    expect(m).toMatchObject({ engine: 'local', score: 0.9, label: 'positive' });
  });
});

const H = 3_600_000;
const day = dayBounds('2026-10-12', 'Europe/Bucharest');

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

describe('daily index', () => {
  const asOf = day.start + 12 * H;

  it('is neutral (50, low confidence) without news', () => {
    const r = computeIndex([], day, asOf);
    expect(r).toMatchObject({ index: 50, confidence: 'low', counts: { positive: 0, neutral: 0, negative: 0, pending: 0, excluded: 0 } });
  });

  it('moves with the weighted sentiment and is shrunk toward 50 with little evidence', () => {
    const few = computeIndex([item({ sentiment: 1 })], day, asOf);
    const many = computeIndex(Array.from({ length: 30 }, () => item({ sentiment: 1 })), day, asOf);
    expect(few.index).toBeGreaterThan(50);
    expect(many.index).toBeGreaterThan(few.index);
    expect(many.confidence).toBe('high');
    const bearish = computeIndex(Array.from({ length: 30 }, () => item({ sentiment: -1 })), day, asOf);
    expect(bearish.index).toBeCloseTo(100 - many.index, 5);
  });

  it('ignores news outside the window, after asOf, irrelevant ones, and counts pending ones', () => {
    const r = computeIndex(
      [
        item({ publishedAt: day.start - 1, sentiment: -1 }),
        item({ publishedAt: day.end, sentiment: -1 }),
        item({ publishedAt: asOf + 1, sentiment: -1 }),
        item({ relevance: 0, sentiment: -1 }),
        item({ sentiment: null }),
        item({ sentiment: 0.5 }),
      ],
      day,
      asOf,
    );
    expect(r.counts).toEqual({ positive: 1, neutral: 0, negative: 0, pending: 1, excluded: 1 });
    expect(r.index).toBeGreaterThan(50);
  });

  it('a story covered by many outlets counts about once (with a small boost)', () => {
    const single = computeIndex([item({ sentiment: -1, sourceId: 'a' }), item({ sentiment: 1, sourceId: 'b' })], day, asOf);
    expect(single.index).toBeCloseTo(50, 5);
    const clustered = computeIndex(
      [...Array.from({ length: 6 }, (_, k) => item({ sentiment: -1, clusterId: 'same', sourceId: `x${k}` })), item({ sentiment: 1, sourceId: 'b' })],
      day,
      asOf,
    );
    const separate = computeIndex(
      [...Array.from({ length: 6 }, (_, k) => item({ sentiment: -1, sourceId: `x${k}` })), item({ sentiment: 1, sourceId: 'b' })],
      day,
      asOf,
    );
    expect(clustered.index).toBeLessThan(50);
    expect(clustered.index).toBeGreaterThan(separate.index + 5); // ≈2.3× one story, not 6×
  });

  it('caps the share of a single noisy source', () => {
    const noisy = Array.from({ length: 50 }, () => item({ sentiment: 1, sourceId: 'spam' }));
    const others = ['a', 'b', 'c', 'd'].map((s) => item({ sentiment: -1, sourceId: s }));
    const r = computeIndex([...noisy, ...others], day, asOf);
    expect(r.raw).toBeLessThan(-0.4); // spam limited to 25% of the weight
  });

  it('recent news weigh more (8h half-life)', () => {
    const r = computeIndex([item({ sentiment: -1, publishedAt: day.start + 1 * H }), item({ sentiment: 1, publishedAt: day.start + 11 * H })], day, asOf);
    expect(r.raw).toBeGreaterThan(0.3);
  });

  it('sponsored and speculative items weigh less', () => {
    const r = computeIndex([item({ sentiment: 1, flags: ['sponsored'] }), item({ sentiment: -1 })], day, asOf);
    expect(r.raw).toBeLessThan(-0.5);
  });

  it('reports drivers and a per-category breakdown', () => {
    const r = computeIndex(
      [item({ sentiment: 0.9, title: 'good' }), item({ sentiment: -0.8, title: 'bad', category: 'macro' }), item({ sentiment: 0.1, title: 'meh' })],
      day,
      asOf,
    );
    expect(r.drivers.positive[0]!.title).toBe('good');
    expect(r.drivers.negative[0]!.title).toBe('bad');
    expect(r.breakdown.macro.index).toBeLessThan(50);
    expect(r.breakdown.crypto.index).toBeGreaterThan(50);
    expect(r.breakdown.geopolitics).toMatchObject({ index: 50, count: 0 });
  });

  it('toIndex is bounded and symmetric', () => {
    expect(toIndex(1, 1e9, DEFAULT_INDEX_PARAMS)).toBeLessThanOrEqual(100);
    expect(toIndex(-1, 1e9, DEFAULT_INDEX_PARAMS)).toBeGreaterThanOrEqual(0);
    expect(toIndex(0.3, 5, DEFAULT_INDEX_PARAMS) + toIndex(-0.3, 5, DEFAULT_INDEX_PARAMS)).toBeCloseTo(100, 5);
  });

  it('intraday series has one point per elapsed hour (+ partial hour)', () => {
    const s = intradaySeries([item({ sentiment: 1, publishedAt: day.start + 2.5 * H })], day, day.start + 4.5 * H);
    expect(s.map((p) => (p.t - day.start) / H)).toEqual([1, 2, 3, 4, 4.5]);
    expect(s[1]!.index).toBe(50);
    expect(s[2]!.index).toBeGreaterThan(50);
  });

  it('handles DST days (Europe/Bucharest 2026-10-25 lasts 25 hours)', () => {
    const d = dayBounds('2026-10-25', 'Europe/Bucharest');
    expect((d.end - d.start) / H).toBe(25);
  });
});

describe('ClaudeEngine circuit breaker', () => {
  it('stops calling Claude after an invalid key and falls back to the local engine', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { ClaudeEngine } = await import('./claude.ts');
    const { silentLogger } = await import('../log.ts');
    let calls = 0;
    const client = {
      beta: {
        messages: {
          parse: async () => {
            calls++;
            throw new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers());
          },
        },
      },
    };
    const local = new LocalEngine({ status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} });
    const engine = new ClaudeEngine({ apiKey: 'k', model: 'claude-opus-5-5', log: silentLogger, client: client as never }, local);
    const items = [{ id: 'a', title: 'Exchange hacked', summary: '' }];
    const r1 = await engine.score(items);
    const r2 = await engine.score(items);
    expect(calls).toBe(1);
    expect(r1[0]).toMatchObject({ engine: 'rules', label: 'negative' });
    expect(r2[0]).toMatchObject({ engine: 'rules' });
    expect(engine.status().lastError).toMatchObject({ permanent: true });
  });

  it('tells what each answered call cost: headlines and tokens (FD-AICLARITY)', async () => {
    const { ClaudeEngine } = await import('./claude.ts');
    const { silentLogger } = await import('../log.ts');
    const client = { beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 640, output_tokens: 120 }, parsed_output: { results: [{ n: 1, score: 0.5, impact: 1 }] } }) } } };
    const local = new LocalEngine({ status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} });
    const seen: unknown[] = [];
    const engine = new ClaudeEngine({ apiKey: 'k', model: 'claude-opus-5-5', log: silentLogger, client: client as never, onUsage: (u) => seen.push(u) }, local);
    await engine.score([
      { id: 'a', title: 'Fed cuts rates', summary: '' },
      { id: 'b', title: 'Exchange hacked', summary: '' },
    ]);
    expect(seen).toEqual([{ items: 2, input: 640, output: 120 }]);
  });

  it('uses Claude scores when available and fills missing ones locally', async () => {
    const { ClaudeEngine } = await import('./claude.ts');
    const { silentLogger } = await import('../log.ts');
    const client = { beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: { results: [{ n: 1, score: 0.9, impact: 3 }] } }) } } };
    const local = new LocalEngine({ status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} });
    const engine = new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-5-5', log: silentLogger, client: client as never }, local);
    const out = await engine.score([
      { id: 'a', title: 'Fed cuts rates', summary: '' },
      { id: 'b', title: 'Exchange hacked', summary: '' },
    ]);
    expect(out.find((o) => o.id === 'a')).toMatchObject({ engine: 'claude:claude-haiku-5-5', score: 0.9, label: 'positive' });
    expect(out.find((o) => o.id === 'b')).toMatchObject({ engine: 'rules', label: 'negative' });
  });
});

describe('scanner summary', () => {
  it('reports a 24h change only for timeframes up to 1 day', async () => {
    const { summarize } = await import('../scanner/scanner.ts');
    const { runSlingshot } = await import('../../shared/indicator/slingshot.ts');
    const { DEFAULT_SLINGSHOT_PARAMS } = await import('../../shared/indicator/params.ts');
    const candles = Array.from({ length: 30 }, (_, i) => ({ t: i * H, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
    const r = runSlingshot({ candles, chartTfSec: 3600, msTfSec: 3600, params: DEFAULT_SLINGSHOT_PARAMS, nowMs: 100 * H });
    expect(summarize('X', 'X/USDT', '1h', r, candles, 2).change24h).toBeCloseTo(((129 - 105) / 105) * 100, 9);
    expect(summarize('X', 'X/USDT', '1w', r, candles, 2).change24h).toBeNull();
  });
});

describe('capSourceShares', () => {
  it('leaves balanced or small sets alone', () => {
    const m = new Map([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    expect(capSourceShares(m, 0.25)).toEqual(m);
  });
  it('clips dominant sources so none exceeds the cap', () => {
    const out = capSourceShares(
      new Map([
        ['spam', 100],
        ['a', 1],
        ['b', 1],
        ['c', 1],
        ['d', 1],
      ]),
      0.25,
    );
    const total = [...out.values()].reduce((x, y) => x + y, 0);
    for (const w of out.values()) expect(w / total).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(out.get('a')).toBe(1);
  });
});
