// @ts-nocheck
/**
 * Money Flow Index (MFI) Indicator
 *
 * Volume-weighted RSI that measures buying and selling pressure.
 * Range: 0 to 100
 */

import { Series, ta, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type FillConfig, type Bar } from 'oakscriptjs';

export interface MFIInputs {
  /** Period length */
  length: number;
}

export const defaultInputs: MFIInputs = {
  length: 14,
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'Length', defval: 14, min: 1, max: 2000 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'MF', color: '#7E57C2', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_upper', price: 80, color: '#787B86', linestyle: 'dashed', title: 'Overbought' },
  { id: 'hline_mid',   price: 50, color: '#787B8680', linestyle: 'dashed', title: 'Middle Band' },
  { id: 'hline_lower', price: 20, color: '#787B86', linestyle: 'dashed', title: 'Oversold' },
];

export const fillConfig: FillConfig[] = [
  { id: 'fill_band', plot1: 'hline_upper', plot2: 'hline_lower', color: '#7E57C21A' },
];

export const metadata = {
  title: 'Money Flow Index',
  shortTitle: 'MFI',
  overlay: false,
};

export function calculate(bars: Bar[], inputs: Partial<MFIInputs> = {}): IndicatorResult {
  const { length } = { ...defaultInputs, ...inputs };

  // mf = ta.mfi(hlc3, length): upper = math.sum(volume * (ta.change(src) <= 0 ? 0 : src), length),
  // lower likewise with >= 0; 100 - 100 / (1 + upper / lower)
  const hlc3 = Series.fromArray(bars, bars.map((b) => (b.high + b.low + b.close) / 3));
  const volume = Series.fromArray(bars, bars.map((b) => b.volume ?? NaN));
  const mfiValues = ta.mfi(hlc3, length, volume).toArray();

  const mfiData = mfiValues.map((value, i) => ({
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
      'plot0': mfiData,
    },
  };
}

export const MFI = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
  fillConfig,
};
