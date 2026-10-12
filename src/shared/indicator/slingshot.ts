// Port of "[Dusty Investments] Slingshot System Long 3.3" (Pine v5) — line-by-line translation.
// Source: Sling Shot System/sling-shot-system.pine. Keep the statement order identical to Pine:
// the long state machine is path dependent. `var` variables are state; everything else is per-bar.
import { Ema, Extreme, isNa, pivotHighAt, pivotLowAt, Rsi, Rma, Sma, StochSelf, trueRange } from './pine.ts';
import type { SlingshotParams } from './params.ts';

export interface Candle {
  /** Open time, epoch ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type AlertType = 'longSignal' | 'takeProfitSignal' | 'atrTakeProfit' | 'atrStopLoss' | 'msBullish' | 'msBearish';

export interface SlingshotMarker {
  id: number;
  bar: number;
  time: number;
  kind: 'long' | 'longPreview' | 'takeProfit';
  /** 'tp' = longTPColor (green), 'sl' = longSLColor (red). */
  color: 'tp' | 'sl';
  /** True when the marker sits on the still-forming candle. */
  provisional: boolean;
}

export interface SlingshotSignal {
  /** Bar of the V2 low (where the LONG label is drawn). */
  bar: number;
  time: number;
  /** Bar on which the signal was confirmed (exit from oversold). */
  confirmBar: number;
  confirmTime: number;
  entryLow: number;
  sl: number;
  tp: number;
  breakout: number;
  outcome: 'active' | 'tp' | 'sl' | 'invalidated';
  outcomeReason?: 'takeProfitSignal' | 'atrTakeProfit' | 'stopLoss' | 'superseded' | 'trendFlip';
  closedBar?: number;
  closedTime?: number;
  provisional: boolean;
}

export interface SlingshotAlert {
  bar: number;
  time: number;
  type: AlertType;
  provisional: boolean;
}

export interface AtrDisplay {
  tp: number;
  sl: number;
  fromBar: number;
  /** Bar index (may be beyond the last candle) where the TP/SL line ends. */
  toBarTp: number;
  toBarSl: number;
  /** Bar index where the TP/SL text labels sit (bar_index + 5). */
  labelBar: number;
  showLines: boolean;
  showLabels: boolean;
}

export interface MsLevel {
  price: number;
  fromBar: number;
}

export interface MsDisplay {
  upper: MsLevel | null;
  lower: MsLevel | null;
  rightEdgeBar: number;
}

export type SlingshotWarning = 'INSUFFICIENT_HISTORY' | 'HTF_UNAVAILABLE';

export interface SlingshotResult {
  emaFast: number[];
  emaSlow: number[];
  uptrend: boolean[];
  markers: SlingshotMarker[];
  signals: SlingshotSignal[];
  alerts: SlingshotAlert[];
  atr: AtrDisplay | null;
  ms: MsDisplay | null;
  /** Last bar's state, convenient for scanners. */
  last: {
    bar: number;
    uptrend: boolean;
    waitingLongTP: boolean;
    tpHit: boolean;
    liveSignal: boolean;
    msUpper: number;
    msLower: number;
    kLine: number;
  } | null;
  warnings: SlingshotWarning[];
}

export interface SlingshotInput {
  candles: Candle[];
  /** Candles of the market-structure timeframe; required only when it is higher than the chart's. */
  htfCandles?: Candle[] | null;
  chartTfSec: number;
  /** Seconds of the market-structure timeframe (equal to chartTfSec when the input is empty). */
  msTfSec: number;
  params: SlingshotParams;
  /** Wall clock used to decide whether the last candle is still forming. */
  nowMs: number;
  /** Precomputed series (tests inject hand-made series to drive the state machine). */
  series?: SlingshotSeries;
}

const MAX_LABELS = 500;

type LabelKind = 'long' | 'longPreview' | 'takeProfit' | 'atr' | 'ms';

interface LabelRec {
  id: number;
  bar: number;
  kind: LabelKind;
  color: 'tp' | 'sl';
  alive: boolean;
}

/** Emulates Pine label objects, including max_labels_count garbage collection (oldest first). */
export class LabelRegistry {
  private readonly all: LabelRec[] = [];
  private aliveCount = 0;
  private gcCursor = 0;

  create(bar: number, kind: LabelKind, color: 'tp' | 'sl'): number {
    const rec: LabelRec = { id: this.all.length, bar, kind, color, alive: true };
    this.all.push(rec);
    this.aliveCount++;
    while (this.aliveCount > MAX_LABELS && this.gcCursor < this.all.length) {
      const old = this.all[this.gcCursor++] as LabelRec;
      if (old.alive) {
        old.alive = false;
        this.aliveCount--;
      }
    }
    return rec.id;
  }

  delete(id: number | null): void {
    if (id === null) return;
    const rec = this.all[id];
    if (rec && rec.alive) {
      rec.alive = false;
      this.aliveCount--;
    }
  }

  setColor(id: number, color: 'tp' | 'sl'): void {
    const rec = this.all[id];
    if (rec && rec.alive) rec.color = color;
  }

  setBar(id: number, bar: number): void {
    const rec = this.all[id];
    if (rec && rec.alive) rec.bar = bar;
  }

  aliveOf(kinds: LabelKind[]): LabelRec[] {
    return this.all.filter((r) => r.alive && kinds.includes(r.kind));
  }
}

/**
 * Market-structure pivots computed in the HTF context (the `msPivots()` call inside request.security):
 * the latest confirmed pivot high/low and the open time of the bar that produced it, per HTF bar.
 */
function htfPivotSeries(htf: Candle[], swing: number) {
  const n = htf.length;
  const highs = htf.map((c) => c.h);
  const lows = htf.map((c) => c.l);
  const ph = new Array<number>(n).fill(NaN);
  const phTime = new Array<number>(n).fill(NaN);
  const pl = new Array<number>(n).fill(NaN);
  const plTime = new Array<number>(n).fill(NaN);
  let lastPh = NaN;
  let lastPhTime = NaN;
  let lastPl = NaN;
  let lastPlTime = NaN;
  for (let j = 0; j < n; j++) {
    const p = pivotHighAt(highs, j, swing, swing);
    const q = pivotLowAt(lows, j, swing, swing);
    // ta.valuewhen(not na(ph), ph, 0) and ta.valuewhen(not na(ph), time[msSwing], 0)
    if (!isNa(p)) {
      lastPh = p;
      lastPhTime = j - swing >= 0 ? (htf[j - swing] as Candle).t : NaN;
    }
    if (!isNa(q)) {
      lastPl = q;
      lastPlTime = j - swing >= 0 ? (htf[j - swing] as Candle).t : NaN;
    }
    ph[j] = lastPh;
    phTime[j] = lastPhTime;
    pl[j] = lastPl;
    plTime[j] = lastPlTime;
  }
  return { ph, phTime, pl, plTime };
}

/**
 * Index of the HTF bar visible from chart bar `i` with lookahead_off:
 * historical bars see the latest HTF bar closed by the chart bar's close; a still-forming
 * last chart bar sees the developing HTF bar that contains it.
 */
export function makeHtfMapper(htf: Candle[], htfSec: number, chartSec: number) {
  let j = -1;
  return (chartOpen: number, forming: boolean): number => {
    const chartClose = chartOpen + chartSec * 1000;
    while (j + 1 < htf.length && (htf[j + 1] as Candle).t + htfSec * 1000 <= chartClose) j++;
    if (forming) {
      let k = j;
      while (k + 1 < htf.length && (htf[k + 1] as Candle).t <= chartOpen) k++;
      return k;
    }
    return j;
  };
}

/** Higher-timeframe candles needed so market structure covers the whole chart history (+ pivot warm-up). */
export function htfCandleCount(chartCount: number, chartTfSec: number, msTfSec: number, swing: number): number {
  const n = Math.ceil((chartCount * chartTfSec) / msTfSec) + 2 * swing + 10;
  return Math.max(100, Math.min(5000, n));
}

export interface SlingshotSeries {
  emaFast: ArrayLike<number>;
  emaSlow: ArrayLike<number>;
  /** Smoothed stochastic RSI %K. */
  kLine: ArrayLike<number>;
  atr: ArrayLike<number>;
}

/** The `ta.*` series of the script, computed bar by bar exactly like Pine. */
export function computeSlingshotSeries(candles: Candle[], p: SlingshotParams): SlingshotSeries {
  const n = candles.length;
  const emaFast = new Array<number>(n);
  const emaSlow = new Array<number>(n);
  const kLine = new Array<number>(n);
  const atr = new Array<number>(n);
  const emaFastM = new Ema(p.lenFastEma);
  const emaSlowM = new Ema(p.lenSlowEma);
  const rsiM = new Rsi(p.lenRsi);
  const stochM = new StochSelf(p.lenStoch);
  const kSma = new Sma(p.smoothK);
  const atrM = new Rma(p.atrLength);
  let prevClose = NaN;
  for (let i = 0; i < n; i++) {
    const c = candles[i] as Candle;
    emaFast[i] = emaFastM.next(c.c);
    emaSlow[i] = emaSlowM.next(c.c);
    const rsiValue = rsiM.next(c.c);
    kLine[i] = kSma.next(stochM.next(rsiValue, i));
    atr[i] = atrM.next(trueRange(c.h, c.l, prevClose));
    prevClose = c.c;
  }
  return { emaFast, emaSlow, kLine, atr };
}

export function runSlingshot(input: SlingshotInput): SlingshotResult {
  const { candles, params: p, chartTfSec, msTfSec, nowMs } = input;
  const n = candles.length;
  const warnings: SlingshotWarning[] = [];
  const result: SlingshotResult = {
    emaFast: new Array<number>(n).fill(NaN),
    emaSlow: new Array<number>(n).fill(NaN),
    uptrend: new Array<boolean>(n).fill(false),
    markers: [],
    signals: [],
    alerts: [],
    atr: null,
    ms: null,
    last: null,
    warnings,
  };
  if (n === 0) {
    warnings.push('INSUFFICIENT_HISTORY');
    return result;
  }
  if (n < Math.max(p.lenSlowEma, p.lenRsi + p.lenStoch + p.smoothK, p.atrLength) + 2) warnings.push('INSUFFICIENT_HISTORY');

  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const lastForming = (candles[n - 1] as Candle).t + chartTfSec * 1000 > nowMs;
  const isProvisional = (bar: number) => lastForming && bar === n - 1;
  const timeOf = (bar: number) => (candles[bar] as Candle).t;
  const histHigh = (bar: number) => (bar >= 0 && bar < n ? (high[bar] as number) : NaN);

  const series = input.series ?? computeSlingshotSeries(candles, p);

  // ===================== Market structure setup =====================
  const msUseHtf = msTfSec > chartTfSec;
  const msBarRatio = Math.trunc(Math.max(1, Math.round(msTfSec / chartTfSec)));
  const htf = input.htfCandles ?? null;
  let msEnabled = true;
  let htfSeries: ReturnType<typeof htfPivotSeries> | null = null;
  let mapHtf: ((open: number, forming: boolean) => number) | null = null;
  if (msUseHtf) {
    if (!htf || htf.length === 0) {
      msEnabled = false;
      warnings.push('HTF_UNAVAILABLE');
    } else {
      htfSeries = htfPivotSeries(htf, p.msSwing);
      mapHtf = makeHtfMapper(htf, msTfSec, chartTfSec);
    }
  }
  const msWinLen = p.msSwing * msBarRatio + 1;
  const msWinHighM = new Extreme(msWinLen, 'max');
  const msWinLowM = new Extreme(msWinLen, 'min');

  const labels = new LabelRegistry();

  // ===================== Global TP state =====================
  let waitingLongTP = false;
  let tpHit = false;
  let tpLabel: number | null = null;
  let longTPHigh = NaN;
  const currentCycleLabel: number | null = null; // never assigned in the Pine script

  // ===================== ATR variables =====================
  let activeLongSignalBar = NaN;
  let activeLongSignalLow = NaN;
  let storedHighestHigh = NaN;
  let storedHighestBar = NaN; // written like in Pine, never read
  let storedTakeProfitAtr = NaN;
  let storedStopLossAtr = NaN;

  // ===================== History tracking =====================
  const activeSignalLabels: number[] = [];
  const activeSignalSLs: number[] = [];
  const activeSignalTPs: number[] = [];
  const activeSignalBreakoutLevels: number[] = [];
  const signalByLabel = new Map<number, SlingshotSignal>();

  // ===================== LONG state =====================
  let bullCandidV1Idx = NaN;
  let bullCandidV1Low = NaN;
  let bullV1Idx = NaN;
  let bullV1Low = NaN;
  let bullDealIdx = NaN;
  let bullNeedNewDeal = true;
  let bullV2Search = false;
  let bullV2BestIdx = NaN;
  let bullV2BestLow = NaN;
  let bullV2Preview: number | null = null;
  let bullTrendIntegrity = false;

  // ===================== Market structure state =====================
  let msSwingHigh = NaN;
  let msSwingHighBar = NaN;
  let msSwingLow = NaN;
  let msSwingLowBar = NaN;
  let msLastPhTime = NaN;
  let msLastPlTime = NaN;
  let msLegHigh = NaN;
  let msLegHighBar = NaN;
  let msLegLow = NaN;
  let msLegLowBar = NaN;
  let msStructUpper = NaN;
  let msStructUpperBar = NaN;
  let msStructLower = NaN;
  let msStructLowerBar = NaN;
  let msPendingUp = false;
  let msPendingDown = false;

  // Per-bar drawings that Pine deletes and recreates each bar.
  let atrLabelTp: number | null = null;
  let atrLabelSl: number | null = null;
  let msHighLabel: number | null = null;
  let msLowLabel: number | null = null;

  let kLine = NaN;
  let isUptrend = false;

  const closeSignal = (labelId: number, outcome: SlingshotSignal['outcome'], reason: SlingshotSignal['outcomeReason'], bar: number) => {
    const s = signalByLabel.get(labelId);
    if (s && s.outcome === 'active') {
      s.outcome = outcome;
      s.outcomeReason = reason;
      s.closedBar = bar;
      s.closedTime = timeOf(bar);
    }
  };

  const getHighestHigh = (i: number, lb: number): [number, number] => {
    let h = histHigh(i - 1);
    let b = i - 1;
    for (let k = 1; k <= lb; k++) {
      const v = histHigh(i - k);
      if (v > h) {
        h = v;
        b = i - k;
      }
    }
    return [h, b];
  };

  for (let i = 0; i < n; i++) {
    const bar = candles[i] as Candle;
    const hi = bar.h;
    const lo = bar.l;
    const cl = bar.c;

    // ===================== Series =====================
    const emaFast = series.emaFast[i] as number;
    const emaSlow = series.emaSlow[i] as number;
    kLine = series.kLine[i] as number;
    const currentAtr = series.atr[i] as number;
    const takeProfitAtrValue = currentAtr * p.takeProfitMultiplier;
    const stopLossAtrValue = currentAtr * p.stopLossMultiplier;

    isUptrend = emaFast > emaSlow;

    const emaUpper = Math.max(emaFast, emaSlow);
    const emaLower = Math.min(emaFast, emaSlow);
    const tol = p.touchTolPct * 0.01;
    const upperTol = emaUpper * (1 + tol);
    const lowerTol = emaLower * (1 - tol);
    const cloudOverlapTol = hi >= lowerTol && lo <= upperTol;
    const cloudTouchLongTol = isUptrend && cloudOverlapTol;

    const kGE80 = kLine >= p.stochOverbought - p.kTol;
    const kLE20 = kLine <= p.stochOversold + p.kTol;

    let alertBuySignal = false;
    let alertTPSignal = false;
    let alertAtrTP = false;
    let alertAtrSL = false;
    let alertMsBull = false;
    let alertMsBear = false;

    // V1 candidate: in uptrend, K ≤ oversold and price touches the cloud
    if (isUptrend && kLine <= p.stochOversold && cloudTouchLongTol) {
      bullCandidV1Idx = i;
      bullCandidV1Low = lo;
    }

    // Lock the deal when K reaches ≥ overbought in uptrend
    if (isUptrend && kGE80) {
      bullDealIdx = i;
      bullV1Idx = bullCandidV1Idx;
      bullV1Low = bullCandidV1Low;
      bullNeedNewDeal = false;
      bullV2Search = false;
      bullV2BestIdx = NaN;
      bullV2BestLow = NaN;
      if (bullV2Preview !== null) labels.delete(bullV2Preview);
      bullV2Preview = null;
      bullTrendIntegrity = true;
    }

    // Invalidate current long cycle if trend flips
    if (!isNa(bullV1Idx) && bullTrendIntegrity && !isUptrend) {
      bullTrendIntegrity = false;
      bullNeedNewDeal = true;
      bullV2Search = false;
      bullV2BestIdx = NaN;
      bullV2BestLow = NaN;
      if (bullV2Preview !== null) labels.delete(bullV2Preview);
      bullV2Preview = null;
      bullV1Idx = NaN;
      bullV1Low = NaN;
      bullDealIdx = NaN;
      // Clear the pending setup; a confirmed signal still waiting for its TP/SL keeps its levels (v3.3)
      if (!waitingLongTP) {
        activeLongSignalBar = NaN;
        activeLongSignalLow = NaN;
        storedHighestHigh = NaN;
        storedHighestBar = NaN;
      }
    }

    let liveSignalLow = NaN;
    let liveSignalBar = NaN;
    let liveSignalActive = false;

    // Start V2 search: new pullback above V1 low, still in uptrend and touching cloud
    if (
      bullTrendIntegrity &&
      !bullNeedNewDeal &&
      !bullV2Search &&
      !isNa(bullDealIdx) &&
      !isNa(bullV1Idx) &&
      isUptrend &&
      kLine <= p.stochOversold &&
      cloudTouchLongTol &&
      i > bullDealIdx &&
      lo > bullV1Low
    ) {
      bullV2Search = true;
      bullV2BestIdx = i;
      bullV2BestLow = lo;
      if (bullV2Preview !== null) labels.delete(bullV2Preview);
      bullV2Preview = labels.create(bullV2BestIdx, 'longPreview', 'tp');
      liveSignalActive = true;
      liveSignalLow = lo;
      liveSignalBar = i;
    }

    // Track the best V2 low while conditions hold
    if (bullV2Search) {
      if (!isUptrend) {
        if (bullV2Preview !== null) labels.delete(bullV2Preview);
        bullV2Search = false;
        bullV2BestIdx = NaN;
        bullV2BestLow = NaN;
        bullTrendIntegrity = false;
        bullNeedNewDeal = true;
        bullV1Idx = NaN;
        bullV1Low = NaN;
        bullDealIdx = NaN;
        // v3.3: keep the levels of a confirmed signal that is still waiting for its TP/SL
        if (!waitingLongTP) {
          activeLongSignalBar = NaN;
          activeLongSignalLow = NaN;
          storedHighestHigh = NaN;
          storedHighestBar = NaN;
        }
      } else if (kLE20) {
        if (lo <= bullV1Low) {
          // The pullback violates the V1 low: cancel the V2 search
          if (bullV2Preview !== null) labels.delete(bullV2Preview);
          bullV2Search = false;
          bullV2BestIdx = NaN;
          bullV2BestLow = NaN;
          // v3.3: keep the levels of a confirmed signal that is still waiting for its TP/SL
          if (!waitingLongTP) {
            activeLongSignalBar = NaN;
            activeLongSignalLow = NaN;
            storedHighestHigh = NaN;
            storedHighestBar = NaN;
          }
        } else {
          if (lo < bullV2BestLow) {
            bullV2BestIdx = i;
            bullV2BestLow = lo;
            if (bullV2Preview !== null) labels.delete(bullV2Preview);
            bullV2Preview = labels.create(bullV2BestIdx, 'longPreview', 'tp');
          }
          liveSignalActive = true;
          liveSignalLow = i === bullV2BestIdx ? lo : bullV2BestLow;
          liveSignalBar = bullV2BestIdx;
        }
      } else {
        // Exit oversold: finalize LONG if V2 is valid above V1 low
        if (bullV2Preview !== null) labels.delete(bullV2Preview);
        if (!isNa(bullV2BestIdx) && bullV2BestLow > bullV1Low && isUptrend) {
          // NEW SIGNAL CONFIRMED — every still-tracked signal turns red
          for (let k = activeSignalLabels.length - 1; k >= 0; k--) {
            const oldLbl = activeSignalLabels[k] as number;
            labels.setColor(oldLbl, 'sl');
            closeSignal(oldLbl, 'invalidated', 'superseded', i);
            activeSignalLabels.splice(k, 1);
            activeSignalSLs.splice(k, 1);
            activeSignalTPs.splice(k, 1);
            activeSignalBreakoutLevels.splice(k, 1);
          }

          const l = labels.create(bullV2BestIdx, 'long', 'tp');
          waitingLongTP = true;
          tpHit = false;
          tpLabel = null;
          longTPHigh = NaN;
          bullNeedNewDeal = true;
          bullTrendIntegrity = false;

          activeLongSignalBar = bullV2BestIdx;
          activeLongSignalLow = bullV2BestLow;
          storedTakeProfitAtr = takeProfitAtrValue;
          storedStopLossAtr = stopLossAtrValue;
          const [h, b] = getHighestHigh(i, p.lookback);
          storedHighestHigh = h;
          storedHighestBar = b;

          alertBuySignal = true;

          const preciseSL = bullV2BestLow - stopLossAtrValue;
          const preciseTP = storedHighestHigh + takeProfitAtrValue;
          activeSignalLabels.push(l);
          activeSignalSLs.push(preciseSL);
          activeSignalTPs.push(preciseTP);
          activeSignalBreakoutLevels.push(storedHighestHigh);
          const sig: SlingshotSignal = {
            bar: bullV2BestIdx,
            time: timeOf(bullV2BestIdx),
            confirmBar: i,
            confirmTime: timeOf(i),
            entryLow: bullV2BestLow,
            sl: preciseSL,
            tp: preciseTP,
            breakout: storedHighestHigh,
            outcome: 'active',
            provisional: isProvisional(i),
          };
          signalByLabel.set(l, sig);
          result.signals.push(sig);
        } else if (!waitingLongTP) {
          activeLongSignalBar = NaN;
          activeLongSignalLow = NaN;
          storedHighestHigh = NaN;
          storedHighestBar = NaN;
        }
        bullV2Search = false;
        bullV2BestIdx = NaN;
        bullV2BestLow = NaN;
      }
    }

    // Full reset of LONG state if trend flips and we are not searching V2
    if (!isUptrend && !bullV2Search && !isNa(bullDealIdx)) {
      bullCandidV1Idx = NaN;
      bullCandidV1Low = NaN;
      bullV1Idx = NaN;
      bullV1Low = NaN;
      bullDealIdx = NaN;
      bullNeedNewDeal = true;
      bullTrendIntegrity = false;
      if (bullV2Preview !== null) labels.delete(bullV2Preview);
      bullV2Preview = null;
      for (let k = activeSignalLabels.length - 1; k >= 0; k--) {
        const oldLbl = activeSignalLabels[k] as number;
        labels.setColor(oldLbl, 'sl');
        closeSignal(oldLbl, 'invalidated', 'trendFlip', i);
        activeSignalLabels.splice(k, 1);
        activeSignalSLs.splice(k, 1);
        activeSignalTPs.splice(k, 1);
        activeSignalBreakoutLevels.splice(k, 1);
      }
    }

    // Take profit logic
    if (waitingLongTP && hi > storedHighestHigh) {
      if (tpLabel === null || hi > longTPHigh) {
        longTPHigh = hi;
        if (tpLabel !== null) labels.setBar(tpLabel, i);
        else tpLabel = labels.create(i, 'takeProfit', 'tp');
      }
      if (!tpHit) alertTPSignal = true;
      tpHit = true;
      // `currentCycleLabel` is never assigned in the Pine script, so its success branch never runs.
      if (currentCycleLabel !== null) {
        const idx = activeSignalLabels.indexOf(currentCycleLabel);
        if (idx !== -1) {
          activeSignalLabels.splice(idx, 1);
          activeSignalSLs.splice(idx, 1);
        }
      }
    }

    // ATR take profit hit
    if (waitingLongTP && hi >= storedHighestHigh + storedTakeProfitAtr) alertAtrTP = true;

    // Stop loss (current signal)
    if (waitingLongTP && lo < activeLongSignalLow - storedStopLossAtr) {
      alertAtrSL = true;
      waitingLongTP = false;
    }

    // History colour update: success first, then stop loss
    for (let k = activeSignalLabels.length - 1; k >= 0; k--) {
      const slPrice = activeSignalSLs[k] as number;
      const tpPrice = activeSignalTPs[k] as number;
      const breakoutPrice = activeSignalBreakoutLevels[k] as number;
      const lbl = activeSignalLabels[k] as number;
      const tpSignalAppeared = hi > breakoutPrice;
      const hitAtrTP = hi >= tpPrice;
      if (tpSignalAppeared || hitAtrTP) {
        closeSignal(lbl, 'tp', tpSignalAppeared ? 'takeProfitSignal' : 'atrTakeProfit', i);
        activeSignalLabels.splice(k, 1);
        activeSignalSLs.splice(k, 1);
        activeSignalTPs.splice(k, 1);
        activeSignalBreakoutLevels.splice(k, 1);
      } else if (lo <= slPrice) {
        labels.setColor(lbl, 'sl');
        closeSignal(lbl, 'sl', 'stopLoss', i);
        activeSignalLabels.splice(k, 1);
        activeSignalSLs.splice(k, 1);
        activeSignalTPs.splice(k, 1);
        activeSignalBreakoutLevels.splice(k, 1);
      }
    }

    // ========== ATR display logic ==========
    let displayTP = NaN;
    let displaySL = NaN;
    let displayBar = NaN;
    let shouldShow = false;
    if (waitingLongTP) {
      if (!p.hideAtrOnTP || !tpHit) {
        displayTP = storedHighestHigh + storedTakeProfitAtr;
        displaySL = activeLongSignalLow - storedStopLossAtr;
        displayBar = activeLongSignalBar;
        shouldShow = true;
      }
    } else if (liveSignalActive) {
      const [h] = getHighestHigh(i, p.lookback);
      displayTP = h + takeProfitAtrValue;
      displaySL = liveSignalLow - stopLossAtrValue;
      displayBar = liveSignalBar;
      shouldShow = true;
    }
    if (waitingLongTP && lo < activeLongSignalLow - storedStopLossAtr && p.hideAtrOnStop) shouldShow = false;

    labels.delete(atrLabelTp);
    labels.delete(atrLabelSl);
    atrLabelTp = null;
    atrLabelSl = null;
    if (shouldShow && p.showLabels) {
      atrLabelTp = labels.create(i + 5, 'atr', 'tp');
      atrLabelSl = labels.create(i + 5, 'atr', 'sl');
    }
    if (i === n - 1) {
      result.atr = shouldShow
        ? {
            tp: displayTP,
            sl: displaySL,
            fromBar: displayBar,
            toBarTp: i + p.atrLineLengthTP,
            toBarSl: i + p.atrLineLengthSL,
            labelBar: i + 5,
            showLines: p.showLines,
            showLabels: p.showLabels,
          }
        : null;
    }

    // ========== Market structure logic ==========
    let msPhHtf = NaN;
    let msPhHtfTime = NaN;
    let msPlHtf = NaN;
    let msPlHtfTime = NaN;
    if (msUseHtf && htfSeries && mapHtf) {
      const j = mapHtf(bar.t, isProvisional(i));
      if (j >= 0) {
        msPhHtf = htfSeries.ph[j] as number;
        msPhHtfTime = htfSeries.phTime[j] as number;
        msPlHtf = htfSeries.pl[j] as number;
        msPlHtfTime = htfSeries.plTime[j] as number;
      }
    }
    const msPhLocal = pivotHighAt(high, i, p.msSwing, p.msSwing);
    const msPlLocal = pivotLowAt(low, i, p.msSwing, p.msSwing);

    let msNewSwingHigh = false;
    let msNewSwingLow = false;
    if (msUseHtf) {
      if (!isNa(msPhHtfTime) && (isNa(msLastPhTime) || msPhHtfTime !== msLastPhTime)) {
        msLastPhTime = msPhHtfTime;
        msSwingHigh = msPhHtf;
        msSwingHighBar = Math.trunc(Math.max(0, i - p.msSwing * msBarRatio));
        msNewSwingHigh = true;
      }
      if (!isNa(msPlHtfTime) && (isNa(msLastPlTime) || msPlHtfTime !== msLastPlTime)) {
        msLastPlTime = msPlHtfTime;
        msSwingLow = msPlHtf;
        msSwingLowBar = Math.trunc(Math.max(0, i - p.msSwing * msBarRatio));
        msNewSwingLow = true;
      }
    } else {
      if (!isNa(msPhLocal)) {
        msSwingHigh = msPhLocal;
        msSwingHighBar = Math.trunc(Math.max(0, i - p.msSwing));
        msNewSwingHigh = true;
      }
      if (!isNa(msPlLocal)) {
        msSwingLow = msPlLocal;
        msSwingLowBar = Math.trunc(Math.max(0, i - p.msSwing));
        msNewSwingLow = true;
      }
    }

    // Running leg extremes
    const winHigh = msWinHighM.next(hi, i);
    const winLow = msWinLowM.next(lo, i);
    const msWinHigh = winHigh.value;
    const msWinHighBar = Math.trunc(Math.max(0, i + winHigh.offset));
    const msWinLow = winLow.value;
    const msWinLowBar = Math.trunc(Math.max(0, i + winLow.offset));

    if (msNewSwingLow || isNa(msLegHigh)) {
      msLegHigh = msWinHigh;
      msLegHighBar = msWinHighBar;
    } else if (hi > msLegHigh) {
      msLegHigh = hi;
      msLegHighBar = i;
    }
    if (msNewSwingHigh || isNa(msLegLow)) {
      msLegLow = msWinLow;
      msLegLowBar = msWinLowBar;
    } else if (lo < msLegLow) {
      msLegLow = lo;
      msLegLowBar = i;
    }

    // The structure: a live range that only ends when price leaves it
    const msRefUp = p.msBreakOnClose ? cl : hi;
    const msRefDown = p.msBreakOnClose ? cl : lo;
    const msBrokeUp = !isNa(msStructUpper) && !msPendingUp && msRefUp > msStructUpper;
    const msBrokeDown = !isNa(msStructLower) && !msPendingDown && msRefDown < msStructLower;

    if (isNa(msStructUpper) || isNa(msStructLower)) {
      if (!isNa(msSwingHigh) && !isNa(msSwingLow) && msSwingHigh > msSwingLow) {
        msStructUpper = msSwingHigh;
        msStructUpperBar = msSwingHighBar;
        msStructLower = msSwingLow;
        msStructLowerBar = msSwingLowBar;
      }
    } else if (msBrokeUp) {
      alertMsBull = true;
      msPendingUp = true;
      msPendingDown = false;
      msStructUpper = hi;
      msStructUpperBar = i;
      msStructLower = msLegLow;
      msStructLowerBar = msLegLowBar;
    } else if (msBrokeDown) {
      alertMsBear = true;
      msPendingDown = true;
      msPendingUp = false;
      msStructLower = lo;
      msStructLowerBar = i;
      msStructUpper = msLegHigh;
      msStructUpperBar = msLegHighBar;
    } else {
      if (hi > msStructUpper) {
        msStructUpper = hi;
        msStructUpperBar = i;
      }
      if (lo < msStructLower) {
        msStructLower = lo;
        msStructLowerBar = i;
      }
    }

    if (msPendingUp && msNewSwingHigh) msPendingUp = false;
    if (msPendingDown && msNewSwingLow) msPendingDown = false;

    // ========== Market structure display ==========
    labels.delete(msHighLabel);
    labels.delete(msLowLabel);
    msHighLabel = null;
    msLowLabel = null;
    const msMinEndUp = isNa(msStructUpperBar) ? 0 : msStructUpperBar + p.msLineLength;
    const msMinEndDn = isNa(msStructLowerBar) ? 0 : msStructLowerBar + p.msLineLength;
    const msRightEdge = Math.trunc(Math.min(Math.max(Math.max(msMinEndUp, msMinEndDn), i + p.msRightExtend), i + 490));
    const showUpper = p.showMS && msEnabled && !isNa(msStructUpper);
    const showLower = p.showMS && msEnabled && !isNa(msStructLower);
    if (showUpper) msHighLabel = labels.create(msRightEdge, 'ms', 'tp');
    if (showLower) msLowLabel = labels.create(msRightEdge, 'ms', 'sl');
    if (i === n - 1) {
      result.ms =
        showUpper || showLower
          ? {
              upper: showUpper ? { price: msStructUpper, fromBar: msStructUpperBar } : null,
              lower: showLower ? { price: msStructLower, fromBar: msStructLowerBar } : null,
              rightEdgeBar: msRightEdge,
            }
          : null;
    }

    // ===================== Plots & alerts =====================
    result.emaFast[i] = emaFast;
    result.emaSlow[i] = emaSlow;
    result.uptrend[i] = isUptrend;

    const pushAlert = (type: AlertType) => result.alerts.push({ bar: i, time: bar.t, type, provisional: isProvisional(i) });
    if (alertBuySignal) pushAlert('longSignal');
    if (alertTPSignal) pushAlert('takeProfitSignal');
    if (alertAtrTP) pushAlert('atrTakeProfit');
    if (alertAtrSL) pushAlert('atrStopLoss');
    if (msEnabled) {
      if (alertMsBull) pushAlert('msBullish');
      if (alertMsBear) pushAlert('msBearish');
    }

    if (i === n - 1) {
      result.last = {
        bar: i,
        uptrend: isUptrend,
        waitingLongTP,
        tpHit,
        liveSignal: liveSignalActive,
        msUpper: msEnabled ? msStructUpper : NaN,
        msLower: msEnabled ? msStructLower : NaN,
        kLine,
      };
    }
  }

  for (const rec of labels.aliveOf(['long', 'longPreview', 'takeProfit'])) {
    result.markers.push({
      id: rec.id,
      bar: rec.bar,
      time: timeOf(Math.min(rec.bar, n - 1)),
      kind: rec.kind as SlingshotMarker['kind'],
      color: rec.color,
      provisional: isProvisional(rec.bar),
    });
  }
  return result;
}
