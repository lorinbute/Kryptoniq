// FD-AISLOW: a slow or busy provider. More time for an answer, a quick retry that grows with the errors in a row,
// users scored at the same time (one's slow provider does not hold the others up), and how far the scoring got.
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testDb } from '../test/db.ts';
import { silentLogger, type Logger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { AnthropicClient } from '../ai/anthropic.ts';
import { GeminiClient } from '../ai/gemini.ts';
import { callJson } from '../ai/http.ts';
import { AiService } from '../ai/service.ts';
import { AiError, withinRo, type AiClient } from '../ai/types.ts';
import { aiRounds, AI_MAX_ROUNDS, AI_RUN_BUDGET_MS } from '../jobs/register.ts';
import { AI_BATCH, AI_CALL_TIMEOUT_MS, AiScorer, PASSING_PAUSE_MAX_MS } from './ai-scorer.ts';
import { AI_PER_RUN, SentimentService, scorerStateKey } from './service.ts';
import type { NliScorer } from './local.ts';

const MIN = 60_000;
const fakeClient = (generate: AiClient['generate']): AiClient => ({ provider: 'gemini', model: 'gemini-3.8-flash', generate });
const items = [{ id: 'a', title: 'Fed cuts rates', summary: '' }];
const answer = (n: number) => ({ parsed: { results: Array.from({ length: n }, (_, i) => ({ n: i + 1, score: 0.4, impact: 2, reason: 'r' })) } as never, stop: 'done' as const, usage: { input: 1, output: 1 } });
const timeout = () => new AiError('gemini', 'timeout', 0, '', 'gemini-3.8-flash', { said: 'Google nu a răspuns în 3 minute' });
/** A fetch that gives up as the timeout does. */
const timesOut = (async () => {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}) as typeof fetch;

describe('how long was waited, said (FD-AISLOW §1)', () => {
  it('seconds or minutes, with the Romanian „de” from 20 on', () => {
    expect(withinRo(1_000)).toBe('într-o secundă');
    expect(withinRo(1_500)).toBe('în 2 secunde');
    expect(withinRo(15_000)).toBe('în 15 secunde');
    expect(withinRo(20_000)).toBe('în 20 de secunde');
    expect(withinRo(90_000)).toBe('în 90 de secunde');
    expect(withinRo(60_000)).toBe('într-un minut');
    expect(withinRo(180_000)).toBe('în 3 minute');
    expect(withinRo(20 * MIN)).toBe('în 20 de minute');
    expect(withinRo(10)).toBe('într-o secundă');
  });

  it('the provider that did not answer in time says how long it was given, and is not asked again in the call', async () => {
    let calls = 0;
    const counted = (async (...args: Parameters<typeof timesOut>) => (calls++, timesOut(...args))) as typeof globalThis.fetch;
    const call = { provider: 'gemini' as const, url: 'https://x.example', headers: {}, timeoutMs: 180_000, classify: () => 'other' as const };
    await expect(callJson(call, { fetch: counted, sleep: async () => {} })).rejects.toMatchObject({ kind: 'timeout', message: 'Google nu a răspuns în 3 minute' });
    expect(calls).toBe(1);
    await expect(callJson({ ...call, provider: 'openai', timeoutMs: 15_000 }, { fetch: counted })).rejects.toMatchObject({ message: 'OpenAI nu a răspuns în 15 secunde' });
    // Through the Gemini client, as the scores ask.
    const gemini = new GeminiClient('AIzaSyD-test-key-0123456789abcdef', 'gemini-3.8-flash', { fetch: counted, sleep: async () => {} });
    const req = { system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), name: 'n', maxTokens: 10, effort: 'low' as const, timeoutMs: AI_CALL_TIMEOUT_MS };
    const err: unknown = await gemini.generate(req).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout', message: 'Google nu a răspuns în 3 minute' });
    expect((err as AiError).passing).toBe(true);
  });

  it('the time is the whole call’s, retries included: none that would pass it, the last one shortened', async () => {
    const busy = () => new Response(JSON.stringify({ error: { message: 'The model is overloaded.' } }), { status: 503 });
    const call = { provider: 'gemini' as const, url: 'https://x.example', headers: {}, timeoutMs: 500, classify: () => 'overloaded' as const };
    let calls = 0;
    // A 503, and a second try would wait a second: past the half second given, so the 503 stands.
    const once = (async () => (calls++, busy())) as typeof globalThis.fetch;
    await expect(callJson(call, { fetch: once, sleep: async () => {} })).rejects.toMatchObject({ kind: 'overloaded', message: 'Google e supraîncărcat acum' });
    expect(calls).toBe(1);
    // A 503 after 400 ms, then no answer: the second try has what is left (about 1.1 s), not the whole 1.5 s again.
    calls = 0;
    const slow = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return new Promise<Response>((r) => setTimeout(() => r(busy()), 400));
      return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
    }) as typeof globalThis.fetch;
    const started = Date.now();
    await expect(callJson({ ...call, timeoutMs: 1_500 }, { fetch: slow, sleep: async () => {} })).rejects.toMatchObject({ kind: 'timeout', message: 'Google nu a răspuns în 2 secunde' });
    const took = Date.now() - started;
    expect(calls).toBe(2);
    expect(took).toBeGreaterThanOrEqual(1_400);
    expect(took).toBeLessThan(1_850);
  });

  it('Anthropic: the SDK’s retries within the time; past it, said as the others; the caller stopping stays a stop', async () => {
    const waits = {
      beta: {
        messages: {
          parse: (_p: unknown, o: { signal: AbortSignal }) =>
            new Promise((_r, reject) => o.signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()))),
        },
      },
      messages: { stream: () => ({ finalMessage: async () => ({}) }) },
    } as never;
    const req = (signal?: AbortSignal) => ({ system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), name: 'n', maxTokens: 10, effort: 'low' as const, timeoutMs: 60, signal });
    const err: unknown = await new AnthropicClient('k', 'claude-opus-5-5', waits).generate(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout', message: 'Anthropic nu a răspuns într-o secundă' });
    expect((err as AiError).passing).toBe(true);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    const stopped: unknown = await new AnthropicClient('k', 'claude-opus-5-5', waits).generate({ ...req(stop.signal), timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(stopped).toBeInstanceOf(Anthropic.APIUserAbortError);
  });

  it('a passing error: a busy or slow provider, not a refusal', () => {
    const e = (kind: ConstructorParameters<typeof AiError>[1], status = 0) => new AiError('gemini', kind, status, '');
    expect([e('timeout'), e('overloaded', 503), e('connection'), e('rate', 429), e('other', 500)].map((x) => x.passing)).toEqual([true, true, true, true, true]);
    expect([e('quota', 429), e('bad_request', 400), e('other', 418), e('auth', 401), e('permission', 403), e('model', 404)].map((x) => x.passing)).toEqual([false, false, false, false, false, false]);
    // In the call itself a timeout is still not repeated.
    expect(e('timeout').transient).toBe(false);
  });
});

describe('the pause after an error (FD-AISLOW §2)', () => {
  it('a passing error: a minute, doubled with each one in a row, at most 15; the first answer starts again', async () => {
    let now = 1_000_000;
    let fail: (() => Error) | null = timeout;
    const states: { failures?: number; lastError: unknown }[] = [];
    const requests: number[] = [];
    const scorer = new AiScorer({
      client: fakeClient(async (req) => {
        requests.push(req.timeoutMs);
        if (fail) throw fail();
        return answer(1);
      }),
      log: silentLogger,
      now: () => now,
      onState: (s) => states.push(s),
    });
    const pauses: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(await scorer.score(items)).toEqual([]);
      const st = scorer.status();
      expect(st.failures).toBe(i + 1);
      expect(st.lastError).toMatchObject({ message: 'Google nu a răspuns în 3 minute', passing: true, permanent: false });
      pauses.push((st.pausedUntil ?? 0) - now);
      // Paused: nothing asked meanwhile.
      now = (st.pausedUntil ?? 0) - 1;
      expect(await scorer.score(items)).toEqual([]);
      now += 1;
    }
    expect(pauses).toEqual([1, 2, 4, 8, 15, 15].map((m) => m * MIN));
    expect(requests).toHaveLength(6);
    expect(requests.every((t) => t === AI_CALL_TIMEOUT_MS)).toBe(true);
    // Out of credit after all: half an hour, at once, not a passing one; the errors in a row still count.
    fail = () => new AiError('gemini', 'quota', 402, 'Your prepayment credits are depleted.');
    await scorer.score(items);
    expect(scorer.status()).toMatchObject({ failures: 7, lastError: { passing: false }, pausedUntil: now + 30 * MIN });
    // A request refused (not a passing error): five minutes.
    now += 30 * MIN;
    fail = () => new AiError('gemini', 'bad_request', 400, 'bad');
    await scorer.score(items);
    expect(scorer.status()).toMatchObject({ failures: 8, pausedUntil: now + 5 * MIN });
    // The first answer: no error, no count, told.
    now += 5 * MIN;
    fail = null;
    states.length = 0;
    expect(await scorer.score(items)).toHaveLength(1);
    expect(scorer.status()).toMatchObject({ failures: 0, lastError: null, pausedUntil: null });
    expect(states).toEqual([expect.objectContaining({ failures: 0, lastError: null })]);
    // Then one passing error is again a minute.
    fail = timeout;
    await scorer.score(items);
    expect(scorer.status().pausedUntil).toBe(now + MIN);
    expect(PASSING_PAUSE_MAX_MS).toBe(15 * MIN);
  });

  it('an answer with nothing to use (a refusal) is still an answer; the user asking again starts the count over', async () => {
    let now = 5_000_000;
    let reply: () => Promise<Awaited<ReturnType<AiClient['generate']>>> = () => Promise.reject(timeout());
    const scorer = new AiScorer({ client: fakeClient(() => reply() as never), log: silentLogger, now: () => now });
    await scorer.score(items);
    now += MIN;
    await scorer.score(items);
    expect(scorer.status().failures).toBe(2);
    reply = async () => ({ parsed: null, stop: 'refusal', usage: null });
    now += 2 * MIN;
    expect(await scorer.score(items)).toEqual([{ id: 'a', score: null, label: null, impact: null, engine: 'gemini:gemini-3.8-flash', reason: null }]);
    expect(scorer.status()).toMatchObject({ failures: 0, lastError: null });
    reply = () => Promise.reject(timeout());
    await scorer.score(items);
    now += MIN;
    await scorer.score(items);
    expect(scorer.status().failures).toBe(2);
    scorer.resume();
    expect(scorer.status()).toMatchObject({ failures: 0, pausedUntil: null });
    // Its error stays until an answer (FD-AIQUOTA §2).
    expect(scorer.status().lastError).toMatchObject({ passing: true });
  });

  it('restored after a restart: the count goes on; a state saved before FD-AISLOW counts its error as one', async () => {
    const now = 9_000_000;
    const lastError = { at: now - MIN, message: 'Google nu a răspuns la timp', permanent: false, passing: true };
    const go = new AiScorer({ client: fakeClient(() => Promise.reject(timeout())), log: silentLogger, now: () => now, restored: { lastError, pausedUntil: now - 1, failures: 3 } });
    await go.score(items);
    expect(go.status()).toMatchObject({ failures: 4, pausedUntil: now + 8 * MIN });
    const { passing: _, ...before } = lastError;
    const old = new AiScorer({ client: fakeClient(() => Promise.reject(timeout())), log: silentLogger, now: () => now, restored: { lastError: before, pausedUntil: null } });
    expect(old.status().failures).toBe(1);
    await old.score(items);
    expect(old.status()).toMatchObject({ failures: 2, pausedUntil: now + 2 * MIN });
    const clean = new AiScorer({ client: fakeClient(() => Promise.reject(timeout())), log: silentLogger, now: () => now, restored: { lastError: null, pausedUntil: null } });
    expect(clean.status().failures).toBe(0);
  });

  it('stopped while it waits (the app or the job stops): no error, no count', async () => {
    const stop = new AbortController();
    const scorer = new AiScorer({
      client: fakeClient(async () => {
        stop.abort();
        throw new DOMException('aborted', 'AbortError');
      }),
      log: silentLogger,
    });
    expect(await scorer.score(items, stop.signal)).toEqual([]);
    expect(scorer.status()).toMatchObject({ failures: 0, lastError: null, pausedUntil: null });
  });

  it('a slow answer is noted in the log with how long it took (FD-AISLOW §5)', async () => {
    let now = 0;
    const lines: string[] = [];
    const log: Logger = { ...silentLogger, info: (m: string) => void lines.push(m) };
    const scorer = new AiScorer({
      client: fakeClient(async () => {
        now += 74_000;
        return answer(1);
      }),
      log,
      now: () => now,
    });
    await scorer.score(items);
    expect(lines).toEqual(['AI scoring (gemini:gemini-3.8-flash): 1 headlines answered in 74 s']);
    // A minute or less: nothing.
    lines.length = 0;
    const quick = new AiScorer({ client: fakeClient(async () => ((now += 60_000), answer(1))), log, now: () => now });
    await quick.score(items);
    expect(lines).toEqual([]);
  });
});

describe('the rounds of a run (FD-AISLOW §3)', () => {
  it('until one scores nothing, the budget is spent, 40 of them, or the run is stopped', async () => {
    const live = new AbortController().signal;
    const left = [25, 25, 3, 0, 25];
    expect(await aiRounds(async () => left.shift() ?? 0, live)).toBe(4);
    // Slow rounds: none starts after five minutes.
    let now = 0;
    expect(
      await aiRounds(
        async () => {
          now += 2 * MIN;
          return 25;
        },
        live,
        () => now,
      ),
    ).toBe(3);
    expect(AI_RUN_BUDGET_MS).toBe(5 * MIN);
    expect(await aiRounds(async () => 1, live, () => 0)).toBe(AI_MAX_ROUNDS);
    const stopped = new AbortController();
    stopped.abort();
    expect(await aiRounds(async () => 1, stopped.signal)).toBe(0);
  });
});

describe('users scored at the same time, on the test schema (FD-AISLOW §3, §4)', () => {
  const noModel: NliScorer = { status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} };

  async function setup(news: number) {
    const db = await testDb();
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES (N'ana@example.com', N'Ana', N'user', 1)");
    await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
    for (const u of [1, 2]) {
      await settings.setAiKey(u, 'gemini', `AIzaSyD-test-key-${u}-0123456789abcdef`);
      await settings.updateFor(u, u === 1, { ai: { provider: 'gemini', scoring: true } });
    }
    const now = Date.now();
    for (let i = 0; i < news; i++) {
      await db.run(
        `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
         VALUES (?, 's1', ?, ?, ?, 'crypto', 1, 1, ?, 0.1, 'x', 'local')`,
        [`n${i}`, `Headline ${i}`, now - (i + 1) * 60_000, now, `n${i}`],
      );
    }
    return { db, settings, now };
  }
  const scoredBy = async (db: Awaited<ReturnType<typeof testDb>>, user: number) => (await db.get<{ n: number }>('SELECT count(*) AS n FROM news_ai_scores WHERE user_id = ?', [user]))?.n ?? 0;

  it('a slow provider does not hold another user up; one batch each per round', async () => {
    const { db, settings, now } = await setup(30);
    const sizes: Record<number, number[]> = { 1: [], 2: [] };
    const keyOf = async (u: number) => (await settings.getAiKeys(u)).gemini;
    const key1 = await keyOf(1);
    const ai = new AiService({
      db,
      settings,
      log: silentLogger,
      clientFactory: (provider, key, model) => {
        const user = key === key1 ? 1 : 2;
        return {
          provider,
          model,
          generate: async (req) => {
            const n = (req.prompt.match(/^\d+\. /gm) ?? []).length;
            sizes[user]?.push(n);
            // User 1 (first in order) answers only once user 2's scores are in: one after the other, it never would.
            if (user === 1) {
              const until = Date.now() + 10_000;
              while ((await scoredBy(db, 2)) === 0) {
                if (Date.now() > until) throw new Error('user 2 was held up by user 1');
                await new Promise((r) => setTimeout(r, 25));
              }
            }
            return answer(n) as never;
          },
        };
      },
    });
    const svc = new SentimentService(db, ai, noModel, silentLogger);
    expect(AI_PER_RUN).toBe(AI_BATCH);
    expect(await svc.scoreUsers(undefined, now)).toBe(2 * AI_BATCH);
    expect(await scoredBy(db, 1)).toBe(AI_BATCH);
    expect(await scoredBy(db, 2)).toBe(AI_BATCH);
    expect(await svc.scoreUsers(undefined, now)).toBe(10);
    expect(await svc.scoreUsers(undefined, now)).toBe(0);
    expect(sizes).toEqual({ 1: [25, 5], 2: [25, 5] });
  });

  it("one user's failure does not stop the other's batch; the run fails after, with that error", async () => {
    const { db, settings, now } = await setup(3);
    const key1 = (await settings.getAiKeys(1)).gemini;
    const ai = new AiService({
      db,
      settings,
      log: silentLogger,
      clientFactory: (provider, key, model) => {
        if (key === key1) throw new Error('boom');
        return { provider, model, generate: async () => answer(3) as never };
      },
    });
    const svc = new SentimentService(db, ai, noModel, silentLogger);
    await expect(svc.scoreUsers(undefined, now)).rejects.toThrow('boom');
    expect(await scoredBy(db, 2)).toBe(3);
  });

  it('the count of errors in a row is saved, read by the page, and goes on after a restart', async () => {
    const { db, settings, now } = await setup(1);
    await settings.updateFor(2, false, { ai: { scoring: false } });
    let calls = 0;
    const ai = new AiService({ db, settings, log: silentLogger, clientFactory: (provider, _k, model) => ({ provider, model, generate: async () => (calls++, Promise.reject(timeout())) }) });
    const jobs = new SentimentService(db, ai, noModel, silentLogger);
    await jobs.scoreUsers(undefined, now);
    const page = new SentimentService(db, ai, noModel, silentLogger);
    expect(await page.aiStatus(1)).toMatchObject({ failures: 1, lastError: { passing: true, message: 'Google nu a răspuns în 3 minute' }, pausedUntil: expect.any(Number) });
    // The pause ends while the app is down; restarted, it tries, and the count goes on: two minutes now.
    const row = await db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [scorerStateKey(1)]);
    const state = JSON.parse(row?.value ?? '{}') as { pausedUntil: number };
    await db.run('UPDATE market_cache SET value = ? WHERE [key] = ?', [JSON.stringify({ ...state, pausedUntil: Date.now() - 1 }), scorerStateKey(1)]);
    const restarted = new SentimentService(db, ai, noModel, silentLogger);
    const before = Date.now();
    await restarted.scoreUsers(undefined, now);
    expect(calls).toBe(2);
    const st = await page.aiStatus(1);
    expect(st?.failures).toBe(2);
    expect(st?.pausedUntil).toBeGreaterThanOrEqual(before + 2 * MIN);
    expect(st?.pausedUntil).toBeLessThanOrEqual(Date.now() + 2 * MIN);
    // No state yet: no errors.
    await page.retryNow(1);
    expect(await page.aiStatus(1)).toMatchObject({ failures: 0, lastError: null });
  });

  it('the user saving again after a pause that is over: the errors in a row start over too', async () => {
    const { db, settings, now } = await setup(1);
    await settings.updateFor(2, false, { ai: { scoring: false } });
    const ai = new AiService({ db, settings, log: silentLogger, clientFactory: (provider, _k, model) => ({ provider, model, generate: async () => Promise.reject(timeout()) }) });
    // Only the clock is faked (the scorer reads it from the start), so the pause can end without waiting for it.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const svc = new SentimentService(db, ai, noModel, silentLogger);
      await svc.scoreUsers(undefined, now);
      expect(await svc.aiStatus(1)).toMatchObject({ failures: 1, pausedUntil: expect.any(Number) });
      vi.setSystemTime(Date.now() + 2 * MIN);
      expect(await svc.aiStatus(1)).toMatchObject({ failures: 1, pausedUntil: null });
      await svc.retryNow(1);
      const before = Date.now();
      await svc.scoreUsers(undefined, now);
      const st = await svc.aiStatus(1);
      expect(st?.failures).toBe(1);
      expect(st?.pausedUntil).toBe(before + MIN);
    } finally {
      vi.useRealTimers();
    }
  });

  it('progress: the news the scoring gives the user, how many it went through, its last score', async () => {
    const { db, now } = await setup(0);
    await db.run("INSERT INTO sources(id, name, url, category, builtin, enabled) VALUES ('s2', 'Off', 'https://s2.example/rss', 'crypto', 0, 0)");
    const add = (id: string, source: string, relevance: number, at: number) =>
      db.run(
        `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
         VALUES (?, ?, ?, ?, ?, 'crypto', ?, 1, ?, 0.1, 'x', 'local')`,
        [id, source, id, at, at, relevance, id],
      );
    await add('a', 's1', 1, now - MIN);
    await add('b', 's1', 1, now - 2 * MIN);
    await add('c', 's1', 1, now - 3 * MIN);
    await add('off', 's2', 1, now - MIN);
    await add('weightless', 's1', 0, now - MIN);
    await add('old', 's1', 1, now - 49 * 3_600_000);
    const score = (user: number, id: string, at: number) =>
      db.run("INSERT INTO news_ai_scores(user_id, news_id, score, label, engine, impact, scored_at) VALUES (?, ?, 0.1, 'x', 'gemini:m', 1, ?)", [user, id, at]);
    await score(1, 'a', now - 10 * MIN);
    await score(1, 'b', now - 5 * MIN);
    await score(1, 'old', now - MIN);
    await score(2, 'c', now - 7 * MIN);
    const svc = new SentimentService(db, new AiService({ db, settings: new SettingsService(db, new SecretBox(Buffer.alloc(32, 4))), log: silentLogger }), noModel, silentLogger);
    expect(await svc.aiProgress(1, now)).toEqual({ total: 3, scored: 2, lastAt: now - MIN });
    expect(await svc.aiProgress(2, now)).toEqual({ total: 3, scored: 1, lastAt: now - 7 * MIN });
    expect(await svc.aiProgress(3, now)).toEqual({ total: 3, scored: 0, lastAt: null });
  });
});
