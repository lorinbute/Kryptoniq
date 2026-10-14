// Sign-in, registration, the one-time links, the user's own security page and the admin's Users page
// (FD-USERS §3–§8, TD-USERS §3). Answers never tell an anonymous caller whether an address has an account.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderSVG } from 'uqr';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { PASSWORD_RULE } from '../auth/passwords.ts';
import { WEBAUTHN_COOKIE, CHALLENGE_TTL_MS, type RelyingParty } from '../auth/passkeys.ts';
import { FULL_SESSION_MS, PENDING_SESSION_MS, SESSION_COOKIE } from '../auth/sessions.ts';
import { callerKey, minutes } from '../auth/throttle.ts';
import { formatSecret } from '../auth/totp.ts';
import { cleanName, normalizeEmail, UserError, type UserRow } from '../auth/users.ts';
import { syncStockSources } from '../news/sources.ts';
import { retagRecent } from '../news/ingest.ts';
import { formatIssues, isDevMail, ValidationError } from '../settings.ts';
import { isActive, me, sessionToken } from './auth.ts';
import { readCookie, setCookie } from './cookies.ts';
import { hostnameOf, isLoopback } from './security.ts';
import { NotFoundError } from './errors.ts';

/** An error with its HTTP status and code (the app's error handler sends it as is). */
function fail(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new ValidationError(`Cerere invalidă: ${formatIssues(r.error.issues)}`, r.error.issues);
  return r.data;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });
// Lengths are capped before any hashing: a megabyte "password" must not cost a megabyte of scrypt.
const email = z.string().max(254);
const password = z.string().max(200);
const code = z.string().max(40);

/** The generic answers (FD-INVITE §1, FD-USERS §6): the same whether or not the address has an account. */
export const REQUEST_SENT = 'Am primit cererea. Când adminul o aprobă, primești pe email un link ca să-ți activezi contul.';
export const REQUESTS_FULL = 'Nu mai primim cereri acum. Încearcă mai târziu.';
export const FORGOT_SENT = 'Dacă adresa are un cont confirmat, ți-am trimis un link pentru o parolă nouă. Linkul e valabil o oră.';

/** Where the page was opened (links in the mails point back to the same address; the Host is allowlisted). */
const originOf = (req: FastifyRequest) => `${req.viaHttps ? 'https' : 'http'}://${String(req.headers.host ?? '').toLowerCase()}`;

/** The public address: this instance's own, or the one the public instance wrote in the database (FD-ONLINE §2). */
export async function publicBase(ctx: AppContext): Promise<string | null> {
  return ctx.config.publicUrl ?? (await ctx.settings.publicInstance())?.url ?? null;
}

/**
 * The WebAuthn relying party of this request. Browsers allow passkeys only in a secure context and never on an IP
 * address, so on the local network (http://192.168.x.y) they are simply not offered (FD-USERS §9).
 */
export function relyingParty(req: FastifyRequest): RelyingParty {
  const host = String(req.headers.host ?? '').toLowerCase();
  const name = hostnameOf(host);
  const port = host.slice(name.length);
  if (!name || name.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(name)) {
    throw fail(400, 'PASSKEY_UNAVAILABLE', `Passkey-urile nu merg pe o adresă IP. Deschide Sentiq la http://localhost${port}.`);
  }
  if (!req.viaHttps && name !== 'localhost') {
    throw fail(400, 'PASSKEY_UNAVAILABLE', `Passkey-urile cer HTTPS sau http://localhost${port}.`);
  }
  return { id: name, origin: `${req.viaHttps ? 'https' : 'http'}://${host}` };
}

/** Passkeys are possible on this address (the page hides the button otherwise). */
function passkeysHere(req: FastifyRequest): boolean {
  try {
    relyingParty(req);
    return true;
  } catch {
    return false;
  }
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { users, sessions, passkeys, mailer, throttle } = ctx;

  const startSession = async (req: FastifyRequest, reply: FastifyReply, u: UserRow) => {
    // A new token at every sign-in (never the one the browser came with: no session fixation).
    await sessions.destroy(sessionToken(req));
    const token = await sessions.create(u.id, 'full', { ip: req.clientIp, userAgent: String(req.headers['user-agent'] ?? '') });
    await users.touchLogin(u.id);
    setCookie(req, reply, SESSION_COOKIE, token, { maxAgeMs: FULL_SESSION_MS });
    return { status: 'ok' as const, user: await users.publicUser((await users.byId(u.id)) as UserRow) };
  };

  const lockedReply = (ms: number) => fail(429, 'TOO_MANY_ATTEMPTS', `Prea multe încercări. Mai încearcă peste ${minutes(ms)} minute.`);
  const loginKey = (req: FastifyRequest) => `login:${callerKey(req.clientIp)}`;
  /** "Mai ai 2 încercări." after a wrong password or code (FD-USERS §5). */
  const attemptsLeft = (key: string) => {
    const n = throttle.remaining(key);
    return n === 1 ? 'Mai ai o încercare, apoi login-ul se blochează 15 minute.' : `Mai ai ${n} încercări.`;
  };

  /** Mail is sent in the background: the answer takes as long whether or not a mail goes out. */
  const sendLater = (kind: 'reset' | 'reset-done', u: UserRow, link = '') => {
    if (!u.email) return;
    void mailer.send(kind, u.email, u.name, link).catch((err: Error) => ctx.log.error(`email: ${err.message}`));
  };
  /**
   * Where the links in the mails point: the public address when there is one (this instance's, or the one the public
   * instance wrote in the database, FD-ONLINE §2), else the address this page was opened at (FD-INVITE §2: approved
   * from this Mac, that is localhost, which the page warns about).
   */
  const linkBase = async (req: FastifyRequest) => (await publicBase(ctx)) ?? originOf(req);
  /** The activation mail, waited for (the admin is told whether it went out) and the link for the page. */
  const sendActivation = async (req: FastifyRequest, u: UserRow, token: string) => {
    const link = `${await linkBase(req)}/activate?token=${token}`;
    const mailed = u.email ? await mailer.send('activate', u.email, u.name, link).catch(() => false) : false;
    return { link, mailed, to: u.email };
  };

  /** A limit per caller for the routes that send mail or create accounts (each accepted call counts). */
  const spend = (key: string) => {
    const locked = throttle.lockedFor(key);
    if (locked) throw lockedReply(locked);
    throttle.registerFailure(key);
  };

  // ── State and the admin's first password ────────────────────────────────────────────────────────────

  app.get('/api/auth/state', async (req) => {
    const resend = await ctx.settings.getResend();
    const setupNeeded = await users.setupNeeded();
    return {
      user: req.user ? await users.publicUser((await users.byId(req.user.id)) as UserRow) : null,
      setupNeeded,
      // The first password can only be set from this Mac (FD-USERS §3); the address is shown there only.
      setupHere: setupNeeded && isLoopback(req),
      adminEmail: setupNeeded && isLoopback(req) ? (await users.admin()).email : null,
      passkeys: passkeysHere(req),
      // Named in the note about passkeys on an address where they do not work (FD-ONLINE §3).
      publicUrl: await publicBase(ctx),
      // Development mail (Resend's test sender) only reaches the Resend account's owner (FD-USERS §4).
      devMail: isDevMail(resend),
      passwordRule: PASSWORD_RULE,
    };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    if (!(await users.setupNeeded())) throw fail(409, 'SETUP_DONE', 'Contul de admin are deja o parolă. Intră în cont.');
    if (!isLoopback(req)) throw fail(403, 'SETUP_LOCAL_ONLY', 'Parola de admin se setează doar de pe Mac-ul pe care rulează Sentiq (http://localhost).');
    const b = parse(z.object({ email: email.optional(), name: z.string().max(200).optional(), password }), req.body);
    const u = await users.setupAdmin(b);
    return startSession(req, reply, u);
  });

  // ── Account requests and activation (FD-INVITE) ─────────────────────────────────────────────────────

  app.post('/api/auth/request-account', async (req) => {
    const b = parse(z.object({ email, name: z.string().max(200) }), req.body);
    const key = `register:${callerKey(req.clientIp)}`;
    const locked = throttle.lockedFor(key);
    if (locked) throw lockedReply(locked);
    // A valid request counts before the database answers: requests sent at once all count, invalid ones never.
    users.checkRequest(b);
    throttle.registerFailure(key);
    const outcome = await users.requestAccount(b);
    if (outcome === 'full') throw fail(429, 'REQUESTS_FULL', REQUESTS_FULL);
    if (outcome === 'created') {
      const admin = await users.admin();
      const who = `${cleanName(b.name)} (${normalizeEmail(b.email)})`;
      ctx.log.info(`users: a new account request from ${who}`);
      // The admin hears of it at once (development mail reaches the admin too).
      if (admin.email) void mailer.send('request', admin.email, who, `${await linkBase(req)}/users`).catch((err: Error) => ctx.log.error(`email: ${err.message}`));
    }
    return { ok: true, message: REQUEST_SENT };
  });

  app.post('/api/auth/activate/check', async (req) => {
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    const info = await users.activationInfo(token);
    return info ? { valid: true, ...info } : { valid: false };
  });

  app.post('/api/auth/activate', async (req) => {
    const b = parse(z.object({ token: z.string().max(200), password }), req.body);
    const u = await users.activate(b.token, b.password);
    ctx.log.info(`users: ${u.email} activated their account`);
    return { ok: true, email: u.email };
  });

  // ── Sign-in (FD-USERS §5) ───────────────────────────────────────────────────────────────────────────

  app.post('/api/auth/login', async (req, reply) => {
    const b = parse(z.object({ email, password }), req.body);
    const key = loginKey(req);
    // One attempt of this caller at a time: parallel guesses cannot all pass the check before one is counted.
    return throttle.serial(key, async () => {
      const locked = throttle.lockedFor(key);
      if (locked) throw lockedReply(locked);
      const r = await users.login(b.email, b.password);
      if (r.status === 'invalid') {
        const now = throttle.registerFailure(key);
        if (now) throw lockedReply(now);
        throw fail(400, 'INVALID_CREDENTIALS', `Email sau parolă greșită. ${attemptsLeft(key)}`);
      }
      if (r.status === 'disabled') throw fail(403, 'ACCOUNT_DISABLED', 'Contul este dezactivat. Vorbește cu adminul.');
      // An account gets its password and its confirmed address together (FD-INVITE §3): this is only a safety net.
      if (r.status === 'unverified') throw fail(403, 'EMAIL_UNVERIFIED', 'Contul nu e activat. Folosește linkul de activare primit pe email sau cere adminului unul nou.');
      if (r.status === '2fa') {
        // The password was right, but the budget is shared with the code (Serento): it resets only at the end.
        await sessions.destroy(sessionToken(req));
        const token = await sessions.create(r.user.id, 'pending', { ip: req.clientIp, userAgent: String(req.headers['user-agent'] ?? '') });
        setCookie(req, reply, SESSION_COOKIE, token, { maxAgeMs: PENDING_SESSION_MS });
        return { status: '2fa' as const };
      }
      throttle.reset(key);
      return startSession(req, reply, r.user);
    });
  });

  app.post('/api/auth/login/2fa', async (req, reply) => {
    const b = parse(z.object({ code }), req.body);
    const token = sessionToken(req);
    const pending = await sessions.read(token);
    if (!pending || pending.kind !== 'pending') throw fail(401, 'LOGIN_EXPIRED', 'Au trecut cele 5 minute. Reia autentificarea cu parola.');
    const key = loginKey(req);
    return throttle.serial(key, async () => {
      const locked = throttle.lockedFor(key);
      if (locked) throw lockedReply(locked);
      const u = await users.byId(pending.user_id);
      if (!isActive(u)) {
        await sessions.destroy(token);
        throw fail(401, 'LOGIN_EXPIRED', 'Reia autentificarea cu parola.');
      }
      const factor = await users.verifySecondFactor(u.id, b.code);
      if (factor === 'invalid') {
        const now = throttle.registerFailure(key);
        if (now) throw lockedReply(now);
        throw fail(
          400,
          'INVALID_CODE',
          `Cod greșit. Folosește codul afișat acum în aplicație (ora telefonului trebuie să fie setată automat) sau un cod de recuperare. ${attemptsLeft(key)}`,
        );
      }
      throttle.reset(key);
      const out = await startSession(req, reply, u);
      return { ...out, usedRecoveryCode: factor === 'recovery' };
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await sessions.destroy(sessionToken(req));
    setCookie(req, reply, SESSION_COOKIE, null);
    return { ok: true };
  });

  // ── Forgotten password (FD-USERS §6) ────────────────────────────────────────────────────────────────

  app.post('/api/auth/forgot', async (req) => {
    const b = parse(z.object({ email }), req.body);
    spend(`mail:${callerKey(req.clientIp)}`);
    const r = await users.beginReset(b.email);
    if (r) sendLater('reset', r.user, `${originOf(req)}/reset-password?token=${r.token}`);
    return { ok: true, message: FORGOT_SENT };
  });

  app.post('/api/auth/reset/check', async (req) => {
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    return { valid: (await users.tokenUser('reset', token)) !== null };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const b = parse(z.object({ token: z.string().max(200), password }), req.body);
    const u = await users.completeReset(b.token, b.password);
    // Whoever might have had the old password is signed out everywhere; two-factor stays as it was.
    await sessions.destroyAll(u.id);
    setCookie(req, reply, SESSION_COOKIE, null);
    sendLater('reset-done', u);
    ctx.log.info(`users: ${u.email} set a new password from a reset link`);
    return { ok: true, twoFactor: u.totp_confirmed_at !== null };
  });

  // ── Passkey sign-in (FD-USERS §5) ───────────────────────────────────────────────────────────────────

  app.post('/api/auth/passkey/options', async (req, reply) => {
    const { options, challengeId } = await passkeys.authenticationOptions(relyingParty(req));
    setCookie(req, reply, WEBAUTHN_COOKIE, challengeId, { maxAgeMs: CHALLENGE_TTL_MS, path: '/api' });
    return options;
  });

  app.post('/api/auth/passkey', async (req, reply) => {
    const b = parse(z.object({ response: z.record(z.string(), z.unknown()) }), req.body);
    const rp = relyingParty(req);
    const challengeId = readCookie(req, WEBAUTHN_COOKIE);
    setCookie(req, reply, WEBAUTHN_COOKIE, null, { path: '/api' });
    const userId = await passkeys.completeAuthentication(challengeId, b.response, rp);
    const u = await users.byId(userId);
    if (!u || u.disabled_at !== null) throw fail(403, 'ACCOUNT_DISABLED', 'Contul este dezactivat. Vorbește cu adminul.');
    if (!isActive(u)) throw fail(403, 'EMAIL_UNVERIFIED', 'Contul nu e activat.');
    // A passkey proves the device and the person (PIN / fingerprint): both factors, so no code is asked.
    return startSession(req, reply, u);
  });

  // ── The signed-in user's own account (FD-USERS §7) ──────────────────────────────────────────────────

  /** Password-checking actions of a signed-in session have their own small budget (a stolen session cannot guess). */
  const accountKey = (userId: number) => `account:${userId}`;
  const checkAccountBudget = (userId: number) => {
    const locked = throttle.lockedFor(accountKey(userId));
    if (locked) throw lockedReply(locked);
  };
  const accountFailure = (userId: number, message: string) => {
    const now = throttle.registerFailure(accountKey(userId));
    return now ? lockedReply(now) : fail(400, 'INVALID_CREDENTIALS', message);
  };

  const twoFactorView = async (userId: number) => {
    const s = await users.twoFactorState(userId);
    return {
      enabled: s.enabled,
      confirmedAt: s.confirmedAt,
      pending: s.pendingSecret !== null,
      secret: s.pendingSecret ? formatSecret(s.pendingSecret) : null,
      uri: s.uri,
      // Black on white with the standard quiet zone: what authenticator cameras read best (Serento's TwoFactorQr).
      qr: s.uri ? `data:image/svg+xml;base64,${Buffer.from(renderSVG(s.uri, { ecc: 'M', border: 4, pixelSize: 6 })).toString('base64')}` : null,
      recoveryCodesLeft: s.recoveryCodesLeft,
    };
  };

  app.get('/api/account', async (req) => {
    const u = me(req);
    return {
      user: await users.publicUser((await users.byId(u.id)) as UserRow),
      twoFactor: await twoFactorView(u.id),
      passkeys: await passkeys.list(u.id),
      passkeysHere: passkeysHere(req),
    };
  });

  app.put('/api/account/name', async (req) => {
    const u = me(req);
    const { name } = parse(z.object({ name: z.string().max(200) }), req.body);
    const clean = cleanName(name);
    if (!clean) throw new ValidationError('Scrie un nume.');
    await ctx.db.run('UPDATE users SET name = ? WHERE id = ?', [clean, u.id]);
    return { user: await users.publicUser((await users.byId(u.id)) as UserRow) };
  });

  app.put('/api/account/password', async (req) => {
    const u = me(req);
    const b = parse(z.object({ current: password, next: password }), req.body);
    // One check of this account's budget at a time (as for the sign-in).
    return throttle.serial(accountKey(u.id), async () => {
      checkAccountBudget(u.id);
      const problem = await users.changePassword(u.id, b.current, b.next);
      if (problem === 'Parola actuală nu e corectă.') throw accountFailure(u.id, problem);
      if (problem) throw new ValidationError(problem);
      throttle.reset(accountKey(u.id));
      // Every other session ends; this one stays.
      const closed = await sessions.destroyAll(u.id, sessionToken(req));
      sendLater('reset-done', (await users.byId(u.id)) as UserRow);
      return { ok: true, closedSessions: closed };
    });
  });

  app.post('/api/account/logout-all', async (req, reply) => {
    const u = me(req);
    await sessions.destroyAll(u.id);
    setCookie(req, reply, SESSION_COOKIE, null);
    return { ok: true };
  });

  app.get('/api/account/2fa', async (req) => twoFactorView(me(req).id));

  app.post('/api/account/2fa/start', async (req) => {
    const u = me(req);
    const { restart } = parse(z.object({ restart: z.boolean().default(false) }), req.body);
    if (!(await users.beginTwoFactor(u.id, restart))) throw fail(409, 'TWO_FACTOR_ON', 'Autentificarea în doi pași este deja activă.');
    return twoFactorView(u.id);
  });

  app.post('/api/account/2fa/cancel', async (req) => {
    const u = me(req);
    await users.cancelTwoFactor(u.id);
    return twoFactorView(u.id);
  });

  app.post('/api/account/2fa/enable', async (req) => {
    const u = me(req);
    const b = parse(z.object({ code }), req.body);
    return throttle.serial(accountKey(u.id), async () => {
      checkAccountBudget(u.id);
      const codes = await users.confirmTwoFactor(u.id, b.code);
      if (!codes) throw accountFailure(u.id, 'Cod greșit. Scrie codul de 6 cifre afișat acum în aplicație; dacă tot nu merge, verifică dacă ora telefonului e setată automat.');
      throttle.reset(accountKey(u.id));
      ctx.log.info(`users: ${u.email} turned on two-factor`);
      return { codes, twoFactor: await twoFactorView(u.id) };
    });
  });

  app.post('/api/account/2fa/disable', async (req) => {
    const u = me(req);
    const b = parse(z.object({ password, code }), req.body);
    return throttle.serial(accountKey(u.id), async () => {
      checkAccountBudget(u.id);
      if (!(await users.disableTwoFactor(u.id, b.password, b.code))) throw accountFailure(u.id, 'Parola sau codul nu sunt corecte.');
      throttle.reset(accountKey(u.id));
      await sessions.destroyPending(u.id);
      ctx.log.info(`users: ${u.email} turned off two-factor`);
      return twoFactorView(u.id);
    });
  });

  app.post('/api/account/2fa/recovery-codes', async (req) => {
    const u = me(req);
    const b = parse(z.object({ password, code }), req.body);
    return throttle.serial(accountKey(u.id), async () => {
      checkAccountBudget(u.id);
      const codes = await users.regenerateRecoveryCodes(u.id, b.password, b.code);
      if (!codes) throw accountFailure(u.id, 'Parola sau codul nu sunt corecte.');
      throttle.reset(accountKey(u.id));
      return { codes, twoFactor: await twoFactorView(u.id) };
    });
  });

  app.get('/api/account/passkeys', async (req) => passkeys.list(me(req).id));

  app.post('/api/account/passkeys/options', async (req, reply) => {
    const u = me(req);
    const { options, challengeId } = await passkeys.registrationOptions(u.id, relyingParty(req));
    setCookie(req, reply, WEBAUTHN_COOKIE, challengeId, { maxAgeMs: CHALLENGE_TTL_MS, path: '/api' });
    return options;
  });

  app.post('/api/account/passkeys', async (req, reply) => {
    const u = me(req);
    const b = parse(z.object({ response: z.record(z.string(), z.unknown()), name: z.string().max(200).optional() }), req.body);
    const rp = relyingParty(req);
    const challengeId = readCookie(req, WEBAUTHN_COOKIE);
    setCookie(req, reply, WEBAUTHN_COOKIE, null, { path: '/api' });
    const added = await passkeys.completeRegistration(u.id, challengeId, b.response, b.name, rp);
    ctx.log.info(`users: ${u.email} added a passkey`);
    return added;
  });

  app.put('/api/account/passkeys/:id', async (req) => {
    const u = me(req);
    const { id } = parse(idParam, req.params);
    const { name } = parse(z.object({ name: z.string().max(200) }), req.body);
    if (!(await passkeys.rename(u.id, id, name))) throw new NotFoundError('Passkey-ul nu există (sau numele e gol).');
    return passkeys.list(u.id);
  });

  app.delete('/api/account/passkeys/:id', async (req) => {
    const u = me(req);
    const { id } = parse(idParam, req.params);
    if (!(await passkeys.remove(u.id, id))) throw new NotFoundError('Passkey-ul nu există.');
    return passkeys.list(u.id);
  });

  // ── The admin's Users page (FD-USERS §8) ────────────────────────────────────────────────────────────

  app.get('/api/admin/users', async () => users.list());

  const adminAction = (path: string, act: (id: number) => Promise<void>) =>
    app.post(`/api/admin/users/:id/${path}`, async (req) => {
      const { id } = parse(idParam, req.params);
      await act(id);
      const target = await users.byId(id);
      ctx.log.info(`users: the admin did "${path}" on ${target?.email ?? `#${id}`}`);
      return users.list();
    });

  // FD-INVITE §2: the requests, their approval (the account and its activation link) and a new link.
  app.get('/api/admin/account-requests', async () => users.accountRequests());

  app.post('/api/admin/account-requests/:id/approve', async (req) => {
    const { id } = parse(idParam, req.params);
    const { user, token } = await users.approveRequest(id);
    ctx.log.info(`users: the admin approved the account of ${user.email}`);
    return { ...(await sendActivation(req, user, token)), users: await users.list(), requests: await users.accountRequests() };
  });

  app.delete('/api/admin/account-requests/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await users.rejectRequest(id);
    ctx.log.info(`users: the admin refused account request #${id}`);
    return users.accountRequests();
  });

  app.post('/api/admin/users/:id/activation-link', async (req) => {
    const { id } = parse(idParam, req.params);
    const { user, token } = await users.newActivation(id);
    ctx.log.info(`users: the admin made a new activation link for ${user.email}`);
    return sendActivation(req, user, token);
  });

  adminAction('disable', async (id) => {
    await users.setDisabled(id, true);
    await sessions.destroyAll(id);
  });
  adminAction('enable', (id) => users.setDisabled(id, false));
  adminAction('reset-2fa', async (id) => {
    await users.resetTwoFactor(id);
    await sessions.destroyPending(id);
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const target = await users.byId(id);
    if (!target) throw new NotFoundError('Utilizatorul nu există.');
    if (target.role === 'admin') throw new UserError('Contul de admin nu poate fi șters.');
    // Their exchange clients and cached portfolios leave memory with the rows.
    for (const a of await ctx.accounts.list(id)) await ctx.accounts.delete(a.id);
    await users.remove(id);
    ctx.settings.forget(id);
    // Their favourites no longer tag the news, and their stocks' feeds may go.
    ctx.coins.invalidate();
    for (const sym of await syncStockSources(ctx.db)) ctx.log.info(`news: removed the automatic feed of ${sym} (in nobody's favourites)`);
    await retagRecent(ctx.db, await ctx.coins.get(), Date.now() - 7 * 86_400_000, await ctx.coins.classifier());
    ctx.log.info(`users: the admin deleted ${target.email ?? `#${id}`}`);
    return users.list();
  });

  app.put('/api/settings/resend', async (req) => {
    const b = parse(z.object({ key: z.string().max(300).nullable().optional(), from: z.string().max(300).nullable().optional() }), req.body);
    await ctx.settings.setResend(b.key, b.from);
    const u = me(req);
    return ctx.settings.viewFor(u.id, u.role === 'admin');
  });
}

