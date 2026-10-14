// Test schemas in the app's own database (FD-AZURE §1, TD-AZURE §10): each one belongs to a contained user of its
// own, whose default schema it is, with no rights on dbo; so a test never reads or writes the real tables.
import { randomBytes } from 'node:crypto';
import { Db } from '../db/database.ts';
import type { DbConfig } from '../db/config.ts';

export interface TestSchema {
  /** The user and its schema have the same name. */
  name: string;
  password: string;
}

/** `t_<yyyymmddhhmm>_<4 hex>`: the start of the run, so leftovers can be told by age. */
export function newRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `t_${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}_${randomBytes(2).toString('hex')}`;
}

const NAME_RE = /^t_\d{12}_[0-9a-f]{4}(_\d+)?$/;

/** A contained user and its schema, with tables only there. */
export async function createTestSchema(admin: Db, name: string): Promise<TestSchema> {
  if (!NAME_RE.test(name)) throw new Error(`bad test schema name ${name}`);
  // Upper, lower, digit and symbol: Azure's password policy.
  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  await admin.run(`CREATE USER [${name}] WITH PASSWORD = N'${password}', DEFAULT_SCHEMA = [${name}]`);
  await admin.run(`EXEC(N'CREATE SCHEMA [${name}] AUTHORIZATION [${name}]')`);
  await admin.run(`GRANT CREATE TABLE TO [${name}]; DENY SELECT, INSERT, UPDATE, DELETE, ALTER, REFERENCES, EXECUTE ON SCHEMA::dbo TO [${name}]`);
  return { name, password };
}

/** Drops a test schema's tables (foreign keys first), the schema and its user. */
export async function dropTestSchema(admin: Db, name: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error(`bad test schema name ${name}`);
  await admin.run(
    `DECLARE @sql nvarchar(max) = N'';
     SELECT @sql += N'ALTER TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(f.name) + N';'
       FROM sys.foreign_keys f JOIN sys.tables t ON f.parent_object_id = t.object_id JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = @s;
     SELECT @sql += N'DROP TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';'
       FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = @s;
     IF SCHEMA_ID(@s) IS NOT NULL SET @sql += N'DROP SCHEMA ' + QUOTENAME(@s) + N';';
     IF DATABASE_PRINCIPAL_ID(@s) IS NOT NULL SET @sql += N'DROP USER ' + QUOTENAME(@s) + N';';
     IF @sql <> N'' EXEC sp_executesql @sql;`,
    { s: name },
  );
}

/** Test schemas older than `maxAgeMs` (a run that was interrupted), or every one with `maxAgeMs = 0`. */
export async function staleTestSchemas(admin: Db, maxAgeMs: number, now = Date.now()): Promise<string[]> {
  const names = (await admin.all<{ name: string }>("SELECT name FROM sys.database_principals WHERE name LIKE N't[_]%' UNION SELECT name FROM sys.schemas WHERE name LIKE N't[_]%'")).map((r) => r.name);
  return names.filter((n) => {
    if (!NAME_RE.test(n)) return false;
    const m = /^t_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(n)!;
    const at = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
    return now - at > maxAgeMs;
  });
}

/** The connection of a test schema's user (the same server and database). */
export function schemaConfig(base: DbConfig, s: TestSchema): DbConfig {
  return { ...base, user: s.name, password: s.password };
}
