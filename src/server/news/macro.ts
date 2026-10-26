// FD-MACRORULES: what a macro news item is, by the user's rules: economy-wide data, policy actions and structural trends
// that affect whole nations and the global financial system, never a single company. Pure, so it is tested alone.

/** The areas of the rules, each with the words that speak of it. */
export type MacroArea = 'monetary' | 'inflation' | 'growth' | 'labor' | 'fiscal' | 'trade' | 'themes';

const AREAS: Record<MacroArea, RegExp> = {
  // 1. Monetary policy & central banking: rate decisions, QE / QT, sovereign yields and the yield curve.
  monetary:
    /\b(fed|federal reserve|fomc|powell|ecb|european central bank|lagarde|bank of england|boe|bank of japan|boj|pboc|people's bank of china|swiss national bank|snb|reserve bank of australia|rba|bank of canada|rbnz|riksbank|norges bank|central banks?|monetary policy|interest rates?|rate (?:cuts?|hikes?|decisions?|path|outlook|bets?)|(?:cuts?|hikes?|holds?|raises?|lowers?) (?:interest )?rates|policy rates?|benchmark rates?|(?:interest|borrowing) costs|rates (?:rise|rises|rising|fall|falls|falling|climb|climbs|higher|lower|steady|on hold)|basis points?|dovish|hawkish|quantitative (?:easing|tightening)|qe|qt|asset purchases|bond[- ]buying|balance sheet runoff|bond yields?|treasury (?:yields?|bonds?|notes?|bills?|auctions?|market|secretary|department)|treasuries|t-bills?|gilts?|bunds?|jgbs?|sovereign bonds?|government bonds?|yield curve|(?:2|10|30|two|ten|thirty)-year (?:yields?|notes?|bonds?|treasur(?:y|ies))|mortgage rates?)\b/gi,
  // 2. Inflation & price stability: CPI, PCE, PPI, and the input shocks (energy, farm goods).
  inflation:
    /\b(inflation|disinflation|deflation|cpi|consumer prices?|consumer price index|pce|personal consumption expenditures|ppi|producer prices?|producer price index|price pressures?|cost of living|oil|oil prices?|crude(?: oil)?|brent|wti|natural gas|lng|gas prices|energy (?:prices|shock|crisis|supplies)|diesel prices|opec\+?|gasoline prices|food prices|grain prices|wheat|corn|soybeans?|commodity prices)\b/gi,
  // 3. Growth & activity: GDP, PMIs, consumer demand, the business cycle.
  growth:
    /\b(gdp|gross domestic product|economy|economies|economic (?:growth|data|outlook|slowdown|activity|indicators?)|recessions?|soft landing|hard landing|stagflation|business cycle|pmis?|purchasing managers|ism (?:manufacturing|services)|manufacturing activity|services activity|factory (?:activity|orders|output)|industrial (?:production|output)|retail sales|consumer (?:confidence|sentiment|spending)|household spending|durable goods)\b/gi,
  // 4. Labor markets: payrolls, claims, unemployment, wages.
  labor:
    /\b(jobs (?:report|data|numbers|growth)|payrolls|nonfarm|non-farm|jobless claims|unemployment(?: rate| claims)?|labou?r market|job openings|jolts|wage growth|wages? (?:rise|rose|grow|growth|gains?|increases?|pressures?)|real wages|average hourly earnings|wage-price)\b/gi,
  // 5. Fiscal policy & sovereign debt: budgets, deficits, stimulus, ratings, auctions, debt service.
  fiscal:
    /\b(budget deficits?|fiscal (?:policy|stimulus|deficit|package|plan|rules?|anchor|targets?|year|outlook)|(?:government|public|national|federal) borrowing|debt (?:levels?|burden|ratio|crisis|sustainability)|stimulus (?:package|checks|bill|plan)|austerity|government spending|debt ceiling|debt limit|national debt|public debt|sovereign debt|sovereign (?:ratings?|credit)|credit ratings? (?:cut|downgrade|outlook)|treasury auctions?|bond auctions?|government shutdown|spending bill|budget (?:bill|talks|deal|plan|rules|cuts|gap|shortfall|deficit|update|speech|statement)|finance minister|(?:national|government|federal|state) budget|(?:fuel|tax|vat|excise|carbon) (?:levy|levies|cuts?|hikes?|increases?|rises?))\b/gi,
  // 6. International trade & currencies: balances, FX, tariffs, export controls, supply chains.
  trade:
    /\b(trade ['‘’"“”]?(?:balance|deficits?|surplus(?:es)?|war|wars|deal|deals|talks|data|tensions|policy|conflict|dispute|barriers|agreement)|current account|imports|exports|tariffs?|export controls?|protectionism|supply chains?|reshoring|nearshoring|dollar index|dxy|greenback|eur\/usd|usd\/jpy|gbp\/usd|usd\/cny|euro|yen|yuan|renminbi|sterling|forex|fx|currenc(?:y|ies)|exchange rates?|devaluation|(?:usd|eur|gbp|jpy|chf|cad|aud|nzd|cny|cnh)\/?(?:usd|eur|gbp|jpy|chf|cad|aud|nzd|cny|cnh))\b|(?<![-\w$])dollar\b(?!-)/gi,
  // Today's dominant themes: real yields and debt burdens, divergent growth, AI capex and credit demand, commodity and
  // geopolitical volatility.
  themes:
    /\b(real yields?|term premium|debt (?:servicing|service) costs?|interest costs on (?:the )?(?:national |government )?debt|china(?:'s)? (?:property|real estate|housing)|chinese (?:property|real estate|housing)|property (?:sector|crisis|slump)|euro ?zone|european economy|global growth|world economy|imf|world bank|oecd|(?:ai|artificial intelligence) (?:capex|capital (?:spending|expenditures?)|spending|infrastructure|investment)|data cent(?:er|re)s? (?:spending|boom|capex|build-?out|investment|delays?|slowdown|demand)|ai build-?out|corporate bond (?:issuance|sales|market)|bond issuance|credit (?:markets?|spreads?)|high-yield|junk bonds?|investment-grade|shipping (?:lanes?|corridors?|routes?|rates|costs)|freight (?:rates|costs)|red sea|strait of hormuz|suez|panama canal|risk premiums?|gold|silver|precious metals|safe[- ]havens?)\b/gi,
};

/** The words of a single company's story: its results, its shares, its deals, its people. */
const COMPANY_TERMS =
  /\b(earnings|revenues?|profits?|quarterly results|guidance|eps|stock|shares of|ipos?|mergers?|acquisitions?|acquires?|acquired|buybacks?|dividends?|ceo|chief executive|layoffs|recalls?|lawsuits?|sues|price target|market cap|invested in|would be worth)\b/gi;
/** The market as a whole: its shares are not a company's. */
const MARKET_WIDE =
  /\b((?:asian|european|global|world|us|u\.s\.|chinese|japanese|emerging[- ]markets?|wall street) (?:shares|stocks|equities)|stocks|equities|wall street|s&p 500|dow jones|dow|nasdaq|markets?)\b/i;
/** Institutions that comment on the economy (forecasts, ratings): naming them does not make a story a company's. */
export const INSTITUTIONS =
  /\b(goldman(?: sachs)?|jpmorgan(?: chase)?|jp morgan|morgan stanley|bank of america|bofa|citi(?:group)?|wells fargo|ubs|barclays|deutsche bank|hsbc|nomura|blackrock|pimco|vanguard|moody's|fitch|s&p global|morningstar|bridgewater|imf|world bank|oecd)\b/gi;

const distinct = (re: RegExp, text: string) => new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase())).size;

/** What the macro rules say of an item; `companies`: how many companies its title names (institutions left out). */
export interface MacroVerdict {
  macro: boolean;
  /** How strongly it speaks of macro (2 × the title's areas + the summary's other ones), for choosing a category. */
  strength: number;
  areas: MacroArea[];
}

export function macroVerdict(title: string, summary: string, companies: number): MacroVerdict {
  const head = summary.slice(0, 300);
  // Each area counts once (Brent and crude are one theme, not two): the title's, and the summary's other ones.
  const areas: MacroArea[] = [];
  let inTitle = 0;
  let inSummary = 0;
  for (const [area, re] of Object.entries(AREAS) as [MacroArea, RegExp][]) {
    re.lastIndex = 0;
    const t = re.test(title);
    re.lastIndex = 0;
    const s = !t && re.test(head);
    re.lastIndex = 0;
    if (t || s) areas.push(area);
    if (t) inTitle++;
    if (s) inSummary++;
  }
  // A company's story: each company named and each of its words; the market as a whole is not one.
  const company = Math.max(0, companies + distinct(COMPANY_TERMS, title) - (MARKET_WIDE.test(title) ? 1 : 0));
  const macro = inTitle > 0 ? inTitle > company : inSummary >= 2 && company === 0;
  return { macro, strength: macro ? 2 * inTitle + inSummary : 0, areas: macro ? areas : [] };
}
