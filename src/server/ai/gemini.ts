// Google Gemini (TD-AIKEYS §2): `generateContent` with a JSON Schema answer. The key goes in a header, never in the URL.
import { z } from 'zod';
import { dayBounds, dayKey } from '../../shared/time.ts';
import { AiError, type AiAnswer, type AiClient, type AiErrorKind, type AiExplained, type AiRequest } from './types.ts';
import { callJson, errorText, jsonSchemaOf, kindOfStatus, parseAnswer, type HttpDeps } from './http.ts';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** An empty Prepay balance (FD-AIQUOTA): a 402, sometimes a 429 that says so. */
const PREPAY_RE = /prepayment credits/i;

/** What Google means by an error: a bad key comes as a 400, an empty free tier as a 429 about the quota. */
export function geminiKind(status: number, body: unknown, text: string): AiErrorKind {
  const all = `${text} ${JSON.stringify(body ?? '')}`;
  if (/API_KEY_INVALID|API key not valid|API_KEY_EXPIRED/i.test(all)) return 'auth';
  // No credit left on a Prepay project: nothing is served until it is topped up.
  if (status === 402 || (status === 429 && PREPAY_RE.test(all))) return 'quota';
  // A per-minute limit passes in a moment; a daily one (its quota id, or a metric "…_per_day" when only the message
  // names it) or a model the free tier does not give (limit 0) does not.
  if (status === 429 && /PerDay|per_day\b|limit: 0\b/i.test(all)) return 'quota';
  if (status === 400 && /FAILED_PRECONDITION|location is not supported|billing/i.test(all)) return 'permission';
  return kindOfStatus(status);
}

/** One limit Google says was passed. */
export interface GeminiLimit {
  metric: string;
  /** Its quota id ("GenerateRequestsPerDayPerProjectPerModel-FreeTier"); empty when only the message names it. */
  id: string;
  model: string | null;
  /** The limit itself; null when Google does not say. */
  limit: number | null;
}

const violationSchema = z.object({ quotaMetric: z.string().nullish(), quotaId: z.string().nullish(), quotaDimensions: z.record(z.string(), z.unknown()).nullish(), quotaValue: z.unknown().optional() }).loose();
const quotaBodySchema = z.object({ error: z.object({ details: z.array(z.unknown()).nullish() }).loose() }).loose();
const LIMIT_LINE_RE = /Quota exceeded for metric:\s*([^\s,]+),\s*limit:\s*(\d+)(?:,\s*model:\s*([\w.-]+))?/gi;

const numberOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The limits a 429 says were passed: the `QuotaFailure` details, and the message's lines (which also give the limit). */
export function geminiLimits(body: unknown, text: string): GeminiLimit[] {
  const lines = [...errorText(body, text).matchAll(LIMIT_LINE_RE)].map((m) => ({ metric: m[1] as string, id: '', model: m[3] ?? null, limit: Number(m[2]) }));
  const out: GeminiLimit[] = [];
  const used = new Set<GeminiLimit>();
  const parsed = quotaBodySchema.safeParse(body);
  for (const d of parsed.success ? (parsed.data.error.details ?? []) : []) {
    const violations = z.object({ violations: z.array(z.unknown()) }).loose().safeParse(d);
    if (!violations.success) continue;
    for (const raw of violations.data.violations) {
      const v = violationSchema.safeParse(raw);
      if (!v.success) continue;
      const metric = v.data.quotaMetric ?? '';
      const model = typeof v.data.quotaDimensions?.model === 'string' ? v.data.quotaDimensions.model : null;
      // Google writes a line per limit, in the same order: the per-minute and the per-day ones share a metric.
      const line = lines.find((l) => !used.has(l) && l.metric === metric && (!model || !l.model || l.model === model));
      if (line) used.add(line);
      out.push({ metric, id: v.data.quotaId ?? '', model: model ?? line?.model ?? null, limit: numberOf(v.data.quotaValue) ?? line?.limit ?? null });
    }
  }
  // Only the message: its lines are the limits.
  return out.length ? out : lines;
}

const LA = 'America/Los_Angeles';
/** Google's daily limits reset at midnight Pacific time. */
export const nextPacificMidnight = (now: number) => dayBounds(dayKey(now, LA), LA).end;

const isDaily = (l: GeminiLimit) => /PerDay/i.test(l.id) || /per_day/i.test(l.metric);
const isFree = (l: GeminiLimit) => /FreeTier/i.test(l.id) || /free_tier/i.test(l.metric);
const BILLING = 'AI Studio, la Billing';
const requestsRo = (n: number): string => (n === 1 ? 'o cerere' : `${n}${n % 100 >= 20 || (n > 0 && n % 100 === 0) ? ' de' : ''} cereri`);

/** A refused Gemini call said exactly (FD-AIQUOTA §1): an empty Prepay balance, which limit, when it resets. */
export function explainGemini(kind: AiErrorKind, status: number, body: unknown, text: string, model: string | null, now = Date.now()): AiExplained | null {
  if (kind !== 'quota') return null;
  if (status === 402 || PREPAY_RE.test(`${text} ${errorText(body, text)}`)) {
    return {
      said: `creditul preplătit (Prepay) al proiectului Google al cheii e epuizat: adaugă credit în ${BILLING}. Creditele primite cu abonamentul se folosesc doar cât soldul Prepay e peste 0`,
      resetsAt: null,
    };
  }
  const limits = geminiLimits(body, text);
  const zero = limits.find((l) => l.limit === 0);
  if (zero) {
    const m = zero.model ?? model;
    return isFree(zero)
      ? { said: `modelul${m ? ` ${m}` : ''} nu e inclus în nivelul gratuit Google: cheia trebuie să fie dintr-un proiect cu facturare (${BILLING})`, resetsAt: null }
      : { said: `proiectul Google al cheii are limita 0${m ? ` pentru ${m}` : ''}: modelul nu e disponibil pe nivelul proiectului (vezi AI Studio, la Rate limits)`, resetsAt: null };
  }
  const daily = limits.find(isDaily);
  if (!daily) return null;
  const m = daily.model ?? model;
  const of = m ? ` pentru ${m}` : '';
  const given = daily.limit !== null ? `: ${requestsRo(daily.limit)} pe zi${of}` : of;
  const resetsAt = nextPacificMidnight(now);
  if (isFree(daily)) {
    return {
      said: `cheia e pe nivelul gratuit Google și a atins limita lui zilnică${given}. Limita e a proiectului Google, nu a cheii: o cheie nouă din același proiect nu ajută. Pentru mai mult, proiectul cheii trebuie legat de facturare (${BILLING})`,
      resetsAt,
    };
  }
  return { said: `proiectul Google al cheii a atins limita zilnică a nivelului său${given}. Limita e a proiectului, nu a cheii`, resetsAt };
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
          explain: (kind, status, b, text) => explainGemini(kind, status, b, text, this.model),
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
