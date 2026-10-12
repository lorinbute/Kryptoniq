import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface AppConfig {
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.KRYPTONIQ_DATA_DIR ?? path.join(projectRoot, 'data'));
  const port = Number(env.KRYPTONIQ_PORT ?? 4317);
  return {
    // Local-only by design: never bind to a public interface.
    host: '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4317,
    dataDir,
    dbPath: path.join(dataDir, 'kryptoniq.db'),
    modelsDir: path.join(dataDir, 'models'),
    webDist: path.join(projectRoot, 'dist', 'web'),
    production: env.NODE_ENV === 'production',
    disableJobs: env.KRYPTONIQ_DISABLE_JOBS === '1',
    quietConsole: env.KRYPTONIQ_QUIET === '1',
  };
}

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Kryptoniq/0.1';
