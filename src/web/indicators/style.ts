// The style the user chose for an indicator (FD-INDICATORS §3 "Stil", TD-INDICATORS §8): what the renderer gets (the
// plots' overrides, the hlines recoloured or hidden, the fills of hidden plots left out), and what its legend reads.
import type { FillConfig, HLineConfig, IndicatorResult, PlotConfig } from 'oakscriptjs';
import type { Study } from '../../shared/studies.ts';
import type { StudyModule } from './catalog.ts';
import type { PlotOverride, RenderableIndicator, RenderOptions } from './vendor/render/index';
import { formatColor, parseColor } from '../color.ts';
import { colorKey } from './color-links.ts';

/** The plots listed in the Style tab: the editable ones that draw something (not a value kept for alerts). */
export function stylePlots(mod: Pick<StudyModule, 'plotConfig'>): PlotConfig[] {
  return mod.plotConfig.filter((p) => p.editable !== false && p.color !== 'transparent' && p.display !== 'data_window' && p.display !== 'status_line');
}

/** The hlines listed in the Style tab. */
export function styleHlines(mod: Pick<StudyModule, 'hlineConfig'>): HLineConfig[] {
  return (mod.hlineConfig ?? []).filter((h) => h.editable !== false);
}

/** A fill as the indicators give them: declared (FillConfig) or drawn by the result (FillData). */
type AnyFill = {
  id?: string;
  plot1: number | string;
  plot2: number | string;
  title?: string;
  color?: string;
  colors?: unknown;
  gradient?: unknown;
  editable?: boolean;
  options?: { color?: string; title?: string; transp?: number; editable?: boolean };
};

const keyPart = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 56);

/**
 * Each fill's key in the saved style (FD-FILLS): its id, else its title, else its two lines; a repeated one gets _2, _3.
 * Computed on a whole list, so the Style tab and the drawing give a fill the same key.
 */
export function fillKeys(fills: readonly AnyFill[]): string[] {
  const seen = new Map<string, number>();
  return fills.map((f) => {
    const title = f.title ?? f.options?.title;
    const raw = f.id ?? (title ? `f_${title}` : `f_${String(f.plot1)}_${String(f.plot2)}`);
    const base = /^[A-Za-z_]/.test(raw) ? keyPart(raw) : `f_${keyPart(raw)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  });
}

/** A fill with a single colour gets a colour box; one coloured bar by bar, or a gradient, only its visibility (TradingView). */
export const fillColorEditable = (f: Pick<AnyFill, 'colors' | 'gradient'>) => !f.colors && !f.gradient;

/** A fill as the Style tab lists it: its key, its name and its single colour as drawn now (null: bar by bar or a gradient). */
export interface StyleFill {
  key: string;
  title: string;
  color: string | null;
}

/** The colour a result fill is drawn with: its colour with the indicator's own transparency (`transp`) in it. */
function drawnColor(f: AnyFill): string {
  const raw = f.options?.color ?? f.color ?? '#2962FF';
  const transp = f.options?.transp;
  if (transp == null) return raw;
  const { hex, alpha } = parseColor(raw);
  return formatColor(hex, alpha * (1 - Math.min(100, Math.max(0, transp)) / 100));
}

/** The fills listed in the Style tab (FD-FILLS): the declared ones, then those the result draws now, each once. */
export function styleFills(mod: Pick<StudyModule, 'fillConfig' | 'plotConfig' | 'hlineConfig'>, result: Pick<IndicatorResult, 'fills'> | null | undefined): StyleFill[] {
  const lineTitle = (id: number | string) =>
    mod.plotConfig.find((p) => p.id === String(id))?.title || mod.hlineConfig?.find((h) => h.id === String(id))?.title || String(id);
  const out: StyleFill[] = [];
  const add = (list: readonly AnyFill[]) => {
    const keys = fillKeys(list);
    list.forEach((f, i) => {
      const key = keys[i] as string;
      if (f.editable === false || f.options?.editable === false || out.some((x) => x.key === key)) return;
      const title = f.title ?? f.options?.title ?? `${lineTitle(f.plot1)} – ${lineTitle(f.plot2)}`;
      out.push({ key, title, color: fillColorEditable(f) ? drawnColor(f) : null });
    });
  };
  add((mod.fillConfig ?? []) as AnyFill[]);
  add((result?.fills ?? []) as AnyFill[]);
  return out;
}

/** What the Style tab offers for a plot (FD-STUDYUX §3): kind and width for a line, width only, or neither. */
const LINE_PLOTS = new Set(['line', 'stepline', 'stepline_diamond', 'linebr', 'steplinebr', 'area', 'areabr']);
const WIDTH_PLOTS = new Set(['histogram', 'circles', 'cross']);
export function lineKind(def: Pick<PlotConfig, 'style'>): 'line' | 'width' | null {
  const st = def.style ?? 'line';
  return LINE_PLOTS.has(st) ? 'line' : WIDTH_PLOTS.has(st) ? 'width' : null;
}

/** The width a plot is drawn with when nobody chose one: its own, else the renderer's (2 px; 1 px for a histogram); the line box shows it selected (FD-STYLEUNIFY). */
export const plotWidth = (def: Pick<PlotConfig, 'style' | 'lineWidth'>) => def.lineWidth ?? (def.style === 'histogram' ? 1 : 2);

/** Whether an hline is drawn: its override, else its own `display`. */
export const hlineShown = (h: HLineConfig, o: { visible?: boolean } | undefined) => o?.visible ?? h.display !== 'none';

type PlotStyle = NonNullable<Study['plots']>[string];

/**
 * The colour a point of a plot is drawn in with the user's style (FD-COLORUNIFY): its palette choice, else (a point in
 * the plot's own colour) the colour chosen for the plot, else its own. Colours compare by `colorKey`.
 */
export function pointColor(def: Pick<PlotConfig, 'color'>, o: PlotStyle | undefined, c: string | undefined): string {
  if (!c) return o?.color || def.color || '#2962FF';
  const k = colorKey(c);
  for (const [from, to] of Object.entries(o?.palette ?? {})) if (colorKey(from) === k) return to;
  if (o?.color && def.color && colorKey(def.color) === k) return o.color;
  return c;
}

/**
 * The colour an hline has when none was chosen (FD-COLORUNIFY D): the result's hline at the same place and level when the
 * indicator returns them (Pine: `hline(1, color = color.new(input, 0))` follows the input), else its own.
 */
export function hlineDefault(mod: Pick<StudyModule, 'hlineConfig'>, h: HLineConfig, result: Pick<IndicatorResult, 'hlines'> | null | undefined): string {
  const i = mod.hlineConfig?.indexOf(h) ?? -1;
  const r = i >= 0 ? (result?.hlines?.[i] as { value?: number; options?: { color?: string } } | undefined) : undefined;
  return (r && r.value === h.price && r.options?.color) || h.color || '#787B86';
}

/** What the renderer draws for one indicator with its style. */
export function styledEntry(
  mod: StudyModule,
  study: Pick<Study, 'plots' | 'hlines' | 'fills'>,
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
    // Keyed by `colorKey` (the renderer looks points up the same way); a palette choice wins over the plot's colour.
    const palette: Record<string, string> = {};
    if (o.color) {
      p.color = o.color;
      // Points drawn in the plot's own colour take the new one too.
      if (def.color) palette[colorKey(def.color)] = o.color;
    }
    for (const [from, to] of Object.entries(o.palette ?? {})) palette[colorKey(from)] = to;
    if (Object.keys(palette).length) p.palette = palette;
    plots[def.id] = p;
  }
  // Hidden with display none, not left out: an empty list would make the renderer draw the result's own hlines.
  const hlineConfig = mod.hlineConfig?.map((h) => {
    const o = study.hlines?.[h.id];
    return {
      ...h,
      color: o?.color ?? hlineDefault(mod, h, result),
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
  // A fill goes with a hidden line, or when the user hid it (FD-FILLS); a single-coloured one is drawn in the colour chosen,
  // exactly (the indicator's own transparency no longer added: the colour carries its opacity).
  const restyle = <F extends AnyFill>(list: readonly F[]): F[] => {
    const keys = fillKeys(list);
    const out: F[] = [];
    list.forEach((f, i) => {
      const o = study.fills?.[keys[i] as string];
      if (hidden.has(String(f.plot1)) || hidden.has(String(f.plot2)) || o?.visible === false) return;
      if (!o?.color || !fillColorEditable(f)) return void out.push(f);
      if (f.options) {
        const { transp: _drop, ...rest } = f.options;
        out.push({ ...f, color: o.color, options: { ...rest, color: o.color } });
      } else out.push({ ...f, color: o.color });
    });
    return out;
  };
  const fillConfig: FillConfig[] | undefined = mod.fillConfig ? restyle(mod.fillConfig as (FillConfig & AnyFill)[]) : undefined;
  const out: IndicatorResult = (hidden.size || study.fills) && result.fills?.length ? { ...result, fills: restyle(result.fills as (NonNullable<IndicatorResult['fills']>[number] & AnyFill)[]) } : result;
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
