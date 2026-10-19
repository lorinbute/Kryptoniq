// @ts-nocheck
/**
 * Price Volume Trend (PVT) Indicator
 *
 * Cumulative volume indicator that relates volume to price change:
 * vt = ta.cum(ta.change(close) / close[1] * volume). The first bar has no change, so it is na.
 */

import { Series, ta, type IndicatorResult, type InputConfig, type PlotConfig, type Bar } from 'oakscriptjs';

export interface PVTInputs {
  // No inputs needed
}

export const defaultInputs: PVTInputs = {};

export const inputConfig: InputConfig[] = [];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'PVT', color: '#2962FF', lineWidth: 1 },
];

export const metadata = {
  title: 'Price Volume Trend',
  shortTitle: 'PVT',
  overlay: false,
};

export function calculate(bars: Bar[], _inputs: Partial<PVTInputs> = {}): IndicatorResult {
  // vt = ta.cum(ta.change(src) / src[1] * volume); x / 0 is +-infinity (0 / 0 na): ta.cum skips it (na on that bar)
  const change = ta.change(new Series(bars, (b) => b.close)).toArray();
  const terms = bars.map((b, i) => (i > 0 ? (change[i] ?? NaN) / bars[i - 1].close * (b.volume ?? NaN) : NaN));
  const pvt = ta.cum(Series.fromArray(bars, terms)).toArray();

  const pvtData = pvt.map((value, i) => ({
    time: bars[i].time,
    value: value ?? NaN,
  }));

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': pvtData,
    },
  };
}

export const PVT = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
