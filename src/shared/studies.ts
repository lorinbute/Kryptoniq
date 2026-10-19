// The indicators a chart can carry besides Slingshot and LMA (FD-INDICATORS, TD-INDICATORS §2): their ids, shared by the
// server (validation of the saved list) and the page (catalog), and the shape of one saved indicator.
import { z } from 'zod';

/** The 117 standard TradingView indicators of the vendored port, then Sentiq's own Volume. Generated from the catalog. */
export const STUDY_IDS = [
  'sma', 'adr', 'alma', 'atr', 'bb', 'bop', 'cci', 'dema', 'ema', 'hma', 'ichimoku', 'keltner', 'lsma', 'macd',
  'mass-index', 'mc-ginley-dynamic', 'momentum', 'obv', 'roc', 'rsi', 'stoch', 'tema', 'vwma', 'wma', 'donchian',
  'parabolic-sar', 'supertrend', 'adx', 'awesome-oscillator', 'bbtrend', 'bull-bear-power', 'chande-mo', 'dpo',
  'elder-force', 'hist-volatility', 'ma-cross', 'ma-ribbon', 'median', 'mfi', 'pvt', 'rvi', 'smi-ergodic',
  'smi-ergodic-osc', 'smma', 'stdev', 'stoch-rsi', 'trend-strength', 'tsi', 'volume-osc', 'vortex',
  'williams-alligator', 'williams-r', 'woodies-cci', 'bb-percent-b', 'bb-bandwidth', 'chaikin-mf', 'envelope',
  'price-oscillator', 'aroon', 'coppock-curve', 'choppiness', 'eom', 'chaikin-osc', 'zigzag', 'fisher-transform',
  'trix', 'dmi', 'klinger', 'ultimate-osc', 'chande-kroll-stop', 'relative-volume-at-time', 'rci-ribbon',
  'volume-delta', 'cvd', 'net-volume', 'kst', 'connors-rsi', 'chop-zone', 'rci', 'rvol', 'williams-fractals', 'twap',
  'bb-bars', 'moon-phases', 'aroon-oscillator', 'nvi', 'pvi', 'ulcer-index', 'prings-special-k', 'volatility-stop',
  'vwap', 'up-down-volume', 'auto-key-levels', 'auto-trend-detector', '24-hour-volume', 'accumulation-distribution',
  'adr-bars', 'auto-fib-extension', 'auto-fib-retracement', 'auto-pitchfork', 'chandelier',
  'correlation-coefficient', 'gaps', 'kama', 'linreg-channel', 'multi-time-period-charts', 'performance',
  'pivot-points-high-low', 'pivot-points-standard', 'pmo', 'rob-booker-ziv-ghost-pivots', 'rsi-divergence-indicator',
  'seasonality', 'smi', 'technicals', 'trading-sessions', 'visible-average-price', 'volume',
] as const;
export type StudyId = (typeof STUDY_IDS)[number];
export const isStudyId = (v: unknown): v is StudyId => typeof v === 'string' && (STUDY_IDS as readonly string[]).includes(v);

/** Indicators one chart can carry besides Slingshot and LMA. */
export const STUDY_MAX = 20;

/** Sentiq's own indicators, at the top of the list (FD-INDICATORS §1). */
export const PREMIUM_KEYS = ['slingshot', 'lma'] as const;
export type PremiumKey = (typeof PREMIUM_KEYS)[number];

/** What can be starred in the "Indicatori" list (FD-STUDYUX §1): Sentiq's own and the standard ones. */
export const FAVORITE_IDS = [...PREMIUM_KEYS, ...STUDY_IDS] as const;
export type FavoriteId = (typeof FAVORITE_IDS)[number];
export const isFavoriteId = (v: unknown): v is FavoriteId => typeof v === 'string' && (FAVORITE_IDS as readonly string[]).includes(v);
/** In the order they were starred. */
export const studyFavoritesSchema = z
  .array(z.enum(FAVORITE_IDS))
  .max(FAVORITE_IDS.length)
  .refine((list) => new Set(list).size === list.length, 'fiecare favorit o singură dată');

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A colour as the indicators give them: #RGB(A) / #RRGGBB(AA), rgb() / rgba(). */
export const STUDY_COLOR_RE = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;
const color = z.string().max(40).regex(STUDY_COLOR_RE);
const inputValue = z.union([z.boolean(), z.number().finite(), z.string().max(300)]);
const keyed = <T extends z.ZodType>(value: T, max: number) =>
  z.record(z.string().regex(KEY_RE), value).refine((r) => Object.keys(r).length <= max, `cel mult ${max} de chei`);

/** A line's kind (TradingView's solid / dashed / dotted, FD-STUDYUX §3). */
export const LINE_STYLE_IDS = ['solid', 'dashed', 'dotted'] as const;
export type LineStyleId = (typeof LINE_STYLE_IDS)[number];
/** Up to the default + 2 px (a default of 4 px gives 6). */
const lineWidth = z.number().int().min(1).max(6);

/** Style of one line of an indicator (TradingView's Style tab): shown or not, its colour (or its palette), width, kind. */
export const studyPlotStyleSchema = z
  .object({
    visible: z.boolean().optional(),
    color: color.optional(),
    /** A plot coloured per bar from a fixed set: original colour -> colour drawn. */
    palette: z
      .record(color, color)
      .refine((r) => Object.keys(r).length <= 16, 'cel mult 16 culori')
      .optional(),
    width: lineWidth.optional(),
    style: z.enum(LINE_STYLE_IDS).optional(),
  })
  .strict();

/** A horizontal line: shown or not, colour, width, kind, and its level (FD-HLINELEVELS, e.g. 80 / 50 / 20 of Stoch RSI). */
export const studyHlineStyleSchema = z
  .object({
    visible: z.boolean().optional(),
    color: color.optional(),
    width: lineWidth.optional(),
    style: z.enum(LINE_STYLE_IDS).optional(),
    price: z.number().finite().min(-1e12).max(1e12).optional(),
  })
  .strict();

/** One indicator on the charts (FD-INDICATORS §4). */
export const studySchema = z
  .object({
    /** This copy of the indicator (the same indicator can be added twice). */
    uid: z.string().regex(/^[a-z0-9]{6,24}$/),
    id: z.enum(STUDY_IDS),
    /** The inputs the user saved; the page checks each against the indicator's own rules. */
    inputs: keyed(inputValue, 80).default({}),
    visible: z.boolean().default(true),
    plots: keyed(studyPlotStyleSchema, 40).optional(),
    hlines: keyed(studyHlineStyleSchema, 40).optional(),
    /** Height of its own pane, as a ratio to the price pane. */
    height: z.number().min(0.05).max(3).optional(),
  })
  .strict();
export type Study = z.infer<typeof studySchema>;

/**
 * The last settings of each indicator (FD-STUDYMEMORY): what it comes back with when added again. A list, not an
 * object keyed by id, so that saving one replaces it whole (the settings merge objects key by key).
 */
export const studyMemoryEntrySchema = studySchema.pick({ id: true, inputs: true, plots: true, hlines: true, height: true }).strict();
export type StudyMemoryEntry = z.infer<typeof studyMemoryEntrySchema>;
export const studyMemorySchema = z
  .array(studyMemoryEntrySchema)
  .max(STUDY_IDS.length)
  .refine((list) => new Set(list.map((m) => m.id)).size === list.length, 'fiecare indicator o singură dată');

export const studiesSchema = z
  .array(studySchema)
  .max(STUDY_MAX)
  .refine((list) => new Set(list.map((s) => s.uid)).size === list.length, 'fiecare indicator are un uid unic');
