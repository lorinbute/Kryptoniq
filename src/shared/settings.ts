// Application settings schema shared by server (validation/persistence) and web (forms).
import { z } from 'zod';
import { slingshotParamsSchema } from './indicator/params.ts';
import { lmaParamsSchema } from './indicator/lma-params.ts';
import { TIMEFRAMES } from './time.ts';

/** The exchanges crypto prices can come from (FD-MARKETSRC §1: Kraken and Coinbase lack the pairs and the history). */
export const MARKET_EXCHANGES = ['kucoin', 'binance', 'bybit', 'okx', 'bitget'] as const;
export type MarketExchange = (typeof MARKET_EXCHANGES)[number];
/** The timeframes of the Slingshot signals on Today (FD-MARKETSRC §2): every price exchange has them. */
export const SCANNER_TFS = ['15m', '1h', '4h', '1d'] as const;
export const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'] as const;
export type Impact = (typeof IMPACTS)[number];
export const CALENDAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'ALL'] as const;
export const CANDLE_COUNTS = [1500, 3000, 5000] as const;
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

/** The pair of a crypto chart ("BTC/USDT"), since FD-SENTIQ a stock ("stock:AAPL"), since FD-INDICES an index ("index:SPX"). */
export const CHART_SYMBOL_RE = /^(?:[A-Z0-9][A-Z0-9._-]{0,29}\/[A-Z0-9]{1,15}|stock:[A-Z][A-Z0-9.-]{0,9}|index:[A-Z]{2,6})$/;

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(64).default('UTC'),
  retentionDays: z.number().int().min(7).max(365).default(90),
  sentiment: z
    .object({
      engine: z.enum(['local', 'claude']).default('local'),
      claudeModel: z.enum(CLAUDE_MODELS).default(DEFAULT_CLAUDE_MODEL),
    })
    .prefault({}),
  /**
   * Each user's: `exchange` is the one chosen among several connected exchanges (FD-MARKETSRC §2; absent until one is
   * chosen: the first added counts), `defaultTf` the chart's last timeframe.
   */
  market: z
    .object({
      exchange: z.enum(MARKET_EXCHANGES).optional(),
      defaultTf: z.enum(TIMEFRAMES).default('1h'),
    })
    .prefault({}),
  /** Everyone's (the admin's to set): the exchange for those without one of their own, and the chart history. */
  marketData: z
    .object({
      exchange: z.enum(MARKET_EXCHANGES).default('kucoin'),
      candles: z.union([z.literal(1500), z.literal(3000), z.literal(5000)]).default(1500),
    })
    .prefault({}),
  scanner: z.object({ tf: z.enum(TIMEFRAMES).default('1h') }).prefault({}),
  calendar: z
    .object({
      impacts: z.array(z.enum(IMPACTS)).max(IMPACTS.length).default(['High', 'Medium']),
      currencies: z.array(z.enum(CALENDAR_CURRENCIES)).max(CALENDAR_CURRENCIES.length).default(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ALL']),
      /** Quarterly results of the watchlist stocks (FD-SENTIQ §4.5). */
      earnings: z.boolean().default(true),
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
      /** Slingshot drawn on the chart (FD-CHARTFAV §1); the panels below the chart stay. */
      showSlingshot: z.boolean().default(true),
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
  twelveDataKeySet: boolean;
  twelveDataKeyHint: string | null;
  /** FD-USERS §4: the Resend key (hint only for the admin) and the sender. Absent from a server before FD-USERS. */
  resendKeySet?: boolean;
  resendKeyHint?: string | null;
  resendFrom?: string;
  /** Mail reaches only the Resend account's owner (no key, or Resend's test sender). */
  resendDev?: boolean;
}
