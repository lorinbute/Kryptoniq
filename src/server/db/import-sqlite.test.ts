// The one-time move of the SQLite file into Azure SQL (FD-AZURE §3, TD-AZURE §9).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { testDb } from '../test/db.ts';
import { ImportError, importSqlite, snapshot, targetContents } from './import-sqlite.ts';
import { LegacySqliteDb } from './sqlite-legacy.ts';
import { MIGRATIONS } from './sqlite-migrations.ts';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** A version-8 file with a bit of everything the import has to carry over. */
function sqliteFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sq-import-'));
  dirs.push(dir);
  const file = path.join(dir, 'kryptoniq.db');
  const db = new LegacySqliteDb(file);
  db.run("UPDATE users SET email = 'Admin@Example.com', name = 'Admin', password_hash = 'scrypt$x', passkey_user_handle = ? WHERE id = 1", [new Uint8Array([9, 8, 7])]);
  db.run("INSERT INTO users(id, email, name, role, created_at) VALUES (5, 'ana@example.com', 'Ana', 'user', 2)");
  db.run("INSERT INTO sources(id, name, url, category) VALUES ('s1', 'Știri', 'https://s1.example/rss', 'crypto')");
  db.run(
    `INSERT INTO news(id, source_id, url, canonical_url, title, summary, published_at, fetched_at, category, relevance, impact, cluster_id, sentiment, sentiment_impact)
     VALUES ('n1', 's1', 'https://a.example/1', 'https://a.example/1', 'Bitcoin „sus”', '', 1760000000123, 1760000000456, 'crypto', 0.8, 2, 'c1', -0.25, NULL)`,
  );
  db.run("INSERT INTO news_coins(news_id, coin) VALUES ('n1', 'BTC')");
  db.run("INSERT INTO watchlist(user_id, coin, quote, position, aliases, added_at, kind) VALUES (5, 'ETH', 'USDT', 0, '[]', 1, 'crypto')");
  db.run("INSERT INTO exchange_accounts(id, user_id, exchange, label, api_key, secret, key_hint, created_at, credentials) VALUES (7, 5, 'kucoin', 'Main', '', '', 'k…', 1, 'v1:x')");
  db.run("INSERT INTO cost_basis(account_id, asset, avg_price, updated_at) VALUES (7, 'BTC', 50000.5, 1)");
  db.run("INSERT INTO passkeys(id, user_id, credential_id, public_key, counter, name, created_at) VALUES (3, 1, 'cred-1', ?, 4294967295, 'Mac', 1)", [new Uint8Array([1, 2, 3])]);
  db.run("INSERT INTO settings(key, value) VALUES ('app', '{\"retentionDays\":60}')");
  db.run("INSERT INTO account_requests(id, email, name, created_at) VALUES (2, 'Bob@Example.com', 'Bob', 1)");
  db.close();
  return file;
}

describe('the import', () => {
  it('copies every row with its ids, numbers, bytes and texts, and new rows continue the ids', async () => {
    const db = await testDb();
    const snap = snapshot(sqliteFile());
    dirs.push(snap.dir);
    const r = await importSqlite(db, snap.copy);
    expect(r.copied).toMatchObject({ users: 2, news: 1, news_coins: 1, passkeys: 1, exchange_accounts: 1, cost_basis: 1, account_requests: 1 });
    expect(await db.all('SELECT id, email, name FROM users ORDER BY id')).toEqual([
      { id: 1, email: 'Admin@Example.com', name: 'Admin' },
      { id: 5, email: 'ana@example.com', name: 'Ana' },
    ]);
    const admin = await db.get<{ h: Buffer }>('SELECT passkey_user_handle AS h FROM users WHERE id = 1');
    expect([...admin!.h]).toEqual([9, 8, 7]);
    expect(await db.get('SELECT title, published_at, fetched_at, relevance, sentiment, sentiment_impact FROM news')).toEqual({
      title: 'Bitcoin „sus”',
      published_at: 1760000000123,
      fetched_at: 1760000000456,
      relevance: 0.8,
      sentiment: -0.25,
      sentiment_impact: null,
    });
    expect(await db.get('SELECT counter FROM passkeys')).toEqual({ counter: 4294967295 });
    expect(await db.get('SELECT avg_price FROM cost_basis')).toEqual({ avg_price: 50000.5 });
    // The hash columns are computed for the imported rows too.
    expect(await db.get("SELECT id FROM news WHERE canonical_hash = HASHBYTES('SHA2_256', CAST(? AS NVARCHAR(MAX)))", ['https://a.example/1'])).toEqual({ id: 'n1' });
    // E-mails stay unique without regard to case.
    await expect(db.run("INSERT INTO users(email, name, role, created_at) VALUES ('admin@example.com', 'X', 'user', 1)")).rejects.toThrow();
    // New ids continue after the imported ones (SQL Server may skip one a refused insert used up).
    expect((await db.run("INSERT INTO users(email, name, role, created_at) VALUES ('new@example.com', 'N', 'user', 1)")).lastInsertRowid).toBeGreaterThan(5);
  });

  it('refuses a database that already has data, unless asked to replace it', async () => {
    const db = await testDb();
    const snap = snapshot(sqliteFile());
    dirs.push(snap.dir);
    // A new database (only the seed) is empty.
    expect(await targetContents(db)).toEqual({ users: 0, news: 0, accounts: 0 });
    await importSqlite(db, snap.copy);
    await expect(importSqlite(db, snap.copy)).rejects.toBeInstanceOf(ImportError);
    await db.run("INSERT INTO settings([key], value) VALUES ('extra', '1')");
    await importSqlite(db, snap.copy, { replace: true });
    expect(await db.get("SELECT 1 AS x FROM settings WHERE [key] = 'extra'")).toBeUndefined();
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM users'))?.n).toBe(2);
  });

  it('brings an older file to version 8 first, on a copy, and refuses an unknown newer one', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sq-import-'));
    dirs.push(dir);
    const old = path.join(dir, 'v1.db');
    const raw = new DatabaseSync(old);
    raw.exec(MIGRATIONS[0] as string);
    raw.exec('PRAGMA user_version = 1');
    raw.close();
    const snap = snapshot(old);
    dirs.push(snap.dir);
    expect(snap.fromVersion).toBe(1);
    const copy = new DatabaseSync(snap.copy);
    expect((copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    copy.close();
    const orig = new DatabaseSync(old);
    expect((orig.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    orig.exec('PRAGMA user_version = 99');
    orig.close();
    expect(() => snapshot(old)).toThrow(ImportError);
    expect(() => snapshot(path.join(dir, 'missing.db'))).toThrow(ImportError);
  });
});
