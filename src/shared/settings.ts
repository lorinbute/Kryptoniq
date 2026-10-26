// Application settings schema shared by server (validation/persistence) and web (forms).
import { z } from 'zod';
import { slingshotParamsSchema } from './indicator/params.ts';
import { lmaParamsSchema } from './indicator/lma-params.ts';
import { TIMEFRAMES } from './time.ts';
import { AI_MODEL_RE, AI_PROVIDERS, type AiProvider } from './ai.ts';
import { studiesSchema, studyFavoritesSchema, studyMemorySchema } from './studies.ts';
import { orderTicketMemorySchema } from './trading.ts';
import { stockNewsSchema } from './stock-indices.ts';
import { chartLinesSchemaFor, hlineStyleSchema } from './hlines.ts';
import { chartStyleSchema } from './chart-style.ts';

/** The exchanges crypto prices can come from (FD-MARKETSRC §1: Kraken and Coinbase lack the pairs and the history). */
export const MARKET_EXCHANGES = ['kucoin', 'binance', 'bybit', 'okx', 'bitget'] as const;
export type MarketExchange = (typeof MARKET_EXCHANGES)[number];
/** The timeframes of the Slingshot signals on Today (FD-MARKETSRC §2): every price exchange has them. */
export const SCANNER_TFS = ['15m', '1h', '4h', '1d'] as const;
export const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'] as const;
export type Impact = (typeof IMPACTS)[number];
export const CALENDAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'ALL'] as const;
export const CANDLE_COUNTS = [1500, 3000, 5000] as const;

/** The pair of a crypto chart ("BTC/USDT"), since FD-SENTIQ a stock ("stock:AAPL"), since FD-INDICES an index ("index:SPX"). */
export const CHART_SYMBOL_RE = /^(?:[A-Z0-9][A-Z0-9._-]{0,29}\/[A-Z0-9]{1,15}|stock:[A-Z][A-Z0-9.-]{0,9}|index:[A-Z]{2,6})$/;

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(64).default('UTC'),
  retentionDays: z.number().int().min(7).max(365).default(90),
  /**
   * Each user's own AI (FD-AIKEYS): the provider whose key is used, the model (absent or another provider's: the
   * provider's default) and whether it also scores the news (else the local model does). The keys are kept apart.
   */
  ai: z
    .object({
      provider: z.enum(AI_PROVIDERS).default('anthropic'),
      model: z.string().regex(AI_MODEL_RE).optional(),
      scoring: z.boolean().default(false),
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
      /** On the chart but not drawn, hidden with the legend's eye (FD-PREMIUMHIDE). */
      slingshotHidden: z.boolean().default(false),
      lmaHidden: z.boolean().default(false),
      /** Share of the chart height given to the LMA pane. */
      lmaPane: z.number().min(0.1).max(0.7).default(0.25),
      /** The price scale is logarithmic ("L" under it, FD-CHARTTV §4). */
      logScale: z.boolean().default(false),
      /** The watch list the symbol panel shows (FD-WATCHLISTS §4); null, or one deleted since: the first. */
      listId: z.number().int().positive().nullable().default(null),
    })
    .prefault({}),
  /**
   * The indicators on the charts besides Slingshot and LMA (FD-INDICATORS §4), in the order they were added. A key of its
   * own: a list that no longer parses falls back without taking the chart prefs with it.
   */
  studies: studiesSchema.default([]),
  /** The indicators starred in the "Indicatori" list (FD-STUDYUX §1); a key of its own, like `studies`. */
  studyFavorites: studyFavoritesSchema.default([]),
  /** The last settings of each indicator, for when it is added again (FD-STUDYMEMORY). */
  studyMemory: studyMemorySchema.default([]),
  /** The order form's last choices, per account (FD-TICKETMEMORY). */
  orderTicket: orderTicketMemorySchema.prefault({}),
  /** The stock news and score: all, or only the companies of the indices picked (FD-INDEXNEWS). */
  stockNews: stockNewsSchema.prefault({}),
  /** The horizontal lines drawn on each chart, by symbol (FD-HLINE); a patch of one symbol replaces its list. */
  chartLines: chartLinesSchemaFor(CHART_SYMBOL_RE).prefault({}),
  /** The style new horizontal lines start with ("Salvează ca șablon", FD-HLINE §4); null: the initial one. */
  hlineTemplate: hlineStyleSchema.nullable().default(null),
  /** How the chart looks (FD-CHARTSETTINGS); a key of its own, like `studies`. */
  chartStyle: chartStyleSchema.prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** A user's own AI key of one provider (FD-AIKEYS): whether it is saved, and its last characters. */
export interface AiKeyView {
  set: boolean;
  hint: string | null;
}

/** Settings as returned by the API (secrets replaced by presence flags). */
export interface SettingsView extends Settings {
  /** The user's own AI keys, one per provider (FD-AIKEYS). */
  aiKeys: Record<AiProvider, AiKeyView>;
  twelveDataKeySet: boolean;
  twelveDataKeyHint: string | null;
  /** FD-USERS §4: the Resend key (hint only for the admin) and the sender. Absent from a server before FD-USERS. */
  resendKeySet?: boolean;
  resendKeyHint?: string | null;
  resendFrom?: string;
  /** Mail reaches only the Resend account's owner (no key, or Resend's test sender). */
  resendDev?: boolean;
}
