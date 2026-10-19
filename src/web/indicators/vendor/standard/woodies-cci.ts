// @ts-nocheck
/**
 * Woodies CCI Indicator
 *
 * Two CCIs of the close: CCI Turbo (length 6) and CCI 14 (length 14).
 * CCI 14 is also drawn as a histogram: teal when the last 5 CCI 14 values (bars 1 to 5 back) are all above 0,
 * red when they are all below 0, otherwise teal when CCI 14 is below 0 and red when not.
 */

import { Series, ta, type IndicatorResult, type InputConfig, type PlotConfig, type HLineConfig, type FillConfig, type Bar } from 'oakscriptjs';

export interface WoodiesCCIInputs {
  /** Turbo CCI period */
  turboLength: number;
  /** Standard CCI period */
  cciLength: number;
}

export const defaultInputs: WoodiesCCIInputs = {
  turboLength: 6,
  cciLength: 14,
};

export const inputConfig: InputConfig[] = [
  { id: 'turboLength', type: 'int', title: 'CCI Turbo Length', defval: 6, min: 3, max: 14 },
  { id: 'cciLength', type: 'int', title: 'CCI 14 Length', defval: 14, min: 7, max: 20 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'CCI Turbo Histogram', color: '#2962FF', lineWidth: 1, style: 'histogram' },
  { id: 'plot1', title: 'CCI Turbo', color: '#009688', lineWidth: 1 },
  { id: 'plot2', title: 'CCI 14', color: '#F44336', lineWidth: 1 },
];

export const hlineConfig: HLineConfig[] = [
  { id: 'hline_mid',   price: 0, color: '#787B86', linestyle: 'solid', title: 'Zero Line' },
  { id: 'hline_upper', price: 100, color: '#787B86', linestyle: 'dotted', title: 'Hundred Line' },
  { id: 'hline_lower', price: -100, color: '#787B86', linestyle: 'dotted', title: 'Minus Line' },
];

export const fillConfig: FillConfig[] = [];

export const metadata = {
  title: 'Woodies CCI',
  shortTitle: 'Woodies CCI',
  overlay: false,
};

/** Pine float comparisons: a > b only when a - b > 1e-10 (na compares false) */
const EPS = 1e-10;
const gt = (a: number, b: number) => a - b > EPS;
const lt = (a: number, b: number) => b - a > EPS;

export function calculate(bars: Bar[], inputs: Partial<WoodiesCCIInputs> = {}): IndicatorResult {
  const { turboLength, cciLength } = { ...defaultInputs, ...inputs };
  const A = (s: Series) => s.toArray().map((v) => v ?? NaN);

  // source = close; cciTurbo = ta.cci(source, cciTurboLength); cci14 = ta.cci(source, cci14Length)
  const source = new Series(bars, (b) => b.close);
  const cciTurbo = A(ta.cci(source, turboLength));
  const cci14 = A(ta.cci(source, cciLength));
  const back = (i: number, k: number) => (i - k >= 0 ? cci14[i - k] : NaN);

  const histogramData = cci14.map((v, i) => {
    let last5IsDown = true;
    let last5IsUp = true;
    for (let k = 5; k >= 1; k--) {
      last5IsDown = last5IsDown && lt(back(i, k), 0);
      last5IsUp = last5IsUp && gt(back(i, k), 0);
    }
    const color = last5IsUp ? '#009688' : last5IsDown ? '#F44336' : lt(v, 0) ? '#009688' : '#F44336';
    return { time: bars[i].time, value: v, color };
  });

  const turboData = cciTurbo.map((value, i) => ({ time: bars[i].time, value }));
  const cci14Data = cci14.map((value, i) => ({ time: bars[i].time, value }));

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': histogramData,
      'plot1': turboData,
      'plot2': cci14Data,
    },
  };
}

export const WoodiesCCI = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
  hlineConfig,
  fillConfig,
};
