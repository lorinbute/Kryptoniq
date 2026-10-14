// Setări → Admin (FD-ADMINSET): what applies to everybody, the admin's alone. The route exists only for the admin.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Archive, Brain, ChartLine, Mail, Rss, Trash2 } from 'lucide-react';
import type { FeedTest, Health, SourceRow, TdBudget } from '../../shared/api-types.ts';
import { CANDLE_COUNTS, CLAUDE_MODELS, MARKET_EXCHANGES, type SettingsView } from '../../shared/settings.ts';
import { api, errorMessage } from '../api.ts';
import { fmtAgo, fmtNum } from '../format.ts';
import { invalidatePriceSource, useHashScroll, useSaveSettings, useSettings, useStocksInfo } from '../hooks.ts';
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

function SentimentSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  // Also for what the key spent today (FD-AICLARITY), whatever the engine: the summaries use it too.
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 30_000 });
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
    <Panel id="sentiment" title="Motorul de sentiment" icon={Brain}>
      <div className="flex max-w-[75ch] flex-col gap-4 text-[13px]">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Motor</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="engine" checked={s.sentiment.engine === 'local'} onChange={() => save.mutate({ sentiment: { engine: 'local' } })} className="mt-1" />
            <span>
              <strong>Local</strong>: model AI pe serverul Sentiq, plus reguli de piață. Gratuit.
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
              <strong>Claude</strong>: înțelege mai bine implicațiile macro. Trimite doar titlurile știrilor către Anthropic, cu cheia de mai jos; se plătește la Anthropic după tokeni (consumul de azi e mai jos).
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
              <span className="text-faint">Cheie API Anthropic, folosită și de Rezumat {s.claudeKeySet && <>(salvată: {s.claudeKeyHint})</>}</span>
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
        <KeyUse engine={s.sentiment.engine} keySet={s.claudeKeySet} usage={health.data?.claudeUsage} loaded={health.isSuccess} />
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

/** FD-AICLARITY: what Sentiq does with the Claude key by itself, with today's use. */
function KeyUse({ engine, keySet, usage, loaded }: { engine: string; keySet: boolean; usage: Health['claudeUsage']; loaded: boolean }) {
  const tokens = (c: { input: number; output: number }) => `${fmtNum(c.input, 0)} / ${fmtNum(c.output, 0)} tokeni (intrare / ieșire)`;
  // A server from before FD-AICLARITY answers without the counts.
  const unknown = loaded ? 'consumul nu e disponibil (serverul nu îl trimite încă).' : '…';
  const sentiment = usage?.sentiment;
  const summary = usage?.summary;
  return (
    <section aria-labelledby="key-use" className="flex flex-col gap-2 rounded-[10px] border border-line px-4 py-3">
      <h3 id="key-use" className="text-[13px] font-semibold text-text">
        La ce folosește Sentiq cheia Claude{usage && <span className="font-normal text-faint"> · azi, ziua UTC {usage.day}</span>}
      </h3>
      <ul className="flex flex-col gap-1.5 text-muted">
        <li>
          <span className="text-text">Sentimentul fiecărei știri</span>, automat:{' '}
          {engine !== 'claude'
            ? 'motorul e Local, deci nu folosește cheia.'
            : !keySet
              ? 'fără cheie se folosește motorul local.'
              : sentiment
                ? `${fmtNum(sentiment.items, 0)} titluri în ${fmtNum(sentiment.calls, 0)} apeluri, ${tokens(sentiment)}, cu ${usage.sentimentModel}.`
                : unknown}
        </li>
        <li>
          <span className="text-text">Rezumatul de pe Azi</span> (butonul „Rezumat”, pentru fiecare utilizator):{' '}
          {summary ? `${fmtNum(summary.calls, 0)} ${summary.calls === 1 ? 'rezumat' : 'rezumate'}, ${tokens(summary)}, cu ${usage.summaryModel}.` : unknown}
        </li>
      </ul>
      <p className="text-faint">Prețul în dolari îl arată consola Anthropic (Usage).</p>
    </section>
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
    <Panel id="market-data" title="Date de piață" icon={ChartLine}>
      <div className="flex max-w-[75ch] flex-col gap-2 text-[13px]">
        <MarketDefaults s={s} />
        <p className="text-muted">
          <strong className="text-text">Acțiuni:</strong> graficele zilnice și săptămânale vin gratuit de la Nasdaq. Pentru timeframe-urile intraday (1m – 4h), pentru toți utilizatorii, pune cheia gratuită{' '}
          <a href="https://twelvedata.com/register" target="_blank" rel="noreferrer">
            Twelve Data
          </a>{' '}
          (după înregistrare, în pagina API Keys). Planul gratuit are 8 cereri pe minut și 800 pe zi; un plan plătit (de exemplu Grow, fără limită zilnică) e recunoscut
          singur, din cheie. Aplicația ține minte lumânările, ca să nu consume cereri degeaba.
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
        {s.twelveDataKeySet && b && <TdPlanLine b={b} />}
        {setTdKey.error && <div className="text-bear">{errorMessage(setTdKey.error)}</div>}
      </div>
    </Panel>
  );
}

const PLAN_NAMES: Record<string, string> = { basic: 'Basic (gratuit)', grow: 'Grow', pro: 'Pro', ultra: 'Ultra', enterprise: 'Enterprise' };

/** FD-TDPLAN: the key's plan as read from Twelve Data, today's use against it, and a read on request (after an upgrade). */
function TdPlanLine({ b }: { b: TdBudget }) {
  const qc = useQueryClient();
  const reread = useMutation({
    mutationFn: () => api.post<{ budget: TdBudget }>('/api/settings/twelvedata-plan'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stocks'] }),
  });
  const name = PLAN_NAMES[b.plan.category] ?? b.plan.category;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span>
          Planul Twelve Data: <strong className="text-text">{b.plan.assumed ? `${name} (presupus, încă necitit)` : name}</strong>: {b.perMinute} cereri pe minut,{' '}
          {b.perDay === null ? 'fără limită zilnică' : `${b.perDay} pe zi`}
          {b.plan.at && <span className="text-faint"> (citit {fmtAgo(b.plan.at)})</span>}.
        </span>
        <button type="button" className="btn" onClick={() => reread.mutate()} disabled={reread.isPending}>
          {reread.isPending ? 'Se citește…' : 'Recitește planul'}
        </button>
      </div>
      {/* Wraps on a phone (`.num` alone never breaks a line). */}
      <p className="num whitespace-normal text-faint">
        Consum azi (UTC): {b.used}
        {b.perDay === null ? '' : ` / ${b.perDay}`} cereri; în ultimul minut: {b.minuteUsed} / {b.perMinute}.
      </p>
      {reread.error && <div className="text-bear">{errorMessage(reread.error)}</div>}
    </div>
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
          <SentimentSection s={settings.data} />
          <MarketDataSection s={settings.data} />
          <RetentionSection s={settings.data} />
          <EmailSection s={settings.data} />
        </>
      )}
    </div>
  );
}
