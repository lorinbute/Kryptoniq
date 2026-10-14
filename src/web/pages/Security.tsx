// The signed-in user's own security (FD-USERS §7): name, password, two-factor with recovery codes, passkeys and signing
// out everywhere.
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { Copy, Download, Fingerprint, KeyRound, LogOut, Pencil, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { AccountInfo, PasskeySummary, PublicUser, TwoFactorView } from '../../shared/api-types.ts';
import { api, errorMessage } from '../api.ts';
import { AUTH_KEY, landAfterSignOut, useAuthChange } from '../auth.ts';
import { fmtAgo, fmtDateTime } from '../format.ts';
import { useTz } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { passkeyMessage } from './Auth.tsx';
import { copyText } from '../clipboard.ts';

const ACCOUNT_KEY = ['account'] as const;

function useAccount() {
  return useQuery({ queryKey: ACCOUNT_KEY, queryFn: () => api.get<AccountInfo>('/api/account') });
}

/** After a change: the account page and the user in the auth state (menu, counts) read again. */
function useRefreshAccount() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ACCOUNT_KEY });
    void qc.invalidateQueries({ queryKey: AUTH_KEY });
  };
}

function Msg({ tone = 'ok', children }: { tone?: 'ok' | 'error'; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={tone === 'error' ? 'text-[13px] text-bear' : 'text-[13px] text-bull'}>
      {children}
    </div>
  );
}

function ProfileSection({ user }: { user: PublicUser }) {
  const [name, setName] = useState(user.name);
  const refresh = useRefreshAccount();
  const save = useMutation({ mutationFn: () => api.put('/api/account/name', { name }), onSuccess: refresh });
  return (
    <Panel title="Contul tău" icon={UserRound}>
      <form
        className="flex flex-wrap items-end gap-3 text-[13.5px]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-faint">Nume</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className="w-64 max-w-full" />
        </label>
        <button className="btn" disabled={save.isPending || !name.trim() || name.trim() === user.name}>
          Salvează
        </button>
        <div className="flex flex-col gap-1">
          <span className="text-faint">Email</span>
          <span className="py-2">{user.email}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-faint">Rol</span>
          <span className="py-2">{user.role === 'admin' ? 'Admin' : 'Utilizator'}</span>
        </div>
      </form>
      {save.isSuccess && <Msg>Numele e salvat.</Msg>}
      {save.error && <Msg tone="error">{errorMessage(save.error)}</Msg>}
    </Panel>
  );
}

function PasswordSection({ email }: { email: string | null }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => api.put<{ closedSessions: number }>('/api/account/password', { current: form.current, next: form.next }),
    onSuccess: () => setForm({ current: '', next: '', confirm: '' }),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMismatch(form.next !== form.confirm);
    if (form.next === form.confirm) change.mutate();
  };
  return (
    <Panel title="Parola" icon={KeyRound}>
      <form className="flex flex-wrap items-end gap-3 text-[13.5px]" onSubmit={onSubmit}>
        {/* The account's email, for password managers (which save the new password under it). */}
        <input type="text" autoComplete="username" value={email ?? ''} className="hidden" readOnly aria-hidden tabIndex={-1} />
        <label className="flex flex-col gap-1">
          <span className="text-faint">Parola actuală</span>
          <input type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required maxLength={200} className="w-56 max-w-full" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Parola nouă</span>
          <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" required minLength={12} maxLength={200} className="w-56 max-w-full" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-faint">Parola nouă, încă o dată</span>
          <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required maxLength={200} className="w-56 max-w-full" />
        </label>
        <button className="btn" disabled={change.isPending}>
          Schimbă parola
        </button>
      </form>
      <p className="mt-2 text-[12.5px] text-faint">Minimum 12 caractere, cu literă mare, literă mică și cifră. Celelalte sesiuni se închid; aceasta rămâne deschisă.</p>
      {mismatch && <Msg tone="error">Parolele noi nu coincid.</Msg>}
      {change.isSuccess && (
        <Msg>
          Parola e schimbată.{' '}
          {change.data.closedSessions > 0 ? `Am închis ${change.data.closedSessions === 1 ? 'o altă sesiune' : `${change.data.closedSessions} alte sesiuni`}.` : ''}
        </Msg>
      )}
      {change.error && <Msg tone="error">{errorMessage(change.error)}</Msg>}
    </Panel>
  );
}


/** The ten codes, shown once: copy, download, and say they are kept. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [kept, setKept] = useState(false);
  const text = `Sentiq — coduri de recuperare (fiecare merge o singură dată)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentiq-coduri-recuperare.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-accent-dim bg-accent/[0.05] p-4">
      <p className="text-[13.5px]">
        <strong>Păstrează aceste coduri într-un loc sigur.</strong> Fiecare îți deschide contul o singură dată dacă nu ai telefonul la tine. Nu le vei mai vedea.
      </p>
      <ol className="num grid grid-cols-2 gap-x-6 gap-y-1.5 text-[15px] tracking-[0.04em] sm:w-fit">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => void copyText(text).then(setCopied)}>
          <Copy size={14} aria-hidden />
          {copied ? 'Copiate' : 'Copiază'}
        </button>
        <button type="button" className="btn" onClick={download}>
          <Download size={14} aria-hidden />
          Descarcă .txt
        </button>
        <label className="ml-1 inline-flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
          Le-am salvat
        </label>
        <button type="button" className="btn btn-primary" disabled={!kept} onClick={onDone}>
          Gata
        </button>
      </div>
      {copied === false && <Msg tone="error">Browserul nu a permis copierea; folosește „Descarcă .txt” sau notează-le.</Msg>}
    </div>
  );
}

/** Password + a code: what turning 2FA off or renewing the codes asks for (FD-USERS §7). */
function ConfirmWithCode({ action, danger, onSubmit, busy, error, onCancel }: { action: string; danger?: boolean; onSubmit: (password: string, code: string) => void; busy: boolean; error: unknown; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-[12px] border border-line-strong bg-panel-2 p-3 text-[13.5px]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password, code);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-faint">Parola</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} className="w-52 max-w-full" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-faint">Cod din aplicație sau de recuperare</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required maxLength={20} spellCheck={false} className="w-52 max-w-full" />
      </label>
      <button className={danger ? 'btn btn-danger' : 'btn'} disabled={busy}>
        {action}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Renunță
      </button>
      {Boolean(error) && <div className="basis-full text-[13px] text-bear">{errorMessage(error)}</div>}
    </form>
  );
}

function TwoFactorSection({ tf }: { tf: TwoFactorView }) {
  const qc = useQueryClient();
  const refresh = useRefreshAccount();
  const tz = useTz();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'none' | 'disable' | 'renew'>('none');
  const setView = (v: TwoFactorView) => qc.setQueryData<AccountInfo>(ACCOUNT_KEY, (a) => (a ? { ...a, twoFactor: v } : a));
  const start = useMutation({ mutationFn: (restart: boolean) => api.post<TwoFactorView>('/api/account/2fa/start', { restart }), onSuccess: setView });
  const cancel = useMutation({ mutationFn: () => api.post<TwoFactorView>('/api/account/2fa/cancel'), onSuccess: setView });
  const enable = useMutation({
    mutationFn: () => api.post<{ codes: string[]; twoFactor: TwoFactorView }>('/api/account/2fa/enable', { code }),
    onSuccess: (r) => {
      setCode('');
      setCodes(r.codes);
      setView(r.twoFactor);
      refresh();
    },
  });
  const disable = useMutation({
    mutationFn: (b: { password: string; code: string }) => api.post<TwoFactorView>('/api/account/2fa/disable', b),
    onSuccess: (v) => {
      setMode('none');
      setView(v);
      refresh();
    },
  });
  const renew = useMutation({
    mutationFn: (b: { password: string; code: string }) => api.post<{ codes: string[]; twoFactor: TwoFactorView }>('/api/account/2fa/recovery-codes', b),
    onSuccess: (r) => {
      setMode('none');
      setCodes(r.codes);
      setView(r.twoFactor);
      refresh();
    },
  });

  let body: ReactNode;
  if (codes) {
    body = <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;
  } else if (tf.enabled) {
    body = (
      <div className="flex flex-col gap-3 text-[13.5px]">
        <p>
          <span className="text-bull">Activă</span>
          {tf.confirmedAt ? ` din ${fmtDateTime(tf.confirmedAt, tz)}` : ''}. La intrare, după parolă, îți cerem codul din aplicația de autentificare.
        </p>
        {tf.recoveryCodesLeft <= 3 ? (
          <Warning>
            Mai ai {tf.recoveryCodesLeft === 1 ? 'un singur cod' : `${tf.recoveryCodesLeft} coduri`} de recuperare. Generează altele noi cât ai acces la aplicație.
          </Warning>
        ) : (
          <p className="text-muted">Coduri de recuperare rămase: {tf.recoveryCodesLeft} din 10.</p>
        )}
        {mode === 'none' && (
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setMode('renew')}>
              Coduri de recuperare noi
            </button>
            <button className="btn btn-danger" onClick={() => setMode('disable')}>
              Dezactivează
            </button>
          </div>
        )}
        {mode === 'renew' && (
          <ConfirmWithCode action="Generează coduri noi" busy={renew.isPending} error={renew.error} onCancel={() => setMode('none')} onSubmit={(password, c) => renew.mutate({ password, code: c })} />
        )}
        {mode === 'disable' && (
          <ConfirmWithCode
            action="Dezactivează"
            danger
            busy={disable.isPending}
            error={disable.error}
            onCancel={() => setMode('none')}
            onSubmit={(password, c) => disable.mutate({ password, code: c })}
          />
        )}
      </div>
    );
  } else if (tf.pending && tf.qr) {
    body = (
      <div className="flex flex-col gap-4 text-[13.5px] md:flex-row md:items-start">
        {/* Black on white with a quiet zone: what phone cameras read best, also on a dark page. */}
        <img src={tf.qr} alt="Cod QR pentru aplicația de autentificare" width={220} height={220} className="size-[220px] shrink-0 rounded-[10px] bg-white" />
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>Deschide aplicația de autentificare (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
            <li>Scanează codul QR.</li>
            <li>Scrie mai jos codul de 6 cifre pe care îl arată.</li>
          </ol>
          <p className="text-muted">
            Nu poți scana? Introdu cheia de mână: <span className="num break-all text-text select-all">{tf.secret}</span>
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-faint">Codul de 6 cifre</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required className="num w-36 tracking-[0.2em]" />
            </label>
            <button className="btn btn-primary" disabled={enable.isPending}>
              Activează
            </button>
            <button type="button" className="btn" onClick={() => start.mutate(true)} disabled={start.isPending}>
              Cheie nouă
            </button>
            <button type="button" className="btn" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Renunță
            </button>
          </form>
          {(enable.error || start.error || cancel.error) && <Msg tone="error">{errorMessage(enable.error ?? start.error ?? cancel.error)}</Msg>}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-start gap-3 text-[13.5px]">
        <p className="max-w-[70ch] text-muted">
          Pe lângă parolă, la intrare îți cerem un cod de 6 cifre dintr-o aplicație de pe telefon. Cineva care îți află parola tot nu poate intra.
        </p>
        <button className="btn btn-primary" onClick={() => start.mutate(false)} disabled={start.isPending}>
          Activează autentificarea în doi pași
        </button>
        {start.error && <Msg tone="error">{errorMessage(start.error)}</Msg>}
      </div>
    );
  }
  return (
    <Panel title="Autentificare în doi pași" icon={ShieldCheck}>
      {body}
    </Panel>
  );
}

function PasskeyRow({ p, tz }: { p: PasskeySummary; tz: string }) {
  const qc = useQueryClient();
  const refresh = useRefreshAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const setList = (list: PasskeySummary[]) => qc.setQueryData<AccountInfo>(ACCOUNT_KEY, (a) => (a ? { ...a, passkeys: list } : a));
  const rename = useMutation({
    mutationFn: () => api.put<PasskeySummary[]>(`/api/account/passkeys/${p.id}`, { name }),
    onSuccess: (list) => {
      setEditing(false);
      setList(list);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del<PasskeySummary[]>(`/api/account/passkeys/${p.id}`),
    onSuccess: (list) => {
      setList(list);
      refresh();
    },
  });
  return (
    <tr>
      <td>
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-label="Numele passkey-ului" className="w-48" autoFocus />
            <button className="btn" disabled={!name.trim() || rename.isPending}>
              Salvează
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Renunță
            </button>
          </form>
        ) : (
          <span className="font-medium">{p.name}</span>
        )}
        {(rename.error || remove.error) && <div className="text-[12.5px] text-bear">{errorMessage(rename.error ?? remove.error)}</div>}
      </td>
      <td className="text-muted">{p.synced ? 'Sincronizat (iCloud, Google, 1Password…)' : 'Doar pe acest dispozitiv'}</td>
      <td className="num text-muted">{fmtDateTime(p.createdAt, tz)}</td>
      <td className="text-muted">{p.lastUsedAt ? fmtAgo(p.lastUsedAt) : 'niciodată'}</td>
      <td className="text-right whitespace-nowrap">
        {!editing && (
          <button className="btn" onClick={() => setEditing(true)} aria-label={`Redenumește ${p.name}`}>
            <Pencil size={14} aria-hidden />
          </button>
        )}{' '}
        <button
          className="btn btn-danger"
          aria-label={`Șterge ${p.name}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Ștergi passkey-ul „${p.name}”? Vei intra cu parola (și codul, dacă ai 2FA).`)) remove.mutate();
          }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </td>
    </tr>
  );
}

function PasskeysSection({ list, here }: { list: PasskeySummary[]; here: boolean }) {
  const qc = useQueryClient();
  const refresh = useRefreshAccount();
  const tz = useTz();
  const [name, setName] = useState('');
  const supported = browserSupportsWebAuthn();
  const add = useMutation({
    mutationFn: async () => {
      const options = await api.post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/account/passkeys/options');
      let response;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch (err) {
        throw new Error(passkeyMessage(err));
      }
      return api.post<PasskeySummary>('/api/account/passkeys', { response, name: name.trim() || undefined });
    },
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ACCOUNT_KEY });
      refresh();
    },
  });
  return (
    <Panel title="Passkey-uri" icon={Fingerprint} flush={list.length > 0}>
      <div className="flex flex-col gap-3 pb-3 text-[13.5px]">
        <p className="max-w-[75ch] text-muted">
          Un passkey te lasă să intri cu Touch ID, Face ID sau PIN-ul dispozitivului, fără parolă și fără cod. Merge doar pe adresa pe care l-ai creat: unul făcut pe adresa publică nu merge pe http://localhost și invers.
        </p>
      </div>
      {list.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Nume</th>
              <th>Unde e păstrat</th>
              <th>Adăugat</th>
              <th>Folosit</th>
              {/* relative: the hidden label stays inside the table's own scroll box (else it widens the page on a phone). */}
              <th className="relative text-right">
                <span className="sr-only">Acțiuni</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <PasskeyRow key={p.id} p={p} tz={tz} />
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-col gap-2 pt-3 text-[13.5px]">
        {here && supported ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-faint">Nume (opțional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="de ex. MacBook" maxLength={64} className="w-56" />
            </label>
            <button className="btn btn-primary" disabled={add.isPending}>
              <Fingerprint size={15} aria-hidden />
              Adaugă un passkey
            </button>
          </form>
        ) : (
          <p className="text-faint">
            {supported
              ? `Aici nu se pot adăuga passkey-uri: deschide Sentiq la http://localhost:${window.location.port || '4317'}.`
              : 'Browserul acesta nu are passkey-uri.'}
          </p>
        )}
        {add.error && <Msg tone="error">{errorMessage(add.error)}</Msg>}
        {add.isSuccess && <Msg>Passkey-ul e adăugat.</Msg>}
      </div>
    </Panel>
  );
}

function SessionsSection() {
  const change = useAuthChange();
  const out = useMutation({
    mutationFn: () => api.post('/api/account/logout-all'),
    onSuccess: () => {
      landAfterSignOut();
      change(null);
    },
  });
  return (
    <Panel title="Sesiuni" icon={LogOut}>
      <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
        <p className="max-w-[70ch] text-muted">
          Ai uitat contul deschis pe alt calculator sau telefon? Ieși peste tot, inclusiv de aici.
        </p>
        <button className="btn btn-danger" onClick={() => out.mutate()} disabled={out.isPending}>
          Ieși de pe toate dispozitivele
        </button>
      </div>
      {out.error && <Msg tone="error">{errorMessage(out.error)}</Msg>}
    </Panel>
  );
}

export default function SecurityPage() {
  const account = useAccount();
  const [params] = useSearchParams();
  if (account.isPending) return <Loading />;
  if (!account.data) return <ErrorNote error={account.error} onRetry={() => void account.refetch()} />;
  const a = account.data;
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3.5">
      <h1 className="page-title">Securitate</h1>
      {params.get('recovery') === '1' && (
        <Warning>
          Ai intrat cu un cod de recuperare; mai ai {a.twoFactor.recoveryCodesLeft}. Dacă ți-ai pierdut telefonul, dezactivează autentificarea în doi pași și activeaz-o din nou pe
          telefonul nou, sau generează coduri noi.
        </Warning>
      )}
      {params.get('welcome') === '1' && !a.twoFactor.enabled && (
        <Warning>Contul de admin e gata. Activează autentificarea în doi pași: contul tău vede cheile și setările tuturor.</Warning>
      )}
      <ProfileSection user={a.user} />
      <PasswordSection email={a.user.email} />
      <TwoFactorSection tf={a.twoFactor} />
      <PasskeysSection list={a.passkeys} here={a.passkeysHere} />
      <SessionsSection />
    </div>
  );
}
