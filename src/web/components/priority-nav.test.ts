// FD-NAVOVERFLOW: how many of the top bar's pages fit before "»".
import { describe, expect, it } from 'vitest';
import { fitCount } from './PriorityNav.tsx';

describe('the top bar pages that fit', () => {
  it('all of them when they fit, with the gaps between them (no "»")', () => {
    expect(fitCount([80, 90, 100], 278, 4, 38)).toBe(3);
    expect(fitCount([80, 90, 100], 277, 4, 38)).toBe(2);
  });

  it('otherwise as many as leave room for "»" after them', () => {
    // 80 + 4 + 90 + 4 + 38 = 216
    expect(fitCount([80, 90, 100, 70], 216, 4, 38)).toBe(2);
    expect(fitCount([80, 90, 100, 70], 215, 4, 38)).toBe(1);
  });

  it('none when even the first one does not fit beside "»"; an empty list is empty', () => {
    expect(fitCount([80, 90], 100, 4, 38)).toBe(0);
    expect(fitCount([], 0, 4, 38)).toBe(0);
  });
});
