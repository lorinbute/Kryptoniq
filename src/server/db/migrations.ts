// Append-only list of schema migrations; index + 1 = PRAGMA user_version after it runs.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('crypto','macro','geopolitics')),
    enabled INTEGER NOT NULL DEFAULT 1,
    weight REAL NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    etag TEXT,
    last_modified TEXT,
    last_attempt_at INTEGER,
    last_success_at INTEGER,
    last_new_item_at INTEGER,
    last_error TEXT,
    failures INTEGER NOT NULL DEFAULT 0,
    next_fetch_at INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE news (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    guid TEXT,
    url TEXT,
    canonical_url TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    published_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    category TEXT NOT NULL,
    relevance REAL NOT NULL,
    impact REAL NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    cluster_id TEXT NOT NULL,
    sentiment REAL,
    sentiment_label TEXT,
    sentiment_engine TEXT,
    sentiment_meta TEXT,
    scored_at INTEGER
  );
  CREATE INDEX news_published ON news(published_at);
  CREATE INDEX news_cluster ON news(cluster_id);
  CREATE INDEX news_canonical ON news(canonical_url);
  CREATE INDEX news_unscored ON news(sentiment_engine, published_at);
  CREATE INDEX news_source ON news(source_id, published_at);

  CREATE TABLE news_coins (
    news_id TEXT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
    coin TEXT NOT NULL,
    PRIMARY KEY (news_id, coin)
  );
  CREATE INDEX news_coins_coin ON news_coins(coin);

  CREATE TABLE daily_sentiment (
    day TEXT NOT NULL,
    tz TEXT NOT NULL,
    value REAL NOT NULL,
    raw REAL NOT NULL,
    confidence TEXT NOT NULL,
    counts TEXT NOT NULL,
    breakdown TEXT NOT NULL,
    drivers TEXT NOT NULL,
    computed_at INTEGER NOT NULL,
    final INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, tz)
  );

  CREATE TABLE calendar_raw (
    source TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    title TEXT NOT NULL,
    currency TEXT NOT NULL,
    country TEXT,
    ts INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    impact TEXT NOT NULL,
    forecast TEXT,
    previous TEXT,
    actual TEXT,
    unit TEXT,
    scale TEXT,
    period TEXT,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (source, ext_id)
  );
  CREATE INDEX calendar_raw_ts ON calendar_raw(ts);

  CREATE TABLE calendar_custom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    ts INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    impact TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CRYPTO',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX calendar_custom_ts ON calendar_custom(ts);

  CREATE TABLE job_state (
    name TEXT PRIMARY KEY,
    last_start INTEGER,
    last_end INTEGER,
    last_ok INTEGER,
    last_error TEXT,
    runs INTEGER NOT NULL DEFAULT 0,
    data TEXT
  );

  CREATE TABLE watchlist (
    coin TEXT PRIMARY KEY,
    quote TEXT NOT NULL DEFAULT 'USDT',
    position INTEGER NOT NULL DEFAULT 0,
    aliases TEXT NOT NULL DEFAULT '[]',
    added_at INTEGER NOT NULL
  );

  CREATE TABLE exchange_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL,
    secret TEXT NOT NULL,
    password TEXT,
    key_hint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER,
    last_error TEXT,
    permissions TEXT
  );

  CREATE TABLE cost_basis (
    account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    avg_price REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, asset)
  );

  CREATE TABLE market_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  `,
];
