// FD-AIQUOTA: a refused call said exactly (Google's empty Prepay balance, which limit, when it resets), the provider's
// own words kept (keys hidden), and the scorer's pause kept across a restart, lifted when the user saves again.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testDb } from '../test/db.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import { SettingsService } from '../settings.ts';
import { AiScorer } from '../sentiment/ai-scorer.ts';
import { SentimentService, scorerStateKey } from '../sentiment/service.ts';
import type { NliScorer } from '../sentiment/local.ts';
import { explainGemini, GeminiClient, geminiKind, geminiLimits, nextPacificMidnight } from './gemini.ts';
import type { HttpDeps } from './http.ts';
import { listModels } from './models.ts';
import { AiService } from './service.ts';
import { AiError, aiErrorLine, providerWords, type AiClient } from './types.ts';

const HELP = 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/usage?tab=rate-limit.';
/** A 429 as Google sends it: the message, then the details (help, the limits passed, when to retry). */
const google429 = (lines: string[], violations: Record<string, unknown>[]) => ({
  error: {
    code: 429,
    message: `${HELP} \n${lines.map((l) => `* ${l}`).join('\n')}\nPlease retry in 33.6s.`,
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [{ description: 'Learn more about Gemini API quotas', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }] },
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '33s' },
    ],
  },
});
const FREE_METRIC = 'generativelanguage.googleapis.com/generate_content_free_tier_requests';
const PAID_METRIC = 'generativelanguage.googleapis.com/generate_requests_per_model_per_day';
const dims = (model: string) => ({ location: 'global', model });
const FREE_DAILY = google429(
  [`Quota exceeded for metric: ${FREE_METRIC}, limit: 20, model: gemini-3.8-flash`],
  [{ quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash'), quotaValue: '20' }],
);
const PREPAY = { error: { code: 402, message: 'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay.' } };
const NOW = Date.parse('2026-10-20T17:00:27Z');
const paidZeroNoModel = { error: { message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0' } };
const explain = (status: number, body: unknown) => explainGemini(geminiKind(status, body, ''), status, body, '', 'gemini-3.8-flash', NOW);

function net(...answers: { status: number; body: unknown }[]): HttpDeps & { calls: number } {
  const n = {
    calls: 0,
    sleep: async () => {},
    fetch: (async () => {
      n.calls++;
      const a = answers.shift();
      if (!a) throw new Error('no more answers');
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return n;
}

describe("Google's refusals, said exactly (FD-AIQUOTA §1)", () => {
  it('an empty Prepay balance: a 402, or a 429 that says so', () => {
    expect(geminiKind(402, PREPAY, '')).toBe('quota');
    const said = /^creditul preplătit \(Prepay\) al proiectului Google al cheii e epuizat: adaugă credit în AI Studio, la Billing\. Creditele primite cu abonamentul se folosesc doar cât soldul Prepay e peste 0$/;
    expect(explain(402, PREPAY)).toEqual({ said: expect.stringMatching(said), resetsAt: null });
    const as429 = { error: { code: 429, message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' } };
    expect(geminiKind(429, as429, '')).toBe('quota');
    expect(explain(429, as429)?.said).toMatch(said);
  });

  it("the free tier's daily limit: how many, of which model, that it is the project's, when it resets", () => {
    expect(geminiLimits(FREE_DAILY, '')).toEqual([{ metric: FREE_METRIC, id: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', model: 'gemini-3.8-flash', limit: 20 }]);
    expect(explain(429, FREE_DAILY)).toEqual({
      said: 'cheia e pe nivelul gratuit Google și a atins limita lui zilnică: 20 de cereri pe zi pentru gemini-3.8-flash. Limita e a proiectului Google, nu a cheii: o cheie nouă din același proiect nu ajută. Pentru mai mult, proiectul cheii trebuie legat de facturare (AI Studio, la Billing)',
      resetsAt: Date.parse('2026-10-21T07:00:00Z'),
    });
  });

  it("a paid tier's daily limit; a limit 0 (the model not given), free or paid; per minute only: nothing more to say", () => {
    const paid = google429([`Quota exceeded for metric: ${PAID_METRIC}, limit: 1500, model: gemini-3.8-flash`], [{ quotaMetric: PAID_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel', quotaDimensions: dims('gemini-3.8-flash') }]);
    expect(explain(429, paid)).toEqual({
      said: 'proiectul Google al cheii a atins limita zilnică a nivelului său: 1500 de cereri pe zi pentru gemini-3.8-flash. Limita e a proiectului, nu a cheii',
      resetsAt: Date.parse('2026-10-21T07:00:00Z'),
    });
    // Only the message names the daily metric: still a daily limit, not a passing one.
    const paidText = { error: { message: `${HELP} Quota exceeded for metric: ${PAID_METRIC}, limit: 1500, model: gemini-3.8-flash` } };
    expect(geminiKind(429, paidText, '')).toBe('quota');
    expect(explain(429, paidText)?.said).toMatch(/^proiectul Google al cheii a atins limita zilnică a nivelului său: 1500 de cereri pe zi pentru gemini-3\.8-flash\./);
    const freeZero = google429([`Quota exceeded for metric: ${FREE_METRIC}, limit: 0, model: gemini-4-argon`], []);
    expect(explain(429, freeZero)).toEqual({ said: 'modelul gemini-4-argon nu e inclus în nivelul gratuit Google: cheia trebuie să fie dintr-un proiect cu facturare (AI Studio, la Billing)', resetsAt: null });
    // Only the message, no model in it: the model asked for.
    const paidZero = { error: { message: `RESOURCE_EXHAUSTED: You exceeded your current quota. Quota exceeded for metric: ${PAID_METRIC}, limit: 0` } };
    expect(explain(429, paidZero)).toEqual({ said: 'proiectul Google al cheii are limita 0 pentru gemini-3.8-flash: modelul nu e disponibil pe nivelul proiectului (vezi AI Studio, la Rate limits)', resetsAt: null });
    const perMinute = google429([`Quota exceeded for metric: ${FREE_METRIC}, limit: 10, model: gemini-3.8-flash`], [{ quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash'), quotaValue: '10' }]);
    expect(geminiKind(429, perMinute, '')).toBe('rate');
    expect(explain(429, perMinute)).toBeNull();
  });

  it('several limits passed: the daily one counts, a 0 above all; a daily limit with no number says none', () => {
    const both = google429(
      [`Quota exceeded for metric: ${FREE_METRIC}, limit: 10, model: gemini-3.8-flash`, `Quota exceeded for metric: ${FREE_METRIC}, limit: 20, model: gemini-3.8-flash`],
      [
        { quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash'), quotaValue: '10' },
        { quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash'), quotaValue: '20' },
      ],
    );
    expect(explain(429, both)?.said).toMatch(/: 20 de cereri pe zi pentru gemini-3\.8-flash\./);
    // The same metric for both, no value in the details: each limit from its own line, in order.
    const unvalued = google429(
      [`Quota exceeded for metric: ${FREE_METRIC}, limit: 10, model: gemini-3.8-flash`, `Quota exceeded for metric: ${FREE_METRIC}, limit: 20, model: gemini-3.8-flash`],
      [
        { quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash') },
        { quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3.8-flash') },
      ],
    );
    expect(geminiLimits(unvalued, '').map((l) => l.limit)).toEqual([10, 20]);
    expect(explain(429, unvalued)?.said).toMatch(/: 20 de cereri pe zi pentru gemini-3\.8-flash\./);
    const withZero = google429([], [
      { quotaMetric: FREE_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: dims('gemini-3-pro'), quotaValue: '20' },
      { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count', quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier', quotaDimensions: dims('gemini-3-pro'), quotaValue: '0' },
    ]);
    expect(explain(429, withZero)?.said).toMatch(/^modelul gemini-3-pro nu e inclus în nivelul gratuit Google/);
    const noNumber = { error: { message: HELP, details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    expect(explain(429, noNumber)?.said).toMatch(/^cheia e pe nivelul gratuit Google și a atins limita lui zilnică pentru gemini-3\.8-flash\. Limita e a proiectului/);
    // No model named and none asked for (the key's model list): said without one.
    expect(explainGemini('quota', 429, noNumber, '', null, NOW)?.said).toMatch(/^cheia e pe nivelul gratuit Google și a atins limita lui zilnică\. Limita e/);
    expect(explainGemini('quota', 429, paidZeroNoModel, '', null, NOW)?.said).toBe('proiectul Google al cheii are limita 0: modelul nu e disponibil pe nivelul proiectului (vezi AI Studio, la Rate limits)');
    // A limit of one: said in Romanian.
    const one = google429([], [{ quotaMetric: PAID_METRIC, quotaId: 'GenerateRequestsPerDayPerProjectPerModel', quotaDimensions: dims('gemini-3.8-flash'), quotaValue: '1' }]);
    expect(explain(429, one)?.said).toMatch(/: o cerere pe zi pentru/);
  });

  it('the daily limits reset at midnight Pacific time (summer time and winter time, the day it changes)', () => {
    expect(nextPacificMidnight(Date.parse('2026-10-21T06:59:59Z'))).toBe(Date.parse('2026-10-21T07:00:00Z'));
    expect(nextPacificMidnight(Date.parse('2026-10-21T07:00:00Z'))).toBe(Date.parse('2026-10-22T07:00:00Z'));
    expect(nextPacificMidnight(Date.parse('2026-11-01T12:00:00Z'))).toBe(Date.parse('2026-11-02T08:00:00Z'));
    expect(nextPacificMidnight(Date.parse('2026-12-01T10:00:00Z'))).toBe(Date.parse('2026-12-02T08:00:00Z'));
  });

  it('end to end: the error says it, keeps Google’s words, is not asked again (not a passing error)', async () => {
    const n = net({ status: 429, body: FREE_DAILY });
    const err = (await new GeminiClient('AIza-test', 'gemini-3.8-flash', n).generate({ system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), name: 'x', maxTokens: 10, effort: 'low', timeoutMs: 5000 }).catch((e) => e)) as AiError;
    expect(n.calls).toBe(1);
    expect(err).toMatchObject({ kind: 'quota', transient: false, permanent: false });
    expect(err.message).toMatch(/^cheia e pe nivelul gratuit Google și a atins limita lui zilnică: 20 de cereri pe zi/);
    expect(err.detail).toBe(providerWords(FREE_DAILY.error.message));
    expect(err.detail).toContain('limit: 20, model: gemini-3.8-flash');
    expect(err.resetsAt).toBe(nextPacificMidnight(Date.now()));
    const prepay = (await new GeminiClient('k', 'gemini-3.8-flash', net({ status: 402, body: PREPAY })).generate({ system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), name: 'x', maxTokens: 10, effort: 'low', timeoutMs: 5000 }).catch((e) => e)) as AiError;
    expect(prepay).toMatchObject({ kind: 'quota', resetsAt: null, detail: PREPAY.error.message });
    expect(aiErrorLine(prepay)).toBe(`${prepay.message} (Google: ${PREPAY.error.message})`);
  });
});

describe('the key checked on an empty Prepay balance (FD-AIQUOTA §4)', () => {
  it('says so, as the scores do', async () => {
    const err = (await listModels('gemini', 'AIza-test', net({ status: 402, body: PREPAY })).catch((e) => e)) as AiError;
    expect(err).toMatchObject({ kind: 'quota', detail: PREPAY.error.message });
    expect(err.message).toMatch(/^creditul preplătit \(Prepay\)/);
  });
});

describe("the provider's own words (FD-AIQUOTA §1)", () => {
  it('kept for a quota or a limit only; spaces folded, anything like a key hidden, cut at 600', () => {
    expect(new AiError('openai', 'quota', 429, 'You exceeded your current quota, please check your plan and billing details.').detail).toBe('You exceeded your current quota, please check your plan and billing details.');
    expect(new AiError('anthropic', 'rate', 429, 'Number of request tokens has exceeded your per-minute rate limit').detail).toMatch(/per-minute/);
    for (const kind of ['auth', 'permission', 'model', 'bad_request', 'overloaded', 'connection', 'timeout', 'other'] as const) {
      expect(new AiError('openai', kind, 400, 'Incorrect API key provided: sk-proj-abcd****wxyz').detail).toBeNull();
    }
    expect(new AiError('openai', 'quota', 429, '').detail).toBeNull();
    // A message that carries the provider's words never carries a key either.
    expect(new AiError('gemini', 'permission', 403, "Permission denied: Consumer 'api_key:AIzaSyD-0123456789abcdef' has been suspended.").message).toBe(
      "cheia API Google nu are acces (Permission denied: Consumer 'api_key:…' has been suspended.)",
    );
    expect(providerWords('a\n\n   b ')).toBe('a b');
    expect(providerWords('Incorrect API key provided: sk-proj-abcd****************wxyz. Use AIzaSyD-0123456789abcdef here')).toBe('Incorrect API key provided: …. Use … here');
    const long = providerWords('x'.repeat(700));
    expect(long).toHaveLength(600);
    expect(long.endsWith('…')).toBe(true);
    // The usual words when nothing more precise is said; the log line with the provider's words.
    const plain = new AiError('openai', 'quota', 429, 'You exceeded your current quota');
    expect(plain.message).toBe('contul OpenAI nu mai are credit sau a atins limita planului');
    expect(aiErrorLine(plain)).toBe('contul OpenAI nu mai are credit sau a atins limita planului (OpenAI: You exceeded your current quota)');
    expect(aiErrorLine(new AiError('gemini', 'timeout', 0, ''))).toBe('Google nu a răspuns la timp');
    expect(aiErrorLine(new Error('boom'))).toBe('boom');
  });
});

const fakeClient = (generate: AiClient['generate']): AiClient => ({ provider: 'gemini', model: 'gemini-3.8-flash', generate });
const items = [{ id: 'a', title: 'Fed cuts rates', summary: '' }];
const ok: AiClient['generate'] = async () => ({ parsed: { results: [{ n: 1, score: 0.4, impact: 2, reason: 'r' }] } as never, stop: 'done', usage: { input: 1, output: 1 } });

describe('the pause, after a restart (FD-AIQUOTA §2)', () => {
  it('a pause still running holds; a refused key stays stopped; an ended one tries, and its error goes at the answer', async () => {
    let now = 1_000_000;
    let calls = 0;
    const generate: AiClient['generate'] = async (req) => (calls++, ok(req));
    const error = { at: now - 60_000, message: 'contul Google nu mai are credit', permanent: false, detail: 'w', resetsAt: null };
    const states: unknown[] = [];
    const held = new AiScorer({ client: fakeClient(generate), log: silentLogger, now: () => now, restored: { lastError: error, pausedUntil: now + 600_000 }, onState: (s) => states.push(s) });
    expect(held.paused()).toBe(true);
    expect(await held.score(items)).toEqual([]);
    expect(calls).toBe(0);
    expect(held.status()).toMatchObject({ lastError: error, pausedUntil: now + 600_000 });
    now += 600_000;
    expect(await held.score(items)).toHaveLength(1);
    expect(calls).toBe(1);
    expect(states).toEqual([expect.objectContaining({ lastError: null, pausedUntil: null })]);
    // A refused key: no end to the pause (its saved pause is none).
    const refused = new AiScorer({ client: fakeClient(generate), log: silentLogger, now: () => now, restored: { lastError: { ...error, permanent: true }, pausedUntil: null } });
    now += 365 * 86_400_000;
    expect(await refused.score(items)).toEqual([]);
    expect(calls).toBe(1);
    // Asked again by the user: it tries.
    refused.resume();
    expect(await refused.score(items)).toHaveLength(1);
    expect(refused.status().lastError).toBeNull();
  });

  it("the error kept says the provider's words and when the limit resets", async () => {
    const scorer = new AiScorer({
      client: fakeClient(async () => Promise.reject(new AiError('gemini', 'quota', 429, 'Quota exceeded', 'gemini-3.8-flash', { said: 'limita zilnică', resetsAt: 123 }))),
      log: silentLogger,
    });
    await scorer.score(items);
    expect(scorer.status().lastError).toMatchObject({ message: 'limita zilnică', permanent: false, detail: 'Quota exceeded', resetsAt: 123 });
  });
});

describe('the pause across instances and restarts, on the test schema (FD-AIQUOTA §2)', () => {
  const noModel: NliScorer = { status: () => ({ state: 'failed', progress: null, error: null, model: 'x' }), warmUp: () => {}, score: async () => null, onReady: () => {} };

  it('a restart keeps the pause; the user saving again (on the page’s instance) lifts it on the jobs’ instance', async () => {
    const db = await testDb();
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
    await settings.updateFor(1, true, { timezone: 'UTC' });
    await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
    await settings.setAiKey(1, 'gemini', 'AIzaSyD-test-key-0123456789abcdef');
    await settings.updateFor(1, true, { ai: { provider: 'gemini', scoring: true } });
    const now = Date.now();
    await db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
       VALUES ('n1', 's1', 'Fed cuts rates', ?, ?, 'crypto', 1, 1, 'n1', 0.1, 'x', 'local')`,
      [now - 3_600_000, now - 3_600_000],
    );
    let calls = 0;
    let refuse = true;
    const ai = new AiService({
      db,
      settings,
      log: silentLogger,
      clientFactory: (provider, _key, model) => ({
        provider,
        model,
        generate: async (req) => {
          calls++;
          if (refuse) throw new AiError('gemini', 'quota', 402, PREPAY.error.message, model, explainGemini('quota', 402, PREPAY, '', model));
          return ok(req);
        },
      }),
    });
    const jobs = new SentimentService(db, ai, noModel, silentLogger);
    expect(await jobs.scoreUsers(undefined, now)).toBe(0);
    expect(calls).toBe(1);
    const page = new SentimentService(db, ai, noModel, silentLogger);
    expect(await page.aiStatus(1)).toMatchObject({ lastError: { message: expect.stringMatching(/^creditul preplătit/), detail: PREPAY.error.message, resetsAt: null }, pausedUntil: expect.any(Number) });
    // A restart (a new service on the same base): still paused, nothing sent.
    const restarted = new SentimentService(db, ai, noModel, silentLogger);
    expect(await restarted.scoreUsers(undefined, now)).toBe(0);
    expect(calls).toBe(1);
    // The user saves their key again, served by the page's instance: the jobs' instance (paused in memory) tries.
    refuse = false;
    await page.retryNow(1);
    expect(await db.get('SELECT 1 AS x FROM market_cache WHERE [key] = ?', [scorerStateKey(1)])).toBeUndefined();
    expect(await restarted.scoreUsers(undefined, now)).toBe(1);
    expect(calls).toBe(2);
    expect((await page.aiStatus(1))?.lastError).toBeNull();
  });

  it('a state saved before FD-AIQUOTA (no words, no reset time) still reads; another key starts clean', async () => {
    const db = await testDb();
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 4)));
    await db.run("INSERT INTO sources(id, name, url, category, builtin) VALUES ('s1', 'Source 1', 'https://s1.example/rss', 'crypto', 0)");
    await settings.setAiKey(1, 'gemini', 'AIzaSyD-test-key-0123456789abcdef');
    await settings.updateFor(1, true, { ai: { provider: 'gemini', scoring: true } });
    const now = Date.now();
    await db.run(
      `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
       VALUES ('n1', 's1', 'Fed cuts rates', ?, ?, 'crypto', 1, 1, 'n1', 0.1, 'x', 'local')`,
      [now - 3_600_000, now - 3_600_000],
    );
    let calls = 0;
    const busy = new AiService({ db, settings, log: silentLogger, clientFactory: (provider, _k, model) => ({ provider, model, generate: async () => (calls++, Promise.reject(new AiError('gemini', 'overloaded', 503, ''))) }) });
    const svc = new SentimentService(db, busy, noModel, silentLogger);
    await svc.scoreUsers(undefined, now);
    // The state as the version before saved it: the same signature, no words, no reset time.
    const row = await db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [scorerStateKey(1)]);
    const { sig } = JSON.parse(row?.value ?? '{}') as { sig: string };
    const old = { sig, lastError: { at: 1, message: 'contul Google nu mai are credit sau a atins limita planului', permanent: false }, pausedUntil: now + 600_000 };
    await db.run('UPDATE market_cache SET value = ? WHERE [key] = ?', [JSON.stringify(old), scorerStateKey(1)]);
    expect(await svc.aiStatus(1, now)).toMatchObject({ lastError: old.lastError, pausedUntil: now + 600_000 });
    // Its pause holds after a restart.
    const restarted = new SentimentService(db, busy, noModel, silentLogger);
    expect(await restarted.scoreUsers(undefined, now)).toBe(0);
    expect(calls).toBe(1);
    await settings.setAiKey(1, 'gemini', 'AIzaSyD-other-key-0123456789abcdef');
    busy.forget(1);
    expect((await svc.aiStatus(1, now))?.lastError).toBeNull();
  });
});
