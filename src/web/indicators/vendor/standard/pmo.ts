// @ts-nocheck
/**
 * Price Momentum Oscillator (PMO)
 *
 * A twice-smoothed 1-bar rate of change of the source, with an EMA signal line:
 *
 *   roc    = 100 * (src - src[1]) / src[1]
 *   PMO    = ewma(10 * ewma(roc, 2 / length1), 2 / length2)
 *   signal = ewma(PMO, 2 / (max(1, signalLength) + 1))
 *
 * where ewma(x, alpha) = alpha * x + (1 - alpha) * previous result (the first value, and the value after an na, start
 * from x itself). Drawn with a zero line.
 *
 * Based on the standard Price Momentum Oscillator indicator. The functions pmo, ema2 and ewma of the standard "ta"
 * library are ported in this file.
 */

import { taCore, getSourceSeries, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type Bar, type SourceType } from 'oakscriptjs';

export interface PriceMomentumOscillatorInputs {
  /** Source: a price of the bar or the volume */
  src: SourceType | 'volume';
  length1: number;
  length2: number;
  signalLength: number;
}

export const defaultInputs: PriceMomentumOscillatorInputs = {
  src: 'close',
  length1: 35,
  length2: 20,
  signalLength: 10,
};

export const inputConfig: InputConfig[] = [
  { id: 'src', type: 'source', title: 'Source', defval: 'close' },
  { id: 'length1', type: 'int', title: 'Length 1', defval: 35, min: 1 },
  { id: 'length2', type: 'int', title: 'Length 2', defval: 20, min: 1 },
  { id: 'signalLength', type: 'int', title: 'Signal length', defval: 10, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'PMO', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'Signal', color: '#FF6D00', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_zero', price: 0, color: '#787B86', linestyle: 'dashed', linewidth: 1, title: 'Zero' },
];

export const metadata = {
  title: 'Price Momentum Oscillator',
  shortTitle: 'PMO',
  overlay: false,
};

/**
 * ewma() of the "ta" library: result := alpha * source + (1 - alpha) * nz(result[1], source).
 * nz() treats +-infinity as na; an na alpha or source gives na on the bar.
 */
function ewma(source: number[], alpha: number | number[]): number[] {
  const out: number[] = new Array(source.length);
  let prev = NaN;
  for (let i = 0; i < source.length; i++) {
    const a = typeof alpha === 'number' ? alpha : alpha[i];
    if (a < 0) throw new Error('Invalid smoothing factor. The value must not be negative.');
    const s = source[i];
    const r = a * s + (1.0 - a) * (Number.isFinite(prev) ? prev : s);
    out[i] = r;
    prev = r;
  }
  return out;
}

/** ema2() of the "ta" library: EMA with a float length */
function ema2(source: number[], length: number): number[] {
  if (length < 1) throw new Error(`Invalid length (${length}). The value must be greater than or equal to 1.`);
  return ewma(source, 2.0 / (Math.max(1.0, length) + 1.0));
}

export function calculate(bars: Bar[], inputs: Partial<PriceMomentumOscillatorInputs> = {}): IndicatorResult {
  const { src, length1, length2, signalLength } = { ...defaultInputs, ...inputs };
  // input.source also offers the volume, which getSourceSeries does not give
  const source = src === 'volume'
    ? bars.map((b) => b.volume ?? NaN)
    : getSourceSeries(bars, src).toArray().map((v) => v ?? NaN);

  // pmo() of the "ta" library
  const roc = taCore.roc(source, 1);
  const smooth1 = ewma(roc, 2.0 / length1).map((v) => 10.0 * v);
  const pmo = ewma(smooth1, 2.0 / length2);
  const signal = ema2(pmo, signalLength);

  const point = (v: number, i: number) => ({ time: bars[i].time, value: Number.isFinite(v) ? v : NaN });
  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: pmo.map(point),
      plot1: signal.map(point),
    },
  };
}

export const PriceMomentumOscillatorStandard = { calculate, metadata, defaultInputs, inputConfig, plotConfig, hlineConfig };
