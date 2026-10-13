// Brute-force guard (FD-USERS §5), ported from Serento.Web's LoginThrottle: after MAX_FAILURES within the cooldown a
// key is locked for COOLDOWN. Keys carry a partition prefix (login:, register:, mail:) so one guard never locks
// another. In memory: a restart clears it.

export const MAX_FAILURES = 3;
export const COOLDOWN_MS = 15 * 60_000;
const MAX_ENTRIES = 4000;
const TARGET_ENTRIES = 3000;

interface Entry {
  failures: number;
  lockedUntil: number | null;
  lastSeen: number;
}

/**
 * The caller: an IPv4 address whole, an IPv6 address by its /64 (one host is routinely given a whole /64, so the
 * full address would hand an attacker unlimited fresh keys). IPv4-mapped IPv6 counts as IPv4.
 */
export function callerKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v = ip.trim().toLowerCase();
  if (v.startsWith('::ffff:') && v.includes('.')) return v.slice(7);
  if (!v.includes(':')) return v;
  // Expand "::" so the first four groups are the /64.
  const [head = '', tail = ''] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = v.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export class Throttle {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Remaining lockout (ms), or null. */
  lockedFor(key: string): number | null {
    const e = this.entries.get(key);
    if (e?.lockedUntil) {
      const remaining = e.lockedUntil - this.now();
      if (remaining > 0) return remaining;
      this.entries.delete(key);
    }
    return null;
  }

  /** Counts one failure; returns the lockout (ms) when this one started or is inside a lockout. */
  registerFailure(key: string): number | null {
    const now = this.now();
    let e = this.entries.get(key);
    if (!e) {
      // Compacted before inserting, so the new entry cannot be the one the compaction drops.
      if (this.entries.size >= MAX_ENTRIES) this.compact(now);
      e = { failures: 0, lockedUntil: null, lastSeen: now };
      this.entries.set(key, e);
    }
    if (e.lockedUntil !== null && e.lockedUntil <= now) {
      e.failures = 0;
      e.lockedUntil = null;
    }
    e.failures++;
    e.lastSeen = now;
    if (e.failures >= MAX_FAILURES) {
      e.lockedUntil ??= now + COOLDOWN_MS;
      return e.lockedUntil - now;
    }
    return null;
  }

  remaining(key: string): number {
    const e = this.entries.get(key);
    return e ? Math.max(0, MAX_FAILURES - e.failures) : MAX_FAILURES;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Stale entries first, then the oldest, surrendering live lockouts last (as in Serento). */
  private compact(now: number): void {
    for (const [k, e] of this.entries) if (e.lastSeen < now - COOLDOWN_MS && (e.lockedUntil === null || e.lockedUntil <= now)) this.entries.delete(k);
    if (this.entries.size <= TARGET_ENTRIES) return;
    const order = [...this.entries.entries()].sort(
      (a, b) => Number(a[1].lockedUntil !== null && a[1].lockedUntil > now) - Number(b[1].lockedUntil !== null && b[1].lockedUntil > now) || a[1].lastSeen - b[1].lastSeen,
    );
    for (const [k] of order.slice(0, this.entries.size - TARGET_ENTRIES)) this.entries.delete(k);
  }
}

export const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
