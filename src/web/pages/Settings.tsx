import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Brain, ChartLine, KeyRound, Rss, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import type { AccountView, FeedTest, Health, SourceRow, SymbolInfo, WatchItem } from '../../shared/api-types.ts';
import { CANDLE_COUNTS, CLAUDE_MODELS, MARKET_EXCHANGES, type SettingsView } from '../../shared/settings.ts';
import { TIMEFRAMES } from '../../shared/time.ts';
import { api, errorMessage, qs } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { useSettings, useWatchlist } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { CoinLogo } from '../components/icons.tsx';

const CAT_RO: Record<string, string> = { crypto: 'Crypto', macro: 'Macro', geopolitics: 'Geopolitică' };

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

function WatchlistSection() {
  const qc = useQueryClient();
  const wl = useWatchlist();
  const [q, setQ] = useState('');
  const results = useQuery({ queryKey: ['symbols', q], queryFn: () => api.get<SymbolInfo[]>(`/api/market/symbols${qs({ q })}`), enabled: q.length >= 1, staleTime: 5 * 60_000 });
  const done = (data: WatchItem[]) => {
    qc.setQueryData(['watchlist'], data);
    void qc.invalidateQueries({ queryKey: ['scanner'] });
    void qc.invalidateQueries({ queryKey: ['news'] });
  };
  const add = useMutation({ mutationFn: (s: SymbolInfo) => api.post<WatchItem[]>('/api/watchlist', { coin: s.base, quote: s.quote }), onSuccess: done });
  const remove = useMutation({ mutationFn: (coin: string) => api.del<WatchItem[]>(`/api/watchlist/${coin}`), onSuccess: done });
  const order = useMutation({ mutationFn: (coins: string[]) => api.put<WatchItem[]>('/api/watchlist/order', { coins }), onSuccess: done });
  const aliases = useMutation({ mutationFn: ({ coin, list }: { coin: string; list: string[] }) => api.put<WatchItem[]>(`/api/watchlist/${coin}`, { aliases: list }), onSuccess: done });
  const items = wl.data ?? [];
  const move = (i: number, d: number) => {
    const coins = items.map((w) => w.coin);
    const j = i + d;
    if (j < 0 || j >= coins.length) return;
    [coins[i], coins[j]] = [coins[j] as string, coins[i] as string];
    order.mutate(coins);
  };
  const err = add.error ?? remove.error ?? order.error ?? aliases.error;
  return (
    <Panel title="Monede favorite" icon={Star}>
      <p className="mb-3 max-w-[75ch] text-[13px] text-muted">
        Apar în scanner, pe grafice și în filtrul de știri. Aliasurile ajută la recunoașterea monedei în titluri (ex. „Render Network” pentru RNDR).
      </p>
      {!wl.data && !wl.isError ? (
        <Loading />
      ) : (
        <div className="mb-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Ordine</th>
              <th>Monedă</th>
              <th>Pereche</th>
              <th>Aliasuri în știri (separate prin virgulă)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((w, i) => (
              <tr key={w.coin}>
                <td className="w-20">
                  <button className="text-muted hover:text-text" aria-label={`Mută ${w.coin} mai sus`} onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp size={14} aria-hidden />
                  </button>
                  <button className="ml-1 text-muted hover:text-text" aria-label={`Mută ${w.coin} mai jos`} onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                    <ArrowDown size={14} aria-hidden />
                  </button>
                </td>
                <td className="font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <CoinLogo coin={w.coin} size={18} />
                    {w.coin}
                  </span>
                </td>
                <td className="text-muted">
                  {w.coin}/{w.quote}
                </td>
                <td>
                  <AliasInput initial={w.aliases} onSave={(list) => aliases.mutate({ coin: w.coin, list })} label={w.coin} />
                </td>
                <td className="text-right">
                  <button className="text-faint hover:text-bear" aria-label={`Șterge ${w.coin}`} onClick={() => remove.mutate(w.coin)}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div className="relative w-72 max-w-full">
        <input aria-label="Adaugă o monedă" placeholder="Adaugă o monedă, ex. SOL" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} className="w-full" />
        {q && results.data && (
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-panel-2 py-1 shadow-lg">
            {results.data.length === 0 && <li className="px-3 py-1.5 text-[13px] text-faint">Nicio pereche pe exchange-ul de date</li>}
            {results.data.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-panel"
                  onClick={() => {
                    add.mutate(r);
                    setQ('');
                  }}
                >
                  {r.symbol}
                </button>
              </li>
            ))}
          </ul>
        )}
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
  const [category, setCategory] = useState<'crypto' | 'macro' | 'geopolitics'>('crypto');
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
                    <div className="font-medium">{s.name}</div>
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
  const [form, setForm] = useState({ label: '', apiKey: '', secret: '', password: '' });
  const add = useMutation({
    mutationFn: () => api.post<AccountView>('/api/accounts', { exchange: 'kucoin', ...form }),
    onSuccess: () => {
      setForm({ label: '', apiKey: '', secret: '', password: '' });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
  const test = useMutation({ mutationFn: (id: number) => api.post<AccountView>(`/api/accounts/${id}/test`), onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
  return (
    <Panel title="Conturi exchange" icon={KeyRound}>
      <div id="accounts" className="flex flex-col gap-4 text-[13px]">
        <p className="max-w-[75ch] text-muted">
          Folosește o cheie KuCoin doar cu permisiunea „General” (citire). Cheile se salvează criptat pe acest Mac și nu mai sunt afișate după salvare.
        </p>
        {(accounts.data ?? []).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
            <strong>{a.label}</strong>
            <span className="text-muted">{a.exchange}</span>
            <span className="num text-faint">{a.keyHint}</span>
            {a.lastError ? <span className="text-bear">{a.lastError}</span> : a.lastOkAt ? <span className="text-bull">conectat {fmtAgo(a.lastOkAt)}</span> : null}
            {a.permissionWarning && <span className="text-warn">permisiuni extra: {a.permissions}</span>}
            <span className="ml-auto flex gap-2">
              <button className="btn" onClick={() => test.mutate(a.id)} disabled={test.isPending}>
                Testează conexiunea
              </button>
              <button className="btn btn-danger" onClick={() => remove.mutate(a.id)}>
                Șterge
              </button>
            </span>
          </div>
        ))}
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-faint">Nume (ex. KuCoin principal)</span>
            <input required maxLength={60} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">API Key</span>
            <input required autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">API Secret</span>
            <input required type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">API Passphrase</span>
            <input required type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <div>
            <button className="btn btn-primary" disabled={add.isPending}>
              {add.isPending ? 'Se verifică…' : 'Adaugă contul'}
            </button>
          </div>
        </form>
        {(add.error || remove.error || test.error) && <div className="text-bear">{errorMessage(add.error ?? remove.error ?? test.error)}</div>}
      </div>
    </Panel>
  );
}

function MarketSection({ s }: { s: SettingsView }) {
  const save = useSaveSettings();
  return (
    <Panel title="Date de piață și scanner" icon={ChartLine}>
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
    </Panel>
  );
}

function GeneralSection({ s }: { s: SettingsView }) {
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
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ retentionDays: Number(days) });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-faint">Păstrează știrile (zile)</span>
            <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 text-right" />
          </label>
          <button className="btn">Salvează</button>
        </form>
      </div>
      {save.error && <div className="mt-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  if (!settings.data && !settings.isError) return <Loading />;
  if (!settings.data) return <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />;
  const s = settings.data;
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Setări</h1>
      <WatchlistSection />
      <SourcesSection />
      <SentimentSection s={s} />
      <AccountsSection />
      <MarketSection s={s} />
      <GeneralSection s={s} />
    </div>
  );
}
