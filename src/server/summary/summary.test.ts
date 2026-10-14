import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, type AppContext } from '../context.ts';
import { testDb } from '../test/db.ts';
import { loadConfig } from '../config.ts';
import { silentLogger } from '../log.ts';
import { SecretBox } from '../secrets/crypto.ts';
import type { NliScorer } from '../sentiment/local.ts';
import { parseTradingView } from '../calendar/sources.ts';
import type { Scanner } from '../scanner/scanner.ts';
import { dayKey } from '../../shared/time.ts';
import { buildDayContext, type DayContext } from './context.ts';
import { ClaudeUsage } from '../sentiment/usage.ts';
import { SUMMARY_COOLDOWN_MS, SUMMARY_MODEL, SummaryCooldownError, SummaryFailedError, SummaryService, SummaryUnavailableError, type SummaryContent } from './service.ts';

const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };

let dir: string;
let ctx: AppContext;
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-summary-'));
  ctx = await createContext({ ...loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'x') }, silentLogger, {
    nli: fakeNli,
    box: new SecretBox(Buffer.alloc(32, 6)),
    db: await testDb(),
  });
  await ctx.settings.updateFor(1, true, { timezone: 'UTC' });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 9, 13, 15, 20);
const fakeScanner = {
  result: () => ({ computedAt: NOW, exchange: 'kucoin', rows: [{ coin: 'BTC', kind: 'crypto', symbol: 'BTC/USDT', tf: '1h', ok: true, price: 83000, change24h: -1.2, uptrend: true, liveSignal: false, lastSignal: null }] }),
} as unknown as Scanner;

async function seedDay() {
  await ctx.db.run(
    `INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_label, sentiment_engine)
     VALUES ('n1', 'coindesk', 'Bitcoin slides as CPI runs hot', ?, ?, 'crypto', 1, 3, 'c1', -0.6, 'negative', 'local'),
            ('n2', 'coindesk', 'Bitcoin dips after inflation data', ?, ?, 'crypto', 1, 2, 'c1', -0.4, 'negative', 'local'),
            ('n3', 'coindesk', 'Yesterday story', ?, ?, 'crypto', 1, 3, 'c3', 0.5, 'positive', 'local')`,
    [NOW - 3_600_000, NOW, NOW - 3_000_000, NOW, NOW - 30 * 3_600_000, NOW],
  );
  const ev = (id: string, date: number, actual: number | null, forecast: number | null) => ({
    id,
    title: 'Inflation Rate YoY',
    country: 'US',
    indicator: 'Inflation Rate',
    ticker: 'ECONOMICS:USIRYY',
    category: 'prce',
    period: id === 'cpi-aug' ? 'Aug' : 'Sep',
    referenceDate: new Date(date - 20 * 86_400_000).toISOString(),
    actual,
    previous: 2.9,
    forecast,
    importance: 1,
    unit: '%',
    currency: 'USD',
    date: new Date(date).toISOString(),
  });
  await ctx.economy.ingest(parseTradingView(JSON.stringify({ result: [ev('cpi-aug', NOW - 32 * 86_400_000, 2.9, 2.8), ev('cpi-sep', NOW - 2 * 3_600_000, 3.1, 3.0)] })), undefined, NOW);
}

describe('the day context (TD-SUMMARY §2)', () => {
  it("tells Claude about today only, and offers the charts the app has data for", async () => {
    await seedDay();
    // The user's own calendar note (low impact) is there, marked as theirs; its private note is not.
    await ctx.calendar.addCustom(1, { title: 'Unlock ARB', ts: NOW + 2 * 3_600_000, impact: 'Low', note: 'secret plan' });
    const c = await buildDayContext({ db: ctx.db, settings: ctx.settings, daily: ctx.daily, calendar: ctx.calendar, economy: ctx.economy, scanner: fakeScanner }, 1, NOW);
    expect(c.day).toBe('2026-10-13');
    expect(c.tz).toBe('UTC');
    expect(c.prompt).toContain('## Sentimentul zilei');
    // In the news list: one line per story (the two Bitcoin items are one cluster), nothing from yesterday.
    const newsPart = c.prompt.split('## Știrile importante')[1]?.split('\n## ')[0] ?? '';
    expect(newsPart).toContain('Bitcoin slides as CPI runs hot');
    expect(newsPart).not.toContain('Bitcoin dips after inflation data');
    expect(c.prompt).not.toContain('Yesterday story');
    expect(c.prompt).toMatch(/\[econ:ECONOMICS:USIRYY\] SUA: Inflația \(anuală\).*3\.1%; anterior 2\.9%; prognoză 3%; creșterea e rea; IMPORTANT/);
    expect(c.prompt).toContain('- BTC: preț 83000, 24h -1.2%, trend ascendent');
    expect(c.prompt).toMatch(/CRYPTO \[Low\] Unlock ARB \(notat de utilizator\)/);
    expect(c.prompt).not.toContain('secret plan');
    for (const id of ['econ:ECONOMICS:USIRYY', 'favorites-24h', 'sentiment-breakdown']) expect(c.charts, id).toHaveProperty([id]);
    expect(c.charts['econ:ECONOMICS:USIRYY']).toMatchObject({ kind: 'line', forecast: 3, polarity: -1, unit: '%', points: [{ label: 'Aug', value: 2.9 }, { label: 'Sep', value: 3.1 }] });
    expect(c.charts['favorites-24h']).toMatchObject({ kind: 'bars', baseline: 0, bars: [{ label: 'BTC', value: -1.2 }] });
    expect(c.prompt).toContain('- econ:ECONOMICS:USIRYY: SUA: Inflația (anuală)');
  });
});

const content = (charts: { id: string; caption: string }[]): SummaryContent => ({
  verdict: 'mixta',
  confidence: 'medie',
  headline: 'Inflația peste așteptări apasă pe crypto.',
  overview: 'CPI 3,1% față de 3% prognozat.',
  sections: [{ title: 'Macro', body: 'Inflația a urcat.' }],
  opportunities: [],
  risks: ['Volatilitate după CPI.'],
  upcoming: [{ time: '20:00', event: 'Minutele FOMC', why: 'Tonul Fed.' }],
  charts,
});

function service(answer: () => unknown, opts: { calls?: unknown[] } = {}) {
  const context: DayContext = { day: '2026-10-13', tz: 'UTC', asOf: NOW, prompt: 'DATE', charts: { 'sentiment-today': { id: 'sentiment-today', kind: 'line', title: 'S', unit: null, scale: null, baseline: 50, points: [], forecast: null, polarity: 1 } } };
  return new SummaryService({
    db: ctx.db,
    settings: ctx.settings,
    log: silentLogger,
    build: () => context,
    clientFactory: () =>
      ({
        messages: {
          stream: (params: unknown) => {
            opts.calls?.push(params);
            return { finalMessage: async () => answer() };
          },
        },
      }) as never,
  });
}

describe('the summary service (TD-SUMMARY §3)', () => {
  it('needs the Claude key', async () => {
    await expect(service(() => ({})).generate(1, '2026-10-13')).rejects.toBeInstanceOf(SummaryUnavailableError);
  });

  it('asks Claude for a structured summary, keeps only charts it has data for, and stores it', async () => {
    await ctx.settings.setClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    const calls: unknown[] = [];
    // Unknown ids, names every object has ("constructor", "__proto__") and repeats are left out.
    const picked = [
      { id: 'sentiment-today', caption: 'Coborâre după CPI.' },
      { id: 'made-up', caption: 'x' },
      { id: 'constructor', caption: 'x' },
      { id: '__proto__', caption: 'x' },
      { id: 'sentiment-today', caption: 'din nou' },
    ];
    const svc = service(() => ({ stop_reason: 'end_turn', parsed_output: content(picked) }), { calls });
    const s = await svc.generate(1, '2026-10-13');
    expect(calls[0]).toMatchObject({ model: SUMMARY_MODEL, output_config: { effort: 'medium' }, messages: [{ role: 'user' }] });
    expect(JSON.stringify(calls[0])).toContain('DATE');
    expect(s.charts.map((c) => [c.id, c.caption])).toEqual([['sentiment-today', 'Coborâre după CPI.']]);
    expect(s.content.charts.map((c) => c.id)).toEqual(['sentiment-today']);
    expect(await svc.latest(1, '2026-10-13')).toMatchObject({ model: SUMMARY_MODEL, content: { verdict: 'mixta' } });
    expect(await svc.latest(1, '2026-10-12')).toBeNull();
    // Too soon for another one.
    await expect(svc.generate(1, '2026-10-13')).rejects.toBeInstanceOf(SummaryCooldownError);
    expect(await svc.retryAt(1, '2026-10-13')).toBeGreaterThan(Date.now() + SUMMARY_COOLDOWN_MS - 5000);
  });

  it('counts the tokens of every answered summary, a refused one too (FD-AICLARITY)', async () => {
    await ctx.settings.setClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    const usage = new ClaudeUsage(ctx.db);
    const make = (answer: unknown) =>
      new SummaryService({
        db: ctx.db,
        settings: ctx.settings,
        log: silentLogger,
        usage,
        build: () => ({ day: '2026-10-13', tz: 'UTC', asOf: NOW, prompt: 'DATE', charts: {} }),
        clientFactory: () => ({ messages: { stream: () => ({ finalMessage: async () => answer }) } }) as never,
      });
    await make({ stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 2500 }, parsed_output: content([]) }).generate(1, '2026-10-13');
    await expect(make({ stop_reason: 'refusal', usage: { input_tokens: 8000, output_tokens: 10 }, parsed_output: null }).generate(2, '2026-10-13')).rejects.toBeInstanceOf(SummaryFailedError);
    expect((await usage.today()).summary).toEqual({ calls: 2, items: 0, input: 17000, output: 2510 });
  });

  it('writes one summary for requests made at the same time', async () => {
    await ctx.settings.setClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    const calls: unknown[] = [];
    const svc = service(() => ({ stop_reason: 'end_turn', parsed_output: content([]) }), { calls });
    const [a, b] = await Promise.all([svc.generate(1, '2026-10-13'), svc.generate(1, '2026-10-13')]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('turns a refusal or an unreadable answer into an error, and lets the user retry at once', async () => {
    await ctx.settings.setClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    await expect(service(() => ({ stop_reason: 'refusal', parsed_output: null })).generate(1, '2026-10-13')).rejects.toBeInstanceOf(SummaryFailedError);
    await expect(service(() => ({ stop_reason: 'max_tokens', parsed_output: null })).generate(1, '2026-10-13')).rejects.toThrow(/prea lung/);
    const failing = new SummaryService({
      db: ctx.db,
      settings: ctx.settings,
      log: silentLogger,
      build: () => ({ day: 'd', tz: 'UTC', asOf: 0, prompt: '', charts: {} }),
      clientFactory: () => ({ messages: { stream: () => ({ finalMessage: async () => Promise.reject(new Error('socket hang up')) }) } }) as never,
    });
    await expect(failing.generate(1, '2026-10-13')).rejects.toThrow(/nu s-a putut genera: socket hang up/);
    // Nothing stored, so no cooldown either.
    expect(await failing.retryAt(1, '2026-10-13')).toBeNull();
    // The day's data cannot be read: an error of the summary too, and Claude is not asked.
    const calls: unknown[] = [];
    const noData = new SummaryService({
      db: ctx.db,
      settings: ctx.settings,
      log: silentLogger,
      build: () => {
        throw new Error('database is locked');
      },
      clientFactory: () => ({ messages: { stream: (p: unknown) => (calls.push(p), { finalMessage: async () => ({}) }) } }) as never,
    });
    await expect(noData.generate(1, '2026-10-13')).rejects.toThrow(/Datele zilei nu s-au putut citi/);
    expect(calls).toHaveLength(0);
  });
});

describe('the routes (TD-SUMMARY §4)', () => {
  it('are behind the sign-in, say when there is no key, and keep each user’s summary apart', async () => {
    const { buildApp } = await import('../http/app.ts');
    const { hashPassword } = await import('../auth/passwords.ts');
    const app = await buildApp(ctx);
    try {
      const hash = await hashPassword('Admin-password-1');
      await ctx.db.run('UPDATE users SET email = ?, password_hash = ? WHERE id = 1', ['admin@example.com', hash]);
      const ana = (await ctx.db.run("INSERT INTO users(email, name, password_hash, role, email_verified_at, created_at) VALUES ('ana@example.com', 'Ana', ?, 'user', 1, 1)", [hash])).lastInsertRowid;
      const h = async (uid: number) => ({ host: 'localhost:4317', cookie: `sentiq_session=${await ctx.sessions.create(uid, 'full')}`, 'x-sentiq': '1', 'content-type': 'application/json' });
      expect((await app.inject({ url: '/api/summary', headers: { host: 'localhost:4317' } })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/summary', headers: await h(1) })).json()).toEqual({ summary: null, hasKey: false, retryAt: null });
      const noKey = await app.inject({ method: 'POST', url: '/api/summary', headers: await h(1), payload: '{}' });
      expect(noKey.statusCode).toBe(400);
      expect(noKey.json().error.code).toBe('NO_CLAUDE_KEY');
      // A stored summary of the admin is not Ana's.
      const day = dayKey(Date.now(), (await ctx.settings.forUser(1)).timezone);
      await ctx.db.run(`INSERT INTO day_summaries(user_id, day, tz, created_at, model, content, charts) VALUES (1, ?, 'UTC', ?, ?, ?, '[]')`, [day, Date.now(), SUMMARY_MODEL, JSON.stringify(content([]))]);
      expect((await app.inject({ url: '/api/summary', headers: await h(1) })).json().summary).toMatchObject({ content: { verdict: 'mixta' } });
      expect((await app.inject({ url: '/api/summary', headers: await h(ana) })).json().summary).toBeNull();
      await ctx.settings.setClaudeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
      const soon = await app.inject({ method: 'POST', url: '/api/summary', headers: await h(1), payload: '{}' });
      expect(soon.statusCode).toBe(429);
      expect(soon.json().error.details.retryAt).toBeGreaterThan(Date.now());
    } finally {
      await app.close();
    }
  });
});
