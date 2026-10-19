// FD-TRADING, TD-TRADING §8: the trading service end to end through the HTTP API, on a simulated platform: switching
// trading on (both factors, the key's rights), sending once per form, the rate limit, somebody else's account, the
// journal.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContext, type AppContext } from '../../context.ts';
import { testDb } from '../../test/db.ts';
import { loadConfig } from '../../config.ts';
import { buildApp } from '../../http/app.ts';
import { silentLogger } from '../../log.ts';
import { SecretBox } from '../../secrets/crypto.ts';
import type { NliScorer } from '../../sentiment/local.ts';
import type { ClientFactory } from '../accounts.ts';
import { hashPassword } from '../../auth/passwords.ts';
import { computeCode, decodeBase32, newSecret, stepFor } from '../../auth/totp.ts';
import { softAuthenticator } from '../../test/soft-authenticator.ts';
import type { OrderPreview, OrderTicket } from '../../../shared/trading.ts';
import { TRADE_ACTIONS_PER_MINUTE, type TraderFactory } from './service.ts';
import { TradingError, type Trader } from './types.ts';

const BOX = new SecretBox(Buffer.alloc(32, 5));
const PASSWORD = 'Admin-password-1';
const TOTP = newSecret();
const fakeNli: NliScorer = { status: () => ({ state: 'ready', progress: 100, error: null, model: 'fake' }), warmUp: () => {}, score: async () => 0, onReady: () => {} };
const key = (n: number) => `0f3c2a1e-5b6d-4c7e-8f90-${String(n).padStart(12, '0')}`;

let dir: string;
let ctx: AppContext;
let app: FastifyInstance;
let H: Record<string, string>;
/** What the exchange's key may do (KuCoin's permission string), read when trading is switched on. */
let permission: string | null;
const placed: OrderPreview[] = [];
let normalizeErrors: string[] = [];
let placeError: Error | null = null;
let built = 0;

const fakeClients: ClientFactory = () => ({ spot: { privateGetUserApiKey: async () => ({ data: { permission } }) } as never, futures: null });
const fakeTrader: TraderFactory = () => {
  built++;
  const trader: Trader = {
    symbols: async () => [{ symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' }],
    instrument: async (market, symbol) => ({ market, symbol, ref: null, name: null, currency: 'USDT', base: 'BTC', last: 100, amountStep: null, minAmount: null, minCost: null, priceStep: null, contractSize: null, maxLeverage: null, availableQuote: 1000, availableBase: 1, position: null }),
    // A value in USDT becomes the asset at a price of 100, as a real trader does.
    normalize: async (t: OrderTicket) => ({ ticket: t, displaySymbol: t.symbol, amount: t.amountIn === 'quote' ? t.amount / 100 : t.amount, contracts: null, price: t.price ?? null, triggerPrice: null, last: 100, value: t.amount * 100, margin: null, available: 1000, currency: 'USDT', env: 'live', warnings: [], errors: [...normalizeErrors] }),
    place: async (p) => {
      placed.push(p);
      if (placeError) throw placeError;
      return { status: 'open', orderId: `o${placed.length}`, message: null, followUps: [] };
    },
    cancel: async (c) => ({ status: 'cancelled', orderId: c.orderId, message: null, followUps: [] }),
  };
  return trader;
};

beforeAll(async () => {
  H = { host: 'localhost:4317', 'x-sentiq': '1', 'content-type': 'application/json' };
});

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-trading-'));
  const config = { ...loadConfig({ SENTIQ_DATA_DIR: dir } as NodeJS.ProcessEnv), webDist: path.join(dir, 'no-web') };
  ctx = await createContext(config, silentLogger, { nli: fakeNli, clientFactory: fakeClients, traderFactory: fakeTrader, box: BOX, retryDelaysMs: [0, 0], db: await testDb() });
  app = await buildApp(ctx);
  await ctx.db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, totp_secret = ?, totp_confirmed_at = 1 WHERE id = 1', ['admin@example.com', 'Admin', await hashPassword(PASSWORD), BOX.encrypt(TOTP)]);
  H.cookie = `sentiq_session=${await ctx.sessions.create(1, 'full')}`;
  permission = 'General,Spot,Futures';
  placed.length = 0;
  normalizeErrors = [];
  placeError = null;
  built = 0;
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The authenticator's code of now (its last step forgotten: a test asks more often than every 30 seconds). */
async function code(): Promise<string> {
  await ctx.db.run('UPDATE users SET totp_last_step = 0 WHERE id = 1');
  return computeCode(decodeBase32(TOTP), stepFor(Date.now()));
}

const post = (url: string, body: unknown) => app.inject({ method: 'POST', url, headers: H, payload: JSON.stringify(body) });
const get = (url: string) => app.inject({ method: 'GET', url, headers: H });
const account = async (exchange: string, credentials: Record<string, string>, userId = 1) => (await ctx.accounts.create(userId, { exchange, label: exchange, credentials })).id;
const kucoin = () => account('kucoin', { apiKey: 'k1234567', secret: 's1234567', password: 'p1234567' });
const enable = async (id: number) => post(`/api/accounts/${id}/trading`, { enabled: true, password: PASSWORD, code: await code() });
const order = (id: number, n: number, extra: Partial<OrderTicket> = {}) => ({ accountId: id, idemKey: key(n), market: 'spot', symbol: 'BTC/USDT', side: 'buy', kind: 'market', amount: 0.01, ...extra });

describe('switching trading on (FD-TRADING §1)', () => {
  it('asks for the password and a code, reads the key again and keeps what it may trade', async () => {
    const id = await kucoin();
    expect((await get('/api/trading')).json().accounts[0]).toMatchObject({ accountId: id, exchange: 'kucoin', supported: true, enabled: false, markets: [] });
    expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: 'Wrong-password-1', code: await code() })).json().error.code).toBe('BAD_FACTORS');
    expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: PASSWORD, code: '000000' === (await code()) ? '111111' : '000000' })).json().error.code).toBe('BAD_FACTORS');
    const on = await enable(id);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ permissions: 'General,Spot,Futures', trading: { supported: true, enabled: true, markets: ['spot', 'futures'] } });
    // Off: no factors.
    expect((await post(`/api/accounts/${id}/trading`, { enabled: false })).json().trading).toMatchObject({ enabled: false, markets: [] });
    // A key that can only trade spot: only spot.
    permission = 'General,Spot';
    expect((await enable(id)).json().trading.markets).toEqual(['spot']);
    // A read-only key, and one that can withdraw: refused.
    permission = 'General';
    expect((await enable(id)).json().error).toMatchObject({ code: 'PERMISSION', message: expect.stringMatching(/nu are permisiunea de tranzacționare/) });
    permission = 'General,Spot,Withdrawal';
    const funds = (await enable(id)).json();
    expect(funds.error.message).toMatch(/poate retrage/);
    // A read that fails just now keeps what was known: the key still counts as able to withdraw.
    permission = null;
    expect((await enable(id)).json().error.message).toMatch(/poate retrage sau transfera fonduri \(General,Spot,Withdrawal\)/);
    expect(funds.error.message).toMatch(/poate retrage sau transfera fonduri/);
    expect((await get('/api/accounts')).json()[0]).toMatchObject({ fundsRisk: true, trading: { enabled: false } });
    // The journal says when it was switched.
    expect((await get('/api/trading/log')).json().map((r: { action: string }) => r.action)).toEqual(['enable', 'disable', 'enable']);
    // On again with a good key; the key is later allowed to withdraw ("Testează" reads it): the next order switches off.
    permission = 'General,Spot';
    expect((await enable(id)).json().trading.enabled).toBe(true);
    await ctx.db.run("UPDATE exchange_accounts SET permissions = N'General,Spot,Withdrawal' WHERE id = ?", [id]);
    expect((await post(`/api/trading/${id}/orders`, order(id, 50))).json().error.message).toMatch(/tranzacționarea a fost oprită/);
    expect((await get('/api/accounts')).json()[0].trading.enabled).toBe(false);
    expect(placed).toHaveLength(0);
  });

  it('locks the attempts after three wrong factors; IBKR never trades; Kraken (no permissions to read) does, spot only', async () => {
    const id = await kucoin();
    for (let i = 0; i < 2; i++) expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: 'Wrong-password-1', code: '123456' })).statusCode).toBe(400);
    expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: 'Wrong-password-1', code: '123456' })).statusCode).toBe(429);
    expect((await enable(id)).statusCode).toBe(429);
    ctx.throttle.reset('account:1');
    const ibkr = await account('ibkr', { token: '123456789', queryId: '123456' });
    expect((await enable(ibkr)).json().error.code).toBe('UNSUPPORTED');
    expect((await get('/api/accounts')).json().find((a: { id: number }) => a.id === ibkr).trading).toMatchObject({ supported: false, reason: expect.stringMatching(/Flex/) });
    permission = null;
    const kr = await account('kraken', { apiKey: 'k1234567', secret: 's1234567' });
    expect((await enable(kr)).json().trading.markets).toEqual(['spot']);
  });
});

describe('switching trading on, fixed (FD-TRADEUNLOCK)', () => {
  it('says which factor was wrong and how many attempts are left; a key that cannot trade costs none', async () => {
    const id = await kucoin();
    const wrongPassword = (await post(`/api/accounts/${id}/trading`, { enabled: true, password: 'Wrong-password-1', code: await code() })).json().error;
    expect(wrongPassword).toMatchObject({ code: 'BAD_FACTORS', message: expect.stringMatching(/^Parola nu e corectă: e parola cu care intri în Sentiq, nu cea a KuCoin\. Mai ai 2 încercări/) });
    const good = await code();
    const wrongCode = (await post(`/api/accounts/${id}/trading`, { enabled: true, password: PASSWORD, code: good === '000000' ? '111111' : '000000' })).json().error;
    expect(wrongCode.message).toMatch(/^Codul 2FA nu e corect sau a fost deja folosit: e codul Sentiq .* nu cel al KuCoin\. Așteaptă codul următor\. Mai ai o încercare/);
    ctx.throttle.reset('account:1');
    // A code spent (here at the switch itself) is refused the second time, with the message about the code.
    const spent = await code();
    expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: PASSWORD, code: spent })).statusCode).toBe(200);
    await post(`/api/accounts/${id}/trading`, { enabled: false });
    expect((await post(`/api/accounts/${id}/trading`, { enabled: true, password: PASSWORD, code: spent })).json().error.message).toMatch(/a fost deja folosit/);
    ctx.throttle.reset('account:1');

    // The key read first: a read-only one is refused before the factors, however often, and costs no attempt.
    permission = 'General';
    for (let i = 0; i < 4; i++) {
      const r = await post(`/api/accounts/${id}/trading`, { enabled: true, password: 'Wrong-password-1', code: '123456' });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('PERMISSION');
    }
    // Spot and Futures added on the exchange: the list read again is kept, and the switch goes through.
    permission = 'General,Spot,Futures';
    expect((await enable(id)).json()).toMatchObject({ permissions: 'General,Spot,Futures', trading: { enabled: true, markets: ['spot', 'futures'] } });
  });

  it('a passkey of the account answers for both factors; a refused one costs no attempt', async () => {
    const id = await kucoin();
    /** The WebAuthn challenge cookie a response sets, sent back with the next request (no cookie jar here). */
    const withChallenge = (res: { headers: Record<string, unknown> }) => {
      const set = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
      const c = set.map((x) => x.split(';')[0] ?? '').find((x) => x.startsWith('sentiq_webauthn='));
      return { ...H, cookie: c ? `${H.cookie}; ${c}` : (H.cookie as string) };
    };
    const send = (url: string, body: unknown, headers = H) => app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
    // No passkey yet: the options say so.
    expect((await send('/api/trading/passkey/options', {})).json().error.code).toBe('PASSKEY');
    const device = softAuthenticator('localhost', 'http://localhost:4317');
    const reg = await send('/api/account/passkeys/options', {});
    expect((await send('/api/account/passkeys', { response: device.create(reg.json()), name: 'MacBook' }, withChallenge(reg))).statusCode).toBe(200);

    const opts = await send('/api/trading/passkey/options', {});
    // Only this account's passkeys are asked for, with user verification.
    expect(opts.json()).toMatchObject({ userVerification: 'required', allowCredentials: [{ id: device.id }] });
    // No password and no code: the passkey is enough.
    const on = await send(`/api/accounts/${id}/trading`, { enabled: true, passkey: device.get(opts.json()) }, withChallenge(opts));
    expect(on.statusCode).toBe(200);
    expect(on.json().trading).toMatchObject({ enabled: true, markets: ['spot', 'futures'] });
    await post(`/api/accounts/${id}/trading`, { enabled: false });

    // A sign-in challenge does not switch trading on, nor a step-up one sign in; a refused passkey never locks.
    for (let i = 0; i < 4; i++) {
      const login = await send('/api/auth/passkey/options', {});
      const r = await send(`/api/accounts/${id}/trading`, { enabled: true, passkey: device.get(login.json()) }, withChallenge(login));
      expect(r.json().error).toMatchObject({ code: 'PASSKEY', message: expect.stringMatching(/altă operație/) });
    }
    const step = await send('/api/trading/passkey/options', {});
    expect((await send('/api/auth/passkey', { response: device.get(step.json()) }, withChallenge(step))).json().error.code).toBe('PASSKEY');
    // Without its challenge (another tab, or more than 5 minutes): refused.
    expect((await send(`/api/accounts/${id}/trading`, { enabled: true, passkey: device.get({ challenge: 'x' }) })).json().error.message).toMatch(/A durat prea mult/);
    expect((await enable(id)).statusCode).toBe(200);
  });

  it("another account's passkey is refused, its counter untouched", async () => {
    const id = await kucoin();
    const device = softAuthenticator('localhost', 'http://localhost:4317');
    // A passkey of user 2, registered straight in the table (the ceremony is the same as above).
    const rp = { id: 'localhost', origin: 'http://localhost:4317' };
    const ion = (await ctx.db.run("INSERT INTO users(email, name, role, created_at, email_verified_at, totp_confirmed_at) VALUES (N'ion@example.com', N'Ion', N'user', 1, 1, 1)")).lastInsertRowid;
    const reg = await ctx.passkeys.registrationOptions(ion, rp);
    await ctx.passkeys.completeRegistration(ion, reg.challengeId, device.create(reg.options), 'Ion', rp);
    // The admin has one of their own (the ceremony is offered only then).
    const own = softAuthenticator('localhost', 'http://localhost:4317');
    const mine = await ctx.passkeys.registrationOptions(1, rp);
    await ctx.passkeys.completeRegistration(1, mine.challengeId, own.create(mine.options), 'Admin', rp);
    const counter = () => ctx.db.get<{ counter: number }>('SELECT counter FROM passkeys WHERE user_id = ?', [ion]);
    const before = await counter();
    const step = await ctx.passkeys.stepUpOptions(1, rp);
    await expect(ctx.passkeys.completeStepUp(1, step.challengeId, device.get(step.options), rp)).rejects.toThrow(/altui cont/);
    expect(await counter()).toEqual(before);
    expect((await get('/api/accounts')).json().find((a: { id: number }) => a.id === id).trading.enabled).toBe(false);
  });
});

describe('sending an order (FD-TRADING §3, §6)', () => {
  it('journals the amount as it left (in the asset); a send cut off by a restart answers "unknown"; a perpetual is cancelled as futures', async () => {
    const id = await kucoin();
    await enable(id);
    await post(`/api/trading/${id}/orders`, order(id, 70, { amount: 50, amountIn: 'quote' }));
    expect((await get('/api/trading/log')).json()[0]).toMatchObject({ action: 'order', amount: 0.5, status: 'sent' });
    // A row left "sending" three minutes ago (the server restarted mid-send).
    await ctx.db.run(
      "INSERT INTO trade_log(user_id, account_id, exchange, env, account_label, idem_key, action, status, created_at, updated_at) VALUES (1, ?, N'kucoin', N'live', N'kucoin', ?, N'order', N'pending', ?, ?)",
      [id, key(71), Date.now() - 180_000, Date.now() - 180_000],
    );
    const cut = await post(`/api/trading/${id}/orders`, order(id, 71));
    expect(cut.statusCode).toBe(502);
    expect(cut.json().error.message).toMatch(/întreruptă/);
    // A fresh "sending" row: in progress (409).
    await ctx.db.run("INSERT INTO trade_log(user_id, account_id, exchange, env, account_label, idem_key, action, status, created_at, updated_at) VALUES (1, ?, N'kucoin', N'live', N'kucoin', ?, N'order', N'pending', ?, ?)", [id, key(72), Date.now(), Date.now()]);
    expect((await post(`/api/trading/${id}/orders`, order(id, 72))).statusCode).toBe(409);
    expect(placed).toHaveLength(1);
    // Futures only: a perpetual's order listed with the spot ones is still cancelled (as futures).
    permission = 'General,Futures';
    await post(`/api/accounts/${id}/trading`, { enabled: false });
    expect((await enable(id)).json().trading.markets).toEqual(['futures']);
    expect((await post(`/api/trading/${id}/cancel`, { orderId: 'f1', symbol: 'BTC/USDT:USDT', market: 'spot', trigger: false })).statusCode).toBe(200);
    expect((await post(`/api/trading/${id}/cancel`, { orderId: 's1', symbol: 'BTC/USDT', market: 'spot', trigger: false })).json().error.code).toBe('DISABLED');
  });

  it('sends a form once: the second send returns the first result; another form is another order', async () => {
    const id = await kucoin();
    await enable(id);
    expect((await post(`/api/trading/${id}/preview`, order(id, 1))).json()).toMatchObject({ amount: 0.01, env: 'live', errors: [] });
    const first = await post(`/api/trading/${id}/orders`, order(id, 1));
    expect(first.json()).toEqual({ status: 'open', orderId: 'o1', message: null, followUps: [] });
    const again = await post(`/api/trading/${id}/orders`, order(id, 1));
    expect(again.json()).toMatchObject({ status: 'open', orderId: 'o1', message: expect.stringMatching(/fusese deja trimis/) });
    expect(placed).toHaveLength(1);
    expect((await post(`/api/trading/${id}/orders`, order(id, 2))).json().orderId).toBe('o2');
    const log = (await get('/api/trading/log')).json();
    expect(log.filter((r: { action: string }) => r.action === 'order')).toEqual([
      expect.objectContaining({ status: 'sent', orderId: 'o2', symbol: 'BTC/USDT', side: 'buy', kind: 'market', amount: 0.01 }),
      expect.objectContaining({ status: 'sent', orderId: 'o1' }),
    ]);
    // The trader is kept per account.
    expect(built).toBe(1);
  });

  it('a refused order lets its form go (sent again later it can pass); an unknown outcome keeps it and never resends', async () => {
    const id = await kucoin();
    await enable(id);
    normalizeErrors = ['Cantitatea e sub minim.'];
    expect((await post(`/api/trading/${id}/orders`, order(id, 3))).json().error).toEqual({ code: 'INVALID', message: 'Cantitatea e sub minim.' });
    normalizeErrors = [];
    expect((await post(`/api/trading/${id}/orders`, order(id, 3))).json().orderId).toBe('o1');
    // A key the platform refuses: its own steps to add the right come with the message.
    placeError = new TradingError('PERMISSION', 'Cheia nu are permisiunea de tranzacționare.');
    expect((await post(`/api/trading/${id}/orders`, order(id, 30))).json().error.message).toMatch(/permisiunea de tranzacționare\. Pe KuCoin: Profil → API Management/);
    placeError = new TradingError('UNKNOWN_OUTCOME', 'Nu știm sigur dacă ordinul a ajuns. Verifică ordinele deschise înainte să-l trimiți din nou.');
    const lost = await post(`/api/trading/${id}/orders`, order(id, 4));
    expect(lost.statusCode).toBe(502);
    expect(lost.json().error.code).toBe('UNKNOWN_OUTCOME');
    placeError = null;
    expect((await post(`/api/trading/${id}/orders`, order(id, 4))).json().error.code).toBe('UNKNOWN_OUTCOME');
    expect(placed).toHaveLength(3);
    const statuses = (await get('/api/trading/log')).json().filter((r: { action: string }) => r.action === 'order').map((r: { status: string }) => r.status);
    expect(statuses).toEqual(['unknown', 'error', 'sent', 'rejected']);
  });

  it('only where trading is on, for the markets it was switched on for, on the own accounts, at most 20 a minute', async () => {
    const id = await kucoin();
    expect((await post(`/api/trading/${id}/orders`, order(id, 5))).json().error.code).toBe('DISABLED');
    permission = 'General,Spot';
    await enable(id);
    expect((await post(`/api/trading/${id}/orders`, order(id, 6, { market: 'futures', symbol: 'BTC/USDT:USDT' }))).json().error).toMatchObject({ code: 'DISABLED', message: expect.stringMatching(/futures/) });
    // The form names its account; it must be the one in the address.
    expect((await post(`/api/trading/${id}/orders`, order(id + 1, 7))).statusCode).toBe(400);
    // Somebody else's account: not found.
    await ctx.db.run("INSERT INTO users(email, name, password_hash, role, email_verified_at, totp_confirmed_at, created_at) VALUES (N'ana@example.com', N'Ana', N'x', N'user', 1, 1, 1)");
    const anas = await account('kucoin', { apiKey: 'k7654321', secret: 's7654321', password: 'p7654321' }, 2);
    expect((await post(`/api/trading/${anas}/orders`, order(anas, 8))).statusCode).toBe(404);
    expect((await post(`/api/accounts/${anas}/trading`, { enabled: false })).statusCode).toBe(404);
    // The rate limit.
    for (let i = 0; i < TRADE_ACTIONS_PER_MINUTE; i++) expect((await post(`/api/trading/${id}/orders`, order(id, 100 + i))).statusCode).toBe(200);
    const tooMany = await post(`/api/trading/${id}/orders`, order(id, 200));
    expect(tooMany.statusCode).toBe(429);
    expect(tooMany.json().error.message).toMatch(/Prea multe acțiuni de tranzacționare/);
  });

  it('cancels, reads the instrument and the pairs, and forgets the cached portfolio after any action', async () => {
    const id = await kucoin();
    await enable(id);
    const portfolios = (ctx.accounts as unknown as { portfolios: Map<number, unknown> }).portfolios;
    portfolios.set(id, { data: {}, at: Date.now() });
    expect((await post(`/api/trading/${id}/cancel`, { orderId: 'x1', symbol: 'BTC/USDT', market: 'spot', trigger: true })).json()).toMatchObject({ status: 'cancelled', orderId: 'x1' });
    expect(portfolios.has(id)).toBe(false);
    expect((await get(`/api/trading/${id}/symbols?market=spot`)).json()).toEqual([{ symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' }]);
    expect((await get(`/api/trading/${id}/instrument?market=spot&symbol=BTC%2FUSDT`)).json()).toMatchObject({ last: 100, availableQuote: 1000 });
    portfolios.set(id, { data: {}, at: Date.now() });
    await post(`/api/trading/${id}/orders`, order(id, 9));
    expect(portfolios.has(id)).toBe(false);
    expect((await get('/api/trading/log')).json()[1]).toMatchObject({ action: 'cancel', orderId: 'x1', status: 'sent' });
    // Deleting the account keeps the journal (and forgets the trader).
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${id}`, headers: H })).statusCode).toBe(200);
    expect((await get('/api/trading/log')).json().length).toBeGreaterThanOrEqual(3);
  });
});
