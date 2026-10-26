// The keyboard in a list of search results (FD-CHARTAUDIT §4): ↓ / ↑ go round the results, Enter opens the chosen one.

/** The result chosen after ↓ or ↑ (−1 = none yet: ↓ chooses the first, ↑ the last); −1 when there are none. */
export function stepActive(active: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  if (active < 0 || active >= count) return key === 'ArrowDown' ? 0 : count - 1;
  return (active + (key === 'ArrowDown' ? 1 : count - 1)) % count;
}

/** The result Enter opens: the chosen one, or the first; −1 when there are none. */
export function enterIndex(active: number, count: number): number {
  if (count <= 0) return -1;
  return active >= 0 && active < count ? active : 0;
}
