// @ts-nocheck
/**
 * Negative Volume Index (NVI)
 *
 * Cumulative index that changes only on bars where volume DECREASES versus the
 * prior bar: it moves by the bar's percentage close change (index * (close - close[1]) / close[1]).
 * Tracks "smart money" that is presumed to trade on quiet days. The plot is ta.nvi * 1000
 * (starts at 1000), with an EMA (255) of it as signal line.
 *
 * Based on the standard "Negative Volume Index" indicator.
 */

import { ta, type IndicatorResult, type InputConfig, type PlotConfig, type Bar } from 'oakscriptjs';

export interface NVIInputs {
  /** Signal EMA length */
  signalLength: number;
}

export const defaultInputs: NVIInputs = {
  signalLength: 255,
};

export const inputConfig: InputConfig[] = [
  { id: 'signalLength', type: 'int', title: 'EMA length', defval: 255, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'NVI', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'NVI-based EMA', color: '#FF9800', lineWidth: 1 },
];

export const metadata = {
  title: 'Negative Volume Index',
  shortTitle: 'NVI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<NVIInputs> = {}): IndicatorResult {
  const { signalLength } = { ...defaultInputs, ...inputs };

  // nvi = ta.nvi * 1000.0; ema = ta.ema(nvi, maLengthInput)
  const nviSeries = ta.nvi(bars).mul(1000);
  const nvi = nviSeries.toArray();
  const ema = ta.ema(nviSeries, signalLength).toArray();

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': nvi.map((value, i) => ({ time: bars[i].time, value: value ?? NaN })),
      'plot1': ema.map((value, i) => ({ time: bars[i].time, value: value ?? NaN })),
    },
  };
}

export const NegativeVolumeIndex = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
