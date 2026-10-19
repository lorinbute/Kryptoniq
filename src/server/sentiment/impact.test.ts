// FD-IMPACT: the importance an AI gives a news item weighs it in the daily index (keywords only for news scored
// locally); geopolitics linked to markets at 0.8; the history recomputed once, sparing days the retention thinned.
// Since FD-AIKEYS the AI is a user's own: its scores and importance count for that user alone.
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
import type { NliScorer } from './local.ts';
import { SentimentService } from './service.ts';
import { AiService } from '../ai/service.ts';
import { AiError, type AiClient } from '../ai/types.ts';

const noModel: NliScorer = { status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} };
const DAY = 86_400_000;

/** An AI that calls everything bearish and minor (−0.5, importance 1). */
const bearish: AiClient = {
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  generate: async (req) => {
    const n = (req.prompt.match(/^\d+\./gm) ?? []).length;
    return { parsed: { results: Array.from({ length: n }, (_, i) => ({ n: i + 1, score: -0.5, impact: 1 })) } as never, stop: 'done', usage: { input: 10, output: 5 } };
  },
};

async function setup() {
  const db = await testDb();
  const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
  await settings.updateFor(1, true, { timezone: 'UTC' });
  await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
  const ai = new AiService({ db, settings, log: silentLogger, clientFactory: () => bearish });
  return { db, settings, ai, daily: new DailySentimentService(db, settings, ai) };
}

/** User 1 has their own Gemini score the news. */
async function aiScoring(settings: SettingsService, ai: AiService) {
  await settings.setAiKey(1, 'gemini', 'AIzaSyD-test-key-0123456789abcdef');
  await settings.updateFor(1, true, { ai: { provider: 'gemini', scoring: true } });
  ai.forget(1);
}

/** A scored news item: `impact` by keywords, `ai` by Claude (null = scored locally). */
async function addNews(db: Db, id: string, at: number, sentiment: number, impact: number, ai: number | null) {
  await db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine, sentiment_impact)
     VALUES (?, 's1', ?, ?, ?, 'crypto', 1, ?, ?, ?, 'x', ?, ?)`,
    [id, `Story ${id}`, at, at, impact, id, sentiment, ai === null ? 'local' : 'claude:claude-opus-5-5', ai],
  );
}

describe("a user's AI importance, stored with their score", () => {
  it('is written by their scoring, cleared by a new title, never touched by a re-tag; the common score stays local', async () => {
    const { db, settings, ai } = await setup();
    await aiScoring(settings, ai);
    const svc = new SentimentService(db, ai, noModel, silentLogger);
    const det = new CoinDetector([]);
    const now = Date.now();
    const item = { guid: 'g1', link: 'https://example.com/a', title: 'Bitcoin exchange hacked for $5M', summary: '', publishedAt: now - 60_000 };
    await ingestItems(db, { id: 's1', category: 'crypto' }, [item], det, now);
    const mine = () => db.get<{ score: number | null; impact: number | null; engine: string }>('SELECT score, impact, engine FROM news_ai_scores WHERE user_id = 1');
    const common = () => db.get<{ impact: number; sentiment_impact: number | null; sentiment_engine: string | null }>('SELECT impact, sentiment_impact, sentiment_engine FROM news');
    expect(await svc.scoreUsers(undefined, now)).toBe(1);
    expect(await mine()).toEqual({ score: -0.5, impact: 1, engine: 'gemini:gemini-3.8-flash' });
    // Scored once: nothing left for the next run.
    expect(await svc.scoreUsers(undefined, now)).toBe(0);
    await svc.scorePending();
    expect(await common()).toMatchObject({ impact: 3, sentiment_impact: null, sentiment_engine: 'rules' });
    // A re-tag (watchlist or coin list changed) recomputes the keyword importance only.
    await retagRecent(db, det, 0);
    expect((await mine())?.impact).toBe(1);
    // A new title at the source: the AI scores it again.
    await ingestItems(db, { id: 's1', category: 'crypto' }, [{ ...item, title: 'Bitcoin exchange hacked for $50M' }], det, now);
    expect(await mine()).toBeUndefined();
    expect(await svc.scoreUsers(undefined, now)).toBe(1);
    // Their own rescoring, then nobody's: the key is gone.
    expect(await svc.resetUser(1, 0)).toBe(1);
    await settings.setAiKey(1, 'gemini', null);
    ai.forget(1);
    expect(await svc.scoreUsers(undefined, now)).toBe(0);
  });

  it('the state of their scoring (an error, its end) is seen by every instance, for that provider, model and key only', async () => {
    const { db, settings, ai } = await setup();
    await aiScoring(settings, ai);
    const now = Date.now();
    await addNews(db, 'n1', now - 3_600_000, 0.2, 1, null);
    let fail = true;
    const flaky = new AiService({
      db,
      settings,
      log: silentLogger,
      clientFactory: (provider, _key, model) => ({
        provider,
        model,
        generate: async (req) => (fail ? Promise.reject(new AiError('gemini', 'auth', 400, 'API key not valid')) : bearish.generate(req)),
      }),
    });
    // The instance running the jobs scores; the other one (the page's) only reads the state.
    const jobs = new SentimentService(db, flaky, noModel, silentLogger);
    const page = new SentimentService(db, ai, noModel, silentLogger);
    expect(await page.aiStatus(1)).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash', lastError: null });
    expect(await jobs.scoreUsers(undefined, now)).toBe(0);
    expect(await page.aiStatus(1)).toMatchObject({ lastError: { permanent: true, message: 'cheia API Google nu este validă' }, pausedUntil: null });
    // Another key: a clean state, and the scoring starts again (the error of the old key is not this one's).
    await settings.setAiKey(1, 'gemini', 'AIzaSyD-other-key-0123456789abcdef');
    ai.forget(1);
    flaky.forget(1);
    expect((await page.aiStatus(1))?.lastError).toBeNull();
    fail = false;
    expect(await jobs.scoreUsers(undefined, now)).toBe(1);
    expect((await page.aiStatus(1))?.lastError).toBeNull();
    // Not scoring: no state.
    await settings.updateFor(1, true, { ai: { scoring: false } });
    ai.forget(1);
    expect(await page.aiStatus(1)).toBeNull();
  });

  it('only the last 48 hours are sent, and only what weighs in the index', async () => {
    const { db, settings, ai } = await setup();
    await aiScoring(settings, ai);
    const svc = new SentimentService(db, ai, noModel, silentLogger);
    const now = Date.UTC(2026, 9, 14, 12);
    await addNews(db, 'new', now - 3_600_000, 0.2, 1, null);
    await addNews(db, 'old', now - 50 * 3_600_000, 0.2, 1, null);
    await addNews(db, 'off', now - 3_600_000, 0.2, 1, null);
    await db.run("UPDATE news SET relevance = 0 WHERE id = 'off'");
    expect(await svc.scoreUsers(undefined, now)).toBe(1);
    expect((await db.all<{ news_id: string }>('SELECT news_id FROM news_ai_scores')).map((r) => r.news_id)).toEqual(['new']);
  });
});

describe('the daily index uses the importance', () => {
  it("takes the AI's when there is one, the keywords' otherwise", async () => {
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

  it("a user's own AI scores count for them alone, in the index, the history and the news list", async () => {
    const { db, settings, ai, daily } = await setup();
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES (N'ana@example.com', N'Ana', N'user', 1)");
    const at = Date.UTC(2026, 9, 12, 10);
    // Two items the local model calls bullish (+0.6), keywords: importance 1.
    await addNews(db, 'a', at, 0.6, 1, null);
    await addNews(db, 'b', at, 0.6, 1, null);
    await aiScoring(settings, ai);
    // User 1's AI scored one of them −0.5 (importance 1); the other it left to the local score.
    await db.run("INSERT INTO news_ai_scores(user_id, news_id, score, label, engine, impact, scored_at) VALUES (1, 'a', -0.5, 'negative', 'gemini:x', 1, 1), (1, 'b', NULL, NULL, 'gemini:x', NULL, 1)");
    expect(await daily.scopeFor(1)).toBe(1);
    expect(await daily.scopeFor(2)).toBeNull();
    const asOf = at + 3_600_000;
    const theirs = await daily.computeDay('2026-10-12', 'UTC', asOf, false, 1);
    const common = await daily.computeDay('2026-10-12', 'UTC', asOf, false);
    expect(theirs.raw).toBeCloseTo(0.05, 10);
    expect(common.raw).toBeCloseTo(0.6, 10);
    // Their history: their own days, the common ones before.
    await daily.refreshZone('UTC', Date.UTC(2026, 9, 14, 12), 1);
    await daily.refreshZone('UTC', Date.UTC(2026, 9, 14, 12));
    expect(await db.get('SELECT 1 AS x FROM ai_daily_sentiment WHERE user_id = 1 AND day = ? AND final = 1', ['2026-10-12'])).toBeDefined();
    await db.run(`INSERT INTO daily_sentiment(day, tz, value, raw, confidence, counts, breakdown, drivers, computed_at, final) VALUES ('2026-10-11', 'UTC', 61, 0.1, 'low', '{}', '{}', '{}', 1, 1)`);
    const later = Date.UTC(2026, 9, 14, 12);
    const days = await daily.history(7, 'UTC', later, 1);
    expect(days.find((d) => d.day === '2026-10-11')?.index).toBe(61);
    expect(days.find((d) => d.day === '2026-10-12')).toMatchObject({ index: (await daily.computeDay('2026-10-12', 'UTC', later, false, 1)).index, final: true });
    expect((await daily.history(7, 'UTC', later)).find((d) => d.day === '2026-10-12')?.index).toBe((await daily.computeDay('2026-10-12', 'UTC', later, false)).index);
    expect((await daily.computeDay('2026-10-12', 'UTC', later, false, 1)).index).toBeLessThan((await daily.computeDay('2026-10-12', 'UTC', later, false)).index);
    // The news list: their AI's score where it gave one, with its engine; the filters follow it.
    const q = (sentiment?: string) => newsQuerySchema.parse({ range: '7d', ...(sentiment ? { sentiment } : {}) });
    const page = await queryNews(db, q(), 'UTC', 1, asOf, true);
    expect(page.items.find((i) => i.id === 'a')?.sentiment).toMatchObject({ score: -0.5, label: 'negative', engine: 'gemini:x', meta: null });
    expect(page.items.find((i) => i.id === 'b')?.sentiment).toMatchObject({ score: 0.6, engine: 'local' });
    expect((await queryNews(db, q('negative'), 'UTC', 1, asOf, true)).items.map((i) => i.id)).toEqual(['a']);
    expect((await queryNews(db, q('negative'), 'UTC', 2, asOf)).items).toEqual([]);
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
