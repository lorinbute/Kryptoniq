// Sessions (FD-USERS §5, TD-USERS §2): a random token in an HttpOnly cookie, only its SHA-256 in the database.
// `full` = signed in, 30 days sliding; `pending` = the password was right and the second factor is still due,
// 5 minutes, fixed. A pending session never authorises a request: only the 2FA step reads it.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/database.ts';

export const SESSION_COOKIE = 'sentiq_session';
export const FULL_SESSION_MS = 30 * 86_400_000;
export const PENDING_SESSION_MS = 5 * 60_000;
/** A full session's last-seen time (and so its expiry) moves at most this often: one write per 5 min, not per request. */
const SLIDE_EVERY_MS = 5 * 60_000;

export type SessionKind = 'full' | 'pending';

export interface SessionRow {
  id_hash: string;
  user_id: number;
  kind: SessionKind;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  /** Set when this read moved the expiry forward: the cookie's own lifetime has to follow. */
  slid?: boolean;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export class Sessions {
  private readonly db: Db;
  private readonly now: () => number;
  constructor(db: Db, now: () => number = () => Date.now()) {
    this.db = db;
    this.now = now;
  }

  create(userId: number, kind: SessionKind, meta: { ip?: string; userAgent?: string } = {}): string {
    const token = newToken();
    const now = this.now();
    this.db.run(
      'INSERT INTO sessions(id_hash, user_id, kind, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [hashToken(token), userId, kind, now, now, now + (kind === 'full' ? FULL_SESSION_MS : PENDING_SESSION_MS), meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300) || null],
    );
    return token;
  }

  /** The live session for a token (expired ones are removed); a full one slides forward. */
  read(token: string | undefined): SessionRow | null {
    if (!token || token.length > 100) return null;
    const idHash = hashToken(token);
    const row = this.db.get<SessionRow>('SELECT id_hash, user_id, kind, created_at, last_seen_at, expires_at FROM sessions WHERE id_hash = ?', [idHash]);
    if (!row) return null;
    const now = this.now();
    if (row.expires_at <= now) {
      this.db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
      return null;
    }
    if (row.kind === 'full' && now - row.last_seen_at >= SLIDE_EVERY_MS) {
      this.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?', [now, now + FULL_SESSION_MS, idHash]);
      row.last_seen_at = now;
      row.expires_at = now + FULL_SESSION_MS;
      row.slid = true;
    }
    return row;
  }

  destroy(token: string | undefined): void {
    if (token) this.db.run('DELETE FROM sessions WHERE id_hash = ?', [hashToken(token)]);
  }

  /** Every session of a user, except (optionally) the one making the request. */
  destroyAll(userId: number, exceptToken?: string): number {
    if (exceptToken) return this.db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', [userId, hashToken(exceptToken)]).changes;
    return this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]).changes;
  }

  /** Pending sessions of a user (2FA turned off elsewhere invalidates them). */
  destroyPending(userId: number): void {
    this.db.run("DELETE FROM sessions WHERE user_id = ? AND kind = 'pending'", [userId]);
  }

  purgeExpired(): number {
    return this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [this.now()]).changes;
  }
}
