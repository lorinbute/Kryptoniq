// FD-HLINE: the horizontal lines' style, where they show, and how they are kept per symbol.
import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from './time.ts';
import { CHART_SYMBOL_RE, settingsSchema } from './settings.ts';
import { HLINE_DEFAULT_STYLE, HLINE_MAX, chartLinesSchemaFor, hlineSchema, hlineVisibleOn, salvageChartLines, styleOf, timeframeUnit, type HLine } from './hlines.ts';

const line = (id: string, price = 100, patch: Partial<HLine> = {}): HLine => ({ ...structuredClone(HLINE_DEFAULT_STYLE), id, price, text: '', ...patch });

describe('the horizontal lines', () => {
  it('accept TradingView-like settings and refuse what is out of range', () => {
    expect(hlineSchema.safeParse(line('abc123', 2.023, { color: '#6FFFB0AA', width: 4, style: 'dotted', textSize: 40, bold: true, italic: true, vAlign: 'top', hAlign: 'center', text: 'Suport\nzilnic' })).success).toBe(true);
    for (const bad of [
      { width: 5 },
      { color: 'red' },
      { textSize: 13 },
      { price: Number.NaN },
      { text: 'x'.repeat(501) },
      { id: 'AB' },
      { visibility: { ...HLINE_DEFAULT_STYLE.visibility, hours: { on: true, from: 5, to: 2 } } },
      { visibility: { ...HLINE_DEFAULT_STYLE.visibility, minutes: { on: true, from: 1, to: 60 } } },
    ] as Partial<HLine>[]) {
      expect(hlineSchema.safeParse(line('abc123', 1, bad)).success).toBe(false);
    }
  });

  it('show on a timeframe when its unit is ticked and its number in range', () => {
    expect(TIMEFRAMES.map(timeframeUnit)).toEqual([
      { unit: 'minutes', n: 1 },
      { unit: 'minutes', n: 3 },
      { unit: 'minutes', n: 5 },
      { unit: 'minutes', n: 15 },
      { unit: 'minutes', n: 30 },
      { unit: 'hours', n: 1 },
      { unit: 'hours', n: 2 },
      { unit: 'hours', n: 4 },
      { unit: 'hours', n: 6 },
      { unit: 'hours', n: 8 },
      { unit: 'hours', n: 12 },
      { unit: 'days', n: 1 },
      { unit: 'weeks', n: 1 },
    ]);
    expect(TIMEFRAMES.every((tf) => hlineVisibleOn(HLINE_DEFAULT_STYLE, tf))).toBe(true);
    const v = structuredClone(HLINE_DEFAULT_STYLE.visibility);
    v.minutes = { on: true, from: 5, to: 15 };
    v.hours.on = false;
    expect(TIMEFRAMES.filter((tf) => hlineVisibleOn({ visibility: v }, tf))).toEqual(['5m', '15m', '1d', '1w']);
  });

  it('are kept per symbol, without symbols left empty, within the limits', () => {
    const schema = chartLinesSchemaFor(CHART_SYMBOL_RE);
    expect(schema.parse({ 'BTC/USDT': [line('aaaaaa')], 'stock:AAPL': [], 'index:SPX': [line('bbbbbb')] })).toEqual({ 'BTC/USDT': [line('aaaaaa')], 'index:SPX': [line('bbbbbb')] });
    expect(schema.safeParse({ 'btc/usdt': [line('aaaaaa')] }).success).toBe(false);
    expect(schema.safeParse({ 'BTC/USDT': Array.from({ length: HLINE_MAX + 1 }, (_, i) => line(`line${String(i).padStart(3, '0')}`)) }).success).toBe(false);
    expect(schema.safeParse(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`C${i}/USDT`, [line('aaaaaa')]]))).success).toBe(false);
    // The settings: none at first, no template.
    expect(settingsSchema.parse({})).toMatchObject({ chartLines: {}, hlineTemplate: null });
  });

  it('keep the valid lines of the valid symbols when a stored list no longer parses', () => {
    const stored = { 'BTC/USDT': [line('aaaaaa'), { id: 'bad', price: 'x' }, line('cccccc', 5, { width: 9 })], nope: [line('dddddd')], 'ETH/USDT': 'not a list', 'SOL/USDT': [{}] };
    expect(salvageChartLines(stored, CHART_SYMBOL_RE)).toEqual({ 'BTC/USDT': [line('aaaaaa')] });
    expect(salvageChartLines('nothing', CHART_SYMBOL_RE)).toEqual({});
  });

  it('take the style alone into a template', () => {
    const st = styleOf(line('aaaaaa', 7, { text: 'Rezistență', color: '#FF0000' }));
    expect(st).not.toHaveProperty('price');
    expect(st).not.toHaveProperty('text');
    expect(st).toMatchObject({ color: '#FF0000' });
  });
});
