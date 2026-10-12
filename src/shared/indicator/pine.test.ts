import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ema, Extreme, isNa, pivotHighAt, pivotLowAt, Rma, Rsi, Sma, StochSelf, trueRange } from './pine.ts';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/btc-usdt-1h.json', import.meta.url)), 'utf8')) as number[][];
const close = raw.map((r) => r[4] as number);
const high = raw.map((r) => r[2] as number);
const low = raw.map((r) => r[3] as number);

const closeTo = (a: number, b: number, rel = 1e-9) => {
  if (isNa(a) || isNa(b)) return isNa(a) && isNa(b);
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
};

// ---- Naive references: recompute everything from scratch for each bar ----
function naiveSma(src: number[], i: number, len: number): number {
  if (isNa(src[i] as number)) return NaN;
  const vals: number[] = [];
  for (let k = i; k >= 0 && vals.length < len; k--) if (!isNa(src[k] as number)) vals.push(src[k] as number);
  if (vals.length < len) return NaN;
  return vals.reduce((a, b) => a + b, 0) / len;
}

function naiveSmoothed(src: number[], len: number, step: (prev: number, x: number) => number): number[] {
  const out: number[] = [];
  let seeded = false;
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const x = src[i] as number;
    if (isNa(x)) {
      out.push(NaN);
      continue;
    }
    if (!seeded) {
      prev = naiveSma(src, i, len);
      if (!isNa(prev)) seeded = true;
      out.push(prev);
    } else {
      prev = step(prev, x);
      out.push(prev);
    }
  }
  return out;
}

describe('Sma', () => {
  it('matches the naive window average and is na-compacted', () => {
    const src = [1, 2, NaN, 3, 4, NaN, NaN, 5, 6];
    const m = new Sma(3);
    src.forEach((x, i) => expect(closeTo(m.next(x), naiveSma(src, i, 3))).toBe(true));
    const m2 = new Sma(3);
    expect(src.map((x) => m2.next(x))).toEqual([NaN, NaN, NaN, 2, 3, NaN, NaN, 4, 5]);
  });
});

describe('Ema / Rma', () => {
  it('Ema is seeded with SMA and matches the naive recursion on real data', () => {
    for (const len of [2, 14, 38, 62]) {
      const m = new Ema(len);
      const alpha = 2 / (len + 1);
      const ref = naiveSmoothed(close, len, (p, x) => p + alpha * (x - p));
      close.forEach((x, i) => expect(closeTo(m.next(x), ref[i] as number)).toBe(true));
    }
  });
  it('Ema first value equals the SMA of the first `len` closes', () => {
    const m = new Ema(5);
    const out = close.slice(0, 5).map((x) => m.next(x));
    expect(out.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(out[4]).toBeCloseTo(close.slice(0, 5).reduce((a, b) => a + b, 0) / 5, 8);
  });
  it('Ema(1) returns the source', () => {
    const m = new Ema(1);
    expect(m.next(42)).toBe(42);
  });
  it('Rma matches the Wilder recursion', () => {
    const len = 14;
    const m = new Rma(len);
    const ref = naiveSmoothed(close, len, (p, x) => (p * (len - 1) + x) / len);
    close.forEach((x, i) => expect(closeTo(m.next(x), ref[i] as number)).toBe(true));
  });
});

describe('Rsi', () => {
  it('matches a naive Wilder RSI on real data', () => {
    const len = 14;
    const m = new Rsi(len);
    const u: number[] = [NaN];
    const d: number[] = [NaN];
    for (let i = 1; i < close.length; i++) {
      u.push(Math.max((close[i] as number) - (close[i - 1] as number), 0));
      d.push(Math.max((close[i - 1] as number) - (close[i] as number), 0));
    }
    const ru = naiveSmoothed(u, len, (p, x) => (p * (len - 1) + x) / len);
    const rd = naiveSmoothed(d, len, (p, x) => (p * (len - 1) + x) / len);
    close.forEach((x, i) => {
      const got = m.next(x);
      const a = ru[i] as number;
      const b = rd[i] as number;
      const want = b <= 1e-10 ? 100 : a <= 1e-10 ? 0 : 100 - 100 / (1 + a / b);
      expect(closeTo(got, isNa(a) || isNa(b) ? NaN : want)).toBe(true);
    });
  });
  it('first defined value appears at bar `len`', () => {
    const m = new Rsi(14);
    const out = close.slice(0, 16).map((x) => m.next(x));
    expect(out.slice(0, 14).every(Number.isNaN)).toBe(true);
    expect(Number.isFinite(out[14])).toBe(true);
  });
  it('saturates on one-sided moves', () => {
    const up = new Rsi(3);
    const rising = [1, 2, 3, 4, 5, 6].map((x) => up.next(x));
    expect(rising.at(-1)).toBe(100);
    const down = new Rsi(3);
    const falling = [6, 5, 4, 3, 2, 1].map((x) => down.next(x));
    expect(falling.at(-1)).toBe(0);
    const flat = new Rsi(3);
    expect([1, 1, 1, 1, 1].map((x) => flat.next(x)).at(-1)).toBe(100); // both sides zero → 100
  });
});

describe('Extreme (ta.highest/lowest + bars)', () => {
  it('matches a naive window scan on real data', () => {
    for (const len of [1, 5, 11, 20]) {
      const hi = new Extreme(len, 'max');
      const lo = new Extreme(len, 'min');
      for (let i = 0; i < high.length; i++) {
        const h = hi.next(high[i] as number, i);
        const l = lo.next(low[i] as number, i);
        if (i < len - 1) {
          expect(Number.isNaN(h.value)).toBe(true);
          continue;
        }
        let bh = -Infinity;
        let bhOff = 0;
        let bl = Infinity;
        let blOff = 0;
        for (let k = 0; k < len; k++) {
          const vh = high[i - k] as number;
          const vl = low[i - k] as number;
          if (vh >= bh) {
            bh = vh;
            bhOff = k === 0 ? 0 : -k;
          }
          if (vl <= bl) {
            bl = vl;
            blOff = k === 0 ? 0 : -k;
          }
        }
        expect(h.value).toBe(bh);
        expect(h.offset).toBe(bhOff);
        expect(l.value).toBe(bl);
        expect(l.offset).toBe(blOff);
      }
    }
  });
  it('resolves ties to the oldest bar', () => {
    const hi = new Extreme(3, 'max');
    const out = [5, 7, 7, 7].map((x, i) => hi.next(x, i));
    expect(out[2]).toEqual({ value: 7, offset: -1 });
    expect(out[3]).toEqual({ value: 7, offset: -2 });
  });
  it('an na input resets the window', () => {
    const hi = new Extreme(3, 'max');
    hi.next(10, 0);
    hi.next(9, 1);
    expect(hi.next(NaN, 2)).toEqual({ value: NaN, offset: 0 });
    expect(hi.next(4, 3)).toEqual({ value: 4, offset: 0 });
    expect(hi.next(3, 4)).toEqual({ value: 4, offset: -1 });
  });
});

describe('pivots', () => {
  it('needs left + right bars of history', () => {
    expect(pivotHighAt([1, 3, 2], 1, 1, 1)).toBeNaN();
    expect(pivotHighAt([1, 3, 2], 2, 1, 1)).toBe(3);
  });
  it('pivot high: strict on the right, non-strict on the left', () => {
    expect(pivotHighAt([3, 3, 1], 2, 1, 1)).toBe(3); // equal left bar → still a pivot
    expect(pivotHighAt([1, 3, 3], 2, 1, 1)).toBeNaN(); // equal right bar → not a pivot
    expect(pivotHighAt([1, 3, 3, 1], 3, 1, 1)).toBe(3); // the newer of two equal tops is the pivot
  });
  it('pivot low mirrors pivot high', () => {
    expect(pivotLowAt([1, 1, 3], 2, 1, 1)).toBe(1);
    expect(pivotLowAt([3, 1, 1], 2, 1, 1)).toBeNaN();
  });
  it('detects real pivots consistent with the definition', () => {
    let count = 0;
    for (let i = 10; i < high.length; i++) {
      const p = pivotHighAt(high, i, 5, 5);
      if (!Number.isNaN(p)) {
        count++;
        const c = i - 5;
        for (let j = c + 1; j <= i; j++) expect(high[c]).toBeGreaterThan(high[j] as number);
        for (let j = c - 5; j < c; j++) expect(high[c]).toBeGreaterThanOrEqual(high[j] as number);
      }
    }
    expect(count).toBeGreaterThan(20);
  });
});

describe('trueRange & stoch', () => {
  it('trueRange uses high-low on the first bar', () => {
    expect(trueRange(10, 8, NaN)).toBe(2);
    expect(trueRange(10, 8, 12)).toBe(4);
    expect(trueRange(10, 8, 5)).toBe(5);
  });
  it('stoch of a flat window is na (0/0), not clamped otherwise', () => {
    const s = new StochSelf(3);
    expect(s.next(NaN, 0)).toBeNaN();
    expect(s.next(50, 1)).toBeNaN(); // bar_index < len - 1
    expect(s.next(50, 2)).toBeNaN(); // 0/0
    expect(s.next(60, 3)).toBe(100);
    expect(s.next(55, 4)).toBe(50);
  });
});

describe('RollingSum (math.sum) and Wma (ta.wma)', () => {
  it('math.sum is na until the window is full and skips na values', async () => {
    const { RollingSum } = await import('./pine.ts');
    const s = new RollingSum(3);
    expect([1, 2].map((x) => s.next(x)).every(Number.isNaN)).toBe(true);
    expect(s.next(3)).toBe(6);
    expect(s.next(NaN)).toBeNaN();
    expect(s.next(4)).toBe(9);
  });
  it('ta.wma weights the newest bar most and is na until `len` values', async () => {
    const { Wma } = await import('./pine.ts');
    const w = new Wma(3);
    expect(w.next(1)).toBeNaN();
    expect(w.next(2)).toBeNaN();
    // (1·1 + 2·2 + 3·3) / 6
    expect(w.next(3)).toBeCloseTo(14 / 6, 12);
    // (2·1 + 3·2 + 4·3) / 6
    expect(w.next(4)).toBeCloseTo(20 / 6, 12);
    // an na bar returns na and repeats the previous value inside the window
    expect(w.next(NaN)).toBeNaN();
    // window [4, 4, 5]: (4·1 + 4·2 + 5·3) / 6
    expect(w.next(5)).toBeCloseTo(27 / 6, 12);
  });
});
