// @ts-nocheck
/**
 * Kaufman's Adaptive Moving Average (KAMA)
 *
 * An exponential average whose smoothing factor follows Kaufman's Efficiency Ratio (ER) of the source:
 *
 *   ER    = sum(|change(src)|, erLength) == 0 ? 0 : |src - src[erLength]| / sum(|change(src)|, erLength)
 *   alpha = (ER * (2 / (fast + 1) - 2 / (slow + 1)) + 2 / (slow + 1))^2
 *   KAMA  = alpha * src + (1 - alpha) * previous KAMA  (starts from the source on the first bar with an ER)
 *
 * Based on the standard Kaufman's Adaptive Moving Average indicator. The functions kama, er and ewma of the standard
 * "ta" library are ported in this file.
 */

import { taCore, math, getSourceSeries, type IndicatorResult, type InputConfig, type PlotConfig, type Bar, type SourceType } from 'oakscriptjs';

export interface KaufmansAdaptiveMovingAverageInputs {
  /** Source: a price of the bar or the volume */
  src: SourceType | 'volume';
  /** Length of the Efficiency Ratio */
  erLength: number;
  /** Length of the fastest smoothing */
  fastLength: number;
  /** Length of the slowest smoothing */
  slowLength: number;
}

export const defaultInputs: KaufmansAdaptiveMovingAverageInputs = {
  src: 'close',
  erLength: 10,
  fastLength: 2,
  slowLength: 30,
};

export const inputConfig: InputConfig[] = [
  { id: 'src', type: 'source', title: 'Source', defval: 'close' },
  { id: 'erLength', type: 'int', title: 'ER length', defval: 10, min: 1 },
  { id: 'fastLength', type: 'int', title: 'Fast length', defval: 2, min: 1 },
  { id: 'slowLength', type: 'int', title: 'Slow length', defval: 30, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'KAMA', color: '#2962FF', lineWidth: 1 },
];

export const metadata = {
  title: "Kaufman's Adaptive Moving Average",
  shortTitle: 'KAMA',
  overlay: true,
};

/**
 * ewma() of the "ta" library: result := alpha * source + (1 - alpha) * nz(result[1], source).
 * nz() treats +-infinity as na; an na alpha or source gives na on the bar.
 */
function ewma(source: number[], alpha: number[]): number[] {
  const out: number[] = new Array(source.length);
  let prev = NaN;
  for (let i = 0; i < source.length; i++) {
    const a = alpha[i];
    if (a < 0) throw new Error('Invalid smoothing factor. The value must not be negative.');
    const s = source[i];
    const r = a * s + (1.0 - a) * (Number.isFinite(prev) ? prev : s);
    out[i] = r;
    prev = r;
  }
  return out;
}

/** er() of the "ta" library: Kaufman's Efficiency Ratio */
function er(source: number[], length: number): number[] {
  const absChange = taCore.change(source, length).map((v) => Math.abs(v));
  const sumChanges = math.sum(taCore.change(source, 1).map((v) => Math.abs(v)), length) as number[];
  // sumChanges == 0.0: Pine equality within 1e-10 (na compares false)
  return absChange.map((v, i) => (Math.abs(sumChanges[i]) <= 1e-10 ? 0.0 : v / sumChanges[i]));
}

export function calculate(bars: Bar[], inputs: Partial<KaufmansAdaptiveMovingAverageInputs> = {}): IndicatorResult {
  const { src, erLength, fastLength, slowLength } = { ...defaultInputs, ...inputs };
  // input.source also offers the volume, which getSourceSeries does not give
  const source = src === 'volume'
    ? bars.map((b) => b.volume ?? NaN)
    : getSourceSeries(bars, src).toArray().map((v) => v ?? NaN);

  // kama() of the "ta" library
  const alphaFast = 2.0 / (fastLength + 1.0);
  const alphaSlow = 2.0 / (slowLength + 1.0);
  const alpha = er(source, erLength).map((e) => math.pow(e * (alphaFast - alphaSlow) + alphaSlow, 2) as number);
  const kama = ewma(source, alpha);

  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: kama.map((v, i) => ({ time: bars[i].time, value: Number.isFinite(v) ? v : NaN })),
    },
  };
}

export const KaufmansAdaptiveMovingAverage = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
