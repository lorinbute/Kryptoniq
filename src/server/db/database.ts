import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.ts';

export type Params = Record<string, SQLInputValue> | SQLInputValue[];

/** Thin synchronous wrapper around node:sqlite with a statement cache and transactions. */
export class Db {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private bind(params?: Params): SQLInputValue[] {
    if (params === undefined) return [];
    return Array.isArray(params) ? params : [params as unknown as SQLInputValue];
  }

  all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
    return this.stmt(sql).all(...this.bind(params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
    return this.stmt(sql).get(...this.bind(params)) as T | undefined;
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...this.bind(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** Runs `fn` in a transaction (nested calls join the outer one). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    let version = row.user_version;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[i] as string);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
        this.raw.exec('COMMIT');
        version = i + 1;
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw new Error(`Migration ${i + 1} failed: ${(err as Error).message}`);
      }
    }
  }

  sizeBytes(): number {
    const p = this.get<{ page_count: number }>('PRAGMA page_count');
    const s = this.get<{ page_size: number }>('PRAGMA page_size');
    return (p?.page_count ?? 0) * (s?.page_size ?? 0);
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}
