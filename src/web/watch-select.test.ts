// FD-WATCHLISTS §2: ticking the symbols of the open list.
import { describe, expect, it } from 'vitest';
import { clickBox, EMPTY_SELECTION, keepPresent, selectionState, toggleAll } from './watch-select.ts';
import { quarterLabel } from './components/SymbolInfo.tsx';

const order = ['BTC', 'ETH', 'SOL', 'AAPL', 'TSLA'];
const ticked = (s: { selected: ReadonlySet<string> }) => order.filter((c) => s.selected.has(c));

describe('the boxes of a list', () => {
  it('a click ticks or unticks one; Shift + click ticks the run from the last one clicked, either way', () => {
    let s = clickBox(order, EMPTY_SELECTION, 'ETH', false);
    expect(ticked(s)).toEqual(['ETH']);
    s = clickBox(order, s, 'AAPL', true);
    expect(ticked(s)).toEqual(['ETH', 'SOL', 'AAPL']);
    s = clickBox(order, s, 'BTC', true);
    expect(ticked(s)).toEqual(['BTC', 'ETH', 'SOL', 'AAPL']);
    s = clickBox(order, s, 'SOL', false);
    expect(ticked(s)).toEqual(['BTC', 'ETH', 'AAPL']);
    expect(s.anchor).toBe('SOL');
    // Shift without a box clicked before: just that one.
    expect(ticked(clickBox(order, EMPTY_SELECTION, 'TSLA', true))).toEqual(['TSLA']);
    // A symbol not in the list: nothing changes.
    expect(clickBox(order, s, 'DOGE', false)).toBe(s);
  });

  it('the box on top: all, then none; "some" in between', () => {
    expect(selectionState(order, EMPTY_SELECTION)).toBe('none');
    const some = clickBox(order, EMPTY_SELECTION, 'SOL', false);
    expect(selectionState(order, some)).toBe('some');
    const all = toggleAll(order, some);
    expect(selectionState(order, all)).toBe('all');
    expect(selectionState(order, toggleAll(order, all))).toBe('none');
    expect(selectionState([], EMPTY_SELECTION)).toBe('none');
  });

  it('symbols gone from the list leave the selection (and the start of a run)', () => {
    let s = clickBox(order, EMPTY_SELECTION, 'BTC', false);
    s = clickBox(order, s, 'SOL', false);
    const after = keepPresent(['BTC', 'ETH'], s);
    expect([...after.selected]).toEqual(['BTC']);
    expect(after.anchor).toBeNull();
  });

  it('a quarter named by the month it ended in', () => {
    expect([quarterLabel('2026-06-30'), quarterLabel('2025-09-30'), quarterLabel('2025-12-31')]).toEqual(['iun. 2026', 'sept. 2025', 'dec. 2025']);
  });
});
