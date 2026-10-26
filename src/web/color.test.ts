import { describe, expect, it } from 'vitest';
import { alphaToPercent, fade, formatColor, mixColor, parseColor, percentToAlpha } from './color.ts';

describe('colours with their opacity (FD-OPACITY)', () => {
  it('reads every form the indicators use', () => {
    expect(parseColor('#00ffaa')).toEqual({ hex: '#00FFAA', alpha: 255 });
    expect(parseColor('#00FFAA80')).toEqual({ hex: '#00FFAA', alpha: 128 });
    expect(parseColor('#0fa')).toEqual({ hex: '#00FFAA', alpha: 255 });
    expect(parseColor('#0fa8')).toEqual({ hex: '#00FFAA', alpha: 136 });
    expect(parseColor('rgba(33, 150, 243, 0.5)')).toEqual({ hex: '#2196F3', alpha: 128 });
    expect(parseColor('rgb(255,82,82)')).toEqual({ hex: '#FF5252', alpha: 255 });
    expect(parseColor('transparent')).toEqual({ hex: '#000000', alpha: 0 });
    expect(parseColor('red')).toEqual({ hex: '#000000', alpha: 255 });
  });

  it('saves #RRGGBB when opaque, else #RRGGBBAA', () => {
    expect(formatColor('#00ffaa', 255)).toBe('#00FFAA');
    expect(formatColor('#00FFAA', 128)).toBe('#00FFAA80');
    expect(formatColor('#00FFAA', 0)).toBe('#00FFAA00');
    // the colour part only, whatever the alpha it came with
    expect(formatColor('#00FFAA80', 255)).toBe('#00FFAA');
  });

  it('opacity in percent, both ways', () => {
    expect(alphaToPercent(255)).toBe(100);
    expect(alphaToPercent(128)).toBe(50);
    expect(percentToAlpha(50)).toBe(128);
    expect(percentToAlpha(140)).toBe(255);
    expect(percentToAlpha(-3)).toBe(0);
    for (let pct = 0; pct <= 100; pct++) expect(alphaToPercent(percentToAlpha(pct))).toBe(pct);
  });

  it('fade multiplies the opacity the user chose', () => {
    expect(fade('#00FFAA', 0.5)).toBe('rgba(0, 255, 170, 0.5)');
    expect(fade('#00FFAA80', 0.5)).toBe('rgba(0, 255, 170, 0.251)');
    expect(fade('rgba(255, 82, 82, 0.4)', 0.18)).toBe('rgba(255, 82, 82, 0.072)');
  });
});

describe("a point of the chart's background gradient (FD-CHARTSETTINGS)", () => {
  it('mixes the colours and their opacity, the same colour staying as it is', () => {
    expect(mixColor('#000000', '#FFFFFF', 0.5)).toBe('rgba(128, 128, 128, 1)');
    expect(mixColor('#FF000000', '#FF0000', 0.25)).toBe('rgba(255, 0, 0, 0.25)');
    expect(mixColor('#102030', '#102030', 0.7)).toBe('#102030');
    // Outside 0–1: the ends.
    expect(mixColor('#000000', '#FFFFFF', -1)).toBe('rgba(0, 0, 0, 1)');
    expect(mixColor('#000000', '#FFFFFF', 2)).toBe('rgba(255, 255, 255, 1)');
  });
});
