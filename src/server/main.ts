// Kryptoniq server entry point: `node src/server/main.ts`.
import path from 'node:path';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';
import { buildApp } from './http/app.ts';
import { registerJobs } from './jobs/register.ts';
import { createLogger } from './log.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(path.join(config.dataDir, 'logs'), config.quietConsole);
  const ctx = createContext(config, log);
  const app = await buildApp(ctx);
  if (!config.disableJobs) {
    registerJobs(ctx);
    ctx.scheduler.start();
    ctx.nli.warmUp();
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      await ctx.scheduler.stop();
    } finally {
      ctx.db.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${(err as Error)?.stack ?? err}`));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use — is Kryptoniq already running?` : `Cannot start: ${e.message}`);
    await ctx.scheduler.stop();
    ctx.db.close();
    process.exit(1);
  }
  log.info(`Kryptoniq running at http://${config.host}:${config.port}`);
}

void main();
