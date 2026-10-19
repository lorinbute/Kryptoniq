// Each user's own AI (FD-AIKEYS): the move of the admin's old Claude key and engine, and who scores with their AI.
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { LEGACY_CLAUDE_KEY, SettingsService, UPSERT_SETTING } from '../settings.ts';
import { AiService } from './service.ts';

const box = new SecretBox(Buffer.alloc(32, 5));
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

async function setup(now = Date.UTC(2026, 9, 16, 12)) {
  const db = await testDb();
  const settings = new SettingsService(db, box);
  await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
  return { db, settings, ai: new AiService({ db, settings, log: silentLogger, now: () => now }), now };
}

async function news(db: Awaited<ReturnType<typeof setup>>['db'], id: string, at: number, engine: string | null) {
  await db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine, sentiment_impact, scored_at)
     VALUES (?, 's1', ?, ?, ?, 'crypto', 1, 1, ?, ?, ?, ?, ?, ?)`,
    [id, `Story ${id}`, at, at, id, engine ? 0.7 : null, engine ? 'positive' : null, engine, engine?.startsWith('claude:') ? 3 : null, engine ? at : null],
  );
}

describe('the admin’s Claude key and engine become the admin’s own (FD-AIKEYS §4)', () => {
  it('moves the key, the choice and the scores; the days that can still change are scored locally again; only once', async () => {
    const { db, settings, ai, now } = await setup();
    // Before FD-AIKEYS: the engine and the model in the global settings, the key beside them.
    await db.run(UPSERT_SETTING, { k: 'app', v: JSON.stringify({ retentionDays: 60, sentiment: { engine: 'claude', claudeModel: 'claude-haiku-5-5' } }) });
    await db.run(UPSERT_SETTING, { k: LEGACY_CLAUDE_KEY, v: box.encrypt(KEY) });
    await db.run("INSERT INTO market_cache([key], value, fetched_at) VALUES (N'claude:usage', N'{}', 1)");
    await settings.updateFor(1, true, { timezone: 'Europe/Bucharest' });
    await news(db, 'recent', now - 3_600_000, 'claude:claude-haiku-5-5');
    await news(db, 'old', now - 10 * 86_400_000, 'claude:claude-haiku-5-5');
    await news(db, 'local', now - 3_600_000, 'local');
    expect(await ai.migrateLegacy(1)).toBe(true);
    expect((await settings.getAiKeys(1)).anthropic).toBe(KEY);
    expect(await ai.config(1)).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', scoring: true, key: KEY });
    // The admin's other settings and the global ones stay.
    expect((await settings.forUser(1)).timezone).toBe('Europe/Bucharest');
    expect((await settings.get()).retentionDays).toBe(60);
    expect(await db.get('SELECT 1 AS x FROM settings WHERE [key] = ?', [LEGACY_CLAUDE_KEY])).toBeUndefined();
    expect(JSON.parse((await db.get<{ value: string }>("SELECT value FROM settings WHERE [key] = 'app'"))!.value)).not.toHaveProperty('sentiment');
    expect(await db.get("SELECT 1 AS x FROM market_cache WHERE [key] = N'claude:usage'")).toBeUndefined();
    // Claude's scores are the admin's now (with the importance); the recent one goes back to the queue of the local model.
    expect(await db.all('SELECT news_id, score, engine, impact FROM news_ai_scores WHERE user_id = 1 ORDER BY news_id')).toEqual([
      { news_id: 'old', score: 0.7, engine: 'claude:claude-haiku-5-5', impact: 3 },
      { news_id: 'recent', score: 0.7, engine: 'claude:claude-haiku-5-5', impact: 3 },
    ]);
    expect(await db.all('SELECT id, sentiment_engine FROM news ORDER BY id')).toEqual([
      { id: 'local', sentiment_engine: 'local' },
      { id: 'old', sentiment_engine: 'claude:claude-haiku-5-5' },
      { id: 'recent', sentiment_engine: null },
    ]);
    expect(await ai.scoringUsers()).toEqual([1]);
    // Once only: the admin's later choices stay theirs.
    await settings.updateFor(1, true, { ai: { scoring: false } });
    expect(await ai.migrateLegacy(1)).toBe(false);
    ai.forget();
    expect((await ai.config(1)).scoring).toBe(false);
  });

  it('a local engine with a key: the key moves, the scores stay local; an engine without a key: nothing to score with', async () => {
    const { db, ai } = await setup();
    await db.run(UPSERT_SETTING, { k: 'app', v: JSON.stringify({ sentiment: { engine: 'local', claudeModel: 'claude-opus-5-5' } }) });
    await db.run(UPSERT_SETTING, { k: LEGACY_CLAUDE_KEY, v: box.encrypt(KEY) });
    expect(await ai.migrateLegacy(1)).toBe(true);
    expect(await ai.config(1)).toMatchObject({ provider: 'anthropic', scoring: false, key: KEY });

    const other = await setup();
    await other.db.run(UPSERT_SETTING, { k: 'app', v: JSON.stringify({ sentiment: { engine: 'claude', claudeModel: 'claude-opus-5-5' } }) });
    expect(await other.ai.migrateLegacy(1)).toBe(true);
    expect(await other.ai.config(1)).toMatchObject({ scoring: false, key: null });
    // A new installation has neither: nothing to do.
    const fresh = await setup();
    await fresh.settings.update({});
    expect(await fresh.ai.migrateLegacy(1)).toBe(false);
  });
});

describe('at start-up', () => {
  it('the AI and Twelve Data keys become the admin\'s; the AI move happens before any other write of the global settings drops the old engine', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { createContext } = await import('../context.ts');
    const { loadConfig } = await import('../config.ts');
    const db = await testDb();
    // An installation from before FD-MARKETSRC too: that move writes the global settings again.
    await db.run(UPSERT_SETTING, { k: 'app', v: JSON.stringify({ sentiment: { engine: 'claude', claudeModel: 'claude-sonnet-5-5' } }) });
    await db.run(UPSERT_SETTING, { k: LEGACY_CLAUDE_KEY, v: box.encrypt(KEY) });
    // FD-TDKEYS: the Twelve Data key, with the plan read for it and the day's credits.
    await db.run(UPSERT_SETTING, { k: 'twelvedata_key', v: box.encrypt('t'.repeat(32)) });
    await db.run("INSERT INTO market_cache([key], value, fetched_at) VALUES (N'td:plan', N'{\"category\":\"grow\",\"perMinute\":55,\"perDay\":null,\"at\":1,\"keyHint\":\"tttt\"}', 1), (N'td:usage', N'{\"day\":\"2026-10-16\",\"used\":7}', 1)");
    const dir = mkdtempSync(path.join(tmpdir(), 'sq-ai-'));
    try {
      const nli = { status: () => ({ state: 'ready' as const, progress: 100, error: null, model: 'x' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };
      const ctx = await createContext({ ...loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'x') }, silentLogger, { db, box, nli });
      expect(await ctx.ai.config(1)).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', scoring: true, key: KEY });
      expect((await ctx.settings.get()).marketData).toEqual({ exchange: 'kucoin', candles: 1500 });
      expect(await ctx.settings.getTwelveDataKey(1)).toBe('t'.repeat(32));
      expect(await db.get("SELECT 1 AS x FROM settings WHERE [key] = N'twelvedata_key'")).toBeUndefined();
      expect((await db.all<{ key: string }>("SELECT [key] FROM market_cache WHERE [key] LIKE N'td:%' ORDER BY [key]")).map((r) => r.key)).toEqual(['td:plan:1', 'td:usage:1']);
      await ctx.stocks.budget(1).ready;
      expect(ctx.stocks.budget(1).status()).toMatchObject({ perMinute: 55, perDay: null });
      // Once only.
      expect(await ctx.settings.migrateTwelveData(1)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('who scores with their own AI', () => {
  it('the users who chose it and have the key, enabled accounts only', async () => {
    const { db, settings, ai } = await setup();
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES (N'ana@example.com', N'Ana', N'user', 1), (N'bob@example.com', N'Bob', N'user', 1), (N'cy@example.com', N'Cy', N'user', 1)");
    // Ana: Gemini with its key. Bob: chose it, but his key is OpenAI's. Cy: disabled.
    await settings.updateFor(2, false, { ai: { provider: 'gemini', scoring: true } });
    await settings.setAiKey(2, 'gemini', 'AIzaSyD-ana-key-0123456789abcdef');
    await settings.updateFor(3, false, { ai: { provider: 'gemini', scoring: true } });
    await settings.setAiKey(3, 'openai', 'sk-proj-bob-0123456789abcdefgh');
    await settings.updateFor(4, false, { ai: { provider: 'openai', scoring: true } });
    await settings.setAiKey(4, 'openai', 'sk-proj-cy-0123456789abcdefghij');
    await db.run('UPDATE users SET disabled_at = 1 WHERE id = 4');
    expect(await ai.scoringUsers()).toEqual([2]);
    expect(await ai.config(2)).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash' });
    // Without a key: the model list is Sentiq's, the provider is not asked.
    expect(await ai.models(1, 'openai')).toEqual({ models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'], source: 'default', error: null });
  });
});
