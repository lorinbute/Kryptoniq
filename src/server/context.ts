// Wires the services together (used by main.ts and by the API tests).
import type { AppConfig } from './config.ts';
import { AiService, type AiServiceDeps } from './ai/service.ts';
import { AccountsService, defaultClientFactory, type BrokerFactory, type ClientFactory } from './exchange/accounts.ts';
import { TradingService, type TraderFactory } from './exchange/trading/service.ts';
import { CalendarService } from './calendar/service.ts';
import { WatchlistService } from './watchlists/service.ts';
import { RetagQueue } from './news/retag-queue.ts';
import { retagRecent } from './news/ingest.ts';
import { SymbolProfiles } from './market/profile.ts';
import { EconomyService } from './economy/service.ts';
import { buildDayContext } from './summary/context.ts';
import { SummaryService } from './summary/service.ts';
import { Db } from './db/database.ts';
import type { Logger } from './log.ts';
import { MarketData } from './market/market.ts';
import { MarketSource } from './market/source.ts';
import { StockData } from './market/stocks.ts';
import { CoinRegistry } from './news/coin-registry.ts';
import { IndexMembersService } from './news/index-members.ts';
import { stockScopeFor } from './news/stock-scope.ts';
import { seedSources, syncStockSources } from './news/sources.ts';
import { Scheduler } from './jobs/scheduler.ts';
import { Scanner } from './scanner/scanner.ts';
import { BotEngine } from './bots/engine.ts';
import { BotService } from './bots/service.ts';
import { SecretBox } from './secrets/crypto.ts';
import { DailySentimentService } from './sentiment/daily.ts';
import { TransformersNli, type NliScorer } from './sentiment/local.ts';
import { SentimentService } from './sentiment/service.ts';
import { publishPublicInstance, SettingsService } from './settings.ts';
import { Mailer } from './auth/email.ts';
import { PasskeyService } from './auth/passkeys.ts';
import { Sessions } from './auth/sessions.ts';
import { Throttle } from './auth/throttle.ts';
import { UserService } from './auth/users.ts';

export interface AppContext {
  config: AppConfig;
  log: Logger;
  db: Db;
  box: SecretBox;
  settings: SettingsService;
  coins: CoinRegistry;
  /** FD-INDEXNEWS: the companies of the filter indices. */
  indexMembers: IndexMembersService;
  nli: NliScorer;
  /** FD-AIKEYS: each user's own AI (provider, model, key, what it spent). */
  ai: AiService;
  sentiment: SentimentService;
  daily: DailySentimentService;
  calendar: CalendarService;
  market: MarketData;
  /** FD-MARKETSRC: which exchange each user's crypto prices come from. */
  marketSource: MarketSource;
  stocks: StockData;
  scanner: Scanner;
  accounts: AccountsService;
  /** FD-TRADING: orders on the accounts where trading was switched on. */
  trading: TradingService;
  /** FD-BOT: the trading bots (the engine runs them in the `bots` job). */
  botEngine: BotEngine;
  bots: BotService;
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
  /** FD-WATCHLISTS: each user's lists of symbols. */
  watchlists: WatchlistService;
  /** FD-WATCHLISTS §3: a symbol's description and quarterly results. */
  profiles: SymbolProfiles;
  /** The last 7 days of news tagged again after the symbols followed change, in the background. */
  retag: RetagQueue;
}

export interface ContextOverrides {
  nli?: NliScorer;
  market?: MarketData;
  stocks?: StockData;
  clientFactory?: ClientFactory;
  brokerFactory?: BrokerFactory;
  /** FD-TRADING: the traders (tests: simulated platforms). */
  traderFactory?: TraderFactory;
  box?: SecretBox;
  /** Waits before retrying a refused exchange read (TD-RATELIMIT); tests use zeros. */
  retryDelaysMs?: readonly number[];
  /** An open database (tests: their own schema); otherwise `config.db` is opened (TD-AZURE §8). */
  db?: Db;
  /** The users' AI clients and the network of their model lists (tests). */
  ai?: Pick<AiServiceDeps, 'clientFactory' | 'http' | 'anthropicSdk'>;
}

const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL'];

/** Rows holding something encrypted with the master key: exchange / broker accounts, the app's keys, TOTP secrets. */
export async function encryptedSecrets(db: Db): Promise<number> {
  return (
    (
      await db.get<{ n: number }>(
        `SELECT (SELECT count(*) FROM exchange_accounts)
              + (SELECT count(*) FROM settings WHERE [key] IN (N'claude_key', N'resend_key', N'twelvedata_key'))
              + (SELECT count(*) FROM user_keys)
              + (SELECT count(*) FROM users WHERE totp_secret IS NOT NULL) AS n`,
      )
    )?.n ?? 0
  );
}

export async function createContext(config: AppConfig, log: Logger, overrides: ContextOverrides = {}): Promise<AppContext> {
  let db = overrides.db;
  if (!db) {
    if (!config.db) throw new Error(config.dbError ?? 'Baza de date nu e configurată.');
    db = await Db.open(config.db);
  }
  // FD-AZURE §2: a new master key next to secrets saved with another one would make them unreadable for good (Azure
  // without SENTIQ_MASTER_KEY, a second computer without data/master.key): refuse instead.
  if (!overrides.box && !SecretBox.available(config.dataDir) && (await encryptedSecrets(db)) > 0) {
    throw new Error('Cheia master lipsește (SENTIQ_MASTER_KEY sau data/master.key), dar baza are deja chei criptate cu ea: pune aceeași cheie, altfel nu mai pot fi citite.');
  }
  const box = overrides.box ?? SecretBox.load(config.dataDir);
  // FD-DBHEAL: a stuck session ended by this instance goes to the log.
  db.onWarn = (message) => log.warn(message);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  await seedSources(db);
  for (const sym of await syncStockSources(db)) log.info(`news: removed the automatic feed of ${sym} (in nobody's favourites)`);
  // FD-ONLINE §2: the public address (Azure) for the instances without one (the Mac).
  await publishPublicInstance(db, config);
  const firstRun = (await db.get<{ n: number }>("SELECT count(*) AS n FROM settings WHERE [key] = N'app'"))?.n === 0;
  const settings = new SettingsService(db, box);
  const users = new UserService(db, box);
  const admin = await users.admin();
  if (firstRun) {
    await settings.update({});
    const d = db;
    await db.tx(async () => {
      const count = (await d.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [admin.id]))?.n ?? 0;
      if (count > 0) return;
      for (const [i, coin] of DEFAULT_WATCHLIST.entries()) {
        await d.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (?, ?, N'USDT', ?, N'[]', ?, N'crypto')", [admin.id, coin, i, Date.now()]);
      }
    });
  }
  // FD-USERS §2: the personal settings so far kept globally become the admin's own.
  await settings.migrateLegacyToAdmin(admin.id);
  // FD-AIKEYS: the AI key and engine, so far everyone's (the admin's), become the admin's own. Before any other write
  // of the global settings: a write keeps only what the schema knows, and the old engine is no longer in it.
  const ai = new AiService({ db, settings, log, ...overrides.ai });
  if (await ai.migrateLegacy(admin.id)) log.info('ai: the Claude key and engine are now the admin\'s own (Settings → Mine → AI)');
  // FD-TDKEYS: the Twelve Data key, so far everyone's, becomes the admin's own.
  if (await settings.migrateTwelveData(admin.id)) log.info("twelvedata: the key is now the admin's own (Settings → Mine)");
  // FD-MARKETSRC: the exchange and the chart history become everyone's, from the admin's.
  await settings.migrateMarketData(admin.id);
  // The admin's address can come from the environment before the first sign-in (FD-USERS §3).
  const adminEmail = process.env.SENTIQ_ADMIN_EMAIL;
  if (!admin.email && adminEmail) {
    try {
      await users.setAdminEmail(adminEmail);
    } catch (err) {
      log.warn(`SENTIQ_ADMIN_EMAIL ignored: ${(err as Error).message}`);
    }
  }
  const indexMembers = new IndexMembersService(db);
  const coins = new CoinRegistry(db, Date.now, indexMembers);
  const nli = overrides.nli ?? new TransformersNli(config.modelsDir, log);
  const sentiment = new SentimentService(db, ai, nli, log);
  // FD-INDEXNEWS: a user's own index also when only their stock news are limited to indices.
  const daily = new DailySentimentService(db, settings, ai, (userId) => stockScopeFor(db, settings, userId));
  const calendar = new CalendarService(db, log);
  const economy = new EconomyService(db, log);
  const market = overrides.market ?? new MarketData({ proxy, retryDelaysMs: overrides.retryDelaysMs });
  // FD-TDKEYS: each user's Twelve Data key.
  const stocks = overrides.stocks ?? new StockData({ db, key: (userId) => settings.getTwelveDataKey(userId) });
  const marketSource = new MarketSource(db, settings, market);
  const scanner = new Scanner(db, settings, market, log, stocks, marketSource);
  const accounts = new AccountsService(db, box, log, overrides.clientFactory ?? defaultClientFactory(proxy), { retryDelaysMs: overrides.retryDelaysMs, brokerFactory: overrides.brokerFactory });
  const trading = new TradingService({ db, accounts, log, traderFactory: overrides.traderFactory });
  const scheduler = new Scheduler(db, log);
  const botEngine = new BotEngine({ db, log, settings, market, stocks, source: marketSource, daily, calendar, ai, trading, accounts });
  const bots = new BotService(db, botEngine);
  const summary = new SummaryService({ db, ai, log, build: (userId, now) => buildDayContext({ db, settings, daily, calendar, economy, scanner }, userId, now) });
  const sessions = new Sessions(db);
  const passkeys = new PasskeyService(db, users);
  const mailer = new Mailer(() => settings.getResend(), log);
  const throttle = new Throttle();
  const watchlists = new WatchlistService(db);
  const profiles = new SymbolProfiles(db, ai, log, stocks.nasdaq);
  const retag = new RetagQueue(async () => retagRecent(db, await coins.get(), Date.now() - 7 * 86_400_000, await coins.classifier()), log);
  return {
    config,
    log,
    db,
    box,
    settings,
    coins,
    indexMembers,
    nli,
    ai,
    sentiment,
    daily,
    calendar,
    economy,
    summary,
    market,
    marketSource,
    stocks,
    scanner,
    accounts,
    trading,
    botEngine,
    bots,
    scheduler,
    users,
    sessions,
    passkeys,
    mailer,
    throttle,
    watchlists,
    profiles,
    retag,
  };
}
