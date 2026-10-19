// Setări → Admin (FD-ADMINSET): what applies to everybody, the admin's alone. The route exists only for the admin.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Archive, Brain, ChartLine, Mail, Rss, Trash2 } from 'lucide-react';
import type { FeedTest, Health, SourceRow } from '../../shared/api-types.ts';
import { CANDLE_COUNTS, MARKET_EXCHANGES, type SettingsView } from '../../shared/settings.ts';
import { api, errorMessage } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { invalidatePriceSource, useHashScroll, useSaveSettings, useSettings } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { SettingsTabs } from '../components/SettingsTabs.tsx';

const CAT_RO: Record<string, string> = { crypto: 'Crypto', macro: 'Macro', geopolitics: 'Geopolitică', stocks: 'Acțiuni' };
/** FD-AUTOFEED §2: what an automatic feed is, on its tag. */
const AUTO_HINT = 'Adăugată pentru o acțiune din favoritele cuiva. Dispare când acțiunea nu mai e în favoritele nimănui.';

/** The news sources (the section and the page's anchor scroll share the query). */
const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => api.get<SourceRow[]>('/api/sources') });

function SourcesSection() {
  const qc = useQueryClient();
  const sources = useSources();
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
    <Panel id="sources" title="Surse de știri" icon={Rss} bodyClass="pb-4">
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
                      {s.auto && <span className="tag ml-1.5 align-middle font-normal" title={AUTO_HINT}>automată</span>}
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

/** FD-AIKEYS: the common score is the local model's; each user's own AI is in their own settings. */
function SentimentSection() {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 30_000 });
  const rescore = useMutation({ mutationFn: () => api.post<{ reset: number }>('/api/sentiment/rescore', { hours: 48 }) });
  const recompute = useMutation({ mutationFn: () => api.post<{ finalized: string[] }>('/api/sentiment/recompute-history'), onSuccess: () => qc.invalidateQueries({ queryKey: ['sentiment'] }) });
  const aiUsers = health.data?.sentiment.aiUsers;
  return (
    <Panel id="sentiment" title="Sentimentul știrilor" icon={Brain}>
      <div className="flex max-w-[75ch] flex-col gap-4 text-[13px]">
        <p className="text-muted">
          <strong className="text-text">Scorul comun</strong> îl dă modelul local (pe serverul Sentiq, plus reguli de piață), gratuit, pentru toți. Fiecare utilizator își poate pune
          propria cheie AI (Anthropic, OpenAI sau Google Gemini) în{' '}
          <Link to="/settings#ai" className="text-accent">
            Setări → Ale mele → Inteligență artificială
          </Link>
          . Cu ea are Rezumatul zilei și, la alegere, scorul știrilor dat de AI-ul său, plătit direct la furnizor. Cheia ta e tot acolo.
        </p>
        {typeof aiUsers === 'number' && (
          <p className="text-muted">
            {aiUsers === 0
              ? 'Acum nimeni nu are scorul știrilor pe AI-ul propriu.'
              : `${aiUsers} ${aiUsers === 1 ? 'utilizator are' : 'utilizatori au'} scorul știrilor pe AI-ul propriu (îl văd doar în contul propriu); ceilalți văd scorul comun.`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => rescore.mutate()} disabled={rescore.isPending}>
            Rescorează ultimele 48 h
          </button>
          <button className="btn" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            Recalculează istoricul zilnic
          </button>
          {rescore.data && <span className="self-center text-muted">{rescore.data.reset} știri trimise la rescorare (scorul comun).</span>}
          {recompute.data && <span className="self-center text-muted">{recompute.data.finalized.length} zile recalculate.</span>}
        </div>
        {(rescore.error || recompute.error) && <div className="text-bear">{errorMessage(rescore.error ?? recompute.error)}</div>}
      </div>
    </Panel>
  );
}

const EXCHANGE_NAMES: Record<string, string> = { kucoin: 'KuCoin', binance: 'Binance', bybit: 'Bybit', okx: 'OKX', bitget: 'Bitget' };

/** FD-MARKETSRC §2: the exchange for those without one of their own, and how much history the charts load. */
function MarketDefaults({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const save = useSaveSettings();
  const md = s.marketData ?? { exchange: 'kucoin', candles: 1500 };
  const apply = (patch: object) => save.mutate({ marketData: patch }, { onSuccess: () => invalidatePriceSource(qc) });
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-4">
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-faint">Exchange implicit pentru prețurile crypto</span>
          <select value={md.exchange} onChange={(e) => apply({ exchange: e.target.value })} disabled={save.isPending}>
            {MARKET_EXCHANGES.map((x) => (
              <option key={x} value={x}>
                {EXCHANGE_NAMES[x] ?? x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Istoric încărcat pe grafice</span>
          <select value={String(md.candles)} onChange={(e) => apply({ candles: Number(e.target.value) })} disabled={save.isPending}>
            {CANDLE_COUNTS.map((c) => (
              <option key={c} value={String(c)}>
                {c} de lumânări
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-muted">
        Fiecare vede prețurile crypto de la exchange-ul lui conectat (KuCoin, Binance, Bybit, OKX sau Bitget). Exchange-ul implicit e pentru cine nu are unul dintre ele și pentru
        monedele pe care exchange-ul lui nu le are. Mai mult istoric înseamnă că poți derula mai înapoi pe grafic, cu încărcare mai lentă.
      </p>
      {save.error && <div className="text-bear">{errorMessage(save.error)}</div>}
    </div>
  );
}

function MarketDataSection({ s }: { s: SettingsView }) {
  return (
    <Panel id="market-data" title="Date de piață" icon={ChartLine}>
      <div className="flex max-w-[75ch] flex-col gap-2 text-[13px]">
        <MarketDefaults s={s} />
        <p className="text-muted">
          <strong className="text-text">Acțiuni:</strong> graficele zilnice și săptămânale vin gratuit de la Nasdaq, pentru toți. Pentru 1m – 4h, fiecare utilizator își pune
          propria cheie Twelve Data (gratuită) în{' '}
          <Link to="/settings#stock-data" className="text-accent">
            Setări → Ale mele → Date pentru acțiuni
          </Link>
          ; creditele și planul sunt ale fiecărei chei. Cheia ta e tot acolo.
        </p>
      </div>
    </Panel>
  );
}

function RetentionSection({ s }: { s: SettingsView }) {
  const save = useSaveSettings();
  const [days, setDays] = useState(String(s.retentionDays));
  useEffect(() => setDays(String(s.retentionDays)), [s.retentionDays]);
  return (
    <Panel id="retention" title="Păstrarea știrilor" icon={Archive}>
      <form
        className="flex flex-wrap items-end gap-2 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ retentionDays: Number(days) });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-faint">Zile (7–365); știrile mai vechi se șterg</span>
          <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 text-right" />
        </label>
        <button className="btn" disabled={save.isPending}>
          Salvează
        </button>
        {save.isSuccess && <span className="self-center text-bull">Salvat.</span>}
      </form>
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
    <Panel id="email" title="Email (Resend)" icon={Mail}>
      <div className="flex max-w-[80ch] flex-col gap-3 text-[13px]">
        <p className="text-muted">
          Prin Resend pleacă cererile de cont, linkurile de activare și cele de parolă nouă. Fără cheie, linkurile apar doar în jurnalul serverului (<code>data/logs</code>).
        </p>
        {s.resendDev && (
          <Warning>
            Expeditorul de test <code>onboarding@resend.dev</code> livrează doar la adresa contului Resend. Pentru ceilalți utilizatori ai nevoie de un domeniu verificat în Resend și un
            expeditor de pe el; până atunci, trimite-le tu linkul de activare din pagina Utilizatori.
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

export default function AdminSettingsPage() {
  const settings = useSettings();
  const sources = useSources();
  // The long list of sources comes first: an anchor below it (#market-data) is scrolled to once it is drawn.
  useHashScroll(Boolean(settings.data) && !sources.isPending);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Setări</h1>
      <SettingsTabs />
      <p className="text-[13px] text-muted">Aceste setări se aplică tuturor utilizatorilor.</p>
      {!settings.data && !settings.isError ? (
        <Loading />
      ) : !settings.data ? (
        <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
          <SourcesSection />
          <SentimentSection />
          <MarketDataSection s={settings.data} />
          <RetentionSection s={settings.data} />
          <EmailSection s={settings.data} />
        </>
      )}
    </div>
  );
}
