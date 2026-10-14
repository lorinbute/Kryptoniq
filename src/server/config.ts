import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DbConfigError, loadDbConfig, type DbConfig } from './db/config.ts';
import type { ProxyMode } from './http/security.ts';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface AppConfig {
  /** Where the server listens (FD-USERS §9): every interface by default ('::' = IPv6 and IPv4), '127.0.0.1' for this Mac only. */
  host: string;
  port: number;
  dataDir: string;
  /** The SQLite file of Sentiq before FD-AZURE: read only by the importer (TD-AZURE §9). */
  legacyDbPath: string;
  /** The Azure SQL connection (TD-AZURE §1), or null with `dbError` saying what is missing. */
  db: DbConfig | null;
  dbError: string | null;
  /** 'azure' behind App Service (TD-AZURE §7). */
  proxy: ProxyMode;
  modelsDir: string;
  webDist: string;
  production: boolean;
  /** Disables outbound jobs (tests). */
  disableJobs: boolean;
  /** Log only to the daily file, not to the console (background launcher, TD-LAUNCH). */
  quietConsole: boolean;
  /** Extra names the server answers to, besides localhost and this Mac's own addresses and names. */
  allowedHosts: string[];
  /** The public address (FD-ONLINE): an origin, `https://host[:port]` (or `http://localhost` for local tests), or null. */
  publicUrl: string | null;
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `SENTIQ_PUBLIC_URL` as an origin: https (or http on this computer, for tests), no path, query or fragment. */
export function parsePublicUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK_NAMES.has(u.hostname))) return null;
  return u.origin.toLowerCase();
}

/** A `SENTIQ_*` setting, or its `KRYPTONIQ_*` name from before the rename (FD-SENTIQ §1). */
export function envOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[`SENTIQ_${name}`] ?? env[`KRYPTONIQ_${name}`];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // App Service sets WEBSITE_SITE_NAME; its wwwroot is rewritten at every deployment, /home is kept (TD-AZURE §1).
  const proxy: ProxyMode = env.WEBSITE_SITE_NAME || envOf(env, 'PROXY') === 'azure' ? 'azure' : null;
  const dataDir = path.resolve(envOf(env, 'DATA_DIR') ?? (env.WEBSITE_SITE_NAME ? '/home/data' : path.join(projectRoot, 'data')));
  const port = Number(envOf(env, 'PORT') ?? env.PORT ?? 4317);
  // Installations from before the rename keep their database file.
  const legacyDb = path.join(dataDir, 'kryptoniq.db');
  const publicUrl = parsePublicUrl(envOf(env, 'PUBLIC_URL'));
  let db: DbConfig | null = null;
  let dbError: string | null = null;
  try {
    db = loadDbConfig(env, dataDir);
  } catch (err) {
    if (!(err instanceof DbConfigError)) throw err;
    dbError = err.message;
  }
  const siteHost = env.WEBSITE_HOSTNAME?.trim().toLowerCase();
  return {
    // The local network can reach it (FD-USERS §9); the Host allowlist and the sign-in keep everyone else out.
    host: envOf(env, 'BIND')?.trim() || '::',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4317,
    dataDir,
    legacyDbPath: existsSync(legacyDb) ? legacyDb : path.join(dataDir, 'sentiq.db'),
    db,
    dbError,
    proxy,
    modelsDir: path.join(dataDir, 'models'),
    webDist: path.join(projectRoot, 'dist', 'web'),
    production: env.NODE_ENV === 'production',
    disableJobs: envOf(env, 'DISABLE_JOBS') === '1',
    quietConsole: envOf(env, 'QUIET') === '1',
    allowedHosts: [
      ...(envOf(env, 'ALLOWED_HOSTS') ?? '').split(',').map((h) => h.trim()).filter(Boolean),
      ...(publicUrl ? [new URL(publicUrl).host] : []),
      ...(siteHost ? [siteHost] : []),
    ],
    publicUrl,
  };
}

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sentiq/0.2';
