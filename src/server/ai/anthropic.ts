// Anthropic (TD-AIKEYS §2): the SDK, as before FD-AIKEYS. Short answers (the scores) through `beta.messages.parse`
// with the server-side fallback; long ones (the summary) streamed.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiError, withinRo, type AiAnswer, type AiClient, type AiErrorKind, type AiRequest } from './types.ts';

export type AnthropicSdk = Pick<Anthropic, 'messages' | 'beta'>;

/** An SDK error as an `AiError`; anything else (an abort) as it is. */
export function fromAnthropic(err: unknown, model?: string): unknown {
  if (!(err instanceof Anthropic.APIError) || err instanceof Anthropic.APIUserAbortError) return err;
  const status = err.status ?? 0;
  // The API's own words ({ type: 'error', error: { message } }), not the SDK's "400 {…}".
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const detail = typeof body?.error?.message === 'string' ? body.error.message : err.message;
  let kind: AiErrorKind;
  if (err instanceof Anthropic.AuthenticationError) kind = 'auth';
  else if (err instanceof Anthropic.PermissionDeniedError) kind = 'permission';
  else if (err instanceof Anthropic.NotFoundError) kind = 'model';
  else if (err instanceof Anthropic.RateLimitError) kind = 'rate';
  else if (err instanceof Anthropic.BadRequestError) kind = /credit balance/i.test(detail) ? 'quota' : 'bad_request';
  else if (err instanceof Anthropic.APIConnectionTimeoutError) kind = 'timeout';
  else if (err instanceof Anthropic.APIConnectionError) kind = 'connection';
  else if (status === 529 || status === 503) kind = 'overloaded';
  else kind = 'other';
  return new AiError('anthropic', kind, status, detail, model);
}

type Stop = AiAnswer<unknown>['stop'];
const stopOf = (reason: string | null | undefined): Stop => (reason === 'refusal' ? 'refusal' : reason === 'max_tokens' ? 'max_tokens' : reason === 'end_turn' ? 'done' : 'other');

export class AnthropicClient implements AiClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private readonly sdk: AnthropicSdk;

  constructor(key: string, model: string, sdk?: AnthropicSdk) {
    this.model = model;
    // The timeout is the request's (below); the SDK's own retries stay.
    this.sdk = sdk ?? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 180_000 });
  }

  async generate<T>(req: AiRequest<T>): Promise<AiAnswer<T>> {
    // FD-AISLOW §1: the time is the whole call's, the SDK's retries within it.
    const deadline = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, deadline]) : deadline;
    try {
      return req.long ? await this.streamed({ ...req, signal }) : await this.parsed({ ...req, signal });
    } catch (err) {
      if (deadline.aborted && !req.signal?.aborted) throw new AiError('anthropic', 'timeout', 0, '', this.model, { said: `Anthropic nu a răspuns ${withinRo(req.timeoutMs)}` });
      throw fromAnthropic(err, this.model);
    }
  }

  private async parsed<T>(req: AiRequest<T>): Promise<AiAnswer<T>> {
    // Haiku has no server-side fallback.
    const fallback = !this.model.includes('haiku');
    const response = await this.sdk.beta.messages.parse(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema as z.ZodType) },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: req.signal, timeout: req.timeoutMs },
    );
    const usage = response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null;
    const stop = stopOf(response.stop_reason);
    const parsed = stop === 'refusal' ? null : ((response.parsed_output as T | null | undefined) ?? null);
    return { parsed, stop: parsed ? 'done' : stop === 'done' ? 'other' : stop, usage };
  }

  private async streamed<T>(req: AiRequest<T>): Promise<AiAnswer<T>> {
    // Streamed: the answer can take a while (adaptive thinking), and a long request is safer as a stream.
    const stream = this.sdk.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema as z.ZodType) },
      },
      { signal: req.signal, timeout: req.timeoutMs },
    );
    const message = await stream.finalMessage();
    const usage = message.usage ? { input: message.usage.input_tokens, output: message.usage.output_tokens } : null;
    const stop = stopOf(message.stop_reason);
    const parsed = stop === 'refusal' ? null : ((message.parsed_output as T | null | undefined) ?? null);
    return { parsed, stop: parsed ? 'done' : stop === 'done' ? 'other' : stop, usage };
  }
}
