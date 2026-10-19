import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import type { ZodType } from 'zod';
import { ArrowRightLeft, Bell, Info, ListChecks, Maximize2, Minimize2, Search, SlidersHorizontal, X } from 'lucide-react';
import type { AccountView, CandlesResult, Portfolio, StockQuoteRow, StockSearchHit, SymbolInfo } from '../../shared/api-types.ts';
import { DEFAULT_SLINGSHOT_PARAMS, SLINGSHOT_SHORT_TITLE, SLINGSHOT_TITLE, SLINGSHOT_VERSION, slingshotParamsSchema, type SlingshotParams } from '../../shared/indicator/params.ts';
import {
  DEFAULT_LMA_PARAMS,
  effectiveLmaParams,
  LINE_STYLES,
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
import { CHART_SYMBOL_RE, type Settings, type SettingsView } from '../../shared/settings.ts';
import { STUDY_MAX, type FavoriteId, type Study, type StudyId, type StudyMemoryEntry } from '../../shared/studies.ts';
import { api, errorMessage, qs } from '../api.ts';
import { CandleChart, DEFAULT_PANE_FACTOR, lmaHlines, type PriceLineSpec, type StudyDraw } from '../chart/CandleChart.tsx';
import { useFullscreen } from '../chart/fullscreen.ts';
import { PNL_COLORS, PNL_COLORS_LIGHT, pnlLines } from '../chart/pnl.ts';
import { useTheme } from '../theme.ts';
import { saveSettingsPatch, type SettingsPatch } from '../chart/prefs.ts';
import { premiumState } from '../chart/premium.ts';
import { fmtAgo, fmtDateTime, fmtPct, fmtPrice } from '../format.ts';
import { chartPathOf, indexChartPath, nearestTimeframe, rememberedPath, stockChartPath } from '../chart/paths.ts';
import { INDEX_DELAY_NOTE, INDEX_TIMEFRAMES, INDICES, indexById, indexId, plainSymbol, searchIndices } from '../../shared/indices.ts';
import { useMarketSource, useSettings, useStocksInfo, useTz, useWatchlist } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { FavoritesDnd, SortableFavorite } from '../components/SortableFavorites.tsx';
import { OrderTicket, useTradingCaps, type TicketSeed } from '../components/OrderTicket.tsx';
import { IndicatorPicker, PremiumBadge, type PremiumItem, type PremiumKey } from '../components/IndicatorPicker.tsx';
import { StudySettings } from '../components/StudySettings.tsx';
import { LegendButtons, LegendRow, StudyLegendRow } from '../components/StudyLegend.tsx';
import { studyMeta } from '../indicators/catalog-meta.ts';
import { legendParams, sanitizeInputs, type ChartInfo } from '../indicators/compute.ts';
import { useStudyRuntime, type StudyRuntime } from '../indicators/runtime.ts';
import { legendNumbers, styledEntry } from '../indicators/style.ts';
import { useStudies } from '../indicators/useStudies.ts';
import { fromMemory, memoryOf, rememberStudy } from '../indicators/memory.ts';
import { AlertIcon, CoinLogo, OutcomeIcon } from '../components/icons.tsx';
import { useScrollLock } from '../scroll-lock.ts';
import { HLineSettings } from '../components/HLineSettings.tsx';
import { HLINE_DEFAULT_STYLE, HLINE_MAX, hlineVisibleOn, styleOf, type HLine, type HLineStyle } from '../../shared/hlines.ts';

const ALERT_RO: Record<string, string> = {
  longSignal: 'Long Signal',
  takeProfitSignal: 'Take Profit Signal',
  atrTakeProfit: 'ATR Take Profit Hit',
  atrStopLoss: 'ATR Stop Loss Hit',
  msBullish: 'Bullish Market Structure',
  msBearish: 'Bearish Market Structure',
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

function SymbolPicker({ current, onPick }: { current: string; onPick: (path: string) => void }) {
  const watchlist = useWatchlist();
  const favs = watchlist.data ?? [];
  const [q, setQ] = useState('');
  const term = q.trim();
  const results = useQuery({
    queryKey: ['symbols', term],
    queryFn: () => api.get<SymbolInfo[]>(`/api/market/symbols${qs({ q: term })}`),
    enabled: term.length >= 1,
    staleTime: 5 * 60_000,
  });
  // Stocks from two letters on (FD-SENTIQ §4.3): one Nasdaq / Twelve Data search per word typed.
  const stocks = useQuery({
    queryKey: ['stocks', 'search', term],
    queryFn: () => api.get<StockSearchHit[]>(`/api/stocks/search${qs({ q: term })}`),
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const pick = (path: string) => {
    onPick(path);
    setQ('');
  };
  const pairs = results.data ?? [];
  const shares = stocks.data ?? [];
  // FD-INDICES: the seven indices are known here, no request needed.
  const indices = term.length >= 2 ? searchIndices(term) : [];
  // Group titles only when more than one kind was found.
  const titled = [pairs, shares, indices].filter((l) => l.length > 0).length > 1;
  const row = 'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] transition-colors hover:bg-hover';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Drag a chip to reorder the favourites; Alt + ←/→ does it from the keyboard (FD-CHARTFAV §2). */}
      <FavoritesDnd ids={favs.map((w) => w.coin)} layout="wrap">
        {(order) =>
          favs.map((w) => {
            const id = w.kind === 'crypto' ? `${w.coin}/${w.quote}` : `${w.kind}:${plainSymbol(w.coin)}`;
            return (
              <SortableFavorite key={w.coin} id={w.coin}>
                {(s) => (
                  <button
                    ref={s.setNodeRef}
                    {...s.attributes}
                    {...s.listeners}
                    style={s.style}
                    type="button"
                    className={clsx('chip gap-1.5 pl-1.5', s.isDragging && 'shadow-drag')}
                    aria-pressed={id === current}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    onClick={() => !order.justDragged() && onPick(chartPathOf(w))}
                    onKeyDown={order.keyMove(w.coin, 'x')}
                    title={`${w.name ? `${w.name}. ` : ''}Trage ca să muți favoritul`}
                  >
                    <CoinLogo coin={w.coin} size={16} badge={w.kind === 'stock'} square={w.kind === 'stock'} />
                    {plainSymbol(w.coin)}
                  </button>
                )}
              </SortableFavorite>
            );
          })
        }
      </FavoritesDnd>
      <div className="relative ml-1">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
        {/* The height of the favourite chips it follows (FD-SELECTSAFARI), not of a button. */}
        <input
          aria-label="Caută o pereche, o acțiune sau un indice"
          placeholder="Pereche, acțiune sau indice"
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          className="h-[30px] min-h-[30px] w-64 max-w-full py-0 pl-9 text-[13px] pointer-coarse:h-9 pointer-coarse:min-h-9"
        />
        {term && (results.data || stocks.data || indices.length > 0) && (
          <ul className="absolute z-30 mt-1.5 max-h-80 w-72 overflow-auto overscroll-contain rounded-xl border border-line-strong bg-panel-2 py-1.5 shadow-pop" role="listbox">
            {pairs.length === 0 && shares.length === 0 && indices.length === 0 && (
              <li className="px-3.5 py-2 text-[13px] text-faint">{stocks.isFetching || results.isFetching ? 'Se caută…' : 'Nicio pereche, acțiune sau indice'}</li>
            )}
            {titled && pairs.length > 0 && <li className="px-3.5 pt-1 pb-0.5 text-[11.5px] text-faint">Crypto</li>}
            {pairs.map((r) => (
              <li key={r.symbol}>
                <button type="button" className={row} onClick={() => pick(`/charts/${r.base}/${r.quote}`)}>
                  <CoinLogo coin={r.base} size={16} />
                  {r.symbol}
                </button>
              </li>
            ))}
            {titled && shares.length > 0 && <li className="px-3.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">Acțiuni</li>}
            {shares.map((r) => (
              <li key={`stock:${r.symbol}`}>
                <button type="button" className={row} onClick={() => pick(stockChartPath(r.symbol))}>
                  <CoinLogo coin={r.symbol} size={16} badge square />
                  <span className="font-medium">{r.symbol}</span>
                  <span className="min-w-0 truncate text-[12.5px] text-faint">
                    {r.name}
                    {r.exchange ? ` · ${r.exchange}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {titled && indices.length > 0 && <li className="px-3.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">Indici</li>}
            {indices.map((i) => (
              <li key={i.id}>
                <button type="button" className={row} onClick={() => pick(indexChartPath(i.id))}>
                  <CoinLogo coin={i.id} size={16} />
                  <span className="font-medium">{i.symbol}</span>
                  <span className="min-w-0 truncate text-[12.5px] text-faint">{i.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
  | { kind: 'bool' }
  | { kind: 'color' }
  | { kind: 'text' }
  | { kind: 'select'; options: { value: string; label: string }[] }
  /** A Style-tab hline: on/off (`key`), line style (`styleKey`) and a preview of its colour and value. */
  | { kind: 'line'; styleKey: keyof P & string; preview: (draft: P) => { color: string; value: number } }
);
interface GroupDef<P> {
  title: string;
  fields: FieldDef<P>[];
}

const SLINGSHOT_GROUPS: GroupDef<SlingshotParams>[] = [
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
      { key: 'longTPColor', label: 'ATR Take Profit Color', kind: 'color' },
      { key: 'longSLColor', label: 'ATR Stop Loss Color', kind: 'color' },
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
      { key: 'msBullColor', label: 'Bullish MS Color', kind: 'color' },
      { key: 'msBearColor', label: 'Bearish MS Color', kind: 'color' },
      { key: 'msLineWidth', label: 'MS Line Width', kind: 'int' },
      { key: 'msLineStyle', label: 'MS Line Style', kind: 'select', options: ['Solid', 'Dashed', 'Dotted'].map((v) => ({ value: v, label: v })) },
      { key: 'msTextSize', label: 'MS Text Size', kind: 'select', options: ['Tiny', 'Small', 'Normal', 'Large'].map((v) => ({ value: v, label: v })) },
    ],
  },
];

// Names, groups, limits and tooltips from logarithmic-moving-average.pine; "Style" mirrors TradingView's Style tab.
const lmaLine = (key: 'long' | 'short' | 'neutral') => (d: LmaParams) => {
  const h = lmaHlines(effectiveLmaParams(d)).find((x) => x.key === key) as ReturnType<typeof lmaHlines>[number];
  return { color: h.color, value: h.price };
};
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
      { key: 'showSignal', label: 'LMA Signal', kind: 'bool' },
      { key: 'signalWidth', label: 'LMA Signal Line Width', kind: 'int', min: 1, max: 4 },
      { key: 'showFill', label: 'LMA Signal Fill', kind: 'bool' },
      { key: 'showBarColors', label: 'LMA Signal Bar Colors', kind: 'bool' },
      { key: 'showLongLine', label: 'Long Threshold', kind: 'line', styleKey: 'longLineStyle', preview: lmaLine('long') },
      { key: 'showShortLine', label: 'Short Threshold', kind: 'line', styleKey: 'shortLineStyle', preview: lmaLine('short') },
      { key: 'showNeutralLine', label: 'Neutral Line', kind: 'line', styleKey: 'neutralLineStyle', preview: lmaLine('neutral') },
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
  // The (i) shows the Pine tooltip on hover; for assistive tech the same text is the field's description
  // (`title` on the control), so the field's name stays just its label.
  const tipIcon = (tip?: string) =>
    tip ? (
      <span className="inline-flex shrink-0 cursor-help text-faint" title={tip} aria-hidden>
        <Info size={13} />
      </span>
    ) : null;
  const renderField = (f: FieldDef<P>, inRow: boolean) => {
    const isForced = forced !== null && f.key in forced;
    const v = isForced ? (forced as Record<string, unknown>)[f.key] : draft[f.key];
    const id = `${settingsKey}-${f.key}`;
    if (f.kind === 'bool' || f.kind === 'line') {
      // Checkboxes on the left of their label, as in TradingView.
      const line = f.kind === 'line' ? f.preview(draft) : null;
      return (
        <div key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
          <label htmlFor={id} className="flex min-w-0 items-center gap-2.5">
            <input id={id} type="checkbox" checked={Boolean(v)} title={f.tip} onChange={(e) => set(f.key, e.target.checked)} />
            <span className="text-muted">{f.label}</span>
            {tipIcon(f.tip)}
          </label>
          {f.kind === 'line' && line && (
            // The preview has the dropdown's height (FD-UIPOLISH).
            <span className="flex shrink-0 items-stretch gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-line px-2" aria-hidden>
                <span className="h-4 w-4 rounded" style={{ background: line.color }} />
                <span className="w-6 border-t-2" style={{ borderColor: line.color, borderTopStyle: String(draft[f.styleKey]).toLowerCase() as 'solid' | 'dashed' | 'dotted' }} />
              </span>
              <select aria-label={`${f.label}: stil`} value={String(draft[f.styleKey])} onChange={(e) => set(f.styleKey, e.target.value)} className="w-[92px]">
                {LINE_STYLES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
              <span className="num w-10 self-center text-right text-muted">{Number.isFinite(line.value) ? line.value : '—'}</span>
            </span>
          )}
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
          <input id={id} type="color" value={String(v)} onChange={(e) => set(f.key, e.target.value.toUpperCase())} className="h-8 w-12 p-1" />
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
          const bad = [...new Set(r.error.issues.map((i) => String(i.path[0])))].map((k) => {
            const f = allFields.find((x) => x.key === k);
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
  hline,
  onClose,
}: {
  target: DrawerTarget;
  slingshot: SlingshotParams;
  lma: LmaParams;
  studies: readonly Study[];
  runtime: StudyRuntime | null;
  onSaveStudy: (next: Study) => Promise<unknown>;
  hline: HLinePanel;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // FD-SCROLLLOCK: the page behind the panel stays still (the chart beside it still zooms with the wheel).
  useScrollLock();
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
    <aside ref={panel} role="dialog" aria-modal="false" className="panel fixed top-0 right-0 z-40 flex h-screen w-[400px] max-w-full flex-col rounded-none border-y-0 border-r-0" aria-label={`Setările ${title}`}>
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
        <StudySettings key={study.uid} name={meta.name} mod={runtime.STUDY_MODULES[study.id]} runtime={runtime} study={study} onSave={onSaveStudy} />
      )}
    </aside>
  );
}

function SignalsTable({ signals, precision, tz }: { signals: SlingshotSignal[]; precision: number; tz: string }) {
  if (!signals.length) return <p className="pb-4 text-[13.5px] text-faint">Niciun semnal LONG în istoricul încărcat.</p>;
  const counts = signals.reduce<Record<string, number>>((a, s) => ((a[s.outcome] = (a[s.outcome] ?? 0) + 1), a), {});
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
              <th>LONG (minimul V2)</th>
              <th className="text-right">Intrare</th>
              <th className="text-right">SL</th>
              <th className="text-right">TP (ATR)</th>
              <th>Rezultat</th>
            </tr>
          </thead>
          <tbody>
            {[...signals].reverse().map((s) => (
              <tr key={s.bar}>
                <td className="num">
                  {fmtDateTime(s.time, tz)}
                  {s.provisional && <span className="ml-1 text-[11px] text-warn">neconfirmat</span>}
                </td>
                <td className="num text-right">{fmtPrice(s.entryLow, precision)}</td>
                <td className="num text-right text-bear">{fmtPrice(s.sl, precision)}</td>
                <td className="num text-right text-bull">{fmtPrice(s.tp, precision)}</td>
                <td className="whitespace-nowrap">
                  <span className={clsx('inline-flex items-center gap-1.5 font-semibold', s.outcome === 'tp' ? 'text-bull' : s.outcome === 'active' ? 'text-text' : 'text-bear')}>
                    <OutcomeIcon outcome={s.outcome} />
                    {OUTCOME_RO[s.outcome]}
                  </span>
                  {s.outcomeReason && <span className="ml-1 text-[12px] text-faint">({REASON_RO[s.outcomeReason]})</span>}
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

function usePositionLines(symbol: string, show: boolean, lastPrice: number | null, stock: boolean): PriceLineSpec[] {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts'), staleTime: 60_000, enabled: show });
  // Only the accounts that can hold this chart's asset: brokers for a share, exchanges for a coin (their APIs have limits).
  const relevant = (accounts.data ?? []).filter((a) => (a.kind === 'stocks') === stock);
  const portfolios = useQueries({
    queries: (show ? relevant : []).map((a) => ({
      queryKey: ['portfolio', a.id],
      queryFn: () => api.get<Portfolio>(`/api/portfolio/${a.id}`),
      refetchInterval: 60_000,
    })),
  });
  // The lines' colours follow the theme (FD-THEME §1).
  const theme = useTheme();
  return useMemo(() => {
    if (!show) return [];
    const colors = theme === 'light' ? PNL_COLORS_LIGHT : PNL_COLORS;
    const [base = '', quote = 'USDT'] = stock ? [symbol, 'USD'] : symbol.split('/');
    const lines: PriceLineSpec[] = [];
    const several = relevant.length > 1;
    for (const p of portfolios) {
      const d = p.data;
      // Stocks come from brokers, coins from exchanges: a ticker can be both (COIN), the account kind decides.
      if (!d || (d.kind === 'stocks') !== stock) continue;
      // The open trade on this coin: entry, liquidation, SL / TP orders with their PnL, PnL now (FD-PNL).
      const account = several ? accounts.data?.find((a) => a.id === d.accountId)?.label : undefined;
      const pnl = pnlLines({ base, quote, lastPrice, positions: d.positions, balances: d.balances, orders: d.orders, account, stock }, colors);
      lines.push(...pnl.lines);
      // Other orders on this coin stay as plain lines.
      for (const o of d.orders) {
        if (pnl.usedOrders.has(`${o.market}:${o.id}`)) continue;
        if (!o.symbol.startsWith(`${base}/`) || (o.market === 'spot' && !o.symbol.startsWith(`${base}/${quote}`))) continue;
        const price = o.triggerPrice ?? o.price;
        if (price) lines.push({ price, color: colors.other, title: `${o.side} ${o.type}${o.triggerPrice ? ' stop' : ''}`, style: 'dashed' });
      }
    }
    return lines;
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

const DEFAULT_CHART_PREFS: Settings['charts'] = { symbol: '', showPositions: true, showLma: true, showSlingshot: true, slingshotHidden: false, lmaHidden: false, lmaPane: 0.25 };

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
  const fs = useFullscreen(frame, { blockEsc: drawer !== null || picker });
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
  const studies = useMemo(() => s?.studies ?? [], [s?.studies]);
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
  const rawLines = usePositionLines(symbol, prefs.showPositions && !index, candles.data?.candles.at(-1)?.c ?? null, stock);
  const linesKey = JSON.stringify(rawLines);
  // Keep the array identity stable while the content is unchanged (avoids redrawing price lines every render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const priceLines = useMemo(() => rawLines, [linesKey]);
  const precision = candles.data?.pricePrecision ?? 2;
  const hlinePanel = useMemo<HLinePanel>(
    () => ({
      line: hlinesSaved.find((l) => l.id === hlineTarget),
      precision,
      template: s?.hlineTemplate ?? null,
      onDraft: setHlineDraft,
      // Optimistic, as the drags and additions: the form checks the same schema as the server, and a change made while
      // a save is on its way builds on it (a refusal brings the server's lines back).
      onSave: (next) => saveHlines(linesNow().map((l) => (l.id === next.id ? next : l))),
      onSaveTemplate: (style) => saveSettingsPatch(qc, { hlineTemplate: style }, { optimistic: false }),
      onDelete: (id) => saveHlines(linesNow().filter((l) => l.id !== id)),
    }),
    [hlinesSaved, hlineTarget, precision, s?.hlineTemplate, saveHlines, linesNow, qc],
  );
  const alerts = useMemo(() => (result ? collapseAlerts(result.alerts).reverse().slice(0, 40) : []), [result]);
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

  // FD-CHARTFAV §1: with Slingshot off or hidden nothing of it is drawn (the panels below still use `result`).
  const tpSl = slingshotDrawn && result?.atr ? (
    // The indicator's own table, in its Pine colours: on a dark plate in both themes, or its neon would vanish on white
    // (FD-THEME §1).
    <div className="absolute right-3 bottom-3 rounded-xl border border-[#262d3a] bg-[#07090e]/90 px-4 py-3 text-[13px] backdrop-blur">
      <div className="flex justify-between gap-6">
        <span style={{ color: p.longTPColor }}>TAKE PROFIT</span>
        <span className="num font-semibold" style={{ color: p.longTPColor }}>
          {fmtPrice(result.atr.tp, precision)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-6">
        <span style={{ color: p.longSLColor }}>STOP LOSS</span>
        <span className="num font-semibold" style={{ color: p.longSLColor }}>
          {fmtPrice(result.atr.sl, precision)}
        </span>
      </div>
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
          <span className="font-medium text-muted">{LMA_SHORT_TITLE}</span>
          <span className="num hidden text-faint sm:inline">{lmaText(e)}</span>
          {/* FD-CHARTSTEADY §2: the buttons before the values, so the cursor's values never move them. */}
          {lmaButtons(false)}
          <span className="num font-semibold" style={{ color: col }}>
            {Number.isFinite(v) ? v.toFixed(2) : '—'}
          </span>
          {Number.isFinite(v) && (
            <span className="text-[11.5px] font-semibold" style={{ color: col }}>
              {lma.state[i]}
            </span>
          )}
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
  // The price pane: Slingshot, a hidden LMA, the indicators over the candles, and the hidden ones that have a pane of their own.
  const mainStudies = studies.filter((st) => studyMeta(st.id)?.overlay !== false || !st.visible);
  const legends: Record<string, (bar: number | null) => React.ReactNode> = {};
  if (prem.slingshot !== 'off' || prem.lma === 'hidden' || mainStudies.length) {
    const slingshotHidden = prem.slingshot === 'hidden';
    legends.main = (bar) => (
      <div className="flex flex-col items-start gap-0.5 px-1.5 pt-1.5">
        {prem.slingshot !== 'off' && (
          <LegendRow dim={slingshotHidden}>
            <span className="font-medium text-muted">{SLINGSHOT_SHORT_TITLE}</span>
            <span className="num hidden text-faint sm:inline">
              {p.lenFastEma} {p.lenSlowEma}
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
            <span className="font-medium text-muted">{LMA_SHORT_TITLE}</span>
            <span className="num hidden text-faint sm:inline">{lmaText(effectiveLmaParams(lmaParams))}</span>
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
            {/* While loading it keeps the previous width; never empty (an empty line would shift the row's baseline). */}
            <span className="text-[12.5px] text-faint">{loadingCandles && sourceGhost && sourceGhost.length > sourceText.length ? <Holding ghost={sourceGhost} dash={sourceText || '\u00a0'} start /> : sourceText || '\u00a0'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
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
            <label className="inline-flex min-h-[38px] items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] text-muted">
              <input type="checkbox" checked={prefs.showPositions} onChange={(e) => remember({ charts: { showPositions: e.target.checked } })} /> Pozițiile mele
            </label>
            {canTrade && (
              <button className="btn btn-primary" onClick={() => setTicket(stock ? { kind: 'stocks', symbol: base ?? symbol, price: last?.c } : { kind: 'crypto', symbol, price: last?.c })}>
                <ArrowRightLeft size={16} aria-hidden /> Tranzacționează
              </button>
            )}
            <button className="btn" onClick={() => setPicker(true)}>
              <SlidersHorizontal size={16} aria-hidden /> Indicatori
            </button>
            {fs.active ? (
              <button className="btn btn-primary" onClick={fs.exit} aria-label="Ieși din ecran complet (Esc)">
                <Minimize2 size={16} aria-hidden /> Ieși din ecran complet
                <kbd className="num rounded border border-current/30 px-1 text-[11px] opacity-80">Esc</kbd>
              </button>
            ) : (
              <button className="btn" onClick={() => void fs.enter()} aria-label="Ecran complet" title="Ecran complet">
                <Maximize2 size={16} aria-hidden />
                <span className="hidden sm:inline">Ecran complet</span>
              </button>
            )}
          </div>
        </div>
        <SymbolPicker current={savedSymbol} onPick={(path) => navigate(path)} />
        {ticket && <OrderTicket seed={ticket} onClose={closeTicket} />}
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
        <div className={clsx('panel relative overflow-hidden bg-chart', fs.active && 'min-h-[320px] flex-1')}>
          {!candles.data && !candles.isError ? (
            <div className="px-6">
              <Loading label="Se încarcă lumânările…" />
            </div>
          ) : !candles.data ? (
            <div className="p-6">
              <ErrorNote error={candles.error} onRetry={() => candles.refetch()} />
            </div>
          ) : (
            <CandleChart
              candles={candles.data.candles}
              result={slingshotDrawn ? result : null}
              params={p}
              precision={precision}
              tz={tz}
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
              // FD-INDICATORS §2: 120 px more for each pane below the price.
              className={fs.active ? 'h-full' : undefined}
              style={fs.active ? undefined : { height: 560 + 120 * paneOrder.length }}
              hlines={shownHlines}
              selectedHLine={hlineTarget}
              onAddHLine={addHLine}
              hlineBlocked={hlineBlocked}
              onMoveHLine={moveHLine}
              onOpenHLine={openHLine}
            />
          )}
        </div>
        {drawer && (
          <SettingsDrawer target={drawer} slingshot={p} lma={lmaParams} studies={studies} runtime={runtime} onSaveStudy={saveStudy} hline={hlinePanel} onClose={closeDrawer} />
        )}
        {picker && (
          <IndicatorPicker
            premium={PREMIUM}
            premiumOn={prem}
            studyCount={studies.length}
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
            <SignalsTable signals={result.signals} precision={precision} tz={tz} />
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
                  <span className="flex flex-wrap items-center gap-x-2">
                    <AlertIcon type={a.type} />
                    <span>{ALERT_RO[a.type]}</span>
                    {a.count > 1 && <span className="text-faint">× {a.count} bare</span>}
                    {a.provisional && <span className="text-[12px] text-warn">neconfirmat</span>}
                  </span>
                  <span className="num shrink-0 text-faint">{fmtDateTime(a.time, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
