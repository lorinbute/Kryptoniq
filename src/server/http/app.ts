// Fastify app: security hooks, JSON API (TD §11), static web build with SPA fallback.
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HttpError } from '../net/http.ts';
import { MarketError } from '../market/market.ts';
import { ValidationError } from '../settings.ts';
import type { AppContext } from '../context.ts';
import { registerSecurity } from './security.ts';
import { registerRoutes } from './routes.ts';
import { ConflictError, NotFoundError } from './errors.ts';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: false });
  registerSecurity(app);

  // JSON bodies; an empty body (e.g. DELETE sent with a JSON content type) is simply "no body".
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body);
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Corpul cererii nu este JSON valid') as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'BAD_JSON';
      done(err, undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError || err instanceof z.ZodError) {
      const details = err instanceof ValidationError ? err.details : err.issues;
      return reply.code(400).send({ error: { code: 'VALIDATION', message: err.message, details } });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    if (err instanceof ConflictError) return reply.code(409).send({ error: { code: 'CONFLICT', message: err.message } });
    if (err instanceof MarketError) {
      const status = err.code === 'UNKNOWN_SYMBOL' ? 404 : err.code === 'EXCHANGE_ERROR' ? 502 : 400;
      return reply.code(status).send({ error: { code: err.code, message: err.message, suggestions: err.suggestions } });
    }
    if (err instanceof HttpError) return reply.code(502).send({ error: { code: err.code, message: err.message } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message ?? 'Cerere invalidă' } });
    }
    ctx.log.error(`unhandled ${(err as Error).stack ?? err}`);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Eroare internă (detalii în data/logs)' } });
  });

  await registerRoutes(app, ctx);

  const webDist = ctx.config.webDist;
  const hasWeb = existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      // Files are looked up on disk per request, so a rebuilt UI is served without restarting (TD-STATIC).
      wildcard: true,
      index: false,
      setHeaders(res, filePath) {
        // Hashed assets never change; the page itself must never come from a browser cache.
        res.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-store');
      },
    });
    // The root is a directory, which the static plugin refuses (403) with `index: false`.
    app.get('/', (_req, reply) => reply.header('Cache-Control', 'no-store').sendFile('index.html'));
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Ruta ${req.method} ${req.url.split('?')[0]} nu există` } });
    }
    if (!hasWeb) {
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send('Kryptoniq: web build missing. Run `npm start` (build + serve) or `npm run dev` and open http://127.0.0.1:5317');
    }
    // A missing file (e.g. a JS chunk of an older build) is a real 404: answering with the page would hand
    // the browser HTML where it expects JavaScript, leaving a blank screen.
    if (/\.[a-z0-9]+$/i.test(req.url.split('?')[0] ?? '')) {
      return reply.code(404).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('Fișierul nu există.');
    }
    return reply.header('Cache-Control', 'no-store').sendFile('index.html');
  });

  return app;
}
