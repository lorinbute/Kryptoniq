// FD-WATCHLISTS §3: what the "Date financiare" popup shows of a symbol. A stock: Nasdaq's description, sector and
// industry, and the last four quarters from TradingView's screener (it has the newly listed ones Nasdaq has not yet);
// a coin: CoinGecko's description; an index: Sentiq's own words. Kept a while in market_cache (the same for everyone);
// the description translated into Romanian with the user's own AI, once per text.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import type { AiService } from '../ai/service.ts';
import { httpRequest } from '../net/http.ts';
import { ValidationError } from '../settings.ts';
import { isTvSymbol, tvScan } from '../calendar/sources.ts';
import { AI_PROVIDER_INFO } from '../../shared/ai.ts';
import { indexById, plainSymbol } from '../../shared/indices.ts';
import type { NasdaqClient } from './stocks.ts';

export type ProfileKind = 'crypto' | 'stock' | 'index' | 'fund';

export interface ProfileQuarter {
  /** The last day of the month the quarter ended in (YYYY-MM-DD). */
  end: string;
  revenue: number | null;
  grossProfit: number | null;
  ebitda: number | null;
  netIncome: number | null;
  /** Diluted EPS, in dollars. */
  eps: number | null;
  freeCashFlow: number | null;
  /** Against the same quarter a year before: revenue as a ratio change, EPS against its absolute value. */
  revenueYoY: number | null;
  epsYoY: number | null;
}

export interface SymbolProfile {
  kind: ProfileKind;
  /** As the lists keep it: "AAPL", "BTC", "^SPX". */
  symbol: string;
  name: string | null;
  description: { text: string; source: 'Nasdaq' | 'CoinGecko' | 'Sentiq'; lang: 'en' | 'ro' } | null;
  /** The Romanian translation made already (FD-WATCHLISTS §3); null when none yet. */
  translated: string | null;
  facts: { label: string; value: string; href?: string }[];
  /** Newest first, at most four. */
  quarters: ProfileQuarter[];
  /** The next results, as TradingView has them (FD-EARNTV). */
  next: { day: string; time: 'pre' | 'after' | 'unknown'; confirmed: boolean; eps: number | null } | null;
  /** What could not be read now: shown in place of that part. */
  problems: { part: 'description' | 'results'; message: string }[];
  fetchedAt: number;
}

const STOCK_TTL_MS = 12 * 3_600_000;
const CRYPTO_TTL_MS = 7 * 24 * 3_600_000;
/** A description longer than this is cut at a sentence's end (some coins' run for pages). */
export const DESCRIPTION_MAX = 1500;
const QUARTERS = 4;

const profileKey = (kind: string, symbol: string) => `profile:v1:${kind}:${symbol}`;
const translationKey = (text: string) => `translate:ro:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;

/** TradingView's columns for a stock's profile, in this order. */
export const TV_PROFILE_COLUMNS = [
  'name',
  'is_primary',
  'type',
  'total_revenue_fq_h',
  'gross_profit_fq_h',
  'ebitda_fq_h',
  'net_income_fq_h',
  'earnings_per_share_diluted_fq_h',
  'free_cash_flow_fq_h',
  'fiscal_period_end_fq',
  'earnings_release_next_trading_date_fq',
  'earnings_publication_type_next_fq',
  'earnings_release_next_time',
  'earnings_per_share_forecast_next_fq',
  'sector',
  'industry',
] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nums = (v: unknown): (number | null)[] => (Array.isArray(v) ? v.map(num) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDay = (sec: number | null): string | null => {
  if (sec === null) return null;
  const d = new Date(sec * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

export interface TvFundamentals {
  type: string | null;
  quarters: ProfileQuarter[];
  next: SymbolProfile['next'];
  sector: string | null;
  industry: string | null;
}

/** The last day of the month `back` months before the one of `endSec` (a quarter's end, three months a step). */
function monthEnd(endSec: number, back: number): string | null {
  const d = new Date(endSec * 1000);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back + 1, 0)).toISOString().slice(0, 10);
}

/** TradingView's screener answer for one stock → its quarters (newest first), next results, sector (FD-WATCHLISTS §3). */
export function parseTvFundamentals(body: string, symbol: string): TvFundamentals | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('TradingView: răspunsul nu e JSON');
  }
  const rows = z
    .object({ data: z.array(z.object({ s: z.string(), d: z.array(z.unknown()) })).nullish() })
    .loose()
    .safeParse(json);
  if (!rows.success) throw new Error('TradingView: răspuns neașteptat');
  // The same name on several exchanges: the one with results, then the primary listing.
  const candidates = (rows.data.data ?? []).filter((r) => r.d[0] === symbol);
  const rank = (d: unknown[]) => (Array.isArray(d[3]) ? 2 : 0) + (d[1] === true ? 1 : 0);
  const best = candidates.sort((a, b) => rank(b.d) - rank(a.d))[0];
  if (!best) return null;
  const [, , type, rev, gross, ebitda, net, eps, fcf, periodEnd, nextDay, pubType, nextTime, nextEps, sector, industry] = best.d;
  const r = nums(rev);
  const e = nums(eps);
  const g = nums(gross);
  const eb = nums(ebitda);
  const n = nums(net);
  const f = nums(fcf);
  const end = num(periodEnd);
  const quarters: ProfileQuarter[] = [];
  for (let i = 0; i < Math.min(QUARTERS, r.length) && end !== null; i++) {
    const day = monthEnd(end, 3 * i);
    if (!day) break;
    const before = r[i + 4] ?? null;
    const epsBefore = e[i + 4] ?? null;
    const revenue = r[i] ?? null;
    const epsNow = e[i] ?? null;
    quarters.push({
      end: day,
      revenue,
      grossProfit: g[i] ?? null,
      ebitda: eb[i] ?? null,
      netIncome: n[i] ?? null,
      eps: epsNow,
      freeCashFlow: f[i] ?? null,
      revenueYoY: revenue !== null && before !== null && before > 0 ? revenue / before - 1 : null,
      epsYoY: epsNow !== null && epsBefore !== null && epsBefore !== 0 ? (epsNow - epsBefore) / Math.abs(epsBefore) : null,
    });
  }
  const day = isoDay(num(nextDay));
  const pub = num(pubType);
  return {
    type: str(type),
    quarters,
    next: day ? { day, time: nextTime === -1 ? 'pre' : nextTime === 1 ? 'after' : 'unknown', confirmed: pub !== null && pub >= 11 && pub <= 13, eps: num(nextEps) } : null,
    sector: str(sector),
    industry: str(industry),
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** CoinGecko's HTML description → plain text: paragraphs kept, links and tags out, entities read, cut at ~1,500. */
export function plainDescription(html: string, max = DESCRIPTION_MAX): string {
  const text = html
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // At the last sentence's end in the second half; otherwise at a word.
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return stop > max / 2 ? `${cut.slice(0, stop + 1)}…` : `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

const searchSchema = z.object({ coins: z.array(z.object({ id: z.string(), symbol: z.string(), market_cap_rank: z.number().nullish() }).loose()) }).loose();
const coinSchema = z
  .object({
    name: z.string().nullish(),
    description: z.object({ en: z.string().nullish() }).loose().nullish(),
    categories: z.array(z.string().nullish()).nullish(),
    genesis_date: z.string().nullish(),
    links: z.object({ homepage: z.array(z.string().nullish()).nullish() }).loose().nullish(),
  })
  .loose();

/** The CoinGecko coin with this exact symbol and the best market-cap rank (none ranked last); null without one. */
export function pickCoinId(body: unknown, symbol: string): string | null {
  const r = searchSchema.safeParse(body);
  if (!r.success) return null;
  const exact = r.data.coins.filter((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  exact.sort((a, b) => (a.market_cap_rank ?? Number.MAX_SAFE_INTEGER) - (b.market_cap_rank ?? Number.MAX_SAFE_INTEGER));
  return exact[0]?.id ?? null;
}

const roDate = (iso: string) => {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(t) : iso;
};

async function getJson(url: string, what: string): Promise<unknown> {
  const r = await httpRequest(url, { headers: { Accept: 'application/json' }, timeoutMs: 20_000 });
  if (r.status === 429) throw new Error(`${what}: prea multe cereri acum`);
  if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status}`);
  try {
    return JSON.parse(r.body) as unknown;
  } catch {
    throw new Error(`${what}: răspuns neașteptat`);
  }
}

const TRANSLATE_SYSTEM = [
  'You translate descriptions of companies, stock indices and crypto-assets into Romanian, for a trading app.',
  'Keep every name, ticker, product, number and date as it is; use the usual Romanian financial terms.',
  'Return only the translation, as plain text, with the same paragraphs.',
].join(' ');

export class SymbolProfiles {
  private readonly db: Db;
  private readonly ai: AiService;
  private readonly log: Logger;
  private readonly nasdaq: Pick<NasdaqClient, 'companyProfile'>;
  private readonly now: () => number;

  constructor(db: Db, ai: AiService, log: Logger, nasdaq: Pick<NasdaqClient, 'companyProfile'>, now: () => number = Date.now) {
    this.db = db;
    this.ai = ai;
    this.log = log;
    this.nasdaq = nasdaq;
    this.now = now;
  }

  private async cached(kind: string, symbol: string, ttl: number): Promise<SymbolProfile | null> {
    const row = await this.db.get<{ value: string; fetched_at: number }>('SELECT value, fetched_at FROM market_cache WHERE [key] = ?', [profileKey(kind, symbol)]);
    if (!row || this.now() - row.fetched_at > ttl) return null;
    try {
      return JSON.parse(row.value) as SymbolProfile;
    } catch {
      return null;
    }
  }

  private async put(key: string, value: unknown): Promise<void> {
    await this.db.run(
      'UPDATE market_cache SET value = @v, fetched_at = @t WHERE [key] = @k; IF @@ROWCOUNT = 0 INSERT INTO market_cache([key], value, fetched_at) VALUES (@k, @v, @t)',
      { k: key, v: JSON.stringify(value), t: this.now() },
    );
  }

  /** The Romanian translation of a text made already, or null. */
  async translation(text: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM market_cache WHERE [key] = ?', [translationKey(text)]);
    if (!row) return null;
    try {
      const v = JSON.parse(row.value) as { text?: unknown };
      return typeof v.text === 'string' ? v.text : null;
    } catch {
      return null;
    }
  }

  /** What the popup shows of a symbol (FD-WATCHLISTS §3). `kind` is the list's; a stock may turn out a fund. */
  async profile(kind: 'crypto' | 'stock' | 'index', symbol: string, name: string | null = null): Promise<SymbolProfile> {
    if (kind === 'index') return this.indexProfile(symbol);
    const ttl = kind === 'stock' ? STOCK_TTL_MS : CRYPTO_TTL_MS;
    const hit = await this.cached(kind, symbol, ttl);
    const p = hit ?? (kind === 'stock' ? await this.stockProfile(symbol, name) : await this.cryptoProfile(symbol, name));
    if (!hit && p.problems.length === 0) await this.put(profileKey(kind, symbol), p).catch((err: Error) => this.log.warn(`profile ${symbol}: not kept (${err.message})`));
    // The translation may have come after the profile was kept.
    return { ...p, translated: p.description?.lang === 'en' ? await this.translation(p.description.text) : null };
  }

  private indexProfile(symbol: string): SymbolProfile {
    const info = indexById(symbol);
    return {
      kind: 'index',
      symbol,
      name: info?.name ?? plainSymbol(symbol),
      description: info ? { text: info.description, source: 'Sentiq', lang: 'ro' } : null,
      translated: null,
      facts: [],
      quarters: [],
      next: null,
      problems: [],
      fetchedAt: this.now(),
    };
  }

  private async stockProfile(symbol: string, name: string | null): Promise<SymbolProfile> {
    const problems: SymbolProfile['problems'] = [];
    const [company, tv] = await Promise.all([
      this.nasdaq.companyProfile(symbol).catch((err: Error) => {
        problems.push({ part: 'description', message: err.message });
        return null;
      }),
      isTvSymbol(symbol)
        ? tvScan([symbol], TV_PROFILE_COLUMNS)
            .then((body) => parseTvFundamentals(body, symbol))
            .catch((err: Error) => {
              problems.push({ part: 'results', message: err.message });
              return null;
            })
        : Promise.resolve(null),
    ]);
    const fund = tv?.type === 'fund';
    const facts: SymbolProfile['facts'] = [];
    const sector = company?.sector ?? tv?.sector ?? null;
    const industry = company?.industry ?? tv?.industry ?? null;
    if (sector) facts.push({ label: 'Sector', value: sector });
    if (industry) facts.push({ label: 'Industrie', value: industry });
    return {
      kind: fund ? 'fund' : 'stock',
      symbol,
      name: company?.name ?? name,
      description: company?.description ? { text: company.description, source: 'Nasdaq', lang: 'en' } : null,
      translated: null,
      facts,
      quarters: fund ? [] : (tv?.quarters ?? []),
      next: fund ? null : (tv?.next ?? null),
      problems,
      fetchedAt: this.now(),
    };
  }

  private async cryptoProfile(symbol: string, name: string | null): Promise<SymbolProfile> {
    const base: SymbolProfile = { kind: 'crypto', symbol, name, description: null, translated: null, facts: [], quarters: [], next: null, problems: [], fetchedAt: this.now() };
    try {
      const id = pickCoinId(await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`, 'CoinGecko'), symbol);
      if (!id) return base;
      const raw = coinSchema.safeParse(
        await getJson(
          `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
          'CoinGecko',
        ),
      );
      if (!raw.success) throw new Error('CoinGecko: răspuns neașteptat');
      const c = raw.data;
      const text = c.description?.en ? plainDescription(c.description.en) : '';
      const categories = (c.categories ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5);
      const home = (c.links?.homepage ?? []).find((h): h is string => typeof h === 'string' && /^https?:\/\//.test(h));
      const facts: SymbolProfile['facts'] = [];
      if (categories.length) facts.push({ label: 'Categorii', value: categories.join(', ') });
      if (c.genesis_date) facts.push({ label: 'Lansare', value: roDate(c.genesis_date) });
      if (home) facts.push({ label: 'Site', value: home.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: home });
      return { ...base, name: c.name ?? name, description: text ? { text, source: 'CoinGecko', lang: 'en' } : null, facts };
    } catch (err) {
      return { ...base, problems: [{ part: 'description', message: (err as Error).message }] };
    }
  }

  /**
   * The description in Romanian, with the user's own AI (FD-WATCHLISTS §3), kept for everyone once made. Throws a
   * `ValidationError` without a key, and the provider's error (in Romanian) when it refuses.
   */
  async translate(userId: number, text: string): Promise<string> {
    const known = await this.translation(text);
    if (known) return known;
    const c = await this.ai.config(userId);
    if (!c.key) throw new ValidationError('Fără o cheie AI, descrierea rămâne în engleză');
    const answer = await this.ai.client(c.provider, c.key, c.model).generate({
      system: TRANSLATE_SYSTEM,
      prompt: text,
      schema: z.object({ text: z.string() }),
      name: 'translation',
      maxTokens: 3000,
      effort: 'low',
      timeoutMs: 60_000,
    });
    if (answer.usage) void this.ai.usage.record(userId, 'translate', { items: 1, input: answer.usage.input, output: answer.usage.output, model: c.model });
    const out = answer.parsed?.text.trim();
    if (!out) throw new Error(`${AI_PROVIDER_INFO[c.provider].product} nu a dat o traducere`);
    await this.put(translationKey(text), { text: out }).catch((err: Error) => this.log.warn(`translation not kept (${err.message})`));
    return out;
  }
}

