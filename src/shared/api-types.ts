// Type-only bridge: the web app imports server DTO types from here (erased at build time).
export type { DaySentiment, HistoryPoint } from '../server/sentiment/daily.ts';
export type { Driver, IndexResult, SubIndex, Confidence } from '../server/sentiment/daily-index.ts';
export type { NewsItemDto, NewsPage } from '../server/news/query.ts';
export type { CalendarEvent } from '../server/calendar/merge.ts';
export type { CandlesResult, SymbolInfo } from '../server/market/market.ts';
export type { MarketContext, FearGreed, GlobalMarket } from '../server/market/context.ts';
export type { ScanResult, ScanRow } from '../server/scanner/scanner.ts';
export type { AccountView, Portfolio, BalanceRow, PositionRow, OrderRow, FillRow } from '../server/exchange/accounts.ts';
export type { SourceRow } from '../server/news/sources.ts';
export type { JobStatus } from '../server/jobs/scheduler.ts';
export type { ModelStatus } from '../server/sentiment/local.ts';

export interface WatchItem {
  coin: string;
  quote: string;
  position: number;
  aliases: string[];
}

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
  calendar: { ff: number | null; tv: number | null; ffBlockedUntil: number | null };
  db: { sizeBytes: number; news: number };
}

export interface CalendarResponse {
  events: import('../server/calendar/merge.ts').CalendarEvent[];
  updated: { ff: number | null; tv: number | null };
  ffBlockedUntil: number | null;
  ffWeeks: { start: number; end: number }[];
}

export interface FeedTest {
  ok: boolean;
  count: number;
  sample: string[];
  error?: string;
}
