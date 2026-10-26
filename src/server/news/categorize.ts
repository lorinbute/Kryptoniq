// FD-MULTICAT: the category of a news item from a source covering several, by what the item is about. FD-MACRORULES: an
// item is macro only by the user's rules (macro.ts); one that would be macro without them goes to its subject, else to
// "other".
import { macroVerdict, type MacroVerdict } from './macro.ts';
import type { SourceCategory } from './sources.ts';

/** A news item's category: a source's, or "other" (FD-MACRORULES: about none of them, out of every score). */
export type NewsCategory = SourceCategory | 'other';

/** The fixed order of the categories: of a source's list, and of a tie. */
export const CATEGORY_ORDER: readonly SourceCategory[] = ['crypto', 'stocks', 'macro', 'geopolitics'];

/** Unique, known, in the fixed order. */
export function normalizeCategories(list: readonly string[]): SourceCategory[] {
  return CATEGORY_ORDER.filter((c) => list.includes(c));
}

/** The categories of a source: its list when it has several, else its one. */
export function sourceCategories(s: { category: SourceCategory; categories?: string | null }): SourceCategory[] {
  const list = s.categories ? normalizeCategories(s.categories.split(',')) : [];
  return list.length > 1 ? list : [s.category];
}

/** The columns of a source for these categories (at least one): the first, and the list when there are several. */
export function encodeCategories(list: readonly SourceCategory[]): { category: SourceCategory; categories: string | null } {
  const cats = normalizeCategories(list);
  const first = cats[0];
  if (!first) throw new Error('at least one category');
  return { category: first, categories: cats.length > 1 ? cats.join(',') : null };
}

/** The words of each category's subject (each distinct word counts once). */
const TERMS: Record<SourceCategory, RegExp> = {
  crypto:
    // Not "mining" / "miners" / "wallets": gold miners and digital wallets are not crypto (FD-MACRORULES, real news).
    /\b(crypto|cryptos|cryptocurrenc(?:y|ies)|bitcoin|ether|ethereum|blockchains?|stablecoins?|altcoins?|memecoins?|tokens?|tokenized|defi|nfts?|web3|on-?chain|halving|exchanges? hack\w*|airdrops?|staking)\b/gi,
  stocks:
    /\b(stocks?|shares?|equit(?:y|ies)|earnings|revenue|profit|guidance|eps|ipos?|s&p 500|s&p|nasdaq|dow jones|dow|wall street|analysts?|upgrades?|downgrades?|price target|dividends?|buybacks?|market cap|premarket|pre-market|after-hours|quarterly|q[1-4]|ceo|merger|acquisition|acquires?)\b/gi,
  // FD-MACRORULES: macro's signal is the rules' (`macroVerdict`), not a list of words here.
  macro: /(?!)/g,
  geopolitics:
    /\b(wars?|missiles?|strikes?|airstrikes?|sanctions?|military|troops|invasion|invades?|ceasefire|truce|nato|conflict|attacks?|nuclear|elections?|coup|diplomat\w*|summit|borders?|terror\w*|hostilities|embargo|blockade|geopolitic\w*|tariffs?|trade war)\b/gi,
};

/** FD-MACRORULES: the signs of a single company's story, for the subject of an item that is not macro. */
const COMPANY_STORY =
  /\b(inc|corp|corporation|ltd|plc|llc|holdings?|bancorp|bancshares|therapeutics|pharmaceuticals?|biosciences?|minerals|technologies|industries|raised to|cut to|upgraded|downgraded|upgrades?|downgrades?|reiterates?|initiates?|price target|overweight|underweight|outperform|underperform|private placement|financing|offering|contract|stake|spin-?off|shareholders?|stockholders?|appoints|tapped by|secures|unveils|partnership|partners with|clinical|fda|earnings preview|earnings call|launch(?:es|ed)?|expands|buys|sells|to sell|in talks|signs|named|unit|subsidiary|annual meeting)\b/gi;

/** Points for a coin or a company named: more than a word (it names the subject). */
const ENTITY = 2;

/** A company among the symbols (FD-MACRORULES): a share or an index member, not a coin and not an index. */
export const isCompany = (symbol: string, isCrypto: (symbol: string) => boolean) => !symbol.startsWith('^') && !isCrypto(symbol);

/**
 * How strongly a text speaks of each category: its distinct words, and the coins / companies it names; macro by the
 * rules (`macro`, else judged here with the companies among `coins`).
 */
export function categorySignals(title: string, summary: string, coins: readonly string[], isCrypto: (symbol: string) => boolean, macro?: MacroVerdict): Record<SourceCategory, number> {
  const text = `${title} ${summary.slice(0, 300)}`;
  const out = {} as Record<SourceCategory, number>;
  for (const c of CATEGORY_ORDER) out[c] = new Set([...text.matchAll(TERMS[c])].map((m) => m[0].toLowerCase())).size;
  out.macro = (macro ?? macroVerdict(title, summary, coins.some((s) => isCompany(s, isCrypto)) ? 1 : 0)).strength;
  // "#CO" / "#SPX": a company or an index member named; "^SPX": a watchlist index; another symbol not a coin: a stock.
  if (coins.some((s) => isCrypto(s))) out.crypto += ENTITY;
  if (coins.some((s) => s.startsWith('#') || s.startsWith('^') || !isCrypto(s))) out.stocks += ENTITY;
  return out;
}

/**
 * The category of an item from a source covering `allowed`: the one it speaks of most (ties: the fixed order); with no
 * sign of any, the source's first (`matched` false: the item is about none of them).
 */
export function categorize(
  title: string,
  summary: string,
  coins: readonly string[],
  allowed: readonly SourceCategory[],
  isCrypto: (symbol: string) => boolean,
  macro?: MacroVerdict,
): { category: SourceCategory; matched: boolean } {
  const cats = normalizeCategories(allowed);
  const first = cats[0] ?? 'macro';
  const signals = categorySignals(title, summary, coins, isCrypto, macro);
  let best: SourceCategory = first;
  let top = 0;
  for (const c of cats) {
    if (signals[c] > top) {
      best = c;
      top = signals[c];
    }
  }
  return { category: best, matched: top > 0 };
}

/**
 * FD-MACRORULES: the subject of an item that is not macro by the rules: the strongest of crypto, stocks and geopolitics
 * (ties: the fixed order), or null when it speaks of none.
 */
export function subjectOf(title: string, summary: string, coins: readonly string[], isCrypto: (symbol: string) => boolean): SourceCategory | null {
  const signals = categorySignals(title, summary, coins, isCrypto);
  // A company the detector does not know (a small or a foreign one) still reads as one: its legal form, an analyst's call,
  // a corporate act.
  signals.stocks += new Set([...title.matchAll(COMPANY_STORY)].map((m) => m[0].toLowerCase())).size;
  let best: SourceCategory | null = null;
  let top = 0;
  for (const c of CATEGORY_ORDER) {
    if (c === 'macro' || signals[c] <= top) continue;
    best = c;
    top = signals[c];
  }
  return best;
}
