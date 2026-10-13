import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Brain, ChartLine, GripVertical, KeyRound, Mail, Plus, Rss, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import type { AccountView, FeedTest, Health, SourceRow, StockSearchHit, SymbolInfo, WatchItem } from '../../shared/api-types.ts';
import { CANDLE_COUNTS, CLAUDE_MODELS, MARKET_EXCHANGES, type SettingsView } from '../../shared/settings.ts';
import { TIMEFRAMES } from '../../shared/time.ts';
import { api, errorMessage, qs } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { useSettings, useStocksInfo, useWatchlist } from '../hooks.ts';
import { useIsAdmin } from '../auth.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { CoinLogo } from '../components/icons.tsx';
import { AccountWizard } from '../components/AccountWizard.tsx';
import { FavoritesDnd, SortableFavorite } from '../components/SortableFavorites.tsx';
import { ProviderLogo } from '../components/ProviderLogo.tsx';
import { providerById } from '../../shared/providers.ts';

const CAT_RO: Record<string, string> = { crypto: 'Crypto', macro: 'Macro', geopolitics: 'Geopolitică', stocks: 'Acțiuni' };

function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: unknown) => api.put<SettingsView>('/api/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['sentiment'] });
      void qc.invalidateQueries({ queryKey: ['scanner'] });
    },
  });
}

type WatchKind = 'crypto' | 'stock';
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
  const done = (data: WatchItem[]) => {
    qc.setQueryData(['watchlist'], data);
    void qc.invalidateQueries({ queryKey: ['scanner'] });
    void qc.invalidateQueries({ queryKey: ['news'] });
    void qc.invalidateQueries({ queryKey: ['sources'] });
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const add = useMutation({ mutationFn: (body: object) => api.post<WatchItem[]>('/api/watchlist', body), onSuccess: done });
  const remove = useMutation({ mutationFn: (coin: string) => api.del<WatchItem[]>(`/api/watchlist/${encodeURIComponent(coin)}`), onSuccess: done });
  const aliases = useMutation({ mutationFn: ({ coin, list }: { coin: string; list: string[] }) => api.put<WatchItem[]>(`/api/watchlist/${encodeURIComponent(coin)}`, { aliases: list }), onSuccess: done });
  const items = wl.data ?? [];
  const hits: AddHit[] | null =
    kind === 'crypto'
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
    <Panel title="Favorite" icon={Star}>
      <p className="mb-3 max-w-[75ch] text-[13px] text-muted">
        Monede și acțiuni care apar în bandă, în Azi, în scanner, pe grafice și în filtrul de știri. Aliasurile ajută la recunoașterea lor în titluri (ex. „Render Network” pentru RNDR,
        „iPhone” pentru AAPL); la acțiuni, numele companiei se adaugă singur.
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
                        <tr ref={srt.setNodeRef} style={srt.style} className={clsx(srt.isDragging && 'bg-panel-2 shadow-drag')}>
                          <td className="w-28 whitespace-nowrap">
                            <button
                              ref={srt.setActivatorNodeRef}
                              {...srt.attributes}
                              {...srt.listeners}
                              type="button"
                              className="cursor-grab align-middle text-faint transition-colors hover:text-accent active:cursor-grabbing"
                              aria-label={`Trage ca să muți ${w.coin}`}
                              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                              title="Trage ca să muți"
                              onKeyDown={order.keyMove(w.coin, 'y')}
                            >
                              <GripVertical size={15} aria-hidden />
                            </button>
                            <button className="ml-1.5 text-muted transition-colors hover:text-accent" aria-label={`Mută ${w.coin} mai sus`} onClick={() => order.move(w.coin, -1)} disabled={i === 0}>
                              <ArrowUp size={14} aria-hidden />
                            </button>
                            <button className="ml-1 text-muted transition-colors hover:text-accent" aria-label={`Mută ${w.coin} mai jos`} onClick={() => order.move(w.coin, 1)} disabled={i === items.length - 1}>
                              <ArrowDown size={14} aria-hidden />
                            </button>
                          </td>
                          <td className="font-semibold">
                            <span className="inline-flex items-center gap-2">
                              <CoinLogo coin={w.coin} size={18} badge={w.kind === 'stock'} square={w.kind === 'stock'} />
                              {w.coin}
                              {w.name && <span className="max-w-[200px] truncate font-normal text-faint">{w.name}</span>}
                            </span>
                          </td>
                          <td className="text-muted">{w.kind === 'stock' ? 'Acțiune' : 'Crypto'}</td>
                          <td className="text-muted">{w.kind === 'stock' ? (w.exchange ?? 'SUA') : `${w.coin}/${w.quote}`}</td>
                          <td>
                            <AliasInput initial={w.aliases} onSave={(list) => aliases.mutate({ coin: w.coin, list })} label={w.coin} />
                          </td>
                          <td className="text-right">
                            <button className="text-faint hover:text-bear" aria-label={`Șterge ${w.coin}`} onClick={() => remove.mutate(w.coin)}>
                              <Trash2 size={14} aria-hidden />
                            </button>
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
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="seg" role="group" aria-label="Tipul favoritei">
          {(['crypto', 'stock'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setQ('');
              }}
            >
              {k === 'crypto' ? 'Crypto' : 'Acțiuni'}
            </button>
          ))}
        </div>
        <div className="relative w-80 max-w-full">
          <input
            aria-label={kind === 'crypto' ? 'Adaugă o monedă' : 'Adaugă o acțiune'}
            placeholder={kind === 'crypto' ? 'Adaugă o monedă, ex. SOL' : 'Adaugă o acțiune, ex. AAPL sau Apple'}
            value={q}
            onChange={(e) => setQ(kind === 'crypto' ? e.target.value.toUpperCase() : e.target.value)}
            className="w-full"
          />
          {term && (hits || searching.isError) && (
            <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-panel-2 py-1 shadow-pop">
              {searching.isError && <li className="px-3 py-1.5 text-[13px] text-bear">{errorMessage(searching.error)}</li>}
              {hits?.length === 0 && <li className="px-3 py-1.5 text-[13px] text-faint">{kind === 'crypto' ? 'Nicio pereche pe exchange-ul de date' : 'Nicio acțiune din SUA cu acest nume'}</li>}
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
      {err && <div className="mt-2 text-[13px] text-bear">{errorMessage(err)}</div>}
    </Panel>
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
  return <input aria-label={`Aliasuri pentru ${label}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="w-full" />;
}

function SourcesSection() {
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get<SourceRow[]>('/api/sources') });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: object }) => api.put(`/api/sources/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sources'] });
      void qc.invalidateQueries({ queryKey: ['news'] });
      void qc.invalidateQueries({ queryKey: ['sentiment'] });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/sources/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }) });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'crypto' | 'macro' | 'geopolitics' | 'stocks'>('crypto');
  const [test, setTest] = useState<FeedTest | null>(null);
  const testFeed = useMutation({ mutationFn: () => api.post<FeedTest>('/api/sources/test', { url }), onSuccess: setTest });
  const add = useMutation({
    mutationFn: () => api.post('/api/sources', { name, url, category }),
    onSuccess: () => {
      setName('');
      setUrl('');
      setTest(null);
      void qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
  return (
    <Panel title="Surse de știri" icon={Rss} bodyClass="pb-4">
      {!sources.data && !sources.isError ? (
        <div className="px-5">
          <Loading />
        </div>
      ) : !sources.data ? (
        <div className="px-5">
          <ErrorNote error={sources.error} />
        </div>
      ) : (
        <div className="panel-flush overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Activă</th>
                <th>Sursă</th>
                <th>Categorie</th>
                <th>Pondere în sentiment</th>
                <th>Stare</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.data.map((s) => (
                <tr key={s.id} className={clsx(!s.enabled && 'text-faint')}>
                  <td>
                    <input type="checkbox" aria-label={`Activează ${s.name}`} checked={s.enabled === 1} onChange={(e) => update.mutate({ id: s.id, patch: { enabled: e.target.checked } })} />
                  </td>
                  <td>
                    <div className="font-medium">
                      {s.name}
                      {s.auto && <span className="tag ml-1.5 align-middle font-normal" title="Adăugată și scoasă odată cu acțiunea din favorite">automată</span>}
                    </div>
                    <div className="max-w-[340px] truncate text-[12px] text-faint">{s.url}</div>
                  </td>
                  <td>{CAT_RO[s.category]}</td>
                  <td>
                    <select aria-label={`Pondere ${s.name}`} value={String(s.weight)} onChange={(e) => update.mutate({ id: s.id, patch: { weight: Number(e.target.value) } })}>
                      {[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5].map((w) => (
                        <option key={w} value={String(w)}>
                          {w.toFixed(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-[12px] whitespace-nowrap">
                    {s.last_error ? (
                      <span className="text-bear" title={s.last_error}>
                        Eroare ({s.failures}×)
                      </span>
                    ) : s.last_success_at ? (
                      <span className="text-muted">OK {fmtAgo(s.last_success_at)}</span>
                    ) : (
                      <span className="text-faint">încă neverificată</span>
                    )}
                    <div className="text-faint">{s.item_count} știri</div>
                  </td>
                  <td className="text-right">
                    {!s.builtin && (
                      <button className="text-faint hover:text-bear" aria-label={`Șterge ${s.name}`} onClick={() => remove.mutate(s.id)}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="mx-5 mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[200px_1fr_150px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-faint">Nume</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-faint">Adresa feed-ului RSS/Atom</span>
          <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/feed" />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-faint">Categorie</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            <option value="crypto">Crypto</option>
            <option value="macro">Macro / piețe</option>
            <option value="geopolitics">Geopolitică</option>
            <option value="stocks">Acțiuni</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="btn" disabled={!url || testFeed.isPending} onClick={() => testFeed.mutate()}>
            Testează
          </button>
          <button className="btn btn-primary" disabled={add.isPending || !name || !url}>
            Adaugă sursa
          </button>
        </div>
        {test && (
          <div className={clsx('text-[13px] md:col-span-4', test.ok ? 'text-muted' : 'text-bear')}>
            {test.ok ? `Feed valid, ${test.count} articole. Ultimele: ${test.sample.slice(0, 3).join('; ')}` : `Feed-ul nu poate fi citit: ${test.error}`}
          </div>
        )}
        {(add.error || update.error || remove.error) && <div className="text-[13px] text-bear md:col-span-4">{errorMessage(add.error ?? update.error ?? remove.error)}</div>}
      </form>
    </Panel>
  );
}

function SentimentSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 30_000, enabled: s.sentiment.engine === 'claude' });
  const save = useSaveSettings();
  const [key, setKey] = useState('');
  const setClaudeKey = useMutation({
    mutationFn: (k: string | null) => api.put<SettingsView>('/api/settings/claude-key', { key: k }),
    onSuccess: (data) => {
      setKey('');
      qc.setQueryData(['settings'], data);
    },
  });
  const rescore = useMutation({ mutationFn: () => api.post<{ reset: number }>('/api/sentiment/rescore', { hours: 48 }) });
  const recompute = useMutation({ mutationFn: () => api.post<{ finalized: string[] }>('/api/sentiment/recompute-history'), onSuccess: () => qc.invalidateQueries({ queryKey: ['sentiment'] }) });
  return (
    <Panel title="Motorul de sentiment" icon={Brain}>
      <div className="flex max-w-[75ch] flex-col gap-4 text-[13px]">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Motor</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="engine" checked={s.sentiment.engine === 'local'} onChange={() => save.mutate({ sentiment: { engine: 'local' } })} className="mt-1" />
            <span>
              <strong>Local</strong>: model AI pe Mac-ul tău plus reguli de piață. Gratuit și funcționează offline.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="engine"
              checked={s.sentiment.engine === 'claude'}
              onChange={() => save.mutate({ sentiment: { engine: 'claude' } })}
              className="mt-1"
            />
            <span>
              <strong>Claude</strong>: înțelege mai bine implicațiile macro. Trimite doar titlurile știrilor către Anthropic; costă câțiva cenți pe zi.
            </span>
          </label>
        </fieldset>
        {s.sentiment.engine === 'claude' && !s.claudeKeySet && <Warning>Fără cheie API se folosește în continuare motorul local.</Warning>}
        {health.data?.sentiment.claude?.lastError && (
          <Warning>
            Claude: {health.data.sentiment.claude.lastError.message}.{' '}
            {health.data.sentiment.claude.lastError.permanent ? 'Se folosește motorul local până când salvezi o cheie validă.' : 'Se folosește temporar motorul local; se reîncearcă automat.'}
          </Warning>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-faint">Model Claude</span>
            <select value={s.sentiment.claudeModel} onChange={(e) => save.mutate({ sentiment: { claudeModel: e.target.value } })}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m.includes('haiku') ? ' (cel mai ieftin)' : m.includes('opus') ? ' (cel mai capabil)' : ''}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) setClaudeKey.mutate(key.trim());
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-faint">Cheie API Anthropic {s.claudeKeySet && <>(salvată: {s.claudeKeyHint})</>}</span>
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" className="w-72 max-w-full" />
            </label>
            <button className="btn" disabled={!key.trim() || setClaudeKey.isPending}>
              Salvează cheia
            </button>
            {s.claudeKeySet && (
              <button type="button" className="btn btn-danger" onClick={() => setClaudeKey.mutate(null)}>
                Șterge cheia
              </button>
            )}
          </form>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => rescore.mutate()} disabled={rescore.isPending}>
            Rescorează ultimele 48 h
          </button>
          <button className="btn" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            Recalculează istoricul zilnic
          </button>
          {rescore.data && <span className="self-center text-muted">{rescore.data.reset} știri trimise la rescorare.</span>}
          {recompute.data && <span className="self-center text-muted">{recompute.data.finalized.length} zile recalculate.</span>}
        </div>
        {(save.error || setClaudeKey.error) && <div className="text-bear">{errorMessage(save.error ?? setClaudeKey.error)}</div>}
      </div>
    </Panel>
  );
}

function AccountsSection() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts') });
  const [wizard, setWizard] = useState(false);
  const closeWizard = useCallback(() => setWizard(false), []);
  const test = useMutation({ mutationFn: (id: number) => api.post<AccountView>(`/api/accounts/${id}/test`), onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
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
          Exchange-uri crypto și brokeri de acțiuni, cu chei doar pentru citire. Cheile se salvează criptat pe acest Mac și nu mai sunt afișate după salvare.
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
                    if (window.confirm(`Ștergi contul „${a.label}”? Cheile lui se șterg de pe acest Mac.`)) remove.mutate(a.id);
                  }}
                >
                  Șterge
                </button>
              </span>
            </div>
          );
        })}
        {(remove.error || test.error) && <div className="text-bear">{errorMessage(remove.error ?? test.error)}</div>}
      </div>
      {wizard && <AccountWizard onClose={closeWizard} />}
    </Panel>
  );
}

function TwelveDataKey({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const info = useStocksInfo();
  const [key, setKey] = useState('');
  const setTdKey = useMutation({
    mutationFn: (k: string | null) => api.put<SettingsView>('/api/settings/twelvedata-key', { key: k }),
    onSuccess: (data) => {
      setKey('');
      qc.setQueryData(['settings'], data);
      // Timeframes and sources of the stock charts change with the key.
      void qc.invalidateQueries({ queryKey: ['stocks'] });
      void qc.invalidateQueries({ queryKey: ['candles', 'stock'] });
    },
  });
  const b = info.data?.budget;
  return (
    <div className="mt-4 flex max-w-[75ch] flex-col gap-2 border-t border-line pt-4 text-[13px]">
      <p className="text-muted">
        <strong className="text-text">Acțiuni:</strong> graficele zilnice și săptămânale vin gratuit de la Nasdaq. Pentru timeframe-urile intraday (1m – 4h) pune cheia gratuită{' '}
        <a href="https://twelvedata.com/register" target="_blank" rel="noreferrer">
          Twelve Data
        </a>{' '}
        (după înregistrare, în pagina API Keys). Planul gratuit are 800 de cereri pe zi și 8 pe minut; aplicația le ține minte ca să nu le consume degeaba.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) setTdKey.mutate(key.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-faint">Cheie Twelve Data {s.twelveDataKeySet && <>(salvată: {s.twelveDataKeyHint})</>}</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cheia de 32 de caractere" className="w-72 max-w-full" />
        </label>
        <button className="btn" disabled={!key.trim() || setTdKey.isPending}>
          {setTdKey.isPending ? 'Se verifică…' : 'Verifică și salvează'}
        </button>
        {s.twelveDataKeySet && (
          <button type="button" className="btn btn-danger" onClick={() => setTdKey.mutate(null)} disabled={setTdKey.isPending}>
            Șterge cheia
          </button>
        )}
      </form>
      {s.twelveDataKeySet && b && (
        // Wraps on a phone (`.num` alone never breaks a line).
        <p className="num whitespace-normal text-faint">
          Consum azi (UTC): {b.used} / {b.perDay} cereri; în ultimul minut: {b.minuteUsed} / {b.perMinute}.
        </p>
      )}
      {setTdKey.error && <div className="text-bear">{errorMessage(setTdKey.error)}</div>}
    </div>
  );
}

function MarketSection({ s, admin }: { s: SettingsView; admin: boolean }) {
  const save = useSaveSettings();
  return (
    <Panel id="market" title="Date de piață și scanner" icon={ChartLine}>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-faint">Exchange pentru grafice</span>
          <select value={s.market.exchange} onChange={(e) => save.mutate({ market: { exchange: e.target.value } })}>
            {MARKET_EXCHANGES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Timeframe grafice (ultimul ales)</span>
          <select value={s.market.defaultTf} onChange={(e) => save.mutate({ market: { defaultTf: e.target.value } })}>
            {TIMEFRAMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Lumânări încărcate</span>
          <select value={String(s.market.candles)} onChange={(e) => save.mutate({ market: { candles: Number(e.target.value) } })}>
            {CANDLE_COUNTS.map((c) => (
              <option key={c} value={String(c)}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Timeframe scanner</span>
          <select value={s.scanner.tf} onChange={(e) => save.mutate({ scanner: { tf: e.target.value } })}>
            {TIMEFRAMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      {save.error && <div className="mt-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
      {admin ? (
        <TwelveDataKey s={s} />
      ) : (
        <p className="mt-4 max-w-[75ch] border-t border-line pt-4 text-[13px] text-muted">
          Acțiuni: graficele zilnice și săptămânale vin de la Nasdaq.{' '}
          {s.twelveDataKeySet ? 'Timeframe-urile intraday vin de la Twelve Data, cu cheia pusă de admin.' : 'Pentru timeframe-urile intraday, adminul poate pune o cheie Twelve Data.'}
        </p>
      )}
    </Panel>
  );
}

function GeneralSection({ s, admin }: { s: SettingsView; admin: boolean }) {
  const save = useSaveSettings();
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.timezone];
  const [days, setDays] = useState(String(s.retentionDays));
  useEffect(() => setDays(String(s.retentionDays)), [s.retentionDays]);
  return (
    <Panel title="General" icon={SlidersHorizontal}>
      <div className="flex flex-wrap items-end gap-4 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-faint">Fus orar (definește „ziua” pentru sentiment)</span>
          <select value={s.timezone} onChange={(e) => save.mutate({ timezone: e.target.value })} className="w-64">
            {(zones.includes(s.timezone) ? zones : [s.timezone, ...zones]).map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        {admin && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ retentionDays: Number(days) });
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-faint">Păstrează știrile (zile, pentru toți)</span>
              <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 text-right" />
            </label>
            <button className="btn">Salvează</button>
          </form>
        )}
      </div>
      {save.error && <div className="mt-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
    </Panel>
  );
}

/** Resend (FD-USERS §4): the key that sends the confirmation and password mails; the admin's alone. */
function EmailSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [from, setFrom] = useState(s.resendFrom ?? '');
  useEffect(() => setFrom(s.resendFrom ?? ''), [s.resendFrom]);
  const save = useMutation({
    mutationFn: (body: { key?: string | null; from?: string | null }) => api.put<SettingsView>('/api/settings/resend', body),
    onSuccess: (data) => {
      setKey('');
      qc.setQueryData(['settings'], data);
    },
  });
  return (
    <Panel title="Email (Resend)" icon={Mail}>
      <div className="flex max-w-[80ch] flex-col gap-3 text-[13px]">
        <p className="text-muted">
          Prin Resend pleacă linkurile de confirmare a contului și de parolă nouă. Fără cheie, linkurile apar doar în <code>data/logs</code>.
        </p>
        {s.resendDev && (
          <Warning>
            Expeditorul de test <code>onboarding@resend.dev</code> livrează doar la adresa contului Resend. Pentru ceilalți utilizatori ai nevoie de un domeniu verificat în Resend și un
            expeditor de pe el; până atunci, confirmă-le adresa din pagina Utilizatori.
          </Warning>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ ...(key.trim() ? { key: key.trim() } : {}), from: from.trim() || null });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-faint">Cheie API {s.resendKeySet && <>(salvată: {s.resendKeyHint})</>}</span>
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.resendKeySet ? 'lasă gol ca s-o păstrezi' : 're_…'} className="w-64 max-w-full" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">Expeditor</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="onboarding@resend.dev" className="w-72 max-w-full" maxLength={200} />
          </label>
          <button className="btn" disabled={save.isPending}>
            Salvează
          </button>
          {s.resendKeySet && (
            <button type="button" className="btn btn-danger" onClick={() => save.mutate({ key: null })} disabled={save.isPending}>
              Șterge cheia
            </button>
          )}
        </form>
        {save.isSuccess && <div className="text-bull">Salvat.</div>}
        {save.error && <div className="text-bear">{errorMessage(save.error)}</div>}
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const admin = useIsAdmin();
  const { hash } = useLocation();
  const ready = Boolean(settings.data);
  // Links such as /settings#market (from a stock chart) land on their section once the page has rendered.
  useEffect(() => {
    if (!ready || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [ready, hash]);
  if (!settings.data && !settings.isError) return <Loading />;
  if (!settings.data) return <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />;
  const s = settings.data;
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Setări</h1>
      <WatchlistSection />
      {/* FD-USERS §2: news sources, the sentiment engine, retention and the keys are everyone's: the admin's to set. */}
      {admin && <SourcesSection />}
      {admin && <SentimentSection s={s} />}
      <AccountsSection />
      <MarketSection s={s} admin={admin} />
      <GeneralSection s={s} admin={admin} />
      {admin && <EmailSection s={s} />}
    </div>
  );
}
