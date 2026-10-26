// FD-CHARTSETTINGS: how the chart looks, as TradingView's chart settings (Symbol, Status line, Canvas, Alerts). Each
// user's, saved on the account. The defaults are the chart as it was: a null colour is the theme's own.
import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/, 'Culoare #RRGGBB sau #RRGGBBAA');
/** A colour, or null: the theme's (light / dark). */
const themed = color.nullable().default(null);
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type ChartLineStyle = (typeof LINE_STYLES)[number];
/** When a group of buttons shows: with the mouse over the chart, always, never. */
export const BUTTON_VISIBILITY = ['hover', 'always', 'never'] as const;
export type ButtonVisibility = (typeof BUTTON_VISIBILITY)[number];
export const TITLE_MODES = ['symbol', 'name', 'both'] as const;
export const SCALE_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16] as const;

const candlePart = (visible: boolean) =>
  z
    .object({
      visible: z.boolean().default(visible),
      up: color.default('#26A69A'),
      down: color.default('#EF5350'),
    })
    .prefault({});
const grid = z
  .object({
    visible: z.boolean().default(false),
    color: themed,
    style: z.enum(LINE_STYLES).default('solid'),
  })
  .prefault({});

export const chartStyleSchema = z.object({
  /** Symbol: the candles. */
  candles: z
    .object({
      /** Up / down by the previous candle's close, not the candle's own open. */
      prevClose: z.boolean().default(false),
      body: candlePart(true),
      borders: candlePart(false),
      wick: candlePart(true),
    })
    .prefault({}),
  /** Symbol: the decimals shown ('default': the pair's). */
  precision: z.union([z.literal('default'), z.number().int().min(0).max(8)]).default('default'),
  /** Symbol: the chart's time zone (null: the account's). */
  timezone: z.string().min(1).max(64).nullable().default(null),
  /** Status line: the instrument's row and the indicators' legends. */
  status: z
    .object({
      logo: z.boolean().default(true),
      title: z.boolean().default(true),
      titleMode: z.enum(TITLE_MODES).default('symbol'),
      marketStatus: z.boolean().default(false),
      values: z.boolean().default(false),
      barChange: z.boolean().default(false),
      volume: z.boolean().default(true),
      dayChange: z.boolean().default(false),
      indicatorTitles: z.boolean().default(true),
      indicatorInputs: z.boolean().default(true),
      indicatorValues: z.boolean().default(true),
      indicatorBackground: z.boolean().default(true),
      /** The legends' plate, % opaque. */
      backgroundOpacity: z.number().int().min(0).max(100).default(75),
    })
    .prefault({}),
  /** Canvas. */
  canvas: z
    .object({
      background: z
        .object({
          type: z.enum(['solid', 'gradient']).default('solid'),
          /** Solid: the colour; gradient: its top. */
          top: themed,
          bottom: themed,
        })
        .prefault({}),
      vertGrid: grid,
      horzGrid: grid,
      separators: themed,
      crosshair: z.object({ color: themed, width: z.number().int().min(1).max(4).default(1), style: z.enum(LINE_STYLES).default('dashed') }).prefault({}),
      watermark: z.object({ visible: z.boolean().default(false), color: themed }).prefault({}),
      scaleText: z.object({ color: themed, size: z.number().int().min(10).max(16).default(11) }).prefault({}),
      scaleLines: themed,
      /** The "go to the latest candle" button. */
      navigation: z.enum(BUTTON_VISIBILITY).default('always'),
      /** The legends' eye / settings / × buttons. */
      paneButtons: z.enum(BUTTON_VISIBILITY).default('always'),
      margins: z
        .object({
          /** % of the price pane left empty above / below the candles. */
          top: z.number().int().min(0).max(40).default(20),
          bottom: z.number().int().min(0).max(40).default(10),
          /** Bars left empty after the last candle. */
          right: z.number().int().min(0).max(200).default(24),
        })
        .prefault({}),
    })
    .prefault({}),
  /** Alerts: the messages at the bottom; FD-TRADESOUND: the coin sound when a trade ends (the chart open). */
  alerts: z.object({ autoHideToasts: z.boolean().default(true), tradeSound: z.boolean().default(true) }).prefault({}),
});
export type ChartStyle = z.infer<typeof chartStyleSchema>;

/** The defaults (the chart as it was before these settings). */
export const DEFAULT_CHART_STYLE: ChartStyle = chartStyleSchema.parse({});

/** A patch of the chart's settings (any part). */
export type ChartStylePatch = { [K in keyof ChartStyle]?: ChartStyle[K] extends object ? Partial<ChartStyle[K]> : ChartStyle[K] };

/**
 * Settings saved by another version that no longer read whole: each part (the candles, the precision, the time zone, the
 * status line, the canvas, the alerts) kept when it still reads, else its defaults.
 */
export function salvageChartStyle(stored: unknown): ChartStyle {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return DEFAULT_CHART_STYLE;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CHART_STYLE) as (keyof ChartStyle)[]) {
    const r = chartStyleSchema.safeParse({ [key]: (stored as Record<string, unknown>)[key] });
    out[key] = r.success ? r.data[key] : DEFAULT_CHART_STYLE[key];
  }
  return out as ChartStyle;
}
