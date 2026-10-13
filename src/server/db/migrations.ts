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
  // 2 — FD-SENTIQ: generic account credentials + environment, stocks in the watchlist, a 'stocks' news category
  // (the CHECK constraint needs the table rebuilt) and sources managed automatically (Nasdaq feed per stock).
  `
  ALTER TABLE exchange_accounts ADD COLUMN credentials TEXT;
  ALTER TABLE exchange_accounts ADD COLUMN env TEXT NOT NULL DEFAULT 'live';

  ALTER TABLE watchlist ADD COLUMN kind TEXT NOT NULL DEFAULT 'crypto';
  ALTER TABLE watchlist ADD COLUMN name TEXT;
  ALTER TABLE watchlist ADD COLUMN exchange TEXT;

  CREATE TABLE sources_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('crypto','macro','geopolitics','stocks')),
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
    item_count INTEGER NOT NULL DEFAULT 0,
    auto TEXT
  );
  INSERT INTO sources_new (id, name, url, category, enabled, weight, builtin, etag, last_modified, last_attempt_at, last_success_at,
                           last_new_item_at, last_error, failures, next_fetch_at, item_count)
    SELECT id, name, url, category, enabled, weight, builtin, etag, last_modified, last_attempt_at, last_success_at,
           last_new_item_at, last_error, failures, next_fetch_at, item_count FROM sources;
  DROP TABLE sources;
  ALTER TABLE sources_new RENAME TO sources;
  `,
  // 3 — FD-USERS: accounts, sessions, passkeys, one-time links and per-user data. The admin (id 1) exists from the
  // start, without email or password, so everything already in the database becomes theirs.
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    email_verified_at INTEGER,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER,
    disabled_at INTEGER,
    totp_secret TEXT,
    totp_confirmed_at INTEGER,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT,
    passkey_user_handle BLOB
  );
  INSERT INTO users (id, email, name, role, email_verified_at, created_at) VALUES (1, NULL, '', 'admin', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

  CREATE TABLE user_tokens (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('full','pending')),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);

  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    value TEXT NOT NULL
  );

  CREATE TABLE watchlist_new (
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
    coin TEXT NOT NULL,
    quote TEXT NOT NULL DEFAULT 'USDT',
    position INTEGER NOT NULL DEFAULT 0,
    aliases TEXT NOT NULL DEFAULT '[]',
    added_at INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'crypto',
    name TEXT,
    exchange TEXT,
    PRIMARY KEY (user_id, coin)
  );
  INSERT INTO watchlist_new (user_id, coin, quote, position, aliases, added_at, kind, name, exchange)
    SELECT 1, coin, quote, position, aliases, added_at, kind, name, exchange FROM watchlist;
  DROP TABLE watchlist;
  ALTER TABLE watchlist_new RENAME TO watchlist;

  ALTER TABLE exchange_accounts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE;
  CREATE INDEX exchange_accounts_user ON exchange_accounts(user_id);
  ALTER TABLE calendar_custom ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE;
  CREATE INDEX calendar_custom_user ON calendar_custom(user_id, ts);
  `,
  // 4 — FD-IMPACT: the importance the sentiment engine (Claude) gives a news item, used by the daily index instead
  // of the keyword one; filled in from the scores already stored. Geopolitical news linked to markets weigh 0.8.
  `
  ALTER TABLE news ADD COLUMN sentiment_impact REAL;
  UPDATE news SET sentiment_impact = MAX(1, MIN(3, ROUND(json_extract(sentiment_meta, '$.impact'))))
    WHERE sentiment_engine LIKE 'claude:%' AND json_valid(sentiment_meta)
      AND json_type(sentiment_meta, '$.impact') IN ('integer', 'real');
  UPDATE news SET relevance = 0.8 WHERE category = 'geopolitics' AND relevance = 0.6;
  `,
  // 5 — FD-ECON: the economic indicators of the Economy page and their releases (from the TradingView calendar).
  `
  CREATE TABLE econ_indicators (
    key TEXT PRIMARY KEY,
    country TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    unit TEXT,
    scale TEXT,
    currency TEXT,
    importance INTEGER NOT NULL DEFAULT -1,
    source TEXT,
    source_url TEXT,
    comment TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX econ_indicators_country ON econ_indicators(country);
  CREATE TABLE econ_releases (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL REFERENCES econ_indicators(key) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    period TEXT,
    reference_date INTEGER,
    actual REAL,
    previous REAL,
    forecast REAL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX econ_releases_key ON econ_releases(key, ts);
  CREATE INDEX econ_releases_ts ON econ_releases(ts);
  `,
  // 6 — FD-SUMMARY: each user's latest day summary by Claude, with the chart data it was written from.
  `
  CREATE TABLE day_summaries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    tz TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    model TEXT NOT NULL,
    content TEXT NOT NULL,
    charts TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  `,
  // 7 — FD-MCP: the Claude connector's OAuth (clients registered by DCR, connections, codes, tokens; hashes only).
  `
  CREATE TABLE mcp_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE mcp_grants (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_host TEXT NOT NULL,
    redirect_host TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );
  CREATE INDEX mcp_grants_user ON mcp_grants(user_id);
  CREATE TABLE mcp_codes (
    hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_host TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    redirect_host TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    grant_id INTEGER
  );
  CREATE TABLE mcp_tokens (
    hash TEXT PRIMARY KEY,
    grant_id INTEGER NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    expires_at INTEGER NOT NULL,
    rotated_at INTEGER
  );
  CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);
  `,
  // 8 — FD-INVITE: accounts only on request, approved by the admin; the activation link is a new kind of token.
  `
  CREATE TABLE account_requests (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE user_tokens_new (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify','reset','activate')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );
  INSERT INTO user_tokens_new(user_id, kind, token_hash, expires_at, created_at) SELECT user_id, kind, token_hash, expires_at, created_at FROM user_tokens;
  DROP TABLE user_tokens;
  ALTER TABLE user_tokens_new RENAME TO user_tokens;
  `,
];
