// Short retries for exchange reads that were refused for a moment (TD-RATELIMIT): KuCoin's 429000 (own quota or
// "System-level rate limit exceeded" when it is overloaded) and passing network errors.
import ccxt from 'ccxt';

/**
 * True for a rate limit, including KuCoin's `429000`, which ccxt reports as a plain ExchangeError
 * (`kucoin {"code":"429000","msg":"Too many requests. …"}`).
 */
export function isRateLimitError(err: unknown): boolean {
  if (err instanceof ccxt.RateLimitExceeded || err instanceof ccxt.DDoSProtection) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /"code"\s*:\s*"?429000\b/.test(message) || /too many requests/i.test(message);
}

/** Worth trying again in a few seconds: a rate limit or a network error that is neither a timeout nor maintenance. */
export function isTransientError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  return err instanceof ccxt.NetworkError && !(err instanceof ccxt.RequestTimeout) && !(err instanceof ccxt.OnMaintenance);
}

export interface RetryOptions {
  /** Waits before each new attempt; its length is the number of retries. */
  delaysMs?: readonly number[];
  retryIf?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying transient failures after each delay (±25% jitter); other errors are thrown at once. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delaysMs ?? [1500, 4000];
  const retryIf = opts.retryIf ?? isTransientError;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !retryIf(err)) throw err;
      if (delay > 0) await sleep(Math.round(delay * (0.75 + Math.random() * 0.5)));
    }
  }
}
