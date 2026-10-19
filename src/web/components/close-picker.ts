// The eToro positions of a holding, one row each with its own "Vinde" (FD-ETOROROWS): their order, their P/L %, and
// what a row's "De vândut" field may hold.
import type { ClosablePosition } from '../../shared/trading.ts';

/** The holding's positions, oldest first (those without a date keep eToro's order, after the dated ones). */
export function closeRows(positions: readonly ClosablePosition[], ids: readonly string[]): ClosablePosition[] {
  const want = new Set(ids);
  const rows = positions.filter((p) => want.has(p.id));
  return rows
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.openedAt ?? Infinity) - (b.p.openedAt ?? Infinity) || a.i - b.i)
    .map((x) => x.p);
}

/** Its P/L against what was put in, %. */
export const pnlPct = (p: ClosablePosition) => (p.pnl !== null && p.invested !== null && p.invested > 0 ? (p.pnl / p.invested) * 100 : null);

/** Why a row's "De vândut" cannot be sent, or null: empty (the whole position) or a positive number within its units. */
export function rowUnitsProblem(text: string, units: number): string | null {
  const t = text.replace(',', '.').trim();
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return 'un număr pozitiv';
  if (v > units + 1e-9) return `cel mult ${units}`;
  return null;
}
