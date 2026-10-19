// @ts-nocheck
/**
 * Technical Ratings
 *
 * Three ratings in [-1, 1] from 26 indicators (the `calcRatingAll()` function of the TechnicalRating library, with the
 * functions of its ta library, ported here):
 * - MAs: the mean of 15 votes (+1 / 0 / -1): close against the SMA and EMA of 10, 20, 30, 50, 100 and 200 bars, the
 *   HMA 9, the VWMA 20 and the Ichimoku cloud (9 / 26 / 52).
 * - Oscillators: the mean of 11 votes: RSI 14, Stochastic 14 / 3 / 3, CCI 20, ADX 14, Awesome Oscillator, Momentum
 *   10, MACD 12 / 26 / 9, Stochastic RSI 14 / 14 / 3 / 3, Williams %R 14, Bull Bear Power 13 and Ultimate Oscillator
 *   7 / 14 / 28.
 * - All: the mean of the two (the one that exists when the other is na).
 * Votes without data are left out of the means.
 *
 * The rating chosen by 'Rating is based on' is plotted as columns, coloured by a gradient from the sell colours to
 * the buy colours; its opacity counts the bars of rising absolute rating (0 to 5) while the rating is above 0.1 or
 * below -0.1. Four levels at 1, 0.5, -0.5 and -1. A table on the last bar gives the rating states ("Strong Buy" above
 * 0.5, "Buy" above 0.1, "Neutral", "Sell", "Strong Sell", "-" for na) of the indicator timeframe and of up to five
 * other timeframes ('Show MTF'; a timeframe already in the table is shown once). The four alert conditions have no
 * output.
 *
 * Based on the standard Technical Ratings indicator.
 *
 * Timeframes ('Indicator Timeframe' "" is the chart timeframe), as `request.security` without lookahead: the value
 * of a period from the chart bar that completes it, the period before on the other bars. On the open last bar
 * (`chart.lastBarConfirmed` false) the plot and the table show the developing period, as the original after a
 * realtime update (before the first update the original shows the last completed period, as the port does with the
 * last bar closed). 'Plot confirmed ratings only' shows on every bar of a period the value of the period before.
 * - A timeframe above the chart timeframe (indicator timeframe, table rows): the ratings are computed on the host's
 *   bars of the chart symbol on that timeframe (`bars` accessor of the chart context with its ticker id, listed by
 *   `requiredSymbols`; optional, for exactness: the original reads the history of that timeframe) and shown with
 *   `securityOther`. When the accessor gives nothing, on the bars of that timeframe built from the chart bars
 *   (src/anchor-period.ts, with the exchange calendar of the chart context when it has the time zone and the
 *   session): the long averages (200 bars) of a weekly or monthly timeframe then need a long chart history.
 * - An indicator timeframe below the chart timeframe is the runtime error of the original.
 * - A table timeframe below the chart timeframe reads the bars of the chart symbol on that timeframe from the `bars`
 *   accessor (`requiredSymbols`); without them the port throws a MissingSymbolDataError.
 */

import {
  ta, Series, color, array, math, timeframe, mapToChart,
  type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type Bar, type PineSize,
} from 'oakscriptjs';
import type { TableData, TableCellData, TablePosition } from '../types';
import { alertStates, crossedOver, crossedUnder, type AlertConditionDecl, type AlertConditionState } from '../alert-states';
import { chartTimeframe, higherTimeframeBars } from '../anchor-period';
import {
  lastBarConfirmedOf, symbolBarsOf, tickeridOf, type ChartContext, type SymbolRequest,
} from '../chart-context';
import { otherSymbolChart, securityOther, securityOtherValues } from '../other-symbol';

export interface TechnicalsInputs {
  /** Indicator Timeframe ("" = chart timeframe) */
  timeframe: string;
  /** Rating is based on */
  ratingSignal: 'MAs' | 'Oscillators' | 'All';
  /** Plot confirmed ratings only */
  plotConfirmed: boolean;
  useMtf1: boolean;
  mtf1: string;
  useMtf2: boolean;
  mtf2: string;
  useMtf3: boolean;
  mtf3: string;
  useMtf4: boolean;
  mtf4: string;
  useMtf5: boolean;
  mtf5: string;
  /** Table size */
  tableSizeInput: 'tiny' | 'small' | 'normal' | 'large' | 'huge' | 'auto';
  /** Table vertical position */
  tableYPosInput: 'top' | 'middle' | 'bottom';
  /** Table horizontal position */
  tableXPosInput: 'left' | 'center' | 'right';
  colText: string;
  colBuy: string;
  colStrongBuy: string;
  colNeutral: string;
  colSell: string;
  colStrongSell: string;
  tableTitleColor: string;
}

export const defaultInputs: TechnicalsInputs = {
  timeframe: '',
  ratingSignal: 'All',
  plotConfirmed: false,
  useMtf1: false,
  mtf1: '60',
  useMtf2: false,
  mtf2: '240',
  useMtf3: true,
  mtf3: '1D',
  useMtf4: true,
  mtf4: '1W',
  useMtf5: true,
  mtf5: '1M',
  tableSizeInput: 'small',
  tableYPosInput: 'middle',
  tableXPosInput: 'right',
  colText: '#ffffff',
  colBuy: '#5b9cf6',
  colStrongBuy: '#2962ff',
  colNeutral: '#a8adbc',
  colSell: '#ef9a9a',
  colStrongSell: '#f44336',
  tableTitleColor: '#295b79',
};

const PC_TT = "If enabled and the indicator's timeframe is higher than the chart's, the plotted rating and alert "
  + 'conditions update only after a bar on that timeframe is confirmed. Otherwise, they also update during open bars on '
  + 'the timeframe. Does not affect the table display.';
const GRP1 = 'Show MTF';
const GRP2 = 'Table Settings';

export const inputConfig: InputConfig[] = [
  { id: 'timeframe', type: 'timeframe', title: 'Indicator Timeframe', defval: '' },
  { id: 'ratingSignal', type: 'string', title: 'Rating is based on', defval: 'All', options: ['MAs', 'Oscillators', 'All'] },
  { id: 'plotConfirmed', type: 'bool', title: 'Plot confirmed ratings only', defval: false, tooltip: PC_TT, display: 'none' },
  { id: 'useMtf1', type: 'bool', title: '', defval: false, inline: 'mtf1', group: GRP1, display: 'none' },
  { id: 'mtf1', type: 'timeframe', title: '', defval: '60', inline: 'mtf1', group: GRP1, active: 'useMtf1' },
  { id: 'useMtf2', type: 'bool', title: '', defval: false, inline: 'mtf2', group: GRP1, display: 'none' },
  { id: 'mtf2', type: 'timeframe', title: '', defval: '240', inline: 'mtf2', group: GRP1, active: 'useMtf2' },
  { id: 'useMtf3', type: 'bool', title: '', defval: true, inline: 'mtf3', group: GRP1, display: 'none' },
  { id: 'mtf3', type: 'timeframe', title: '', defval: '1D', inline: 'mtf3', group: GRP1, active: 'useMtf3' },
  { id: 'useMtf4', type: 'bool', title: '', defval: true, inline: 'mtf4', group: GRP1, display: 'none' },
  { id: 'mtf4', type: 'timeframe', title: '', defval: '1W', inline: 'mtf4', group: GRP1, active: 'useMtf4' },
  { id: 'useMtf5', type: 'bool', title: '', defval: true, inline: 'mtf5', group: GRP1, display: 'none' },
  { id: 'mtf5', type: 'timeframe', title: '', defval: '1M', inline: 'mtf5', group: GRP1, active: 'useMtf5' },
  { id: 'tableSizeInput', type: 'string', title: 'Size      ', defval: 'small', options: ['tiny', 'small', 'normal', 'large', 'huge', 'auto'], inline: 'Table Size', group: GRP2 },
  { id: 'tableYPosInput', type: 'string', title: 'Position ', defval: 'middle', options: ['top', 'middle', 'bottom'], inline: 'Table Pos', group: GRP2 },
  { id: 'tableXPosInput', type: 'string', title: '', defval: 'right', options: ['left', 'center', 'right'], inline: 'Table Pos', group: GRP2 },
  { id: 'colText', type: 'color', title: 'Text     ', defval: '#ffffff', inline: 'Text Color', group: GRP2 },
  { id: 'colBuy', type: 'color', title: 'Buy  ', defval: '#5b9cf6', inline: 'Buy Colors', group: GRP2 },
  { id: 'colStrongBuy', type: 'color', title: '', defval: '#2962ff', inline: 'Buy Colors', group: GRP2 },
  { id: 'colNeutral', type: 'color', title: 'Neutral  ', defval: '#a8adbc', inline: 'Neutral', group: GRP2 },
  { id: 'colSell', type: 'color', title: 'Sell  ', defval: '#ef9a9a', inline: 'Sell Colors', group: GRP2 },
  { id: 'colStrongSell', type: 'color', title: '', defval: '#f44336', inline: 'Sell Colors', group: GRP2 },
  { id: 'tableTitleColor', type: 'color', title: 'Headers', defval: '#295b79', inline: 'Headers', group: GRP2 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Rating (indicator timeframe)', color: '#2962ff', lineWidth: 1, style: 'columns', histbase: 0 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_1', price: 1, title: 'Level', color: '#5B9CF680', linestyle: 'solid', linewidth: 1 },
  { id: 'hline_05', price: 0.5, title: 'Level', color: '#5B9CF680', linestyle: 'dashed', linewidth: 1 },
  { id: 'hline_m1', price: -1, title: 'Level', color: '#EF9A9A80', linestyle: 'solid', linewidth: 1 },
  { id: 'hline_m05', price: -0.5, title: 'Level', color: '#EF9A9A80', linestyle: 'dashed', linewidth: 1 },
];

export const metadata = {
  title: 'Technical Ratings',
  shortTitle: 'Technicals',
  overlay: false,
};

const LEVEL_STRONG = 0.5;
const LEVEL_WEAK = 0.1;

/** Pine float comparisons: a > b only when a - b > 1e-10 (na compares false) */
const EPS = 1e-10;
const gt = (a: number, b: number) => a - b > EPS;
const lt = (a: number, b: number) => b - a > EPS;
const ge = (a: number, b: number) => !isNaN(a) && !isNaN(b) && !(b - a > EPS);
const eq = (a: number, b: number) => !isNaN(a) && !isNaN(b) && Math.abs(a - b) <= EPS;
/** na() of Pine: na and +-infinity */
const isNa = (v: number) => !Number.isFinite(v);
/** nz() of Pine */
const nz = (v: number) => (isNa(v) ? 0 : v);

/** Value `k` bars back (na before the first bar) */
const back = (arr: number[], i: number, k: number) => (i - k >= 0 ? arr[i - k] : NaN);

interface Ratings {
  total: number[];
  other: number[];
  ma: number[];
}

/** `calcRatingAll()` of the TechnicalRating library on the given bars: [ratingTotal, ratingOther, ratingMA] */
function calcRatingAll(bars: Bar[]): Ratings {
  const n = bars.length;
  const A = (s: Series) => s.toArray().map((v) => v ?? NaN);
  const close = new Series(bars, (b) => b.close);
  const high = new Series(bars, (b) => b.high);
  const low = new Series(bars, (b) => b.low);
  const closeArr = bars.map((b) => b.close);

  // ta library: ichimoku() with its default lengths, midpoint(len) = avg(highest(high, len), lowest(low, len))
  const midpoint = (len: number) => {
    const hh = A(ta.highest(high, len));
    const ll = A(ta.lowest(low, len));
    return hh.map((h, i) => (h + ll[i]) / 2);
  };
  const con = midpoint(9);
  const base = midpoint(26);
  const lead1 = con.map((c, i) => (c + base[i]) / 2);
  const lead2 = midpoint(52);
  // stochFull(14, 3, 3)
  const kStoch = A(ta.sma(ta.stoch(close, high, low, 14), 3));
  const dStoch = A(ta.sma(Series.fromArray(bars, kStoch), 3));
  // stochRsi(14, 14, 3, 3)
  const rsiS = ta.rsi(close, 14);
  const kStochRsi = A(ta.sma(ta.stoch(rsiS, rsiS, rsiS, 14), 3));
  const dStochRsi = A(ta.sma(Series.fromArray(bars, kStochRsi), 3));
  const [diPS, diNS, adxS] = ta.dmi(bars, 14, 14);
  const diP = A(diPS);
  const diN = A(diNS);
  const adx = A(adxS);
  const [macdS, signalS] = ta.macd(close, 12, 26, 9);
  const macd = A(macdS);
  const signal = A(signalS);
  const ema13 = A(ta.ema(close, 13));
  const bullPower = bars.map((b, i) => b.high - ema13[i]);
  const bearPower = bars.map((b, i) => b.low - ema13[i]);
  const rsi = A(rsiS);
  const cci = A(ta.cci(close, 20));
  const mom = A(ta.mom(close, 10));
  const priceAvg = A(ta.ema(close, 50));
  // uo(7, 14, 28): 100 * (4 * avg7 + 2 * avg14 + avg28) / 7, avgN = sum(bp, N) / sum(tr, N)
  const tMin = bars.map((b, i) => Math.min(b.low, back(closeArr, i, 1)));
  const tMax = bars.map((b, i) => Math.max(b.high, back(closeArr, i, 1)));
  const trS = Series.fromArray(bars, tMax.map((v, i) => v - tMin[i]));
  const bpS = Series.fromArray(bars, closeArr.map((c, i) => c - tMin[i]));
  const uoAverage = (len: number) => {
    const bp = A(math.sum(bpS, len));
    const tr = A(math.sum(trS, len));
    return bp.map((v, i) => v / tr[i]);
  };
  const avg1 = uoAverage(7);
  const avg2 = uoAverage(14);
  const avg3 = uoAverage(28);
  const uo = avg1.map((v, i) => (100 * (4 * v + 2 * avg2[i] + avg3[i])) / 7);
  const wr = A(ta.wpr(bars, 14));
  // ao(): sma(hl2, 5) - sma(hl2, 34)
  const hl2 = new Series(bars, (b) => (b.high + b.low) / 2);
  const aoSlow = A(ta.sma(hl2, 34));
  const ao = A(ta.sma(hl2, 5)).map((v, i) => v - aoSlow[i]);
  const aoS = Series.fromArray(bars, ao);
  const aoCrossUp = ta.crossover(aoS, 0).toArray();
  const aoCrossDn = ta.crossunder(aoS, 0).toArray();

  const maSeries = [10, 20, 30, 50, 100, 200].map((len) => A(ta.sma(close, len)))
    .concat([10, 20, 30, 50, 100, 200].map((len) => A(ta.ema(close, len))))
    .concat([A(ta.hma(close, 9)), A(ta.vwma(close, 20, new Series(bars, (b) => b.volume ?? NaN)))]);

  /** calcRating(src, bullCond, bearCond) */
  const calcRating = (src: number, bull: boolean, bear: boolean) => (isNa(src) ? NaN : bull ? 1 : bear ? -1 : 0);

  const total: number[] = [];
  const other: number[] = [];
  const ma: number[] = [];
  const indRatings = array.new_float(0);
  for (let i = 0; i < n; i++) {
    const c = closeArr[i];
    array.clear(indRatings);
    // calcRatingMA(ma, close) = math.sign(close - ma)
    for (const s of maSeries) array.push(indRatings, Math.sign(c - s[i]));
    const l1 = back(lead1, i, 26);
    const l2 = back(lead2, i, 26);
    array.push(indRatings, calcRating(lead2[i],
      gt(l1, l2) && gt(base[i], l1) && gt(con[i], base[i]) && gt(c, con[i]),
      lt(l1, l2) && lt(base[i], l1) && lt(con[i], base[i]) && lt(c, con[i])));
    const ratingMA = array.avg(indRatings);

    array.clear(indRatings);
    const rsi1 = back(rsi, i, 1);
    array.push(indRatings, calcRating(rsi1, lt(rsi[i], 30) && lt(rsi1, rsi[i]), gt(rsi[i], 70) && gt(rsi1, rsi[i])));
    array.push(indRatings, calcRating(back(dStoch, i, 1),
      lt(kStoch[i], 20) && lt(dStoch[i], 20) && gt(kStoch[i], dStoch[i]),
      gt(kStoch[i], 80) && gt(dStoch[i], 80) && lt(kStoch[i], dStoch[i])));
    const cci1 = back(cci, i, 1);
    array.push(indRatings, calcRating(cci1, lt(cci[i], -100) && gt(cci[i], cci1), gt(cci[i], 100) && lt(cci[i], cci1)));
    const adx1 = back(adx, i, 1);
    array.push(indRatings, calcRating(adx[i],
      gt(adx[i], 20) && gt(adx[i], adx1) && gt(diP[i], diN[i]),
      gt(adx[i], 20) && gt(adx[i], adx1) && lt(diP[i], diN[i])));
    const ao0 = ao[i];
    const ao1 = back(ao, i, 1);
    const ao2 = back(ao, i, 2);
    array.push(indRatings, calcRating(ao1,
      !!aoCrossUp[i] || (gt(ao0, 0) && gt(ao1, 0) && gt(ao0, ao1) && gt(ao2, ao1)),
      !!aoCrossDn[i] || (lt(ao0, 0) && lt(ao1, 0) && lt(ao0, ao1) && lt(ao2, ao1))));
    const mom1 = back(mom, i, 1);
    array.push(indRatings, calcRating(mom1, gt(mom[i], mom1), lt(mom[i], mom1)));
    array.push(indRatings, calcRating(signal[i], gt(macd[i], signal[i]), lt(macd[i], signal[i])));
    const downTrend = lt(c, priceAvg[i]);
    const upTrend = gt(c, priceAvg[i]);
    array.push(indRatings, calcRating(priceAvg[i],
      downTrend && lt(kStochRsi[i], 20) && lt(dStochRsi[i], 20) && gt(kStochRsi[i], dStochRsi[i]),
      upTrend && gt(kStochRsi[i], 80) && gt(dStochRsi[i], 80) && lt(kStochRsi[i], dStochRsi[i])));
    const wr1 = back(wr, i, 1);
    array.push(indRatings, calcRating(wr1, lt(wr[i], -80) && gt(wr[i], wr1), gt(wr[i], -20) && lt(wr[i], wr1)));
    array.push(indRatings, calcRating(priceAvg[i],
      upTrend && lt(bearPower[i], 0) && gt(bearPower[i], back(bearPower, i, 1)),
      downTrend && gt(bullPower[i], 0) && lt(bullPower[i], back(bullPower, i, 1))));
    array.push(indRatings, calcRating(uo[i], gt(uo[i], 70), lt(uo[i], 30)));
    const ratingOther = array.avg(indRatings);

    const sum = nz(ratingMA) + nz(ratingOther);
    total.push(!isNa(ratingMA) && !isNa(ratingOther) ? sum / 2 : !isNa(ratingMA) || !isNa(ratingOther) ? sum : NaN);
    other.push(ratingOther);
    ma.push(ratingMA);
  }
  return { total, other, ma };
}

/** `ratingStatus()` of the TechnicalRating library (strong bound 0.5, weak bound 0.1) */
function ratingStatus(v: number): string {
  if (isNa(v)) return '-';
  if (lt(v, -LEVEL_STRONG)) return 'Strong\nSell';
  if (lt(v, -LEVEL_WEAK)) return 'Sell';
  if (gt(v, LEVEL_STRONG)) return 'Strong\nBuy ';
  if (gt(v, LEVEL_WEAK)) return 'Buy';
  return 'Neutral';
}

/** `countRising()` of the TechnicalRating library (one state per call) */
function countRising(): (plot: number) => number {
  let result = 0;
  let prev = NaN;
  return (plot: number) => {
    const v = Math.abs(plot);
    // switch without a default: na when no case matches
    result = eq(v, 0) ? 0 : ge(v, prev) ? Math.min(5, result + 1) : lt(v, prev) ? Math.max(1, result - 1) : NaN;
    prev = v;
    return result;
  };
}

/** Normalised timeframe string ("D" -> "1D"); "" stays "" */
const tfKey = (tf: string) => (tf.trim() === '' ? '' : timeframe.info(tf).period);

/** The timeframes of the table and whether each is shown, after the check for duplicates of the original */
function tableTimeframes(cfg: TechnicalsInputs, currentTf: string): { timeframes: string[]; enabled: boolean[] } {
  const timeframes = ['TF', currentTf, cfg.mtf1, cfg.mtf2, cfg.mtf3, cfg.mtf4, cfg.mtf5];
  const enabled = [true, true, cfg.useMtf1, cfg.useMtf2, cfg.useMtf3, cfg.useMtf4, cfg.useMtf5];
  for (let i = 1; i < enabled.length; i++) {
    if (!enabled[i]) continue;
    for (let j = 0; j < i; j++) {
      if (!enabled[j]) continue;
      if (timeframes[j] === timeframes[i]) {
        enabled[i] = false;
        break;
      }
    }
  }
  return { timeframes, enabled };
}

/** The table timeframes below (`lower`) or above the chart timeframe, each once */
function tableTimeframesBy(cfg: TechnicalsInputs, currentTf: string, chartTf: string, lower: boolean): string[] {
  if (chartTf === '') return [];
  const chartSeconds = timeframe.in_seconds(chartTf);
  const { timeframes, enabled } = tableTimeframes(cfg, currentTf);
  const out: string[] = [];
  for (let i = 1; i < timeframes.length; i++) {
    const tf = timeframes[i];
    if (!enabled[i] || tf.trim() === '') continue;
    const seconds = timeframe.in_seconds(tf);
    if (lower ? seconds >= chartSeconds : seconds <= chartSeconds) continue;
    if (!out.some((t) => tfKey(t) === tfKey(tf))) out.push(tf);
  }
  return out;
}

/** The table timeframes below the chart timeframe (bars from the `bars` accessor of the chart context, needed) */
function lowerTimeframes(cfg: TechnicalsInputs, currentTf: string, chartTf: string): string[] {
  return tableTimeframesBy(cfg, currentTf, chartTf, true);
}

/**
 * The timeframes above the chart timeframe (indicator timeframe and table rows): bars from the `bars` accessor of
 * the chart context when it gives them (optional), else built from the chart bars
 */
function higherTimeframes(cfg: TechnicalsInputs, currentTf: string, chartTf: string): string[] {
  return tableTimeframesBy(cfg, currentTf, chartTf, false);
}

/**
 * Bars of the chart symbol (ticker id of the chart context) that the inputs read from the `bars` accessor; needs
 * `chart.timeframe` to know them:
 * - the timeframes above the chart timeframe (indicator timeframe, table rows): optional, for exactness (the
 *   original reads the history of that timeframe); without them the port builds the bars from the chart bars
 * - the table timeframes below the chart timeframe: needed (none with the default inputs on charts of 1 day or less)
 */
export function requiredSymbols(inputs: Partial<TechnicalsInputs> = {}, chart?: ChartContext): SymbolRequest[] {
  const cfg = { ...defaultInputs, ...inputs };
  const chartTf = chart?.timeframe ? timeframe.info(chart.timeframe).period : '';
  const currentTf = cfg.timeframe.trim() === '' ? chartTf : cfg.timeframe;
  const symbol = tickeridOf(chart);
  const higher = symbol === '' ? [] : higherTimeframes(cfg, currentTf, chartTf);
  return [...higher, ...lowerTimeframes(cfg, currentTf, chartTf)].map((tf) => ({ symbol, timeframe: tf }));
}

/** Reference alertconditions: crosses of the rating the plot shows (`userRating`) over the levels */
export const alertConditions: AlertConditionDecl[] = [
  { id: 'alert0', title: 'Sell', message: 'Ratings changed to "Sell"' },
  { id: 'alert1', title: 'Buy', message: 'Ratings changed to "Buy"' },
  { id: 'alert2', title: 'Strong Sell', message: 'Ratings changed to "Strong Sell"' },
  { id: 'alert3', title: 'Strong Buy', message: 'Ratings changed to "Strong Buy"' },
];

export function calculate(
  bars: Bar[],
  inputs: Partial<TechnicalsInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { tables: TableData[]; alerts: AlertConditionState[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const live = !lastBarConfirmedOf(chart);

  // timeframe.period and the indicator timeframe
  const chartTf = chartTimeframe(bars, chart);
  const chartSeconds = chartTf === '' ? NaN : timeframe.in_seconds(chartTf);
  const currentTf = cfg.timeframe.trim() === '' ? chartTf : cfg.timeframe;
  const currentSeconds = currentTf === '' ? chartSeconds : timeframe.in_seconds(currentTf);
  if (n > 0 && currentSeconds < chartSeconds) {
    throw new Error(`Cannot plot ratings for all bars from the '${currentTf}' timeframe on the current chart. Select a higher timeframe.`);
  }

  // request.security("", tf, ...) of the ratings: one computation per timeframe
  const chartRatings = calcRatingAll(bars);
  // a higher timeframe: the host's bars of the chart symbol when the accessor gives them (mapped with securityOther),
  // else the bars built from the chart bars (group / latest of higherTimeframeBars)
  const symbol = tickeridOf(chart);
  const calendar = chart?.symbolInfo?.(symbol) ?? (chart?.timezone ? { timezone: chart.timezone, session: chart.session } : undefined);
  interface Higher { r: Ratings; host?: Bar[]; group: number[]; latest: number[] }
  const higher = new Map<string, Higher>();
  const higherOf = (tf: string): Higher => {
    const key = tfKey(tf);
    let h = higher.get(key);
    if (!h) {
      const host = symbol === '' ? undefined : chart?.bars?.(symbol, tf);
      if (host && host.length > 0) {
        h = { r: calcRatingAll(host), host, group: [], latest: [] };
      } else {
        const sec = higherTimeframeBars(bars, tf, chart);
        h = { r: calcRatingAll(sec.htf), group: sec.group, latest: sec.latest };
      }
      higher.set(key, h);
    }
    return h;
  };
  /** index of the higher-timeframe bar shown on each chart bar by request.security (-1: na) */
  const shownOf = (tf: string, h: Higher, lookahead: boolean): number[] =>
    securityOther(bars, h.host!, tf, otherSymbolChart(bars, chart), { lookahead, other: calendar });
  const isChartTf = (tf: string) => tf.trim() === '' || tfKey(tf) === tfKey(chartTf) || timeframe.in_seconds(tf) === chartSeconds;

  // the plot: request.security("", currentTf, [rt, ro, rma]) or, confirmed only on a higher timeframe,
  // request.security("", currentTf, [rt[1], ro[1], rma[1]], lookahead_on)
  let plotTotal: number[];
  let plotOsc: number[];
  let plotMA: number[];
  if (isChartTf(currentTf) || n === 0) {
    ({ total: plotTotal, other: plotOsc, ma: plotMA } = chartRatings);
  } else {
    const h = higherOf(currentTf);
    const { r, group, latest } = h;
    const confirmed = cfg.plotConfirmed && currentSeconds > chartSeconds;
    const shown = h.host ? shownOf(currentTf, h, confirmed) : null;
    const toChart = (values: number[]) => {
      if (shown) return shown.map((k) => (confirmed ? (k > 0 ? values[k - 1] : NaN) : k >= 0 ? values[k] : NaN));
      if (confirmed) return mapToChart(values.map((_v, g) => (g > 0 ? values[g - 1] : NaN)), group, latest, true, false);
      const out = mapToChart(values, group, latest, false, false);
      // the open last bar shows the developing period
      if (live) out[n - 1] = values[group[n - 1]];
      return out;
    };
    plotTotal = toChart(r.total);
    plotOsc = toChart(r.other);
    plotMA = toChart(r.ma);
  }
  const userRating = cfg.ratingSignal === 'MAs' ? plotMA : cfg.ratingSignal === 'Oscillators' ? plotOsc : plotTotal;

  const risingBuys = countRising();
  const fallingSells = countRising();
  const plot0: Array<{ time: number; value: number; color: string }> = [];
  for (let i = 0; i < n; i++) {
    const u = userRating[i];
    const condBuy = gt(u, LEVEL_WEAK);
    const condSell = lt(u, -LEVEL_WEAK);
    const rb = risingBuys(condBuy ? u : 0);
    const fs = fallingSells(condSell ? u : 0);
    const gradientLvl = condBuy ? rb : condSell ? fs : 0;
    const buyColor = color.from_gradient(u, 0, 0.2, cfg.colNeutral, cfg.colStrongBuy);
    const sellColor = color.from_gradient(u, -0.2, 0, cfg.colStrongSell, cfg.colNeutral);
    const gradColor = color.from_gradient(u, -0.2, 0.2, sellColor, buyColor);
    plot0.push({
      time: bars[i].time,
      value: Number.isFinite(u) ? u : NaN,
      color: String(color.new(gradColor, 50 - gradientLvl * 10)),
    });
  }

  // the table, filled on the last bar
  const tables: TableData[] = [];
  if (n > 0) {
    const { timeframes, enabled } = tableTimeframes(cfg, currentTf);
    const last = n - 1;
    // lower timeframes of the table: bars of the chart symbol from the accessor of the chart context
    const lower = lowerTimeframes(cfg, currentTf, chartTf);
    const lowerBars = lower.length
      ? symbolBarsOf(lower.map((tf) => ({ symbol: tickeridOf(chart), timeframe: tf })), chart)
      : [];
    /** [total, osc, ma] statuses of request.security("", tf, [ratingStatus(...) x 3]) on the last bar */
    const statusesOf = (tf: string): [string, string, string] => {
      const st = (r: Ratings, k: number) => (k < 0 ? null : [ratingStatus(r.total[k]), ratingStatus(r.other[k]), ratingStatus(r.ma[k])]);
      let res: string[] | null;
      const li = lower.findIndex((t) => tfKey(t) === tfKey(tf));
      if (li >= 0) {
        const lb = lowerBars[li];
        const r = calcRatingAll(lb);
        const idx = securityOtherValues(bars, lb, tf, lb.map((_b, k) => k), otherSymbolChart(bars, chart),
          { other: chart?.timezone ? { timezone: chart.timezone, session: chart.session } : undefined });
        res = st(r, Number.isNaN(idx[last]) ? -1 : idx[last]);
      } else if (isChartTf(tf)) {
        res = st(chartRatings, last);
      } else {
        const h = higherOf(tf);
        // host bars: lookahead off (the library shows the developing bar on the open last bar)
        res = st(h.r, h.host ? shownOf(tf, h, false)[last] : live ? h.group[last] : h.latest[last]);
      }
      // na strings before the first completed period
      return res ? [res[0], res[1], res[2]] : ['', '', ''];
    };

    const bg = (status: string) => {
      switch (status) {
        case 'Sell': return cfg.colSell;
        case 'Strong\nSell': return cfg.colStrongSell;
        case 'Buy': return cfg.colBuy;
        case 'Strong\nBuy ': return cfg.colStrongBuy;
        case 'Neutral': return cfg.colNeutral;
        case '-': return cfg.colNeutral;
        default: return cfg.tableTitleColor;
      }
    };
    const align = (text: string): 'center' | 'left' =>
      (text === 'MAs' || text === 'Osc' || text === 'All' || text === '-' ? 'center' : 'left');
    const textSize = cfg.tableSizeInput as PineSize;
    const cells: TableCellData[] = [];
    const addCell = (column: number, row: number, text: string) => {
      cells.push({
        column, row, text, textColor: cfg.colText, textHAlign: align(text), textVAlign: 'center',
        bgColor: bg(text), textSize,
      });
    };
    let row = 0;
    for (let i = 0; i < enabled.length; i++) {
      if (!enabled[i]) continue;
      const [all, osc, mas] = i === 0 ? ['All', 'Osc', 'MAs'] : statusesOf(timeframes[i]);
      addCell(0, row, timeframes[i]);
      if (cfg.ratingSignal === 'All') {
        addCell(1, row, mas);
        addCell(2, row, osc);
        addCell(3, row, all);
      } else if (cfg.ratingSignal === 'Oscillators') {
        addCell(1, row, osc);
      } else if (cfg.ratingSignal === 'MAs') {
        addCell(1, row, mas);
      }
      row += 1;
    }
    tables.push({
      position: `${cfg.tableYPosInput}_${cfg.tableXPosInput}` as TablePosition,
      columns: 4,
      rows: 7,
      cells,
      frameColor: '#ffffff',
      frameWidth: 2,
      borderColor: '#ffffff',
      borderWidth: 1,
    });
  }

  const hlines: NonNullable<IndicatorResult['hlines']> = [
    { value: 1, options: { title: 'Level', color: String(color.new(cfg.colBuy, 50)), linestyle: 'solid', linewidth: 1 } },
    { value: 0.5, options: { title: 'Level', color: String(color.new(cfg.colBuy, 50)), linestyle: 'dashed', linewidth: 1 } },
    { value: -1, options: { title: 'Level', color: String(color.new(cfg.colSell, 50)), linestyle: 'solid', linewidth: 1 } },
    { value: -0.5, options: { title: 'Level', color: String(color.new(cfg.colSell, 50)), linestyle: 'dashed', linewidth: 1 } },
  ];

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: { plot0 },
    hlines,
    tables,
    alerts: alertStates(alertConditions, bars, [
      crossedUnder(userRating, -LEVEL_WEAK),
      crossedOver(userRating, LEVEL_WEAK),
      crossedUnder(userRating, -LEVEL_STRONG),
      crossedOver(userRating, LEVEL_STRONG),
    ]),
  };
}

export const TechnicalRatingsStandard = {
  calculate, metadata, defaultInputs, inputConfig, plotConfig, hlineConfig, requiredSymbols, alertConditions,
};
