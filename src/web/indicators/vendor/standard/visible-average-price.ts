// @ts-nocheck
/**
 * Visible Average Price
 *
 * Average of the source over the bars visible on the chart, shown as a horizontal price line across the chart.
 *
 * Based on the standard Visible Average Price indicator. The original adds the source of each visible bar to a list
 * and plots the running average with `offset = -100000`, `show_last = 1` and `trackprice = true`: the plot itself is
 * moved out of the chart (`plots.plot0` is the same: no point on charts of up to 100,000 bars) and only its price
 * line at the last average is seen. The plot output has no price line option, so the port gives that price line as
 * a horizontal line drawing (`lines`, extended on both sides, colour of the plot) at the average of the visible bars.
 *
 * Visible range: the indicator reads the first and the last visible bar of the chart (`leftVisibleBarTime` /
 * `rightVisibleBarTime` of the chart context, third argument of calculate); it must be calculated again when the user
 * scrolls or zooms. Without these values the range is all the bars. When no bar is in the range there is no line.
 */

import { array, type Bar, type IndicatorResult, type InputConfig, type PlotConfig, type SourceType, getSource } from 'oakscriptjs';
import type { LineDrawingData } from '../types';
import { visibleRangeOf, type ChartContext } from '../chart-context';

export interface VisibleAveragePriceInputs {
  /** Source */
  src: SourceType | 'volume';
}

export const defaultInputs: VisibleAveragePriceInputs = {
  src: 'close',
};

export const inputConfig: InputConfig[] = [
  { id: 'src', type: 'source', title: 'Source', defval: 'close' },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Avg Price', color: '#787B86', lineWidth: 1 },
];

export const metadata = {
  title: 'Visible Average Price',
  shortTitle: 'Avg Price',
  overlay: true,
};

/** The indicator reads the visible range of the chart */
export const usesVisibleRange = true;

/** plot(..., offset = -100000) */
const PLOT_OFFSET = -100000;

export function calculate(
  bars: Bar[],
  inputs: Partial<VisibleAveragePriceInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { lines: LineDrawingData[] } {
  const { src } = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const toMs = chart?.timeUnit === 'ms' ? 1 : 1000;
  // timeLeft = chart.left_visible_bar_time, timeRight = chart.right_visible_bar_time
  const { leftTime, rightTime } = visibleRangeOf(bars, chart);

  // var float[] src_vals = array.new<float>()
  // if time >= timeLeft and time <= timeRight: array.unshift(src_vals, src)
  const srcVals = array.new_float();
  const values = getSource(bars, src as SourceType);
  bars.forEach((b, i) => {
    const t = (b.time as number) * toMs;
    if (t >= leftTime && t <= rightTime) array.unshift(srcVals, values[i]);
  });
  // avgSRC = array.avg(src_vals) on the last bar (na values skipped; na while the list is empty)
  const last = n > 0 ? array.avg(srcVals) : NaN;

  // plot(avgSRC, 'Avg Price', color = #787B86, trackprice = true, show_last = 1, offset = -100000): only the value of
  // the last bar is shown, 100,000 bars before it (no point on charts of up to 100,000 bars)
  const shownBar = n - 1 + PLOT_OFFSET;
  const plot0 = bars.map((b, j) => ({ time: b.time, value: j === shownBar ? last : NaN }));

  // trackprice = true: the price line at the last value of the plot
  const lines: LineDrawingData[] = [];
  if (Number.isFinite(last)) {
    lines.push({
      time1: bars[0].time as number, price1: last, time2: bars[n - 1].time as number, price2: last,
      color: '#787B86', width: 1, style: 'dashed', extend: 'both',
    });
  }

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: { plot0 },
    lines,
  };
}

export const VisibleAveragePrice = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  usesVisibleRange,
};
