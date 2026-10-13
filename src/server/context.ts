// Wires the services together (used by main.ts and by the API tests).
import type { AppConfig } from './config.ts';
import { AccountsService, defaultClientFactory, type BrokerFactory, type ClientFactory } from './exchange/accounts.ts';
import { CalendarService } from './calendar/service.ts';
import { EconomyService } from './economy/service.ts';
import { buildDayContext } from './summary/context.ts';
import { SummaryService } from './summary/service.ts';
import { Db } from './db/database.ts';
import type { Logger } from './log.ts';
import { MarketData } from './market/market.ts';
import { StockData } from './market/stocks.ts';
import { CoinRegistry } from './news/coin-registry.ts';
import { seedSources, syncStockSources } from './news/sources.ts';
import { Scheduler } from './jobs/scheduler.ts';
import { Scanner } from './scanner/scanner.ts';
import { SecretBox } from './secrets/crypto.ts';
import { DailySentimentService } from './sentiment/daily.ts';
import { TransformersNli, type NliScorer } from './sentiment/local.ts';
import { SentimentService } from './sentiment/service.ts';
import { SettingsService } from './settings.ts';
import { Mailer } from './auth/email.ts';
import { PasskeyService } from './auth/passkeys.ts';
import { Sessions } from './auth/sessions.ts';
import { Throttle } from './auth/throttle.ts';
import { UserService } from './auth/users.ts';
import { isActive } from './http/auth.ts';
import { OAuthService, type DocFetcher } from './mcp/oauth.ts';

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
  stocks: StockData;
  scanner: Scanner;
  accounts: AccountsService;
  scheduler: Scheduler;
  /** FD-ECON. */
  economy: EconomyService;
  /** FD-SUMMARY. */
  summary: SummaryService;
  /** FD-USERS. */
  users: UserService;
  sessions: Sessions;
  passkeys: PasskeyService;
  mailer: Mailer;
  throttle: Throttle;
  /** FD-MCP: the Claude connector's authorization server, only while the connector is on. */
  oauth: OAuthService | null;
}

export interface ContextOverrides {
  nli?: NliScorer;
  market?: MarketData;
  stocks?: StockData;
  clientFactory?: ClientFactory;
  brokerFactory?: BrokerFactory;
  box?: SecretBox;
  /** Waits before retrying a refused exchange read (TD-RATELIMIT); tests use zeros. */
  retryDelaysMs?: readonly number[];
  /** Reads the client documents of the apps asking to connect (FD-MCP); tests give their own. */
  fetchClientDoc?: DocFetcher;
}

const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL'];

export function createContext(config: AppConfig, log: Logger, overrides: ContextOverrides = {}): AppContext {
  const db = new Db(config.dbPath);
  const box = overrides.box ?? SecretBox.load(config.dataDir);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  seedSources(db);
  syncStockSources(db);
  const firstRun = db.get<{ n: number }>("SELECT count(*) AS n FROM settings WHERE key = 'app'")?.n === 0;
  const settings = new SettingsService(db, box);
  const users = new UserService(db, box);
  const admin = users.admin();
  if (firstRun) {
    settings.update({});
    const count = db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [admin.id])?.n ?? 0;
    if (count === 0) {
      DEFAULT_WATCHLIST.forEach((coin, i) =>
        db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, 'USDT', ?, '[]', ?, 'crypto')", [admin.id, coin, i, Date.now()]),
      );
    }
  }
  // FD-USERS §2: the personal settings so far kept globally become the admin's own.
  settings.migrateLegacyToAdmin(admin.id);
  // The admin's address can come from the environment before the first sign-in (FD-USERS §3).
  const adminEmail = process.env.SENTIQ_ADMIN_EMAIL;
  if (!admin.email && adminEmail) {
    try {
      users.setAdminEmail(adminEmail);
    } catch (err) {
      log.warn(`SENTIQ_ADMIN_EMAIL ignored: ${(err as Error).message}`);
    }
  }
  const coins = new CoinRegistry(db);
  const nli = overrides.nli ?? new TransformersNli(config.modelsDir, log);
  const sentiment = new SentimentService(db, settings, nli, log);
  const daily = new DailySentimentService(db, settings);
  const calendar = new CalendarService(db, log);
  const economy = new EconomyService(db, log);
  const market = overrides.market ?? new MarketData({ proxy, retryDelaysMs: overrides.retryDelaysMs });
  const stocks = overrides.stocks ?? new StockData({ db, key: () => settings.getTwelveDataKey() });
  const scanner = new Scanner(db, settings, market, log, stocks);
  const accounts = new AccountsService(db, box, log, overrides.clientFactory ?? defaultClientFactory(proxy), { retryDelaysMs: overrides.retryDelaysMs, brokerFactory: overrides.brokerFactory });
  const scheduler = new Scheduler(db, log);
  const summary = new SummaryService({ db, settings, log, build: (userId, now) => buildDayContext({ db, settings, daily, calendar, economy, scanner }, userId, now) });
  const sessions = new Sessions(db);
  const passkeys = new PasskeyService(db, users);
  const mailer = new Mailer(() => settings.getResend(), log);
  const throttle = new Throttle();
  const oauth =
    config.mcp.enabled && config.publicUrl
      ? new OAuthService({ db, log, issuer: config.publicUrl, clientHosts: config.mcp.clientHosts, userActive: (id) => isActive(users.byId(id)), fetchDoc: overrides.fetchClientDoc })
      : null;
  return { config, log, db, box, settings, coins, nli, sentiment, daily, calendar, economy, summary, market, stocks, scanner, accounts, scheduler, users, sessions, passkeys, mailer, throttle, oauth };
}
