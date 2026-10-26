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
import { fade, mixColor } from '../color.ts';
import { LABEL_FONT, LABEL_HEIGHT, labelGeometry, labelPartAt, type LabelGeometry, type TradeLabelSpec } from './trade-labels.ts';

/** FD-CHARTSETTINGS: the chart's background, its top and bottom colours (the same when it is solid). */
export interface ChartBackground {
  top: string;
  bottom: string;
}

interface Attached {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  requestUpdate: () => void;
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
        this.polys.push({ pts: [...cur.top, ...cur.bottom.reverse()], color: fade(cur.up ? this.source.upColor : this.source.downColor, 0.5) });
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
          ctx.fillStyle = fade(seg.color, 0.18);
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

/**
 * Which side of its anchor the label's box goes (FD-CHARTAUDIT §5): right, as in TradingView, when it fits in the
 * pane's width; left when only that fits (a narrow chart cut it at the price scale); right again when neither does.
 */
export function edgeLabelSide(x: number, boxWidth: number, paneWidth: number): 'right' | 'left' {
  return x + boxWidth > paneWidth && x - boxWidth >= 0 ? 'left' : 'right';
}

class EdgeLabelRenderer implements IPrimitivePaneRenderer {
  private readonly item: { x: number; y: number; d: EdgeLabelData } | null;
  constructor(item: { x: number; y: number; d: EdgeLabelData } | null) {
    this.item = item;
  }
  draw(target: CanvasRenderingTarget2D): void {
    const it = this.item;
    if (!it) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const fs = 12 * vr;
      ctx.font = `600 ${fs}px "Geist Variable", system-ui, sans-serif`;
      const tw = ctx.measureText(it.d.text).width;
      const padX = 7 * hr;
      const h = fs + 9 * vr;
      const tip = 6 * hr;
      const x = it.x * hr;
      const y = it.y * vr;
      const w = tip + tw + 2 * padX;
      // The pointer sits on the anchor; the box extends to the right, like label.style_label_left (or, when it would
      // be cut, to the left: label.style_label_right).
      const dir = edgeLabelSide(x, w, bitmapSize.width) === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * tip, y - h / 2);
      ctx.lineTo(x + dir * w, y - h / 2);
      ctx.lineTo(x + dir * w, y + h / 2);
      ctx.lineTo(x + dir * tip, y + h / 2);
      ctx.closePath();
      ctx.fillStyle = it.d.background;
      ctx.fill();
      ctx.fillStyle = it.d.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(it.d.text, dir === 1 ? x + tip + padX : x - w + padX, y + 0.5 * vr);
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

// ---------------- Slingshot: LONG / SHORT / TAKE PROFIT as triangles (Pine label.style_triangleup / _triangledown), an
// invalidated signal as an X (label.style_xcross) ----------------

/** A shape's size in CSS px: the triangle's width and height (the X takes the width) and its text (FD-SS34LIVE). */
export interface ShapeSize {
  w: number;
  h: number;
  text: number;
}

export interface ShapeLabel {
  /** Logical bar index. */
  bar: number;
  /** The bar's low (`below`) or high (`above`): Pine yloc.belowbar / yloc.abovebar. */
  price: number;
  position: 'below' | 'above';
  color: string;
  text: string;
  shape: 'triangle' | 'x';
  size: ShapeSize;
}

class ShapeLabelsRenderer implements IPrimitivePaneRenderer {
  private readonly items: { x: number; y: number; s: ShapeLabel }[];
  constructor(items: { x: number; y: number; s: ShapeLabel }[]) {
    this.items = items;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      // A few pixels between the bar and the shape, and between the shape and its text.
      const gap = 5 * vr;
      // The X's line width and caps stay here, not on the next drawings of the pane.
      ctx.save();
      ctx.textAlign = 'center';
      for (const { x: x0, y: y0, s } of this.items) {
        const x = x0 * hr;
        const y = y0 * vr;
        const half = (s.size.w / 2) * hr;
        // The X is as wide as the triangle and square.
        const h = (s.shape === 'x' ? s.size.w : s.size.h) * vr;
        const below = s.position === 'below';
        const near = below ? y + gap : y - gap;
        const far = below ? near + h : near - h;
        ctx.fillStyle = s.color;
        ctx.strokeStyle = s.color;
        if (s.shape === 'x') {
          const top = Math.min(near, far);
          ctx.lineWidth = Math.max(2, s.size.w / 6) * hr;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - half, top);
          ctx.lineTo(x + half, top + h);
          ctx.moveTo(x + half, top);
          ctx.lineTo(x - half, top + h);
          ctx.stroke();
        } else {
          // The tip points at the bar: up under it, down above it.
          ctx.beginPath();
          ctx.moveTo(x, near);
          ctx.lineTo(x + half, far);
          ctx.lineTo(x - half, far);
          ctx.closePath();
          ctx.fill();
        }
        ctx.font = `600 ${s.size.text * vr}px "Geist Variable", system-ui, sans-serif`;
        ctx.textBaseline = below ? 'top' : 'bottom';
        ctx.fillText(s.text, x, below ? far + 3 * vr : far - 3 * vr);
      }
      ctx.restore();
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

// ---------------- FD-ORDEREDIT, FD-TRADEUI: the trades' lines: their boxes, and what the pointer catches ----------------

/** How far a finger reaches a line, px (a mouse: HLINE_CATCH_PX). */
export const TRADE_TOUCH_CATCH_PX = 14;

/** A trade line as the boxes see it: its level, colour, box (or none) and whether it can be dragged. */
export interface TradeLabelItem {
  id: string;
  price: number;
  color: string;
  label: TradeLabelSpec | null;
  draggable: boolean;
  /** The entry it counts from: while dragged, the area between the two is coloured (FD-TRADEUI). */
  zoneFrom: number | null;
}

/** The area between a dragged SL / TP and its entry: TradingView's profit (green) or loss (orange) zone. */
class TradeZoneRenderer implements IPrimitivePaneRenderer {
  private readonly zone: { top: number; bottom: number; color: string } | null;
  constructor(zone: { top: number; bottom: number; color: string } | null) {
    this.zone = zone;
  }
  draw(target: CanvasRenderingTarget2D): void {
    const z = this.zone;
    if (!z) return;
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vr, bitmapSize }) => {
      const top = Math.round(z.top * vr);
      const bottom = Math.round(z.bottom * vr);
      ctx.fillStyle = fade(z.color, 0.14);
      ctx.fillRect(0, top, bitmapSize.width, bottom - top);
    });
  }
}

class TradeZoneView implements IPrimitivePaneView {
  private readonly source: TradeLabels;
  private zone: { top: number; bottom: number; color: string } | null = null;
  constructor(source: TradeLabels) {
    this.source = source;
  }
  // Under the candles: they stay readable over it.
  zOrder() {
    return 'bottom' as const;
  }
  update(): void {
    this.zone = this.source.zone();
  }
  renderer(): IPrimitivePaneRenderer {
    return new TradeZoneRenderer(this.zone);
  }
}

interface DrawnBox {
  y: number;
  item: TradeLabelItem;
  spec: TradeLabelSpec;
  g: LabelGeometry;
  selected: boolean;
  /** Being dragged now. */
  dragged: boolean;
  hover: 'close' | 'body' | null;
}

const labelFontAt = (scale: number) => LABEL_FONT.replace(/^\d+px/, `${12 * scale}px`);

class TradeLabelsRenderer implements IPrimitivePaneRenderer {
  private readonly boxes: DrawnBox[];
  private readonly background: ChartBackground;
  constructor(boxes: DrawnBox[], background: ChartBackground) {
    this.boxes = boxes;
    this.background = background;
  }
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      for (const b of this.boxes) {
        const { g, spec, item } = b;
        const left = Math.round(g.x * hr);
        const right = Math.round((g.x + g.w) * hr);
        const top = Math.round((b.y - LABEL_HEIGHT / 2) * vr);
        const bottom = top + Math.round(LABEL_HEIGHT * vr);
        const border = Math.max(1, Math.round((b.selected ? 2 : 1) * hr));
        const radius = 3 * hr;
        const qtyEnd = left + Math.round(g.qtyW * hr);
        const closeStart = right - Math.round(g.closeW * hr);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(left, top, right - left, bottom - top, radius);
        // Opaque, on the chart's background where it is (a gradient's colour at its middle).
        ctx.fillStyle = mixColor(this.background.top, this.background.bottom, (top + bottom) / 2 / bitmapSize.height);
        ctx.fill();
        ctx.clip();
        // Moved, not yet confirmed: the box tinted with its line's colour, its content dimmed (as TradingView).
        const pending = Boolean(spec.pending) || b.dragged;
        if (pending) {
          ctx.fillStyle = fade(item.color, 0.22);
          ctx.fillRect(left, top, right - left, bottom - top);
          ctx.globalAlpha = 0.7;
        }
        if (spec.fill && g.qtyW > 0) {
          ctx.fillStyle = item.color;
          ctx.fillRect(left, top, qtyEnd - left, bottom - top);
        }
        if (b.hover === 'close' && g.closeW > 0) {
          ctx.fillStyle = fade(item.color, 0.25);
          ctx.fillRect(closeStart, top, right - closeStart, bottom - top);
        }
        // The cells' separators, then the outline over them.
        ctx.fillStyle = item.color;
        const sep = Math.max(1, Math.round(hr));
        if (g.qtyW > 0) ctx.fillRect(qtyEnd - Math.floor(sep / 2), top, sep, bottom - top);
        if (g.closeW > 0) ctx.fillRect(closeStart - Math.floor(sep / 2), top, sep, bottom - top);
        ctx.restore();
        ctx.save();
        if (pending) ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.roundRect(left + border / 2, top + border / 2, right - left - border, bottom - top - border, radius);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = border;
        ctx.stroke();
        // The texts, centred in their cells: the digits' height on the box's middle (the font's own middle sits higher).
        const mid = (top + bottom) / 2;
        ctx.font = labelFontAt(vr);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const baseline = Math.round(mid + ctx.measureText('0').actualBoundingBoxAscent / 2);
        if (spec.qty !== null && g.qtyW > 0) {
          ctx.fillStyle = spec.fill ? contrastOn(item.color) : item.color;
          ctx.fillText(spec.qty, (left + qtyEnd) / 2, baseline);
        }
        ctx.fillStyle = spec.textColor;
        ctx.fillText(spec.text, (qtyEnd + (g.closeW > 0 ? closeStart : right)) / 2, baseline);
        if (g.closeW > 0) {
          // The ×: two strokes, 7 px, in the cell's middle.
          const cx = (closeStart + right) / 2;
          const d = 3.5 * hr;
          ctx.strokeStyle = item.color;
          ctx.lineWidth = Math.max(1, 1.25 * hr);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - d, mid - d);
          ctx.lineTo(cx + d, mid + d);
          ctx.moveTo(cx + d, mid - d);
          ctx.lineTo(cx - d, mid + d);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }
}

class TradeLabelsView implements IPrimitivePaneView {
  private readonly source: TradeLabels;
  private boxes: DrawnBox[] = [];
  constructor(source: TradeLabels) {
    this.source = source;
  }
  zOrder() {
    return 'top' as const;
  }
  update(): void {
    this.boxes = this.source.boxes();
  }
  renderer(): IPrimitivePaneRenderer {
    return new TradeLabelsRenderer(this.boxes, this.source.background);
  }
}

/**
 * The trades' lines (FD-ORDEREDIT, FD-TRADEUI): the library draws each line and its price on the scale; this draws its
 * box (quantity | PnL | ×), catches the pointer on the box, its × and the line, and gives the cursor there (↕ to drag,
 * a hand on the ×). A line being dragged is drawn where the pointer is, with its text there.
 */
export class TradeLabels implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  items: TradeLabelItem[] = [];
  background: ChartBackground = { top: '#000', bottom: '#000' };
  selected: string | null = null;
  hover: { id: string; part: 'close' | 'body' } | null = null;
  dragged: { id: string; price: number; text: string } | null = null;
  private readonly views: (TradeZoneView | TradeLabelsView)[] = [new TradeZoneView(this), new TradeLabelsView(this)];
  private readonly widths = new Map<string, number>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(items: TradeLabelItem[]): void {
    this.items = items;
    this.attachedTo?.requestUpdate();
  }
  /** FD-CHARTSETTINGS: the chart's background (the theme's or the settings'), under the boxes. */
  setBackground(background: ChartBackground): void {
    if (background.top === this.background.top && background.bottom === this.background.bottom) return;
    this.background = background;
    this.attachedTo?.requestUpdate();
  }
  setSelected(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.attachedTo?.requestUpdate();
  }
  setHover(h: { id: string; part: 'close' | 'body' } | null): void {
    if (this.hover?.id === h?.id && this.hover?.part === h?.part) return;
    this.hover = h;
    this.attachedTo?.requestUpdate();
  }
  setDragged(d: { id: string; price: number; text: string } | null): void {
    this.dragged = d;
    this.attachedTo?.requestUpdate();
  }
  /** A text's width in the boxes' font, CSS px (measured once per text). */
  measure = (text: string): number => {
    const known = this.widths.get(text);
    if (known !== undefined) return known;
    this.measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!this.measureCtx) return text.length * 7;
    this.measureCtx.font = LABEL_FONT;
    const w = this.measureCtx.measureText(text).width;
    if (this.widths.size > 500) this.widths.clear();
    this.widths.set(text, w);
    return w;
  };
  private priceOf(it: TradeLabelItem): number {
    return this.dragged?.id === it.id ? this.dragged.price : it.price;
  }
  private specOf(it: TradeLabelItem): TradeLabelSpec | null {
    if (!it.label) return null;
    return this.dragged?.id === it.id ? { ...it.label, text: this.dragged.text } : it.label;
  }
  /** The boxes as drawn now: their level (CSS px from the pane's top) and geometry. */
  boxes(): DrawnBox[] {
    const a = this.attachedTo;
    if (!a) return [];
    const width = a.chart.timeScale().width();
    const out: DrawnBox[] = [];
    for (const item of this.items) {
      const spec = this.specOf(item);
      if (!spec) continue;
      const y = a.series.priceToCoordinate(this.priceOf(item));
      if (y === null) continue;
      out.push({ y, item, spec, g: labelGeometry(spec, width, this.measure), selected: item.id === this.selected || item.id === this.dragged?.id, dragged: item.id === this.dragged?.id, hover: this.hover?.id === item.id ? this.hover.part : null });
    }
    // The line being dragged (or selected) over the others.
    return out.sort((x, y) => Number(x.selected) - Number(y.selected));
  }
  /** The coloured area of the line being dragged (its entry to where it is now), CSS px from the pane's top; or null. */
  zone(): { top: number; bottom: number; color: string } | null {
    const a = this.attachedTo;
    const d = this.dragged;
    const it = d ? this.items.find((x) => x.id === d.id) : undefined;
    if (!a || !d || !it || it.zoneFrom === null) return null;
    const y1 = a.series.priceToCoordinate(it.zoneFrom);
    const y2 = a.series.priceToCoordinate(d.price);
    if (y1 === null || y2 === null) return null;
    return { top: Math.min(y1, y2), bottom: Math.max(y1, y2), color: it.color };
  }
  /** The box (and its part) under (x, y) CSS px of the pane; the one drawn on top first. */
  hit(x: number, y: number): { id: string; part: 'close' | 'body'; draggable: boolean } | null {
    const boxes = this.boxes();
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i] as DrawnBox;
      if (Math.abs(b.y - y) > LABEL_HEIGHT / 2) continue;
      const part = labelPartAt(b.g, x);
      if (part) return { id: b.item.id, part, draggable: b.item.draggable };
    }
    return null;
  }
  /** The draggable line nearest to `y` within `reach`; null when none. */
  lineAt(y: number, reach = HLINE_CATCH_PX): { id: string; distance: number } | null {
    const a = this.attachedTo;
    if (!a) return null;
    let best: { id: string; distance: number } | null = null;
    for (const it of this.items) {
      if (!it.draggable) continue;
      const ly = a.series.priceToCoordinate(this.priceOf(it));
      if (ly === null) continue;
      const distance = Math.abs(ly - y);
      if (distance <= reach && (!best || distance < best.distance)) best = { id: it.id, distance };
    }
    return best;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const box = this.hit(x, y);
    if (box?.part === 'close') return { externalId: `trade:${box.id}:close`, cursorStyle: 'pointer', zOrder: 'top', distance: 0, hitTestPriority: 2, itemType: 'primitive' };
    if (box?.draggable) return { externalId: `trade:${box.id}`, cursorStyle: 'ns-resize', zOrder: 'top', distance: 0, hitTestPriority: 2, itemType: 'primitive' };
    const line = box ? null : this.lineAt(y);
    return line ? { externalId: `trade:${line.id}`, cursorStyle: 'ns-resize', zOrder: 'top', distance: line.distance, hitTestPriority: 1, itemType: 'primitive' } : null;
  }
}

// ---------------- FD-CHARTTV §5: the current price on the price scale, with the time left in the candle ----------------

/** The colours of the current price (the dotted line and its label), as in TradingView's capture. */
export const CURRENT_PRICE_COLORS = { line: '#F0CF2B', background: '#FFF3A3', text: '#14161B' } as const;
/** The cursor's labels on the scales (and the "+" next to the price one). */
export const CURSOR_LABEL_COLOR = '#3C414C';

export interface CurrentPriceData {
  price: number;
  precision: number;
  /** When the last candle closes (ms); null: no countdown (a closed market). */
  closesAt: number | null;
  /** "50:31" from the time left. */
  format: (msLeft: number) => string;
  /** The price scale's font size (FD-CHARTSETTINGS): the label is as wide as the library's at this size. */
  fontSize?: number;
}

interface DrawnPrice {
  y: number;
  price: string;
  countdown: string | null;
  fontSize: number;
}

/**
 * The library's label geometry on the price scale (lightweight-charts 5.2.1, PriceAxisViewRenderer, 11 px): a 1 px
 * border, 5 px for the tick, padding of fontSize / 12 × 5 on both sides of the text, 2.5 / 12 of the font above and
 * below, 2 px rounded outer corners. The current price's label is drawn the same, so every label on the scale has the
 * same width and look (as in TradingView): only its countdown row is added under it.
 */
const AXIS_TICK = 5;

class CurrentPriceRenderer implements IPrimitivePaneRenderer {
  private readonly item: DrawnPrice | null;
  constructor(item: DrawnPrice | null) {
    this.item = item;
  }
  draw(target: CanvasRenderingTarget2D): void {
    const it = this.item;
    if (!it) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const size = it.fontSize;
      const AXIS_PAD_X = (size / 12) * 5;
      const AXIS_ROW = size + 2 * ((2.5 / 12) * size);
      const font = (px: number) => `${px * vr}px "Geist Mono Variable", ui-monospace, monospace`;
      ctx.font = font(size);
      const priceW = ctx.measureText(it.price).width / hr;
      ctx.font = font(size - 1);
      const countW = it.countdown ? ctx.measureText(it.countdown).width / hr : 0;
      // As wide as the library's label of this price (its text, paddings, tick and border).
      const width = Math.round((1 + 2 * AXIS_PAD_X + Math.ceil(Math.max(priceW, countW)) + AXIS_TICK) * hr);
      const rows = it.countdown ? 2 : 1;
      const top = Math.round((it.y - AXIS_ROW / 2) * vr);
      const height = Math.round(rows * AXIS_ROW * vr);
      ctx.fillStyle = CURRENT_PRICE_COLORS.background;
      ctx.beginPath();
      ctx.roundRect(0, top, width, height, [0, 2 * hr, 2 * hr, 0]);
      ctx.fill();
      ctx.fillStyle = CURRENT_PRICE_COLORS.text;
      ctx.textBaseline = 'middle';
      const x = (AXIS_TICK + AXIS_PAD_X) * hr;
      ctx.font = font(size);
      ctx.fillText(it.price, x, top + (AXIS_ROW * vr) / 2);
      if (it.countdown) {
        ctx.font = font(size - 1);
        ctx.fillText(it.countdown, x, top + AXIS_ROW * vr * 1.5);
      }
    });
  }
}

class CurrentPriceView implements IPrimitivePaneView {
  private readonly source: CurrentPriceLabel;
  private item: DrawnPrice | null = null;
  constructor(source: CurrentPriceLabel) {
    this.source = source;
  }
  // Under the cursor's price label (the scale's top layer), as the library's own last-price label.
  zOrder() {
    return 'normal' as const;
  }
  update(): void {
    const a = this.source.attachedTo;
    const d = this.source.data;
    this.item = null;
    if (!a || !d || !Number.isFinite(d.price)) return;
    const y = a.series.priceToCoordinate(d.price);
    if (y === null) return;
    this.item = { y, price: d.price.toFixed(d.precision), countdown: d.closesAt === null ? null : d.format(d.closesAt - Date.now()), fontSize: d.fontSize ?? 11 };
  }
  renderer(): IPrimitivePaneRenderer {
    return new CurrentPriceRenderer(this.item);
  }
}

/** The current price's label, drawn on the price scale (the library's own label has one line: no room for the countdown). */
export class CurrentPriceLabel implements ISeriesPrimitive<Time> {
  attachedTo: Attached | null = null;
  data: CurrentPriceData | null = null;
  private readonly views: CurrentPriceView[] = [new CurrentPriceView(this)];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.attachedTo = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.attachedTo = null;
  }
  setData(data: CurrentPriceData | null): void {
    this.data = data;
    this.attachedTo?.requestUpdate();
  }
  /** Draws again (the countdown, every second). */
  tick(): void {
    if (this.data?.closesAt != null) this.attachedTo?.requestUpdate();
  }
  updateAllViews(): void {
    for (const v of this.views) v.update();
  }
  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
