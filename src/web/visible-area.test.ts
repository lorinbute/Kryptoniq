// FD-MODALFIT: a window's layer follows the part of the window really seen (the keyboard up, the page zoomed in).
import { describe, expect, it } from 'vitest';
import { areaStyle } from './visible-area.ts';

describe('the part of the window seen', () => {
  it('leaves the CSS alone without a visual viewport, or when the whole window is seen', () => {
    expect(areaStyle(null, 714)).toBeUndefined();
    expect(areaStyle(undefined, 714)).toBeUndefined();
    expect(areaStyle({ height: 714, offsetTop: 0 }, 714)).toBeUndefined();
    // Under a pixel short: rounding, not a keyboard.
    expect(areaStyle({ height: 713.5, offsetTop: 0 }, 714)).toBeUndefined();
  });

  it('with the keyboard up: as tall as what is above it', () => {
    expect(areaStyle({ height: 402, offsetTop: 0 }, 714)).toEqual({ top: 0, height: 402, bottom: 'auto' });
  });

  it('scrolled inside the window (Safari moves the part seen to the field typed in): from there down', () => {
    expect(areaStyle({ height: 402.4, offsetTop: 120.6 }, 714)).toEqual({ top: 121, height: 402, bottom: 'auto' });
  });

  it('never above the window', () => {
    expect(areaStyle({ height: 300, offsetTop: -5 }, 714)).toEqual({ top: 0, height: 300, bottom: 'auto' });
  });
});
