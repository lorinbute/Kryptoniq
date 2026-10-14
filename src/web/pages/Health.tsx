import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import type { Health } from '../../shared/api-types.ts';
import { api } from '../api.ts';
import { fmtAgo, fmtBytes, fmtIn } from '../format.ts';
import { useNow } from '../hooks.ts';
import { ErrorNote, Loading, Panel } from '../components/ui.tsx';
import { Clock, Database, Rss } from 'lucide-react';

/** FD-AZURE §2: past 80% of the database's maximum size. */
const dbNearlyFull = (db: Health['db']) => db.sizeBytes != null && !!db.maxSizeBytes && db.sizeBytes / db.maxSizeBytes > 0.8;

const JOB_RO: Record<string, string> = {
  'news.fetch': 'Descărcare știri',
  'sentiment.score': 'Scorare sentiment',
  'sentiment.daily': 'Indicele zilei',
  'calendar.ff': 'Calendar ForexFactory',
  'calendar.tv': 'Calendar TradingView',
  'calendar.earnings': 'Rezultate companii (Nasdaq)',
  'econ.history': 'Indicatori economici (istoric, program)',
  'market.context': 'Context piață',
  'stocks.market': 'Bursa SUA și indici',
  scanner: 'Scanner Slingshot',
  maintenance: 'Întreținere',
};
const MODEL_RO: Record<string, string> = { idle: 'neîncărcat', loading: 'se descarcă / se încarcă', ready: 'gata', failed: 'indisponibil' };

export default function HealthPage() {
  const now = useNow(5000);
  const q = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health'), refetchInterval: 10_000 });
  if (!q.data && !q.isError) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  const m = h.sentiment.model;
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5">
      <h1 className="page-title">Stare sistem</h1>
      <Panel title="Sentiment și date" icon={Database}>
        <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-faint">Motor activ</dt>
            <dd>{h.sentiment.engine}</dd>
          </div>
          <div>
            <dt className="text-faint">Model local ({m.model})</dt>
            <dd className={clsx(m.state === 'failed' && 'text-bear', m.state === 'ready' && 'text-bull')}>
              {MODEL_RO[m.state]}
              {m.state === 'loading' && m.progress !== null && ` ${m.progress}%`}
              {m.error && <div className="text-[12px] text-bear">{m.error}</div>}
            </dd>
          </div>
          {h.sentiment.claude && (
            <div>
              <dt className="text-faint">Claude ({h.sentiment.claude.model})</dt>
              <dd className={clsx(h.sentiment.claude.lastError ? 'text-bear' : 'text-bull')}>
                {h.sentiment.claude.lastError
                  ? `${h.sentiment.claude.lastError.message}; ${h.sentiment.claude.lastError.permanent ? 'se folosește motorul local până schimbi cheia' : 'se reîncearcă în câteva minute'}`
                  : 'funcționează'}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-faint">Știri în așteptare</dt>
            <dd className="num">{h.sentiment.pending}</dd>
          </div>
          <div>
            <dt className="text-faint">Bază de date</dt>
            <dd>
              {/* FD-AZURE §5: Azure SQL (`?.`: an older server sent only the size). */}
              {h.db.database ? `Azure SQL ${h.db.server}/${h.db.database}` : 'SQLite'}
              {h.db.objective ? ` · ${h.db.objective}` : ''}
              <div className={clsx('num text-[12px]', dbNearlyFull(h.db) ? 'text-warn' : 'text-muted')}>
                {h.db.sizeBytes != null ? fmtBytes(h.db.sizeBytes) : 'mărime necunoscută'}
                {h.db.maxSizeBytes ? ` din ${fmtBytes(h.db.maxSizeBytes)}` : ''}, {h.db.news} știri
                {dbNearlyFull(h.db) ? ' (aproape plină)' : ''}
              </div>
            </dd>
          </div>
          {h.jobsLeader && (
            <div>
              <dt className="text-faint">Joburi de fundal</dt>
              <dd className={clsx(!h.jobsLeader.self && 'text-muted')}>
                {h.jobsLeader.self
                  ? `rulează aici (${h.jobsLeader.host})`
                  : h.jobsLeader.host
                    ? `rulează pe ${h.jobsLeader.host}, nu aici`
                    : 'nu rulează nicăieri acum'}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-faint">Calendar ForexFactory</dt>
            <dd>{h.calendar.ff ? fmtAgo(h.calendar.ff, now) : 'niciodată'}</dd>
          </div>
          <div>
            <dt className="text-faint">Calendar TradingView</dt>
            <dd>{h.calendar.tv ? fmtAgo(h.calendar.tv, now) : 'niciodată'}</dd>
          </div>
          {h.calendar.ffBlockedUntil && (
            <div>
              <dt className="text-faint">ForexFactory blocat</dt>
              <dd className="text-warn">până {fmtIn(h.calendar.ffBlockedUntil, now)}</dd>
            </div>
          )}
          {/* `?.`: fields added with FD-SENTIQ, absent from an older server. */}
          {h.calendar.earn != null && (
            <div>
              <dt className="text-faint">Rezultate companii</dt>
              <dd>{fmtAgo(h.calendar.earn, now)}</dd>
            </div>
          )}
          {h.twelveData && (
            <div>
              <dt className="text-faint">Twelve Data (acțiuni)</dt>
              <dd className="num">
                {h.twelveData.hasKey ? `${h.twelveData.used}${h.twelveData.perDay === null ? '' : ` / ${h.twelveData.perDay}`} cereri azi (UTC)${h.twelveData.perDay === null ? ', fără limită zilnică' : ''}` : 'fără cheie: grafice zilnice de la Nasdaq'}
              </dd>
            </div>
          )}
        </dl>
      </Panel>
      <Panel title="Job-uri în fundal" icon={Clock} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Ultima rulare</th>
              <th>Durată</th>
              <th>Următoarea</th>
              <th>Stare</th>
            </tr>
          </thead>
          <tbody>
            {h.jobs.map((j) => (
              <tr key={j.name}>
                <td>{JOB_RO[j.name] ?? j.name}</td>
                <td className="whitespace-nowrap">{j.lastEnd ? fmtAgo(j.lastEnd, now) : '—'}</td>
                <td className="num">{j.lastDurationMs !== null ? `${(j.lastDurationMs / 1000).toFixed(1)} s` : '—'}</td>
                <td className="whitespace-nowrap">{j.running ? 'rulează acum' : j.nextAt ? fmtIn(j.nextAt, now) : '—'}</td>
                <td className={clsx(j.lastError ? 'text-bear' : 'text-bull')}>{j.lastError ?? (j.lastOk ? 'OK' : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Surse de știri" icon={Rss} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Sursă</th>
              <th>Ultimul succes</th>
              <th>Ultima știre nouă</th>
              <th>Următoarea verificare</th>
              <th>Eroare</th>
            </tr>
          </thead>
          <tbody>
            {h.sources.map((s) => (
              <tr key={s.id} className={clsx(!s.enabled && 'text-faint')}>
                <td>
                  {s.name}
                  {!s.enabled && <span className="ml-1 text-[12px]">(dezactivată)</span>}
                </td>
                <td className="whitespace-nowrap">{s.lastSuccessAt ? fmtAgo(s.lastSuccessAt, now) : '—'}</td>
                <td className="whitespace-nowrap">{s.lastNewItemAt ? fmtAgo(s.lastNewItemAt, now) : '—'}</td>
                <td className="whitespace-nowrap">{s.enabled ? (s.nextFetchAt > now ? fmtIn(s.nextFetchAt, now) : 'curând') : '—'}</td>
                <td className="max-w-[360px] text-[12px] text-bear">{s.lastError ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
