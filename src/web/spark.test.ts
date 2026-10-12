import { describe, expect, it } from 'vitest';
import { sparkChange, sparkPath } from './spark.ts';

describe('sparkline', () => {
  it('scales the series into the box, highest value at the top', () => {
    expect(sparkPath([1, 3, 2], 100, 20)).toBe('M0 19L50 1L100 10');
  });

  it('draws nothing without two usable points', () => {
    expect(sparkPath([], 100, 20)).toBe('');
    expect(sparkPath([5], 100, 20)).toBe('');
    expect(sparkPath([Number.NaN, 4], 100, 20)).toBe('');
    expect(sparkPath([1, 2], 0, 20)).toBe('');
  });

  it('skips gaps but keeps the time axis', () => {
    expect(sparkPath([1, Number.NaN, 3], 100, 20)).toBe('M0 19L100 1');
    expect(sparkPath([Number.NaN, 1, 3], 100, 20)).toBe('M0 19L100 1');
  });

  it('draws a flat series through the middle', () => {
    expect(sparkPath([7, 7, 7], 60, 20)).toBe('M0 10L30 10L60 10');
  });

  it('computes the change over the series', () => {
    expect(sparkChange([100, 90, 110])).toBeCloseTo(10);
    expect(sparkChange([Number.NaN, 50, 25])).toBeCloseTo(-50);
    expect(sparkChange([3])).toBeNull();
    expect(sparkChange([0, 5])).toBeNull();
  });
});
