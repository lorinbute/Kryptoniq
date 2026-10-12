// Text/URL/date normalisation for feed items. Pure functions.
import { decode } from 'he';

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|ref_src|cmpid|cmp|src|ncid|taid|yptr|guccounter|_hsenc|_hsmi|mkt_tok)$/i;

/** Plain text from (possibly HTML) feed content. Never returns markup. */
export function toPlainText(input: unknown, maxLen = 10_000): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let s = input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  // Feeds sometimes double-escape; decode at most twice.
  s = decode(s);
  if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s)) s = decode(s);
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return s;
}

/** Only http(s) links are kept; returns null otherwise. */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Canonical form used to detect the same article across fetches and sources. */
export function canonicalUrl(input: unknown): string | null {
  const safe = safeHttpUrl(input);
  if (!safe) return null;
  const u = new URL(safe);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.protocol = 'https:';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}

const NAIVE_UTC = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** Parses RFC 822, ISO 8601 and `YYYY-MM-DD HH:mm:ss` (interpreted as UTC). */
export function parseFeedDate(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const naive = NAIVE_UTC.exec(s);
  if (naive) {
    const t = Date.parse(`${naive[1]}T${naive[2]}Z`);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  // "Mon, 12 Oct 2026 14:18:49 +0000 (UTC)" and similar trailing comments
  const t2 = Date.parse(s.replace(/\s*\([^)]*\)\s*$/, ''));
  return Number.isFinite(t2) ? t2 : null;
}

export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const MAX_ITEM_AGE_MS = 3 * 24 * 3_600_000;

/**
 * Publication time used by the app: missing or implausibly future dates fall back to the
 * discovery time; items older than 3 days are rejected (null) on first discovery.
 */
export function effectivePublishedAt(published: number | null, now: number): number | null {
  if (published === null || published > now + MAX_FUTURE_SKEW_MS) return now;
  if (published < now - MAX_ITEM_AGE_MS) return null;
  return published;
}
