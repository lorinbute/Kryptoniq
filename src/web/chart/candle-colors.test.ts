import { describe, expect, it } from 'vitest';
import { chartStyleSchema } from '../../shared/chart-style.ts';
import { isTransparent } from '../indicators/vendor/render/color.ts';
import { candleBarWidth, candleBodyRect, candleColors, CLEAR } from './candle-colors.ts';

const k = (patch: unknown = {}) => chartStyleSchema.parse({ candles: patch }).candles;
const LMA = '#00FFAA';
// up by its open, down by its open but up from the close before, down.
const cs = [
  { o: 100, c: 110 },
  { o: 115, c: 112 },
  { o: 112, c: 100 },
];

describe('the candles coloured by an indicator (FD-BARCOLORBODY)', () => {
  it("fill the body only: the border and the wick stay the series' own", () => {
    expect(candleColors(k(), cs, 0, LMA)).toEqual({ color: LMA });
    expect(candleColors(k(), cs, 1, LMA)).toEqual({ color: LMA });
    // Without an indicator the series' options give everything.
    expect(candleColors(k(), cs, 1)).toEqual({});
  });

  it('keep the settings colours of the border and the wick, up / down by the close before when asked', () => {
    const look = k({ prevClose: true, borders: { visible: true, up: '#111111', down: '#222222' }, wick: { up: '#333333', down: '#444444' } });
    // The second candle fell from its open but rose from the close before: up.
    expect(candleColors(look, cs, 1, LMA)).toEqual({ color: LMA, borderColor: '#111111', wickColor: '#333333' });
    expect(candleColors(look, cs, 2, LMA)).toEqual({ color: LMA, borderColor: '#222222', wickColor: '#444444' });
    expect(candleColors(look, cs, 2)).toEqual({ color: '#EF5350', borderColor: '#222222', wickColor: '#444444' });
    // The first candle: by its own open (the series' options).
    expect(candleColors(look, cs, 0, LMA)).toEqual({ color: LMA });
  });

  it('leave a body switched off empty', () => {
    expect(candleColors(k({ body: { visible: false } }), cs, 0, LMA)).toEqual({ color: CLEAR });
    expect(candleColors(k({ prevClose: true, body: { visible: false } }), cs, 1, LMA)).toMatchObject({ color: CLEAR });
    // The generic barcolor reads the switched-off body as see-through: nothing to colour.
    expect(isTransparent(CLEAR)).toBe(true);
    expect(isTransparent('#26A69A00')).toBe(true);
    expect(isTransparent('#26A69A')).toBe(false);
    expect(isTransparent('rgba(0, 0, 0, 0.5)')).toBe(false);
  });

  it("fill the body where the library does: inside the border, nothing when there is no inside", () => {
    // 1×: bar spacing 6 → 5 px wide (odd, as the 1 px wick); the border 1 px.
    expect(candleBarWidth(6, 1)).toBe(5);
    expect(candleBodyRect(100, 10, 30, 6, 1, 1, false)).toEqual({ left: 98, top: 10, width: 5, height: 21 });
    expect(candleBodyRect(100, 10, 30, 6, 1, 1, true)).toEqual({ left: 99, top: 11, width: 3, height: 19 });
    // 2×: bar spacing 6 → 10 px (even, as the 2 px wick); the border 2 px.
    expect(candleBarWidth(6, 2)).toBe(10);
    expect(candleBodyRect(100, 10, 30, 6, 2, 2, true)).toEqual({ left: 197, top: 22, width: 6, height: 37 });
    // Too narrow for an inside, or flat within the border: nothing to fill.
    expect(candleBodyRect(100, 10, 30, 1, 1, 1, true)).toBeNull();
    expect(candleBodyRect(100, 20, 20.4, 6, 1, 1, true)).toBeNull();
    // Without a border a flat candle is still a line.
    expect(candleBodyRect(100, 20, 20, 6, 1, 1, false)).toEqual({ left: 98, top: 20, width: 5, height: 1 });
  });
});
