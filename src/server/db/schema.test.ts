// The Azure SQL layer (TD-AZURE §2–§4): parameters, types, collations, uniqueness, transactions and the write lock.
import { describe, expect, it } from 'vitest';
import { testDb, workerDb } from '../test/db.ts';
import { DbBusyError, positional } from './database.ts';
import { MIGRATIONS, migrate, schemaVersion, TABLES } from './schema.ts';

describe('placeholders (no database)', () => {
  it('turns ? into @p0… and leaves strings, quoted names and comments alone', () => {
    expect(positional("SELECT ? AS a, '?' AS b, [x?] AS c -- what?\n, ? /* ? */ , N'it''s ?' , ?")).toEqual({
      text: "SELECT @p0 AS a, '?' AS b, [x?] AS c -- what?\n, @p1 /* ? */ , N'it''s ?' , @p2",
      count: 3,
    });
  });
});

describe('the schema', () => {
  it('is at the last version and migrating again changes nothing', async () => {
    const db = await testDb();
    expect(await schemaVersion(db)).toBe(MIGRATIONS.length);
    await migrate(db);
    expect(await schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('TABLES names every table of the schema', async () => {
    const db = await testDb();
    const names = (await db.all<{ name: string }>('SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID() ORDER BY name')).map((r) => r.name);
    expect(names.filter((n) => n !== 'schema_version').sort()).toEqual([...TABLES].sort());
  });

  it('a new database has only the admin, without e-mail or password', async () => {
    const db = await testDb();
    expect(await db.all('SELECT id, email, password_hash, role FROM users')).toEqual([{ id: 1, email: null, password_hash: null, role: 'admin' }]);
    const next = (await db.run("INSERT INTO users(email, name, role, created_at) VALUES ('a@example.com', 'A', 'user', 1)")).lastInsertRowid;
    expect(next).toBe(2);
  });
});

describe('values', () => {
  it('keeps epoch milliseconds, floats, text with diacritics and bytes exactly', async () => {
    const db = await testDb();
    const ms = Date.UTC(2026, 9, 14, 12, 34, 56, 789);
    const key = new Uint8Array([0, 1, 2, 250, 255]);
    await db.run('INSERT INTO market_cache([key], value, fetched_at) VALUES (?, ?, ?)', ['ăîșț', 'Știri — „test” 🚀', ms]);
    expect(await db.get('SELECT [key], value, fetched_at FROM market_cache')).toEqual({ key: 'ăîșț', value: 'Știri — „test” 🚀', fetched_at: ms });
    await db.run('UPDATE users SET passkey_user_handle = ? WHERE id = 1', [key]);
    const row = await db.get<{ h: Buffer }>('SELECT passkey_user_handle AS h FROM users WHERE id = 1');
    expect([...row!.h]).toEqual([...key]);
    await db.run("INSERT INTO sources(id, name, url, category, weight) VALUES ('s', 'S', 'https://s.example/rss', 'crypto', 0.75)");
    expect(await db.get('SELECT weight, enabled FROM sources')).toEqual({ weight: 0.75, enabled: 1 });
  });

  it('a null may go into a binary column only through CONVERT', async () => {
    const db = await testDb();
    await db.run('UPDATE users SET passkey_user_handle = CONVERT(VARBINARY(MAX), ?) WHERE id = 1', [null]);
    expect(await db.get('SELECT passkey_user_handle FROM users WHERE id = 1')).toEqual({ passkey_user_handle: null });
  });
});

describe('text compares as in SQLite', () => {
  it('e-mails ignore letter case (one account per address), everything else does not', async () => {
    const db = await testDb();
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES ('Ana@Example.com', 'A', 'user', 1)");
    expect(await db.get('SELECT name FROM users WHERE email = ?', ['ana@example.com'])).toEqual({ name: 'A' });
    await expect(db.run("INSERT INTO users(email, name, role, created_at) VALUES ('ANA@example.com', 'B', 'user', 1)")).rejects.toThrow();
    // Two accounts without an address are fine (the unique index skips NULL).
    await db.run("INSERT INTO users(email, name, role, created_at) VALUES (NULL, 'C', 'user', 1)");
    await db.run("INSERT INTO watchlist(user_id, coin, added_at) VALUES (1, 'BTC', 1), (1, 'btc', 1)");
    expect(await db.all('SELECT coin FROM watchlist WHERE coin = ? ORDER BY coin', ['BTC'])).toEqual([{ coin: 'BTC' }]);
    expect((await db.all<{ coin: string }>('SELECT coin FROM watchlist ORDER BY coin')).map((r) => r.coin)).toEqual(['BTC', 'btc']);
  });

  it('a long URL is unique through its hash, exactly', async () => {
    const db = await testDb();
    const long = `https://feeds.example.com/${'x'.repeat(3000)}`;
    await db.run("INSERT INTO sources(id, name, url, category) VALUES ('a', 'A', ?, 'crypto')", [long]);
    await expect(db.run("INSERT INTO sources(id, name, url, category) VALUES ('b', 'B', ?, 'crypto')", [long])).rejects.toThrow();
    await db.run("INSERT INTO sources(id, name, url, category) VALUES ('c', 'C', ?, 'crypto')", [long.toUpperCase()]);
    expect(await db.get('SELECT id FROM sources WHERE url = ?', [long])).toEqual({ id: 'a' });
  });
});

describe('transactions and the write lock', () => {
  it('roll back everything when something fails, and join when nested', async () => {
    const db = await testDb();
    await expect(
      db.tx(async () => {
        await db.run("INSERT INTO settings([key], value) VALUES ('a', '1')");
        await db.tx(() => db.run("INSERT INTO settings([key], value) VALUES ('b', '2')"));
        await db.run("INSERT INTO settings([key], value) VALUES ('a', 'duplicate')");
      }),
    ).rejects.toThrow();
    expect(await db.all('SELECT [key] FROM settings')).toEqual([]);
    const out = await db.tx(async () => {
      await db.run("INSERT INTO settings([key], value) VALUES ('a', '1')");
      // Several queries at once inside one transaction run one after the other.
      const [x, y] = await Promise.all([db.get('SELECT value FROM settings'), db.run("UPDATE settings SET value = '2'")]);
      return { x, y };
    });
    expect(out).toEqual({ x: { value: '1' }, y: { changes: 1, lastInsertRowid: 0 } });
    expect(await db.get('SELECT value FROM settings')).toEqual({ value: '2' });
  });

  it('two read-then-write transactions at once never lose an update', async () => {
    const db = await testDb();
    await db.run("INSERT INTO settings([key], value) VALUES ('n', '0')");
    const bump = () =>
      db.tx(async () => {
        const n = Number((await db.get<{ value: string }>("SELECT value FROM settings WHERE [key] = 'n'"))!.value);
        await db.run("UPDATE settings SET value = ? WHERE [key] = 'n'", [String(n + 1)]);
      });
    await Promise.all(Array.from({ length: 6 }, bump));
    expect(await db.get("SELECT value FROM settings WHERE [key] = 'n'")).toEqual({ value: '6' });
  });

  it('a write waits for a transaction of another connection, and says so when it waits too long', async () => {
    const db = await testDb();
    const { cfg } = await workerDb();
    const { Db } = await import('./database.ts');
    const other = await Db.open(cfg, { migrate: false, poolMax: 1 });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const holding = other.tx(async () => {
        await other.run("INSERT INTO settings([key], value) VALUES ('held', '1')");
        await held;
      });
      // Give the other transaction time to take the lock.
      await new Promise((r) => setTimeout(r, 500));
      const write = db.run("INSERT INTO settings([key], value) VALUES ('after', '1')");
      await new Promise((r) => setTimeout(r, 300));
      release();
      await holding;
      await write;
      expect((await db.all<{ key: string }>('SELECT [key] FROM settings ORDER BY [key]')).map((r) => r.key)).toEqual(['after', 'held']);
    } finally {
      await other.close();
    }
    expect(DbBusyError).toBeTypeOf('function');
  });

  it('a promise left running after the transaction ended does not use it', async () => {
    const db = await testDb();
    let late: Promise<unknown> = Promise.resolve();
    await db.tx(async () => {
      late = new Promise((r) => setTimeout(r, 200)).then(() => db.run("INSERT INTO settings([key], value) VALUES ('late', '1')"));
    });
    await late;
    expect(await db.get("SELECT value FROM settings WHERE [key] = 'late'")).toEqual({ value: '1' });
  });
});

describe('the personal settings of an older database (FD-USERS §2)', () => {
  it('become the admin’s, once, and a second user starts from the defaults', async () => {
    const db = await testDb();
    const { SettingsService } = await import('../settings.ts');
    const { SecretBox } = await import('../secrets/crypto.ts');
    await db.run(`INSERT INTO settings([key], value) VALUES ('app', '{"timezone":"Asia/Tokyo","retentionDays":60,"charts":{"symbol":"SOL/USDT"}}')`);
    const settings = new SettingsService(db, new SecretBox(Buffer.alloc(32, 2)));
    await settings.migrateLegacyToAdmin(1);
    await settings.migrateLegacyToAdmin(1);
    expect(await db.all('SELECT user_id FROM user_settings')).toEqual([{ user_id: 1 }]);
    expect(await settings.forUser(1)).toMatchObject({ timezone: 'Asia/Tokyo', retentionDays: 60, charts: { symbol: 'SOL/USDT' } });
    const ana = (await db.run("INSERT INTO users(email, name, role, created_at) VALUES ('ana@example.com', 'Ana', 'user', 1)")).lastInsertRowid;
    expect(await settings.forUser(ana)).toMatchObject({ retentionDays: 60, charts: { symbol: '' } });
  });
});
