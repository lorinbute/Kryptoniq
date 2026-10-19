// Setări → Ale mele → Date pentru acțiuni (FD-TDKEYS, FD-TDPLAN): each user's own Twelve Data key, its plan as read
// from Twelve Data, today's use against it, and a read on request (after an upgrade).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartLine } from 'lucide-react';
import type { TdBudget } from '../../shared/api-types.ts';
import type { SettingsView } from '../../shared/settings.ts';
import { api, errorMessage } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { useStocksInfo } from '../hooks.ts';
import { Panel } from './ui.tsx';

const PLAN_NAMES: Record<string, string> = { basic: 'Basic (gratuit)', grow: 'Grow', pro: 'Pro', ultra: 'Ultra', enterprise: 'Enterprise' };

export function StockDataSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const info = useStocksInfo();
  const [key, setKey] = useState('');
  const setTdKey = useMutation({
    mutationFn: (k: string | null) => api.put<SettingsView>('/api/settings/twelvedata-key', { key: k }),
    onSuccess: (data) => {
      setKey('');
      qc.setQueryData(['settings'], data);
      // Timeframes and sources of the stock charts change with the key, and so do the stock signals on Today.
      void qc.invalidateQueries({ queryKey: ['stocks'] });
      void qc.invalidateQueries({ queryKey: ['candles', 'stock'] });
      void qc.invalidateQueries({ queryKey: ['scanner'] });
    },
  });
  const b = info.data?.budget;
  return (
    <Panel id="stock-data" title="Date pentru acțiuni" icon={ChartLine}>
      <div className="flex max-w-[75ch] flex-col gap-2 text-[13px]">
        <p className="text-muted">
          Graficele zilnice și săptămânale ale acțiunilor vin gratuit de la Nasdaq. Cu cheia ta{' '}
          <a href="https://twelvedata.com/register" target="_blank" rel="noreferrer">
            Twelve Data
          </a>{' '}
          (gratuită; după înregistrare, în pagina API Keys) ai și 1m – 4h, iar semnalele acțiunilor de pe Azi folosesc timeframe-ul ales. Planul gratuit are 8 cereri pe minut și
          800 pe zi; un plan plătit (de exemplu Grow, fără limită zilnică) e recunoscut singur, din cheie. Cheia și creditele ei sunt doar ale tale; aplicația ține minte
          lumânările, ca să nu consume cereri degeaba. Indicii nu au nevoie de cheie.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) setTdKey.mutate(key.trim());
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-faint">Cheia Twelve Data {s.twelveDataKeySet && <>(salvată: {s.twelveDataKeyHint})</>}</span>
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cheia de 32 de caractere" className="w-72 max-w-full" />
          </label>
          <button className="btn" disabled={!key.trim() || setTdKey.isPending}>
            {setTdKey.isPending ? 'Se verifică…' : s.twelveDataKeySet ? 'Verifică și înlocuiește' : 'Verifică și salvează'}
          </button>
          {s.twelveDataKeySet && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (window.confirm('Ștergi cheia Twelve Data? Acțiunile rămân pe 1d și 1w până pui alta.')) setTdKey.mutate(null);
              }}
              disabled={setTdKey.isPending}
            >
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
