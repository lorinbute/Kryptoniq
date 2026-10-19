// The style the user chose for an indicator (FD-INDICATORS §3 "Stil", TD-INDICATORS §8): what the renderer gets (the
// plots' overrides, the hlines recoloured or hidden, the fills of hidden plots left out), and what its legend reads.
import type { FillConfig, HLineConfig, IndicatorResult, PlotConfig } from 'oakscriptjs';
import type { Study } from '../../shared/studies.ts';
import type { StudyModule } from './catalog.ts';
import type { PlotOverride, RenderableIndicator, RenderOptions } from './vendor/render/index';

/** The plots listed in the Style tab: the editable ones that draw something (not a value kept for alerts). */
export function stylePlots(mod: Pick<StudyModule, 'plotConfig'>): PlotConfig[] {
  return mod.plotConfig.filter((p) => p.editable !== false && p.color !== 'transparent' && p.display !== 'data_window' && p.display !== 'status_line');
}

/** The hlines listed in the Style tab. */
export function styleHlines(mod: Pick<StudyModule, 'hlineConfig'>): HLineConfig[] {
  return (mod.hlineConfig ?? []).filter((h) => h.editable !== false);
}

/** What the Style tab offers for a plot (FD-STUDYUX §3): kind and width for a line, width only, or neither. */
const LINE_PLOTS = new Set(['line', 'stepline', 'stepline_diamond', 'linebr', 'steplinebr', 'area', 'areabr']);
const WIDTH_PLOTS = new Set(['histogram', 'circles', 'cross']);
export function lineKind(def: Pick<PlotConfig, 'style'>): 'line' | 'width' | null {
  const st = def.style ?? 'line';
  return LINE_PLOTS.has(st) ? 'line' : WIDTH_PLOTS.has(st) ? 'width' : null;
}

/** The width a plot is drawn with when nobody chose one: its own, else the renderer's (2 px; 1 px for a histogram). */
export const plotWidth = (def: Pick<PlotConfig, 'style' | 'lineWidth'>) => def.lineWidth ?? (def.style === 'histogram' ? 1 : 2);

/** "Implicită", "Groasă", "Foarte groasă": the width drawn by default (1–4 px), then +1 and +2 px. */
export function widthChoices(drawn: number): [number, number, number] {
  const base = Math.min(4, Math.max(1, Math.round(drawn)));
  return [base, base + 1, base + 2];
}

/** Whether an hline is drawn: its override, else its own `display`. */
export const hlineShown = (h: HLineConfig, o: { visible?: boolean } | undefined) => o?.visible ?? h.display !== 'none';

/** What the renderer draws for one indicator with its style. */
export function styledEntry(
  mod: StudyModule,
  study: Pick<Study, 'plots' | 'hlines'>,
  inputs: Record<string, unknown>,
  result: IndicatorResult,
): { entry: RenderableIndicator; result: IndicatorResult; options: RenderOptions } {
  const plots: Record<string, PlotOverride> = {};
  const hidden = new Set<string>();
  for (const def of mod.plotConfig) {
    const o = study.plots?.[def.id];
    if (!o) continue;
    const p: PlotOverride = {};
    if (o.visible !== undefined) p.visible = o.visible;
    if (o.visible === false) hidden.add(def.id);
    if (o.width !== undefined) p.lineWidth = o.width;
    const palette: Record<string, string> = { ...(o.palette ?? {}) };
    if (o.color) {
      p.color = o.color;
      // Points drawn in the plot's own colour take the new one too.
      palette[def.color] = o.color;
    }
    if (Object.keys(palette).length) p.palette = palette;
    plots[def.id] = p;
  }
  // Hidden with display none, not left out: an empty list would make the renderer draw the result's own hlines.
  const hlineConfig = mod.hlineConfig?.map((h) => {
    const o = study.hlines?.[h.id];
    return {
      ...h,
      ...(o?.color ? { color: o.color } : {}),
      ...(o?.width ? { linewidth: o.width } : {}),
      ...(o?.style ? { linestyle: o.style } : {}),
      // Its level as set by the user: the fills between hlines follow it (the renderer reads the prices from here).
      ...(o?.price !== undefined ? { price: o.price } : {}),
      ...(hlineShown(h, o) ? {} : { display: 'none' as const }),
    };
  });
  // A line's kind is read from its definition by the renderer: a copy of the list carries the chosen ones.
  const restyled = mod.plotConfig.some((def) => study.plots?.[def.id]?.style && lineKind(def) === 'line');
  const plotConfig = restyled
    ? mod.plotConfig.map((def) => {
        const st = study.plots?.[def.id]?.style;
        return st && lineKind(def) === 'line' ? { ...def, linestyle: st } : def;
      })
    : mod.plotConfig;
  const keepFill = (f: { plot1: number | string; plot2: number | string }) => !hidden.has(String(f.plot1)) && !hidden.has(String(f.plot2));
  const fillConfig: FillConfig[] | undefined = mod.fillConfig?.filter(keepFill);
  const out: IndicatorResult = hidden.size && result.fills?.length ? { ...result, fills: result.fills.filter(keepFill) } : result;
  return {
    entry: { overlay: mod.overlay, plotConfig, ...(hlineConfig ? { hlineConfig } : {}), ...(fillConfig ? { fillConfig } : {}) },
    result: out,
    options: { inputs, plots },
  };
}

/** Each plot's values by bar time, for the legend (built once per result). */
const lookups = new WeakMap<object, Map<string, Map<number, { value: number; color?: string }>>>();
export function plotValueAt(result: IndicatorResult, plotId: string, time: number): { value: number; color?: string } | undefined {
  let byPlot = lookups.get(result);
  if (!byPlot) {
    byPlot = new Map();
    lookups.set(result, byPlot);
  }
  let m = byPlot.get(plotId);
  if (!m) {
    m = new Map();
    for (const p of result.plots?.[plotId] ?? []) {
      const pt = p as { time: number; value: number; color?: string };
      m.set(pt.time, pt.color ? { value: pt.value, color: pt.color } : { value: pt.value });
    }
    byPlot.set(plotId, m);
  }
  return m.get(time);
}

/** Whether a plot has a value on any bar (a plot that is all na, e.g. a band that is switched off, stays out of the legend). */
const filled = new WeakMap<object, Map<string, boolean>>();
export function plotHasData(result: IndicatorResult, plotId: string): boolean {
  let byPlot = filled.get(result);
  if (!byPlot) {
    byPlot = new Map();
    filled.set(result, byPlot);
  }
  let has = byPlot.get(plotId);
  if (has === undefined) {
    has = (result.plots?.[plotId] ?? []).some((p) => typeof p.value === 'number' && Number.isFinite(p.value));
    byPlot.set(plotId, has);
  }
  return has;
}

/** "#2", "#3" for the same indicator added again with the same parameters (FD §6), by uid. */
export function legendNumbers(items: readonly { uid: string; id: string; params: string }[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const it of items) {
    const k = `${it.id}|${it.params}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) out.set(it.uid, n);
  }
  return out;
}
