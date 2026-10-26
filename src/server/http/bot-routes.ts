// The trading bots' API (FD-BOT, TD-BOT §5): each user's own bots only (anybody else's are "not found").
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { botEditSchema, botInputSchema, botStopSchema } from '../../shared/bot.ts';
import type { AppContext } from '../context.ts';
import { formatIssues, ValidationError } from '../settings.ts';
import { me } from './auth.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ValidationError(`Cerere invalidă: ${formatIssues(r.error.issues)}`, r.error.issues);
  return r.data;
}

export async function registerBotRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const bots = ctx.bots;
  app.get('/api/bots', async (req) => bots.list(me(req).id));
  app.get('/api/bots/:id', async (req) => bots.detail(me(req).id, parse(idParam, req.params).id));
  app.post('/api/bots/check', async (req) => bots.check(me(req).id, parse(botInputSchema, req.body)));
  app.post('/api/bots', async (req) => bots.create(me(req).id, parse(botInputSchema, req.body)));
  app.put('/api/bots/:id', async (req) => bots.edit(me(req).id, parse(idParam, req.params).id, parse(botEditSchema, req.body)));
  app.post('/api/bots/:id/pause', async (req) => bots.pause(me(req).id, parse(idParam, req.params).id));
  app.post('/api/bots/:id/resume', async (req) => bots.resume(me(req).id, parse(idParam, req.params).id));
  app.post('/api/bots/:id/stop', async (req) => bots.stop(me(req).id, parse(idParam, req.params).id, parse(botStopSchema, req.body).action));
  app.delete('/api/bots/:id', async (req) => {
    await bots.remove(me(req).id, parse(idParam, req.params).id);
    return { ok: true };
  });
}
