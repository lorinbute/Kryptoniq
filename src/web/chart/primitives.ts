// Custom lightweight-charts primitives: the EMA cloud fill, horizontal segments (TP/SL, market structure) and the
// LMA gradient fill and state label (TD-CHARTUX §3).
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { colorNew, rgbaCss, type Rgba } from '../../shared/indicator/lma.ts';
import type { HLine } from '../../shared/hlines.ts';

interface Attached {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  requestUpdate: () => void;
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------- EMA cloud ----------------

export interface CloudPoint {
  time: UTCTimestamp;
  fast: number;
  slow: number;
  up: boolean;
}

class CloudRenderer implements IPrimitivePaneRenderer {
  private readonly polys: { pts: [number, number][]; color: string }[];
  constructor(polys: { pts: [number, number][]; color: string }[]) {
    this.polys = polys;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      for (const p of this.polys) {
        if (p.pts.length < 4) continue;
        ctx.beginPath();
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * hr, y * vr) : ctx.moveTo(x * hr, y * vr)));
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
      }
    });
  }
}

class CloudView implements IPrimitivePaneView {
  private readonly source: CloudFill;
  private polys: { pts: [number, number][]; color: string }[] = [];
  constructor(source: CloudFill) {
    this.source = source;
  }
  zOrder() {
    return 'bottom' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    this.polys = [];
    if (!a) return;
    const ts = a.chart.timeScale();
    const pts = this.source.points;
    const range = ts.getVisibleLogicalRange();
    const from = range ? Math.max(0, Math.floor(range.from) - 2) : 0;
    const to = range ? Math.min(pts.length - 1, Math.ceil(range.to) + 2) : pts.length - 1;
    let cur: { up: boolean; top: [number, number][]; bottom: [number, number][] } | null = null;
    const flush = () => {
      if (cur && cur.top.length > 1) {
        this.polys.push({ pts: [...cur.top, ...cur.bottom.reverse()], color: hexA(cur.up ? this.source.upColor : this.source.downColor, 0.5) });
      }
      cur = null;
    };
    for (let i = from; i <= to; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p.fast) || !Number.isFinite(p.slow)) {
        flush();
        continue;
      }
      const x = ts.logicalToCoordinate(i as Logical);
      const y1 = a.series.priceToCoordinate(p.fast);
      const y2 = a.series.priceToCoordinate(p.slow);
      if (x === null || y1 === null || y2 === null) {
        flush();
        continue;
      }
      if (cur && cur.up !== p.up) {
        // Like Pine's fill(), the band between bar i-1 and i takes bar i's colour: the new
        // colour starts from the previous bar so the fill stays continuous.
        const prevTop = cur.top.at(-1) as [number, number];
        const prevBottom = cur.bottom.at(-1) as [number, number];
        flush();
        cur = { up: p.up, top: [prevTop], bottom: [prevBottom] };
      }
      if (!cur) cur = { up: p.up, top: [], bottom: [] };
      cur.top.push([x, y1]);
      cur.bottom.push([x, y2]);
    }
    flush();
  }
  renderer(): IPrimitivePaneRenderer {
    return new CloudRenderer(this.polys);
  }
}

export class CloudFill implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  points: CloudPoint[] = [];
  upColor = '#00FFAA';
  downColor = '#FF5252';
  private readonly views: CloudView[] = [new CloudView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(points: CloudPoint[], upColor: string, downColor: string): void {
    this.points = points;
    this.upColor = upColor;
    this.downColor = downColor;
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

// ---------------- horizontal segments ----------------

export interface Segment {
  fromBar: number;
  toBar: number;
  price: number;
  color: string;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
  label?: { text: string[]; bar: number; placement: 'above' | 'below' | 'right'; size: number };
}

interface DrawnSegment {
  x1: number;
  x2: number;
  y: number;
  seg: Segment;
  labelX: number | null;
}

class SegmentsRenderer implements IPrimitivePaneRenderer {
  private readonly items: DrawnSegment[];
  constructor(items: DrawnSegment[]) {
    this.items = items;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      for (const it of this.items) {
        const { seg } = it;
        ctx.save();
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = Math.max(1, Math.round(seg.width * hr));
        ctx.setLineDash(seg.style === 'dashed' ? [6 * hr, 4 * hr] : seg.style === 'dotted' ? [1.5 * hr, 3 * hr] : []);
        const y = Math.round(it.y * vr) + 0.5;
        ctx.beginPath();
        ctx.moveTo(it.x1 * hr, y);
        ctx.lineTo(it.x2 * hr, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (seg.label && it.labelX !== null) {
          const fs = seg.label.size * vr;
          ctx.font = `600 ${fs}px "Geist Variable", system-ui, sans-serif`;
          const lines = seg.label.text;
          const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10 * hr;
          const lh = fs * 1.25;
          const h = lines.length * lh + 6 * vr;
          // Keep the text inside the pane when its anchor (bars in the future) is scrolled out of view.
          const x = Math.max(4 * hr, Math.min(it.labelX * hr, bitmapSize.width - w - 4 * hr));
          const top = seg.label.placement === 'above' ? y - h - 4 * vr : seg.label.placement === 'below' ? y + 4 * vr : y - h / 2;
          ctx.fillStyle = hexA(seg.color.startsWith('#') ? seg.color : '#888888', 0.18);
          ctx.beginPath();
          ctx.roundRect(x, top, w, h, 4 * hr);
          ctx.fill();
          ctx.fillStyle = seg.color;
          lines.forEach((l, i) => ctx.fillText(l, x + 5 * hr, top + 3 * vr + lh * (i + 0.8)));
        }
        ctx.restore();
      }
    });
  }
}

class SegmentsView implements IPrimitivePaneView {
  private readonly source: HSegments;
  private items: DrawnSegment[] = [];
  constructor(source: HSegments) {
    this.source = source;
  }
  zOrder() {
    return 'top' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    this.items = [];
    if (!a) return;
    const ts = a.chart.timeScale();
    for (const seg of this.source.segments) {
      const x1 = ts.logicalToCoordinate(seg.fromBar as Logical);
      const x2 = ts.logicalToCoordinate(seg.toBar as Logical);
      const y = a.series.priceToCoordinate(seg.price);
      if (x1 === null || x2 === null || y === null || !Number.isFinite(seg.price)) continue;
      const labelX = seg.label ? ts.logicalToCoordinate(seg.label.bar as Logical) : null;
      this.items.push({ x1, x2, y, seg, labelX });
    }
  }
  renderer(): IPrimitivePaneRenderer {
    return new SegmentsRenderer(this.items);
  }
}

export class HSegments implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  segments: Segment[] = [];
  private readonly views: SegmentsView[] = [new SegmentsView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(segments: Segment[]): void {
    this.segments = segments;
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

// ---------------- LMA: gradient fill between the signal and 0 ----------------

/** One bar of the LMA plot; the index in the array is the bar's logical index. */
export interface FillPoint {
  value: number;
  color: Rgba;
}

interface DrawnFill {
  pts: [number, number][];
  /** Gradient from y1 (colour c1) to y2 (colour c2). */
  y1: number;
  y2: number;
  c1: string;
  c2: string;
}

class GradientFillRenderer implements IPrimitivePaneRenderer {
  private readonly items: DrawnFill[];
  constructor(items: DrawnFill[]) {
    this.items = items;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      for (const it of this.items) {
        if (it.y1 === it.y2) continue;
        const g = ctx.createLinearGradient(0, it.y1 * vr, 0, it.y2 * vr);
        g.addColorStop(0, it.c1);
        g.addColorStop(1, it.c2);
        ctx.beginPath();
        it.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * hr, y * vr) : ctx.moveTo(x * hr, y * vr)));
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
      }
    });
  }
}

class GradientFillView implements IPrimitivePaneView {
  private readonly source: GradientFill;
  private items: DrawnFill[] = [];
  constructor(source: GradientFill) {
    this.source = source;
  }
  zOrder() {
    return 'bottom' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    this.items = [];
    if (!a) return;
    const ts = a.chart.timeScale();
    const pts = this.source.points;
    const range = ts.getVisibleLogicalRange();
    const from = Math.max(1, range ? Math.floor(range.from) - 1 : 1);
    const to = Math.min(pts.length - 1, range ? Math.ceil(range.to) + 1 : pts.length - 1);
    const y0 = a.series.priceToCoordinate(0);
    if (y0 === null) return;
    for (let i = from; i <= to; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      if (!p0 || !p1 || !Number.isFinite(p0.value) || !Number.isFinite(p1.value)) continue;
      const x0 = ts.logicalToCoordinate((i - 1) as Logical);
      const x1 = ts.logicalToCoordinate(i as Logical);
      const ya = a.series.priceToCoordinate(p0.value);
      const yb = a.series.priceToCoordinate(p1.value);
      if (x0 === null || x1 === null || ya === null || yb === null) continue;
      // Pine: fill(pm, p0, top, bottom, topColor, bottomColor) with the bar's colour at the line and none at 0.
      const c = rgbaCss(colorNew(p1.color, 10));
      // Pine's other end is #00000000; the same hue at alpha 0 avoids a grey fringe if a browser mixes unpremultiplied.
      const clear = rgbaCss({ ...p1.color, a: 0 });
      const above = p1.value > 0;
      this.items.push({ pts: [[x0, ya], [x1, yb], [x1, y0], [x0, y0]], y1: above ? yb : y0, y2: above ? y0 : yb, c1: above ? c : clear, c2: above ? clear : c });
    }
  }
  renderer(): IPrimitivePaneRenderer {
    return new GradientFillRenderer(this.items);
  }
}

export class GradientFill implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  points: FillPoint[] = [];
  private readonly views: GradientFillView[] = [new GradientFillView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(points: FillPoint[]): void {
    this.points = points;
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

// ---------------- LMA: state label (Pine label.style_label_left) ----------------

export interface EdgeLabelData {
  /** Logical bar of the anchor (Pine: bar_index + 2). */
  bar: number;
  value: number;
  text: string;
  background: string;
  color: string;
}

class EdgeLabelRenderer implements IPrimitivePaneRenderer {
  private readonly item: { x: number; y: number; d: EdgeLabelData } | null;
  constructor(item: { x: number; y: number; d: EdgeLabelData } | null) {
    this.item = item;
  }
  draw(target: CanvasRenderingTarget2D): void {
    const it = this.item;
    if (!it) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const fs = 12 * vr;
      ctx.font = `600 ${fs}px "Geist Variable", system-ui, sans-serif`;
      const tw = ctx.measureText(it.d.text).width;
      const padX = 7 * hr;
      const h = fs + 9 * vr;
      const tip = 6 * hr;
      const x = it.x * hr;
      const y = it.y * vr;
      // The pointer sits on the anchor; the box extends to the right, like label.style_label_left.
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + tip, y - h / 2);
      ctx.lineTo(x + tip + tw + 2 * padX, y - h / 2);
      ctx.lineTo(x + tip + tw + 2 * padX, y + h / 2);
      ctx.lineTo(x + tip, y + h / 2);
      ctx.closePath();
      ctx.fillStyle = it.d.background;
      ctx.fill();
      ctx.fillStyle = it.d.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(it.d.text, x + tip + padX, y + 0.5 * vr);
    });
  }
}

class EdgeLabelView implements IPrimitivePaneView {
  private readonly source: EdgeLabel;
  private item: { x: number; y: number; d: EdgeLabelData } | null = null;
  constructor(source: EdgeLabel) {
    this.source = source;
  }
  zOrder() {
    return 'top' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    const d = this.source.data;
    this.item = null;
    if (!a || !d || !Number.isFinite(d.value)) return;
    const x = a.chart.timeScale().logicalToCoordinate(d.bar as Logical);
    const y = a.series.priceToCoordinate(d.value);
    if (x === null || y === null) return;
    this.item = { x, y, d };
  }
  renderer(): IPrimitivePaneRenderer {
    return new EdgeLabelRenderer(this.item);
  }
}

export class EdgeLabel implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  data: EdgeLabelData | null = null;
  private readonly views: EdgeLabelView[] = [new EdgeLabelView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(data: EdgeLabelData | null): void {
    this.data = data;
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

// ---------------- Slingshot: LONG / TAKE PROFIT as triangles (Pine label.style_triangleup / _triangledown) ----------------

export interface ShapeLabel {
  /** Logical bar index. */
  bar: number;
  /** The bar's low (`below`) or high (`above`): Pine yloc.belowbar / yloc.abovebar. */
  price: number;
  position: 'below' | 'above';
  color: string;
  text: string;
}

class ShapeLabelsRenderer implements IPrimitivePaneRenderer {
  private readonly items: { x: number; y: number; s: ShapeLabel }[];
  constructor(items: { x: number; y: number; s: ShapeLabel }[]) {
    this.items = items;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      // size.small: a ~11 px triangle, 11 px text, a few pixels away from the bar.
      const half = 5.5 * hr;
      const h = 9 * vr;
      const gap = 5 * vr;
      const fs = 11 * vr;
      ctx.font = `600 ${fs}px "Geist Variable", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const { x: x0, y: y0, s } of this.items) {
        const x = x0 * hr;
        const y = y0 * vr;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        if (s.position === 'below') {
          const top = y + gap;
          ctx.moveTo(x, top);
          ctx.lineTo(x + half, top + h);
          ctx.lineTo(x - half, top + h);
          ctx.closePath();
          ctx.fill();
          ctx.textBaseline = 'top';
          ctx.fillText(s.text, x, top + h + 3 * vr);
        } else {
          const bottom = y - gap;
          ctx.moveTo(x, bottom);
          ctx.lineTo(x + half, bottom - h);
          ctx.lineTo(x - half, bottom - h);
          ctx.closePath();
          ctx.fill();
          ctx.textBaseline = 'bottom';
          ctx.fillText(s.text, x, bottom - h - 3 * vr);
        }
      }
    });
  }
}

class ShapeLabelsView implements IPrimitivePaneView {
  private readonly source: ShapeLabels;
  private items: { x: number; y: number; s: ShapeLabel }[] = [];
  constructor(source: ShapeLabels) {
    this.source = source;
  }
  zOrder() {
    return 'top' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    this.items = [];
    if (!a) return;
    const ts = a.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    for (const s of this.source.shapes) {
      if (range && (s.bar < range.from - 2 || s.bar > range.to + 2)) continue;
      const x = ts.logicalToCoordinate(s.bar as Logical);
      const y = a.series.priceToCoordinate(s.price);
      if (x === null || y === null) continue;
      this.items.push({ x, y, s });
    }
  }
  renderer(): IPrimitivePaneRenderer {
    return new ShapeLabelsRenderer(this.items);
  }
}

export class ShapeLabels implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  shapes: ShapeLabel[] = [];
  private readonly views: ShapeLabelsView[] = [new ShapeLabelsView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(shapes: ShapeLabel[]): void {
    this.shapes = shapes;
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

// ---------------- FD-HLINE: the horizontal lines the user draws ----------------

/** How near (CSS px) the pointer must be to a line to catch it. */
export const HLINE_CATCH_PX = 5;

/** White or black, whichever reads better on a colour (#RRGGBB[AA]). */
function contrastOn(color: string): string {
  const h = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0e14' : '#ffffff';
}

/** The colour without its transparency (the axis label is always solid). */
const solid = (color: string) => color.slice(0, 7);

const DASH: Record<HLine['style'], (hr: number) => number[]> = { solid: () => [], dashed: (hr) => [6 * hr, 4 * hr], dotted: (hr) => [1.5 * hr, 3 * hr] };

class HLinesRenderer implements IPrimitivePaneRenderer {
  private readonly items: { y: number; line: HLine; selected: boolean }[];
  constructor(items: { y: number; line: HLine; selected: boolean }[]) {
    this.items = items;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      for (const { y: cssY, line: l, selected } of this.items) {
        const width = Math.max(1, Math.round((l.width + (selected ? 1 : 0)) * hr));
        const y = Math.round(cssY * vr) + (width % 2 ? 0.5 : 0);
        ctx.save();
        // The text first measured: "Mijloc" leaves a gap in the line for it.
        const rows = l.text ? l.text.split('\n') : [];
        let text: { x: number; top: number; lh: number; font: string } | null = null;
        let gap: [number, number] | null = null;
        if (rows.length) {
          const fs = l.textSize * vr;
          const font = `${l.italic ? 'italic ' : ''}${l.bold ? 700 : 400} ${fs}px "Geist Variable", system-ui, sans-serif`;
          ctx.font = font;
          const tw = Math.max(...rows.map((r) => ctx.measureText(r).width));
          const lh = fs * 1.25;
          const th = rows.length * lh;
          const pad = 8 * hr;
          const x = l.hAlign === 'left' ? pad : l.hAlign === 'center' ? (bitmapSize.width - tw) / 2 : bitmapSize.width - tw - pad;
          const top = l.vAlign === 'top' ? y - width / 2 - 3 * vr - th : l.vAlign === 'bottom' ? y + width / 2 + 3 * vr : y - th / 2;
          if (l.vAlign === 'middle') gap = [x - 5 * hr, x + tw + 5 * hr];
          text = { x, top, lh, font };
        }
        ctx.strokeStyle = l.color;
        ctx.lineWidth = width;
        ctx.setLineDash(DASH[l.style](hr));
        ctx.beginPath();
        if (gap) {
          ctx.moveTo(0, y);
          ctx.lineTo(Math.max(0, gap[0]), y);
          ctx.moveTo(Math.min(bitmapSize.width, gap[1]), y);
          ctx.lineTo(bitmapSize.width, y);
        } else {
          ctx.moveTo(0, y);
          ctx.lineTo(bitmapSize.width, y);
        }
        ctx.stroke();
        if (text) {
          ctx.setLineDash([]);
          ctx.font = text.font;
          ctx.fillStyle = l.textColor;
          ctx.textBaseline = 'middle';
          rows.forEach((r, i) => ctx.fillText(r, text.x, text.top + text.lh * (i + 0.5)));
        }
        ctx.restore();
      }
    });
  }
}

class HLinesView implements IPrimitivePaneView {
  private readonly source: HLines;
  private items: { y: number; line: HLine; selected: boolean }[] = [];
  constructor(source: HLines) {
    this.source = source;
  }
  zOrder() {
    return 'top' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    this.items = [];
    if (!a) return;
    for (const line of this.source.lines) {
      const y = a.series.priceToCoordinate(line.price);
      if (y !== null) this.items.push({ y, line, selected: line.id === this.source.selected });
    }
  }
  renderer(): IPrimitivePaneRenderer {
    return new HLinesRenderer(this.items);
  }
}

class HLineAxisView implements ISeriesPrimitiveAxisView {
  private readonly source: HLines;
  private readonly line: HLine;
  private y: number | null = null;
  constructor(source: HLines, line: HLine) {
    this.source = source;
    this.line = line;
  }
  update(): void {
    this.y = this.source.attachedTo?.series.priceToCoordinate(this.line.price) ?? null;
  }
  coordinate(): number {
    return this.y ?? -1000;
  }
  text(): string {
    return this.line.price.toFixed(this.source.precision);
  }
  textColor(): string {
    return contrastOn(this.line.color);
  }
  backColor(): string {
    return solid(this.line.color);
  }
  visible(): boolean {
    // Out of the price pane: no label (the line is not drawn there either).
    const h = this.source.attachedTo?.chart.panes()[0]?.getHeight() ?? 0;
    return this.y !== null && this.y >= 0 && this.y <= h;
  }
}

/** The lines on the price pane: drawn full width with their text, a label on the price axis, caught by the pointer. */
export class HLines implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  lines: HLine[] = [];
  selected: string | null = null;
  precision = 2;
  private readonly views: HLinesView[] = [new HLinesView(this)];
  private axisViews: HLineAxisView[] = [];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(lines: HLine[], selected: string | null, precision: number): void {
    this.lines = lines;
    this.selected = selected;
    this.precision = precision;
    this.axisViews = lines.filter((l) => l.priceLabel).map((l) => new HLineAxisView(this, l));
    this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
    for (const v of this.axisViews) v.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }
  /** The line nearest to `y` (CSS px from the price pane's top), within reach; null when none. */
  lineAt(y: number): { id: string; distance: number } | null {
    const a = this.attachedTo;
    if (!a) return null;
    let best: { id: string; distance: number } | null = null;
    for (const l of this.lines) {
      const ly = a.series.priceToCoordinate(l.price);
      if (ly === null) continue;
      const distance = Math.abs(ly - y);
      if (distance <= HLINE_CATCH_PX && (!best || distance < best.distance)) best = { id: l.id, distance };
    }
    return best;
  }
  hitTest(_x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.lineAt(y);
    return hit ? { externalId: `hline:${hit.id}`, cursorStyle: 'ns-resize', zOrder: 'top', distance: hit.distance, hitTestPriority: 1, itemType: 'primitive' } : null;
  }
}
