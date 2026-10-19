// JSON API routes (TD §11). Every input is validated with zod. Every route runs for a signed-in user (FD-USERS):
// favourites, settings, accounts and custom events are that user's own; news, sentiment and market data are common.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { indexById, indexId, LISTED_SYMBOL_RE } from '../../shared/indices.ts';
import { dayKey, isDayKey, isTimeframe, type Timeframe } from '../../shared/time.ts';
import type { AppContext } from '../context.ts';
import { readContext } from '../market/context.ts';
import { coinLogo } from '../market/logos.ts';
import { STATS_PERIODS } from '../exchange/trade-stats.ts';
import { CreditBudget, defaultStockAliases, STOCK_SYMBOL_RE, TwelveDataClient } from '../market/stocks.ts';
import { fetchText } from '../net/http.ts';
import { retagRecent } from '../news/ingest.ts';
import { parseFeed } from '../news/parser.ts';
import { queryNews, newsQuerySchema } from '../news/query.ts';
import { stockScopeFor } from '../news/stock-scope.ts';
import { FILTER_INDICES } from '../../shared/stock-indices.ts';
import { safeHttpUrl } from '../news/normalize.ts';
import { SOURCE_COLUMNS, syncStockSources, type SourceRow } from '../news/sources.ts';
import { BIN } from '../db/schema.ts';
import { formatIssues, TWELVEDATA_KEY_INVALID, TWELVEDATA_KEY_RE, ValidationError } from '../settings.ts';
import { AI_PROVIDERS } from '../../shared/ai.ts';
import { orderTicketSchema } from '../../shared/trading.ts';
import { COOLDOWN_MS, minutes } from '../auth/throttle.ts';
import { CHALLENGE_TTL_MS, WEBAUTHN_COOKIE } from '../auth/passkeys.ts';
import { TradingError } from '../exchange/trading/types.ts';
import { me } from './auth.ts';
import { relyingParty } from './auth-routes.ts';
import { readCookie, setCookie } from './cookies.ts';
import { ConflictError, NotFoundError } from './errors.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const coinRe = /^[A-Z0-9]{1,15}$/;
/** A crypto pair as the charts ask for it (BASE/QUOTE, or a contract BASE/QUOTE:SETTLE). */
const PAIR_RE = /^[A-Z0-9]{1,15}\/[A-Z0-9]{1,15}(:[A-Z0-9]{1,15})?$/;
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
  const sourceById = (id: string) => db.get<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`, [id]);

  /**
   * `added`: a stock the user has just put in the watchlist (its Nasdaq feed is fetched now). Only the admin's
   * adding turns a feed back on that the admin had turned off (the sources are the admin's, FD-USERS §2).
   */
  const afterWatchlistChange = async (added?: string, reenable = false) => {
    ctx.coins.invalidate();
    for (const sym of await syncStockSources(db, reenable ? added : undefined)) ctx.log.info(`news: removed the automatic feed of ${sym} (in nobody's favourites)`);
    await retagRecent(db, await ctx.coins.get(), Date.now() - 7 * DAY, await ctx.coins.classifier());
    ctx.scheduler.nudge('scanner', 1000);
    if (added) {
      ctx.scheduler.nudge('news.fetch', 1000);
      ctx.scheduler.nudge('calendar.earnings', 2000);
    }
  };

  // ---------------- health ----------------
  app.get('/api/ping', async () => ({ ok: true }));

  app.get('/api/health', async () => {
    // Independent reads at once: each one is a trip to the database (TD-AZURE §12).
    const [jobs, jobsLeader, sources, pending, aiUsers, calendar, ff, info, news, tdUsers] = await Promise.all([
      ctx.scheduler.status(),
      ctx.scheduler.currentLeader(),
      db.all<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY category, name, id`),
      ctx.sentiment.pendingCount(),
      ctx.ai.scoringUsers(),
      ctx.calendar.lastUpdate(),
      ctx.calendar.ffState(),
      db.info(),
      db.get<{ n: number }>('SELECT count(*) AS n FROM news'),
      ctx.settings.usersWithKey('twelvedata'),
    ]);
    return {
      now: Date.now(),
      jobs,
      jobsLeader,
      sources: sources.map((s) => ({
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
      // FD-AIKEYS: the common score is the local model's; some users have their own AI score the news too.
      sentiment: { engine: ctx.sentiment.engine().id, model: ctx.nli.status(), pending, aiUsers: aiUsers.length },
      calendar: { ...calendar, ffBlockedUntil: ff.blockedUntil || null },
      db: { ...info, news: news?.n ?? 0 },
      // FD-TDKEYS: each user's own key; how many have one (their credits are theirs to see).
      twelveData: { users: tdUsers.length },
    };
  });

  // ---------------- sentiment ----------------
  // The same news for everybody, cut into days of each user's own time zone; scored by the local model, or by the
  // user's own AI where they chose it (FD-AIKEYS).
  const scope = (req: FastifyRequest) => ctx.daily.scopeFor(me(req).id);
  /** The user's own AI scores the news (FD-AIKEYS): its score is shown where it gave one. */
  const ownAiScores = async (req: FastifyRequest) => ctx.ai.isScoring(me(req).id);
  app.get('/api/sentiment/today', async (req) => ctx.daily.today((await mine(req)).timezone, Date.now(), await scope(req)));

  app.get('/api/sentiment/history', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const tz = (await mine(req)).timezone;
    return { tz, points: await ctx.daily.history(days, tz, Date.now(), await scope(req)) };
  });

  app.get('/api/sentiment/day/:day', async (req) => {
    const { day } = parse(z.object({ day: z.string().refine(isDayKey, 'YYYY-MM-DD') }), req.params);
    return ctx.daily.computeDay(day, (await mine(req)).timezone, Date.now(), true, await scope(req));
  });

  app.post('/api/sentiment/rescore', async (req) => {
    const { hours } = parse(z.object({ hours: z.number().int().min(1).max(168).default(48) }), req.body ?? {});
    const reset = await ctx.sentiment.reset(Date.now() - hours * 3_600_000);
    ctx.scheduler.nudge('sentiment.score', 0);
    return { reset };
  });

  app.post('/api/sentiment/recompute-history', async () => ({ finalized: await ctx.daily.recomputeHistory() }));

  // ---------------- news ----------------
  // FD-INDEXNEWS: the indices the stock news can be limited to, with how many companies and the lists' date.
  app.get('/api/stock-indices', async () => {
    const m = await ctx.indexMembers.get();
    return { asOf: m.asOf, indices: FILTER_INDICES.map((f) => ({ ...f, count: m.members[f.id].length })) };
  });

  app.get('/api/news', async (req) =>
    queryNews(db, parse(newsQuerySchema, req.query), (await mine(req)).timezone, me(req).id, Date.now(), await ownAiScores(req), await stockScopeFor(db, ctx.settings, me(req).id)),
  );

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

  app.get('/api/sources', async () => db.all<SourceRow>(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY category, name, id`));

  app.post('/api/sources/test', async (req) => {
    const { url } = parse(z.object({ url: z.string().trim().url().max(500) }), req.body);
    return testFeed(url);
  });

  app.post('/api/sources', async (req) => {
    const s = parse(sourceInput.extend({ skipTest: z.boolean().default(false) }), req.body);
    const url = safeHttpUrl(s.url);
    if (!url) throw new ValidationError('Sunt acceptate doar adrese http(s)');
    const taken = () => db.get('SELECT id FROM sources WHERE url = ?', [url]);
    if (await taken()) throw new ConflictError('Feed-ul este deja adăugat');
    if (!s.skipTest) {
      const t = await testFeed(url);
      if (!t.ok) throw new ValidationError(`Feed-ul nu poate fi citit: ${t.error ?? 'nu conține articole'}`);
    }
    const id = `custom-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
    // Checked again with the insert: the same feed added twice at once is added once.
    await db.tx(async () => {
      if ((await taken()) || (await sourceById(id))) throw new ConflictError('Feed-ul este deja adăugat');
      await db.run('INSERT INTO sources(id, name, url, category, enabled, weight, builtin) VALUES (?, ?, ?, ?, 1, ?, 0)', [id, s.name, url, s.category, s.weight]);
    });
    ctx.scheduler.nudge('news.fetch', 500);
    return sourceById(id);
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
    await db.tx(async () => {
      const src = await sourceById(id);
      if (!src) throw new NotFoundError(`Sursa ${id} nu există`);
      if (src.builtin && (patch.name !== undefined || patch.category !== undefined)) throw new ValidationError('La sursele implicite poți schimba doar activarea și ponderea');
      await db.run(
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
      if (patch.category !== undefined && patch.category !== src.category) await db.run('UPDATE news SET category = ? WHERE source_id = ?', [patch.category, id]);
    });
    if (patch.enabled) ctx.scheduler.nudge('news.fetch', 500);
    return sourceById(id);
  });

  app.delete('/api/sources/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(80) }), req.params);
    await db.tx(async () => {
      const src = await db.get<SourceRow>('SELECT builtin FROM sources WHERE id = ?', [id]);
      if (!src) throw new NotFoundError(`Sursa ${id} nu există`);
      if (src.builtin) throw new ConflictError('Sursele implicite nu se pot șterge, doar dezactiva');
      await db.run('DELETE FROM sources WHERE id = ?', [id]);
    });
    return { ok: true };
  });

  // ---------------- watchlist (coins and, since FD-SENTIQ §4.1, stocks; since FD-INDICES, indices) ----------------
  const aliasesSchema = z.array(z.string().trim().min(3).max(40)).max(10);
  // A ticker of any kind (BTC, AAPL, BRK.B, ^SPX), for the routes that address an existing row.
  const symbolRe = /^\^?[A-Z0-9][A-Z0-9.-]{0,14}$/;
  type WatchRow = { coin: string; quote: string; position: number; aliases: string; kind: string; name: string | null; exchange: string | null };
  const listWatchlist = async (userId: number) =>
    (await db.all<WatchRow>('SELECT coin, quote, position, aliases, kind, name, exchange FROM watchlist WHERE user_id = ? ORDER BY position, coin', [userId])).map((w) => ({
      ...w,
      // Rows saved before FD-SENTIQ §4.1 have no other kind than crypto.
      kind: w.kind === 'stock' || w.kind === 'index' ? w.kind : ('crypto' as const),
      aliases: (() => {
        try {
          return JSON.parse(w.aliases) as string[];
        } catch {
          return [];
        }
      })(),
    }));
  const kindLabel = (kind: string) => (kind === 'stock' ? 'acțiune' : kind === 'index' ? 'indice' : 'monedă');

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
        // FD-INDICES: one of the catalog's, by its symbol ("SPX") or id ("^SPX"); kept under the id.
        z.object({
          kind: z.literal('index'),
          coin: z
            .string()
            .max(10)
            .transform((v, c) => indexId(v) ?? (c.addIssue({ code: 'custom', message: 'Indice necunoscut' }), z.NEVER)),
          aliases: aliasesSchema.optional(),
        }),
      ]),
      // Older clients send no kind.
      { kind: 'crypto', ...((req.body ?? {}) as object) },
    );
    // Checked, placed and added in one transaction: two adds at once never pass the limit or share a position.
    await db.tx(async () => {
      const existing = await db.get<{ kind: string }>('SELECT kind FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, w.coin]);
      if (existing) throw new ConflictError(`${w.coin.replace(/^\^/, '')} este deja în favorite (ca ${kindLabel(existing.kind)})`);
      if (((await db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [user.id]))?.n ?? 0) >= 50) {
        throw new ValidationError('Lista de favorite are maximum 50 de simboluri');
      }
      const pos = ((await db.get<{ p: number | null }>('SELECT max(position) AS p FROM watchlist WHERE user_id = ?', [user.id]))?.p ?? -1) + 1;
      if (w.kind === 'crypto') {
        await db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, ?, ?, ?, ?, N'crypto')", [
          user.id,
          w.coin,
          w.quote,
          pos,
          JSON.stringify(w.aliases),
          Date.now(),
        ]);
      } else if (w.kind === 'index') {
        const info = indexById(w.coin);
        await db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind, name, exchange) VALUES (?, ?, N'USD', ?, ?, ?, N'index', ?, NULL)", [
          user.id,
          w.coin,
          pos,
          JSON.stringify(w.aliases ?? info?.aliases ?? []),
          Date.now(),
          info?.name ?? null,
        ]);
      } else {
        const name = w.name || null;
        const aliases = w.aliases ?? defaultStockAliases(name);
        await db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind, name, exchange) VALUES (?, ?, N'USD', ?, ?, ?, N'stock', ?, ?)", [
          user.id,
          w.coin,
          pos,
          JSON.stringify(aliases),
          Date.now(),
          name,
          w.exchange || null,
        ]);
      }
    });
    // A new stock may need its news feed and its results (FD-AUTOFEED); a coin or an index only the retagging.
    if (w.kind === 'stock') await afterWatchlistChange(w.coin, user.role === 'admin');
    else await afterWatchlistChange();
    return listWatchlist(user.id);
  });

  app.put('/api/watchlist/order', async (req) => {
    const user = me(req);
    const { coins } = parse(z.object({ coins: z.array(z.string().regex(symbolRe)).max(50) }), req.body);
    // One statement: each listed symbol gets its index (OPENJSON's [key]) as position.
    await db.run(`UPDATE w SET position = CAST(j.[key] AS int) FROM watchlist w JOIN OPENJSON(?) j ON w.coin = j.value COLLATE ${BIN} WHERE w.user_id = ?`, [JSON.stringify(coins), user.id]);
    return listWatchlist(user.id);
  });

  app.put('/api/watchlist/:coin', async (req) => {
    const user = me(req);
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(symbolRe) }), req.params);
    const patch = parse(z.object({ quote: z.string().trim().toUpperCase().regex(coinRe).optional(), aliases: aliasesSchema.optional() }), req.body);
    await db.tx(async () => {
      const row = await db.get<{ kind: string }>('SELECT kind FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, coin]);
      if (!row) throw new NotFoundError(`${coin} nu este în favorite`);
      if (row.kind !== 'crypto' && patch.quote !== undefined && patch.quote !== 'USD') throw new ValidationError(row.kind === 'index' ? 'Indicii sunt cotați în USD' : 'Acțiunile sunt cotate în USD');
      await db.run('UPDATE watchlist SET quote = COALESCE(?, quote), aliases = COALESCE(?, aliases) WHERE user_id = ? AND coin = ?', [
        patch.quote ?? null,
        patch.aliases ? JSON.stringify(patch.aliases) : null,
        user.id,
        coin,
      ]);
    });
    await afterWatchlistChange();
    return listWatchlist(user.id);
  });

  app.delete('/api/watchlist/:coin', async (req) => {
    const user = me(req);
    const { coin } = parse(z.object({ coin: z.string().toUpperCase().regex(symbolRe) }), req.params);
    if ((await db.run('DELETE FROM watchlist WHERE user_id = ? AND coin = ?', [user.id, coin])).changes === 0) throw new NotFoundError(`${coin} nu este în favorite`);
    await afterWatchlistChange();
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
    const st = await ctx.calendar.ffState();
    return {
      events: await ctx.calendar.query({ userId: me(req).id, from: q.from, to: q.to, impacts: list(q.impact), currencies: list(q.currencies)?.map((c) => c.toUpperCase()), earnings: q.earnings !== '0' }),
      updated: await ctx.calendar.lastUpdate(),
      ffBlockedUntil: st.blockedUntil > Date.now() ? st.blockedUntil : null,
      ffWeeks: st.weeks,
    };
  });

  app.post('/api/calendar/custom', async (req) => ({ id: await ctx.calendar.addCustom(me(req).id, req.body) }));

  app.delete('/api/calendar/custom/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await ctx.calendar.deleteCustom(me(req).id, id))) throw new NotFoundError('Evenimentul nu există');
    return { ok: true };
  });

  // ---------------- market ----------------
  app.get('/api/market/candles', async (req) => {
    const s = await ctx.marketSource.forUser(me(req).id);
    const { asset } = parse(z.object({ asset: z.enum(['crypto', 'stock', 'index']).default('crypto') }).passthrough(), req.query);
    if (asset === 'index') {
      // FD-INDICES: daily and weekly candles of one of the catalog's indices ("SPX" or "^SPX").
      const q = parse(
        z.object({
          symbol: z
            .string()
            .max(10)
            .transform((v, c) => indexId(v) ?? (c.addIssue({ code: 'custom', message: 'Indice necunoscut' }), z.NEVER)),
          tf: z.string().refine(isTimeframe, 'Unsupported timeframe'),
          limit: z.coerce.number().int().min(50).max(5000).default(s.candles),
        }),
        req.query,
      );
      return ctx.stocks.candles(q.symbol, q.tf as Timeframe, q.limit, me(req).id);
    }
    if (asset === 'stock') {
      // FD-SENTIQ §4.3: a share by its ticker (Twelve Data with the user's own key, FD-TDKEYS; otherwise Nasdaq daily).
      const q = parse(
        z.object({
          symbol: z.string().trim().toUpperCase().regex(STOCK_SYMBOL_RE),
          tf: z.string().refine(isTimeframe, 'Unsupported timeframe'),
          limit: z.coerce.number().int().min(50).max(5000).default(s.candles),
        }),
        req.query,
      );
      return ctx.stocks.candles(q.symbol, q.tf as Timeframe, q.limit, me(req).id);
    }
    const q = parse(
      z.object({
        // FD-MARKETSRC: chosen here per user and pair; an explicit one (an open tab from before) is still served.
        exchange: z.string().max(20).optional(),
        symbol: z.string().regex(PAIR_RE),
        tf: z.string().refine(isTimeframe, 'Unsupported timeframe'),
        limit: z.coerce.number().int().min(50).max(5000).default(s.candles),
      }),
      req.query,
    );
    const exchange = q.exchange ?? (await ctx.marketSource.forSymbol(me(req).id, q.symbol));
    return ctx.market.candles(exchange, q.symbol, q.tf as Timeframe, q.limit);
  });

  /** FD-MARKETSRC: where the user's crypto prices come from (for one pair, when given) and that exchange's timeframes. */
  app.get('/api/market/source', async (req) => {
    const u = me(req);
    const { symbol } = parse(z.object({ symbol: z.string().regex(PAIR_RE).optional() }), req.query);
    const s = await ctx.marketSource.forUser(u.id);
    const exchange = symbol ? await ctx.marketSource.forSymbol(u.id, symbol) : s.exchange;
    return { exchange, userExchange: s.exchange, connected: s.connected, defaultExchange: s.defaultExchange, candles: s.candles, timeframes: ctx.market.timeframes(exchange) };
  });

  // ---------------- stocks (FD-SENTIQ §4) ----------------
  const tickers = z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))])
    // Shares and, since FD-INDICES, index ids (an unknown index comes back with its error, like an unknown share).
    .pipe(z.array(z.string().regex(LISTED_SYMBOL_RE)).min(1).max(50));

  /** The user's stock data (FD-TDKEYS): the timeframes their key gives, and its plan and credits. */
  app.get('/api/stocks/info', async (req) => {
    const u = me(req).id;
    const budget = ctx.stocks.budget(u);
    // Made on the user's first request: its stored plan and day count are read first.
    await budget.ready;
    return { timeframes: await ctx.stocks.timeframes(u), hasKey: await ctx.stocks.hasKey(u), market: await ctx.stocks.confirmedStatus(), budget: budget.status() };
  });

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
    return ctx.stocks.search(q, me(req).id);
  });

  app.get('/api/stocks/spark', async (req) => {
    const { symbol } = parse(z.object({ symbol: z.string().trim().toUpperCase().regex(LISTED_SYMBOL_RE) }), req.query);
    return ctx.stocks.spark(symbol);
  });

  app.get('/api/market/symbols', async (req) => {
    const s = await ctx.marketSource.forUser(me(req).id);
    const q = parse(z.object({ exchange: z.string().max(20).optional(), q: z.string().trim().max(20).default('') }), req.query);
    if (q.exchange) return ctx.market.searchSymbols(q.exchange, q.q);
    // The user's exchange and the default one (whose pairs the charts fall back to), each pair once, the user's first.
    const lists = await Promise.all(
      [...new Set([s.exchange, s.defaultExchange])].map((id) => ctx.market.searchSymbols(id, q.q).catch((err: Error) => (id === s.exchange ? Promise.reject(err) : []))),
    );
    const seen = new Set<string>();
    return lists.flat().filter((m) => !seen.has(m.symbol) && seen.add(m.symbol)).slice(0, 50);
  });

  app.get('/api/market/context', async () => readContext(db));

  // FD-SUMMARY: the user's day summary (today in their time zone), by their own AI (FD-AIKEYS).
  const summaryState = async (req: FastifyRequest) => {
    const u = me(req);
    const day = dayKey(Date.now(), (await mine(req)).timezone);
    const ai = await ctx.ai.config(u.id);
    return {
      summary: await ctx.summary.latest(u.id, day),
      hasKey: ai.key !== null,
      ai: { provider: ai.provider, model: ai.model },
      retryAt: await ctx.summary.retryAt(u.id, day),
    };
  };
  app.get('/api/summary', async (req) => summaryState(req));
  app.post('/api/summary', async (req) => {
    const u = me(req);
    await ctx.summary.generate(u.id, dayKey(Date.now(), (await mine(req)).timezone));
    return summaryState(req);
  });

  // FD-ECON: the economic indicators by country (common to every user).
  app.get('/api/economy', async () => ctx.economy.view());
  app.get('/api/economy/description', async (req) => {
    const { key } = parse(z.object({ key: z.string().min(1).max(200) }), req.query);
    const description = await ctx.economy.description(key);
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
  const scanOf = async (req: FastifyRequest) => ctx.scanner.result(me(req).id) ?? { computedAt: null, exchange: (await ctx.marketSource.forUser(me(req).id)).exchange, rows: [] };

  // A manual scan covers every user's favourites: at most one a minute, whoever asks (FD-USERS §2).
  let lastManualScan = 0;

  app.get('/api/scanner', async (req) => {
    // An instance that does not run the jobs (TD-AZURE §6) scans when a page asks, in the background, at most once a
    // minute: its results live in its own memory.
    if (!ctx.scheduler.leaderInfo().self && Date.now() - lastManualScan >= 60_000) {
      lastManualScan = Date.now();
      void ctx.scheduler.trigger('scanner').catch(() => undefined);
    }
    return scanOf(req);
  });
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
    const prev = await ctx.settings.forUser(u.id);
    // Global keys (retention, market data) only for the admin: 403 for anybody else.
    const next = await ctx.settings.updateFor(u.id, u.role === 'admin', req.body);
    if (JSON.stringify(prev.ai) !== JSON.stringify(next.ai)) {
      // FD-AIKEYS: another provider, model or scoring choice: the scorer and the index follow at once.
      ctx.ai.forgetChoice(u.id);
      ctx.scheduler.nudge('sentiment.ai', 500);
      ctx.scheduler.nudge('sentiment.daily', 2000);
    }
    if (prev.timezone !== next.timezone) ctx.scheduler.nudge('sentiment.daily', 0);
    if (JSON.stringify(prev.stockNews) !== JSON.stringify(next.stockNews)) {
      // FD-INDEXNEWS §3: the user's own index is computed again with the new filter (the days with stored news).
      await ctx.daily.resetUser(u.id);
      ctx.scheduler.nudge('sentiment.daily', 500);
    }
    if (
      prev.scanner.tf !== next.scanner.tf ||
      prev.market.exchange !== next.market.exchange ||
      JSON.stringify(prev.marketData) !== JSON.stringify(next.marketData) ||
      JSON.stringify(prev.indicator) !== JSON.stringify(next.indicator)
    ) {
      ctx.scheduler.nudge('scanner', 500);
    }
    return view(req);
  });

  /** FD-TDKEYS: the user's own Twelve Data key, checked (one credit, theirs) before it is saved. */
  app.put('/api/settings/twelvedata-key', async (req) => {
    const u = me(req).id;
    const { key } = parse(z.object({ key: z.string().max(200).nullable() }), req.body);
    const k = key?.trim() ?? '';
    const before = await ctx.settings.getTwelveDataKey(u);
    const changed = (k || null) !== before;
    if (k) {
      // A malformed key costs no request; a wrong one is refused here, not discovered later on a chart. A new key is
      // checked on its own credits (one), not on those of the key it replaces.
      if (!TWELVEDATA_KEY_RE.test(k)) throw new ValidationError(TWELVEDATA_KEY_INVALID);
      const checker = changed ? new TwelveDataClient(async () => k, new CreditBudget()) : ctx.stocks.td(u);
      await checker.verify(k).catch((err: Error) => {
        throw new ValidationError(err.message);
      });
    }
    await ctx.settings.setTwelveDataKey(u, k || null);
    // Another key (or none): its use of the day starts from nothing but its check (FD-TDKEYS §2).
    if (changed) await ctx.stocks.budget(u).reset(k ? 1 : 0);
    // FD-TDPLAN: the new key's limits (a plan that cannot be read now is read by the job later); none without a key.
    await ctx.stocks.refreshPlan(u, k || null).catch((err: Error) => ctx.log.warn(`twelvedata: the plan of user ${u} could not be read (${err.message})`));
    ctx.scheduler.nudge('scanner', 1000);
    return view(req);
  });

  /** FD-TDPLAN: read the user's plan again now (after an upgrade on Twelve Data's site). */
  app.post('/api/settings/twelvedata-plan', async (req) => {
    const u = me(req).id;
    if (!(await ctx.stocks.hasKey(u))) throw new ValidationError('Cheia ta Twelve Data lipsește');
    await ctx.stocks.refreshPlan(u).catch((err: Error) => {
      throw new ValidationError(err.message);
    });
    return { budget: ctx.stocks.budget(u).status() };
  });

  // ---------------- each user's own AI (FD-AIKEYS) ----------------
  const providerParam = z.object({ provider: z.enum(AI_PROVIDERS) });

  /** Saves (checked with the provider first) or removes the user's key of one provider. */
  app.put('/api/ai/key', async (req) => {
    const u = me(req);
    const { provider, key } = parse(providerParam.extend({ key: z.string().max(400).nullable() }), req.body);
    const { warning } = await ctx.ai.setKey(u.id, provider, key);
    ctx.scheduler.nudge('sentiment.ai', 500);
    ctx.scheduler.nudge('sentiment.daily', 2000);
    return { ...(await view(req)), aiKeyWarning: warning };
  });

  /** The models the user's key of a provider can use (Sentiq's list without a key). */
  app.get('/api/ai/models', async (req) => {
    const { provider } = parse(providerParam, req.query);
    return ctx.ai.models(me(req).id, provider);
  });

  /** The user's AI: what it is, whether it scores the news (and how that goes), what it spent today. */
  app.get('/api/ai/status', async (req) => {
    const u = me(req);
    const [c, scoring, usage] = await Promise.all([ctx.ai.config(u.id), ctx.sentiment.aiStatus(u.id), ctx.ai.usage.today(u.id)]);
    return { provider: c.provider, model: c.model, keySet: c.key !== null, scoring: c.scoring, scorer: scoring, usage };
  });

  /** The user's AI scores the last hours' news again (after another model, say). */
  app.post('/api/ai/rescore', async (req) => {
    const u = me(req);
    const { hours } = parse(z.object({ hours: z.number().int().min(1).max(48).default(48) }), req.body ?? {});
    if (!(await ctx.ai.isScoring(u.id))) throw new ValidationError('Scorul știrilor nu folosește AI-ul tău: alege-l întâi, cu cheia salvată.');
    const reset = await ctx.sentiment.resetUser(u.id, Date.now() - hours * 3_600_000);
    ctx.scheduler.nudge('sentiment.ai', 0);
    return { reset };
  });

  // ---------------- accounts & portfolio ----------------
  // FD-USERS §2: each user sees and reads only their own accounts; anybody else's id is "not found".
  const ownAccount = async (req: FastifyRequest, id: number) => {
    if (!(await ctx.accounts.owns(me(req).id, id))) throw new NotFoundError('Contul nu există');
  };

  app.get('/api/accounts', async (req) => ctx.accounts.list(me(req).id));

  /** FD-MARKETSRC: an account added or removed can change where the user's prices come from. */
  const afterAccountsChange = (userId: number) => {
    ctx.marketSource.forget(userId);
    ctx.scheduler.nudge('scanner', 1000);
  };

  app.post('/api/accounts', async (req) => {
    const userId = me(req).id;
    const added = await ctx.accounts.connect(userId, req.body);
    afterAccountsChange(userId);
    return added;
  });

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await ownAccount(req, id);
    if (!(await ctx.accounts.delete(id))) throw new NotFoundError('Contul nu există');
    ctx.trading.forget(id);
    afterAccountsChange(me(req).id);
    return { ok: true };
  });

  app.post('/api/accounts/:id/test', async (req) => {
    const { id } = parse(idParam, req.params);
    await ownAccount(req, id);
    return ctx.accounts.test(id);
  });

  app.get('/api/portfolio/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { force } = parse(z.object({ force: z.enum(['0', '1']).optional() }), req.query);
    await ownAccount(req, id);
    return ctx.accounts.portfolio(id, force === '1');
  });

  // FD-TRADESTATS: wins, losses, success rate and net result of the futures positions closed in a period.
  app.get('/api/portfolio/:id/stats', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ period: z.enum(STATS_PERIODS).default('30d'), force: z.enum(['0', '1']).optional() }), req.query);
    await ownAccount(req, id);
    return ctx.accounts.tradeStats(id, q.period, (await mine(req)).timezone, q.force === '1');
  });

  app.put('/api/portfolio/:id/cost-basis/:asset', async (req) => {
    // Shares too: BRK.B, SAP.DE (the service checks the same pattern).
    const p = parse(z.object({ id: z.coerce.number().int().positive(), asset: z.string().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/) }), req.params);
    const { avgPrice } = parse(z.object({ avgPrice: z.number().positive().nullable() }), req.body);
    await ownAccount(req, p.id);
    await ctx.accounts.setCostBasis(p.id, p.asset, avgPrice);
    return { ok: true };
  });

  // ---------------- trading (FD-TRADING) ----------------
  // Only the user's own accounts (others are "not found"), only where trading was switched on (the service checks).

  app.get('/api/trading', async (req) => ({ accounts: await ctx.trading.caps(me(req).id) }));

  app.get('/api/trading/log', async (req) => ctx.trading.journalOf(me(req).id));

  // FD-TRADEUNLOCK: a passkey answers for both factors, as at sign-in; the challenge is bound to this user.
  app.post('/api/trading/passkey/options', async (req, reply) => {
    const { options, challengeId } = await ctx.passkeys.stepUpOptions(me(req).id, relyingParty(req));
    setCookie(req, reply, WEBAUTHN_COOKIE, challengeId, { maxAgeMs: CHALLENGE_TTL_MS, path: '/api' });
    return options;
  });

  app.post('/api/accounts/:id/trading', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const u = me(req);
    const b = parse(
      z.object({ enabled: z.boolean(), password: z.string().max(200).optional(), code: z.string().max(40).optional(), passkey: z.record(z.string(), z.unknown()).optional() }),
      req.body,
    );
    await ownAccount(req, id);
    if (!b.enabled) return ctx.trading.disable(u.id, id);
    // Both factors again, on the account's own attempt budget (as changing the password or the authenticator).
    const key = `account:${u.id}`;
    const passkey = b.passkey;
    if (passkey) {
      // A passkey cannot be guessed: a refused one costs no attempt and a lockout does not stop it (as at sign-in).
      const challengeId = readCookie(req, WEBAUTHN_COOKIE);
      setCookie(req, reply, WEBAUTHN_COOKIE, null, { path: '/api' });
      const view = await ctx.trading.enable(u.id, id, async () => {
        try {
          await ctx.passkeys.completeStepUp(u.id, challengeId, passkey, relyingParty(req));
        } catch (err) {
          ctx.log.warn(`trading: user ${u.id} switching trading on for account ${id} refused: passkey (${(err as Error).message})`);
          throw err;
        }
        return 'ok';
      });
      ctx.throttle.reset(key);
      return view;
    }
    const lockedError = (ms: number) => Object.assign(new Error(`Prea multe încercări. Mai încearcă peste ${minutes(ms)} minute.`), { statusCode: 429, code: 'TOO_MANY_ATTEMPTS' });
    return ctx.throttle.serial(key, async () => {
      const locked = ctx.throttle.lockedFor(key);
      if (locked) throw lockedError(locked);
      try {
        const view = await ctx.trading.enable(u.id, id, () => ctx.users.stepUp(u.id, b.password, b.code));
        ctx.throttle.reset(key);
        return view;
      } catch (err) {
        if (err instanceof TradingError && err.code === 'BAD_FACTORS') {
          const now = ctx.throttle.registerFailure(key);
          if (now) throw lockedError(now);
          const left = ctx.throttle.remaining(key);
          const pause = `apoi o pauză de ${minutes(COOLDOWN_MS)} minute`;
          err.message += left === 1 ? ` Mai ai o încercare, ${pause}.` : ` Mai ai ${left} încercări, ${pause}.`;
        }
        throw err;
      }
    });
  });

  const tradeMarket = z.enum(['spot', 'futures', 'stock']);

  app.get('/api/trading/:id/symbols', async (req) => {
    const { id } = parse(idParam, req.params);
    const { market } = parse(z.object({ market: tradeMarket }), req.query);
    await ownAccount(req, id);
    return ctx.trading.symbols(me(req).id, id, market);
  });

  app.get('/api/trading/:id/instrument', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ market: tradeMarket, symbol: z.string().trim().min(1).max(40) }), req.query);
    await ownAccount(req, id);
    return ctx.trading.instrument(me(req).id, id, q.market, q.symbol);
  });

  /** The form names the account it was filled for; it must be the one in the address. */
  const ticketFor = (id: number, body: unknown) => {
    const t = parse(orderTicketSchema, body);
    if (t.accountId !== id) throw new ValidationError('Formularul e pentru alt cont.');
    return t;
  };

  app.post('/api/trading/:id/preview', async (req) => {
    const { id } = parse(idParam, req.params);
    await ownAccount(req, id);
    return ctx.trading.preview(me(req).id, ticketFor(id, req.body));
  });

  app.post('/api/trading/:id/orders', async (req) => {
    const { id } = parse(idParam, req.params);
    await ownAccount(req, id);
    return ctx.trading.place(me(req).id, ticketFor(id, req.body));
  });

  app.post('/api/trading/:id/cancel', async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ orderId: z.string().trim().min(1).max(120), symbol: z.string().trim().min(1).max(60), market: tradeMarket, trigger: z.boolean().default(false) }), req.body);
    await ownAccount(req, id);
    return ctx.trading.cancel(me(req).id, id, b);
  });
}
