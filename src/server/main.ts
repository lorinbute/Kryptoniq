// Sentiq server entry point: `node src/server/main.ts`.
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';
import { describeDb } from './db/config.ts';
import { Db } from './db/database.ts';
import { buildApp } from './http/app.ts';
import { registerJobs } from './jobs/register.ts';
import { createLogger } from './log.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(path.join(config.dataDir, 'logs'), config.quietConsole);
  // FD-AZURE §2: without a database Sentiq does not start, and says what to fix.
  if (!config.db) {
    log.error(config.dbError ?? 'Baza de date nu e configurată.');
    process.exit(1);
  }
  let db: Db;
  try {
    db = await Db.open(config.db);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
  log.info(`database: ${describeDb(config.db)}`);
  let ctx: Awaited<ReturnType<typeof createContext>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  try {
    ctx = await createContext(config, log, { db });
    app = await buildApp(ctx);
  } catch (err) {
    log.error(`Cannot start: ${(err as Error).stack ?? err}`);
    await db.close();
    process.exit(1);
  }
  if (!config.disableJobs) {
    registerJobs(ctx);
    // Only one process on this database runs the jobs (TD-AZURE §6).
    await ctx.scheduler.start();
    ctx.nli.warmUp();
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    // A shutdown that hangs (an open stream, a stuck query) must not leave a process behind holding connections (FD-DBHEAL).
    setTimeout(() => {
      log.warn('shutdown took over 15 s: exiting now');
      process.exit(0);
    }, 15_000).unref();
    try {
      await app.close();
      await ctx.scheduler.stop();
    } finally {
      await ctx.db.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${(err as Error)?.stack ?? err}`));

  let host = config.host;
  try {
    try {
      await app.listen({ host, port: config.port });
    } catch (err) {
      // A Mac with IPv6 turned off cannot listen on '::'; every IPv4 interface is the same reach.
      if (host !== '::' || (err as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT') throw err;
      host = '0.0.0.0';
      await app.listen({ host, port: config.port });
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use — is Sentiq already running?` : `Cannot start: ${e.message}`);
    await ctx.scheduler.stop();
    await ctx.db.close();
    process.exit(1);
  }
  log.info(config.proxy ? `Sentiq running on port ${config.port}, behind Azure App Service` : `Sentiq running at http://localhost:${config.port}`);
  if (!config.proxy && (host === '::' || host === '0.0.0.0')) {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a!.address}:${config.port}`);
    if (lan.length) log.info(`On the local network: ${lan.join(', ')} (passkeys do not work on an IP address: use http://localhost here)`);
  }
}

void main();
