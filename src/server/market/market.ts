// Public market data through ccxt: markets, symbol search and cached OHLCV (TD §8).
import ccxt, { type Exchange, type MarketInterface } from 'ccxt';
import { TIMEFRAMES, tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import { MARKET_EXCHANGES } from '../../shared/settings.ts';
import { isRateLimitError, withRetry } from '../exchange/retry.ts';

export type MarketExchangeId = (typeof MARKET_EXCHANGES)[number];

export class MarketError extends Error {
  readonly code: 'UNKNOWN_EXCHANGE' | 'UNKNOWN_SYMBOL' | 'UNSUPPORTED_TIMEFRAME' | 'EXCHANGE_ERROR';
  readonly suggestions: string[];
  constructor(code: MarketError['code'], message: string, suggestions: string[] = []) {
    super(message);
    this.code = code;
    this.suggestions = suggestions;
  }
}

export interface CandlesResult {
  exchange: string;
  symbol: string;
  tf: Timeframe;
  candles: Candle[];
  pricePrecision: number;
  /** Index of the last candle whose period has ended (−1 if none). */
  lastClosedIndex: number;
  fetchedAt: number;
  /** Stocks: why older candles are shown (the source refused, e.g. the Twelve Data limit), FD-SENTIQ §4.3. */
  notice?: string;
}

export interface SymbolInfo {
  symbol: string;
  base: string;
  quote: string;
  type: string;
}

const MARKETS_TTL_MS = 24 * 3_600_000;
// A failed daily refresh keeps the old list and is tried again after this pause, not on every request.
const MARKETS_RETRY_MS = 5 * 60_000;
const CACHE_MAX = 50;
const INCREMENTAL_MAX_AGE_MS = 3_600_000;

interface CacheEntry {
  candles: Candle[];
  fetchedAt: number;
  count: number;
}

/** Decimal places of a tick size: 0.1 → 1, 0.25 → 2, 1e-8 → 8, 5 → 0. */
export function tickDecimals(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0 || tick >= 1) return 0;
  const s = tick.toString();
  const exp = /e-(\d+)$/.exec(s);
  if (exp) {
    const mantissa = s.split('e')[0] as string;
    return Number(exp[1]) + (mantissa.split('.')[1]?.length ?? 0);
  }
  return s.split('.')[1]?.length ?? 0;
}

export function precisionDigits(exchange: Pick<Exchange, 'precisionMode'>, market: Pick<MarketInterface, 'precision'> | undefined): number {
  const p = market?.precision?.price;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return 2;
  if (exchange.precisionMode === ccxt.TICK_SIZE) return Math.min(12, tickDecimals(p));
  return Math.max(0, Math.min(12, Math.round(p)));
}

/** Merges candles by open time (later wins), sorted, without non-finite values. */
export function mergeCandles(base: Candle[], update: Candle[]): Candle[] {
  const byT = new Map<number, Candle>();
  for (const c of base) byT.set(c.t, c);
  for (const c of update) byT.set(c.t, c);
  return [...byT.values()]
    .filter((c) => [c.t, c.o, c.h, c.l, c.c, c.v].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

const toCandle = (r: (number | undefined)[]): Candle => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5] ?? 0) });

export class MarketData {
  private readonly exchanges = new Map<string, Exchange>();
  private readonly marketsLoadedAt = new Map<string, number>();
  private readonly marketsLoading = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CandlesResult>>();
  private readonly proxy: string | undefined;
  private readonly now: () => number;
  private readonly retryDelaysMs: readonly number[];

  constructor(opts: { proxy?: string; now?: () => number; factory?: (id: MarketExchangeId) => Exchange; retryDelaysMs?: readonly number[] } = {}) {
    this.proxy = opts.proxy;
    this.now = opts.now ?? Date.now;
    this.retryDelaysMs = opts.retryDelaysMs ?? [1000, 3000];
    if (opts.factory) this.factory = opts.factory;
  }

  private factory = (id: MarketExchangeId): Exchange => {
    const Ctor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[id];
    if (!Ctor) throw new MarketError('UNKNOWN_EXCHANGE', `Exchange necunoscut: ${id}`);
    return new Ctor({
      enableRateLimit: true,
      timeout: 20_000,
      ...(this.proxy ? { httpsProxy: this.proxy } : {}),
      // KuCoin's market loading would also download the full ticker list (its heaviest public call) just for fee rates.
      ...(id === 'kucoin' ? { options: { fetchMarkets: { fetchTickersFees: false } } } : {}),
    });
  };

  exchange(id: string): Exchange {
    if (!(MARKET_EXCHANGES as readonly string[]).includes(id)) throw new MarketError('UNKNOWN_EXCHANGE', `Exchange nesuportat: ${id}`);
    let ex = this.exchanges.get(id);
    if (!ex) {
      ex = this.factory(id as MarketExchangeId);
      this.exchanges.set(id, ex);
    }
    return ex;
  }

  async loadMarkets(id: string): Promise<Exchange> {
    const ex = this.exchange(id);
    const loadedAt = this.marketsLoadedAt.get(id) ?? 0;
    if (ex.markets && this.now() - loadedAt < MARKETS_TTL_MS) return ex;
    let p = this.marketsLoading.get(id);
    if (!p) {
      p = (async () => {
        try {
          // Always `reload`: ccxt keeps a failed load and would replay its error instead of asking again.
          await withRetry(() => ex.loadMarkets(true), { delaysMs: this.retryDelaysMs });
          this.marketsLoadedAt.set(id, this.now());
        } catch (err) {
          if (!ex.markets) throw new MarketError('EXCHANGE_ERROR', `${id}: nu se poate încărca lista de piețe (${exchangeMessage(err)})`);
          this.marketsLoadedAt.set(id, this.now() - MARKETS_TTL_MS + MARKETS_RETRY_MS);
        } finally {
          this.marketsLoading.delete(id);
        }
      })();
      this.marketsLoading.set(id, p);
    }
    await p;
    return ex;
  }

  /** Whether the exchange lists this pair, active and spot (FD-MARKETSRC §2: otherwise the default exchange is asked). */
  async lists(id: string, symbol: string): Promise<boolean> {
    const m = (await this.loadMarkets(id)).markets?.[symbol];
    return Boolean(m && m.spot !== false && m.active !== false);
  }

  /** The app's timeframes this exchange offers (ccxt knows them without a request). */
  timeframes(id: string): Timeframe[] {
    const ex = this.exchange(id);
    return TIMEFRAMES.filter((t) => Boolean(ex.timeframes && t in ex.timeframes));
  }

  async searchSymbols(id: string, q: string, limit = 50): Promise<SymbolInfo[]> {
    const ex = await this.loadMarkets(id);
    const needle = q.trim().toUpperCase();
    const quoteRank = (quote: string) => ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR'].indexOf(quote);
    return Object.values(ex.markets ?? {})
      .filter((m): m is MarketInterface => Boolean(m && m.spot && m.active !== false))
      .filter((m) => !needle || m.base.toUpperCase().startsWith(needle) || m.symbol.toUpperCase().includes(needle))
      .sort((a, b) => {
        const exactA = a.base.toUpperCase() === needle ? 0 : 1;
        const exactB = b.base.toUpperCase() === needle ? 0 : 1;
        if (exactA !== exactB) return exactA - exactB;
        const qa = quoteRank(a.quote);
        const qb = quoteRank(b.quote);
        return (qa === -1 ? 99 : qa) - (qb === -1 ? 99 : qb) || a.symbol.localeCompare(b.symbol);
      })
      .slice(0, limit)
      .map((m) => ({ symbol: m.symbol, base: m.base, quote: m.quote, type: m.type ?? 'spot' }));
  }

  private async resolve(id: string, symbol: string): Promise<{ ex: Exchange; market: MarketInterface }> {
    const ex = await this.loadMarkets(id);
    const market = ex.markets?.[symbol];
    if (!market) {
      const base = symbol.split('/')[0] ?? symbol;
      const suggestions = (await this.searchSymbols(id, base, 5)).map((s) => s.symbol);
      throw new MarketError('UNKNOWN_SYMBOL', `${symbol} nu este listat pe ${id}${suggestions.length ? `; încearcă ${suggestions.join(', ')}` : ''}`, suggestions);
    }
    return { ex, market };
  }

  async candles(id: string, symbol: string, tf: Timeframe, count: number): Promise<CandlesResult> {
    const key = `${id}|${symbol}|${tf}`;
    // Wait for an identical request in flight; its result lands in the cache we read next.
    const pending = this.inflight.get(key);
    if (pending) await pending.catch(() => undefined);
    const p = this.loadCandles(id, symbol, tf, count, key);
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async loadCandles(id: string, symbol: string, tf: Timeframe, count: number, key: string): Promise<CandlesResult> {
    const { ex, market } = await this.resolve(id, symbol);
    if (!ex.timeframes || !(tf in ex.timeframes)) throw new MarketError('UNSUPPORTED_TIMEFRAME', `${id} nu oferă timeframe-ul ${tf}`);
    const tfMs = tfSeconds(tf) * 1000;
    const now = this.now();
    const ttl = tfSeconds(tf) <= 900 ? 10_000 : 30_000;
    const cached = this.cache.get(key);
    let entry: CacheEntry;
    if (cached && cached.count >= count && now - cached.fetchedAt < ttl) {
      entry = cached;
    } else {
      try {
        if (cached && cached.count >= count && now - cached.fetchedAt < INCREMENTAL_MAX_AGE_MS && cached.candles.length > 0) {
          const lastT = (cached.candles.at(-1) as Candle).t;
          const fresh = await this.fetchRange(ex, symbol, lastT, now, tfMs, 1000);
          entry = { candles: mergeCandles(cached.candles, fresh).slice(-cached.count), fetchedAt: now, count: cached.count };
        } else {
          const since = now - count * tfMs;
          entry = { candles: (await this.fetchRange(ex, symbol, since, now, tfMs, count + 5)).slice(-count), fetchedAt: now, count };
        }
        this.store(key, entry);
      } catch (err) {
        // The exchange is down: serve the last good candles; `fetchedAt` tells the UI how old they are.
        if (!cached || cached.candles.length === 0) throw err;
        entry = cached;
      }
    }
    const candles = entry.candles.slice(-count);
    let lastClosedIndex = candles.length - 1;
    while (lastClosedIndex >= 0 && (candles[lastClosedIndex] as Candle).t + tfMs > now) lastClosedIndex--;
    return { exchange: id, symbol, tf, candles, pricePrecision: precisionDigits(ex, market), lastClosedIndex, fetchedAt: entry.fetchedAt };
  }

  private store(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }

  /** Pages forward from `since` until `until` (exchange page sizes differ: KuCoin 1500, Binance 1000, OKX 300…). */
  private async fetchRange(ex: Exchange, symbol: string, since: number, until: number, tfMs: number, maxCandles: number): Promise<Candle[]> {
    const perPage = pageSize(ex);
    const tf = Object.keys(ex.timeframes ?? {}).find((k) => tfSeconds(k as Timeframe) * 1000 === tfMs) as string;
    let out: Candle[] = [];
    let cursor = since;
    for (let page = 0; page < 20 && cursor <= until && out.length < maxCandles; page++) {
      let batch: (number | undefined)[][];
      try {
        batch = (await withRetry(() => ex.fetchOHLCV(symbol, tf, cursor, perPage), { delaysMs: this.retryDelaysMs })) as (number | undefined)[][];
      } catch (err) {
        throw new MarketError('EXCHANGE_ERROR', `${ex.id}: ${exchangeMessage(err)}`);
      }
      if (!batch.length) break;
      out = mergeCandles(out, batch.map(toCandle));
      const last = (out.at(-1) as Candle).t;
      if (last + tfMs <= cursor) break;
      cursor = last + tfMs;
    }
    return out;
  }
}

/** The exchange's error in words; a rate limit gets a plain sentence instead of the raw JSON (TD-RATELIMIT). */
function exchangeMessage(err: unknown): string {
  if (isRateLimitError(err)) return 'exchange-ul limitează temporar cererile; se reîncearcă automat';
  return err instanceof Error ? err.message : String(err);
}

function pageSize(ex: Exchange): number {
  const byId: Record<string, number> = { kucoin: 1500, binance: 1000, bybit: 1000, okx: 300 };
  return byId[ex.id] ?? 500;
}
