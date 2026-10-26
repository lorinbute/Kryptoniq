// The admin's Users page (FD-USERS §8, FD-INVITE §2): account requests to approve or refuse, the activation link of
// an approved account, and the accounts: disable / enable, reset two-factor (FD-2FA §4), a new activation link, delete.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, UserPlus, Users as UsersIcon } from 'lucide-react';
import type { AccountRequest, ActivationSent, PublicUser } from '../../shared/api-types.ts';
import { api, errorMessage } from '../api.ts';
import { REQUESTS_KEY } from '../auth.ts';
import { copyText } from '../clipboard.ts';
import { fmtAgo, fmtDateTime } from '../format.ts';
import { useSettings, useTz } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';

const USERS_KEY = ['admin', 'users'] as const;

type Action = 'disable' | 'enable' | 'reset-2fa' | 'delete';

const CONFIRM: Partial<Record<Action, (u: PublicUser) => string>> = {
  disable: (u) => `Dezactivezi contul ${u.email}? Sesiunile lui se închid și nu mai poate intra până îl reactivezi.`,
  'reset-2fa': (u) =>
    `Resetezi autentificarea în doi pași pentru ${u.email}? Sesiunile contului se închid; la următorul login, cu parola, își configurează din nou aplicația. Folosește asta doar dacă și-a pierdut telefonul și codurile de recuperare.`,
  delete: (u) => `Ștergi definitiv contul ${u.email}, cu listele de urmărire, setările, conturile de exchange și evenimentele lui?`,
};

function Status({ u }: { u: PublicUser }) {
  if (u.disabled) return <span className="text-bear">Dezactivat</span>;
  if (!u.activated) return <span className="text-warn">Așteaptă activarea</span>;
  return <span className="text-bull">Activ</span>;
}

/** The activation link just made: whether its mail went out, the link to pass on, and a warning for localhost. */
function SentNotice({ sent, onClose }: { sent: ActivationSent & { name: string }; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const host = new URL(sent.link).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border px-4 py-3.5 text-[13.5px] ${sent.mailed ? 'border-bull/40 bg-bull/[0.06]' : 'border-warn/40 bg-warn/[0.06]'}`}
      role="status"
      aria-label="Linkul de activare"
    >
      <p>
        {sent.mailed ? (
          <>
            Emailul cu linkul de activare a plecat la <span className="font-medium">{sent.to}</span>. Dacă nu-l găsește, trimite-i tu linkul:
          </>
        ) : (
          <>
            Emailul către <span className="font-medium">{sent.to ?? sent.name}</span> nu a plecat (expeditorul de test al Resend livrează doar la adresa ta, sau lipsește cheia). Trimite-i
            tu linkul de activare (valabil 7 zile):
          </>
        )}
      </p>
      {/* Its own line: a long link wraps inside the box on a phone. */}
      <code className="num block w-full rounded-[8px] border border-line-strong bg-panel-2 px-2.5 py-1.5 text-[12.5px] break-all whitespace-normal">{sent.link}</code>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => void copyText(sent.link).then(setCopied)}>
          <Copy size={14} aria-hidden />
          Copiază
        </button>
        <button className="btn" onClick={onClose}>
          Gata
        </button>
        {copied !== null && <span className={copied ? 'text-bull' : 'text-bear'}>{copied ? 'Copiat.' : 'Nu s-a putut copia: selectează-l de mână.'}</span>}
      </div>
      {local && (
        <p className="text-[12.5px] text-muted">
          Linkul folosește adresa <span className="num">{host}</span>: merge doar pe acest Mac. Pentru alt calculator, deschide Sentiq pe adresa lui din rețea înainte să aprobi, sau
          așteaptă adresa publică.
        </p>
      )}
      <p className="text-[12.5px] text-faint">Linkul se vede doar acum; poți face oricând unul nou din tabel.</p>
    </section>
  );
}

function RequestsPanel({ list, onSent }: { list: AccountRequest[]; onSent: (s: ActivationSent & { name: string }) => void }) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: (r: AccountRequest) => api.post<ActivationSent & { users: PublicUser[]; requests: AccountRequest[] }>(`/api/admin/account-requests/${r.id}/approve`),
    onSuccess: (res, r) => {
      qc.setQueryData(USERS_KEY, res.users);
      qc.setQueryData(REQUESTS_KEY, res.requests);
      onSent({ link: res.link, mailed: res.mailed, to: res.to, name: r.name });
    },
    // Answered elsewhere meanwhile, or the address got an account: read the list again.
    onError: () => void qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });
  const reject = useMutation({
    mutationFn: (r: AccountRequest) => api.del<AccountRequest[]>(`/api/admin/account-requests/${r.id}`),
    onSuccess: (requests) => qc.setQueryData(REQUESTS_KEY, requests),
    onError: () => void qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });
  const busy = approve.isPending || reject.isPending;
  return (
    <Panel title={`Cereri de cont (${list.length})`} icon={UserPlus} bodyClass="pb-2">
      {/* A list, not a table: on a phone the buttons go under the name instead of off the screen. */}
      <ul className="rows flex flex-col">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3">
            <div className="min-w-0 flex-1 basis-[240px]">
              <div className="font-medium">{r.name}</div>
              <div className="text-[13px] break-all text-muted">
                {r.email} <span className="text-faint">· cerută {fmtAgo(r.createdAt)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-primary" disabled={busy} onClick={() => approve.mutate(r)}>
                Aprobă
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Respingi cererea lui ${r.name} (${r.email})? Nu primește niciun email; poate cere din nou.`)) reject.mutate(r);
                }}
              >
                Respinge
              </button>
            </div>
          </li>
        ))}
      </ul>
      {(approve.error || reject.error) && <div className="px-5 pt-2 text-[13px] text-bear">{errorMessage(approve.error ?? reject.error)}</div>}
    </Panel>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const tz = useTz();
  const settings = useSettings();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => api.get<PublicUser[]>('/api/admin/users') });
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => api.get<AccountRequest[]>('/api/admin/account-requests'), refetchInterval: 60_000 });
  const [sent, setSent] = useState<(ActivationSent & { name: string }) | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: Action }) =>
      action === 'delete' ? api.del<PublicUser[]>(`/api/admin/users/${id}`) : api.post<PublicUser[]>(`/api/admin/users/${id}/${action}`),
    onSuccess: (list) => qc.setQueryData(USERS_KEY, list),
  });
  const relink = useMutation({
    mutationFn: (u: PublicUser) => api.post<ActivationSent>(`/api/admin/users/${u.id}/activation-link`),
    onSuccess: (res, u) => setSent({ ...res, name: u.name }),
  });
  const run = (u: PublicUser, action: Action) => {
    const ask = CONFIRM[action];
    if (ask && !window.confirm(ask(u))) return;
    act.mutate({ id: u.id, action });
  };
  if (users.isPending) return <Loading />;
  if (!users.data) return <ErrorNote error={users.error} onRetry={() => void users.refetch()} />;
  const devMail = settings.data?.resendDev === true;
  const waiting = requests.data ?? [];
  return (
    <div className="flex w-full flex-col gap-3.5">
      <h1 className="page-title">Utilizatori</h1>
      {devMail && (
        <Warning>
          Emailurile pleacă prin expeditorul de test al Resend, care livrează doar la adresa ta. Când aprobi o cerere, îți arătăm linkul de activare, ca să i-l trimiți tu.
        </Warning>
      )}
      {sent && <SentNotice sent={sent} onClose={() => setSent(null)} />}
      {waiting.length > 0 && <RequestsPanel list={waiting} onSent={setSent} />}
      <Panel title={`${users.data.length} ${users.data.length === 1 ? 'cont' : 'conturi'}`} icon={UsersIcon} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Utilizator</th>
              <th>Stare</th>
              <th>Securitate</th>
              <th>Creat</th>
              <th>Ultima intrare</th>
              <th className="text-right">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium">{u.name || '—'}</div>
                  <div className="text-muted">{u.email ?? 'fără email'}</div>
                </td>
                <td>{u.role === 'admin' ? <span className="text-accent">Admin</span> : <Status u={u} />}</td>
                <td className="text-muted">
                  {/* FD-2FA §4: required of everybody; an activated account without it sets it up at its next sign-in. */}
                  {u.twoFactor ? '2FA' : u.activated ? <span className="text-warn">2FA neconfigurat</span> : '—'}
                  {u.passkeys > 0 ? `, ${u.passkeys} ${u.passkeys === 1 ? 'passkey' : 'passkey-uri'}` : ''}
                </td>
                <td className="num text-muted">{fmtDateTime(u.createdAt, tz)}</td>
                <td className="text-muted">{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'niciodată'}</td>
                <td className="text-right">
                  {u.role === 'admin' ? (
                    <span className="text-faint">contul tău</span>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {!u.activated && !u.disabled && (
                        <button className="btn" onClick={() => relink.mutate(u)} disabled={relink.isPending}>
                          Link nou de activare
                        </button>
                      )}
                      {u.disabled ? (
                        <button className="btn" onClick={() => run(u, 'enable')} disabled={act.isPending}>
                          Reactivează
                        </button>
                      ) : (
                        <button className="btn" onClick={() => run(u, 'disable')} disabled={act.isPending}>
                          Dezactivează
                        </button>
                      )}
                      {u.twoFactor && (
                        <button className="btn" onClick={() => run(u, 'reset-2fa')} disabled={act.isPending}>
                          Resetează 2FA
                        </button>
                      )}
                      <button className="btn btn-danger" onClick={() => run(u, 'delete')} disabled={act.isPending}>
                        Șterge
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(act.error || relink.error) && <div className="px-5 pt-2 text-[13px] text-bear">{errorMessage(act.error ?? relink.error)}</div>}
      </Panel>
      <p className="text-[12.5px] text-faint">
        Conturile noi se fac doar la cerere: cineva cere un cont din pagina de autentificare, tu îl aprobi aici, iar el își alege parola din linkul de activare (valabil 7 zile).
        Cererile la care nu răspunzi în 30 de zile dispar.
      </p>
    </div>
  );
}
