// Pine Script v5 `ta.*` primitives with TradingView semantics (see docs/research.md §5).
// `na` is represented as NaN. Pine's na() also treats ±Infinity as na, hence `isNa`.

export const isNa = (x: number): boolean => !Number.isFinite(x);

/** ta.sma — the window is na-compacted: an na input returns na and is not stored. */
export class Sma {
  private readonly buf: number[] = [];
  private readonly len: number;
  constructor(len: number) {
    this.len = len;
  }
  next(x: number): number {
    if (this.len < 1) return NaN;
    if (isNa(x)) return NaN;
    this.buf.push(x);
    if (this.buf.length > this.len) this.buf.shift();
    if (this.buf.length < this.len) return NaN;
    let sum = 0;
    for (const v of this.buf) sum += v;
    return sum / this.len;
  }
}

/** math.sum — the window is na-compacted like ta.sma: na until `len` non-na values, an na input returns na. */
export class RollingSum {
  private readonly buf: number[] = [];
  private readonly len: number;
  constructor(len: number) {
    this.len = Math.trunc(len);
  }
  next(x: number): number {
    if (this.len < 1) return NaN;
    if (isNa(x)) return NaN;
    this.buf.push(x);
    if (this.buf.length > this.len) this.buf.shift();
    if (this.buf.length < this.len) return NaN;
    let sum = 0;
    for (const v of this.buf) sum += v;
    return sum;
  }
}

/**
 * ta.wma — weights 1…len from the OLDEST bar to the newest, divided by 1 + 2 + … + len (PyneCore's measured law).
 * The window is not compacted: an na bar repeats the previous value, and the na bar itself returns na.
 */
export class Wma {
  private readonly buf: number[] = [];
  private readonly len: number;
  private count = 0;
  private last = NaN;
  private readonly norm: number;
  constructor(len: number) {
    this.len = Math.trunc(len);
    let n = 0;
    for (let i = 1; i <= this.len; i++) n += i;
    this.norm = n;
  }
  next(x: number): number {
    if (this.len < 1) return NaN;
    const na = isNa(x);
    if (!na) {
      this.count++;
      this.last = x;
    }
    this.buf.push(this.last);
    if (this.buf.length > this.len) this.buf.shift();
    if (na || this.count < this.len) return NaN;
    let sum = 0;
    let weight = 0;
    for (const v of this.buf) {
      weight += 1;
      sum += v * weight;
    }
    return sum / this.norm;
  }
}

/** ta.ema — seeded with the na-compacted SMA, then `prev + alpha * (x - prev)`. */
export class Ema {
  private last = NaN;
  private readonly alpha: number;
  private readonly seed: Sma;
  private readonly len: number;
  constructor(len: number) {
    this.len = len;
    this.alpha = 2 / (len + 1);
    this.seed = new Sma(len);
  }
  next(x: number): number {
    if (this.len === 1) return x;
    if (isNa(x)) return NaN;
    if (isNa(this.last)) {
      this.last = this.seed.next(x);
      return this.last;
    }
    this.last = this.last + this.alpha * (x - this.last);
    return this.last;
  }
}

/** ta.rma (Wilder) — seeded with the SMA, then `(prev * (len - 1) + x) / len`. */
export class Rma {
  private last = NaN;
  private readonly seed: Sma;
  private readonly len: number;
  constructor(len: number) {
    this.len = len;
    this.seed = new Sma(len);
  }
  next(x: number): number {
    if (this.len === 1) return x;
    if (isNa(x)) return NaN;
    if (isNa(this.last)) {
      this.last = this.seed.next(x);
      return this.last;
    }
    this.last = (this.last * (this.len - 1) + x) / this.len;
    return this.last;
  }
}

/** ta.rsi — saturates to 100 / 0 when one side is below Pine's 1e-10 tolerance. */
export class Rsi {
  private prev = NaN;
  private readonly up: Rma;
  private readonly down: Rma;
  constructor(len: number) {
    this.up = new Rma(len);
    this.down = new Rma(len);
  }
  next(x: number): number {
    if (isNa(x)) return NaN;
    if (isNa(this.prev)) {
      this.prev = x;
      return NaN;
    }
    const u = this.up.next(Math.max(x - this.prev, 0));
    const d = this.down.next(Math.max(this.prev - x, 0));
    this.prev = x;
    if (d <= 1e-10) return 100;
    if (u <= 1e-10) return 0;
    return 100 - 100 / (1 + u / d);
  }
}

export interface ExtremeResult {
  value: number;
  /** Offset as returned by ta.highestbars / ta.lowestbars (0 or negative). */
  offset: number;
}

/**
 * ta.highest / ta.lowest (+ ...bars) for a fixed length.
 * The window only holds values seen since the first call / the last na call (an na input resets it),
 * which reproduces TradingView's warm-up behaviour. Ties resolve to the OLDEST bar.
 * Must be called on every bar (with the bar index) when used at series level.
 */
export class Extreme {
  private readonly vals: number[] = [];
  private readonly len: number;
  private readonly mode: 'max' | 'min';
  constructor(len: number, mode: 'max' | 'min') {
    this.len = len;
    this.mode = mode;
  }
  next(x: number, barIndex: number): ExtremeResult {
    if (isNa(x)) {
      this.vals.length = 0;
      if (barIndex < this.len - 1) return { value: NaN, offset: NaN };
      return { value: NaN, offset: 0 };
    }
    this.vals.push(x);
    if (this.vals.length > this.len) this.vals.shift();
    if (barIndex < this.len - 1) return { value: NaN, offset: NaN };
    let best = NaN;
    let bestOffset = 0;
    // Scan newest → oldest; on equality keep moving to the older bar.
    for (let k = 0; k < this.vals.length; k++) {
      const v = this.vals[this.vals.length - 1 - k] as number;
      if (isNa(best)) {
        best = v;
        bestOffset = k;
      } else if (this.mode === 'max' ? v >= best : v <= best) {
        best = v;
        bestOffset = k;
      }
    }
    return { value: best, offset: bestOffset === 0 ? 0 : -bestOffset };
  }
}

/**
 * ta.pivothigh(src, left, right) evaluated at bar `i` over a full source array.
 * The centre bar (i - right) must be strictly greater than every bar on its right and
 * greater than or equal to every bar on its left. Returns the pivot value or NaN.
 */
export function pivotHighAt(src: ArrayLike<number>, i: number, left: number, right: number): number {
  return pivotAt(src, i, left, right, 'high');
}

/** ta.pivotlow — mirror of pivotHighAt (strictly lower than the right side, ≤ the left side). */
export function pivotLowAt(src: ArrayLike<number>, i: number, left: number, right: number): number {
  return pivotAt(src, i, left, right, 'low');
}

function pivotAt(src: ArrayLike<number>, i: number, left: number, right: number, kind: 'high' | 'low'): number {
  if (i < left + right) return NaN;
  const c = i - right;
  const cv = src[c] as number;
  if (isNa(cv)) return NaN;
  for (let j = c + 1; j <= i; j++) {
    const v = src[j] as number;
    if (isNa(v)) return NaN;
    if (kind === 'high' ? !(cv > v) : !(cv < v)) return NaN;
  }
  for (let j = c - left; j < c; j++) {
    const v = src[j] as number;
    if (isNa(v)) return NaN;
    if (kind === 'high' ? !(cv >= v) : !(cv <= v)) return NaN;
  }
  return cv;
}

/** ta.tr(true): high - low on the first bar, Wilder's true range afterwards. */
export function trueRange(high: number, low: number, prevClose: number): number {
  if (isNa(prevClose)) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * ta.stoch(src, high, low, len) where the same series feeds all three arguments (as in
 * `ta.stoch(rsi, rsi, rsi, len)`). Pine returns na before touching the windows when any
 * argument is na, so the windows are only fed non-na values.
 */
export class StochSelf {
  private readonly hi: Extreme;
  private readonly lo: Extreme;
  private readonly len: number;
  constructor(len: number) {
    this.len = len;
    this.hi = new Extreme(len, 'max');
    this.lo = new Extreme(len, 'min');
  }
  next(x: number, barIndex: number): number {
    if (isNa(x)) return NaN;
    const h = this.hi.next(x, barIndex).value;
    const l = this.lo.next(x, barIndex).value;
    if (barIndex < this.len - 1) return NaN;
    return (100 * (x - l)) / (h - l);
  }
}
