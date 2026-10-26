// US stock indices a user can add to the favourites (FD-INDICES, TD-INDICES §1). Shared by the server (validation,
// news aliases, data sources) and the web (search, labels). An index is kept under its id with "^" in front ("^SPX"),
// so it never collides with a coin or a share of the same ticker (SPX6900, Compound, Compass).
import type { Timeframe } from './time.ts';

export interface IndexInfo {
  /** The id stored in the favourites: "^SPX". */
  id: string;
  /** What the user sees: "SPX". */
  symbol: string;
  name: string;
  /** Default aliases for the news (FD-INDICES §1): proper nouns, matched as company names are. */
  aliases: string[];
  /** What the index is, in Romanian (FD-WATCHLISTS §3: the "Date financiare" popup). */
  description: string;
}

export const INDICES: readonly IndexInfo[] = [
  {
    id: '^SPX',
    symbol: 'SPX',
    name: 'S&P 500',
    aliases: ['S&P 500', 'S&P500', 'SPX'],
    description:
      'Indicele celor aproximativ 500 de companii mari listate în SUA, ponderat după capitalizarea liberă la tranzacționare (S&P Dow Jones Indices). E reperul obișnuit pentru „piața americană de acțiuni”: acoperă cam 80% din valoarea ei.',
  },
  {
    id: '^NDX',
    symbol: 'NDX',
    name: 'Nasdaq-100',
    aliases: ['Nasdaq-100', 'Nasdaq 100', 'NDX'],
    description:
      'Cele mai mari 100 de companii nefinanciare listate la Nasdaq, ponderate după capitalizare (cu limite pe ponderea fiecăreia). E dominat de tehnologie, comunicații și comerț online; ETF-ul QQQ îl urmărește.',
  },
  // Not "COMP": that is also Compound's ticker.
  {
    id: '^COMP',
    symbol: 'COMP',
    name: 'Nasdaq Composite',
    aliases: ['Nasdaq Composite'],
    description: 'Toate acțiunile obișnuite listate la bursa Nasdaq (peste 3.000), ponderate după capitalizare. Mai larg decât Nasdaq-100, are și companii mici și financiare, dar tot tehnologia îl mișcă cel mai mult.',
  },
  // Not "Dow" alone: that is also Dow Inc.
  {
    id: '^DJI',
    symbol: 'DJI',
    name: 'Dow Jones Industrial Average',
    aliases: ['Dow Jones', 'DJIA'],
    description:
      'Cel mai vechi indice bursier american: 30 de companii mari, alese de S&P Dow Jones Indices. E ponderat după preț (o acțiune scumpă cântărește mai mult), nu după capitalizare, deci se poate mișca altfel decât S&P 500.',
  },
  {
    id: '^RUT',
    symbol: 'RUT',
    name: 'Russell 2000',
    aliases: ['Russell 2000'],
    description: 'Cele aproximativ 2.000 de companii mici din indicele Russell 3000 (FTSE Russell). E reperul pentru companiile mici din SUA, mai sensibile la dobânzi și la economia internă decât giganții din S&P 500.',
  },
  {
    id: '^VIX',
    symbol: 'VIX',
    name: 'VIX (volatilitatea S&P 500)',
    aliases: ['VIX', 'volatility index'],
    description:
      'Volatilitatea așteptată a S&P 500 pentru următoarele 30 de zile, calculată de Cboe din prețurile opțiunilor. Numit și „indicele fricii”: crește de obicei când acțiunile scad brusc; în jur de 12–20 e liniște, peste 30 e teamă.',
  },
  {
    id: '^SOX',
    symbol: 'SOX',
    name: 'PHLX Semiconductor',
    aliases: ['Philadelphia Semiconductor', 'PHLX Semiconductor'],
    description: 'Cele 30 de companii mari de semiconductori listate în SUA, ponderate după capitalizare, cu limite. E reperul pentru ciclul cipurilor, de la proiectare la echipamentele de fabricație.',
  },
];

/** Indices: intraday from CNBC (FD-INDEXINTRA; 3m, 15m, 2h and 4h merged), daily and weekly; no 6h / 8h / 12h (a session is 6½ h). */
export const INDEX_TIMEFRAMES: readonly Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];

/** Shown on an index's price when it is not a real-time one (the fallback, or CNBC not marking it real-time; FD-INDEXINTRA). */
export const INDEX_DELAY_NOTE = 'Cotația indicelui poate avea până la 15 minute întârziere.';

/** A share's ticker or an index id: what the routes for listed symbols accept (the index is then looked up). */
export const LISTED_SYMBOL_RE = /^(?:\^[A-Z]{2,6}|[A-Z][A-Z0-9.-]{0,9})$/;

const BY_ID = new Map(INDICES.map((i) => [i.id, i]));

export const isIndexId = (s: string): boolean => s.startsWith('^');

export const indexById = (id: string): IndexInfo | undefined => BY_ID.get(id);

/** "spx", "SPX" or "^SPX" → "^SPX" when it is one of ours, else null. */
export function indexId(s: string): string | null {
  const up = s.trim().toUpperCase();
  const id = up.startsWith('^') ? up : `^${up}`;
  return BY_ID.has(id) ? id : null;
}

/** The symbol as the user sees it: an index without its "^". */
export const plainSymbol = (coin: string): string => (coin.startsWith('^') ? coin.slice(1) : coin);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const compact = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');

/** The indices whose symbol, name or aliases contain the term ("s&p", "sp500", "dow"); all of them for an empty one. */
export function searchIndices(term: string): IndexInfo[] {
  const f = fold(term.trim());
  const c = compact(term);
  if (!f) return [...INDICES];
  return INDICES.filter((i) => [i.symbol, i.name, ...i.aliases].some((x) => fold(x).includes(f) || (c.length > 0 && compact(x).includes(c))));
}
