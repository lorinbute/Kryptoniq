// Moving one favourite to another place (FD-CHARTFAV §2). Pure, so the drag, the keys and the arrows agree.

/** `list` with the item at `from` moved to `to`; the same list when nothing would change. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}
