// FD-CHARTAUDIT §5: the LMA state label goes to the left of its anchor only when it would be cut on the right.
import { describe, expect, it } from 'vitest';
import { edgeLabelSide } from './primitives.ts';

describe('the LMA state label', () => {
  it('stays on the right when it fits (as in TradingView)', () => {
    expect(edgeLabelSide(100, 80, 400)).toBe('right');
    expect(edgeLabelSide(320, 80, 400)).toBe('right');
  });

  it('goes to the left when it would be cut by the price scale', () => {
    expect(edgeLabelSide(350, 80, 400)).toBe('left');
    expect(edgeLabelSide(399, 80, 400)).toBe('left');
  });

  it('stays on the right when it fits on neither side', () => {
    expect(edgeLabelSide(50, 120, 140)).toBe('right');
  });
});
