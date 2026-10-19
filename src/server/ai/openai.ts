// OpenAI (TD-AIKEYS §2): the Responses API with a strict JSON Schema. Nothing is kept on OpenAI's side (`store: false`).
import { z } from 'zod';
import { AiError, type AiAnswer, type AiClient, type AiErrorKind, type AiRequest } from './types.ts';
import { callJson, jsonSchemaOf, kindOfStatus, parseAnswer, type HttpDeps } from './http.ts';

export const OPENAI_URL = 'https://api.openai.com/v1';

/** What OpenAI means by an error: an empty account is not a busy one. */
export function openAiKind(status: number, body: unknown): AiErrorKind {
  const code = z.object({ error: z.object({ code: z.string().nullish(), type: z.string().nullish() }).loose() }).loose().safeParse(body);
  const c = code.success ? `${code.data.error.code ?? ''} ${code.data.error.type ?? ''}` : '';
  if (/insufficient_quota|billing_hard_limit/.test(c)) return 'quota';
  if (/model_not_found/.test(c)) return 'model';
  if (/invalid_api_key/.test(c)) return 'auth';
  return kindOfStatus(status);
}

const responseSchema = z
  .object({
    status: z.string().nullish(),
    incomplete_details: z.object({ reason: z.string().nullish() }).loose().nullish(),
    error: z.object({ message: z.string().nullish() }).loose().nullish(),
    output: z
      .array(
        z
          .object({
            type: z.string(),
            content: z.array(z.object({ type: z.string(), text: z.string().nullish(), refusal: z.string().nullish() }).loose()).nullish(),
          })
          .loose(),
      )
      .nullish(),
    usage: z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish() }).loose().nullish(),
  })
  .loose();

export class OpenAiClient implements AiClient {
  readonly provider = 'openai' as const;
  readonly model: string;
  private readonly key: string;
  private readonly deps: HttpDeps;
  /** The model refused the reasoning setting once (a model without reasoning): not sent again. */
  private noReasoning = false;

  constructor(key: string, model: string, deps: HttpDeps = {}) {
    this.key = key;
    this.model = model;
    this.deps = deps;
  }

  async generate<T>(req: AiRequest<T>): Promise<AiAnswer<T>> {
    const body = (withReasoning: boolean) => ({
      model: this.model,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: req.maxTokens,
      store: false,
      text: { format: { type: 'json_schema', name: req.name, schema: jsonSchemaOf(req.schema), strict: true } },
      ...(withReasoning ? { reasoning: { effort: req.effort } } : {}),
    });
    const send = (withReasoning: boolean) =>
      callJson(
        {
          provider: 'openai',
          url: `${OPENAI_URL}/responses`,
          method: 'POST',
          headers: { Authorization: `Bearer ${this.key}` },
          body: body(withReasoning),
          timeoutMs: req.timeoutMs,
          signal: req.signal,
          model: this.model,
          classify: openAiKind,
        },
        this.deps,
      );
    let raw: unknown;
    try {
      raw = await send(!this.noReasoning);
    } catch (err) {
      // A model without reasoning says so in a 400: asked again without it.
      if (!(err instanceof AiError && err.kind === 'bad_request' && /reasoning/i.test(err.message)) || this.noReasoning) throw err;
      this.noReasoning = true;
      raw = await send(false);
    }
    const r = responseSchema.safeParse(raw);
    if (!r.success) throw new AiError('openai', 'other', 200, 'răspuns neașteptat');
    const res = r.data;
    const usage = res.usage ? { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0 } : null;
    if (res.status === 'failed') throw new AiError('openai', 'other', 200, res.error?.message ?? 'cererea a eșuat');
    let text = '';
    let refused = false;
    for (const item of res.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) text += part.text;
        else if (part.type === 'refusal') refused = true;
      }
    }
    if (refused) return { parsed: null, stop: 'refusal', usage };
    if (res.status === 'incomplete') {
      const reason = res.incomplete_details?.reason ?? '';
      return { parsed: null, stop: reason === 'max_output_tokens' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : 'other', usage };
    }
    const parsed = parseAnswer(text, req.schema);
    return { parsed, stop: parsed ? 'done' : 'other', usage };
  }
}
