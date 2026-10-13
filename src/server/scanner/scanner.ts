// Runs the Slingshot port on every watchlist coin (FD §5.4).
import { htfCandleCount, runSlingshot, type SlingshotResult } from '../../shared/indicator/slingshot.ts';
import { tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import type { MarketData } from '../market/market.ts';
import type { StockData } from '../market/stocks.ts';
import type { Settings } from '../../shared/settings.ts';
import type { SettingsService } from '../settings.ts';

/** Stocks are re-scanned at most this often, to stay inside Twelve Data's free plan (FD-SENTIQ §4.6). */
const STOCK_SCAN_EVERY_MS = 30 * 60_000;

export interface ScanRow {
  coin: string;
  /** A coin (crypto) or a share (stock). */
  kind?: 'crypto' | 'stock';
  symbol: string;
  tf: Timeframe;
  ok: boolean;
  error?: string;
  price?: number;
  change24h?: number | null;
  pricePrecision?: number;
  uptrend?: boolean;
  liveSignal?: boolean;
  waitingLongTP?: boolean;
  lastSignal?: { time: number; entryLow: number; sl: number; tp: number; outcome: string; provisional: boolean } | null;
  atr?: { tp: number; sl: number } | null;
  ms?: { upper: number | null; lower: number | null; lastBreak: { type: 'msBullish' | 'msBearish'; time: number } | null } | null;
  warnings?: string[];
}

export interface ScanResult {
  computedAt: number;
  exchange: string;
  rows: ScanRow[];
}

export function summarize(coin: string, symbol: string, tf: Timeframe, r: SlingshotResult, candles: { t: number; c: number }[], precision: number): ScanRow {
  const last = candles.at(-1);
  const dayAgoT = (last?.t ?? 0) - 86_400_000;
  // A 24h change needs candles no longer than a day (on 1w it would be a weekly change).
  const ref = tfSeconds(tf) <= 86_400 ? [...candles].reverse().find((c) => c.t <= dayAgoT) : undefined;
  const lastSignal = r.signals.at(-1) ?? null;
  const lastBreak = [...r.alerts].reverse().find((a) => a.type === 'msBullish' || a.type === 'msBearish') ?? null;
  return {
    coin,
    symbol,
    tf,
    ok: true,
    price: last?.c,
    change24h: last && ref ? ((last.c - ref.c) / ref.c) * 100 : null,
    pricePrecision: precision,
    uptrend: r.last?.uptrend ?? false,
    liveSignal: r.last?.liveSignal ?? false,
    waitingLongTP: r.last?.waitingLongTP ?? false,
    lastSignal: lastSignal
      ? { time: lastSignal.time, entryLow: lastSignal.entryLow, sl: lastSignal.sl, tp: lastSignal.tp, outcome: lastSignal.outcome, provisional: lastSignal.provisional }
      : null,
    atr: r.atr ? { tp: r.atr.tp, sl: r.atr.sl } : null,
    ms: r.ms
      ? {
          upper: r.ms.upper?.price ?? null,
          lower: r.ms.lower?.price ?? null,
          lastBreak: lastBreak ? { type: lastBreak.type as 'msBullish' | 'msBearish', time: lastBreak.time } : null,
        }
      : null,
    warnings: r.warnings,
  };
}

/** The users a scan is kept for: active accounts that can sign in (the admin always). */
const SCANNED_USERS = "SELECT id FROM users WHERE disabled_at IS NULL AND (role = 'admin' OR email_verified_at IS NOT NULL) ORDER BY id";

export class Scanner {
  /** Each user's last complete scan (FD-USERS §2: everyone has their own favourites and indicator settings). */
  private readonly latest = new Map<number, ScanResult>();
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly market: MarketData;
  private readonly log: Logger;
  private readonly stocks: StockData | null;
  /** The last row of each stock per settings signature, when it was computed and whether the market was closed then. */
  private readonly stockRows = new Map<string, { row: ScanRow; at: number; closed: boolean; tf: Timeframe }>();

  constructor(db: Db, settings: SettingsService, market: MarketData, log: Logger, stocks: StockData | null = null) {
    this.db = db;
    this.settings = settings;
    this.market = market;
    this.log = log;
    this.stocks = stocks;
  }

  /** A stock's row: recomputed every 30 min while the market trades, once after it closes, otherwise reused. */
  private async stockRow(coin: string, tfWanted: Timeframe, s: Settings, signal?: AbortSignal): Promise<ScanRow> {
    const stocks = this.stocks;
    const symbol = `${coin}/USD`;
    if (!stocks) return { coin, kind: 'stock', symbol, tf: tfWanted, ok: false, error: 'datele pentru acțiuni nu sunt disponibile' };
    const tf = stocks.timeframes().includes(tfWanted) ? tfWanted : '1d';
    const status = await stocks.confirmedStatus();
    const closed = status?.state === 'closed';
    const p = s.indicator;
    // Keyed by the settings too: two users with different indicator settings get their own rows, and new settings
    // or history length recompute at once, even with the market closed.
    const key = JSON.stringify([coin, p, s.market.candles]);
    const prev = this.stockRows.get(key);
    const now = Date.now();
    if (prev && prev.tf === tf && (closed ? prev.closed : now - prev.at < STOCK_SCAN_EVERY_MS)) return prev.row;
    if (signal?.aborted) return prev?.row ?? { coin, kind: 'stock', symbol, tf, ok: false, error: 'scanare întreruptă' };
    const chartSec = tfSeconds(tf);
    const msSec = p.msTf ? tfSeconds(p.msTf) : chartSec;
    let row: ScanRow;
    try {
      const c = await stocks.candles(coin, tf, s.market.candles);
      let htf = null;
      if (msSec > chartSec && p.msTf && stocks.timeframes().includes(p.msTf as Timeframe)) {
        try {
          htf = (await stocks.candles(coin, p.msTf as Timeframe, htfCandleCount(s.market.candles, chartSec, msSec, p.msSwing))).candles;
        } catch (err) {
          this.log.warn(`scanner HTF ${coin}: ${(err as Error).message}`);
        }
      }
      const r = runSlingshot({ candles: c.candles, htfCandles: htf, chartTfSec: chartSec, msTfSec: msSec, params: p, nowMs: now });
      row = { ...summarize(coin, symbol, tf, r, c.candles, c.pricePrecision), kind: 'stock' };
      if (tf !== tfWanted) row.warnings = [...(row.warnings ?? []), 'STOCK_TF_FALLBACK'];
    } catch (err) {
      // Keep the previous good row when the source refuses for a while (budget, network).
      if (prev?.row.ok) return prev.row;
      row = { coin, kind: 'stock', symbol, tf, ok: false, error: (err as Error).message.slice(0, 200) };
    }
    this.stockRows.set(key, { row, at: now, closed, tf });
    return row;
  }

  /** A user's last scan, or null before the first one finished. */
  result(userId: number): ScanResult | null {
    return this.latest.get(userId) ?? null;
  }

  /** Scans every active user's favourites; a coin shared by users with the same settings is computed once. */
  async run(signal?: AbortSignal): Promise<void> {
    const users = this.db.all<{ id: number }>(SCANNED_USERS).map((u) => u.id);
    // One run: the same pair with the same settings for two users is one computation.
    const memo = new Map<string, ScanRow>();
    for (const userId of users) {
      if (signal?.aborted) break;
      const result = await this.runFor(userId, memo, signal);
      // An interrupted run (shutdown / timeout) keeps the previous complete result.
      if (result) this.latest.set(userId, result);
    }
    for (const id of this.latest.keys()) if (!users.includes(id)) this.latest.delete(id);
    // Rows of stocks nobody scans any more, or of old settings, go after a day.
    const now = Date.now();
    for (const [k, v] of this.stockRows) if (now - v.at > 86_400_000) this.stockRows.delete(k);
  }

  private async runFor(userId: number, memo: Map<string, ScanRow>, signal?: AbortSignal): Promise<ScanResult | null> {
    const s = this.settings.forUser(userId);
    const tf = s.scanner.tf;
    const exchange = s.market.exchange;
    const p = s.indicator;
    const chartSec = tfSeconds(tf);
    const msSec = p.msTf ? tfSeconds(p.msTf) : chartSec;
    // Same history length as the charts: the long state machine is path dependent, so a shorter history
    // could report a different "last signal" than the chart of the same coin.
    const count = s.market.candles;
    const coins = this.db.all<{ coin: string; quote: string; kind: string }>('SELECT coin, quote, kind FROM watchlist WHERE user_id = ? ORDER BY position, coin', [userId]);
    const rows: ScanRow[] = [];
    for (const w of coins) {
      if (signal?.aborted) return null;
      if (w.kind === 'stock') {
        rows.push(await this.stockRow(w.coin, tf, s, signal));
        continue;
      }
      const symbol = `${w.coin}/${w.quote}`;
      const key = JSON.stringify([exchange, symbol, tf, count, p]);
      const known = memo.get(key);
      if (known) {
        rows.push(known);
        continue;
      }
      let row: ScanRow;
      try {
        const c = await this.market.candles(exchange, symbol, tf, count);
        let htf = null;
        if (msSec > chartSec && p.msTf) {
          try {
            htf = (await this.market.candles(exchange, symbol, p.msTf, htfCandleCount(count, chartSec, msSec, p.msSwing))).candles;
          } catch (err) {
            this.log.warn(`scanner HTF ${symbol}: ${(err as Error).message}`);
          }
        }
        const r = runSlingshot({ candles: c.candles, htfCandles: htf, chartTfSec: chartSec, msTfSec: msSec, params: p, nowMs: Date.now() });
        row = { ...summarize(w.coin, symbol, tf, r, c.candles, c.pricePrecision), kind: 'crypto' };
      } catch (err) {
        row = { coin: w.coin, kind: 'crypto', symbol, tf, ok: false, error: (err as Error).message.slice(0, 200) };
      }
      memo.set(key, row);
      rows.push(row);
    }
    if (signal?.aborted) return null;
    return { computedAt: Date.now(), exchange, rows };
  }
}
