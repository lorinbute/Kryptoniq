// Type-only bridge: the web app imports server DTO types from here (erased at build time).
export type { DaySentiment, HistoryPoint, TodayExplain } from '../server/sentiment/daily.ts';
export type { Driver, IndexResult, ScoreWhy, SubIndex, Confidence } from '../server/sentiment/daily-index.ts';
export type { NewsItemDto, NewsPage } from '../server/news/query.ts';
export type { EconIndicator, EconomyView } from '../server/economy/service.ts';
export type { StoredSummary, SummaryContent } from '../server/summary/service.ts';
export type { SummaryChart } from '../server/summary/context.ts';

/** FD-MARKETSRC: where the user's crypto prices come from (`/api/market/source`). */
export interface MarketSourceInfo {
  /** The exchange used for the pair asked about (without one: the user's). */
  exchange: string;
  /** The user's exchange: the connected one, the one chosen among several, or the default. */
  userExchange: string;
  /** Connected exchanges that can give prices, first added first (a choice is offered from two up). */
  connected: string[];
  defaultExchange: string;
  /** Candles loaded per chart. */
  candles: number;
  /** The timeframes `exchange` offers. */
  timeframes: import('./time.ts').Timeframe[];
}

export type { CalendarEvent } from '../server/calendar/merge.ts';
export type { CandlesResult, SymbolInfo } from '../server/market/market.ts';
export type { MarketContext, FearGreed, GlobalMarket } from '../server/market/context.ts';
export type { ScanResult, ScanRow } from '../server/scanner/scanner.ts';
export type { AccountView, Portfolio, BalanceRow, PositionRow, OrderRow, FillRow, TradeStats } from '../server/exchange/accounts.ts';
export type { StatsPeriod } from '../server/exchange/trade-stats.ts';
export type { SourceRow } from '../server/news/sources.ts';
export type { JobStatus } from '../server/jobs/scheduler.ts';
export type { ModelStatus } from '../server/sentiment/local.ts';
export type { StockQuote, StockSearchHit, MarketStatus } from '../server/market/stocks.ts';
export type { StockContext, StockFearGreed, IndexQuote } from '../server/market/stock-context.ts';

export interface WatchItem {
  coin: string;
  quote: string;
  position: number;
  aliases: string[];
  /** FD-SENTIQ §4.1 (rows saved before it are crypto); an index (FD-INDICES) has its id as `coin` ("^SPX"). */
  kind: 'crypto' | 'stock' | 'index';
  /** Company or index name; exchange (stocks only). */
  name: string | null;
  exchange: string | null;
}

/** Twelve Data credits of the day (UTC) and of the last minute. */
export type TdBudget = ReturnType<import('../server/market/stocks.ts').CreditBudget['status']>;

/** GET /api/stocks/info: the signed-in user's (FD-TDKEYS). */
export interface StocksInfo {
  timeframes: import('../shared/time.ts').Timeframe[];
  hasKey: boolean;
  market: import('../server/market/stocks.ts').MarketStatus | null;
  budget: TdBudget;
}

/** GET /api/stocks/quotes: a failed symbol comes back with `error` and empty values. */
export type StockQuoteRow = import('../server/market/stocks.ts').StockQuote & { error?: string };

export interface HealthSource {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastNewItemAt: number | null;
  lastError: string | null;
  failures: number;
  nextFetchAt: number;
  itemCount: number;
}

export interface Health {
  now: number;
  jobs: import('../server/jobs/scheduler.ts').JobStatus[];
  sources: HealthSource[];
  /** `aiUsers`: users whose own AI scores the news too (FD-AIKEYS); `?`: a server from before it. */
  sentiment: { engine: string; model: import('../server/sentiment/local.ts').ModelStatus; pending: number; aiUsers?: number };
  calendar: { ff: number | null; tv: number | null; earn: number | null; ffBlockedUntil: number | null };
  /** FD-AZURE §5: Azure SQL; the size is null when the database user may not read it. */
  db: { sizeBytes: number | null; maxSizeBytes?: number | null; server?: string; database?: string; edition?: string | null; objective?: string | null; news: number };
  /** TD-AZURE §6: the instance running the background jobs. */
  jobsLeader?: import('../server/jobs/scheduler.ts').JobsLeader;
  /** FD-TDKEYS: each user's own key; how many have one (`hasKey`… from a server before it). */
  twelveData: { users?: number; hasKey?: boolean };
}

// ── FD-AIKEYS ─────────────────────────────────────────────────────────────────────────────────────────

export type { AiModelList } from '../server/ai/service.ts';
export type { AiUsageDay, UsageCounts } from '../server/ai/usage.ts';
export type { AiScorerStatus } from '../server/sentiment/ai-scorer.ts';
export type { AiProgress } from '../server/sentiment/service.ts';
export type { WatchListView, WatchView } from '../server/watchlists/service.ts';
export type { ProfileQuarter, SymbolProfile } from '../server/market/profile.ts';

/** GET /api/ai/status: the user's own AI. */
export interface AiStatus {
  provider: import('./ai.ts').AiProvider;
  model: string;
  keySet: boolean;
  /** The user chose their AI for the news scores (it works only with the key: `keySet`). */
  scoring: boolean;
  /** How the scoring goes (null when it is not on). */
  scorer: import('../server/sentiment/ai-scorer.ts').AiScorerStatus | null;
  usage: import('../server/ai/usage.ts').AiUsageDay;
  /** How far the scoring got with the last 48 h (FD-AISLOW §4); null when it is not on (absent from older servers). */
  progress?: import('../server/sentiment/service.ts').AiProgress | null;
}

/** GET / POST /api/summary. */
export interface SummaryState {
  summary: import('../server/summary/service.ts').StoredSummary | null;
  hasKey: boolean;
  /** The user's provider and model (a server from before FD-AIKEYS sends none). */
  ai?: { provider: import('./ai.ts').AiProvider; model: string };
  retryAt: number | null;
}

export interface CalendarResponse {
  events: import('../server/calendar/merge.ts').CalendarEvent[];
  updated: { ff: number | null; tv: number | null; earn: number | null };
  ffBlockedUntil: number | null;
  ffWeeks: { start: number; end: number }[];
}

export interface FeedTest {
  ok: boolean;
  count: number;
  sample: string[];
  error?: string;
  /** FD-HTMLFEED: how the address reads ("feed RSS", "titlurile din pagină"…), how many items have a date, and a remark. */
  method?: string;
  dated?: number;
  note?: string;
}

// ── FD-USERS ──────────────────────────────────────────────────────────────────────────────────────────

export interface PublicUser {
  id: number;
  email: string | null;
  name: string;
  role: 'admin' | 'user';
  emailVerified: boolean;
  /** Has a password: an approved account gets one when it is activated (FD-INVITE §3). */
  activated: boolean;
  twoFactor: boolean;
  recoveryCodesLeft: number;
  passkeys: number;
  createdAt: number;
  lastLoginAt: number | null;
  disabled: boolean;
}

/** FD-INVITE §1: somebody asking for an account. */
export interface AccountRequest {
  id: number;
  email: string;
  name: string;
  createdAt: number;
}

/** FD-INVITE §2: an activation link the admin just made, and whether its mail went out. */
export interface ActivationSent {
  link: string;
  mailed: boolean;
  to: string | null;
}

/** GET /api/auth/state: who is signed in and what the sign-in page should offer. */
export interface AuthState {
  user: PublicUser | null;
  setupNeeded: boolean;
  /** The admin's first password can be set from here (this Mac). */
  setupHere: boolean;
  adminEmail: string | null;
  /** Passkeys work on this address (localhost or HTTPS, never a bare IP). */
  passkeys: boolean;
  /** The public address (FD-ONLINE §2), when there is one. Absent from a server before FD-ONLINE. */
  publicUrl?: string | null;
  /** Mail goes through Resend's test sender (or nowhere): only the Resend account's owner receives it. */
  devMail: boolean;
  passwordRule: string;
}

export interface TwoFactorView {
  enabled: boolean;
  confirmedAt: number | null;
  /** A secret waiting for its first code: the enrolment's, or (with `replacing`) the new authenticator's. */
  pending: boolean;
  /** FD-2FA §3: a change of authenticator started (the old one works until the new one is confirmed). */
  replacing: boolean;
  secret: string | null;
  uri: string | null;
  qr: string | null;
  recoveryCodesLeft: number;
}

export interface PasskeySummary {
  id: number;
  name: string;
  synced: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface AccountInfo {
  user: PublicUser;
  twoFactor: TwoFactorView;
  passkeys: PasskeySummary[];
  passkeysHere: boolean;
}

export type LoginResult = { status: 'ok'; user: PublicUser; usedRecoveryCode?: boolean } | { status: '2fa' };

/** POST /api/auth/activate: signed in straight away (FD-2FA §1), unless the browser was in another account. */
export type ActivateResult = { ok: true; email: string; signedIn: true; user: PublicUser } | { ok: true; email: string; signedIn: false };

/** POST /api/account/2fa/enable: the recovery codes (shown once) and the account with two-factor on. */
export interface TwoFactorEnabled {
  codes: string[];
  twoFactor: TwoFactorView;
  user: PublicUser;
}
