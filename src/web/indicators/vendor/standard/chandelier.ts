// @ts-nocheck
/**
 * Chandelier Exit
 *
 * Trailing exit levels at a multiple of the Average True Range from the highest high and the lowest low:
 *
 *   atr        = atr(atrLength) * multiplier
 *   Long exit  = highest(high, length) - atr
 *   Short exit = lowest(low, length) + atr
 *
 * Based on the standard Chandelier Exit indicator. The function chandelier of the standard "ta" library is ported in
 * this file.
 */

import { taCore, type IndicatorResult, type InputConfig, type PlotConfig, type Bar } from 'oakscriptjs';

export interface ChandelierExitStandardInputs {
  /** Bars of the highest high and lowest low */
  length: number;
  /** ATR length */
  atrLength: number;
  /** ATR multiplier */
  atrMult: number;
}

export const defaultInputs: ChandelierExitStandardInputs = {
  length: 22,
  atrLength: 22,
  atrMult: 3.0,
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'Length', defval: 22, min: 1 },
  { id: 'atrLength', type: 'int', title: 'ATR length', defval: 22, min: 1 },
  { id: 'atrMult', type: 'float', title: 'ATR multiplier', defval: 3.0, min: 0.0, step: 0.01 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Long exit', color: '#2962FF', lineWidth: 1 },
  { id: 'plot1', title: 'Short exit', color: '#FF6D00', lineWidth: 1 },
];

export const metadata = {
  title: 'Chandelier Exit',
  shortTitle: 'Chandelier',
  overlay: true,
};

export function calculate(bars: Bar[], inputs: Partial<ChandelierExitStandardInputs> = {}): IndicatorResult {
  const { length, atrLength, atrMult } = { ...defaultInputs, ...inputs };
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);

  // chandelier() of the "ta" library
  const atr = taCore.atr(atrLength, high, low, close).map((v) => v * atrMult);
  const highest = taCore.highest(high, length);
  const lowest = taCore.lowest(low, length);

  const point = (v: number, i: number) => ({ time: bars[i].time, value: Number.isFinite(v) ? v : NaN });
  return {
    metadata: { title: metadata.title, shorttitle: metadata.shortTitle, overlay: metadata.overlay },
    plots: {
      plot0: highest.map((h, i) => point(h - atr[i], i)),
      plot1: lowest.map((l, i) => point(l + atr[i], i)),
    },
  };
}

export const ChandelierExitStandard = { calculate, metadata, defaultInputs, inputConfig, plotConfig };
