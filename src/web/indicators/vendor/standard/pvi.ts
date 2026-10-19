// @ts-nocheck
/**
 * Positive Volume Index (PVI)
 *
 * Cumulative index that changes only on bars where volume INCREASES versus the
 * prior bar: it moves by the bar's percentage close change (index * (close - close[1]) / close[1]).
 * Tracks the "crowd" that is presumed to trade on active days. The plot is ta.pvi * 1000
 * (starts at 1000), with an EMA (255) of it as signal line.
 *
 * Based on the standard "Positive Volume Index" indicator.
 */

import { ta, type IndicatorResult, type InputConfig, type PlotConfig, type Bar } from 'oakscriptjs';

export interface PVIInputs {
  /** Signal EMA length */
  signalLength: number;
}

export const defaultInputs: PVIInputs = {
  signalLength: 255,
};

export const inputConfig: InputConfig[] = [
  { id: 'signalLength', type: 'int', title: 'EMA length', defval: 255, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'PVI', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'PVI-based EMA', color: '#FF9800', lineWidth: 1 },
];

export const metadata = {
  title: 'Positive Volume Index',
  shortTitle: 'PVI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<PVIInputs> = {}): IndicatorResult {
  const { signalLength } = { ...defaultInputs, ...inputs };

  // pvi = ta.pvi * 1000.0; ema = ta.ema(pvi, maLengthInput)
  const pviSeries = ta.pvi(bars).mul(1000);
  const pvi = pviSeries.toArray();
  const ema = ta.ema(pviSeries, signalLength).toArray();

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': pvi.map((value, i) => ({ time: bars[i].time, value: value ?? NaN })),
      'plot1': ema.map((value, i) => ({ time: bars[i].time, value: value ?? NaN })),
    },
  };
}

export const PositiveVolumeIndex = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
