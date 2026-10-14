// A fresh database for a test (TD-AZURE §10): the worker's own schema, emptied and seeded as a new database is.
import { inject } from 'vitest';
import { Db } from '../db/database.ts';
import type { DbConfig } from '../db/config.ts';
import { IDENTITY_TABLES, SEED_ADMIN, TABLES } from '../db/schema.ts';
import { schemaConfig } from './schemas.ts';

let shared: { cfg: DbConfig; pool: ReturnType<typeof Db.poolFor> } | null = null;

/** This worker's schema connection (one pool per worker, kept open across tests). */
export async function workerDb(): Promise<{ cfg: DbConfig; db: Db }> {
  if (!shared) {
    const provided = inject('sentiqDb');
    if ('missing' in provided) throw new Error(provided.missing);
    const { base, schemas } = provided;
    const id = Number(process.env.VITEST_POOL_ID ?? 1);
    const s = schemas[(id - 1) % schemas.length];
    if (!s) throw new Error('no test schema for this worker');
    const cfg = schemaConfig(base, s);
    const pool = Db.poolFor(cfg, 3);
    await pool.connect();
    shared = { cfg, pool };
  }
  return { cfg: shared.cfg, db: Db.shared(shared.pool, shared.cfg) };
}

/** Empties every table (keeping the schema), resets the identities that were used and puts the admin row back. */
const RESET = [
  ...TABLES.map((t) => `DELETE FROM ${t};`),
  ...[...IDENTITY_TABLES].map(
    (t) => `IF (SELECT last_value FROM sys.identity_columns WHERE object_id = OBJECT_ID(QUOTENAME(SCHEMA_NAME()) + N'.${t}')) IS NOT NULL DBCC CHECKIDENT ('${t}', RESEED, 0) WITH NO_INFOMSGS;`,
  ),
  SEED_ADMIN,
].join('\n');

/** The database a test starts from: what `new Db(':memory:')` was before FD-AZURE. */
export async function testDb(): Promise<Db> {
  const { db } = await workerDb();
  await db.tx(() => db.run(RESET));
  return db;
}
