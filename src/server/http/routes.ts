// JSON API routes (TD §11). Every input is validated with zod.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDayKey, isTimeframe, type Timeframe } from '../../shared/time.ts';
import type { AppContext } from '../context.ts';
import { readContext } from '../market/context.ts';
import { coinLogo } from '../market/logos.ts';
import { fetchText } from '../net/http.ts';
import { retagRecent } from '../news/ingest.ts';
import { parseFeed } from '../news/parser.ts';
import { queryNews, newsQuerySchema } from '../news/query.ts';
import { safeHttpUrl } from '../news/normalize.ts';
import type { SourceRow } from '../news/sources.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { ConflictError, NotFoundError } from './errors.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const coinRe = /^[A-Z0-9]{1,15}$/;
const DAY = 86_400_000;

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ValidationError(`Cerere invalidă: ${formatIssues(r.error.issues)}`, r.error.issues);
  return r.data;
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  const afterWatchlistChange = () => {
    ctx.coins.invalidate();
    retagRecent(db, ctx.coins.get(), Date.now() - 7 * DAY);
    ctx.scheduler.nudge('scanner', 1000);
  };

  // ---------------- health ----------------
  app.get('/api/ping', async () => ({ ok: true }));

  app.get('/api/health', async () => ({
    now: Date.now(),
    jobs: ctx.scheduler.status(),
    sources: db.all<SourceRow>('SELECT * FROM sources ORDER BY category, name').map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      enabled: s.enabled === 1,
      lastAttemptAt: s.last_attempt_at,
      lastSuccessAt: s.last_success_at,
      lastNewItemAt: s.last_new_item_at,
      lastError: s.last_error,
      failures: s.failures,
      nextFetchAt: s.next_fetch_at,
      itemCount: s.item_count,
    })),
    sentiment: { engine: ctx.sentiment.engine().id, model: ctx.nli.status(), pending: ctx.sentiment.pendingCount(), claude: ctx.sentiment.claudeStatus() },
    calendar: { ...ctx.calendar.lastUpdate(), ffBlockedUntil: ctx.calendar.ffState().blockedUntil || null },
    db: { sizeBytes: db.sizeBytes(), news: db.get<{ n: number }>('SELECT count(*) AS n FROM news')?.n ?? 0 },
  }));

  // ---------------- sentiment ----------------
  app.get('/api/sentiment/today', async () => ctx.daily.today());

  app.get('/api/sentiment/history', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    return { tz: ctx.settings.get().timezone, points: ctx.daily.history(days) };
  });

  app.get('/api/sentiment/day/:day', async (req) => {
    const { day } = parse(z.object({ day: z.string().refine(isDayKey, 'YYYY-MM-DD') }), req.params);
    return ctx.daily.computeDay(day, ctx.settings.get().timezone, Date.now());
  });

  app.post('/api/sentiment/rescore', async (req) => {
    const { hours } = parse(z.object({ hours: z.number().int().min(1).max(168).default(48) }), req.body ?? {});
    const reset = ctx.sentiment.reset(Date.now() - hours * 3_600_000);
    ctx.scheduler.nudge('sentiment.score', 0);
    return { reset };
  });

  app.post('/api/sentiment/recompute-history', async () => ({ finalized: ctx.daily.recomputeHistory() }));

  // ---------------- news ----------------
  app.get('/api/news', async (req) => queryNews(db, parse(newsQuerySchema, req.query), ctx.settings.get().timezone));

  // ---------------- sources ----------------
  const sourceInput = z.object({
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().url().max(500),
    category: z.enum(['crypto', 'macro', 'geopolitics']),
    weight: z.number().min(0.5).max(1.5).default(1),
  });

  async function testFeed(url: string): Promise<{ ok: boolean; count: number; sample: string[]; error?: string }> {
    const safe = safeHttpUrl(url);
    if (!safe) return { ok: false, count: 0, sample: [], error: 'Sunt acceptate doar adrese http(s)' };
    try {
      const res = await fetchText(safe, { timeoutMs: 15_000 });
      const items = parseFeed(res.body);
      return { ok: items.length > 0, count: items.length, sample: items.slice(0, 5).map((i) => i.title), ...(items.length ? {} : { error: 'Feed-ul nu conține articole' }) };
    } catch (err) {
      return { ok: false, count: 0, sample: [], error: (err as Error).message };
    }
  }

  app.get('/api/sources', async () => db.all<SourceRow>('SELECT * FROM sources ORDER BY category, name'));

  app.post('/api/sources/test', async (req) => {
    const { url } = parse(z.object({ url: z.string().trim().url().max(500) }), req.body);
    return testFeed(url);
  });

  app.post('/api/sources', async (req) => {
    const s = parse(sourceInput.extend({ skipTest: z.boolean().default(false) }), req.body);
    const url = safeHttpUrl(s.url);
    if (!url) throw new ValidationError('Sunt acceptate doar adrese http(s)');
    if (db.get('SELECT id FROM sources WHERE url = ?', [url])) throw new ConflictError('Feed-ul este deja adăugat');
    if (!s.skipTest) {
      const t = await testFeed(url);
      if (!t.ok) throw new ValidationError(`Feed-ul nu poate fi citit: ${t.error ?? 'nu conține articole'}`);
    }
    const id = `custom-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
    db.run('INSERT INTO sources(id, name, url, category, enabled, weight, builtin) VALUES (?, ?, ?, ?, 1, ?, 0)', [id, s.name, url, s.category, s.weight]);
    ctx.scheduler.nudge('news.fetch', 500);
    return db.get('SELECT * FROM sources WHERE id = ?', [id]);
  });

  app.put('/api/sources/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(80) }), req.params);
    const patch = parse(
      z.object({
        enabled: z.boolean().optional(),
        weight: z.number().min(0.5).max(1.5).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        category: z.enum(['crypto', 'macro', 'geopolitics']).optional(),
      }),
      req.body,
    );
    const src = db.get<SourceRow>('SELECT * FROM sources WHERE id = ?', [id]);
    if (!src) throw new NotFoundError(`Sursa ${id} nu există`);
    if (src.builtin && (patch.name !== undefined || patch.category !== undefined)) throw new ValidationError('La sursele implicite poți schimba doar activarea și ponderea');
    db.run(
      `UPDATE sources SET enabled = COALESCE(?, enabled), weight = COALESCE(?, weight), name = COALESCE(?, name), category = COALESCE(?, category),
         next_fetch_at = CASE WHEN ? = 1 THEN 0 ELSE next_fetch_at END, failures = CASE WHEN ? = 1 THEN 0 ELSE failures END
       WHERE id = ?`,
      [
        patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
        patch.weight ?? null,
        patch.name ?? null,
        patch.category ?? null,
        patch.enabled ? 1 : 0,
        patch.enabled ? 1 : 0,
        id,
      ],
    );
    if (patch.category !== undefined && patch.category !== src.category) db.run('UPDATE news SET category = ? WHERE source_id = ?', [patch.category, id]);
    if (patch.enabled) ctx.scheduler.nudge('news.fetch', 500);
    return db.get('SELECT * FROM sources WHERE id = ?', [id]);
  });

  app.delete('/api/sources/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(80) }), req.params);
    const src = db.get<SourceRow>('SELECT builtin FROM sources WHERE id = ?', [id]);
    if (!src) throw new NotFoundError(`Sursa ${id} nu există`);
    if (src.builtin) throw new ConflictError('Sursele implicite nu se pot șterge, doar dezactiva');
    db.run('DELETE FROM sources WHERE id = ?', [id]);
    return { ok: true };
  });

  // ---------------- watchlist ----------------
  const aliasesSchema = z.array(z.string().trim().min(3).max(40)).max(10);
  const listWatchlist = () =>
    db.all<{ coin: string; quote: string; position: number; aliases: string }>('SELECT coin, quote, position, aliases FROM watchlist ORDER BY position, coin').map((w) => ({
      ...w,
      aliases: (() => {
        try {
          return JSON.parse(w.aliases) as string[];
        } catch {
          return [];
        }
      })(),
    }));

  app.get('/api/watchlist', async () => listWatchlist());

  app.post('/api/watchlist', async (req) => {
    const w = parse(
      z.object({
        coin: z.string().trim().toUpperCase().regex(coinRe),
        quote: z.string().trim().toUpperCase().regex(coinRe).default('USDT'),
        aliases: aliasesSchema.default([]),
      }),
      req.body,
    );
    if (db.get('SELECT coin FROM watchlist WHERE coin = ?', [w.coin])) throw new ConflictError(`${w.coin} este deja în lista de monede favorite`);
    if ((db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist')?.n ?? 0) >= 50) throw new ValidationError('Lista de monede favorite are maximum 50 de monede');
    const pos = (db.get<{ p: number | null }>('SELECT max(position) AS p FROM watchlist')?.p ?? -1) + 1;
    db.run('INSERT INTO watchlist(coin, quote, position, aliases, added_at) VALUES (?, ?, ?, ?, ?)', [w.coin, w.quote, pos, JSON.stringify(w.aliases), Date.now()]);
    afterWatchlistChange();
    return listWatchlist();
  });

  app.put('/api/watchlist/order', async (req) => {
    const { coins } = parse(z.object({ coins: z.array(z.string().regex(coinRe)).max(50) }), req.body);
    db.tx(() => coins.forEach((c, i) => db.run('UPDATE watchlist SET position = ? WHERE coin = ?', [i, c])));
    return listWatchlist();
  });

  app.put('/api/watchlist/:coin', async (req) => {
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(coinRe) }), req.params);
    const patch = parse(z.object({ quote: z.string().trim().toUpperCase().regex(coinRe).optional(), aliases: aliasesSchema.optional() }), req.body);
    if (!db.get('SELECT coin FROM watchlist WHERE coin = ?', [coin])) throw new NotFoundError(`${coin} nu este în lista de monede favorite`);
    db.run('UPDATE watchlist SET quote = COALESCE(?, quote), aliases = COALESCE(?, aliases) WHERE coin = ?', [patch.quote ?? null, patch.aliases ? JSON.stringify(patch.aliases) : null, coin]);
    afterWatchlistChange();
    return listWatchlist();
  });

  app.delete('/api/watchlist/:coin', async (req) => {
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(coinRe) }), req.params);
    if (db.run('DELETE FROM watchlist WHERE coin = ?', [coin]).changes === 0) throw new NotFoundError(`${coin} nu este în lista de monede favorite`);
    afterWatchlistChange();
    return listWatchlist();
  });

  // ---------------- calendar ----------------
  app.get('/api/calendar', async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.number().int().nonnegative(),
        to: z.coerce.number().int().positive(),
        impact: z.string().max(100).optional(),
        currencies: z.string().max(200).optional(),
      }),
      req.query,
    );
    if (q.to <= q.from || q.to - q.from > 62 * DAY) throw new ValidationError('Interval invalid (maximum 62 de zile)');
    const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    const st = ctx.calendar.ffState();
    return {
      events: ctx.calendar.query({ from: q.from, to: q.to, impacts: list(q.impact), currencies: list(q.currencies)?.map((c) => c.toUpperCase()) }),
      updated: ctx.calendar.lastUpdate(),
      ffBlockedUntil: st.blockedUntil > Date.now() ? st.blockedUntil : null,
      ffWeeks: st.weeks,
    };
  });

  app.post('/api/calendar/custom', async (req) => ({ id: ctx.calendar.addCustom(req.body) }));

  app.delete('/api/calendar/custom/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.calendar.deleteCustom(id)) throw new NotFoundError('Evenimentul nu există');
    return { ok: true };
  });

  // ---------------- market ----------------
  app.get('/api/market/candles', async (req) => {
    const s = ctx.settings.get().market;
    const q = parse(
      z.object({
        exchange: z.string().max(20).default(s.exchange),
        symbol: z.string().regex(/^[A-Z0-9]{1,15}\/[A-Z0-9]{1,15}(:[A-Z0-9]{1,15})?$/),
        tf: z.string().refine(isTimeframe, 'Unsupported timeframe'),
        limit: z.coerce.number().int().min(50).max(5000).default(s.candles),
      }),
      req.query,
    );
    return ctx.market.candles(q.exchange, q.symbol, q.tf as Timeframe, q.limit);
  });

  app.get('/api/market/symbols', async (req) => {
    const s = ctx.settings.get().market;
    const q = parse(z.object({ exchange: z.string().max(20).default(s.exchange), q: z.string().trim().max(20).default('') }), req.query);
    return ctx.market.searchSymbols(q.exchange, q.q);
  });

  app.get('/api/market/context', async () => readContext(db));

  // Coin logo as an image (TD-ICONS). A missing logo is cached by the browser too, so it is asked once a day.
  app.get('/api/logo/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const svg = await coinLogo(symbol);
    reply.header('Cache-Control', 'public, max-age=86400');
    if (!svg) return reply.code(404).type('text/plain; charset=utf-8').send('');
    return reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('image/svg+xml; charset=utf-8').send(svg);
  });

  // ---------------- scanner ----------------
  app.get('/api/scanner', async () => ctx.scanner.result() ?? { computedAt: null, exchange: ctx.settings.get().market.exchange, rows: [] });

  app.post('/api/scanner/run', async () => {
    // Through the scheduler so a manual run never overlaps the periodic one.
    await ctx.scheduler.trigger('scanner').catch(() => undefined);
    return ctx.scanner.result() ?? { computedAt: null, exchange: ctx.settings.get().market.exchange, rows: [] };
  });

  // ---------------- settings ----------------
  app.get('/api/settings', async () => ctx.settings.view());

  app.put('/api/settings', async (req) => {
    const prev = ctx.settings.get();
    const next = ctx.settings.update(req.body);
    if (prev.timezone !== next.timezone) ctx.scheduler.nudge('sentiment.daily', 0);
    if (
      prev.scanner.tf !== next.scanner.tf ||
      prev.market.exchange !== next.market.exchange ||
      prev.market.candles !== next.market.candles ||
      JSON.stringify(prev.indicator) !== JSON.stringify(next.indicator)
    ) {
      ctx.scheduler.nudge('scanner', 500);
    }
    return ctx.settings.view();
  });

  app.put('/api/settings/claude-key', async (req) => {
    const { key } = parse(z.object({ key: z.string().max(400).nullable() }), req.body);
    ctx.settings.setClaudeKey(key);
    return ctx.settings.view();
  });

  // ---------------- accounts & portfolio ----------------
  app.get('/api/accounts', async () => ctx.accounts.list());

  app.post('/api/accounts', async (req) => {
    const created = ctx.accounts.create(req.body);
    return ctx.accounts.test(created.id);
  });

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.accounts.delete(id)) throw new NotFoundError('Contul nu există');
    return { ok: true };
  });

  app.post('/api/accounts/:id/test', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.accounts.list().some((a) => a.id === id)) throw new NotFoundError('Contul nu există');
    return ctx.accounts.test(id);
  });

  app.get('/api/portfolio/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { force } = parse(z.object({ force: z.enum(['0', '1']).optional() }), req.query);
    if (!ctx.accounts.list().some((a) => a.id === id)) throw new NotFoundError('Contul nu există');
    return ctx.accounts.portfolio(id, force === '1');
  });

  app.put('/api/portfolio/:id/cost-basis/:asset', async (req) => {
    const p = parse(z.object({ id: z.coerce.number().int().positive(), asset: z.string().toUpperCase().regex(coinRe) }), req.params);
    const { avgPrice } = parse(z.object({ avgPrice: z.number().positive().nullable() }), req.body);
    ctx.accounts.setCostBasis(p.id, p.asset, avgPrice);
    return { ok: true };
  });
}
