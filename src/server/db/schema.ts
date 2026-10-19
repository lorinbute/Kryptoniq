// Azure SQL schema (TD-AZURE §3): an append-only list of migrations, each a list of T-SQL batches; the version is kept
// in `schema_version`. Migration 1 is where the 8 SQLite migrations (sqlite-migrations.ts) ended, plus `job_lease`.
import type { Db } from './database.ts';

/** Text compares and sorts byte by byte, case-sensitive, as SQLite's BINARY did. */
export const BIN = 'Latin1_General_100_BIN2';
/** E-mail addresses: case-insensitive, as SQLite's NOCASE was. */
export const CI = 'Latin1_General_100_CI_AS';

const t = (n: number | 'MAX') => `NVARCHAR(${n}) COLLATE ${BIN}`;
const email = `NVARCHAR(320) COLLATE ${CI}`;
const NOW_MS = "DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME())";

/** Every table, children before parents: the order to empty them (tests, import); reversed, the order to fill them. */
export const TABLES = [
  'trade_log',
  'news_ai_scores',
  'news_coins',
  'news',
  'sources',
  'daily_sentiment',
  'calendar_raw',
  'calendar_custom',
  'job_state',
  'job_lease',
  'watchlist',
  'cost_basis',
  'exchange_accounts',
  'market_cache',
  'settings',
  'user_settings',
  'user_keys',
  'ai_daily_sentiment',
  'user_tokens',
  'sessions',
  'passkeys',
  'day_summaries',
  'account_requests',
  'econ_releases',
  'econ_indicators',
  'users',
] as const;

/** Tables whose `id` is an IDENTITY column. */
export const IDENTITY_TABLES = new Set(['users', 'calendar_custom', 'exchange_accounts', 'passkeys', 'account_requests', 'trade_log']);

/** The admin (id 1) every new database starts with, without e-mail or password (FD-USERS §3). */
export const SEED_ADMIN = `SET IDENTITY_INSERT users ON;
INSERT INTO users (id, email, name, role, email_verified_at, created_at) VALUES (1, NULL, N'', N'admin', ${NOW_MS}, ${NOW_MS});
SET IDENTITY_INSERT users OFF`;

export const MIGRATIONS: string[][] = [
  // 1 — FD-AZURE: the SQLite schema at version 8, in T-SQL; job_lease (TD-AZURE §6).
  [
    `CREATE TABLE settings (
      [key] ${t(100)} NOT NULL PRIMARY KEY,
      value ${t('MAX')} NOT NULL
    );
    CREATE TABLE sources (
      id ${t(200)} NOT NULL PRIMARY KEY,
      name ${t('MAX')} NOT NULL,
      url ${t('MAX')} NOT NULL,
      url_hash AS CAST(HASHBYTES('SHA2_256', url) AS BINARY(32)) PERSISTED,
      category ${t(20)} NOT NULL CHECK (category IN (N'crypto', N'macro', N'geopolitics', N'stocks')),
      enabled INT NOT NULL DEFAULT 1,
      weight FLOAT NOT NULL DEFAULT 1,
      builtin INT NOT NULL DEFAULT 0,
      etag ${t('MAX')} NULL,
      last_modified ${t('MAX')} NULL,
      last_attempt_at BIGINT NULL,
      last_success_at BIGINT NULL,
      last_new_item_at BIGINT NULL,
      last_error ${t('MAX')} NULL,
      failures INT NOT NULL DEFAULT 0,
      next_fetch_at BIGINT NOT NULL DEFAULT 0,
      item_count INT NOT NULL DEFAULT 0,
      auto ${t(200)} NULL
    );
    CREATE UNIQUE INDEX sources_url ON sources(url_hash);`,
    `CREATE TABLE news (
      id ${t(64)} NOT NULL PRIMARY KEY,
      source_id ${t(200)} NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      guid ${t('MAX')} NULL,
      url ${t('MAX')} NULL,
      canonical_url ${t('MAX')} NULL,
      canonical_hash AS CAST(HASHBYTES('SHA2_256', canonical_url) AS BINARY(32)) PERSISTED,
      title ${t('MAX')} NOT NULL,
      summary ${t('MAX')} NOT NULL DEFAULT N'',
      published_at BIGINT NOT NULL,
      fetched_at BIGINT NOT NULL,
      category ${t('MAX')} NOT NULL,
      relevance FLOAT NOT NULL,
      impact FLOAT NOT NULL,
      flags ${t('MAX')} NOT NULL DEFAULT N'[]',
      cluster_id ${t(64)} NOT NULL,
      sentiment FLOAT NULL,
      sentiment_label ${t('MAX')} NULL,
      sentiment_engine ${t(100)} NULL,
      sentiment_meta ${t('MAX')} NULL,
      scored_at BIGINT NULL,
      sentiment_impact FLOAT NULL
    );
    CREATE INDEX news_published ON news(published_at);
    CREATE INDEX news_cluster ON news(cluster_id);
    CREATE INDEX news_canonical ON news(canonical_hash);
    CREATE INDEX news_unscored ON news(sentiment_engine, published_at);
    CREATE INDEX news_source ON news(source_id, published_at);
    CREATE TABLE news_coins (
      news_id ${t(64)} NOT NULL REFERENCES news(id) ON DELETE CASCADE,
      coin ${t(64)} NOT NULL,
      PRIMARY KEY (news_id, coin)
    );
    CREATE INDEX news_coins_coin ON news_coins(coin);`,
    `CREATE TABLE daily_sentiment (
      day ${t(16)} NOT NULL,
      tz ${t(64)} NOT NULL,
      value FLOAT NOT NULL,
      raw FLOAT NOT NULL,
      confidence ${t('MAX')} NOT NULL,
      counts ${t('MAX')} NOT NULL,
      breakdown ${t('MAX')} NOT NULL,
      drivers ${t('MAX')} NOT NULL,
      computed_at BIGINT NOT NULL,
      final INT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, tz)
    );
    CREATE TABLE calendar_raw (
      source ${t(16)} NOT NULL,
      ext_id ${t(200)} NOT NULL,
      title ${t('MAX')} NOT NULL,
      currency ${t('MAX')} NOT NULL,
      country ${t('MAX')} NULL,
      ts BIGINT NOT NULL,
      all_day INT NOT NULL DEFAULT 0,
      impact ${t('MAX')} NOT NULL,
      forecast ${t('MAX')} NULL,
      previous ${t('MAX')} NULL,
      actual ${t('MAX')} NULL,
      unit ${t('MAX')} NULL,
      scale ${t('MAX')} NULL,
      period ${t('MAX')} NULL,
      fetched_at BIGINT NOT NULL,
      PRIMARY KEY (source, ext_id)
    );
    CREATE INDEX calendar_raw_ts ON calendar_raw(ts);
    CREATE TABLE job_state (
      name ${t(100)} NOT NULL PRIMARY KEY,
      last_start BIGINT NULL,
      last_end BIGINT NULL,
      last_ok BIGINT NULL,
      last_error ${t('MAX')} NULL,
      runs INT NOT NULL DEFAULT 0,
      data ${t('MAX')} NULL
    );
    CREATE TABLE job_lease (
      name ${t(50)} NOT NULL PRIMARY KEY,
      owner ${t(100)} NOT NULL,
      host ${t(200)} NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE market_cache (
      [key] ${t(300)} NOT NULL PRIMARY KEY,
      value ${t('MAX')} NOT NULL,
      fetched_at BIGINT NOT NULL
    );`,
    `CREATE TABLE users (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      email ${email} NULL,
      name ${t('MAX')} NOT NULL DEFAULT N'',
      password_hash ${t('MAX')} NULL,
      role ${t(10)} NOT NULL DEFAULT N'user' CHECK (role IN (N'admin', N'user')),
      email_verified_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      last_login_at BIGINT NULL,
      disabled_at BIGINT NULL,
      totp_secret ${t('MAX')} NULL,
      totp_confirmed_at BIGINT NULL,
      totp_last_step BIGINT NOT NULL DEFAULT 0,
      recovery_codes ${t('MAX')} NULL,
      passkey_user_handle VARBINARY(MAX) NULL
    );
    CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE user_tokens (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind ${t(16)} NOT NULL CHECK (kind IN (N'verify', N'reset', N'activate')),
      token_hash ${t(128)} NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
    CREATE TABLE sessions (
      id_hash ${t(128)} NOT NULL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind ${t(16)} NOT NULL CHECK (kind IN (N'full', N'pending')),
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      ip ${t('MAX')} NULL,
      user_agent ${t('MAX')} NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE passkeys (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id ${t('MAX')} NOT NULL,
      credential_hash AS CAST(HASHBYTES('SHA2_256', credential_id) AS BINARY(32)) PERSISTED,
      public_key VARBINARY(MAX) NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      transports ${t('MAX')} NULL,
      device_type ${t('MAX')} NULL,
      backed_up INT NOT NULL DEFAULT 0,
      name ${t('MAX')} NOT NULL,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT NULL
    );
    CREATE UNIQUE INDEX passkeys_credential ON passkeys(credential_hash);
    CREATE INDEX passkeys_user ON passkeys(user_id);
    CREATE TABLE user_settings (
      user_id INT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      value ${t('MAX')} NOT NULL
    );
    CREATE TABLE account_requests (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      email ${email} NOT NULL UNIQUE,
      name ${t('MAX')} NOT NULL,
      created_at BIGINT NOT NULL
    );`,
    `CREATE TABLE watchlist (
      user_id INT NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
      coin ${t(64)} NOT NULL,
      quote ${t('MAX')} NOT NULL DEFAULT N'USDT',
      position INT NOT NULL DEFAULT 0,
      aliases ${t('MAX')} NOT NULL DEFAULT N'[]',
      added_at BIGINT NOT NULL,
      kind ${t('MAX')} NOT NULL DEFAULT N'crypto',
      name ${t('MAX')} NULL,
      exchange ${t('MAX')} NULL,
      PRIMARY KEY (user_id, coin)
    );
    CREATE TABLE exchange_accounts (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      exchange ${t('MAX')} NOT NULL,
      label ${t('MAX')} NOT NULL,
      api_key ${t('MAX')} NOT NULL,
      secret ${t('MAX')} NOT NULL,
      password ${t('MAX')} NULL,
      key_hint ${t('MAX')} NOT NULL,
      created_at BIGINT NOT NULL,
      last_ok_at BIGINT NULL,
      last_error ${t('MAX')} NULL,
      permissions ${t('MAX')} NULL,
      credentials ${t('MAX')} NULL,
      env ${t('MAX')} NOT NULL DEFAULT N'live',
      user_id INT NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX exchange_accounts_user ON exchange_accounts(user_id);
    CREATE TABLE cost_basis (
      account_id INT NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
      asset ${t(64)} NOT NULL,
      avg_price FLOAT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (account_id, asset)
    );
    CREATE TABLE calendar_custom (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      title ${t('MAX')} NOT NULL,
      ts BIGINT NOT NULL,
      all_day INT NOT NULL DEFAULT 0,
      impact ${t('MAX')} NOT NULL,
      currency ${t('MAX')} NOT NULL DEFAULT N'CRYPTO',
      note ${t('MAX')} NOT NULL DEFAULT N'',
      created_at BIGINT NOT NULL,
      user_id INT NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX calendar_custom_ts ON calendar_custom(ts);
    CREATE INDEX calendar_custom_user ON calendar_custom(user_id, ts);
    CREATE TABLE day_summaries (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day ${t(16)} NOT NULL,
      tz ${t(64)} NOT NULL,
      created_at BIGINT NOT NULL,
      model ${t('MAX')} NOT NULL,
      content ${t('MAX')} NOT NULL,
      charts ${t('MAX')} NOT NULL,
      PRIMARY KEY (user_id, day)
    );`,
    `CREATE TABLE econ_indicators (
      [key] ${t(200)} NOT NULL PRIMARY KEY,
      country ${t(16)} NOT NULL,
      name ${t('MAX')} NOT NULL,
      category ${t('MAX')} NULL,
      unit ${t('MAX')} NULL,
      scale ${t('MAX')} NULL,
      currency ${t('MAX')} NULL,
      importance INT NOT NULL DEFAULT -1,
      source ${t('MAX')} NULL,
      source_url ${t('MAX')} NULL,
      comment ${t('MAX')} NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX econ_indicators_country ON econ_indicators(country);
    CREATE TABLE econ_releases (
      id ${t(100)} NOT NULL PRIMARY KEY,
      [key] ${t(200)} NOT NULL REFERENCES econ_indicators([key]) ON DELETE CASCADE,
      ts BIGINT NOT NULL,
      period ${t('MAX')} NULL,
      reference_date BIGINT NULL,
      actual FLOAT NULL,
      previous FLOAT NULL,
      forecast FLOAT NULL,
      fetched_at BIGINT NOT NULL
    );
    CREATE INDEX econ_releases_key ON econ_releases([key], ts);
    CREATE INDEX econ_releases_ts ON econ_releases(ts);`,
    `CREATE TABLE mcp_clients (
      client_id ${t(200)} NOT NULL PRIMARY KEY,
      client_name ${t('MAX')} NOT NULL,
      redirect_uris ${t('MAX')} NOT NULL,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT NULL
    );
    CREATE TABLE mcp_grants (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id ${t('MAX')} NOT NULL,
      client_name ${t('MAX')} NOT NULL,
      client_host ${t('MAX')} NOT NULL,
      redirect_host ${t('MAX')} NOT NULL,
      scope ${t('MAX')} NOT NULL,
      resource ${t('MAX')} NOT NULL,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT NULL,
      revoked_at BIGINT NULL
    );
    CREATE INDEX mcp_grants_user ON mcp_grants(user_id);
    CREATE TABLE mcp_codes (
      hash ${t(128)} NOT NULL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id ${t('MAX')} NOT NULL,
      client_name ${t('MAX')} NOT NULL,
      client_host ${t('MAX')} NOT NULL,
      redirect_uri ${t('MAX')} NOT NULL,
      redirect_host ${t('MAX')} NOT NULL,
      code_challenge ${t('MAX')} NOT NULL,
      scope ${t('MAX')} NOT NULL,
      resource ${t('MAX')} NOT NULL,
      expires_at BIGINT NOT NULL,
      used_at BIGINT NULL,
      grant_id INT NULL
    );
    CREATE TABLE mcp_tokens (
      hash ${t(128)} NOT NULL PRIMARY KEY,
      grant_id INT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
      kind ${t(16)} NOT NULL CHECK (kind IN (N'access', N'refresh')),
      expires_at BIGINT NOT NULL,
      rotated_at BIGINT NULL
    );
    CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);`,
    SEED_ADMIN,
  ],
  // 2 — FD-MCPREMOVE: the AI connector is gone; its tables with it (children first).
  ['DROP TABLE IF EXISTS mcp_tokens; DROP TABLE IF EXISTS mcp_codes; DROP TABLE IF EXISTS mcp_grants; DROP TABLE IF EXISTS mcp_clients;'],
  // 3 — FD-AIKEYS, FD-TDKEYS: each user's own keys (AI providers, Twelve Data), the news scores their AI gave and the
  // daily index made from them.
  [
    `CREATE TABLE user_keys (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name ${t(20)} NOT NULL,
      secret ${t('MAX')} NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, name)
    );
    CREATE TABLE news_ai_scores (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      news_id ${t(64)} NOT NULL REFERENCES news(id) ON DELETE CASCADE,
      score FLOAT NULL,
      label ${t(20)} NULL,
      engine ${t(100)} NOT NULL,
      impact FLOAT NULL,
      scored_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, news_id)
    );
    CREATE INDEX news_ai_scores_news ON news_ai_scores(news_id);
    CREATE TABLE ai_daily_sentiment (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day ${t(16)} NOT NULL,
      tz ${t(64)} NOT NULL,
      value FLOAT NOT NULL,
      raw FLOAT NOT NULL,
      confidence ${t('MAX')} NOT NULL,
      counts ${t('MAX')} NOT NULL,
      breakdown ${t('MAX')} NOT NULL,
      drivers ${t('MAX')} NOT NULL,
      computed_at BIGINT NOT NULL,
      final INT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day, tz)
    );`,
  ],
  // 4 — FD-2FA: the new authenticator's secret while the user changes it (the old one works until it is confirmed).
  [`ALTER TABLE users ADD totp_next_secret ${t('MAX')} NULL;`],
  // 5 — FD-TRADING: trading switched on per account, and the journal of what Sentiq sent (kept after the exchange
  // account goes, with the user; one row per idempotency key).
  [
    `ALTER TABLE exchange_accounts ADD trading_enabled_at BIGINT NULL, trading_markets ${t(40)} NULL;`,
    `CREATE TABLE trade_log (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id INT NULL,
      exchange ${t(40)} NOT NULL,
      env ${t(20)} NOT NULL,
      account_label ${t(200)} NOT NULL,
      idem_key ${t(64)} NULL,
      action ${t(16)} NOT NULL,
      market ${t(16)} NULL,
      symbol ${t(80)} NULL,
      side ${t(8)} NULL,
      kind ${t(16)} NULL,
      amount FLOAT NULL,
      price FLOAT NULL,
      trigger_price FLOAT NULL,
      leverage FLOAT NULL,
      status ${t(16)} NOT NULL,
      order_id ${t(120)} NULL,
      message ${t(500)} NULL,
      detail ${t('MAX')} NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX trade_log_idem ON trade_log(user_id, idem_key) WHERE idem_key IS NOT NULL;
    CREATE INDEX trade_log_user ON trade_log(user_id, created_at);`,
  ],
];

const VERSION_TABLE = "OBJECT_ID(QUOTENAME(SCHEMA_NAME()) + N'.schema_version', N'U')";

/** The schema version of the caller's default schema (0 when it has no tables yet). */
export async function schemaVersion(db: Db): Promise<number> {
  const exists = await db.get<{ x: number }>(`SELECT CASE WHEN ${VERSION_TABLE} IS NULL THEN 0 ELSE 1 END AS x`);
  if (!exists?.x) return 0;
  return (await db.get<{ version: number }>('SELECT TOP (1) version FROM schema_version'))?.version ?? 0;
}

/** Applies the missing migrations in one transaction (under the write lock: two processes never both migrate). */
export async function migrate(db: Db): Promise<void> {
  const newer = (v: number) => new Error(`Schema bazei de date (versiunea ${v}) e mai nouă decât acest Sentiq (versiunea ${MIGRATIONS.length}): actualizează Sentiq.`);
  const seen = await schemaVersion(db);
  if (seen > MIGRATIONS.length) throw newer(seen);
  if (seen === MIGRATIONS.length) return;
  await db.tx(async () => {
    await db.run(`IF ${VERSION_TABLE} IS NULL BEGIN CREATE TABLE schema_version (version INT NOT NULL); INSERT INTO schema_version (version) VALUES (0); END`);
    const from = await schemaVersion(db);
    if (from > MIGRATIONS.length) throw newer(from);
    for (let i = from; i < MIGRATIONS.length; i++) {
      try {
        for (const batch of MIGRATIONS[i]!) await db.run(batch);
      } catch (err) {
        throw new Error(`Migration ${i + 1} failed: ${(err as Error).message}`, { cause: err });
      }
      await db.run('UPDATE schema_version SET version = ?', [i + 1]);
    }
  });
}
