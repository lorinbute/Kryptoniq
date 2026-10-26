// The HTTP side of the OpenAI and Gemini clients and of the model lists (TD-AIKEYS §2): JSON in and out, a timeout,
// the caller's abort, a few retries on a busy provider, and the provider's error turned into an `AiError`.
import { z } from 'zod';
import { AI_PROVIDER_INFO, type AiProvider } from '../../shared/ai.ts';
import { USER_AGENT } from '../config.ts';
import { AiError, withinRo, type AiErrorKind, type AiExplained } from './types.ts';

export type FetchFn = typeof fetch;

export interface HttpDeps {
  fetch?: FetchFn;
  /** Waits between retries (tests: none). */
  sleep?: (ms: number) => Promise<void>;
}

/** Waits before the 1st and the 2nd retry; a Retry-After up to `MAX_RETRY_AFTER_MS` is used instead. */
export const RETRY_DELAYS_MS = [1_000, 4_000];
const MAX_RETRY_AFTER_MS = 20_000;
const MAX_BODY = 8 * 1024 * 1024;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface JsonCall {
  provider: AiProvider;
  url: string;
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Named in the error when the provider does not know it. */
  model?: string;
  /** Says which error the provider meant (status, its JSON body). */
  classify: (status: number, body: unknown, text: string) => AiErrorKind;
  /** Says it more precisely, when the provider tells which limit (FD-AIQUOTA). */
  explain?: (kind: AiErrorKind, status: number, body: unknown, text: string) => AiExplained | null;
}

/** The provider's error text: `{ error: { message } }` for both OpenAI and Google. */
export function errorText(body: unknown, text: string): string {
  const parsed = z.object({ error: z.object({ message: z.string() }).loose() }).loose().safeParse(body);
  if (parsed.success) return parsed.data.error.message;
  return text.slice(0, 300);
}

/** No answer in the call's time: said with that time (FD-AISLOW §1). */
const timedOut = (call: JsonCall) =>
  new AiError(call.provider, 'timeout', 0, '', call.model, { said: `${AI_PROVIDER_INFO[call.provider].name} nu a răspuns ${withinRo(call.timeoutMs)}` });

async function once(call: JsonCall, fetchImpl: FetchFn, ms: number): Promise<{ status: number; body: unknown; text: string; retryAfter: number | null }> {
  const timeout = AbortSignal.timeout(ms);
  const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(call.url, {
      method: call.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(call.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...call.headers },
      body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      signal,
    });
  } catch (err) {
    if (call.signal?.aborted) throw err;
    const e = err as Error & { cause?: { code?: string } };
    if (timeout.aborted || e.name === 'TimeoutError') throw timedOut(call);
    throw new AiError(call.provider, 'connection', 0, e.cause?.code ?? e.message);
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) {
    await res.body?.cancel();
    throw new AiError(call.provider, 'other', res.status, 'răspuns prea mare');
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (call.signal?.aborted) throw err;
    if (timeout.aborted) throw timedOut(call);
    throw new AiError(call.provider, 'connection', 0, (err as Error).message);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const ra = Number(res.headers.get('retry-after'));
  return { status: res.status, body, text, retryAfter: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null };
}

/**
 * The JSON answer of a successful call; an `AiError` otherwise (after the retries a busy provider is worth). The time
 * is the whole call's, retries included (FD-AISLOW §1): a slow provider holds the caller up that long at most.
 */
export async function callJson(call: JsonCall, deps: HttpDeps = {}): Promise<unknown> {
  const fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = Date.now() + call.timeoutMs;
  for (let attempt = 0; ; attempt++) {
    let error: AiError;
    let wait: number | null = null;
    try {
      const r = await once(call, fetchImpl, Math.max(1, deadline - Date.now()));
      if (r.status >= 200 && r.status < 300) {
        if (r.body === null) throw new AiError(call.provider, 'other', r.status, 'răspunsul nu e JSON');
        return r.body;
      }
      const kind = call.classify(r.status, r.body, r.text);
      error = new AiError(call.provider, kind, r.status, errorText(r.body, r.text), call.model, call.explain?.(kind, r.status, r.body, r.text));
      wait = r.retryAfter;
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      error = err;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    // A timeout is not repeated: the caller's time is already spent; nor is a call whose time would go on the wait.
    if (!error.transient || delay === undefined || call.signal?.aborted) throw error;
    const pause = wait !== null && wait <= MAX_RETRY_AFTER_MS ? wait : delay;
    if (Date.now() + pause >= deadline) throw error;
    await sleep(pause);
  }
}

/** The usual meaning of an HTTP status, for the providers that say little more. */
export function kindOfStatus(status: number): AiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 404) return 'model';
  if (status === 429) return 'rate';
  if (status === 400 || status === 413 || status === 422) return 'bad_request';
  if (status === 503 || status === 529) return 'overloaded';
  return 'other';
}

/** A JSON Schema for the providers' structured output: what zod gives, without the `$schema` line. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** The text of a JSON answer, checked against the schema (null when it is not JSON or does not fit). */
export function parseAnswer<T>(text: string, schema: z.ZodType<T>): T | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}
