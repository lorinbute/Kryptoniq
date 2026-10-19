// @ts-nocheck
/**
 * RSI Divergence Indicator
 *
 * RSI (ta.rsi of the source) with divergences found on its pivots. A pivot low / high of the RSI is known
 * `Pivot Lookback Right` bars after its bar; it is compared with the previous RSI pivot of the same kind when the
 * pivot found before it is between `Min of Lookback Range` and `Max of Lookback Range` bars back:
 * - Regular Bullish: RSI higher low, price lower low (on the lows of the pivot bars)
 * - Hidden Bullish: RSI lower low, price higher low
 * - Regular Bearish: RSI lower high, price higher high (on the highs of the pivot bars)
 * - Hidden Bearish: RSI higher high, price lower high
 * Each kind draws a line through the RSI pivots (transparent unless the divergence is found and its "Plot" input is
 * on) and a label on the pivot bar. The lines and labels are drawn `Pivot Lookback Right` bars back (Pine offset).
 *
 * Based on the standard RSI Divergence Indicator.
 *
 * Not ported: the Timeframe setting of indicator(timeframe = "") (the chart timeframe is used), the alert conditions.
 */

import {
  ta, taCore, compare, getSourceSeries,
  type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type FillConfig, type Bar, type SourceType,
} from 'oakscriptjs';
import type { MarkerData, OutputDecl, OutputValues } from '../types';
import { alertStates, type AlertConditionDecl, type AlertConditionState } from '../alert-states';

export interface RsiDivergenceIndicatorInputs {
  /** RSI Period */
  len: number;
  /** RSI Source */
  src: SourceType;
  /** Pivot Lookback Right */
  lbR: number;
  /** Pivot Lookback Left */
  lbL: number;
  /** Max of Lookback Range */
  rangeUpper: number;
  /** Min of Lookback Range */
  rangeLower: number;
  /** Plot Bullish */
  plotBull: boolean;
  /** Plot Hidden Bullish */
  plotHiddenBull: boolean;
  /** Plot Bearish */
  plotBear: boolean;
  /** Plot Hidden Bearish */
  plotHiddenBear: boolean;
}

export const defaultInputs: RsiDivergenceIndicatorInputs = {
  len: 14,
  src: 'close',
  lbR: 5,
  lbL: 5,
  rangeUpper: 60,
  rangeLower: 5,
  plotBull: true,
  plotHiddenBull: false,
  plotBear: true,
  plotHiddenBear: false,
};

export const inputConfig: InputConfig[] = [
  { id: 'len', type: 'int', title: 'RSI Period', defval: 14, min: 1 },
  { id: 'src', type: 'source', title: 'RSI Source', defval: 'close' },
  { id: 'lbR', type: 'int', title: 'Pivot Lookback Right', defval: 5, display: 'data_window' },
  { id: 'lbL', type: 'int', title: 'Pivot Lookback Left', defval: 5, display: 'data_window' },
  { id: 'rangeUpper', type: 'int', title: 'Max of Lookback Range', defval: 60, display: 'data_window' },
  { id: 'rangeLower', type: 'int', title: 'Min of Lookback Range', defval: 5, display: 'data_window' },
  { id: 'plotBull', type: 'bool', title: 'Plot Bullish', defval: true, display: 'data_window' },
  { id: 'plotHiddenBull', type: 'bool', title: 'Plot Hidden Bullish', defval: false, display: 'data_window' },
  { id: 'plotBear', type: 'bool', title: 'Plot Bearish', defval: true, display: 'data_window' },
  { id: 'plotHiddenBear', type: 'bool', title: 'Plot Hidden Bearish', defval: false, display: 'data_window' },
];

// Pine v6 colours: color.green #4CAF50, color.red #F23645; hidden colours color.new(c, 80) (alpha byte 51)
const BULL_COLOR = '#4CAF50';
const BEAR_COLOR = '#F23645';
const HIDDEN_BULL_COLOR = '#4CAF5033';
const HIDDEN_BEAR_COLOR = '#F2364533';
// noneColor = color.new(color.white, 100)
const NONE_COLOR = '#FFFFFF00';
// textColor = color.white
const TEXT_COLOR = '#FFFFFF';

// The divergence lines: display = display.pane, offset = -lbR (applied to the point times)
export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'RSI', color: '#2962FF', lineWidth: 2 },
  { id: 'plot1', title: 'Regular Bullish', color: BULL_COLOR, lineWidth: 2, display: 'pane' },
  { id: 'plot2', title: 'Hidden Bullish', color: HIDDEN_BULL_COLOR, lineWidth: 2, display: 'pane' },
  { id: 'plot3', title: 'Regular Bearish', color: BEAR_COLOR, lineWidth: 2, display: 'pane' },
  { id: 'plot4', title: 'Hidden Bearish', color: HIDDEN_BEAR_COLOR, lineWidth: 2, display: 'pane' },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_mid', price: 50, title: 'Middle Line', color: '#787B86', linestyle: 'dotted', linewidth: 1 },
  { id: 'hline_ob', price: 70, title: 'Overbought', color: '#787B86', linestyle: 'dotted', linewidth: 1 },
  { id: 'hline_os', price: 30, title: 'Oversold', color: '#787B86', linestyle: 'dotted', linewidth: 1 },
];

// fill(obLevel, osLevel, title = "Background", color = color.rgb(33, 150, 243, 90))
export const fillConfig: FillConfig[] = [
  { id: 'fill_background', plot1: 'hline_ob', plot2: 'hline_os', color: '#2196F31A', title: 'Background' },
];

export const metadata = {
  title: 'RSI Divergence Indicator',
  shortTitle: 'RSI Divergence Indicator',
  overlay: false,
};

type PlotPoint = { time: number; value: number; color?: string };

export function calculate(
  bars: Bar[],
  inputs: Partial<RsiDivergenceIndicatorInputs> = {},
): Omit<IndicatorResult, 'markers'> & { markers: MarkerData[]; outputValues: OutputValues; alerts: AlertConditionState[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const { lbR, lbL, rangeUpper, rangeLower } = cfg;
  const n = bars.length;

  // osc = ta.rsi(src, len)
  const oscSeries = ta.rsi(getSourceSeries(bars, cfg.src), cfg.len);
  const osc = oscSeries.toArray().map((v) => v ?? NaN);

  // plFound = na(ta.pivotlow(osc, lbL, lbR)) ? false : true (same for the highs)
  const plFound = ta.pivotlow(oscSeries, lbL, lbR).toArray().map((v) => v != null && !Number.isNaN(v));
  const phFound = ta.pivothigh(oscSeries, lbL, lbR).toArray().map((v) => v != null && !Number.isNaN(v));

  // _inRange(cond) => bars = ta.barssince(cond == true); rangeLower <= bars and bars <= rangeUpper
  // inRangePl = _inRange(plFound[1]): called on every bar (plFound[1] is false on the first bar)
  const inRange = (found: boolean[]) => {
    const since = taCore.barssince(found.map((_, i) => i > 0 && found[i - 1]));
    return since.map((b) => compare.le(rangeLower, b) && compare.le(b, rangeUpper));
  };
  const inRangePl = inRange(plFound);
  const inRangePh = inRange(phFound);

  // osc[lbR], low[lbR], high[lbR]
  const back = (values: number[]) => values.map((_, i) => (i >= lbR ? values[i - lbR] : NaN));
  const oscR = back(osc);
  const lowR = back(bars.map((b) => b.low));
  const highR = back(bars.map((b) => b.high));

  // ta.valuewhen(plFound, osc[lbR], 1) ... : the values of the previous pivot
  const prevOscPl = taCore.valuewhen(plFound, oscR, 1);
  const prevLowPl = taCore.valuewhen(plFound, lowR, 1);
  const prevOscPh = taCore.valuewhen(phFound, oscR, 1);
  const prevHighPh = taCore.valuewhen(phFound, highR, 1);

  const rsiPlot: PlotPoint[] = bars.map((b, i) => ({ time: b.time, value: osc[i] }));
  const na = (): PlotPoint[] => bars.map((b) => ({ time: b.time, value: NaN }));
  const bullPlot = na();
  const hiddenBullPlot = na();
  const bearPlot = na();
  const hiddenBearPlot = na();
  const markers: MarkerData[] = [];
  // The label shapes' series (cond ? osc[lbR] : na) on the bar they are computed on.
  const labels: OutputValues = { bullLabel: [], hiddenBullLabel: [], bearLabel: [], hiddenBearLabel: [] };
  // the alert conditions (not gated by the "Plot ..." inputs), on the bar they are computed on
  const alertFlags: boolean[][] = [[], [], [], []];

  for (let i = 0; i < n; i++) {
    // Regular Bullish: oscHL = osc[lbR] > valuewhen(...) and inRangePl; priceLL = low[lbR] < valuewhen(...)
    const oscHL = compare.gt(oscR[i], prevOscPl[i]) && inRangePl[i];
    const priceLL = compare.lt(lowR[i], prevLowPl[i]);
    const bullCond = cfg.plotBull && priceLL && oscHL && plFound[i];
    // Hidden Bullish: oscLL = osc[lbR] < valuewhen(...) and inRangePl; priceHL = low[lbR] > valuewhen(...)
    const oscLL = compare.lt(oscR[i], prevOscPl[i]) && inRangePl[i];
    const priceHL = compare.gt(lowR[i], prevLowPl[i]);
    const hiddenBullCond = cfg.plotHiddenBull && priceHL && oscLL && plFound[i];
    // Regular Bearish: oscLH = osc[lbR] < valuewhen(...) and inRangePh; priceHH = high[lbR] > valuewhen(...)
    const oscLH = compare.lt(oscR[i], prevOscPh[i]) && inRangePh[i];
    const priceHH = compare.gt(highR[i], prevHighPh[i]);
    const bearCond = cfg.plotBear && priceHH && oscLH && phFound[i];
    // Hidden Bearish: oscHH = osc[lbR] > valuewhen(...) and inRangePh; priceLH = high[lbR] < valuewhen(...)
    const oscHH = compare.gt(oscR[i], prevOscPh[i]) && inRangePh[i];
    const priceLH = compare.lt(highR[i], prevHighPh[i]);
    const hiddenBearCond = cfg.plotHiddenBear && priceLH && oscHH && phFound[i];
    // bullCondAlert, hiddenBullCondAlert, bearCondAlert, hiddenBearCondAlert
    alertFlags[0][i] = priceLL && oscHL && plFound[i];
    alertFlags[1][i] = priceHL && oscLL && plFound[i];
    alertFlags[2][i] = priceHH && oscLH && phFound[i];
    alertFlags[3][i] = priceLH && oscHH && phFound[i];

    const at = bars[i].time as number;
    const lv = oscR[i];
    if (Number.isFinite(lv)) {
      if (bullCond) labels.bullLabel.push({ time: at, value: lv });
      if (hiddenBullCond) labels.hiddenBullLabel.push({ time: at, value: lv });
      if (bearCond) labels.bearLabel.push({ time: at, value: lv });
      if (hiddenBearCond) labels.hiddenBearLabel.push({ time: at, value: lv });
    }

    // offset = -lbR: the value of bar i is drawn on bar i - lbR
    const j = i - lbR;
    if (j < 0 || j >= n) continue;
    const time = bars[j].time;
    const v = oscR[i];
    // plot(plFound ? osc[lbR] : na, color = bullCond ? bullColor : noneColor) ...
    const plValue = plFound[i] ? v : NaN;
    const phValue = phFound[i] ? v : NaN;
    bullPlot[j] = { time, value: plValue, color: bullCond ? BULL_COLOR : NONE_COLOR };
    hiddenBullPlot[j] = { time, value: plValue, color: hiddenBullCond ? HIDDEN_BULL_COLOR : NONE_COLOR };
    bearPlot[j] = { time, value: phValue, color: bearCond ? BEAR_COLOR : NONE_COLOR };
    hiddenBearPlot[j] = { time, value: phValue, color: hiddenBearCond ? HIDDEN_BEAR_COLOR : NONE_COLOR };

    // plotshape(cond ? osc[lbR] : na, style = shape.labelup / labeldown, location = location.absolute)
    if (!Number.isFinite(v)) continue;
    if (bullCond) {
      markers.push({ time, position: 'atPriceBottom', price: v, shape: 'labelUp', color: BULL_COLOR, text: ' Bull ', textColor: TEXT_COLOR, id: 'bullLabel' });
    }
    if (hiddenBullCond) {
      markers.push({ time, position: 'atPriceBottom', price: v, shape: 'labelUp', color: BULL_COLOR, text: ' H Bull ', textColor: TEXT_COLOR, id: 'hiddenBullLabel' });
    }
    if (bearCond) {
      markers.push({ time, position: 'atPriceTop', price: v, shape: 'labelDown', color: BEAR_COLOR, text: ' Bear ', textColor: TEXT_COLOR, id: 'bearLabel' });
    }
    if (hiddenBearCond) {
      markers.push({ time, position: 'atPriceTop', price: v, shape: 'labelDown', color: BEAR_COLOR, text: ' H Bear ', textColor: TEXT_COLOR, id: 'hiddenBearLabel' });
    }
  }

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: rsiPlot,
      plot1: bullPlot,
      plot2: hiddenBullPlot,
      plot3: bearPlot,
      plot4: hiddenBearPlot,
    },
    markers,
    outputValues: labels,
    alerts: alertStates(alertConditions, bars, alertFlags),
  };
}

/** Reference alertconditions */
export const alertConditions: AlertConditionDecl[] = [
  { id: 'alert0', title: 'Regular Bullish Divergence', message: 'Found a new Regular Bullish Divergence, `Pivot Lookback Right` number of bars to the left of the current bar' },
  { id: 'alert1', title: 'Hidden Bullish Divergence', message: 'Found a new Hidden Bullish Divergence, `Pivot Lookback Right` number of bars to the left of the current bar' },
  { id: 'alert2', title: 'Regular Bearish Divergence', message: 'Found a new Regular Bearish Divergence, `Pivot Lookback Right` number of bars to the left of the current bar' },
  { id: 'alert3', title: 'Hidden Bearish Divergence', message: 'Found a new Hidden Bearish Divergence, `Pivot Lookback Right` number of bars to the left of the current bar' },
];

/** Reference outputs: the RSI, then each divergence line followed by its label. */
export const outputs: OutputDecl[] = [
  { kind: 'plot', id: 'plot0' },
  { kind: 'plot', id: 'plot1' },
  { kind: 'shape', id: 'bullLabel', title: 'Regular Bullish Label' },
  { kind: 'plot', id: 'plot2' },
  { kind: 'shape', id: 'hiddenBullLabel', title: 'Hidden Bullish Label' },
  { kind: 'plot', id: 'plot3' },
  { kind: 'shape', id: 'bearLabel', title: 'Regular Bearish Label' },
  { kind: 'plot', id: 'plot4' },
  { kind: 'shape', id: 'hiddenBearLabel', title: 'Hidden Bearish Label' },
];

export const RsiDivergenceIndicator = { calculate, metadata, defaultInputs, inputConfig, plotConfig, hlineConfig, fillConfig, outputs, alertConditions };
