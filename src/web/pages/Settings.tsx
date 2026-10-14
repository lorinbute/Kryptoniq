// Setări → Ale mele (FD-ADMINSET, FD-MARKETSRC): each user's own settings. The admin also gets the tab of everyone's
// (SettingsAdmin). Where prices come from is not a setting here: the connected exchange decides (a choice from two up).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, GripVertical, KeyRound, Plus, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import type { AccountView, StockSearchHit, SymbolInfo, WatchItem } from '../../shared/api-types.ts';
import type { SettingsView } from '../../shared/settings.ts';
import { api, errorMessage, qs } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { invalidatePriceSource, useHashScroll, useMarketSource, useSaveSettings, useSettings, useWatchlist } from '../hooks.ts';
import { useIsAdmin } from '../auth.ts';
import { ErrorNote, Loading, Panel } from '../components/ui.tsx';
import { CoinLogo } from '../components/icons.tsx';
import { AccountWizard } from '../components/AccountWizard.tsx';
import { FavoritesDnd, SortableFavorite } from '../components/SortableFavorites.tsx';
import { ProviderLogo } from '../components/ProviderLogo.tsx';
import { SettingsTabs } from '../components/SettingsTabs.tsx';
import { providerById } from '../../shared/providers.ts';
import { plainSymbol, searchIndices } from '../../shared/indices.ts';

type WatchKind = 'crypto' | 'stock' | 'index';
const KIND_LABEL: Record<WatchKind, string> = { crypto: 'Crypto', stock: 'Acțiuni', index: 'Indici' };
interface AddHit {
  key: string;
  label: string;
  hint: string;
  body: object;
  coin: string;
  stock: boolean;
}

function WatchlistSection() {
  const qc = useQueryClient();
  const wl = useWatchlist();
  const [kind, setKind] = useState<WatchKind>('crypto');
  const [q, setQ] = useState('');
  const term = q.trim();
  const pairs = useQuery({ queryKey: ['symbols', term], queryFn: () => api.get<SymbolInfo[]>(`/api/market/symbols${qs({ q: term })}`), enabled: kind === 'crypto' && term.length >= 1, staleTime: 5 * 60_000 });
  const stocks = useQuery({
    queryKey: ['stocks', 'search', term],
    queryFn: () => api.get<StockSearchHit[]>(`/api/stocks/search${qs({ q: term })}`),
    enabled: kind === 'stock' && term.length >= 1,
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Several changes at once (the index list invites quick clicks) are answered in any order: an answer is shown only
  // while it is the only change under way, and the list is read again once the last one is done.
  const pending = useRef(0);
  const done = (data: WatchItem[]) => {
    if (pending.current <= 1) qc.setQueryData(['watchlist'], data);
    void qc.invalidateQueries({ queryKey: ['scanner'] });
    void qc.invalidateQueries({ queryKey: ['news'] });
    void qc.invalidateQueries({ queryKey: ['sources'] });
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const tracked = {
    onMutate: () => {
      pending.current++;
    },
    onSuccess: done,
    onSettled: () => {
      pending.current--;
      if (pending.current === 0) void qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  };
  const add = useMutation({ mutationFn: (body: object) => api.post<WatchItem[]>('/api/watchlist', body), ...tracked });
  const remove = useMutation({ mutationFn: (coin: string) => api.del<WatchItem[]>(`/api/watchlist/${encodeURIComponent(coin)}`), ...tracked });
  const aliases = useMutation({ mutationFn: ({ coin, list }: { coin: string; list: string[] }) => api.put<WatchItem[]>(`/api/watchlist/${encodeURIComponent(coin)}`, { aliases: list }), ...tracked });
  const items = wl.data ?? [];
  const hits: AddHit[] | null =
    kind === 'index'
      ? null
      : kind === 'crypto'
      ? (pairs.data?.map((r) => ({ key: r.symbol, label: r.symbol, hint: '', body: { kind: 'crypto', coin: r.base, quote: r.quote }, coin: r.base, stock: false })) ?? null)
      : (stocks.data?.map((r) => ({
          key: r.symbol,
          label: r.symbol,
          hint: [r.name, r.exchange].filter(Boolean).join(' · '),
          body: { kind: 'stock', coin: r.symbol, name: r.name, exchange: r.exchange || undefined },
          coin: r.symbol,
          stock: true,
        })) ?? null);
  const searching = kind === 'crypto' ? pairs : stocks;
  const err = add.error ?? remove.error ?? aliases.error;
  return (
    <Panel id="watchlist" title="Favorite" icon={Star}>
      {/* The whole width of the panel (FD-TRADESTATS §4): a narrower column broke it into four short lines. */}
      <p className="mb-3 text-[13px] text-muted">
        Monede, acțiuni și indici care apar în bandă, în Azi, în scanner, pe grafice și în filtrul de știri. Aliasurile ajută la recunoașterea lor în titluri (ex. „Render Network”
        pentru RNDR, „iPhone” pentru AAPL); la acțiuni și la indici, numele se adaugă singur.
      </p>
      {!wl.data && !wl.isError ? (
        <Loading />
      ) : (
        // Drag a row by its handle, or use the arrows / Alt + ↑↓ (FD-CHARTFAV §2).
        <FavoritesDnd ids={items.map((w) => w.coin)} layout="rows">
          {(order) => (
            <div className="table-bleed mb-3 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ordine</th>
                    <th>Simbol</th>
                    <th>Tip</th>
                    <th>Pereche / bursă</th>
                    <th>Aliasuri în știri (separate prin virgulă)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((w, i) => (
                    <SortableFavorite key={w.coin} id={w.coin}>
                      {(srt) => (
                        // Centred vertically (FD-UIPOLISH): the alias field is taller than the text beside it. Icons and the
                        // symbol sit in flex boxes (FD-ROWCENTER): inline, they rode the text's baseline, ~3 px high.
                        <tr ref={srt.setNodeRef} style={srt.style} className={clsx('[&>td]:align-middle', srt.isDragging && 'bg-panel-2 shadow-drag')}>
                          <td className="w-28 whitespace-nowrap">
                            <div className="flex items-center">
                              <button
                                ref={srt.setActivatorNodeRef}
                                {...srt.attributes}
                                {...srt.listeners}
                                type="button"
                                className="cursor-grab text-faint transition-colors hover:text-accent active:cursor-grabbing"
                                aria-label={`Trage ca să muți ${plainSymbol(w.coin)}`}
                                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                                title="Trage ca să muți"
                                onKeyDown={order.keyMove(w.coin, 'y')}
                              >
                                <GripVertical size={15} aria-hidden />
                              </button>
                              <button className="ml-1.5 text-muted transition-colors hover:text-accent" aria-label={`Mută ${plainSymbol(w.coin)} mai sus`} onClick={() => order.move(w.coin, -1)} disabled={i === 0}>
                                <ArrowUp size={14} aria-hidden />
                              </button>
                              <button className="ml-1 text-muted transition-colors hover:text-accent" aria-label={`Mută ${plainSymbol(w.coin)} mai jos`} onClick={() => order.move(w.coin, 1)} disabled={i === items.length - 1}>
                                <ArrowDown size={14} aria-hidden />
                              </button>
                            </div>
                          </td>
                          <td className="font-semibold">
                            <div className="flex min-w-0 items-center gap-2">
                              <CoinLogo coin={w.coin} size={18} badge={w.kind === 'stock'} square={w.kind === 'stock'} />
                              {plainSymbol(w.coin)}
                              {w.name && <span className="max-w-[200px] truncate font-normal text-faint">{w.name}</span>}
                            </div>
                          </td>
                          <td className="text-muted">{w.kind === 'stock' ? 'Acțiune' : w.kind === 'index' ? 'Indice' : 'Crypto'}</td>
                          <td className="text-muted">{w.kind === 'stock' ? (w.exchange ?? 'SUA') : w.kind === 'index' ? 'indice SUA' : `${w.coin}/${w.quote}`}</td>
                          <td>
                            <AliasInput initial={w.aliases} onSave={(list) => aliases.mutate({ coin: w.coin, list })} label={plainSymbol(w.coin)} />
                          </td>
                          <td>
                            <div className="flex justify-end">
                              <button className="text-faint hover:text-bear" aria-label={`Șterge ${plainSymbol(w.coin)}`} onClick={() => remove.mutate(w.coin)}>
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </SortableFavorite>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FavoritesDnd>
      )}
      {/* One height for the switch and the search field, on every screen (FD-UIPOLISH): the row stretches both. */}
      <div className="flex flex-wrap items-stretch gap-2.5">
        <div className="seg" role="group" aria-label="Tipul favoritei">
          {(['crypto', 'stock', 'index'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setQ('');
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="relative w-80 max-w-full">
          <input
            aria-label={kind === 'crypto' ? 'Adaugă o monedă' : kind === 'stock' ? 'Adaugă o acțiune' : 'Caută un indice'}
            placeholder={kind === 'crypto' ? 'Adaugă o monedă, ex. SOL' : kind === 'stock' ? 'Adaugă o acțiune, ex. AAPL sau Apple' : 'Caută un indice, ex. SPX sau Dow'}
            value={q}
            onChange={(e) => setQ(kind === 'crypto' ? e.target.value.toUpperCase() : e.target.value)}
            className="h-full w-full"
          />
          {term && (hits || searching.isError) && (
            <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-panel-2 py-1 shadow-pop">
              {searching.isError && <li className="px-3 py-1.5 text-[13px] text-bear">{errorMessage(searching.error)}</li>}
              {hits?.length === 0 && <li className="px-3 py-1.5 text-[13px] text-faint">{kind === 'crypto' ? 'Nicio pereche cu acest simbol' : 'Nicio acțiune din SUA cu acest nume'}</li>}
              {hits?.map((h) => (
                <li key={h.key}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-hover"
                    onClick={() => {
                      add.mutate(h.body);
                      setQ('');
                    }}
                  >
                    {h.stock && <CoinLogo coin={h.coin} size={16} badge square />}
                    <span className="font-medium">{h.label}</span>
                    {h.hint && <span className="min-w-0 truncate text-faint">{h.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {kind === 'index' && <IndexPicker term={term} have={new Set(items.map((w) => w.coin))} onPick={(id) => add.mutate({ kind: 'index', coin: id })} />}
      {err && <div className="mt-2 text-[13px] text-bear">{errorMessage(err)}</div>}
    </Panel>
  );
}

/** FD-INDICES: the indices one can add, all shown at once (there are seven) and narrowed by the field above. */
function IndexPicker({ term, have, onPick }: { term: string; have: ReadonlySet<string>; onPick: (id: string) => void }) {
  const list = searchIndices(term);
  if (list.length === 0) return <p className="mt-2.5 text-[13px] text-faint">Niciun indice cu acest nume. Sunt disponibili doar indicii americani din listă.</p>;
  return (
    <ul className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Indici disponibili">
      {list.map((i) => {
        const added = have.has(i.id);
        return (
          <li key={i.id}>
            <button
              type="button"
              disabled={added}
              onClick={() => onPick(i.id)}
              className="flex w-full items-center gap-2.5 rounded-[10px] border border-line px-3 py-2 text-left text-[13px] transition-colors hover:border-accent hover:bg-hover-soft disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-transparent"
            >
              <CoinLogo coin={i.id} size={18} />
              <span className="font-semibold">{i.symbol}</span>
              <span className="min-w-0 truncate text-muted">{i.name}</span>
              {added ? <span className="ml-auto shrink-0 text-[12px] text-faint">în favorite</span> : <Plus size={14} aria-hidden className="ml-auto shrink-0 text-faint" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AliasInput({ initial, onSave, label }: { initial: string[]; onSave: (list: string[]) => void; label: string }) {
  const [v, setV] = useState(initial.join(', '));
  // Only reset the field when the saved aliases really change (not on every refetch, mid-typing).
  const saved = initial.join(', ');
  useEffect(() => setV(saved), [saved]);
  const commit = () => {
    const list = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);
    if (list.join(',') !== initial.join(',')) onSave(list);
  };
  return <input aria-label={`Aliasuri pentru ${label}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="block w-full" />;
}

/**
 * FD-MARKETSRC §2: with two or more exchanges that can give prices, the user picks the one their charts, strip and
 * signals use. With one (or none) there is nothing to choose: it is that one (or the admin's default).
 */
function PriceSourceChoice() {
  const qc = useQueryClient();
  const src = useMarketSource();
  const save = useSaveSettings();
  const list = src.data?.connected ?? [];
  if (list.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
      <span className="text-muted">Prețurile crypto vin de la:</span>
      <div className="seg" role="group" aria-label="Prețurile crypto vin de la">
        {list.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={src.data?.userExchange === id}
            disabled={save.isPending}
            onClick={() => save.mutate({ market: { exchange: id } }, { onSuccess: () => invalidatePriceSource(qc) })}
          >
            <span className="inline-flex items-center gap-1.5">
              <ProviderLogo id={id} size={16} />
              {providerById(id)?.name ?? id}
            </span>
          </button>
        ))}
      </div>
      <span className="text-[12px] text-faint">Graficele, banda de sus și semnalele de pe Azi folosesc prețurile lui.</span>
      {save.error && <span className="text-bear">{errorMessage(save.error)}</span>}
    </div>
  );
}

/** The user's accounts (the section and the page's anchor scroll share the query). */
const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts') });

function AccountsSection() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [wizard, setWizard] = useState(false);
  const closeWizard = useCallback(() => setWizard(false), []);
  const test = useMutation({ mutationFn: (id: number) => api.post<AccountView>(`/api/accounts/${id}/test`), onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
      invalidatePriceSource(qc);
    },
  });
  const list = accounts.data ?? [];
  return (
    <Panel
      title="Conturi (exchange-uri și brokeri)"
      icon={KeyRound}
      actions={
        <button className="btn btn-primary" onClick={() => setWizard(true)}>
          <Plus size={15} aria-hidden /> Adaugă un cont
        </button>
      }
    >
      <div id="accounts" className="flex flex-col gap-3 text-[13px]">
        <p className="max-w-[75ch] text-muted">
          Exchange-uri crypto și brokeri de acțiuni, cu chei doar pentru citire. Cheile se salvează criptat în baza Sentiq și nu mai sunt afișate după salvare.
        </p>
        {accounts.isError && <ErrorNote error={accounts.error} onRetry={() => accounts.refetch()} />}
        {accounts.data && list.length === 0 && <p className="text-faint">Niciun cont conectat încă.</p>}
        {list.map((a) => {
          const provider = providerById(a.exchange);
          const envLabel = provider?.envs?.find((e) => e.id === a.env)?.label;
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3.5 py-2.5">
              <ProviderLogo id={a.exchange} size={28} />
              <span className="flex min-w-0 flex-col">
                <strong className="truncate">{a.label}</strong>
                <span className="text-[12px] text-faint">
                  {provider?.name ?? a.exchange}
                  {envLabel && a.env !== provider?.envs?.[0]?.id ? `, ${envLabel}` : ''}
                </span>
              </span>
              <span className="num text-faint">{a.keyHint}</span>
              {a.lastError ? <span className="text-bear">{a.lastError}</span> : a.lastOkAt ? <span className="text-bull">conectat {fmtAgo(a.lastOkAt)}</span> : null}
              {a.permissionWarning && <span className="text-warn">permisiuni în plus față de citire: {a.permissions}</span>}
              <span className="ml-auto flex gap-2">
                <button className="btn" onClick={() => test.mutate(a.id)} disabled={test.isPending}>
                  Testează
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (window.confirm(`Ștergi contul „${a.label}”? Cheile lui se șterg din Sentiq.`)) remove.mutate(a.id);
                  }}
                >
                  Șterge
                </button>
              </span>
            </div>
          );
        })}
        {(remove.error || test.error) && <div className="text-bear">{errorMessage(remove.error ?? test.error)}</div>}
        <PriceSourceChoice />
      </div>
      {wizard && <AccountWizard onClose={closeWizard} />}
    </Panel>
  );
}

function GeneralSection({ s }: { s: SettingsView }) {
  const save = useSaveSettings();
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.timezone];
  return (
    <Panel id="general" title="General" icon={SlidersHorizontal}>
      <div className="flex flex-wrap items-end gap-4 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-faint">Fus orar (definește „ziua” pentru sentiment)</span>
          <select value={s.timezone} onChange={(e) => save.mutate({ timezone: e.target.value })} className="w-64">
            {(zones.includes(s.timezone) ? zones : [s.timezone, ...zones]).map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
      </div>
      {save.error && <div className="mt-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const admin = useIsAdmin();
  const watchlist = useWatchlist();
  const accounts = useAccounts();
  // Links such as /settings#market land on their section once the lists above it are drawn.
  useHashScroll(Boolean(settings.data) && !watchlist.isPending && !accounts.isPending);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Setări</h1>
      {/* FD-ADMINSET: everyone's settings (sources, sentiment, keys, retention, mail) are on the admin's own tab. */}
      {admin && <SettingsTabs />}
      {!settings.data && !settings.isError ? (
        <Loading />
      ) : !settings.data ? (
        <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
          <WatchlistSection />
          <AccountsSection />
          <GeneralSection s={settings.data} />
        </>
      )}
    </div>
  );
}
