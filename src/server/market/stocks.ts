// Stock market data (FD-SENTIQ §4, TD-SENTIQ §5): candles from Twelve Data (free key) or Nasdaq (no key),
// quotes / search / earnings / market status from Nasdaq, and a local budget for Twelve Data's free plan.
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { INDEX_TIMEFRAMES, isIndexId } from '../../shared/indices.ts';
import { tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import { HttpError, httpRequest } from '../net/http.ts';
import type { CnbcClient } from './cnbc.ts';
import { type CboeClient, IndexData, sourceOf } from './indices.ts';
import { MarketError, type CandlesResult } from './market.ts';

export const STOCK_SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const NY = 'America/New_York';
/** Nasdaq's API answers browsers only. */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** Twelve Data intervals for our timeframes (it has no 3m, 6h, 8h, 12h). */
export const TD_INTERVALS: Partial<Record<Timeframe, string>> = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1day', '1w': '1week' };
/** Without a Twelve Data key only daily data exists (Nasdaq). */
export const NASDAQ_TIMEFRAMES: readonly Timeframe[] = ['1d', '1w'];

export function stockTimeframes(hasKey: boolean): Timeframe[] {
  return hasKey ? (Object.keys(TD_INTERVALS) as Timeframe[]) : [...NASDAQ_TIMEFRAMES];
}

// ---------------------------------------------------------------- company names

const NAME_SUFFIX =
  /(?:[\s,.\-–]+|^)(?:common stocks?|ordinary shares|american depositary shares|depositary shares|ads|class [a-c]|series [a-c]|inc|incorporated|corporation|corp|company|co|ltd|limited|plc|n\.?v|s\.?a|ag|se|holdings?|\(the\))\.?$/i;
/** First words that are ordinary words, never a company on their own ("General Motors" ≠ "General"). */
const PLAIN_FIRST = new Set(['general', 'american', 'united', 'first', 'national', 'international', 'advanced', 'applied', 'global', 'royal', 'southern', 'northern', 'western', 'eastern', 'digital', 'energy', 'super', 'micro', 'public', 'bank', 'home', 'target', 'texas', 'new', 'old', 'south', 'north', 'west', 'east', 'black', 'blue', 'green', 'red', 'white', 'golden', 'silver', 'great', 'pacific', 'atlantic', 'capital', 'citizens', 'state', 'standard']);
/** Second words that make the first one the name people use ("Palantir Technologies" → "Palantir"). */
const GENERIC_SECOND = new Set(['global', 'holdings', 'holding', 'group', 'technologies', 'technology', 'platforms', 'systems', 'industries', 'enterprises', 'brands', 'markets', 'communications', 'international', 'therapeutics', 'pharmaceuticals', 'financial', 'motors', 'networks', 'software', 'labs', 'entertainment', 'interactive', 'semiconductor', 'semiconductors', 'resources', 'energy', 'healthcare', 'health', 'bancorp', 'payments', 'airlines', 'robotics', 'biosciences', 'sciences', 'solutions', 'services', 'wholesale', 'motor']);

/** "Alphabet Inc. Class A Common Stock" → "Alphabet"; "The Walt Disney Company" → "Walt Disney". */
export function cleanCompanyName(name: string): string {
  let n = name.replace(/\s+/g, ' ').trim().replace(/^the\s+/i, '');
  for (let i = 0; i < 8; i++) {
    const next = n.replace(NAME_SUFFIX, '').replace(/[\s,.\-–]+$/, '').trim();
    if (next === n || next.length < 2) break;
    n = next;
  }
  return n;
}

/** Default news aliases of a stock (FD-SENTIQ §4.1): its clean name, plus the first word when that is the brand. */
export function defaultStockAliases(name: string | null | undefined): string[] {
  if (!name) return [];
  const clean = cleanCompanyName(name);
  const out = [clean];
  const words = clean.split(' ');
  const [first, second] = words;
  if (words.length === 2 && first && second && first.length >= 4 && !PLAIN_FIRST.has(first.toLowerCase()) && GENERIC_SECOND.has(second.toLowerCase())) out.push(first);
  const seen = new Set<string>();
  return out.filter((a) => a.length >= 3 && a.length <= 40 && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
}

// ---------------------------------------------------------------- time zones

/** Offset (ms) of a time zone from UTC at an instant. */
function tzOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(utcMs);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** A wall-clock time in a zone (e.g. "2026-10-12 15:30:00" in New York) → UTC ms. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  // Near a DST change the first offset can be the other side's: correct once.
  t = guess - tzOffset(t, tz);
  return t;
}

const parseYmdHms = (s: string): [number, number, number, number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  return m ? [+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)] : null;
};

/** Nasdaq numbers: "$340.97", "25,900,600", "+1.29%", "N/A". */
export function nasdaqNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[$,%\s]/g, '');
  if (s === '' || s === 'N/A' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- Twelve Data budget

/** A Twelve Data plan's limits (FD-TDPLAN): read from the key at `/api_usage`; `perDay` null = no daily limit. */
export interface TdPlan {
  /** basic, grow, pro, ultra, enterprise… as Twelve Data names it. */
  category: string;
  perMinute: number;
  perDay: number | null;
}

/** The job that reads the plan (FD-TDPLAN). */
export const TD_PLAN_JOB = 'twelvedata.plan';

/** The free plan's limits: what Sentiq assumes until the key's plan was read. */
export const TD_BASIC_PLAN: TdPlan = { category: 'basic', perMinute: 8, perDay: 800 };
/** The plan another instance read is picked up this often. */
const PLAN_RELOAD_MS = 5 * 60_000;

interface StoredPlan extends TdPlan {
  /** When it was read. */
  at: number;
  /** The last four characters of the key it was read for: a plan read for another key is ignored. */
  keyHint: string;
}

const parseStoredPlan = (raw: string | undefined): StoredPlan | null => {
  try {
    const v = JSON.parse(raw ?? '') as Partial<StoredPlan>;
    if (typeof v.perMinute !== 'number' || !(v.perMinute > 0) || (v.perDay !== null && !(typeof v.perDay === 'number' && v.perDay > 0))) return null;
    return { category: String(v.category ?? 'unknown'), perMinute: v.perMinute, perDay: v.perDay ?? null, at: Number(v.at) || 0, keyHint: String(v.keyHint ?? '') };
  } catch {
    return null;
  }
};

/**
 * Twelve Data credits: per minute and, on plans that have one, per day (UTC). The limits are the key's plan, read from
 * Twelve Data (FD-TDPLAN), the free plan's until then. The day's count and the plan are persisted: a restart does not
 * reset the day, and the Mac and Azure use the same plan.
 */
export class CreditBudget {
  private minute: number[] = [];
  private day = '';
  private used = 0;
  private readonly db: Db | null;
  private readonly now: () => number;
  private plan: StoredPlan | null = null;
  private readonly fixed: TdPlan | null;
  private planReadAt = 0;
  private planReading: Promise<void> | null = null;

  /** `perMinute` / `perDay`: fixed limits (tests); otherwise the plan's. */
  constructor(opts: { db?: Db | null; now?: () => number; perMinute?: number; perDay?: number | null } = {}) {
    this.db = opts.db ?? null;
    this.now = opts.now ?? Date.now;
    this.fixed = opts.perMinute !== undefined || opts.perDay !== undefined ? { category: 'fixed', perMinute: opts.perMinute ?? 8, perDay: opts.perDay === undefined ? 800 : opts.perDay } : null;
    this.ready = this.load();
  }

  /** The limits in force. */
  get perMinute(): number {
    return (this.fixed ?? this.plan ?? TD_BASIC_PLAN).perMinute;
  }

  get perDay(): number | null {
    return (this.fixed ?? this.plan ?? TD_BASIC_PLAN).perDay;
  }

  /** Read once at start: the credits already used today (taken meanwhile are kept: the larger count wins), and the plan. */
  readonly ready: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  private async load(): Promise<void> {
    if (!this.db) return;
    try {
      const row = await this.db.get<{ value: string }>("SELECT value FROM market_cache WHERE [key] = N'td:usage'");
      if (row) {
        const v = JSON.parse(row.value) as { day: string; used: number };
        if (this.day === '' || this.day === v.day) {
          this.day = v.day;
          this.used = Math.max(this.used, v.used);
        }
      }
    } catch {
      // start fresh
    }
    await this.reloadPlan();
  }

  /** The plan as stored (by this instance or the other one). */
  private async reloadPlan(): Promise<void> {
    if (!this.db) return;
    this.planReadAt = this.now();
    try {
      const row = await this.db.get<{ value: string }>("SELECT value FROM market_cache WHERE [key] = N'td:plan'");
      this.plan = parseStoredPlan(row?.value);
    } catch {
      // keep the last one
    }
  }

  /** Picks up, in the background, a plan the other instance read meanwhile. */
  private maybeReloadPlan(): void {
    if (!this.db || this.planReading || this.now() - this.planReadAt < PLAN_RELOAD_MS) return;
    this.planReading = this.reloadPlan().finally(() => (this.planReading = null));
  }

  /** The plan read for the key ending in `keyHint` (FD-TDPLAN): its limits apply from now on. */
  async setPlan(p: TdPlan, keyHint: string): Promise<void> {
    this.plan = { category: p.category, perMinute: p.perMinute, perDay: p.perDay, at: this.now(), keyHint };
    this.planReadAt = this.now();
    if (this.db) {
      await this.db.run(`UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = N'td:plan'; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (N'td:plan', @v, @t)`, {
        v: JSON.stringify(this.plan),
        t: this.now(),
      });
    }
  }

  /** The key was removed or replaced: back to the free plan's limits until the new key's plan is read. */
  async clearPlan(): Promise<void> {
    this.plan = null;
    this.planReadAt = this.now();
    if (this.db) await this.db.run("DELETE FROM market_cache WHERE [key] = N'td:plan'");
  }

  /** The stored plan, when it belongs to the key ending in `keyHint`. */
  planFor(keyHint: string): StoredPlan | null {
    return this.plan && this.plan.keyHint === keyHint ? this.plan : null;
  }

  /** Resolves once the count was read and every write so far has finished (tests, shutdown). */
  async settled(): Promise<void> {
    await this.ready;
    await this.saving;
  }

  /** Writes the latest count, one write at a time (a slow one never overwrites a newer count). */
  private persist(): void {
    const db = this.db;
    if (!db) return;
    this.saving = this.saving
      .then(() =>
        db.run(`UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = N'td:usage'; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (N'td:usage', @v, @t)`, {
          v: JSON.stringify({ day: this.day, used: this.used }),
          t: this.now(),
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  status(): { used: number; perDay: number | null; minuteUsed: number; perMinute: number; day: string; plan: { category: string; at: number | null; assumed: boolean } } {
    this.maybeReloadPlan();
    const now = this.now();
    const current = this.fixed ?? this.plan ?? TD_BASIC_PLAN;
    const plan = { category: current.category, at: this.plan && !this.fixed ? this.plan.at : null, assumed: !this.fixed && !this.plan };
    if (this.day !== this.today()) return { used: 0, perDay: this.perDay, minuteUsed: 0, perMinute: this.perMinute, day: this.today(), plan };
    return { used: this.used, perDay: this.perDay, minuteUsed: this.minute.filter((t) => now - t < 60_000).length, perMinute: this.perMinute, day: this.day, plan };
  }

  /** Takes credits, or throws with the moment they are available again. */
  take(n = 1): void {
    this.maybeReloadPlan();
    const now = this.now();
    const today = this.today();
    if (this.day !== today) {
      this.day = today;
      this.used = 0;
    }
    this.minute = this.minute.filter((t) => now - t < 60_000);
    const perDay = this.perDay;
    if (perDay !== null && this.used + n > perDay) {
      const tomorrow = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1);
      throw new MarketError('EXCHANGE_ERROR', `limita zilnică Twelve Data (${perDay} cereri) a fost atinsă; revine la ${new Date(tomorrow).toISOString().slice(11, 16)} UTC`);
    }
    if (this.minute.length + n > this.perMinute) {
      const free = (this.minute[0] as number) + 60_000;
      throw new MarketError('EXCHANGE_ERROR', `limita Twelve Data de ${this.perMinute} cereri pe minut a fost atinsă; revine în ${Math.ceil((free - now) / 1000)} s`);
    }
    for (let i = 0; i < n; i++) this.minute.push(now);
    this.used += n;
    this.persist();
  }

  /** The server told us we are over its limit: no more requests for the rest of this minute. */
  exhaustMinute(): void {
    const now = this.now();
    while (this.minute.length < this.perMinute) this.minute.push(now);
  }
}

// ---------------------------------------------------------------- clients

async function getJson(url: string, headers: Record<string, string>, what: string): Promise<unknown> {
  const r = await httpRequest(url, { headers, timeoutMs: 20_000 });
  if (r.status === 429) throw new MarketError('EXCHANGE_ERROR', `${what}: prea multe cereri`);
  if (r.status !== 200) throw new MarketError('EXCHANGE_ERROR', `${what}: HTTP ${r.status}`);
  try {
    return JSON.parse(r.body) as unknown;
  } catch {
    throw new MarketError('EXCHANGE_ERROR', `${what}: răspuns neașteptat`);
  }
}

export interface StockQuote {
  symbol: string;
  name: string | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  /** "Market Open", "Market Closed", "Pre-Market", "After-Hours" (as Nasdaq says it). */
  status: string | null;
  fetchedAt: number;
  /** An index's quote from a delayed source (Cboe, up to 15 minutes; FD-INDEXINTRA). */
  delayed?: boolean;
}

export interface StockSearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface MarketStatus {
  /** open | pre | after | closed */
  state: 'open' | 'pre' | 'after' | 'closed';
  label: string;
  /** Next regular open / close, UTC ms. */
  opensAt: number | null;
  closesAt: number | null;
  fetchedAt: number;
}

export interface EarningsRow {
  symbol: string;
  name: string;
  /** pre | after | unknown */
  time: 'pre' | 'after' | 'unknown';
  quarter: string | null;
  epsForecast: string | null;
  lastYearEps: string | null;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** "Oct 13, 2026 09:30 AM ET" → UTC ms. */
export function parseNasdaqEt(s: unknown): number | null {
  const m = /^(\w{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)/.exec(String(s ?? ''));
  if (!m) return null;
  const month = MONTHS[m[1] as string];
  if (!month) return null;
  let h = +m[4]! % 12;
  if (m[6] === 'PM') h += 12;
  return zonedToUtc(+m[3]!, month, +m[2]!, h, +m[5]!, 0, NY);
}

/** Nasdaq's asset classes: shares, funds and (for its own indices) index. */
export type NasdaqClass = 'stocks' | 'etf' | 'index';

export class NasdaqClient {
  private readonly headers = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
  /** stocks / etf per symbol (the history endpoint needs the right asset class). */
  private readonly assetClass = new Map<string, NasdaqClass>();

  private async get(path: string): Promise<Record<string, unknown> | null> {
    const j = (await getJson(`https://api.nasdaq.com${path}`, this.headers, 'Nasdaq')) as { data?: unknown; status?: { rCode?: number } };
    return j && typeof j.data === 'object' && j.data !== null ? (j.data as Record<string, unknown>) : null;
  }

  /** `fixed`: the class is known (an index, FD-INDICES); otherwise stocks, then etf, remembered per symbol. */
  private async withClass<T>(sym: string, fn: (cls: NasdaqClass) => Promise<T | null>, fixed?: NasdaqClass): Promise<T | null> {
    if (fixed) return fn(fixed);
    const known = this.assetClass.get(sym);
    for (const cls of known ? [known] : (['stocks', 'etf'] as const)) {
      const r = await fn(cls);
      if (r !== null) {
        this.assetClass.set(sym, cls);
        return r;
      }
    }
    return null;
  }

  async quote(sym: string, now: number, cls?: NasdaqClass): Promise<StockQuote> {
    const d = await this.withClass(sym, (c) => this.get(`/api/quote/${encodeURIComponent(sym)}/info?assetclass=${c}`), cls);
    if (!d) throw new MarketError('UNKNOWN_SYMBOL', `${sym} nu e listat la Nasdaq / NYSE`);
    const p = (d.primaryData ?? {}) as Record<string, unknown>;
    return {
      symbol: sym,
      name: typeof d.companyName === 'string' ? d.companyName : null,
      last: nasdaqNumber(p.lastSalePrice),
      change: nasdaqNumber(p.netChange),
      changePct: nasdaqNumber(p.percentageChange),
      status: typeof d.marketStatus === 'string' ? d.marketStatus : null,
      fetchedAt: now,
    };
  }

  /** Daily bars between two dates (newest last); Nasdaq keeps about 10 years. */
  async daily(sym: string, fromDay: string, toDay: string, limit: number, cls?: NasdaqClass): Promise<Candle[]> {
    const d = await this.withClass(
      sym,
      async (c) => {
        const data = await this.get(`/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${c}&fromdate=${fromDay}&todate=${toDay}&limit=${limit}`);
        const rows = (data?.tradesTable as { rows?: unknown[] } | undefined)?.rows;
        return Array.isArray(rows) ? rows : null;
      },
      cls,
    );
    if (!d) throw new MarketError('UNKNOWN_SYMBOL', `${sym} nu are istoric la Nasdaq`);
    const out: Candle[] = [];
    for (const r of d as Record<string, unknown>[]) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r.date ?? ''));
      const o = nasdaqNumber(r.open);
      const h = nasdaqNumber(r.high);
      const l = nasdaqNumber(r.low);
      const c = nasdaqNumber(r.close);
      if (!m || o === null || h === null || l === null || c === null) continue;
      out.push({ t: zonedToUtc(+m[3]!, +m[1]!, +m[2]!, 0, 0, 0, NY), o, h, l, c, v: nasdaqNumber(r.volume) ?? 0 });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /** Today's minute prices → one daily bar (open, high, low, last), when the market traded today. */
  async today(sym: string, cls?: NasdaqClass): Promise<Candle | null> {
    const d = await this.withClass(sym, (c) => this.get(`/api/quote/${encodeURIComponent(sym)}/chart?assetclass=${c}`), cls);
    const pts = (d?.chart as { x?: number; y?: number }[] | undefined) ?? [];
    const prices = pts.map((p) => ({ t: Number(p.x), p: nasdaqNumber(p.y) })).filter((x): x is { t: number; p: number } => Number.isFinite(x.t) && x.p !== null);
    if (prices.length === 0) return null;
    // The x values are New York wall-clock times written as if they were UTC.
    const first = new Date(prices[0]!.t);
    const day = zonedToUtc(first.getUTCFullYear(), first.getUTCMonth() + 1, first.getUTCDate(), 0, 0, 0, NY);
    return { t: day, o: prices[0]!.p, h: Math.max(...prices.map((x) => x.p)), l: Math.min(...prices.map((x) => x.p)), c: prices.at(-1)!.p, v: 0 };
  }

  async search(q: string): Promise<StockSearchHit[]> {
    const j = (await getJson(`https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(q)}`, this.headers, 'Nasdaq')) as { data?: unknown };
    return (Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : [])
      .filter((r) => typeof r.symbol === 'string' && STOCK_SYMBOL_RE.test(String(r.symbol)) && ['STOCKS', 'ETF'].includes(String(r.asset ?? 'STOCKS')))
      .map((r) => ({ symbol: String(r.symbol), name: String(r.name ?? r.symbol), exchange: String(r.exchange ?? ''), type: String(r.asset ?? 'STOCKS') === 'ETF' ? 'ETF' : 'Acțiune' }));
  }

  async marketStatus(now: number): Promise<MarketStatus> {
    const d = await this.get('/api/market-info');
    if (!d) throw new MarketError('EXCHANGE_ERROR', 'Nasdaq: starea pieței indisponibilă');
    const label = String(d.marketIndicator ?? '');
    const state: MarketStatus['state'] = /open/i.test(label) ? 'open' : /pre/i.test(label) ? 'pre' : /after/i.test(label) ? 'after' : 'closed';
    return { state, label, opensAt: parseNasdaqEt(d.marketOpeningTime), closesAt: parseNasdaqEt(d.marketClosingTime), fetchedAt: now };
  }

  async earnings(day: string): Promise<EarningsRow[]> {
    const d = await this.get(`/api/calendar/earnings?date=${day}`);
    const rows = (d?.rows as Record<string, unknown>[] | undefined) ?? [];
    return rows
      .filter((r) => typeof r.symbol === 'string')
      .map((r) => {
        const t = String(r.time ?? '');
        return {
          symbol: String(r.symbol).toUpperCase(),
          name: String(r.name ?? r.symbol),
          time: t.includes('pre') ? 'pre' : t.includes('after') ? 'after' : 'unknown',
          quarter: typeof r.fiscalQuarterEnding === 'string' ? r.fiscalQuarterEnding : null,
          epsForecast: typeof r.epsForecast === 'string' && r.epsForecast.trim() ? r.epsForecast.trim() : null,
          lastYearEps: typeof r.lastYearEPS === 'string' && r.lastYearEPS.trim() ? r.lastYearEPS.trim() : null,
        };
      });
  }

  /** The Nasdaq-100 index. */
  async ndx(now: number): Promise<{ last: number | null; changePct: number | null; fetchedAt: number }> {
    const d = await this.get('/api/quote/NDX/info?assetclass=index');
    const p = (d?.primaryData ?? {}) as Record<string, unknown>;
    return { last: nasdaqNumber(p.lastSalePrice), changePct: nasdaqNumber(p.percentageChange), fetchedAt: now };
  }
}

export class TwelveDataClient {
  private readonly budget: CreditBudget;
  private readonly key: () => Promise<string | null>;
  constructor(key: () => Promise<string | null>, budget: CreditBudget) {
    this.key = key;
    this.budget = budget;
  }

  async hasKey(): Promise<boolean> {
    return Boolean(await this.key());
  }

  private async get(path: string, params: Record<string, string>, credits: number, keyOverride?: string): Promise<Record<string, unknown>> {
    const key = keyOverride ?? (await this.key());
    if (!key) throw new MarketError('UNSUPPORTED_TIMEFRAME', 'Cheia Twelve Data lipsește (Setări → Admin → Date de piață)');
    if (credits > 0) this.budget.take(credits);
    const qs = new URLSearchParams({ ...params, apikey: key }).toString();
    let r;
    try {
      r = await httpRequest(`https://api.twelvedata.com${path}?${qs}`, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new MarketError('EXCHANGE_ERROR', `Twelve Data: ${(err as HttpError).message}`);
    }
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(r.body) as Record<string, unknown>;
    } catch {
      throw new MarketError('EXCHANGE_ERROR', `Twelve Data: răspuns neașteptat (HTTP ${r.status})`);
    }
    if (j.status === 'error' || r.status !== 200) {
      const code = Number(j.code ?? r.status);
      const msg = String(j.message ?? `HTTP ${r.status}`).slice(0, 200);
      if (code === 429) {
        this.budget.exhaustMinute();
        throw new MarketError('EXCHANGE_ERROR', `Twelve Data: limita de cereri a fost atinsă (${msg})`);
      }
      if (code === 401 || code === 403) throw new MarketError('EXCHANGE_ERROR', `Twelve Data: cheia nu e validă sau planul nu include simbolul (${msg})`);
      if (code === 400 || code === 404) throw new MarketError('UNKNOWN_SYMBOL', `Twelve Data: ${msg}`);
      throw new MarketError('EXCHANGE_ERROR', `Twelve Data: ${msg}`);
    }
    return j;
  }

  async timeSeries(sym: string, interval: string, outputsize: number): Promise<{ candles: Candle[]; exchange: string }> {
    const j = await this.get('/time_series', { symbol: sym, interval, outputsize: String(Math.min(5000, Math.max(1, outputsize))), order: 'ASC' }, 1);
    const meta = (j.meta ?? {}) as Record<string, unknown>;
    const tz = typeof meta.exchange_timezone === 'string' && meta.exchange_timezone ? meta.exchange_timezone : NY;
    const values = Array.isArray(j.values) ? (j.values as Record<string, unknown>[]) : [];
    const candles: Candle[] = [];
    for (const v of values) {
      const p = parseYmdHms(String(v.datetime ?? ''));
      const o = nasdaqNumber(v.open);
      const h = nasdaqNumber(v.high);
      const l = nasdaqNumber(v.low);
      const c = nasdaqNumber(v.close);
      if (!p || o === null || h === null || l === null || c === null) continue;
      candles.push({ t: zonedToUtc(...p, tz), o, h, l, c, v: nasdaqNumber(v.volume) ?? 0 });
    }
    return { candles: candles.sort((a, b) => a.t - b.t), exchange: String(meta.exchange ?? '') };
  }

  async search(q: string): Promise<StockSearchHit[]> {
    const j = await this.get('/symbol_search', { symbol: q, outputsize: '20' }, 0);
    return (Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : [])
      .filter((r) => String(r.country ?? '') === 'United States' && /Common Stock|ETF|Depositary/i.test(String(r.instrument_type ?? '')) && STOCK_SYMBOL_RE.test(String(r.symbol ?? '')))
      .map((r) => ({ symbol: String(r.symbol), name: String(r.instrument_name ?? r.symbol), exchange: String(r.exchange ?? ''), type: /ETF/i.test(String(r.instrument_type)) ? 'ETF' : 'Acțiune' }));
  }

  /**
   * The key's plan (FD-TDPLAN, one credit): `plan_limit` a minute and, only on plans that have one, `plan_daily_limit`.
   * `keyOverride`: a key not saved yet.
   */
  async plan(keyOverride?: string): Promise<TdPlan> {
    const j = await this.get('/api_usage', {}, 1, keyOverride);
    const perMinute = Number(j.plan_limit);
    if (!Number.isFinite(perMinute) || perMinute <= 0) throw new MarketError('EXCHANGE_ERROR', 'Twelve Data: răspuns neașteptat la citirea planului');
    const daily = j.plan_daily_limit === undefined || j.plan_daily_limit === null ? null : Number(j.plan_daily_limit);
    return { category: String(j.plan_category ?? 'unknown').toLowerCase(), perMinute, perDay: daily !== null && Number.isFinite(daily) && daily > 0 ? daily : null };
  }

  /** Checks a key before it is saved (one credit). */
  async verify(key: string): Promise<void> {
    const j = await this.get('/time_series', { symbol: 'AAPL', interval: '1day', outputsize: '1' }, 1, key);
    if (!Array.isArray(j.values)) throw new MarketError('EXCHANGE_ERROR', 'Twelve Data: răspuns neașteptat la verificarea cheii');
  }
}

// ---------------------------------------------------------------- StockData

interface CacheEntry {
  candles: Candle[];
  fetchedAt: number;
  count: number;
  exchange: string;
  /**
   * Read outside the regular session (pre-market, after-hours, night, weekend, holiday): the sources give regular-hours
   * bars only, so nothing changes until the session opens again.
   */
  closedAt: boolean;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const SOURCE_NAME: Record<string, string> = { twelvedata: 'Twelve Data', nasdaq: 'Nasdaq', cboe: 'Cboe', cnbc: 'CNBC' };
/** Known to be outside the regular session (an unknown state counts as open: the short TTL then applies). */
const outsideSession = (status: MarketStatus | null): boolean => status !== null && status.state !== 'open';

/** Weekly bars (weeks starting Monday, New York time) from daily ones. */
export function weeklyFromDaily(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    const local = new Date(d.t + tzOffset(d.t, NY));
    const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
    const monday = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate() - dow, 0, 0, 0, NY);
    const last = out.at(-1);
    if (last && last.t === monday) {
      last.h = Math.max(last.h, d.h);
      last.l = Math.min(last.l, d.l);
      last.c = d.c;
      last.v += d.v;
    } else out.push({ t: monday, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v });
  }
  return out;
}

export class StockData {
  readonly nasdaq: NasdaqClient;
  readonly td: TwelveDataClient;
  readonly budget: CreditBudget;
  /** US indices (FD-INDICES): an id with "^" in front is served from here. */
  readonly indices: IndexData;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CandlesResult>>();
  private readonly quotes = new Map<string, StockQuote>();
  private readonly sparks = new Map<string, { symbol: string; closes: number[]; fetchedAt: number }>();
  private status: MarketStatus | null = null;
  private readonly now: () => number;
  private readonly key: () => Promise<string | null>;

  constructor(opts: { db?: Db | null; key: () => Promise<string | null>; now?: () => number; nasdaq?: NasdaqClient; budget?: CreditBudget; cboe?: CboeClient; cnbc?: CnbcClient }) {
    this.now = opts.now ?? Date.now;
    this.budget = opts.budget ?? new CreditBudget({ db: opts.db, now: this.now });
    this.nasdaq = opts.nasdaq ?? new NasdaqClient();
    this.td = new TwelveDataClient(opts.key, this.budget);
    this.key = opts.key;
    this.indices = new IndexData({ nasdaq: this.nasdaq, cboe: opts.cboe, cnbc: opts.cnbc, now: this.now, status: () => this.confirmedStatus() });
  }

  /** US market state, re-read at most every 5 minutes. */
  async marketStatus(): Promise<MarketStatus | null> {
    const now = this.now();
    if (this.status && now - this.status.fetchedAt < 5 * 60_000) return this.status;
    try {
      this.status = await this.nasdaq.marketStatus(now);
    } catch {
      // keep the last known state
    }
    return this.status;
  }

  /** The market state, only when Nasdaq confirmed it in the last 15 minutes (else null: unknown). */
  async confirmedStatus(): Promise<MarketStatus | null> {
    const last = await this.marketStatus();
    return last && this.now() - last.fetchedAt < 15 * 60_000 ? last : null;
  }

  async timeframes(): Promise<Timeframe[]> {
    return stockTimeframes(await this.td.hasKey());
  }

  /**
   * Reads the Twelve Data key's plan and applies its limits (FD-TDPLAN): after a key is saved, at start-up, every 6 hours
   * and on request. Without a key, the plan is forgotten. A failed read keeps the last plan (and throws).
   */
  async refreshPlan(key: string | null = null): Promise<TdPlan | null> {
    const k = key ?? (await this.key());
    if (!k) {
      await this.budget.clearPlan();
      return null;
    }
    const p = await this.td.plan(k);
    await this.budget.setPlan(p, k.slice(-4));
    return p;
  }

  /** The timeframes of one symbol: an index has 1d and 1w only (FD-INDICES), a share what the source has. */
  async timeframesFor(sym: string): Promise<Timeframe[]> {
    return isIndexId(sym) ? [...INDEX_TIMEFRAMES] : this.timeframes();
  }

  /**
   * How long candles stay fresh: shorter for short timeframes; read outside the session, until it opens again (the
   * state is re-read every 5 minutes, so the first bars of a new session come at most that late).
   */
  private fresh(tf: Timeframe, entry: CacheEntry, status: MarketStatus | null, now: number): boolean {
    const base = tfSeconds(tf) <= 3600 ? 60_000 : tfSeconds(tf) <= 4 * 3600 ? 5 * 60_000 : 15 * 60_000;
    if (now - entry.fetchedAt < base) return true;
    return entry.closedAt && outsideSession(status);
  }

  async candles(symbol: string, tf: Timeframe, count: number): Promise<CandlesResult> {
    const sym = symbol.toUpperCase();
    if (isIndexId(sym)) return this.indexCandles(sym, tf, count);
    if (!STOCK_SYMBOL_RE.test(sym)) throw new MarketError('UNKNOWN_SYMBOL', `Simbol invalid: ${symbol}`);
    const hasKey = await this.td.hasKey();
    const useTd = hasKey && TD_INTERVALS[tf] !== undefined;
    if (!useTd && !NASDAQ_TIMEFRAMES.includes(tf)) {
      throw new MarketError('UNSUPPORTED_TIMEFRAME', hasKey ? `Timeframe-ul ${tf} nu există la Twelve Data (alege 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1d sau 1w)` : `Timeframe-ul ${tf} are nevoie de cheia gratuită Twelve Data (Setări → Admin → Date de piață); fără ea sunt disponibile 1d și 1w`);
    }
    const key = `${useTd ? 'td' : 'nq'}|${sym}|${tf}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.load(sym, tf, count, key, useTd ? 'td' : 'nq')
      .catch((err: unknown) => this.withSuggestions(sym, err))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** An index's candles (FD-INDICES, FD-INDEXINTRA): daily / weekly from its daily history, intraday from CNBC. */
  private indexCandles(id: string, tf: Timeframe, count: number): Promise<CandlesResult> {
    sourceOf(id);
    if (!INDEX_TIMEFRAMES.includes(tf)) return Promise.reject(new MarketError('UNSUPPORTED_TIMEFRAME', `Indicii nu au ${tf}`));
    const key = `ix|${id}|${tf}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.load(id, tf, count, key, 'ix').finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** A symbol the source does not know (renamed, delisted, mistyped): the error names the closest listed ones (FD §5). */
  private async withSuggestions(sym: string, err: unknown): Promise<never> {
    if (!(err instanceof MarketError) || err.code !== 'UNKNOWN_SYMBOL') throw err;
    const hits = await this.search(sym.replace(/[.-].*$/, '')).catch(() => []);
    // The closest spellings first ("APPL" → AAPL before AADX).
    const suggestions = hits
      .map((h) => h.symbol)
      .filter((s) => s !== sym)
      .map((s, i) => ({ s, d: editDistance(s, sym), i }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, 3)
      .map((x) => x.s);
    if (!suggestions.length) throw err;
    throw new MarketError('UNKNOWN_SYMBOL', `${err.message}; încearcă ${suggestions.join(', ')}`, suggestions);
  }

  private async load(sym: string, tf: Timeframe, count: number, key: string, mode: 'td' | 'nq' | 'ix'): Promise<CandlesResult> {
    const now = this.now();
    const cached = this.cache.get(key);
    // A state Nasdaq could not confirm for a while is not trusted (a Friday "closed" must not freeze Monday's chart).
    const status = await this.confirmedStatus();
    let entry: CacheEntry;
    let notice: string | undefined;
    if (cached && cached.count >= count && this.fresh(tf, cached, status, now)) {
      entry = cached;
    } else {
      try {
        if (mode === 'td') {
          const r = await this.td.timeSeries(sym, TD_INTERVALS[tf] as string, count);
          entry = { candles: r.candles, fetchedAt: now, count, exchange: 'twelvedata', closedAt: outsideSession(status) };
        } else if (mode === 'ix') {
          // Daily and weekly from the index's daily history; intraday from CNBC (FD-INDEXINTRA).
          if (tf === '1d' || tf === '1w') {
            const daily = await this.indices.history(sym);
            entry = { candles: (tf === '1w' ? weeklyFromDaily(daily.candles) : daily.candles).slice(-count), fetchedAt: now, count, exchange: daily.from, closedAt: outsideSession(status) };
          } else {
            entry = { candles: await this.indices.intraday(sym, tf, count), fetchedAt: now, count, exchange: 'cnbc', closedAt: outsideSession(status) };
          }
        } else {
          const days = tf === '1w' ? count * 7 + 7 : Math.ceil(count * 1.5) + 10;
          let daily = await this.nasdaq.daily(sym, dayKey(now - days * 86_400_000), dayKey(now), Math.min(10_000, days));
          // Today's bar from the minute prices, while the history does not have it yet.
          try {
            const today = await this.nasdaq.today(sym);
            if (today && (daily.length === 0 || today.t > (daily.at(-1) as Candle).t)) daily = [...daily, today];
          } catch {
            // the history alone is enough
          }
          entry = { candles: (tf === '1w' ? weeklyFromDaily(daily) : daily).slice(-count), fetchedAt: now, count, exchange: 'nasdaq', closedAt: outsideSession(status) };
        }
        if (entry.candles.length === 0) throw new MarketError('UNKNOWN_SYMBOL', `${sym.replace(/^\^/, '')}: nicio lumânare de la ${SOURCE_NAME[entry.exchange] ?? entry.exchange}`);
        this.cache.set(key, entry);
        while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
      } catch (err) {
        // The source refused (budget, network): the last candles, with their age and the reason.
        if (cached && cached.candles.length > 0) {
          entry = cached;
          notice = (err as Error).message;
        } else throw err;
      }
    }
    const candles = entry.candles.slice(-count);
    const tfMs = tfSeconds(tf) * 1000;
    let lastClosedIndex = candles.length - 1;
    while (lastClosedIndex >= 0 && (candles[lastClosedIndex] as Candle).t + tfMs > now) lastClosedIndex--;
    const lastPrice = candles.at(-1)?.c ?? 1;
    return { exchange: entry.exchange, symbol: sym, tf, candles, pricePrecision: lastPrice < 1 ? 4 : 2, lastClosedIndex, fetchedAt: entry.fetchedAt, ...(notice ? { notice } : {}) };
  }

  /** Last price and day change (Nasdaq; an index from its source): a minute per symbol, 15 minutes while the market is closed. */
  async quote(sym: string): Promise<StockQuote> {
    const now = this.now();
    const c = this.quotes.get(sym);
    const ttl = this.status?.state === 'closed' && now - this.status.fetchedAt < 10 * 60_000 ? 15 * 60_000 : 60_000;
    if (c && now - c.fetchedAt < ttl) return c;
    try {
      const q = isIndexId(sym) ? await this.indices.quote(sym) : await this.nasdaq.quote(sym, now);
      this.quotes.set(sym, q);
      return q;
    } catch (err) {
      if (c) return c;
      throw err;
    }
  }

  async search(q: string): Promise<StockSearchHit[]> {
    if (await this.td.hasKey()) {
      try {
        const hits = await this.td.search(q);
        if (hits.length) return dedupe(hits);
      } catch {
        // Nasdaq below
      }
    }
    return dedupe(await this.nasdaq.search(q));
  }

  /** 60 daily closes for the small chart in the strip and the Today cards: Nasdaq (an index: its history), never Twelve Data. */
  async spark(sym: string): Promise<{ symbol: string; closes: number[]; fetchedAt: number }> {
    const now = this.now();
    const c = this.sparks.get(sym);
    if (c && now - c.fetchedAt < 3_600_000) return c;
    try {
      const daily = isIndexId(sym) ? (await this.indices.history(sym)).candles : await this.nasdaq.daily(sym, dayKey(now - 100 * 86_400_000), dayKey(now), 100);
      const out = { symbol: sym, closes: daily.slice(-60).map((d) => d.c), fetchedAt: now };
      this.sparks.set(sym, out);
      return out;
    } catch (err) {
      if (c) return c;
      throw err;
    }
  }
}

/** Levenshtein distance (short tickers only). */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] as number;
}

function dedupe(hits: StockSearchHit[]): StockSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.symbol) ? false : (seen.add(h.symbol), true)));
}
