// @ts-nocheck
/**
 * Multi-Time Period Charts (MTPC)
 *
 * Draws the bars of a higher timeframe over the chart as boxes: each finished period gets a box from its first to
 * its last chart bar, and the period still running on the last bar gets a box that grows with it. Up periods
 * (close >= open) use the up colours, down periods the down colours. The box covers:
 * - High/Low Range: high to low of the period
 * - Open/Close Range: close to open
 * - OHLC: high to low, with a second box from open to close (the body)
 * - True Range: high (or the previous close when higher) to low (or the previous close when lower)
 * With Auto-timeframe the period is 2 hours on seconds charts, 1440 minutes on intraday charts, 1 week on daily
 * charts, 1 month on weekly charts, 3 months on monthly charts and 12 months above. "Display Heikin Ashi values"
 * draws the Heikin Ashi bars of the periods.
 *
 * Based on the standard Multi-Time Period Charts indicator.
 *
 * By default the periods are built from the chart bars (`timeframe.change`); "Use daily-based values" takes the
 * bars of the higher timeframe (request.security with lookahead), which the port builds from the chart bars too
 * (see src/anchor-period.ts): exact where the higher-timeframe bars equal the chart bars put together (24x7
 * symbols); on stocks the official daily values differ from the intraday bars, so the port can differ there. The
 * periods follow the exchange time zone and session of the chart context (third argument of calculate); without
 * them the UTC calendar of the bars. A Timeframe below the chart timeframe with "Use daily-based values" needs
 * lower-timeframe bars: the port throws an Error.
 */

import {
  box, timeframe as pineTimeframe, heikinAshi, resetDrawings, setDrawingBar, varDrawing, drawingOutputs,
  type Bar, type Box, type IndicatorResult, type InputConfig, type PlotConfig,
} from 'oakscriptjs';
import { chartTimeframe, higherTimeframeBars, periodChanges } from '../anchor-period';
import type { ChartContext } from '../chart-context';

export type MtpcCalcType = 'High/Low Range' | 'Open/Close Range' | 'OHLC' | 'True Range';

export interface MultiTimePeriodChartsInputs {
  /** Choose the higher timeframe from the chart timeframe */
  autoTF: boolean;
  /** Higher timeframe when Auto-timeframe is off */
  tf: string;
  calcType: MtpcCalcType;
  /** Heikin Ashi values of the periods */
  useHa: boolean;
  /** Bars of the higher timeframe (request.security) instead of the chart bars */
  useDaily: boolean;
  upBorderColor: string;
  upBodyColor: string;
  dnBorderColor: string;
  dnBodyColor: string;
}

export const defaultInputs: MultiTimePeriodChartsInputs = {
  autoTF: true,
  tf: '1M',
  calcType: 'High/Low Range',
  useHa: false,
  useDaily: false,
  upBorderColor: '#009688',
  upBodyColor: 'rgba(0, 150, 136, 0.3)',
  dnBorderColor: '#F44336',
  dnBodyColor: 'rgba(244, 67, 54, 0.3)',
};

const TT_AT = "If selected, the indicator automatically chooses the timeframe of the displayed bars. The chosen higher timeframe is:\n\n"
  + " • '2 hours' if the chart timeframe is a seconds-based timeframe.\n"
  + " • '1 day' if the chart timeframe is lower than one day and not a seconds-based timeframe.\n"
  + " • '1 week' if the chart timeframe is higher than one day and lower than one week.\n"
  + " • '1 month' if the chart timeframe is higher than one week and lower than one month.\n"
  + " • '3 months' if the chart timeframe is higher than one month and lower than three months.\n"
  + " • '12 months' if the chart timeframe is higher than three months. \n\n"
  + "If not selected, it uses the timeframe specified in the 'Timeframe' input.";

const TT_UC = 'When this option is unchecked, MTPC will use intraday data while calculating on intraday charts.'
  + ' If Extended Hours are displayed on the chart, they will be taken into account during the calculation.'
  + ' If intraday OHLC values are different from daily-based values (normal for stocks), the MTPC will also differ.';

const GRP01 = 'Border and fill colors';

export const inputConfig: InputConfig[] = [
  { id: 'autoTF', type: 'bool', title: 'Auto-timeframe', defval: true, tooltip: TT_AT, display: 'none' },
  { id: 'tf', type: 'timeframe', title: 'Timeframe', defval: '1M', active: { not: 'autoTF' } },
  { id: 'calcType', type: 'string', title: 'Calculation', defval: 'High/Low Range', options: ['High/Low Range', 'Open/Close Range', 'OHLC', 'True Range'] },
  { id: 'useHa', type: 'bool', title: 'Display Heikin Ashi values', defval: false, display: 'none' },
  { id: 'useDaily', type: 'bool', title: 'Use daily-based values', defval: false, tooltip: TT_UC, display: 'none' },
  { id: 'upBorderColor', type: 'color', title: 'Up bars  ', defval: '#009688', inline: '10', group: GRP01 },
  { id: 'upBodyColor', type: 'color', title: '', defval: 'rgba(0, 150, 136, 0.3)', inline: '10', group: GRP01 },
  { id: 'dnBorderColor', type: 'color', title: 'Down bars', defval: '#F44336', inline: '11', group: GRP01 },
  { id: 'dnBodyColor', type: 'color', title: '', defval: 'rgba(244, 67, 54, 0.3)', inline: '11', group: GRP01 },
];

// No plots: boxes
export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Multi-Time Period Charts',
  shortTitle: 'MTPC',
  overlay: true,
};

/** indicator(max_boxes_count = 500) */
const MAX_BOXES = 500;

/** OHLC type of the original: a higher-timeframe bar and the close before it */
interface OHLC {
  o: number;
  h: number;
  l: number;
  c: number;
  prevC: number;
}

const NA_OHLC: OHLC = { o: NaN, h: NaN, l: NaN, c: NaN, prevC: NaN };

/** Pine float comparison: a < b when b - a > 1e-10 (na compares false) */
const lt = (a: number, b: number) => b - a > 1e-10;

/** selectAutoTimeframe() */
function selectAutoTimeframe(chartTf: string): string {
  const info = pineTimeframe.info(chartTf);
  const secondsInTF = pineTimeframe.in_seconds(chartTf);
  if (info.isseconds) return '120';
  if (secondsInTF < 86400) return '1440';
  if (secondsInTF < 604800) return '1W';
  if (secondsInTF < 2628003) return '1M';
  if (secondsInTF < 7884009) return '3M';
  return '12M';
}

/** chartOHLC(tf, useHA) on every bar: the higher-timeframe bar built from the chart bars so far */
function chartOHLC(bars: Bar[], change: boolean[], useHA: boolean): OHLC[] {
  let htfOpen = NaN;
  let htfHigh = NaN;
  let htfLow = NaN;
  let prevClose = NaN;
  let haClose = NaN;
  let haOpen = NaN;
  let prevHaC = NaN;
  let prevHaO = NaN;
  return bars.map((b, i) => {
    if (change[i]) {
      htfOpen = b.open;
      htfHigh = b.high;
      htfLow = b.low;
      prevClose = i > 0 ? bars[i - 1].close : NaN;
      prevHaO = haOpen;
      prevHaC = haClose;
    }
    // math.max / math.min give na when one argument is na
    htfHigh = Math.max(b.high, htfHigh);
    htfLow = Math.min(b.low, htfLow);
    if (useHA) {
      // haFrom()
      const haC = (htfOpen + htfHigh + htfLow + b.close) / 4;
      const haO = Number.isNaN(prevHaO) || Number.isNaN(prevHaC) ? (htfOpen + b.close) / 2 : (prevHaO + prevHaC) / 2;
      const haH = Math.max(htfHigh, haO, haC);
      const haL = Math.min(htfLow, haO, haC);
      haOpen = haO;
      haClose = haC;
      return { o: haO, h: haH, l: haL, c: haC, prevC: prevHaC };
    }
    return { o: htfOpen, h: htfHigh, l: htfLow, c: b.close, prevC: prevClose };
  });
}

export function calculate(bars: Bar[], inputs: Partial<MultiTimePeriodChartsInputs> = {}, chart?: ChartContext): IndicatorResult {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const result: IndicatorResult = {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
  };
  if (n === 0) return result;
  const unit = bars[0].time >= 1e12 ? 'ms' : 's';
  const chartTf = chartTimeframe(bars, chart);

  // var string timeframe = autoTFInput ? selectAutoTimeframe() : selectTimeframeFromInput(tfInput)
  let tf: string;
  if (cfg.autoTF) {
    tf = chartTf === '' ? '1440' : selectAutoTimeframe(chartTf);
  } else {
    tf = chart?.sessionType === 'extended' && cfg.tf === '1D' ? '1440' : cfg.tf;
  }
  const isNewPeriod = periodChanges(bars, tf, chart);

  // [bar0, bar1]: the current higher-timeframe bar and the one before (bar1 on bar 0: na)
  let bar0: OHLC[];
  let bar1: Array<OHLC | null>;
  if (!cfg.useDaily) {
    bar0 = chartOHLC(bars, isNewPeriod, cfg.useHa);
    bar1 = bar0.map((_, i) => (i > 0 ? bar0[i - 1] : null));
  } else {
    // request.security(ticker, timeframe, [makeOHLC(0), makeOHLC(1)], lookahead = barmerge.lookahead_on): every chart
    // bar of a period gets that period's bar and the bar before it
    let htf: Bar[];
    let group: number[];
    const tfSeconds = pineTimeframe.in_seconds(tf.trim() === '' ? chartTf : tf);
    const chartSeconds = chartTf === '' ? tfSeconds : pineTimeframe.in_seconds(chartTf);
    if (tfSeconds === chartSeconds) {
      htf = bars;
      group = bars.map((_, i) => i);
    } else if (tfSeconds < chartSeconds) {
      throw new Error(`Multi-Time Period Charts: "Use daily-based values" with the timeframe "${tf}", below the chart timeframe, needs lower-timeframe bars, which the chart bars do not have.`);
    } else {
      const s = higherTimeframeBars(bars, tf, chart);
      htf = s.htf;
      group = s.group;
    }
    // ticker.heikinashi(syminfo.tickerid)
    if (cfg.useHa) htf = heikinAshi(htf);
    // makeOHLC(offset): OHLC.new(open[offset], high[offset], low[offset], close[offset], close[offset + 1])
    const makeOHLC = (g: number): OHLC => (g < 0 ? NA_OHLC : {
      o: htf[g].open, h: htf[g].high, l: htf[g].low, c: htf[g].close, prevC: g > 0 ? htf[g - 1].close : NaN,
    });
    bar0 = group.map((g) => makeOHLC(g));
    bar1 = group.map((g) => makeOHLC(g - 1));
  }

  const isOhlc = cfg.calcType === 'OHLC';
  // setBox(): hides the box when cond is true, else places it and colours it by direction
  const setBox = (bx: Box, cond: boolean, left: number, right: number, top: number, bottom: number, diff: number) => {
    const bodyColor = lt(diff, 0) ? cfg.dnBodyColor : cfg.upBodyColor;
    const borderColor = lt(diff, 0) ? cfg.dnBorderColor : cfg.upBorderColor;
    if (cond) {
      box.set_bgcolor(bx, 'transparent');
      box.set_border_color(bx, 'transparent');
    } else {
      box.set_left(bx, left);
      box.set_right(bx, right);
      box.set_top(bx, top);
      box.set_bottom(bx, bottom);
      box.set_bgcolor(bx, bodyColor);
      box.set_border_color(bx, borderColor);
    }
  };

  resetDrawings({ box: MAX_BOXES });
  const rtBox = varDrawing<Box>();
  const rtBody = varDrawing<Box>();
  let prevBarIndex = 0;
  const last = n - 1;
  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === last);
    const isLast = i === last;
    const drawCurrent = isLast && !isNewPeriod[i];
    const bar = (drawCurrent ? bar0[i] : bar1[i]) ?? NA_OHLC;
    const diff = bar.c - bar.o;
    const left = prevBarIndex;
    const right = drawCurrent ? i : i - 1;
    let top: number;
    let bottom: number;
    if (cfg.calcType === 'Open/Close Range') {
      top = bar.c;
      bottom = bar.o;
    } else if (cfg.calcType === 'True Range') {
      top = Math.max(bar.h, bar.prevC);
      bottom = Math.min(bar.l, bar.prevC);
    } else {
      top = bar.h;
      bottom = bar.l;
    }

    // On each new period: the box of the finished period
    if (isNewPeriod[i]) {
      prevBarIndex = i;
      const htBar = box.new(NaN, NaN, NaN, NaN);
      setBox(htBar, false, left, right, top, bottom, diff);
      if (isOhlc) {
        const htBody = box.new(NaN, NaN, NaN, NaN);
        setBox(htBody, false, left, right, bar.o, bar.c, diff);
      }
    }

    // The developing box of the current period, on the last bar
    if (isLast) {
      if (!rtBox.value) rtBox.value = box.new(NaN, NaN, NaN, NaN);
      setBox(rtBox.value, isNewPeriod[i], left, right, top, bottom, diff);
      if (isOhlc) {
        if (!rtBody.value) rtBody.value = box.new(NaN, NaN, NaN, NaN);
        setBox(rtBody.value, isNewPeriod[i], left, right, bar.o, bar.c, diff);
      }
    }
  }
  setDrawingBar(null);

  return { ...result, ...drawingOutputs(bars, unit) };
}

export const MultiTimePeriodCharts = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
