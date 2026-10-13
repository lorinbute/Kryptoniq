// Type-only bridge: the web app imports server DTO types from here (erased at build time).
export type { DaySentiment, HistoryPoint } from '../server/sentiment/daily.ts';
export type { Driver, IndexResult, SubIndex, Confidence } from '../server/sentiment/daily-index.ts';
export type { NewsItemDto, NewsPage } from '../server/news/query.ts';
export type { EconIndicator, EconomyView } from '../server/economy/service.ts';
export type { StoredSummary, SummaryContent } from '../server/summary/service.ts';
export type { SummaryChart } from '../server/summary/context.ts';
import type { Connection as McpConnection } from '../server/mcp/oauth.ts';
export type { McpConnection };

/** FD-MCP §5: the Claude connector on the Security page. */
export type McpStatus = { enabled: false } | { enabled: true; url: string; connections: McpConnection[] };

/** FD-MCP §4: an app asking to connect, as the consent page shows it. */
export interface OAuthRequestInfo {
  client: { name: string; host: string; kind: 'cimd' | 'dcr' };
  redirectHost: string;
  /** The callback is this computer (Claude Code). */
  loopback: boolean;
  scopes: string[];
  account: { name: string; email: string | null };
}
export type { CalendarEvent } from '../server/calendar/merge.ts';
export type { CandlesResult, SymbolInfo } from '../server/market/market.ts';
export type { MarketContext, FearGreed, GlobalMarket } from '../server/market/context.ts';
export type { ScanResult, ScanRow } from '../server/scanner/scanner.ts';
export type { AccountView, Portfolio, BalanceRow, PositionRow, OrderRow, FillRow } from '../server/exchange/accounts.ts';
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
  /** FD-SENTIQ §4.1; rows saved before it are crypto. */
  kind: 'crypto' | 'stock';
  /** Company name and exchange (stocks only). */
  name: string | null;
  exchange: string | null;
}

/** Twelve Data credits of the day (UTC) and of the last minute. */
export type TdBudget = ReturnType<import('../server/market/stocks.ts').CreditBudget['status']>;

/** GET /api/stocks/info */
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
  sentiment: { engine: string; model: import('../server/sentiment/local.ts').ModelStatus; pending: number; claude: import('../server/sentiment/claude.ts').ClaudeStatus | null };
  calendar: { ff: number | null; tv: number | null; earn: number | null; ffBlockedUntil: number | null };
  db: { sizeBytes: number; news: number };
  twelveData: TdBudget & { hasKey: boolean };
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
  /** Mail goes through Resend's test sender (or nowhere): only the Resend account's owner receives it. */
  devMail: boolean;
  passwordRule: string;
}

export interface TwoFactorView {
  enabled: boolean;
  confirmedAt: number | null;
  pending: boolean;
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
