// Port of "[DI] Logarithmic Moving Average" (Pine v6, © Dusty Investments) — TD-CHARTUX §2.
// Bar-by-bar, with TradingView's semantics for na, ta.* and color.* (see docs/research.md §5 and PyneCore).
import type { Candle } from './slingshot.ts';
import { effectiveLmaParams, type LmaMaType, type LmaParams } from './lma-params.ts';
import { Ema, isNa, Rma, RollingSum, Sma, Wma } from './pine.ts';

/** A Pine colour: 0–255 channels and an alpha byte (255 = opaque). */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type LmaState = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface LmaResult {
  /** `smoothSignal` per bar (NaN = na). */
  signal: number[];
  /** `signalColor` per bar (also the bar colour when "Color Price Bars" is on). */
  color: Rgba[];
  /** `positionState` per bar. */
  state: LmaState[];
  /** The parameters after the preset was applied. */
  effective: LmaParams;
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
/** Pine v6 built-in colours used by the script. */
export const PINE_GRAY = '#787B86';
export const PINE_BLACK = '#363A45';
export const PINE_WHITE = '#FFFFFF';

/** #RRGGBB, or #RRGGBBAA with the opacity the user chose (FD-OPACITY): Pine's input.color carries it too. */
export function hexToRgba(hex: string): Rgba {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255 };
}

export function rgbaCss(c: Rgba): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round((c.a / 255) * 1000) / 1000})`;
}

/** color.new(c, transp): replaces the alpha with `floor((1 - transp / 100) * 255 + 0.5)`. */
export function colorNew(c: Rgba, transp: number): Rgba {
  const a = transp <= 0 ? 255 : transp >= 100 ? 0 : Math.floor((1 - transp / 100) * 255 + 0.5);
  return { ...c, a };
}

/**
 * color.from_gradient as TradingView computes it (PyneCore's measured law): the value is clamped into the range,
 * the alpha mixes as a byte and the channels are mixed premultiplied by their alpha, then truncated.
 */
export function fromGradient(value: number, bottomValue: number, topValue: number, bottom: Rgba, top: Rgba): Rgba {
  if (Number.isNaN(value) || Number.isNaN(bottomValue) || Number.isNaN(topValue)) return TRANSPARENT;
  const span = topValue - bottomValue;
  if (span === 0) return TRANSPARENT;
  const position = (Math.max(Math.min(value, topValue), bottomValue) - bottomValue) / span;
  const rest = 1 - position;
  const alpha = bottom.a * rest + top.a * position;
  if (alpha === 0) return TRANSPARENT;
  const scale = alpha / 255;
  const bw = bottom.a / 255;
  const tw = top.a / 255;
  const mix = (b: number, t: number) => Math.trunc((bw * b * rest + tw * t * position) / scale);
  return { r: mix(bottom.r, top.r), g: mix(bottom.g, top.g), b: mix(bottom.b, top.b), a: Math.trunc(alpha) };
}

/** The script's getBrightness(): above 150 the label text is black, otherwise white. */
export function brightness(c: Rgba): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/** getMa(): the smoothing average chosen in the inputs (unknown types fall back to EMA, as in the script). */
function smoother(type: LmaMaType, len: number): (x: number, volume: number) => number {
  switch (type) {
    case 'SMA': {
      const s = new Sma(len);
      return (x) => s.next(x);
    }
    case 'WMA': {
      const s = new Wma(len);
      return (x) => s.next(x);
    }
    case 'RMA': {
      const s = new Rma(len);
      return (x) => s.next(x);
    }
    case 'VWMA': {
      // ta.vwma = ta.sma(src * volume, len) / ta.sma(volume, len)
      const num = new Sma(len);
      const den = new Sma(len);
      return (x, v) => num.next(x * v) / den.next(v);
    }
    default: {
      const s = new Ema(len);
      return (x) => s.next(x);
    }
  }
}

export function runLma(candles: readonly Candle[], params: LmaParams): LmaResult {
  const p = effectiveLmaParams(params);
  const period = Math.trunc(p.period);
  const n = candles.length;
  const close = candles.map((c) => c.c);

  // Logarithmic weights (rebuilt on every bar in Pine; the values never change).
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i <= period - 1; i++) {
    const logArg = Math.max(i + p.steepness, 2.0);
    const w = 1.0 / Math.pow(Math.log(logArg), 2);
    weights.push(w);
    totalWeight = totalWeight + w;
  }

  const bull = hexToRgba(p.bullishColor);
  const bear = hexToRgba(p.bearishColor);
  const neutral = hexToRgba(p.neutralColor);
  const sumReturns = new RollingSum(period);
  const smooth = smoother(p.maType, p.smooth);

  const lma: number[] = new Array(n);
  const signal: number[] = new Array(n);
  const color: Rgba[] = new Array(n);
  const state: LmaState[] = new Array(n);

  for (let b = 0; b < n; b++) {
    const closeAt = (i: number) => (b - i >= 0 ? (close[b - i] as number) : NaN);
    const c0 = close[b] as number;

    let l = 0.0;
    for (let i = 0; i <= period - 1; i++) {
      const ci = closeAt(i);
      if (i <= b && !isNa(ci)) l = l + ci * (weights[i] as number);
    }
    l = totalWeight > 0 ? l / totalWeight : c0;
    lma[b] = l;

    let lmaSlope = 0.0;
    const l10 = b >= 10 ? (lma[b - 10] as number) : NaN;
    if (!isNa(l10) && l10 !== 0) lmaSlope = ((l - l10) / l10) * 100;

    let logReturns = 0.0;
    const c1 = closeAt(1);
    if (!isNa(c1) && c1 > 0 && c0 > 0) logReturns = Math.log(c0 / c1);
    const logMomentum = (sumReturns.next(logReturns) * 252) / period;

    let sumX = 0.0;
    let sumY = 0.0;
    let sumXY = 0.0;
    let sumX2 = 0.0;
    let sumY2 = 0.0;
    let validPoints = 0;
    for (let i = 0; i <= period - 1; i++) {
      const ci = closeAt(i);
      if (!isNa(ci) && ci > 0) {
        const x = i;
        const y = Math.log(ci);
        sumX = sumX + x;
        sumY = sumY + y;
        sumXY = sumXY + x * y;
        sumX2 = sumX2 + x * x;
        sumY2 = sumY2 + y * y;
        validPoints = validPoints + 1;
      }
    }
    let correlation = 0.0;
    if (validPoints > 10) {
      const denominator = Math.sqrt((validPoints * sumX2 - sumX * sumX) * (validPoints * sumY2 - sumY * sumY));
      // Pine: `if denominator != 0` is false for na (a negative product from rounding gives na).
      if (!Number.isNaN(denominator) && denominator !== 0) correlation = (validPoints * sumXY - sumX * sumY) / denominator;
    }
    const rSquared = Math.max(0, Math.min(1, correlation * correlation));

    let sig = lmaSlope * (0.5 + rSquared * 0.5);
    if (Math.sign(sig) === Math.sign(logMomentum) && Math.abs(logMomentum) > 0.01) sig = sig * p.momentumWeight;

    const s = smooth(sig, candles[b]?.v ?? NaN);
    signal[b] = s;
    state[b] = s > p.longThreshold ? 'BULLISH' : s < p.shortThreshold ? 'BEARISH' : 'NEUTRAL';
    color[b] =
      s > p.longThreshold
        ? bull
        : s > 0
          ? fromGradient(s, 0, p.longThreshold, neutral, bull)
          : s < p.shortThreshold
            ? bear
            : s < 0
              ? fromGradient(s, p.shortThreshold, 0, bear, neutral)
              : neutral;
  }

  return { signal, color, state, effective: p };
}
