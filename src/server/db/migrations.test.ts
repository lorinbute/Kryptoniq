import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('migration 2 (FD-SENTIQ)', () => {
  it('rebuilds `sources` without cascading into the news, and keeps every row', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sq-mig-'));
    const file = path.join(dir, 'v1.db');
    // A database as version 1 left it, with a source, its news and a KuCoin account.
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(MIGRATIONS[0] as string);
    raw.exec('PRAGMA user_version = 1');
    raw.exec(`INSERT INTO sources(id, name, url, category, builtin) VALUES ('coindesk', 'CoinDesk', 'https://x/rss', 'crypto', 1)`);
    raw.exec(`INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id) VALUES ('n1', 'coindesk', 'BTC up', 1, 1, 'crypto', 1, 1, 'c1')`);
    raw.exec(`INSERT INTO news_coins(news_id, coin) VALUES ('n1', 'BTC')`);
    raw.exec(`INSERT INTO watchlist(coin, quote, position, aliases, added_at) VALUES ('BTC', 'USDT', 0, '[]', 1)`);
    raw.exec(`INSERT INTO exchange_accounts(exchange, label, api_key, secret, password, key_hint, created_at) VALUES ('kucoin', 'Main', 'k', 's', 'p', 'k…', 1)`);
    raw.close();

    const db = new Db(file);
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(MIGRATIONS.length);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM news')?.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM news_coins')?.n).toBe(1);
    expect(db.get<{ id: string; category: string; auto: string | null }>('SELECT id, category, auto FROM sources')).toEqual({ id: 'coindesk', category: 'crypto', auto: null });
    expect(db.get('SELECT kind, name, exchange FROM watchlist')).toEqual({ kind: 'crypto', name: null, exchange: null });
    expect(db.get('SELECT credentials, env FROM exchange_accounts')).toEqual({ credentials: null, env: 'live' });
    // The new category is accepted, an unknown one still is not.
    db.run(`INSERT INTO sources(id, name, url, category) VALUES ('nasdaq:AAPL', 'Nasdaq AAPL', 'https://y/rss', 'stocks')`);
    expect(() => db.run(`INSERT INTO sources(id, name, url, category) VALUES ('z', 'Z', 'https://z/rss', 'sports')`)).toThrow();
    // Foreign keys are on again: deleting the source still removes its news.
    db.run(`DELETE FROM sources WHERE id = 'coindesk'`);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM news')?.n).toBe(0);
    db.close();
  });
});

describe('migration 3 (FD-USERS)', () => {
  it("makes everything that exists the admin's, and the admin an account without email or password", async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sq-mig3-'));
    const file = path.join(dir, 'v2.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(MIGRATIONS[0] as string);
    raw.exec(MIGRATIONS[1] as string);
    raw.exec('PRAGMA user_version = 2');
    raw.exec(`INSERT INTO watchlist(coin, quote, position, aliases, added_at, kind) VALUES ('BTC', 'USDT', 1, '["Bitcoin"]', 1, 'crypto'), ('AAPL', 'USD', 0, '[]', 2, 'stock')`);
    raw.exec(`INSERT INTO exchange_accounts(exchange, label, api_key, secret, password, key_hint, created_at) VALUES ('kucoin', 'Main', 'k', 's', 'p', 'k…', 1)`);
    raw.exec(`INSERT INTO cost_basis(account_id, asset, avg_price, updated_at) VALUES (1, 'BTC', 50000, 1)`);
    raw.exec(`INSERT INTO calendar_custom(title, ts, all_day, impact, currency, note, created_at) VALUES ('Mine', 10, 0, 'High', 'CRYPTO', '', 1)`);
    raw.exec(`INSERT INTO settings(key, value) VALUES ('app', '{"timezone":"Asia/Tokyo","retentionDays":60,"charts":{"symbol":"SOL/USDT"}}')`);
    raw.close();

    const db = new Db(file);
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(MIGRATIONS.length);
    expect(db.get('SELECT id, email, password_hash, role, email_verified_at IS NOT NULL AS verified FROM users')).toEqual({ id: 1, email: null, password_hash: null, role: 'admin', verified: 1 });
    expect(db.all('SELECT user_id, coin, quote, position, aliases, kind FROM watchlist ORDER BY position')).toEqual([
      { user_id: 1, coin: 'AAPL', quote: 'USD', position: 0, aliases: '[]', kind: 'stock' },
      { user_id: 1, coin: 'BTC', quote: 'USDT', position: 1, aliases: '["Bitcoin"]', kind: 'crypto' },
    ]);
    expect(db.get('SELECT user_id FROM exchange_accounts')).toEqual({ user_id: 1 });
    expect(db.get('SELECT user_id FROM calendar_custom')).toEqual({ user_id: 1 });
    expect(db.get('SELECT avg_price FROM cost_basis')).toEqual({ avg_price: 50000 });
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);

    // The personal settings follow the admin; the shared ones stay where they were.
    const { SettingsService } = await import('../settings.ts');
    const { SecretBox } = await import('../secrets/crypto.ts');
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 2)));
    settings.migrateLegacyToAdmin(1);
    expect(settings.forUser(1)).toMatchObject({ timezone: 'Asia/Tokyo', retentionDays: 60, charts: { symbol: 'SOL/USDT' } });
    // A second user starts from the defaults for their own keys, and shares the admin's retention.
    const ana = db.run("INSERT INTO users(email, name, role, created_at) VALUES ('ana@example.com', 'Ana', 'user', 1)").lastInsertRowid;
    expect(settings.forUser(ana)).toMatchObject({ retentionDays: 60, charts: { symbol: '' } });
    // An account that goes takes its own rows with it.
    db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at) VALUES (?, 'ETH', 'USDT', 0, '[]', 1)", [ana]);
    db.run('DELETE FROM users WHERE id = ?', [ana]);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist')?.n).toBe(2);
    db.close();
  });
});

describe('migration 4 (FD-IMPACT)', () => {
  it("keeps Claude's importance from the stored scores and lifts market-linked geopolitics to 0.8", () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sq-mig4-'));
    const file = path.join(dir, 'v3.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys = ON');
    for (const m of MIGRATIONS.slice(0, 3)) raw.exec(m as string);
    raw.exec('PRAGMA user_version = 3');
    raw.exec(`INSERT INTO sources(id, name, url, category) VALUES ('s', 'S', 'https://s/rss', 'geopolitics')`);
    const add = (id: string, category: string, relevance: number, engine: string | null, meta: string | null) =>
      raw
        .prepare(`INSERT INTO news(id, source_id, title, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_engine, sentiment_meta) VALUES (?, 's', ?, 1, 1, ?, ?, 3, ?, 0, ?, ?)`)
        .run(id, id, category, relevance, id, engine, meta);
    add('claude', 'geopolitics', 0.6, 'claude:claude-opus-5-5', '{"impact":1}');
    add('claude-odd', 'macro', 1, 'claude:claude-opus-5-5', '{"impact":2.6}');
    add('claude-none', 'macro', 1, 'claude:claude-opus-5-5', '{}');
    add('claude-bad', 'macro', 1, 'claude:claude-opus-5-5', 'not json');
    add('local', 'geopolitics', 0, 'local', '{"model":0.2,"rules":[]}');
    add('pending', 'macro', 0.8, null, null);
    raw.close();

    const db = new Db(file);
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(MIGRATIONS.length);
    const rows = Object.fromEntries(db.all<{ id: string; relevance: number; sentiment_impact: number | null }>('SELECT id, relevance, sentiment_impact FROM news').map((r) => [r.id, r]));
    expect(rows.claude).toMatchObject({ relevance: 0.8, sentiment_impact: 1 });
    expect(rows['claude-odd']).toMatchObject({ relevance: 1, sentiment_impact: 3 });
    expect(rows['claude-none']?.sentiment_impact).toBeNull();
    expect(rows['claude-bad']?.sentiment_impact).toBeNull();
    expect(rows.local).toMatchObject({ relevance: 0, sentiment_impact: null });
    expect(rows.pending).toMatchObject({ relevance: 0.8, sentiment_impact: null });
    db.close();
  });
});
