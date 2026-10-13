// Sentiq server entry point: `node src/server/main.ts`.
import { networkInterfaces } from 'node:os';
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
    ctx.db.close();
    process.exit(1);
  }
  log.info(`Sentiq running at http://localhost:${config.port}`);
  if (host === '::' || host === '0.0.0.0') {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a!.address}:${config.port}`);
    if (lan.length) log.info(`On the local network: ${lan.join(', ')} (passkeys work only on http://localhost)`);
  }
  // FD-MCP §2: the Claude connector is off unless both settings are there.
  if (ctx.oauth) log.info(`Claude connector on: ${ctx.oauth.resource}`);
  else if (config.mcp.requested) log.warn('SENTIQ_MCP=1 but SENTIQ_PUBLIC_URL is missing or not https: the Claude connector stays off');
}

void main();
