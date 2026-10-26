// Outbound HTTP with timeouts, a response-size cap and conditional requests.
import { USER_AGENT } from '../config.ts';
import { BrotliRefused, plainFetch } from './plain-fetch.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface FetchTextOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchTextResult {
  status: number;
  notModified: boolean;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
}

export type FetchFn = typeof fetch;

let hook: FetchFn | null = null;
/**
 * FIX-BROTLI: outside content (feeds, pages, calendars) comes through `plainFetch`, which never decodes Brotli; the APIs
 * of known services (brokers, e-mail, market data) keep Node's fetch.
 */
const contentFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response> => (hook ? hook(url, { ...init, redirect: 'follow' }) : plainFetch(url, init));
const apiFetch: FetchFn = (...args) => (hook ?? fetch)(...args);

/** Test hook: replace the network layer (both ways out). */
export function setFetchImpl(fn: FetchFn | null): void {
  hook = fn;
}

export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<FetchTextResult> {
  const { timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024 } = opts;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...opts.headers };
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;
  let res: Response;
  try {
    res = await contentFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof BrotliRefused) throw new HttpError('BROTLI', err.message);
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError('TIMEOUT', `Niciun răspuns în ${Math.round(timeoutMs / 1000)} s`);
    throw new HttpError('NETWORK', e.cause?.code ? `${e.message} (${e.cause.code})` : e.message);
  }
  const meta = {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
  if (res.status === 304) {
    await res.body?.cancel();
    return { ...meta, notModified: true, body: '' };
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new HttpError('RATE_LIMITED', 'Prea multe cereri (HTTP 429)', 429);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError('HTTP_STATUS', `Serverul a răspuns cu eroarea HTTP ${res.status}`, res.status);
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new HttpError('TOO_LARGE', `Răspuns prea mare (peste ${Math.round(maxBytes / 1024 / 1024)} MB)`, res.status);
  }
  let body: string;
  try {
    body = await readCapped(res, maxBytes);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const e = err as Error;
    // The timeout signal also covers a body that stalls mid-download.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError('TIMEOUT', `Niciun răspuns în ${Math.round(timeoutMs / 1000)} s`);
    throw new HttpError('NETWORK', e.message);
  }
  return { ...meta, notModified: false, body };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError('TOO_LARGE', `Răspuns prea mare (peste ${Math.round(maxBytes / 1024 / 1024)} MB)`, res.status);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return decodeBody(buf, res.headers.get('content-type') ?? '');
}

function decodeBody(buf: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 200));
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromXml ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchTextOptions = {}): Promise<T> {
  const r = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const trimmed = r.body.trimStart();
  if (trimmed.startsWith('<')) throw new HttpError('NOT_JSON', 'Răspuns HTML/XML în loc de JSON', r.status);
  try {
    return JSON.parse(r.body) as T;
  } catch {
    throw new HttpError('BAD_JSON', 'JSON invalid', r.status);
  }
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * A request whose HTTP errors are returned, not thrown (brokers explain a 401 / 403 / 429 in the body).
 * Network failures and timeouts still throw HttpError; the response size is capped as in fetchText.
 */
export async function httpRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<HttpResponse> {
  const { timeoutMs = 20_000, maxBytes = 10 * 1024 * 1024 } = opts;
  let res: Response;
  try {
    res = await apiFetch(url, { method: opts.method ?? 'GET', headers: { 'User-Agent': USER_AGENT, ...opts.headers }, body: opts.body, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError('TIMEOUT', `Niciun răspuns în ${Math.round(timeoutMs / 1000)} s`);
    throw new HttpError('NETWORK', e.cause?.code ? `${e.message} (${e.cause.code})` : e.message);
  }
  let body: string;
  try {
    body = await readCapped(res, maxBytes);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const e = err as Error;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError('TIMEOUT', `Niciun răspuns în ${Math.round(timeoutMs / 1000)} s`);
    throw new HttpError('NETWORK', e.message);
  }
  return { status: res.status, headers: res.headers, body };
}
