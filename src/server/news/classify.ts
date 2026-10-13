// Relevance, impact and flags of a news item (docs/technical-design.md §5.4). Pure functions.
import type { SourceCategory } from './sources.ts';

export type NewsFlag = 'sponsored' | 'speculative' | 'recap' | 'lowRelevance';

const SPONSORED = /\b(sponsored|press release|partner content|paid (post|content)|advertorial)\b|\[PR\]|\(PR\)/i;
const SPECULATIVE =
  /\b(price prediction|price forecast|predictions?:|could (soar|surge|crash|explode|hit|reach|rally|drop)|might (soar|surge|crash|hit|reach)|is it time to buy|will .{1,40} (hit|reach|soar)|to the moon|100x|1000x)\b|\?\s*$/i;
const RECAP = /\b(weekly recap|week in review|this week in|daily digest|morning brief|evening brief|newsletter|roundup|what happened in crypto today)\b/i;

const MARKET_TERMS =
  /\b(stocks?|equit(y|ies)|s&p|nasdaq|dow|wall street|fed|federal reserve|fomc|powell|rates?|rate (cut|hike)|inflation|cpi|pce|ppi|yields?|treasur(y|ies)|bonds?|dollar|dxy|earnings|recession|gdp|jobs|payrolls|unemployment|tariffs?|oil|crude|markets?|crypto|bitcoin|etf|sec|ecb|boj|central bank|stimulus|debt|deficit|shutdown)\b/i;

const GEO_MARKET_TERMS =
  /\b(war|missiles?|strikes?|airstrikes?|sanctions?|tariffs?|trade (war|deal|talks)|oil|opec|ceasefire|invasion|invades?|nuclear|attacks?|blockade|elections?|coup|default|embargo|troops|military|conflict|escalat\w*|truce|hostilities|drone|shipping lanes?|strait of hormuz|red sea|semiconductor|export (ban|controls?)|central bank|inflation|recession|markets?|stocks?|crypto|bitcoin)\b/i;

const IMPACT_3 =
  /\b(fed|federal reserve|fomc|powell|rate (decision|cut|hike)s?|cuts? rates|hikes? rates|interest rates?|cpi|inflation|payrolls|jobs report|nonfarm|recession|war|tariffs?|hack(ed|s)?|exploit(ed)?|liquidat\w*|bankrupt\w*|insolven\w*|crash(es|ed)?|default(s|ed)?|emergency|sanctions?)\b/i;
const IMPACT_3_SEC_ETF = /\b(sec|cftc)\b[\s\S]*\betfs?\b|\betfs?\b[\s\S]*\b(sec|approv\w*|reject\w*|denied|deny)\b/i;
const IMPACT_2 =
  /\b(etfs?|regulat\w*|yields?|treasur(y|ies)|dollar|dxy|stablecoins?|sec|cftc|gdp|ppi|pce|unemployment|jobless|earnings|nvidia|apple|microsoft|tesla|blackrock|microstrategy|strategy inc|coinbase|binance|tether|circle|ecb|boj|pboc|opec|oil)\b/i;

/** Relevance of a geopolitical item linked to markets (FD-IMPACT §2; 0.6 before 13 Oct 2026). */
export const GEO_RELEVANCE = 0.8;

export const TOP10 = new Set(['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'ADA', 'TRX', 'LINK', 'AVAX', 'TON', 'SUI', 'HYPE']);
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'PYUSD', 'USDS', 'USD1']);

export interface Classification {
  relevance: number;
  impact: number;
  flags: NewsFlag[];
}

export function classify(category: SourceCategory, title: string, summary: string, coins: string[]): Classification {
  const text = `${title} ${summary}`;
  const flags: NewsFlag[] = [];
  if (SPONSORED.test(text)) flags.push('sponsored');
  if (SPECULATIVE.test(title)) flags.push('speculative');
  if (RECAP.test(title)) flags.push('recap');

  let relevance: number;
  if (category === 'crypto') relevance = 1;
  // Stock feeds also carry commodity pieces ("Corn gets a dead cat bounce"): full weight for a tagged share or the market.
  else if (category === 'stocks') relevance = coins.length > 0 || MARKET_TERMS.test(text) ? 1 : 0.8;
  else if (category === 'macro') relevance = MARKET_TERMS.test(text) ? 1 : 0.8;
  // Geopolitics moves markets more than it used to (tariffs, sanctions, wars, statements: FD-IMPACT §2).
  else relevance = GEO_MARKET_TERMS.test(text) ? GEO_RELEVANCE : 0;
  if (relevance === 0) flags.push('lowRelevance');

  const majorCoins = coins.filter((c) => !STABLES.has(c));
  let impact = 1;
  if (IMPACT_3.test(text) || IMPACT_3_SEC_ETF.test(text)) impact = 3;
  else if (IMPACT_2.test(text) || majorCoins.includes('BTC') || majorCoins.includes('ETH')) impact = 2;
  else if (majorCoins.some((c) => TOP10.has(c))) impact = 1.5;

  return { relevance, impact, flags };
}
