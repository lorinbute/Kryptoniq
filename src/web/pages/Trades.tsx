import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowRightLeft, ChartCandlestick, Coins, History, ListChecks, Plus, Power, RefreshCw, Wallet } from 'lucide-react';
import type { AccountView, BalanceRow, OrderRow, Portfolio, StatsPeriod, TradeStats } from '../../shared/api-types.ts';
import { api, errorMessage, qs } from '../api.ts';
import { autoDigits, fmtAgo, fmtDateTime, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtUsd, fmtWeekday } from '../format.ts';
import { useTz } from '../hooks.ts';
import { Empty, ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { CoinLogo } from '../components/icons.tsx';
import { AccountWizard } from '../components/AccountWizard.tsx';
import { ProviderLogo } from '../components/ProviderLogo.tsx';
import { providerById } from '../../shared/providers.ts';
import { OrderTicket, type TicketSeed } from '../components/OrderTicket.tsx';
import { CancelOrderButton, EnableTradingDialog, FundsRiskNote, TradeJournal, useDisableTrading } from '../components/TradingControls.tsx';
import { ModifyTicket } from '../components/ModifyTicket.tsx';
import { holdingSeed, orderSeed, positionSeed, type ModifySeed } from '../components/modify-seeds.ts';
import { closeSeed, sellSeed } from '../components/trade-seeds.ts';
import { canReverse, ReverseDialog } from '../components/ReverseDialog.tsx';
import { portfolioInterval } from '../portfolio-settle.ts';

const SECTION_RO: Record<string, string> = { balances: 'Solduri', positions: 'Poziții', orders: 'Ordine', fills: 'Tranzacții', prices: 'Prețuri', mode: 'Tip cont', futures: 'Cont futures' };
/** `who`: „exchange-ul” or „brokerul”. */
const codeRo = (code: string, who: string): string =>
  ({
    AUTH: 'cheia API e invalidă sau a expirat',
    PERMISSION: 'cheia nu are permisiunea necesară (sau IP-ul nu e pe lista permisă)',
    RATE_LIMIT: `${who} limitează temporar cererile (prea multe cereri sau supraîncărcare); reîncerc automat`,
    NETWORK: 'problemă de rețea',
    MAINTENANCE: `${who} e în mentenanță sau nu răspunde`,
    EXCHANGE: `eroare de la ${who.replace(/-?ul$/, '')}`,
  })[code] ?? `eroare de la ${who.replace(/-?ul$/, '')}`;

/** Codes whose raw exchange text helps (a wrong key, a missing permission, an unknown error); the rest are explained above. */
const SHOW_RAW = new Set(['AUTH', 'PERMISSION', 'EXCHANGE']);

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'USD', 'DAI', 'FDUSD']);

const pnlClass = (v: number | null) => (v === null ? 'text-muted' : v >= 0 ? 'text-bull' : 'text-bear');

/** FD-TRADESTATS §2: the period of the closed-position cards, kept in this browser. */
const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'today', label: 'Azi' },
  { id: '7d', label: '7z' },
  { id: '30d', label: '30z' },
  { id: '90d', label: '90z' },
];
const PERIOD_KEY = 'sentiq:trades-period';
function readPeriod(): StatsPeriod {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    return PERIODS.some((p) => p.id === v) ? (v as StatsPeriod) : '30d';
  } catch {
    return '30d';
  }
}
function writePeriod(v: StatsPeriod): void {
  try {
    localStorage.setItem(PERIOD_KEY, v);
  } catch {
    // private window: the choice lasts this visit
  }
}
const statsKey = (id: number, period: StatsPeriod) => ['portfolio-stats', id, period] as const;
const statsUrl = (id: number, period: StatsPeriod, force = false) => `/api/portfolio/${id}/stats${qs({ period, force: force ? '1' : undefined })}`;

/** One summary card; `title` explains it (or why it shows a dash). */
function Stat({ label, value, tone, title, hint }: { label: string; value: string; tone?: string; title?: string; hint?: string }) {
  return (
    <div className="panel min-w-0 px-4 py-3" title={title}>
      <div className="truncate text-[12.5px] text-muted">{label}</div>
      <div className={clsx('num mt-0.5 truncate text-[22px] tracking-[-0.02em]', tone)}>{value}</div>
      {hint && <div className="truncate text-[11.5px] text-faint">{hint}</div>}
    </div>
  );
}

/** „Reîmprospătează” in the page's top row (FD-TRADESTATS §2, FD-BROKERSTATS): the account's portfolio and its stats for the period. */
function useRefreshAccount(account: AccountView, period: StatsPeriod) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const [p, st] = await Promise.all([api.get<Portfolio>(`/api/portfolio/${account.id}?force=1`), api.get<TradeStats>(statsUrl(account.id, period, true)).catch(() => null)]);
      qc.setQueryData(['portfolio', account.id], p);
      if (st) qc.setQueryData(statsKey(account.id, period), st);
    },
  });
}

function CostBasisEditor({ accountId, row }: { accountId: number; row: BalanceRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.avgPrice ? String(row.avgPrice) : '');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (avgPrice: number | null) => api.put(`/api/portfolio/${accountId}/cost-basis/${encodeURIComponent(row.asset)}`, { avgPrice }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['portfolio', accountId] });
    },
  });
  if (!editing) {
    return (
      <button type="button" className="text-[12px] text-link" onClick={() => setEditing(true)}>
        {row.avgSource === 'manual' ? 'editează' : row.avgPrice === null ? 'setează manual' : 'corectează'}
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        // Empty = remove the manual price; anything else must be a positive number.
        if (value.trim() === '') return save.mutate(null);
        const n = Number(value.trim().replace(',', '.'));
        setInvalid(!(Number.isFinite(n) && n > 0));
        if (Number.isFinite(n) && n > 0) save.mutate(n);
      }}
    >
      <input aria-label={`Preț mediu ${row.asset}`} value={value} onChange={(e) => setValue(e.target.value)} className="w-24 text-right" inputMode="decimal" />
      <button className="btn px-2 py-1">OK</button>
      <button type="button" className="btn px-2 py-1" onClick={() => setEditing(false)}>
        Renunță
      </button>
      {invalid && <span className="text-[12px] text-bear">Introdu un preț pozitiv, sau lasă gol ca să ștergi prețul manual.</span>}
      {save.isError && <span className="text-[12px] text-bear">{errorMessage(save.error)}</span>}
    </form>
  );
}

/** FD-TRADESTATS §2: the seven cards of a crypto account, the period of the last four, and when it was read. */
function CryptoCards({
  p,
  account,
  stats,
  period,
  updated,
}: {
  p: Portfolio;
  account: AccountView;
  stats: { data?: TradeStats; isPending: boolean; isError: boolean };
  period: StatsPeriod;
  updated: React.ReactNode;
}) {
  const name = providerById(account.exchange)?.name ?? account.exchange;
  // A server from before FD-TRADESTATS sends no `futuresAvailable`.
  const futures = p.totals.futuresAvailable ?? null;
  const futuresErr = p.errors.futures;
  const futuresTitle = futuresErr
    ? `Contul futures: ${codeRo(futuresErr.code, 'exchange-ul')}${SHOW_RAW.has(futuresErr.code) ? ` (${futuresErr.message})` : ''}`
    : futures === null
      ? `${name}: fără cont futures în Sentiq.`
      : 'Suma liberă în contul futures, în USDT: cât poți folosi pentru poziții noi.';
  const st = stats.data;
  const statDash = (): string | undefined => {
    if (stats.isPending) return undefined;
    if (stats.isError || !st) return 'Statisticile nu s-au putut citi.';
    if (!st.supported) return futures === null && !futuresErr ? `${name}: fără futures în Sentiq.` : `${name} nu dă prin API istoricul pozițiilor închise.`;
    if (st.error) return `Istoricul pozițiilor: ${codeRo(st.error.code, 'exchange-ul')}`;
    return undefined;
  };
  const why = statDash();
  const count = (v: number | null | undefined) => (stats.isPending ? '…' : v === null || v === undefined ? '—' : fmtNum(v, 0));
  const periodLabel = PERIODS.find((x) => x.id === period)?.label ?? period;
  const closedTitle = (what: string) => why ?? `${what}: pozițiile futures închise în perioada aleasă (${periodLabel}), după rezultatul lor net (cu comisioane și funding).`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Stat label="Disponibil în futures" value={fmtUsd(futures)} title={futuresTitle} />
        <Stat
          label="Valoare în contul spot"
          value={fmtUsd(p.totals.spotValue)}
          title="Tot ce ai în conturile spot (la KuCoin: Trading și Funding): monedele la prețul de acum, plus stablecoins. Contul futures nu e inclus."
        />
        <Stat label="PnL nerealizat (futures)" value={fmtUsd(p.totals.unrealizedPnl)} tone={pnlClass(p.totals.unrealizedPnl)} title="Profitul sau pierderea pozițiilor futures încă deschise, la prețul de acum." />
        <Stat label="Tranzacții profitabile" value={count(st?.wins)} tone={st?.wins ? 'text-bull' : undefined} title={closedTitle('Profitabile')} />
        <Stat label="Tranzacții cu pierdere" value={count(st?.losses)} tone={st?.losses ? 'text-bear' : undefined} title={closedTitle('Cu pierdere')} />
        <Stat
          label="Rata de succes"
          value={stats.isPending ? '…' : st?.successRate === null || st?.successRate === undefined ? '—' : `${fmtNum(st.successRate, 1)} %`}
          title={why ?? 'Profitabile din profitabile + cu pierdere; pozițiile închise pe zero nu intră.'}
        />
        <Stat
          label="Câștig net"
          value={stats.isPending ? '…' : fmtUsd(st?.net)}
          tone={pnlClass(st?.net ?? null)}
          title={why ?? 'Suma rezultatelor nete ale pozițiilor futures închise în perioadă.'}
          hint={st?.netPartial ? 'parțial: o monedă fără preț' : undefined}
        />
      </div>
      {/* The period is chosen in the page's top row (FD-UIPOLISH); here only what was read and when. */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {st?.error && <span className="text-[12px] text-bear">{why}</span>}
        <div className="ml-auto">{updated}</div>
      </div>
    </div>
  );
}

/** FD-BROKERSTATS §2: what a closed trade is at each broker, and its result. */
const BROKER_STATS_NOTE: Record<string, string> = {
  etoro: 'pozițiile închise (o închidere parțială e o tranzacție separată), după profitul net dat de eToro',
  trading212: 'vânzările executate (un ordin e o tranzacție), după profitul realizat dat de Trading 212',
  ibkr: 'ordinele care au închis sau redus o poziție, după Realized P/L (FIFO, cu comisioane) din raportul Flex',
  alpaca: 'ordinele care au închis sau redus o poziție; rezultatul e calculat de Sentiq din execuții (FIFO), fără taxele regulatorii',
};

/** FD-BROKERSTATS §3: why a closed trade can have no known result. */
const UNKNOWN_WHY: Record<string, string> = {
  etoro: 'eToro nu a dat profitul net',
  trading212: 'Trading 212 nu a dat profitul realizat',
  alpaca: 'cumpărarea e mai veche decât istoricul citit, acțiunile au venit prin transfer sau split, ori contul nu permite short',
};

/** „1 tranzacție”, „5 tranzacții”, „20 de tranzacții”. */
const tradesRo = (n: number): string => (n === 1 ? '1 tranzacție' : `${n}${n % 100 >= 20 || (n > 0 && n % 100 === 0) ? ' de' : ''} tranzacții`);

/** IBKR's reports follow the New York trading day. */
const ET = 'America/New_York';

const BROKER_GRID: Record<number, string> = { 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7' };

/** FD-BROKERSTATS §1: a broker's cards (holdings, cash, open positions' PnL, then the closed trades of the period). */
function BrokerCards({
  p,
  account,
  stats,
  period,
  updated,
}: {
  p: Portfolio;
  account: AccountView;
  stats: { data?: TradeStats; isPending: boolean; isError: boolean };
  period: StatsPeriod;
  updated: React.ReactNode;
}) {
  const name = providerById(account.exchange)?.name ?? account.exchange;
  const st = stats.data;
  // IBKR's report has finished days only: before today's, „Azi” cannot be counted.
  const notYet = !!st && !st.error && st.asOf != null && st.asOf < st.from;
  const statDash = (): string | undefined => {
    if (stats.isPending) return undefined;
    if (stats.isError || !st) return 'Statisticile nu s-au putut citi.';
    // A server from before FD-BROKERSTATS sends no `currency` and no broker stats.
    if (!st.supported) return st.currency === undefined ? 'Serverul Sentiq nu are încă statisticile pentru brokeri.' : `${name} nu dă prin API istoricul tranzacțiilor închise.`;
    if (st.error) return `Istoricul tranzacțiilor: ${codeRo(st.error.code, 'brokerul')}`;
    if (notYet) return `${name} trimite tranzacțiile unei zile după închiderea ei (raportul Flex are datele până la închiderea bursei de ${fmtWeekday(st.asOf as number, ET)}). Alege 7z, 30z sau 90z.`;
    return undefined;
  };
  const why = statDash();
  const count = (v: number | null | undefined) => (stats.isPending ? '…' : v === null || v === undefined ? '—' : fmtNum(v, 0));
  const periodLabel = PERIODS.find((x) => x.id === period)?.label ?? period;
  // The New York day, in full („vineri, 16 octombrie”): a short month („oct.”) would end the sentence with two dots.
  const through = st?.asOf != null && !notYet ? ` Datele: până la închiderea bursei de ${fmtWeekday(st.asOf, ET)}.` : '';
  const what = BROKER_STATS_NOTE[account.exchange] ?? 'tranzacțiile închise';
  const closedTitle = (label: string) => why ?? `${label}: ${what}, în perioada aleasă (${periodLabel}).${through}`;
  const counted = st && st.wins !== null && !why;
  const partial = !counted
    ? undefined
    : st.netPartial
      ? 'parțial: fără curs valutar'
      : st.limited
        ? 'parțial: istoric prea lung'
        : st.unknownResults
          ? `${tradesRo(st.unknownResults)} fără rezultat`
          : undefined;
  const partialTitle = !counted
    ? ''
    : [
        st.netPartial ? ' Unele rezultate sunt în altă monedă, fără curs de schimb: sunt numărate, dar nu intră în sumă.' : '',
        st.limited ? ` ${name} dă istoricul pe pagini; Sentiq citește un număr limitat, iar perioada are mai multe tranzacții decât au încăput.` : '',
        st.unknownResults
          ? ` Fără rezultat cunoscut, deci nenumărate: ${tradesRo(st.unknownResults)}${UNKNOWN_WHY[account.exchange] ? ` (${UNKNOWN_WHY[account.exchange]})` : ''}.`
          : '',
      ].join('');
  const cards: React.ReactNode[] = [
    <Stat key="value" label="Valoare dețineri" value={fmtMoney(p.totals.spotValue, p.currency)} />,
    p.cash !== null && <Stat key="cash" label="Numerar disponibil" value={fmtMoney(p.cash, p.currency)} />,
    p.positions.length > 0 && (
      <Stat key="upnl" label="PnL nerealizat (poziții)" value={fmtMoney(p.totals.unrealizedPnl, p.currency)} tone={pnlClass(p.totals.unrealizedPnl)} title="Profitul sau pierderea pozițiilor cu levier sau short încă deschise." />
    ),
    <Stat key="wins" label="Tranzacții profitabile" value={count(st?.wins)} tone={st?.wins ? 'text-bull' : undefined} title={closedTitle('Profitabile')} />,
    <Stat key="losses" label="Tranzacții cu pierdere" value={count(st?.losses)} tone={st?.losses ? 'text-bear' : undefined} title={closedTitle('Cu pierdere')} />,
    <Stat
      key="rate"
      label="Rata de succes"
      value={stats.isPending ? '…' : st?.successRate === null || st?.successRate === undefined ? '—' : `${fmtNum(st.successRate, 1)} %`}
      title={why ?? 'Profitabile din profitabile + cu pierdere; tranzacțiile închise pe zero nu intră.'}
    />,
    <Stat
      key="net"
      label="Câștig net"
      value={stats.isPending ? '…' : why ? '—' : fmtMoney(st?.net, st?.currency ?? p.currency)}
      tone={why ? undefined : pnlClass(st?.net ?? null)}
      title={why ?? `Suma rezultatelor: ${what}, în moneda contului.${through}${partialTitle}`}
      hint={partial}
    />,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5">
      <div className={clsx('grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4', BROKER_GRID[cards.length])}>{cards}</div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {st?.error && <span className="text-[12px] text-bear">{why}</span>}
        <div className="ml-auto">{updated}</div>
      </div>
    </div>
  );
}

/** Whether "Anulează" can go out: the order's market (as the server reads it) is one trading was switched on for. */
function cancellable(account: AccountView, o: OrderRow): boolean {
  if (o.cancellable === false) return false;
  // A perpetual's order (BTC/USDT:USDT) is futures wherever it is listed (KuCoin's unified account lists it with spot).
  const market = account.kind === 'stocks' ? 'stock' : o.symbol.includes(':') ? 'futures' : o.market;
  return account.trading.markets.includes(market);
}

function PortfolioView({
  account,
  period,
  onTicket,
  onModify,
  onReverse,
}: {
  account: AccountView;
  period: StatsPeriod;
  onTicket: (seed: TicketSeed) => void;
  onModify: (seed: ModifySeed) => void;
  onReverse: (r: { symbol: string; side: 'long' | 'short' }) => void;
}) {
  const trades = account.trading.enabled;
  const tz = useTz();
  const q = useQuery({ queryKey: ['portfolio', account.id], queryFn: () => api.get<Portfolio>(`/api/portfolio/${account.id}`), refetchInterval: () => portfolioInterval(account.id, 30_000) });
  const statsQ = useQuery({
    queryKey: statsKey(account.id, period),
    queryFn: () => api.get<TradeStats>(statsUrl(account.id, period)),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  if (!q.data && !q.isError) return <Loading label={account.kind === 'stocks' ? 'Se citesc datele de la broker…' : 'Se citesc datele de pe exchange…'} />;
  if (!q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const stocks = p.kind === 'stocks';
  // Crypto values are in USDT and shown as dollars, as before; a broker's are in the account's currency.
  const money = (v: number | null | undefined, currency = p.currency) => (stocks ? fmtMoney(v, currency) : fmtUsd(v));
  const errs = Object.entries(p.errors);
  // Shares are quoted in cents (as on their chart); coins keep the finer steps they need.
  const digits = (v: number | null | undefined, crypto = false) => (stocks && !crypto ? (Math.abs(v ?? 1) < 1 ? 4 : 2) : autoDigits(v ?? 1));
  const chartOf = (asset: string, crypto = false) => (stocks && !crypto ? `/charts/s/${encodeURIComponent(asset)}` : `/charts/${asset}/USDT`);
  const updated = (
    <div className="text-[12px] text-faint">
      {p.exchange === 'kucoin' ? `Cont ${p.mode === 'unified' ? 'unificat (UTA)' : p.mode === 'classic' ? 'clasic' : 'necunoscut'}, ` : ''}
      {p.asOf ? `date la închiderea din ${fmtDateTime(p.asOf, tz)} (raport Flex), citit ${fmtAgo(p.fetchedAt)}` : `actualizat ${fmtAgo(p.fetchedAt)}`}
    </div>
  );
  return (
    <div className="flex flex-col gap-3.5">
      {stocks ? (
        <BrokerCards p={p} account={account} stats={statsQ} period={period} updated={updated} />
      ) : (
        <CryptoCards p={p} account={account} stats={statsQ} period={period} updated={updated} />
      )}
      {errs.length > 0 && (
        <Warning>
          {errs.filter(([k]) => k !== 'futures').map(([k, v]) => {
            const staleAt = p.stale[k as keyof Portfolio['stale']];
            const code = v?.code ?? 'EXCHANGE';
            return (
              <div key={k} title={v?.message}>
                {SECTION_RO[k] ?? k}: {codeRo(code, stocks ? 'brokerul' : 'exchange-ul')}
                {SHOW_RAW.has(code) && v?.message ? ` (${v.message})` : ''}
                {staleAt ? `; se afișează datele din ${fmtDateTime(staleAt, tz)}` : ''}
              </div>
            );
          })}
        </Warning>
      )}

      <Panel title={stocks ? 'Poziții cu levier sau short' : 'Poziții futures deschise'} icon={ChartCandlestick} flush>
        {p.positions.length === 0 ? (
          <div>
            <Empty>{stocks ? 'Nicio poziție cu levier sau short.' : 'Nicio poziție futures deschisă.'}</Empty>
          </div>
        ) : (
          // Rows with buttons: every cell on the row's middle, as the buttons (the text never sits above them).
          <table className={clsx('table', trades && '[&_td]:align-middle')}>
            <thead>
              <tr>
                <th>Simbol</th>
                <th>Direcție</th>
                <th className="text-right">Mărime</th>
                <th className="text-right">Intrare</th>
                <th className="text-right">Mark</th>
                <th className="text-right">PnL</th>
                <th className="text-right">Lichidare</th>
                <th className="text-right">Levier</th>
                {trades && (
                  <th className="relative text-right">
                    <span className="sr-only">Acțiuni</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {p.positions.map((pos, i) => {
                const d = digits(pos.entryPrice ?? pos.markPrice);
                const [base, quoteFull] = pos.symbol.split('/');
                return (
                  // eToro keeps every position apart (FD-HEDGEALL): two shorts on one instrument are two rows.
                  <tr key={`${pos.symbol}-${pos.side}-${pos.ref?.positionIds?.join(',') ?? i}`}>
                    <td>
                      {/* The margin mode centred on the symbol's row, as the logo and the name (FD-ORDEREDIT); a block flex, so
                          the cell's middle is the text's (an inline one sits on the logo's baseline). */}
                      <span className="flex items-center gap-x-1.5">
                        <Link to={stocks ? chartOf(base ?? '') : `/charts/${base}/${(quoteFull ?? 'USDT').split(':')[0]}`} className="inline-flex items-center gap-2 font-semibold text-text">
                          {base && <CoinLogo coin={base} size={18} badge={stocks} square={stocks} />}
                          {stocks ? base : pos.symbol}
                        </Link>
                        {pos.marginMode && <span className="text-[12px] leading-none text-faint">{pos.marginMode}</span>}
                      </span>
                    </td>
                    <td className={pos.side === 'long' ? 'text-bull' : 'text-bear'}>{pos.side === 'long' ? 'Long' : pos.side === 'short' ? 'Short' : pos.side}</td>
                    <td className="num text-right">{fmtNum(pos.size ?? pos.contracts, 6)}</td>
                    <td className="num text-right">{fmtPrice(pos.entryPrice, d)}</td>
                    <td className="num text-right">{fmtPrice(pos.markPrice, d)}</td>
                    <td className={clsx('num text-right', pnlClass(pos.unrealizedPnl))}>
                      {stocks ? money(pos.unrealizedPnl) : fmtNum(pos.unrealizedPnl, 2)} <span className="text-[12px]">{fmtPct(pos.percentage)}</span>
                    </td>
                    <td className="num text-right text-warn">{fmtPrice(pos.liquidationPrice, d)}</td>
                    <td className="num text-right">{pos.leverage ? `${fmtNum(pos.leverage, 1)}×` : '—'}</td>
                    {trades && (
                      <td className="text-right">
                        {(() => {
                          const seed = closeSeed(account, pos);
                          const protect = positionSeed(account, p, pos);
                          return (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {protect && (
                                <button className="btn h-8 px-2 text-[12px] whitespace-nowrap" onClick={() => onModify(protect)} aria-label={protect.title}>
                                  SL / TP
                                </button>
                              )}
                              {/* FD-REVERSE: closed, then opened the other way (TradingView's ⇅). */}
                              {(pos.side === 'long' || pos.side === 'short') && canReverse(account, pos.symbol) && (
                                <button className="btn h-8 px-2 text-[12px]" onClick={() => onReverse({ symbol: pos.symbol, side: pos.side as 'long' | 'short' })} aria-label={`Întoarce poziția ${pos.side} ${pos.symbol}`}>
                                  Întoarce
                                </button>
                              )}
                              {seed && (
                                <button className="btn h-8 px-2 text-[12px]" onClick={() => onTicket(seed)}>
                                  Închide
                                </button>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={stocks ? 'Dețineri' : 'Dețineri spot'} icon={Coins} flush>
        {p.balances.length === 0 ? (
          <div>
            <Empty>Niciun sold.</Empty>
          </div>
        ) : (
          <table className={clsx('table', trades && '[&_td]:align-middle')}>
            <thead>
              <tr>
                <th>Activ</th>
                <th>Cont</th>
                <th className="text-right">Cantitate</th>
                <th className="text-right">Preț</th>
                <th className="text-right">Valoare</th>
                <th className="text-right">Preț mediu</th>
                <th className="text-right">{stocks ? 'PnL' : 'PnL estimat'}</th>
                {trades && (
                  <th className="relative text-right">
                    <span className="sr-only">Acțiuni</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {p.balances.map((b) => {
                const d = digits(b.price, b.crypto);
                return (
                  <tr key={`${b.account}-${b.asset}`}>
                    <td className="font-semibold">
                      {/* Block flex: the logo and the name on one middle (an inline one sits on the logo's baseline). */}
                      {STABLE_ASSETS.has(b.asset) || b.asset.startsWith('#') ? (
                        <span className="flex items-center gap-2">
                          <CoinLogo coin={b.asset} size={18} badge={stocks} square={stocks} />
                          {b.asset}
                        </span>
                      ) : (
                        <Link to={chartOf(b.asset, b.crypto)} className="flex w-fit items-center gap-2 text-text">
                          <CoinLogo coin={b.asset} size={18} badge={stocks && !b.crypto} square={stocks && !b.crypto} />
                          {b.asset}
                        </Link>
                      )}
                      {b.name && <div className="max-w-[24ch] truncate text-[11.5px] font-normal text-faint">{b.name}</div>}
                      {b.note && <div className="text-[11.5px] font-normal text-link">{b.note}</div>}
                    </td>
                    <td className="text-[12px] text-muted">{b.account}</td>
                    <td className="num text-right">
                      {fmtNum(b.total, 8)}
                      {b.used > 0 && <div className="text-[11.5px] text-faint">{fmtNum(b.used, 8)} în ordine</div>}
                    </td>
                    <td className="num text-right">
                      {fmtPrice(b.price, d)}
                      {stocks && b.priceCurrency && b.priceCurrency !== b.currency && <span className="ml-1 text-[11px] text-faint">{b.priceCurrency}</span>}
                    </td>
                    <td className="num text-right">{money(b.value, b.currency ?? p.currency)}</td>
                    <td className="num text-right">
                      {b.avgPrice !== null ? fmtPrice(b.avgPrice, d) : <span className="text-faint">necunoscut</span>}
                      {b.avgSource === 'manual' && <div className="text-[11px] text-faint">setat manual</div>}
                      {b.avgSource === 'broker' && <div className="text-[11px] text-faint">de la broker</div>}
                      {/* An eToro instrument without a symbol ("#1234") has nothing to attach a price to. */}
                      {!STABLE_ASSETS.has(b.asset) && /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(b.asset) && (
                        <div>
                          <CostBasisEditor accountId={account.id} row={b} />
                        </div>
                      )}
                    </td>
                    <td className={clsx('num text-right', pnlClass(b.pnl))}>
                      {b.pnl !== null ? (
                        <>
                          {money(b.pnl, b.currency ?? p.currency)} <span className="text-[12px]">{fmtPct(b.pnlPct)}</span>
                        </>
                      ) : b.pnlPct !== null ? (
                        <span className="text-[12px]">{fmtPct(b.pnlPct)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    {trades && (
                      <td className="text-right">
                        {(() => {
                          // Stablecoins and instruments without a symbol are not sold from here; nor a KuCoin "main" balance
                          // (it trades only once moved to the trading account, and Sentiq never moves funds).
                          const seed = STABLE_ASSETS.has(b.asset) || b.asset.startsWith('#') || b.free <= 0 || b.account === 'main' ? null : sellSeed(account, b);
                          // A holding's SL / TP once per asset (KuCoin's "main" row is the same holding).
                          const protect = STABLE_ASSETS.has(b.asset) || b.asset.startsWith('#') || b.account === 'main' ? null : holdingSeed(account, p, b);
                          return (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {protect && (
                                <button className="btn h-8 px-2 text-[12px] whitespace-nowrap" onClick={() => onModify(protect)} aria-label={protect.title}>
                                  SL / TP
                                </button>
                              )}
                              {seed && (
                                <button className="btn h-8 px-2 text-[12px]" onClick={() => onTicket(seed)}>
                                  Vinde
                                </button>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Ordine deschise" icon={ListChecks} flush>
        {p.orders.length === 0 ? (
          <div>
            <Empty>Niciun ordin deschis.</Empty>
          </div>
        ) : (
          <table className={clsx('table', trades && '[&_td]:align-middle')}>
            <thead>
              <tr>
                <th>Simbol</th>
                <th>Piață</th>
                <th>Tip</th>
                <th>Direcție</th>
                <th className="text-right">Preț</th>
                <th className="text-right">Declanșare</th>
                <th className="text-right">Cantitate</th>
                <th>Plasat</th>
                {trades && (
                  <th className="relative text-right">
                    <span className="sr-only">Acțiuni</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={`${o.market}-${o.id}`}>
                  <td className="font-semibold">
                    <span className="flex items-center gap-2">
                      <CoinLogo coin={o.symbol.split('/')[0] ?? o.symbol} size={18} badge={stocks} square={stocks} />
                      {stocks ? o.symbol.split('/')[0] : o.symbol}
                    </span>
                  </td>
                  <td className="text-muted">{stocks ? (o.market === 'spot' ? 'Acțiuni' : 'Levier / short') : o.market === 'spot' ? 'Spot' : 'Futures'}</td>
                  <td>
                    {o.type}
                    {o.reduceOnly && <span className="ml-1 text-[12px] text-faint">reduce-only</span>}
                  </td>
                  <td className={o.side === 'buy' ? 'text-bull' : 'text-bear'}>
                    {o.side === 'buy' ? 'Cumpărare' : 'Vânzare'}
                    {/* FD-KUCOINHEDGE: in hedge mode, the position the order opens or closes. */}
                    {o.positionSide && <span className="ml-1 text-[12px] text-faint">{o.positionSide}</span>}
                  </td>
                  <td className="num text-right">{fmtPrice(o.price, digits(o.price))}</td>
                  <td className="num text-right">{o.triggerPrice ? fmtPrice(o.triggerPrice, digits(o.triggerPrice)) : '—'}</td>
                  <td className="num text-right">
                    {fmtNum(o.amount, 8)}
                    {o.filled ? <div className="text-[11.5px] text-faint">{fmtNum(o.filled, 8)} executat</div> : null}
                  </td>
                  <td className="num text-[12px] text-muted">{o.timestamp ? fmtDateTime(o.timestamp, tz) : '—'}</td>
                  {trades && (
                    <td className="text-right">
                      {(() => {
                        const edit = orderSeed(account, p, o);
                        const cancel = cancellable(account, o);
                        return (
                          <span className="inline-flex items-start justify-end gap-1.5">
                            {edit && (
                              <button className="btn h-8 px-2 text-[12px]" onClick={() => onModify(edit)} aria-label={`Modifică ordinul ${o.symbol}`}>
                                Modifică
                              </button>
                            )}
                            {cancel && <CancelOrderButton account={account} order={o} />}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Tranzacții recente (7 zile)" icon={History} flush>
        {p.fills.length === 0 ? (
          <div>
            <Empty>Nicio tranzacție în ultimele 7 zile.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Simbol</th>
                <th>Direcție</th>
                <th className="text-right">Preț</th>
                <th className="text-right">Cantitate</th>
                <th className="text-right">Valoare</th>
                <th className="text-right">Comision</th>
              </tr>
            </thead>
            <tbody>
              {p.fills.map((f) => (
                <tr key={`${f.market}-${f.id}`}>
                  <td className="num text-[12px] text-muted">{fmtDateTime(f.timestamp, tz)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <CoinLogo coin={f.symbol.split('/')[0] ?? f.symbol} size={16} badge={stocks} square={stocks} />
                      {stocks ? f.symbol.split('/')[0] : f.symbol}
                    </span>{' '}
                    <span className="text-[12px] text-faint">{stocks ? (f.market === 'spot' ? '' : 'derivat') : f.market === 'spot' ? 'spot' : 'futures'}</span>
                  </td>
                  <td className={f.side === 'buy' ? 'text-bull' : 'text-bear'}>{f.side === 'buy' ? 'Cumpărare' : 'Vânzare'}</td>
                  <td className="num text-right">{fmtPrice(f.price, digits(f.price))}</td>
                  <td className="num text-right">{fmtNum(f.amount, 8)}</td>
                  <td className="num text-right">{fmtNum(f.cost, 2)}</td>
                  <td className="num text-right text-muted">
                    {fmtNum(f.fee, 6)} {f.feeCurrency ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

export default function TradesPage() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts') });
  const [selected, setSelected] = useState<number | null>(null);
  const [wizard, setWizard] = useState(false);
  const closeWizard = useCallback(() => setWizard(false), []);
  if (!accounts.data && !accounts.isError) return <Loading />;
  if (!accounts.data) return <ErrorNote error={accounts.error} onRetry={() => accounts.refetch()} />;
  const list = accounts.data;
  const wizardEl = wizard && <AccountWizard onClose={closeWizard} onDone={(a) => setSelected(a.id)} />;
  if (list.length === 0) {
    return (
      <div className="flex w-full flex-col gap-3.5">
        <h1 className="page-title">Tranzacții</h1>
        <Panel title="Tranzacțiile tale" icon={Wallet}>
          <div className="max-w-[70ch] space-y-3 text-[14px]">
            <p>
              Conectează un exchange crypto sau un broker de acțiuni ca să vezi deținerile, pozițiile și ordinele deschise. Implicit Sentiq doar citește; poți porni tranzacționarea pe un
              cont (cu passkey-ul sau cu parola și codul 2FA), apoi trimite ordine din Sentiq, fiecare cu o confirmare.
            </p>
            <p className="text-muted">
              Crypto: KuCoin, Binance, Bybit, OKX, Kraken, Coinbase, Bitget. Acțiuni: Trading 212, eToro, Interactive Brokers, Alpaca. Pentru fiecare, wizard-ul arată cum creezi
              cheia: pentru citire și, dacă vrei să tranzacționezi din Sentiq, cu tranzacționare; niciodată cu retrageri. Restricționează cheia la IP-urile serverului Sentiq,
              afișate acolo.
            </p>
            <button className="btn btn-primary" onClick={() => setWizard(true)}>
              <Plus size={15} aria-hidden /> Adaugă un cont
            </button>
          </div>
        </Panel>
        {wizardEl}
      </div>
    );
  }
  const current = list.find((a) => a.id === selected) ?? list[0]!;
  return <AccountsView list={list} current={current} onSelect={setSelected} onAdd={() => setWizard(true)} wizardEl={wizardEl} />;
}

/** The page with accounts: the top row (accounts, „Reîmprospătează”, „Adaugă un cont”) and the chosen account. */
function AccountsView({ list, current, onSelect, onAdd, wizardEl }: { list: AccountView[]; current: AccountView; onSelect: (id: number) => void; onAdd: () => void; wizardEl: React.ReactNode }) {
  const [period, setPeriod] = useState<StatsPeriod>(readPeriod);
  const choosePeriod = useCallback((v: StatsPeriod) => {
    setPeriod(v);
    writePeriod(v);
  }, []);
  const refresh = useRefreshAccount(current, period);
  // A failed refresh belongs to the account it was for: switching accounts clears its warning.
  const resetRefresh = refresh.reset;
  useEffect(() => resetRefresh(), [current.id, resetRefresh]);
  // FD-TRADING: the order form (from a button or a row) and the switch.
  const [ticket, setTicket] = useState<TicketSeed | null>(null);
  const [enabling, setEnabling] = useState(false);
  const disable = useDisableTrading(current);
  const closeTicket = useCallback(() => setTicket(null), []);
  // FD-ORDEREDIT: a position's SL / TP, or an open order, being changed.
  const [modify, setModify] = useState<ModifySeed | null>(null);
  const closeModify = useCallback(() => setModify(null), []);
  // FD-REVERSE: a position being turned the other way.
  const [reverse, setReverse] = useState<{ accountId: number; symbol: string; side: 'long' | 'short' } | null>(null);
  const closeReverse = useCallback(() => setReverse(null), []);
  const closeEnabling = useCallback(() => setEnabling(false), []);
  return (
    <div className="flex w-full flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">Tranzacții</h1>
        <div className="seg" role="group" aria-label="Cont">
          {list.map((a) => (
            <button key={a.id} type="button" aria-pressed={a.id === current.id} onClick={() => onSelect(a.id)} className="inline-flex items-center gap-1.5">
              <ProviderLogo id={a.exchange} size={16} />
              {a.label}
            </button>
          ))}
        </div>
        {/* FD-TRADESTATS §2, FD-UIPOLISH: the period of the closed trades and the buttons share the top row (FD-BROKERSTATS: every account). */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span id="trades-period" className="text-[12.5px] text-muted">
              Tranzacții închise în
            </span>
            <div className="seg" role="group" aria-labelledby="trades-period">
              {PERIODS.map((x) => (
                <button key={x.id} type="button" aria-pressed={x.id === period} onClick={() => x.id !== period && choosePeriod(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          {current.trading.enabled ? (
            <>
              <button className="btn btn-primary" onClick={() => setTicket({ accountId: current.id, kind: current.kind })}>
                <ArrowRightLeft size={14} aria-hidden /> Ordin nou
              </button>
              <button
                className="btn"
                disabled={disable.isPending}
                title="Oprește tranzacționarea pe acest cont"
                onClick={() => {
                  if (window.confirm(`Oprești tranzacționarea pe „${current.label}”? Ordinele deja plasate rămân pe platformă.`)) disable.mutate();
                }}
              >
                <Power size={14} aria-hidden /> Oprește tranzacționarea
              </button>
            </>
          ) : (
            current.trading.supported && (
              <button className="btn" onClick={() => setEnabling(true)}>
                <ArrowRightLeft size={14} aria-hidden /> Pornește tranzacționarea
              </button>
            )
          )}
          <button className="btn" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw size={14} className={clsx(refresh.isPending && 'animate-spin')} aria-hidden /> Reîmprospătează
          </button>
          <button className="btn" onClick={onAdd}>
            <Plus size={15} aria-hidden /> Adaugă un cont
          </button>
        </div>
      </div>
      {refresh.isError && <Warning>Reîmprospătarea nu a reușit: {errorMessage(refresh.error)}</Warning>}
      {disable.isError && <Warning>Tranzacționarea nu a putut fi oprită: {errorMessage(disable.error)}</Warning>}
      {current.fundsRisk ? (
        <FundsRiskNote account={current} />
      ) : (
        current.permissionWarning &&
        !current.trading.enabled && (
          <Warning>
            Cheia „{current.label}” poate face mai mult decât citire ({current.permissions}). Ca să tranzacționezi cu ea din Sentiq, pornește tranzacționarea; dacă nu vrei,
            ajunge o cheie doar pentru citire.
          </Warning>
        )
      )}
      {current.trading.reason && <p className="text-[12.5px] text-faint">{current.trading.reason} Contul rămâne doar pentru citire.</p>}
      {current.lastError && <Warning>Ultima eroare: {current.lastError}</Warning>}
      <PortfolioView key={current.id} account={current} period={period} onTicket={setTicket} onModify={setModify} onReverse={(r) => setReverse({ ...r, accountId: current.id })} />
      <TradeJournal account={current} />
      {wizardEl}
      {ticket && <OrderTicket seed={ticket} onClose={closeTicket} />}
      {modify && modify.account.id === current.id && <ModifyTicket seed={modify} onClose={closeModify} />}
      {reverse && reverse.accountId === current.id && <ReverseDialog account={current} symbol={reverse.symbol} side={reverse.side} onClose={closeReverse} />}
      {enabling && <EnableTradingDialog account={current} onClose={closeEnabling} />}
    </div>
  );
}
