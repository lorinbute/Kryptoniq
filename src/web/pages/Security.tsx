// The signed-in user's own security (FD-USERS §7): name, password, two-factor with recovery codes (required since
// FD-2FA: it can be moved to a new phone, never turned off), passkeys and signing out everywhere.
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, LogOut, Pencil, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { AccountInfo, PasskeySummary, PublicUser, TwoFactorView } from '../../shared/api-types.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { AUTH_KEY, landAfterSignOut, useAuthChange } from '../auth.ts';
import { fmtAgo, fmtDateTime } from '../format.ts';
import { ACCOUNT_KEY, useAccountInfo, useTz } from '../hooks.ts';
import { ErrorNote, Loading, Panel, Warning } from '../components/ui.tsx';
import { RecoveryCodes } from '../components/RecoveryCodes.tsx';
import { TotpManualKey, TotpQrImage } from '../components/TotpQr.tsx';
import { passkeyMessage } from '../passkey.ts';


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


/** Password + a code: what changing the authenticator or renewing the codes asks for (FD-USERS §7, FD-2FA §3). */
function ConfirmWithCode({ action, onSubmit, busy, error, onCancel }: { action: string; onSubmit: (password: string, code: string) => void; busy: boolean; error: unknown; onCancel: () => void }) {
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
      <button className="btn" disabled={busy}>
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
  const [mode, setMode] = useState<'none' | 'replace' | 'renew'>('none');
  const setView = (v: TwoFactorView) => qc.setQueryData<AccountInfo>(ACCOUNT_KEY, (a) => (a ? { ...a, twoFactor: v } : a));
  // FD-2FA §3: a new phone. The old app works until the new one's first code is confirmed.
  const replace = useMutation({
    mutationFn: (b: { password: string; code: string }) => api.post<TwoFactorView>('/api/account/2fa/replace', b),
    onSuccess: (v) => {
      setMode('none');
      // A new change starts clean: no code typed or error left from an earlier one.
      setCode('');
      confirm.reset();
      setView(v);
      refresh();
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.post<TwoFactorView>('/api/account/2fa/replace/confirm', { code }),
    onSuccess: (v) => {
      setCode('');
      setView(v);
      refresh();
    },
    // Finished or abandoned in another tab: the state of now.
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NO_REPLACEMENT') refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<TwoFactorView>('/api/account/2fa/replace/cancel'),
    onSuccess: (v) => {
      setCode('');
      confirm.reset();
      setView(v);
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
  } else if (tf.replacing && tf.qr) {
    body = (
      <div className="flex flex-col gap-4 text-[13.5px] md:flex-row md:items-start">
        <TotpQrImage qr={tf.qr} />
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>Deschide aplicația de autentificare pe telefonul nou.</li>
            <li>Scanează codul QR.</li>
            <li>Scrie mai jos codul de 6 cifre pe care îl arată aplicația nouă.</li>
          </ol>
          <TotpManualKey secret={tf.secret} />
          <p className="text-faint">Până confirmi, aplicația de acum merge în continuare; „Renunță” o păstrează.</p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-faint">Codul din aplicația nouă</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required className="num w-36 tracking-[0.2em]" />
            </label>
            <button className="btn btn-primary" disabled={confirm.isPending}>
              Confirmă
            </button>
            <button type="button" className="btn" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Renunță
            </button>
          </form>
          {(confirm.error || cancel.error) && <Msg tone="error">{errorMessage(confirm.error ?? cancel.error)}</Msg>}
        </div>
      </div>
    );
  } else if (tf.enabled) {
    body = (
      <div className="flex flex-col gap-3 text-[13.5px]">
        <p>
          <span className="text-bull">Activă</span>
          {tf.confirmedAt ? ` din ${fmtDateTime(tf.confirmedAt, tz)}` : ''}. La intrare, după parolă, îți cerem codul din aplicația de autentificare. E obligatorie pentru toate
          conturile, deci nu se poate opri; pentru un telefon nou, schimbă aplicația.
        </p>
        {confirm.isSuccess && <Msg>Aplicația nouă e activă; cea veche nu mai merge.</Msg>}
        {tf.recoveryCodesLeft <= 3 ? (
          <Warning>
            Mai ai {tf.recoveryCodesLeft === 1 ? 'un singur cod' : `${tf.recoveryCodesLeft} coduri`} de recuperare. Generează altele noi cât ai acces la aplicație.
          </Warning>
        ) : (
          <p className="text-muted">Coduri de recuperare rămase: {tf.recoveryCodesLeft} din 10.</p>
        )}
        {mode === 'none' && (
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setMode('replace')}>
              Schimbă aplicația de autentificare
            </button>
            <button className="btn" onClick={() => setMode('renew')}>
              Coduri de recuperare noi
            </button>
          </div>
        )}
        {mode === 'replace' && (
          <ConfirmWithCode
            action="Continuă"
            busy={replace.isPending}
            error={replace.error}
            onCancel={() => setMode('none')}
            onSubmit={(password, c) => replace.mutate({ password, code: c })}
          />
        )}
        {mode === 'renew' && (
          <ConfirmWithCode action="Generează coduri noi" busy={renew.isPending} error={renew.error} onCancel={() => setMode('none')} onSubmit={(password, c) => renew.mutate({ password, code: c })} />
        )}
      </div>
    );
  } else {
    // Not reachable from the app (an account without two-factor sees only its setup, FD-2FA); a page left open while
    // the admin reset it closes with the session.
    body = <p className="text-[13.5px] text-muted">Autentificarea în doi pași nu e configurată. Reîncarcă pagina ca s-o configurezi.</p>;
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
            if (window.confirm(`Ștergi passkey-ul „${p.name}”? Vei intra cu parola și codul din aplicația de autentificare.`)) remove.mutate();
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
  const account = useAccountInfo();
  const [params] = useSearchParams();
  if (account.isPending) return <Loading />;
  if (!account.data) return <ErrorNote error={account.error} onRetry={() => void account.refetch()} />;
  const a = account.data;
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3.5">
      <h1 className="page-title">Securitate</h1>
      {params.get('recovery') === '1' && (
        <Warning>
          Ai intrat cu un cod de recuperare; mai ai {a.twoFactor.recoveryCodesLeft}. Dacă ți-ai pierdut telefonul, schimbă aplicația de autentificare (cu parola și un cod de
          recuperare) sau generează coduri noi.
        </Warning>
      )}
      <ProfileSection user={a.user} />
      <PasswordSection email={a.user.email} />
      <TwoFactorSection tf={a.twoFactor} />
      <PasskeysSection list={a.passkeys} here={a.passkeysHere} />
      <SessionsSection />
    </div>
  );
}
