// FD-USERS end to end through the HTTP API: first access, registration, sign-in with 2FA and passkeys, the
// one-time links, data isolation between users, the admin's Users page and the local-network checks.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { createContext, type AppContext } from './context.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import type { Logger } from './log.ts';
import { setFetchImpl } from './net/http.ts';
import { SecretBox } from './secrets/crypto.ts';
import type { NliScorer } from './sentiment/local.ts';
import type { ClientFactory } from './exchange/accounts.ts';
import { computeCode, decodeBase32, stepFor } from './auth/totp.ts';
import { hashPassword } from './auth/passwords.ts';
import { ingestItems } from './news/ingest.ts';

const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };
const fakeClients: ClientFactory = () => {
  const spot = {
    options: {},
    markets: {},
    isUTAEnabled: async () => false,
    loadMigrationStatus: async () => undefined,
    fetchBalance: async () => ({ total: { USDT: 10 }, free: { USDT: 10 }, used: {} }),
    fetchPositions: async () => [],
    fetchOpenOrders: async () => [],
    fetchMyTrades: async () => [],
    fetchTickers: async () => ({}),
    privateGetUserApiKey: async () => ({ data: { permission: 'General' } }),
  };
  return { spot: spot as never, futures: { fetchOpenOrders: async () => [], fetchMyTrades: async () => [] } as never };
};

const ADMIN = { email: 'admin@example.com', password: 'Admin-password-1' };
const ANA = { email: 'ana@example.com', name: 'Ana', password: 'Ana-password-12' };

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;
let logLines: string[];

function makeLogger(): Logger {
  const add = (level: string) => (msg: string) => void logLines.push(`${level} ${msg}`);
  return { info: add('info'), warn: add('warn'), error: add('error') };
}

/** A browser: its own cookies, address and Host. */
function browser(opts: { host?: string; ip?: string; origin?: string } = {}) {
  const jar = new Map<string, string>();
  const host = opts.host ?? 'localhost:4317';
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<LightMyRequestResponse> => {
    const headers: Record<string, string> = { host };
    if (opts.origin) headers.origin = opts.origin;
    if (method !== 'GET') headers['x-sentiq'] = '1';
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body), remoteAddress: opts.ip ?? '127.0.0.1' });
    const set = res.headers['set-cookie'];
    for (const c of (Array.isArray(set) ? set : set ? [set] : []).map(String)) {
      const [pair = ''] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      if (/max-age=0/i.test(c)) jar.delete(name);
      else jar.set(name, pair.slice(i + 1));
    }
    return res;
  };
  return {
    jar,
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}) => call('POST', url, body),
    put: (url: string, body: unknown = {}) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
  };
}
type Browser = ReturnType<typeof browser>;

/** The last link of a kind the server wrote to the log (development mail without a key, FD-USERS §6). */
function loggedLink(kind: 'reset-password'): string | null {
  for (let i = logLines.length - 1; i >= 0; i--) {
    const m = new RegExp(`https?://[^\\s]+/${kind}\\?token=([A-Za-z0-9_-]+)`).exec(logLines[i] as string);
    if (m) return m[1] as string;
  }
  return null;
}
const linkCount = (kind: string) => logLines.filter((l) => l.includes(`/${kind}?token=`)).length;

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let adminHash = '';
beforeAll(async () => {
  adminHash = await hashPassword(ADMIN.password);
});

beforeEach(async () => {
  logLines = [];
  dir = mkdtempSync(path.join(tmpdir(), 'sq-users-'));
  const config = { ...loadConfig({ SENTIQ_DATA_DIR: dir, SENTIQ_ALLOWED_HOSTS: 'sentiq.lan' } as NodeJS.ProcessEnv), webDist: path.join(dir, 'no-web') };
  ctx = createContext(config, makeLogger(), { nli: fakeNli, clientFactory: fakeClients, box: new SecretBox(Buffer.alloc(32, 9)), retryDelaysMs: [0, 0] });
  app = await buildApp(ctx);
});

afterEach(async () => {
  vi.useRealTimers();
  setFetchImpl(null);
  await app.close();
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The admin with a password (without going through the setup page) and a signed-in browser. */
async function adminBrowser(): Promise<Browser> {
  ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ? WHERE id = 1', [ADMIN.email, 'Admin', adminHash]);
  const b = browser();
  expect((await b.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).json()).toMatchObject({ status: 'ok' });
  return b;
}

/** Ana asks for an account, the admin approves it, she activates it from the link and signs in (FD-INVITE). */
async function anaBrowser(): Promise<Browser> {
  const b = browser({ ip: '192.168.1.40' });
  expect((await b.post('/api/auth/request-account', { name: ANA.name, email: ANA.email })).statusCode).toBe(200);
  const { token } = ctx.users.approveRequest(ctx.users.accountRequests()[0]!.id);
  expect((await b.post('/api/auth/activate', { token, password: ANA.password })).statusCode).toBe(200);
  expect((await b.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toMatchObject({ status: 'ok' });
  return b;
}

/** The token of an activation link the admin got back. */
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

describe('the admin account and its first password (FD-USERS §3)', () => {
  it('exists from the start; its password is set once, only from this Mac', async () => {
    const mac = browser();
    const lan = browser({ ip: '192.168.1.50' });
    expect((await mac.get('/api/watchlist')).statusCode).toBe(401);
    expect((await mac.get('/api/auth/state')).json()).toMatchObject({ user: null, setupNeeded: true, setupHere: true, passkeys: true });
    expect((await lan.get('/api/auth/state')).json()).toMatchObject({ setupNeeded: true, setupHere: false });
    expect((await lan.post('/api/auth/setup', { email: ADMIN.email, password: ADMIN.password })).json().error.code).toBe('SETUP_LOCAL_ONLY');
    expect((await mac.post('/api/auth/setup', { email: ADMIN.email, password: 'short' })).statusCode).toBe(400);
    expect((await mac.post('/api/auth/setup', { email: 'not-an-email', password: ADMIN.password })).statusCode).toBe(400);
    const done = await mac.post('/api/auth/setup', { email: ADMIN.email, name: 'Lorin', password: ADMIN.password });
    expect(done.json()).toMatchObject({ status: 'ok', user: { role: 'admin', email: ADMIN.email, name: 'Lorin' } });
    // Everything that was in the database before is the admin's: the default favourites included.
    expect((await mac.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).toContain('BTC');
    expect((await mac.post('/api/auth/setup', { email: 'x@example.com', password: ADMIN.password })).statusCode).toBe(409);
    expect((await mac.get('/api/auth/state')).json()).toMatchObject({ setupNeeded: false, setupHere: false, user: { role: 'admin' } });
  });

  it('signs in only the first of two first passwords sent at once (review round 1)', async () => {
    const [a, b] = await Promise.all([browser().post('/api/auth/setup', { email: ADMIN.email, password: ADMIN.password }), browser().post('/api/auth/setup', { email: ADMIN.email, password: 'Other-password-2' })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    const winner = a.statusCode === 200 ? ADMIN.password : 'Other-password-2';
    expect((await browser({ ip: '192.168.1.30' }).post('/api/auth/login', { email: ADMIN.email, password: winner })).statusCode).toBe(200);
  });

  it('takes the email given by SENTIQ_ADMIN_EMAIL before the first sign-in, shown on this Mac only', async () => {
    ctx.users.setAdminEmail('Boss@Example.com');
    expect((await browser().get('/api/auth/state')).json()).toMatchObject({ setupNeeded: true, adminEmail: 'boss@example.com' });
    expect((await browser({ ip: '192.168.1.31' }).get('/api/auth/state')).json()).toMatchObject({ setupNeeded: true, adminEmail: null });
    const b = browser();
    // The address is already known: the one typed on the page is ignored.
    expect((await b.post('/api/auth/setup', { email: 'other@example.com', password: ADMIN.password })).json().user.email).toBe('boss@example.com');
  });
});

describe('account requests (FD-INVITE §1, §2)', () => {
  it('answers the same for a new, a taken and a repeated address, and tells the admin', async () => {
    const admin = await adminBrowser();
    const b = browser({ ip: '192.168.1.41' });
    const first = await b.post('/api/auth/request-account', { name: ANA.name, email: ANA.email });
    expect(first.json()).toEqual({ ok: true, message: 'Am primit cererea. Când adminul o aprobă, primești pe email un link ca să-ți activezi contul.' });
    // A second request cannot rename the first; an address with an account asks nothing new.
    expect((await b.post('/api/auth/request-account', { name: 'Not Ana', email: ANA.email.toUpperCase() })).json()).toEqual(first.json());
    expect((await browser({ ip: '192.168.1.48' }).post('/api/auth/request-account', { name: 'Admin?', email: ADMIN.email })).json()).toEqual(first.json());
    expect((await admin.get('/api/admin/account-requests')).json()).toEqual([{ id: expect.any(Number), email: ANA.email, name: 'Ana', createdAt: expect.any(Number) }]);
    // The admin hears of it once (no Resend key here: the notice is not sent, and it carries no link to log).
    expect(logLines.filter((l) => l.includes('users: a new account request from Ana (ana@example.com)'))).toHaveLength(1);
    expect(logLines.some((l) => l.startsWith('warn email: no Resend key, the request mail for admin@example.com was not sent'))).toBe(true);
    expect((await browser({ ip: '192.168.1.49' }).post('/api/auth/request-account', { name: '', email: 'x@example.com' })).statusCode).toBe(400);
    expect((await browser({ ip: '192.168.1.50' }).post('/api/auth/request-account', { name: 'X', email: 'not an address' })).statusCode).toBe(400);
    // Only the admin sees and answers requests; the old self-registration is gone.
    expect((await browser().get('/api/admin/account-requests')).statusCode).toBe(401);
    expect((await admin.post('/api/auth/register', { ...ANA })).statusCode).toBe(404);
    expect((await admin.post('/api/auth/verify', { token: 'x'.repeat(43) })).statusCode).toBe(404);
  });

  it('limits requests per caller and in total, and forgets unanswered ones after 30 days', async () => {
    const b = browser({ ip: '192.168.1.42' });
    for (let i = 0; i < 3; i++) expect((await b.post('/api/auth/request-account', { name: `U${i}`, email: `u${i}@example.com` })).statusCode).toBe(200);
    expect((await b.post('/api/auth/request-account', { name: 'U9', email: 'u9@example.com' })).statusCode).toBe(429);
    expect((await browser({ ip: '192.168.1.43' }).post('/api/auth/request-account', { name: 'U9', email: 'u9@example.com' })).statusCode).toBe(200);
    for (let i = 10; ctx.users.accountRequests().length < 50; i++) ctx.users.requestAccount({ name: `U${i}`, email: `u${i}@example.com` });
    const full = await browser({ ip: '192.168.1.44' }).post('/api/auth/request-account', { name: 'Late', email: 'late@example.com' });
    expect(full.statusCode).toBe(429);
    expect(full.json().error.message).toBe('Nu mai primim cereri acum. Încearcă mai târziu.');
    ctx.db.run('UPDATE account_requests SET created_at = ? WHERE email = ?', [Date.now() - 31 * 86_400_000, 'u0@example.com']);
    expect(ctx.users.purgeOldRequests()).toBe(1);
    expect(ctx.users.accountRequests()).toHaveLength(49);
  });
});

describe('approval and activation (FD-INVITE §2, §3)', () => {
  it('creates an account waiting for activation; its link sets the password once, then the user signs in', async () => {
    const admin = await adminBrowser();
    const anon = browser({ ip: '192.168.1.45' });
    await anon.post('/api/auth/request-account', { name: ANA.name, email: ANA.email });
    const reqId = (await admin.get('/api/admin/account-requests')).json()[0].id as number;
    const approved = await admin.post(`/api/admin/account-requests/${reqId}/approve`);
    expect(approved.statusCode).toBe(200);
    const a = approved.json();
    expect(a).toMatchObject({ mailed: false, to: ANA.email, requests: [] });
    expect(a.link).toMatch(/^http:\/\/localhost:4317\/activate\?token=[A-Za-z0-9_-]{43}$/);
    expect(a.users.find((u: { email: string }) => u.email === ANA.email)).toMatchObject({ activated: false, emailVerified: false, disabled: false });
    // The link is the admin's alone: never in the log.
    const token = tokenOf(a.link);
    expect(logLines.some((l) => l.includes(token))).toBe(false);
    expect((await admin.post(`/api/admin/account-requests/${reqId}/approve`)).statusCode).toBe(404);
    // Not activated: no password to sign in with, no reset link either.
    expect((await anon.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json().error.code).toBe('INVALID_CREDENTIALS');
    await anon.post('/api/auth/forgot', { email: ANA.email });
    expect(linkCount('reset-password')).toBe(0);
    expect((await anon.post('/api/auth/activate/check', { token })).json()).toEqual({ valid: true, email: ANA.email, name: 'Ana' });
    expect((await anon.post('/api/auth/activate', { token, password: 'weakpassword' })).statusCode).toBe(400);
    expect((await anon.post('/api/auth/activate', { token, password: ANA.password })).json()).toEqual({ ok: true, email: ANA.email });
    expect((await anon.post('/api/auth/activate', { token, password: 'Another-pass-99' })).json().error.message).toBe('Linkul nu mai e valabil. Cere adminului unul nou.');
    expect((await anon.post('/api/auth/activate/check', { token })).json()).toEqual({ valid: false });
    expect((await anon.post('/api/auth/login', { email: ANA.email.toUpperCase(), password: ANA.password })).json()).toMatchObject({ status: 'ok', user: { role: 'user', name: 'Ana', activated: true, emailVerified: true } });
    expect((await anon.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).toEqual(['BTC', 'ETH', 'SOL']);
    expect((await admin.post(`/api/admin/users/${a.users[1].id}/activation-link`)).json().error.message).toBe('Contul e deja activat.');
  });

  it('replaces a link with a new one; expired, disabled or deleted accounts are not activated; refusing tells nobody', async () => {
    const t0 = Date.UTC(2026, 9, 13, 13);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const admin = await adminBrowser();
    const anon = browser({ ip: '192.168.1.46' });
    const ask = async (name: string, email: string) => {
      await browser({ ip: `10.0.0.${name.length + email.length}` }).post('/api/auth/request-account', { name, email });
      return ctx.users.accountRequests().find((r) => r.email === email)!.id;
    };
    const approve = async (id: number) => (await admin.post(`/api/admin/account-requests/${id}/approve`)).json();
    const ana = await approve(await ask(ANA.name, ANA.email));
    const anaId = ana.users.find((u: { email: string }) => u.email === ANA.email).id as number;
    const fresh = (await admin.post(`/api/admin/users/${anaId}/activation-link`)).json();
    expect(fresh).toMatchObject({ mailed: false, to: ANA.email });
    expect((await anon.post('/api/auth/activate/check', { token: tokenOf(ana.link) })).json().valid).toBe(false);
    expect((await anon.post('/api/auth/activate/check', { token: tokenOf(fresh.link) })).json().valid).toBe(true);
    // Seven days later the link is gone; the admin makes another.
    vi.setSystemTime(t0 + 7 * 86_400_000 + 1000);
    expect((await anon.post('/api/auth/activate/check', { token: tokenOf(fresh.link) })).json().valid).toBe(false);
    const again = (await admin.post(`/api/admin/users/${anaId}/activation-link`)).json();
    // Disabled before activating: the link does not work.
    await admin.post(`/api/admin/users/${anaId}/disable`);
    expect((await anon.post('/api/auth/activate', { token: tokenOf(again.link), password: ANA.password })).statusCode).toBe(400);
    await admin.post(`/api/admin/users/${anaId}/enable`);
    expect((await anon.post('/api/auth/activate/check', { token: tokenOf(again.link) })).json().valid).toBe(true);
    await admin.del(`/api/admin/users/${anaId}`);
    expect((await anon.post('/api/auth/activate/check', { token: tokenOf(again.link) })).json().valid).toBe(false);
    // Refused: the request goes, no mail.
    const bob = await ask('Bob', 'bob@example.com');
    expect((await admin.del(`/api/admin/account-requests/${bob}`)).json()).toEqual([]);
    expect((await admin.del(`/api/admin/account-requests/${bob}`)).statusCode).toBe(404);
    expect(logLines.some((l) => l.includes('bob@example.com') && l.includes('email'))).toBe(false);
    // An address that got an account meanwhile: refused, and the request is gone.
    const cara = await ask('Cara', 'cara@example.com');
    ctx.db.run("INSERT INTO users(email, name, password_hash, role, email_verified_at, created_at) VALUES ('cara@example.com', 'Cara', ?, 'user', 1, 1)", [adminHash]);
    expect((await admin.post(`/api/admin/account-requests/${cara}/approve`)).json().error.message).toBe('Adresa are deja un cont.');
    expect(ctx.users.accountRequests()).toEqual([]);
    // Behind a public address, the links use it.
    (ctx.config as { publicUrl: string | null }).publicUrl = 'https://sentiq.example.com';
    const dan = await approve(await ask('Dan', 'dan@example.com'));
    expect(dan.link).toMatch(/^https:\/\/sentiq\.example\.com\/activate\?token=/);
  });

  it('is the admin’s only', async () => {
    await adminBrowser();
    const ana = await anaBrowser();
    await browser({ ip: '192.168.1.47' }).post('/api/auth/request-account', { name: 'Bob', email: 'bob@example.com' });
    const id = ctx.users.accountRequests()[0]!.id;
    expect((await ana.get('/api/admin/account-requests')).statusCode).toBe(403);
    expect((await ana.post(`/api/admin/account-requests/${id}/approve`)).statusCode).toBe(403);
    expect((await ana.del(`/api/admin/account-requests/${id}`)).statusCode).toBe(403);
    expect((await ana.post('/api/admin/users/2/activation-link')).statusCode).toBe(403);
  });
});

describe('data of each user (FD-USERS §2)', () => {
  it('keeps favourites, settings, events and accounts apart, and the shared settings to the admin', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.post('/api/watchlist', { kind: 'crypto', coin: 'DOGE' })).statusCode).toBe(200);
    expect((await admin.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).not.toContain('DOGE');
    // The same coin can be a favourite of both.
    expect((await admin.post('/api/watchlist', { kind: 'crypto', coin: 'DOGE' })).statusCode).toBe(200);
    expect((await ana.del('/api/watchlist/DOGE')).statusCode).toBe(200);
    expect((await admin.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).toContain('DOGE');
    await ana.put('/api/watchlist/order', { coins: ['SOL', 'ETH', 'BTC'] });
    expect((await ana.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).toEqual(['SOL', 'ETH', 'BTC']);
    expect((await admin.get('/api/watchlist')).json()[0].coin).not.toBe('SOL');

    // Settings: own ones for everybody, the shared ones only for the admin.
    expect((await ana.put('/api/settings', { timezone: 'Asia/Tokyo', charts: { showLma: false } })).json()).toMatchObject({ timezone: 'Asia/Tokyo' });
    expect((await admin.get('/api/settings')).json().timezone).not.toBe('Asia/Tokyo');
    expect((await admin.get('/api/settings')).json().charts.showLma).toBe(true);
    const forbidden = await ana.put('/api/settings', { retentionDays: 30 });
    expect(forbidden.statusCode).toBe(403);
    expect((await ana.put('/api/settings', { sentiment: { engine: 'claude' } })).statusCode).toBe(403);
    expect((await admin.put('/api/settings', { retentionDays: 30 })).json().retentionDays).toBe(30);
    expect((await ana.get('/api/settings')).json().retentionDays).toBe(30);
    expect((await ana.get('/api/sentiment/history?days=3')).json().tz).toBe('Asia/Tokyo');

    // Secrets: the admin's alone to change; their hints only the admin sees.
    expect((await admin.put('/api/settings/claude-key', { key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' })).statusCode).toBe(200);
    expect((await ana.put('/api/settings/claude-key', { key: null })).statusCode).toBe(403);
    expect((await ana.get('/api/settings')).json()).toMatchObject({ claudeKeySet: true, claudeKeyHint: null });
    expect((await admin.get('/api/settings')).json().claudeKeyHint).not.toBeNull();
    for (const [method, url] of [
      ['GET', '/api/health'],
      ['POST', '/api/sources'],
      ['POST', '/api/sources/test'],
      ['PUT', '/api/sources/coindesk'],
      ['DELETE', '/api/sources/coindesk'],
      ['POST', '/api/sentiment/rescore'],
      ['POST', '/api/sentiment/recompute-history'],
      ['PUT', '/api/settings/twelvedata-key'],
      ['PUT', '/api/settings/resend'],
      ['GET', '/api/admin/users'],
    ] as const) {
      const r = method === 'GET' ? await ana.get(url) : method === 'DELETE' ? await ana.del(url) : method === 'PUT' ? await ana.put(url, {}) : await ana.post(url, {});
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await ana.get('/api/sources')).statusCode).toBe(200);

    // Custom events.
    const now = Date.now();
    const ev = (await admin.post('/api/calendar/custom', { title: 'Admin only', ts: now + 3_600_000, impact: 'High' })).json().id as number;
    const anaCal = (await ana.get(`/api/calendar?from=${now}&to=${now + 86_400_000}`)).json();
    expect(anaCal.events.some((e: { title: string }) => e.title === 'Admin only')).toBe(false);
    expect((await ana.del(`/api/calendar/custom/${ev}`)).statusCode).toBe(404);
    expect((await admin.del(`/api/calendar/custom/${ev}`)).statusCode).toBe(200);

    // Exchange accounts.
    const acc = (await admin.post('/api/accounts', { exchange: 'kucoin', label: 'Main', apiKey: 'key-123456789', secret: 'secret-123456789', password: 'pass' })).json();
    expect(acc.id).toBeGreaterThan(0);
    expect((await ana.get('/api/accounts')).json()).toEqual([]);
    expect((await ana.get(`/api/portfolio/${acc.id}`)).statusCode).toBe(404);
    expect((await ana.post(`/api/accounts/${acc.id}/test`)).statusCode).toBe(404);
    expect((await ana.put(`/api/portfolio/${acc.id}/cost-basis/BTC`, { avgPrice: 1 })).statusCode).toBe(404);
    expect((await ana.del(`/api/accounts/${acc.id}`)).statusCode).toBe(404);
    expect((await admin.get('/api/accounts')).json()).toHaveLength(1);

    // The scanner keeps a result per user.
    expect((await ana.get('/api/scanner')).json()).toMatchObject({ computedAt: null, rows: [] });
  });
});

describe('shared news, own tags (FD-USERS §2, review round 1)', () => {
  it("lets a user's alias tag news for their filter without weighing them in everybody's sentiment", async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.put('/api/watchlist/BTC', { aliases: ['Zorblax Prime'] })).statusCode).toBe(200);
    const now = Date.now();
    ingestItems(ctx.db, { id: 'coindesk', category: 'crypto' }, [{ guid: 'z1', link: 'https://example.com/z1', title: 'Zorblax Prime rallies again', summary: '', publishedAt: now - 60_000 }], ctx.coins.get(), now, ctx.coins.classifier());
    const row = () => ctx.db.get<{ impact: number; coins: string | null }>("SELECT impact, (SELECT group_concat(coin) FROM news_coins c WHERE c.news_id = n.id) AS coins FROM news n WHERE title LIKE 'Zorblax%'");
    expect(row()).toEqual({ impact: 1, coins: 'BTC' });
    const fav = (await ana.get('/api/news?range=24h&favorites=1')).json();
    expect(fav.items.map((i: { title: string }) => i.title)).toContain('Zorblax Prime rallies again');
    // The admin's own alias does weigh (as before FD-USERS): BTC news count double.
    expect((await admin.put('/api/watchlist/BTC', { aliases: ['Zorblax Prime'] })).statusCode).toBe(200);
    expect(row()?.impact).toBe(2);
  });
});

describe('the Economy page (FD-ECON)', () => {
  it('is behind the sign-in and common to every user', async () => {
    expect((await browser().get('/api/economy')).statusCode).toBe(401);
    const ana = await anaBrowser();
    const r = await ana.get('/api/economy');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ historyReady: false, updatedAt: null });
    expect(r.json().countries.map((c: { code: string }) => c.code)).toEqual(['US', 'EU', 'GB', 'JP', 'CN', 'CA', 'CH', 'AU', 'NZ']);
  });
});

describe('route checks cannot be walked around (review round 1)', () => {
  it('judges the route the router matched, not the raw URL', async () => {
    await adminBrowser();
    const ana = await anaBrowser();
    // The router decodes %61 → a: a check on the raw URL would let these through.
    for (const url of ['/api/%61dmin/users', '/api/%68ealth', '/%61pi/admin/users', '/api/./health', '/api/x/../admin/users']) {
      const r = await ana.get(url);
      expect([403, 404], url).toContain(r.statusCode);
    }
    const anon = browser({ ip: '192.168.1.66' });
    for (const url of ['/api/%77atchlist', '/%61pi/watchlist', '/api//watchlist', '/api/settings/']) {
      const r = await anon.get(url);
      expect(r.statusCode, url).not.toBe(200);
      if (r.headers['content-type']?.toString().includes('json')) expect(r.json().error.code, url).toMatch(/AUTH_REQUIRED|NOT_FOUND/);
    }
    // A change without the CSRF header is refused whatever the path looks like.
    const raw = await app.inject({ method: 'POST', url: '/%61pi/auth/logout', headers: { host: 'localhost:4317', 'content-type': 'application/json' }, payload: '{}' });
    expect(raw.statusCode).toBe(403);
  });
});

describe('sign-in (FD-USERS §5)', () => {
  it('locks a caller for 15 minutes after three wrong passwords, even for the right one', async () => {
    await adminBrowser();
    const b = browser({ ip: '192.168.1.60' });
    const first = await b.post('/api/auth/login', { email: ADMIN.email, password: 'Wrong-password-1' });
    expect(first.statusCode).toBe(400);
    expect(first.json().error.message).toMatch(/Mai ai 2 încercări/);
    expect((await b.post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong-password-1' })).statusCode).toBe(400);
    const third = await b.post('/api/auth/login', { email: ADMIN.email, password: 'Wrong-password-1' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toMatch(/15 minute/);
    expect((await b.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).statusCode).toBe(429);
    expect((await browser({ ip: '192.168.1.61' }).post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).statusCode).toBe(200);
  });

  it('signs out here or everywhere, and ends the sessions of a disabled account', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const ana2 = browser({ ip: '192.168.1.70' });
    await ana2.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await ana.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect((await ana2.get('/api/watchlist')).statusCode).toBe(200);
    await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await ana.post('/api/account/logout-all')).statusCode).toBe(200);
    expect((await ana2.get('/api/watchlist')).statusCode).toBe(401);
    await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    const anaId = ctx.users.byEmail(ANA.email)!.id;
    expect((await admin.post(`/api/admin/users/${anaId}/disable`)).statusCode).toBe(200);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect((await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json().error.code).toBe('ACCOUNT_DISABLED');
    await admin.post(`/api/admin/users/${anaId}/enable`);
    expect((await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password })).statusCode).toBe(200);
  });

  it('keeps the browser cookie alive as long as the session is used (review round 3)', async () => {
    const t0 = Date.UTC(2026, 9, 13, 15);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const admin = await adminBrowser();
    const first = await admin.get('/api/watchlist');
    expect(first.headers['set-cookie']).toBeUndefined(); // no write on every request
    vi.setSystemTime(t0 + 6 * 60_000);
    const later = await admin.get('/api/watchlist');
    expect(String(later.headers['set-cookie'])).toMatch(/^sentiq_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
    // 29 days later, still in: the expiry moved with each use.
    vi.setSystemTime(t0 + 29 * 86_400_000);
    expect((await admin.get('/api/watchlist')).statusCode).toBe(200);
    vi.setSystemTime(t0 + 58 * 86_400_000);
    expect((await admin.get('/api/watchlist')).statusCode).toBe(200);
    vi.setSystemTime(t0 + 89 * 86_400_000);
    expect((await admin.get('/api/watchlist')).statusCode).toBe(401);
  });

  it('changes the password with the current one, closing the other sessions', async () => {
    const ana = await anaBrowser();
    const other = browser({ ip: '192.168.1.71' });
    await other.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await ana.put('/api/account/password', { current: 'Wrong-password-1', next: 'New-password-123' })).statusCode).toBe(400);
    expect((await ana.put('/api/account/password', { current: ANA.password, next: 'weak' })).statusCode).toBe(400);
    expect((await ana.put('/api/account/password', { current: ANA.password, next: 'New-password-123' })).json()).toMatchObject({ ok: true, closedSessions: 1 });
    expect((await ana.get('/api/watchlist')).statusCode).toBe(200);
    expect((await other.get('/api/watchlist')).statusCode).toBe(401);
    expect((await other.post('/api/auth/login', { email: ANA.email, password: 'New-password-123' })).statusCode).toBe(200);
  });
});

describe('two-factor authentication (FD-USERS §5, §7)', () => {
  it('enrols with a QR code, then asks for a code within 5 minutes; recovery codes work once', async () => {
    const t0 = Date.UTC(2026, 9, 13, 10, 0, 5);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const ana = await anaBrowser();
    const start = (await ana.post('/api/account/2fa/start')).json();
    expect(start).toMatchObject({ enabled: false, pending: true });
    expect(start.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(start.qr.split(',')[1], 'base64').toString()).toContain('<svg');
    const key = decodeBase32(start.secret.replace(/ /g, ''));
    const codeAt = (ms: number) => computeCode(key, stepFor(ms));
    expect((await ana.post('/api/account/2fa/enable', { code: '000000' === codeAt(t0) ? '111111' : '000000' })).statusCode).toBe(400);
    const enabled = (await ana.post('/api/account/2fa/enable', { code: codeAt(t0) })).json();
    expect(enabled.codes).toHaveLength(10);
    expect(enabled.twoFactor).toMatchObject({ enabled: true, pending: false, secret: null, qr: null, recoveryCodesLeft: 10 });
    expect((await ana.post('/api/account/2fa/start')).statusCode).toBe(409);

    await ana.post('/api/auth/logout');
    expect((await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toEqual({ status: '2fa' });
    // The password alone opens nothing.
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    // The code that confirmed the enrolment is spent.
    expect((await ana.post('/api/auth/login/2fa', { code: codeAt(t0) })).json().error.code).toBe('INVALID_CODE');
    vi.setSystemTime(t0 + 30_000);
    const ok = (await ana.post('/api/auth/login/2fa', { code: codeAt(t0 + 30_000) })).json();
    expect(ok).toMatchObject({ status: 'ok', usedRecoveryCode: false });
    expect((await ana.get('/api/watchlist')).statusCode).toBe(200);

    await ana.post('/api/auth/logout');
    await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    const rec = (await ana.post('/api/auth/login/2fa', { code: enabled.codes[0].toLowerCase() })).json();
    expect(rec).toMatchObject({ status: 'ok', usedRecoveryCode: true, user: { recoveryCodesLeft: 9 } });
    await ana.post('/api/auth/logout');
    await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await ana.post('/api/auth/login/2fa', { code: enabled.codes[0] })).statusCode).toBe(400);

    // Five fixed minutes for the second step.
    vi.setSystemTime(t0 + 6 * 60_000);
    expect((await ana.post('/api/auth/login/2fa', { code: codeAt(t0 + 6 * 60_000) })).json().error.code).toBe('LOGIN_EXPIRED');
  });

  it('shares the attempt budget between the password and the code', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 13, 11) });
    const ana = await anaBrowser();
    const s = (await ana.post('/api/account/2fa/start')).json();
    await ana.post('/api/account/2fa/enable', { code: computeCode(decodeBase32(s.secret.replace(/ /g, '')), stepFor(Date.now())) });
    const b = browser({ ip: '192.168.1.80' });
    expect((await b.post('/api/auth/login', { email: ANA.email, password: 'Wrong-password-1' })).statusCode).toBe(400);
    expect((await b.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json().status).toBe('2fa');
    expect((await b.post('/api/auth/login/2fa', { code: '12345' })).statusCode).toBe(400);
    expect((await b.post('/api/auth/login/2fa', { code: 'AAAAA-AAAAA' })).statusCode).toBe(429);
  });

  it('turns off and renews codes only with the password and a code', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 13, 12) });
    const ana = await anaBrowser();
    const s = (await ana.post('/api/account/2fa/start')).json();
    const key = decodeBase32(s.secret.replace(/ /g, ''));
    const { codes } = (await ana.post('/api/account/2fa/enable', { code: computeCode(key, stepFor(Date.now())) })).json();
    expect((await ana.post('/api/account/2fa/recovery-codes', { password: 'Wrong-password-1', code: codes[1] })).statusCode).toBe(400);
    const renewed = (await ana.post('/api/account/2fa/recovery-codes', { password: ANA.password, code: codes[1] })).json();
    expect(renewed.codes).toHaveLength(10);
    expect(renewed.codes).not.toContain(codes[2]);
    expect((await ana.post('/api/account/2fa/disable', { password: ANA.password, code: codes[2] })).statusCode).toBe(400); // old codes are gone
    // Restarting an unconfirmed enrolment is possible; the third bad attempt locks the account's own budget.
    expect((await ana.post('/api/account/2fa/disable', { password: ANA.password, code: renewed.codes[0] })).json()).toMatchObject({ enabled: false });
    const again = (await ana.post('/api/account/2fa/start')).json();
    const restarted = (await ana.post('/api/account/2fa/start', { restart: true })).json();
    expect(restarted.secret).not.toBe(again.secret);
    await ana.post('/api/account/2fa/cancel');
    expect((await ana.get('/api/account/2fa')).json()).toMatchObject({ enabled: false, pending: false });
  });
});

describe('forgotten password (FD-USERS §6)', () => {
  it('sends one live link at a time, ends every session and keeps two-factor', async () => {
    const t0 = Date.UTC(2026, 9, 13, 13);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const ana = await anaBrowser();
    const s = (await ana.post('/api/account/2fa/start')).json();
    await ana.post('/api/account/2fa/enable', { code: computeCode(decodeBase32(s.secret.replace(/ /g, '')), stepFor(t0)) });
    const anon = browser({ ip: '192.168.1.90' });
    const generic = (await anon.post('/api/auth/forgot', { email: 'nobody@example.com' })).json();
    expect(linkCount('reset-password')).toBe(0);
    const sent = (await anon.post('/api/auth/forgot', { email: ANA.email })).json();
    expect(sent.message).toBe(generic.message);
    const token = loggedLink('reset-password');
    expect(token).not.toBeNull();
    // A second request while the first link lives sends nothing new.
    await browser({ ip: '192.168.1.91' }).post('/api/auth/forgot', { email: ANA.email });
    expect(linkCount('reset-password')).toBe(1);
    expect((await anon.post('/api/auth/reset/check', { token })).json()).toEqual({ valid: true });
    expect((await anon.post('/api/auth/reset', { token, password: 'weak' })).statusCode).toBe(400);
    expect((await anon.post('/api/auth/reset', { token, password: 'Reset-password-1' })).json()).toMatchObject({ ok: true, twoFactor: true });
    expect((await anon.post('/api/auth/reset', { token, password: 'Reset-password-2' })).statusCode).toBe(400);
    expect((await anon.post('/api/auth/reset/check', { token })).json()).toEqual({ valid: false });
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email: ANA.email, password: 'Reset-password-1' })).json()).toEqual({ status: '2fa' });
    // An hour later a new link can be asked for.
    vi.setSystemTime(t0 + 61 * 60_000);
    await browser({ ip: '192.168.1.92' }).post('/api/auth/forgot', { email: ANA.email });
    expect(linkCount('reset-password')).toBe(2);
  });
});

describe('the Users page (FD-USERS §8)', () => {
  it('lets the admin turn off 2FA and delete accounts, never their own', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const list = (await admin.get('/api/admin/users')).json();
    expect(list.map((u: { email: string; role: string; emailVerified: boolean; activated: boolean }) => [u.email, u.role, u.emailVerified, u.activated])).toEqual([
      [ADMIN.email, 'admin', true, true],
      [ANA.email, 'user', true, true],
    ]);
    const anaId = list[1].id as number;
    await ana.post('/api/watchlist', { kind: 'stock', coin: 'AAPL', name: 'Apple Inc.' });
    for (const action of ['disable', 'enable', 'reset-2fa', 'activation-link']) expect((await admin.post(`/api/admin/users/1/${action}`)).statusCode, action).toBe(400);
    expect((await admin.del('/api/admin/users/1')).statusCode).toBe(400);
    expect((await admin.del('/api/admin/users/999')).statusCode).toBe(404);
    expect((await admin.post('/api/admin/users/999/disable')).statusCode).toBe(404);
    expect((await admin.post('/api/admin/users/999/activation-link')).statusCode).toBe(404);
    // Confirming an address by hand is gone (the activation link proves it).
    expect((await admin.post(`/api/admin/users/${anaId}/verify`)).statusCode).toBe(404);
    expect((await admin.del(`/api/admin/users/${anaId}`)).json()).toHaveLength(1);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect(ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [anaId])?.n).toBe(0);
    // Her stock's Nasdaq feed goes with her (nobody else follows it).
    expect(ctx.db.get("SELECT id FROM sources WHERE auto = 'nasdaq:AAPL'")).toBeUndefined();
  });
});

describe('mail through Resend (FD-USERS §6, FD-INVITE)', () => {
  it('keeps the key encrypted, tells whether the activation mail went, and never logs an activation or reset link', async () => {
    const admin = await adminBrowser();
    expect((await admin.put('/api/settings/resend', { key: 'not-a-key' })).statusCode).toBe(400);
    // A bad sender: nothing is saved, not even the good key sent with it.
    expect((await admin.put('/api/settings/resend', { key: 're_test_1234567890abcdef', from: 'no address' })).statusCode).toBe(400);
    expect((await admin.get('/api/settings')).json().resendKeySet).toBe(false);
    const saved = (await admin.put('/api/settings/resend', { key: 're_test_1234567890abcdef', from: 'Sentiq <onboarding@resend.dev>' })).json();
    expect(saved).toMatchObject({ resendKeySet: true, resendFrom: 'Sentiq <onboarding@resend.dev>' });
    expect(saved.resendKeyHint).not.toContain('1234567890abcdef');
    const stored = ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'resend_key'")!.value;
    expect(stored).not.toContain('re_test');
    const sent: { to: string[]; subject: string; html: string; auth: string }[] = [];
    let status = 403;
    setFetchImpl(async (url, init) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; html: string };
      sent.push({ ...body, auth: String((init?.headers as Record<string, string>).Authorization) });
      return new Response(JSON.stringify(status === 200 ? { id: 'x' } : { message: 'You can only send testing emails to your own email address' }), { status });
    });
    // The admin's notice of a request (development mail reaches the admin).
    status = 200;
    await browser({ ip: '192.168.1.97' }).post('/api/auth/request-account', { name: ANA.name, email: ANA.email });
    await until(() => sent.length === 1);
    expect(sent[0]).toMatchObject({ to: [ADMIN.email], auth: 'Bearer re_test_1234567890abcdef' });
    expect(sent[0]?.subject).toBe('Sentiq · cerere nouă de cont');
    expect(sent[0]?.html).toContain('Ana (ana@example.com)');
    expect(sent[0]?.html).toContain('http://localhost:4317/users');
    // The activation mail refused (Resend's test sender): the admin is told, and has the link; the log does not.
    status = 403;
    const reqId = ctx.users.accountRequests()[0]!.id;
    const approved = (await admin.post(`/api/admin/account-requests/${reqId}/approve`)).json();
    expect(approved).toMatchObject({ mailed: false, to: ANA.email });
    expect(sent[1]).toMatchObject({ to: [ANA.email], subject: 'Sentiq · contul tău a fost aprobat' });
    expect(sent[1]?.html).toContain(approved.link.replace(/&/g, '&amp;'));
    expect(logLines.some((l) => l.startsWith('warn email: Resend refused the activate mail for ana@example.com') && l.endsWith('the link is not logged'))).toBe(true);
    expect(logLines.some((l) => l.includes(tokenOf(approved.link)))).toBe(false);
    status = 200;
    const id = ctx.users.byEmail(ANA.email)!.id;
    const resent = (await admin.post(`/api/admin/users/${id}/activation-link`)).json();
    expect(resent).toMatchObject({ mailed: true, to: ANA.email });
    await browser({ ip: '192.168.1.99' }).post('/api/auth/activate', { token: tokenOf(resent.link), password: ANA.password });
    status = 403;
    await browser({ ip: '192.168.1.98' }).post('/api/auth/forgot', { email: ANA.email });
    await until(() => sent.length === 4);
    await until(() => logLines.some((l) => l.includes('Resend refused the reset mail')));
    expect(linkCount('reset-password')).toBe(0);
    expect(sent[3]?.html).toContain('/reset-password?token=');
    // Removing the key: the next mail falls back to the log.
    expect((await admin.put('/api/settings/resend', { key: null })).json().resendKeySet).toBe(false);
  });
});

/** A software authenticator: a P-256 key, attestation "none", user verification done. */
function softAuthenticator(rpId: string, origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = randomBytes(16);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
  const rpHash = createHash('sha256').update(rpId).digest();
  let counter = 0;
  let userHandle = '';
  const authData = (flags: number, attested?: Buffer, signCount = counter) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(signCount);
    return Buffer.concat([rpHash, Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  };
  return {
    id: b64(credId),
    create(options: { challenge: string; user: { id: string } }) {
      userHandle = options.user.id;
      const cose = new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const attested = Buffer.concat([Buffer.alloc(16), len, credId, Buffer.from(isoCBOR.encode(cose))]);
      const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(0x45, attested)]]) as never);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), attestationObject: b64(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    /** `signCount`: what a cloned authenticator would send (a counter behind the real one's). */
    get(options: { challenge: string }, handle = userHandle, signCount?: number) {
      counter++;
      const data = authData(0x05, undefined, signCount ?? counter);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const signature = sign('sha256', Buffer.concat([data, createHash('sha256').update(clientData).digest()]), privateKey);
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), authenticatorData: b64(data), signature: b64(signature), userHandle: handle },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}

describe('passkeys (FD-USERS §5, §7)', () => {
  it('registers on localhost, signs in without a password or code, and refuses replays', async () => {
    const ana = await anaBrowser();
    const device = softAuthenticator('localhost', 'http://localhost:4317');
    const regOptions = (await ana.post('/api/account/passkeys/options')).json();
    expect(regOptions.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(regOptions.attestation).toBe('none');
    expect(regOptions.user.name).toBe(ANA.email);
    expect(ana.jar.has('sentiq_webauthn')).toBe(true);
    const added = await ana.post('/api/account/passkeys', { response: device.create(regOptions), name: 'MacBook' });
    expect(added.json()).toMatchObject({ name: 'MacBook' });
    expect((await ana.get('/api/account/passkeys')).json()).toHaveLength(1);
    // The same authenticator is listed as excluded next time.
    expect((await ana.post('/api/account/passkeys/options')).json().excludeCredentials.map((c: { id: string }) => c.id)).toEqual([device.id]);

    // Even two-factor does not ask for a code after a passkey.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 13, 14) });
    const s = (await ana.post('/api/account/2fa/start')).json();
    await ana.post('/api/account/2fa/enable', { code: computeCode(decodeBase32(s.secret.replace(/ /g, '')), stepFor(Date.now())) });
    vi.useRealTimers();

    const fresh = browser();
    const authOptions = (await fresh.post('/api/auth/passkey/options')).json();
    expect(authOptions.allowCredentials ?? []).toEqual([]);
    expect(authOptions.userVerification).toBe('required');
    const assertion = device.get(authOptions);
    expect((await fresh.post('/api/auth/passkey', { response: assertion })).json()).toMatchObject({ status: 'ok', user: { email: ANA.email } });
    expect((await fresh.get('/api/watchlist')).statusCode).toBe(200);
    // The challenge was spent: the same answer again is refused.
    const replay = browser();
    replay.jar.set('sentiq_webauthn', 'nope');
    expect((await replay.post('/api/auth/passkey', { response: assertion })).statusCode).toBe(400);
    // A userHandle of another account is refused.
    const wrong = browser();
    const o2 = (await wrong.post('/api/auth/passkey/options')).json();
    expect((await wrong.post('/api/auth/passkey', { response: device.get(o2, Buffer.from('someone-else').toString('base64url')) })).json().error.code).toBe('PASSKEY');
    // A cloned authenticator (its counter did not move) is refused (FD-USERS §10).
    const cloned = browser();
    const oc = (await cloned.post('/api/auth/passkey/options')).json();
    expect((await cloned.post('/api/auth/passkey', { response: device.get(oc, undefined, 1) })).json().error.message).toMatch(/copiat/);
    // A password lockout does not block a passkey (it cannot be guessed).
    const locked = browser();
    for (let i = 0; i < 3; i++) await locked.post('/api/auth/login', { email: ANA.email, password: 'Wrong-password-1' });
    const o3 = (await locked.post('/api/auth/passkey/options')).json();
    expect((await locked.post('/api/auth/passkey', { response: device.get(o3) })).statusCode).toBe(200);

    const pk = (await ana.get('/api/account/passkeys')).json()[0];
    expect((await ana.put(`/api/account/passkeys/${pk.id}`, { name: 'Laptop' })).json()[0].name).toBe('Laptop');
    expect((await ana.del(`/api/account/passkeys/${pk.id}`)).json()).toEqual([]);
    const o4 = (await fresh.post('/api/auth/passkey/options')).json();
    expect((await fresh.post('/api/auth/passkey', { response: device.get(o4) })).statusCode).toBe(400);
  });

  it('are not offered on an IP address', async () => {
    const admin = await adminBrowser();
    const ip = browser({ host: '127.0.0.1:4317' });
    ip.jar.clear();
    for (const [k, v] of admin.jar) ip.jar.set(k, v);
    expect((await ip.get('/api/auth/state')).json().passkeys).toBe(false);
    const r = await ip.post('/api/account/passkeys/options');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/localhost:4317/);
    expect((await browser({ host: '127.0.0.1:4317' }).post('/api/auth/passkey/options')).statusCode).toBe(400);
  });
});

describe('local network (FD-USERS §9)', () => {
  it("answers on this Mac's names and addresses only, and only to same-origin pages", async () => {
    expect((await browser({ host: 'evil.example:4317' }).get('/api/ping')).json().error.code).toBe('FORBIDDEN_HOST');
    expect((await browser({ host: 'sentiq.lan:4317' }).get('/api/ping')).statusCode).toBe(200);
    const lanIp = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
    if (lanIp) expect((await browser({ host: `${lanIp}:4317`, ip: '192.168.1.99' }).get('/api/auth/state')).statusCode).toBe(200);
    const cross = browser({ origin: 'http://evil.example' });
    expect((await cross.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).json().error.code).toBe('FORBIDDEN_ORIGIN');
    const same = browser({ host: 'sentiq.lan:4317', origin: 'http://sentiq.lan:4317' });
    expect((await same.post('/api/auth/login', { email: ADMIN.email, password: 'Wrong-password-1' })).statusCode).toBe(400);
  });
});
