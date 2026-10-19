// @ts-nocheck
/**
 * Pivot Points High Low
 *
 * Finds pivot highs (a high with `left` lower-or-equal highs before it and `right` lower highs after it) and pivot
 * lows (the same on the lows), and draws a label with the price on each pivot bar: a label pointing down above the
 * pivot highs and a label pointing up below the pivot lows. A pivot is known `right` bars after its bar.
 *
 * Based on the standard Pivot Points High Low indicator.
 *
 * The label text is the price rounded to the symbol tick (format.mintick): the port reads the tick from the optional
 * third argument (see src/chart-context.ts); without it the tick is 0.01. At most 500 labels stay on the chart
 * (max_labels_count = 500, oldest deleted first).
 */

import {
  ta, str, label, resetDrawings, setDrawingBar, drawingOutputs, Series,
  type IndicatorResult, type InputConfig, type PlotConfig, type Bar,
} from 'oakscriptjs';
import type { LabelData } from '../types';
import { mintickOf, type ChartContext } from '../chart-context';

export interface PivotPointsHighLowInputs {
  /** Pivot high: bars on the left */
  leftLenH: number;
  /** Pivot high: bars on the right */
  rightLenH: number;
  /** Text colour of the pivot high labels */
  textColorH: string;
  /** Colour of the pivot high labels */
  labelColorH: string;
  /** Pivot low: bars on the left */
  leftLenL: number;
  /** Pivot low: bars on the right */
  rightLenL: number;
  /** Text colour of the pivot low labels */
  textColorL: string;
  /** Colour of the pivot low labels */
  labelColorL: string;
}

export const defaultInputs: PivotPointsHighLowInputs = {
  leftLenH: 10,
  rightLenH: 10,
  textColorH: '#363A45',
  labelColorH: '#FFFFFF',
  leftLenL: 10,
  rightLenL: 10,
  textColorL: '#363A45',
  labelColorL: '#FFFFFF',
};

const LENGTH_GROUP = 'LENGTH LEFT / RIGHT';
const COLOR_GROUP = 'Text Color / Label Color';

export const inputConfig: InputConfig[] = [
  { id: 'leftLenH', type: 'int', title: 'Pivot High', defval: 10, min: 1, inline: 'Pivot High', group: LENGTH_GROUP },
  { id: 'rightLenH', type: 'int', title: '/', defval: 10, min: 1, inline: 'Pivot High', group: LENGTH_GROUP },
  { id: 'textColorH', type: 'color', title: 'Pivot High', defval: '#363A45', inline: 'Pivot High', group: COLOR_GROUP },
  { id: 'labelColorH', type: 'color', title: '', defval: '#FFFFFF', inline: 'Pivot High', group: COLOR_GROUP },
  { id: 'leftLenL', type: 'int', title: 'Pivot Low', defval: 10, min: 1, inline: 'Pivot Low', group: LENGTH_GROUP },
  { id: 'rightLenL', type: 'int', title: '/', defval: 10, min: 1, inline: 'Pivot Low', group: LENGTH_GROUP },
  { id: 'textColorL', type: 'color', title: 'Pivot Low', defval: '#363A45', inline: 'Pivot Low', group: COLOR_GROUP },
  { id: 'labelColorL', type: 'color', title: '', defval: '#FFFFFF', inline: 'Pivot Low', group: COLOR_GROUP },
];

// No plots: the output is labels only
export const plotConfig: PlotConfig[] = [];

export const metadata = {
  title: 'Pivot Points High Low',
  shortTitle: 'Pivots HL',
  overlay: true,
};

/** indicator(max_labels_count = 500) */
const MAX_LABELS = 500;

export function calculate(
  bars: Bar[],
  inputs: Partial<PivotPointsHighLowInputs> = {},
  chart?: ChartContext,
): IndicatorResult & { labels: LabelData[] } {
  const cfg = { ...defaultInputs, ...inputs };
  const n = bars.length;
  const mintick = mintickOf(chart);

  // ph = ta.pivothigh(leftLenH, rightLenH) (on high), pl = ta.pivotlow(leftLenL, rightLenL) (on low)
  const ph = ta.pivothigh(new Series(bars, (b) => b.high), cfg.leftLenH, cfg.rightLenH).toArray();
  const pl = ta.pivotlow(new Series(bars, (b) => b.low), cfg.leftLenL, cfg.rightLenL).toArray();

  resetDrawings({ label: MAX_LABELS });

  // drawLabel(_offset, _pivot, _style, _color, _textColor) =>
  //     if not na(_pivot)
  //         label.new(bar_index[_offset], _pivot, str.tostring(_pivot, format.mintick), style = _style, color = _color,
  //                   textcolor = _textColor)
  const drawLabel = (i: number, offset: number, pivot: number | null | undefined, style: 'label_down' | 'label_up',
    color: string, textColor: string) => {
    if (pivot == null || !Number.isFinite(pivot)) return;
    // bar_index[_offset] is na before the bar `_offset`: the pivot functions give no value there
    label.new(i - offset, pivot, str.tostring(pivot, 'mintick', mintick), 'bar_index', 'price', color, style, textColor);
  };

  for (let i = 0; i < n; i++) {
    setDrawingBar(i, i === n - 1);
    drawLabel(i, cfg.rightLenH, ph[i], 'label_down', cfg.labelColorH, cfg.textColorH);
    drawLabel(i, cfg.rightLenL, pl[i], 'label_up', cfg.labelColorL, cfg.textColorL);
  }
  setDrawingBar(null);

  const { labels = [] } = drawingOutputs(bars);
  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {},
    labels,
  };
}

export const PivotPointsHighLow = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
