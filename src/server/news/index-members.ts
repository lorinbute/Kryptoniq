// The companies of the indices a user can filter the stock news by (FD-INDEXNEWS, TD-INDEXNEWS §2–§3): the lists, read
// from public sources (Nasdaq for the Nasdaq-100 and the US-listed stocks, Wikipedia for the S&P 500 and the Dow), checked,
// kept in the job data, and the snapshot shipped with the app when no read has succeeded yet.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Db } from '../db/database.ts';
import { readJobData, writeJobData } from '../jobs/scheduler.ts';
import { cleanCompanyName, defaultStockAliases } from '../market/stocks.ts';
import { fetchText } from '../net/http.ts';
import { FILTER_INDEX_IDS, type FilterIndexId } from '../../shared/stock-indices.ts';

export interface IndexMember {
  symbol: string;
  name: string;
  /** Names matched in the news (proper nouns; empty when the name is an ordinary word: then the ticker only). */
  aliases: string[];
}

export interface IndexMembers {
  /** When the lists were read (ms); the snapshot's own date when none was read here. */
  asOf: number;
  members: Record<FilterIndexId, IndexMember[]>;
  /** Every US-listed stock (Nasdaq's screener): recognised in the news only when named explicitly ("$XYZ", "NYSE: XYZ"). */
  listed: string[];
}

export const MEMBERS_JOB = 'index.members';
/** The job that tags the stored news again; its data keeps the member signature they were tagged with (TD-INDEXNEWS §3). */
export const RETAG_JOB = 'news.retag-members';
/** Lists older than this are read again. */
export const MEMBERS_MAX_AGE_MS = 7 * 86_400_000;

const SYMBOL_RE = /^[A-Z][A-Z0-9]{0,6}(?:\.[A-Z])?$/;
/** How many members a list may have to be believed (a page that changed shape gives far fewer). */
export const MEMBER_COUNTS: Record<FilterIndexId, [number, number]> = { SPX: [490, 515], NDX: [95, 110], DJI: [30, 30] };
const MIN_LISTED = 5000;

// ---------------------------------------------------------------- parsers

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A ticker as the news write it: "BRK/B", "BRK-B" → "BRK.B"; anything else that does not look like a share → null. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[/-]/, '.');
  return SYMBOL_RE.test(s) ? s : null;
}

/** Nasdaq's "list-type/nasdaq100" answer → the members (names as Nasdaq gives them). */
export function parseNasdaq100(json: unknown): { symbol: string; name: string }[] {
  const rows = obj(obj(obj(json).data).data).rows;
  if (!Array.isArray(rows)) return [];
  const out: { symbol: string; name: string }[] = [];
  for (const r of rows) {
    const symbol = normalizeSymbol(str(obj(r).symbol));
    const name = str(obj(r).companyName);
    if (symbol && name) out.push({ symbol, name });
  }
  return out;
}

/** Nasdaq's stock screener (download=true) → every listed share's ticker (not warrants, units, rights or preferreds). */
export function parseScreener(json: unknown): string[] {
  const rows = obj(obj(json).data).rows;
  if (!Array.isArray(rows)) return [];
  const out = new Set<string>();
  for (const r of rows) {
    const raw = str(obj(r).symbol);
    if (/[\^~ ]/.test(raw)) continue;
    const s = normalizeSymbol(raw);
    if (s) out.add(s);
  }
  return [...out].sort();
}

const SYMBOL_TEMPLATE = /\{\{\s*(?:nyse\s*symbol|nasdaq\s*symbol|nyse\s*link|nasdaq\s*link|nyse|nasdaq|nyseamerican|cboe)\s*\|\s*([A-Za-z0-9.\-/]+)\s*\}\}/i;
const EXCHANGE_LINK = /^(?:new york stock exchange|nyse|nasdaq|nasdaq stock market)$/i;

/** The text of a table cell: links as shown, templates and tags out, "(Class A)" kept out of the name. */
function cellText(cell: string): string {
  return cell
    .replace(/^[!|]+\s*(?:scope="[^"]*"\s*\|)?/, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\((?:class [a-c])\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A Wikipedia "constituents" table (S&P 500, Dow) → its members. The ticker is the cell with the exchange template; the
 * name is the cell after it when the ticker comes first (S&P 500), else the row's first cell (the Dow: company first).
 */
export function parseWikiConstituents(wikitext: string): { symbol: string; name: string }[] {
  const start = wikitext.search(/id="constituents"/);
  if (start < 0) return [];
  const rest = wikitext.slice(start);
  const end = rest.indexOf('\n|}');
  const table = (end > 0 ? rest.slice(0, end) : rest).replace(/<!--[\s\S]*?-->/g, '');
  const out: { symbol: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const row of table.split(/\n\|-/).slice(1)) {
    // Cells: one per line ("|| x", "| x", "! x"), or several on one line ("x || y").
    const cells = row
      .split('\n')
      .filter((l) => /^[!|]/.test(l))
      .flatMap((l) => l.split(/\s(?:\|\||!!)\s/))
      .map((c) => c.trim())
      .filter((c) => c !== '');
    const at = cells.findIndex((c) => SYMBOL_TEMPLATE.test(c));
    if (at < 0) continue;
    const symbol = normalizeSymbol((SYMBOL_TEMPLATE.exec(cells[at] as string) as RegExpExecArray)[1] as string);
    const name = cellText((at === 0 ? cells[1] : cells[0]) ?? '');
    if (!symbol || !name || seen.has(symbol) || EXCHANGE_LINK.test(name)) continue;
    seen.add(symbol);
    out.push({ symbol, name });
  }
  return out;
}

// ---------------------------------------------------------------- aliases

/**
 * The names people use for the largest companies, where the legal one says little ("Alphabet" is also "Google") or the
 * automatic one would be wrong ("Dow" is the index, so Dow Inc. is only "Dow Inc.").
 */
export const CURATED_ALIASES: Record<string, string[]> = {
  GOOGL: ['Alphabet', 'Google'],
  GOOG: ['Alphabet', 'Google'],
  META: ['Meta Platforms', 'Meta', 'Facebook'],
  AMZN: ['Amazon'],
  AAPL: ['Apple'],
  MSFT: ['Microsoft'],
  NVDA: ['Nvidia', 'NVIDIA'],
  TSLA: ['Tesla'],
  JPM: ['JPMorgan', 'JPMorgan Chase', 'JP Morgan'],
  XOM: ['Exxon', 'ExxonMobil', 'Exxon Mobil'],
  DIS: ['Disney', 'Walt Disney'],
  PG: ['Procter & Gamble', 'P&G'],
  JNJ: ['Johnson & Johnson', 'J&J'],
  'BRK.B': ['Berkshire Hathaway', 'Berkshire'],
  UNH: ['UnitedHealth'],
  AMD: ['Advanced Micro Devices', 'AMD'],
  IBM: ['IBM'],
  KO: ['Coca-Cola'],
  MCD: ["McDonald's"],
  HD: ['Home Depot'],
  GS: ['Goldman Sachs', 'Goldman'],
  MS: ['Morgan Stanley'],
  BAC: ['Bank of America', 'BofA'],
  WFC: ['Wells Fargo'],
  C: ['Citigroup', 'Citi'],
  V: ['Visa Inc.'],
  MA: ['Mastercard'],
  WMT: ['Walmart'],
  COST: ['Costco'],
  NFLX: ['Netflix'],
  ORCL: ['Oracle'],
  CRM: ['Salesforce'],
  AVGO: ['Broadcom'],
  INTC: ['Intel'],
  CSCO: ['Cisco'],
  QCOM: ['Qualcomm'],
  TXN: ['Texas Instruments'],
  ADBE: ['Adobe'],
  PEP: ['PepsiCo', 'Pepsi'],
  PFE: ['Pfizer'],
  MRK: ['Merck'],
  ABBV: ['AbbVie'],
  LLY: ['Eli Lilly', 'Lilly'],
  CVX: ['Chevron'],
  BA: ['Boeing'],
  CAT: ['Caterpillar'],
  GE: ['GE Aerospace', 'General Electric'],
  GM: ['General Motors'],
  F: ['Ford', 'Ford Motor'],
  T: ['AT&T'],
  VZ: ['Verizon'],
  CMCSA: ['Comcast'],
  NKE: ['Nike'],
  SBUX: ['Starbucks'],
  UPS: ['UPS', 'United Parcel Service'],
  FDX: ['FedEx'],
  DOW: ['Dow Inc.'],
  MMM: ['3M'],
  HON: ['Honeywell'],
  AXP: ['American Express', 'Amex'],
  PYPL: ['PayPal'],
  UBER: ['Uber'],
  ABNB: ['Airbnb'],
  BKNG: ['Booking Holdings'],
  PLTR: ['Palantir'],
  TGT: ['Target Corporation'],
  DAL: ['Delta Air Lines'],
  UAL: ['United Airlines'],
  LUV: ['Southwest Airlines'],
  // Ordinary words, places or other firms on their own: the longer name only.
  USB: ['U.S. Bancorp', 'US Bancorp'],
  NDAQ: ['Nasdaq Inc.', 'Nasdaq, Inc.'],
  EIX: ['Edison International'],
  EG: ['Everest Group'],
  RF: ['Regions Financial'],
  WAT: ['Waters Corporation'],
  HIG: ['Hartford Financial', 'The Hartford'],
  J: ['Jacobs Solutions'],
  ROL: ['Rollins Inc.'],
  LII: ['Lennox International'],
  MCHP: ['Microchip Technology'],
  MSI: ['Motorola Solutions'],
  EQT: ['EQT Corporation', 'EQT Corp'],
  PTC: ['PTC Inc.'],
  ODFL: ['Old Dominion Freight Line'],
  IVZ: ['Invesco Ltd'],
  // Names Nasdaq writes with share classes, or that people shorten.
  ARM: ['Arm Holdings'],
  MSTR: ['MicroStrategy', 'Strategy Inc'],
  SPCX: ['SpaceX'],
  TMUS: ['T-Mobile', 'T-Mobile US'],
  TMO: ['Thermo Fisher', 'Thermo Fisher Scientific'],
  BMY: ['Bristol Myers Squibb', 'Bristol-Myers Squibb', 'Bristol Myers'],
  EL: ['Estée Lauder', 'Estee Lauder'],
  CMG: ['Chipotle', 'Chipotle Mexican Grill'],
  PM: ['Philip Morris', 'Philip Morris International'],
  SCHW: ['Charles Schwab', 'Schwab'],
  LULU: ['Lululemon'],
  RCL: ['Royal Caribbean'],
  LYV: ['Live Nation'],
  MU: ['Micron', 'Micron Technology'],
  ON: ['Onsemi', 'ON Semiconductor'],
  NXPI: ['NXP', 'NXP Semiconductors'],
  ANET: ['Arista Networks', 'Arista'],
  GWW: ['W. W. Grainger', 'Grainger'],
  OXY: ['Occidental', 'Occidental Petroleum'],
  WDAY: ['Workday'],
  SHOP: ['Shopify'],
  ASML: ['ASML'],
  TRI: ['Thomson Reuters'],
  BIIB: ['Biogen'],
  INTU: ['Intuit'],
  CPRT: ['Copart'],
  CTSH: ['Cognizant'],
  AIZ: ['Assurant'],
  MOS: ['Mosaic Company'],
  DE: ['Deere', 'John Deere', 'Deere & Company'],
  KKR: ['KKR'],
  MKC: ['McCormick'],
  AJG: ['Arthur J. Gallagher', 'Gallagher'],
  'BF.B': ['Brown-Forman', 'Brown–Forman'],
};

/** Single words that are ordinary English yet, as written in business news, are the company (TD-INDEXNEWS §2). */
export const SAFE_BRAND_WORDS = new Set(['apple', 'amazon', 'oracle', 'alphabet', 'meta', 'google', 'ford', 'intel', 'citi', 'lilly', 'goldman', 'berkshire']);

/**
 * A member's news names. `isWord` says whether a single word is an ordinary one (the dictionary, where there is one);
 * without it (a member new since the snapshot, on the server) only names of two words or more are kept.
 */
export function memberAliases(symbol: string, name: string, isWord?: (w: string) => boolean): string[] {
  const curated = CURATED_ALIASES[symbol];
  if (curated) return curated;
  const out: string[] = [];
  const keep = (a: string) => {
    const single = !/\s/.test(a);
    if (single) {
      const lower = a.toLowerCase();
      if (!SAFE_BRAND_WORDS.has(lower) && (!isWord || isWord(lower))) return false;
    }
    return true;
  };
  // "Deere & Co." loses "Co." to the cleaning: no "&" left hanging, no "(The)".
  const tidy = (a: string) => a.replace(/\s*\((?:the)\)\s*/gi, ' ').replace(/[\s,&]+$/, '').trim();
  for (const a of defaultStockAliases(tidy(name)).map(tidy)) if (a.length >= 2 && keep(a) && !out.includes(a)) out.push(a);
  // An ordinary-word name is still found through its full legal name ("Southern Company", "Target Corporation").
  if (out.length === 0) {
    const full = name.replace(/\s+/g, ' ').trim().replace(/^the\s+/i, '');
    if (/\s/.test(full) && full !== cleanCompanyName(full)) out.push(full.replace(/[,.]$/, ''));
  }
  return out;
}

// ---------------------------------------------------------------- the lists

/** The member lists as one value: tagging is redone when it changes. */
export function membersSignature(m: IndexMembers): string {
  const h = createHash('sha256');
  for (const id of FILTER_INDEX_IDS) for (const x of m.members[id]) h.update(`${id}:${x.symbol}:${x.aliases.join('|')};`);
  h.update(`listed:${m.listed.length}:${m.listed.slice(0, 50).join(',')}`);
  return h.digest('hex').slice(0, 16);
}

/** Whether a list read now can be believed. */
export function plausible(id: FilterIndexId, list: readonly { symbol: string }[]): boolean {
  const [lo, hi] = MEMBER_COUNTS[id];
  return list.length >= lo && list.length <= hi && new Set(list.map((x) => x.symbol)).size === list.length;
}

let snapshot: IndexMembers | null = null;
/** The lists shipped with the app (generated by scripts/index-members.ts). */
export function snapshotMembers(): IndexMembers {
  snapshot ??= JSON.parse(readFileSync(new URL('./index-members.snapshot.json', import.meta.url), 'utf8')) as IndexMembers;
  return snapshot;
}

const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  Accept: 'application/json',
};
const wiki = (page: string) => `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;

export interface MemberSources {
  nasdaq100(): Promise<unknown>;
  screener(): Promise<unknown>;
  wikitext(page: string): Promise<string>;
}

export const httpSources: MemberSources = {
  async nasdaq100() {
    return JSON.parse((await fetchText('https://api.nasdaq.com/api/quote/list-type/nasdaq100', { headers: NASDAQ_HEADERS })).body);
  },
  async screener() {
    return JSON.parse((await fetchText('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', { headers: NASDAQ_HEADERS, timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024 })).body);
  },
  async wikitext(page: string) {
    const j = JSON.parse((await fetchText(wiki(page), { headers: { 'Api-User-Agent': 'Sentiq (https://sentiq.money)' } })).body) as { parse?: { wikitext?: string } };
    return j.parse?.wikitext ?? '';
  },
};

export const WIKI_PAGES: Record<'SPX' | 'DJI', string> = { SPX: 'List of S&P 500 companies', DJI: 'List of Dow Jones Industrial Average companies' };

/** The member lists of the Sentiq server: the last good read, else the snapshot; read again once a week. */
export class IndexMembersService {
  private readonly db: Db;
  private readonly sources: MemberSources;
  private current: IndexMembers | null = null;
  /** The last read's problems, for the system status (a source that failed keeps its previous list). */
  lastErrors: string[] = [];

  constructor(db: Db, sources: MemberSources = httpSources) {
    this.db = db;
    this.sources = sources;
  }

  async get(): Promise<IndexMembers> {
    if (this.current) return this.current;
    const stored = await readJobData<IndexMembers | null>(this.db, MEMBERS_JOB, null);
    this.current = stored && stored.members && Array.isArray(stored.listed) ? stored : snapshotMembers();
    return this.current;
  }

  /** Reads the sources again when the lists are older than a week (or `force`); true when something changed. */
  async refresh(now = Date.now(), force = false): Promise<boolean> {
    const was = await this.get();
    if (!force && now - was.asOf < MEMBERS_MAX_AGE_MS) return false;
    const errors: string[] = [];
    const known = new Map<string, IndexMember>();
    for (const id of FILTER_INDEX_IDS) for (const m of was.members[id]) known.set(m.symbol, m);
    const withAliases = (list: { symbol: string; name: string }[]): IndexMember[] =>
      list.map((x) => known.get(x.symbol) ?? { symbol: x.symbol, name: x.name, aliases: memberAliases(x.symbol, x.name) });
    const next: IndexMembers = { asOf: now, members: { ...was.members }, listed: was.listed };
    const read = async (id: FilterIndexId, get: () => Promise<{ symbol: string; name: string }[]>) => {
      try {
        const list = await get();
        if (plausible(id, list)) next.members[id] = withAliases(list);
        else errors.push(`${id}: ${list.length} companii, lista ignorată`);
      } catch (err) {
        errors.push(`${id}: ${(err as Error).message}`);
      }
    };
    await read('NDX', async () => parseNasdaq100(await this.sources.nasdaq100()));
    await read('SPX', async () => parseWikiConstituents(await this.sources.wikitext(WIKI_PAGES.SPX)));
    await read('DJI', async () => parseWikiConstituents(await this.sources.wikitext(WIKI_PAGES.DJI)));
    try {
      const listed = parseScreener(await this.sources.screener());
      if (listed.length > MIN_LISTED) next.listed = listed;
      else errors.push(`acțiuni listate: ${listed.length}, lista ignorată`);
    } catch (err) {
      errors.push(`acțiuni listate: ${(err as Error).message}`);
    }
    this.lastErrors = errors;
    // Nothing read: the date stays, so the next run tries again.
    if (errors.length === FILTER_INDEX_IDS.length + 1) return false;
    const changed = membersSignature(next) !== membersSignature(was);
    await writeJobData(this.db, MEMBERS_JOB, next);
    this.current = next;
    return changed;
  }
}
