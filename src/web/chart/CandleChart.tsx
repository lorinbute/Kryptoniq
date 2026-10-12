// Candlestick chart with the Slingshot overlay (TD §9.3) and the LMA pane below it (TD-CHARTUX).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  TickMarkType,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, SlingshotResult } from '../../shared/indicator/slingshot.ts';
import type { SlingshotParams } from '../../shared/indicator/params.ts';
import { brightness, colorNew, hexToRgba, PINE_BLACK, PINE_GRAY, PINE_WHITE, rgbaCss, type LmaResult } from '../../shared/indicator/lma.ts';
import type { LineStyleName, LmaParams } from '../../shared/indicator/lma-params.ts';
import { CloudFill, EdgeLabel, GradientFill, HSegments, ShapeLabels, type Segment, type ShapeLabel } from './primitives.ts';
import { loadView, saveView } from './view-store.ts';

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
  style: 'solid' | 'dashed' | 'dotted';
  /** Default true; false shows only the title (e.g. the PnL next to the current price). */
  lineVisible?: boolean;
  /** Default true. */
  axisLabelVisible?: boolean;
}

interface Props {
  candles: Candle[];
  result: SlingshotResult | null;
  params: SlingshotParams;
  precision: number;
  tz: string;
  priceLines: PriceLineSpec[];
  /** What is shown (exchange|pair|timeframe): a new key restores that key's remembered view, or the default one. */
  viewKey: string;
  /** The LMA (null when hidden: no pane, normal candle colours). */
  lma: LmaResult | null;
  /** Share of the height given to the LMA pane. */
  lmaShare: number;
  /** Called after the user drags the pane separator. */
  onLmaShareChange?: (share: number) => void;
  /** Drawn over the bottom-right corner of the price pane (e.g. the TP/SL table). */
  mainOverlay?: ReactNode;
  /** The LMA pane's legend; `bar` is the bar under the cursor, or null. */
  lmaLegend?: (bar: number | null) => ReactNode;
  /** Height classes of the chart box (default 560 px). */
  className?: string;
}

interface Boxes {
  main: { top: number; height: number } | null;
  lma: { top: number; height: number } | null;
  /** Width of the drawing area (without the price scale). */
  plotWidth: number;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const LINE_STYLE: Record<LineStyleName, LineStyle> = { Solid: LineStyle.Solid, Dashed: LineStyle.Dashed, Dotted: LineStyle.Dotted };

/** The script's three hline() calls with their Style-tab settings (shared with the settings form's preview). */
export function lmaHlines(e: LmaParams): { key: 'long' | 'short' | 'neutral'; price: number; color: string; width: 1 | 2; style: LineStyleName; visible: boolean }[] {
  return [
    { key: 'long', price: e.longThreshold, color: rgbaCss(colorNew(hexToRgba(e.bullishColor), 30)), width: 1, style: e.longLineStyle, visible: e.showLongLine },
    { key: 'short', price: e.shortThreshold, color: rgbaCss(colorNew(hexToRgba(e.bearishColor), 30)), width: 1, style: e.shortLineStyle, visible: e.showShortLine },
    { key: 'neutral', price: 0, color: PINE_GRAY, width: 2, style: e.neutralLineStyle, visible: e.showNeutralLine },
  ];
}
const clampShare = (v: number) => Math.min(0.7, Math.max(0.1, v));

function tzFormatter(tz: string, opts: Intl.DateTimeFormatOptions) {
  const f = new Intl.DateTimeFormat('ro-RO', { timeZone: tz, hourCycle: 'h23', ...opts });
  return (t: Time) => f.format((t as number) * 1000);
}

const styleOf = (s: string): 'solid' | 'dashed' | 'dotted' => (s === 'Solid' ? 'solid' : s === 'Dashed' ? 'dashed' : 'dotted');
const sizeOf = (s: string) => ({ Tiny: 9, Small: 11, Normal: 12, Large: 14 })[s] ?? 11;

export function buildSegments(r: SlingshotResult, p: SlingshotParams, precision: number): Segment[] {
  const out: Segment[] = [];
  const fmt = (v: number) => v.toFixed(precision);
  if (r.atr && Number.isFinite(r.atr.fromBar)) {
    const { tp, sl, fromBar, toBarTp, toBarSl, labelBar, showLines, showLabels } = r.atr;
    if (showLines && Number.isFinite(tp)) out.push({ fromBar, toBar: toBarTp, price: tp, color: p.longTPColor, width: 2, style: 'dashed' });
    if (showLines && Number.isFinite(sl)) out.push({ fromBar, toBar: toBarSl, price: sl, color: p.longSLColor, width: 2, style: 'dashed' });
    if (showLabels && Number.isFinite(tp)) out.push({ fromBar: labelBar, toBar: labelBar, price: tp, color: p.longTPColor, width: 0, style: 'solid', label: { text: ['TAKE PROFIT', fmt(tp)], bar: labelBar, placement: 'above', size: 11 } });
    if (showLabels && Number.isFinite(sl)) out.push({ fromBar: labelBar, toBar: labelBar, price: sl, color: p.longSLColor, width: 0, style: 'solid', label: { text: ['STOP LOSS', fmt(sl)], bar: labelBar, placement: 'below', size: 11 } });
  }
  if (r.ms) {
    const st = styleOf(p.msLineStyle);
    const size = sizeOf(p.msTextSize);
    if (r.ms.upper && Number.isFinite(r.ms.upper.fromBar)) {
      out.push({ fromBar: r.ms.upper.fromBar, toBar: r.ms.rightEdgeBar, price: r.ms.upper.price, color: p.msBullColor, width: p.msLineWidth, style: st, label: p.msBullText ? { text: [p.msBullText], bar: r.ms.rightEdgeBar, placement: 'right', size } : undefined });
    }
    if (r.ms.lower && Number.isFinite(r.ms.lower.fromBar)) {
      out.push({ fromBar: r.ms.lower.fromBar, toBar: r.ms.rightEdgeBar, price: r.ms.lower.price, color: p.msBearColor, width: p.msLineWidth, style: st, label: p.msBearText ? { text: [p.msBearText], bar: r.ms.rightEdgeBar, placement: 'right', size } : undefined });
    }
  }
  return out;
}

/** Share of the height held by the LMA pane, or null when there is no second pane. */
function lmaShareOf(chart: IChartApi): number | null {
  const panes = chart.panes();
  if (panes.length < 2) return null;
  const a = (panes[0] as (typeof panes)[number]).getStretchFactor();
  const b = (panes[1] as (typeof panes)[number]).getStretchFactor();
  return a + b > 0 ? b / (a + b) : null;
}

function applyLmaShare(chart: IChartApi, share: number): void {
  const panes = chart.panes();
  if (panes.length < 2) return;
  panes[0]?.setStretchFactor(1 - share);
  panes[1]?.setStretchFactor(share);
}

/** The LMA legend follows the cursor; its own state keeps mouse moves from re-rendering the page. */
function HoverLegend({ chart, count, render }: { chart: IChartApi | null; count: number; render: (bar: number | null) => ReactNode }) {
  const [bar, setBar] = useState<number | null>(null);
  useEffect(() => {
    if (!chart) return;
    const onMove = (p: MouseEventParams<Time>) => {
      const l = p.logical;
      setBar(l === undefined || l === null || p.point === undefined ? null : Math.round(l));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chart]);
  return <>{render(bar !== null && bar >= 0 && bar < count ? bar : null)}</>;
}

export function CandleChart({ candles, result, params, precision, tz, priceLines, viewKey, lma, lmaShare, onLmaShareChange, mainOverlay, lmaLegend, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle: ISeriesApi<'Candlestick'>;
    fast: ISeriesApi<'Line'>;
    slow: ISeriesApi<'Line'>;
    markers: ShapeLabels;
    cloud: CloudFill;
    segments: HSegments;
    lines: IPriceLine[];
  } | null>(null);
  const lmaRef = useRef<{ series: ISeriesApi<'Line'>; fill: GradientFill; label: EdgeLabel; lines: IPriceLine[] } | null>(null);
  /** Values the LMA pane must show (the visible hlines), read by its autoscale. */
  const hlineValues = useRef<number[]>([0.5, -0.5, 0]);
  /** The key whose data is on screen (its view is the one being remembered). */
  const lastKey = useRef<string>('');
  const prevLength = useRef(0);
  const shareRef = useRef(lmaShare);
  shareRef.current = lmaShare;
  const onShareRef = useRef(onLmaShareChange);
  onShareRef.current = onLmaShareChange;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boxes, setBoxes] = useState<Boxes>({ main: null, lma: null, plotWidth: 0 });
  const showLma = lma !== null;

  /** Remembers the current zoom / position of the key on screen. */
  const flushView = () => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const chart = chartRef.current;
    if (!chart || !lastKey.current) return;
    const ts = chart.timeScale();
    saveView(lastKey.current, { barSpacing: ts.options().barSpacing, scroll: ts.scrollPosition() });
  };
  const flushViewRef = useRef(flushView);
  flushViewRef.current = flushView;

  // Create the chart once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      // Matches the --color-ink / --color-line / --color-muted tokens (the chart draws on a canvas, not CSS).
      layout: {
        background: { type: ColorType.Solid, color: '#07090e' },
        textColor: '#8d96a8',
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#1a202b', separatorHoverColor: '#2a3242', enableResize: true },
      },
      // FD-CHARTUX: no grid, no crosshair lines (the axis labels stay).
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false, labelVisible: true }, horzLine: { visible: false, labelVisible: true } },
      rightPriceScale: { borderColor: '#1a202b' },
      timeScale: { borderColor: '#1a202b', timeVisible: true, secondsVisible: false, rightOffset: 24 },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const slow = chart.addSeries(LineSeries, lineOpts);
    const fast = chart.addSeries(LineSeries, lineOpts);
    // LONG / TAKE PROFIT are triangles in the script (label.style_triangleup / _triangledown); the library's markers
    // only have arrows, circles and squares.
    const markers = new ShapeLabels();
    const cloud = new CloudFill();
    const segments = new HSegments();
    candle.attachPrimitive(cloud);
    candle.attachPrimitive(segments);
    candle.attachPrimitive(markers);
    chartRef.current = chart;
    seriesRef.current = { candle, fast, slow, markers, cloud, segments, lines: [] };

    // Zoom / scroll: remembered 400 ms after the last change.
    const onRange = () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushViewRef.current(), 400);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    // The pane separator was dragged: remember the new height.
    const checkShare = () => {
      const share = lmaShareOf(chart);
      if (share !== null && Math.abs(share - shareRef.current) > 0.01) onShareRef.current?.(clampShare(share));
    };
    const onUp = () => requestAnimationFrame(checkShare);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('touchend', onUp);
    setChartApi(chart);
    return () => {
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('touchend', onUp);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      flushViewRef.current();
      checkShare();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lmaRef.current = null;
    };
  }, []);

  // The LMA pane exists only while the LMA is shown.
  useEffect(() => {
    const chart = chartApi;
    if (!chart || !showLma) return;
    const series = chart.addSeries(
      LineSeries,
      {
        lineWidth: 3,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        // Like hline() in TradingView, the thresholds and 0 always fit in the pane.
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const base = original();
          const vals = hlineValues.current;
          if (!base && vals.length === 0) return null;
          const min = Math.min(...vals, base?.priceRange?.minValue ?? Infinity);
          const max = Math.max(...vals, base?.priceRange?.maxValue ?? -Infinity);
          return { priceRange: { minValue: min, maxValue: max }, margins: base?.margins };
        },
      },
      1,
    );
    const fill = new GradientFill();
    const label = new EdgeLabel();
    series.attachPrimitive(fill);
    series.attachPrimitive(label);
    lmaRef.current = { series, fill, label, lines: [] };
    applyLmaShare(chart, shareRef.current);
    return () => {
      lmaRef.current = null;
      // On unmount the chart is already gone.
      if (chartRef.current === chart) chart.removeSeries(series);
    };
  }, [chartApi, showLma]);

  // A height saved elsewhere (or restored) is applied unless it is what is already shown.
  useEffect(() => {
    const chart = chartApi;
    if (!chart || !showLma) return;
    const cur = lmaShareOf(chart);
    if (cur === null || Math.abs(cur - lmaShare) > 0.01) applyLmaShare(chart, lmaShare);
  }, [chartApi, showLma, lmaShare]);

  // Where each pane is, for the HTML overlays.
  useEffect(() => {
    const chart = chartApi;
    const el = host.current;
    if (!chart || !el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const row = (i: number) => {
        const r = chart.panes()[i]?.getHTMLElement()?.getBoundingClientRect();
        return r ? { top: r.top - base.top, height: r.height } : null;
      };
      const next: Boxes = { main: row(0), lma: showLma ? row(1) : null, plotWidth: Math.max(0, base.width - chart.priceScale('right').width()) };
      setBoxes((prev) =>
        prev.plotWidth === next.plotWidth && prev.main?.top === next.main?.top && prev.main?.height === next.main?.height && prev.lma?.top === next.lma?.top && prev.lma?.height === next.lma?.height
          ? prev
          : next,
      );
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    // The drawing area also narrows when the price scale widens (more digits), which resizes no row.
    const onPlotSize = () => measure();
    chart.timeScale().subscribeSizeChange(onPlotSize);
    // The pane rows appear a frame after the series is added.
    const raf = requestAnimationFrame(() => {
      for (const p of chart.panes()) {
        const row = p.getHTMLElement();
        if (row) ro.observe(row);
      }
      measure();
    });
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (chartRef.current === chart) chart.timeScale().unsubscribeSizeChange(onPlotSize);
    };
  }, [chartApi, showLma]);

  // Time axis and crosshair labels in the user's time zone.
  useEffect(() => {
    const chart = chartApi;
    if (!chart) return;
    const time = tzFormatter(tz, { hour: '2-digit', minute: '2-digit' });
    const day = tzFormatter(tz, { day: 'numeric', month: 'short' });
    const month = tzFormatter(tz, { month: 'short' });
    const year = tzFormatter(tz, { year: 'numeric' });
    const full = tzFormatter(tz, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    chart.applyOptions({
      localization: { timeFormatter: (t: Time) => full(t) },
      timeScale: {
        tickMarkFormatter: (t: Time, type: TickMarkType) =>
          type === TickMarkType.Year ? year(t) : type === TickMarkType.Month ? month(t) : type === TickMarkType.DayOfMonth ? day(t) : time(t),
      },
    });
    seriesRef.current?.candle.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
  }, [chartApi, tz, precision]);

  // Data + overlays.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartApi;
    if (!s || !chart) return;
    const ts = chart.timeScale();
    const before = ts.getVisibleLogicalRange();
    const prevLen = prevLength.current;
    // Like TradingView: when the last bar is on screen, new bars keep the view glued to the right edge.
    const followRight = before !== null && prevLen > 0 && before.to >= prevLen - 1;
    // Pine barcolor(colorBars ? …) and its Style-tab switch "LMA Signal Bar Colors".
    const barColors = lma && lma.effective.colorBars && lma.effective.showBarColors ? lma.color.map(rgbaCss) : null;
    s.candle.setData(
      candles.map((c, i) => {
        const bar = { time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c };
        // Pine barcolor(): body and wick take the LMA colour.
        const col = barColors?.[i];
        return col ? { ...bar, color: col, wickColor: col, borderColor: col } : bar;
      }),
    );
    prevLength.current = candles.length;
    const r = result;
    if (r) {
      const up = params.longTPColor;
      const down = params.longSLColor;
      const line = (vals: number[]) =>
        candles.map((c, i) => {
          const v = vals[i] as number;
          return Number.isFinite(v) ? { time: toTime(c.t), value: v, color: r.uptrend[i] ? up : down } : { time: toTime(c.t) };
        });
      s.fast.setData(line(r.emaFast));
      s.slow.setData(line(r.emaSlow));
      s.cloud.setData(
        candles.map((c, i) => ({ time: toTime(c.t), fast: r.emaFast[i] as number, slow: r.emaSlow[i] as number, up: r.uptrend[i] as boolean })),
        up,
        down,
      );
      const shapes: ShapeLabel[] = r.markers
        .filter((m) => m.bar >= 0 && m.bar < candles.length)
        .map((m) => {
          const c = candles[m.bar] as Candle;
          const tp = m.kind === 'takeProfit';
          return { bar: m.bar, price: tp ? c.h : c.l, position: tp ? 'above' : 'below', color: m.color === 'tp' ? up : down, text: tp ? 'TAKE PROFIT' : 'LONG' };
        });
      s.markers.setData(shapes);
      s.segments.setData(buildSegments(r, params, precision));
    } else {
      s.fast.setData([]);
      s.slow.setData([]);
      s.cloud.setData([], params.longTPColor, params.longSLColor);
      s.markers.setData([]);
      s.segments.setData([]);
    }
    const l = lmaRef.current;
    if (l && lma) {
      l.series.setData(candles.map((c, i) => (Number.isFinite(lma.signal[i] as number) ? { time: toTime(c.t), value: lma.signal[i] as number, color: rgbaCss(lma.color[i] as LmaResult['color'][number]) } : { time: toTime(c.t) })));
      l.fill.setData(lma.effective.showFill ? lma.signal.map((value, i) => ({ value, color: lma.color[i] as LmaResult['color'][number] })) : []);
      const n = candles.length;
      const lastValue = lma.signal[n - 1] as number;
      const lastColor = lma.color[n - 1];
      l.label.setData(
        lastColor && Number.isFinite(lastValue)
          ? { bar: n - 1 + 2, value: lastValue, text: lma.state[n - 1] as string, background: rgbaCss(colorNew(lastColor, 10)), color: brightness(lastColor) > 150 ? PINE_BLACK : PINE_WHITE }
          : null,
      );
    }
    if (lastKey.current !== viewKey) {
      // Remember the view being left, then show the new key's remembered view (or the last 180 bars).
      flushViewRef.current();
      lastKey.current = viewKey;
      const saved = loadView(viewKey);
      if (saved) {
        ts.applyOptions({ barSpacing: saved.barSpacing });
        ts.scrollToPosition(saved.scroll, false);
      } else {
        ts.setVisibleLogicalRange({ from: Math.max(0, candles.length - 180), to: candles.length + 20 });
      }
    } else if (followRight && before && candles.length > prevLen) {
      const added = candles.length - prevLen;
      ts.setVisibleLogicalRange({ from: before.from + added, to: before.to + added });
    }
  }, [chartApi, candles, result, params, precision, viewKey, lma, showLma]);

  // LMA thresholds and the 0 line (Pine hline), as shown / styled in the Style group.
  const e = lma?.effective;
  const linesKey = e
    ? [e.longThreshold, e.shortThreshold, e.bullishColor, e.bearishColor, e.showLongLine, e.longLineStyle, e.showShortLine, e.shortLineStyle, e.showNeutralLine, e.neutralLineStyle].join('|')
    : '';
  useEffect(() => {
    const l = lmaRef.current;
    if (!l || !e) return;
    for (const x of l.lines) l.series.removePriceLine(x);
    const lines = lmaHlines(e).filter((h) => h.visible);
    hlineValues.current = lines.map((h) => h.price);
    l.lines = lines.map((h) => l.series.createPriceLine({ price: h.price, color: h.color, lineWidth: h.width, lineStyle: LINE_STYLE[h.style], axisLabelVisible: false, title: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, showLma, linesKey]);

  // The signal line itself (Style: "LMA Signal" on/off and its width).
  const signalKey = e ? `${e.showSignal}|${e.signalWidth}` : '';
  useEffect(() => {
    const l = lmaRef.current;
    if (!l || !e) return;
    l.series.applyOptions({ lineVisible: e.showSignal, lastValueVisible: e.showSignal, crosshairMarkerVisible: e.showSignal, lineWidth: e.signalWidth as 1 | 2 | 3 | 4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, showLma, signalKey]);

  // Positions / orders as price lines.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of s.lines) s.candle.removePriceLine(l);
    s.lines = priceLines
      .filter((l) => Number.isFinite(l.price))
      .map((l) =>
        s.candle.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: l.style === 'solid' ? LineStyle.Solid : l.style === 'dashed' ? LineStyle.Dashed : LineStyle.Dotted,
          lineVisible: l.lineVisible ?? true,
          axisLabelVisible: l.axisLabelVisible ?? true,
          title: l.title,
        }),
      );
  }, [chartApi, priceLines]);

  const place = (b: { top: number; height: number }): CSSProperties => ({ top: b.top, height: b.height, left: 0, width: boxes.plotWidth });
  return (
    <div className={clsx('relative w-full', className ?? 'h-[560px]')}>
      {/* `isolate`: the chart's canvases (z-index 1–2) and pane separators (49–50) stay below the overlays and the page. */}
      <div ref={host} className="absolute inset-0 isolate" aria-label="Grafic lumânări" role="img" />
      {mainOverlay && boxes.main && boxes.plotWidth > 0 && (
        <div className="pointer-events-none absolute" style={place(boxes.main)}>
          {mainOverlay}
        </div>
      )}
      {lmaLegend && boxes.lma && boxes.plotWidth > 0 && (
        <div className="pointer-events-none absolute" style={place(boxes.lma)}>
          <HoverLegend chart={chartApi} count={candles.length} render={lmaLegend} />
        </div>
      )}
    </div>
  );
}
