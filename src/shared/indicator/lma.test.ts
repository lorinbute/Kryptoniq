import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Candle } from './slingshot.ts';
import { DEFAULT_LMA_PARAMS, effectiveLmaParams, LMA_MA_TYPES, lmaParamsSchema, type LmaParams } from './lma-params.ts';
import { brightness, colorNew, fromGradient, hexToRgba, runLma, TRANSPARENT, type Rgba } from './lma.ts';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/btc-usdt-1h.json', import.meta.url)), 'utf8')) as number[][];
const btc: Candle[] = raw.map((r) => ({ t: r[0] as number, o: r[1] as number, h: r[2] as number, l: r[3] as number, c: r[4] as number, v: r[5] as number }));

const flat = (n: number, price = 100, v = 1): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * 3_600_000, o: price, h: price, l: price, c: price, v }));
const P = (over: Partial<LmaParams> = {}): LmaParams => ({ ...DEFAULT_LMA_PARAMS, ...over });

const same = (a: number, b: number, rel = 1e-9) => (Number.isNaN(a) || Number.isNaN(b) ? Number.isNaN(a) && Number.isNaN(b) : Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)));

/**
 * Reference written straight from the Pine source, bar by bar, recomputing every series from scratch with history
 * lookups (no incremental state), so it shares no code with the port.
 */
function reference(candles: Candle[], params: LmaParams): number[] {
  const p = effectiveLmaParams(params);
  const close = candles.map((c) => c.c);
  const vol = candles.map((c) => c.v);
  const n = close.length;
  const at = (s: number[], b: number, i: number) => (b - i >= 0 ? (s[b - i] as number) : NaN);
  const weights = Array.from({ length: p.period }, (_, i) => 1 / Math.log(Math.max(i + p.steepness, 2)) ** 2);
  const total = weights.reduce((a, w) => a + w, 0);
  const lma: number[] = [];
  const sig: number[] = [];
  const logRet: number[] = [];
  for (let b = 0; b < n; b++) {
    let l = 0;
    for (let i = 0; i < p.period; i++) if (i <= b && !Number.isNaN(at(close, b, i))) l += at(close, b, i) * (weights[i] as number);
    lma.push(total > 0 ? l / total : (close[b] as number));
    const l10 = at(lma, b, 10);
    const slope = !Number.isNaN(l10) && l10 !== 0 ? (((lma[b] as number) - l10) / l10) * 100 : 0;
    const c1 = at(close, b, 1);
    logRet.push(!Number.isNaN(c1) && c1 > 0 && (close[b] as number) > 0 ? Math.log((close[b] as number) / c1) : 0);
    // math.sum: na until `period` values
    let mom = NaN;
    if (b >= p.period - 1) {
      let s = 0;
      for (let i = 0; i < p.period; i++) s += at(logRet, b, i);
      mom = (s * 252) / p.period;
    }
    let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0, k = 0; // prettier-ignore
    for (let i = 0; i < p.period; i++) {
      const c = at(close, b, i);
      if (!Number.isNaN(c) && c > 0) {
        const y = Math.log(c);
        sx += i;
        sy += y;
        sxy += i * y;
        sx2 += i * i;
        sy2 += y * y;
        k++;
      }
    }
    let corr = 0;
    if (k > 10) {
      const d = Math.sqrt((k * sx2 - sx * sx) * (k * sy2 - sy * sy));
      if (!Number.isNaN(d) && d !== 0) corr = (k * sxy - sx * sy) / d;
    }
    const r2 = Math.max(0, Math.min(1, corr * corr));
    let s = slope * (0.5 + r2 * 0.5);
    if (Math.sign(s) === Math.sign(mom) && Math.abs(mom) > 0.01) s *= p.momentumWeight;
    sig.push(s);
  }
  const len = p.smooth;
  const sma = (src: number[], b: number) => {
    if (b < len - 1) return NaN;
    let s = 0;
    for (let i = 0; i < len; i++) s += at(src, b, i);
    return s / len;
  };
  const out: number[] = [];
  for (let b = 0; b < n; b++) {
    const prev = b > 0 ? (out[b - 1] as number) : NaN;
    const x = sig[b] as number;
    switch (p.maType) {
      case 'SMA':
        out.push(sma(sig, b));
        break;
      case 'WMA': {
        if (b < len - 1) out.push(NaN);
        else {
          let s = 0;
          for (let i = 0; i < len; i++) s += at(sig, b, i) * (len - i);
          out.push(s / ((len * (len + 1)) / 2));
        }
        break;
      }
      case 'RMA':
        out.push(Number.isNaN(prev) ? sma(sig, b) : (prev * (len - 1) + x) / len);
        break;
      case 'VWMA': {
        const sv = sig.map((v, i) => v * (vol[i] as number));
        out.push(sma(sv, b) / sma(vol, b));
        break;
      }
      default: {
        const alpha = 2 / (len + 1);
        out.push(Number.isNaN(prev) ? sma(sig, b) : prev + alpha * (x - prev));
      }
    }
  }
  return out;
}

describe('LMA parameters', () => {
  it('has the Pine defaults and limits', () => {
    expect(DEFAULT_LMA_PARAMS).toMatchObject({ preset: 'Default', period: 100, steepness: 2.5, maType: 'EMA', smooth: 10, momentumWeight: 1.2, longThreshold: 0.5, shortThreshold: -0.5, bullishColor: '#00FFAA', bearishColor: '#B22833', neutralColor: '#FFFF00', colorBars: true });
    expect(lmaParamsSchema.safeParse({ period: 49 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ period: 201 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ period: 100.5 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ shortThreshold: 0.2 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ smooth: 2 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ maType: 'HMA' }).success).toBe(false);
    // Style tab
    expect(DEFAULT_LMA_PARAMS).toMatchObject({ showSignal: true, signalWidth: 3, showFill: true, showBarColors: true, showLongLine: true, longLineStyle: 'Dashed', showShortLine: true, shortLineStyle: 'Dashed', showNeutralLine: true, neutralLineStyle: 'Solid' });
    expect(lmaParamsSchema.safeParse({ signalWidth: 5 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ signalWidth: 0 }).success).toBe(false);
    expect(lmaParamsSchema.safeParse({ longLineStyle: 'Wavy' }).success).toBe(false);
    // values saved before the Style tab existed still parse, with its defaults
    expect(lmaParamsSchema.parse({ period: 120 })).toMatchObject({ period: 120, showFill: true, neutralLineStyle: 'Solid' });
  });

  it('applies the presets like the script: the four named ones force values, Default and Custom keep the inputs', () => {
    const mine = P({ period: 77, steepness: 4, smooth: 12, longThreshold: 1.5, shortThreshold: -1.5 });
    expect(effectiveLmaParams({ ...mine, preset: 'Default' })).toMatchObject({ period: 77, steepness: 4, smooth: 12, longThreshold: 1.5 });
    expect(effectiveLmaParams({ ...mine, preset: 'Custom' })).toMatchObject({ period: 77, smooth: 12 });
    expect(effectiveLmaParams({ ...mine, preset: 'Scalping' })).toMatchObject({ period: 60, steepness: 3, smooth: 5, longThreshold: 0.3, shortThreshold: -0.3 });
    expect(effectiveLmaParams({ ...mine, preset: 'Swing Trading' })).toMatchObject({ period: 120, steepness: 2, smooth: 15, longThreshold: 0.7, shortThreshold: -0.7 });
    expect(effectiveLmaParams({ ...mine, preset: 'Trend Following' })).toMatchObject({ period: 150, steepness: 1.8, smooth: 20, longThreshold: 1, shortThreshold: -1 });
    expect(effectiveLmaParams({ ...mine, preset: 'Mean Reversion' })).toMatchObject({ period: 80, steepness: 3.5, smooth: 8, longThreshold: 0.4, shortThreshold: -0.4 });
    // Not forced by any preset.
    expect(effectiveLmaParams({ ...mine, preset: 'Scalping', maType: 'WMA', momentumWeight: 1.7 })).toMatchObject({ maType: 'WMA', momentumWeight: 1.7 });
  });
});

describe('LMA colours (color.* semantics)', () => {
  const bull = hexToRgba('#00FFAA');
  const neutral = hexToRgba('#FFFF00');
  it('color.new sets the alpha byte like TradingView', () => {
    expect(colorNew(bull, 10).a).toBe(230);
    expect(colorNew(bull, 30).a).toBe(179);
    expect(colorNew(bull, 90).a).toBe(25);
    expect(colorNew(bull, 0).a).toBe(255);
    expect(colorNew(bull, 100).a).toBe(0);
  });
  it('color.from_gradient clamps, mixes and truncates like TradingView', () => {
    // halfway between yellow (255,255,0) and #00FFAA (0,255,170): trunc(127.5)=127, 255, trunc(85)=85
    expect(fromGradient(0.25, 0, 0.5, neutral, bull)).toEqual({ r: 127, g: 255, b: 85, a: 255 });
    expect(fromGradient(-1, 0, 0.5, neutral, bull)).toEqual(neutral);
    expect(fromGradient(9, 0, 0.5, neutral, bull)).toEqual(bull);
    expect(fromGradient(NaN, 0, 0.5, neutral, bull)).toEqual(TRANSPARENT);
    expect(fromGradient(0.2, 0.5, 0.5, neutral, bull)).toEqual(TRANSPARENT);
    // premultiplied alpha: a transparent end contributes no hue
    const clear: Rgba = { r: 255, g: 0, b: 0, a: 0 };
    expect(fromGradient(0.5, 0, 1, clear, bull)).toEqual({ r: 0, g: 255, b: 170, a: 127 });
  });
  it('picks black text on light colours, white on dark ones', () => {
    expect(brightness(neutral)).toBeGreaterThan(150);
    expect(brightness(hexToRgba('#B22833'))).toBeLessThan(150);
  });
});

describe('runLma', () => {
  it('matches a from-scratch reference of the Pine script on 600 BTC/USDT 1h bars, for every smoothing type', () => {
    const candles = btc.slice(0, 600);
    for (const maType of LMA_MA_TYPES) {
      for (const preset of ['Default', 'Scalping', 'Trend Following'] as const) {
        const params = P({ maType, preset });
        const got = runLma(candles, params).signal;
        const want = reference(candles, params);
        const bad = got.findIndex((v, i) => !same(v, want[i] as number, 1e-7));
        expect(bad, `${maType}/${preset} first mismatch at bar ${bad}: ${got[bad]} vs ${want[bad]}`).toBe(-1);
      }
    }
  });

  it('warms up like Pine: na until the smoothing has `smooth` values, no slope before bar 10, no momentum boost before `period` bars', () => {
    const candles = btc.slice(0, 300);
    const r = runLma(candles, P());
    expect(r.signal.slice(0, 9).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(r.signal[9] as number)).toBe(false);
    // Before bar 10 the slope is 0, so the raw signal is 0 and its first EMA seed (SMA of 10 zeros) is 0.
    expect(r.signal[9]).toBe(0);
    // With a momentum weight of 1 nothing changes before bar period-1 (momentum is na there).
    const a = runLma(candles, P({ momentumWeight: 1 })).signal;
    const b = runLma(candles, P({ momentumWeight: 2 })).signal;
    expect(a.slice(0, 99)).toEqual(b.slice(0, 99));
    expect(a.slice(99).some((v, i) => v !== b[99 + i])).toBe(true);
  });

  it('gives finite values on constant prices and settles to 0 / NEUTRAL once the warm-up is over', () => {
    // During the first `period` bars the LMA rises (it is divided by the full weight sum, as in Pine), so the
    // warm-up shows a slope even on a flat market; afterwards the slope is exactly 0.
    const r = runLma(flat(600), P());
    expect(r.signal.slice(9).every(Number.isFinite)).toBe(true);
    expect(Math.abs(r.signal.at(-1) as number)).toBeLessThan(1e-6);
    expect(r.state.slice(-100).every((st) => st === 'NEUTRAL')).toBe(true);
    expect(r.color.at(-1)).toEqual(hexToRgba('#FFFF00'));
  });

  it('VWMA with zero volume is na (0 / 0), like Pine', () => {
    const r = runLma(flat(120, 100, 0), P({ maType: 'VWMA' }));
    expect(r.signal.every(Number.isNaN)).toBe(true);
    expect(new Set(r.state)).toEqual(new Set(['NEUTRAL']));
  });

  it('classifies states and colours against the thresholds', () => {
    const up = Array.from({ length: 400 }, (_, i) => ({ t: i, o: 100 * 1.004 ** i, h: 100 * 1.004 ** i, l: 100 * 1.004 ** i, c: 100 * 1.004 ** i, v: 1 }));
    const r = runLma(up, P());
    const last = r.signal.at(-1) as number;
    expect(last).toBeGreaterThan(0.5);
    expect(r.state.at(-1)).toBe('BULLISH');
    expect(r.color.at(-1)).toEqual(hexToRgba('#00FFAA'));
    const down = up.map((c) => ({ ...c, o: 1e6 / c.o, h: 1e6 / c.h, l: 1e6 / c.l, c: 1e6 / c.c }));
    const d = runLma(down, P());
    expect(d.state.at(-1)).toBe('BEARISH');
    expect(d.color.at(-1)).toEqual(hexToRgba('#B22833'));
    // A gentle trend ends between 0 and the long threshold: the colour is a gradient from neutral to bullish.
    const gentle = up.map((c, i) => ({ ...c, c: 100 * 1.0003 ** i }));
    const g = runLma(gentle, P());
    const v = g.signal.at(-1) as number;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.5);
    expect(g.state.at(-1)).toBe('NEUTRAL');
    expect(g.color.at(-1)).toEqual(fromGradient(v, 0, 0.5, hexToRgba('#FFFF00'), hexToRgba('#00FFAA')));
    expect(g.color.at(-1)).not.toEqual(hexToRgba('#00FFAA'));
    expect(g.color.at(-1)).not.toEqual(hexToRgba('#FFFF00'));
  });
});
