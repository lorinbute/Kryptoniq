// FD-WATCHLISTS §2: the symbols ticked in the open list. A click ticks or unticks one; Shift + click ticks the run from
// the last one clicked to this one; the box on top ticks all or none.

export interface Selection {
  selected: ReadonlySet<string>;
  /** The last symbol clicked (the start of a Shift + click run); null before any. */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { selected: new Set(), anchor: null };

/** A click on `coin`'s box; `order` is the list as shown. */
export function clickBox(order: readonly string[], sel: Selection, coin: string, shift: boolean): Selection {
  const at = order.indexOf(coin);
  if (at < 0) return sel;
  const from = shift && sel.anchor !== null ? order.indexOf(sel.anchor) : -1;
  const next = new Set(sel.selected);
  if (from >= 0) {
    for (let i = Math.min(from, at); i <= Math.max(from, at); i++) next.add(order[i] as string);
  } else if (next.has(coin)) {
    next.delete(coin);
  } else {
    next.add(coin);
  }
  return { selected: next, anchor: coin };
}

/** What the box on top shows. */
export function selectionState(order: readonly string[], sel: Selection): 'none' | 'some' | 'all' {
  const n = order.filter((c) => sel.selected.has(c)).length;
  return n === 0 ? 'none' : n === order.length ? 'all' : 'some';
}

/** The box on top: all when not all are ticked, otherwise none. */
export function toggleAll(order: readonly string[], sel: Selection): Selection {
  return selectionState(order, sel) === 'all' ? EMPTY_SELECTION : { selected: new Set(order), anchor: sel.anchor };
}

/** Only the symbols still in the list (after a delete, a move, another tab's change). */
export function keepPresent(order: readonly string[], sel: Selection): Selection {
  const have = new Set(order);
  const selected = new Set([...sel.selected].filter((c) => have.has(c)));
  return { selected, anchor: sel.anchor !== null && have.has(sel.anchor) ? sel.anchor : null };
}
