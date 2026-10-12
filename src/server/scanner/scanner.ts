// Runs the Slingshot port on every watchlist coin (FD §5.4).
import { htfCandleCount, runSlingshot, type SlingshotResult } from '../../shared/indicator/slingshot.ts';
import { tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import type { MarketData } from '../market/market.ts';
import type { SettingsService } from '../settings.ts';


export interface ScanRow {
  coin: string;
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

export class Scanner {
  private latest: ScanResult | null = null;
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly market: MarketData;
  private readonly log: Logger;

  constructor(db: Db, settings: SettingsService, market: MarketData, log: Logger) {
    this.db = db;
    this.settings = settings;
    this.market = market;
    this.log = log;
  }

  result(): ScanResult | null {
    return this.latest;
  }

  async run(signal?: AbortSignal): Promise<ScanResult> {
    const s = this.settings.get();
    const tf = s.scanner.tf;
    const exchange = s.market.exchange;
    const p = s.indicator;
    const chartSec = tfSeconds(tf);
    const msSec = p.msTf ? tfSeconds(p.msTf) : chartSec;
    // Same history length as the charts: the long state machine is path dependent, so a shorter history
    // could report a different "last signal" than the chart of the same coin.
    const count = s.market.candles;
    const coins = this.db.all<{ coin: string; quote: string }>('SELECT coin, quote FROM watchlist ORDER BY position, coin');
    const rows: ScanRow[] = [];
    for (const w of coins) {
      if (signal?.aborted) break;
      const symbol = `${w.coin}/${w.quote}`;
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
        rows.push(summarize(w.coin, symbol, tf, r, c.candles, c.pricePrecision));
      } catch (err) {
        rows.push({ coin: w.coin, symbol, tf, ok: false, error: (err as Error).message.slice(0, 200) });
      }
    }
    // An interrupted run (shutdown / timeout) keeps the previous complete result.
    if (signal?.aborted && this.latest) return this.latest;
    this.latest = { computedAt: Date.now(), exchange, rows };
    return this.latest;
  }
}
