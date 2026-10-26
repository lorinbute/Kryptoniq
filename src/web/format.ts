// Formatting helpers (Romanian locale, user time zone).

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ro-RO', { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

export const fmtTime = (ts: number, tz: string) => dtf(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
export const fmtDate = (ts: number, tz: string) => dtf(tz, { day: '2-digit', month: 'short' }).format(ts);
export const fmtDateTime = (ts: number, tz: string) =>
  dtf(tz, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
export const fmtWeekday = (ts: number, tz: string) => dtf(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);

export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 0) return fmtIn(ts, now);
  if (s < 60) return 'acum';
  const m = Math.round(s / 60);
  if (m < 60) return `acum ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `acum ${h} h`;
  const d = Math.floor(h / 24);
  return `acum ${d} ${d === 1 ? 'zi' : 'zile'}`;
}

export function fmtIn(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((ts - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `în ${Math.floor(h / 24)} z ${h % 24} h`;
  if (h > 0) return `în ${h} h ${String(m).padStart(2, '0')} min`;
  return `în ${m}:${String(sec).padStart(2, '0')}`;
}

/** Compact countdown for the cockpit tiles: "1z 17h 44m", "3h 05m", "12m 09s"; 0 once the time has passed. */
export function fmtCountdown(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((ts - now) / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}z ${h}h ${two(m)}m`;
  if (h > 0) return `${h}h ${two(m)}m`;
  return `${m}m ${two(sec)}s`;
}

const nf = new Map<string, Intl.NumberFormat>();
function numFmt(min: number, max: number, extra: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${min}|${max}|${JSON.stringify(extra)}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra });
    nf.set(key, f);
  }
  return f;
}

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numFmt(digits, digits).format(v);
}

export function fmtNum(v: number | null | undefined, max = 2, min = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numFmt(min, max).format(v);
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = numFmt(digits, digits).format(v);
  return `${signed && v > 0 ? '+' : ''}${s}%`;
}

/** USD amounts in the same (Romanian) number style as the rest of the UI: "1.234,50 USD", "2,82 tril. USD". */
export function fmtUsd(v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numFmt(compact ? 0 : 2, 2, { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard' }).format(v);
}

/**
 * An amount in a currency (FD-SENTIQ §3): "1.234,50 €", "980,00 GBP"-style through Intl for ISO codes, and
 * "1.234,50 USDT" for the crypto quote coins Intl does not know.
 */
export function fmtMoney(v: number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return numFmt(2, 2, { style: 'currency', currency }).format(v);
    } catch {
      // unknown ISO code: plain number with the code
    }
  }
  return `${numFmt(2, 2).format(v)} ${currency}`;
}

/** Decimals that keep ~5 significant digits for prices without exchange precision. */
export function autoDigits(v: number): number {
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a === 0) return 2;
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  return Math.min(10, Math.ceil(-Math.log10(a)) + 4);
}

export type Tone = 'bull' | 'bear' | 'neutral';

export function indexTone(index: number): Tone {
  if (index >= 60) return 'bull';
  if (index < 40) return 'bear';
  return 'neutral';
}

export function indexLabel(index: number): string {
  if (index < 20) return 'Foarte negativ';
  if (index < 40) return 'Negativ';
  if (index < 60) return 'Neutru';
  if (index < 80) return 'Pozitiv';
  return 'Foarte pozitiv';
}

export const confidenceLabel: Record<string, string> = { low: 'încredere scăzută', medium: 'încredere medie', high: 'încredere ridicată' };

export const toneText: Record<Tone, string> = { bull: 'text-bull', bear: 'text-bear', neutral: 'text-muted' };

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  // The database's maximum size (FD-AZURE §5): 2 GB, 250 GB.
  return `${Number((n / 1024 ** 3).toFixed(1))} GB`;
}

/** A count in Romanian: "1 desen", "3 desene", "20 de desene", "101 desene" (with "de" from 20 on, unless it ends in 01–19). */
export function countRo(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const r = n % 100;
  return `${n} ${n < 20 || (r >= 1 && r <= 19) ? '' : 'de '}${many}`;
}
