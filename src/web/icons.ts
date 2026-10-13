// What a news item or a calendar event is about, so the UI can show a relevant icon (FD-ICONS / TD-ICONS).
// Pure keyword rules on English headlines (the feeds are English); the first matching rule wins.

export type NewsTopic =
  | 'hack'
  | 'central-bank'
  | 'inflation'
  | 'jobs'
  | 'etf'
  | 'stablecoin'
  | 'regulation'
  | 'energy'
  | 'war'
  | 'growth'
  | 'gold'
  | 'bonds'
  | 'fx'
  | 'politics'
  | 'earnings'
  | 'ai'
  | 'defi'
  | 'coin'
  | 'crypto'
  | 'macro'
  | 'geopolitics';

/** Topics specific enough to beat a coin logo (a hack or an ETF story is about that, not about the coin). */
const STRONG: [NewsTopic, RegExp][] = [
  ['hack', /\b(hack(?:ed|s|ers?)?|exploit(?:ed|s)?|breach(?:ed)?|drain(?:ed|er)?|stolen|scam(?:s|mers?)?|phishing|rug ?pull)\b/i],
  [
    'central-bank',
    /\b(fed(?:'s)?|fomc|federal reserve|powell|warsh|hammack|waller|lagarde|ecb|boe|bank of england|bailey|boj|bank of japan|ueda|pboc|snb|rba|rbnz|rbi|central banks?|rate (?:cut|hike|decision)s?|interest rates?|monetary policy)\b/i,
  ],
  ['inflation', /\b(inflation(?:ary)?|cpi|ppi|pce|consumer prices?|price index)\b/i],
  ['jobs', /\b(jobs?|payrolls?|nfp|unemployment|jobless|employment|labou?r market|layoffs?|hiring)\b/i],
  ['etf', /\b(etfs?|etps?|fund flows?|inflows?|outflows?|grayscale|blackrock|ishares)\b/i],
  ['stablecoin', /\b(stablecoins?|usdt|usdc|tether|rlusd|usd1|pyusd)\b/i],
  [
    'regulation',
    /\b(sec|cftc|doj|justice department|antitrust|investigat(?:es|ing|ion)|probe|regulat(?:or|ors|ion|ions|ory)|lawsuits?|sued|court|judge|legislation|bill|compliance|licen[cs]e)\b/i,
  ],
  // Before "war": "Oil prices rise on Saudi Arabia attacks" is about oil.
  ['energy', /\b(oil|crude|brent|wti|opec|natural gas|lng|gasoline|diesel|energy|fuel)\b/i],
  ['war', /\b(war|attacks?|missiles?|airstrikes?|strikes?|military|troops|ceasefire|conflict|drones?|invasion|houthis?|hamas|hezbollah|nato)\b/i],
];

/** Broader topics: on a story about a coin, the coin's logo is more telling than these. */
const WEAK: [NewsTopic, RegExp][] = [
  ['growth', /\b(gdp|recession|economy|economic growth|pmi|manufacturing|industrial production|retail sales|consumer spending)\b/i],
  ['gold', /\b(gold|silver|copper|precious metals?|metals|bullion)\b/i],
  ['bonds', /\b(bonds?|treasur(?:y|ies)|yields?|gilts?|bunds?)\b/i],
  ['fx', /\b(dollar|dxy|yen|euro|sterling|pound|yuan|forex|currenc(?:y|ies))\b/i],
  ['politics', /\b(elections?|trump|president|tariffs?|sanctions?|government|shutdown|minister|parliament|congress|senate|vote)\b/i],
  ['earnings', /\b(earnings|revenue|profits?|guidance|dividends?|stocks?|shares|nasdaq|s&p|dow|ipo|buybacks?|price target)\b/i],
  ['ai', /\b(ai|artificial intelligence|openai|anthropic|nvidia|chips?|semiconductors?|data cent(?:er|re)s?)\b/i],
  ['defi', /\b(defi|protocol|blockchain|layer[- ]?2|staking|validators?|mainnet|testnet|on-?chain|dex|tvl|tokeni[sz](?:ed|ation))\b/i],
];

const CATEGORY_TOPIC: Record<string, NewsTopic> = { crypto: 'crypto', macro: 'macro', geopolitics: 'geopolitics', stocks: 'earnings' };

/** The icon topic of a news item. A coin logo is used when the story is about a coin (see STRONG / WEAK). */
export function newsTopic(title: string, summary: string | null | undefined, category: string, coins: readonly string[]): NewsTopic {
  const text = `${title} ${summary ?? ''}`;
  for (const [topic, re] of STRONG) if (re.test(text)) return topic;
  if (coins.length > 0) return 'coin';
  for (const [topic, re] of WEAK) if (re.test(text)) return topic;
  return CATEGORY_TOPIC[category] ?? 'macro';
}

export type EventKind =
  | 'holiday'
  | 'custom'
  | 'earnings'
  | 'manufacturing'
  | 'housing'
  | 'retail'
  | 'inflation'
  | 'jobs'
  | 'growth'
  | 'energy'
  | 'central-bank'
  | 'sentiment'
  | 'trade'
  | 'other';

// Order matters: "Philly Fed Manufacturing Index" is manufacturing, not the Fed; "Average Hourly Earnings" is jobs.
const EVENT_RULES: [EventKind, RegExp][] = [
  ['manufacturing', /\b(pmi|manufacturing|industrial|factory|production|durable goods|ism|philly fed|empire state)\b/i],
  ['housing', /\b(housing|home sales|building permits|mortgage|house price)\b/i],
  ['retail', /\b(retail sales|consumer spending)\b/i],
  ['inflation', /\b(cpi|ppi|pce|inflation|price index|prices)\b/i],
  ['jobs', /\b(employment|unemployment|payrolls|nfp|jobless|claims|jolts|job openings|hourly earnings|wages?|labou?r)\b/i],
  ['growth', /\b(gdp|growth)\b/i],
  ['energy', /\b(crude|oil|natural gas|inventories)\b/i],
  [
    'central-bank',
    /\b(speaks|speech|testifies|press conference|rate decision|rate statement|policy rate|interest rate|fomc|monetary policy|minutes|cash rate|bank rate|fed|ecb|boe|boj)\b/i,
  ],
  ['sentiment', /\b(sentiment|confidence|zew|ifo|gfk|expectations)\b/i],
  ['trade', /\b(trade balance|exports?|imports?|current account)\b/i],
];

export function eventKind(title: string, impact: string, source: string): EventKind {
  if (source === 'custom') return 'custom';
  // Quarterly results of a watchlist stock (FD-SENTIQ §4.5).
  if (source === 'earn') return 'earnings';
  if (impact === 'Holiday' || /\bholiday\b/i.test(title)) return 'holiday';
  for (const [kind, re] of EVENT_RULES) if (re.test(title)) return kind;
  return 'other';
}

/** A stable hue (0–359) per ticker, for the fallback badge of coins without a logo. */
export function coinHue(symbol: string): number {
  let h = 0;
  for (const ch of symbol.toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
