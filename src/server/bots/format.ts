// Numbers in the bots' words (the summary, the journal), as the pages write them: 84.425,3 (FD-BOT §7).
const formats = new Map<string, Intl.NumberFormat>();

/** A number with at most `max` decimals (at least `min`), in Romanian. */
export function num(v: number, max = 2, min = 0): string {
  const key = `${min}|${max}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: min, maximumFractionDigits: max });
    formats.set(key, f);
  }
  return f.format(v);
}

/** A price with the decimals it needs: 2 from 1 000, 4 from 1, more below. */
export const price = (v: number): string => {
  const a = Math.abs(v);
  return num(v, a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8);
};

/** An amount of an asset (up to 8 decimals). */
export const qty = (v: number): string => num(v, 8);

/** A profit with its sign: +12,30 / −4,10. */
export const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 2, 2)}`;
