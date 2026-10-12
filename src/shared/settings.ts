// Application settings schema shared by server (validation/persistence) and web (forms).
import { z } from 'zod';
import { slingshotParamsSchema } from './indicator/params.ts';
import { lmaParamsSchema } from './indicator/lma-params.ts';
import { TIMEFRAMES } from './time.ts';

export const MARKET_EXCHANGES = ['kucoin', 'binance', 'bybit', 'okx'] as const;
export const ACCOUNT_EXCHANGES = ['kucoin'] as const;
export const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'] as const;
export type Impact = (typeof IMPACTS)[number];
export const CALENDAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'ALL'] as const;
export const CANDLE_COUNTS = [1500, 3000, 5000] as const;
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

/** A spot pair as the charts address it (BASE/QUOTE in capitals). */
export const CHART_SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]{0,29}\/[A-Z0-9]{1,15}$/;

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(64).default('UTC'),
  retentionDays: z.number().int().min(7).max(365).default(90),
  sentiment: z
    .object({
      engine: z.enum(['local', 'claude']).default('local'),
      claudeModel: z.enum(CLAUDE_MODELS).default(DEFAULT_CLAUDE_MODEL),
    })
    .prefault({}),
  market: z
    .object({
      exchange: z.enum(MARKET_EXCHANGES).default('kucoin'),
      defaultTf: z.enum(TIMEFRAMES).default('1h'),
      candles: z.union([z.literal(1500), z.literal(3000), z.literal(5000)]).default(1500),
    })
    .prefault({}),
  scanner: z.object({ tf: z.enum(TIMEFRAMES).default('1h') }).prefault({}),
  calendar: z
    .object({
      impacts: z.array(z.enum(IMPACTS)).max(IMPACTS.length).default(['High', 'Medium']),
      currencies: z.array(z.enum(CALENDAR_CURRENCIES)).max(CALENDAR_CURRENCIES.length).default(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ALL']),
    })
    .prefault({}),
  indicator: slingshotParamsSchema.prefault({}),
  lma: lmaParamsSchema.prefault({}),
  /** What the Charts page remembers (FD-CHARTUX §2); the timeframe is `market.defaultTf`. */
  charts: z
    .object({
      symbol: z.union([z.literal(''), z.string().regex(CHART_SYMBOL_RE)]).default(''),
      showPositions: z.boolean().default(true),
      showLma: z.boolean().default(true),
      /** Share of the chart height given to the LMA pane. */
      lmaPane: z.number().min(0.1).max(0.7).default(0.25),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Settings as returned by the API (secrets replaced by presence flags). */
export interface SettingsView extends Settings {
  claudeKeySet: boolean;
  claudeKeyHint: string | null;
}
