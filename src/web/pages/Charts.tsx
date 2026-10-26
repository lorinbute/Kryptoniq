import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IndicatorResult } from 'oakscriptjs';
import { clsx } from 'clsx';
import type { ZodType } from 'zod';
import { ArrowDownUp, ArrowRightLeft, Bell, Bot, ListChecks, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, RotateCcw, Settings as Cog, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { AccountView, CandlesResult, Portfolio, StockQuoteRow } from '../../shared/api-types.ts';
import { DEFAULT_SLINGSHOT_PARAMS, SIGNAL_SIZE_NAMES, SLINGSHOT_SHORT_TITLE, SLINGSHOT_TITLE, SLINGSHOT_VERSION, slingshotParamsSchema, type SlingshotParams } from '../../shared/indicator/params.ts';
import {
  DEFAULT_LMA_PARAMS,
  effectiveLmaParams,
  LMA_MA_TYPES,
  LMA_PRESET_VALUES,
  LMA_PRESETS,
  LMA_SHORT_TITLE,
  LMA_TITLE,
  LMA_TOOLTIPS,
  lmaParamsSchema,
  type LmaParams,
} from '../../shared/indicator/lma-params.ts';
import { rgbaCss, runLma } from '../../shared/indicator/lma.ts';
import { htfCandleCount, runSlingshot, type SlingshotAlert, type SlingshotSignal } from '../../shared/indicator/slingshot.ts';
import { TIMEFRAMES, tfSeconds, type Timeframe } from '../../shared/time.ts';
import type { ModifyStepPlan } from '../../shared/trading.ts';
import { CHART_SYMBOL_RE, type Settings, type SettingsView } from '../../shared/settings.ts';
import { STUDY_MAX, type FavoriteId, type Study, type StudyId, type StudyMemoryEntry } from '../../shared/studies.ts';
import { DEFAULT_CHART_STYLE, type ChartLineStyle, type ChartStyle } from '../../shared/chart-style.ts';
import { api, errorMessage, qs } from '../api.ts';
import { CandleChart, DEFAULT_PANE_FACTOR, type PriceLineSpec, type StudyDraw } from '../chart/CandleChart.tsx';
import { lmaHlines, lmaScriptLineColors } from '../chart/lma-lines.ts';
import { modalOpen, useFullscreen } from '../chart/fullscreen.ts';
import { useTradeEndSound } from '../chart/useTradeEndSound.ts';
import { clampWidth, readPrefs, WATCHLIST_DEFAULT, WATCHLIST_MAX, WATCHLIST_MIN, writePrefs, type WatchlistPrefs } from '../chart/watchlist-prefs.ts';
import { ListDrawer, Watchlist } from '../components/Watchlist.tsx';
import { OfflineBanner } from '../components/OfflineBanner.tsx';
import { useMediaQuery } from '../media.ts';
import { PNL_COLORS, PNL_COLORS_LIGHT, tradeLinesOf } from '../chart/pnl.ts';
import { anchorOf, draftGroups, draftTicket, isDraggable, lineActionOf, lineCloses, liveDrafts, sentLevels, withDrafts, withSent, type AccountLine, type Drafts, type SentLevel } from '../chart/trade-drafts.ts';
import { chartLineOf, labelText, lineColor, TRADE_COLORS, TRADE_COLORS_LIGHT } from '../chart/trade-labels.ts';
import { LineActionDialog, type LineAction } from '../components/LineActionDialog.tsx';
import { entryBasisOf, stepImpact } from '../components/modify-seeds.ts';
import { BOX, TradeDraftBar } from '../components/TradeDraftBar.tsx';
import { canReverse, ReverseDialog } from '../components/ReverseDialog.tsx';
import { useTheme } from '../theme.ts';
import { saveSettingsPatch, type SettingsPatch } from '../chart/prefs.ts';
import { premiumState } from '../chart/premium.ts';
import { countRo, fmtAgo, fmtDateTime, fmtPct, fmtPrice } from '../format.ts';
import { chartPrecision, chartTimeZone, prevDayCloses } from '../chart/chart-look.ts';
import { ChartMenu, type ChartMenuItem } from '../components/ChartMenu.tsx';
import { ChartSettingsDialog } from '../components/ChartSettingsDialog.tsx';
import { ChartStatusLine, statusLineOn } from '../components/ChartStatusLine.tsx';
import { isMac } from '../components/CommandPalette.tsx';
import { chartPathOf, nearestTimeframe, rememberedPath } from '../chart/paths.ts';
import { INDEX_DELAY_NOTE, INDEX_TIMEFRAMES, INDICES, indexById, indexId, plainSymbol } from '../../shared/indices.ts';
import { useMarketSource, useSettings, useStocksInfo, useTz, useWatchlist } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Toast, Warning, type ToastMessage } from '../components/ui.tsx';
import { OrderTicket, useTradingCaps, type TicketSeed } from '../components/OrderTicket.tsx';
import { BotsDialog } from '../components/bots/BotsDialog.tsx';
import { portfolioInterval } from '../portfolio-settle.ts';
import type { BotSeed } from '../components/bots/bot-form.ts';
import { IndicatorPicker, PremiumBadge, type PremiumItem, type PremiumKey } from '../components/IndicatorPicker.tsx';
import { StudySettings } from '../components/StudySettings.tsx';
import { LEGEND_INPUTS, LEGEND_TITLE, LEGEND_VALUES, LegendButtons, LegendRow, StudyLegendRow } from '../components/StudyLegend.tsx';
import { studyMeta } from '../indicators/catalog-meta.ts';
import { legendParams, sanitizeInputs, type ChartInfo } from '../indicators/compute.ts';
import { useStudyRuntime, type StudyRuntime } from '../indicators/runtime.ts';
import { legendNumbers, styledEntry } from '../indicators/style.ts';
import { linkStyle } from '../indicators/color-links.ts';
import { useStudies } from '../indicators/useStudies.ts';
import { fromMemory, memoryOf, rememberStudy } from '../indicators/memory.ts';
import { ColorPicker } from '../components/ColorPicker.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { AlertIcon, CoinLogo, OutcomeIcon } from '../components/icons.tsx';
import { useScrollLock } from '../scroll-lock.ts';
import { useVisibleArea } from '../visible-area.ts';
import { HLineSettings } from '../components/HLineSettings.tsx';
import { HLINE_DEFAULT_STYLE, HLINE_MAX, hlineVisibleOn, styleOf, type HLine, type HLineStyle } from '../../shared/hlines.ts';

const ALERT_RO: Record<string, string> = {
  longSignal: 'Long Signal',
  takeProfitSignal: 'Take Profit Signal',
  atrTakeProfit: 'ATR Take Profit Hit',
  atrStopLoss: 'ATR Stop Loss Hit',
  msBullish: 'Bullish Market Structure',
  msBearish: 'Bearish Market Structure',
  shortSignal: 'Short Signal',
  shortTakeProfitSignal: 'Short Take Profit Signal',
  shortAtrTakeProfit: 'Short ATR Take Profit Hit',
  shortAtrStopLoss: 'Short ATR Stop Loss Hit',
};
const OUTCOME_RO: Record<string, string> = { active: 'Activ', tp: 'TP atins', sl: 'SL atins', invalidated: 'Invalidat' };
const EXCHANGE_NAME: Record<string, string> = { kucoin: 'KuCoin', binance: 'Binance', bybit: 'Bybit', okx: 'OKX', bitget: 'Bitget', twelvedata: 'Twelve Data', nasdaq: 'Nasdaq', cboe: 'Cboe', cnbc: 'CNBC' };
const MARKET_RO: Record<string, string> = { open: 'bursa e deschisă', pre: 'pre-market', after: 'after-hours', closed: 'bursa e închisă' };
const REASON_RO: Record<string, string> = {
  takeProfitSignal: 'maximul depășit',
  atrTakeProfit: 'ținta ATR',
  stopLoss: 'stop loss',
  superseded: 'înlocuit de un semnal nou',
  trendFlip: 'trendul s-a întors',
};
/** Why a signal closed; a SHORT's take profit signal is a low broken (FD-SLINGSHOT34). */
const reasonRo = (s: SlingshotSignal) => (s.side === 'short' && s.outcomeReason === 'takeProfitSignal' ? 'minimul depășit' : s.outcomeReason ? REASON_RO[s.outcomeReason] : '');

/** Collapses consecutive repeats of the same alert (e.g. ATR TP on every bar above the target). */
export function collapseAlerts(alerts: SlingshotAlert[]): (SlingshotAlert & { count: number })[] {
  const out: (SlingshotAlert & { count: number })[] = [];
  for (const a of alerts) {
    const prev = out.at(-1);
    if (prev && prev.type === a.type && a.bar - (prev.bar + prev.count - 1) === 1) prev.count++;
    else out.push({ ...a, count: 1 });
  }
  return out;
}

/** The last non-null value seen (FD-CHARTSTEADY §1). */
function useLatched(value: string | null): string | null {
  const [kept, setKept] = useState(value);
  useEffect(() => {
    if (value !== null) setKept(value);
  }, [value]);
  return value ?? kept;
}

/**
 * A header value while a new symbol loads (FD-CHARTSTEADY §1): a grey dash over the previous symbol's text, kept
 * invisible so it holds the same width and the header does not change its lines twice.
 */
function Holding({ ghost, dash, start = false }: { ghost: string | null; dash: string; start?: boolean }) {
  if (!ghost) return <>{dash}</>;
  return (
    <span className="relative inline-flex">
      <span className="invisible">{ghost}</span>
      <span className={clsx('absolute inset-0 flex items-center', start ? 'justify-start' : 'justify-center')}>{dash}</span>
    </span>
  );
}

type FieldDef<P> = {
  key: keyof P & string;
  label: string;
  /** The Pine tooltip, shown behind an (i). */
  tip?: string;
  /** Consecutive fields with the same value share a row (Pine `inline`). */
  inline?: string;
} & (
  | { kind: 'int' | 'float'; step?: number; min?: number; max?: number }
  /** `lockedWhen`: why the box cannot change now (it is then disabled), e.g. the last side left on. */
  | { kind: 'bool'; lockedWhen?: (draft: P) => string | null }
  | { kind: 'color' }
  | { kind: 'text' }
  | { kind: 'select'; options: { value: string; label: string }[] }
  /**
   * FD-STYLEUNIFY: an element's look on one row, the same everywhere: a box to tick (`toggle`), the line box (its `color`,
   * else `swatch`, a colour that comes from elsewhere, explained by `note`; `scriptColor` when the saved colour is null:
   * the script's own), its `width` and `style`, its `size`, and a level shown after it (`value`).
   */
  | {
      kind: 'look';
      toggle?: keyof P & string;
      color?: keyof P & string;
      scriptColor?: (draft: P) => string;
      swatch?: (draft: P) => string;
      note?: string;
      width?: keyof P & string;
      style?: keyof P & string;
      size?: keyof P & string;
      value?: (draft: P) => number;
    }
);

/** The keys a field edits (an error on any of them names the field). */
const fieldKeys = <P,>(f: FieldDef<P>): string[] => (f.kind === 'look' ? [f.key, f.toggle, f.color, f.width, f.style, f.size].filter((k): k is keyof P & string => Boolean(k)) : [f.key]);
/** Pine's line style names <-> the line box's. */
const PINE_STYLE: Record<ChartLineStyle, string> = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };
const boxStyle = (v: unknown): ChartLineStyle => (v === 'Dashed' ? 'dashed' : v === 'Dotted' ? 'dotted' : 'solid');
interface GroupDef<P> {
  title: string;
  fields: FieldDef<P>[];
}

const ONE_SIDE_TIP = 'Cel puțin unul dintre Long Signals și Short Signals rămâne bifat.';
/** FD-STYLEUNIFY: each state of a side's labels, with the Pine input's title and tooltip. */
const signalLooks = (side: 'long' | 'short'): FieldDef<SlingshotParams>[] => {
  const S = side === 'long' ? 'Long' : 'Short';
  const row = (state: string, label: string, tip?: string): FieldDef<SlingshotParams> => ({
    key: `${side}${state}Color` as keyof SlingshotParams & string,
    label,
    kind: 'look',
    color: `${side}${state}Color` as keyof SlingshotParams & string,
    size: `${side}${state}Size` as keyof SlingshotParams & string,
    ...(tip ? { tip } : {}),
  });
  return [
    row('Forming', `${S} Forming Signal`, `A ${S.toUpperCase()} still forming (before its confirmation).`),
    row('', `${S} Signal`, `A valid ${S.toUpperCase()}: active, or ended with its take profit.`),
    row('Failed', `${S} Failed Signal`, `A ${S.toUpperCase()} that hit its stop loss.`),
    row('Invalid', `${S} Invalidated Signal`, `A ${S.toUpperCase()} replaced by a newer one (an X while the newer one is forming, for good once it is confirmed) or ended by a trend flip.`),
    row('Tp', `${S} Take Profit`, `The TAKE PROFIT label of a ${S.toUpperCase()}.`),
    row('Sl', `${S} Stop Loss`, `The STOP LOSS label on the bar where a ${S.toUpperCase()} failed.`),
  ];
};
/** FD-STYLEUNIFY: a side's take profit / stop loss level: its line and its label's size. */
const atrLook = (side: 'long' | 'short', level: 'Tp' | 'Sl'): FieldDef<SlingshotParams> => {
  const color = `${side}${level === 'Tp' ? 'TP' : 'SL'}Color` as keyof SlingshotParams & string;
  return {
    key: color,
    label: `${side === 'long' ? 'Long' : 'Short'} ATR ${level === 'Tp' ? 'Take Profit' : 'Stop Loss'}`,
    kind: 'look',
    color,
    width: `${side}${level}LineWidth` as keyof SlingshotParams & string,
    style: `${side}${level}LineStyle` as keyof SlingshotParams & string,
    size: `${side}${level}LabelSize` as keyof SlingshotParams & string,
  };
};
const CLOUD_NOTE = 'Culoarea vine din Cloud Uptrend Color / Cloud Downtrend Color, după trend.';
const cloudSwatch = (d: SlingshotParams) => `linear-gradient(135deg, ${d.cloudUpColor} 50%, ${d.cloudDownColor} 50%)`;
const SLINGSHOT_GROUPS: GroupDef<SlingshotParams>[] = [
  {
    // FD-SLINGSHOT34: the sides; the last one ticked cannot be unticked. FD-STYLEUNIFY: each state, each side.
    title: 'Signals',
    fields: [
      { key: 'showLong', label: 'Long Signals', kind: 'bool', tip: ONE_SIDE_TIP, lockedWhen: (d) => (d.showShort ? null : ONE_SIDE_TIP) },
      { key: 'showShort', label: 'Short Signals', kind: 'bool', tip: ONE_SIDE_TIP, lockedWhen: (d) => (d.showLong ? null : ONE_SIDE_TIP) },
      ...signalLooks('long'),
      ...signalLooks('short'),
    ],
  },
  {
    title: 'Indicator Settings',
    fields: [
      { key: 'lenFastEma', label: 'Fast EMA Period', kind: 'int' },
      { key: 'lenSlowEma', label: 'Slow EMA Period', kind: 'int' },
      { key: 'lenRsi', label: 'RSI Period for Stoch', kind: 'int' },
      { key: 'lenStoch', label: 'Stochastic (K) Period', kind: 'int' },
      { key: 'smoothK', label: 'K Line Smoothing', kind: 'int' },
      { key: 'stochOversold', label: 'Stoch Oversold Level', kind: 'int' },
      { key: 'stochOverbought', label: 'Stoch Overbought Level', kind: 'int' },
      { key: 'touchTolPct', label: 'Cloud touch tolerance (%)', kind: 'float', step: 0.05 },
      { key: 'kTol', label: 'K tolerance at 20/80', kind: 'float', step: 0.1 },
    ],
  },
  {
    title: 'ATR Settings',
    fields: [
      { key: 'atrLength', label: 'ATR Length', kind: 'int' },
      { key: 'takeProfitMultiplier', label: 'Take Profit ATR Multiplier', kind: 'float', step: 0.1 },
      { key: 'stopLossMultiplier', label: 'Stop Loss ATR Multiplier', kind: 'float', step: 0.1 },
      { key: 'lookback', label: 'Lookback Period', kind: 'int' },
      { key: 'atrLineLengthTP', label: 'ATR TP Line Length', kind: 'int' },
      { key: 'atrLineLengthSL', label: 'ATR SL Line Length', kind: 'int' },
      { key: 'showLabels', label: 'Show ATR Labels', kind: 'bool' },
      { key: 'showLines', label: 'Show ATR Levels', kind: 'bool' },
      { key: 'hideAtrOnTP', label: 'Hide ATR Levels and Labels on Take Profit Hit', kind: 'bool' },
      { key: 'hideAtrOnStop', label: 'Hide ATR Levels and Labels on Stop Loss Hit', kind: 'bool' },
      atrLook('long', 'Tp'),
      atrLook('long', 'Sl'),
      atrLook('short', 'Tp'),
      atrLook('short', 'Sl'),
    ],
  },
  {
    // FD-SS34LIVE: the EMAs in the trend's colour, the cloud at half its opacity; FD-STYLEUNIFY: the EMAs' width and style
    // (TradingView's Style tab).
    title: 'Cloud',
    fields: [
      { key: 'cloudUpColor', label: 'Cloud Uptrend Color', kind: 'color', tip: 'The EMAs in an uptrend; the cloud gets it at half its opacity.' },
      { key: 'cloudDownColor', label: 'Cloud Downtrend Color', kind: 'color', tip: 'The EMAs in a downtrend; the cloud gets it at half its opacity.' },
      { key: 'slowEmaWidth', label: 'Slow EMA', kind: 'look', swatch: cloudSwatch, note: CLOUD_NOTE, width: 'slowEmaWidth', style: 'slowEmaStyle' },
      { key: 'fastEmaWidth', label: 'Fast EMA', kind: 'look', swatch: cloudSwatch, note: CLOUD_NOTE, width: 'fastEmaWidth', style: 'fastEmaStyle' },
    ],
  },
  {
    title: 'Market Structure',
    fields: [
      { key: 'showMS', label: 'Show Market Structure Levels', kind: 'bool' },
      { key: 'msTf', label: 'Market Structure Timeframe', kind: 'select', options: [{ value: '', label: 'Chart' }, ...TIMEFRAMES.map((t) => ({ value: t, label: t }))] },
      { key: 'msSwing', label: 'Swing Strength (bars left/right)', kind: 'int' },
      { key: 'msLineLength', label: 'MS Line Min Length (bars)', kind: 'int' },
      { key: 'msRightExtend', label: 'MS Line Right Extension (bars)', kind: 'int' },
      { key: 'msBreakOnClose', label: 'Confirm Break With Candle Close', kind: 'bool' },
      { key: 'msBullText', label: 'Bullish Line Text', kind: 'text' },
      { key: 'msBearText', label: 'Bearish Line Text', kind: 'text' },
      // FD-STYLEUNIFY: each line its colour, width, style and text size
      { key: 'msBullColor', label: 'Bullish MS Line', kind: 'look', color: 'msBullColor', width: 'msBullLineWidth', style: 'msBullLineStyle', size: 'msBullTextSize' },
      { key: 'msBearColor', label: 'Bearish MS Line', kind: 'look', color: 'msBearColor', width: 'msBearLineWidth', style: 'msBearLineStyle', size: 'msBearTextSize' },
    ],
  },
];

// Names, groups, limits and tooltips from logarithmic-moving-average.pine; "Style" mirrors TradingView's Style tab.
/** FD-STYLEUNIFY: a threshold line: its colour (the script's until one is chosen), width, style and level. */
const lmaLine = (key: 'long' | 'short' | 'neutral', label: string): FieldDef<LmaParams> => ({
  key: `${key}LineColor`,
  label,
  kind: 'look',
  toggle: `show${key === 'long' ? 'Long' : key === 'short' ? 'Short' : 'Neutral'}Line`,
  color: `${key}LineColor`,
  scriptColor: (d) => lmaScriptLineColors(effectiveLmaParams(d))[key],
  width: `${key}LineWidth`,
  style: `${key}LineStyle`,
  value: (d) => (lmaHlines(effectiveLmaParams(d)).find((x) => x.key === key) as ReturnType<typeof lmaHlines>[number]).price,
});
const lmaSwatch = (d: LmaParams) => `linear-gradient(135deg, ${d.bullishColor} 33%, ${d.neutralColor} 33% 66%, ${d.bearishColor} 66%)`;
const LMA_GROUPS: GroupDef<LmaParams>[] = [
  {
    title: 'Strategy Presets',
    fields: [{ key: 'preset', label: 'Strategy Preset', kind: 'select', options: LMA_PRESETS.map((v) => ({ value: v, label: v })), tip: LMA_TOOLTIPS.preset }],
  },
  {
    title: 'LMA Core Settings',
    fields: [
      { key: 'period', label: 'LMA Period', kind: 'int', min: 50, max: 200, tip: LMA_TOOLTIPS.period },
      { key: 'steepness', label: 'Log Steepness', kind: 'float', step: 0.1, min: 1.5, max: 5, tip: LMA_TOOLTIPS.steepness },
      { key: 'maType', label: 'Smoothing MA Type', kind: 'select', options: LMA_MA_TYPES.map((v) => ({ value: v, label: v })), tip: LMA_TOOLTIPS.maType },
      { key: 'smooth', label: 'Signal Smoothing', kind: 'int', min: 3, max: 25, tip: LMA_TOOLTIPS.smooth },
      { key: 'momentumWeight', label: 'Momentum Confirmation Weight', kind: 'float', step: 0.1, min: 1, max: 2, tip: LMA_TOOLTIPS.momentumWeight },
    ],
  },
  {
    title: 'Trading Thresholds',
    fields: [
      { key: 'longThreshold', label: 'Long Entry Threshold', kind: 'float', step: 0.1, min: 0.1, max: 2, tip: LMA_TOOLTIPS.longThreshold },
      { key: 'shortThreshold', label: 'Short Entry Threshold', kind: 'float', step: 0.1, min: -2, max: -0.1, tip: LMA_TOOLTIPS.shortThreshold },
    ],
  },
  {
    title: 'Visual Settings',
    fields: [
      { key: 'bullishColor', label: 'Bullish Color', kind: 'color', inline: 'colors' },
      { key: 'bearishColor', label: 'Bearish Color', kind: 'color', inline: 'colors' },
      { key: 'neutralColor', label: 'Neutral Color', kind: 'color', inline: 'colors' },
      { key: 'colorBars', label: 'Color Price Bars', kind: 'bool', tip: LMA_TOOLTIPS.colorBars },
    ],
  },
  {
    title: 'Style',
    fields: [
      {
        key: 'signalWidth',
        label: 'LMA Signal',
        kind: 'look',
        toggle: 'showSignal',
        swatch: lmaSwatch,
        note: 'Culoarea vine din Bullish / Neutral / Bearish Color, după starea semnalului.',
        width: 'signalWidth',
        style: 'signalStyle',
      },
      { key: 'showFill', label: 'LMA Signal Fill', kind: 'bool' },
      { key: 'showBarColors', label: 'LMA Signal Bar Colors', kind: 'bool' },
      lmaLine('long', 'Long Threshold'),
      lmaLine('short', 'Short Threshold'),
      lmaLine('neutral', 'Neutral Line'),
    ],
  },
];

/** The fields a named LMA preset forces (shown locked, with the preset's values). */
const lmaLocked = (d: LmaParams): Partial<LmaParams> | null => LMA_PRESET_VALUES[d.preset] ?? null;

/** Groups consecutive fields that share an `inline` key into one row. */
function rowsOf<F extends { inline?: string }>(fields: F[]): F[][] {
  const rows: F[][] = [];
  for (const f of fields) {
    const last = rows.at(-1);
    if (f.inline && last && last[0]?.inline === f.inline) last.push(f);
    else rows.push([f]);
  }
  return rows;
}

function IndicatorForm<P extends Record<string, unknown>>({
  settingsKey,
  params,
  defaults,
  groups,
  schema,
  locked,
}: {
  settingsKey: 'indicator' | 'lma';
  params: P;
  defaults: P;
  groups: GroupDef<P>[];
  schema: ZodType<P>;
  locked?: (draft: P) => Partial<P> | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<P>(params);
  const [invalid, setInvalid] = useState<string | null>(null);
  // Reset the form only when the saved values really change (not when the settings are merely re-read).
  const savedKey = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(params), [savedKey]);
  const save = useMutation({ mutationFn: (values: P) => saveSettingsPatch(qc, { [settingsKey]: values }, { optimistic: false }) });
  const set = (k: keyof P, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const forced = locked?.(draft) ?? null;
  const allFields = groups.flatMap((g) => g.fields);
  // The (i) shows the Pine tooltip on hover and on a click or a tap (FIX-INFOTIP); the same text stays the control's
  // description (`title`), so the field's name stays just its label.
  const tipIcon = (tip?: string) =>
    tip ? (
      // On the first line's middle, however the name wraps.
      <span className="flex h-[1lh] shrink-0 items-center">
        <InfoTip text={tip} />
      </span>
    ) : null;
  const renderField = (f: FieldDef<P>, inRow: boolean) => {
    const isForced = forced !== null && f.key in forced;
    const v = isForced ? (forced as Record<string, unknown>)[f.key] : draft[f.key];
    const id = `${settingsKey}-${f.key}`;
    if (f.kind === 'bool') {
      // Checkboxes on the left of their label, as in TradingView.
      const lockedWhy = f.lockedWhen?.(draft) ?? null;
      return (
        <div key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
          <label htmlFor={id} className="flex min-w-0 items-center gap-2.5">
            {/* A long label wraps; the box keeps its size (it shrank at 320 px). */}
            <input id={id} type="checkbox" className="shrink-0" checked={Boolean(v)} disabled={lockedWhy !== null} title={lockedWhy ?? f.tip} onChange={(e) => set(f.key, e.target.checked)} />
            <span className={lockedWhy ? 'text-faint' : 'text-muted'}>{f.label}</span>
            {tipIcon(f.tip)}
          </label>
        </div>
      );
    }
    if (f.kind === 'look') {
      // FD-STYLEUNIFY: [☐] Name ……… [colour · width · style] [size] [level]; on a phone the name wraps and the controls stay
      // on the right, the same on every row.
      const colorKey = f.color;
      const saved = colorKey ? draft[colorKey] : null;
      const color = colorKey ? String(saved ?? f.scriptColor?.(draft) ?? '#000000') : (f.swatch?.(draft) ?? '#000000');
      const level = f.value?.(draft);
      const name = (
        <>
          <span className="text-muted">{f.label}</span>
          {tipIcon(f.tip)}
        </>
      );
      return (
        <div key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
          {f.toggle ? (
            <label htmlFor={`${id}-on`} className="flex min-w-0 items-start gap-2.5">
              <span className="flex h-[1lh] shrink-0 items-center">
                <input id={`${id}-on`} type="checkbox" checked={Boolean(draft[f.toggle])} title={f.tip} onChange={(e) => set(f.toggle as keyof P, e.target.checked)} />
              </span>
              <span className="flex min-w-0 items-start gap-1.5">{name}</span>
            </label>
          ) : (
            <span className="flex min-w-0 items-start gap-1.5">{name}</span>
          )}
          <span className="flex shrink-0 items-center gap-2">
            <ColorPicker
              id={id}
              label={f.label}
              value={color}
              onChange={colorKey ? (c) => set(colorKey, c) : undefined}
              colorNote={f.note}
              lineWidth={f.width ? Number(draft[f.width]) : undefined}
              onLineWidth={f.width ? (w) => set(f.width as keyof P, w) : undefined}
              lineStyle={f.style ? boxStyle(draft[f.style]) : undefined}
              onLineStyle={f.style ? (st) => set(f.style as keyof P, PINE_STYLE[st]) : undefined}
            />
            {f.size && (
              <select aria-label={`${f.label}: mărime`} value={String(draft[f.size])} onChange={(e) => set(f.size as keyof P, e.target.value)} className="w-[88px]">
                {SIGNAL_SIZE_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            {level !== undefined && <span className="num w-10 text-right text-muted">{Number.isFinite(level) ? level : '—'}</span>}
          </span>
        </div>
      );
    }
    return (
      <label key={f.key} htmlFor={id} className={clsx('flex items-center gap-3 text-[13px]', !inRow && 'justify-between')}>
        <span className={clsx('inline-flex items-center gap-1.5', isForced ? 'text-faint' : 'text-muted')}>
          {f.label}
          {tipIcon(f.tip)}
          {isForced && <span className="text-[11.5px] text-faint">din preset</span>}
        </span>
        {f.kind === 'color' ? (
          <ColorPicker id={id} label={f.label} value={String(v)} onChange={(c) => set(f.key, c)} />
        ) : f.kind === 'select' ? (
          <select id={id} value={String(v)} title={f.tip} onChange={(e) => set(f.key, e.target.value)} className="w-40">
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : f.kind === 'text' ? (
          <input id={id} value={String(v)} maxLength={200} onChange={(e) => set(f.key, e.target.value)} className="w-40" />
        ) : (
          <input
            id={id}
            type="number"
            disabled={isForced}
            title={f.tip}
            step={f.kind === 'int' ? 1 : (f.step ?? 0.1)}
            min={f.min}
            max={f.max}
            value={Number.isFinite(v as number) ? (v as number) : ''}
            onChange={(e) => set(f.key, e.target.value === '' ? NaN : Number(e.target.value))}
            className="w-24 text-right disabled:opacity-60"
          />
        )}
      </label>
    );
  };
  return (
    <form
      noValidate
      className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const r = schema.safeParse(draft);
        if (!r.success) {
          // A rule across fields (e.g. one of Long / Short) says what is wrong in its own words.
          const rule = r.error.issues.find((i) => i.code === 'custom');
          if (rule) {
            setInvalid(rule.message);
            return;
          }
          const bad = [...new Set(r.error.issues.map((i) => String(i.path[0])))].map((k) => {
            const f = allFields.find((x) => fieldKeys(x).includes(k));
            const range = f && (f.kind === 'int' || f.kind === 'float') && f.min !== undefined && f.max !== undefined ? ` (${f.min} – ${f.max})` : '';
            return `${f?.label ?? k}${range}`;
          });
          setInvalid(`Valori invalide: ${bad.join(', ')}.`);
          return;
        }
        setInvalid(null);
        save.mutate(r.data);
      }}
    >
      <p className="mb-4 text-[12.5px] text-faint">Aceleași nume, limite și valori implicite ca în TradingView.</p>
      {groups.map((g) => (
        <fieldset key={g.title} className="mb-5">
          <legend className="mb-2.5 text-[13.5px] font-semibold text-accent">{g.title}</legend>
          <div className="flex flex-col gap-2.5">
            {rowsOf(g.fields).map((row) =>
              row.length > 1 ? (
                <div key={row[0]?.key} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {row.map((f) => renderField(f, true))}
                </div>
              ) : (
                renderField(row[0] as FieldDef<P>, false)
              ),
            )}
          </div>
        </fieldset>
      ))}
      {invalid && <div className="mb-2 text-[13px] text-bear">{invalid}</div>}
      {save.isError && <div className="mb-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
      {save.isSuccess && !save.isPending && !invalid && <div className="mb-2 text-[13px] text-bull">Setările au fost salvate.</div>}
      <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex gap-2 border-t border-line bg-panel px-5 py-4">
        <button className="btn btn-primary" disabled={save.isPending}>
          Salvează
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setInvalid(null);
            setDraft(defaults);
          }}
        >
          Valorile implicite
        </button>
      </div>
    </form>
  );
}

/** What the settings panel shows: Slingshot, the LMA, one indicator (by its uid) or one horizontal line (FD-HLINE). */
type DrawerTarget = 'slingshot' | 'lma' | `study:${string}` | `hline:${string}`;

/** FD-HLINE §4: what the panel needs for a horizontal line. */
interface HLinePanel {
  /** The line as saved; undefined once it is gone from this symbol. */
  line: HLine | undefined;
  precision: number;
  template: HLineStyle | null;
  onDraft: (d: HLine) => void;
  onSave: (next: HLine) => Promise<unknown>;
  onSaveTemplate: (style: HLineStyle) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

/** A new indicator's uid: 12 random characters [a-z0-9]. */
function newStudyUid(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => '0123456789abcdefghijklmnopqrstuvwxyz'[x % 36]).join('');
}

/** Slingshot and LMA, with the PREMIUM tag (FD-INDICATORS §1); a tab of their own, alphabetical with the rest elsewhere (FD-PICKERSORT). */
const PREMIUM: PremiumItem[] = [
  {
    key: 'slingshot',
    name: SLINGSHOT_TITLE,
    shortName: 'Slingshot',
    overlay: true,
    description: 'Norul EMA 38 / 62, semnalele LONG și TAKE PROFIT, nivelurile TP / SL din ATR și Market Structure.',
  },
  { key: 'lma', name: LMA_TITLE, shortName: 'LMA', overlay: false, description: 'Linia de semnal, pragurile long / short și starea BULLISH / BEARISH / NEUTRAL, în panoul de jos.' },
];

function SettingsDrawer({
  target,
  slingshot,
  lma,
  studies,
  runtime,
  onSaveStudy,
  resultOf,
  hline,
  onClose,
}: {
  target: DrawerTarget;
  slingshot: SlingshotParams;
  lma: LmaParams;
  studies: readonly Study[];
  runtime: StudyRuntime | null;
  onSaveStudy: (next: Study) => Promise<unknown>;
  /** An indicator's current result, for the fills its Style tab lists (FD-FILLS). */
  resultOf: (uid: string) => IndicatorResult | null;
  hline: HLinePanel;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // FD-SCROLLLOCK: the page behind the panel stays still (the chart beside it still zooms with the wheel).
  useScrollLock();
  // FD-MODALFIT: above the on-screen keyboard while it is up.
  const area = useVisibleArea();
  useEffect(() => {
    // Dialog behaviour: focus moves into the panel, Escape closes it, focus returns to the opener.
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('input, select, button[role="tab"]')?.focus());
    const onKey = (e: KeyboardEvent) => {
      // An Esc already used by something above the drawer (the ⌘K search) does not close it too.
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  const study = target.startsWith('study:') ? studies.find((x) => x.uid === target.slice(6)) : undefined;
  const meta = study ? studyMeta(study.id) : undefined;
  const isLine = target.startsWith('hline:');
  const title = isLine ? 'Linie orizontală' : target === 'slingshot' ? SLINGSHOT_TITLE : target === 'lma' ? LMA_SHORT_TITLE : (meta?.name ?? 'Indicator');
  return (
    // FD-CHARTAUDIT §2: top to bottom of the visible window (100vh is Safari's "large" screen on iOS: the buttons at the
    // bottom fell under it); the whole width on a phone.
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      className="panel fixed top-0 right-0 bottom-0 z-40 flex w-[400px] max-w-full flex-col rounded-none border-y-0 border-r-0 max-[440px]:w-full"
      style={area}
      aria-label={`Setările ${title}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="flex min-w-0 items-center gap-2 text-[16px] font-semibold">
          <span className="truncate">{title}</span>
          {(target === 'slingshot' || target === 'lma') && <PremiumBadge />}
        </h2>
        <button className="btn w-[38px] shrink-0 px-0" onClick={onClose} aria-label="Închide setările">
          <X size={16} aria-hidden />
        </button>
      </header>
      {isLine ? (
        hline.line ? (
          <HLineSettings
            key={hline.line.id}
            line={hline.line}
            precision={hline.precision}
            template={hline.template}
            onDraft={hline.onDraft}
            onSave={hline.onSave}
            onSaveTemplate={hline.onSaveTemplate}
            onDelete={() => hline.onDelete((hline.line as HLine).id)}
            onCancel={onClose}
          />
        ) : (
          <p className="px-5 py-4 text-[13.5px] text-faint">Linia nu mai e pe grafic.</p>
        )
      ) : target === 'slingshot' ? (
        <IndicatorForm key="slingshot" settingsKey="indicator" params={slingshot} defaults={DEFAULT_SLINGSHOT_PARAMS} groups={SLINGSHOT_GROUPS} schema={slingshotParamsSchema} />
      ) : target === 'lma' ? (
        <IndicatorForm key="lma" settingsKey="lma" params={lma} defaults={DEFAULT_LMA_PARAMS} groups={LMA_GROUPS} schema={lmaParamsSchema} locked={lmaLocked} />
      ) : !study || !meta ? (
        <p className="px-5 py-4 text-[13.5px] text-faint">Indicatorul nu mai e pe grafic.</p>
      ) : !runtime ? (
        <div className="px-5">
          <Loading label="Se încarcă indicatorul…" />
        </div>
      ) : (
        <StudySettings key={study.uid} name={meta.name} mod={runtime.STUDY_MODULES[study.id]} runtime={runtime} study={study} result={resultOf(study.uid)} onSave={onSaveStudy} />
      )}
    </aside>
  );
}

/**
 * `shortColor`: the chart's SHORT label colour, so a SHORT row reads like its label (FD-SLINGSHOT34). A LONG uses the
 * theme's green: the indicator's neon one would vanish on the light theme (FD-THEME §1).
 */
function SignalsTable({
  signals,
  precision,
  tz,
  shortColor,
  forming,
}: {
  signals: SlingshotSignal[];
  precision: number;
  tz: string;
  shortColor: string;
  /** FD-SS34LIVE: a new signal of that side is forming, so its active one shows as invalidated, as on the chart. */
  forming: Record<SlingshotSignal['side'], boolean>;
}) {
  if (!signals.length) return <p className="pb-4 text-[13.5px] text-faint">Niciun semnal în istoricul încărcat.</p>;
  const shown = (s: SlingshotSignal) => (s.outcome === 'active' && forming[s.side] ? 'invalidated' : s.outcome);
  const counts = signals.reduce<Record<string, number>>((a, s) => ((a[shown(s)] = (a[shown(s)] ?? 0) + 1), a), {});
  const pill = 'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px]';
  return (
    <>
      <p className="flex flex-wrap gap-2 pb-3">
        <span className={clsx(pill, 'bg-panel-2')}>
          <span className="num font-[650]">{signals.length}</span> <span className="text-muted">semnale</span>
        </span>
        <span className={clsx(pill, 'bg-bull/10 text-bull')}>
          <span className="num font-[650]">{counts.tp ?? 0}</span> TP atins
        </span>
        <span className={clsx(pill, 'bg-bear/10 text-bear')}>
          <span className="num font-[650]">{counts.sl ?? 0}</span> SL atins
        </span>
        {(counts.invalidated ?? 0) > 0 && (
          <span className={clsx(pill, 'bg-bear/10 text-bear')}>
            <span className="num font-[650]">{counts.invalidated}</span> invalidate
          </span>
        )}
        {(counts.active ?? 0) > 0 && (
          <span className={clsx(pill, 'bg-panel-2 text-text')}>
            <span className="num font-[650]">{counts.active}</span> active
          </span>
        )}
      </p>
      <div className="table-wrap max-h-[380px] overflow-auto">
        {/* A minimum width keeps rows on one line; on a phone the table scrolls sideways instead. */}
        <table className="table min-w-[680px]">
          <thead>
            <tr>
              <th>Semnal (V2)</th>
              <th className="text-right">Intrare</th>
              <th className="text-right">SL</th>
              <th className="text-right">TP (ATR)</th>
              <th>Rezultat</th>
            </tr>
          </thead>
          <tbody>
            {[...signals].reverse().map((s) => (
              <tr key={`${s.side}-${s.bar}`}>
                <td className="num">
                  <span className={clsx('mr-2 font-semibold', s.side === 'long' && 'text-bull')} style={s.side === 'short' ? { color: shortColor } : undefined}>
                    {s.side === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                  {fmtDateTime(s.time, tz)}
                  {s.provisional && <span className="ml-1 text-[11px] text-warn">neconfirmat</span>}
                </td>
                <td className="num text-right" title={s.side === 'long' ? 'Minimul V2' : 'Maximul V2'}>
                  {fmtPrice(s.entry, precision)}
                </td>
                <td className="num text-right text-bear">{fmtPrice(s.sl, precision)}</td>
                <td className="num text-right text-bull">{fmtPrice(s.tp, precision)}</td>
                <td className="whitespace-nowrap">
                  <span className={clsx('inline-flex items-center gap-1.5 font-semibold', shown(s) === 'tp' ? 'text-bull' : shown(s) === 'active' ? 'text-text' : 'text-bear')}>
                    <OutcomeIcon outcome={shown(s)} />
                    {OUTCOME_RO[shown(s)]}
                  </span>
                  {s.outcomeReason ? (
                    <span className="ml-1 text-[12px] text-faint">({reasonRo(s)})</span>
                  ) : (
                    shown(s) !== s.outcome && <span className="ml-1 text-[12px] text-faint">(semnal nou în formare)</span>
                  )}
                  {s.closedTime && <span className="ml-1 text-[12px] text-faint">{fmtDateTime(s.closedTime, tz)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The trades on this chart's asset across the accounts that can hold it (FD-PNL): entries, liquidations, SL / TP with
 * their PnL, the PnL now, the other open orders (FD-ORDEREDIT: with their attached TP / SL), each with its account.
 */
function useTradeLines(symbol: string, show: boolean, lastPrice: number | null, stock: boolean): { lines: AccountLine[]; portfolios: Map<number, Portfolio> } {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts'), staleTime: 60_000, enabled: show });
  // Only the accounts that can hold this chart's asset: brokers for a share, exchanges for a coin (their APIs have limits).
  const relevant = (accounts.data ?? []).filter((a) => (a.kind === 'stocks') === stock);
  const portfolios = useQueries({
    queries: (show ? relevant : []).map((a) => ({
      queryKey: ['portfolio', a.id],
      queryFn: () => api.get<Portfolio>(`/api/portfolio/${a.id}`),
      // FIX-SLTPDUP: every few seconds while the account settles after a trading action.
      refetchInterval: () => portfolioInterval(a.id, 60_000),
    })),
  });
  // The lines' colours follow the theme (FD-THEME §1).
  const theme = useTheme();
  return useMemo(() => {
    const byAccount = new Map<number, Portfolio>();
    if (!show) return { lines: [], portfolios: byAccount };
    const colors = theme === 'light' ? PNL_COLORS_LIGHT : PNL_COLORS;
    const [base = '', quote = 'USDT'] = stock ? [symbol, 'USD'] : symbol.split('/');
    const lines: AccountLine[] = [];
    const several = relevant.length > 1;
    for (const p of portfolios) {
      const d = p.data;
      // Stocks come from brokers, coins from exchanges: a ticker can be both (COIN), the account kind decides.
      if (!d || (d.kind === 'stocks') !== stock) continue;
      const account = accounts.data?.find((a) => a.id === d.accountId);
      if (!account) continue;
      byAccount.set(account.id, d);
      const r = tradeLinesOf({ base, quote, lastPrice, positions: d.positions, balances: d.balances, orders: d.orders, account: several ? account.label : undefined, accountId: account.id, stock }, colors);
      // FD-TRADEUI: the PnL now is in the entry's box (no line of its own).
      for (const l of r.lines) if (l.role !== 'pnl') lines.push({ ...l, account });
    }
    return { lines, portfolios: byAccount };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `relevant` derives from accounts.data
  }, [portfolios, accounts.data, symbol, show, lastPrice, stock, theme]);
}

export default function ChartsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const watchlist = useWatchlist();
  const stock = params.ticker ? params.ticker.toUpperCase() : null;
  // FD-INDICES: /charts/i/SPX; an index not in the list gets null here.
  const index = params.index ? indexId(params.index) : undefined;
  const hasPair = Boolean(stock || params.index || (params.base && params.quote));
  // `?.` on charts too: a server started before this version sends no `charts` group (FD-CHARTUX).
  const remembered = settings.data ? (settings.data.charts?.symbol ?? '') : undefined;
  // "Grafice" without a pair opens the last pair shown (FD-CHARTUX §2), else the first favourite.
  useEffect(() => {
    if (hasPair || remembered === undefined || watchlist.isPending) return;
    const first = watchlist.data?.[0];
    navigate(remembered ? rememberedPath(remembered) : first ? chartPathOf(first) : '/charts/BTC/USDT', { replace: true });
  }, [hasPair, remembered, watchlist.isPending, watchlist.data, navigate]);
  if (!hasPair) {
    return settings.isError ? <ErrorNote error={settings.error} onRetry={() => settings.refetch()} /> : <Loading label="Se deschide ultimul grafic…" />;
  }
  if (index === null) return <ErrorNote error={new Error(`Indice necunoscut: ${params.index}. Indicii disponibili: ${INDICES.map((i) => i.symbol).join(', ')}.`)} />;
  if (index) return <ChartView stock index symbol={index} />;
  return stock ? <ChartView stock symbol={stock} /> : <ChartView stock={false} symbol={`${params.base?.toUpperCase()}/${params.quote?.toUpperCase()}`} />;
}

const DEFAULT_CHART_PREFS: Settings['charts'] = { symbol: '', showPositions: true, showLma: true, showSlingshot: true, slingshotHidden: false, lmaHidden: false, lmaPane: 0.25, logScale: false, listId: null };

/**
 * `symbol`: "BTC/USDT", the ticker ("AAPL") of a stock or the id ("^SPX") of an index. `stock`: a share or an index, both
 * served by the stock data; `index`: an index (FD-INDICES: 1d and 1w only, no positions).
 */
function ChartView({ symbol, stock, index = false }: { symbol: string; stock: boolean; index?: boolean }) {
  // The Twelve Data key is each user's own (FD-TDKEYS).
  const keyWhere = 'Setări → Ale mele → Date pentru acțiuni';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tz = useTz();
  const settings = useSettings();
  const s = settings.data;
  // FD-CHARTSETTINGS: the chart's settings; while their window is open, its draft, shown on the chart at once.
  const savedLook = s?.chartStyle ?? DEFAULT_CHART_STYLE;
  const [lookOpen, setLookOpen] = useState(false);
  const [lookDraft, setLookDraft] = useState<ChartStyle | null>(null);
  const look = lookOpen && lookDraft ? lookDraft : savedLook;
  const closeLook = useCallback(() => {
    setLookOpen(false);
    setLookDraft(null);
  }, []);
  // The chart's own time zone (axis, signals, alerts), else the account's.
  const chartTz = chartTimeZone(look, tz);
  // FD-TRADESOUND: the coin sound when a trade ends, while this chart is open and seen.
  // FIX-COINSOUND2: the trades of this chart only (an index has none).
  useTradeEndSound(savedLook.alerts.tradeSound && !index, stock ? symbol : (symbol.split('/')[0] ?? symbol), stock);
  // Defaults fill in what an older server does not send yet.
  const prefs: Settings['charts'] = { ...DEFAULT_CHART_PREFS, ...s?.charts };
  // FD-PREMIUMHIDE: Slingshot and LMA off the chart, drawn, or on it but hidden with the legend's eye.
  const prem = premiumState(prefs);
  const slingshotDrawn = prem.slingshot === 'shown';
  const lmaDrawn = prem.lma === 'shown';
  const savedTf: Timeframe = s?.market.defaultTf ?? '1h';
  // A stock source has fewer timeframes (FD-SENTIQ §4.3): the closest one is shown, the saved one is kept for coins.
  const info = useStocksInfo(stock);
  // Without an answer from the server, the stock chart still opens on the timeframes that need no key.
  const stockTfs: Timeframe[] | null = index ? [...INDEX_TIMEFRAMES] : (info.data?.timeframes ?? (info.isError ? ['1d', '1w'] : null));
  // A coin's prices come from the user's exchange, or the default one when theirs lacks the pair (FD-MARKETSRC).
  const src = useMarketSource(stock ? undefined : symbol);
  const exchange = index ? 'index' : stock ? 'stock' : (src.data?.exchange ?? '');
  const exchangeName = EXCHANGE_NAME[exchange] ?? exchange;
  // An exchange has fewer timeframes too (8h on Bybit / OKX / Bitget): the same rule as for stocks. No answer: all.
  const cryptoTfs: Timeframe[] | null = src.data?.timeframes ?? (src.isError ? [...TIMEFRAMES] : null);
  const tfs = stock ? stockTfs : cryptoTfs;
  const activeTf: Timeframe = tfs ? nearestTimeframe(savedTf, tfs) : savedTf;
  const p = s?.indicator ?? DEFAULT_SLINGSHOT_PARAMS;
  const lmaParams = useMemo(() => ({ ...DEFAULT_LMA_PARAMS, ...s?.lma }), [s?.lma]);
  const limit = src.data?.candles ?? s?.marketData?.candles ?? 1500;
  const chartSec = tfSeconds(activeTf);
  const msSec = p.msTf ? tfSeconds(p.msTf) : chartSec;
  const htfAvailable = !p.msTf || (tfs?.includes(p.msTf) ?? !stock);
  const needHtf = msSec > chartSec && p.msTf !== '' && htfAvailable;
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  /** FD-HLINE §4: the line being edited, as the panel's form has it (previewed on the chart). */
  const [hlineDraft, setHlineDraft] = useState<HLine | null>(null);
  // Closing the panel (✕, Esc, "Anulează") drops the preview: the line is back as saved.
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    setHlineDraft(null);
  }, []);
  const [picker, setPicker] = useState(false);
  const closePicker = useCallback(() => setPicker(false), []);
  const frame = useRef<HTMLDivElement>(null);
  // FD-WATCHDRAWER: on a phone (under 768 px, Tailwind's `md`) the symbol list is a panel sliding in from the right,
  // closed whenever the page opens and never remembered; wider, the side panel of FD-CHARTTV.
  const wide = useMediaQuery('(min-width: 768px)');
  const [listOpen, setListOpen] = useState(false);
  const closeListDrawer = useCallback(() => setListOpen(false), []);
  useEffect(() => {
    if (wide) setListOpen(false);
  }, [wide]);
  const fs = useFullscreen(frame, { blockEsc: drawer !== null || picker || listOpen });
  // FD-CHARTTV §3: the symbol list's width and visibility, kept in this browser.
  const [list, setList] = useState(readPrefs);
  const listShown = wide ? !list.hidden : listOpen;
  const setListPrefs = useCallback((next: WatchlistPrefs) => {
    setList(next);
    writePrefs(next);
  }, []);
  const chartRow = useRef<HTMLDivElement>(null);
  // Dragging the list's left edge: its width is from the pointer to the row's right side.
  const onListEdgeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const edge = e.currentTarget;
    edge.setPointerCapture(e.pointerId);
    let width = list.width;
    const move = (ev: PointerEvent) => {
      const row = chartRow.current?.getBoundingClientRect();
      if (!row) return;
      width = clampWidth(row.right - ev.clientX - 6, row.width);
      setList((l) => ({ ...l, width }));
    };
    const up = () => {
      edge.removeEventListener('pointermove', move);
      edge.removeEventListener('pointerup', up);
      edge.removeEventListener('pointercancel', up);
      setListPrefs({ ...list, width });
    };
    edge.addEventListener('pointermove', move);
    edge.addEventListener('pointerup', up);
    edge.addEventListener('pointercancel', up);
  };
  /** Chart toggles are saved at once (optimistic) and kept on the server. */
  const remember = useCallback((patch: SettingsPatch) => void saveSettingsPatch(qc, patch).catch(() => undefined), [qc]);

  // Stocks: the server keeps candles a minute at least (Twelve Data's free plan has 8 requests a minute).
  // The coin's exchange named explicitly: the timeframes and the name shown are that exchange's.
  const source = stock ? { asset: index ? 'index' : 'stock' } : { exchange: exchange || undefined };
  const candles = useQuery({
    queryKey: ['candles', exchange, symbol, activeTf, limit],
    queryFn: () => api.get<CandlesResult>(`/api/market/candles${qs({ ...source, symbol, tf: activeTf, limit })}`),
    refetchInterval: stock ? 60_000 : chartSec <= 900 ? 10_000 : 30_000,
    enabled: settings.isSuccess && tfs !== null,
  });
  const htfLimit = htfCandleCount(limit, chartSec, msSec, p.msSwing);
  const htf = useQuery({
    queryKey: ['candles', exchange, symbol, p.msTf, htfLimit],
    queryFn: () => api.get<CandlesResult>(`/api/market/candles${qs({ ...source, symbol, tf: p.msTf, limit: htfLimit })}`),
    refetchInterval: stock ? 5 * 60_000 : 60_000,
    // After the source is known: its timeframes decide whether the higher one exists at all.
    enabled: settings.isSuccess && needHtf && tfs !== null,
  });
  const quoteQ = useQuery({
    queryKey: ['stocks', 'quotes', symbol],
    queryFn: () => api.get<StockQuoteRow[]>(`/api/stocks/quotes${qs({ symbols: symbol })}`),
    refetchInterval: 60_000,
    enabled: stock,
  });
  const stockQuote = quoteQ.data?.[0];
  const watch = useWatchlist();
  const companyName = stock ? (watch.data?.find((w) => w.kind !== 'crypto' && w.coin === symbol)?.name ?? indexById(symbol)?.name ?? stockQuote?.name ?? null) : null;

  // The pair is remembered once its chart has loaded (a mistyped address does not replace the last good pair).
  const loadedSymbol = candles.data?.symbol;
  const savedSymbol = index ? `index:${plainSymbol(symbol)}` : stock ? `stock:${symbol}` : symbol;
  useEffect(() => {
    if (!s || loadedSymbol !== symbol || s.charts?.symbol === savedSymbol || !CHART_SYMBOL_RE.test(savedSymbol)) return;
    remember({ charts: { symbol: savedSymbol } });
  }, [s, loadedSymbol, symbol, savedSymbol, remember]);

  const result = useMemo(() => {
    if (!candles.data) return null;
    return runSlingshot({
      candles: candles.data.candles,
      htfCandles: needHtf ? (htf.data?.candles ?? null) : null,
      chartTfSec: chartSec,
      msTfSec: msSec,
      params: p,
      nowMs: Date.now(),
    });
  }, [candles.data, htf.data, needHtf, chartSec, msSec, p]);
  const lma = useMemo(() => (lmaDrawn && candles.data ? runLma(candles.data.candles, lmaParams) : null), [lmaDrawn, candles.data, lmaParams]);

  // FD-INDICATORS: the other indicators, saved for every chart of the user.
  // FD-COLORUNIFY: in the linked form everywhere (drawing, legend, settings); written so at the next save of its settings.
  const studies = useMemo(() => (s?.studies ?? []).map(linkStyle), [s?.studies]);
  // FD-CHARTAUDIT §3: how many times each indicator is on the chart (the picker says "Pe grafic").
  const studiesOn = useMemo(() => {
    const n: Record<string, number> = {};
    for (const st of studies) n[st.id] = (n[st.id] ?? 0) + 1;
    return n;
  }, [studies]);
  const [studyError, setStudyError] = useState<unknown>(null);
  const studyRuntime = useStudyRuntime(studies.some((x) => x.visible) || picker || (drawer?.startsWith('study:') ?? false));
  const runtime = studyRuntime.runtime;
  const precisionNow = candles.data?.pricePrecision ?? 2;
  const chartInfo: ChartInfo | null = useMemo(
    () => (candles.data ? { kind: index ? 'index' : stock ? 'stock' : 'crypto', exchange: candles.data.exchange, symbol, tf: activeTf, precision: precisionNow } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(candles.data), candles.data?.exchange, index, stock, symbol, activeTf, precisionNow],
  );
  const readsVisible = studies.some((x) => x.visible && x.id === 'visible-average-price');
  const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);
  const studyStates = useStudies({
    runtime,
    studies,
    info: chartInfo,
    candles: candles.data?.candles ?? null,
    env: { chartLimit: limit, chartTfs: tfs, stockTfs: stock && !index ? stockTfs : null },
    visibleRange: readsVisible ? visibleRange : null,
  });
  /**
   * Saves the list (FD §4) and, with it, the memory of the last settings (FD-STUDYMEMORY): both from the latest ones in
   * the cache, so two quick clicks both count, in one patch, so neither is saved without the other.
   */
  const saveStudies = useCallback(
    (change: (list: Study[], memory: readonly StudyMemoryEntry[]) => { studies: Study[]; memory?: StudyMemoryEntry[] }, optimistic = true) => {
      const now = qc.getQueryData<SettingsView>(['settings']);
      const next = change([...(now?.studies ?? [])], now?.studyMemory ?? []);
      setStudyError(null);
      return saveSettingsPatch(qc, { studies: next.studies, ...(next.memory ? { studyMemory: next.memory } : {}) }, { optimistic }).catch((err: unknown) => {
        setStudyError(err);
        throw err;
      });
    },
    [qc],
  );
  // Added with its last settings, if it has any.
  const addStudy = useCallback(
    (id: StudyId) =>
      void saveStudies((list, memory) => ({ studies: list.length >= STUDY_MAX ? list : [...list, fromMemory(id, memory, newStudyUid())] })).catch(() => undefined),
    [saveStudies],
  );
  const patchStudy = useCallback(
    (uid: string, patch: Partial<Study>) => void saveStudies((list) => ({ studies: list.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) })).catch(() => undefined),
    [saveStudies],
  );
  // A form's save reaches the cache only with the server's answer: a removal waits for it, or it would remember the
  // settings from before the save.
  const formSave = useRef<Promise<unknown>>(Promise.resolve());
  // Removed as it was: the memory keeps its settings, the pane height dragged included.
  const removeStudy = useCallback(
    (uid: string) => {
      setDrawer((d) => (d === `study:${uid}` ? null : d));
      void formSave.current
        .then(() =>
          saveStudies((list, memory) => {
            const gone = list.find((x) => x.uid === uid);
            return { studies: list.filter((x) => x.uid !== uid), ...(gone ? { memory: rememberStudy(memory, memoryOf(gone)) } : {}) };
          }),
        )
        .catch(() => undefined);
    },
    [saveStudies],
  );
  // FD-HLINE: the horizontal lines of this symbol (from the latest cache: two quick changes both count).
  const hlinesSaved = useMemo(() => s?.chartLines?.[savedSymbol] ?? [], [s?.chartLines, savedSymbol]);
  const hlineTarget = drawer?.startsWith('hline:') ? drawer.slice(6) : null;
  const shownHlines = useMemo(
    () => hlinesSaved.map((l) => (hlineDraft && hlineTarget === l.id && hlineDraft.id === l.id ? hlineDraft : l)).filter((l) => hlineVisibleOn(l, activeTf)),
    [hlinesSaved, hlineDraft, hlineTarget, activeTf],
  );
  const linesNow = useCallback((): HLine[] => qc.getQueryData<SettingsView>(['settings'])?.chartLines?.[savedSymbol] ?? [], [qc, savedSymbol]);
  const saveHlines = useCallback((next: HLine[]) => saveSettingsPatch(qc, { chartLines: { [savedSymbol]: next } }), [qc, savedSymbol]);
  const addHLine = useCallback(
    (price: number) => {
      const now = linesNow();
      if (now.length >= HLINE_MAX) return;
      const style = qc.getQueryData<SettingsView>(['settings'])?.hlineTemplate ?? HLINE_DEFAULT_STYLE;
      void saveHlines([...now, { ...styleOf(style), id: newStudyUid(), price, text: '' }]).catch(() => undefined);
    },
    [qc, linesNow, saveHlines],
  );
  const moveHLine = useCallback(
    (id: string, price: number) => {
      // Its panel open: the previewed draft moves too, in the same render (no jump back to the draft's old price).
      setHlineDraft((d) => (d && d.id === id ? { ...d, price } : d));
      void saveHlines(linesNow().map((l) => (l.id === id ? { ...l, price } : l))).catch(() => undefined);
    },
    [linesNow, saveHlines],
  );
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  // A click on the line whose panel is open changes nothing (its draft stays previewed).
  const openHLine = useCallback((id: string) => {
    if (drawerRef.current === `hline:${id}`) return;
    setHlineDraft(null);
    setDrawer(`hline:${id}`);
  }, []);
  // The panel of a line closes when the line is no longer on this symbol (another symbol, deleted elsewhere).
  useEffect(() => {
    if (hlineTarget && s && !hlinesSaved.some((l) => l.id === hlineTarget)) closeDrawer();
  }, [hlineTarget, hlinesSaved, s, closeDrawer]);
  const hlineBlocked = hlinesSaved.length >= HLINE_MAX ? `Ai deja ${HLINE_MAX} de linii pe acest simbol: șterge una ca să adaugi alta.` : null;

  const saveStudy = useCallback(
    (next: Study) => {
      const saved = saveStudies((list, memory) => ({ studies: list.map((x) => (x.uid === next.uid ? next : x)), memory: rememberStudy(memory, memoryOf(next)) }), false);
      formSave.current = saved.catch(() => undefined);
      return saved;
    },
    [saveStudies],
  );
  // FD-STUDYUX §1: the starred indicators, from the latest list in the cache (two quick clicks both count).
  const favorites = useMemo(() => s?.studyFavorites ?? [], [s?.studyFavorites]);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const toggleFavorite = useCallback(
    (id: FavoriteId) => {
      const now = qc.getQueryData<SettingsView>(['settings'])?.studyFavorites ?? [];
      setFavoriteError(null);
      void saveSettingsPatch(qc, { studyFavorites: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] }).catch((err: unknown) => setFavoriteError(errorMessage(err)));
    },
    [qc],
  );
  // The panes below the price (FD §2): the LMA, then each shown indicator that has a pane of its own.
  const paneStudies = useMemo(() => studies.filter((x) => x.visible && studyMeta(x.id)?.overlay === false), [studies]);
  const paneOrder = useMemo(() => [...(lma ? ['lma'] : []), ...paneStudies.map((x) => x.uid)], [lma, paneStudies]);
  // FD-INDICATORS §2: 120 px more for each pane below the price. FD-CHARTAUDIT §6: from what is switched on (the LMA's
  // values come with the candles), so the panel keeps the same height while another timeframe or symbol loads.
  const chartHeight = 560 + 120 * ((lmaDrawn ? 1 : 0) + paneStudies.length);
  const paneFactors = useMemo(() => {
    const f: Record<string, number> = { lma: prefs.lmaPane / (1 - prefs.lmaPane) };
    for (const x of paneStudies) f[x.uid] = x.height ?? DEFAULT_PANE_FACTOR;
    return f;
  }, [prefs.lmaPane, paneStudies]);
  const onPaneFactors = useCallback(
    (changed: Record<string, number>) => {
      const { lma: fl, ...rest } = changed;
      if (fl !== undefined) remember({ charts: { lmaPane: Math.round(Math.min(0.7, Math.max(0.1, fl / (1 + fl))) * 1000) / 1000 } });
      if (Object.keys(rest).length) {
        void saveStudies((list) => ({ studies: list.map((x) => (rest[x.uid] !== undefined ? { ...x, height: Math.round(Math.min(3, Math.max(0.05, rest[x.uid] as number)) * 1000) / 1000 } : x)) })).catch(
          () => undefined,
        );
      }
    },
    [remember, saveStudies],
  );
  const draws = useMemo((): StudyDraw[] => {
    if (!runtime) return [];
    const out: StudyDraw[] = [];
    for (const st of studies) {
      const state = studyStates.get(st.uid);
      if (!st.visible || !state?.result) continue;
      const mod = runtime.STUDY_MODULES[st.id];
      const styled = styledEntry(mod, st, state.inputs, state.result);
      out.push({ uid: st.uid, paneKey: mod.overlay ? null : st.uid, ...styled });
    }
    return out;
  }, [runtime, studies, studyStates]);

  // Nobody holds an index: no position lines on its chart.
  const lastClose = candles.data?.candles.at(-1)?.c ?? null;
  const { lines: tradeLines, portfolios: tradePortfolios } = useTradeLines(symbol, prefs.showPositions && !index, lastClose, stock);
  // FD-ORDEREDIT: the lines dragged and not yet sent (none on another symbol); a line gone takes its draft along.
  const [drafts, setDrafts] = useState<Drafts>({});
  useEffect(() => setDrafts({}), [symbol]);
  const live = useMemo(() => liveDrafts(tradeLines, drafts), [tradeLines, drafts]);
  useEffect(() => {
    if (live !== drafts) setDrafts(live);
  }, [live, drafts]);
  // FIX-SLTPDUP: the levels just confirmed stay at their new price until the platform lists them (it does a few seconds
  // late); an old order it still lists meanwhile is hidden. Each waits at most a minute.
  const [sent, setSent] = useState<SentLevel[]>([]);
  const [sentTick, setSentTick] = useState(0);
  useEffect(() => setSent([]), [symbol]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `sentTick` re-reads the clock when a level expires
  const settled = useMemo(() => withSent(tradeLines, sent, Date.now()), [tradeLines, sent, sentTick]);
  useEffect(() => {
    if (settled.waiting.length !== sent.length) setSent(settled.waiting);
  }, [settled.waiting, sent.length]);
  useEffect(() => {
    if (!sent.length) return;
    const t = setTimeout(() => setSentTick((x) => x + 1), Math.max(0, Math.min(...sent.map((x) => x.until)) - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [sent, sentTick]);
  const shownLines = useMemo(() => withDrafts(settled.lines, live), [settled.lines, live]);
  // FD-TRADEUI: each line with its box (quantity | PnL | ×), in TradingView's colours.
  const theme = useTheme();
  const tradePalette = theme === 'light' ? TRADE_COLORS_LIGHT : TRADE_COLORS;
  const severalAccounts = new Set(tradeLines.map((l) => l.account.id)).size > 1;
  const rawLines: PriceLineSpec[] = shownLines.map((l) =>
    chartLineOf(l, {
      last: lastClose,
      drafted: live[l.id] !== undefined,
      entryDraft: l.role === 'order-sl' || l.role === 'order-tp' ? live[`${l.group}|line`] : undefined,
      several: severalAccounts,
      palette: tradePalette,
      close: lineCloses(l, tradePortfolios.get(l.account.id)),
      draggable: isDraggable(l, l.account),
    }),
  );
  const linesKey = JSON.stringify(rawLines);
  // Keep the array identity stable while the content is unchanged (avoids redrawing price lines every render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const priceLines = useMemo(() => rawLines, [linesKey]);
  // The pair's decimals (what a drag or a new line is rounded to), and the ones shown (FD-CHARTSETTINGS' precision).
  const pairPrecision = candles.data?.pricePrecision ?? 2;
  const precision = chartPrecision(look, pairPrecision);
  // FD-ORDEREDIT: a drop is a draft (back on its own level: none); the title follows the drag with the PnL there.
  const lineById = useMemo(() => new Map(tradeLines.map((l) => [l.id, l])), [tradeLines]);
  const onDragLine = useCallback(
    (id: string, price: number) => {
      const l = lineById.get(id);
      if (!l) return;
      setDrafts((d) => {
        const next = { ...d };
        if (price === l.price) delete next[id];
        else next[id] = price;
        return next;
      });
    },
    [lineById],
  );
  const dragText = useCallback(
    (id: string, price: number) => {
      const l = lineById.get(id);
      if (!l) return '';
      const { text } = labelText(l, price, lastClose, l.role === 'order-sl' || l.role === 'order-tp' ? live[`${l.group}|line`] : undefined);
      return severalAccounts ? `${text} · ${l.account.label}` : text;
    },
    [lineById, live, lastClose, severalAccounts],
  );
  // FD-TRADEUI: the × of a box: close the position (its order form), remove a SL / TP, cancel an order.
  const [lineAction, setLineAction] = useState<LineAction | null>(null);
  const closeLineAction = useCallback(() => setLineAction(null), []);
  const onLineAction = useCallback(
    (id: string) => {
      const l = lineById.get(id);
      if (!l) return;
      const act = lineActionOf(l, tradePortfolios.get(l.account.id));
      if (!act) return;
      if (act.kind === 'ticket') setTicket(act.seed);
      else setLineAction(act.action);
    },
    [lineById, tradePortfolios],
  );
  const [tradeNote, setTradeNote] = useState<ToastMessage | null>(null);
  const quietTrade = useCallback(() => setTradeNote(null), []);
  // On the entry (or order) line, before its box (TradingView): ⇅ for a futures position that can be turned, then
  // Discard / Confirm for its lines dragged and not yet sent.
  const [reverseOf, setReverseOf] = useState<{ account: AccountView; symbol: string; side: 'long' | 'short' } | null>(null);
  const closeReverse = useCallback(() => setReverseOf(null), []);
  const reversible = shownLines.filter((l) => l.role === 'entry' && l.position?.market === 'futures' && canReverse(l.account, l.position.symbol));
  const overlayGroups = [...new Set([...reversible.map((l) => l.group), ...draftGroups(tradeLines, live)])];
  const lineOverlays = overlayGroups.flatMap((group) => {
    const anchor = anchorOf(group, shownLines);
    const ticket = draftTicket(tradeLines, live, group);
    if (!anchor) return [];
    const account = anchor.account;
    const pos = anchor.role === 'entry' ? anchor.position : undefined;
    const reverse = pos && reversible.includes(anchor) ? (
      <button
        type="button"
        className={clsx(BOX, 'w-[26px] bg-chart px-0 pointer-coarse:w-8')}
        style={{ borderColor: lineColor(anchor, tradePalette), color: lineColor(anchor, tradePalette) }}
        onClick={() => setReverseOf({ account, symbol: pos.symbol, side: pos.side })}
        aria-label={`Întoarce poziția ${pos.side} ${pos.symbol.split(':')[0]}`}
        title="Întoarce poziția (închide-o și deschide-o în sens opus)"
      >
        <ArrowDownUp size={13} aria-hidden />
      </button>
    ) : null;
    if (!ticket) return reverse ? [{ key: group, price: anchor.price, clamp: false, node: reverse }] : [];
    const order = tradeLines.find((l) => l.group === group && l.order)?.order;
    const quote = (order?.symbol.split('/')[1] ?? '').split(':')[0] || (stock ? 'USD' : 'USDT');
    const impact = (st: ModifyStepPlan) =>
      stepImpact(
        st,
        anchor.role === 'entry'
          ? { kind: 'protection', basisOf: (orderId, what) => tradeLines.find((l) => l.group === group && l.role === what && l.order?.id === orderId)?.basis ?? anchor.basis ?? null }
          : { kind: 'order', basis: order ? entryBasisOf(order, quote) : null, closes: false, amount: order?.amount ?? null },
      );
    const discard = () =>
      setDrafts((d) => {
        const next = { ...d };
        for (const l of tradeLines) if (l.group === group) delete next[l.id];
        return next;
      });
    return [
      {
        key: group,
        price: anchor.price,
        node: (
          <div className="flex items-center gap-1.5">
            {reverse}
            <TradeDraftBar
              account={account}
              ticket={ticket}
              impact={impact}
              onDiscard={discard}
              onSent={(r, message) => {
                if (r) setSent((x) => [...x, ...sentLevels(tradeLines, live, group, ticket, r, Date.now())]);
                discard();
                setTradeNote({ text: message, bad: r?.status !== 'done', at: Date.now() });
              }}
            />
          </div>
        ),
      },
    ];
  });
  const hlinePanel = useMemo<HLinePanel>(
    () => ({
      line: hlinesSaved.find((l) => l.id === hlineTarget),
      precision: pairPrecision,
      template: s?.hlineTemplate ?? null,
      onDraft: setHlineDraft,
      // Optimistic, as the drags and additions: the form checks the same schema as the server, and a change made while
      // a save is on its way builds on it (a refusal brings the server's lines back).
      onSave: (next) => saveHlines(linesNow().map((l) => (l.id === next.id ? next : l))),
      onSaveTemplate: (style) => saveSettingsPatch(qc, { hlineTemplate: style }, { optimistic: false }),
      onDelete: (id) => saveHlines(linesNow().filter((l) => l.id !== id)),
    }),
    [hlinesSaved, hlineTarget, pairPrecision, s?.hlineTemplate, saveHlines, linesNow, qc],
  );
  const alerts = useMemo(() => (result ? collapseAlerts(result.alerts).reverse().slice(0, 40) : []), [result]);

  // FD-CHARTSETTINGS: the chart's menu (a right click on its panes), "Resetează vizualizarea" (⌥R / Alt+R too) and the
  // removals, each with "Anulează" in its message.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const [resetTick, setResetTick] = useState(0);
  const resetView = useCallback(() => setResetTick((t) => t + 1), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyR' || e.defaultPrevented) return;
      // Not while typing, nor under an open window.
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]') || modalOpen()) return;
      e.preventDefault();
      resetView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resetView]);
  // Another symbol: its settings window closes as with "Renunță", its menu too.
  useEffect(() => {
    closeLook();
    closeMenu();
  }, [symbol, closeLook, closeMenu]);
  const saveLook = useCallback((next: ChartStyle) => saveSettingsPatch(qc, { chartStyle: next }), [qc]);
  const indicatorCount = studies.length + (prem.slingshot !== 'off' ? 1 : 0) + (prem.lma !== 'off' ? 1 : 0);
  const removeDrawings = () => {
    const before = linesNow();
    if (!before.length) return;
    if (drawerRef.current?.startsWith('hline:')) closeDrawer();
    void saveHlines([]).catch(() => undefined);
    const text = before.length === 1 ? 'Desenul a fost șters.' : `${countRo(before.length, 'desen', 'desene')} au fost șterse.`;
    const undo = () => {
      // Back as they were, with any drawn since.
      const ids = new Set(before.map((l) => l.id));
      void saveHlines([...before, ...linesNow().filter((l) => !ids.has(l.id))].slice(0, HLINE_MAX)).catch(() => undefined);
    };
    setTradeNote({ text, at: Date.now(), action: { label: 'Anulează', run: undo } });
  };
  const removeIndicators = () => {
    const n = indicatorCount;
    if (!n) return;
    const before = { studies: qc.getQueryData<SettingsView>(['settings'])?.studies ?? studies, charts: { showSlingshot: prefs.showSlingshot, slingshotHidden: prefs.slingshotHidden, showLma: prefs.showLma, lmaHidden: prefs.lmaHidden } };
    setDrawer((d) => (d && (d === 'slingshot' || d === 'lma' || d.startsWith('study:')) ? null : d));
    // Removed as one by one would: the memory keeps each one's settings. After a form's save on its way, so the list
    // put back by "Anulează" is the one removed (with that save in it).
    void formSave.current
      .then(() =>
        saveStudies((list, memory) => {
          before.studies = list;
          return { studies: [], memory: list.reduce((m, x) => rememberStudy(m, memoryOf(x)), [...memory]) };
        }),
      )
      .catch(() => undefined);
    remember({ charts: { showSlingshot: false, slingshotHidden: false, showLma: false, lmaHidden: false } });
    const text = n === 1 ? 'Indicatorul a fost scos de pe grafic.' : `${countRo(n, 'indicator', 'indicatori')} au fost scoși de pe grafic.`;
    const undo = () => {
      const uids = new Set(before.studies.map((x) => x.uid));
      void saveStudies((list) => ({ studies: [...before.studies, ...list.filter((x) => !uids.has(x.uid))].slice(0, STUDY_MAX) })).catch(() => undefined);
      remember({ charts: before.charts });
    };
    setTradeNote({ text, at: Date.now(), action: { label: 'Anulează', run: undo } });
  };
  const menuItems: ChartMenuItem[] = [
    { id: 'reset', label: 'Resetează vizualizarea', icon: RotateCcw, shortcut: isMac() ? '⌥R' : 'Alt+R', onSelect: resetView },
    ...(hlinesSaved.length ? [{ id: 'drawings', label: `Șterge ${countRo(hlinesSaved.length, 'desen', 'desene')}`, icon: Trash2, separated: true, onSelect: removeDrawings }] : []),
    ...(indicatorCount ? [{ id: 'indicators', label: `Șterge ${countRo(indicatorCount, 'indicator', 'indicatori')}`, icon: Trash2, separated: !hlinesSaved.length, onSelect: removeIndicators }] : []),
    { id: 'settings', label: 'Setări…', icon: Cog, separated: true, onSelect: () => setLookOpen(true) },
  ];
  const last = candles.data?.candles.at(-1);
  // 24 h change from the loaded candles (only meaningful when a candle is at most a day long).
  const change24h = useMemo(() => {
    const cs = candles.data?.candles;
    const end = cs?.at(-1);
    if (stock || !cs || !end || chartSec > 86_400) return null;
    const ref = [...cs].reverse().find((c) => c.t <= end.t - 86_400_000);
    return ref ? ((end.c - ref.c) / ref.c) * 100 : null;
  }, [candles.data, chartSec, stock]);
  const [base, quote] = stock ? [symbol, null] : symbol.split('/');
  const market = stock ? info.data?.market : null;
  // FD-CHARTSTEADY §1: the header's values, and the previous symbol's, which hold their place while this one loads.
  const loadingCandles = !candles.data && !candles.isError;
  const priceText = last ? fmtPrice(last.c, precision) : null;
  const changeText = change24h !== null ? `${fmtPct(change24h)} 24h` : null;
  const sessionLabel = market?.state === 'closed' || market?.state === 'pre' || (!market && stockQuote?.status && /closed/i.test(stockQuote.status)) ? 'la închidere' : 'azi';
  const stockChangeText = stockQuote?.changePct != null ? `${fmtPct(stockQuote.changePct)} ${sessionLabel}` : null;
  const sourceText = `${candles.data ? (EXCHANGE_NAME[candles.data.exchange] ?? candles.data.exchange) : stock ? '' : exchangeName}${market ? ` · ${MARKET_RO[market.state] ?? market.label}` : ''}${index && stockQuote?.delayed ? ' · până la 15 min întârziere' : ''}`;
  const priceGhost = useLatched(priceText);
  // One slot for the change, a coin's or a share's: moving from a coin to a share keeps the coin's width while loading.
  const changeGhost = useLatched(stock ? stockChangeText : changeText);
  const sourceGhost = useLatched(candles.data ? sourceText || null : null);
  // FD-TRADING §5: "Tranzacționează" with an account of the chart's kind where trading is on (never for an index).
  const tradingCaps = useTradingCaps(!index);
  const canTrade = !index && (tradingCaps.data?.accounts ?? []).some((a) => a.enabled && a.markets.length > 0 && (a.kind === 'stocks') === stock);
  const [ticket, setTicket] = useState<TicketSeed | null>(null);
  const closeTicket = useCallback(() => setTicket(null), []);
  // FD-BOT §1: the bots' window, from the chart's symbol, timeframe, price and the range of its last 100 candles.
  const [botSeed, setBotSeed] = useState<BotSeed | null>(null);
  const closeBots = useCallback(() => setBotSeed(null), []);
  const openBots = () => {
    const recent = candles.data?.candles.slice(-100) ?? [];
    setBotSeed({
      kind: stock ? 'stocks' : 'crypto',
      symbol: stock ? (base ?? symbol) : symbol,
      tf: activeTf,
      price: last?.c ?? null,
      low: recent.length ? Math.min(...recent.map((c) => c.l)) : null,
      high: recent.length ? Math.max(...recent.map((c) => c.h)) : null,
    });
  };

  // FD-CHARTFAV §1: with Slingshot off or hidden nothing of it is drawn (the panels below still use `result`).
  // FD-SLINGSHOT34: the LONG's rows, then the SHORT's; the two sides are independent and may show together.
  const tpSlRows = result ? [result.atr, result.atrShort].filter((a) => a !== null) : [];
  const tpSl =
    slingshotDrawn && tpSlRows.length > 0 ? (
      // The indicator's own table, in its Pine colours: on a dark plate in both themes, or its neon would vanish on white
      // (FD-THEME §1).
      // On phones the side's suffix needs a tighter box, or "TAKE PROFIT (SHORT)" would wrap; it never gets wider than the
      // chart (a label would be cut short first).
      <div className="absolute right-3 bottom-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-xl border border-[#262d3a] bg-[#07090e]/90 px-3 py-3 text-[11px] whitespace-nowrap backdrop-blur min-[360px]:text-[12px] sm:px-4 sm:text-[13px]">
        {tpSlRows.map((a) => {
          // FD-STYLEUNIFY: each side in its own take profit / stop loss colours.
          const tpColor = a.side === 'short' ? p.shortTPColor : p.longTPColor;
          const slColor = a.side === 'short' ? p.shortSLColor : p.longSLColor;
          return (
            <Fragment key={a.side}>
              <div className="flex justify-between gap-3 sm:gap-6">
                <span className="min-w-0 truncate" style={{ color: tpColor }}>TAKE PROFIT{a.side === 'short' ? ' (SHORT)' : ''}</span>
                <span className="num shrink-0 font-semibold" style={{ color: tpColor }}>
                  {fmtPrice(a.tp, precision)}
                </span>
              </div>
              <div className="flex justify-between gap-3 sm:gap-6">
                <span className="min-w-0 truncate" style={{ color: slColor }}>STOP LOSS{a.side === 'short' ? ' (SHORT)' : ''}</span>
                <span className="num shrink-0 font-semibold" style={{ color: slColor }}>
                  {fmtPrice(a.sl, precision)}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    ) : null;

  const lmaText = (e: LmaParams) => `${e.preset !== 'Default' && e.preset !== 'Custom' ? `${e.preset} ` : ''}${e.period} ${e.steepness} ${e.maType} ${e.smooth}`;
  const lmaButtons = (hidden: boolean) => (
    <LegendButtons
      name={LMA_SHORT_TITLE}
      hidden={hidden}
      onToggle={() => remember({ charts: { lmaHidden: !hidden } })}
      onSettings={() => setDrawer('lma')}
      onRemove={() => remember({ charts: { showLma: false, lmaHidden: false } })}
    />
  );
  const lmaLegend = (bar: number | null) => {
    if (!lma) return null;
    const i = bar ?? lma.signal.length - 1;
    const v = lma.signal[i] as number;
    const c = lma.color[i];
    const e = lma.effective;
    const col = c ? rgbaCss(c) : undefined;
    return (
      <div className="px-1.5 pt-1.5">
        <LegendRow>
          <span className={clsx('font-medium text-muted', LEGEND_TITLE)}>{LMA_SHORT_TITLE}</span>
          <span className={clsx('contents', LEGEND_INPUTS)}>
            <span className="num hidden text-faint sm:inline">{lmaText(e)}</span>
          </span>
          {/* FD-CHARTSTEADY §2: the buttons before the values, so the cursor's values never move them. */}
          {lmaButtons(false)}
          <span className={clsx('contents', LEGEND_VALUES)}>
            <span className="num font-semibold" style={{ color: col }}>
              {Number.isFinite(v) ? v.toFixed(2) : '—'}
            </span>
            {Number.isFinite(v) && (
              <span className="text-[11.5px] font-semibold" style={{ color: col }}>
                {lma.state[i]}
              </span>
            )}
          </span>
        </LegendRow>
      </div>
    );
  };

  // FD-INDICATORS §2: the legend of each indicator; the same one twice with the same inputs is numbered.
  const legendInfo = useMemo(() => {
    const items = studies.map((st) => {
      const mod = runtime?.STUDY_MODULES[st.id] ?? null;
      const inputs = studyStates.get(st.uid)?.inputs ?? (mod ? sanitizeInputs(mod, st.inputs) : st.inputs);
      return { uid: st.uid, id: st.id, params: mod ? legendParams(mod, inputs) : '', mod };
    });
    return { items: new Map(items.map((x) => [x.uid, x])), numbers: legendNumbers(items) };
  }, [studies, runtime, studyStates]);
  const studyLegend = (st: Study, bar: number | null) => {
    const li = legendInfo.items.get(st.uid);
    const cs = candles.data?.candles ?? [];
    const c = bar !== null ? cs[bar] : cs.at(-1);
    return (
      <StudyLegendRow
        key={st.uid}
        shortName={studyMeta(st.id)?.shortName ?? st.id}
        params={li?.params ?? ''}
        number={legendInfo.numbers.get(st.uid)}
        study={st}
        mod={li?.mod ?? null}
        state={studyStates.get(st.uid)}
        time={c ? Math.floor(c.t / 1000) : null}
        precision={precision}
        loading={!runtime && !studyRuntime.error}
        onToggle={() => patchStudy(st.uid, { visible: !st.visible })}
        onSettings={() => setDrawer(`study:${st.uid}`)}
        onRemove={() => removeStudy(st.uid)}
      />
    );
  };
  // FD-CHARTSETTINGS: the status line, first in the price pane: the symbol as shown in the header, its name (a share's
  // company, a coin's own name from the watchlist), where the prices come from, whether the market is open.
  const symbolLabel = base ? `${plainSymbol(base)}${quote ? `/${quote}` : ''}` : symbol;
  const coinAlias = !stock ? watch.data?.find((w) => w.kind === 'crypto' && w.coin === base)?.aliases.map((a) => a.replace(/^=/, '')).find((a) => a.toUpperCase() !== base?.toUpperCase()) : undefined;
  const instrumentName = companyName ?? coinAlias ?? null;
  const statusMarket = stock ? (market ? { open: market.state === 'open', text: MARKET_RO[market.state] ?? market.label } : null) : { open: true, text: 'piața e deschisă non-stop' };
  const statusSource = candles.data ? (EXCHANGE_NAME[candles.data.exchange] ?? candles.data.exchange) : '';
  // The change since the day before: for candles shorter than a day (a day's or a week's own change is the candle's).
  const wantDay = look.status.dayChange && chartSec < 86_400;
  const prevDay = useMemo(() => (wantDay && candles.data ? prevDayCloses(candles.data.candles, chartTz) : null), [wantDay, candles.data, chartTz]);
  const hasVolume = useMemo(() => candles.data?.candles.some((k) => k.v > 0) ?? false, [candles.data]);
  const statusOn = statusLineOn(look.status);
  const statusLine = (bar: number | null) =>
    candles.data ? (
      <ChartStatusLine
        look={look}
        logo={base ? <CoinLogo coin={base} size={16} badge={stock} square={stock} /> : null}
        symbol={symbolLabel}
        name={instrumentName}
        tf={activeTf}
        source={statusSource}
        market={statusMarket}
        candles={candles.data.candles}
        bar={bar}
        precision={precision}
        prevDay={prevDay}
        hasVolume={hasVolume}
      />
    ) : null;
  // The price pane: the status line, Slingshot, a hidden LMA, the indicators over the candles, and the hidden ones that
  // have a pane of their own.
  const mainStudies = studies.filter((st) => studyMeta(st.id)?.overlay !== false || !st.visible);
  const legends: Record<string, (bar: number | null) => React.ReactNode> = {};
  if (statusOn || prem.slingshot !== 'off' || prem.lma === 'hidden' || mainStudies.length) {
    const slingshotHidden = prem.slingshot === 'hidden';
    legends.main = (bar) => (
      <div className="flex flex-col items-start gap-0.5 px-1.5 pt-1.5">
        {statusOn && statusLine(bar)}
        {prem.slingshot !== 'off' && (
          <LegendRow dim={slingshotHidden}>
            <span className={clsx('font-medium text-muted', LEGEND_TITLE)}>{SLINGSHOT_SHORT_TITLE}</span>
            <span className={clsx('contents', LEGEND_INPUTS)}>
              <span className="num hidden text-faint sm:inline">
                {p.lenFastEma} {p.lenSlowEma}
              </span>
            </span>
            <LegendButtons
              name={SLINGSHOT_SHORT_TITLE}
              hidden={slingshotHidden}
              onToggle={() => remember({ charts: { slingshotHidden: !slingshotHidden } })}
              onSettings={() => setDrawer('slingshot')}
              onRemove={() => remember({ charts: { showSlingshot: false, slingshotHidden: false } })}
            />
          </LegendRow>
        )}
        {prem.lma === 'hidden' && (
          <LegendRow dim>
            <span className={clsx('font-medium text-muted', LEGEND_TITLE)}>{LMA_SHORT_TITLE}</span>
            <span className={clsx('contents', LEGEND_INPUTS)}>
              <span className="num hidden text-faint sm:inline">{lmaText(effectiveLmaParams(lmaParams))}</span>
            </span>
            {lmaButtons(true)}
          </LegendRow>
        )}
        {mainStudies.map((st) => studyLegend(st, bar))}
      </div>
    );
  }
  if (lma) legends.lma = lmaLegend;
  for (const st of paneStudies) legends[st.uid] = (bar) => <div className="px-1.5 pt-1.5">{studyLegend(st, bar)}</div>;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Everything inside this frame goes full screen: the chart's toolbar, the pair picker and the chart. */}
      <div ref={frame} className={clsx('flex flex-col gap-3.5', fs.active && 'fixed inset-0 z-[45] overflow-auto overscroll-contain bg-ink p-3 sm:p-4')}>
        {/* FD-CHARTAUDIT §7: the page's banner is behind the full screen. */}
        {fs.active && <OfflineBanner framed />}
        {/* FD-ORDEREDIT: what came of the lines' changes (in the frame, so it shows in full screen too). */}
        <Toast message={tradeNote} onDone={quietTrade} autoHide={look.alerts.autoHideToasts} />
        {menuAt && <ChartMenu at={menuAt} items={menuItems} onClose={closeMenu} />}
        {lookOpen && <ChartSettingsDialog saved={savedLook} pairPrecision={pairPrecision} accountTz={tz} onPreview={setLookDraft} onSave={saveLook} onClose={closeLook} />}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          {/* FD-CHARTSTEADY §1: a fixed basis, so whether the toolbar fits beside it never depends on the symbol's data. */}
          <div className="flex min-w-0 flex-[1_1_34rem] flex-wrap items-baseline gap-x-4 gap-y-1.5">
            <h1 className="inline-flex items-center gap-2.5 self-center text-[28px] leading-none font-[650] tracking-[-0.03em]">
              {base && <CoinLogo coin={base} size={28} badge={stock} square={stock} />}
              <span>
                {base && plainSymbol(base)}
                {quote && <span className="font-medium text-faint">/{quote}</span>}
              </span>
            </h1>
            {companyName && <span className="max-w-[260px] truncate self-center text-[14px] text-muted">{companyName}</span>}
            {/* FD-CHARTSTEADY §1: the price and the change keep their place, grey, while a new symbol loads. */}
            {priceText ? (
              <span className="num text-[28px] leading-none tracking-[-0.03em]" title={index && stockQuote?.delayed ? INDEX_DELAY_NOTE : undefined}>
                {priceText}
              </span>
            ) : (
              <span className="num text-[28px] leading-none tracking-[-0.03em] text-faint" aria-busy={loadingCandles} title={loadingCandles ? 'Se încarcă…' : undefined}>
                {loadingCandles ? <Holding ghost={priceGhost} dash="—" start /> : '—'}
              </span>
            )}
            {!stock && chartSec <= 86_400 && (
              <span
                className={clsx('num inline-flex h-6 items-center self-center rounded-md px-2 text-[12.5px]', change24h === null ? 'bg-panel-2 text-faint' : change24h >= 0 ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear')}
                title={changeText ? undefined : loadingCandles ? 'Se încarcă…' : 'Nu sunt lumânări de acum 24 de ore'}
              >
                {changeText ?? (loadingCandles ? <Holding ghost={changeGhost} dash="— 24h" /> : '— 24h')}
              </span>
            )}
            {stock && (
              <span
                className={clsx(
                  'num inline-flex h-6 items-center self-center rounded-md px-2 text-[12.5px]',
                  stockQuote?.changePct == null ? 'bg-panel-2 text-faint' : stockQuote.changePct >= 0 ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear',
                )}
                title={stockChangeText ? (index ? 'Variația ultimei ședințe' : 'Variația ultimei ședințe (Nasdaq)') : quoteQ.isPending ? 'Se încarcă…' : 'Variația nu e disponibilă acum'}
              >
                {/* At night, in the pre-market and on weekends it is the previous session's change. */}
                {stockChangeText ?? (quoteQ.isPending ? <Holding ghost={changeGhost} dash="—" /> : '—')}
              </span>
            )}
            {/* While loading it keeps the previous width; never empty (an empty line would shift the row's baseline).
                Centred on the row, as the 24h chip beside it (FD-ORDEREDIT §alignment). */}
            <span className="self-center text-[12.5px] leading-6 text-faint">{loadingCandles && sourceGhost && sourceGhost.length > sourceText.length ? <Holding ghost={sourceGhost} dash={sourceText || '\u00a0'} start /> : sourceText || '\u00a0'}</span>
          </div>
          {/* FD-CHARTTV §2: everything on a row as tall as its tallest; the buttons stay together (never split). */}
          {/* FD-CHARTPOLISH §2: left-aligned; it grows to its row's width (its basis is its content, so it still wraps
              as before), and only the list's button goes to the right edge, above the list. */}
          <div className="flex flex-[1_1_auto] flex-wrap items-stretch gap-2.5">
            <div className="seg" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => {
                const off = tfs !== null && !tfs.includes(t);
                const why = !off
                  ? undefined
                  : index
                    ? `Indicii nu au ${t}`
                    : !stock
                      ? `${exchangeName} nu are ${t}`
                      : info.data?.hasKey
                        ? `Twelve Data nu are ${t}`
                        : `${t} are nevoie de cheia ta Twelve Data (${keyWhere}; planul gratuit ajunge); fără ea sunt 1d și 1w`;
                return (
                  <button key={t} type="button" aria-pressed={t === activeTf} disabled={off} title={why} onClick={() => t !== activeTf && remember({ market: { defaultTf: t } })}>
                    {t}
                  </button>
                );
              })}
            </div>
            {/* FD-WATCHDRAWER: on a phone the buttons wrap (nothing leaves the screen); wider, they stay together.
                FD-CHARTPOLISH §2: on a phone the group lays nothing out itself (`contents`): its buttons and the list's
                share the rows, so the list's button sits at the end of the last one, not alone on a row of its own.
                FD-CHARTAUDIT §8: wider, the list's button is in the group, which grows to its row's width: it goes to
                the next row only with the others (it was left alone on one at 1180 px, and at 1024 in full screen). */}
            <div className="contents md:flex md:flex-[1_1_auto] md:flex-nowrap md:items-stretch md:gap-2.5">
              <label className="inline-flex items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] whitespace-nowrap text-muted">
                <input type="checkbox" checked={prefs.showPositions} onChange={(e) => remember({ charts: { showPositions: e.target.checked } })} /> Pozițiile mele
              </label>
              {canTrade && (
                <button className="btn btn-primary" onClick={() => setTicket(stock ? { kind: 'stocks', symbol: base ?? symbol, price: last?.c } : { kind: 'crypto', symbol, price: last?.c })}>
                  <ArrowRightLeft size={16} aria-hidden /> Tranzacționează
                </button>
              )}
              {!index && (
                <button className="btn" onClick={openBots}>
                  <Bot size={16} aria-hidden /> Bot
                </button>
              )}
              <button className="btn whitespace-nowrap" onClick={() => setPicker(true)}>
                <SlidersHorizontal size={16} aria-hidden /> Indicatori
              </button>
              {fs.active ? (
                <button className="btn btn-primary w-[38px] px-0 pointer-coarse:w-11" onClick={fs.exit} aria-label="Ieși din ecran complet (Esc)" title="Ieși din ecran complet (Esc)">
                  <Minimize2 size={16} aria-hidden />
                </button>
              ) : (
                <button className="btn" onClick={() => void fs.enter()} aria-label="Ecran complet" title="Ecran complet">
                  <Maximize2 size={16} aria-hidden />
                  <span className="hidden sm:inline">Ecran complet</span>
                </button>
              )}
              {/* FD-CHARTTV §3, FD-CHARTTOUCH, FD-CHARTPOLISH §2: the symbol list's button at the right edge (its panel
                  comes from the right), the rest of the row staying on the left. */}
              <button
                className="btn ml-auto w-[38px] shrink-0 px-0 pointer-coarse:w-11"
                aria-pressed={listShown}
                aria-label={listShown ? 'Ascunde lista de simboluri' : 'Arată lista de simboluri'}
                title={listShown ? 'Ascunde lista de simboluri' : 'Arată lista de simboluri'}
                onClick={() => (wide ? setListPrefs({ ...list, hidden: !list.hidden }) : setListOpen((o) => !o))}
              >
                {listShown ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
              </button>
            </div>
          </div>
        </div>
        {ticket && <OrderTicket seed={ticket} onClose={closeTicket} />}
        {botSeed && <BotsDialog seed={botSeed} onClose={closeBots} />}
        {lineAction && <LineActionDialog action={lineAction} onClose={closeLineAction} onDone={(text, bad) => setTradeNote({ text, bad, at: Date.now() })} />}
        {reverseOf && <ReverseDialog account={reverseOf.account} symbol={reverseOf.symbol} side={reverseOf.side} onClose={closeReverse} onDone={(text, bad) => setTradeNote({ text, bad, at: Date.now() })} />}
        {!stock && cryptoTfs && activeTf !== savedTf && (
          <p className="text-[12.5px] text-faint">
            {exchangeName} nu are {savedTf}; graficul arată {activeTf}.
          </p>
        )}
        {index && activeTf !== savedTf && (
          <p className="text-[12.5px] text-faint">
            Indicii nu au {savedTf}; graficul arată {activeTf}.
          </p>
        )}
        {stock && !index && stockTfs && activeTf !== savedTf && (
          <p className="text-[12.5px] text-faint">
            {info.data?.hasKey ? `Twelve Data nu are ${savedTf}; graficul arată ${activeTf}.` : `Fără cheia ta Twelve Data, acțiunile au doar 1d și 1w; graficul arată ${activeTf}.`}{' '}
            {!info.data?.hasKey && <Link to="/settings#stock-data">Adaugă cheia ta gratuită</Link>}
          </p>
        )}
        {/* About lines that are drawn only with Slingshot on and shown (FD-CHARTFAV §1, FD-PREMIUMHIDE). */}
        {slingshotDrawn && !htfAvailable && p.msTf && msSec > chartSec && (
          <Warning>
            {index ? 'Indicii nu au' : stock ? 'Sursa acțiunilor nu are' : `${exchangeName} nu are`} {p.msTf}; liniile Market Structure sunt ascunse.
          </Warning>
        )}

        {result?.warnings.includes('INSUFFICIENT_HISTORY') && <Warning>Istoric insuficient pentru încălzirea indicatorului; semnalele pot lipsi pe această pereche nouă.</Warning>}
        {slingshotDrawn && result?.warnings.includes('HTF_UNAVAILABLE') && (htf.isError || htf.data) && (
          <Warning>Nu s-au putut încărca lumânările pe {p.msTf}; liniile Market Structure sunt ascunse.</Warning>
        )}
        {candles.data?.notice && (
          <Warning>
            Se afișează lumânările primite {fmtAgo(candles.data.fetchedAt)}, pentru că {candles.data.notice}.
          </Warning>
        )}
        {/* Outside the regular session a stock's candles do not change until the open: not stale. */}
        {candles.data && !candles.data.notice && Date.now() - candles.data.fetchedAt > 5 * 60_000 && !(stock && market && market.state !== 'open') && <Warning>Date vechi de {fmtAgo(candles.data.fetchedAt)}.</Warning>}

        {candles.isError && candles.data && <Warning>Actualizarea a eșuat ({errorMessage(candles.error)}); graficul arată ultimele date primite.</Warning>}
        {studyError ? <Warning>Lista indicatorilor nu s-a putut salva ({errorMessage(studyError)}); se arată cea de pe server.</Warning> : null}
        {studyRuntime.error ? <Warning>Codul indicatorilor nu s-a putut încărca ({errorMessage(studyRuntime.error)}). Reîncarcă pagina.</Warning> : null}
        {/* FD-CHARTTV §3: the chart, then the symbol list on its right (under it on a narrow screen). */}
        <div ref={chartRow} className={clsx('flex', fs.active && 'min-h-[320px] flex-1')}>
          {/* FD-CHARTSETTINGS: on the chart's own background, the loading one included (no flash of the theme's). */}
          <div className="panel relative min-w-0 flex-1 overflow-hidden bg-chart" style={look.canvas.background.top ? ({ '--color-chart': look.canvas.background.top } as React.CSSProperties) : undefined}>
            {/* FD-CHARTAUDIT §6: while another timeframe or symbol loads, the panel keeps the chart's height (the page
                below does not jump). */}
            {!candles.data && !candles.isError ? (
              <div className={clsx('grid place-items-center px-6', fs.active && 'h-full')} style={fs.active ? undefined : { height: chartHeight }}>
                <Loading label="Se încarcă lumânările…" />
              </div>
            ) : !candles.data ? (
              <div className={clsx('p-6', fs.active && 'h-full')} style={fs.active ? undefined : { height: chartHeight }}>
                <ErrorNote error={candles.error} onRetry={() => candles.refetch()} />
              </div>
            ) : (
              <CandleChart
                candles={candles.data.candles}
                result={slingshotDrawn ? result : null}
                params={p}
                precision={pairPrecision}
                displayPrecision={precision}
                tz={chartTz}
                priceLines={priceLines}
                viewKey={`${exchange}|${symbol}|${activeTf}`}
                lma={lma}
                paneOrder={paneOrder}
                paneFactors={paneFactors}
                onPaneFactors={onPaneFactors}
                studies={draws}
                runtime={runtime}
                mainOverlay={tpSl}
                legends={legends}
                onVisibleRange={readsVisible ? setVisibleRange : undefined}
                className={fs.active ? 'h-full' : undefined}
                style={fs.active ? undefined : { height: chartHeight }}
                hlines={shownHlines}
                selectedHLine={hlineTarget}
                onAddHLine={addHLine}
                hlineBlocked={hlineBlocked}
                onMoveHLine={moveHLine}
                onOpenHLine={openHLine}
                tfMs={chartSec * 1000}
                // A share's candle runs only with the market open, and ends by its close at the latest (a weekly one: not today).
                countdown={!stock || (market?.state === 'open' && activeTf !== '1w')}
                closeCap={stock ? (market?.closesAt ?? null) : null}
                logScale={prefs.logScale}
                onLogScale={(on) => remember({ charts: { logScale: on } })}
                onDragLine={onDragLine}
                dragText={dragText}
                onLineAction={onLineAction}
                lineOverlays={lineOverlays}
                look={look}
                watermark={[`${symbolLabel}, ${activeTf}`, ...(instrumentName ? [instrumentName] : [])]}
                resetView={resetTick}
                onSettings={() => setLookOpen(true)}
                onContextMenu={(at) => setMenuAt({ x: at.x, y: at.y })}
              />
            )}
          </div>
          {wide && !list.hidden && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Lățimea listei de simboluri"
                aria-valuemin={WATCHLIST_MIN}
                aria-valuemax={WATCHLIST_MAX}
                aria-valuenow={list.width}
                tabIndex={0}
                title="Trage ca să schimbi lățimea listei (dublu-click: 300 px)"
                className="group flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center"
                onPointerDown={onListEdgeDown}
                onDoubleClick={() => setListPrefs({ ...list, width: WATCHLIST_DEFAULT })}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  // The edge is the list's left side: ← widens it, → narrows it.
                  setListPrefs({ ...list, width: clampWidth(list.width + (e.key === 'ArrowLeft' ? 16 : -16), chartRow.current?.offsetWidth) });
                }}
              >
                <span className="h-12 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-accent group-focus-visible:bg-accent" aria-hidden />
              </div>
              {/* No overflow clip: the search's results may spill over the chart. */}
              <aside className="panel relative flex w-[var(--wl)] max-w-[50%] shrink-0 flex-col" style={{ '--wl': `${list.width}px` } as React.CSSProperties} aria-label="Lista de simboluri">
                <div className="absolute inset-0 flex flex-col">
                  <Watchlist current={savedSymbol} onPick={(path) => navigate(path)} contained={fs.active} />
                </div>
              </aside>
            </>
          )}
        </div>
        {!wide && (
          // FD-WATCHDRAWER: in the page's frame, so the system's full screen shows it too.
          <ListDrawer open={listOpen} onClose={closeListDrawer}>
            <Watchlist
              current={savedSymbol}
              inDrawer
              onPick={(path) => {
                setListOpen(false);
                navigate(path);
              }}
            />
          </ListDrawer>
        )}
        {drawer && (
          <SettingsDrawer
            target={drawer}
            slingshot={p}
            lma={lmaParams}
            studies={studies}
            runtime={runtime}
            onSaveStudy={saveStudy}
            resultOf={(uid) => studyStates.get(uid)?.result ?? null}
            hline={hlinePanel}
            onClose={closeDrawer}
          />
        )}
        {picker && (
          <IndicatorPicker
            premium={PREMIUM}
            premiumOn={prem}
            studyCount={studies.length}
            studiesOn={studiesOn}
            favorites={favorites}
            favoriteError={favoriteError}
            onToggleFavorite={toggleFavorite}
            onAddPremium={(key: PremiumKey) => remember({ charts: key === 'slingshot' ? { showSlingshot: true, slingshotHidden: false } : { showLma: true, lmaHidden: false } })}
            onAddStudy={addStudy}
            onClose={closePicker}
          />
        )}
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[2fr_1fr]">
        <Panel title={`Semnale Slingshot ${SLINGSHOT_VERSION} pe ${activeTf}`} icon={ListChecks} flush>
          {result ? (
            <SignalsTable signals={result.signals} precision={precision} tz={chartTz} shortColor={p.shortColor} forming={{ long: result.last?.liveSignal ?? false, short: result.last?.liveShortSignal ?? false }} />
          ) : candles.isError ? (
            <p className="pb-4 text-[13.5px] text-faint">Fără semnale: lumânările nu s-au putut încărca.</p>
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="Alerte" icon={Bell}>
          {alerts.length === 0 ? (
            <p className="text-[13.5px] text-faint">Nicio alertă în istoricul încărcat.</p>
          ) : (
            <ul className="rows -mx-5 max-h-[380px] divide-y divide-line-soft overflow-auto text-[13.5px]">
              {alerts.map((a) => (
                <li key={`${a.bar}-${a.type}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                    {/* The icon stays with its name, on the name's first line, however a narrow screen wraps them. */}
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="flex h-[1lh] shrink-0 items-center">
                        <AlertIcon type={a.type} />
                      </span>
                      <span>{ALERT_RO[a.type]}</span>
                    </span>
                    {a.count > 1 && <span className="text-faint">× {a.count} bare</span>}
                    {a.provisional && <span className="text-[12px] text-warn">neconfirmat</span>}
                  </span>
                  <span className="num shrink-0 text-faint">{fmtDateTime(a.time, chartTz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
