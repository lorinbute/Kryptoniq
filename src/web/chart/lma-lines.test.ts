import { describe, expect, it } from 'vitest';
import { DEFAULT_LMA_PARAMS, lmaParamsSchema } from '../../shared/indicator/lma-params.ts';
import { lmaHlines, lmaScriptLineColors } from './lma-lines.ts';

describe("the LMA's threshold lines (FD-STYLEUNIFY)", () => {
  it("keep the script's colours and widths by default, following its Visual Settings", () => {
    const own = lmaScriptLineColors(DEFAULT_LMA_PARAMS);
    expect(lmaHlines(DEFAULT_LMA_PARAMS).map((h) => [h.key, h.color, h.width, h.style])).toEqual([
      ['long', own.long, 1, 'Dashed'],
      ['short', own.short, 1, 'Dashed'],
      ['neutral', own.neutral, 2, 'Solid'],
    ]);
    // Bullish Color at 30 % transparency (179 / 255), as the script's hline.
    expect(own.long).toBe('rgba(0, 255, 170, 0.702)');
    expect(lmaScriptLineColors({ ...DEFAULT_LMA_PARAMS, bullishColor: '#112233' }).long).toBe('rgba(17, 34, 51, 0.702)');
  });

  it('take the colour, width and style chosen', () => {
    const e = lmaParamsSchema.parse({ longLineColor: '#ABCDEF80', longLineWidth: 4, longLineStyle: 'Dotted', neutralLineWidth: 1, signalStyle: 'Dashed' });
    const [long, , neutral] = lmaHlines(e);
    expect([long?.color, long?.width, long?.style]).toEqual(['#ABCDEF80', 4, 'Dotted']);
    expect(neutral?.width).toBe(1);
    expect(e.signalStyle).toBe('Dashed');
    // A chosen colour stays when Bullish Color changes (as in TradingView); null goes back to the script's.
    expect(lmaHlines({ ...e, bullishColor: '#000000' })[0]?.color).toBe('#ABCDEF80');
    expect(lmaHlines({ ...e, longLineColor: null })[0]?.color).toBe(lmaScriptLineColors(e).long);
    for (const bad of [{ longLineWidth: 0 }, { neutralLineWidth: 5 }, { shortLineColor: 'red' }, { signalStyle: 'Wavy' }]) {
      expect(lmaParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
