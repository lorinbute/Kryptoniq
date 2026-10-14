// The one-time move of a SQLite database (data/kryptoniq.db) into Azure SQL (FD-AZURE §3, TD-AZURE §9).
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './database.ts';
import { IDENTITY_TABLES, TABLES } from './schema.ts';
import { LEGACY_VERSION, LegacySqliteDb } from './sqlite-legacy.ts';

export class ImportError extends Error {}

export interface ImportResult {
  /** Rows copied, per table (SQLite order). */
  copied: Record<string, number>;
  /** The SQLite file's schema version (migrated to LEGACY_VERSION on the copy when older). */
  fromVersion: number;
}

/** What the target already holds beyond a new database's seed (FD-AZURE §3): users who can sign in, news, accounts. */
export async function targetContents(db: Db): Promise<{ users: number; news: number; accounts: number }> {
  const n = async (sql: string) => (await db.get<{ n: number }>(sql))?.n ?? 0;
  return {
    users: await n('SELECT count(*) AS n FROM users WHERE email IS NOT NULL OR password_hash IS NOT NULL'),
    news: await n('SELECT count(*) AS n FROM news'),
    accounts: await n('SELECT count(*) AS n FROM exchange_accounts'),
  };
}

/** A consistent copy of the file (it may be in use), migrated to the last SQLite version; the caller removes `dir`. */
export function snapshot(file: string): { dir: string; copy: string; fromVersion: number } {
  if (!existsSync(file)) throw new ImportError(`Nu există fișierul ${file}.`);
  const dir = mkdtempSync(path.join(tmpdir(), 'sentiq-import-'));
  const copy = path.join(dir, 'snapshot.db');
  try {
    const src = new DatabaseSync(file, { readOnly: true });
    try {
      src.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
    } finally {
      src.close();
    }
  } catch {
    // An old SQLite without VACUUM INTO: a plain copy of the file with its write-ahead log (the app is stopped,
    // FD-AZURE §3; without the -wal file the last changes would be lost).
    copyFileSync(file, copy);
    for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, copy + ext);
  }
  const raw = new DatabaseSync(copy);
  const fromVersion = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  raw.close();
  if (fromVersion > LEGACY_VERSION) {
    rmSync(dir, { recursive: true, force: true });
    throw new ImportError(`Fișierul SQLite are versiunea ${fromVersion}, mai nouă decât cea pe care o cunoaște importul (${LEGACY_VERSION}).`);
  }
  if (fromVersion < LEGACY_VERSION) new LegacySqliteDb(copy).close(); // the old migrations, on the copy only
  return { dir, copy, fromVersion };
}

type Value = string | number | null | Uint8Array;

/** Most rows per INSERT: SQL Server allows 1000 rows and 2100 parameters in one statement. */
function batchSize(columns: number): number {
  return Math.max(1, Math.min(1000, Math.floor(2000 / columns)));
}

/**
 * Copies every table of the SQLite snapshot into `db`, in one transaction: the target is emptied first, so nothing is
 * ever half imported. `replace` must be true when the target already holds data (targetContents).
 */
export async function importSqlite(db: Db, copy: string, opts: { replace?: boolean; fromVersion?: number } = {}): Promise<ImportResult> {
  const src = new DatabaseSync(copy, { readOnly: true });
  try {
    const have = await targetContents(db);
    if (!opts.replace && (have.users || have.news || have.accounts)) {
      throw new ImportError(
        `Baza are deja date (${have.users} utilizatori, ${have.news} știri, ${have.accounts} conturi). Ca s-o înlocuiești cu datele de pe Mac: import-sqlite --replace.`,
      );
    }
    const sqliteTables = new Set((src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    // Columns the target can take (computed ones excluded) per table.
    const targetCols = new Map<string, Map<string, string>>();
    for (const r of await db.all<{ t: string; c: string; type: string }>(
      `SELECT t.name AS t, c.name AS c, ty.name AS type FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id JOIN sys.types ty ON c.user_type_id = ty.user_type_id
       WHERE t.schema_id = SCHEMA_ID() AND c.is_computed = 0`,
    )) {
      if (!targetCols.has(r.t)) targetCols.set(r.t, new Map());
      targetCols.get(r.t)!.set(r.c, r.type);
    }
    const copied: Record<string, number> = {};
    await db.tx(async () => {
      for (const t of TABLES) await db.run(`DELETE FROM ${t}`);
      for (const t of [...TABLES].reverse()) {
        if (!sqliteTables.has(t)) continue; // job_lease: Azure SQL only
        const cols = targetCols.get(t);
        if (!cols) throw new ImportError(`Tabelul ${t} lipsește din baza Azure.`);
        const srcCols = (src.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => cols.has(c));
        const rows = src.prepare(`SELECT ${srcCols.map((c) => `"${c}"`).join(', ')} FROM ${t}`).all() as Record<string, Value>[];
        copied[t] = rows.length;
        if (!rows.length) continue;
        const identity = IDENTITY_TABLES.has(t) && srcCols.includes('id');
        const list = srcCols.map((c) => `[${c}]`).join(', ');
        const size = batchSize(srcCols.length);
        for (let i = 0; i < rows.length; i += size) {
          const chunk = rows.slice(i, i + size);
          const params: Record<string, Value> = {};
          const values = chunk.map((row, r) => {
            const cells = srcCols.map((c, k) => {
              const name = `v${r}_${k}`;
              const v = row[c] ?? null;
              params[name] = v;
              // A NULL of a binary column is sent as text: SQL Server only converts it explicitly.
              return cols.get(c) === 'varbinary' ? `CONVERT(VARBINARY(MAX), @${name})` : `@${name}`;
            });
            return `(${cells.join(', ')})`;
          });
          const insert = `INSERT INTO ${t} (${list}) VALUES ${values.join(', ')}`;
          await db.run(identity ? `SET IDENTITY_INSERT ${t} ON; ${insert}; SET IDENTITY_INSERT ${t} OFF` : insert, params);
        }
      }
      // Every table has as many rows as the file.
      for (const [t, n] of Object.entries(copied)) {
        const got = (await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))?.n ?? 0;
        if (got !== n) throw new ImportError(`Tabelul ${t}: ${got} rânduri în Azure, ${n} în fișier.`);
      }
    });
    return { copied, fromVersion: opts.fromVersion ?? LEGACY_VERSION };
  } finally {
    src.close();
  }
}
