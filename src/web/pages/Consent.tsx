// "Conectezi Claude la Sentiq?": the consent page of the Claude connector (FD-MCP §4). The server keeps the request;
// the page shows who asks, where the browser goes back and what Claude can and cannot see, then sends the answer.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import type { OAuthRequestInfo } from '../../shared/api-types.ts';
import { api, errorMessage } from '../api.ts';
import { Loading } from '../components/ui.tsx';

const CAN_READ = [
  'sentimentul zilei și știrile, cu scorurile lor',
  'calendarul economic, cu evenimentele tale și notițele lor',
  'indicatorii economici pe țări',
  'contextul pieței (Fear & Greed, indici, dominanța BTC)',
  'favoritele tale, graficele și semnalele Slingshot',
];
const CANNOT = ['cheile API, conturile de exchange și broker, portofoliile și pozițiile', 'parola, emailul altor utilizatori sau datele lor', 'să schimbe ceva în Sentiq'];

export default function ConsentPage() {
  const [params] = useSearchParams();
  const id = params.get('req') ?? '';
  const valid = /^[A-Za-z0-9_-]{10,40}$/.test(id);
  const info = useQuery({ queryKey: ['oauth-request', id], queryFn: () => api.get<OAuthRequestInfo>(`/api/oauth/requests/${id}`), enabled: valid, retry: false, staleTime: Infinity });
  const [leaving, setLeaving] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post<{ redirect: string }>(`/api/oauth/requests/${id}`, { approve }),
    onSuccess: ({ redirect }) => {
      setLeaving(new URL(redirect).host);
      window.location.assign(redirect);
    },
  });
  useEffect(() => {
    document.title = 'Conectează Claude · Sentiq';
    return () => {
      document.title = 'Sentiq';
    };
  }, []);

  const r = info.data;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <main className="flex w-full max-w-[460px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <img src="/brand/sentiq-64.png" alt="" width={40} height={40} className="size-10" aria-hidden />
          <span className="text-[20px] font-[650] tracking-[-0.02em]">Sentiq</span>
        </div>
        <h1 className="text-[26px] leading-tight font-[650] tracking-[-0.03em]">Conectezi Claude la Sentiq?</h1>
        <div className="panel flex flex-col gap-5 p-6 text-[14px]">
          {!valid || info.isError ? (
            <>
              <p role="alert">{valid ? errorMessage(info.error) : 'Adresa nu conține nicio cerere de conectare.'}</p>
              <Link to="/" className="btn self-start">
                Mergi la Sentiq
              </Link>
            </>
          ) : !r ? (
            <Loading />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] text-muted">Cere acces</span>
                <span className="text-[18px] font-semibold">
                  {r.client.name} <span className="text-[14px] font-normal text-muted">· {r.client.host}</span>
                </span>
                <span className="text-[13px] text-muted">
                  După răspuns te întorci la <span className="font-medium text-text">{r.loopback ? 'acest calculator (localhost)' : r.redirectHost}</span>.
                </span>
              </div>
              {r.loopback && (
                <div className="flex items-start gap-2.5 rounded-[10px] border border-warn/40 bg-warn/[0.06] px-3 py-2.5 text-[13.5px]" role="note">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <span>Aprobă doar dacă tocmai ai pornit tu conectarea din Claude Code pe acest calculator: orice program de aici poate primi răspunsul.</span>
                </div>
              )}
              <section className="flex flex-col gap-2">
                <h2 className="text-[13.5px] font-semibold">Claude va putea citi, din contul tău:</h2>
                <ul className="flex flex-col gap-1.5">
                  {CAN_READ.map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-bull" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="text-[13.5px] font-semibold">Claude nu va putea vedea sau face:</h2>
                <ul className="flex flex-col gap-1.5 text-muted">
                  {CANNOT.map((t) => (
                    <li key={t} className="flex gap-2">
                      <X size={15} className="mt-0.5 shrink-0 text-bear" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
              <p className="text-[13px] text-muted">
                Ești în cont ca <span className="font-medium text-text">{r.account.name}</span>
                {r.account.email && <> ({r.account.email})</>}. Analiza o face Claude, pe abonamentul tău. Poți deconecta oricând din Securitate.
              </p>
              {decide.error && (
                <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13.5px]">
                  {errorMessage(decide.error)}
                </div>
              )}
              {leaving ? (
                <p className="flex items-center gap-2 text-muted" role="status">
                  <Loader2 size={15} className="animate-spin text-accent" aria-hidden />
                  Te trimitem înapoi la {leaving}…
                </p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
                    {decide.isPending && decide.variables && <Loader2 size={15} className="animate-spin" aria-hidden />}
                    Permite accesul
                  </button>
                  <button type="button" className="btn" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
                    Refuză
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
