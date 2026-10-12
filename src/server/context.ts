// Wires the services together (used by main.ts and by the API tests).
import type { AppConfig } from './config.ts';
import { AccountsService, defaultClientFactory, type ClientFactory } from './exchange/accounts.ts';
import { CalendarService } from './calendar/service.ts';
import { Db } from './db/database.ts';
import type { Logger } from './log.ts';
import { MarketData } from './market/market.ts';
import { CoinRegistry } from './news/coin-registry.ts';
import { seedSources } from './news/sources.ts';
import { Scheduler } from './jobs/scheduler.ts';
import { Scanner } from './scanner/scanner.ts';
import { SecretBox } from './secrets/crypto.ts';
import { DailySentimentService } from './sentiment/daily.ts';
import { TransformersNli, type NliScorer } from './sentiment/local.ts';
import { SentimentService } from './sentiment/service.ts';
import { SettingsService } from './settings.ts';

export interface AppContext {
  config: AppConfig;
  log: Logger;
  db: Db;
  box: SecretBox;
  settings: SettingsService;
  coins: CoinRegistry;
  nli: NliScorer;
  sentiment: SentimentService;
  daily: DailySentimentService;
  calendar: CalendarService;
  market: MarketData;
  scanner: Scanner;
  accounts: AccountsService;
  scheduler: Scheduler;
}

export interface ContextOverrides {
  nli?: NliScorer;
  market?: MarketData;
  clientFactory?: ClientFactory;
  box?: SecretBox;
  /** Waits before retrying a refused exchange read (TD-RATELIMIT); tests use zeros. */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL'];

export function createContext(config: AppConfig, log: Logger, overrides: ContextOverrides = {}): AppContext {
  const db = new Db(config.dbPath);
  const box = overrides.box ?? SecretBox.load(config.dataDir);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  seedSources(db);
  const firstRun = db.get<{ n: number }>("SELECT count(*) AS n FROM settings WHERE key = 'app'")?.n === 0;
  const settings = new SettingsService(db, box);
  if (firstRun) {
    settings.update({});
    const count = db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist')?.n ?? 0;
    if (count === 0) {
      DEFAULT_WATCHLIST.forEach((coin, i) => db.run('INSERT INTO watchlist(coin, quote, position, aliases, added_at) VALUES (?, ?, ?, ?, ?)', [coin, 'USDT', i, '[]', Date.now()]));
    }
  }
  const coins = new CoinRegistry(db);
  const nli = overrides.nli ?? new TransformersNli(config.modelsDir, log);
  const sentiment = new SentimentService(db, settings, nli, log);
  const daily = new DailySentimentService(db, settings);
  const calendar = new CalendarService(db, log);
  const market = overrides.market ?? new MarketData({ proxy, retryDelaysMs: overrides.retryDelaysMs });
  const scanner = new Scanner(db, settings, market, log);
  const accounts = new AccountsService(db, box, log, overrides.clientFactory ?? defaultClientFactory(proxy), { retryDelaysMs: overrides.retryDelaysMs });
  const scheduler = new Scheduler(db, log);
  return { config, log, db, box, settings, coins, nli, sentiment, daily, calendar, market, scanner, accounts, scheduler };
}
