// Candlestick chart with the Slingshot overlay (TD §9.3), the LMA pane (TD-CHARTUX) and any other indicator over the
// candles or in its own pane below (TD-INDICATORS §8).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronsRight, Plus, Settings } from 'lucide-react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createTextWatermark,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ITextWatermarkPluginApi,
  type ISeriesApi,
  type MouseEventParams,
  type PriceScaleOptions,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { IndicatorResult } from 'oakscriptjs';
import type { Candle, SlingshotResult } from '../../shared/indicator/slingshot.ts';
import { buildSegments, slingshotShapes } from './slingshot-draw.ts';
import type { SlingshotParams } from '../../shared/indicator/params.ts';
import { brightness, colorNew, PINE_BLACK, PINE_WHITE, rgbaCss, type LmaResult } from '../../shared/indicator/lma.ts';
import type { LineStyleName } from '../../shared/indicator/lma-params.ts';
import { toBars } from '../indicators/compute.ts';
import type { StudyRuntime } from '../indicators/runtime.ts';
import type { IndicatorRenderer, RenderableIndicator, RenderOptions } from '../indicators/vendor/render/index';
import { type ChartBackground, CloudFill, CurrentPriceLabel, CURRENT_PRICE_COLORS, CURSOR_LABEL_COLOR, EdgeLabel, GradientFill, HLINE_CATCH_PX, HLines, HSegments, ShapeLabels, TradeLabels, TRADE_TOUCH_CATCH_PX } from './primitives.ts';
import { LABEL_HEIGHT, LABEL_RIGHT, type TradeLabelSpec } from './trade-labels.ts';
import { fade, formatColor, mixColor } from '../color.ts';
import { fmtBarCountdown } from './countdown.ts';
import { lmaHlines } from './lma-lines.ts';
import { candleColors, CLEAR } from './candle-colors.ts';
import { endTouchCross } from './touch-cross.ts';
import type { HLine } from '../../shared/hlines.ts';
import { isMac } from '../components/CommandPalette.tsx';
import { loadView, saveView } from './view-store.ts';
import { THEME_EVENT, themeColors } from '../theme.ts';
import { DEFAULT_CHART_STYLE, type ChartLineStyle, type ChartStyle } from '../../shared/chart-style.ts';
import { useMediaQuery } from '../media.ts';

const STYLE_OF: Record<ChartLineStyle, LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.LargeDashed, dotted: LineStyle.Dotted };

/**
 * The chart's frame from its settings (FD-CHARTSETTINGS) and the theme (FD-THEME §1, the canvas does not read CSS by
 * itself): a colour left to the theme (null) is the theme's.
 */
/** FD-CHARTSETTINGS: the chart's background from the settings (a colour left unset: the theme's). */
function backgroundOf(look: ChartStyle): ChartBackground {
  const c = themeColors();
  const b = look.canvas.background;
  const top = b.top ?? c.background;
  return { top, bottom: b.type === 'gradient' ? (b.bottom ?? c.background) : top };
}

function frameOptions(look: ChartStyle) {
  const c = themeColors();
  const cv = look.canvas;
  const bg = backgroundOf(look);
  // FD-HLINE §1: the cursor's lines, thin and dashed in the theme's quiet colour, with their labels on the axes.
  // FD-CHARTTV §5: their labels on the scales in TradingView's dark grey.
  const cursorLine = { visible: true, color: cv.crosshair.color ?? c.text, width: cv.crosshair.width as 1 | 2 | 3 | 4, style: STYLE_OF[cv.crosshair.style], labelVisible: true, labelBackgroundColor: CURSOR_LABEL_COLOR };
  const lines = cv.scaleLines ?? c.line;
  return {
    layout: {
      background: bg.top !== bg.bottom ? { type: ColorType.VerticalGradient as const, topColor: bg.top, bottomColor: bg.bottom } : { type: ColorType.Solid as const, color: bg.top },
      textColor: cv.scaleText.color ?? c.text,
      fontSize: cv.scaleText.size,
      panes: { separatorColor: cv.separators ?? c.line, separatorHoverColor: c.lineStrong },
    },
    grid: {
      vertLines: { visible: cv.vertGrid.visible, color: cv.vertGrid.color ?? c.line, style: STYLE_OF[cv.vertGrid.style] },
      horzLines: { visible: cv.horzGrid.visible, color: cv.horzGrid.color ?? c.line, style: STYLE_OF[cv.horzGrid.style] },
    },
    rightPriceScale: { borderColor: lines },
    // Not the right margin: the library takes `rightOffset` as a scroll position (applied again, the view would jump).
    timeScale: { borderColor: lines },
    crosshair: { vertLine: cursorLine, horzLine: cursorLine },
  };
}

/**
 * FIX-PANES: the scale options a pane below the price starts with. The library copies the options set on the main pane's
 * scale (logarithmic, autoscale off after a drag, the margins) into the chart's, and a pane added later starts from
 * those: each new pane gets the chart's own first ones back instead.
 */
type PaneScale = Pick<PriceScaleOptions, 'mode' | 'autoScale' | 'invertScale' | 'scaleMargins'>;
const paneScaleOf = (o: PriceScaleOptions): PaneScale => ({ mode: o.mode, autoScale: o.autoScale, invertScale: o.invertScale, scaleMargins: { ...o.scaleMargins } });

/** The candles' colours from the settings: a part switched off is see-through. */
function candleOptions(look: ChartStyle) {
  const k = look.candles;
  return {
    upColor: k.body.visible ? k.body.up : CLEAR,
    downColor: k.body.visible ? k.body.down : CLEAR,
    borderVisible: k.borders.visible,
    borderUpColor: k.borders.up,
    borderDownColor: k.borders.down,
    wickVisible: k.wick.visible,
    wickUpColor: k.wick.up,
    wickDownColor: k.wick.down,
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
  /** The price label's colour on the scale, when the line's own is see-through (a pending change). */
  axisLabelColor?: string;
  /** FD-ORDEREDIT: the line's id, given back when it is dragged. */
  id?: string;
  /** It can be dragged (a mouse at once; a finger once a tap has selected it). */
  draggable?: boolean;
  /** FD-TRADEUI: a trade's box (quantity | PnL | ×) away from the price scale, instead of the library's title. */
  label?: TradeLabelSpec;
  /** FD-TRADEUI: the entry a SL / TP counts from: while the line is dragged, the area between them is coloured. */
  zoneFrom?: number;
}

/** FD-ORDEREDIT: HTML over the price pane on a line's level (Confirm / Discard on a trade's entry line). */
export interface LineOverlay {
  key: string;
  price: number;
  node: ReactNode;
  /** Kept inside the pane when its line is above or below it (a pending change); else hidden with the line. */
  clamp?: boolean;
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
  /** The pair's decimals: the prices a drag or a new line sets are rounded to them. */
  precision: number;
  /** FD-CHARTSETTINGS: the decimals shown on the scale and the labels (the settings' precision; default `precision`). */
  displayPrecision?: number;
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
  /** FD-CHARTTV §5: the length of a candle (ms), and whether the last one is running (a countdown under the price). */
  tfMs?: number;
  countdown?: boolean;
  /** A share's candle ends at the session's close at the latest (the market's closing time), or null. */
  closeCap?: number | null;
  /** FD-CHARTTV §4: the price scale logarithmic ("L"), and its switch. */
  logScale?: boolean;
  onLogScale?: (on: boolean) => void;
  /** FD-ORDEREDIT: a draggable price line dropped at a new price (rounded to `precision`). */
  onDragLine?: (id: string, price: number) => void;
  /** The text a line's box shows while it is dragged to `price` (its PnL there). */
  dragText?: (id: string, price: number) => string;
  /** FD-TRADEUI: the × of a line's box (close the position, cancel or remove the order). */
  onLineAction?: (id: string) => void;
  /** HTML on lines' levels, over the price pane. */
  lineOverlays?: readonly LineOverlay[];
  /** FD-CHARTSETTINGS: how the chart looks (the defaults: as it was). */
  look?: ChartStyle;
  /** The watermark's lines (the symbol, the timeframe), shown when the settings ask for it. */
  watermark?: readonly string[];
  /** Bumped to put the view back to its default (the last candles, the price scale fitting itself). */
  resetView?: number;
  /** The chart's settings (the ⚙ under the price scale, and the context menu's "Setări…"). */
  onSettings?: () => void;
  /** The context menu (a right click on the chart), at the pointer, with the price there. */
  onContextMenu?: (at: { x: number; y: number; price: number | null }) => void;
}

/** FD-CHARTTV §4: the "A" / "L" buttons, lit (white, as in TradingView) or not; their strip's height, px. */
const SCALE_BOX = 24;
const SCALE_BTN = 'num grid h-[18px] min-w-[18px] place-items-center rounded-[4px] px-1 text-[11px] font-semibold transition-colors disabled:opacity-50';
const SCALE_ON = 'bg-[#d1d4dc] text-[#131722]';
const SCALE_OFF = 'text-muted hover:bg-hover hover:text-text';

/** The chart's text: the labels on the price scale and the lines' titles on the pane (its size: the settings'). */
const CHART_FONT_FAMILY = '"Geist Mono Variable", ui-monospace, monospace';
/** A pending change's line: its colour at 60 % (0–255). */
const PENDING_ALPHA = 153;
const LINE_STYLES = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;
/** Room between an overlay and the trade boxes on its right, px; under it, a message keeps at least this much width. */
const OVERLAY_GAP = 6;
const OVERLAY_MSG_MIN = 240;

/** The "go to the latest candle" button (FD-GOLATEST), px. */
const LATEST_SIZE = 32;

/**
 * FD-CHARTTOUCH: a finger's move that is a drag, px (Manhattan for the library's touch events, vertical for Sentiq's
 * price drag). Under it, a first finger's move may be the start of a pinch.
 */
const TOUCH_DRAG_PX = 8;

interface Boxes {
  /** Each pane's row: 'main' and the keys of `paneOrder`. */
  panes: Record<string, { top: number; height: number }>;
  /** Width of the drawing area (without the price scale). */
  plotWidth: number;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const LINE_STYLE: Record<LineStyleName, LineStyle> = { Solid: LineStyle.Solid, Dashed: LineStyle.Dashed, Dotted: LineStyle.Dotted };

/** The script's three hline() calls with their Style-tab settings (shared with the settings form's preview). */
function tzFormatter(tz: string, opts: Intl.DateTimeFormatOptions) {
  const f = new Intl.DateTimeFormat('ro-RO', { timeZone: tz, hourCycle: 'h23', ...opts });
  return (t: Time) => f.format((t as number) * 1000);
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

/** After a touch closed the "+"'s menu, the chart's moves of that same touch do not bring it back (FD-CHARTAUDIT §1). */
const PLUS_QUIET_MS = 600;

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
  /** The time under the cursor's last real place (FD-CHARTPOLISH §4: the cross is put back there while on the button). */
  const lastTime = useRef<Time | null>(null);
  /** The mouse is on the chart, on any pane (there the chart draws its own cross: it is not taken away). */
  const onChart = useRef(false);
  // FD-CHARTAUDIT §1: the button's place is written on it at once, in the chart's own move (the same frame as the
  // cross it draws); a re-render would come a frame late, and on a fast move the "+" trailed the dashed line.
  const live = useRef<{ y: number; price: number } | null>(null);
  const top = useRef(main.top);
  top.current = main.top;
  const place = () => {
    const el = box.current;
    if (el && live.current) el.style.top = `${top.current + live.current.y - 10}px`;
  };
  useLayoutEffect(place);
  /** How the last press on the button or its menu was made: a touch never leaves the "+" behind. */
  const lastPointer = useRef('mouse');
  const quietUntil = useRef(0);
  /** A touch closed the menu, or added the line: the "+" and the cross go (on a touch screen nothing would take them). */
  const dismiss = () => {
    setMenu(false);
    setHover(false);
    setAt(null);
    live.current = null;
    cursor.current = null;
    quietUntil.current = performance.now() + PLUS_QUIET_MS;
    if (!chart) return;
    chart.clearCrosshairPosition();
    // FD-CHARTAUDIT §14: and the library's cross mode with them (else the next swipe moves the hidden cross, not the chart).
    endTouchCross(chart);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!chart || !series) return;
    let hide: ReturnType<typeof setTimeout> | null = null;
    const onMove = (p: MouseEventParams<Time>) => {
      // The cross put back from here (no source event): not the mouse.
      if (p.point && !p.sourceEvent) return;
      onChart.current = !!p.point;
      if (p.point && p.time !== undefined) lastTime.current = p.time;
      const price = p.point && p.paneIndex === 0 ? series.coordinateToPrice(p.point.y) : null;
      cursor.current = p.point && price !== null ? { y: p.point.y, price } : null;
      if (hide !== null) clearTimeout(hide);
      hide = null;
      // On the button or its menu the cursor left the chart: the button stays where it was.
      if (hold.current) return;
      if (cursor.current) {
        if (performance.now() < quietUntil.current) return;
        live.current = cursor.current;
        place();
        setAt(cursor.current);
      }
      // Moving onto the button, the chart tells "left" before the button tells "entered": hide a moment later.
      else hide = setTimeout(() => !hold.current && setAt(null), 150);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (hide !== null) clearTimeout(hide);
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, [chart, series, cursor]);
  // FD-CHARTPOLISH §4: on the button (or its menu), the cross stays where it was: its dashed lines and the grey price
  // label (the chart took them away when the mouse left it for the button).
  useEffect(() => {
    if (!chart || !series || !at || !(menu || hover) || lastTime.current === null) return;
    chart.setCrosshairPosition(at.price, lastTime.current, series);
  }, [chart, series, at, menu, hover]);
  // Off the button, with its menu closed and the cursor not on the price pane: it goes, and so does the cross put back
  // (a moment later: back on the chart, the chart's own move comes after the button's "left").
  useEffect(() => {
    if (menu || hover || cursor.current) return;
    const t = setTimeout(() => {
      if (hold.current || cursor.current) return;
      setAt(null);
      // Left for another pane, the chart's own cross is there: only one put back, off the chart, is taken away.
      if (!onChart.current) chart?.clearCrosshairPosition();
    }, 80);
    return () => clearTimeout(t);
  }, [menu, hover, cursor, chart]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      // A mouse goes on showing the "+" where it is; a touch leaves nothing that would take it away.
      if (e.pointerType === 'mouse') setMenu(false);
      else dismissRef.current();
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
    // `top` is written by place() (FD-CHARTAUDIT §1); a touch is never "on" the button (iOS sends it a mouseenter, never
    // the mouseleave), only a mouse.
    <div
      ref={box}
      className="absolute z-20"
      style={{ left: plotWidth - 21 }}
      onPointerDown={(e) => (lastPointer.current = e.pointerType)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
    >
      <button
        type="button"
        aria-label={`Adaugă la ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        title={`Adaugă la ${label}`}
        onClick={() => setMenu((m) => !m)}
        className="grid size-5 place-items-center rounded-l-[4px] text-white transition-colors hover:brightness-125"
        // FD-CHARTTV §5: a grey square against the cursor's price label, in its colour.
        style={{ backgroundColor: CURSOR_LABEL_COLOR }}
      >
        <Plus size={14} aria-hidden />
      </button>
      {menu && (
        // FD-CHARTAUDIT §1: never wider than the plot (on a 320 px phone it began left of the chart and was cut).
        <div
          role="menu"
          className="absolute top-7 right-0 w-max rounded-xl border border-line-strong bg-panel-2 py-1.5 shadow-pop"
          style={{ minWidth: Math.min(240, plotWidth - 8), maxWidth: plotWidth - 8 }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => {
              onAdd(price);
              if (lastPointer.current !== 'mouse') return dismiss();
              setMenu(false);
              setHover(false);
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] text-text transition-colors hover:bg-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
          >
            <span className="flex-1">
              Linie orizontală la <span className="num">{label}</span>
            </span>
            {/* FD-CHARTAUDIT §15: not on a phone (no keyboard), as the top bar's shortcuts. */}
            <kbd className="num hidden text-[11.5px] text-faint md:inline">{isMac() ? '⌥H' : 'Alt+H'}</kbd>
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
  displayPrecision,
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
  tfMs = 0,
  countdown = false,
  closeCap = null,
  logScale = false,
  onLogScale,
  onDragLine,
  dragText,
  onLineAction,
  lineOverlays,
  look = DEFAULT_CHART_STYLE,
  watermark,
  resetView = 0,
  onSettings,
  onContextMenu,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  /** FD-CHARTSETTINGS: the settings now, for what reads them later (the theme switching, the chart created). */
  const lookRef = useRef(look);
  lookRef.current = look;
  /** The candles' settings, as a key: the candles are set again when they change. */
  const candlesKey = JSON.stringify(look.candles);
  /** Bumped when the theme switches: what follows the theme's colours is worked out again. */
  const [themeTick, setThemeTick] = useState(0);
  const bgKey = JSON.stringify(look.canvas.background);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the background's settings and the theme
  const bg = useMemo(() => backgroundOf(lookRef.current), [bgKey, themeTick]);
  /** The symbol and interval in the middle of the price pane (the settings' watermark). */
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  /** The decimals shown. */
  const digits = displayPrecision ?? precision;
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
    current: CurrentPriceLabel;
    lines: IPriceLine[];
    /** FD-ORDEREDIT, FD-TRADEUI: the trades' boxes and what the pointer catches; the draggable lines by id. */
    labels: TradeLabels;
    byId: Map<string, { line: IPriceLine; spec: PriceLineSpec }>;
  } | null>(null);
  const lmaRef = useRef<{ series: ISeriesApi<'Line'>; fill: GradientFill; label: EdgeLabel; lines: IPriceLine[] } | null>(null);
  /** One renderer per indicator drawn, by uid. */
  const renderers = useRef(new Map<string, IndicatorRenderer>());
  /** Values the LMA pane must show (the visible hlines), read by its autoscale. */
  const hlineValues = useRef<number[]>([0.5, -0.5, 0]);
  /** FIX-PANES: the scale a new pane below starts with, taken when the chart is made (before the main pane's are set). */
  const paneScale = useRef<PaneScale | null>(null);
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
  /** FD-CHARTTV §4: the price scale fits the candles by itself ("A" lit). */
  const [auto, setAuto] = useState(true);
  /** FD-CHARTSETTINGS: the mouse over the chart (buttons "visible on mouse over"); a touch screen has none. */
  const [hovered, setHovered] = useState(false);
  const coarse = useMediaQuery('(pointer: coarse)');
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
    // The colours come from the theme's tokens (--color-ink / --color-muted / --color-line), FD-THEME, and the chart's
    // settings (FD-CHARTSETTINGS).
    const frame = frameOptions(lookRef.current);
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        ...frame.layout,
        fontFamily: CHART_FONT_FAMILY,
        attributionLogo: false,
        panes: { ...frame.layout.panes, enableResize: true },
      },
      // FD-CHARTUX: no grid unless the settings ask; FD-HLINE §1: the cursor's dashed lines (in `frameOptions`).
      grid: frame.grid,
      crosshair: { mode: CrosshairMode.Normal, ...frame.crosshair },
      rightPriceScale: frame.rightPriceScale,
      // New bars keep the view glued to the right edge by the code below (data effect), not by the library: its own shift
      // also fires for the points an indicator draws ahead of the candles (Ichimoku) and moved the view off them.
      timeScale: { ...frame.timeScale, rightOffset: lookRef.current.canvas.margins.right, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: false },
    });
    paneScale.current = paneScaleOf(chart.options().rightPriceScale);
    // The theme switched: recolour the frame in place (the zoom stays).
    const onTheme = () => {
      chart.applyOptions(frameOptions(lookRef.current));
      setThemeTick((t) => t + 1);
    };
    window.addEventListener(THEME_EVENT, onTheme);
    const candle = chart.addSeries(CandlestickSeries, {
      ...candleOptions(lookRef.current),
      // FD-CHARTTV §5: the current price's dotted yellow line; its label (with the countdown) is CurrentPriceLabel's.
      lastValueVisible: false,
      priceLineVisible: true,
      priceLineColor: CURRENT_PRICE_COLORS.line,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
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
    const current = new CurrentPriceLabel();
    candle.attachPrimitive(current);
    // FD-ORDEREDIT, FD-TRADEUI: the trades' boxes, over the candles.
    const tradeLabels = new TradeLabels();
    candle.attachPrimitive(tradeLabels);
    chartRef.current = chart;
    seriesRef.current = { candle, fast, slow, markers, cloud, segments, hlines: hl, current, lines: [], labels: tradeLabels, byId: new Map() };

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
      watermarkRef.current?.detach();
      watermarkRef.current = null;
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
      // FIX-PANES: not the main pane's logarithmic scale, autoscale or margins (which the library hands on).
      if (paneScale.current) chart.priceScale('right', pane.paneIndex()).applyOptions(paneScale.current);
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
    seriesRef.current?.candle.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits } });
  }, [chartApi, tz, digits]);

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
    // FD-CHARTSETTINGS: up / down by the previous candle's close, when asked (the first candle by its own open).
    // FD-BARCOLORBODY: LMA's colour fills the body only; the border and the wick keep the settings' colours.
    const k = lookRef.current.candles;
    s.candle.setData(candles.map((c, i) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c, ...candleColors(k, candles, i, barColors?.[i]) })));
    prevLength.current = candles.length;
    shownLast.current = candles.length ? toTime((candles.at(-1) as Candle).t) : null;
    const r = result;
    if (r) {
      // FD-SS34LIVE: the cloud's own colours (the EMAs; the cloud at half their opacity).
      const up = params.cloudUpColor;
      const down = params.cloudDownColor;
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
      s.markers.setData(slingshotShapes(r.markers, candles, params));
      s.segments.setData(buildSegments(r, params, digits));
    } else {
      s.fast.setData([]);
      s.slow.setData([]);
      s.cloud.setData([], params.cloudUpColor, params.cloudDownColor);
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
      // FD-CHARTTV §4: another symbol or timeframe starts fitted ("A" on).
      chart.priceScale('right').setAutoScale(true);
      setAuto(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the candles' settings read through lookRef, keyed by candlesKey
  }, [chartApi, candles, result, params, digits, viewKey, lma, showLma, layoutTick, candlesKey]);

  // LMA thresholds and the 0 line (Pine hline), as shown / styled in the Style group.
  const e = lma?.effective;
  // Keyed by what is drawn (levels, colours, widths, styles, shown or not): any of them changed draws them again.
  const linesKey = e ? JSON.stringify(lmaHlines(e)) : '';
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
  const signalKey = e ? `${e.showSignal}|${e.signalWidth}|${e.signalStyle}` : '';
  useEffect(() => {
    const l = lmaRef.current;
    if (!l || !e) return;
    l.series.applyOptions({ lineVisible: e.showSignal, lastValueVisible: e.showSignal, crosshairMarkerVisible: e.showSignal, lineWidth: e.signalWidth as 1 | 2 | 3 | 4, lineStyle: LINE_STYLE[e.signalStyle] });
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

  // FD-STYLEUNIFY: the Slingshot EMAs' width and style (their colour is the trend's, set with their data).
  const emaKey = `${params.slowEmaWidth}|${params.slowEmaStyle}|${params.fastEmaWidth}|${params.fastEmaStyle}`;
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.slow.applyOptions({ lineWidth: params.slowEmaWidth as 1 | 2 | 3 | 4, lineStyle: LINE_STYLE[params.slowEmaStyle] });
    s.fast.applyOptions({ lineWidth: params.fastEmaWidth as 1 | 2 | 3 | 4, lineStyle: LINE_STYLE[params.fastEmaStyle] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by emaKey
  }, [chartApi, emaKey]);

  // FD-CHARTSETTINGS: the settings applied in place (the zoom stays): the frame, the margins, the candles, the watermark.
  const lookKey = JSON.stringify(look);
  const watermarkKey = (watermark ?? []).join('|');
  useEffect(() => {
    const chart = chartApi;
    const s = seriesRef.current;
    if (!chart || !s) return;
    chart.applyOptions(frameOptions(look));
    // The price pane's own scale: its empty space above and below the candles.
    chart.priceScale('right', 0).applyOptions({ scaleMargins: { top: look.canvas.margins.top / 100, bottom: look.canvas.margins.bottom / 100 } });
    s.candle.applyOptions(candleOptions(look));
    const pane = chart.panes()[0];
    const wm = look.canvas.watermark;
    const lines = (watermark ?? []).filter(Boolean);
    if (pane && wm.visible && lines.length) {
      const color = wm.color ?? fade(themeColors().text, 0.12);
      const options = { horzAlign: 'center' as const, vertAlign: 'center' as const, lines: lines.map((text, i) => ({ text, color, fontSize: i === 0 ? 56 : 28, fontStyle: '600', fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif' })) };
      if (watermarkRef.current) watermarkRef.current.applyOptions(options);
      else watermarkRef.current = createTextWatermark(pane, options);
    } else if (watermarkRef.current) {
      watermarkRef.current.detach();
      watermarkRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by lookKey / watermarkKey; the theme for its colours
  }, [chartApi, lookKey, watermarkKey, themeTick]);
  // The right margin, only when it changes (it moves the view to the latest candle with that much room after it).
  const rightMargin = look.canvas.margins.right;
  const rightApplied = useRef(rightMargin);
  useEffect(() => {
    if (!chartApi || rightApplied.current === rightMargin) return;
    rightApplied.current = rightMargin;
    chartApi.timeScale().applyOptions({ rightOffset: rightMargin });
  }, [chartApi, rightMargin]);
  // The trade boxes on the chart's background.
  useEffect(() => {
    seriesRef.current?.labels.setBackground(bg);
  }, [chartApi, bg]);
  // FD-CHARTSETTINGS: "Resetează vizualizarea": the last 180 candles with room on the right, the price scale fitting
  // itself again (the remembered view becomes this one).
  // Only a new request: a chart made again later (another symbol) opens on its remembered view, not on a reset.
  const resetDone = useRef(resetView);
  useEffect(() => {
    const chart = chartApi;
    if (!chart || resetView === resetDone.current) return;
    resetDone.current = resetView;
    const n = candlesRef.current.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 20 });
    chart.priceScale('right').setAutoScale(true);
    setAuto(true);
  }, [chartApi, resetView]);

  // Positions / orders as price lines; FD-ORDEREDIT: the draggable ones kept by id (a drag moves them in place), the
  // one selected by a tap (or being dragged) thicker.
  const selectedTrade = useRef<string | null>(null);
  const tradeDrag = useRef<{ id: string; price: number } | null>(null);
  const tradeHandlers = useRef({ onDragLine, dragText, onLineAction });
  tradeHandlers.current = { onDragLine, dragText, onLineAction };
  const widthOf = (id: string | undefined) => (id !== undefined && (id === selectedTrade.current || id === tradeDrag.current?.id) ? 2 : 1);
  const restyleTrade = () => {
    const s = seriesRef.current;
    if (!s) return;
    for (const [id, { line }] of s.byId) line.applyOptions({ lineWidth: widthOf(id) });
    s.labels.setSelected(selectedTrade.current);
  };
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of s.lines) s.candle.removePriceLine(l);
    s.byId.clear();
    const shown = priceLines.filter((l) => Number.isFinite(l.price));
    s.lines = shown.map((l) => {
      const line = s.candle.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: widthOf(l.draggable ? l.id : undefined),
        lineStyle: l.style === 'solid' ? LineStyle.Solid : l.style === 'dashed' ? LineStyle.Dashed : LineStyle.Dotted,
        lineVisible: l.lineVisible ?? true,
        axisLabelVisible: l.axisLabelVisible ?? true,
        ...(l.axisLabelColor ? { axisLabelColor: l.axisLabelColor } : {}),
        // A trade's box replaces the library's title.
        title: l.label ? '' : l.title,
      });
      if (l.draggable && l.id) s.byId.set(l.id, { line, spec: l });
      return line;
    });
    // A selected line that is gone (the order filled, or no longer draggable) is no longer selected; a line being dragged
    // stays where the pointer is (the lines are drawn again with each new price, as the PnL changes).
    if (selectedTrade.current && !s.byId.has(selectedTrade.current)) selectedTrade.current = null;
    const d = tradeDrag.current;
    const dragged = d ? s.byId.get(d.id) : undefined;
    if (d && dragged) dragged.line.applyOptions({ price: d.price });
    s.labels.setData(
      // The boxes in the line's full colour (a pending line is dimmed, its box tinted instead).
      shown.flatMap((l) => (l.id && (l.draggable || l.label) ? [{ id: l.id, price: l.price, color: l.axisLabelColor ?? l.color, label: l.label ?? null, draggable: Boolean(l.draggable), zoneFrom: l.zoneFrom ?? null }] : [])),
    );
    s.labels.setSelected(selectedTrade.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- widthOf reads refs only
  }, [chartApi, priceLines]);

  // FD-CHARTTV §5: the current price's label, with the time left in the candle while it is running.
  const lastBar = candles.at(-1);
  const scaleFont = look.canvas.scaleText.size;
  useEffect(() => {
    const cur = seriesRef.current?.current;
    if (!cur) return;
    cur.setData(lastBar ? { price: lastBar.c, precision: digits, closesAt: countdown && tfMs > 0 ? Math.min(lastBar.t + tfMs, closeCap ?? Number.POSITIVE_INFINITY) : null, format: fmtBarCountdown, fontSize: scaleFont } : null);
    if (!countdown || !lastBar) return;
    const t = setInterval(() => cur.tick(), 1000);
    return () => clearInterval(t);
  }, [chartApi, lastBar, digits, countdown, tfMs, closeCap, scaleFont]);

  // FD-CHARTTV §4: "L" — the price scale logarithmic or normal.
  useEffect(() => {
    chartApi?.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [chartApi, logScale]);
  // "A" follows the scale: dragging the price scale (or a double click on it) changes it inside the library.
  useEffect(() => {
    const el = host.current;
    if (!chartApi || !el) return;
    const read = () => requestAnimationFrame(() => setAuto(chartApi.priceScale('right').options().autoScale));
    el.addEventListener('pointerup', read);
    el.addEventListener('dblclick', read);
    el.addEventListener('wheel', read, { passive: true });
    return () => {
      el.removeEventListener('pointerup', read);
      el.removeEventListener('dblclick', read);
      el.removeEventListener('wheel', read);
    };
  }, [chartApi]);
  const fitPrices = () => {
    chartApi?.priceScale('right').setAutoScale(true);
    setAuto(true);
  };

  // FD-CHARTTOUCH: a pinch as Safari delivers it. The library drops a pinch once the first finger has moved at all (any
  // touchmove) before the second lands, and Safari sends even 1 px moves: the page then got the gesture and zoomed. A
  // lone first finger's moves under TOUCH_DRAG_PX are kept from the library (captured on the host, stopped before they
  // reach it), so the second finger always starts a pinch; a drag still starts, a few px later than the library's 5.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let first: { id: number; x: number; y: number } | null = null;
    let through = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t) {
        first = { id: t.identifier, x: t.clientX, y: t.clientY };
        through = false;
      } else {
        // Two fingers: the library's pinch.
        through = true;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (through || !first || e.touches.length !== 1) return;
      const id = first.id;
      const t = [...e.touches].find((x) => x.identifier === id);
      if (!t) return;
      if (Math.abs(t.clientX - first.x) + Math.abs(t.clientY - first.y) >= TOUCH_DRAG_PX) {
        through = true;
        return;
      }
      e.stopPropagation();
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      first = null;
      through = false;
    };
    const opts = { capture: true, passive: true } as const;
    el.addEventListener('touchstart', onStart, opts);
    el.addEventListener('touchmove', onMove, opts);
    el.addEventListener('touchend', onEnd, opts);
    el.addEventListener('touchcancel', onEnd, opts);
    return () => {
      el.removeEventListener('touchstart', onStart, opts);
      el.removeEventListener('touchmove', onMove, opts);
      el.removeEventListener('touchend', onEnd, opts);
      el.removeEventListener('touchcancel', onEnd, opts);
    };
  }, []);

  // FD-HLINE §3: the user's lines. While one is dragged its price is the pointer's; after the drop it stays there until
  // the lines given change (the saved price arrives, or a failed save brings the server's back).
  const hlineState = useRef({ lines: [] as readonly HLine[], selected: null as string | null, precision: 2, digits: 2 });
  hlineState.current = { lines: hlines ?? [], selected: selectedHLine, precision, digits };
  const drag = useRef<{ id: string; price: number; dropped: readonly HLine[] | null } | null>(null);
  const drawHLines = () => {
    const s = seriesRef.current;
    if (!s) return;
    const d = drag.current;
    const st = hlineState.current;
    s.hlines.setData(
      st.lines.map((l) => (d && l.id === d.id ? { ...l, price: d.price } : l)),
      d?.id ?? st.selected,
      st.digits,
    );
  };
  const drawHLinesRef = useRef(drawHLines);
  drawHLinesRef.current = drawHLines;
  useEffect(() => {
    const d = drag.current;
    if (d?.dropped && d.dropped !== hlines) drag.current = null;
    drawHLinesRef.current();
  }, [chartApi, hlines, selectedHLine, digits]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const hlineHandlers = useRef({ onMoveHLine, onOpenHLine, onAddHLine, hlineBlocked });
  hlineHandlers.current = { onMoveHLine, onOpenHLine, onAddHLine, hlineBlocked };
  /** Where the cursor is on the price pane (kept by the "+"), for Alt+H. */
  const plusCursor = useRef<{ y: number; price: number } | null>(null);

  // Dragging a line (mouse / pen) or tapping it (touch). Caught before the chart sees the press, so it does not scroll.
  // FD-ORDEREDIT: a trade's line too; a finger drags one only once a tap has selected it (else it scrolls the chart).
  useEffect(() => {
    const el = host.current;
    if (!chartApi || !el) return;
    let active: { kind: 'hline' | 'trade' | 'action'; id: string; startX: number; startY: number; moved: boolean; touch: boolean; grab: boolean; pointerId: number; price: number | null } | null = null;
    /** A finger dragging a trade's line: the chart gets none of its touches (it would scroll). */
    let touchGrab = false;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const priceAt = (y: number) => {
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      if (!s || !main) return null;
      const price = s.candle.coordinateToPrice(Math.min(main.height, Math.max(0, y - main.top)));
      return price === null ? null : Number(price.toFixed(hlineState.current.precision));
    };
    // The dragged line and its box where the pointer is (its text: the PnL there), or back on their level.
    const showTrade = (id: string, price: number | null) => {
      const s = seriesRef.current;
      const t = s?.byId.get(id);
      if (!s || !t) return;
      // While dragged: dotted and dimmed, as a pending change (TradingView); the price on the scale stays solid.
      t.line.applyOptions(
        price === null
          ? { price: t.spec.price, color: t.spec.color, lineStyle: LINE_STYLES[t.spec.style], axisLabelColor: t.spec.axisLabelColor ?? '' }
          : { price, color: formatColor(t.spec.color, PENDING_ALPHA), lineStyle: LineStyle.Dotted, axisLabelColor: t.spec.axisLabelColor ?? t.spec.color },
      );
      s.labels.setDragged(price === null ? null : { id, price, text: tradeHandlers.current.dragText?.(id, price) ?? t.spec.label?.text ?? '' });
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const { x, y } = local(e);
      // A finger that moved either way scrolled the chart: no tap (FD-CHARTAUDIT §18; a swipe begun on a line opened its
      // settings). A mouse (or a finger holding a trade's line) drags the line up or down only.
      const dist = active.touch && !active.grab ? Math.abs(x - active.startX) + Math.abs(y - active.startY) : Math.abs(y - active.startY);
      if (!active.moved && dist < (active.touch && !active.grab ? 10 : 3)) return;
      active.moved = true;
      // A press on a box's × that moves is no click on it.
      if (active.kind === 'action') return;
      // A finger moving scrolls the chart (it was not stopped): no drag on touch.
      if (active.touch && !active.grab) return;
      const price = priceAt(y);
      if (price === null) return;
      if (active.kind === 'trade') {
        // An order's level is above zero.
        if (!(price > 0)) return;
        active.price = price;
        tradeDrag.current = { id: active.id, price };
        showTrade(active.id, price);
        restyleTrade();
        return;
      }
      drag.current = { id: active.id, price, dropped: null };
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
      // FD-TRADEUI: a click (or tap) on a box's ×.
      if (a.kind === 'action') {
        if (!a.moved) tradeHandlers.current.onLineAction?.(a.id);
        return;
      }
      if (a.kind === 'trade') {
        tradeDrag.current = null;
        if (a.moved && a.price !== null) {
          // Back to what it shows until the lines given change: the drop becomes a draft there (or nothing).
          showTrade(a.id, null);
          tradeHandlers.current.onDragLine?.(a.id, a.price);
        } else if (!a.moved && a.touch) {
          // A tap selects the line (thicker): the next touch on it drags it.
          selectedTrade.current = a.id;
        }
        restyleTrade();
        return;
      }
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
      const a = active;
      active = null;
      stop();
      if (a?.kind === 'trade') {
        tradeDrag.current = null;
        showTrade(a.id, null);
        restyleTrade();
        return;
      }
      drag.current = null;
      drawHLinesRef.current();
    };
    // The touches of a finger holding a trade's line stop here (captured on the host, before the chart's own).
    const onTouch = (e: TouchEvent) => {
      if (!touchGrab) return;
      e.stopPropagation();
      if (e.type === 'touchend' || e.type === 'touchcancel') touchGrab = e.touches.length > 0;
    };
    const onDown = (e: PointerEvent) => {
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      const h = hlineHandlers.current;
      // A second finger (a pinch): the drag ends there and the library zooms, the scale fitting itself as before.
      if (pan && e.pointerId !== pan.pointerId) {
        endPan(true);
        return;
      }
      if (active || pan || !s || !main || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const { x, y } = local(e);
      if (x < 0 || x > boxesRef.current.plotWidth || y < main.top || y > main.top + main.height) return;
      const touch = e.pointerType === 'touch';
      // FD-TRADEUI: a trade's box first: its × is a button, its body the line itself.
      const box = s.labels.hit(x, y - main.top);
      if (box?.part === 'close' && tradeHandlers.current.onLineAction) {
        active = { kind: 'action', id: box.id, startX: x, startY: y, moved: false, touch, grab: false, pointerId: e.pointerId, price: null };
        // The chart neither scrolls nor clicks under it.
        e.preventDefault();
        e.stopPropagation();
        if (touch) touchGrab = true;
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
        return;
      }
      const hit = h.onMoveHLine || h.onOpenHLine ? s.hlines.lineAt(y - main.top) : null;
      const trade = !tradeHandlers.current.onDragLine ? null : box?.draggable ? { id: box.id, distance: 0 } : s.labels.lineAt(y - main.top, touch ? TRADE_TOUCH_CATCH_PX : HLINE_CATCH_PX);
      // A touch anywhere but on the selected line unselects it.
      if (touch && selectedTrade.current && trade?.id !== selectedTrade.current) {
        selectedTrade.current = null;
        restyleTrade();
      }
      // The nearer of the two; a trade's line when both are as near.
      const onTrade = trade !== null && (hit === null || trade.distance <= hit.distance);
      if (!hit && !trade) {
        startPan(e, y);
        return;
      }
      const grab = onTrade && (!touch || trade.id === selectedTrade.current);
      active = { kind: onTrade ? 'trade' : 'hline', id: onTrade ? trade.id : (hit as { id: string }).id, startX: x, startY: y, moved: false, touch, grab, pointerId: e.pointerId, price: null };
      if (!touch) {
        // No mousedown follows: the chart neither scrolls nor clicks.
        e.preventDefault();
        e.stopPropagation();
        el.style.cursor = 'ns-resize';
      } else if (grab) {
        touchGrab = true;
        e.stopPropagation();
      } else if (onTrade) {
        // Not selected: the finger moves the chart as anywhere else (a tap, without a move, selects the line).
        startPan(e, y);
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    };
    // FD-CHARTTV §4: dragging the price pane moves it both ways. With the scale fitting itself, the library moves only
    // the time; a vertical move turns the fitting off and moves the prices here (linear scale), or the library does it
    // with the fitting off from the press (logarithmic: its range cannot be set in prices), back on after a flat drag.
    let pan: { pointerId: number; startY: number; log: boolean; touch: boolean; mouse: boolean; taken: boolean; y0: number; range0: { from: number; to: number } | null; k: number; maxDy: number } | null = null;
    // FD-CHARTAUDIT §13: the library's cross mode on a touch screen (a long press puts the cross on the price pane; while
    // it is there a drag moves it). Told by the library's own cross moves after a touch; the cross put back by the "+"
    // (no source event) leaves it as it is, and the mouse's cross is not that mode.
    let lastType = 'mouse';
    let touchCross = false;
    const onType = (e: PointerEvent) => (lastType = e.pointerType);
    const onCross = (p: MouseEventParams<Time>) => {
      if (p.point && !p.sourceEvent) return;
      touchCross = p.point !== undefined && p.paneIndex === 0 && lastType !== 'mouse';
    };
    // A finger's move under TOUCH_DRAG_PX may be the start of a pinch (FD-CHARTTOUCH); a mouse's is a drag from 3 px.
    const dragFrom = (p: { touch: boolean }) => (p.touch ? TOUCH_DRAG_PX : 3);
    const startPan = (e: PointerEvent, y: number) => {
      const ps = chartApi.priceScale('right');
      if (!ps.options().autoScale) return;
      const log = ps.options().mode === PriceScaleMode.Logarithmic;
      if (log) ps.setAutoScale(false);
      pan = { pointerId: e.pointerId, startY: y, log, touch: e.pointerType === 'touch', mouse: e.pointerType === 'mouse', taken: false, y0: y, range0: null, k: 0, maxDy: 0 };
      window.addEventListener('pointermove', onPanMove, true);
      window.addEventListener('pointerup', onPanUp, true);
      window.addEventListener('pointercancel', onPanUp, true);
    };
    const onPanMove = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.pointerId) return;
      // In the cross mode (from a long press now or before) the finger moves the cross only. Told at the move, not the
      // press: a press that closes the "+" menu ends the mode first (FD-CHARTAUDIT §14), and then drags as usual.
      if (!pan.mouse && touchCross) {
        endPan(true);
        return;
      }
      const { y } = local(e);
      pan.maxDy = Math.max(pan.maxDy, Math.abs(y - pan.startY));
      if (pan.log) return;
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      if (!s || !main) return;
      const ps = chartApi.priceScale('right');
      if (!pan.taken) {
        if (Math.abs(y - pan.startY) < dragFrom(pan)) return;
        const range = ps.getVisibleRange();
        const a = s.candle.coordinateToPrice(main.height * 0.25);
        const b = s.candle.coordinateToPrice(main.height * 0.75);
        if (!range || a === null || b === null || main.height <= 0) return;
        pan.taken = true;
        pan.y0 = y;
        pan.range0 = range;
        // Prices per pixel (the scale is linear here).
        pan.k = (a - b) / (main.height * 0.5);
        ps.setAutoScale(false);
        setAuto(false);
        return;
      }
      const r0 = pan.range0 as { from: number; to: number };
      const shift = (y - pan.y0) * pan.k;
      ps.setVisibleRange({ from: r0.from + shift, to: r0.to + shift });
    };
    const onPanUp = (e: PointerEvent) => {
      if (pan && e.pointerId === pan.pointerId) endPan();
    };
    const endPan = (undo = false) => {
      const p = pan;
      if (!p) return;
      pan = null;
      stopPan();
      // A pinch, or the cross mode (FD-CHARTAUDIT §13), is no drag: the scale fits itself again, as before the press (a
      // drag starts only from "A" on).
      if (undo) {
        chartApi.priceScale('right').setAutoScale(true);
        setAuto(true);
        return;
      }
      // Logarithmic, without a vertical move: the scale fits itself again (the drag only moved the time).
      if (p.log) {
        const flat = p.maxDy < dragFrom(p);
        if (flat) chartApi.priceScale('right').setAutoScale(true);
        setAuto(flat);
      }
    };
    const stopPan = () => {
      window.removeEventListener('pointermove', onPanMove, true);
      window.removeEventListener('pointerup', onPanUp, true);
      window.removeEventListener('pointercancel', onPanUp, true);
    };
    // FD-TRADEUI: the box part under the mouse (the × lights up).
    const onHover = (e: PointerEvent) => {
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      if (!s || e.pointerType !== 'mouse') return;
      if (!main || active) return s.labels.setHover(null);
      const { x, y } = local(e);
      const box = y >= main.top && y <= main.top + main.height ? s.labels.hit(x, y - main.top) : null;
      s.labels.setHover(box ? { id: box.id, part: box.part } : null);
    };
    const onLeave = () => seriesRef.current?.labels.setHover(null);
    el.addEventListener('pointermove', onHover);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onType, true);
    el.addEventListener('pointermove', onType, true);
    el.addEventListener('pointerdown', onDown, true);
    const touchOpts = { capture: true, passive: true } as const;
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) el.addEventListener(t, onTouch, touchOpts);
    chartApi.subscribeCrosshairMove(onCross);
    return () => {
      el.removeEventListener('pointermove', onHover);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onType, true);
      el.removeEventListener('pointermove', onType, true);
      el.removeEventListener('pointerdown', onDown, true);
      for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) el.removeEventListener(t, onTouch, touchOpts);
      chartApi.unsubscribeCrosshairMove(onCross);
      stop();
      stopPan();
    };
  }, [chartApi]);

  // FD-ORDEREDIT, FD-TRADEUI: each overlay on its line, just before the trade boxes on that level (as in TradingView),
  // followed while the view moves (frame by frame, only while there is one). Its message (an error) opens under it, or
  // above it in the pane's lower half; right-aligned with it, or from the pane's left when there is no room.
  const overlaysRef = useRef(lineOverlays);
  overlaysRef.current = lineOverlays;
  const overlayEls = useRef(new Map<string, HTMLDivElement>());
  /** Each overlay on its line or over the box: kept until the room changes clearly (the PnL's width changes with the price). */
  const overlayStacked = useRef(new Map<string, boolean>());
  const overlaysKey = (lineOverlays ?? []).map((o) => `${o.key}@${o.price}`).join('|');
  const [overlayPos, setOverlayPos] = useState<Record<string, { top: number; right: number; up: boolean; room: number; span: number; from: number }>>({});
  useEffect(() => {
    if (!overlaysKey) {
      setOverlayPos({});
      return;
    }
    let raf = 0;
    const tick = () => {
      const s = seriesRef.current;
      const main = boxesRef.current.panes.main;
      const plot = boxesRef.current.plotWidth;
      const next: Record<string, { top: number; right: number; up: boolean; room: number; span: number; from: number }> = {};
      if (s && main && plot > 0) {
        const drawn = s.labels.boxes();
        for (const o of overlaysRef.current ?? []) {
          const raw = s.candle.priceToCoordinate(o.price);
          if (raw === null) continue;
          // Off the pane, an overlay that need not stay reachable goes with its line.
          if (o.clamp === false && (raw < 0 || raw > main.height)) continue;
          const el = overlayEls.current.get(o.key);
          const h = el?.offsetHeight ?? 40;
          const w = el?.offsetWidth ?? 0;
          const onLine = Math.min(Math.max(raw, h / 2 + 2), main.height - h / 2 - 2);
          // Every box on this level (where none is, where one would be).
          let edge = plot - LABEL_RIGHT;
          let boxRight = plot - LABEL_RIGHT;
          for (const b of drawn) {
            if (Math.abs(b.y - onLine) >= h / 2 + LABEL_HEIGHT / 2 + 2) continue;
            edge = Math.min(edge, b.g.x);
            boxRight = Math.max(boxRight, b.g.x + b.g.w);
          }
          let y = onLine;
          let right = Math.round(edge - OVERLAY_GAP);
          let up = onLine > main.height / 2;
          // No room on the line before the boxes (a narrow pane): over the box, right-aligned with it, else under it;
          // its message then opens away from the box. 16 px of room more before it goes back on the line.
          const stacked = overlayStacked.current.get(o.key) ? right - w < 8 + 16 : right - w < 8;
          overlayStacked.current.set(o.key, stacked);
          if (stacked) {
            // 8 px from the pane's edges at least (a bar wider than the box overhangs it on the right).
            right = Math.round(Math.max(Math.min(boxRight, plot - 8), w + 8));
            // Over the box, else under it: the first place that fits in the pane and covers no other box (its own
            // excepted), else the one that covers the least.
            const others = drawn.filter((b) => !b.item.id.startsWith(`${o.key}|`));
            const overlap = (cy: number) =>
              others.reduce((sum, b) => {
                const dy = Math.min(cy + h / 2, b.y + LABEL_HEIGHT / 2) - Math.max(cy - h / 2, b.y - LABEL_HEIGHT / 2);
                const dx = Math.min(right, b.g.x + b.g.w) - Math.max(right - w, b.g.x);
                return sum + (dy > 0 && dx > 0 ? dy * dx : 0);
              }, 0);
            const fits = (cy: number) => cy - h / 2 >= 2 && cy + h / 2 <= main.height - 2;
            const candidates = [raw - LABEL_HEIGHT / 2 - 4 - h / 2, raw + LABEL_HEIGHT / 2 + 4 + h / 2].filter(fits);
            const best = candidates.find((cy) => overlap(cy) === 0) ?? [...candidates].sort((a, b) => overlap(a) - overlap(b))[0];
            y = best ?? Math.min(Math.max(raw, h / 2 + 2), main.height - h / 2 - 2);
            // Its message opens away from the box.
            up = y < raw;
          }
          next[o.key] = { top: Math.round(main.top + y), right, up, room: right - 8, span: plot - 16, from: 8 - (right - w) };
        }
      }
      for (const k of overlayStacked.current.keys()) if (!next[k] && !(overlaysRef.current ?? []).some((o) => o.key === k)) overlayStacked.current.delete(k);
      setOverlayPos((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [overlaysKey, chartApi]);

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
  // FD-CHARTSETTINGS: buttons shown with the mouse over the chart (always without a mouse), always, or never.
  const shown = (v: ChartStyle['canvas']['navigation']) => (v === 'hover' ? hovered || coarse : v === 'always');
  const showLatest = behind && main !== undefined && boxes.plotWidth > 0 && shown(look.canvas.navigation);
  const latestTop = main ? Math.max(main.top + 4, main.top + main.height - LATEST_SIZE - 10) : 0;
  const st = look.status;
  // The time axis' row, under the panes: the ⚙ sits there, under the price scale (as in TradingView).
  const panesBottom = Math.max(0, ...Object.values(boxes.panes).map((b) => b.top + b.height));
  return (
    // FD-CHARTTOUCH: `touch-none` on the whole chart, its overlays too (legends, A / L, », +): no browser gesture (page
    // zoom, double-tap zoom) starts here; taps on the overlays' buttons still work.
    // FD-CHARTSETTINGS: the legends read the status line's settings from data-* (titles, inputs, values, plate, buttons).
    <div
      className={clsx('relative w-full touch-none', className ?? (style?.height === undefined && 'h-[560px]'))}
      // The chart's background for what sits on it (the legends' plates, the A / L strip, the boxes beside the lines).
      style={{ ...style, ['--legend-bg' as string]: `${st.indicatorBackground ? st.backgroundOpacity : 0}%`, ['--color-chart' as string]: bg.top }}
      data-pane-buttons={shown(look.canvas.paneButtons) ? 'shown' : 'hidden'}
      data-legend-titles={st.indicatorTitles ? 'on' : 'off'}
      data-legend-inputs={st.indicatorInputs ? 'on' : 'off'}
      data-legend-values={st.indicatorValues ? 'on' : 'off'}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
      onContextMenu={(e) => {
        // FD-CHARTSETTINGS: the chart's own menu on the panes; nothing (not the browser's) on its scales and buttons.
        const t = e.target as HTMLElement;
        if (t.closest('input, select, textarea')) return;
        e.preventDefault();
        // A finger held down (Android sends it as a contextmenu) is the touch cursor's, not the menu's: on a touch screen
        // the settings open from ⚙.
        const kind = (e.nativeEvent as PointerEvent).pointerType;
        if (kind === 'touch' || kind === 'pen') return;
        const r = host.current?.getBoundingClientRect();
        if (!r || !onContextMenu || t.closest('button, a') || e.clientX - r.left > boxes.plotWidth) return;
        const y = e.clientY - r.top;
        if (y > panesBottom) return;
        const m = boxes.panes.main;
        const price = m && y >= m.top && y <= m.top + m.height ? (seriesRef.current?.candle.coordinateToPrice(y - m.top) ?? null) : null;
        onContextMenu({ x: e.clientX, y: e.clientY, price });
      }}
    >
      {/* `isolate`: the chart's canvases (z-index 1–2) and pane separators (49–50) stay below the overlays and the page. */}
      {/* FD-CHARTTV §5: a cross on the chart (the library leaves the panes' cursor to its host; the scales keep theirs). */}
      <div ref={host} className="absolute inset-0 isolate cursor-crosshair" aria-label="Grafic lumânări" role="img" />
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
          // FD-CHARTTV §5: 34 px further left than before, clear of the "+" at the cursor's price.
          style={{ top: latestTop, left: boxes.plotWidth - LATEST_SIZE - 44, width: LATEST_SIZE, height: LATEST_SIZE }}
        >
          <ChevronsRight size={18} aria-hidden />
        </button>
      )}
      {boxes.plotWidth > 0 && <Legends chart={chartApi} count={candles.length} boxes={boxes} legends={legends} place={place} />}
      {main && boxes.plotWidth > 0 && (
        // FD-CHARTTV §4, FD-CHARTPOLISH §3: "A" (the candles fit the height) and "L" (logarithmic), at the bottom of the
        // price scale (the candles' pane, not under the panes below it), on the chart's background over the prices there.
        <div
          className="absolute z-10 flex items-center justify-center gap-1 bg-chart"
          style={{
            left: boxes.plotWidth + 1,
            right: 0,
            top: main.top + main.height - SCALE_BOX,
            height: SCALE_BOX,
            // A gradient background: the strip is the gradient's last part, as the scale under it.
            ...(bg.top !== bg.bottom ? { background: `linear-gradient(${mixColor(bg.top, bg.bottom, (main.height - SCALE_BOX) / main.height)}, ${bg.bottom})` } : {}),
          }}
        >
          <button type="button" aria-pressed={auto} aria-label="Automat: lumânările vizibile încap pe înălțime" title="Automat: lumânările vizibile încap pe înălțime" onClick={fitPrices} className={clsx(SCALE_BTN, auto ? SCALE_ON : SCALE_OFF)}>
            A
          </button>
          <button
            type="button"
            aria-pressed={logScale}
            aria-label="Scală logaritmică"
            title="Scală logaritmică"
            disabled={!onLogScale}
            onClick={() => onLogScale?.(!logScale)}
            className={clsx(SCALE_BTN, logScale ? SCALE_ON : SCALE_OFF)}
          >
            L
          </button>
        </div>
      )}
      {/* FD-ORDEREDIT: Confirm / Discard on a trade's line, right before its title; kept inside the pane when the line is
          above or below it. Hidden until placed (its width is measured first). */}
      {main &&
        boxes.plotWidth > 0 &&
        lineOverlays?.map((o) => {
          const p = overlayPos[o.key];
          return (
            <div
              key={o.key}
              ref={(el) => {
                if (el) overlayEls.current.set(o.key, el);
                else overlayEls.current.delete(o.key);
              }}
              data-open={p?.up ? 'up' : 'down'}
              data-msg={p && p.room >= OVERLAY_MSG_MIN ? 'right' : 'left'}
              className="absolute z-20 -translate-x-full -translate-y-1/2"
              style={
                p
                  ? // Its boxes on the chart's background where they are (a gradient's colour at that height).
                    ({ top: p.top, left: p.right, '--overlay-room': `${p.room}px`, '--overlay-span': `${p.span}px`, '--overlay-from': `${p.from}px`, '--color-chart': mixColor(bg.top, bg.bottom, (p.top - main.top) / main.height) } as CSSProperties)
                  : { top: 0, left: 0, visibility: 'hidden' }
              }
            >
              {o.node}
            </div>
          );
        })}
      {onSettings && boxes.plotWidth > 0 && panesBottom > 0 && (
        // FD-CHARTSETTINGS: the chart's settings, under the price scale, in the time axis' row (as in TradingView).
        <div className="absolute z-10 flex items-center justify-center" style={{ left: boxes.plotWidth + 1, right: 0, top: panesBottom, bottom: 0 }}>
          <button type="button" onClick={onSettings} aria-label="Setările graficului" title="Setările graficului" className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text">
            <Settings size={14} aria-hidden />
          </button>
        </div>
      )}
      {onAddHLine && main && boxes.plotWidth > 0 && (
        <HLinePlus chart={chartApi} series={seriesRef.current?.candle ?? null} main={main} plotWidth={boxes.plotWidth} precision={precision} blocked={hlineBlocked} onAdd={onAddHLine} cursor={plusCursor} />
      )}
    </div>
  );
}
