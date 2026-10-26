// FD-SCOREWHY: "De ce acest scor?" for today's drivers: the score the index used, told as the News page tells it.
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { testDb } from '../test/db.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { dayBounds, dayKey } from '../../shared/time.ts';
import { DailySentimentService } from './daily.ts';

async function setup() {
  const db = await testDb();
  const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
  await settings.updateFor(1, true, { timezone: 'UTC' });
  await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
  return { db, daily: new DailySentimentService(db, settings) };
}

/** `k` minutes into today (UTC), never after now: the items are today's whatever the hour of the run. */
const today = (now: number, k: number) => Math.min(now - 1000, Math.max(dayBounds(dayKey(now, 'UTC'), 'UTC').start, now - 3_600_000) + k * 60_000);

/** A scored item: `ai` = the common AI importance (null: keywords only); `meta` = the local engine's details. */
async function addNews(db: Db, id: string, at: number, sentiment: number, o: { impact?: number; ai?: number | null; engine?: string; meta?: unknown } = {}) {
  await db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine, sentiment_meta, sentiment_impact)
     VALUES (?, 's1', ?, ?, ?, 'crypto', 0.9, ?, ?, ?, 'x', ?, ?, ?)`,
    [id, `Story ${id}`, at, at, o.impact ?? 2, id, sentiment, o.engine ?? 'local', o.meta === undefined ? null : JSON.stringify(o.meta), o.ai ?? null],
  );
}

describe("today's drivers, explained", () => {
  const meta = { model: 0.41, rules: [{ id: 'etf_inflow', score: 0.6, text: 'ETF inflows', negated: false }] };

  it('the common index: the local engine with its rules, the importance by keywords or by the AI', async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    await addNews(db, 'up', today(now, 1), 0.7, { meta });
    await addNews(db, 'down', today(now, 2), -0.6, { impact: 3, ai: 1.5, engine: 'claude:claude-opus-5-5' });
    const day = await daily.today('UTC', now);
    await daily.explainDrivers(day);
    const [up] = day.drivers.positive;
    const [down] = day.drivers.negative;
    expect(up?.why).toEqual({ engine: 'local', meta, relevance: 0.9, impact: 2, impactSource: 'rules', ruleImpact: 2, reason: null });
    expect(down?.why).toEqual({ engine: 'claude:claude-opus-5-5', meta: null, relevance: 0.9, impact: 1.5, impactSource: 'ai', ruleImpact: 3, reason: null });
  });

  it("a user's own AI: its engine and importance where it scored, the common details elsewhere", async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    await addNews(db, 'mine', today(now, 1), 0.7, { meta });
    await addNews(db, 'common', today(now, 2), -0.4, { meta });
    await db.run("INSERT INTO news_ai_scores(news_id, user_id, score, label, engine, impact, scored_at) VALUES ('mine', 1, -0.5, 'negative', 'gemini:gemini-3.8-flash', 1, ?)", [now]);
    const day = await daily.computeDay(dayKey(now, 'UTC'), 'UTC', now, false, 1);
    await daily.explainDrivers(day, 1);
    const all = [...day.drivers.positive, ...day.drivers.negative];
    // The user's AI turned "mine" negative: it drives the day down, with the AI's details.
    expect(all.find((d) => d.id === 'mine')).toMatchObject({ sentiment: -0.5, why: { engine: 'gemini:gemini-3.8-flash', meta: null, impact: 1, impactSource: 'ai', ruleImpact: 2 } });
    expect(all.find((d) => d.id === 'common')?.why).toEqual({ engine: 'local', meta, relevance: 0.9, impact: 2, impactSource: 'rules', ruleImpact: 2, reason: null });
  });

  it('an item gone meanwhile keeps no explanation; no drivers, nothing asked', async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    await addNews(db, 'gone', today(now, 1), 0.7, { meta });
    const day = await daily.today('UTC', now);
    await db.run("DELETE FROM news WHERE id = 'gone'");
    await daily.explainDrivers(day);
    expect(day.drivers.positive[0]).toMatchObject({ id: 'gone' });
    expect(day.drivers.positive[0]?.why).toBeUndefined();
    const empty = { ...day, drivers: { positive: [], negative: [] } };
    await expect(daily.explainDrivers(empty)).resolves.toBeUndefined();
  });
});

describe('"Cum s-a calculat?" (FD-INDEXWHY)', () => {
  const meta = { model: 0.41, rules: [{ id: 'etf_inflow', score: 0.6, text: 'ETF inflows', negated: false }] };

  it('the heaviest 100 items in full, with their score explained; the rest summed up; the same index as the card', async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    for (let k = 0; k < 105; k++) await addNews(db, `x${String(k).padStart(3, '0')}`, today(now, k % 50), k % 3 === 0 ? -0.5 : 0.4, { meta, impact: 1 + (k % 3) });
    const e = await daily.explainToday('UTC', now);
    const card = await daily.today('UTC', now);
    expect(e.total.index).toBe(card.index);
    expect(e.counts).toEqual(card.counts);
    expect(e.items).toHaveLength(100);
    expect(e.rest.count).toBe(5);
    expect(e.items.every((it) => it.why?.engine === 'local')).toBe(true);
    expect(e.items.reduce((a, it) => a + it.share, 0) + e.rest.share).toBeCloseTo(1, 9);
    expect(e.items.reduce((a, it) => a + it.contribution, 0) + e.rest.contribution).toBeCloseTo(e.total.raw, 9);
    expect(e).toMatchObject({ day: dayKey(now, 'UTC'), tz: 'UTC', params: { halfLifeH: 8, shrinkK: 4 }, rules: { labelT: 0.2 } });
  });

  it("a user's own AI: its scores and importance in the explanation, as in their index", async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    await addNews(db, 'mine', today(now, 1), 0.7, { meta });
    await db.run("INSERT INTO news_ai_scores(news_id, user_id, score, label, engine, impact, scored_at) VALUES ('mine', 1, -0.5, 'negative', 'gemini:gemini-3.8-flash', 3, ?)", [now]);
    const e = await daily.explainToday('UTC', now, 1);
    expect(e.items[0]).toMatchObject({ id: 'mine', sentiment: -0.5, impact: 3, why: { engine: 'gemini:gemini-3.8-flash', impactSource: 'ai' } });
    expect(e.total.index).toBe((await daily.computeDay(dayKey(now, 'UTC'), 'UTC', now, false, 1)).index);
  });
});

describe('today as the Today page gets it (FD-WHYPLAIN)', () => {
  const meta = { model: 0.41, rules: [{ id: 'etf_inflow', score: 0.6, text: 'ETF inflows', negated: false }] };

  it('drivers with how much each moved the index and why it weighs that; none of it stored with the snapshot', async () => {
    const { db, daily } = await setup();
    const now = Date.now();
    await addNews(db, 'up', today(now, 1), 0.7, { meta });
    await addNews(db, 'down', today(now, 2), -0.6, { impact: 3, ai: 1.5, engine: 'claude:claude-opus-5-5' });
    await addNews(db, 'flat', today(now, 3), 0, { meta });
    const day = await daily.todayExplained('UTC', now);
    const up = day.drivers.positive[0]!;
    const down = day.drivers.negative[0]!;
    expect(up.effect).toBeGreaterThan(0);
    expect(down.effect).toBeLessThan(0);
    // The index without "up", unrounded, rounds to the index of the day without it.
    const without = await (async () => {
      await db.run("UPDATE news SET relevance = 0 WHERE id = 'up'");
      const r = await daily.computeDay(day.day, 'UTC', now, false);
      await db.run("UPDATE news SET relevance = 0.9 WHERE id = 'up'");
      return r.index;
    })();
    expect(Math.round(up.without! * 10) / 10).toBe(without);
    expect(up.weighs).toMatchObject({ relevance: 0.9, impact: 2, sourceWeight: 1, spec: 1, clusterN: 1, cap: 1 });
    expect(down.weighs?.impact).toBe(1.5);
    expect(up.why?.engine).toBe('local');
    const stored = await db.get<{ drivers: string }>("SELECT drivers FROM daily_sentiment WHERE day = ? AND tz = 'UTC'", [day.day]);
    expect(stored?.drivers).not.toMatch(/"why"|"effect"|"weighs"|"without"/);
  });
});
