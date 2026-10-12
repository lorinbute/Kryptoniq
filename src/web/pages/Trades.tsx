import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChartCandlestick, Coins, History, ListChecks, RefreshCw, Wallet } from 'lucide-react';
import type { AccountView, BalanceRow, Portfolio } from '../../shared/api-types.ts';
import { api, errorMessage } from '../api.ts';
import { autoDigits, fmtAgo, fmtDateTime, fmtNum, fmtPct, fmtPrice, fmtUsd } from '../format.ts';
import { useTz } from '../hooks.ts';
import { Empty, ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { CoinLogo } from '../components/icons.tsx';

const SECTION_RO: Record<string, string> = { balances: 'Solduri', positions: 'Poziții', orders: 'Ordine', fills: 'Tranzacții', prices: 'Prețuri', mode: 'Tip cont' };
const CODE_RO: Record<string, string> = {
  AUTH: 'cheia API e invalidă sau a expirat',
  PERMISSION: 'cheia nu are permisiunea necesară (sau IP-ul nu e pe lista permisă)',
  RATE_LIMIT: 'exchange-ul limitează temporar cererile (prea multe cereri sau supraîncărcare la exchange); reîncerc automat',
  NETWORK: 'problemă de rețea',
  MAINTENANCE: 'exchange-ul e în mentenanță',
  EXCHANGE: 'eroare de la exchange',
};

/** Codes whose raw exchange text helps (a wrong key, a missing permission, an unknown error); the rest are explained above. */
const SHOW_RAW = new Set(['AUTH', 'PERMISSION', 'EXCHANGE']);

const pnlClass = (v: number | null) => (v === null ? 'text-muted' : v >= 0 ? 'text-bull' : 'text-bear');

function CostBasisEditor({ accountId, row }: { accountId: number; row: BalanceRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.avgPrice ? String(row.avgPrice) : '');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (avgPrice: number | null) => api.put(`/api/portfolio/${accountId}/cost-basis/${row.asset}`, { avgPrice }),
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

function PortfolioView({ account }: { account: AccountView }) {
  const tz = useTz();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portfolio', account.id], queryFn: () => api.get<Portfolio>(`/api/portfolio/${account.id}`), refetchInterval: 30_000 });
  const refresh = useMutation({
    mutationFn: () => api.get<Portfolio>(`/api/portfolio/${account.id}?force=1`),
    onSuccess: (data) => qc.setQueryData(['portfolio', account.id], data),
  });
  if (!q.data && !q.isError) return <Loading label="Se citesc datele de pe exchange…" />;
  if (!q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const errs = Object.entries(p.errors);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <div className="panel px-5 py-3.5">
          <div className="text-[12.5px] text-muted">Valoare spot</div>
          <div className="num mt-0.5 text-[24px] tracking-[-0.02em]">{fmtUsd(p.totals.spotValue)}</div>
        </div>
        <div className="panel px-5 py-3.5">
          <div className="text-[12.5px] text-muted">PnL nerealizat (futures)</div>
          <div className={clsx('num mt-0.5 text-[24px] tracking-[-0.02em]', pnlClass(p.totals.unrealizedPnl))}>{fmtUsd(p.totals.unrealizedPnl)}</div>
        </div>
        <div className="text-[12px] text-faint">
          Cont {p.mode === 'unified' ? 'unificat (UTA)' : p.mode === 'classic' ? 'clasic' : 'necunoscut'}, actualizat {fmtAgo(p.fetchedAt)}
        </div>
        <button className="btn ml-auto" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw size={14} className={clsx(refresh.isPending && 'animate-spin')} aria-hidden /> Reîmprospătează
        </button>
      </div>
      {errs.length > 0 && (
        <Warning>
          {errs.map(([k, v]) => {
            const staleAt = p.stale[k as keyof Portfolio['stale']];
            const code = v?.code ?? 'EXCHANGE';
            return (
              <div key={k} title={v?.message}>
                {SECTION_RO[k] ?? k}: {CODE_RO[code] ?? CODE_RO.EXCHANGE}
                {SHOW_RAW.has(code) && v?.message ? ` (${v.message})` : ''}
                {staleAt ? `; se afișează datele din ${fmtDateTime(staleAt, tz)}` : ''}
              </div>
            );
          })}
        </Warning>
      )}

      <Panel title="Poziții futures deschise" icon={ChartCandlestick} flush>
        {p.positions.length === 0 ? (
          <div>
            <Empty>Nicio poziție futures deschisă.</Empty>
          </div>
        ) : (
          <table className="table">
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
              </tr>
            </thead>
            <tbody>
              {p.positions.map((pos) => {
                const d = autoDigits(pos.entryPrice ?? pos.markPrice ?? 1);
                const [base, quoteFull] = pos.symbol.split('/');
                return (
                  <tr key={`${pos.symbol}-${pos.side}`}>
                    <td>
                      <Link to={`/charts/${base}/${(quoteFull ?? 'USDT').split(':')[0]}`} className="inline-flex items-center gap-2 font-semibold text-text">
                        {base && <CoinLogo coin={base} size={18} />}
                        {pos.symbol}
                      </Link>
                      {pos.marginMode && <span className="ml-1 text-[12px] text-faint">{pos.marginMode}</span>}
                    </td>
                    <td className={pos.side === 'long' ? 'text-bull' : 'text-bear'}>{pos.side === 'long' ? 'Long' : pos.side === 'short' ? 'Short' : pos.side}</td>
                    <td className="num text-right">{fmtNum(pos.size ?? pos.contracts, 6)}</td>
                    <td className="num text-right">{fmtPrice(pos.entryPrice, d)}</td>
                    <td className="num text-right">{fmtPrice(pos.markPrice, d)}</td>
                    <td className={clsx('num text-right', pnlClass(pos.unrealizedPnl))}>
                      {fmtNum(pos.unrealizedPnl, 2)} <span className="text-[12px]">{fmtPct(pos.percentage)}</span>
                    </td>
                    <td className="num text-right text-warn">{fmtPrice(pos.liquidationPrice, d)}</td>
                    <td className="num text-right">{pos.leverage ? `${fmtNum(pos.leverage, 1)}×` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Dețineri spot" icon={Coins} flush>
        {p.balances.length === 0 ? (
          <div>
            <Empty>Niciun sold.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Activ</th>
                <th>Cont</th>
                <th className="text-right">Cantitate</th>
                <th className="text-right">Preț</th>
                <th className="text-right">Valoare</th>
                <th className="text-right">Preț mediu</th>
                <th className="text-right">PnL estimat</th>
              </tr>
            </thead>
            <tbody>
              {p.balances.map((b) => {
                const d = autoDigits(b.price ?? 1);
                return (
                  <tr key={`${b.account}-${b.asset}`}>
                    <td className="font-semibold">
                      <span className="inline-flex items-center gap-2">
                        <CoinLogo coin={b.asset} size={18} />
                        {b.asset}
                      </span>
                    </td>
                    <td className="text-[12px] text-muted">{b.account}</td>
                    <td className="num text-right">
                      {fmtNum(b.total, 8)}
                      {b.used > 0 && <div className="text-[11.5px] text-faint">{fmtNum(b.used, 8)} în ordine</div>}
                    </td>
                    <td className="num text-right">{fmtPrice(b.price, d)}</td>
                    <td className="num text-right">{fmtUsd(b.value)}</td>
                    <td className="num text-right">
                      {b.avgPrice !== null ? fmtPrice(b.avgPrice, d) : <span className="text-faint">necunoscut</span>}
                      {b.avgSource === 'manual' && <div className="text-[11px] text-faint">setat manual</div>}
                      {!['USDT', 'USDC', 'USD', 'DAI', 'FDUSD'].includes(b.asset) && (
                        <div>
                          <CostBasisEditor accountId={account.id} row={b} />
                        </div>
                      )}
                    </td>
                    <td className={clsx('num text-right', pnlClass(b.pnl))}>
                      {b.pnl !== null ? (
                        <>
                          {fmtUsd(b.pnl)} <span className="text-[12px]">{fmtPct(b.pnlPct)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
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
          <table className="table">
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
              </tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={`${o.market}-${o.id}`}>
                  <td className="font-semibold">
                    <span className="inline-flex items-center gap-2">
                      <CoinLogo coin={o.symbol.split('/')[0] ?? o.symbol} size={18} />
                      {o.symbol}
                    </span>
                  </td>
                  <td className="text-muted">{o.market === 'spot' ? 'Spot' : 'Futures'}</td>
                  <td>
                    {o.type}
                    {o.reduceOnly && <span className="ml-1 text-[12px] text-faint">reduce-only</span>}
                  </td>
                  <td className={o.side === 'buy' ? 'text-bull' : 'text-bear'}>{o.side === 'buy' ? 'Cumpărare' : 'Vânzare'}</td>
                  <td className="num text-right">{fmtPrice(o.price, autoDigits(o.price ?? 1))}</td>
                  <td className="num text-right">{o.triggerPrice ? fmtPrice(o.triggerPrice, autoDigits(o.triggerPrice)) : '—'}</td>
                  <td className="num text-right">
                    {fmtNum(o.amount, 8)}
                    {o.filled ? <div className="text-[11.5px] text-faint">{fmtNum(o.filled, 8)} executat</div> : null}
                  </td>
                  <td className="num text-[12px] text-muted">{o.timestamp ? fmtDateTime(o.timestamp, tz) : '—'}</td>
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
                      <CoinLogo coin={f.symbol.split('/')[0] ?? f.symbol} size={16} />
                      {f.symbol}
                    </span>{' '}
                    <span className="text-[12px] text-faint">{f.market === 'spot' ? 'spot' : 'futures'}</span>
                  </td>
                  <td className={f.side === 'buy' ? 'text-bull' : 'text-bear'}>{f.side === 'buy' ? 'Cumpărare' : 'Vânzare'}</td>
                  <td className="num text-right">{fmtPrice(f.price, autoDigits(f.price))}</td>
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
  if (!accounts.data && !accounts.isError) return <Loading />;
  if (!accounts.data) return <ErrorNote error={accounts.error} onRetry={() => accounts.refetch()} />;
  const list = accounts.data;
  if (list.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Tranzacții</h1>
      <Panel title="Tranzacțiile tale" icon={Wallet}>
        <div className="max-w-[70ch] space-y-3 text-[14px]">
          <p>Conectează un cont KuCoin ca să vezi pozițiile, deținerile și ordinele deschise. Kryptoniq doar citește date: nu poate plasa, modifica sau anula ordine.</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Pe KuCoin: Profil, apoi API Management, apoi Create API.</li>
            <li>Bifează doar permisiunea „General” (citire). Nu bifa Spot/Futures trading, Transfer sau Withdrawal.</li>
            <li>Opțional, restricționează cheia la IP-ul tău.</li>
            <li>Copiază API Key, Secret și Passphrase în Setări, la Conturi exchange.</li>
          </ol>
          <Link to="/settings#accounts" className="btn btn-primary no-underline">
            Adaugă un cont
          </Link>
        </div>
      </Panel>
      </div>
    );
  }
  const current = list.find((a) => a.id === selected) ?? list[0]!;
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">Tranzacții</h1>
        <div className="seg" role="group" aria-label="Cont">
          {list.map((a) => (
            <button key={a.id} type="button" aria-pressed={a.id === current.id} onClick={() => setSelected(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {current.permissionWarning && (
        <Warning>
          Cheia „{current.label}” are permisiuni în plus față de citire ({current.permissions}). Recomandat: creează o cheie doar cu „General”.
        </Warning>
      )}
      {current.lastError && <Warning>Ultima eroare: {current.lastError}</Warning>}
      <PortfolioView key={current.id} account={current} />
    </div>
  );
}
