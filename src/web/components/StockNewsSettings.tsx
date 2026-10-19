// Setări → Ale mele → "Știrile despre acțiuni" (FD-INDEXNEWS §1): all stock news, or only the companies of the indices
// picked; the news pages and the user's own score follow it.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Newspaper } from 'lucide-react';
import type { SettingsView } from '../../shared/settings.ts';
import type { FilterIndex, FilterIndexId, StockNews } from '../../shared/stock-indices.ts';
import { api, errorMessage } from '../api.ts';
import { useSaveSettings } from '../hooks.ts';
import { Panel } from './ui.tsx';

interface IndicesInfo {
  asOf: number;
  indices: (FilterIndex & { count: number })[];
}

export function StockNewsSection({ s }: { s: SettingsView }) {
  const qc = useQueryClient();
  const save = useSaveSettings();
  const info = useQuery({ queryKey: ['stock-indices'], queryFn: () => api.get<IndicesInfo>('/api/stock-indices'), staleTime: 60 * 60_000 });
  const [draft, setDraft] = useState<StockNews>(s.stockNews);
  const savedKey = JSON.stringify(s.stockNews);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(s.stockNews), [savedKey]);
  const [done, setDone] = useState(false);
  const changed = JSON.stringify(draft) !== savedKey;
  const valid = draft.mode === 'all' || draft.indices.length > 0;
  const toggle = (id: FilterIndexId, on: boolean) => setDraft((d) => ({ ...d, indices: on ? [...d.indices, id] : d.indices.filter((x) => x !== id) }));

  return (
    <Panel id="stock-news" title="Știrile despre acțiuni" icon={Newspaper}>
      <div className="flex max-w-[75ch] flex-col gap-3 text-[13px]">
        <p className="text-muted">
          Ce știri despre acțiuni vezi (pagina Știri, Azi, Rezumatul zilei) și din care se calculează partea de acțiuni a scorului tău de sentiment.
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Știrile despre acțiuni">
          <label className="inline-flex items-center gap-2.5">
            <input type="radio" name="stock-news-mode" checked={draft.mode === 'all'} onChange={() => setDraft({ mode: 'all', indices: [] })} />
            Toate acțiunile
          </label>
          <label className="inline-flex items-center gap-2.5">
            <input type="radio" name="stock-news-mode" checked={draft.mode === 'indices'} onChange={() => setDraft((d) => ({ mode: 'indices', indices: d.indices }))} />
            Doar companiile din indicii aleși
          </label>
        </div>
        <div className="flex flex-col gap-1.5 pl-6" aria-label="Indicii">
          {(info.data?.indices ?? []).map((f) => (
            <label key={f.id} className={draft.mode === 'all' ? 'inline-flex items-center gap-2.5 opacity-55' : 'inline-flex items-center gap-2.5'}>
              <input type="checkbox" disabled={draft.mode === 'all'} checked={draft.indices.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
              <span className="text-text">{f.name}</span>
              <span className="text-faint">
                {f.etfs.join(', ')} · {f.count} companii
              </span>
            </label>
          ))}
          {info.isError && <span className="text-bear">Listele indicilor nu s-au putut citi ({errorMessage(info.error)}).</span>}
        </div>
        {draft.mode === 'indices' && draft.indices.length === 0 && <p className="text-warn">Alege cel puțin un indice.</p>}
        <p className="text-[12.5px] text-faint">
          Rămân oricum: știrile generale de bursă (fără o companie anume), acțiunile din favoritele tale, știrile crypto, macro și de geopolitică.
          {info.data && ` Listele de companii: ${new Date(info.data.asOf).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })}, actualizate săptămânal.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!changed || !valid || save.isPending}
            onClick={() =>
              save.mutate(
                { stockNews: draft },
                {
                  onSuccess: () => {
                    setDone(true);
                    void qc.invalidateQueries({ queryKey: ['news'] });
                  },
                },
              )
            }
          >
            Salvează
          </button>
          {done && !changed && <span className="text-bull">Salvat. Scorul tău se recalculează în câteva minute.</span>}
          {save.error && <span className="text-bear">{errorMessage(save.error)}</span>}
        </div>
      </div>
    </Panel>
  );
}
