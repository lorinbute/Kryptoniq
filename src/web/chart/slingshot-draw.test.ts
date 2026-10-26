import { describe, expect, it } from 'vitest';
import { DEFAULT_SLINGSHOT_PARAMS, type SlingshotParams } from '../../shared/indicator/params.ts';
import type { Candle, SlingshotMarker, SlingshotResult } from '../../shared/indicator/slingshot.ts';
import { buildSegments, markerState, SIGNAL_SIZES, slingshotShapes, textPx } from './slingshot-draw.ts';

const p = DEFAULT_SLINGSHOT_PARAMS;
const candle = (h: number, l: number): Candle => ({ t: 0, o: l, h, l, c: h, v: 1 });
const result = (atr: SlingshotResult['atr'], atrShort: SlingshotResult['atrShort'] = null): SlingshotResult => ({ emaFast: [], emaSlow: [], uptrend: [], markers: [], signals: [], alerts: [], atr, atrShort, ms: null, last: null, warnings: [] });
const atr = (side: 'long' | 'short', tp: number, sl: number) => ({ side, tp, sl, fromBar: 1, toBarTp: 50, toBarSl: 50, labelBar: 5, showLines: true, showLabels: true });

describe('Slingshot drawing (FD-SLINGSHOT34)', () => {
  it('LONG: TAKE PROFIT label above its line, STOP LOSS below', () => {
    const labels = buildSegments(result(atr('long', 120, 90)), p, 2).filter((s) => s.label);
    expect(labels.map((s) => [s.label?.text[0], s.label?.placement, s.color])).toEqual([
      ['TAKE PROFIT', 'above', p.longTPColor],
      ['STOP LOSS', 'below', p.longSLColor],
    ]);
  });

  it('SHORT: TAKE PROFIT (below the price) labelled under its line, STOP LOSS above', () => {
    const labels = buildSegments(result(null, atr('short', 80, 110)), p, 2).filter((s) => s.label);
    expect(labels.map((s) => [s.label?.text.join(' '), s.label?.placement])).toEqual([
      ['TAKE PROFIT 80.00', 'below'],
      ['STOP LOSS 110.00', 'above'],
    ]);
  });

  it('a LONG and a SHORT tracked together: both sets of lines and labels, the LONG first, each in its own look', () => {
    const q = { ...p, shortTPColor: '#123456', shortSLColor: '#654321', shortTpLineWidth: 4, shortSlLineStyle: 'Dotted' as const, longSlLabelSize: 'Huge' as const };
    const segs = buildSegments(result(atr('long', 120, 90), atr('short', 80, 110)), q, 2);
    expect(segs.filter((s) => !s.label).map((s) => [s.price, s.color, s.width, s.style])).toEqual([
      [120, p.longTPColor, 2, 'dashed'],
      [90, p.longSLColor, 2, 'dashed'],
      [80, '#123456', 4, 'dashed'],
      [110, '#654321', 2, 'dotted'],
    ]);
    expect(segs.filter((s) => s.label).map((s) => s.label?.size)).toEqual([11, 20, 11, 11]);
    expect(segs.filter((s) => s.label).map((s) => [s.label?.text.join(' '), s.label?.placement])).toEqual([
      ['TAKE PROFIT 120.00', 'above'],
      ['STOP LOSS 90.00', 'below'],
      ['TAKE PROFIT 80.00', 'below'],
      ['STOP LOSS 110.00', 'above'],
    ]);
  });

  it('shapes: a SHORT above its candle, its TAKE PROFIT below; each kind in its own colour; failed and invalidated (an X)', () => {
    const q = { ...p, longColor: '#111111', longFormingColor: '#111111', longTpColor: '#222222', shortColor: '#333333', shortFormingColor: '#333333', shortTpColor: '#444444', shortFailedColor: '#555555', longInvalidColor: '#66666680', longSlColor: '#777777', shortSlColor: '#888888' };
    const m = (bar: number, kind: SlingshotMarker['kind'], color: SlingshotMarker['color']): SlingshotMarker => ({ id: bar, bar, time: 0, kind, color, provisional: false });
    const candles = [candle(10, 5), candle(12, 6), candle(11, 4), candle(9, 3), candle(13, 7), candle(8, 2), candle(14, 1), candle(15, 2), candle(16, 3), candle(17, 4)];
    const shapes = slingshotShapes(
      [m(0, 'long', 'signal'), m(1, 'takeProfit', 'signal'), m(2, 'short', 'signal'), m(3, 'shortTakeProfit', 'signal'), m(4, 'short', 'failed'), m(5, 'shortPreview', 'signal'), m(6, 'long', 'invalid'), m(7, 'longPreview', 'signal'), m(8, 'stopLoss', 'signal'), m(9, 'shortStopLoss', 'signal'), m(12, 'long', 'signal')],
      candles,
      q,
    );
    expect(shapes.map((s) => [s.bar, s.text, s.position, s.price, s.color, s.shape])).toEqual([
      [0, 'LONG', 'below', 5, '#111111', 'triangle'],
      [1, 'TAKE PROFIT', 'above', 12, '#222222', 'triangle'],
      [2, 'SHORT', 'above', 11, '#333333', 'triangle'],
      [3, 'TAKE PROFIT', 'below', 3, '#444444', 'triangle'],
      [4, 'SHORT', 'above', 13, '#555555', 'triangle'],
      [5, 'SHORT', 'above', 8, '#333333', 'triangle'],
      [6, 'LONG', 'below', 1, '#66666680', 'x'],
      [7, 'LONG', 'below', 2, '#111111', 'triangle'],
      // FD-SSSL: a LONG's stop loss under the bar (its low), a SHORT's above it (its high)
      [8, 'STOP LOSS', 'below', 3, '#777777', 'triangle'],
      [9, 'STOP LOSS', 'above', 17, '#888888', 'triangle'],
    ]); // bar 12 is outside the candles
  });

  it('FD-STYLEUNIFY: every state of every side in its own colour and size', () => {
    const m = (kind: SlingshotMarker['kind'], color: SlingshotMarker['color']): SlingshotMarker => ({ id: 0, bar: 0, time: 0, kind, color, provisional: false });
    const cases: [SlingshotMarker, string][] = [
      [m('longPreview', 'signal'), 'Forming'],
      [m('long', 'signal'), ''],
      [m('long', 'failed'), 'Failed'],
      [m('long', 'invalid'), 'Invalid'],
      [m('takeProfit', 'signal'), 'Tp'],
      [m('stopLoss', 'signal'), 'Sl'],
      [m('shortPreview', 'signal'), 'Forming'],
      [m('short', 'failed'), 'Failed'],
      [m('shortTakeProfit', 'signal'), 'Tp'],
    ];
    for (const [marker, state] of cases) expect(markerState(marker)).toBe(state);
    const sizes = ['Tiny', 'Small', 'Normal', 'Large', 'Huge'] as const;
    const q: Record<string, string> = { ...(p as unknown as Record<string, string>) };
    let i = 0;
    for (const side of ['long', 'short']) {
      for (const st of ['Forming', '', 'Failed', 'Invalid', 'Tp', 'Sl']) {
        q[`${side}${st}Color`] = `#0000${(i + 16).toString(16).toUpperCase()}`;
        q[`${side}${st}Size`] = sizes[i % 5] as string;
        i++;
      }
    }
    const kinds: SlingshotMarker[] = [m('longPreview', 'signal'), m('long', 'signal'), m('long', 'failed'), m('long', 'invalid'), m('takeProfit', 'signal'), m('stopLoss', 'signal'), m('shortPreview', 'signal'), m('short', 'signal'), m('short', 'failed'), m('short', 'invalid'), m('shortTakeProfit', 'signal'), m('shortStopLoss', 'signal')];
    const shapes = kinds.map((k) => slingshotShapes([k], [candle(10, 5)], q as unknown as SlingshotParams)[0]);
    expect(shapes.map((s) => s?.color)).toEqual(kinds.map((_, j) => `#0000${(j + 16).toString(16).toUpperCase()}`));
    expect(shapes.map((s) => s?.size)).toEqual(kinds.map((_, j) => SIGNAL_SIZES[sizes[j % 5] as (typeof sizes)[number]]));
    // The invalidated ones are X's.
    expect(shapes.map((s) => s?.shape)).toEqual(kinds.map((k) => (k.color === 'invalid' ? 'x' : 'triangle')));
  });

  it('FD-STYLEUNIFY: market structure lines each with their own width, style and text size; one text size table', () => {
    const r = { ...result(null), ms: { upper: { price: 120, fromBar: 1 }, lower: { price: 90, fromBar: 2 }, rightEdgeBar: 60 } } as unknown as SlingshotResult;
    const q = { ...p, msBullLineWidth: 3, msBullLineStyle: 'Solid' as const, msBullTextSize: 'Large' as const, msBearLineWidth: 5, msBearTextSize: 'Huge' as const };
    expect(buildSegments(r, q, 2).map((s) => [s.price, s.width, s.style, s.label?.size])).toEqual([
      [120, 3, 'solid', 16],
      [90, 5, 'dotted', 20],
    ]);
    expect((['Tiny', 'Small', 'Normal', 'Large', 'Huge'] as const).map(textPx)).toEqual([9, 11, 13, 16, 20]);
  });

  it('Signal Size: TradingView\'s "Small" by default (~24 px), bigger and smaller ones to choose', () => {
    const one = (longSize: SlingshotParams['longSize']) => slingshotShapes([{ id: 0, bar: 0, time: 0, kind: 'long', color: 'signal', provisional: false }], [candle(10, 5)], { ...p, longSize })[0]?.size;
    expect(one('Small')).toEqual({ w: 24, h: 18, text: 11 });
    const widths = (['Tiny', 'Small', 'Normal', 'Large', 'Huge'] as const).map((n) => one(n)?.w);
    expect(widths).toEqual([...widths].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(new Set(widths).size).toBe(5);
  });
});
