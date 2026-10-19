// @ts-nocheck
/**
 * Volatility Stop
 *
 * An ATR-based trailing stop (SAR-like). Flips between long and short when the source crosses the stop:
 *
 *   atrM = nz(atr(length) * factor, tr)
 *   max  = max(max, src);  min = min(min, src)
 *   stop = nz(uptrend ? max(stop, max - atrM) : min(stop, min + atrM), src)
 *   uptrend = src - stop >= 0
 *   on a flip (not on the first bar): reset max / min to src and stop to the opposite band
 *
 * The stop is drawn as crosses, teal in an uptrend and red in a downtrend.
 * Based on the standard "Volatility Stop" indicator.
 */

import { ta, getSourceSeries, type IndicatorResult, type InputConfig, type PlotConfig, type Bar, type SourceType } from 'oakscriptjs';

export interface VolatilityStopInputs {
  /** ATR length */
  length: number;
  /** Source */
  src: SourceType;
  /** ATR multiplier */
  factor: number;
}

export const defaultInputs: VolatilityStopInputs = {
  length: 20,
  src: 'close',
  factor: 2.0,
};

export const inputConfig: InputConfig[] = [
  { id: 'length', type: 'int', title: 'Length', defval: 20, min: 2 },
  { id: 'src', type: 'source', title: 'Source', defval: 'close' },
  { id: 'factor', type: 'float', title: 'Multiplier', defval: 2.0, min: 0.25, step: 0.25 },
];

export const plotConfig: PlotConfig[] = [
  { id: 'plot0', title: 'Volatility Stop', color: '#009688', lineWidth: 1, style: 'cross' },
];

export const metadata = {
  title: 'Volatility Stop',
  shortTitle: 'VStop',
  overlay: true,
};

/** Pine float comparisons: a >= b unless b - a > 1e-10 (na compares false) */
const EPS = 1e-10;
const ge = (a: number, b: number) => !isNaN(a) && !isNaN(b) && !(b - a > EPS);
/** Pine math.max / math.min: na when an argument is na */
const pmax = (a: number, b: number) => (isNaN(a) || isNaN(b) ? NaN : Math.max(a, b));
const pmin = (a: number, b: number) => (isNaN(a) || isNaN(b) ? NaN : Math.min(a, b));

export function calculate(bars: Bar[], inputs: Partial<VolatilityStopInputs> = {}): IndicatorResult {
  const { length, src: srcInput, factor } = { ...defaultInputs, ...inputs };
  const A = (s: { toArray(): (number | null)[] }) => s.toArray().map((v) => v ?? NaN);

  const srcArr = A(getSourceSeries(bars, srcInput));
  const trArr = A(ta.tr(bars, false)); // ta.tr: na on the first bar
  const atrArr = A(ta.atr(bars, length));

  const data: { time: number; value: number; color: string }[] = [];

  // var max = src; var min = src; var uptrend = true; var float stop = na (inside `if not na(src)`)
  let started = false;
  let max = NaN;
  let min = NaN;
  let uptrend = true;
  let stop = NaN;
  let first = true; // barstate.isfirst

  for (let i = 0; i < bars.length; i++) {
    const src = srcArr[i];
    let value = NaN;
    if (!isNaN(src)) {
      if (!started) {
        max = src;
        min = src;
        started = true;
      }
      // atrM = nz(ta.atr(atrlen) * atrfactor, ta.tr)
      const atrScaled = atrArr[i] * factor;
      const atrM = isNaN(atrScaled) ? trArr[i] : atrScaled;
      max = pmax(max, src);
      min = pmin(min, src);
      const next = uptrend ? pmax(stop, max - atrM) : pmin(stop, min + atrM);
      stop = isNaN(next) ? src : next;
      const prevUptrend: boolean = uptrend; // uptrend[1]
      uptrend = ge(src - stop, 0);
      if (uptrend !== prevUptrend && !first) {
        max = src;
        min = src;
        stop = uptrend ? max - atrM : min + atrM;
      }
      value = stop;
    }
    first = false;
    // plot(vStop, "Volatility Stop", style = plot.style_cross, color = uptrend ? #009688 : #F44336)
    data.push({ time: bars[i].time, value, color: uptrend ? '#009688' : '#F44336' });
  }

  return {
    metadata: {
      title: metadata.title,
      shorttitle: metadata.shortTitle,
      overlay: metadata.overlay,
    },
    plots: {
      'plot0': data,
    },
  };
}

export const VolatilityStop = {
  calculate,
  metadata,
  defaultInputs,
  inputConfig,
  plotConfig,
};
