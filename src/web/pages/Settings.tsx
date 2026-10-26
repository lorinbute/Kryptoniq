// Setări → Ale mele (FD-ADMINSET, FD-MARKETSRC): each user's own settings. The admin also gets the tab of everyone's
// (SettingsAdmin). Where prices come from is not a setting here: the connected exchange decides (a choice from two up).
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { KeyRound, Plus, SlidersHorizontal } from 'lucide-react';
import type { AccountView } from '../../shared/api-types.ts';
import type { SettingsView } from '../../shared/settings.ts';
import { api, errorMessage } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { invalidatePriceSource, useHashScroll, useMarketSource, useSaveSettings, useSettings } from '../hooks.ts';
import { useIsAdmin } from '../auth.ts';
import { ErrorNote, Loading, Panel } from '../components/ui.tsx';
import { AccountWizard } from '../components/AccountWizard.tsx';
import { AiSection } from '../components/AiSettings.tsx';
import { StockDataSection } from '../components/StockDataSettings.tsx';
import { StockNewsSection } from '../components/StockNewsSettings.tsx';
import { ProviderLogo } from '../components/ProviderLogo.tsx';
import { SettingsTabs } from '../components/SettingsTabs.tsx';
import { providerById } from '../../shared/providers.ts';

/**
 * FD-MARKETSRC §2: with two or more exchanges that can give prices, the user picks the one their charts, strip and
 * signals use. With one (or none) there is nothing to choose: it is that one (or the admin's default).
 */
function PriceSourceChoice() {
  const qc = useQueryClient();
  const src = useMarketSource();
  const save = useSaveSettings();
  const list = src.data?.connected ?? [];
  if (list.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
      <span className="text-muted">Prețurile crypto vin de la:</span>
      <div className="seg" role="group" aria-label="Prețurile crypto vin de la">
        {list.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={src.data?.userExchange === id}
            disabled={save.isPending}
            onClick={() => save.mutate({ market: { exchange: id } }, { onSuccess: () => invalidatePriceSource(qc) })}
          >
            <span className="inline-flex items-center gap-1.5">
              <ProviderLogo id={id} size={16} />
              {providerById(id)?.name ?? id}
            </span>
          </button>
        ))}
      </div>
      <span className="text-[12px] text-faint">Graficele, banda de sus și semnalele de pe Azi folosesc prețurile lui.</span>
      {save.error && <span className="text-bear">{errorMessage(save.error)}</span>}
    </div>
  );
}

/** The user's accounts (the section and the page's anchor scroll share the query). */
const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountView[]>('/api/accounts') });

function AccountsSection() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [wizard, setWizard] = useState(false);
  const closeWizard = useCallback(() => setWizard(false), []);
  const test = useMutation({ mutationFn: (id: number) => api.post<AccountView>(`/api/accounts/${id}/test`), onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
      invalidatePriceSource(qc);
    },
  });
  const list = accounts.data ?? [];
  return (
    <Panel
      title="Conturi (exchange-uri și brokeri)"
      icon={KeyRound}
      actions={
        <button className="btn btn-primary" onClick={() => setWizard(true)}>
          <Plus size={15} aria-hidden /> Adaugă un cont
        </button>
      }
    >
      <div id="accounts" className="flex flex-col gap-3 text-[13px]">
        <p className="max-w-[75ch] text-muted">
          Exchange-uri crypto și brokeri de acțiuni. Cheia trebuie să poată citi; ca să tranzacționezi din Sentiq, și să tranzacționeze, dar niciodată să retragă sau să transfere
          fonduri. Restricționează cheile la IP-urile serverului Sentiq (lista e în pașii fiecărei platforme). Tranzacționarea se pornește pe cont, din Tranzacții. Cheile se salvează criptat în baza Sentiq și nu mai sunt afișate după salvare.
        </p>
        {accounts.isError && <ErrorNote error={accounts.error} onRetry={() => accounts.refetch()} />}
        {accounts.data && list.length === 0 && <p className="text-faint">Niciun cont conectat încă.</p>}
        {list.map((a) => {
          const provider = providerById(a.exchange);
          const envLabel = provider?.envs?.find((e) => e.id === a.env)?.label;
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3.5 py-2.5">
              <ProviderLogo id={a.exchange} size={28} />
              <span className="flex min-w-0 flex-col">
                <strong className="truncate">{a.label}</strong>
                <span className="text-[12px] text-faint">
                  {provider?.name ?? a.exchange}
                  {envLabel && a.env !== provider?.envs?.[0]?.id ? `, ${envLabel}` : ''}
                </span>
              </span>
              <span className="num text-faint">{a.keyHint}</span>
              {a.lastError ? <span className="text-bear">{a.lastError}</span> : a.lastOkAt ? <span className="text-bull">conectat {fmtAgo(a.lastOkAt)}</span> : null}
              {a.fundsRisk ? (
                <span className="text-bear">cheia poate retrage / transfera fonduri: {a.permissions}</span>
              ) : (
                a.permissionWarning && <span className={a.trading.enabled ? 'text-muted' : 'text-warn'}>permisiuni în plus față de citire: {a.permissions}</span>
              )}
              {a.trading.enabled && <span className="text-bull">tranzacționare pornită</span>}
              <span className="ml-auto flex gap-2">
                <button className="btn" onClick={() => test.mutate(a.id)} disabled={test.isPending}>
                  Testează
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (window.confirm(`Ștergi contul „${a.label}”? Cheile lui se șterg din Sentiq.`)) remove.mutate(a.id);
                  }}
                >
                  Șterge
                </button>
              </span>
            </div>
          );
        })}
        {(remove.error || test.error) && <div className="text-bear">{errorMessage(remove.error ?? test.error)}</div>}
        <PriceSourceChoice />
      </div>
      {wizard && <AccountWizard onClose={closeWizard} />}
    </Panel>
  );
}

function GeneralSection({ s }: { s: SettingsView }) {
  const save = useSaveSettings();
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.timezone];
  return (
    <Panel id="general" title="General" icon={SlidersHorizontal}>
      <div className="flex flex-wrap items-end gap-4 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-faint">Fus orar (definește „ziua” pentru sentiment)</span>
          <select value={s.timezone} onChange={(e) => save.mutate({ timezone: e.target.value })} className="w-64">
            {(zones.includes(s.timezone) ? zones : [s.timezone, ...zones]).map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
      </div>
      {save.error && <div className="mt-2 text-[13px] text-bear">{errorMessage(save.error)}</div>}
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const admin = useIsAdmin();
  const accounts = useAccounts();
  // Links such as /settings#market land on their section once the lists above it are drawn.
  useHashScroll(Boolean(settings.data) && !accounts.isPending);
  return (
    <div className="flex w-full flex-col gap-3.5">
      <h1 className="page-title">Setări</h1>
      {/* FD-ADMINSET: everyone's settings (sources, the common sentiment, market data, retention, mail) are on the admin's own tab. */}
      {admin && <SettingsTabs />}
      {!settings.data && !settings.isError ? (
        <Loading />
      ) : !settings.data ? (
        <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
          <AccountsSection />
          <StockDataSection s={settings.data} />
          <AiSection s={settings.data} />
          <StockNewsSection s={settings.data} />
          <GeneralSection s={settings.data} />
        </>
      )}
    </div>
  );
}
