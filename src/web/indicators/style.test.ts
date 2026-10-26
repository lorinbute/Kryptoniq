// FD-INDICATORS §3 "Stil", TD-INDICATORS §8: the style the user chose, as the renderer gets it.
import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from 'oakscriptjs';
import { STUDY_MODULES } from './catalog.ts';
import { fillKeys, hlineDefault, legendNumbers, lineKind, plotHasData, plotValueAt, plotWidth, pointColor, styledEntry, styleFills, stylePlots } from './style.ts';
import { colorKey } from './color-links.ts';

const result = (over: Partial<IndicatorResult> = {}): IndicatorResult =>
  ({ metadata: { title: 'x', overlay: false }, plots: { plot0: [{ time: 10, value: 1 }, { time: 20, value: 2, color: '#123456' }] }, ...over }) as IndicatorResult;

describe('the style of an indicator', () => {
  const bb = STUDY_MODULES.bb;

  it('hides a plot, recolours it (its own colour in the points too) and sets its width', () => {
    const def = bb.plotConfig[1];
    const s = styledEntry(bb, { plots: { [def?.id as string]: { visible: false }, [bb.plotConfig[0]?.id as string]: { color: '#00FF00', width: 3 } } }, {}, result());
    const first = s.options.plots?.[bb.plotConfig[0]?.id as string];
    expect(first).toMatchObject({ color: '#00FF00', lineWidth: 3, palette: { [colorKey(bb.plotConfig[0]?.color as string)]: '#00FF00' } });
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

  it('what the Style tab offers: style and width for a line, width for histograms, circles and crosses', () => {
    for (const st of ['line', 'stepline', 'linebr', 'area', undefined] as const) expect(lineKind({ style: st }), String(st)).toBe('line');
    for (const st of ['histogram', 'circles', 'cross'] as const) expect(lineKind({ style: st })).toBe('width');
    for (const st of ['columns', 'shape', 'char'] as const) expect(lineKind({ style: st as never })).toBeNull();
    // FD-STYLEUNIFY: the line box shows selected what the renderer draws without a choice: 2 px for a line, 1 px for a
    // histogram, else the script's own.
    expect(plotWidth({ style: undefined, lineWidth: undefined })).toBe(2);
    expect(plotWidth({ style: 'histogram', lineWidth: undefined })).toBe(1);
    expect(plotWidth({ style: 'line', lineWidth: 3 })).toBe(3);
  });

  it('the Style tab lists the editable plots that draw something', () => {
    // RSI's transparent helper plot is not listed.
    expect(stylePlots(STUDY_MODULES.rsi).map((p) => p.id)).not.toContain('plot6');
    expect(stylePlots(STUDY_MODULES.rsi).map((p) => p.id)).toContain('plot0');
  });
});

describe('one colour, one box, one effect (FD-COLORUNIFY)', () => {
  it('a line of several colours has a box each: MACD histogram, each colour applied whatever its case', () => {
    const macd = STUDY_MODULES.macd;
    const hist = macd.plotConfig.find((p) => p.id === 'plot0');
    expect(hist?.palette).toEqual(['#26A69A', '#B2DFDB', '#FFCDD2', '#FF5252']);
    const s = styledEntry(macd, { plots: { plot0: { palette: { '#FF5252': '#000000', '#26A69A': '#FFFFFF80' } } } }, {}, result());
    expect(s.options.plots?.plot0?.palette).toEqual({ '#ff5252': '#000000', '#26a69a': '#FFFFFF80' });
    // Bull Bear Power writes #f23645 in its code: the box (declared as the code writes it) still applies.
    expect(pointColor({ color: '#089981' }, { palette: { '#f23645': '#0000FF' } }, '#F23645')).toBe('#0000FF');
  });

  it('a palette choice wins over a colour chosen before for the plot own colour (AO green)', () => {
    const o = { color: '#111111', palette: { '#009688': '#222222' } };
    expect(pointColor({ color: '#009688' }, o, '#009688')).toBe('#222222');
    expect(pointColor({ color: '#009688' }, { color: '#111111' }, '#009688')).toBe('#111111');
    expect(pointColor({ color: '#009688' }, { color: '#111111' }, '#F44336')).toBe('#F44336');
    expect(pointColor({ color: '#009688' }, { color: '#111111' }, undefined)).toBe('#111111');
    expect(pointColor({ color: '#009688' }, undefined, undefined)).toBe('#009688');
    const ao = STUDY_MODULES['awesome-oscillator'];
    const s = styledEntry(ao, { plots: { plot0: o } }, {}, result());
    expect(s.options.plots?.plot0?.palette).toEqual({ '#009688': '#222222' });
  });

  it('an hline follows the input as Pine draws it, until a colour is chosen for it (TSI, Technical Ratings)', () => {
    const tsi = STUDY_MODULES['trend-strength'];
    const bull = tsi.hlineConfig?.find((h) => h.id === 'hline_bull');
    const r = tsi.calculate(
      Array.from({ length: 40 }, (_, i) => ({ time: i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 })),
      { length: 14, bullishColor: '#2962FF1A', bearishColor: '#F236451A' },
    );
    expect(bull && hlineDefault(tsi, bull, r)).toMatch(/^(#2962ff(ff)?|rgba?\(41, ?98, ?255(, ?1)?\))$/i);
    const s = styledEntry(tsi, {}, {}, r);
    expect(s.entry.hlineConfig?.find((h) => h.id === 'hline_bull')?.color).toBe(bull && hlineDefault(tsi, bull, r));
    expect(styledEntry(tsi, { hlines: { hline_bull: { color: '#00FF00' } } }, {}, r).entry.hlineConfig?.find((h) => h.id === 'hline_bull')?.color).toBe('#00FF00');
    // Without a result hline at the same level (another indicator, or none returned): its own colour.
    expect(bull && hlineDefault(tsi, bull, null)).toBe('#089981');
    expect(bull && hlineDefault(tsi, bull, { hlines: [{ value: 0, options: { color: '#000000' } }, { value: 2, options: { color: '#000000' } }] } as never)).toBe('#089981');
  });
});

describe('fills in the Style tab (FD-FILLS)', () => {
  it('a key for each fill: its id, else its title, else its two lines; a repeated one numbered', () => {
    expect(
      fillKeys([
        { id: 'fill_band', plot1: 'hline_upper', plot2: 'hline_lower' },
        { plot1: 'plot1', plot2: 'plot2', options: { title: 'BB Background' } },
        { plot1: 'plot0', plot2: 'plot6', options: { title: 'Overbought Gradient Fill' } },
        { plot1: 'plot0', plot2: 'plot6', options: { title: 'Overbought Gradient Fill' } },
        { plot1: 3, plot2: 4 },
        { id: '1st', plot1: 'a', plot2: 'b' },
      ]),
    ).toEqual(['fill_band', 'f_BB_Background', 'f_Overbought_Gradient_Fill', 'f_Overbought_Gradient_Fill_2', 'f_3_4', 'f_1st']);
  });

  const rsi = STUDY_MODULES.rsi;
  const rsiResult = result({
    fills: [
      { plot1: 'plot2', plot2: 'plot3', options: { color: '#089981', transp: 90, title: 'BB Background' } },
      { plot1: 'plot0', plot2: 'plot6', options: { title: 'Overbought Gradient Fill' }, gradient: { topValue: [100], bottomValue: [70], topColor: ['#4CAF50'], bottomColor: ['#4CAF5000'] } },
    ] as IndicatorResult['fills'],
  });

  it('lists the declared fills, then the ones drawn now; the colour with the indicator transparency in it; a gradient only shown / hidden', () => {
    expect(styleFills(rsi, rsiResult)).toEqual([
      { key: 'fill_band', title: 'RSI Upper Band – RSI Lower Band', color: '#7E57C219' },
      // transp 90: opacity byte 25, as TradingView draws it (lma.test: color.new(c, 90))
      { key: 'f_BB_Background', title: 'BB Background', color: '#08998119' },
      { key: 'f_Overbought_Gradient_Fill', title: 'Overbought Gradient Fill', color: null },
    ]);
    // without a result (a hidden indicator): the declared ones only
    expect(styleFills(rsi, null).map((f) => f.key)).toEqual(['fill_band']);
    expect(styleFills(STUDY_MODULES.bb, result({ fills: [{ plot1: 'plot1', plot2: 'plot2', options: { color: '#2196F3', transp: 95, title: 'Background' } }] as IndicatorResult['fills'] }))).toEqual([
      { key: 'f_Background', title: 'Background', color: '#2196F30D' },
    ]);
  });

  it('a hidden fill goes from both lists; a colour chosen is drawn exactly (no transp); a gradient keeps its colours', () => {
    const s = styledEntry(rsi, { fills: { fill_band: { visible: false }, f_BB_Background: { color: '#FF000080' }, f_Overbought_Gradient_Fill: { color: '#00FF00' } } }, {}, rsiResult);
    expect(s.entry.fillConfig?.map((f) => f.id)).toEqual((rsi.fillConfig ?? []).filter((f) => f.id !== 'fill_band').map((f) => f.id));
    expect(s.result.fills).toEqual([
      { plot1: 'plot2', plot2: 'plot3', color: '#FF000080', options: { color: '#FF000080', title: 'BB Background' } },
      rsiResult.fills?.[1],
    ]);
    const hidden = styledEntry(rsi, { fills: { f_Overbought_Gradient_Fill: { visible: false } } }, {}, rsiResult);
    expect(hidden.result.fills?.map((f) => f.options?.title)).toEqual(['BB Background']);
    // a declared fill recoloured
    expect(styledEntry(rsi, { fills: { fill_band: { color: '#12345680' } } }, {}, rsiResult).entry.fillConfig?.find((f) => f.id === 'fill_band')?.color).toBe('#12345680');
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
