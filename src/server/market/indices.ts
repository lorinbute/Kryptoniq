// US index data (FD-INDICES, FD-INDEXINTRA): CNBC first (real-time quotes, daily bars since 2010, intraday bars for
// about 100 days); when CNBC fails, Nasdaq's own indices from its API (asset class "index") and the others from Cboe's
// public delayed quotes (daily only). StockData routes an index id ("^SPX") here.
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { indexById } from '../../shared/indices.ts';
import { dayKey, zonedParts, zonedTimeToUtc, type Timeframe } from '../../shared/time.ts';
import { HttpError, httpRequest } from '../net/http.ts';
import { CNBC_MINUTES, CnbcClient, type CnbcInterval, type CnbcQuote } from './cnbc.ts';
import { MarketError } from './market.ts';
import type { MarketStatus, NasdaqClient, StockQuote } from './stocks.ts';

const NY = 'America/New_York';
const CBOE = 'https://cdn-api.cboe.com/api/global/delayed_quotes';
/** Cboe's CDN, like Nasdaq's API, answers browsers. */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** The fallback of an index (daily and quotes only). The Dow is Cboe's DJX, which is exactly a hundredth of it. */
export type IndexSource = { from: 'cboe'; code: string; scale: number } | { from: 'nasdaq'; code: string };

/** Where each index comes from: its CNBC symbol, and the fallback. */
export const INDEX_SOURCES: Record<string, { cnbc: string; fallback: IndexSource }> = {
  '^SPX': { cnbc: '.SPX', fallback: { from: 'cboe', code: '_SPX', scale: 1 } },
  '^VIX': { cnbc: '.VIX', fallback: { from: 'cboe', code: '_VIX', scale: 1 } },
  '^RUT': { cnbc: '.RUT', fallback: { from: 'cboe', code: '_RUT', scale: 1 } },
  '^DJI': { cnbc: '.DJI', fallback: { from: 'cboe', code: '_DJX', scale: 100 } },
  '^NDX': { cnbc: '.NDX', fallback: { from: 'nasdaq', code: 'NDX' } },
  '^COMP': { cnbc: '.IXIC', fallback: { from: 'nasdaq', code: 'COMP' } },
  '^SOX': { cnbc: '.SOX', fallback: { from: 'nasdaq', code: 'SOX' } },
};

/** The sources of a known index, or UNKNOWN_SYMBOL. */
export function sourceOf(id: string): { cnbc: string; fallback: IndexSource } {
  const s = INDEX_SOURCES[id];
  if (!s || !indexById(id)) throw new MarketError('UNKNOWN_SYMBOL', `Indice necunoscut: ${id.replace(/^\^/, '')}`);
  return s;
}

/** Each intraday timeframe from a CNBC interval, merged on New York clock buckets of `group` minutes when larger. */
export const INDEX_INTRADAY: Partial<Record<Timeframe, { base: CnbcInterval; group: number; perSession: number }>> = {
  '1m': { base: '1M', group: 1, perSession: 390 },
  '3m': { base: '1M', group: 3, perSession: 130 },
  '5m': { base: '5M', group: 5, perSession: 78 },
  '15m': { base: '5M', group: 15, perSession: 26 },
  '30m': { base: '30M', group: 30, perSession: 13 },
  '1h': { base: '1H', group: 60, perSession: 7 },
  '2h': { base: '1H', group: 120, perSession: 4 },
  '4h': { base: '1H', group: 240, perSession: 2 },
};
/** CNBC keeps about 100 days of intraday bars. */
const MAX_INTRADAY_DAYS = 110;

/**
 * Bars merged into New York clock buckets of `group` minutes (15m from 5m, 4h from 1h…), each at its bucket's start, so
 * `t + timeframe` is when it closes. Buckets never span two days.
 */
export function mergeNy(bars: Candle[], group: number): Candle[] {
  const out: Candle[] = [];
  let key = '';
  for (const b of bars) {
    const p = zonedParts(b.t, NY);
    const minutes = p.hour * 60 + p.minute;
    const start = Math.floor(minutes / group) * group;
    const k = `${p.year}-${p.month}-${p.day}|${start}`;
    const last = out.at(-1);
    if (last && k === key) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else {
      key = k;
      out.push({ t: b.t - (minutes - start) * 60_000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Cboe's daily rows → candles at New York midnight; rows without a full positive OHLC are skipped (SPX before 1996). */
export function parseCboeHistory(json: unknown, scale: number): Candle[] {
  const rows = ((json as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
  const out: Candle[] = [];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const day = String(r.date ?? '');
    const o = num(r.open);
    const h = num(r.high);
    const l = num(r.low);
    const c = num(r.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || o === null || h === null || l === null || c === null || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    out.push({ t: zonedTimeToUtc(day, NY), o: o * scale, h: h * scale, l: l * scale, c: c * scale, v: 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface CboeQuote {
  last: number | null;
  change: number | null;
  changePct: number | null;
  /** The session's bar so far (null before the first price of the day). */
  today: Candle | null;
}

/** Cboe's quote; `last_trade_time` is New York wall-clock time ("2026-10-14T10:48:27"). */
export function parseCboeQuote(json: unknown, scale: number): CboeQuote {
  const d = ((json as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  const last = num(d.current_price);
  const o = num(d.open);
  const h = num(d.high);
  const l = num(d.low);
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(String(d.last_trade_time ?? ''))?.[1];
  const today = day && last !== null && o !== null && h !== null && l !== null && o > 0 && h > 0 && l > 0 && last > 0 ? { t: zonedTimeToUtc(day, NY), o: o * scale, h: h * scale, l: l * scale, c: last * scale, v: 0 } : null;
  const change = num(d.price_change);
  return { last: last === null ? null : last * scale, change: change === null ? null : change * scale, changePct: num(d.price_change_percent), today };
}

export class CboeClient {
  private async get(path: string): Promise<unknown> {
    let r;
    try {
      r = await httpRequest(`${CBOE}/${path}`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' }, timeoutMs: 30_000 });
    } catch (err) {
      throw new MarketError('EXCHANGE_ERROR', `Cboe: ${(err as HttpError).message}`);
    }
    // Only the catalog's codes are asked for: a refusal (Cloudflare answers 403 when it blocks) is the source's, never an
    // unknown symbol.
    if (r.status !== 200) throw new MarketError('EXCHANGE_ERROR', `Cboe: HTTP ${r.status}`);
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new MarketError('EXCHANGE_ERROR', 'Cboe: răspuns neașteptat');
    }
  }

  async quote(code: string, scale: number): Promise<CboeQuote> {
    return parseCboeQuote(await this.get(`quotes/${code}.json`), scale);
  }

  async daily(code: string, scale: number): Promise<Candle[]> {
    return parseCboeHistory(await this.get(`charts/historical/${code}.json`), scale);
  }
}

/** Nasdaq-style market labels, as stock quotes have them (the UI looks for "closed"). */
const STATUS_LABEL: Record<MarketStatus['state'], string> = { open: 'Market Open', closed: 'Market Closed', pre: 'Pre-Market', after: 'After-Hours' };

/** Ten years of daily bars from Nasdaq (what it keeps); Cboe gives its whole history at once; CNBC from 2010. */
const NASDAQ_YEARS = 10;
const CNBC_FIRST_DAY = '2010-01-01';
/** One download of an index's daily history serves its 1d and 1w charts, its spark line and the scanner meanwhile. */
const HISTORY_TTL_MS = 5 * 60_000;
/** CNBC's quotes (all seven indices in one request) and intraday bars are kept this long. */
const QUOTES_TTL_MS = 20_000;
const INTRADAY_TTL_MS = 30_000;

/** Where the candles came from, as the chart names it. */
export type IndexFeed = 'cnbc' | 'cboe' | 'nasdaq';

interface Cached<T> {
  value: T;
  at: number;
}

export class IndexData {
  private readonly nasdaq: NasdaqClient;
  private readonly cboe: CboeClient;
  private readonly cnbc: CnbcClient;
  private readonly now: () => number;
  private readonly status: () => Promise<MarketStatus | null>;
  private readonly histories = new Map<string, Cached<{ candles: Candle[]; from: IndexFeed }>>();
  /** Per index and CNBC interval: the bars and how many days back they reach (a longer read serves shorter asks). */
  private readonly intradays = new Map<string, Cached<{ bars: Candle[]; days: number }>>();
  private quotesCache: Cached<Map<string, CnbcQuote>> | null = null;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: { nasdaq: NasdaqClient; cboe?: CboeClient; cnbc?: CnbcClient; now: () => number; status: () => Promise<MarketStatus | null> }) {
    this.nasdaq = opts.nasdaq;
    this.cboe = opts.cboe ?? new CboeClient();
    this.cnbc = opts.cnbc ?? new CnbcClient();
    this.now = opts.now;
    this.status = opts.status;
  }

  /** One request at a time per key; the others wait for it. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** CNBC's quotes of all the indices, in one request. */
  private cnbcQuotes(): Promise<Map<string, CnbcQuote>> {
    const c = this.quotesCache;
    if (c && this.now() - c.at < QUOTES_TTL_MS) return Promise.resolve(c.value);
    return this.once('quotes', async () => {
      const list = await this.cnbc.quotes(Object.values(INDEX_SOURCES).map((x) => x.cnbc));
      const value = new Map(list.map((q) => [q.symbol, q]));
      this.quotesCache = { value, at: this.now() };
      return value;
    });
  }

  /** CNBC's quote, in real time; when CNBC fails, the fallback's (Cboe's is delayed, FD-INDEXINTRA). */
  async quote(id: string): Promise<StockQuote> {
    const src = sourceOf(id);
    const now = this.now();
    const name = indexById(id)?.name ?? null;
    const state = async () => {
      const st = (await this.status())?.state;
      return st ? STATUS_LABEL[st] : null;
    };
    try {
      const q = (await this.cnbcQuotes()).get(src.cnbc);
      if (!q || q.last === null) throw new MarketError('EXCHANGE_ERROR', `CNBC nu are ${src.cnbc}`);
      return { symbol: id, name, last: q.last, change: q.change, changePct: q.changePct, status: await state(), fetchedAt: now, delayed: !q.realTime };
    } catch {
      const fb = src.fallback;
      if (fb.from === 'nasdaq') return { ...(await this.nasdaq.quote(fb.code, now, 'index')), symbol: id, name };
      const q = await this.cboe.quote(fb.code, fb.scale);
      return { symbol: id, name, last: q.last, change: q.change, changePct: q.changePct, status: await state(), fetchedAt: now, delayed: true };
    }
  }

  /** Every daily bar (newest last), with today's while the history does not have it yet; and where they came from. */
  async history(id: string): Promise<{ candles: Candle[]; from: IndexFeed }> {
    sourceOf(id);
    const c = this.histories.get(id);
    if (c && this.now() - c.at < HISTORY_TTL_MS) return c.value;
    return this.once(`history|${id}`, async () => {
      const value = await this.loadHistory(id);
      this.histories.set(id, { value, at: this.now() });
      return value;
    });
  }

  private async loadHistory(id: string): Promise<{ candles: Candle[]; from: IndexFeed }> {
    const src = sourceOf(id);
    const today = dayKey(this.now(), NY);
    try {
      let days = await this.cnbc.bars(src.cnbc, '1D', CNBC_FIRST_DAY, today);
      if (days.length === 0) throw new MarketError('EXCHANGE_ERROR', 'CNBC: nicio lumânare');
      // Today's bar from the quote (CNBC's daily bars end with the last finished session).
      const q = await this.cnbcQuotes()
        .then((m) => m.get(src.cnbc))
        .catch(() => undefined);
      if (q?.day && q.open && q.high && q.low && q.last && q.open > 0 && q.high > 0 && q.low > 0 && q.last > 0) {
        const bar = { t: zonedTimeToUtc(q.day, NY), o: q.open, h: q.high, l: q.low, c: q.last, v: 0 };
        if (bar.t > (days.at(-1) as Candle).t) days = [...days, bar];
      }
      return { candles: days, from: 'cnbc' };
    } catch {
      return { candles: await this.loadFallback(id), from: src.fallback.from };
    }
  }

  private async loadFallback(id: string): Promise<Candle[]> {
    const src = sourceOf(id).fallback;
    const now = this.now();
    let days: Candle[];
    let today: Candle | null = null;
    if (src.from === 'nasdaq') {
      days = await this.nasdaq.daily(src.code, dayKey(now - NASDAQ_YEARS * 365 * 86_400_000, NY), dayKey(now, NY), 10_000, 'index');
      today = await this.nasdaq.today(src.code, 'index').catch(() => null);
    } else {
      days = await this.cboe.daily(src.code, src.scale);
      today = await this.cboe
        .quote(src.code, src.scale)
        .then((q) => q.today)
        .catch(() => null);
    }
    if (today && (days.length === 0 || today.t > (days.at(-1) as Candle).t)) days = [...days, today];
    return days;
  }

  /**
   * Intraday candles of an index (FD-INDEXINTRA): CNBC's bars of the base interval for as many days as `count` needs
   * (at most ~100: what CNBC keeps), merged when the timeframe is larger. No fallback: only CNBC has them.
   */
  async intraday(id: string, tf: Timeframe, count: number): Promise<Candle[]> {
    const src = sourceOf(id);
    const spec = INDEX_INTRADAY[tf];
    if (!spec) throw new MarketError('UNSUPPORTED_TIMEFRAME', `Indicii nu au ${tf}`);
    const days = Math.min(MAX_INTRADAY_DAYS, Math.ceil((count / spec.perSession) * 1.5) + 4);
    const key = `${id}|${spec.base}`;
    const c = this.intradays.get(key);
    let bars: Candle[];
    if (c && c.value.days >= days && this.now() - c.at < INTRADAY_TTL_MS) bars = c.value.bars;
    else {
      bars = await this.once(`intraday|${key}|${days}`, async () => {
        const today = dayKey(this.now(), NY);
        const value = await this.cnbc.bars(src.cnbc, spec.base, dayKey(this.now() - days * 86_400_000, NY), today).catch((err: Error) => {
          throw new MarketError('EXCHANGE_ERROR', `Datele intraday ale indicilor nu sunt disponibile acum (${err.message})`);
        });
        // A fresh read never shortens what is kept for a longer ask (both are fresh: the longer one wins).
        const kept = this.intradays.get(key);
        if (!kept || this.now() - kept.at >= INTRADAY_TTL_MS || kept.value.days <= days) this.intradays.set(key, { value: { bars: value, days }, at: this.now() });
        return value;
      });
    }
    const merged = spec.group === CNBC_MINUTES[spec.base] ? bars : mergeNy(bars, spec.group);
    return merged.slice(-count);
  }
}
