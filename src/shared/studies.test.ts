// FD-INDICATORS §4: the saved list of indicators, as the server checks it.
import { describe, expect, it } from 'vitest';
import { FAVORITE_IDS, STUDY_IDS, STUDY_MAX, studiesSchema, studyFavoritesSchema, studyMemorySchema, studySchema } from './studies.ts';

const study = (over: Record<string, unknown> = {}) => ({ uid: 'abc123def456', id: 'rsi', inputs: {}, visible: true, ...over });

describe('the saved indicators', () => {
  it('has the 117 standard indicators and Volume, once each', () => {
    expect(STUDY_IDS).toHaveLength(118);
    expect(new Set(STUDY_IDS).size).toBe(118);
    expect(STUDY_IDS).toContain('volume');
  });

  it('accepts an indicator with its inputs and style', () => {
    const s = studySchema.parse(study({ inputs: { length: 21, src: 'hl2', calculateDivergence: true }, plots: { plot0: { visible: false, color: '#FF0000', width: 2, palette: { '#26A69A80': '#00FF00' } } }, hlines: { hline_upper: { color: 'rgba(1, 2, 3, 0.5)' } }, height: 0.5 }));
    expect(s.inputs.length).toBe(21);
    // Defaults filled in.
    expect(studySchema.parse({ uid: 'abc123', id: 'sma' })).toEqual({ uid: 'abc123', id: 'sma', inputs: {}, visible: true });
  });

  it('refuses what a page never sends', () => {
    const bad = [
      study({ id: 'nope' }),
      study({ uid: 'AB' }),
      study({ uid: 'UPPER123' }),
      study({ inputs: { 'bad key': 1 } }),
      study({ inputs: { x: Infinity } }),
      study({ inputs: { x: 'y'.repeat(301) } }),
      study({ inputs: { x: { nested: true } } }),
      study({ inputs: Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`k${i}`, i])) }),
      study({ plots: { plot0: { width: 7 } } }),
      study({ plots: { plot0: { width: 0 } } }),
      study({ plots: { plot0: { style: 'wavy' } } }),
      study({ hlines: { hline0: { width: 7 } } }),
      study({ hlines: { hline0: { style: 'dash' } } }),
      study({ hlines: { hline0: { price: Infinity } } }),
      study({ hlines: { hline0: { price: 1e13 } } }),
      study({ hlines: { hline0: { price: '80' } } }),
      study({ plots: { plot0: { color: 'red' } } }),
      study({ plots: { plot0: { other: 1 } } }),
      // FD-FILLS
      study({ fills: { f_Background: { color: 'blue' } } }),
      study({ fills: { f_Background: { visible: 'no' } } }),
      study({ fills: { f_Background: { width: 2 } } }),
      study({ fills: { 'bad key': { visible: false } } }),
      study({ height: 4 }),
      study({ extra: true }),
    ];
    for (const b of bad) expect(studySchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
  });

  it('keeps the fills chosen in the Style tab (FD-FILLS)', () => {
    const s = studySchema.parse(study({ fills: { f_Background: { visible: false }, fill_band: { color: '#7E57C240' } } }));
    expect(s.fills).toEqual({ f_Background: { visible: false }, fill_band: { color: '#7E57C240' } });
    expect(studyMemorySchema.parse([{ id: 'bb', inputs: {}, fills: { f_Background: { color: '#2196F31A' } } }])[0]?.fills).toEqual({ f_Background: { color: '#2196F31A' } });
  });

  it('a list: at most STUDY_MAX, each uid once', () => {
    const many = Array.from({ length: STUDY_MAX }, (_, i) => study({ uid: `uid${String(i).padStart(4, '0')}` }));
    expect(studiesSchema.safeParse(many).success).toBe(true);
    expect(studiesSchema.safeParse([...many, study({ uid: 'another1' })]).success).toBe(false);
    expect(studiesSchema.safeParse([study(), study()]).success).toBe(false);
  });
});

describe('line kind and width (FD-STUDYUX §3)', () => {
  it('a plot or an hline keeps its kind and a width up to 6 px', () => {
    const s = studySchema.parse(study({ plots: { plot0: { style: 'dotted', width: 6 } }, hlines: { hline_upper: { style: 'dashed', width: 3, visible: false } } }));
    expect(s.plots?.plot0).toEqual({ style: 'dotted', width: 6 });
    expect(s.hlines?.hline_upper).toEqual({ style: 'dashed', width: 3, visible: false });
    // FD-HLINELEVELS: a level of its own.
    expect(studySchema.parse(study({ hlines: { hline_upper: { price: 85.5 }, hline_lower: { price: -10 } } })).hlines).toEqual({ hline_upper: { price: 85.5 }, hline_lower: { price: -10 } });
  });
});

describe('the favourites (FD-STUDYUX §1)', () => {
  it('Slingshot, LMA and the standard ones, once each, in the order starred', () => {
    expect(FAVORITE_IDS.slice(0, 2)).toEqual(['slingshot', 'lma']);
    expect(FAVORITE_IDS).toHaveLength(STUDY_IDS.length + 2);
    expect(studyFavoritesSchema.parse(['rsi', 'lma', 'ema'])).toEqual(['rsi', 'lma', 'ema']);
    expect(studyFavoritesSchema.safeParse([...FAVORITE_IDS]).success).toBe(true);
    for (const bad of [['rsi', 'rsi'], ['nope'], [1], 'rsi']) expect(studyFavoritesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('the last settings of each indicator (FD-STUDYMEMORY)', () => {
  it('one entry per indicator, with the same rules as an indicator on the chart', () => {
    const ok = [{ id: 'rsi', inputs: { length: 21 }, plots: { plot0: { style: 'dotted', width: 3 } }, height: 0.4 }, { id: 'ema', inputs: {} }];
    expect(studyMemorySchema.parse(ok)).toEqual(ok);
    for (const bad of [
      [{ id: 'rsi', inputs: {} }, { id: 'rsi', inputs: { length: 7 } }],
      [{ id: 'nope', inputs: {} }],
      [{ id: 'rsi', inputs: {}, uid: 'abc123' }],
      [{ id: 'rsi', inputs: {}, visible: true }],
      [{ id: 'rsi', inputs: { x: { nested: 1 } } }],
      [{ id: 'rsi', inputs: {}, height: 9 }],
    ]) expect(studyMemorySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(studyMemorySchema.safeParse(STUDY_IDS.map((id) => ({ id, inputs: {} }))).success).toBe(true);
  });
});

