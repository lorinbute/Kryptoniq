// Romanian names, groups and the "essential" indicators of the Economy page (FD-ECON §1–§2). Keys are the source's
// indicator names in lower case; an indicator missing here keeps its original (English) name.

/** The countries of the page, in order, and their Romanian names. EU = the euro area (the EU level the source has). */
export const ECON_COUNTRIES = [
  { code: 'US', name: 'SUA' },
  { code: 'EU', name: 'Zona euro (UE)' },
  { code: 'GB', name: 'Marea Britanie' },
  { code: 'JP', name: 'Japonia' },
  { code: 'CN', name: 'China' },
  { code: 'CA', name: 'Canada' },
  { code: 'CH', name: 'Elveția' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'Noua Zeelandă' },
] as const;

/** EU members shown in the euro-area group, for indicators the euro area itself does not publish. */
export const EU_MEMBERS: Record<string, string> = { DE: 'Germania', FR: 'Franța', IT: 'Italia', ES: 'Spania' };

/** Every country the history is read for. */
export const ECON_SOURCE_COUNTRIES = [...ECON_COUNTRIES.map((c) => c.code), ...Object.keys(EU_MEMBERS)];

export const ECON_GROUPS = [
  { id: 'prce', name: 'Prețuri și inflație' },
  { id: 'lbr', name: 'Piața muncii' },
  { id: 'gdp', name: 'PIB și creștere' },
  { id: 'bsnss', name: 'Industrie și afaceri' },
  { id: 'cnsm', name: 'Consum' },
  { id: 'hse', name: 'Locuințe' },
  { id: 'mny', name: 'Bani și dobânzi' },
  { id: 'trd', name: 'Comerț exterior' },
  { id: 'gov', name: 'Buget public' },
  { id: 'enrg', name: 'Energie' },
  { id: 'bnd', name: 'Obligațiuni' },
  { id: 'other', name: 'Altele' },
] as const;
export type EconGroup = (typeof ECON_GROUPS)[number]['id'];

/** The page's group of a source category (PMIs come without one; bond tables are split in two at the source). */
export function groupOf(category: string | null, name: string): EconGroup {
  if (category === 'mrkt') return 'bnd';
  if (!category) return /\bpmi\b|gdpnow/i.test(name) ? (/gdpnow/i.test(name) ? 'gdp' : 'bsnss') : 'other';
  return (ECON_GROUPS.some((g) => g.id === category) ? category : 'other') as EconGroup;
}

/** Shown under "Esențiale" in every country that has them, besides what the source marks as high importance. */
export const ESSENTIAL = new Set([
  'inflation rate',
  'core inflation rate',
  'unemployment rate',
  'gdp growth rate',
  'gdp annual growth rate',
  'interest rate',
  'deposit interest rate',
  'initial jobless claims',
  'non farm payrolls',
  'manufacturing pmi',
  'services pmi',
  'core pce price index annual change',
  'retail sales mom',
  'government bond 10y',
]);

export const RO_NAMES: Record<string, string> = {
  // Prices
  'inflation rate': 'Inflația (anuală)',
  'inflation rate mom': 'Inflația (lunară)',
  'core inflation rate': 'Inflația de bază (anuală)',
  'core inflation rate mom': 'Inflația de bază (lunară)',
  'consumer price index cpi': 'Indicele prețurilor de consum (CPI)',
  'cpi seasonally adjusted': 'CPI, ajustat sezonier',
  'pce price index annual change': 'Inflația PCE (anuală)',
  'pce price index mom': 'Inflația PCE (lunară)',
  'core pce price index annual change': 'Inflația PCE de bază (anuală)',
  'core pce price index mom': 'Inflația PCE de bază (lunară)',
  'core pce prices qoq': 'Prețurile PCE de bază (trimestrial)',
  'pce prices qoq': 'Prețurile PCE (trimestrial)',
  'producer prices': 'Prețurile producției',
  'producer prices change': 'Prețurile producției (anual)',
  'producer price inflation mom': 'Prețurile producției (lunar)',
  'producer prices mom': 'Prețurile producției (lunar)',
  'producer prices yoy': 'Prețurile producției (anual)',
  'ppi mom': 'Prețurile producției (lunar)',
  'ppi yoy': 'Prețurile producției (anual)',
  'core producer prices mom': 'Prețurile producției de bază (lunar)',
  'core producer prices yoy': 'Prețurile producției de bază (anual)',
  'import prices mom': 'Prețurile importurilor (lunar)',
  'import prices yoy': 'Prețurile importurilor (anual)',
  'export prices mom': 'Prețurile exporturilor (lunar)',
  'export prices yoy': 'Prețurile exporturilor (anual)',
  'gdp deflator': 'Deflatorul PIB',
  'wholesale prices mom': 'Prețurile en-gros (lunar)',
  'wholesale prices yoy': 'Prețurile en-gros (anual)',
  'shop price inflation': 'Inflația prețurilor din magazine',
  // Labour
  'unemployment rate': 'Rata șomajului',
  'u6 unemployment rate': 'Rata șomajului U6 (extinsă)',
  'initial jobless claims': 'Cereri inițiale de șomaj',
  'continuing jobless claims': 'Cereri continue de șomaj',
  'jobless claims 4-week average': 'Cereri de șomaj, media pe 4 săptămâni',
  'non farm payrolls': 'Locuri de muncă noi, non-agricole (NFP)',
  'nonfarm payrolls private': 'Locuri de muncă noi, sectorul privat',
  'government payrolls': 'Locuri de muncă noi, sectorul public',
  'manufacturing payrolls': 'Locuri de muncă noi, industrie',
  'adp employment change': 'Locuri de muncă noi (ADP)',
  'adp employment change weekly': 'Locuri de muncă noi (ADP, săptămânal)',
  'average hourly earnings': 'Câștigul orar mediu (lunar)',
  'average hourly earnings yoy': 'Câștigul orar mediu (anual)',
  'average weekly hours': 'Ore lucrate pe săptămână',
  'labor force participation rate': 'Rata de participare la forța de muncă',
  'job offers': 'Posturi libere (JOLTS)',
  'job quits': 'Demisii (JOLTS)',
  'challenger job cuts': 'Concedieri anunțate (Challenger)',
  'employment change': 'Variația numărului de angajați',
  'employment cost index': 'Costul forței de muncă (ECI)',
  'employment cost index wages': 'Costul forței de muncă: salarii',
  'employment cost index benefits': 'Costul forței de muncă: beneficii',
  'wage growth': 'Creșterea salariilor',
  'unemployment change': 'Variația numărului de șomeri',
  'unemployed persons': 'Numărul șomerilor',
  'nonfarm productivity qoq': 'Productivitatea muncii (trimestrial)',
  'unit labour costs qoq': 'Costul unitar al muncii (trimestrial)',
  // GDP
  'gdp growth rate': 'Creșterea PIB (trimestrială)',
  'gdp annual growth rate': 'Creșterea PIB (anuală)',
  'gdp growth annualized': 'Creșterea PIB (anualizată)',
  'monthly gdp mom': 'PIB lunar',
  'gdp sales qoq': 'Vânzările finale (PIB, trimestrial)',
  'real consumer spending': 'Consumul real (PIB)',
  gdpnow: 'GDPNow (estimarea Fed Atlanta)',
  'corporate profits': 'Profiturile companiilor',
  'full year gdp growth': 'Creșterea PIB (an întreg)',
  // Industry and business
  'industrial production': 'Producția industrială (anuală)',
  'industrial production mom': 'Producția industrială (lunară)',
  'manufacturing production': 'Producția manufacturieră (anuală)',
  'manufacturing production mom': 'Producția manufacturieră (lunară)',
  'capacity utilization': 'Gradul de utilizare a capacităților',
  'manufacturing pmi': 'PMI industrie',
  'services pmi': 'PMI servicii',
  'composite pmi': 'PMI compozit',
  'non manufacturing pmi': 'PMI servicii (ISM)',
  'ism manufacturing employment': 'ISM industrie: angajări',
  'ism manufacturing new orders': 'ISM industrie: comenzi noi',
  'ism manufacturing prices': 'ISM industrie: prețuri',
  'ism non manufacturing business activity': 'ISM servicii: activitate',
  'ism non manufacturing employment': 'ISM servicii: angajări',
  'ism non manufacturing new orders': 'ISM servicii: comenzi noi',
  'ism non manufacturing prices': 'ISM servicii: prețuri',
  'business confidence': 'Încrederea mediului de afaceri',
  'business inventories': 'Stocurile companiilor',
  'durable goods orders': 'Comenzi de bunuri durabile',
  'durable goods orders ex transportation': 'Comenzi de bunuri durabile, fără transport',
  'durable goods orders ex defense': 'Comenzi de bunuri durabile, fără apărare',
  'factory orders': 'Comenzi în industrie',
  'factory orders ex transportation': 'Comenzi în industrie, fără transport',
  'non defense capital goods orders ex aircraft': 'Comenzi de bunuri de capital (fără apărare și avioane)',
  'ny empire state manufacturing index': 'Industria statului New York (Empire State)',
  'philadelphia fed manufacturing index': 'Industria Philadelphia Fed',
  'chicago pmi': 'PMI Chicago',
  'chicago fed national activity index': 'Activitatea economică națională (Chicago Fed)',
  'dallas fed manufacturing index': 'Industria Dallas Fed',
  'dallas fed services index': 'Serviciile Dallas Fed',
  'richmond fed manufacturing index': 'Industria Richmond Fed',
  'richmond fed services index': 'Serviciile Richmond Fed',
  'kansas fed manufacturing index': 'Industria Kansas City Fed',
  'kansas fed composite index': 'Activitatea Kansas City Fed (compozit)',
  'nfib business optimism index': 'Optimismul firmelor mici (NFIB)',
  'total vehicle sales': 'Vânzări de autovehicule',
  'wholesale inventories': 'Stocuri en-gros',
  'retail inventories ex autos': 'Stocuri en-detail, fără auto',
  'zew economic sentiment index': 'Sentimentul economic ZEW',
  'car registrations': 'Înmatriculări de autoturisme',
  'machinery orders': 'Comenzi de utilaje',
  'leading economic index': 'Indicele economic anticipativ',
  'private investment': 'Investițiile private',
  'lmi logistics managers index': 'Indicele managerilor de logistică (LMI)',
  // Consumers
  'consumer confidence': 'Încrederea consumatorilor',
  'michigan consumer sentiment': 'Sentimentul consumatorilor (Michigan)',
  'michigan consumer expectations': 'Așteptările consumatorilor (Michigan)',
  'michigan current economic conditions': 'Condițiile economice curente (Michigan)',
  'michigan inflation expectations': 'Așteptările de inflație (Michigan)',
  'michigan 5 year inflation expectations': 'Așteptările de inflație pe 5 ani (Michigan)',
  'economic optimism index': 'Optimismul economic',
  'personal income': 'Venitul personal',
  'personal spending': 'Cheltuielile personale',
  'retail sales mom': 'Vânzări cu amănuntul (lunar)',
  'retail sales yoy': 'Vânzări cu amănuntul (anual)',
  'retail sales ex autos': 'Vânzări cu amănuntul, fără auto',
  'retail sales ex gas and autos mom': 'Vânzări cu amănuntul, fără auto și carburanți',
  'consumer credit': 'Creditul de consum',
  'household spending': 'Cheltuielile gospodăriilor (anual)',
  'household spending mom': 'Cheltuielile gospodăriilor (lunar)',
  'redbook index': 'Indicele Redbook (vânzări)',
  'cbi distributive trades': 'Comerțul (CBI)',
  'brc retail sales monitor yoy': 'Vânzări cu amănuntul BRC (anual)',
  'used car prices mom': 'Prețul mașinilor rulate (lunar)',
  'used car prices yoy': 'Prețul mașinilor rulate (anual)',
  // Housing
  'building permits': 'Autorizații de construire',
  'building permits mom': 'Autorizații de construire (lunar)',
  'housing starts': 'Locuințe începute',
  'housing starts mom': 'Locuințe începute (lunar)',
  'housing starts yoy': 'Locuințe începute (anual)',
  'new home sales': 'Vânzări de locuințe noi',
  'new home sales mom': 'Vânzări de locuințe noi (lunar)',
  'existing home sales': 'Vânzări de locuințe existente',
  'existing home sales mom': 'Vânzări de locuințe existente (lunar)',
  'pending home sales': 'Vânzări de locuințe în curs (anual)',
  'pending home sales mom': 'Vânzări de locuințe în curs (lunar)',
  'case shiller home price index yoy': 'Prețul locuințelor Case-Shiller (anual)',
  'case shiller home price index mom': 'Prețul locuințelor Case-Shiller (lunar)',
  'house price index yoy': 'Prețul locuințelor (anual)',
  'house price index mom': 'Prețul locuințelor (lunar)',
  'housing index': 'Indicele prețului locuințelor',
  'nahb housing market index': 'Încrederea constructorilor (NAHB)',
  'construction spending': 'Cheltuieli pentru construcții',
  '30 year mortgage rate': 'Dobânda la ipoteci pe 30 de ani',
  '15 year mortgage rate': 'Dobânda la ipoteci pe 15 ani',
  'mortgage rate': 'Dobânda la ipoteci (MBA)',
  'mortgage applications': 'Cereri de credite ipotecare',
  'mba mortgage market index': 'Piața ipotecară (MBA)',
  'mba purchase index': 'Ipoteci pentru cumpărare (MBA)',
  'mba mortgage refinance index': 'Refinanțări ipotecare (MBA)',
  'mortgage approvals': 'Ipoteci aprobate',
  'home loans': 'Credite ipotecare',
  'rics house price balance': 'Prețul locuințelor (RICS)',
  'nationwide housing prices yoy': 'Prețul locuințelor Nationwide (anual)',
  'nationwide housing prices mom': 'Prețul locuințelor Nationwide (lunar)',
  // Money and rates
  'interest rate': 'Dobânda băncii centrale',
  'deposit interest rate': 'Dobânda la depozite (BCE)',
  'money supply m2': 'Masa monetară M2',
  'money supply m3': 'Masa monetară M3',
  'money supply m4': 'Masa monetară M4',
  'central bank balance sheet': 'Bilanțul băncii centrale',
  'fixed asset investment': 'Investiții în active fixe',
  'foreign bond investment': 'Investiții străine în obligațiuni',
  'monetary base yoy': 'Baza monetară (anual)',
  // Trade
  'balance of trade': 'Balanța comercială',
  exports: 'Exporturi',
  imports: 'Importuri',
  'exports yoy': 'Exporturi (anual)',
  'imports yoy': 'Importuri (anual)',
  'current account': 'Contul curent',
  'goods trade balance': 'Balanța comercială cu bunuri',
  'goods trade balance non-eu': 'Balanța comercială cu bunuri, în afara UE',
  // Budget
  'government budget value': 'Soldul bugetului public',
  // Bonds
  'government bond 10y': 'Randamentul obligațiunilor pe 10 ani',
  // Energy
  'crude oil stocks change': 'Variația stocurilor de țiței (EIA)',
  'api crude oil stock change': 'Variația stocurilor de țiței (API)',
  'natural gas stocks change': 'Variația stocurilor de gaze',
  'gasoline stocks change': 'Variația stocurilor de benzină',
  'crude oil rigs': 'Platforme de foraj pentru petrol',
  'total rigs': 'Platforme de foraj, total',
  'cushing crude oil stocks': 'Stocurile de țiței de la Cushing',
};

/** Short Romanian explanations the Calendar's glossary does not have. */
export const RO_EXPLAIN: Record<string, string> = {
  'manufacturing pmi': 'Indicele managerilor de achiziții din industrie: peste 50 = expansiune, sub 50 = contracție.',
  'services pmi': 'Indicele managerilor de achiziții din servicii: peste 50 = expansiune, sub 50 = contracție.',
  'composite pmi': 'PMI-ul industriei și serviciilor împreună: peste 50 = expansiune, sub 50 = contracție.',
  'zew economic sentiment index': 'Așteptările analiștilor pentru următoarele 6 luni (ZEW): peste 0 = optimism.',
  'business confidence': 'Încrederea companiilor în afaceri (în Germania, indicele Ifo).',
  'consumer confidence': 'Cât de optimiști sunt consumatorii; un consum mai slab încetinește economia.',
  'interest rate': 'Dobânda de politică monetară a băncii centrale.',
  'deposit interest rate': 'Dobânda BCE la depozitele băncilor: principala dobândă din zona euro.',
  'government bond 10y': 'Randamentul titlurilor de stat pe 10 ani: costul banilor pe termen lung.',
  'housing starts': 'Construcțiile de locuințe începute (ritm anualizat).',
  'building permits': 'Autorizațiile de construire: un semnal timpuriu pentru construcții.',
  'existing home sales': 'Vânzările de locuințe existente (ritm anualizat).',
  'new home sales': 'Vânzările de locuințe noi (ritm anualizat).',
  'continuing jobless claims': 'Persoanele care primesc în continuare ajutor de șomaj (săptămânal).',
  'balance of trade': 'Exporturile minus importurile.',
  'current account': 'Balanța comercială plus veniturile și transferurile cu străinătatea.',
  'capacity utilization': 'Cât din capacitatea de producție e folosită; aproape de maxim înseamnă presiune pe prețuri.',
  'industrial production': 'Producția fabricilor, minelor și utilităților.',
  'industrial production mom': 'Producția fabricilor, minelor și utilităților, față de luna trecută.',
};

/** 1 = a rise is good for the economy, -1 = bad, 0 = ambiguous (FD-ECONCOLOR, research §11). */
export type Polarity = 1 | 0 | -1;

/** Exceptions by name, checked in order before the group's default (lower-case names). */
const POLARITY_RULES: [RegExp, Polarity][] = [
  // Prices paid by companies and price expectations are inflation, wherever the source files them.
  [/prices paid|ism (non )?manufacturing prices|price trends|price expectations|inflation expectations|cpi expectations|used car prices/, -1],
  // Rates: dearer money for the economy (and for risk assets).
  [/interest rate|lending rate|loan prime rate|mortgage rate/, -1],
  [/\byield\b|government bond/, -1],
  // Unemployment and job losses.
  [/unemploy|jobless|claimant count|job cuts/, -1],
  [/unit labour costs|labour costs/, -1],
  [/government debt/, -1],
  // Ambiguous: wages (good for households, inflationary), inventories and commodity stocks, house prices, imports,
  // credit, money, reserves, export and commodity prices.
  [/earnings|wage|employment cost index|overtime pay/, 0],
  [/inventor|stocks? change|stocks$|crude oil|distillate|gasoline|heating oil|natural gas|refinery|rigs|grain stocks|prospective plantings/, 0],
  [/house price|home price|housing index|housing prices|dwelling prices|rics house/, 0],
  [/^imports|crude oil imports/, 0],
  [/consumer credit|debt balance|housing credit|net lending|private sector credit/, 0],
  [/money supply|monetary base|balance sheet|reserve balances|foreign exchange reserves|foreign (bond|stock) investment|investment in foreign/, 0],
  [/export prices|commodity prices|dairy trade price/, 0],
  // Credit growth in China means stimulus: good for growth.
  [/loan growth|new bank loans|social financing|loans to private sector/, 1],
  [/fixed asset investment/, 1],
];

const GROUP_POLARITY: Record<EconGroup, Polarity> = { prce: -1, lbr: 1, gdp: 1, bsnss: 1, cnsm: 1, hse: 1, mny: 0, trd: 1, gov: 1, enrg: 0, bnd: -1, other: 0 };

/** Whether a rise of this indicator is good, bad or neither for the economy. */
export function polarityOf(category: string | null, name: string): Polarity {
  const n = name.toLowerCase();
  for (const [re, p] of POLARITY_RULES) if (re.test(n)) return p;
  return GROUP_POLARITY[groupOf(category, name)];
}
