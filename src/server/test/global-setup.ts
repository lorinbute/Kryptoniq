// Vitest global setup (TD-AZURE §10): one test schema per worker in the database of data/database.env, migrated
// once; dropped at the end. Leftovers of an interrupted run (older than 3 hours) are dropped first.
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { loadDbConfig, type DbConfig } from '../db/config.ts';
import { Db } from '../db/database.ts';
import { createTestSchema, dropTestSchema, newRunId, schemaConfig, staleTestSchemas, type TestSchema } from './schemas.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Without data/database.env: `missing` says why; the tests that need the database fail with it, the others run. */
    sentiqDb: { base: DbConfig; schemas: TestSchema[] } | { missing: string };
  }
}

/** One schema per worker: as many as Vitest may start (`maxWorkers`, 4 in vitest.config.ts). */
const DEFAULT_WORKERS = 4;
const STALE_MS = 3 * 3_600_000;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
  let base: DbConfig;
  try {
    base = loadDbConfig(process.env, dataDir);
  } catch (err) {
    project.provide('sentiqDb', { missing: `Testele cu bază de date rulează pe baza din data/database.env, într-o schemă separată: ${(err as Error).message}` });
    return async () => undefined;
  }
  let admin: Db;
  try {
    admin = await Db.open(base, { migrate: false, poolMax: 2 });
  } catch (err) {
    // No network, a firewall: the tests without a database still run.
    project.provide('sentiqDb', { missing: `Baza de test nu e accesibilă: ${(err as Error).message}` });
    return async () => undefined;
  }
  // A leftover still in use by another run stays (and is said); it never stops this run.
  for (const name of await staleTestSchemas(admin, STALE_MS)) {
    await dropTestSchema(admin, name).catch((err: Error) => console.warn(`old test schema ${name} not dropped: ${err.message}`));
  }
  const run = newRunId();
  const schemas: TestSchema[] = [];
  try {
    const configured = Number((project.config as { maxWorkers?: unknown }).maxWorkers);
    const workers = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_WORKERS;
    for (let i = 1; i <= workers; i++) {
      const s = await createTestSchema(admin, `${run}_${i}`);
      schemas.push(s);
      // The schema's tables, created by its own user (they land in its default schema).
      const db = await Db.open(schemaConfig(base, s), { poolMax: 1 });
      await db.close();
    }
  } catch (err) {
    for (const s of schemas) await dropTestSchema(admin, s.name).catch(() => undefined);
    await admin.close();
    throw err;
  }
  project.provide('sentiqDb', { base, schemas });
  return async () => {
    for (const s of schemas) {
      // Left behind, the next run drops it (older than 3 hours); said here so a problem is seen.
      await dropTestSchema(admin, s.name).catch((err: Error) => console.warn(`test schema ${s.name} not dropped: ${err.message}`));
    }
    await admin.close();
  };
}
