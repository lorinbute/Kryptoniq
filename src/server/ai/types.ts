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

/** A provider's error, said in Romanian (the settings panel and the summary show it as it is). */
export class AiError extends Error {
  readonly provider: AiProvider;
  readonly kind: AiErrorKind;
  readonly status: number;

  constructor(provider: AiProvider, kind: AiErrorKind, status: number, detail: string, model?: string) {
    super(describe(provider, kind, status, detail, model));
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }

  /** The key or the model will not work until the user changes them: no point asking again meanwhile. */
  get permanent(): boolean {
    return this.kind === 'auth' || this.kind === 'permission' || this.kind === 'model';
  }

  /** Worth another try in a moment. */
  get transient(): boolean {
    return this.kind === 'rate' || this.kind === 'overloaded' || this.kind === 'connection' || (this.kind === 'other' && this.status >= 500);
  }
}

function describe(provider: AiProvider, kind: AiErrorKind, status: number, detail: string, model?: string): string {
  const name = AI_PROVIDER_INFO[provider].name;
  const short = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
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
