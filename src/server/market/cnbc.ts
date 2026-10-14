// CNBC's public quote and chart data (FD-INDEXINTRA, TD-INDEXINTRA): the US indices in real time, daily bars since 2010
// and intraday bars (1, 5, 30 minutes, 1 hour) for about 100 days. No key; the same browser headers as Nasdaq and Cboe.
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { addDays } from '../../shared/time.ts';
import { HttpError, httpRequest } from '../net/http.ts';
import { MarketError } from './market.ts';

const QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

export type CnbcInterval = '1M' | '5M' | '30M' | '1H' | '1D';
/** Minutes a bar of each interval lasts. */
export const CNBC_MINUTES: Record<CnbcInterval, number> = { '1M': 1, '5M': 5, '30M': 30, '1H': 60, '1D': 1440 };

/** The regular session, in New York minutes of the day: 9:30–16:00. */
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

export interface CnbcQuote {
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** The last trade, UTC ms. */
  at: number | null;
  /** New York day of the last trade (YYYY-MM-DD). */
  day: string | null;
  /** CNBC marks real-time quotes. */
  realTime: boolean;
}

/** "7,700.70", "-1.34%", "UNCH" → number or null. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,%+\s]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

export function parseCnbcQuotes(json: unknown): CnbcQuote[] {
  const list = ((json as { FormattedQuoteResult?: { FormattedQuote?: unknown } })?.FormattedQuoteResult?.FormattedQuote ?? []) as Record<string, unknown>[];
  if (!Array.isArray(list)) return [];
  return list
    .filter((q) => typeof q.symbol === 'string')
    .map((q) => {
      const t = typeof q.last_time === 'string' ? Date.parse(q.last_time) : NaN;
      const day = typeof q.last_time === 'string' ? (/^(\d{4}-\d{2}-\d{2})T/.exec(q.last_time)?.[1] ?? null) : null;
      return {
        symbol: String(q.symbol),
        last: num(q.last),
        change: num(q.change),
        changePct: num(q.change_pct),
        open: num(q.open),
        high: num(q.high),
        low: num(q.low),
        at: Number.isFinite(t) ? t : null,
        day,
        realTime: String(q.realTime) === 'true',
      };
    });
}

/**
 * CNBC's bars → candles at their own start (`tradeTimeinMills`). Intraday: only the regular session (a bar that starts
 * before 16:00 and ends after 9:30, New York time, read from `tradeTime`), so the flat after-hours prints are left out.
 * Bars without a full positive OHLC are skipped.
 */
export function parseCnbcBars(json: unknown, interval: CnbcInterval): Candle[] {
  const bars = ((json as { barData?: { priceBars?: unknown } })?.barData?.priceBars ?? []) as Record<string, unknown>[];
  if (!Array.isArray(bars)) return [];
  const minutes = CNBC_MINUTES[interval];
  const out: Candle[] = [];
  for (const b of bars) {
    const t = Number(b.tradeTimeinMills);
    const o = num(b.open);
    const h = num(b.high);
    const l = num(b.low);
    const c = num(b.close);
    if (!Number.isFinite(t) || o === null || h === null || l === null || c === null || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    if (interval !== '1D') {
      const m = /^\d{8}(\d{2})(\d{2})/.exec(String(b.tradeTime ?? ''));
      if (!m) continue;
      const start = Number(m[1]) * 60 + Number(m[2]);
      if (start >= CLOSE_MIN || start + minutes <= OPEN_MIN) continue;
    }
    out.push({ t, o, h, l, c, v: 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** YYYYMMDD000000 of a day (CNBC reads it in New York time). */
const stamp = (day: string) => `${day.replace(/-/g, '')}000000`;

export class CnbcClient {
  private async get(url: string): Promise<unknown> {
    let r;
    try {
      r = await httpRequest(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' }, timeoutMs: 30_000 });
    } catch (err) {
      throw new MarketError('EXCHANGE_ERROR', `CNBC: ${(err as HttpError).message}`);
    }
    if (r.status !== 200) throw new MarketError('EXCHANGE_ERROR', `CNBC: HTTP ${r.status}`);
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new MarketError('EXCHANGE_ERROR', 'CNBC: răspuns neașteptat');
    }
  }

  /** Several symbols in one request (".SPX", ".DJI"…). */
  async quotes(symbols: string[]): Promise<CnbcQuote[]> {
    const qs = new URLSearchParams({ symbols: symbols.join('|'), requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json' });
    return parseCnbcQuotes(await this.get(`${QUOTE_URL}?${qs.toString()}`));
  }

  /** Bars between two New York days (`toDay` included). */
  async bars(symbol: string, interval: CnbcInterval, fromDay: string, toDay: string): Promise<Candle[]> {
    // The end is exclusive at CNBC: the day after `toDay`.
    const json = await this.get(`${BARS_URL}/${encodeURIComponent(symbol)}/${interval}/${stamp(fromDay)}/${stamp(addDays(toDay, 1))}/adjusted/EST5EDT.json`);
    if (!(json as { barData?: unknown })?.barData) throw new MarketError('EXCHANGE_ERROR', 'CNBC: răspuns fără lumânări');
    return parseCnbcBars(json, interval);
  }
}
