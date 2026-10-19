// Google Gemini (TD-AIKEYS §2): `generateContent` with a JSON Schema answer. The key goes in a header, never in the URL.
import { z } from 'zod';
import { AiError, type AiAnswer, type AiClient, type AiErrorKind, type AiRequest } from './types.ts';
import { callJson, jsonSchemaOf, kindOfStatus, parseAnswer, type HttpDeps } from './http.ts';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** What Google means by an error: a bad key comes as a 400, an empty free tier as a 429 about the quota. */
export function geminiKind(status: number, body: unknown, text: string): AiErrorKind {
  const all = `${text} ${JSON.stringify(body ?? '')}`;
  if (/API_KEY_INVALID|API key not valid|API_KEY_EXPIRED/i.test(all)) return 'auth';
  // A per-minute limit passes in a moment; a daily one (or a model the free tier does not give: limit 0) does not.
  if (status === 429 && /PerDay|limit: 0\b/i.test(all)) return 'quota';
  if (status === 400 && /FAILED_PRECONDITION|location is not supported|billing/i.test(all)) return 'permission';
  return kindOfStatus(status);
}

/** Thinking is set by level from Gemini 3 on (2.5 had a token budget instead). */
const hasThinkingLevel = (model: string) => /^gemini-(?:[3-9]|\d{2,})/.test(model);
const REFUSED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'LANGUAGE']);

const responseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            finishReason: z.string().nullish(),
            content: z.object({ parts: z.array(z.object({ text: z.string().nullish(), thought: z.boolean().nullish() }).loose()).nullish() }).loose().nullish(),
          })
          .loose(),
      )
      .nullish(),
    promptFeedback: z.object({ blockReason: z.string().nullish() }).loose().nullish(),
    usageMetadata: z.object({ promptTokenCount: z.number().nullish(), candidatesTokenCount: z.number().nullish(), thoughtsTokenCount: z.number().nullish() }).loose().nullish(),
  })
  .loose();

export class GeminiClient implements AiClient {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private readonly key: string;
  private readonly deps: HttpDeps;
  /** The model refused the thinking setting once: not sent again. */
  private noThinking: boolean;

  constructor(key: string, model: string, deps: HttpDeps = {}) {
    this.key = key;
    this.model = model;
    this.deps = deps;
    this.noThinking = !hasThinkingLevel(model);
  }

  async generate<T>(req: AiRequest<T>): Promise<AiAnswer<T>> {
    const body = (thinking: boolean) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchemaOf(req.schema),
        maxOutputTokens: req.maxTokens,
        ...(thinking ? { thinkingConfig: { thinkingLevel: req.effort } } : {}),
      },
    });
    const send = (thinking: boolean) =>
      callJson(
        {
          provider: 'gemini',
          url: `${GEMINI_URL}/models/${encodeURIComponent(this.model)}:generateContent`,
          method: 'POST',
          headers: { 'x-goog-api-key': this.key },
          body: body(thinking),
          timeoutMs: req.timeoutMs,
          signal: req.signal,
          model: this.model,
          classify: geminiKind,
        },
        this.deps,
      );
    let raw: unknown;
    try {
      raw = await send(!this.noThinking);
    } catch (err) {
      if (!(err instanceof AiError && err.kind === 'bad_request' && /thinking/i.test(err.message)) || this.noThinking) throw err;
      this.noThinking = true;
      raw = await send(false);
    }
    const r = responseSchema.safeParse(raw);
    if (!r.success) throw new AiError('gemini', 'other', 200, 'răspuns neașteptat');
    const res = r.data;
    const u = res.usageMetadata;
    // The thinking is billed as output.
    const usage = u ? { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : null;
    if (res.promptFeedback?.blockReason) return { parsed: null, stop: 'refusal', usage };
    const cand = res.candidates?.[0];
    if (!cand) return { parsed: null, stop: 'other', usage };
    const reason = cand.finishReason ?? 'STOP';
    if (REFUSED.has(reason)) return { parsed: null, stop: 'refusal', usage };
    if (reason === 'MAX_TOKENS') return { parsed: null, stop: 'max_tokens', usage };
    const text = (cand.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    const parsed = parseAnswer(text, req.schema);
    return { parsed, stop: parsed ? 'done' : 'other', usage };
  }
}
