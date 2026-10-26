// FD-USERS end to end through the HTTP API: first access, registration, sign-in with 2FA and passkeys, the
// one-time links, data isolation between users, the admin's Users page and the local-network checks; FD-2FA: the
// two-factor setup every account goes through before anything else, and the change of authenticator.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HLINE_DEFAULT_STYLE } from '../shared/hlines.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { softAuthenticator } from './test/soft-authenticator.ts';
import { testDb } from './test/db.ts';
import { createContext, type AppContext } from './context.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import type { Logger } from './log.ts';
import { setFetchImpl } from './net/http.ts';
import { SecretBox } from './secrets/crypto.ts';
import type { NliScorer } from './sentiment/local.ts';
import type { ClientFactory } from './exchange/accounts.ts';
import { computeCode, decodeBase32, newSecret, stepFor } from './auth/totp.ts';
import { hashPassword } from './auth/passwords.ts';
import { ingestItems } from './news/ingest.ts';
import { publishPublicInstance } from './settings.ts';

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
/** The context's key box: the tests read the authenticator secrets they need through it. */
const BOX = new SecretBox(Buffer.alloc(32, 9));
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

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  // performance.now(): Date may be faked by the test.
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) throw new Error('timed out');
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
  ctx = await createContext(config, makeLogger(), { nli: fakeNli, clientFactory: fakeClients, box: BOX, retryDelaysMs: [0, 0], db: await testDb() });
  app = await buildApp(ctx);
});

afterEach(async () => {
  vi.useRealTimers();
  setFetchImpl(null);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The authenticator's code of this moment for an account. Its last used step is forgotten first: a test signs in more
 * often than once every 30 seconds, which the anti-replay threshold would refuse.
 */
async function codeNow(email: string): Promise<string> {
  const u = (await ctx.users.byEmail(email))!;
  await ctx.db.run('UPDATE users SET totp_last_step = 0 WHERE id = ?', [u.id]);
  return computeCode(decodeBase32(BOX.decrypt(u.totp_secret!)), stepFor(Date.now()));
}

/** Email, password, then the code: two-factor is every account's (FD-2FA). */
async function signIn(b: Browser, email: string, password: string): Promise<void> {
  expect((await b.post('/api/auth/login', { email, password })).json()).toEqual({ status: '2fa' });
  expect((await b.post('/api/auth/login/2fa', { code: await codeNow(email) })).json()).toMatchObject({ status: 'ok' });
}

/** The two-factor setup of a signed-in account without it (FD-2FA §1): the QR's key, the first code, the codes. */
async function enrol(b: Browser): Promise<{ key: Buffer; codes: string[] }> {
  const start = (await b.post('/api/account/2fa/start')).json();
  const key = decodeBase32(start.secret.replace(/ /g, ''));
  const done = (await b.post('/api/account/2fa/enable', { code: computeCode(key, stepFor(Date.now())) })).json();
  expect(done.codes).toHaveLength(10);
  return { key, codes: done.codes };
}

/** The admin with a password and an authenticator (without going through the setup pages), and a signed-in browser. */
async function adminBrowser(): Promise<Browser> {
  await ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, totp_secret = ?, totp_confirmed_at = 1 WHERE id = 1', [ADMIN.email, 'Admin', adminHash, BOX.encrypt(newSecret())]);
  const b = browser();
  await signIn(b, ADMIN.email, ADMIN.password);
  return b;
}

/**
 * Ana asks for an account, the admin approves it and the activation link sets the password and signs the account in
 * (FD-INVITE, FD-2FA §1); then two-factor is set up, unless `enrol: false` leaves the account on the setup.
 */
async function anaBrowser(opts: { enrol?: boolean } = {}): Promise<Browser> {
  const b = browser({ ip: '192.168.1.40' });
  expect((await b.post('/api/auth/request-account', { name: ANA.name, email: ANA.email })).statusCode).toBe(200);
  const { token } = await ctx.users.approveRequest((await ctx.users.accountRequests())[0]!.id);
  expect((await b.post('/api/auth/activate', { token, password: ANA.password })).json()).toMatchObject({ ok: true, signedIn: true, user: { email: ANA.email, twoFactor: false } });
  if (opts.enrol !== false) await enrol(b);
  return b;
}

/** Mail goes out in the background (it reads its settings from the database first): long enough for one to show. */
const settle = () => new Promise((r) => setTimeout(r, 400));

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
    expect(done.json()).toMatchObject({ status: 'ok', user: { role: 'admin', email: ADMIN.email, name: 'Lorin', twoFactor: false } });
    // FD-2FA §2: the admin too sets up two-factor before anything else, the admin's own routes included.
    for (const url of ['/api/watchlist', '/api/admin/users', '/api/health', '/api/account']) {
      const r = await mac.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error, url).toEqual({ code: 'TWO_FACTOR_REQUIRED', message: 'Configurează mai întâi autentificarea în doi pași.' });
    }
    await enrol(mac);
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
    await ctx.users.setAdminEmail('Boss@Example.com');
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
    for (let i = 10; (await ctx.users.accountRequests()).length < 50; i++) await ctx.users.requestAccount({ name: `U${i}`, email: `u${i}@example.com` });
    const full = await browser({ ip: '192.168.1.44' }).post('/api/auth/request-account', { name: 'Late', email: 'late@example.com' });
    expect(full.statusCode).toBe(429);
    expect(full.json().error.message).toBe('Nu mai primim cereri acum. Încearcă mai târziu.');
    await ctx.db.run('UPDATE account_requests SET created_at = ? WHERE email = ?', [Date.now() - 31 * 86_400_000, 'u0@example.com']);
    expect(await ctx.users.purgeOldRequests()).toBe(1);
    expect(await ctx.users.accountRequests()).toHaveLength(49);
  });
});

describe('approval and activation (FD-INVITE §2, §3)', () => {
  it('on the Mac, the activation link points to the public address the public instance wrote (FD-ONLINE §2)', async () => {
    await publishPublicInstance(ctx.db, { publicUrl: 'https://sentiq.example', proxy: 'azure' });
    const admin = await adminBrowser();
    const anon = browser({ ip: '192.168.1.45' });
    await anon.post('/api/auth/request-account', { name: ANA.name, email: ANA.email });
    const reqId = (await admin.get('/api/admin/account-requests')).json()[0].id as number;
    expect((await admin.post(`/api/admin/account-requests/${reqId}/approve`)).json().link).toMatch(/^https:\/\/sentiq\.example\/activate\?token=[A-Za-z0-9_-]{43}$/);
  });

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
    await settle();
    expect(linkCount('reset-password')).toBe(0);
    expect((await anon.post('/api/auth/activate/check', { token })).json()).toEqual({ valid: true, email: ANA.email, name: 'Ana' });
    expect((await anon.post('/api/auth/activate', { token, password: 'weakpassword' })).statusCode).toBe(400);
    // FD-2FA §1: the activation signs the account in, straight on to the two-factor setup.
    expect((await anon.post('/api/auth/activate', { token, password: ANA.password })).json()).toMatchObject({
      ok: true,
      email: ANA.email,
      signedIn: true,
      user: { role: 'user', name: 'Ana', activated: true, emailVerified: true, twoFactor: false },
    });
    expect((await anon.get('/api/auth/state')).json().user).toMatchObject({ email: ANA.email, twoFactor: false });
    expect((await anon.post('/api/auth/activate', { token, password: 'Another-pass-99' })).json().error.message).toBe('Linkul nu mai e valabil. Cere adminului unul nou.');
    expect((await anon.post('/api/auth/activate/check', { token })).json()).toEqual({ valid: false });
    // Signing in with the password alone (another browser) also lands on the setup, and nothing else opens.
    const other = browser({ ip: '192.168.1.46' });
    expect((await other.post('/api/auth/login', { email: ANA.email.toUpperCase(), password: ANA.password })).json()).toMatchObject({ status: 'ok', user: { twoFactor: false } });
    expect((await other.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await anon.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
    await enrol(anon);
    expect((await anon.get('/api/watchlist')).json().map((w: { coin: string }) => w.coin)).toEqual(['BTC', 'ETH', 'SOL']);
    // The session opened with the password alone ended with the setup (FD-2FA §2).
    expect((await other.get('/api/watchlist')).statusCode).toBe(401);
    expect((await other.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toEqual({ status: '2fa' });
    expect((await admin.post(`/api/admin/users/${a.users[1].id}/activation-link`)).json().error.message).toBe('Contul e deja activat.');
  });

  it('replaces a link with a new one; expired, disabled or deleted accounts are not activated; refusing tells nobody', async () => {
    const t0 = Date.UTC(2026, 9, 13, 13);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const admin = await adminBrowser();
    const anon = browser({ ip: '192.168.1.46' });
    const ask = async (name: string, email: string) => {
      await browser({ ip: `10.0.0.${name.length + email.length}` }).post('/api/auth/request-account', { name, email });
      return (await ctx.users.accountRequests()).find((r) => r.email === email)!.id;
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
    await ctx.db.run("INSERT INTO users(email, name, password_hash, role, email_verified_at, created_at) VALUES ('cara@example.com', 'Cara', ?, 'user', 1, 1)", [adminHash]);
    expect((await admin.post(`/api/admin/account-requests/${cara}/approve`)).json().error.message).toBe('Adresa are deja un cont.');
    expect(await ctx.users.accountRequests()).toEqual([]);
    // Behind a public address, the links use it.
    (ctx.config as { publicUrl: string | null }).publicUrl = 'https://sentiq.example.com';
    const dan = await approve(await ask('Dan', 'dan@example.com'));
    expect(dan.link).toMatch(/^https:\/\/sentiq\.example\.com\/activate\?token=/);
  });

  it('is the admin’s only', async () => {
    await adminBrowser();
    const ana = await anaBrowser();
    await browser({ ip: '192.168.1.47' }).post('/api/auth/request-account', { name: 'Bob', email: 'bob@example.com' });
    const id = (await ctx.users.accountRequests())[0]!.id;
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
    expect((await ana.put('/api/settings', { marketData: { candles: 5000 } })).statusCode).toBe(403);
    // FD-AIKEYS: the AI is each one's own.
    expect((await ana.put('/api/settings', { ai: { provider: 'gemini', scoring: true } })).json().ai).toEqual({ provider: 'gemini', scoring: true });
    expect((await admin.get('/api/settings')).json().ai).toEqual({ provider: 'anthropic', scoring: false });
    expect((await admin.put('/api/settings', { retentionDays: 30 })).json().retentionDays).toBe(30);
    expect((await ana.get('/api/settings')).json().retentionDays).toBe(30);
    expect((await ana.get('/api/sentiment/history?days=3')).json().tz).toBe('Asia/Tokyo');

    // Everyone's secrets (Resend): the admin's alone to change. The Twelve Data key is each one's own (FD-TDKEYS).
    expect((await ana.put('/api/settings/resend', { key: null })).statusCode).toBe(403);
    await ctx.settings.setTwelveDataKey(1, 'a'.repeat(32));
    expect((await ana.put('/api/settings/twelvedata-key', { key: null })).statusCode).toBe(200);
    expect(await ctx.settings.getTwelveDataKey(1)).toBe('a'.repeat(32));
    expect((await ana.get('/api/settings')).json()).toMatchObject({ twelveDataKeySet: false, twelveDataKeyHint: null });
    expect((await admin.get('/api/settings')).json()).toMatchObject({ twelveDataKeySet: true, twelveDataKeyHint: 'aaaa…aaaa' });
    expect(await ctx.stocks.timeframes(2)).toEqual(['1d', '1w']);
    expect(await ctx.stocks.hasKey(1)).toBe(true);
    // The AI keys are each one's own (FD-AIKEYS): Ana sees only the hint of Ana's own key.
    await ctx.settings.setAiKey(2, 'gemini', 'AIzaSyD-ana-key-0123456789abcdef');
    ctx.ai.forget(2);
    expect((await ana.get('/api/settings')).json().aiKeys.gemini).toEqual({ set: true, hint: 'AIza…cdef' });
    expect((await admin.get('/api/settings')).json().aiKeys.gemini).toEqual({ set: false, hint: null });
    expect((await ana.get('/api/ai/status')).json()).toMatchObject({ provider: 'gemini', keySet: true, scoring: true });
    expect((await admin.get('/api/ai/status')).json()).toMatchObject({ provider: 'anthropic', keySet: false });
    // The mail settings are the admin's alone (FD-ADMINSET §1): not even whether they are set.
    const anaView = (await ana.get('/api/settings')).json();
    for (const k of ['resendKeySet', 'resendKeyHint', 'resendFrom', 'resendDev']) expect(anaView, k).not.toHaveProperty(k);
    expect((await admin.get('/api/settings')).json()).toMatchObject({ resendKeySet: false, resendDev: true });
    for (const [method, url] of [
      ['GET', '/api/health'],
      ['POST', '/api/sources'],
      ['POST', '/api/sources/test'],
      ['PUT', '/api/sources/coindesk'],
      ['DELETE', '/api/sources/coindesk'],
      ['POST', '/api/sentiment/rescore'],
      ['POST', '/api/sentiment/recompute-history'],
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

describe('the indicators on the charts (FD-INDICATORS §4)', () => {
  it('are each one\'s own, saved whole, refused when wrong, and kept item by item when an old list no longer parses', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const rsi = { uid: 'anarsi000001', id: 'rsi', inputs: { length: 21 }, visible: true, plots: { plot0: { color: '#FF0000' } } };
    const ema = { uid: 'anaema000001', id: 'ema', inputs: {}, visible: false, height: 0.5 };
    const saved = (await ana.put('/api/settings', { studies: [rsi, ema] })).json();
    expect(saved.studies).toEqual([rsi, ema]);
    expect((await ana.get('/api/settings')).json().studies).toEqual([rsi, ema]);
    expect((await admin.get('/api/settings')).json().studies).toEqual([]);
    // The list is replaced whole (one removed is gone).
    expect((await ana.put('/api/settings', { studies: [ema] })).json().studies).toEqual([ema]);
    for (const bad of [
      [{ ...rsi, id: 'unknown' }],
      [rsi, rsi],
      [{ ...rsi, inputs: { length: { a: 1 } } }],
      Array.from({ length: 21 }, (_, i) => ({ ...ema, uid: `many${String(i).padStart(4, '0')}` })),
    ]) {
      expect((await ana.put('/api/settings', { studies: bad })).statusCode).toBe(400);
    }
    expect((await ana.get('/api/settings')).json().studies).toEqual([ema]);
    // A list written by a newer catalog: the indicator it no longer knows goes, the rest and the chart prefs stay.
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.studies = [rsi, { ...ema, id: 'removed-one' }, { uid: 'bad', id: 'sma' }, rsi];
    stored.charts = { ...(stored.charts as object), showLma: false };
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    const view = (await ana.get('/api/settings')).json();
    expect(view.studies).toEqual([rsi]);
    expect(view.charts.showLma).toBe(false);
  });

  it('the last settings of each indicator: own, replaced whole, kept item by item when an old list no longer parses (FD-STUDYMEMORY)', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.get('/api/settings')).json().studyMemory).toEqual([]);
    const rsi = { uid: 'anarsi000002', id: 'rsi', inputs: { length: 21, src: 'hl2' }, visible: true };
    const memory = [{ id: 'rsi', inputs: { length: 21, src: 'hl2' }, plots: { plot0: { style: 'dotted' } } }];
    // The list and the memory in one request (a removal).
    const saved = (await ana.put('/api/settings', { studies: [], studyMemory: memory })).json();
    expect(saved).toMatchObject({ studies: [], studyMemory: memory });
    expect((await admin.get('/api/settings')).json().studyMemory).toEqual([]);
    // Saved again without `src` or style: replaced whole, nothing lingers.
    expect((await ana.put('/api/settings', { studies: [rsi], studyMemory: [{ id: 'rsi', inputs: { length: 14 } }] })).json().studyMemory).toEqual([{ id: 'rsi', inputs: { length: 14 } }]);
    expect((await ana.put('/api/settings', { studyMemory: [{ id: 'rsi', inputs: {} }, { id: 'rsi', inputs: {} }] })).statusCode).toBe(400);
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.studyMemory = [{ id: 'ema', inputs: { length: 50 } }, { id: 'removed-one', inputs: {} }, { id: 'ema', inputs: {} }, { id: 'macd', inputs: { x: { a: 1 } } }];
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    const view = (await ana.get('/api/settings')).json();
    expect(view.studyMemory).toEqual([{ id: 'ema', inputs: { length: 50 } }]);
    expect(view.studies).toEqual([rsi]);
  });

  it('the order form’s last choices: own, merged choice by choice, kept item by item (FD-TICKETMEMORY)', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.get('/api/settings')).json().orderTicket).toEqual({ lastAccount: {}, accounts: {} });
    await ana.put('/api/settings', { orderTicket: { accounts: { '7': { market: 'futures', kind: 'limit' } } } });
    // One choice more: merged into the account's entry, the others stay.
    const saved = (await ana.put('/api/settings', { orderTicket: { accounts: { '7': { leverage: 10 } }, lastAccount: { crypto: 7 } } })).json();
    expect(saved.orderTicket).toEqual({ lastAccount: { crypto: 7 }, accounts: { '7': { market: 'futures', kind: 'limit', leverage: 10 } } });
    expect((await admin.get('/api/settings')).json().orderTicket).toEqual({ lastAccount: {}, accounts: {} });
    expect((await ana.put('/api/settings', { orderTicket: { accounts: { '7': { price: 100 } } } })).statusCode).toBe(400);
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.orderTicket = { lastAccount: { crypto: 7 }, accounts: { '7': { kind: 'limit' }, '8': { kind: 'iceberg' } } };
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    expect((await ana.get('/api/settings')).json().orderTicket).toEqual({ lastAccount: { crypto: 7 }, accounts: { '7': { kind: 'limit' } } });
  });

  it('the favourites: each one\'s own, the list replaced whole, an unknown id dropped on read (FD-STUDYUX §1)', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.get('/api/settings')).json().studyFavorites).toEqual([]);
    expect((await ana.put('/api/settings', { studyFavorites: ['rsi', 'slingshot'] })).json().studyFavorites).toEqual(['rsi', 'slingshot']);
    expect((await admin.get('/api/settings')).json().studyFavorites).toEqual([]);
    expect((await ana.put('/api/settings', { studyFavorites: ['slingshot'] })).json().studyFavorites).toEqual(['slingshot']);
    for (const bad of [['nope'], ['rsi', 'rsi']]) expect((await ana.put('/api/settings', { studyFavorites: bad })).statusCode).toBe(400);
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.studyFavorites = ['ema', 'removed-one', 'ema', 'lma'];
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    expect((await ana.get('/api/settings')).json().studyFavorites).toEqual(['ema', 'lma']);
  });

  it('the horizontal lines and their template: own, a symbol\'s list replaced whole, an invalid line dropped on read (FD-HLINE)', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const line = (id: string, price: number, patch: Record<string, unknown> = {}) => ({ ...structuredClone(HLINE_DEFAULT_STYLE), id, price, text: '', ...patch });
    expect((await ana.get('/api/settings')).json()).toMatchObject({ chartLines: {}, hlineTemplate: null });
    await ana.put('/api/settings', { chartLines: { 'BTC/USDT': [line('aaaaaa', 100), line('bbbbbb', 90)], 'stock:AAPL': [line('cccccc', 250, { text: 'Rezistență' })] } });
    // One symbol's list replaced (a line moved, one deleted); the other symbol's stays.
    const saved = (await ana.put('/api/settings', { chartLines: { 'BTC/USDT': [line('aaaaaa', 101)] } })).json();
    expect(saved.chartLines).toEqual({ 'BTC/USDT': [line('aaaaaa', 101)], 'stock:AAPL': [line('cccccc', 250, { text: 'Rezistență' })] });
    // A symbol emptied is not kept.
    expect(Object.keys((await ana.put('/api/settings', { chartLines: { 'stock:AAPL': [] } })).json().chartLines)).toEqual(['BTC/USDT']);
    expect((await ana.put('/api/settings', { hlineTemplate: { ...structuredClone(HLINE_DEFAULT_STYLE), color: '#6FFFB0' } })).json().hlineTemplate).toMatchObject({ color: '#6FFFB0' });
    expect((await admin.get('/api/settings')).json()).toMatchObject({ chartLines: {}, hlineTemplate: null });
    for (const bad of [{ chartLines: { 'BTC/USDT': [line('aaaaaa', 1, { width: 9 })] } }, { chartLines: { 'btc/usdt': [line('aaaaaa', 1)] } }, { hlineTemplate: { color: '#fff' } }]) {
      expect((await ana.put('/api/settings', bad)).statusCode).toBe(400);
    }
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.chartLines = { 'BTC/USDT': [line('aaaaaa', 101), { id: 'broken', price: 'x' }], nope: [line('dddddd', 5)] };
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    const read = (await ana.get('/api/settings')).json();
    expect(read.chartLines).toEqual({ 'BTC/USDT': [line('aaaaaa', 101)] });
    // The other keys survived the broken one.
    expect(read.hlineTemplate).toMatchObject({ color: '#6FFFB0' });
  });

  it("the chart's settings: own, merged part by part, the chart's zone checked, a broken part back to its defaults (FD-CHARTSETTINGS)", async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.get('/api/settings')).json().chartStyle).toMatchObject({ precision: 'default', timezone: null, canvas: { scaleText: { size: 11 } } });
    await ana.put('/api/settings', { chartStyle: { canvas: { vertGrid: { visible: true, color: '#33445580' } }, timezone: 'America/New_York' } });
    const saved = (await ana.put('/api/settings', { chartStyle: { canvas: { scaleText: { size: 14 } }, precision: 4 } })).json().chartStyle;
    // The earlier change stays: a patch changes only what it names.
    expect(saved).toMatchObject({ precision: 4, timezone: 'America/New_York', canvas: { vertGrid: { visible: true, color: '#33445580', style: 'solid' }, scaleText: { size: 14 } } });
    expect((await admin.get('/api/settings')).json().chartStyle).toMatchObject({ precision: 'default', timezone: null });
    for (const bad of [{ chartStyle: { timezone: 'Mars/Olympus' } }, { chartStyle: { precision: 12 } }, { chartStyle: { canvas: { background: { top: 'red' } } } }]) {
      expect((await ana.put('/api/settings', bad)).statusCode).toBe(400);
    }
    // Back to the account's zone: null.
    expect((await ana.put('/api/settings', { chartStyle: { timezone: null } })).json().chartStyle.timezone).toBeNull();
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    stored.chartStyle = { ...(stored.chartStyle as object), canvas: { margins: { top: 'lots' } }, timezone: 'Mars/Olympus' };
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    const read = (await ana.get('/api/settings')).json().chartStyle;
    // The canvas back to its defaults, an unknown zone to the account's, the rest kept.
    expect(read.canvas.scaleText.size).toBe(11);
    expect(read.timezone).toBeNull();
    expect(read.precision).toBe(4);
    // And saving still works.
    expect((await ana.put('/api/settings', { chartStyle: { alerts: { autoHideToasts: false } } })).statusCode).toBe(200);
  });

  it("Slingshot settings saved before the per-side looks keep their look when read back (FD-STYLEUNIFY)", async () => {
    const ana = await anaBrowser();
    // A first save makes the user's row.
    expect((await ana.put('/api/settings', { indicator: { showShort: true } })).statusCode).toBe(200);
    const row = await ctx.db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = 2');
    const stored = JSON.parse(row?.value ?? '{}') as Record<string, unknown>;
    // As an older version wrote them: shared failed / invalidated colours, one size, one market structure style.
    stored.indicator = { showLong: true, showShort: true, longColor: '#123456', failedColor: '#FF00FF', invalidColor: '#FFA50080', signalSize: 'Large', longTPColor: '#00BCD4', msLineWidth: 4, msTextSize: 'Tiny' };
    await ctx.db.run('UPDATE user_settings SET value = ? WHERE user_id = 2', [JSON.stringify(stored)]);
    ctx.settings.forget();
    const read = (await ana.get('/api/settings')).json().indicator;
    expect(read).toMatchObject({ longFormingColor: '#123456', longFailedColor: '#FF00FF', shortFailedColor: '#FF00FF', shortInvalidColor: '#FFA50080', longSize: 'Large', shortSlSize: 'Large', shortTPColor: '#00BCD4', msBullLineWidth: 4, msBearTextSize: 'Tiny' });
    expect(read).not.toHaveProperty('failedColor');
    // Saving one look keeps the others.
    const saved = (await ana.put('/api/settings', { indicator: { shortSize: 'Huge' } })).json().indicator;
    expect(saved).toMatchObject({ shortSize: 'Huge', longSize: 'Large', longFailedColor: '#FF00FF' });
  });
});

describe('shared news, own tags (FD-USERS §2, review round 1)', () => {
  it("lets a user's alias tag news for their filter without weighing them in everybody's sentiment", async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    expect((await ana.put('/api/watchlist/BTC', { aliases: ['Zorblax Prime'] })).statusCode).toBe(200);
    const now = Date.now();
    await ingestItems(ctx.db, { id: 'coindesk', category: 'crypto' }, [{ guid: 'z1', link: 'https://example.com/z1', title: 'Zorblax Prime rallies again', summary: '', publishedAt: now - 60_000 }], await ctx.coins.get(), now, await ctx.coins.classifier());
    const row = () => ctx.db.get<{ impact: number; coins: string | null }>("SELECT impact, (SELECT STRING_AGG(coin, ',') FROM news_coins c WHERE c.news_id = n.id) AS coins FROM news n WHERE title LIKE 'Zorblax%'");
    expect(await row()).toEqual({ impact: 1, coins: 'BTC' });
    const fav = (await ana.get('/api/news?range=24h&favorites=1')).json();
    expect(fav.items.map((i: { title: string }) => i.title)).toContain('Zorblax Prime rallies again');
    // The admin's own alias does weigh (as before FD-USERS): BTC news count double.
    expect((await admin.put('/api/watchlist/BTC', { aliases: ['Zorblax Prime'] })).statusCode).toBe(200);
    // The news are tagged again in the background (FD-WATCHLISTS).
    await ctx.retag.idle();
    expect((await row())?.impact).toBe(2);
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

  it('counts guesses sent in parallel one by one: the fourth and fifth meet the lock (TD-AZURE §5)', async () => {
    await adminBrowser();
    const b = browser({ ip: '192.168.1.62' });
    const codes = (await Promise.all(Array.from({ length: 5 }, () => b.post('/api/auth/login', { email: ADMIN.email, password: 'Wrong-password-1' })))).map((r) => r.statusCode);
    expect(codes.sort()).toEqual([400, 400, 429, 429, 429]);
  });

  it('signs out here or everywhere, and ends the sessions of a disabled account', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const ana2 = browser({ ip: '192.168.1.70' });
    await signIn(ana2, ANA.email, ANA.password);
    expect((await ana.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect((await ana2.get('/api/watchlist')).statusCode).toBe(200);
    await signIn(ana, ANA.email, ANA.password);
    expect((await ana.post('/api/account/logout-all')).statusCode).toBe(200);
    expect((await ana2.get('/api/watchlist')).statusCode).toBe(401);
    await signIn(ana, ANA.email, ANA.password);
    const anaId = (await ctx.users.byEmail(ANA.email))!.id;
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
    await signIn(other, ANA.email, ANA.password);
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
    const ana = await anaBrowser({ enrol: false });
    const start = (await ana.post('/api/account/2fa/start')).json();
    expect(start).toMatchObject({ enabled: false, pending: true, replacing: false });
    expect(start.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(start.qr.split(',')[1], 'base64').toString()).toContain('<svg');
    // Asked again (a second tab, a reload): the same secret, not a new one.
    expect((await ana.post('/api/account/2fa/start')).json().secret).toBe(start.secret);
    const key = decodeBase32(start.secret.replace(/ /g, ''));
    const codeAt = (ms: number) => computeCode(key, stepFor(ms));
    expect((await ana.post('/api/account/2fa/enable', { code: '000000' === codeAt(t0) ? '111111' : '000000' })).statusCode).toBe(400);
    const enabled = (await ana.post('/api/account/2fa/enable', { code: codeAt(t0) })).json();
    expect(enabled.codes).toHaveLength(10);
    expect(enabled.twoFactor).toMatchObject({ enabled: true, pending: false, replacing: false, secret: null, qr: null, recoveryCodesLeft: 10 });
    expect(enabled.user).toMatchObject({ email: ANA.email, twoFactor: true, recoveryCodesLeft: 10 });
    expect((await ana.post('/api/account/2fa/start')).statusCode).toBe(409);
    // Finished in another tab: not counted as a wrong code.
    expect((await ana.post('/api/account/2fa/enable', { code: '123456' })).json().error.code).toBe('TWO_FACTOR_ON');
    await until(() => logLines.includes(`warn email: no Resend key, the totp-on mail for ${ANA.email} was not sent`));

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

  it('FD-2FA: without it an account reaches only its setup, and the sessions opened before it end', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 18, 9) });
    const ana = await anaBrowser({ enrol: false });
    const phone = browser({ ip: '192.168.1.72' });
    expect((await phone.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toMatchObject({ status: 'ok', user: { twoFactor: false } });
    for (const [method, url] of [
      ['GET', '/api/watchlist'],
      ['GET', '/api/account'],
      ['GET', '/api/settings'],
      ['GET', '/api/news'],
      ['GET', '/api/account/passkeys'],
      ['POST', '/api/account/passkeys/options'],
      ['PUT', '/api/account/password'],
      ['PUT', '/api/account/name'],
      ['POST', '/api/account/logout-all'],
      ['POST', '/api/account/2fa/recovery-codes'],
      ['POST', '/api/account/2fa/replace'],
      ['GET', '/api/admin/users'],
    ] as const) {
      const r = method === 'GET' ? await ana.get(url) : method === 'PUT' ? await ana.put(url, {}) : await ana.post(url, {});
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(r.json().error.code, `${method} ${url}`).toBe('TWO_FACTOR_REQUIRED');
    }
    // What the setup screen needs answers; so do the public routes (the state, signing out).
    expect((await ana.get('/api/account/2fa')).json()).toMatchObject({ enabled: false, pending: false });
    expect((await ana.get('/api/auth/state')).json().user).toMatchObject({ twoFactor: false });
    expect((await ana.get('/api/ping')).statusCode).toBe(200);
    await enrol(ana);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(200);
    // Turning it off or abandoning the setup no longer exists.
    expect((await ana.post('/api/account/2fa/cancel')).statusCode).toBe(404);
    expect((await ana.post('/api/account/2fa/disable', { password: ANA.password, code: '123456' })).statusCode).toBe(404);
    expect((await ana.get('/api/account')).json().user).toMatchObject({ twoFactor: true });
    // The phone signed in with the password alone: its session does not get the second factor for free.
    expect((await phone.get('/api/watchlist')).statusCode).toBe(401);
    expect((await phone.get('/api/auth/state')).json().user).toBeNull();
    // Three wrong codes at the setup lock the account's own budget for 15 minutes.
    const bob = browser({ ip: '192.168.1.73' });
    await bob.post('/api/auth/request-account', { name: 'Bob', email: 'bob@example.com' });
    const { token } = await ctx.users.approveRequest((await ctx.users.accountRequests())[0]!.id);
    await bob.post('/api/auth/activate', { token, password: 'Bob-password-123' });
    const s = (await bob.post('/api/account/2fa/start')).json();
    const right = computeCode(decodeBase32(s.secret.replace(/ /g, '')), stepFor(Date.now()));
    const wrong = right === '000000' ? '111111' : '000000';
    expect((await bob.post('/api/account/2fa/enable', { code: wrong })).statusCode).toBe(400);
    expect((await bob.post('/api/account/2fa/enable', { code: wrong })).statusCode).toBe(400);
    expect((await bob.post('/api/account/2fa/enable', { code: wrong })).statusCode).toBe(429);
    expect((await bob.post('/api/account/2fa/enable', { code: right })).statusCode).toBe(429);
  });

  it('FD-2FA: a browser signed in with another account stays in it when an activation link is used there', async () => {
    const admin = await adminBrowser();
    await browser({ ip: '192.168.1.74' }).post('/api/auth/request-account', { name: ANA.name, email: ANA.email });
    const { token } = await ctx.users.approveRequest((await ctx.users.accountRequests())[0]!.id);
    expect((await admin.post('/api/auth/activate', { token, password: ANA.password })).json()).toEqual({ ok: true, email: ANA.email, signedIn: false });
    expect((await admin.get('/api/auth/state')).json().user).toMatchObject({ email: ADMIN.email });
    expect((await admin.get('/api/admin/users')).statusCode).toBe(200);
    // At Ana's own sign-in, the setup.
    const b = browser({ ip: '192.168.1.75' });
    expect((await b.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toMatchObject({ status: 'ok', user: { twoFactor: false } });
    expect((await b.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('shares the attempt budget between the password and the code', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 13, 11) });
    await anaBrowser();
    const b = browser({ ip: '192.168.1.80' });
    expect((await b.post('/api/auth/login', { email: ANA.email, password: 'Wrong-password-1' })).statusCode).toBe(400);
    expect((await b.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json().status).toBe('2fa');
    expect((await b.post('/api/auth/login/2fa', { code: '12345' })).statusCode).toBe(400);
    expect((await b.post('/api/auth/login/2fa', { code: 'AAAAA-AAAAA' })).statusCode).toBe(429);
  });

  it('renews the codes and changes the authenticator only with the password and a code (FD-2FA §3)', async () => {
    const t0 = Date.UTC(2026, 9, 18, 12, 0, 5);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const ana = await anaBrowser({ enrol: false });
    const { key, codes } = await enrol(ana);
    expect((await ana.post('/api/account/2fa/recovery-codes', { password: 'Wrong-password-1', code: codes[1] })).statusCode).toBe(400);
    const renewed = (await ana.post('/api/account/2fa/recovery-codes', { password: ANA.password, code: codes[1] })).json();
    expect(renewed.codes).toHaveLength(10);
    expect(renewed.codes).not.toContain(codes[2]);
    // The old codes are gone.
    expect((await ana.post('/api/account/2fa/replace', { password: ANA.password, code: codes[2] })).statusCode).toBe(400);

    // A new phone: the old app's code (the enrolment's step is spent, the next one is not) and the password.
    vi.setSystemTime(t0 + 30_000);
    const oldCode = computeCode(key, stepFor(t0 + 30_000));
    const started = (await ana.post('/api/account/2fa/replace', { password: ANA.password, code: oldCode })).json();
    expect(started).toMatchObject({ enabled: true, pending: true, replacing: true, recoveryCodesLeft: 10 });
    expect(started.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const next = decodeBase32(started.secret.replace(/ /g, ''));
    expect(next.equals(key)).toBe(false);
    expect((await ana.get('/api/account/2fa')).json()).toMatchObject({ replacing: true, secret: started.secret });
    // Until it is confirmed, the old app still signs in.
    vi.setSystemTime(t0 + 60_000);
    const other = browser({ ip: '192.168.1.76' });
    await other.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await other.post('/api/auth/login/2fa', { code: computeCode(key, stepFor(t0 + 60_000)) })).json()).toMatchObject({ status: 'ok' });
    // The old app's code in the new one's field is refused; the new app's code of the very same 30 seconds is not.
    const sameStep = computeCode(next, stepFor(t0 + 60_000));
    if (sameStep !== computeCode(key, stepFor(t0 + 60_000))) {
      expect((await ana.post('/api/account/2fa/replace/confirm', { code: computeCode(key, stepFor(t0 + 60_000)) })).statusCode).toBe(400);
    }
    expect((await ana.post('/api/account/2fa/replace/confirm', { code: sameStep })).json()).toMatchObject({ enabled: true, replacing: false, pending: false, secret: null, recoveryCodesLeft: 10 });
    await until(() => logLines.includes(`warn email: no Resend key, the totp-changed mail for ${ANA.email} was not sent`));
    expect((await ana.post('/api/account/2fa/replace/confirm', { code: sameStep })).json().error.code).toBe('NO_REPLACEMENT');
    // From now on the new app signs in, the old one does not; the recovery codes stayed; no session was closed.
    vi.setSystemTime(t0 + 90_000);
    const later = browser({ ip: '192.168.1.77' });
    await later.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await later.post('/api/auth/login/2fa', { code: computeCode(key, stepFor(t0 + 90_000)) })).statusCode).toBe(400);
    expect((await later.post('/api/auth/login/2fa', { code: computeCode(next, stepFor(t0 + 90_000)) })).json()).toMatchObject({ status: 'ok', user: { recoveryCodesLeft: 10 } });
    expect((await other.get('/api/watchlist')).statusCode).toBe(200);
    // A change abandoned: the app of now stays (and a recovery code starts one too, for a lost phone).
    vi.setSystemTime(t0 + 120_000);
    expect((await ana.post('/api/account/2fa/replace', { password: ANA.password, code: renewed.codes[0] })).json().replacing).toBe(true);
    expect((await ana.post('/api/account/2fa/replace/cancel')).json()).toMatchObject({ replacing: false, pending: false, secret: null, recoveryCodesLeft: 9 });
    const last = browser({ ip: '192.168.1.78' });
    await last.post('/api/auth/login', { email: ANA.email, password: ANA.password });
    expect((await last.post('/api/auth/login/2fa', { code: computeCode(next, stepFor(t0 + 120_000)) })).statusCode).toBe(200);
  });
});

describe('forgotten password (FD-USERS §6)', () => {
  it('sends one live link at a time, ends every session and keeps two-factor', async () => {
    const t0 = Date.UTC(2026, 9, 13, 13);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    const ana = await anaBrowser();
    const anon = browser({ ip: '192.168.1.90' });
    const generic = (await anon.post('/api/auth/forgot', { email: 'nobody@example.com' })).json();
    await settle();
    expect(linkCount('reset-password')).toBe(0);
    const sent = (await anon.post('/api/auth/forgot', { email: ANA.email })).json();
    expect(sent.message).toBe(generic.message);
    await until(() => loggedLink('reset-password') !== null);
    const token = loggedLink('reset-password');
    expect(token).not.toBeNull();
    // A second request while the first link lives sends nothing new.
    await browser({ ip: '192.168.1.91' }).post('/api/auth/forgot', { email: ANA.email });
    await settle();
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
    await until(() => linkCount('reset-password') === 2);
  });

  it('FD-2FA: a new password on an account without two-factor leads to its setup', async () => {
    await anaBrowser({ enrol: false });
    await browser({ ip: '192.168.1.93' }).post('/api/auth/forgot', { email: ANA.email });
    await until(() => loggedLink('reset-password') !== null);
    const anon = browser({ ip: '192.168.1.94' });
    expect((await anon.post('/api/auth/reset', { token: loggedLink('reset-password'), password: 'Reset-password-3' })).json()).toMatchObject({ ok: true, twoFactor: false });
    expect((await anon.post('/api/auth/login', { email: ANA.email, password: 'Reset-password-3' })).json()).toMatchObject({ status: 'ok', user: { twoFactor: false } });
    expect((await anon.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
  });
});

describe('the Users page (FD-USERS §8)', () => {
  it('lets the admin reset 2FA and delete accounts, never their own', async () => {
    const admin = await adminBrowser();
    const ana = await anaBrowser();
    const list = (await admin.get('/api/admin/users')).json();
    expect(list.map((u: { email: string; role: string; emailVerified: boolean; activated: boolean }) => [u.email, u.role, u.emailVerified, u.activated])).toEqual([
      [ADMIN.email, 'admin', true, true],
      [ANA.email, 'user', true, true],
    ]);
    const anaId = list[1].id as number;
    await ana.post('/api/watchlist', { kind: 'stock', coin: 'AAPL', name: 'Apple Inc.' });
    // FD-2FA §4: resetting two-factor ends the account's sessions; at the next sign-in it is set up again.
    expect((await admin.post(`/api/admin/users/${anaId}/reset-2fa`)).json().find((u: { id: number }) => u.id === anaId)).toMatchObject({ twoFactor: false });
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    await until(() => logLines.includes(`warn email: no Resend key, the totp-reset mail for ${ANA.email} was not sent`));
    expect((await ana.post('/api/auth/login', { email: ANA.email, password: ANA.password })).json()).toMatchObject({ status: 'ok', user: { twoFactor: false } });
    expect((await ana.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
    await enrol(ana);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(200);
    for (const action of ['disable', 'enable', 'reset-2fa', 'activation-link']) expect((await admin.post(`/api/admin/users/1/${action}`)).statusCode, action).toBe(400);
    expect((await admin.del('/api/admin/users/1')).statusCode).toBe(400);
    expect((await admin.del('/api/admin/users/999')).statusCode).toBe(404);
    expect((await admin.post('/api/admin/users/999/disable')).statusCode).toBe(404);
    expect((await admin.post('/api/admin/users/999/activation-link')).statusCode).toBe(404);
    // Confirming an address by hand is gone (the activation link proves it).
    expect((await admin.post(`/api/admin/users/${anaId}/verify`)).statusCode).toBe(404);
    expect((await admin.del(`/api/admin/users/${anaId}`)).json()).toHaveLength(1);
    expect((await ana.get('/api/watchlist')).statusCode).toBe(401);
    expect((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM watchlist WHERE user_id = ?', [anaId]))?.n).toBe(0);
    // Her stock's Nasdaq feed goes with her (nobody else follows it).
    expect(await ctx.db.get("SELECT id FROM sources WHERE auto = 'nasdaq:AAPL'")).toBeUndefined();
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
    const stored = (await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE [key] = 'resend_key'"))!.value;
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
    const reqId = (await ctx.users.accountRequests())[0]!.id;
    const approved = (await admin.post(`/api/admin/account-requests/${reqId}/approve`)).json();
    expect(approved).toMatchObject({ mailed: false, to: ANA.email });
    expect(sent[1]).toMatchObject({ to: [ANA.email], subject: 'Sentiq · contul tău a fost aprobat' });
    expect(sent[1]?.html).toContain(approved.link.replace(/&/g, '&amp;'));
    expect(logLines.some((l) => l.startsWith('warn email: Resend refused the activate mail for ana@example.com') && l.endsWith('the link is not logged'))).toBe(true);
    expect(logLines.some((l) => l.includes(tokenOf(approved.link)))).toBe(false);
    status = 200;
    const id = (await ctx.users.byEmail(ANA.email))!.id;
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

    // Two-factor (every account's) does not ask for a code after a passkey.
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

  it('do not skip the two-factor setup of an account without it (FD-2FA §2)', async () => {
    const ana = await anaBrowser();
    const device = softAuthenticator('localhost', 'http://localhost:4317');
    const regOptions = (await ana.post('/api/account/passkeys/options')).json();
    await ana.post('/api/account/passkeys', { response: device.create(regOptions), name: 'MacBook' });
    await ctx.users.resetTwoFactor((await ctx.users.byEmail(ANA.email))!.id);
    const b = browser();
    const o = (await b.post('/api/auth/passkey/options')).json();
    expect((await b.post('/api/auth/passkey', { response: device.get(o) })).json()).toMatchObject({ status: 'ok', user: { email: ANA.email, twoFactor: false, passkeys: 1 } });
    expect((await b.get('/api/watchlist')).json().error.code).toBe('TWO_FACTOR_REQUIRED');
    await enrol(b);
    expect((await b.get('/api/watchlist')).statusCode).toBe(200);
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
