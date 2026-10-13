// ⌘K / Ctrl+K search (FD-REDESIGN): jump to a page, to a coin's chart (favourites or any pair on the
// exchange), to a stock's chart (FD-SENTIQ §4.3) or search the news. A modal dialog with a combobox + listbox, fully usable from the keyboard.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CornerDownLeft, FileText, Newspaper, Search, type LucideIcon } from 'lucide-react';
import type { StockSearchHit, SymbolInfo } from '../../shared/api-types.ts';
import { chartPathOf, stockChartPath } from '../chart/paths.ts';
import { api, qs } from '../api.ts';
import { useSettings, useWatchlist } from '../hooks.ts';
import { CoinLogo } from './icons.tsx';

export interface PaletteLink {
  to: string;
  label: string;
  icon?: LucideIcon;
}

interface Item {
  id: string;
  group: 'Pagini' | 'Favorite' | 'Perechi' | 'Acțiuni' | 'Știri';
  label: string;
  hint?: string;
  to: string;
  /** Pages and searches show an icon, coins their logo, stocks a badge. */
  icon?: LucideIcon;
  coin?: string;
  stock?: boolean;
}

/** Lower case without diacritics, so "stiri" finds "Știri". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PaletteLink[] }) {
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const exchange = useSettings().data?.market.exchange;
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const q = text.trim();
  const debounced = useDebounced(q, 200);
  const symbols = useQuery({
    queryKey: ['symbols', debounced, exchange],
    queryFn: () => api.get<SymbolInfo[]>(`/api/market/symbols${qs({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    staleTime: 5 * 60_000,
  });
  const stocks = useQuery({
    queryKey: ['stocks', 'search', debounced],
    queryFn: () => api.get<StockSearchHit[]>(`/api/stocks/search${qs({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const items = useMemo<Item[]>(() => {
    const f = fold(q);
    const out: Item[] = [];
    for (const p of pages) if (!f || fold(p.label).includes(f)) out.push({ id: `p:${p.to}`, group: 'Pagini', label: p.label, to: p.to, icon: p.icon ?? FileText });
    const favs = new Set<string>();
    for (const w of watchlist.data ?? []) {
      const stock = w.kind === 'stock';
      const sym = stock ? w.coin : `${w.coin}/${w.quote}`;
      favs.add(stock ? `stock:${w.coin}` : sym);
      if (!f || fold(sym).includes(f) || w.aliases.some((a) => fold(a).includes(f)) || (w.name !== null && fold(w.name).includes(f)))
        out.push({ id: `w:${sym}`, group: 'Favorite', label: sym, hint: stock ? (w.name ?? 'acțiune') : 'grafic', to: chartPathOf(w), coin: w.coin, stock });
    }
    if (q.length >= 2)
      for (const s of (symbols.data ?? []).filter((s) => !favs.has(s.symbol)).slice(0, 6))
        out.push({ id: `s:${s.symbol}`, group: 'Perechi', label: s.symbol, hint: s.type === 'spot' ? 'spot' : s.type, to: `/charts/${s.base}/${s.quote}`, coin: s.base });
    if (q.length >= 2)
      for (const s of (stocks.data ?? []).filter((s) => !favs.has(`stock:${s.symbol}`)).slice(0, 6))
        out.push({ id: `a:${s.symbol}`, group: 'Acțiuni', label: s.symbol, hint: [s.name, s.exchange].filter(Boolean).join(' · '), to: stockChartPath(s.symbol), coin: s.symbol, stock: true });
    if (q) out.push({ id: 'n:search', group: 'Știri', label: `Caută în știri „${q}”`, to: `/news${qs({ q })}`, icon: Newspaper });
    return out;
  }, [q, pages, watchlist.data, symbols.data, stocks.data]);

  // A new query starts at the first result; the list never points past its end.
  useEffect(() => setActive(0), [q]);
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    setText('');
    setActive(0);
    const focus = () => input.current?.focus();
    requestAnimationFrame(focus);
    // Opened from a chart in full screen (FD-CHARTUX §4): the page comes back a moment later and the first focus can
    // be lost; focus the field again then.
    document.addEventListener('fullscreenchange', focus);
    document.addEventListener('webkitfullscreenchange', focus);
    // Esc closes the search even when the focus is elsewhere (the field handles its own Esc).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement !== input.current) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', focus);
      document.removeEventListener('webkitfullscreenchange', focus);
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    navigate(it.to);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (items.length ? (Math.min(a, items.length - 1) + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (items.length ? (Math.min(a, items.length - 1) - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // The input is the only focusable element: Tab must not leave the modal dialog.
      e.preventDefault();
    }
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Caută în Sentiq" className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-modal">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-faint" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
            aria-autocomplete="list"
            aria-label="Caută o pagină, o monedă, o acțiune sau în știri"
            placeholder="Caută o pagină, o monedă, o acțiune sau în știri"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            className="h-14 w-full min-w-0 rounded-none border-0 bg-transparent px-0 text-[15px] focus:border-0"
          />
          <kbd className="num shrink-0 rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] text-faint">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Rezultate" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[13.5px] text-faint">Niciun rezultat</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="px-3 pt-2.5 pb-1 text-[11.5px] font-medium text-faint">{it.group}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(it)}
                  className={clsx('flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px]', i === current ? 'bg-hover text-text' : 'text-muted')}
                >
                  {it.coin ? (
                    <CoinLogo coin={it.coin} size={18} badge={it.stock} square={it.stock} />
                  ) : it.icon ? (
                    <it.icon size={16} className={clsx('shrink-0', i === current ? 'text-accent' : 'text-faint')} aria-hidden />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[12px] text-faint">{it.hint}</span>}
                  {i === current && <CornerDownLeft size={14} className="text-faint" aria-hidden />}
                </div>
              </li>
            );
          })}
          {q.length >= 2 && symbols.isFetching && <li className="px-3 py-2 text-[12.5px] text-faint">Se caută perechi…</li>}
        </ul>
      </div>
    </div>
  );
}
