// Candlestick chart with the Slingshot overlay (TD §9.3), the LMA pane (TD-CHARTUX) and any other indicator over the
// candles or in its own pane below (TD-INDICATORS §8).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronsRight, Plus } from 'lucide-react';
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
import type { IndicatorResult } from 'oakscriptjs';
import type { Candle, SlingshotResult } from '../../shared/indicator/slingshot.ts';
import type { SlingshotParams } from '../../shared/indicator/params.ts';
import { brightness, colorNew, hexToRgba, PINE_BLACK, PINE_GRAY, PINE_WHITE, rgbaCss, type LmaResult } from '../../shared/indicator/lma.ts';
import type { LineStyleName, LmaParams } from '../../shared/indicator/lma-params.ts';
import { toBars } from '../indicators/compute.ts';
import type { StudyRuntime } from '../indicators/runtime.ts';
import type { IndicatorRenderer, RenderableIndicator, RenderOptions } from '../indicators/vendor/render/index';
import { CloudFill, EdgeLabel, GradientFill, HLines, HSegments, ShapeLabels, type Segment, type ShapeLabel } from './primitives.ts';
import type { HLine } from '../../shared/hlines.ts';
import { isMac } from '../components/CommandPalette.tsx';
import { loadView, saveView } from './view-store.ts';
import { THEME_EVENT, themeColors } from '../theme.ts';

/** The chart's frame in the theme's colours (FD-THEME §1): the canvas does not read CSS by itself. */
function frameOptions() {
  const c = themeColors();
  // FD-HLINE §1: the cursor's lines, thin and dashed in the theme's quiet colour, with their labels on the axes.
  const cursorLine = { visible: true, color: c.text, width: 1 as const, style: LineStyle.LargeDashed, labelVisible: true };
  return {
    layout: { background: { type: ColorType.Solid, color: c.background }, textColor: c.text, panes: { separatorColor: c.line, separatorHoverColor: c.lineStrong } },
    rightPriceScale: { borderColor: c.line },
    timeScale: { borderColor: c.line },
    crosshair: { vertLine: cursorLine, horzLine: cursorLine },
  };
}

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

/** One indicator to draw (FD-INDICATORS §2): its result, with the style the user chose applied. */
export interface StudyDraw {
  uid: string;
  /** Its own pane (a key of `paneOrder`), or null when it is drawn over the candles. */
  paneKey: string | null;
  entry: RenderableIndicator;
  result: IndicatorResult;
  options: RenderOptions;
}

/** Default height of an indicator pane, as a ratio to the price pane (the LMA's default: 25 % of two panes). */
export const DEFAULT_PANE_FACTOR = 1 / 3;

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
  /** The panes below the price, in order: 'lma' and the uid of each indicator with a pane of its own. */
  paneOrder: readonly string[];
  /** Height of each of those panes, as a ratio to the price pane. */
  paneFactors: Readonly<Record<string, number>>;
  /** Called after the user drags a pane separator, with the panes whose height changed. */
  onPaneFactors?: (changed: Record<string, number>) => void;
  /** The indicators with a result to draw. */
  studies: readonly StudyDraw[];
  /** The indicator code (renderer); null until loaded. */
  runtime: StudyRuntime | null;
  /** Drawn over the bottom-right corner of the price pane (e.g. the TP/SL table). */
  mainOverlay?: ReactNode;
  /** Legends by pane ('main' or a key of `paneOrder`); `bar` is the bar under the cursor, or null. */
  legends: Readonly<Record<string, (bar: number | null) => ReactNode>>;
  /** Times (ms) of the first and last visible bar, 300 ms after the view stops moving; only when given. */
  onVisibleRange?: (range: { from: number; to: number }) => void;
  /** Height classes of the chart box (default 560 px). */
  className?: string;
  /** Its height when it depends on the panes (FD-INDICATORS §2). */
  style?: CSSProperties;
  /** FD-HLINE: the horizontal lines shown now (the settings panel's preview already in), and the one being edited. */
  hlines?: readonly HLine[];
  selectedHLine?: string | null;
  /** The "+" at the cursor and Alt+H add a line at that price; without it, neither shows. */
  onAddHLine?: (price: number) => void;
  /** Why no line can be added now (the limit reached), or null. */
  hlineBlocked?: string | null;
  /** A line dragged to a new price (on release). */
  onMoveHLine?: (id: string, price: number) => void;
  /** A line clicked (or tapped): its settings. */
  onOpenHLine?: (id: string) => void;
}

/** The "go to the latest candle" button (FD-GOLATEST), px. */
const LATEST_SIZE = 32;

interface Boxes {
  /** Each pane's row: 'main' and the keys of `paneOrder`. */
  panes: Record<string, { top: number; height: number }>;
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

/** Height of each pane below the price as a ratio to the price pane, by key (TD-INDICATORS §8). */
function factorsOf(chart: IChartApi, order: readonly string[]): Record<string, number> {
  const panes = chart.panes();
  const base = panes[0]?.getStretchFactor() ?? 1;
  const out: Record<string, number> = {};
  if (!(base > 0)) return out;
  order.forEach((key, i) => {
    const p = panes[i + 1];
    if (p) out[key] = p.getStretchFactor() / base;
  });
  return out;
}

function applyFactors(chart: IChartApi, order: readonly string[], factors: Readonly<Record<string, number>>): void {
  const panes = chart.panes();
  panes[0]?.setStretchFactor(1);
  order.forEach((key, i) => panes[i + 1]?.setStretchFactor(factors[key] ?? DEFAULT_PANE_FACTOR));
}

/** FD-HLINE §2: the "+" at the cursor's price on the price pane, and its menu. Its own state, as the legends'. */
function HLinePlus({
  chart,
  series,
  main,
  plotWidth,
  precision,
  blocked,
  onAdd,
  cursor,
}: {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  main: { top: number; height: number };
  plotWidth: number;
  precision: number;
  blocked: string | null;
  onAdd: (price: number) => void;
  /** The cursor's last place on the price pane (read by Alt+H), null when it is elsewhere. */
  cursor: MutableRefObject<{ y: number; price: number } | null>;
}) {
  const [at, setAt] = useState<{ y: number; price: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState(false);
  const hold = useRef(false);
  hold.current = menu || hover;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chart || !series) return;
    let hide: ReturnType<typeof setTimeout> | null = null;
    const onMove = (p: MouseEventParams<Time>) => {
      const price = p.point && p.paneIndex === 0 ? series.coordinateToPrice(p.point.y) : null;
      cursor.current = p.point && price !== null ? { y: p.point.y, price } : null;
      if (hide !== null) clearTimeout(hide);
      hide = null;
      // On the button or its menu the cursor left the chart: the button stays where it was.
      if (hold.current) return;
      if (cursor.current) setAt(cursor.current);
      // Moving onto the button, the chart tells "left" before the button tells "entered": hide a moment later.
      else hide = setTimeout(() => !hold.current && setAt(null), 150);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (hide !== null) clearTimeout(hide);
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, [chart, series, cursor]);
  // Off the button, with its menu closed and the cursor not on the price pane: it goes.
  useEffect(() => {
    if (!menu && !hover && !cursor.current) setAt(null);
  }, [menu, hover, cursor]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    // Before the settings panel's own Esc (which would close it and drop its edits): only the menu closes.
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);
  if (!at || at.y < 0 || at.y > main.height) return null;
  const price = Number(at.price.toFixed(precision));
  const label = price.toFixed(precision);
  return (
    <div ref={box} className="absolute z-20" style={{ top: main.top + at.y - 11, left: plotWidth - 26 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={`Adaugă la ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        title={`Adaugă la ${label}`}
        onClick={() => setMenu((m) => !m)}
        className="grid size-[22px] place-items-center rounded-full border border-line-strong bg-panel text-muted shadow-sm transition-colors hover:border-accent hover:text-accent"
      >
        <Plus size={14} aria-hidden />
      </button>
      {menu && (
        <div role="menu" className="absolute top-7 right-0 w-max min-w-[240px] rounded-xl border border-line-strong bg-panel-2 py-1.5 shadow-pop">
          <button
            type="button"
            role="menuitem"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => {
              setMenu(false);
              setHover(false);
              onAdd(price);
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] text-text transition-colors hover:bg-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
          >
            <span className="flex-1">
              Linie orizontală la <span className="num">{label}</span>
            </span>
            <kbd className="num text-[11.5px] text-faint">{isMac() ? '⌥H' : 'Alt+H'}</kbd>
          </button>
          {blocked && <p className="max-w-[260px] px-3.5 pb-1 text-[12px] text-warn">{blocked}</p>}
        </div>
      )}
    </div>
  );
}

/** The legends follow the cursor; their own state keeps mouse moves from re-rendering the chart or the page. */
function Legends({ chart, count, boxes, legends, place }: { chart: IChartApi | null; count: number; boxes: Boxes; legends: Props['legends']; place: (b: { top: number; height: number }) => CSSProperties }) {
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
  const hovered = bar !== null && bar >= 0 && bar < count ? bar : null;
  return (
    <>
      {Object.entries(legends).map(([key, render]) => {
        const b = boxes.panes[key];
        return b ? (
          <div key={key} className="pointer-events-none absolute" style={place(b)}>
            {render(hovered)}
          </div>
        ) : null;
      })}
    </>
  );
}

export function CandleChart({
  candles,
  result,
  params,
  precision,
  tz,
  priceLines,
  viewKey,
  lma,
  paneOrder,
  paneFactors,
  onPaneFactors,
  studies,
  runtime,
  mainOverlay,
  legends,
  onVisibleRange,
  className,
  style,
  hlines,
  selectedHLine = null,
  onAddHLine,
  hlineBlocked = null,
  onMoveHLine,
  onOpenHLine,
}: Props) {
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
    hlines: HLines;
    lines: IPriceLine[];
  } | null>(null);
  const lmaRef = useRef<{ series: ISeriesApi<'Line'>; fill: GradientFill; label: EdgeLabel; lines: IPriceLine[] } | null>(null);
  /** One renderer per indicator drawn, by uid. */
  const renderers = useRef(new Map<string, IndicatorRenderer>());
  /** Values the LMA pane must show (the visible hlines), read by its autoscale. */
  const hlineValues = useRef<number[]>([0.5, -0.5, 0]);
  /** The key whose data is on screen (its view is the one being remembered). */
  const lastKey = useRef<string>('');
  const prevLength = useRef(0);
  /** Bumped when the view is set by code (a remembered one, the default): an older correction must not undo it. */
  const viewEpoch = useRef(0);
  /** Time of the last candle on screen: the remembered view is measured from it. */
  const shownLast = useRef<UTCTimestamp | null>(null);
  const layoutKey = paneOrder.join('|');
  const orderRef = useRef<readonly string[]>(paneOrder);
  orderRef.current = paneOrder;
  const factorsRef = useRef(paneFactors);
  factorsRef.current = paneFactors;
  const onFactorsRef = useRef(onPaneFactors);
  onFactorsRef.current = onPaneFactors;
  const onVisibleRef = useRef(onVisibleRange);
  onVisibleRef.current = onVisibleRange;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boxes, setBoxes] = useState<Boxes>({ panes: {}, plotWidth: 0 });
  /** The latest candle is right of the view (scrolled back): the "go to the latest candle" button shows (FD-GOLATEST). */
  const [behind, setBehind] = useState(false);
  /** Bumped each time the panes below the price are built again: what lives in them is drawn again. */
  const [layoutTick, setLayoutTick] = useState(0);
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
    // Bars between the last candle and the right edge; not the time scale's own last point, which an indicator drawing
    // ahead of the candles (Ichimoku) moves.
    const r = ts.getVisibleLogicalRange();
    const li = shownLast.current !== null ? ts.timeToIndex(shownLast.current, true) : null;
    saveView(lastKey.current, { barSpacing: ts.options().barSpacing, scroll: r && li !== null ? r.to - li : ts.scrollPosition() });
  };
  const flushViewRef = useRef(flushView);
  flushViewRef.current = flushView;
  /** Whether the latest candle is past the right edge (its centre outside the view). */
  const checkBehind = () => {
    const chart = chartRef.current;
    if (!chart || shownLast.current === null) return setBehind(false);
    const ts = chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const li = ts.timeToIndex(shownLast.current, true);
    setBehind(r !== null && li !== null && r.to < li);
  };
  const checkBehindRef = useRef(checkBehind);
  checkBehindRef.current = checkBehind;

  // Create the chart once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // The colours come from the theme's tokens (--color-ink / --color-muted / --color-line), FD-THEME.
    const frame = frameOptions();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        ...frame.layout,
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 11,
        attributionLogo: false,
        panes: { ...frame.layout.panes, enableResize: true },
      },
      // FD-CHARTUX: no grid; FD-HLINE §1: the cursor's dashed lines (in `frameOptions`).
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal, ...frame.crosshair },
      rightPriceScale: frame.rightPriceScale,
      // New bars keep the view glued to the right edge by the code below (data effect), not by the library: its own shift
      // also fires for the points an indicator draws ahead of the candles (Ichimoku) and moved the view off them.
      timeScale: { ...frame.timeScale, timeVisible: true, secondsVisible: false, rightOffset: 24, shiftVisibleRangeOnNewBar: false },
    });
    // The theme switched: recolour the frame in place (the zoom stays).
    const onTheme = () => chart.applyOptions(frameOptions());
    window.addEventListener(THEME_EVENT, onTheme);
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
    // FD-HLINE: the user's horizontal lines, over everything else on the price pane.
    const hl = new HLines();
    candle.attachPrimitive(hl);
    chartRef.current = chart;
    seriesRef.current = { candle, fast, slow, markers, cloud, segments, hlines: hl, lines: [] };

    // Zoom / scroll: remembered 400 ms after the last change; the visible bars reported 300 ms after it.
    const onRange = () => {
      checkBehindRef.current();
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushViewRef.current(), 400);
      if (onVisibleRef.current) {
        if (rangeTimer.current !== null) clearTimeout(rangeTimer.current);
        rangeTimer.current = setTimeout(() => {
          const r = chart.timeScale().getVisibleLogicalRange();
          const cs = candlesRef.current;
          if (!r || cs.length === 0) return;
          const from = cs[Math.min(cs.length - 1, Math.max(0, Math.ceil(r.from)))]?.t;
          const to = cs[Math.min(cs.length - 1, Math.max(0, Math.floor(r.to)))]?.t;
          if (from !== undefined && to !== undefined) onVisibleRef.current?.({ from, to });
        }, 300);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    // A pane separator was dragged: remember the heights that changed.
    const checkFactors = () => {
      const order = orderRef.current;
      const now = factorsOf(chart, order);
      const changed: Record<string, number> = {};
      for (const key of order) {
        const f = now[key];
        const was = factorsRef.current[key] ?? DEFAULT_PANE_FACTOR;
        if (f !== undefined && Math.abs(f - was) > 0.01 * Math.max(was, 0.05)) changed[key] = f;
      }
      if (Object.keys(changed).length) onFactorsRef.current?.(changed);
    };
    const onUp = () => requestAnimationFrame(checkFactors);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('touchend', onUp);
    setChartApi(chart);
    return () => {
      window.removeEventListener(THEME_EVENT, onTheme);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('touchend', onUp);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      if (rangeTimer.current !== null) clearTimeout(rangeTimer.current);
      flushViewRef.current();
      checkFactors();
      // Their table overlays, observers and frames go before the chart does.
      for (const r of renderers.current.values()) r.clear();
      renderers.current.clear();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lmaRef.current = null;
    };
  }, []);

  // The panes below the price, built again in order when the list changes (TD-INDICATORS §8): the LMA, then each
  // indicator with a pane of its own. Everything in them is drawn again after (layoutTick).
  useEffect(() => {
    const chart = chartApi;
    if (!chart) return;
    const order = layoutKey ? layoutKey.split('|') : [];
    for (const r of renderers.current.values()) r.clear();
    renderers.current.clear();
    if (lmaRef.current) {
      chart.removeSeries(lmaRef.current.series);
      lmaRef.current = null;
    }
    for (let i = chart.panes().length - 1; i >= 1; i--) chart.removePane(i);
    for (const key of order) {
      // Kept while empty: an indicator without a result (an error, data still loading) keeps its pane and legend.
      const pane = chart.addPane(true);
      if (key !== 'lma') continue;
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
        pane.paneIndex(),
      );
      const fill = new GradientFill();
      const label = new EdgeLabel();
      series.attachPrimitive(fill);
      series.attachPrimitive(label);
      lmaRef.current = { series, fill, label, lines: [] };
    }
    applyFactors(chart, order, factorsRef.current);
    setLayoutTick((t) => t + 1);
  }, [chartApi, layoutKey]);

  // A height saved elsewhere (or restored) is applied unless it is what is already shown.
  const factorsKey = paneOrder.map((k) => `${k}:${paneFactors[k] ?? ''}`).join('|');
  useEffect(() => {
    const chart = chartApi;
    if (!chart) return;
    const order = orderRef.current;
    const now = factorsOf(chart, order);
    const off = order.some((k) => Math.abs((now[k] ?? 0) - (factorsRef.current[k] ?? DEFAULT_PANE_FACTOR)) > 0.01);
    if (off) applyFactors(chart, order, factorsRef.current);
  }, [chartApi, layoutTick, factorsKey]);

  // Where each pane is, for the HTML overlays (legends, the TP/SL table).
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
      const panes: Boxes['panes'] = {};
      const main = row(0);
      if (main) panes.main = main;
      orderRef.current.forEach((key, i) => {
        const r = row(i + 1);
        if (r) panes[key] = r;
      });
      const next: Boxes = { panes, plotWidth: Math.max(0, base.width - chart.priceScale('right').width()) };
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    // The drawing area also narrows when the price scale widens (more digits), which resizes no row.
    const onPlotSize = () => measure();
    chart.timeScale().subscribeSizeChange(onPlotSize);
    // The pane rows appear a frame after the series is added.
    const raf = requestAnimationFrame(() => {
      for (const p of chart.panes()) {
        const r = p.getHTMLElement();
        if (r) ro.observe(r);
      }
      measure();
    });
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (chartRef.current === chart) chart.timeScale().unsubscribeSizeChange(onPlotSize);
    };
  }, [chartApi, layoutTick]);

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
    // Another pair or timeframe: the view being left is remembered while its candles are still on screen.
    const switching = lastKey.current !== viewKey;
    if (switching) flushViewRef.current();
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
    shownLast.current = candles.length ? toTime((candles.at(-1) as Candle).t) : null;
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
    if (switching) {
      // Show the new key's remembered view (or the last 180 bars).
      lastKey.current = viewKey;
      const saved = loadView(viewKey);
      const n = candles.length;
      const applyView = () => {
        viewEpoch.current++;
        if (saved) {
          ts.applyOptions({ barSpacing: saved.barSpacing });
          // scrollToPosition counts from the time scale's last point; points an indicator still draws ahead of the
          // candles (the pair left) are taken off.
          const range = ts.getVisibleLogicalRange();
          const li = shownLast.current !== null ? ts.timeToIndex(shownLast.current, true) : null;
          const ahead = range && li !== null ? Math.max(0, range.to - ts.scrollPosition() - li) : 0;
          ts.scrollToPosition(saved.scroll - ahead, false);
        } else {
          ts.setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 20 });
        }
      };
      // The library applies its own options (rightOffset, the bar spacing) on its next frame, over a view set now, and
      // ignores a view before it has a size: the view is set after that frame, once the chart has its width.
      const later = () => {
        if (chartRef.current !== chart || lastKey.current !== viewKey) return;
        if (ts.width() > 0) {
          applyView();
          return;
        }
        const once = () => {
          ts.unsubscribeSizeChange(once);
          if (chartRef.current === chart && lastKey.current === viewKey) requestAnimationFrame(applyView);
        };
        ts.subscribeSizeChange(once);
      };
      viewEpoch.current++;
      requestAnimationFrame(later);
      // The new key's view comes a frame later (its range change checks again): no button from the old view meanwhile.
      setBehind(false);
    } else {
      if (followRight && before && candles.length > prevLen) {
        const added = candles.length - prevLen;
        ts.setVisibleLogicalRange({ from: before.from + added, to: before.to + added });
      }
      // New candles without a scroll: whether the latest one is still in view.
      checkBehindRef.current();
    }
  }, [chartApi, candles, result, params, precision, viewKey, lma, showLma, layoutTick]);

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
  }, [chartApi, showLma, linesKey, layoutTick]);

  // The signal line itself (Style: "LMA Signal" on/off and its width).
  const signalKey = e ? `${e.showSignal}|${e.signalWidth}` : '';
  useEffect(() => {
    const l = lmaRef.current;
    if (!l || !e) return;
    l.series.applyOptions({ lineVisible: e.showSignal, lastValueVisible: e.showSignal, crosshairMarkerVisible: e.showSignal, lineWidth: e.signalWidth as 1 | 2 | 3 | 4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, showLma, signalKey, layoutTick]);

  // The other indicators (TD-INDICATORS §8): one renderer each; a live update keeps their series.
  const bars = useMemo(() => toBars(candles), [candles]);
  const drawnTick = useRef(-1);
  useEffect(() => {
    const chart = chartApi;
    const s = seriesRef.current;
    if (!chart || !s || !runtime) return;
    const fresh = drawnTick.current !== layoutTick;
    drawnTick.current = layoutTick;
    const order = orderRef.current;
    const keep = new Set<string>();
    // Points an indicator draws ahead of the last candle (Ichimoku's clouds, 26 bars) lengthen the time scale, and the
    // library then moves the view off the candles it showed: the view is kept where it was relative to the last candle.
    const ts = chart.timeScale();
    const lastTime = candles.length ? toTime((candles.at(-1) as Candle).t) : null;
    const viewBefore = ts.getVisibleLogicalRange();
    const lastBefore = lastTime !== null ? ts.timeToIndex(lastTime, true) : null;
    const epoch = viewEpoch.current;
    for (const d of studies) {
      const paneIndex = d.paneKey === null ? 0 : order.indexOf(d.paneKey) + 1;
      if (d.paneKey !== null && paneIndex === 0) continue;
      keep.add(d.uid);
      let r = renderers.current.get(d.uid);
      const created = !r;
      if (!r) {
        r = new runtime.IndicatorRenderer(chart, { paneIndex: paneIndex || 1, mainSeries: s.candle });
        renderers.current.set(d.uid, r);
      } else if (paneIndex > 0) r.setPaneIndex(paneIndex);
      r.render(d.entry, d.result, bars, { ...d.options, reuseSeries: !fresh && !created });
    }
    for (const [uid, r] of [...renderers.current]) {
      if (keep.has(uid)) continue;
      r.clear();
      renderers.current.delete(uid);
    }
    if (!viewBefore || lastTime === null || lastBefore === null) return;
    const keepView = () => {
      if (viewEpoch.current !== epoch) return;
      const now = ts.getVisibleLogicalRange();
      const lastNow = ts.timeToIndex(lastTime, true);
      if (!now || lastNow === null) return;
      const shift = lastNow - lastBefore;
      if (Math.abs(now.from - (viewBefore.from + shift)) > 0.5 || Math.abs(now.to - (viewBefore.to + shift)) > 0.5) ts.setVisibleLogicalRange({ from: viewBefore.from + shift, to: viewBefore.to + shift });
    };
    keepView();
    // The library settles the time scale on its next frame too.
    const raf = requestAnimationFrame(keepView);
    return () => cancelAnimationFrame(raf);
  }, [chartApi, runtime, studies, bars, candles, layoutTick]);

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

  // FD-HLINE §3: the user's lines. While one is dragged its price is the pointer's; after the drop it stays there until
  // the lines given change (the saved price arrives, or a failed save brings the server's back).
  const hlineState = useRef({ lines: [] as readonly HLine[], selected: null as string | null, precision: 2 });
  hlineState.current = { lines: hlines ?? [], selected: selectedHLine, precision };
  const drag = useRef<{ id: string; price: number; dropped: readonly HLine[] | null } | null>(null);
  const drawHLines = () => {
    const s = seriesRef.current;
    if (!s) return;
    const d = drag.current;
    const st = hlineState.current;
    s.hlines.setData(
      st.lines.map((l) => (d && l.id === d.id ? { ...l, price: d.price } : l)),
      d?.id ?? st.selected,
      st.precision,
    );
  };
  const drawHLinesRef = useRef(drawHLines);
  drawHLinesRef.current = drawHLines;
  useEffect(() => {
    const d = drag.current;
    if (d?.dropped && d.dropped !== hlines) drag.current = null;
    drawHLinesRef.current();
  }, [chartApi, hlines, selectedHLine, precision]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const hlineHandlers = useRef({ onMoveHLine, onOpenHLine, onAddHLine, hlineBlocked });
  hlineHandlers.current = { onMoveHLine, onOpenHLine, onAddHLine, hlineBlocked };
  /** Where the cursor is on the price pane (kept by the "+"), for Alt+H. */
  const plusCursor = useRef<{ y: number; price: number } | null>(null);

  // Dragging a line (mouse / pen) or tapping it (touch). Caught before the chart sees the press, so it does not scroll.
  useEffect(() => {
    const el = host.current;
    if (!chartApi || !el) return;
    let active: { id: string; startY: number; moved: boolean; touch: boolean; pointerId: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const { y } = local(e);
      if (!active.moved && Math.abs(y - active.startY) < (active.touch ? 10 : 3)) return;
      active.moved = true;
      // A finger moving scrolls the chart (it was not stopped): no drag on touch.
      if (active.touch) return;
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      if (!s || !main) return;
      const price = s.candle.coordinateToPrice(Math.min(main.height, Math.max(0, y - main.top)));
      if (price === null) return;
      drag.current = { id: active.id, price: Number(price.toFixed(hlineState.current.precision)), dropped: null };
      drawHLinesRef.current();
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      el.style.cursor = '';
    };
    const onUp = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const a = active;
      active = null;
      stop();
      const d = drag.current;
      if (a.moved && d && !a.touch) {
        drag.current = { ...d, dropped: hlineState.current.lines };
        hlineHandlers.current.onMoveHLine?.(a.id, d.price);
      } else if (!a.moved) {
        drag.current = null;
        hlineHandlers.current.onOpenHLine?.(a.id);
      }
      drawHLinesRef.current();
    };
    const onCancel = () => {
      active = null;
      drag.current = null;
      stop();
      drawHLinesRef.current();
    };
    const onDown = (e: PointerEvent) => {
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      const h = hlineHandlers.current;
      if (active || !s || !main || (!h.onMoveHLine && !h.onOpenHLine) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const { x, y } = local(e);
      if (x < 0 || x > boxesRef.current.plotWidth || y < main.top || y > main.top + main.height) return;
      const hit = s.hlines.lineAt(y - main.top);
      if (!hit) return;
      active = { id: hit.id, startY: y, moved: false, touch: e.pointerType === 'touch', pointerId: e.pointerId };
      if (!active.touch) {
        // No mousedown follows: the chart neither scrolls nor clicks.
        e.preventDefault();
        e.stopPropagation();
        el.style.cursor = 'ns-resize';
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      stop();
    };
  }, [chartApi]);

  // Alt+H (⌥H): a line at the cursor's price, when the cursor is on the price pane (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyH') return;
      const h = hlineHandlers.current;
      const at = plusCursor.current;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (!h.onAddHLine || !at || h.hlineBlocked || t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      h.onAddHLine(Number(at.price.toFixed(hlineState.current.precision)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const place = (b: { top: number; height: number }): CSSProperties => ({ top: b.top, height: b.height, left: 0, width: boxes.plotWidth });
  const main = boxes.panes.main;
  // FD-GOLATEST, FD-GOLATESTMAIN: the button sits in the bottom-right corner of the price pane, above the panes below it
  // (or above the time axis without them), inside the pane even when it is very short; the price pane's TP / SL box,
  // in the same corner, moves up while the button shows.
  const showLatest = behind && main !== undefined && boxes.plotWidth > 0;
  const latestTop = main ? Math.max(main.top + 4, main.top + main.height - LATEST_SIZE - 10) : 0;
  return (
    <div className={clsx('relative w-full', className ?? (style?.height === undefined && 'h-[560px]'))} style={style}>
      {/* `isolate`: the chart's canvases (z-index 1–2) and pane separators (49–50) stay below the overlays and the page. */}
      <div ref={host} className="absolute inset-0 isolate" aria-label="Grafic lumânări" role="img" />
      {mainOverlay && main && boxes.plotWidth > 0 && (
        <div className="pointer-events-none absolute transition-transform" style={{ ...place(main), transform: showLatest ? `translateY(-${LATEST_SIZE + 10}px)` : undefined }}>
          {mainOverlay}
        </div>
      )}
      {showLatest && (
        <button
          type="button"
          onClick={() => chartApi?.timeScale().scrollToRealTime()}
          aria-label="Mergi la ultima lumânare"
          title="Mergi la ultima lumânare"
          className="absolute z-10 grid place-items-center rounded-lg border border-line bg-panel text-muted shadow-md transition-colors hover:border-accent hover:bg-hover hover:text-accent"
          style={{ top: latestTop, left: boxes.plotWidth - LATEST_SIZE - 10, width: LATEST_SIZE, height: LATEST_SIZE }}
        >
          <ChevronsRight size={18} aria-hidden />
        </button>
      )}
      {boxes.plotWidth > 0 && <Legends chart={chartApi} count={candles.length} boxes={boxes} legends={legends} place={place} />}
      {onAddHLine && main && boxes.plotWidth > 0 && (
        <HLinePlus chart={chartApi} series={seriesRef.current?.candle ?? null} main={main} plotWidth={boxes.plotWidth} precision={precision} blocked={hlineBlocked} onAdd={onAddHLine} cursor={plusCursor} />
      )}
    </div>
  );
}
