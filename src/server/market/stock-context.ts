// Stock market context (FD-SENTIQ §4.2): CNN's Fear & Greed for stocks with the S&P 500 and VIX it carries,
// the Nasdaq-100 and the US market state. Stored in market_cache like the crypto context.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { fetchJson } from '../net/http.ts';
import type { MarketStatus, StockData } from './stocks.ts';

export const STOCK_FNG_KEY = 'stocks:fng';
export const STOCK_INDICES_KEY = 'stocks:indices';
export const STOCK_MARKET_KEY = 'stocks:market';
/** CNN answers browsers coming from its own pages only. */
const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const CNN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  Referer: 'https://edition.cnn.com/',
  Origin: 'https://edition.cnn.com',
};

const point = z.object({ x: z.number(), y: z.number() });
const series = z.object({ data: z.array(point) });
const cnnSchema = z.object({
  fear_and_greed: z.object({
    score: z.number(),
    rating: z.string(),
    timestamp: z.string(),
    previous_close: z.number().nullable().optional(),
    previous_1_week: z.number().nullable().optional(),
  }),
  fear_and_greed_historical: series.optional(),
  market_momentum_sp500: series.optional(),
  market_volatility_vix: series.optional(),
});

export interface StockFearGreed {
  value: number;
  /** CNN's rating: extreme fear, fear, neutral, greed, extreme greed. */
  rating: string;
  timestamp: number;
  previousClose: number | null;
  previousWeek: number | null;
  /** One value a day, oldest first (31 days). */
  history: { value: number; timestamp: number }[];
}

export interface IndexQuote {
  id: 'SPX' | 'NDX' | 'VIX';
  name: string;
  last: number;
  changePct: number | null;
  asOf: number;
}

const DAY = 86_400_000;

/** One value per UTC day (CNN repeats the last day with the time of its update), oldest first. */
function daily(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const byDay = new Map<number, { x: number; y: number }>();
  for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) byDay.set(Math.floor(p.x / DAY), p);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

function lastWithChange(id: IndexQuote['id'], name: string, points: { x: number; y: number }[] | undefined): IndexQuote | null {
  const d = daily(points ?? []);
  const last = d.at(-1);
  if (!last) return null;
  const prev = d.at(-2);
  return { id, name, last: last.y, changePct: prev && prev.y !== 0 ? ((last.y - prev.y) / prev.y) * 100 : null, asOf: last.x };
}

export function parseCnn(raw: unknown): { fearGreed: StockFearGreed; indices: IndexQuote[] } {
  const d = cnnSchema.parse(raw);
  const fg = d.fear_and_greed;
  const history = daily(d.fear_and_greed_historical?.data ?? [])
    .slice(-31)
    .map((p) => ({ value: p.y, timestamp: p.x }));
  return {
    fearGreed: {
      value: Math.round(fg.score),
      rating: fg.rating,
      timestamp: Date.parse(fg.timestamp) || Date.now(),
      previousClose: fg.previous_close ?? null,
      previousWeek: fg.previous_1_week ?? null,
      history,
    },
    indices: [lastWithChange('SPX', 'S&P 500', d.market_momentum_sp500?.data), lastWithChange('VIX', 'VIX', d.market_volatility_vix?.data)].filter(
      (x): x is IndexQuote => x !== null,
    ),
  };
}

function put(db: Db, key: string, value: unknown, now: number): void {
  db.run('INSERT INTO market_cache(key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at', [
    key,
    JSON.stringify(value),
    now,
  ]);
}

function read<T>(db: Db, key: string): { value: T; fetchedAt: number } | null {
  const row = db.get<{ value: string; fetched_at: number }>('SELECT value, fetched_at FROM market_cache WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

/**
 * The `stocks.market` job (every 5 min): the market state always; CNN and the Nasdaq-100 while the market trades
 * (pre-market to after-hours), otherwise once an hour.
 */
export async function refreshStockContext(db: Db, stocks: StockData, now = Date.now(), fetchCnn: () => Promise<unknown> = () => fetchJson(CNN_URL, { headers: CNN_HEADERS, timeoutMs: 15_000 })): Promise<string[]> {
  const errors: string[] = [];
  const status = await stocks.confirmedStatus();
  if (status) put(db, STOCK_MARKET_KEY, status, now);
  else errors.push('nasdaq market-info: indisponibil');
  const last = read<unknown>(db, STOCK_INDICES_KEY);
  const trading = status !== null && status.state !== 'closed';
  if (last && !trading && now - last.fetchedAt < 60 * 60_000) return errors;
  const indices: IndexQuote[] = [];
  try {
    const cnn = parseCnn(await fetchCnn());
    put(db, STOCK_FNG_KEY, cnn.fearGreed, now);
    indices.push(...cnn.indices);
  } catch (err) {
    errors.push(`cnn fear&greed: ${(err as Error).message}`);
  }
  try {
    const ndx = await stocks.nasdaq.ndx(now);
    if (ndx.last !== null) indices.push({ id: 'NDX', name: 'Nasdaq 100', last: ndx.last, changePct: ndx.changePct, asOf: now });
  } catch (err) {
    errors.push(`nasdaq ndx: ${(err as Error).message}`);
  }
  if (indices.length) {
    // A source that failed keeps its last value.
    const prev = read<IndexQuote[]>(db, STOCK_INDICES_KEY)?.value ?? [];
    const merged = (['SPX', 'NDX', 'VIX'] as const).map((id) => indices.find((i) => i.id === id) ?? prev.find((i) => i.id === id)).filter((x): x is IndexQuote => Boolean(x));
    put(db, STOCK_INDICES_KEY, merged, now);
  }
  return errors;
}

export interface StockContext {
  fearGreed: (StockFearGreed & { fetchedAt: number }) | null;
  indices: { items: IndexQuote[]; fetchedAt: number } | null;
  market: (MarketStatus & { storedAt: number }) | null;
}

export function readStockContext(db: Db): StockContext {
  const fg = read<StockFearGreed>(db, STOCK_FNG_KEY);
  const ix = read<IndexQuote[]>(db, STOCK_INDICES_KEY);
  const m = read<MarketStatus>(db, STOCK_MARKET_KEY);
  return {
    fearGreed: fg ? { ...fg.value, fetchedAt: fg.fetchedAt } : null,
    indices: ix && Array.isArray(ix.value) ? { items: ix.value, fetchedAt: ix.fetchedAt } : null,
    market: m ? { ...m.value, storedAt: m.fetchedAt } : null,
  };
}
