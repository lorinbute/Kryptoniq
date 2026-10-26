// FD-CHARTAUDIT §4: the keyboard in the symbol search's results.
import { describe, expect, it } from 'vitest';
import { enterIndex, stepActive } from './search-nav.ts';

describe('the search results from the keyboard', () => {
  it('↓ starts at the first and goes round; ↑ starts at the last and goes round', () => {
    expect(stepActive(-1, 3, 'ArrowDown')).toBe(0);
    expect(stepActive(0, 3, 'ArrowDown')).toBe(1);
    expect(stepActive(2, 3, 'ArrowDown')).toBe(0);
    expect(stepActive(-1, 3, 'ArrowUp')).toBe(2);
    expect(stepActive(0, 3, 'ArrowUp')).toBe(2);
    expect(stepActive(2, 3, 'ArrowUp')).toBe(1);
  });

  it('a choice past the list (it got shorter) starts again; no results, no choice', () => {
    expect(stepActive(5, 3, 'ArrowDown')).toBe(0);
    expect(stepActive(5, 3, 'ArrowUp')).toBe(2);
    expect(stepActive(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('Enter opens the chosen one, or the first; nothing without results', () => {
    expect(enterIndex(2, 3)).toBe(2);
    expect(enterIndex(-1, 3)).toBe(0);
    expect(enterIndex(4, 3)).toBe(0);
    expect(enterIndex(-1, 0)).toBe(-1);
  });
});
