// @ts-nocheck
/**
 * Alert conditions of the built-ins (PineScript `alertcondition()`): the declaration on the registry entry and the
 * `alerts` of a result — per condition, the times of the bars on which it is true and whether it is true on the last
 * bar (the shape the script runtime gives, oakscriptjs AlertState).
 */
import type { Bar } from 'oakscriptjs';

/** One `alertcondition()` of a built-in: id, title and default message, as the reference declares them */
export interface AlertConditionDecl {
  id: string;
  title: string;
  message?: string;
}

/** One condition of a result: the bars (times as given in the input bars) on which it is true */
export interface AlertConditionState extends AlertConditionDecl {
  triggered: boolean;
  times: number[];
}

/** The states of `decls` from one flag per bar for each of them (`flags[k][i]`: condition k is true on bar i) */
export function alertStates(decls: AlertConditionDecl[], bars: Bar[], flags: boolean[][]): AlertConditionState[] {
  return decls.map((d, k) => {
    const f = flags[k] ?? [];
    const times: number[] = [];
    for (let i = 0; i < bars.length; i++) if (f[i]) times.push(bars[i].time as number);
    return { ...d, triggered: !!f[bars.length - 1], times };
  });
}

/** PineScript `ta.crossover(a, b)` per bar (values: numbers, na = NaN / null): a > b now and a <= b on the bar before */
export function crossedOver(a: ArrayLike<number | null | undefined>, b: number | ArrayLike<number | null | undefined>): boolean[] {
  const at = (x: number | ArrayLike<number | null | undefined>, i: number) => (typeof x === 'number' ? x : x[i] ?? NaN);
  const out: boolean[] = [];
  for (let i = 0; i < a.length; i++) {
    const v = a[i] ?? NaN, w = at(b, i), pv = i > 0 ? a[i - 1] ?? NaN : NaN, pw = i > 0 ? at(b, i - 1) : NaN;
    out.push(v > w && pv <= pw);
  }
  return out;
}

/** PineScript `ta.crossunder(a, b)` per bar: a < b now and a >= b on the bar before */
export function crossedUnder(a: ArrayLike<number | null | undefined>, b: number | ArrayLike<number | null | undefined>): boolean[] {
  const at = (x: number | ArrayLike<number | null | undefined>, i: number) => (typeof x === 'number' ? x : x[i] ?? NaN);
  const out: boolean[] = [];
  for (let i = 0; i < a.length; i++) {
    const v = a[i] ?? NaN, w = at(b, i), pv = i > 0 ? a[i - 1] ?? NaN : NaN, pw = i > 0 ? at(b, i - 1) : NaN;
    out.push(v < w && pv >= pw);
  }
  return out;
}
