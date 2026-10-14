// Where Sentiq's Azure SQL database is (FD-AZURE §1, TD-AZURE §1): `data/database.env` on the Mac, the same names as
// App Service application settings in Azure (the environment wins, key by key).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';

export const DB_ENV_FILE = 'database.env';

export interface DbConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export class DbConfigError extends Error {}

const KEYS = ['SENTIQ_DB_SERVER', 'SENTIQ_DB_PORT', 'SENTIQ_DB_NAME', 'SENTIQ_DB_USER', 'SENTIQ_DB_PASSWORD', 'SENTIQ_DB_CONNECTION'] as const;
type Key = (typeof KEYS)[number];

/**
 * `NAME=value` lines; `#` starts a comment only at the start of a line. The value is everything after the first `=`,
 * verbatim (no quotes, no inline comments, no expansion): a password may hold `#`, `'`, `"`, `$` or spaces.
 */
export function parseDbEnv(text: string): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^\s*(#|$)/.test(line)) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if ((KEYS as readonly string[]).includes(key)) out[key as Key] = line.slice(eq + 1);
  }
  return out;
}

const MISSING = 'Baza de date nu e configurată: completează data/database.env (server, bază, utilizator, parolă sau connection string).';

/** The connection from `<dataDir>/database.env` and the environment; throws DbConfigError when it is incomplete. */
export function loadDbConfig(env: NodeJS.ProcessEnv, dataDir: string): DbConfig {
  const file = path.join(dataDir, DB_ENV_FILE);
  const fromFile = existsSync(file) ? parseDbEnv(readFileSync(file, 'utf8')) : {};
  const value = (k: Key): string => {
    const v = env[k] ?? fromFile[k];
    return v === undefined ? '' : k === 'SENTIQ_DB_PASSWORD' || k === 'SENTIQ_DB_CONNECTION' ? v : v.trim();
  };
  const conn = value('SENTIQ_DB_CONNECTION').trim();
  let cfg: DbConfig;
  if (conn) {
    let parsed: { server?: string; port?: number; database?: string; user?: string; password?: string };
    try {
      parsed = sql.ConnectionPool.parseConnectionString(conn) as typeof parsed;
    } catch {
      throw new DbConfigError('Connection string-ul din SENTIQ_DB_CONNECTION nu poate fi citit: copiază-l din nou din portal (ADO.NET, SQL authentication).');
    }
    cfg = { server: parsed.server ?? '', port: Number(parsed.port ?? 1433), database: parsed.database ?? '', user: parsed.user ?? '', password: parsed.password ?? '' };
  } else {
    const port = value('SENTIQ_DB_PORT');
    cfg = {
      server: value('SENTIQ_DB_SERVER').replace(/^tcp:/i, '').replace(/,\d+$/, ''),
      port: port ? Number(port) : 1433,
      database: value('SENTIQ_DB_NAME'),
      user: value('SENTIQ_DB_USER'),
      password: value('SENTIQ_DB_PASSWORD'),
    };
  }
  if (!cfg.server || !cfg.database || !cfg.user || !cfg.password) throw new DbConfigError(MISSING);
  if (/^\{?your_password\}?$/i.test(cfg.password)) throw new DbConfigError('Pune parola bazei de date în locul lui {your_password} din connection string.');
  if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) throw new DbConfigError(`Portul bazei de date nu e valid: ${cfg.port}`);
  return cfg;
}

/** For logs and the health page: never the password. */
export function describeDb(cfg: DbConfig): string {
  return `${cfg.server}/${cfg.database} (${cfg.user})`;
}
