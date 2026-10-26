// FD-WHYPLAIN §3: the user's AI says in a sentence why it gave each score; kept with the score, shown with it.
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { AiService } from '../ai/service.ts';
import type { AiClient } from '../ai/types.ts';
import type { NliScorer } from './local.ts';
import { SentimentService } from './service.ts';
import { DailySentimentService } from './daily.ts';
import { queryNews, newsQuerySchema } from '../news/query.ts';
import { AiScorer, cleanReason, REASON_MAX, SCORE_SYSTEM } from './ai-scorer.ts';

const noModel: NliScorer = { status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} };

/** Answers every headline with +0.6, importance 2 and a reason ("" for the second). */
const withReasons: AiClient = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  generate: async (req) => {
    const n = (req.prompt.match(/^\d+\./gm) ?? []).length;
    return {
      parsed: { results: Array.from({ length: n }, (_, i) => ({ n: i + 1, score: 0.6, impact: 2, reason: i === 1 ? '  ' : `  Fluxuri record   în ETF-uri: cerere instituțională (${i + 1}).  ` })) } as never,
      stop: 'done',
      usage: { input: 10, output: 5 },
    };
  },
};

describe('the reason of an AI score', () => {
  it('is cleaned: spaces folded, trimmed, cut past the limit; empty or missing is none', () => {
    expect(cleanReason('  Fed  dovish:\n bullish.  ')).toBe('Fed dovish: bullish.');
    expect(cleanReason('')).toBeNull();
    expect(cleanReason('   ')).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
    expect(cleanReason(42)).toBeNull();
    const long = cleanReason('a'.repeat(300))!;
    expect(long).toHaveLength(REASON_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('is asked for, in Romanian, and read with each score', async () => {
    expect(SCORE_SYSTEM).toMatch(/reason for its score in Romanian/);
    const scorer = new AiScorer({ client: withReasons, log: silentLogger });
    const out = await scorer.score([
      { id: 'a', title: 'BlackRock ETF draws record inflows', summary: '' },
      { id: 'b', title: 'Nothing to say', summary: '' },
    ]);
    expect(out[0]).toMatchObject({ id: 'a', score: 0.6, impact: 2, reason: 'Fluxuri record în ETF-uri: cerere instituțională (1).' });
    expect(out[1]).toMatchObject({ id: 'b', score: 0.6, reason: null });
  });

  it('is kept with the user\'s score and shown where the score is: the drivers and the News page', async () => {
    const db = await testDb();
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
    await settings.updateFor(1, true, { timezone: 'UTC' });
    await settings.setAiKey(1, 'anthropic', 'sk-ant-api03-test-key-0123456789abcdef0123456789abcdef');
    await settings.updateFor(1, true, { ai: { provider: 'anthropic', scoring: true } });
    const ai = new AiService({ db, settings, log: silentLogger, clientFactory: () => withReasons });
    await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
    const now = Date.now();
    const at = Math.max(now - 3_600_000, now - (now % 86_400_000) + 1000);
    await db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
       VALUES ('n1', 's1', 'BlackRock ETF draws record inflows', ?, ?, 'crypto', 1, 2, 'n1', 0.1, 'neutral', 'local')`,
      [at, at],
    );
    const svc = new SentimentService(db, ai, noModel, silentLogger);
    expect(await svc.scoreUsers(undefined, now)).toBe(1);
    const row = await db.get<{ reason: string | null }>("SELECT reason FROM news_ai_scores WHERE user_id = 1 AND news_id = 'n1'");
    expect(row?.reason).toBe('Fluxuri record în ETF-uri: cerere instituțională (1).');

    const daily = new DailySentimentService(db, settings, ai);
    const day = await daily.today('UTC', now, 1);
    await daily.explainDrivers(day, 1);
    expect(day.drivers.positive[0]?.why).toMatchObject({ engine: 'claude:claude-opus-5-5', reason: 'Fluxuri record în ETF-uri: cerere instituțională (1).' });

    const page = await queryNews(db, newsQuerySchema.parse({ range: '24h' }), 'UTC', 1, now, true);
    expect(page.items[0]?.sentiment).toMatchObject({ engine: 'claude:claude-opus-5-5', reason: 'Fluxuri record în ETF-uri: cerere instituțională (1).' });
    // The common score (not the user's AI) has no reason.
    const common = await queryNews(db, newsQuerySchema.parse({ range: '24h' }), 'UTC', 1, now, false);
    expect(common.items[0]?.sentiment?.reason).toBeNull();
  });
});
