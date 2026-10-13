// JSON API routes (TD §11). Every input is validated with zod. Every route runs for a signed-in user (FD-USERS):
// favourites, settings, accounts and custom events are that user's own; news, sentiment and market data are common.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dayKey, isDayKey, isTimeframe, type Timeframe } from '../../shared/time.ts';
import type { AppContext } from '../context.ts';
import { readContext } from '../market/context.ts';
import { coinLogo } from '../market/logos.ts';
import { defaultStockAliases, STOCK_SYMBOL_RE } from '../market/stocks.ts';
import { fetchText } from '../net/http.ts';
import { retagRecent } from '../news/ingest.ts';
import { parseFeed } from '../news/parser.ts';
import { queryNews, newsQuerySchema } from '../news/query.ts';
import { safeHttpUrl } from '../news/normalize.ts';
import { syncStockSources, type SourceRow } from '../news/sources.ts';
import { formatIssues, TWELVEDATA_KEY_INVALID, TWELVEDATA_KEY_RE, ValidationError } from '../settings.ts';
import { me } from './auth.ts';
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
  /** The signed-in user's settings (their own time zone, market, indicators…). */
  const mine = (req: FastifyRequest) => ctx.settings.forUser(me(req).id);

  /**
   * `added`: a stock the user has just put in the watchlist (its Nasdaq feed is fetched now). Only the admin's
   * adding turns a feed back on that the admin had turned off (the sources are the admin's, FD-USERS §2).
   */
  const afterWatchlistChange = (added?: string, reenable = false) => {
    ctx.coins.invalidate();
    syncStockSources(db, reenable ? added : undefined);
    retagRecent(db, ctx.coins.get(), Date.now() - 7 * DAY, ctx.coins.classifier());
    ctx.scheduler.nudge('scanner', 1000);
    if (added) {
      ctx.scheduler.nudge('news.fetch', 1000);
      ctx.scheduler.nudge('calendar.earnings', 2000);
    }
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
    twelveData: { hasKey: ctx.stocks.td.hasKey(), ...ctx.stocks.budget.status() },
  }));

  // ---------------- sentiment ----------------
  // The same news for everybody, cut into days of each user's own time zone.
  app.get('/api/sentiment/today', async (req) => ctx.daily.today(mine(req).timezone));

  app.get('/api/sentiment/history', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const tz = mine(req).timezone;
    return { tz, points: ctx.daily.history(days, tz) };
  });

  app.get('/api/sentiment/day/:day', async (req) => {
    const { day } = parse(z.object({ day: z.string().refine(isDayKey, 'YYYY-MM-DD') }), req.params);
    return ctx.daily.computeDay(day, mine(req).timezone, Date.now());
  });

  app.post('/api/sentiment/rescore', async (req) => {
    const { hours } = parse(z.object({ hours: z.number().int().min(1).max(168).default(48) }), req.body ?? {});
    const reset = ctx.sentiment.reset(Date.now() - hours * 3_600_000);
    ctx.scheduler.nudge('sentiment.score', 0);
    return { reset };
  });

  app.post('/api/sentiment/recompute-history', async () => ({ finalized: ctx.daily.recomputeHistory() }));

  // ---------------- news ----------------
  app.get('/api/news', async (req) => queryNews(db, parse(newsQuerySchema, req.query), mine(req).timezone, me(req).id));

  // ---------------- sources ----------------
  const sourceInput = z.object({
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().url().max(500),
    category: z.enum(['crypto', 'macro', 'geopolitics', 'stocks']),
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
        category: z.enum(['crypto', 'macro', 'geopolitics', 'stocks']).optional(),
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

  // ---------------- watchlist (coins and, since FD-SENTIQ §4.1, stocks) ----------------
  const aliasesSchema = z.array(z.string().trim().min(3).max(40)).max(10);
  // A ticker of either kind (BTC, AAPL, BRK.B), for the routes that address an existing row.
  const symbolRe = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
  type WatchRow = { coin: string; quote: string; position: number; aliases: string; kind: string; name: string | null; exchange: string | null };
  const listWatchlist = (userId: number) =>
    db.all<WatchRow>('SELECT coin, quote, position, aliases, kind, name, exchange FROM watchlist WHERE user_id = ? ORDER BY position, coin', [userId]).map((w) => ({
      ...w,
      kind: w.kind === 'stock' ? ('stock' as const) : ('crypto' as const),
      aliases: (() => {
        try {
          return JSON.parse(w.aliases) as string[];
        } catch {
          return [];
        }
      })(),
    }));
  const kindLabel = (kind: string) => (kind === 'stock' ? 'acțiune' : 'monedă');

  app.get('/api/watchlist', async (req) => listWatchlist(me(req).id));

  app.post('/api/watchlist', async (req) => {
    const user = me(req);
    const w = parse(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('crypto'),
          coin: z.string().trim().toUpperCase().regex(coinRe),
          quote: z.string().trim().toUpperCase().regex(coinRe).default('USDT'),
          aliases: aliasesSchema.default([]),
        }),
        z.object({
          kind: z.literal('stock'),
          coin: z.string().trim().toUpperCase().regex(STOCK_SYMBOL_RE),
          name: z.string().trim().max(120).optional(),
          exchange: z.string().trim().toUpperCase().max(20).optional(),
          aliases: aliasesSchema.optional(),
        }),
      ]),
      // Older clients send no kind.
      { kind: 'crypto', ...((req.body ?? {}) as object) },
    );
    const existing = db.get<{ kind: string }>('SELECT kind FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, w.coin]);
    if (existing) throw new ConflictError(`${w.coin} este deja în favorite (ca ${kindLabel(existing.kind)})`);
    if ((db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [user.id])?.n ?? 0) >= 50) {
      throw new ValidationError('Lista de favorite are maximum 50 de simboluri');
    }
    const pos = (db.get<{ p: number | null }>('SELECT max(position) AS p FROM watchlist WHERE user_id = ?', [user.id])?.p ?? -1) + 1;
    if (w.kind === 'crypto') {
      db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, ?, ?, ?, ?, 'crypto')", [
        user.id,
        w.coin,
        w.quote,
        pos,
        JSON.stringify(w.aliases),
        Date.now(),
      ]);
      afterWatchlistChange();
    } else {
      const name = w.name || null;
      const aliases = w.aliases ?? defaultStockAliases(name);
      db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind, name, exchange) VALUES (?, ?, 'USD', ?, ?, ?, 'stock', ?, ?)", [
        user.id,
        w.coin,
        pos,
        JSON.stringify(aliases),
        Date.now(),
        name,
        w.exchange || null,
      ]);
      afterWatchlistChange(w.coin, user.role === 'admin');
    }
    return listWatchlist(user.id);
  });

  app.put('/api/watchlist/order', async (req) => {
    const user = me(req);
    const { coins } = parse(z.object({ coins: z.array(z.string().regex(symbolRe)).max(50) }), req.body);
    db.tx(() => coins.forEach((c, i) => db.run('UPDATE watchlist SET position = ? WHERE user_id = ? AND coin = ?', [i, user.id, c])));
    return listWatchlist(user.id);
  });

  app.put('/api/watchlist/:coin', async (req) => {
    const user = me(req);
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(symbolRe) }), req.params);
    const patch = parse(z.object({ quote: z.string().trim().toUpperCase().regex(coinRe).optional(), aliases: aliasesSchema.optional() }), req.body);
    const row = db.get<{ kind: string }>('SELECT kind FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, coin]);
    if (!row) throw new NotFoundError(`${coin} nu este în favorite`);
    if (row.kind === 'stock' && patch.quote !== undefined && patch.quote !== 'USD') throw new ValidationError('Acțiunile sunt cotate în USD');
    db.run('UPDATE watchlist SET quote = COALESCE(?, quote), aliases = COALESCE(?, aliases) WHERE user_id = ? AND coin = ?', [
      patch.quote ?? null,
      patch.aliases ? JSON.stringify(patch.aliases) : null,
      user.id,
      coin,
    ]);
    afterWatchlistChange();
    return listWatchlist(user.id);
  });

  app.delete('/api/watchlist/:coin', async (req) => {
    const user = me(req);
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(symbolRe) }), req.params);
    if (db.run('DELETE FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, coin]).changes === 0) throw new NotFoundError(`${coin} nu este în favorite`);
    afterWatchlistChange();
    return listWatchlist(user.id);
  });

  // ---------------- calendar ----------------
  app.get('/api/calendar', async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.number().int().nonnegative(),
        to: z.coerce.number().int().positive(),
        impact: z.string().max(100).optional(),
        currencies: z.string().max(200).optional(),
        earnings: z.enum(['0', '1']).optional(),
      }),
      req.query,
    );
    if (q.to <= q.from || q.to - q.from > 62 * DAY) throw new ValidationError('Interval invalid (maximum 62 de zile)');
    const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    const st = ctx.calendar.ffState();
    return {
      events: ctx.calendar.query({ userId: me(req).id, from: q.from, to: q.to, impacts: list(q.impact), currencies: list(q.currencies)?.map((c) => c.toUpperCase()), earnings: q.earnings !== '0' }),
      updated: ctx.calendar.lastUpdate(),
      ffBlockedUntil: st.blockedUntil > Date.now() ? st.blockedUntil : null,
      ffWeeks: st.weeks,
    };
  });

  app.post('/api/calendar/custom', async (req) => ({ id: ctx.calendar.addCustom(me(req).id, req.body) }));

  app.delete('/api/calendar/custom/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!ctx.calendar.deleteCustom(me(req).id, id)) throw new NotFoundError('Evenimentul nu există');
    return { ok: true };
  });

  // ---------------- market ----------------
  app.get('/api/market/candles', async (req) => {
    const s = mine(req).market;
    const { asset } = parse(z.object({ asset: z.enum(['crypto', 'stock']).default('crypto') }).passthrough(), req.query);
    if (asset === 'stock') {
      // FD-SENTIQ §4.3: a share by its ticker (Twelve Data with a key, otherwise Nasdaq daily).
      const q = parse(
        z.object({
          symbol: z.string().trim().toUpperCase().regex(STOCK_SYMBOL_RE),
          tf: z.string().refine(isTimeframe, 'Unsupported timeframe'),
          limit: z.coerce.number().int().min(50).max(5000).default(s.candles),
        }),
        req.query,
      );
      return ctx.stocks.candles(q.symbol, q.tf as Timeframe, q.limit);
    }
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

  // ---------------- stocks (FD-SENTIQ §4) ----------------
  const tickers = z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.string().regex(STOCK_SYMBOL_RE)).min(1).max(50));

  app.get('/api/stocks/info', async () => ({
    timeframes: ctx.stocks.timeframes(),
    hasKey: ctx.stocks.td.hasKey(),
    market: await ctx.stocks.confirmedStatus(),
    budget: ctx.stocks.budget.status(),
  }));

  app.get('/api/stocks/quotes', async (req) => {
    const { symbols } = parse(z.object({ symbols: tickers }), req.query);
    const one = (sym: string) =>
      ctx.stocks.quote(sym).catch((err: Error) => ({ symbol: sym, name: null, last: null, change: null, changePct: null, status: null, fetchedAt: Date.now(), error: err.message.slice(0, 200) }));
    // Five at a time: quick for a long watchlist, gentle with Nasdaq; the order of the request is kept.
    const out = [];
    for (let i = 0; i < symbols.length; i += 5) out.push(...(await Promise.all(symbols.slice(i, i + 5).map(one))));
    return out;
  });

  app.get('/api/stocks/search', async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(40) }), req.query);
    return ctx.stocks.search(q);
  });

  app.get('/api/stocks/spark', async (req) => {
    const { symbol } = parse(z.object({ symbol: z.string().trim().toUpperCase().regex(STOCK_SYMBOL_RE) }), req.query);
    return ctx.stocks.spark(symbol);
  });

  app.get('/api/market/symbols', async (req) => {
    const s = mine(req).market;
    const q = parse(z.object({ exchange: z.string().max(20).default(s.exchange), q: z.string().trim().max(20).default('') }), req.query);
    return ctx.market.searchSymbols(q.exchange, q.q);
  });

  app.get('/api/market/context', async () => readContext(db));

  // FD-SUMMARY: the user's day summary by Claude (today in their time zone).
  const summaryState = (req: FastifyRequest) => {
    const u = me(req);
    const day = dayKey(Date.now(), mine(req).timezone);
    return { summary: ctx.summary.latest(u.id, day), hasKey: ctx.summary.hasKey(), retryAt: ctx.summary.retryAt(u.id, day) };
  };
  app.get('/api/summary', async (req) => summaryState(req));
  app.post('/api/summary', async (req) => {
    const u = me(req);
    await ctx.summary.generate(u.id, dayKey(Date.now(), mine(req).timezone));
    return summaryState(req);
  });

  // FD-ECON: the economic indicators by country (common to every user).
  app.get('/api/economy', async () => ctx.economy.view());
  app.get('/api/economy/description', async (req) => {
    const { key } = parse(z.object({ key: z.string().min(1).max(200) }), req.query);
    const description = ctx.economy.description(key);
    if (description === null) throw new NotFoundError('Indicatorul nu are o descriere');
    return { description };
  });

  // Coin logo as an image (TD-ICONS). A missing logo is cached by the browser too, so it is asked once a day.
  app.get('/api/logo/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const svg = await coinLogo(symbol);
    reply.header('Cache-Control', 'public, max-age=86400');
    if (!svg) return reply.code(404).type('text/plain; charset=utf-8').send('');
    return reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('image/svg+xml; charset=utf-8').send(svg);
  });

  // ---------------- scanner ----------------
  const scanOf = (req: FastifyRequest) => ctx.scanner.result(me(req).id) ?? { computedAt: null, exchange: mine(req).market.exchange, rows: [] };

  app.get('/api/scanner', async (req) => scanOf(req));

  // A manual scan covers every user's favourites: at most one a minute, whoever asks (FD-USERS §2).
  let lastManualScan = 0;
  app.post('/api/scanner/run', async (req) => {
    if (Date.now() - lastManualScan >= 60_000) {
      lastManualScan = Date.now();
      // Through the scheduler so a manual run never overlaps the periodic one.
      await ctx.scheduler.trigger('scanner').catch(() => undefined);
    }
    return scanOf(req);
  });

  // ---------------- settings ----------------
  /** What the settings routes return: the user's own view (secrets' hints only for the admin). */
  const view = (req: FastifyRequest) => {
    const u = me(req);
    return ctx.settings.viewFor(u.id, u.role === 'admin');
  };

  app.get('/api/settings', async (req) => view(req));

  app.put('/api/settings', async (req) => {
    const u = me(req);
    const prev = ctx.settings.forUser(u.id);
    // Global keys (retention, sentiment engine) only for the admin: 403 for anybody else.
    const next = ctx.settings.updateFor(u.id, u.role === 'admin', req.body);
    if (prev.timezone !== next.timezone) ctx.scheduler.nudge('sentiment.daily', 0);
    if (
      prev.scanner.tf !== next.scanner.tf ||
      prev.market.exchange !== next.market.exchange ||
      prev.market.candles !== next.market.candles ||
      JSON.stringify(prev.indicator) !== JSON.stringify(next.indicator)
    ) {
      ctx.scheduler.nudge('scanner', 500);
    }
    return view(req);
  });

  app.put('/api/settings/twelvedata-key', async (req) => {
    const { key } = parse(z.object({ key: z.string().max(200).nullable() }), req.body);
    if (key && key.trim()) {
      // A malformed key costs no request; a wrong one is refused here, not discovered later on a chart.
      if (!TWELVEDATA_KEY_RE.test(key.trim())) throw new ValidationError(TWELVEDATA_KEY_INVALID);
      await ctx.stocks.td.verify(key.trim()).catch((err: Error) => {
        throw new ValidationError(err.message);
      });
    }
    ctx.settings.setTwelveDataKey(key);
    ctx.scheduler.nudge('scanner', 1000);
    return view(req);
  });

  app.put('/api/settings/claude-key', async (req) => {
    const { key } = parse(z.object({ key: z.string().max(400).nullable() }), req.body);
    ctx.settings.setClaudeKey(key);
    return view(req);
  });

  // ---------------- accounts & portfolio ----------------
  // FD-USERS §2: each user sees and reads only their own accounts; anybody else's id is "not found".
  const ownAccount = (req: FastifyRequest, id: number) => {
    if (!ctx.accounts.owns(me(req).id, id)) throw new NotFoundError('Contul nu există');
  };

  app.get('/api/accounts', async (req) => ctx.accounts.list(me(req).id));

  app.post('/api/accounts', async (req) => ctx.accounts.connect(me(req).id, req.body));

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    ownAccount(req, id);
    if (!ctx.accounts.delete(id)) throw new NotFoundError('Contul nu există');
    return { ok: true };
  });

  app.post('/api/accounts/:id/test', async (req) => {
    const { id } = parse(idParam, req.params);
    ownAccount(req, id);
    return ctx.accounts.test(id);
  });

  app.get('/api/portfolio/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { force } = parse(z.object({ force: z.enum(['0', '1']).optional() }), req.query);
    ownAccount(req, id);
    return ctx.accounts.portfolio(id, force === '1');
  });

  app.put('/api/portfolio/:id/cost-basis/:asset', async (req) => {
    // Shares too: BRK.B, SAP.DE (the service checks the same pattern).
    const p = parse(z.object({ id: z.coerce.number().int().positive(), asset: z.string().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/) }), req.params);
    const { avgPrice } = parse(z.object({ avgPrice: z.number().positive().nullable() }), req.body);
    ownAccount(req, p.id);
    ctx.accounts.setCostBasis(p.id, p.asset, avgPrice);
    return { ok: true };
  });
}
