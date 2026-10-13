// The Claude connector's authorization server (FD-MCP §4, TD-MCP §3): which apps may ask (the client documents Claude
// publishes, or clients registered by DCR), the user's consent, one-time codes with PKCE, short access tokens and
// rotating refresh tokens, all bound to this server. Only hashes are stored and nothing secret is logged.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { USER_AGENT } from '../config.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';

export const SCOPE = 'sentiq:read';
export const ACCESS_TTL_MS = 3_600_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;
export const CODE_TTL_MS = 60_000;
export const REQUEST_TTL_MS = 10 * 60_000;
/** A rotated refresh token seen again this soon is a client's retry, later it is a stolen copy (FD-MCP §6). */
export const REUSE_GRACE_MS = 60_000;
const MAX_PENDING = 500;
const MAX_DCR_CLIENTS = 500;
const DOC_MAX_BYTES = 10_000;
const DOC_TIMEOUT_MS = 5_000;
const DOC_TTL = { min: 60_000, max: 3_600_000, fallback: 300_000 };
const LAST_USED_EVERY_MS = 60_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** PKCE verifiers and challenges: 43–128 unreserved characters (RFC 7636). */
const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** An OAuth error with its RFC 6749 code (`invalid_grant`, …) and HTTP status. */
export class OAuthError extends Error {
  readonly error: string;
  readonly status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

export interface ClientInfo {
  clientId: string;
  /** The name the client gives itself (self-asserted: the page shows the host next to it). */
  name: string;
  /** Who vouches for it: the client document's host (CIMD) or the callback's host (DCR). */
  host: string;
  kind: 'cimd' | 'dcr';
  redirectUris: string[];
}

export interface PendingRequest {
  id: string;
  /** Kept in a cookie of the browser that started the request: only that browser can answer it (FD-MCP §6). */
  binding: string;
  client: ClientInfo;
  redirectUri: string;
  redirectHost: string;
  /** The callback is this computer (Claude Code): the page warns. */
  loopback: boolean;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string;
  createdAt: number;
}

export type AuthorizeOutcome =
  | { kind: 'consent'; id: string; binding: string }
  /** Errors the client must hear about, sent back to its callback. */
  | { kind: 'redirect'; url: string }
  /** The client or its callback cannot be trusted: shown on Sentiq's own page, never redirected (RFC 6749 §4.1.2.1). */
  | { kind: 'error-page'; message: string };

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface VerifiedToken {
  userId: number;
  grantId: number;
  clientId: string;
  scopes: string[];
  /** Seconds since the epoch (MCP `AuthInfo.expiresAt`). */
  expiresAt: number;
  resource: string;
}

export interface Connection {
  id: number;
  clientName: string;
  clientHost: string;
  redirectHost: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** A client document as fetched: the status, the body (capped) and its `Cache-Control`. */
export type DocFetcher = (url: string) => Promise<{ status: number; body: string; cacheControl: string | null }>;

export interface OAuthDeps {
  db: Db;
  log: Logger;
  /** The server's origin, e.g. https://sentiq.example.com: the issuer. */
  issuer: string;
  /** The hosts whose apps may connect (TD-MCP §1). */
  clientHosts: string[];
  /** Can this account be used right now (not disabled, deleted or unverified)? */
  userActive: (userId: number) => boolean;
  fetchDoc?: DocFetcher;
  now?: () => number;
}

interface GrantRow {
  id: number;
  user_id: number;
  client_id: string;
  scope: string;
  resource: string;
  revoked_at: number | null;
  last_used_at: number | null;
}

interface CodeRow {
  user_id: number;
  client_id: string;
  client_name: string;
  client_host: string;
  redirect_uri: string;
  redirect_host: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: number;
  used_at: number | null;
  grant_id: number | null;
}

interface TokenRow {
  grant_id: number;
  kind: 'access' | 'refresh';
  expires_at: number;
  rotated_at: number | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A client's self-given name, safe for the page and the log (no control characters, which could fake log lines). */
const cleanClientName = (raw: string) => raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim().slice(0, 100);

/**
 * Every connection of a user ends (signed out everywhere, a new password by link, disabled by the admin). Works with
 * the connector off too: connections left from a time it was on must not come back when it is turned on again.
 */
export function revokeUserGrants(db: Db, log: Logger, userId: number, why: string, now = Date.now()): number {
  const n = db.tx(() => {
    const ids = db.all<{ id: number }>('SELECT id FROM mcp_grants WHERE user_id = ? AND revoked_at IS NULL', [userId]).map((r) => r.id);
    for (const id of ids) {
      db.run('UPDATE mcp_grants SET revoked_at = ? WHERE id = ?', [now, id]);
      db.run('DELETE FROM mcp_tokens WHERE grant_id = ?', [id]);
    }
    return ids.length;
  });
  if (n) log.info(`mcp: ${n} connection(s) of user ${userId} ended (${why})`);
  return n;
}
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;

/** Reads a fetch body up to `max` bytes (a larger one is refused, not truncated). */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new Error('document too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('document too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Fetches a client document: no redirects (the document must live at its own address), 5 s, 10 KB. */
export const defaultFetchDoc: DocFetcher = async (url) => {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(DOC_TIMEOUT_MS), headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  return { status: res.status, body: await readCapped(res, DOC_MAX_BYTES), cacheControl: res.headers.get('cache-control') };
};

/** How long to keep a client document: its `max-age`, between 1 minute and 1 hour (5 minutes without one). */
export function docTtl(cacheControl: string | null): number {
  const m = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl ?? '');
  if (/no-store|no-cache/i.test(cacheControl ?? '') || !m) return DOC_TTL.fallback;
  return Math.min(DOC_TTL.max, Math.max(DOC_TTL.min, Number(m[1]) * 1000));
}

/** A callback address: https on a trusted host, or this computer (any port). */
export function classifyRedirect(uri: string, clientHosts: readonly string[]): { host: string; loopback: boolean } | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  if (u.hash || u.username || u.password || uri.length > 500) return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return { host: u.hostname, loopback: true };
  if (u.protocol === 'https:' && clientHosts.includes(u.host.toLowerCase())) return { host: u.host.toLowerCase(), loopback: false };
  return null;
}

/** The requested callback against a registered one: exact, or for this computer the same address on any port (RFC 8252 §7.3). */
export function redirectMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const a = new URL(requested);
    const b = new URL(registered);
    return a.protocol === 'http:' && b.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** The resource a client names, compared without one trailing slash and with the scheme and host in lower case. */
function sameResource(asked: string, ours: string): boolean {
  try {
    const u = new URL(asked);
    if (u.hash) return false;
    const norm = `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
    return norm === ours.toLowerCase();
  } catch {
    return false;
  }
}

/** Adds the answer's parameters to a callback, keeping the callback's own query. */
function withParams(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Old codes, expired tokens, long-ended connections and unused registrations (the daily maintenance; with the connector
 * off too, for rows left from a time it was on).
 */
export function pruneMcp(db: Db, now = Date.now()): void {
  db.run('DELETE FROM mcp_codes WHERE expires_at < ?', [now - 86_400_000]);
  db.run('DELETE FROM mcp_tokens WHERE expires_at < ?', [now]);
  db.run('DELETE FROM mcp_grants WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR (created_at < ? AND NOT EXISTS (SELECT 1 FROM mcp_tokens t WHERE t.grant_id = mcp_grants.id))', [
    now - 30 * 86_400_000,
    now - 86_400_000,
  ]);
  db.run('DELETE FROM mcp_clients WHERE COALESCE(last_used_at, created_at) < ? AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = mcp_clients.client_id)', [
    now - 30 * 86_400_000,
  ]);
}

export class OAuthService {
  readonly issuer: string;
  /** The MCP endpoint: what tokens are issued for (their audience). */
  readonly resource: string;
  private readonly db: Db;
  private readonly log: Logger;
  private readonly clientHosts: string[];
  private readonly userActive: (userId: number) => boolean;
  private readonly fetchDoc: DocFetcher;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly docs = new Map<string, { client: ClientInfo; until: number }>();

  constructor(deps: OAuthDeps) {
    this.db = deps.db;
    this.log = deps.log;
    this.issuer = deps.issuer;
    this.resource = `${deps.issuer}/mcp`;
    this.clientHosts = deps.clientHosts.map((h) => h.toLowerCase());
    this.userActive = deps.userActive;
    this.fetchDoc = deps.fetchDoc ?? defaultFetchDoc;
    this.now = deps.now ?? (() => Date.now());
  }

  // ---------------- clients ----------------

  /** The app behind a `client_id`: Claude's published document (CIMD) or a client registered here (DCR). */
  async resolveClient(clientId: string): Promise<ClientInfo> {
    if (clientId.startsWith('sq_dcr_')) {
      const r = this.db.get<{ client_name: string; redirect_uris: string }>('SELECT client_name, redirect_uris FROM mcp_clients WHERE client_id = ?', [clientId]);
      if (!r) throw new OAuthError('invalid_client', 'Aplicația nu e înregistrată la Sentiq.');
      const redirectUris = JSON.parse(r.redirect_uris) as string[];
      const host = classifyRedirect(redirectUris[0] ?? '', this.clientHosts)?.host ?? '?';
      return { clientId, name: r.client_name, host, kind: 'dcr', redirectUris };
    }
    let u: URL;
    try {
      u = new URL(clientId);
    } catch {
      throw new OAuthError('invalid_client', 'Aplicația nu e cunoscută.');
    }
    if (u.protocol !== 'https:' || u.pathname.length < 2 || u.hash || u.username || u.password || clientId.length > 300) {
      throw new OAuthError('invalid_client', 'Aplicația nu e cunoscută.');
    }
    const host = u.host.toLowerCase();
    if (!this.clientHosts.includes(host)) throw new OAuthError('invalid_client', `Sentiq acceptă doar aplicațiile Claude, nu ${host}.`);
    const cached = this.docs.get(clientId);
    if (cached && cached.until > this.now()) return cached.client;
    let doc: unknown;
    let ttl: number;
    try {
      const r = await this.fetchDoc(clientId);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      doc = JSON.parse(r.body);
      ttl = docTtl(r.cacheControl);
    } catch (err) {
      this.log.warn(`mcp: the client document ${clientId} could not be read (${(err as Error).message})`);
      throw new OAuthError('invalid_client', 'Descrierea aplicației nu s-a putut citi. Încearcă din nou.');
    }
    const d = (doc ?? {}) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
    const redirectUris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter((x): x is string => typeof x === 'string') : [];
    if (d.client_id !== clientId || !redirectUris.length || (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none')) {
      throw new OAuthError('invalid_client', 'Descrierea aplicației nu e validă.');
    }
    const name = (typeof d.client_name === 'string' && cleanClientName(d.client_name)) || host;
    const client: ClientInfo = { clientId, name, host, kind: 'cimd', redirectUris };
    this.docs.set(clientId, { client, until: this.now() + ttl });
    return client;
  }

  /** RFC 7591 registration: only callbacks of the trusted hosts (or this computer), public clients only. */
  register(body: unknown): { client_id: string; client_id_issued_at: number; client_name: string; redirect_uris: string[]; grant_types: string[]; response_types: string[]; token_endpoint_auth_method: 'none' } {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (!uris.length || uris.length > 5 || !uris.every((x) => typeof x === 'string' && classifyRedirect(x, this.clientHosts))) {
      throw new OAuthError('invalid_redirect_uri', 'Sentiq acceptă doar adresele de întoarcere ale aplicațiilor Claude.');
    }
    const method = b.token_endpoint_auth_method ?? 'none';
    const grants = b.grant_types ?? ['authorization_code', 'refresh_token'];
    const responses = b.response_types ?? ['code'];
    if (
      method !== 'none' ||
      !Array.isArray(grants) ||
      !grants.every((g) => g === 'authorization_code' || g === 'refresh_token') ||
      !Array.isArray(responses) ||
      !responses.every((r) => r === 'code') ||
      (b.client_name !== undefined && typeof b.client_name !== 'string')
    ) {
      throw new OAuthError('invalid_client_metadata', 'Sentiq acceptă doar clienți publici cu cod de autorizare și PKCE.');
    }
    const now = this.now();
    const count = this.db.get<{ n: number }>('SELECT count(*) AS n FROM mcp_clients')?.n ?? 0;
    if (count >= MAX_DCR_CLIENTS) {
      // The oldest client nobody uses makes room; with every one in use, no more.
      const freed = this.db.run(
        'DELETE FROM mcp_clients WHERE client_id = (SELECT client_id FROM mcp_clients c WHERE NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.client_id AND g.revoked_at IS NULL) ORDER BY COALESCE(last_used_at, created_at) LIMIT 1)',
      ).changes;
      if (!freed) throw new OAuthError('temporarily_unavailable', 'Prea multe aplicații înregistrate.', 503);
    }
    const name = (typeof b.client_name === 'string' && cleanClientName(b.client_name)) || 'Aplicație';
    const clientId = secret('sq_dcr_');
    const redirectUris = uris as string[];
    this.db.run('INSERT INTO mcp_clients(client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)', [clientId, name, JSON.stringify(redirectUris), now]);
    this.log.info(`mcp: client registered (${name}, ${classifyRedirect(redirectUris[0] as string, this.clientHosts)?.host})`);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // ---------------- authorization ----------------

  /** `GET /authorize`: the request checked, then kept here while the user decides (FD-MCP §4). */
  async authorize(q: Record<string, string | undefined>): Promise<AuthorizeOutcome> {
    if (!q.client_id) return { kind: 'error-page', message: 'Cererea nu spune ce aplicație se conectează.' };
    let client: ClientInfo;
    try {
      client = await this.resolveClient(q.client_id);
    } catch (err) {
      return { kind: 'error-page', message: (err as Error).message };
    }
    // Always named (the token request repeats it), and one of the app's own (MCP: exact match, loopback on any port).
    const redirectUri = q.redirect_uri;
    const target = redirectUri ? classifyRedirect(redirectUri, this.clientHosts) : null;
    if (!redirectUri || !target || !client.redirectUris.some((r) => (client.kind === 'cimd' ? redirectMatches(redirectUri, r) : redirectUri === r))) {
      return { kind: 'error-page', message: 'Adresa de întoarcere nu e a aplicației care cere accesul.' };
    }
    const state = q.state ?? null;
    const fail = (error: string, description: string): AuthorizeOutcome => ({
      kind: 'redirect',
      url: withParams(redirectUri, { error, error_description: description, state, iss: this.issuer }),
    });
    if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
    if (!q.code_challenge || q.code_challenge_method !== 'S256' || !PKCE_RE.test(q.code_challenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    }
    if (state !== null && state.length > 1000) return fail('invalid_request', 'state is too long.');
    const scopes = (q.scope ?? '').split(' ').filter(Boolean);
    if (scopes.some((s) => s !== SCOPE && s !== 'offline_access')) return fail('invalid_scope', `Supported scopes: ${SCOPE} offline_access.`);
    if (q.resource !== undefined && !sameResource(q.resource, this.resource)) return fail('invalid_target', `This server issues tokens for ${this.resource} only.`);
    const now = this.now();
    this.prunePending(now);
    const id = randomBytes(16).toString('base64url');
    const binding = randomBytes(24).toString('base64url');
    this.pending.set(id, {
      id,
      binding,
      client,
      redirectUri,
      redirectHost: target.host,
      loopback: target.loopback,
      state,
      codeChallenge: q.code_challenge,
      scope: SCOPE,
      resource: this.resource,
      createdAt: now,
    });
    return { kind: 'consent', id, binding };
  }

  /** A request waiting for the answer of the browser that started it, or null (unknown, expired, another browser). */
  request(id: string, binding: string | undefined): PendingRequest | null {
    const r = this.pending.get(id);
    if (!r) return null;
    if (this.now() - r.createdAt > REQUEST_TTL_MS) {
      this.pending.delete(id);
      return null;
    }
    const a = Buffer.from(binding ?? '');
    const b = Buffer.from(r.binding);
    return a.length === b.length && timingSafeEqual(a, b) ? r : null;
  }

  /** The user's answer: where the browser goes next (the app's callback), or null for an unknown / expired request. */
  decide(id: string, userId: number, approve: boolean, binding: string | undefined): { redirect: string } | null {
    const r = this.request(id, binding);
    if (!r) return null;
    this.pending.delete(id);
    if (!approve) return { redirect: withParams(r.redirectUri, { error: 'access_denied', error_description: 'The user refused.', state: r.state, iss: this.issuer }) };
    const code = secret('sq_ac_');
    this.db.run(
      `INSERT INTO mcp_codes(hash, user_id, client_id, client_name, client_host, redirect_uri, redirect_host, code_challenge, scope, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sha256(code), userId, r.client.clientId, r.client.name, r.client.host, r.redirectUri, r.redirectHost, r.codeChallenge, r.scope, r.resource, this.now() + CODE_TTL_MS],
    );
    return { redirect: withParams(r.redirectUri, { code, state: r.state, iss: this.issuer }) };
  }

  private prunePending(now: number): void {
    for (const [id, r] of this.pending) if (now - r.createdAt > REQUEST_TTL_MS) this.pending.delete(id);
    // Maps keep insertion order: the oldest go first.
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
  }

  // ---------------- tokens ----------------

  /** `POST /token`. */
  token(p: Record<string, string | undefined>): TokenResponse {
    if (p.grant_type === 'authorization_code') return this.exchangeCode(p);
    if (p.grant_type === 'refresh_token') return this.refresh(p);
    throw new OAuthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token.');
  }

  private exchangeCode(p: Record<string, string | undefined>): TokenResponse {
    if (!p.code || !p.code_verifier || !p.redirect_uri || !p.client_id) throw new OAuthError('invalid_request', 'code, code_verifier, redirect_uri and client_id are required.');
    const now = this.now();
    const hash = sha256(p.code);
    const row = this.db.get<CodeRow>('SELECT * FROM mcp_codes WHERE hash = ?', [hash]);
    if (!row) throw new OAuthError('invalid_grant', 'Unknown authorization code.');
    if (row.used_at !== null) {
      // A code used twice was copied: whatever it gave is withdrawn (RFC 6749 §4.1.2).
      if (row.grant_id !== null) this.revokeGrant(row.grant_id, null, 'authorization code used twice');
      throw new OAuthError('invalid_grant', 'Authorization code already used.');
    }
    if (row.expires_at < now) throw new OAuthError('invalid_grant', 'Authorization code expired.');
    if (row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) throw new OAuthError('invalid_grant', 'The code was issued to another client or callback.');
    if (!PKCE_RE.test(p.code_verifier) || createHash('sha256').update(p.code_verifier).digest('base64url') !== row.code_challenge) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed.');
    }
    if (p.resource !== undefined && !sameResource(p.resource, row.resource)) throw new OAuthError('invalid_target', `Tokens are issued for ${row.resource} only.`);
    if (!this.userActive(row.user_id)) throw new OAuthError('invalid_grant', 'The account cannot be used.');
    const tokens = this.db.tx(() => {
      const id = this.db.run(
        `INSERT INTO mcp_grants(user_id, client_id, client_name, client_host, redirect_host, scope, resource, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.user_id, row.client_id, row.client_name, row.client_host, row.redirect_host, row.scope, row.resource, now, now],
      ).lastInsertRowid;
      this.db.run('UPDATE mcp_codes SET used_at = ?, grant_id = ? WHERE hash = ?', [now, id, hash]);
      if (row.client_id.startsWith('sq_dcr_')) this.db.run('UPDATE mcp_clients SET last_used_at = ? WHERE client_id = ?', [now, row.client_id]);
      return this.issue(id, row.scope, now);
    });
    this.log.info(`mcp: user ${row.user_id} connected ${row.client_name} (${row.client_host})`);
    return tokens;
  }

  private refresh(p: Record<string, string | undefined>): TokenResponse {
    if (!p.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required.');
    const now = this.now();
    const hash = sha256(p.refresh_token);
    const tok = this.db.get<TokenRow>("SELECT grant_id, kind, expires_at, rotated_at FROM mcp_tokens WHERE hash = ? AND kind = 'refresh'", [hash]);
    if (!tok) throw new OAuthError('invalid_grant', 'Unknown refresh token.');
    const grant = this.db.get<GrantRow>('SELECT * FROM mcp_grants WHERE id = ?', [tok.grant_id]);
    if (!grant || grant.revoked_at !== null) throw new OAuthError('invalid_grant', 'The connection was removed.');
    if (tok.rotated_at !== null) {
      // Seen again after it was exchanged: a retry soon after, a stolen copy later (FD-MCP §6).
      if (now - tok.rotated_at > REUSE_GRACE_MS) this.revokeGrant(grant.id, null, 'refresh token used again');
      throw new OAuthError('invalid_grant', 'Refresh token already used.');
    }
    if (tok.expires_at < now) throw new OAuthError('invalid_grant', 'Refresh token expired.');
    if (p.client_id !== undefined && p.client_id !== grant.client_id) throw new OAuthError('invalid_grant', 'The token was issued to another client.');
    if (p.resource !== undefined && !sameResource(p.resource, grant.resource)) throw new OAuthError('invalid_target', `Tokens are issued for ${grant.resource} only.`);
    if (p.scope !== undefined && p.scope.split(' ').filter(Boolean).some((s) => s !== SCOPE && s !== 'offline_access')) throw new OAuthError('invalid_scope', 'Unknown scope.');
    if (!this.userActive(grant.user_id)) throw new OAuthError('invalid_grant', 'The account cannot be used.');
    return this.db.tx(() => {
      this.db.run('UPDATE mcp_tokens SET rotated_at = ? WHERE hash = ?', [now, hash]);
      return this.issue(grant.id, grant.scope, now);
    });
  }

  private issue(grantId: number, scope: string, now: number): TokenResponse {
    const access = secret('sq_at_');
    const refresh = secret('sq_rt_');
    this.db.run("INSERT INTO mcp_tokens(hash, grant_id, kind, expires_at) VALUES (?, ?, 'access', ?)", [sha256(access), grantId, now + ACCESS_TTL_MS]);
    this.db.run("INSERT INTO mcp_tokens(hash, grant_id, kind, expires_at) VALUES (?, ?, 'refresh', ?)", [sha256(refresh), grantId, now + REFRESH_TTL_MS]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope };
  }

  /** A Bearer token on `/mcp`: valid, for this server, of a live connection of an active account; or null. */
  verify(token: string): VerifiedToken | null {
    if (!token.startsWith('sq_at_') || token.length > 200) return null;
    const now = this.now();
    const row = this.db.get<TokenRow & GrantRow>(
      `SELECT t.grant_id, t.kind, t.expires_at, t.rotated_at, g.id, g.user_id, g.client_id, g.scope, g.resource, g.revoked_at, g.last_used_at
       FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id WHERE t.hash = ? AND t.kind = 'access'`,
      [sha256(token)],
    );
    if (!row || row.expires_at < now || row.revoked_at !== null || row.resource !== this.resource || !this.userActive(row.user_id)) return null;
    if (!row.last_used_at || now - row.last_used_at > LAST_USED_EVERY_MS) this.db.run('UPDATE mcp_grants SET last_used_at = ? WHERE id = ?', [now, row.id]);
    return { userId: row.user_id, grantId: row.id, clientId: row.client_id, scopes: row.scope.split(' '), expiresAt: Math.floor(row.expires_at / 1000), resource: row.resource };
  }

  // ---------------- connections ----------------

  /** The user's live connections (a token still usable). */
  connections(userId: number): Connection[] {
    const now = this.now();
    return this.db
      .all<{ id: number; client_name: string; client_host: string; redirect_host: string; created_at: number; last_used_at: number | null }>(
        `SELECT id, client_name, client_host, redirect_host, created_at, last_used_at FROM mcp_grants g
         WHERE user_id = ? AND revoked_at IS NULL
           AND EXISTS (SELECT 1 FROM mcp_tokens t WHERE t.grant_id = g.id AND t.expires_at > ? AND (t.kind = 'access' OR t.rotated_at IS NULL))
         ORDER BY created_at DESC`,
        [userId, now],
      )
      .map((r) => ({ id: r.id, clientName: r.client_name, clientHost: r.client_host, redirectHost: r.redirect_host, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  }

  /** Ends a connection (the user's own when `userId` is given); its tokens stop working at once. */
  revokeGrant(id: number, userId: number | null, why = 'disconnected'): boolean {
    const now = this.now();
    const changed = this.db.tx(() => {
      const n = this.db.run(`UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL${userId === null ? '' : ' AND user_id = ?'}`, userId === null ? [now, id] : [now, id, userId]).changes;
      if (n) this.db.run('DELETE FROM mcp_tokens WHERE grant_id = ?', [id]);
      return n > 0;
    });
    if (changed) this.log.info(`mcp: connection ${id} ended (${why})`);
    return changed;
  }


  /** RFC 7009: the connection a token belongs to ends; an unknown token is not an error. */
  revokeToken(token: string): void {
    const row = this.db.get<{ grant_id: number }>('SELECT grant_id FROM mcp_tokens WHERE hash = ?', [sha256(token)]);
    if (row) this.revokeGrant(row.grant_id, null, 'revoked by the client');
  }

  /** The daily cleanup (see `pruneMcp`). */
  prune(now = this.now()): void {
    pruneMcp(this.db, now);
  }
}
