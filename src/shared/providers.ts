// Exchanges and brokers an account can be connected to (FD-SENTIQ §2, TD-SENTIQ §3): what each one asks for,
// how to create a read-only key there, and what Sentiq reads (trading: shared/trading.ts, FD-TRADING). Only platforms with an API are listed (FD-NOAPI).
// Shared by the server (validation) and the wizard.
import { z } from 'zod';

export const PROVIDER_IDS = [
  'kucoin',
  'binance',
  'bybit',
  'okx',
  'kraken',
  'coinbase',
  'bitget',
  'trading212',
  'etoro',
  'ibkr',
  'alpaca',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderField {
  key: string;
  label: string;
  /** Hidden while typing (with a show button). */
  secret?: boolean;
  /** Several lines (a PEM private key). */
  multiline?: boolean;
  placeholder?: string;
  /** Checked on the server and in the form. */
  pattern?: string;
  patternHint?: string;
}

export interface ProviderEnv {
  id: string;
  label: string;
}

export interface ProviderDef {
  id: ProviderId;
  name: string;
  kind: 'crypto' | 'stocks';
  fields: ProviderField[];
  /** Live / demo / paper; the first one is the default. */
  envs?: ProviderEnv[];
  /** How to create the key, step by step: reading, and trading from Sentiq if wanted, never withdrawals (FD-KEYTEXT). */
  steps: string[];
  keysUrl?: string;
  /** What Sentiq reads from it. */
  reads: string;
  /** The key can be restricted to IP addresses (FD-KEYIPS): the wizard shows Sentiq's server addresses. */
  ipRestrict?: boolean;
  /** Under /provider-logos/ (an initials badge when missing). */
  logo?: string;
}

const KEY = { key: 'apiKey', label: 'API Key' };
const SECRET = { key: 'secret', label: 'API Secret', secret: true };
const PASSPHRASE = { key: 'password', label: 'API Passphrase', secret: true };
const READ_CRYPTO = 'solduri, poziții futures, ordine deschise și tranzacții recente';

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'kucoin',
    ipRestrict: true,
    name: 'KuCoin',
    kind: 'crypto',
    fields: [KEY, SECRET, PASSPHRASE],
    steps: [
      'Pe KuCoin: Profil → API Management → Create API (tipul „API Trading”).',
      'Bifează „General” (citire). Ca să tranzacționezi din Sentiq, bifează și „Spot” și / sau „Futures”. Nu bifa niciodată Transfer sau Withdrawal (Sentiq refuză cheile care le permit); Margin nu e folosit.',
      'Alege un passphrase și notează-l. Restricționează cheia la IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key, Secret și passphrase-ul.',
    ],
    keysUrl: 'https://www.kucoin.com/account/api',
    reads: READ_CRYPTO,
    logo: 'kucoin.svg',
  },
  {
    id: 'binance',
    ipRestrict: true,
    name: 'Binance',
    kind: 'crypto',
    fields: [KEY, { ...SECRET, label: 'Secret Key' }],
    steps: [
      'Pe Binance: Profil → API Management → Create API → System generated.',
      'Lasă bifat „Enable Reading”. Ca să tranzacționezi din Sentiq, activează și „Enable Spot & Margin Trading” și / sau „Enable Futures”. Nu activa niciodată „Enable Withdrawals”.',
      'Alege „Restrict access to trusted IPs only” și pune IP-urile serverului Sentiq (lista de mai jos); Binance o cere pentru tranzacționare.',
      'Copiază API Key și Secret Key (secretul apare o singură dată).',
    ],
    keysUrl: 'https://www.binance.com/en/my/settings/api-management',
    reads: READ_CRYPTO,
    logo: 'binance.svg',
  },
  {
    id: 'bybit',
    ipRestrict: true,
    name: 'Bybit',
    kind: 'crypto',
    fields: [KEY, SECRET],
    steps: [
      'Pe Bybit: Profil → API → Create New Key → System-generated API Keys.',
      'Doar pentru citire: „Read-Only”. Ca să tranzacționezi din Sentiq: „Read-Write”, cu „Spot → Trade” și / sau „Contracts → Orders, Positions”. Nu bifa niciodată Withdraw sau Transfer.',
      'La „IP restriction”, leagă cheia de IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key și API Secret.',
    ],
    keysUrl: 'https://www.bybit.com/app/user/api-management',
    reads: READ_CRYPTO,
    logo: 'bybit.svg',
  },
  {
    id: 'okx',
    ipRestrict: true,
    name: 'OKX',
    kind: 'crypto',
    fields: [KEY, { ...SECRET, label: 'Secret Key' }, { ...PASSPHRASE, label: 'Passphrase' }],
    steps: [
      'Pe OKX: Profil → API → Create API key.',
      'Permisiuni: „Read”; ca să tranzacționezi din Sentiq, și „Trade”. Nu bifa niciodată „Withdraw”.',
      'Alege un passphrase și notează-l. La adresele IP, pune IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key, Secret Key și passphrase-ul.',
    ],
    keysUrl: 'https://www.okx.com/account/my-api',
    reads: READ_CRYPTO,
    logo: 'okx.svg',
  },
  {
    id: 'kraken',
    ipRestrict: true,
    name: 'Kraken',
    kind: 'crypto',
    fields: [KEY, { ...SECRET, label: 'Private Key' }],
    steps: [
      'Pe Kraken: Settings → API → Create API key.',
      'Bifează „Query Funds”, „Query Open Orders & Trades” și „Query Closed Orders & Trades”. Ca să tranzacționezi din Sentiq, și „Create & Modify Orders” și „Cancel & Close Orders”. Nu bifa niciodată „Withdraw Funds” sau „Deposit Funds”.',
      'La „IP address restrictions”, pune IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key și Private Key.',
    ],
    keysUrl: 'https://www.kraken.com/u/security/api',
    reads: 'solduri, ordine deschise și tranzacții recente',
    logo: 'kraken.svg',
  },
  {
    id: 'coinbase',
    ipRestrict: true,
    name: 'Coinbase',
    kind: 'crypto',
    fields: [
      { key: 'apiKey', label: 'Nume cheie API (API key name)', placeholder: 'organizations/…/apiKeys/…', pattern: '^organizations/[^/\\s]+/apiKeys/[^/\\s]+$', patternHint: 'numele cheii CDP, de forma organizations/…/apiKeys/…' },
      { key: 'secret', label: 'Cheie privată (Private key)', secret: true, multiline: true, placeholder: '-----BEGIN EC PRIVATE KEY-----\n…\n-----END EC PRIVATE KEY-----' },
    ],
    steps: [
      'Coinbase Developer Platform (portal.cdp.coinbase.com) → API Keys → Create API key.',
      'Permisiuni: „View” (citire); ca să tranzacționezi din Sentiq, și „Trade”. Nu bifa niciodată „Transfer”.',
      'La „Signature algorithm” alege ECDSA. La „IP allowlist”, pune IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază numele cheii (organizations/…/apiKeys/…) și cheia privată, cu tot cu liniile BEGIN / END.',
    ],
    keysUrl: 'https://portal.cdp.coinbase.com/access/api',
    reads: 'solduri, ordine deschise și tranzacții recente',
    logo: 'coinbase.svg',
  },
  {
    id: 'bitget',
    ipRestrict: true,
    name: 'Bitget',
    kind: 'crypto',
    fields: [KEY, { ...SECRET, label: 'Secret Key' }, { ...PASSPHRASE, label: 'Passphrase' }],
    steps: [
      'Pe Bitget: Profil → API Management → Create API → System-generated API key.',
      'Doar pentru citire: „Read-only”. Ca să tranzacționezi din Sentiq: „Read-write”, cu „Trade” (spot și / sau futures). Nu bifa niciodată „Withdraw” sau „Transfer”.',
      'Alege un passphrase și notează-l. La „IP address”, pune IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key, Secret Key și passphrase-ul.',
    ],
    keysUrl: 'https://www.bitget.com/account/newapi',
    reads: READ_CRYPTO,
    logo: 'bitget.svg',
  },
  {
    id: 'trading212',
    ipRestrict: true,
    name: 'Trading 212',
    kind: 'stocks',
    fields: [KEY, SECRET],
    envs: [
      { id: 'live', label: 'Cont real (Live)' },
      { id: 'demo', label: 'Cont Practice (Demo)' },
    ],
    steps: [
      'În Trading 212 (aplicație sau web): Settings → API (Beta) → Generate API key.',
      'Bifează permisiunile de citire: Account data, Metadata, Portfolio, Orders (read) și History. Ca să tranzacționezi din Sentiq, bifează și „Orders: Execute” (permisiunile nu se mai pot schimba după).',
      'Restricționează cheia la IP-urile serverului Sentiq (lista de mai jos).',
      'Copiază API Key și API Secret (secretul apare o singură dată).',
      'API-ul funcționează doar pentru conturile Invest și Stocks ISA.',
    ],
    keysUrl: 'https://docs.trading212.com',
    reads: 'acțiunile și ETF-urile deținute, ordinele în așteptare și ordinele executate recent',
    logo: 'trading212.png',
  },
  {
    id: 'etoro',
    ipRestrict: true,
    name: 'eToro',
    kind: 'stocks',
    fields: [
      { key: 'publicKey', label: 'Public API Key' },
      { key: 'userKey', label: 'User Key', secret: true },
    ],
    envs: [
      { id: 'real', label: 'Cont real (Real)' },
      { id: 'demo', label: 'Cont virtual (Demo)' },
    ],
    steps: [
      'Pe eToro: Settings → Trading → API Key Management → Create New Key.',
      'Alege mediul (Real sau Demo) și permisiunea: „Read” doar pentru citire, „Write” ca să tranzacționezi din Sentiq (permisiunea nu se mai poate schimba după).',
      'Confirmă cu codul primit prin SMS. La „IP whitelist”, pune IP-urile serverului Sentiq (lista de mai jos); opțional, o dată de expirare.',
      'Copiază Public API Key și User Key (User Key apare o singură dată).',
    ],
    keysUrl: 'https://api-portal.etoro.com/getting-started',
    reads: 'pozițiile (acțiuni, ETF-uri, crypto, CFD-uri, cu SL / TP), ordinele și pozițiile copiate',
    logo: 'etoro.png',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    kind: 'stocks',
    fields: [
      { key: 'token', label: 'Token Flex Web Service', secret: true, pattern: '^[0-9]{6,40}$', patternHint: 'doar cifre' },
      { key: 'queryId', label: 'Flex Query ID', pattern: '^[0-9]{3,12}$', patternHint: 'doar cifre' },
    ],
    steps: [
      'În Client Portal: Performance & Reports → Flex Queries.',
      'Creează un „Activity Flex Query” (format XML, perioada „Last Business Day”) cu secțiunile Open Positions, Trades și Cash Report. La Trades: nivelul „Execution” și toate câmpurile („Select All”). Notează Query ID-ul.',
      'Tot acolo, la „Flex Web Service Configuration”: activează serviciul, alege la „Should Expire After” perioada cea mai lungă, apoi „Generate New Token”.',
      'Copiază tokenul și Query ID-ul. Datele sunt cele de la închiderea zilei precedente.',
    ],
    keysUrl: 'https://www.ibkrguides.com/clientportal/performanceandstatements/flex3.htm',
    reads: 'pozițiile, tranzacțiile și numerarul din raportul Flex (ziua precedentă)',
    logo: 'ibkr.png',
  },
  {
    id: 'alpaca',
    name: 'Alpaca',
    kind: 'stocks',
    fields: [
      { key: 'keyId', label: 'API Key ID' },
      { key: 'secret', label: 'Secret Key', secret: true },
    ],
    envs: [
      { id: 'live', label: 'Cont real (Live)' },
      { id: 'paper', label: 'Cont de test (Paper)' },
    ],
    steps: [
      'În dashboard-ul Alpaca: alege contul (Live sau Paper) → API Keys → Generate New Keys.',
      'Copiază API Key ID și Secret Key (secretul apare o singură dată).',
      'Cheile Paper merg doar cu mediul Paper, iar cele Live doar cu Live.',
      'Cheile Alpaca pot tranzacționa întotdeauna; Sentiq le folosește doar pentru citire până pornești tranzacționarea pe cont, din Tranzacții.',
    ],
    keysUrl: 'https://app.alpaca.markets/dashboard/overview',
    reads: 'pozițiile, ordinele deschise și execuțiile recente',
    logo: 'alpaca.png',
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Validation of an account form for one provider: its own fields, a label and (when it has them) an environment. */
export function accountSchemaFor(p: ProviderDef) {
  const shape: Record<string, z.ZodType<string>> = {};
  for (const f of p.fields) {
    let s = z
      .string({ error: (iss) => (iss.input === undefined || iss.input === null ? `${f.label}: lipsește` : `${f.label}: text invalid`) })
      .trim()
      .min(4, `${f.label}: prea scurt`)
      .max(f.multiline ? 4000 : 400, `${f.label}: prea lung`);
    if (f.pattern) s = s.regex(new RegExp(f.pattern), `${f.label}: ${f.patternHint ?? 'format greșit'}`);
    // A PEM key copied out of the downloaded JSON file keeps its line breaks written as "\n".
    shape[f.key] = f.multiline ? s.transform((v) => v.replace(/\\n/g, '\n').trim()) : s;
  }
  return z.object({
    exchange: z.literal(p.id),
    label: z.string({ error: 'Numele contului lipsește' }).trim().min(1, 'Numele contului lipsește').max(60),
    env: p.envs ? z.enum(p.envs.map((e) => e.id) as [string, ...string[]]).default(p.envs[0]!.id) : z.literal('live').default('live'),
    credentials: z.object(shape, { error: 'Datele cheii lipsesc' }),
  });
}
