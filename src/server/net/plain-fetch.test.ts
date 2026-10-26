// FIX-BROTLI: outside content is downloaded without Node's automatic decompression; Brotli is refused before decoding.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchText, HttpError } from './http.ts';
import { BrotliRefused, plainFetch } from './plain-fetch.ts';

const TEXT = 'Știri: ' + 'abc'.repeat(2000);
let base = '';
let server: http.Server;
let seen: { url: string; method: string; headers: IncomingMessage['headers'] }[] = [];

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  '/plain': (_q, r) => r.end(TEXT),
  '/gzip': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain; charset=utf-8' });
    r.end(zlib.gzipSync(TEXT));
  },
  '/deflate': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'deflate' });
    r.end(zlib.deflateSync(TEXT));
  },
  '/deflate-raw': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'deflate' });
    r.end(zlib.deflateRawSync(TEXT));
  },
  '/twice': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'deflate, gzip' });
    r.end(zlib.gzipSync(zlib.deflateSync(TEXT)));
  },
  '/br': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'br' });
    r.end(zlib.brotliCompressSync(TEXT));
  },
  // Not even Brotli: a decoder would fail on it, the refusal comes first.
  '/br-bad': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'gzip, BR' });
    r.end(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x13]));
  },
  '/zstd': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'zstd' });
    r.end('x');
  },
  '/unknown': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'utf-8' });
    r.end(TEXT);
  },
  '/identity': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'identity' });
    r.end(TEXT);
  },
  '/bomb': (_q, r) => {
    r.writeHead(200, { 'content-encoding': 'gzip' });
    r.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024)));
  },
  '/304': (_q, r) => {
    r.writeHead(304, { etag: '"e1"' });
    r.end();
  },
  '/redirect': (_q, r) => {
    r.writeHead(302, { location: '/gzip', 'content-encoding': 'br' });
    r.end(zlib.brotliCompressSync('moved'));
  },
  '/see-other': (_q, r) => {
    r.writeHead(303, { location: `${base}/echo` });
    r.end();
  },
  '/keep': (_q, r) => {
    r.writeHead(307, { location: '/echo' });
    r.end();
  },
  '/elsewhere': (_q, r) => {
    // Another origin: the same server by another name.
    r.writeHead(302, { location: base.replace('127.0.0.1', 'localhost') + '/echo' });
    r.end();
  },
  '/loop': (_q, r) => {
    r.writeHead(302, { location: '/loop' });
    r.end();
  },
  '/echo': (q, r) => {
    let body = '';
    q.on('data', (c: Buffer) => (body += c.toString()));
    q.on('end', () => r.end(JSON.stringify({ method: q.method, body, auth: q.headers.authorization ?? null })));
  },
  '/slow-headers': () => {
    // Never answers.
  },
  '/slow-body': (_q, r) => {
    r.writeHead(200, { 'content-type': 'text/plain' });
    r.write('partial ');
  },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers });
    (routes[(req.url ?? '').split('?')[0] as string] ?? ((_q, r) => r.writeHead(404).end()))(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const text = async (path: string, init?: Parameters<typeof plainFetch>[1]) => (await plainFetch(`${base}${path}`, init)).text();

describe('plainFetch (FIX-BROTLI)', () => {
  it('asks only for gzip and deflate, and decodes them (deflate with or without the zlib header, two in a row)', async () => {
    seen = [];
    const r = await plainFetch(`${base}/gzip`, { headers: { 'User-Agent': 'Sentiq-test' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await r.text()).toBe(TEXT);
    expect(seen[0]?.headers['accept-encoding']).toBe('gzip, deflate');
    expect(seen[0]?.headers['user-agent']).toBe('Sentiq-test');
    expect(await text('/plain')).toBe(TEXT);
    expect(await text('/deflate')).toBe(TEXT);
    expect(await text('/deflate-raw')).toBe(TEXT);
    expect(await text('/twice')).toBe(TEXT);
    expect(await text('/identity')).toBe(TEXT);
    // A coding not known here: the body as it came, as Node's fetch does.
    expect(await text('/unknown')).toBe(TEXT);
  });

  it('refuses Brotli and zstd before any decoding, even unasked and even when the body is not Brotli at all', async () => {
    await expect(plainFetch(`${base}/br`)).rejects.toBeInstanceOf(BrotliRefused);
    await expect(plainFetch(`${base}/br-bad`)).rejects.toThrow('Serverul a trimis conținut comprimat Brotli (br); Sentiq nu-l decomprimă (FIX-BROTLI).');
    await expect(plainFetch(`${base}/zstd`)).rejects.toThrow('conținut comprimat zstd');
    // fetchText says it in the source's words.
    const err = await fetchText(`${base}/br`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ code: 'BROTLI', message: 'Serverul a trimis conținut comprimat Brotli (br); Sentiq nu-l decomprimă (FIX-BROTLI).' });
  });

  it('follows redirects as fetch does: a Brotli 3xx body unread, 303 turns a POST into a GET, 307 keeps it, another origin loses Authorization', async () => {
    expect(await text('/redirect')).toBe(TEXT);
    expect(JSON.parse(await text('/see-other', { method: 'POST', body: 'x=1', headers: { 'content-type': 'text/plain' } }))).toEqual({ method: 'GET', body: '', auth: null });
    expect(JSON.parse(await text('/keep', { method: 'POST', body: 'x=1', headers: { authorization: 'Bearer t' } }))).toEqual({ method: 'POST', body: 'x=1', auth: 'Bearer t' });
    expect(JSON.parse(await text('/elsewhere', { headers: { authorization: 'Bearer t' } }))).toMatchObject({ auth: null });
    await expect(plainFetch(`${base}/loop`)).rejects.toThrow('Prea multe redirecționări');
  });

  it('a timeout on the headers or on a body that stops is a TimeoutError; 304 has no body; other protocols fail', async () => {
    await expect(plainFetch(`${base}/slow-headers`, { signal: AbortSignal.timeout(200) })).rejects.toMatchObject({ name: 'TimeoutError' });
    const r = await plainFetch(`${base}/slow-body`, { signal: AbortSignal.timeout(300) });
    await expect(r.text()).rejects.toMatchObject({ name: 'TimeoutError' });
    const nm = await plainFetch(`${base}/304`);
    expect(nm.status).toBe(304);
    expect(nm.body).toBeNull();
    expect(nm.headers.get('etag')).toBe('"e1"');
    await expect(plainFetch('ftp://example.com/x')).rejects.toThrow('Protocol nesuportat');
  });

  it('fetchText end to end: the decoded size is capped (a gzip bomb), the timeout and 304 as before', async () => {
    await expect(fetchText(`${base}/bomb`, { maxBytes: 1024 * 1024 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect((await fetchText(`${base}/gzip`)).body).toBe(TEXT);
    await expect(fetchText(`${base}/slow-body`, { timeoutMs: 300 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    seen = [];
    const nm = await fetchText(`${base}/304`, { etag: '"e1"' });
    expect(nm).toMatchObject({ notModified: true, status: 304, body: '' });
    expect(seen[0]?.headers['if-none-match']).toBe('"e1"');
  });
});
