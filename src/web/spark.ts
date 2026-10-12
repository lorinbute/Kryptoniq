// Tiny line charts (sparklines) for the market strip and the coin tiles (TD-REDESIGN).

/**
 * SVG path for `values` drawn into a `w` × `h` box (1 px vertical padding). Non-finite values are skipped,
 * fewer than two usable points give '' (nothing to draw) and a flat series is drawn through the middle.
 */
export function sparkPath(values: readonly number[], w: number, h: number): string {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2 || w <= 0 || h <= 0) return '';
  const first = pts[0]![0];
  const span = pts.at(-1)![0] - first;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of pts) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = 1;
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad));
  const x = (i: number) => ((i - first) / span) * w;
  return pts.map(([i, v], k) => `${k ? 'L' : 'M'}${round(x(i))} ${round(y(v))}`).join('');
}

/** Change in percent from the first to the last finite value, or null. */
export function sparkChange(values: readonly number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  const a = finite[0];
  const b = finite.at(-1);
  if (a === undefined || b === undefined || finite.length < 2 || a === 0) return null;
  return ((b - a) / a) * 100;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
