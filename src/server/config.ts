import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface AppConfig {
  /** Where the server listens (FD-USERS §9): every interface by default ('::' = IPv6 and IPv4), '127.0.0.1' for this Mac only. */
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  modelsDir: string;
  webDist: string;
  production: boolean;
  /** Disables outbound jobs (tests). */
  disableJobs: boolean;
  /** Log only to the daily file, not to the console (background launcher, TD-LAUNCH). */
  quietConsole: boolean;
  /** Extra names the server answers to, besides localhost and this Mac's own addresses and names. */
  allowedHosts: string[];
  /** The public address (FD-MCP §2): an origin, `https://host[:port]` (or `http://localhost` for local tests), or null. */
  publicUrl: string | null;
  /** The Claude connector (FD-MCP): on only with `SENTIQ_MCP=1` and a valid public address. */
  mcp: McpConfig;
}

export interface McpConfig {
  /** `SENTIQ_MCP=1` was set. */
  requested: boolean;
  /** Requested and there is a public address: the routes exist. */
  enabled: boolean;
  /** The hosts whose apps may connect (their client documents and callbacks): Claude's by default. */
  clientHosts: string[];
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
  const dataDir = path.resolve(envOf(env, 'DATA_DIR') ?? path.join(projectRoot, 'data'));
  const port = Number(envOf(env, 'PORT') ?? 4317);
  // Installations from before the rename keep their database file.
  const legacyDb = path.join(dataDir, 'kryptoniq.db');
  const publicUrl = parsePublicUrl(envOf(env, 'PUBLIC_URL'));
  const mcpRequested = envOf(env, 'MCP') === '1';
  return {
    // The local network can reach it (FD-USERS §9); the Host allowlist and the sign-in keep everyone else out.
    host: envOf(env, 'BIND')?.trim() || '::',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4317,
    dataDir,
    dbPath: existsSync(legacyDb) ? legacyDb : path.join(dataDir, 'sentiq.db'),
    modelsDir: path.join(dataDir, 'models'),
    webDist: path.join(projectRoot, 'dist', 'web'),
    production: env.NODE_ENV === 'production',
    disableJobs: envOf(env, 'DISABLE_JOBS') === '1',
    quietConsole: envOf(env, 'QUIET') === '1',
    allowedHosts: [...(envOf(env, 'ALLOWED_HOSTS') ?? '').split(',').map((h) => h.trim()).filter(Boolean), ...(publicUrl ? [new URL(publicUrl).host] : [])],
    publicUrl,
    mcp: {
      requested: mcpRequested,
      enabled: mcpRequested && publicUrl !== null,
      clientHosts: (envOf(env, 'MCP_CLIENTS') ?? 'claude.ai,claude.com')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter((h) => /^[a-z0-9.-]+(:\d+)?$/.test(h)),
    },
  };
}

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sentiq/0.2';
