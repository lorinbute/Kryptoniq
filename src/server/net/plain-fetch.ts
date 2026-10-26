// FIX-BROTLI: the part of `fetch` that downloading outside content uses, on node:http(s), which decompress nothing on
// their own. Node's fetch asks for Brotli and starts decoding it as the bytes arrive (CVE-2026-111497, fixed in 24.22.1);
// here only gzip and deflate are asked for and decoded, and a Brotli (or zstd) body is refused before any decoder exists.
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { PassThrough, pipeline, Readable, Transform, type TransformCallback } from 'node:stream';
import zlib from 'node:zlib';

/** A body compressed in a way that is not decoded here (Brotli, zstd). */
export class BrotliRefused extends Error {
  constructor(coding: string) {
    super(`Serverul a trimis conținut comprimat ${coding === 'br' ? 'Brotli (br)' : coding}; Sentiq nu-l decomprimă (FIX-BROTLI).`);
    this.name = 'BrotliRefused';
  }
}

export interface PlainInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

const MAX_REDIRECTS = 20;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const NULL_BODY = new Set([204, 205, 304]);
const REFUSED = new Set(['br', 'zstd']);
const FLUSH = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };

export async function plainFetch(input: string | URL, init: PlainInit = {}): Promise<Response> {
  let url = new URL(String(input));
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
  headers['accept-encoding'] ??= 'gzip, deflate';
  for (let hops = 0; ; hops++) {
    const res = await send(url, method, headers, body, init.signal);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (REDIRECTS.has(status) && location) {
      // The redirect's own body is thrown away, never decoded.
      res.destroy();
      if (hops >= MAX_REDIRECTS) throw new TypeError('Prea multe redirecționări');
      const next = new URL(location, url);
      if (status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST') {
        method = 'GET';
        body = undefined;
        delete headers['content-type'];
        delete headers['content-length'];
      }
      if (next.origin !== url.origin) delete headers.authorization;
      url = next;
      continue;
    }
    return toResponse(res, status, init.signal);
  }
}

function send(url: URL, method: string, headers: Record<string, string>, body: string | undefined, signal?: AbortSignal): Promise<IncomingMessage> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new TypeError(`Protocol nesuportat: ${url.protocol}`));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers }, (res) => {
      signal?.removeEventListener('abort', onAbort);
      // A timeout while the body is read destroys it with the same reason.
      if (signal) {
        const late = () => res.destroy(signal.reason as Error);
        signal.addEventListener('abort', late, { once: true });
        res.once('close', () => signal.removeEventListener('abort', late));
      }
      resolve(res);
    });
    const onAbort = () => req.destroy(signal?.reason as Error);
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.aborted ? signal.reason : err);
    });
    req.end(body);
  });
}

function toResponse(res: IncomingMessage, status: number, signal?: AbortSignal): Response {
  if (status < 200 || status > 599) {
    res.destroy();
    throw new TypeError(`Răspuns HTTP invalid (${status})`);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const codings = String(res.headers['content-encoding'] ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== '' && c !== 'identity');
  const refused = codings.find((c) => REFUSED.has(c));
  if (refused) {
    res.destroy();
    throw new BrotliRefused(refused);
  }
  if (NULL_BODY.has(status)) {
    res.resume();
    return new Response(null, { status, statusText: res.statusMessage, headers });
  }
  // Applied last first, as written; a coding not known here leaves the body as it came (as undici does).
  const decoders = codings.every((c) => c === 'gzip' || c === 'x-gzip' || c === 'deflate') ? codings.reverse().map((c) => (c === 'deflate' ? inflate() : zlib.createGunzip(FLUSH))) : [];
  const out = new PassThrough();
  pipeline([res, ...decoders, out], (err) => {
    if (err) out.destroy(signal?.aborted ? (signal.reason as Error) : err);
  });
  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage, headers });
}

/** Deflate with the zlib header or without it (both are sent as "deflate"), told apart by the first byte. */
function inflate(): Transform {
  let inner: zlib.Inflate | zlib.InflateRaw | null = null;
  const t = new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (chunk.length === 0) return done();
      if (!inner) {
        inner = (chunk[0]! & 0x0f) === 0x08 ? zlib.createInflate(FLUSH) : zlib.createInflateRaw(FLUSH);
        inner.on('data', (d: Buffer) => t.push(d));
        inner.on('error', (err) => t.destroy(err));
      }
      inner.write(chunk, done);
    },
    flush(done: TransformCallback) {
      if (!inner) return done();
      inner.once('end', () => done());
      inner.end();
    },
  });
  return t;
}
