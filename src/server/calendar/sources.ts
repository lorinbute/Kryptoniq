// Calendar fetchers: ForexFactory (list + impact) and TradingView (actual values, fallback). TD §7.1-7.2.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fetchText, HttpError, httpRequest } from '../net/http.ts';

export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const TV_URL = 'https://economic-calendar.tradingview.com/events';
export const TV_COUNTRIES = ['US', 'EU', 'DE', 'FR', 'IT', 'ES', 'GB', 'JP', 'CN', 'CA', 'AU', 'NZ', 'CH'];

export type CalImpact = 'High' | 'Medium' | 'Low' | 'Holiday';

export interface RawEvent {
  /** ForexFactory, TradingView, or the Nasdaq earnings calendar (FD-SENTIQ §4.5). */
  source: 'ff' | 'tv' | 'earn';
  extId: string;
  title: string;
  currency: string;
  country: string | null;
  ts: number;
  allDay: boolean;
  impact: CalImpact;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  unit: string | null;
  scale: string | null;
  period: string | null;
  /** TradingView only: what the Economy page needs besides the calendar (FD-ECON, TD-ECON §2). */
  tv?: TvExtra;
}

export interface TvExtra {
  ticker: string | null;
  indicator: string | null;
  category: string | null;
  referenceDate: number | null;
  source: string | null;
  sourceUrl: string | null;
  comment: string | null;
  importance: number | null;
  actual: number | null;
  previous: number | null;
  forecast: number | null;
}

export class RateLimitedError extends Error {}

const ffEventSchema = z.object({
  title: z.string().min(1).max(300),
  country: z.string().min(1).max(10),
  date: z.string().min(10),
  impact: z.string(),
  forecast: z.string().optional().nullable(),
  previous: z.string().optional().nullable(),
});

const FF_IMPACTS: Record<string, CalImpact> = { high: 'High', medium: 'Medium', low: 'Low', holiday: 'Holiday', 'non-economic': 'Low' };

const emptyToNull = (s: string | null | undefined) => (s && s.trim() !== '' ? s.trim() : null);

export function parseForexFactory(body: string): RawEvent[] {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<')) throw new RateLimitedError('ForexFactory a limitat accesul (a răspuns cu HTML în loc de JSON)');
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new HttpError('BAD_JSON', 'ForexFactory: JSON invalid');
  }
  if (!Array.isArray(data)) throw new HttpError('BAD_JSON', 'ForexFactory: răspuns neașteptat (lipsește lista)');
  const out: RawEvent[] = [];
  for (const raw of data) {
    const r = ffEventSchema.safeParse(raw);
    if (!r.success) continue;
    const e = r.data;
    const ts = Date.parse(e.date);
    if (!Number.isFinite(ts)) continue;
    const impact = FF_IMPACTS[e.impact.toLowerCase()] ?? 'Low';
    const currency = e.country.toUpperCase() === 'ALL' ? 'ALL' : e.country.toUpperCase();
    out.push({
      source: 'ff',
      extId: createHash('sha1').update(`${e.title}|${e.country}|${e.date}`).digest('hex'),
      title: e.title.trim(),
      currency,
      country: null,
      ts,
      allDay: impact === 'Holiday',
      impact,
      forecast: emptyToNull(e.forecast),
      previous: emptyToNull(e.previous),
      actual: null,
      unit: null,
      scale: null,
      period: null,
    });
  }
  return out;
}

export async function fetchForexFactory(): Promise<RawEvent[]> {
  try {
    const res = await fetchText(FF_URL, { headers: { Accept: 'application/json' } });
    return parseForexFactory(res.body);
  } catch (err) {
    if (err instanceof HttpError && err.code === 'RATE_LIMITED') throw new RateLimitedError(err.message);
    throw err;
  }
}

const tvNum = z.number().nullable().optional();
const tvEventSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().min(1).max(300),
  country: z.string().max(10).optional().nullable(),
  currency: z.string().max(10).optional().nullable(),
  date: z.string(),
  importance: z.number().optional().nullable(),
  actual: tvNum,
  forecast: tvNum,
  previous: tvNum,
  unit: z.string().max(20).optional().nullable(),
  scale: z.string().max(5).optional().nullable(),
  period: z.string().max(30).optional().nullable(),
  // FD-ECON: kept for the Economy page; anything malformed there only drops the extra, never the event.
  ticker: z.string().max(80).optional().nullable().catch(null),
  indicator: z.string().max(200).optional().nullable().catch(null),
  category: z.string().max(20).optional().nullable().catch(null),
  referenceDate: z.string().max(40).optional().nullable().catch(null),
  source: z.string().max(200).optional().nullable().catch(null),
  source_url: z.string().max(500).optional().nullable().catch(null),
  comment: z.string().max(4000).optional().nullable().catch(null),
});

const finite = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

const numToStr = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : null);

export function parseTradingView(body: string): RawEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new HttpError('BAD_JSON', 'TradingView: JSON invalid');
  }
  const list = (data as { result?: unknown })?.result;
  if (!Array.isArray(list)) throw new HttpError('BAD_JSON', 'TradingView: răspuns neașteptat (lipsește lista)');
  const out: RawEvent[] = [];
  for (const raw of list) {
    const r = tvEventSchema.safeParse(raw);
    if (!r.success) continue;
    const e = r.data;
    const ts = Date.parse(e.date);
    if (!Number.isFinite(ts)) continue;
    const imp = e.importance ?? -1;
    out.push({
      source: 'tv',
      extId: String(e.id),
      title: e.title.trim(),
      currency: (e.currency ?? '').toUpperCase() || tvCountryCurrency(e.country ?? ''),
      country: e.country ?? null,
      ts,
      allDay: false,
      impact: imp >= 1 ? 'High' : imp === 0 ? 'Medium' : 'Low',
      forecast: numToStr(e.forecast),
      previous: numToStr(e.previous),
      actual: numToStr(e.actual),
      unit: e.unit ?? null,
      scale: e.scale ?? null,
      period: e.period ?? null,
      tv: {
        ticker: e.ticker?.trim() || null,
        indicator: e.indicator?.trim() || null,
        category: e.category?.trim() || null,
        referenceDate: e.referenceDate && Number.isFinite(Date.parse(e.referenceDate)) ? Date.parse(e.referenceDate) : null,
        source: e.source?.trim() || null,
        sourceUrl: e.source_url?.trim() || null,
        comment: e.comment?.trim() || null,
        importance: finite(e.importance),
        actual: finite(e.actual),
        previous: finite(e.previous),
        forecast: finite(e.forecast),
      },
    });
  }
  return out;
}

function tvCountryCurrency(country: string): string {
  const map: Record<string, string> = { US: 'USD', EU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', GB: 'GBP', JP: 'JPY', CN: 'CNY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF' };
  return map[country.toUpperCase()] ?? country.toUpperCase();
}

export async function fetchTradingView(from: number, to: number, countries: readonly string[] = TV_COUNTRIES): Promise<RawEvent[]> {
  const url = `${TV_URL}?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}&countries=${countries.join(',')}`;
  const res = await fetchText(url, { headers: { Accept: 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' } });
  return parseTradingView(res.body);
}

// ── FD-EARNTV: the next earnings date of the watchlist stocks, from TradingView's screener ─────────────────────────

export const TV_SCAN_URL = 'https://scanner.tradingview.com/america/scan';
/** The columns asked, in this order (their meaning was read from the data: TradingView does not document them). */
export const TV_EARN_COLUMNS = [
  'name',
  'is_primary',
  'earnings_release_next_trading_date_fq',
  'earnings_publication_type_next_fq',
  'earnings_release_next_time',
  'earnings_release_next_calendar_date',
  'earnings_per_share_forecast_next_fq',
  'earnings_release_trading_date_fq',
  'type',
] as const;
/** What TradingView can be asked about: stock symbols, a class after a dot (BRK.B); not indices (^SPX). */
const TV_SYMBOL_RE = /^[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)?$/;
/** Publication types of a confirmed date: before the open, after the close, no time given (10 is an estimate). */
const TV_CONFIRMED = new Set([11, 12, 13]);
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TvEarnings {
  /** The next publication: its trading day (YYYY-MM-DD), when, whether the company confirmed it, the quarter, the EPS expected. */
  next: { day: string; time: 'pre' | 'after' | 'unknown'; confirmed: boolean; quarter: string | null; eps: number | null } | null;
  /** The day of the last publication (results already out); null when TradingView knows none. */
  lastDay: string | null;
}

const tvRowSchema = z.object({ s: z.string(), d: z.array(z.unknown()) });
const tvScanSchema = z.object({ data: z.array(z.unknown()).nullish() }).loose();
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A date TradingView gives as seconds (at midnight UTC); null when it is none or out of range. */
const dateOf = (v: unknown): Date | null => {
  const n = num(v);
  const d = n === null ? null : new Date(n * 1000);
  return d && Number.isFinite(d.getTime()) ? d : null;
};
const utcDay = (v: unknown): string | null => dateOf(v)?.toISOString().slice(0, 10) ?? null;

/** TradingView's screener answer → each stock's next and last earnings dates (FD-EARNTV). */
export function parseTvEarnings(body: string): Map<string, TvEarnings> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('TradingView: răspunsul nu e JSON');
  }
  const parsed = tvScanSchema.safeParse(json);
  if (!parsed.success) throw new Error('TradingView: răspuns neașteptat');
  const out = new Map<string, TvEarnings & { rank: number }>();
  let stocks = 0;
  let dated = 0;
  for (const raw of parsed.data.data ?? []) {
    const row = tvRowSchema.safeParse(raw);
    if (!row.success) continue;
    const [name, primary, nextDay, pubType, nextTime, period, eps, lastDay, kind] = row.data.d;
    if (typeof name !== 'string' || !name) continue;
    const day = utcDay(nextDay);
    const type = num(pubType);
    const end = dateOf(period);
    const info: TvEarnings = {
      next: day
        ? {
            day,
            time: nextTime === -1 ? 'pre' : nextTime === 1 ? 'after' : 'unknown',
            confirmed: type !== null && TV_CONFIRMED.has(type),
            quarter: end ? `${MONTH_ABBR[end.getUTCMonth()]}/${end.getUTCFullYear()}` : null,
            eps: num(eps),
          }
        : null,
      lastDay: utcDay(lastDay),
    };
    if (kind === 'stock' || kind === 'dr') stocks++;
    if (info.next || info.lastDay) dated++;
    // The same name on several exchanges: the one with earnings data, then the primary listing.
    const rank = (type !== null ? 2 : 0) + (primary === true ? 1 : 0);
    const kept = out.get(name);
    if (!kept || rank > kept.rank) out.set(name, { ...info, rank });
  }
  // Unknown columns come back as null, not as an error: stocks without a single date mean TradingView changed them.
  if (stocks > 0 && dated === 0) throw new Error(`TradingView: nicio dată de rezultate pentru ${stocks} acțiuni (s-au schimbat coloanele?)`);
  return new Map([...out].map(([k, { rank: _, ...v }]) => [k, v]));
}

/** Whether TradingView can be asked about a symbol (a stock's, not an index's). */
export const isTvSymbol = (s: string): boolean => TV_SYMBOL_RE.test(s);

/** One screener request for these names and columns (FD-EARNTV, FD-WATCHLISTS): the answer's body. */
export async function tvScan(names: string[], columns: readonly string[]): Promise<string> {
  const res = await httpRequest(TV_SCAN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
    body: JSON.stringify({ filter: [{ left: 'name', operation: 'in_range', right: names }], columns, range: [0, names.length * 3] }),
  });
  if (res.status !== 200) throw new HttpError('HTTP_STATUS', `TradingView a răspuns cu eroarea HTTP ${res.status}`, res.status);
  return res.body;
}

/** One request for all the stocks; none without any (FD-EARNTV). Throws when TradingView does not answer as expected. */
export async function fetchTvEarnings(symbols: string[]): Promise<Map<string, TvEarnings>> {
  const names = [...new Set(symbols)].filter(isTvSymbol);
  if (names.length === 0) return new Map();
  return parseTvEarnings(await tvScan(names, TV_EARN_COLUMNS));
}
