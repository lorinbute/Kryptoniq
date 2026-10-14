// FD-IMPACT: the importance Claude gives a news item weighs it in the daily index (keywords only for news scored
// locally); geopolitics linked to markets at 0.8; the history recomputed once, sparing days the retention thinned.
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import { CoinDetector } from '../news/coins.ts';
import { ingestItems, retagRecent } from '../news/ingest.ts';
import { queryNews, newsQuerySchema } from '../news/query.ts';
import { classify, GEO_RELEVANCE } from '../news/classify.ts';
import { DailySentimentService, DAILY_JOB, INDEX_VERSION, MAINTENANCE_JOB } from './daily.ts';
import { LocalEngine, type NliScorer } from './local.ts';
import { SentimentService } from './service.ts';
import type { SentimentEngine } from './engine.ts';

const noModel: NliScorer = { status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} };
const DAY = 86_400_000;

async function setup() {
  const db = await testDb();
  const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
  await settings.updateFor(1, true, { timezone: 'UTC' });
  await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
  return { db, settings, daily: new DailySentimentService(db, settings) };
}

/** A scored news item: `impact` by keywords, `ai` by Claude (null = scored locally). */
async function addNews(db: Db, id: string, at: number, sentiment: number, impact: number, ai: number | null) {
  await db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine, sentiment_impact)
     VALUES (?, 's1', ?, ?, ?, 'crypto', 1, ?, ?, ?, 'x', ?, ?)`,
    [id, `Story ${id}`, at, at, impact, id, sentiment, ai === null ? 'local' : 'claude:claude-opus-5-5', ai],
  );
}

describe('Claude engine importance', () => {
  it('rounds and limits it to 1–3; the local fallback gives none', async () => {
    const { ClaudeEngine } = await import('./claude.ts');
    const client = {
      beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: { results: [{ n: 1, score: 0.9, impact: 2.6 }, { n: 2, score: -0.4, impact: 7 }] } }) } },
    };
    const engine = new ClaudeEngine({ apiKey: 'k', model: 'claude-opus-5-5', log: silentLogger, client: client as never }, new LocalEngine(noModel));
    const out = await engine.score([
      { id: 'a', title: 'Fed cuts rates', summary: '' },
      { id: 'b', title: 'Chip selloff deepens', summary: '' },
      { id: 'c', title: 'Exchange hacked', summary: '' },
    ]);
    expect(out.find((o) => o.id === 'a')).toMatchObject({ impact: 3, meta: { impact: 3 } });
    expect(out.find((o) => o.id === 'b')?.impact).toBe(3);
    expect(out.find((o) => o.id === 'c')).toMatchObject({ engine: 'rules' });
    expect(out.find((o) => o.id === 'c')?.impact).toBeUndefined();
  });
});

describe('storing the importance with the score', () => {
  it('is written by the scoring, cleared by a reset or a new title, and never touched by a re-tag', async () => {
    const { db, settings } = await setup();
    const svc = new SentimentService(db, settings, noModel, silentLogger);
    const claudeLike: SentimentEngine = {
      id: 'claude:test',
      score: async (items) => items.map((i) => ({ id: i.id, score: -0.5, label: 'negative' as const, engine: 'claude:test', impact: 1, meta: { impact: 1 } })),
    };
    (svc as unknown as { engine: () => SentimentEngine }).engine = () => claudeLike;
    const det = new CoinDetector([]);
    const now = Date.now();
    const item = { guid: 'g1', link: 'https://example.com/a', title: 'Bitcoin exchange hacked for $5M', summary: '', publishedAt: now - 60_000 };
    await ingestItems(db, { id: 's1', category: 'crypto' }, [item], det, now);
    const row = () => db.get<{ impact: number; sentiment_impact: number | null; sentiment: number | null }>('SELECT impact, sentiment_impact, sentiment FROM news');
    expect(await row()).toMatchObject({ impact: 3, sentiment_impact: null, sentiment: null });
    await svc.scorePending();
    expect(await row()).toMatchObject({ impact: 3, sentiment_impact: 1, sentiment: -0.5 });
    // A re-tag (watchlist or coin list changed) recomputes the keyword importance only.
    await retagRecent(db, det, 0);
    expect(await row()).toMatchObject({ impact: 3, sentiment_impact: 1 });
    // A new title at the source: score and importance are redone.
    await ingestItems(db, { id: 's1', category: 'crypto' }, [{ ...item, title: 'Bitcoin exchange hacked for $50M' }], det, now);
    expect(await row()).toMatchObject({ sentiment_impact: null, sentiment: null });
    await svc.scorePending();
    expect((await row())?.sentiment_impact).toBe(1);
    expect(await svc.reset(0)).toBe(1);
    expect(await row()).toMatchObject({ sentiment_impact: null, sentiment: null });
  });
});

describe('the daily index uses the importance', () => {
  it("takes Claude's when there is one, the keywords' otherwise", async () => {
    const { db, daily } = await setup();
    const at = Date.UTC(2026, 9, 12, 10);
    // +1 that keywords call a market mover but Claude a minor item; −1 scored locally (keywords: 1).
    await addNews(db, 'up', at, 1, 3, 1);
    await addNews(db, 'down', at, -1, 1, null);
    const day = await daily.computeDay('2026-10-12', 'UTC', at + 3_600_000, false);
    // With the keyword importance it would be (3 − 1) / 4 = +0.5; with Claude's, the two weigh the same.
    expect(day.raw).toBeCloseTo(0, 10);
    const page = await queryNews(db, newsQuerySchema.parse({ range: '7d' }), 'UTC', 1, at + 3_600_000);
    expect(page.items.find((i) => i.id === 'up')).toMatchObject({ impact: 1, impactSource: 'ai', ruleImpact: 3 });
    expect(page.items.find((i) => i.id === 'down')).toMatchObject({ impact: 1, impactSource: 'rules', ruleImpact: 1 });
  });
});

describe('geopolitics (FD-IMPACT §2)', () => {
  it('weighs 0.8 when linked to markets, nothing otherwise', () => {
    expect(GEO_RELEVANCE).toBe(0.8);
    expect(classify('geopolitics', 'Trump threatens new tariffs on EU', '', []).relevance).toBe(0.8);
    expect(classify('geopolitics', 'Royal wedding draws crowds', '', []).relevance).toBe(0);
  });
});

describe('recomputing the history (FD-IMPACT §3)', () => {
  it('happens once, and spares the days the retention has thinned out', async () => {
    const { db, daily } = await setup();
    const now = Date.UTC(2026, 9, 13, 12);
    for (const d of [10, 11, 12]) await addNews(db, `n${d}`, Date.UTC(2026, 9, d, 9), 0.5, 1, 1);
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) {
      await db.run(
        `INSERT INTO daily_sentiment(day, tz, value, raw, confidence, counts, breakdown, drivers, computed_at, final) VALUES (?, 'UTC', 99, 1, 'high', '{}', '{}', '{}', 1, 1)`,
        [d],
      );
    }
    // A zone nobody uses any more: its complete days go too (rebuilt the new way if someone picks it again).
    await db.run(`INSERT INTO daily_sentiment(day, tz, value, raw, confidence, counts, breakdown, drivers, computed_at, final) VALUES ('2026-10-12', 'Asia/Tokyo', 99, 1, 'high', '{}', '{}', '{}', 1, 1)`);
    // The retention has deleted news up to 10 Oct, 18:00: that day is incomplete, the next ones are not.
    await writeJobData(db, MAINTENANCE_JOB, { retentionCutoff: Date.UTC(2026, 9, 10, 18) });
    expect(await daily.upgradeHistory(now)).toBe(true);
    const value = async (day: string) => (await db.get<{ value: number }>("SELECT value FROM daily_sentiment WHERE day = ? AND tz = 'UTC'", [day]))?.value;
    expect(await value('2026-10-10')).toBe(99);
    expect(await value('2026-10-11')).not.toBe(99);
    expect(await value('2026-10-12')).not.toBe(99);
    expect(await db.get("SELECT 1 AS x FROM daily_sentiment WHERE tz = 'Asia/Tokyo'")).toBeUndefined();
    expect((await readJobData(db, DAILY_JOB, { indexVersion: 1 })).indexVersion).toBe(INDEX_VERSION);
    // Only once.
    await db.run("UPDATE daily_sentiment SET value = 77 WHERE day = '2026-10-12'");
    expect(await daily.upgradeHistory(now)).toBe(false);
    expect(await value('2026-10-12')).toBe(77);
    // Without a retention threshold, the admin's recomputation redoes every day it has news for.
    await writeJobData(db, MAINTENANCE_JOB, { retentionCutoff: 0 });
    await daily.recomputeHistory(now + DAY);
    expect(await value('2026-10-10')).not.toBe(99);
  });
});
