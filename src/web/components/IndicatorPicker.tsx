// The "Indicatori" window (FD-INDICATORS §1): search, categories (Premium first), the list, alphabetical in every tab
// (FD-PICKERSORT); a click adds an indicator to the charts and the window stays open for another.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Search, Star } from 'lucide-react';
import { STUDY_MAX, type FavoriteId, type PremiumKey, type StudyId } from '../../shared/studies.ts';
import { STUDY_CATEGORIES, STUDY_META, type StudyCategory } from '../indicators/catalog-meta.ts';
import { premiumNote, type PremiumState } from '../chart/premium.ts';
import { compareIndicatorNames } from '../indicators/order.ts';
import { Modal } from './Modal.tsx';

export type { PremiumKey } from '../../shared/studies.ts';

export interface PremiumItem {
  key: PremiumKey;
  name: string;
  shortName: string;
  overlay: boolean;
  description: string;
}

type Category = 'favorites' | 'premium' | 'all' | StudyCategory;

type Row = { kind: 'premium'; item: PremiumItem } | { kind: 'study'; id: StudyId; name: string; shortName: string; overlay: boolean; description: string };

/** Lower case, without diacritics: "Î" and "i" match. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const rowName = (r: Row): string => (r.kind === 'premium' ? r.item.name : r.name);

export function PremiumBadge() {
  return <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-accent">PREMIUM</span>;
}

export function IndicatorPicker({
  premium,
  premiumOn,
  studyCount,
  favorites,
  favoriteError,
  onAddPremium,
  onAddStudy,
  onToggleFavorite,
  onClose,
}: {
  premium: readonly PremiumItem[];
  /** Slingshot / LMA off the chart, on it, or on it but hidden with the legend's eye. */
  premiumOn: Readonly<Record<PremiumKey, PremiumState>>;
  /** Standard indicators on the charts now (the limit is STUDY_MAX). */
  studyCount: number;
  onAddPremium: (key: PremiumKey) => void;
  /** The starred ones, in the order they were starred (FD-STUDYUX §1). */
  favorites: readonly FavoriteId[];
  /** Why the last change of the favourites was not saved (the list is back to the server's). */
  favoriteError?: string | null;
  onAddStudy: (id: StudyId) => void;
  onToggleFavorite: (id: FavoriteId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  // The favourites first when there are any: the quick way to the ones in use.
  const [category, setCategory] = useState<Category>(() => (favorites.length ? 'favorites' : 'premium'));
  /** The row that shows "Adăugat" for a moment. */
  const [added, setAdded] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const full = studyCount >= STUDY_MAX;

  const rows = useMemo((): Row[] => {
    const pick = (): Row[] => {
      const all: Row[] = [
        ...premium.map((item): Row => ({ kind: 'premium', item })),
        ...STUDY_META.map((m): Row => ({ kind: 'study', id: m.id, name: m.name, shortName: m.shortName, overlay: m.overlay, description: m.description })),
      ];
      const q = fold(query.trim());
      if (q) {
        // A search looks in every category.
        return all.filter((r) => {
          const name = r.kind === 'premium' ? r.item.name : r.name;
          const short = r.kind === 'premium' ? r.item.shortName : r.shortName;
          const id = r.kind === 'premium' ? r.item.key : r.id;
          return fold(name).includes(q) || fold(short).includes(q) || fold(id).includes(q);
        });
      }
      if (category === 'all') return all;
      if (category === 'favorites') {
        const byId = new Map(all.map((r) => [r.kind === 'premium' ? r.item.key : r.id, r]));
        return favorites.flatMap((id) => byId.get(id) ?? []);
      }
      if (category === 'premium') return all.filter((r) => r.kind === 'premium');
      return all.filter((r) => r.kind === 'study' && STUDY_META.find((m) => m.id === r.id)?.category === category);
    };
    // FD-PICKERSORT: whatever the tab or the search, alphabetical by the name shown (each branch gives a new array).
    return pick().sort((a, b) => compareIndicatorNames(rowName(a), rowName(b)));
  }, [premium, query, category, favorites]);
  const starred = useMemo(() => new Set<string>(favorites), [favorites]);

  const flash = (key: string) => {
    setAdded(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(null), 1500);
  };

  const categories: { id: Category; label: string }[] = [
    { id: 'favorites', label: 'Favorite' },
    { id: 'premium', label: 'Premium' },
    { id: 'all', label: 'Toți' },
    ...STUDY_CATEGORIES.map((c) => ({ id: c.id as Category, label: c.label })),
  ];
  const searching = query.trim() !== '';

  return (
    <Modal title="Indicatori" onClose={onClose} width={860}>
      <div className="flex flex-col gap-4">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută (ex. RSI, Bollinger, MACD)"
            aria-label="Caută un indicator"
            className="w-full pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {full && <p className="text-[12.5px] text-warn">Ai deja {STUDY_MAX} indicatori pe grafic: scoate unul ca să adaugi altul.</p>}
        {favoriteError && <p className="text-[12.5px] text-bear">Favoritele nu s-au putut salva ({favoriteError}).</p>}
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Categories: a column on a wide screen, a scrolling row on a phone. */}
          <div role="group" aria-label="Categorii" className={clsx('-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 sm:mx-0 sm:w-44 sm:flex-col sm:overflow-visible sm:px-0', searching && 'opacity-60')}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={!searching && category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  setQuery('');
                }}
                className={clsx(
                  'inline-flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] whitespace-nowrap transition-colors',
                  !searching && category === c.id ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
                )}
              >
                {c.label}
                {c.id === 'favorites' && favorites.length > 0 && <span className="num text-[12px] font-normal text-faint">{favorites.length}</span>}
                {c.id === 'premium' && <span className="hidden size-1.5 rounded-full bg-accent sm:inline-block" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-faint">
                {!searching && category === 'favorites' ? 'Niciun favorit încă. Apasă steaua de lângă un indicator ca să-l adaugi aici.' : 'Niciun indicator nu se potrivește.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5" aria-label="Indicatori">
                {rows.map((r) => {
                  const key = r.kind === 'premium' ? r.item.key : r.id;
                  const name = r.kind === 'premium' ? r.item.name : r.name;
                  const short = r.kind === 'premium' ? r.item.shortName : r.shortName;
                  const overlay = r.kind === 'premium' ? r.item.overlay : r.overlay;
                  const description = r.kind === 'premium' ? r.item.description : r.description;
                  const note = r.kind === 'premium' ? premiumNote(premiumOn[r.item.key]) : null;
                  const on = note !== null;
                  const disabled = on || (r.kind === 'study' && full);
                  const fav = starred.has(key);
                  return (
                    <li key={key} className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={disabled}
                        title={r.kind === 'study' && full ? `Ai deja ${STUDY_MAX} indicatori pe grafic: scoate unul ca să adaugi altul.` : description}
                        onClick={() => {
                          if (r.kind === 'premium') onAddPremium(r.item.key);
                          else onAddStudy(r.id);
                          flash(key);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={clsx('text-[13.5px] font-medium', disabled && !on ? 'text-faint' : 'text-text')}>{name}</span>
                            {r.kind === 'premium' && <PremiumBadge />}
                          </span>
                          <span className="block truncate text-[12px] text-faint">
                            {short} · {overlay ? 'pe grafic' : 'panou separat'}
                            <span className="hidden sm:inline"> · {description}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px]">
                          {added === key ? <span className="text-bull">Adăugat</span> : note ? <span className="text-faint">{note}</span> : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={fav ? `Scoate ${name} din favorite` : `Adaugă ${name} la favorite`}
                        title={fav ? 'Scoate din favorite' : 'Adaugă la favorite'}
                        onClick={() => onToggleFavorite(key)}
                        className={clsx('shrink-0 rounded-lg p-2 transition-colors hover:bg-hover', fav ? 'text-accent' : 'text-faint hover:text-accent')}
                      >
                        <Star size={16} className={clsx(fav && 'fill-current')} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
