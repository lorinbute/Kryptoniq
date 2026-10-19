// FD-ETOROROWS: the eToro positions of a holding, one row each with its own "Vinde".
import { describe, expect, it } from 'vitest';
import type { ClosablePosition } from '../../shared/trading.ts';
import { closeRows, pnlPct, rowUnitsProblem } from './close-picker.ts';

const pos = (id: string, units: number, pnl: number | null, openedAt: number | null, invested: number | null = 100): ClosablePosition => ({ id, units, openRate: 10, openedAt, pnl, invested, isBuy: true, leverage: 1 });
const all = [pos('a', 2, 15, 3000), pos('b', 3, -8, 1000), pos('c', 1.5, null, null), pos('d', 4, 0, 2000), pos('x', 9, 50, 500)];

describe('the rows of the positions', () => {
  it("the holding's ones, oldest first; those without a date after, in eToro's order", () => {
    expect(closeRows(all, ['a', 'b', 'c', 'd']).map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
    // A position not in the holding (another instrument's, a copied one) is not listed.
    expect(closeRows(all, ['a', 'c']).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('the P/L against what was put in', () => {
    expect(pnlPct(pos('a', 2, 15, 1, 300))).toBe(5);
    expect(pnlPct(pos('a', 2, 15, 1, null))).toBeNull();
    expect(pnlPct(pos('a', 2, null, 1, 300))).toBeNull();
  });

  it('a row field "De vândut": empty (all of it) or a positive number within its units', () => {
    expect(rowUnitsProblem('', 2)).toBeNull();
    expect(rowUnitsProblem(' 1,5 ', 2)).toBeNull();
    expect(rowUnitsProblem('2', 2)).toBeNull();
    expect(rowUnitsProblem('0', 2)).toBe('un număr pozitiv');
    expect(rowUnitsProblem('abc', 2)).toBe('un număr pozitiv');
    expect(rowUnitsProblem('-1', 2)).toBe('un număr pozitiv');
    expect(rowUnitsProblem('2.5', 2)).toBe('cel mult 2');
  });
});
