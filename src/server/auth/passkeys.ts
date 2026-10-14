// Passkeys (FD-USERS §5, §7; TD-USERS §2) with @simplewebauthn/server, under Serento.Web's rules:
// - discoverable credentials and user verification REQUIRED: a passkey replaces the password AND the second factor,
//   so it must prove the device and a PIN / fingerprint / face (two factors in one gesture, phishing-proof);
// - no attestation (no policy about authenticator models to enforce);
// - the challenge is single-use, bound to its ceremony (create / get), consumed before anything is judged, 5 min;
// - a registration challenge is also bound to the signed-in user who asked for it.
// Several accounts: the credential found by its ID must belong to the user its userHandle names.
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Db } from '../db/database.ts';
import type { UserService } from './users.ts';

export const WEBAUTHN_COOKIE = 'sentiq_webauthn';
export const CHALLENGE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 120_000;
const TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable']);

export class PasskeyError extends Error {}

/** A copy backed by a plain ArrayBuffer (what the library's types ask for). */
function copyBytes(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

export interface RelyingParty {
  id: string;
  origin: string;
}

interface Challenge {
  challenge: string;
  purpose: 'create' | 'get';
  userId: number | null;
  expiresAt: number;
}

interface PasskeyRow {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface PasskeySummary {
  id: number;
  name: string;
  synced: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

const cleanName = (s: unknown) =>
  String(s ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 64);

export class PasskeyService {
  private readonly db: Db;
  private readonly users: UserService;
  private readonly now: () => number;
  private readonly challenges = new Map<string, Challenge>();
  constructor(db: Db, users: UserService, now: () => number = () => Date.now()) {
    this.db = db;
    this.users = users;
    this.now = now;
  }

  private issue(challenge: string, purpose: Challenge['purpose'], userId: number | null): string {
    const now = this.now();
    for (const [k, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(k);
    // A bounded map even if somebody keeps asking: the oldest challenges go first.
    while (this.challenges.size >= 5000) this.challenges.delete(this.challenges.keys().next().value as string);
    const id = randomBytes(24).toString('base64url');
    this.challenges.set(id, { challenge, purpose, userId, expiresAt: now + CHALLENGE_TTL_MS });
    return id;
  }

  /** Deleted before it is judged, so a challenge is spent whatever happens next. */
  private consume(id: string | undefined, purpose: Challenge['purpose'], userId: number | null): string {
    const c = id ? this.challenges.get(id) : undefined;
    if (id) this.challenges.delete(id);
    if (!c || c.expiresAt <= this.now()) throw new PasskeyError('A durat prea mult sau a fost pornit în alt tab. Încearcă din nou.');
    if (c.purpose !== purpose || c.userId !== userId) throw new PasskeyError('Provocarea a fost emisă pentru altă operație.');
    return c.challenge;
  }

  // ── Registration (signed in) ─────────────────────────────────────────────────────────────────────────

  async registrationOptions(userId: number, rp: RelyingParty) {
    const u = await this.users.byId(userId);
    if (!u?.email) throw new PasskeyError('Contul nu are o adresă de email.');
    const existing = await this.db.all<{ credential_id: string; transports: string | null }>('SELECT credential_id, transports FROM passkeys WHERE user_id = ?', [userId]);
    const options = await generateRegistrationOptions({
      rpName: 'Sentiq',
      rpID: rp.id,
      userName: u.email,
      userDisplayName: u.name || u.email,
      userID: await this.users.userHandle(userId),
      timeout: TIMEOUT_MS,
      attestationType: 'none',
      // An authenticator that already holds one of this account's credentials says so instead of adding a second.
      excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: (p.transports?.split(',') ?? []) as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    });
    return { options, challengeId: this.issue(options.challenge, 'create', userId) };
  }

  async completeRegistration(userId: number, challengeId: string | undefined, response: unknown, name: unknown, rp: RelyingParty): Promise<PasskeySummary> {
    const challenge = this.consume(challengeId, 'create', userId);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: true,
      });
    } catch (err) {
      throw new PasskeyError(`Passkey-ul nu a fost acceptat: ${(err as Error).message}`);
    }
    if (!result.verified) throw new PasskeyError('Passkey-ul nu a putut fi verificat.');
    const info = result.registrationInfo;
    const cred = info.credential;
    const transports = (cred.transports ?? []).filter((t) => TRANSPORTS.has(t)).join(',') || null;
    const id = await this.db.tx(async () => {
      if (await this.byCredential(cred.id)) throw new PasskeyError('Passkey-ul este deja înregistrat.');
      const count = (await this.db.get<{ n: number }>('SELECT count(*) AS n FROM passkeys WHERE user_id = ?', [userId]))?.n ?? 0;
      return (
        await this.db.run(
          'INSERT INTO passkeys(user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, cred.id, Buffer.from(cred.publicKey), cred.counter, transports, info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, cleanName(name) || `Passkey ${count + 1}`, this.now()],
        )
      ).lastInsertRowid;
    });
    return this.summary((await this.db.get<PasskeyRow>('SELECT * FROM passkeys WHERE id = ?', [id])) as PasskeyRow);
  }

  /** The passkey with this credential id (found through its hash, TD-AZURE §3). */
  private byCredential(credentialId: string): Promise<PasskeyRow | undefined> {
    return this.db.get<PasskeyRow>("SELECT * FROM passkeys WHERE credential_hash = HASHBYTES('SHA2_256', CAST(@c AS NVARCHAR(MAX))) AND credential_id = @c", { c: credentialId });
  }

  // ── Sign-in (anonymous) ──────────────────────────────────────────────────────────────────────────────

  async authenticationOptions(rp: RelyingParty) {
    // No allowCredentials: the browser knows its own discoverable passkeys for this site, and a list would tell any
    // anonymous caller which authenticators this server trusts.
    const options = await generateAuthenticationOptions({ rpID: rp.id, allowCredentials: [], userVerification: 'required', timeout: TIMEOUT_MS });
    return { options, challengeId: this.issue(options.challenge, 'get', null) };
  }

  /** The user a verified assertion signs in. */
  async completeAuthentication(challengeId: string | undefined, response: unknown, rp: RelyingParty): Promise<number> {
    const challenge = this.consume(challengeId, 'get', null);
    const r = response as AuthenticationResponseJSON;
    const credId = typeof r?.id === 'string' ? r.id : '';
    const row = credId ? await this.byCredential(credId) : undefined;
    if (!row) throw new PasskeyError('Passkey-ul nu este înregistrat aici.');
    const handle = r.response?.userHandle;
    if (typeof handle === 'string' && handle.length) {
      const own = Buffer.from(await this.users.userHandle(row.user_id)).toString('base64url');
      if (handle !== own) throw new PasskeyError('Passkey-ul aparține altui cont.');
    }
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: r,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        credential: { id: row.credential_id, publicKey: copyBytes(row.public_key), counter: row.counter, transports: (row.transports?.split(',') ?? []) as AuthenticatorTransportFuture[] },
        requireUserVerification: true,
      });
    } catch (err) {
      // A counter that went back: the same key answers from two devices (a copied authenticator).
      if (/counter/i.test((err as Error).message)) throw new PasskeyError('Passkey-ul pare copiat pe alt dispozitiv (contorul lui a dat înapoi). Șterge-l din Securitate și adaugă-l din nou.');
      throw new PasskeyError(`Passkey-ul nu a fost acceptat: ${(err as Error).message}`);
    }
    if (!result.verified) throw new PasskeyError('Semnătura passkey-ului nu a putut fi verificată.');
    await this.db.run('UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?', [result.authenticationInfo.newCounter, result.authenticationInfo.credentialBackedUp ? 1 : 0, this.now(), row.id]);
    return row.user_id;
  }

  // ── Management ───────────────────────────────────────────────────────────────────────────────────────

  private summary(p: PasskeyRow): PasskeySummary {
    return { id: p.id, name: p.name, synced: p.backed_up === 1, createdAt: p.created_at, lastUsedAt: p.last_used_at };
  }

  async list(userId: number): Promise<PasskeySummary[]> {
    return (await this.db.all<PasskeyRow>('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC, id DESC', [userId])).map((p) => this.summary(p));
  }

  async rename(userId: number, id: number, name: unknown): Promise<boolean> {
    const n = cleanName(name);
    return n.length > 0 && (await this.db.run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', [n, id, userId])).changes > 0;
  }

  /** No guard for the last one: the password (and its two-factor) always remain. */
  async remove(userId: number, id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [id, userId])).changes > 0;
  }
}
