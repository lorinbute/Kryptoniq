// @ts-nocheck
/**
 * Fisher Transform Indicator
 *
 * Converts prices into a Gaussian normal distribution, making
 * turning points easier to identify.
 *
 * Based on the standard Fisher Transform indicator.
 */

import { Series, ta, type Bar, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig } from 'oakscriptjs';

export interface FisherTransformInputs {
  /** Lookback period for highest/lowest calculation */
  length: number;
}

export const defaultInputs: FisherTransformInputs = {
  length: 9,
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'Length', defval: 9, min: 1 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Fisher', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'Trigger', color: '#FF6D00', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_1',  price: 1.5, color: '#E91E63', linestyle: 'dashed', title: '1.5' },
  { id: 'hline_2',  price: 0.75, color: '#787B86', linestyle: 'dashed', title: '0.75' },
  { id: 'hline_3',  price: 0, color: '#E91E63', linestyle: 'dashed', title: '0' },
  { id: 'hline_4',  price: -0.75, color: '#787B86', linestyle: 'dashed', title: '-0.75' },
  { id: 'hline_5',  price: -1.5, color: '#E91E63', linestyle: 'dashed', title: '-1.5' },
];

export const metadata = {
  title: 'Fisher Transform',
  shortTitle: 'Fisher',
  overlay: false,
};

/** Pine float comparisons: a > b only when a - b > 1e-10 (na compares false) */
const EPS = 1e-10;
const gt = (a: number, b: number) => a - b > EPS;
const lt = (a: number, b: number) => b - a > EPS;

/**
 * Calculate Fisher Transform
 *
 * high_ = ta.highest(hl2, len), low_ = ta.lowest(hl2, len)
 * round_(val) => val > .99 ? .999 : val < -.99 ? -.999 : val
 * value := round_(.66 * ((hl2 - low_) / (high_ - low_) - .5) + .67 * nz(value[1]))
 * fish1 := .5 * math.log((1 + value) / (1 - value)) + .5 * nz(fish1[1])
 * fish2 = fish1[1]
 * A flat window (high_ == low_) gives 0 / 0 = na: value and fish1 are na on that bar and count as 0 on the next.
 */
export function calculate(bars: Bar[], inputs: Partial<FisherTransformInputs> = {}): IndicatorResult {
  const { length } = { ...defaultInputs, ...inputs };
  const hl2 = Series.fromArray(bars, bars.map((b) => (b.high + b.low) / 2));
  const hl2Arr = hl2.toArray().map((v) => v ?? NaN);
  const highArr = ta.highest(hl2, length).toArray().map((v) => v ?? NaN);
  const lowArr = ta.lowest(hl2, length).toArray().map((v) => v ?? NaN);

  const fisher: number[] = new Array(bars.length);
  let value = NaN;
  let fish1 = NaN;
  for (let i = 0; i < bars.length; i++) {
    const nzValue = Number.isNaN(value) ? 0 : value;
    const nzFish1 = Number.isNaN(fish1) ? 0 : fish1;
    // A plain division: 0 / 0 is NaN (na), x / 0 is +-infinity
    const raw = 0.66 * ((hl2Arr[i] - lowArr[i]) / (highArr[i] - lowArr[i]) - 0.5) + 0.67 * nzValue;
    value = gt(raw, 0.99) ? 0.999 : lt(raw, -0.99) ? -0.999 : raw;
    fish1 = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * nzFish1;
    fisher[i] = fish1;
  }

  const plotData0 = fisher.map((v, i) => ({
    time: bars[i].time,
    value: Number.isFinite(v) ? v : NaN,
  }));

  const plotData1 = fisher.map((_v, i) => {
    const prev = i > 0 ? fisher[i - 1] : NaN;
    return { time: bars[i].time, value: Number.isFinite(prev) ? prev : NaN };
  });

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': plotData0,
      'plot1': plotData1,
    },
  };
}

export const FisherTransform = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
};
