// One way to ask any provider for a structured answer (FD-AIKEYS, TD-AIKEYS §2): the news scores and the day summary
// do not know whose model answers.
import type { z } from 'zod';
import { AI_PROVIDER_INFO, type AiProvider } from '../../shared/ai.ts';

export interface AiRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Names the schema for the providers that want a name. */
  name: string;
  maxTokens: number;
  /** How hard the model thinks: 'low' for the scores, 'medium' for the summary. */
  effort: 'low' | 'medium';
  /** A long answer: streamed where the provider asks for it (Anthropic). */
  long?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiAnswer<T> {
  /** The answer, checked against the schema; null when there is none to use (`stop` says why). */
  parsed: T | null;
  stop: 'done' | 'max_tokens' | 'refusal' | 'other';
  /** Tokens the provider counted: billed whatever the answer. Null when it said none. */
  usage: { input: number; output: number } | null;
}

export interface AiClient {
  readonly provider: AiProvider;
  readonly model: string;
  /** Throws `AiError` when the provider refuses the request or cannot be reached. */
  generate<T>(req: AiRequest<T>): Promise<AiAnswer<T>>;
}

export type AiErrorKind = 'auth' | 'permission' | 'model' | 'quota' | 'rate' | 'bad_request' | 'overloaded' | 'connection' | 'timeout' | 'other';

/** What a provider said about its error, beyond its kind (FD-AIQUOTA): which limit, and when it resets. */
export interface AiExplained {
  /** Said instead of the kind's usual words. */
  said: string;
  /** When a daily limit resets (null: it does not, or the provider does not say). */
  resetsAt: number | null;
}

/** Kinds whose Romanian words leave out the provider's, who alone says which limit (FD-AIQUOTA §1). */
const SHOWS_DETAIL: ReadonlySet<AiErrorKind> = new Set(['quota', 'rate']);
const DETAIL_MAX = 600;

/** A provider's own words, fit to be shown and logged: spaces folded, anything like a key hidden, cut. */
export function providerWords(text: string): string {
  const t = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:sk-[\w*-]{6,}|AIza[\w-]{10,})/g, '…');
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX - 1)}…` : t;
}

/** A provider's error, said in Romanian (the settings panel and the summary show it as it is). */
export class AiError extends Error {
  readonly provider: AiProvider;
  readonly kind: AiErrorKind;
  readonly status: number;
  /** The provider's own words, for the kinds whose message leaves them out (a quota, a limit); null otherwise. */
  readonly detail: string | null;
  /** When the daily limit refused resets (FD-AIQUOTA §1). */
  readonly resetsAt: number | null;

  constructor(provider: AiProvider, kind: AiErrorKind, status: number, detail: string, model?: string, extra?: Partial<AiExplained> | null) {
    super(extra?.said ?? describe(provider, kind, status, detail, model));
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.detail = SHOWS_DETAIL.has(kind) ? providerWords(detail) || null : null;
    this.resetsAt = extra?.resetsAt ?? null;
  }

  /** The key or the model will not work until the user changes them: no point asking again meanwhile. */
  get permanent(): boolean {
    return this.kind === 'auth' || this.kind === 'permission' || this.kind === 'model';
  }

  /** Worth another try in a moment. */
  get transient(): boolean {
    return this.kind === 'rate' || this.kind === 'overloaded' || this.kind === 'connection' || (this.kind === 'other' && this.status >= 500);
  }

  /** Likely gone by the next run (FD-AISLOW §2): a busy or slow provider, also one that did not answer in time. */
  get passing(): boolean {
    return this.transient || this.kind === 'timeout';
  }
}

/** Two or more of a unit, with the Romanian „de” from 20 on: „3 minute”, „20 de secunde”. */
const countRo = (n: number, unit: string): string => `${n}${n % 100 >= 20 || n % 100 === 0 ? ' de' : ''} ${unit}`;

/** How long was waited, in Romanian (FD-AISLOW §1): „în 15 secunde”, „într-un minut”, „în 3 minute”. */
export function withinRo(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const m = ms / 60_000;
    return m === 1 ? 'într-un minut' : `în ${countRo(m, 'minute')}`;
  }
  const s = Math.max(1, Math.round(ms / 1000));
  return s === 1 ? 'într-o secundă' : `în ${countRo(s, 'secunde')}`;
}

function describe(provider: AiProvider, kind: AiErrorKind, status: number, detail: string, model?: string): string {
  const name = AI_PROVIDER_INFO[provider].name;
  // The provider's words some messages carry: never a key, even one the provider quotes back.
  const short = providerWords(detail).slice(0, 300);
  switch (kind) {
    case 'auth':
      return `cheia API ${name} nu este validă`;
    case 'permission':
      return `cheia API ${name} nu are acces${model ? ` la modelul ${model}` : ''}${short ? ` (${short})` : ''}`;
    case 'model':
      return `${model ? `modelul ${model}` : 'modelul ales'} nu există sau nu e disponibil pentru cheia ta ${name}`;
    case 'quota':
      return `contul ${name} nu mai are credit sau a atins limita planului`;
    case 'rate':
      return `limită de cereri ${name} atinsă`;
    case 'bad_request':
      return `cerere respinsă de ${name}: ${short}`;
    case 'overloaded':
      return `${name} e supraîncărcat acum`;
    case 'connection':
      return `nu se poate conecta la ${name}${short ? ` (${short})` : ''}`;
    case 'timeout':
      return `${name} nu a răspuns la timp`;
    default:
      return `eroare ${name}${status ? ` ${status}` : ''}${short ? `: ${short}` : ''}`;
  }
}

/** Any error in Romanian: a provider's as `AiError` says it, anything else by its message. */
export function describeAiError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** An error for the log: the Romanian words and, where they leave them out, the provider's own. */
export function aiErrorLine(err: unknown): string {
  const said = describeAiError(err);
  return err instanceof AiError && err.detail ? `${said} (${AI_PROVIDER_INFO[err.provider].name}: ${err.detail})` : said;
}
