// Setări → Ale mele → Inteligență artificială (FD-AIKEYS §1): each user's own AI key (Anthropic, OpenAI or Google
// Gemini), the model, whether it scores their news, and what it spent today.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Sparkles } from 'lucide-react';
import { AI_PROVIDER_INFO, AI_PROVIDERS, effectiveModel, modelLabel, type AiProvider } from '../../shared/ai.ts';
import type { AiModelList, AiStatus, UsageCounts } from '../../shared/api-types.ts';
import type { SettingsView } from '../../shared/settings.ts';
import { api, errorMessage, qs } from '../api.ts';
import { fmtNum } from '../format.ts';
import { useSaveSettings } from '../hooks.ts';
import { Panel, Warning } from './ui.tsx';

const tokens = (c: UsageCounts) => `${fmtNum(c.input, 0)} / ${fmtNum(c.output, 0)} tokeni (intrare / ieșire)`;

export function AiSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const save = useSaveSettings();
  const provider = s.ai.provider;
  const info = AI_PROVIDER_INFO[provider];
  const keyView = s.aiKeys?.[provider] ?? { set: false, hint: null };
  const model = effectiveModel(provider, s.ai.model);
  const [key, setKey] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  // What depends on the user's AI: its state, the summary, and the scores they see.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ai'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
    void qc.invalidateQueries({ queryKey: ['sentiment'] });
    void qc.invalidateQueries({ queryKey: ['news'] });
  };
  const choose = (patch: { provider?: AiProvider; model?: string; scoring?: boolean }) => save.mutate({ ai: patch }, { onSuccess: refresh });
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatus>('/api/ai/status'), refetchInterval: 30_000 });
  const models = useQuery({
    queryKey: ['ai', 'models', provider, keyView.hint],
    queryFn: () => api.get<AiModelList>(`/api/ai/models${qs({ provider })}`),
    staleTime: 10 * 60_000,
  });
  const saveKey = useMutation({
    mutationFn: (k: string | null) => api.put<SettingsView & { aiKeyWarning?: string | null }>('/api/ai/key', { provider, key: k }),
    onMutate: () => setWarning(null),
    onSuccess: (data) => {
      setKey('');
      setWarning(data.aiKeyWarning ?? null);
      qc.setQueryData(['settings'], data);
      refresh();
    },
  });
  const rescore = useMutation({ mutationFn: () => api.post<{ reset: number }>('/api/ai/rescore', { hours: 48 }), onSuccess: refresh });

  const list = models.data?.models ?? info.models.map((m) => m.id);
  const options = list.includes(model) ? list : [model, ...list];
  const noteOf = (id: string) => info.models.find((m) => m.id === id)?.note;
  const aiScoring = s.ai.scoring && keyView.set;
  const st = status.data;
  const usage = st?.usage;

  return (
    <Panel id="ai" title="Inteligență artificială" icon={Sparkles}>
      <div className="flex max-w-[80ch] flex-col gap-4 text-[13px]">
        <p className="text-muted">
          Cu cheia ta API, Sentiq folosește modelul ales de tine pentru <strong className="text-text">Rezumatul zilei</strong> și, dacă vrei, pentru{' '}
          <strong className="text-text">scorul de sentiment al știrilor</strong>. Plătești direct la furnizor, după consum; cheia API se plătește separat de abonamentele
          Claude, ChatGPT sau Gemini. Fără cheie, sentimentul vine de la modelul local (gratuit), iar Rezumatul nu e disponibil.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-faint">Furnizor</span>
          <div className="seg self-start" role="group" aria-label="Furnizorul AI">
            {AI_PROVIDERS.map((p) => (
              <button key={p} type="button" aria-pressed={p === provider} disabled={save.isPending} onClick={() => p !== provider && choose({ provider: p })}>
                <span className="inline-flex items-center gap-1.5">
                  {AI_PROVIDER_INFO[p].product}
                  {s.aiKeys?.[p]?.set && <Check size={13} className="text-bull" aria-label="cheie salvată" />}
                </span>
              </button>
            ))}
          </div>
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) saveKey.mutate(key.trim());
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-faint">
              Cheia API {info.name} {keyView.set && <>(salvată: {keyView.hint})</>}
            </span>
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.keyPlaceholder} className="w-80 max-w-full" />
          </label>
          <button className="btn" disabled={!key.trim() || saveKey.isPending}>
            {saveKey.isPending ? 'Se verifică…' : keyView.set ? 'Înlocuiește cheia' : 'Salvează cheia'}
          </button>
          {keyView.set && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={saveKey.isPending}
              onClick={() => {
                if (window.confirm(`Ștergi cheia ${info.name}? Rezumatul și scorul cu ${info.product} se opresc până pui alta.`)) saveKey.mutate(null);
              }}
            >
              Șterge cheia
            </button>
          )}
          <a href={info.keysUrl} target="_blank" rel="noreferrer" className="inline-flex h-[38px] items-center gap-1 text-accent">
            Fă o cheie la {info.name} <ExternalLink size={13} aria-hidden />
          </a>
        </form>
        {warning && <Warning>{warning}</Warning>}
        {provider === 'gemini' && (
          <p className="text-faint">Pe nivelul gratuit Gemini, Google poate folosi datele trimise ca să-și îmbunătățească produsele; cu facturarea pornită, nu le folosește.</p>
        )}

        <label className="flex flex-col gap-1 self-start">
          <span className="text-faint">Model</span>
          <select value={model} onChange={(e) => choose({ model: e.target.value })} disabled={save.isPending} className="w-80 max-w-full">
            {options.map((id) => (
              <option key={id} value={id} title={id}>
                {modelLabel(id)}
                {noteOf(id) ? ` · ${noteOf(id)}` : ''}
              </option>
            ))}
          </select>
          {models.data?.source === 'key' ? (
            <span className="text-[12px] text-faint">Modelele pe care le poate folosi cheia ta.</span>
          ) : models.data?.error ? (
            <span className="text-[12px] text-faint">Lista cheii nu s-a putut citi ({models.data.error}): se arată modelele recomandate.</span>
          ) : null}
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-faint">Scorul de sentiment al știrilor</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="ai-scoring" checked={!s.ai.scoring} onChange={() => choose({ scoring: false })} disabled={save.isPending} className="mt-1" />
            <span>
              <strong>Model local</strong>: pe serverul Sentiq, plus reguli de piață. Gratuit; e scorul pe care îl văd toți cei fără AI propriu.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="ai-scoring" checked={s.ai.scoring} onChange={() => choose({ scoring: true })} disabled={save.isPending || !keyView.set} className="mt-1" />
            <span className={keyView.set ? undefined : 'text-faint'}>
              <strong>{info.product}</strong> ({model}), cu cheia ta: înțelege mai bine implicațiile macro. Titlurile știrilor din ultimele 48 de ore se trimit la {info.name}, în
              loturi de 25; costul crește cu numărul de știri (de obicei câteva sute pe zi). Scorurile și sentimentul zilei calculate așa le vezi doar tu.
              {!keyView.set && ' Pune întâi cheia.'}
            </span>
          </label>
        </fieldset>
        {s.ai.scoring && !keyView.set && <Warning>Fără cheia {info.name}, scorul știrilor vine în continuare de la modelul local.</Warning>}
        {aiScoring && st?.scorer?.lastError && (
          <Warning>
            {info.product}: {st.scorer.lastError.message}.{' '}
            {st.scorer.lastError.permanent ? 'Până schimbi cheia sau modelul, vezi scorul modelului local.' : 'Între timp vezi scorul modelului local; se reîncearcă automat.'}
          </Warning>
        )}

        <section aria-labelledby="ai-use" className="flex flex-col gap-2 rounded-[10px] border border-line px-4 py-3">
          <h3 id="ai-use" className="text-[13px] font-semibold text-text">
            Ce a consumat cheia ta azi{usage && <span className="font-normal text-faint"> · ziua UTC {usage.day}</span>}
          </h3>
          <ul className="flex flex-col gap-1.5 text-muted">
            <li>
              <span className="text-text">Scorul știrilor</span>:{' '}
              {!usage
                ? '…'
                : usage.sentiment.calls === 0
                  ? aiScoring
                    ? 'nimic încă azi.'
                    : 'nimic: scorul vine de la modelul local.'
                  : `${fmtNum(usage.sentiment.items, 0)} titluri în ${fmtNum(usage.sentiment.calls, 0)} apeluri, ${tokens(usage.sentiment)}${usage.sentiment.model ? `, cu ${usage.sentiment.model}` : ''}.`}
            </li>
            <li>
              <span className="text-text">Rezumatul zilei</span>:{' '}
              {!usage
                ? '…'
                : usage.summary.calls === 0
                  ? 'niciun rezumat azi.'
                  : `${fmtNum(usage.summary.calls, 0)} ${usage.summary.calls === 1 ? 'rezumat' : 'rezumate'}, ${tokens(usage.summary)}${usage.summary.model ? `, cu ${usage.summary.model}` : ''}.`}
            </li>
          </ul>
          <p className="text-faint">Prețul în dolari îl arată consola furnizorului. Se trimit doar titlurile știrilor (pentru scor) și datele zilei din Sentiq (pentru Rezumat: sentimentul, știrile, calendarul, indicatorii, contextul pieței, favoritele tale), niciodată conturile, cheile sau portofoliile.</p>
        </section>

        {aiScoring && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => rescore.mutate()} disabled={rescore.isPending}>
              Scorează din nou ultimele 48 h
            </button>
            <span className="text-faint">după ce schimbi modelul, de exemplu.</span>
            {rescore.data && <span className="text-muted">{rescore.data.reset} știri trimise la rescorare.</span>}
          </div>
        )}
        {(save.error || saveKey.error || rescore.error) && <div className="text-bear">{errorMessage(save.error ?? saveKey.error ?? rescore.error)}</div>}
      </div>
    </Panel>
  );
}
