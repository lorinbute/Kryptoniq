// Bars an indicator reads besides the chart's (FD-INDICATORS §5, TD-INDICATORS §7): the chart symbol on another
// timeframe, another crypto pair, an American stock. What Sentiq can load is resolved to one of its sources; the rest is
// "missing" (another symbol) or makes the indicator run from the chart bars, as its original does without the vendor's
// data (the chart symbol).
import type { Bar } from 'oakscriptjs';
import { tfSeconds, zonedParts, type Timeframe } from '../../shared/time.ts';
import { sentiqTf, zoneOf, type ChartInfo } from './compute.ts';

/** A load Sentiq can make: the candles endpoint's query, and whether the bars are then grouped by month. */
export interface ExtraLoad {
  /** Same key for the same candles (React Query's key and the map below). */
  key: string;
  asset: 'crypto' | 'stock' | 'index';
  /** The crypto exchange (absent: the server chooses, FD-MARKETSRC). */
  exchange?: string;
  symbol: string;
  tf: Timeframe;
  limit: number;
  /** '1M': daily bars grouped by calendar month in the symbol's time zone. */
  monthly: boolean;
  /** Time zone of the months. */
  timezone: string;
  /** The chart symbol (on another timeframe). */
  sameSymbol: boolean;
}

export interface Resolved {
  request: { symbol: string; timeframe: string };
  load: ExtraLoad | null;
  /** It names the chart symbol (whatever its timeframe, and whether Sentiq can load it). */
  chartSymbol: boolean;
}

const CRYPTO_EXCHANGES = new Set(['BINANCE', 'KUCOIN', 'BYBIT', 'OKX', 'BITGET', 'COINBASE', 'KRAKEN', 'BITSTAMP', 'GEMINI', 'MEXC', 'GATEIO', 'HTX', 'BITFINEX', 'CRYPTO']);
const STOCK_EXCHANGES = new Set(['', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSEARCA', 'BATS', 'CBOE']);
const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR'] as const;
const STOCK_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
/** Coins whose "<COIN>USD" means the coin on any chart (TradingView's own lists name "BTCUSD"), not a stock ticker. */
const MAJOR_COINS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT', 'LINK', 'LTC', 'BCH', 'TON', 'SHIB', 'XLM', 'NEAR', 'ATOM', 'UNI', 'SUI']);
/** Forex: TradingView's FX prefixes, or two currency codes ("EURUSD"): Sentiq has no forex source. */
const FX_PREFIXES = new Set(['FX', 'FX_IDC', 'OANDA', 'FOREXCOM', 'SAXO', 'PEPPERSTONE', 'ICMARKETS', 'FXCM']);
const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'CNY', 'CNH', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'MXN', 'BRL', 'INR', 'KRW', 'XAU', 'XAG']);
const isForex = (prefix: string, ticker: string) => FX_PREFIXES.has(prefix) || (ticker.length === 6 && CURRENCIES.has(ticker.slice(0, 3)) && CURRENCIES.has(ticker.slice(3)));
const PAIR_RE = /^[A-Z0-9]{1,15}\/[A-Z0-9]{1,15}$/;

/** "BINANCE:ETHUSDT" → ["BINANCE", "ETHUSDT"]; "AAPL" → ["", "AAPL"]. */
function splitPrefix(s: string): [string, string] {
  const i = s.indexOf(':');
  return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)];
}

/** BASE/QUOTE of a crypto ticker written without the slash ("ETHUSDT" → ETH/USDT, "BTCUSD" → BTC/USDT). */
function pairOf(ticker: string): string | null {
  if (PAIR_RE.test(ticker)) {
    const [b, q] = ticker.split('/') as [string, string];
    return `${b}/${q === 'USD' ? 'USDT' : q}`;
  }
  for (const q of QUOTES) {
    if (ticker.length > q.length && ticker.endsWith(q)) {
      const base = ticker.slice(0, -q.length);
      if (/^[A-Z0-9]{1,15}$/.test(base)) return `${base}/${q === 'USD' ? 'USDT' : q}`;
    }
  }
  return null;
}

/** The chart's own ticker without exchange or slash ("BTCUSDT", "AAPL", "SPX"). */
const chartTicker = (info: ChartInfo) => info.symbol.replace('/', '').replace(/^\^/, '').toUpperCase();

/**
 * What symbol a request names, for Sentiq: the chart symbol, a crypto pair or a stock (TD-INDICATORS §7). Crypto: a
 * pair with a slash, a crypto exchange prefix, a ticker ending in USDT / USDC, a major coin with its quote ("BTCUSD"),
 * and, on a crypto chart, any ticker ending in USD / BTC / ETH / EUR. Stock: an American exchange prefix or none, and a
 * ticker. Forex and futures, null: Sentiq has no source for them.
 */
export function resolveSymbol(raw: string, info: ChartInfo): { asset: 'chart' } | { asset: 'crypto'; symbol: string } | { asset: 'stock'; symbol: string } | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const [prefix, ticker] = splitPrefix(s);
  if (ticker === chartTicker(info) || (info.kind === 'crypto' && ticker === info.symbol.toUpperCase())) return { asset: 'chart' };
  if (isForex(prefix, ticker)) return null;
  const pair = pairOf(ticker);
  const major = pair !== null && MAJOR_COINS.has(pair.split('/')[0] as string);
  if (pair && (ticker.includes('/') || CRYPTO_EXCHANGES.has(prefix) || /(USDT|USDC)$/.test(ticker) || (prefix === '' && (info.kind === 'crypto' || major)))) {
    return { asset: 'crypto', symbol: pair };
  }
  if (STOCK_EXCHANGES.has(prefix) && STOCK_RE.test(ticker)) return { asset: 'stock', symbol: ticker };
  return null;
}

/** Candles that cover `seconds` of history on `tf`, plus a margin, within the chart's own limit. */
export function candlesFor(seconds: number, tf: Timeframe, chartLimit: number): number {
  return Math.max(50, Math.min(chartLimit, Math.ceil(seconds / tfSeconds(tf)) + 50));
}

export interface ResolveEnv {
  info: ChartInfo;
  /** Seconds between the first and the last chart candle. */
  spanSec: number;
  /** The chart's candle limit (admin's setting, FD-CHARTUX §2). */
  chartLimit: number;
  /** Timeframes the chart's own source has (null: unknown, assume all). */
  chartTfs: readonly Timeframe[] | null;
  /** Timeframes a stock has without the user's own Twelve Data key (FD-TDKEYS), else all. */
  stockTfs: readonly Timeframe[] | null;
}

/** One request → a load, or null when Sentiq cannot give those bars (TD-INDICATORS §7). */
export function resolveRequest(request: { symbol: string; timeframe: string }, env: ResolveEnv): Resolved {
  const { info } = env;
  const who = resolveSymbol(request.symbol, info);
  const chartSymbol = who?.asset === 'chart';
  const none: Resolved = { request, load: null, chartSymbol };
  const tf = request.timeframe ? sentiqTf(request.timeframe) : info.tf;
  if (!tf || !who) return none;
  const base: Timeframe = tf === '1M' ? '1d' : tf;
  // A lower timeframe than the chart's would be tens of thousands of candles.
  if (tfSeconds(base) < tfSeconds(info.tf) && tf !== '1M') return none;
  const monthly = tf === '1M';
  if (who.asset === 'chart') {
    if (env.chartTfs && !env.chartTfs.includes(base)) return none;
    const asset = info.kind;
    const limit = monthly ? env.chartLimit : candlesFor(env.spanSec, base, env.chartLimit);
    const exchange = info.kind === 'crypto' ? info.exchange : undefined;
    const key = `${asset}|${exchange ?? ''}|${info.symbol}|${base}|${limit}`;
    return { request, chartSymbol, load: { key, asset, ...(exchange ? { exchange } : {}), symbol: info.symbol, tf: base, limit, monthly, timezone: zoneOf(info.kind).timezone, sameSymbol: true } };
  }
  if (who.asset === 'crypto') {
    // The chart's exchange for a coin chart; for a stock chart the server picks the user's (FD-MARKETSRC).
    if (info.kind === 'crypto' && env.chartTfs && !env.chartTfs.includes(base)) return none;
    const exchange = info.kind === 'crypto' ? info.exchange : undefined;
    const key = `crypto|${exchange ?? ''}|${who.symbol}|${base}|${env.chartLimit}`;
    return { request, chartSymbol, load: { key, asset: 'crypto', ...(exchange ? { exchange } : {}), symbol: who.symbol, tf: base, limit: env.chartLimit, monthly, timezone: 'Etc/UTC', sameSymbol: false } };
  }
  if (env.stockTfs && !env.stockTfs.includes(base)) return none;
  const key = `stock||${who.symbol}|${base}|${env.chartLimit}`;
  return { request, chartSymbol, load: { key, asset: 'stock', symbol: who.symbol, tf: base, limit: env.chartLimit, monthly, timezone: 'America/New_York', sameSymbol: false } };
}

/** Daily bars grouped by calendar month in `tz` (open of the first, high / low of all, close of the last, volume summed). */
export function monthlyBars(daily: readonly Bar[], tz: string): Bar[] {
  const out: Bar[] = [];
  let key = '';
  for (const b of daily) {
    const p = zonedParts(b.time * 1000, tz);
    const k = `${p.year}-${p.month}`;
    const last = out.at(-1);
    if (k !== key || !last) {
      out.push({ ...b });
      key = k;
    } else {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume = (last.volume ?? 0) + (b.volume ?? 0);
    }
  }
  return out;
}

/** What a load gave: its bars, still loading, or failed. */
export type LoadState = { bars: Bar[] } | 'loading' | 'failed';

/**
 * How an indicator with requests runs (TD-INDICATORS §7): with the loaded bars; from the chart bars when it reads only
 * the chart symbol and some timeframe cannot be given (or is still loading); or with what is there, the rest missing.
 * `wait`: another symbol still loading, nothing to draw yet.
 */
export function planRun(
  resolved: readonly Resolved[],
  loads: ReadonlyMap<string, LoadState>,
): { mode: 'bars'; bars: (symbol: string, timeframe: string) => Bar[] | undefined } | { mode: 'approximate' } | { mode: 'wait' } {
  const states = resolved.map((r) => (r.load ? (loads.get(r.load.key) ?? 'loading') : 'failed'));
  const ready = states.every((s) => typeof s === 'object');
  const lookup = (symbol: string, timeframe: string) => {
    const i = resolved.findIndex((r) => r.request.symbol === symbol && r.request.timeframe === timeframe);
    const s = i < 0 ? undefined : states[i];
    return s && typeof s === 'object' ? s.bars : undefined;
  };
  if (ready) return { mode: 'bars', bars: lookup };
  const onlyChart = resolved.every((r) => r.chartSymbol);
  if (onlyChart) return { mode: 'approximate' };
  if (states.some((s) => s === 'loading')) return { mode: 'wait' };
  return { mode: 'bars', bars: lookup };
}
