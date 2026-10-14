// "Adaugă un cont" (FD-SENTIQ §2): pick the exchange or broker by its logo, follow its steps for a read-only key,
// fill in exactly the fields it asks for, and connect; the key is verified before the account is kept.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Check, ExternalLink, Eye, EyeOff, Search, ShieldCheck, X } from 'lucide-react';
import type { AccountView } from '../../shared/api-types.ts';
import { PROVIDERS, type ProviderDef } from '../../shared/providers.ts';
import { api, errorMessage } from '../api.ts';
import { ProviderLogo } from './ProviderLogo.tsx';
import { invalidatePriceSource } from '../hooks.ts';

type Filter = 'all' | 'crypto' | 'stocks';
const KIND_RO = { crypto: 'Crypto', stocks: 'Acțiuni' } as const;

function ProviderCard({ p, onPick }: { p: ProviderDef; onPick: (p: ProviderDef) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      className="flex min-h-[112px] flex-col items-start gap-2.5 rounded-xl border border-line bg-panel-2 p-3.5 text-left transition-colors hover:border-accent hover:bg-hover"
    >
      <span className="flex w-full items-center gap-2.5">
        <ProviderLogo id={p.id} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-text">{p.name}</span>
          <span className="block text-[11.5px] text-faint">{KIND_RO[p.kind]}</span>
        </span>
      </span>
      <span className="text-[12px] leading-[1.45] text-muted">Citește {p.reads}.</span>
    </button>
  );
}

function SecretInput({ id, value, onChange, placeholder, multiline }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [shown, setShown] = useState(false);
  if (multiline) {
    return (
      <div className="relative">
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          spellCheck={false}
          autoComplete="off"
          className={clsx('num w-full resize-y text-[12px]', !shown && value && '[-webkit-text-security:disc]')}
        />
        <button type="button" className="absolute top-2 right-2 rounded-md p-1 text-faint transition-colors hover:bg-hover hover:text-accent" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Ascunde' : 'Arată'}>
          {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className="num w-full pr-10" />
      <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-faint transition-colors hover:bg-hover hover:text-accent" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Ascunde' : 'Arată'}>
        {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      </button>
    </div>
  );
}

function KeyForm({ p, onBack, onConnected }: { p: ProviderDef; onBack: () => void; onConnected: (a: AccountView) => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const [label, setLabel] = useState(`${p.name} principal`);
  const [env, setEnv] = useState(p.envs?.[0]?.id ?? 'live');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(p.fields.map((f) => [f.key, ''])));
  const [local, setLocal] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api.post<AccountView>('/api/accounts', { exchange: p.id, label: label.trim(), env, credentials: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
      // A new exchange can become where this user's crypto prices come from (FD-MARKETSRC).
      invalidatePriceSource(qc);
      onConnected(a);
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing = p.fields.filter((f) => !values[f.key]?.trim()).map((f) => f.label);
    if (!label.trim()) missing.unshift('Nume cont');
    if (missing.length) {
      setLocal(`Completează: ${missing.join(', ')}.`);
      return;
    }
    for (const f of p.fields) {
      if (f.pattern && !new RegExp(f.pattern).test(values[f.key]?.trim() ?? '')) {
        setLocal(`${f.label}: ${f.patternHint ?? 'format greșit'}.`);
        return;
      }
    }
    setLocal(null);
    connect.mutate();
  };
  const error = local ?? (connect.isError ? errorMessage(connect.error) : null);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
      <section aria-labelledby={`${formId}-how`} className="flex flex-col gap-3">
        <h3 id={`${formId}-how`} className="inline-flex items-center gap-2 text-[14px] font-semibold">
          <ShieldCheck size={16} className="text-bull" aria-hidden /> Cum creezi o cheie doar pentru citire
        </h3>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-[1.5] text-muted marker:text-faint">
          {p.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {p.keysUrl && (
          <a href={p.keysUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 self-start text-[13px] text-link">
            Deschide pagina de chei <ExternalLink size={13} aria-hidden />
          </a>
        )}
        <p className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2.5 text-[12px] leading-[1.5] text-faint">
          Sentiq doar citește: nu plasează, nu modifică și nu anulează ordine și nu mută fonduri. Cheile se păstrează criptat în baza Sentiq și nu mai sunt afișate.
        </p>
      </section>
      <form onSubmit={submit} className="flex flex-col gap-3.5" aria-describedby={error ? `${formId}-err` : undefined} noValidate>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-muted">Nume cont</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        {p.envs && (
          <div className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-muted" id={`${formId}-env`}>
              Mediu
            </span>
            <div className="seg self-start" role="group" aria-labelledby={`${formId}-env`}>
              {p.envs.map((e) => (
                <button key={e.id} type="button" aria-pressed={env === e.id} onClick={() => setEnv(e.id)}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {p.fields.map((f) => {
          const id = `${formId}-${f.key}`;
          const set = (v: string) => setValues((x) => ({ ...x, [f.key]: v }));
          return (
            <div key={f.key} className="flex flex-col gap-1.5 text-[13px]">
              <label htmlFor={id} className="text-muted">
                {f.label}
              </label>
              {f.secret ? (
                <SecretInput id={id} value={values[f.key] ?? ''} onChange={set} placeholder={f.placeholder} multiline={f.multiline} />
              ) : (
                <input id={id} value={values[f.key] ?? ''} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} autoComplete="off" spellCheck={false} className="num" />
              )}
            </div>
          );
        })}
        {error && (
          <div id={`${formId}-err`} role="alert" className="rounded-lg border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13px] text-bear">
            {error}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={connect.isPending}>
            {connect.isPending ? 'Se verifică cheia…' : 'Conectează'}
          </button>
          <button type="button" className="btn" onClick={onBack} disabled={connect.isPending}>
            <ArrowLeft size={15} aria-hidden /> Altă platformă
          </button>
        </div>
      </form>
    </div>
  );
}

export function AccountWizard({ onClose, onDone }: { onClose: () => void; onDone?: (a: AccountView) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ProviderDef | null>(null);
  const [done, setDone] = useState<AccountView | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return PROVIDERS.filter((p) => (filter === 'all' || p.kind === filter) && (!f || p.name.toLowerCase().includes(f)));
  }, [filter, q]);

  useEffect(() => {
    // Dialog: focus inside, Tab stays inside, Esc closes, focus returns to the opener.
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') ?? [])];
    requestAnimationFrame(() => (dialog.current?.querySelector<HTMLElement>('input, button:not(:disabled)') ?? dialog.current)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const els = focusable();
        if (!els.length) return;
        const first = els[0] as HTMLElement;
        const last = els[els.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  // Each step starts at its top, with the focus on its first field.
  useEffect(() => {
    requestAnimationFrame(() => {
      dialog.current?.querySelector('[data-scroll]')?.scrollTo({ top: 0 });
      dialog.current?.querySelector<HTMLElement>(picked && !done ? 'form input' : 'button:not(:disabled)')?.focus();
    });
  }, [picked, done]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-3 pt-[6vh] pb-6 backdrop-blur-sm sm:px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[88vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-modal">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          {picked && !done && <ProviderLogo id={picked.id} size={28} />}
          <h2 id={titleId} className="flex-1 text-[16px] font-semibold">
            {done ? 'Cont conectat' : picked ? `Conectează ${picked.name}` : 'Adaugă un cont'}
          </h2>
          <span className="hidden text-[12px] text-faint sm:inline">{done ? '' : picked ? 'Pasul 2 din 2' : 'Pasul 1 din 2'}</span>
          <button className="btn w-[38px] px-0" onClick={onClose} aria-label="Închide">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div data-scroll className="flex-1 overflow-y-auto px-5 py-5">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-bull/15 text-bull">
                <Check size={24} aria-hidden />
              </span>
              <ProviderLogo id={done.exchange} size={40} />
              <p className="text-[15px] font-semibold">„{done.label}” e conectat.</p>
              <p className="max-w-[48ch] text-[13px] text-muted">Pozițiile, ordinele și tranzacțiile apar în Tranzacții și, pe grafice, la „Pozițiile mele”.</p>
              <button
                className="btn btn-primary mt-2"
                onClick={() => {
                  onDone?.(done);
                  onClose();
                }}
              >
                Gata
              </button>
            </div>
          ) : picked ? (
            <KeyForm p={picked} onBack={() => setPicked(null)} onConnected={setDone} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="seg" role="group" aria-label="Tip">
                  {(['all', 'crypto', 'stocks'] as const).map((f) => (
                    <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'Toate' : KIND_RO[f]}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
                  <input aria-label="Caută o platformă" placeholder="Caută, ex. Binance" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 pl-9" />
                </div>
              </div>
              {list.length === 0 ? (
                <p className="py-6 text-center text-[13.5px] text-faint">Nicio platformă cu acest nume.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p) => (
                    <ProviderCard key={p.id} p={p} onPick={setPicked} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
