// The brokers' order requests (TD-TRADING §3): one try each, JSON in and out, the HTTP status turned into a trading
// error with the broker's own words. A request that left but got no answer is "unknown", never retried.
import { HttpError, httpRequest } from '../../net/http.ts';
import { TradingError, UNKNOWN_OUTCOME_MESSAGE } from './types.ts';

/** The broker's message out of an error body (JSON or text), short. */
export function brokerMessage(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    for (const k of ['message', 'errorMessage', 'error', 'detail', 'title', 'code']) {
      const v = j[k];
      if (typeof v === 'string' && v) return v.slice(0, 300);
      if (v && typeof v === 'object') {
        const inner = (v as Record<string, unknown>).message ?? (v as Record<string, unknown>).description;
        if (typeof inner === 'string' && inner) return inner.slice(0, 300);
      }
    }
    const errors = j.errors;
    if (errors && typeof errors === 'object') return JSON.stringify(errors).slice(0, 300);
  } catch {
    // not JSON
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export interface CallOptions {
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  /** A write: a lost answer means the outcome is unknown. */
  write?: boolean;
  /** What a 403 means for this broker (the permission to add). */
  forbidden: string;
  timeoutMs?: number;
}

/** One request; the parsed JSON (null for an empty body) or a TradingError. */
export async function brokerCall(broker: string, url: string, o: CallOptions): Promise<unknown> {
  let r;
  try {
    r = await httpRequest(url, {
      method: o.method,
      headers: { Accept: 'application/json', ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      timeoutMs: o.timeoutMs ?? 20_000,
    });
  } catch (err) {
    if (o.write && err instanceof HttpError) throw new TradingError('UNKNOWN_OUTCOME', UNKNOWN_OUTCOME_MESSAGE);
    throw new TradingError('REJECTED', `${broker} nu răspunde acum (${(err as Error).message})`);
  }
  if (r.status >= 200 && r.status < 300) {
    if (!r.body.trim()) return null;
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      return null;
    }
  }
  const msg = brokerMessage(r.body);
  const tail = msg ? `: ${msg}` : '';
  if (r.status === 401) throw new TradingError('PERMISSION', `${broker}: cheia nu e validă (sau e pentru alt mediu)${tail}`);
  if (r.status === 403) {
    if (/buying power|insufficient|not enough/i.test(msg)) throw new TradingError('INSUFFICIENT', `${broker}: fonduri insuficiente${tail}`);
    throw new TradingError('PERMISSION', `${broker}: ${o.forbidden}${tail}`);
  }
  if (r.status === 404) throw new TradingError('NOT_FOUND', `${broker}: nu există${tail}`);
  if (r.status === 408 || r.status === 504) {
    if (o.write) throw new TradingError('UNKNOWN_OUTCOME', UNKNOWN_OUTCOME_MESSAGE);
    throw new TradingError('REJECTED', `${broker} nu a răspuns la timp${tail}`);
  }
  if (r.status === 429) throw new TradingError('RATE_LIMIT', `${broker} limitează cererile acum; încearcă din nou peste câteva secunde${tail}`);
  if (/insufficient|not enough|buying power/i.test(msg)) throw new TradingError('INSUFFICIENT', `${broker}: fonduri insuficiente${tail}`);
  if (/market (is )?closed|outside.*hours|not.*trading hours/i.test(msg)) throw new TradingError('MARKET_CLOSED', `${broker}: piața e închisă${tail}`);
  if (r.status >= 500 && o.write) throw new TradingError('UNKNOWN_OUTCOME', `${UNKNOWN_OUTCOME_MESSAGE} (${broker}: HTTP ${r.status}${tail})`);
  throw new TradingError('REJECTED', `${broker} a refuzat${tail}`);
}
