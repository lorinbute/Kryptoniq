// FD-INDICATORS §3 "Stil", TD-INDICATORS §8: the style the user chose, as the renderer gets it.
import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from 'oakscriptjs';
import { STUDY_MODULES } from './catalog.ts';
import { legendNumbers, lineKind, plotHasData, plotValueAt, plotWidth, styledEntry, stylePlots, widthChoices } from './style.ts';

const result = (over: Partial<IndicatorResult> = {}): IndicatorResult =>
  ({ metadata: { title: 'x', overlay: false }, plots: { plot0: [{ time: 10, value: 1 }, { time: 20, value: 2, color: '#123456' }] }, ...over }) as IndicatorResult;

describe('the style of an indicator', () => {
  const bb = STUDY_MODULES.bb;

  it('hides a plot, recolours it (its own colour in the points too) and sets its width', () => {
    const def = bb.plotConfig[1];
    const s = styledEntry(bb, { plots: { [def?.id as string]: { visible: false }, [bb.plotConfig[0]?.id as string]: { color: '#00FF00', width: 3 } } }, {}, result());
    const first = s.options.plots?.[bb.plotConfig[0]?.id as string];
    expect(first).toMatchObject({ color: '#00FF00', lineWidth: 3, palette: { [bb.plotConfig[0]?.color as string]: '#00FF00' } });
    expect(s.options.plots?.[def?.id as string]).toEqual({ visible: false });
  });

  it('a fill between a hidden plot and another goes with it', () => {
    // An indicator whose configured fills join two of its plots.
    const mod = Object.values(STUDY_MODULES).find((m) => (m.fillConfig ?? []).some((f) => m.plotConfig.some((p) => p.id === f.plot1) && m.plotConfig.some((p) => p.id === f.plot2)));
    expect(mod).toBeDefined();
    if (!mod) return;
    const fills = mod.fillConfig ?? [];
    const f = fills.find((x) => mod.plotConfig.some((p) => p.id === x.plot1)) as { plot1: string; plot2: string };
    const r = result({ fills: [{ plot1: f.plot1, plot2: f.plot2 }] });
    const s = styledEntry(mod, { plots: { [f.plot1]: { visible: false } } }, {}, r);
    expect(s.entry.fillConfig).toEqual(fills.filter((x) => x.plot1 !== f.plot1 && x.plot2 !== f.plot1));
    expect(s.result.fills).toEqual([]);
    // Nothing hidden: the result is passed as is.
    expect(styledEntry(mod, {}, {}, r).result).toBe(r);
  });

  it('a hidden hline stays in the list with display none (an empty list would bring back the result own hlines)', () => {
    const rsi = STUDY_MODULES.rsi;
    const s = styledEntry(rsi, { hlines: { hline_upper: { visible: false }, hline_lower: { color: '#FF0000' } } }, {}, result());
    expect(s.entry.hlineConfig?.find((h) => h.id === 'hline_upper')?.display).toBe('none');
    expect(s.entry.hlineConfig?.find((h) => h.id === 'hline_lower')?.color).toBe('#FF0000');
    expect(s.entry.hlineConfig).toHaveLength(rsi.hlineConfig?.length ?? 0);
  });

  it('a line drawn dotted and thicker; an hline dashed; nothing chosen leaves the definitions as they are (FD-STUDYUX §3)', () => {
    const rsi = STUDY_MODULES.rsi;
    const line = stylePlots(rsi).find((p) => lineKind(p) === 'line');
    expect(line).toBeDefined();
    if (!line) return;
    const s = styledEntry(rsi, { plots: { [line.id]: { style: 'dotted', width: 4 } }, hlines: { hline_upper: { style: 'solid', width: 2 } } }, {}, result());
    expect(s.entry.plotConfig.find((p) => p.id === line.id)?.linestyle).toBe('dotted');
    expect(s.options.plots?.[line.id]).toMatchObject({ lineWidth: 4 });
    expect(s.entry.hlineConfig?.find((h) => h.id === 'hline_upper')).toMatchObject({ linestyle: 'solid', linewidth: 2 });
    // The module's own definitions are not touched.
    expect(rsi.plotConfig.find((p) => p.id === line.id)?.linestyle).not.toBe('dotted');
    expect(styledEntry(rsi, {}, {}, result()).entry.plotConfig).toBe(rsi.plotConfig);
    // A kind on a plot that has none (a histogram) is not passed on.
    const macd = STUDY_MODULES.macd;
    const hist = macd.plotConfig.find((p) => p.style === 'histogram' || p.style === 'columns');
    if (hist) expect(styledEntry(macd, { plots: { [hist.id]: { style: 'dashed' } } }, {}, result()).entry.plotConfig).toBe(macd.plotConfig);
  });

  it('the levels of the horizontal lines: Stochastic RSI at 90 / 50 / 10, its band fill follows (FD-HLINELEVELS)', () => {
    const srsi = STUDY_MODULES['stoch-rsi'];
    const s = styledEntry(srsi, { hlines: { hline_upper: { price: 90 }, hline_lower: { price: 10 } } }, {}, result());
    expect(s.entry.hlineConfig?.map((h) => [h.id, h.price])).toEqual([
      ['hline_upper', 90],
      ['hline_mid', 50],
      ['hline_lower', 10],
    ]);
    // The fill still joins the same two lines; the renderer takes their prices from hlineConfig.
    expect(s.entry.fillConfig).toEqual(srsi.fillConfig);
    expect(srsi.hlineConfig?.find((h) => h.id === 'hline_upper')?.price).toBe(80);
  });

  it('what the Style tab offers: kind and width for a line, width for histograms, circles and crosses', () => {
    for (const st of ['line', 'stepline', 'linebr', 'area', undefined] as const) expect(lineKind({ style: st }), String(st)).toBe('line');
    for (const st of ['histogram', 'circles', 'cross'] as const) expect(lineKind({ style: st })).toBe('width');
    for (const st of ['columns', 'shape', 'char'] as const) expect(lineKind({ style: st as never })).toBeNull();
    expect(widthChoices(1)).toEqual([1, 2, 3]);
    expect(widthChoices(2)).toEqual([2, 3, 4]);
    // "Implicită" is what the renderer draws without a choice: 2 px for a line, 1 px for a histogram.
    expect(plotWidth({ style: undefined, lineWidth: undefined })).toBe(2);
    expect(plotWidth({ style: 'histogram', lineWidth: undefined })).toBe(1);
    expect(plotWidth({ style: 'line', lineWidth: 3 })).toBe(3);
    expect(widthChoices(4)).toEqual([4, 5, 6]);
    expect(widthChoices(9)).toEqual([4, 5, 6]);
  });

  it('the Style tab lists the editable plots that draw something', () => {
    // RSI's transparent helper plot is not listed.
    expect(stylePlots(STUDY_MODULES.rsi).map((p) => p.id)).not.toContain('plot6');
    expect(stylePlots(STUDY_MODULES.rsi).map((p) => p.id)).toContain('plot0');
  });
});

describe('the legend', () => {
  it('reads a plot value at a bar time, with its colour', () => {
    const r = result();
    expect(plotValueAt(r, 'plot0', 20)).toEqual({ value: 2, color: '#123456' });
    expect(plotValueAt(r, 'plot0', 30)).toBeUndefined();
    expect(plotValueAt(r, 'nope', 10)).toBeUndefined();
    // A plot that is na on every bar stays out of the legend.
    expect(plotHasData(r, 'plot0')).toBe(true);
    expect(plotHasData(result({ plots: { plot0: [{ time: 1, value: Number.NaN }] } }), 'plot0')).toBe(false);
  });

  it('numbers the same indicator with the same inputs', () => {
    const n = legendNumbers([
      { uid: 'a', id: 'ema', params: '20 close' },
      { uid: 'b', id: 'ema', params: '50 close' },
      { uid: 'c', id: 'ema', params: '20 close' },
      { uid: 'd', id: 'ema', params: '20 close' },
    ]);
    expect([...n]).toEqual([
      ['c', 2],
      ['d', 3],
    ]);
  });
});
