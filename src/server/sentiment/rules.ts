// Domain rules for market sentiment of headlines (TD §6.2). Ordered: specific rules first; a match
// consumes its text span so a later, more generic rule cannot score the same words again.
// Scores are from the point of view of crypto and risk-asset prices.

export interface Rule {
  id: string;
  re: RegExp;
  score: number;
  /** The pattern already encodes a negation ("no hurry to cut"): never flip it. */
  noNegate?: boolean;
}

const r = (id: string, source: string, score: number, noNegate = false): Rule => ({ id, re: new RegExp(source, 'gi'), score, noNegate });

const UP = String.raw`(?:surg(?:e|es|ed|ing)|soar(?:s|ed|ing)?|rall(?:y|ies|ied|ying)|jump(?:s|ed)?|spik(?:e|es|ed)|rocket(?:s|ed)?|climb(?:s|ed)?|rebound(?:s|ed)?|recover(?:s|ed)?|break(?:s)? (?:above|out)|reclaim(?:s|ed)?|gain(?:s|ed)?|ris(?:e|es|ing)|rose|advanc(?:e|es|ed))`;
const DOWN = String.raw`(?:plung(?:e|es|ed)|plummet(?:s|ed)?|tumbl(?:e|es|ed)|crash(?:es|ed)?|slid(?:e|es)|slump(?:s|ed)?|sink(?:s)?|sank|dump(?:s|ed)?|drop(?:s|ped)?|fall(?:s|ing)?|fell|bleed(?:s|ing)?|tank(?:s|ed)?|break(?:s)? below|sell-?off|selloff|slip(?:s|ped)?|retreat(?:s|ed)?|sheds?|lose(?:s)?|lost|declin(?:e|es|ed)|stumbl(?:e|es|ed)|rout(?:s|ed)?|wobbl(?:e|es|ed))`;
const RISK = String.raw`(?:stocks?|equit(?:y|ies)|s&p(?: 500)?|nasdaq|dow(?: jones)?|wall street|markets?|shares|futures|risk assets|crypto(?:currenc(?:y|ies))?|bitcoin|btc|ether(?:eum)?|eth|altcoins?|solana|xrp|tokens?|coins?)`;
const COINS = String.raw`(?:btc|bitcoins?|eth|ether(?:eum)?|sol(?:ana)?|xrp|tokens?|coins?|crypto)`;
const VENUES = String.raw`(?:exchanges?|coinbase|binance|kraken|bitstamp|okx|bybit|bitfinex|gemini|kucoin)`;

export const RULES: Rule[] = [
  // ---- neutral / informational (score 0 dampens the model) ----
  r('educational', String.raw`^(?:what is|what are|how to|how do|why do|a beginner|explainer|guide to)\b|\bexplained\b|\bbeginner'?s guide\b`, 0),
  r('sentencing', String.raw`\b(?:sentenced|prison term|jailed|convicted)\b`, 0),
  r('fees-low', String.raw`\b(?:fees?|gas)\b[^.]{0,30}?\b(?:fall|falls|drop|drops|declin\w*|lows?)\b`, 0),
  r('jobless-down', String.raw`\bjobless claims\b[^.]{0,25}?\b(?:fall|falls|fell|drop|drops|declin\w*|eas\w*)\b`, 0.1),
  r('jobless-up', String.raw`\bjobless claims\b[^.]{0,25}?\b(?:rise|rises|rose|jump\w*|climb\w*|surg\w*)\b`, -0.3),
  r('flat', String.raw`\b(?:holds? steady|steady|flat|little changed|unchanged|range-?bound|consolidat\w*|sideways|treads? water|muted|mixed)\b`, 0),
  r('upgrade', String.raw`\b(?:upgrade|hard fork|mainnet|testnet)\b`, 0.1),

  // ---- monetary policy ----
  r('no-hurry-cut', String.raw`\bno (?:rush|hurry) to (?:cut|ease)\b|\bhigher for longer\b|\bhawkish\b|\bpushes? back on (?:rate )?cuts?\b`, -0.6, true),
  r('rates-hold', String.raw`\b(?:holds?|keeps?|leaves?|kept|left)\b[^.]{0,15}?\brates?\b[^.]{0,12}?\b(?:steady|unchanged|on hold)\b|\bpause[sd]?\b[^.]{0,20}?\brate`, 0),
  r('rate-cut', String.raw`\b(?:cuts?|cutting|lowers?|lowering|slash(?:es|ed)?|trims?)\b[^.]{0,15}?\b(?:interest )?rates?\b|\brate cuts?\b|\bdovish\b|\beasing cycle\b`, 0.8),
  r('rate-hike', String.raw`\b(?:raises?|raising|hikes?|hiking|lifts?|increases?)\b[^.]{0,15}?\b(?:interest )?rates?\b|\brate hikes?\b|\btightening\b`, -0.8),
  r('yields-up', String.raw`\byields?\b[^.]{0,25}?\b(?:jump\w*|surg\w*|soar\w*|spik\w*|ris(?:e|es|ing)|rose|climb\w*|hits? (?:a )?(?:\d+|multi|record|highest)|highest)\b`, -0.6),
  r('yields-down', String.raw`\byields?\b[^.]{0,25}?\b(?:fall\w*|fell|drop\w*|slid\w*|tumbl\w*|eas\w*|declin\w*|retreat\w*|lowest)\b`, 0.5),
  r('dollar-down', String.raw`\b(?:dollar|dxy|greenback)\b[^.]{0,25}?\b(?:slid\w*|fall\w*|fell|drop\w*|weaken\w*|tumbl\w*|slump\w*|sink\w*|hits? [^.]{0,15}?\blow)\b`, 0.5),
  r('dollar-up', String.raw`\b(?:dollar|dxy|greenback)\b[^.]{0,25}?\b(?:rall\w*|surg\w*|jump\w*|strengthen\w*|climb\w*|ris(?:e|es|ing)|rose|soar\w*|hits? [^.]{0,15}?\bhigh)\b`, -0.5),
  r('yen-up', String.raw`\byen\b[^.]{0,15}?\b(?:surg\w*|jump\w*|soar\w*|strengthen\w*|rall\w*)\b|\bcarry trade\b[^.]{0,20}?\bunwind`, -0.4),

  // ---- inflation / growth / labour ----
  r('inflation-cool', String.raw`\b(?:inflation|cpi|pce|ppi|prices)\b[^.]{0,30}?\b(?:cool\w*|eas\w*|slow\w*|fall\w*|fell|soft\w*|below (?:expectations|estimates|forecasts?))\b`, 0.7),
  r('inflation-hot', String.raw`\bhotter(?:-than-expected)?\b|\b(?:inflation|cpi|pce|ppi)\b[^.]{0,30}?\b(?:accelerat\w*|jump\w*|surg\w*|ris(?:e|es)|rose|heats? up|above (?:expectations|estimates|forecasts?)|sticky|hot)\b`, -0.7),
  r('fears-ease', String.raw`\b(?:recession|tariff|inflation|trade war|default|credit)\b[^.]{0,15}?\b(?:fears?|worries|concerns?)\b[^.]{0,10}?\b(?:eas\w*|fad\w*|reced\w*|abat\w*)\b`, 0.6),
  r('recession', String.raw`\brecession\b`, -0.6),
  r('jobs-weak', String.raw`\b(?:payrolls|jobs report|job growth|hiring)\b[^.]{0,30}?\b(?:miss\w*|disappoint\w*|slow\w*|weak\w*|shrink\w*|fall\w*|fell)\b|\bunemployment\b[^.]{0,20}?\b(?:ris(?:e|es)|rose|jump\w*|climb\w*|highest)\b`, -0.5),
  r('jobs-strong', String.raw`\b(?:payrolls|jobs report|job growth|hiring)\b[^.]{0,30}?\b(?:beat\w*|strong\w*|surg\w*|jump\w*|top\w* (?:estimates|expectations))\b`, 0.3),
  r('confidence-down', String.raw`\bconsumer (?:sentiment|confidence)\b[^.]{0,30}?\b(?:fall\w*|fell|drop\w*|plung\w*|slump\w*|lowest|sink\w*|sank)\b`, -0.5),
  r('confidence-up', String.raw`\bconsumer (?:sentiment|confidence)\b[^.]{0,30}?\b(?:ris(?:e|es)|rose|jump\w*|improv\w*|highest)\b`, 0.4),
  r('shutdown', String.raw`\b(?:government )?shutdown\b|\bdebt ceiling\b[^.]{0,20}?\b(?:standoff|crisis|deadline)\b`, -0.5),

  // ---- safe havens / commodities ----
  r('safe-haven', String.raw`\bgold\b[^.]{0,30}?\b(?:record|all-time high|surg\w*|soar\w*|safe[- ]haven)\b|\bseek(?:s|ing)? safety\b|\bsafe[- ]havens?\b|\bflight to (?:safety|quality)\b`, -0.4),
  r('gold-up', String.raw`\bgold\b[^.]{0,20}?\b(?:ris(?:e|es|ing)|rose|climb\w*|rall\w*|jump\w*|gain\w*)\b`, -0.3),
  r('oil-spike', String.raw`\boil\b[^.]{0,20}?\b(?:spik\w*|surg\w*|soar\w*|jump\w*)\b`, -0.5),
  r('oil-up', String.raw`\boil\b[^.]{0,20}?\b(?:ris(?:e|es|ing)|rose|climb\w*|rall\w*|gain\w*)\b`, -0.3),
  r('oil-down', String.raw`\boil\b[^.]{0,20}?\b(?:fall\w*|fell|drop\w*|slid\w*|tumbl\w*|slump\w*)\b`, 0.2),
  r('dominance-up', String.raw`\bdominance\b[^.]{0,15}?\b(?:climb\w*|ris(?:e|es)|rose|jump\w*|hits?)\b`, -0.3),

  // ---- flows / supply ----
  r('inflows', String.raw`\binflows?\b`, 0.6),
  r('outflows', String.raw`\boutflows?\b`, -0.6),
  r('to-exchange', String.raw`\b(?:moves?|moved|transfers?|transferred|sends?|sent|deposits?|deposited)\b[^.]{0,40}?\b(?:to|into)\b[^.]{0,25}?\b${VENUES}`, -0.5),
  r('seized', String.raw`\bseized (?:bitcoin|btc|crypto|coins)\b`, -0.3),
  r('buys', String.raw`\b(?:buys?|buying|bought|purchas\w*|acquir\w*|adds?|added|accumulat\w*|scoops? up)\b[^.]{0,30}?\b${COINS}\b`, 0.6),
  r('sells', String.raw`\b(?:sells?|selling|sold|dumps?|dumped|offloads?|unloads?)\b[^.]{0,30}?\b(?:${COINS}|holdings|stake)\b`, -0.6),
  r('mints', String.raw`\b(?:mints?|minted|minting)\b[^.]{0,30}?\b(?:usdt|usdc|stablecoins?|tether)\b`, 0.4),

  // ---- security / failures ----
  r('hack', String.raw`\b(?:hack(?:ed|s|ers?)?|exploit(?:ed|s)?|stolen|drain(?:ed|s)?|breach(?:ed)?|rug[- ]?pull\w*|phishing|scam\w*|attackers?)\b`, -0.8),
  r('liquidations', String.raw`\bliquidat\w*`, -0.6),
  r('bankruptcy', String.raw`\b(?:bankrupt\w*|insolven\w*|collaps\w*|defaults?|defaulted|delist\w*|wind(?:s)? down)\b`, -0.8),
  r('outage', String.raw`\b(?:outages?|halt(?:s|ed)?|downtime|suspend(?:s|ed)?|freez\w* withdrawals|paus\w* withdrawals|congestion)\b`, -0.6),
  r('capitulation', String.raw`\bcapitulat\w*|\b(?:record low|all-time low|multi-?year lows?|lowest (?:level )?since)\b`, -0.5),

  // ---- regulation / legal ----
  r('denial', String.raw`\b(?:denies|denied|rejects?|rejected|refus(?:es|ed)|blocks?|blocked)\b[^.]{0,20}?\b(?:approval|application|listing|request|merger|deal)\b`, -0.6),
  r('etf-delay', String.raw`\b(?:delays?|delayed|postpon\w*|rejects?|rejected|denies|denied|disapprov\w*|pushes back)\b[^.]{0,40}?\b(?:etfs?|decision|application|filing)\b`, -0.6),
  r('approval', String.raw`\b(?:sec|cftc|regulators?|court|judge|fda)\b[^.]{0,40}?\b(?:approv\w*|greenlight\w*|clears?|cleared)\b|\bapprov\w*\b[^.]{0,30}?\betfs?\b`, 0.7),
  r('etf-filing', String.raw`\bfiles? for\b[^.]{0,30}?\betfs?\b|\betf (?:filing|application)s?\b`, 0.5),
  r('legal-win', String.raw`\b(?:wins?|won|victory|dismiss(?:es|ed)?|drops? (?:the )?(?:case|lawsuit|charges|probe)|settles?|settlement)\b`, 0.6),
  r('legislation', String.raw`\b(?:pass(?:es|ed)?|signs?|signed|approv\w*|advances?|advanced)\b[^.]{0,30}?\b(?:bill|law|act|legislation|framework)\b`, 0.6),
  r('legal-trouble', String.raw`\b(?:sues?|sued|lawsuits?|charg(?:es|ed) (?:against|with)|indict\w*|subpoena\w*|probes?|investigat\w*|crackdown|fined|fines|penalt\w*|enforcement action)\b`, -0.6),
  r('ban', String.raw`\b(?:bans?|banned|banning|prohibit\w*|outlaw\w*)\b`, -0.7),

  // ---- geopolitics / trade ----
  r('peace-doubt', String.raw`\b(?:ceasefire|truce|peace (?:deal|talks|agreement))\b[^.]{0,25}?\b(?:doubts?|collaps\w*|fail\w*|falter\w*|breaks? down|violat\w*|stall\w*|crumbl\w*|in jeopardy|at risk)\b`, -0.5, true),
  r('peace', String.raw`\b(?:ceasefire|truce|peace (?:deal|talks|agreement)|de-?escalat\w*)\b`, 0.5),
  r('trade-relief', String.raw`\b(?:tariffs?|trade)\b[^.]{0,20}?\b(?:relief|paus\w*|exemptions?|deal|truce|cuts?|rollback|lifted|eas\w*)\b`, 0.5),
  r('war', String.raw`\b(?:war|invasion|invad\w*|missiles?|airstrikes?|strikes? on|attacks?(?: on)?|attacked|bomb\w*|escalat\w*|tensions? (?:rise|rises|mount|flare\w*))\b`, -0.6),
  r('tariffs', String.raw`\b(?:tariffs?|trade war|export (?:bans?|controls?|restrictions?)|sanctions?|embargo)\b`, -0.6),

  // ---- corporate / adoption ----
  r('earnings-beat', String.raw`\brecord (?:quarterly |annual )?(?:revenue|profit|earnings|sales)\b|\b(?:beats?|tops?) (?:estimates|expectations|forecasts)\b`, 0.6),
  r('earnings-miss', String.raw`\bmiss(?:es|ed)? (?:estimates|expectations|forecasts)\b|\bprofit warning\b|\b(?:cuts?|slash\w*) (?:its )?guidance\b|\blayoffs?\b|\blays? off\b`, -0.6),
  r('adoption', String.raw`\b(?:launch(?:es|ed)?|rolls? out|expands?|expanded|integrat\w*|partners? with|partnership|adopts?|adoption|enables?|adds? support)\b`, 0.4),
  r('targets', String.raw`\b(?:eyes?|targets?|predicts?|sees?)\b[^.]{0,20}?\$\d[\d,.]*\s?(?:k|m|b)?\b`, 0.4),

  // ---- sentiment gauges ----
  r('extreme-fear', String.raw`\bextreme fear\b`, -0.6),
  r('extreme-greed', String.raw`\bextreme greed\b`, 0.3),

  // ---- markets / price moves (generic, last) ----
  r('ath', String.raw`\b(?:all-time highs?|record highs?|new highs?|ath)\b`, 0.6),
  r('risk-up', String.raw`\b${RISK}\b[^.]{0,30}?\b(?:${UP}|(?:clos|end|trad|open|finish|edg|mov|head)\w* higher)\b`, 0.6),
  r('risk-down', String.raw`\b${RISK}\b[^.]{0,30}?\b(?:${DOWN}|(?:clos|end|trad|open|finish|edg|mov|head)\w* lower)\b`, -0.6),
  r('move-up', String.raw`\b${UP}\b`, 0.5),
  r('move-down', String.raw`\b${DOWN}\b`, -0.5),
];

const NEGATORS = /\b(?:no|not|never|fails? to|failed to|won't|wont|didn't|doesn't|isn't|aren't|without|unlikely to)\s+(?:\S+\s+){0,2}$/i;
/** Negation inside a subject…verb match ("Bitcoin fails to break above"). */
const INNER_NEGATORS = /\b(?:not|never|fails? to|failed to|won't|didn't|doesn't|isn't|aren't|unlikely to)\b/i;

export interface RuleHit {
  id: string;
  score: number;
  text: string;
  negated: boolean;
}

export interface RulesResult {
  score: number;
  hits: RuleHit[];
}

/** Applies the rules to a headline; `score` is the clamped mean of the hit scores (0 without hits). */
export function applyRules(text: string, rules: Rule[] = RULES): RulesResult {
  const used: [number, number][] = [];
  const hits: (RuleHit & { start: number })[] = [];
  const overlaps = (s: number, e: number) => used.some(([a, b]) => s < b && e > a);
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const s = m.index;
      const e = s + m[0].length;
      if (overlaps(s, e)) continue;
      used.push([s, e]);
      const before = text.slice(Math.max(0, s - 40), s);
      const negated = rule.score !== 0 && !rule.noNegate && (NEGATORS.test(before) || INNER_NEGATORS.test(m[0]));
      hits.push({ id: rule.id, score: negated ? -rule.score : rule.score, text: m[0], negated, start: s });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  if (hits.length === 0) return { score: 0, hits: [] };
  const mean = hits.reduce((acc, h) => acc + h.score, 0) / hits.length;
  return { score: Math.max(-1, Math.min(1, mean)), hits: hits.map(({ start: _s, ...h }) => h) };
}
