// The sign-in screens (FD-USERS §3–§6): sign in (password, then a code; or a passkey), create an account, confirm
// the email, forgotten password, and the admin's first password. Everything a signed-out visitor can reach.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router';
import { browserSupportsWebAuthn, startAuthentication, WebAuthnError } from '@simplewebauthn/browser';
import { Fingerprint, Loader2 } from 'lucide-react';
import type { AuthState, LoginResult, PublicUser } from '../../shared/api-types.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { afterSignInTarget, afterSignOutTarget, clearAfterSignOut, landAfterSignIn, landAfterSignOut, safeNext, useAuthChange } from '../auth.ts';
import { Loading } from '../components/ui.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';

/** The page shell: the mark, a title, one column. */
function Shell({ title, lead, children, footer }: { title: string; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Sentiq`;
    return () => {
      document.title = 'Sentiq';
    };
  }, [title]);
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <ThemeToggle className="absolute top-4 right-4" />
      <main className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <img src="/brand/sentiq-64.png" alt="" width={40} height={40} className="size-10" aria-hidden />
          <span className="text-[20px] font-[650] tracking-[-0.02em]">Sentiq</span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-[26px] leading-tight font-[650] tracking-[-0.03em]">{title}</h1>
          {lead && <div className="text-[14px] text-muted">{lead}</div>}
        </div>
        <div className="panel flex flex-col gap-4 p-6">{children}</div>
        {footer && <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">{footer}</div>}
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13.5px]">
      <span className="text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12.5px] text-faint">{hint}</span>}
    </label>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13.5px]">
      {errorMessage(error)}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-[10px] border border-line-strong bg-panel-2 px-3 py-2.5 text-[13.5px] text-muted">{children}</div>;
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button className="btn btn-primary w-full" disabled={busy}>
      {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const inputClass = 'w-full';

/** A WebAuthn failure the person can understand (cancelled, no passkey for this site…). */
export function passkeyMessage(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_CEREMONY_ABORTED' || (err.cause instanceof Error && err.cause.name === 'NotAllowedError')) return 'Operația a fost anulată sau a expirat.';
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'Acest dispozitiv are deja un passkey pentru contul tău.';
    if (err.code === 'ERROR_INVALID_DOMAIN' || err.code === 'ERROR_INVALID_RP_ID') return 'Passkey-urile merg doar pe http://localhost sau pe HTTPS.';
    return err.message;
  }
  if (err instanceof Error && err.name === 'NotAllowedError') return 'Operația a fost anulată sau a expirat.';
  return errorMessage(err);
}

/** Where to go after signing in: ?next=… or home; after a recovery code, the Security page says how many are left. */
function useFinishSignIn() {
  const [params] = useSearchParams();
  const change = useAuthChange();
  return (r: { user: PublicUser; usedRecoveryCode?: boolean }) => {
    landAfterSignIn(r.usedRecoveryCode ? '/security?recovery=1' : safeNext(params.get('next')));
    change(r.user);
  };
}

function LoginPage({ state }: { state: AuthState }) {
  const [params] = useSearchParams();
  // After an activation the address comes along (FD-INVITE §3).
  const [email, setEmail] = useState(() => {
    const e = params.get('email') ?? '';
    return e.length <= 254 && e.includes('@') ? e : '';
  });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const finish = useFinishSignIn();
  const codeRef = useRef<HTMLInputElement>(null);
  const canPasskey = state.passkeys && browserSupportsWebAuthn();

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  if (state.setupNeeded && state.setupHere) return <Navigate to="/setup" replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
      // The 5 minutes for the code ran out: back to the password.
      if (err instanceof ApiError && err.code === 'LOGIN_EXPIRED') {
        setStep('password');
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.post<LoginResult>('/api/auth/login', { email, password });
      if (r.status === '2fa') {
        setPassword('');
        setStep('code');
      } else finish(r);
    });
  };
  const onCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.post<LoginResult>('/api/auth/login/2fa', { code });
      if (r.status === 'ok') finish(r);
    });
  };
  const onPasskey = () =>
    void run(async () => {
      const options = await api.post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkey/options');
      let response;
      try {
        response = await startAuthentication({ optionsJSON: options });
      } catch (err) {
        throw new Error(passkeyMessage(err));
      }
      finish(await api.post<{ status: 'ok'; user: PublicUser }>('/api/auth/passkey', { response }));
    });

  if (step === 'code') {
    return (
      <Shell title="Codul de verificare" lead="Contul tău folosește autentificarea în doi pași. Ai 5 minute.">
        <form className="flex flex-col gap-4" onSubmit={onCode}>
          <Field label="Codul din aplicația de autentificare" hint="Sau unul din codurile de recuperare (de forma XXXXX-XXXXX).">
            <input
              ref={codeRef}
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={20}
              required
            />
          </Field>
          <FormError error={error} />
          <Submit busy={busy}>Verifică</Submit>
        </form>
        <button
          type="button"
          className="self-start text-[13px] text-link hover:underline"
          onClick={() => {
            setStep('password');
            setCode('');
            setError(null);
          }}
        >
          Înapoi la parolă
        </button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Intră în cont"
      lead={params.get('reset') === '1' ? 'Parola e schimbată. Intră cu parola nouă.' : params.get('activated') === '1' ? 'Contul e activ. Intră cu parola nouă.' : undefined}
      footer={
        <>
          <Link to="/forgot">Am uitat parola</Link>
          <Link to="/request-account">Cere un cont</Link>
        </>
      }
    >
      {state.setupNeeded && !state.setupHere && (
        <Note>Contul de admin nu are încă parolă. Adminul o setează din browserul Mac-ului pe care rulează Sentiq (http://localhost).</Note>
      )}
      <form className="flex flex-col gap-4" onSubmit={onPassword}>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username webauthn" required maxLength={254} />
        </Field>
        <Field label="Parola">
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} />
        </Field>
        <FormError error={error} />
        <Submit busy={busy}>Intră</Submit>
      </form>
      {canPasskey ? (
        <>
          <div className="flex items-center gap-3 text-[12.5px] text-faint" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            sau
            <span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" className="btn w-full" onClick={onPasskey} disabled={busy}>
            <Fingerprint size={16} aria-hidden />
            Intră cu un passkey
          </button>
        </>
      ) : (
        !state.passkeys && (
          <p className="text-[12.5px] text-faint">
            Passkey-urile merg doar când Sentiq e deschis la <span className="num">http://localhost:{window.location.port || '4317'}</span> pe Mac-ul care îl rulează.
          </p>
        )
      )}
    </Shell>
  );
}

/** FD-INVITE §1: asking for an account (no password: the admin approves, a link activates it). */
function RequestAccountPage({ state }: { state: AuthState }) {
  const [form, setForm] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone((await api.post<{ message: string }>('/api/auth/request-account', { name: form.name, email: form.email })).message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <Shell title="Cererea e trimisă" footer={<Link to="/login">Înapoi la autentificare</Link>}>
        <p className="text-[14px]">{done}</p>
        <p className="text-[13.5px] text-muted">Linkul de activare e valabil 7 zile. Verifică și folderul Spam.</p>
        {state.devMail && <Note>Deocamdată emailurile Sentiq ajung doar la admin: linkul de activare ți-l trimite el.</Note>}
      </Shell>
    );
  }
  return (
    <Shell title="Cere un cont" lead="Sentiq e folosit de un grup mic. Adminul îți aprobă cererea, apoi primești pe email linkul de activare." footer={<Link to="/login">Am deja cont</Link>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Nume">
          <input className={inputClass} value={form.name} onChange={set('name')} autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} autoComplete="email" required maxLength={254} />
        </Field>
        <FormError error={error} />
        <Submit busy={busy}>Trimite cererea</Submit>
      </form>
    </Shell>
  );
}

/** Reads ?token= once, then takes it out of the address bar (and so out of the browser history). */
function useOneTimeToken(): string {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (window.location.search.includes('token=')) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  return token;
}

/** FD-INVITE §3: the link from the approval mail: the first password, then the sign-in. */
function ActivatePage({ state }: { state: AuthState }) {
  // Opened in a browser signed in with another account (the admin trying the link): say how to use the new one.
  const signedIn = state.user;
  const token = useOneTimeToken();
  const [info, setInfo] = useState<{ valid: false } | { valid: true; email: string; name: string } | null>(null);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    api
      .post<{ valid: false } | { valid: true; email: string; name: string }>('/api/auth/activate/check', { token })
      .then(setInfo)
      .catch(() => setInfo({ valid: false }));
  }, [token]);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError(new Error('Parolele nu coincid.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDone((await api.post<{ email: string }>('/api/auth/activate', { token, password: form.password })).email);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <Shell title="Contul e activ">
        <p className="text-[14px]">
          Parola e setată pentru <span className="text-text">{done}</span>. Acum poți intra în cont.
        </p>
        {signedIn && (
          <Note>
            Acest browser e în contul {signedIn.email ?? signedIn.name}. Ca să intri cu {done}, ieși întâi din el (meniul cu inițiala, sus în dreapta) sau folosește alt browser.
          </Note>
        )}
        <Link to={`/login?activated=1&email=${encodeURIComponent(done)}`} className="btn btn-primary w-full">
          Intră în cont
        </Link>
      </Shell>
    );
  }
  if (!info) return <Shell title="Activează-ți contul">{<Loading />}</Shell>;
  if (!info.valid) {
    return (
      <Shell title="Linkul nu mai e valabil" footer={<Link to="/login">Înapoi la autentificare</Link>}>
        <p className="text-[13.5px] text-muted">Linkul de activare merge o singură dată și e valabil 7 zile. Cere adminului unul nou.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Activează-ți contul" lead="Cererea ta a fost aprobată. Alege parola cu care vei intra în Sentiq.">
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Nume">
          <input className={inputClass} value={info.name} readOnly />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={info.email} autoComplete="username" readOnly />
        </Field>
        <Field label="Parola" hint={state.passwordRule}>
          <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" required minLength={12} maxLength={200} />
        </Field>
        <Field label="Parola, încă o dată">
          <input className={inputClass} type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} autoComplete="new-password" required maxLength={200} />
        </Field>
        <FormError error={error} />
        <Submit busy={busy}>Activează contul</Submit>
      </form>
    </Shell>
  );
}

function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone((await api.post<{ message: string }>('/api/auth/forgot', { email })).message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Parolă nouă" lead={done ? undefined : 'Îți trimitem un link pe email. Autentificarea în doi pași rămâne așa cum e.'} footer={<Link to="/login">Înapoi la autentificare</Link>}>
      {done ? (
        <p className="text-[14px]">{done}</p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} />
          </Field>
          <FormError error={error} />
          <Submit busy={busy}>Trimite linkul</Submit>
        </form>
      )}
    </Shell>
  );
}

function ResetPasswordPage({ state }: { state: AuthState }) {
  const token = useOneTimeToken();
  const navigate = useNavigate();
  const [valid, setValid] = useState<boolean | null>(null);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api
      .post<{ valid: boolean }>('/api/auth/reset/check', { token })
      .then((r) => setValid(r.valid))
      .catch(() => setValid(false));
  }, [token]);
  const change = useAuthChange();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError(new Error('Parolele nu coincid.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset', { token, password: form.password });
      // Every session ended, this browser's too. Signed in, the page goes away with the user (the landing takes
      // over); signed out, nothing about the user changes and the page moves on by itself.
      landAfterSignOut('/login?reset=1');
      change(null);
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (valid === null) return <Shell title="Parolă nouă">{<Loading />}</Shell>;
  if (!valid) {
    return (
      <Shell title="Linkul nu mai e valabil" footer={<Link to="/forgot">Cere un link nou</Link>}>
        <p className="text-[13.5px] text-muted">Linkurile pentru parolă nouă sunt valabile o oră și merg o singură dată.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Alege o parolă nouă" lead="Toate sesiunile deschise se vor închide.">
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Parola nouă" hint={state.passwordRule}>
          <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" required maxLength={200} />
        </Field>
        <Field label="Parola nouă, încă o dată">
          <input className={inputClass} type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} autoComplete="new-password" required maxLength={200} />
        </Field>
        <FormError error={error} />
        <Submit busy={busy}>Salvează parola</Submit>
      </form>
    </Shell>
  );
}

function SetupPage({ state }: { state: AuthState }) {
  const [form, setForm] = useState({ name: '', email: state.adminEmail ?? '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const change = useAuthChange();
  if (!state.setupNeeded) return <Navigate to="/login" replace />;
  if (!state.setupHere) {
    return (
      <Shell title="Contul de admin" footer={<Link to="/login">Înapoi la autentificare</Link>}>
        <p className="text-[14px]">Parola contului de admin se setează doar din browserul Mac-ului pe care rulează Sentiq, la http://localhost.</p>
      </Shell>
    );
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError(new Error('Parolele nu coincid.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: PublicUser }>('/api/auth/setup', { name: form.name, email: form.email, password: form.password });
      landAfterSignIn('/security?welcome=1');
      change(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Bun venit în Sentiq" lead="Setează parola contului de admin. Tot ce ai configurat până acum (favorite, conturi, setări) rămâne al tău.">
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Nume">
          <input className={inputClass} value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} autoComplete="username" required readOnly={Boolean(state.adminEmail)} maxLength={254} />
        </Field>
        <Field label="Parola" hint={state.passwordRule}>
          <input className={inputClass} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required minLength={12} maxLength={200} />
        </Field>
        <Field label="Parola, încă o dată">
          <input className={inputClass} type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required maxLength={200} />
        </Field>
        <FormError error={error} />
        <Submit busy={busy}>Setează parola și intră</Submit>
      </form>
    </Shell>
  );
}

/** Everything a signed-out visitor sees. Any other address goes to the sign-in, remembering where it was headed. */
export function SignedOutApp({ state }: { state: AuthState }) {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  const landing = afterSignOutTarget();
  useEffect(() => {
    if (landing && next === landing) clearAfterSignOut();
  }, [landing, next]);
  if (landing && next !== landing) return <Navigate to={landing} replace />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage state={state} />} />
      <Route path="/request-account" element={<RequestAccountPage state={state} />} />
      <Route path="/activate" element={<ActivatePage state={state} />} />
      {/* The addresses of the old self-registration (FD-INVITE §4). */}
      <Route path="/register" element={<Navigate to="/request-account" replace />} />
      <Route path="/verify-email" element={<Navigate to="/login" replace />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage state={state} />} />
      <Route path="/setup" element={<SetupPage state={state} />} />
      <Route path="*" element={<Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />} />
    </Routes>
  );
}

/** Signed in: the links from the mails still work; the other sign-in pages go where the sign-in asked, or home. */
export function SignedInAuthRoutes({ state }: { state: AuthState }) {
  const [params] = useSearchParams();
  return (
    <Routes>
      <Route path="/activate" element={<ActivatePage state={state} />} />
      <Route path="/reset-password" element={<ResetPasswordPage state={state} />} />
      <Route path="*" element={<Navigate to={afterSignInTarget() ?? safeNext(params.get('next'))} replace />} />
    </Routes>
  );
}
