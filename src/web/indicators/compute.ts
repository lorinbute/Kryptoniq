// Running one indicator on the chart's candles (FD-INDICATORS, TD-INDICATORS §6): the bars and chart context it reads,
// its inputs checked against its own rules, its errors caught, and what its legend shows. Pure functions: the runtime
// chunk (catalog + vendored code) is passed in, never imported here.
import type { Bar, IndicatorResult, InputConfig, PlotConfig } from 'oakscriptjs';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import type { StudyId } from '../../shared/studies.ts';
import { STUDY_COLOR_RE } from '../../shared/studies.ts';
import type { Timeframe } from '../../shared/time.ts';
import type { StudyModule } from './catalog.ts';
import type { ChartContext } from './vendor/chart-context';

/** What the page knows about the chart on screen. */
export interface ChartInfo {
  kind: 'crypto' | 'stock' | 'index';
  /** The crypto exchange of the candles ("kucoin"); "stock" / "index" otherwise. */
  exchange: string;
  /** "BTC/USDT", "AAPL", "SPX". */
  symbol: string;
  tf: Timeframe;
  precision: number;
}

const PINE_TF: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '8h': '480',
  '12h': '720',
  '1d': '1D',
  '1w': '1W',
};
/** A Sentiq timeframe as PineScript writes it ("60", "1D"). */
export const pineTf = (tf: Timeframe): string => PINE_TF[tf];

/** A PineScript timeframe as Sentiq has it, '1M' for the monthly one (built from daily bars), null when Sentiq has none. */
export function sentiqTf(pine: string): Timeframe | '1M' | null {
  const p = pine.trim().toUpperCase();
  const norm = p === 'D' ? '1D' : p === 'W' ? '1W' : p === 'M' ? '1M' : p;
  if (norm === '1M') return '1M';
  for (const [tf, v] of Object.entries(PINE_TF)) if (v === norm) return tf as Timeframe;
  return null;
}

/** Candles (ms) as the indicators read them (seconds, like the chart). */
export function toBars(candles: readonly Candle[]): Bar[] {
  return candles.map((c) => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
}

/** The chart symbol as a TradingView ticker id: "KUCOIN:BTCUSDT", "NASDAQ:AAPL", "INDEX:SPX". */
export function tickerIdOf(info: ChartInfo): string {
  if (info.kind === 'crypto') return `${info.exchange.toUpperCase()}:${info.symbol.replace('/', '')}`;
  return `${info.kind === 'index' ? 'INDEX' : 'NASDAQ'}:${info.symbol.replace(/^\^/, '')}`;
}

/** Exchange time zone and session of the chart symbol: crypto trades around the clock (UTC), the rest in New York. */
export function zoneOf(kind: ChartInfo['kind']): { timezone: string; session: string } {
  return kind === 'crypto' ? { timezone: 'Etc/UTC', session: '24x7' } : { timezone: 'America/New_York', session: '0930-1600' };
}

/** The chart context the indicators read (TD-INDICATORS §6); `bars` and the visible range are added per indicator. */
export function chartContext(info: ChartInfo): ChartContext {
  const quote = info.kind === 'crypto' ? (info.symbol.split('/')[1] ?? 'USDT') : 'USD';
  return {
    timeframe: pineTf(info.tf),
    ...zoneOf(info.kind),
    tickerid: tickerIdOf(info),
    symbolType: info.kind,
    currency: quote,
    ...(info.kind === 'crypto' ? { basecurrency: info.symbol.split('/')[0] ?? '' } : {}),
    mintick: 10 ** -info.precision,
    timeUnit: 's',
    // The last candle is still forming (FD §5.2).
    lastBarConfirmed: false,
  } as ChartContext;
}

export const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;
const SESSION_RE = /^\d{4}-\d{4}(?::[1-7]+)?$/;
const isPineTf = (v: string) => v === '' || sentiqTf(v) !== null || /^\d+[SDWM]?$/i.test(v);

/** Why a value does not fit an input (the form's message), or null when it does. */
export function inputProblem(cfg: InputConfig, v: unknown): string | null {
  const opts = cfg.options;
  switch (cfg.type) {
    case 'int':
    case 'float': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'trebuie să fie un număr';
      if (cfg.type === 'int' && !Number.isInteger(v)) return 'trebuie să fie un număr întreg';
      if (cfg.min !== undefined && v < cfg.min) return `cel puțin ${cfg.min}`;
      if (cfg.max !== undefined && v > cfg.max) return `cel mult ${cfg.max}`;
      return null;
    }
    case 'bool':
      return typeof v === 'boolean' ? null : 'da sau nu';
    case 'source':
      return typeof v === 'string' && ((SOURCES as readonly string[]).includes(v) || v === 'volume') ? null : 'o sursă din listă';
    case 'color':
      return typeof v === 'string' && STUDY_COLOR_RE.test(v) ? null : 'o culoare';
    case 'timeframe':
      if (typeof v !== 'string') return 'un timeframe';
      if (opts?.length) return opts.includes(v) ? null : 'o variantă din listă';
      return isPineTf(v) ? null : 'un timeframe';
    case 'session':
      if (typeof v !== 'string') return 'o sesiune';
      if (opts?.length) return opts.includes(v) ? null : 'o variantă din listă';
      return SESSION_RE.test(v) ? null : 'o sesiune ca 0930-1600';
    case 'time':
      return typeof v === 'number' && Number.isFinite(v) ? null : 'o dată';
    default: {
      // string, text_area, symbol
      if (typeof v !== 'string') return 'un text';
      if (opts?.length) return opts.includes(v) ? null : 'o variantă din listă';
      return v.length <= 300 ? null : 'cel mult 300 de caractere';
    }
  }
}

/** The inputs to run with: the defaults, then each saved value that fits its input (FD §6: else the default). */
export function sanitizeInputs(mod: Pick<StudyModule, 'defaultInputs' | 'inputConfig'>, saved: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...mod.defaultInputs };
  for (const cfg of mod.inputConfig) {
    if (!Object.hasOwn(saved, cfg.id)) continue;
    const v = saved[cfg.id];
    if (inputProblem(cfg, v) === null) out[cfg.id] = v;
  }
  return out;
}

/** The inputs a study saves: those that differ from the defaults (a changed default upstream then applies). */
export function changedInputs(mod: Pick<StudyModule, 'defaultInputs'>, inputs: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v === mod.defaultInputs[k]) continue;
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** The studies that read volume: on a chart without volume (indices) they show a note instead. */
export const VOLUME_STUDIES: ReadonlySet<StudyId> = new Set<StudyId>([
  'obv', 'mfi', 'pvt', 'volume-osc', 'chaikin-mf', 'eom', 'chaikin-osc', 'klinger', 'relative-volume-at-time', 'volume-delta', 'cvd',
  'net-volume', 'nvi', 'pvi', 'vwap', 'up-down-volume', '24-hour-volume', 'accumulation-distribution', 'vwma', 'twap', 'volume',
]);

export const NO_VOLUME = 'Indicii nu au volum.';

export interface StudyRun {
  result: IndicatorResult | null;
  error: string | null;
  /** Calculated from the chart bars where the original reads another timeframe of the symbol. */
  approximated: boolean;
  /** Symbols Sentiq could not load ("EURUSD (1D)"). */
  missing: string[] | null;
}

/** One run, its errors caught (FD §6: one indicator failing leaves the others and the chart). */
export function runStudy(mod: StudyModule, id: StudyId, bars: Bar[], inputs: Record<string, unknown>, ctx: ChartContext, approximated = false): StudyRun {
  if (VOLUME_STUDIES.has(id) && bars.length > 0 && bars.every((b) => !b.volume)) return { result: null, error: NO_VOLUME, approximated: false, missing: null };
  try {
    return { result: mod.calculate(bars, inputs, ctx), error: null, approximated, missing: null };
  } catch (err) {
    const requests = (err as { requests?: { symbol: string; timeframe: string }[] }).requests;
    if (Array.isArray(requests) && requests.length) return { result: null, error: null, approximated: false, missing: requests.map((r) => `${r.symbol} (${r.timeframe})`) };
    const msg = err instanceof Error ? err.message : String(err);
    return { result: null, error: msg.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Eroare la calcul.', approximated: false, missing: null };
  }
}

/** Whether an input is shown in the legend (PineScript `display`: by default not for bool / color / time / text). */
function inLegend(cfg: InputConfig): boolean {
  if (cfg.display) return cfg.display === 'all' || cfg.display === 'status_line';
  return !['bool', 'color', 'time', 'text_area'].includes(cfg.type);
}

/** The inputs the legend shows after the short name ("14 close"), as TradingView's status line. */
export function legendParams(mod: Pick<StudyModule, 'inputConfig'>, inputs: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const cfg of mod.inputConfig) {
    if (!inLegend(cfg)) continue;
    const v = inputs[cfg.id];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'number') parts.push(String(Number(v.toFixed(6))));
    else if (typeof v === 'string') parts.push(v.length > 24 ? `${v.slice(0, 23)}…` : v);
  }
  return parts.join(' ');
}

/** Whether a plot is drawn, as the renderer decides it (its override, `display`, a `visible` flag or input). */
export function plotShown(def: PlotConfig, override: { visible?: boolean } | undefined, inputs: Readonly<Record<string, unknown>>, result: IndicatorResult | null): boolean {
  if (override?.visible !== undefined) return override.visible;
  if (def.display === 'none' || def.display === 'data_window' || def.display === 'status_line') return false;
  if (def.visible === undefined || typeof def.visible === 'boolean') return def.visible ?? true;
  if (inputs[def.visible] !== undefined) return Boolean(inputs[def.visible]);
  const visibility = (result as { visibility?: Record<string, unknown> } | null)?.visibility;
  if (visibility?.[def.visible] !== undefined) return Boolean(visibility[def.visible]);
  return (result?.plots?.[def.id] ?? []).some((p) => p.value != null && !Number.isNaN(p.value));
}

/** A value for the legend: the chart's precision over the candles, else a few digits. */
export function fmtStudyValue(v: number, overlay: boolean, precision: number): string {
  if (!Number.isFinite(v)) return '—';
  if (overlay) return v.toFixed(precision);
  const a = Math.abs(v);
  const d = a >= 1e6 ? 0 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
  return v.toFixed(d);
}
