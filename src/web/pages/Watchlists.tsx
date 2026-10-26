// Liste de urmărire (FD-WATCHLISTS): the user's named lists of symbols. On the left (a field on a phone) the lists; on
// the right the open one: adding, the boxes to tick (copy / move / delete what is ticked), the order by dragging, each
// symbol's price and aliases, and its "Date financiare" popup. All the lists together are what the rest of Sentiq follows.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Check, GripVertical, Info, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { WatchItem, WatchListView, WatchView } from '../../shared/api-types.ts';
import { plainSymbol } from '../../shared/indices.ts';
import { api, errorMessage } from '../api.ts';
import { fmtPct, fmtPrice } from '../format.ts';
import { useApplyWatchView, useReorderList, useWatchlists, WATCHLISTS_KEY, type ListReorder } from '../hooks.ts';
import { clickBox, EMPTY_SELECTION, keepPresent, selectionState, toggleAll, type Selection } from '../watch-select.ts';
import { guessAdd, guessCopy, guessDropList, guessRemove, guessRename, type AddBody } from '../watch-guess.ts';
import { AddSymbol, AliasInput } from '../components/AddSymbol.tsx';
import { CoinLogo } from '../components/icons.tsx';
import { FavoritesDnd, SortableFavorite } from '../components/SortableFavorites.tsx';
import { SymbolInfo } from '../components/SymbolInfo.tsx';
import { ErrorNote, Loading, Toast } from '../components/ui.tsx';
import { usePriceRows } from '../components/Watchlist.tsx';

const tone = (v: number | null) => (v === null ? 'text-muted' : v >= 0 ? 'text-bull' : 'text-bear');
const symbolsRo = (n: number) => (n === 1 ? '1 simbol' : `${n}${n % 100 >= 20 || (n > 0 && n % 100 === 0) ? ' de' : ''} simboluri`);
const listOf = (coins: readonly string[]) => coins.map(plainSymbol).join(', ');

/** The lists' order, saved as a list's symbols are (one after the other, the latest shown). */
function useReorderLists(): ListReorder {
  const qc = useQueryClient();
  const apply = useApplyWatchView();
  const m = useMutation({
    mutationKey: ['watchlists', 'lists-order'],
    scope: { id: 'watchlists-lists-order' },
    mutationFn: (ids: string[]) => api.put<WatchView>('/api/watchlists/order', { ids: ids.map(Number) }),
    onSuccess: (v) => {
      if (qc.isMutating({ mutationKey: ['watchlists', 'lists-order'] }) <= 1) apply(v, false);
    },
    onError: () => void qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
  return {
    save: (ids) => {
      const prev = qc.getQueryData<WatchView>(WATCHLISTS_KEY);
      if (prev) qc.setQueryData<WatchView>(WATCHLISTS_KEY, { ...prev, lists: ids.map((id) => prev.lists.find((l) => String(l.id) === id)).filter((l): l is WatchListView => l !== undefined) });
      m.mutate(ids);
    },
    isError: m.isError,
    error: m.error,
  };
}

/** A name field for a new list or a renamed one: Enter saves, Esc gives up. */
function NameField({ initial, label, onSave, onCancel, busy }: { initial: string; label: string; onSave: (name: string) => void; onCancel: () => void; busy: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
      }}
    >
      <input
        aria-label={label}
        placeholder="Numele listei"
        value={v}
        maxLength={40}
        autoFocus
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-8 min-w-0 flex-1 text-[13px]"
      />
      <button className="btn h-8 w-8 px-0" disabled={!v.trim() || busy} aria-label="Salvează numele">
        <Check size={14} aria-hidden />
      </button>
      <button type="button" className="btn h-8 w-8 px-0" onClick={onCancel} aria-label="Renunță">
        <X size={14} aria-hidden />
      </button>
    </form>
  );
}

interface ListActions {
  create: (name: string) => void;
  rename: (id: number, name: string) => void;
  remove: (list: WatchListView) => void;
  busy: boolean;
}

/**
 * The name of a new list (or of the open one, on a phone), in a small window under its button: over the page, so
 * nothing below moves (FD-WATCHLISTS §1). A click outside it, or Esc, gives up.
 */
function NamePopover({
  initial,
  label,
  busy,
  onSave,
  onCancel,
  align,
}: {
  initial: string;
  label: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
  /** Which edge of its box it keeps to: the left in the narrow column of lists (it opens over the list), else the right. */
  align: 'left' | 'right';
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const at = e.target as Element | null;
      // Its own button toggles it: that click is the button's.
      if (box.current?.contains(at) || at?.closest('[data-name-anchor]')) return;
      onCancel();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onCancel]);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      className={clsx('absolute top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-panel-2 p-2.5 shadow-pop', align === 'left' ? 'left-0' : 'right-0')}
    >
      <NameField initial={initial} label={label} busy={busy} onSave={onSave} onCancel={onCancel} />
    </div>
  );
}

/** The lists: a column on a wide screen, a field with buttons on a phone. */
function Lists({ lists, active, open, actions }: { lists: WatchListView[]; active: WatchListView | null; open: (id: number) => void; actions: ListActions }) {
  /** 'new': the window for a new list; a list's id: renaming it (in its row on a wide screen, in the window on a phone). */
  const [editing, setEditing] = useState<'new' | number | null>(null);
  const reorder = useReorderLists();
  const ids = lists.map((l) => String(l.id));
  const done = useCallback(() => setEditing(null), []);
  const toggle = (what: 'new' | number) => setEditing((e) => (e === what ? null : what));
  const create = (align: 'left' | 'right') =>
    editing === 'new' && <NamePopover align={align} initial="" label="Numele listei noi" busy={actions.busy} onCancel={done} onSave={(n) => (actions.create(n), done())} />;
  return (
    <>
      {/* A phone: the open list in a field, its actions beside it. */}
      <div className="panel relative flex flex-wrap items-center gap-2 p-3 lg:hidden">
        <select aria-label="Lista deschisă" value={active?.id ?? ''} onChange={(e) => open(Number(e.target.value))} className="h-9 min-w-0 flex-1 text-[13.5px] font-semibold">
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.coins.length})
            </option>
          ))}
        </select>
        <button className="btn h-9 w-9 px-0" data-name-anchor onClick={() => toggle('new')} aria-label="Listă nouă" title="Listă nouă" aria-expanded={editing === 'new'}>
          <Plus size={16} aria-hidden />
        </button>
        {active && (
          <>
            <button className="btn h-9 w-9 px-0" data-name-anchor onClick={() => toggle(active.id)} aria-label={`Redenumește ${active.name}`} title="Redenumește" aria-expanded={editing === active.id}>
              <Pencil size={14} aria-hidden />
            </button>
            <button className="btn btn-danger h-9 w-9 px-0" onClick={() => actions.remove(active)} aria-label={`Șterge ${active.name}`} title="Șterge lista">
              <Trash2 size={14} aria-hidden />
            </button>
          </>
        )}
        {create('right')}
        {active && editing === active.id && (
          <NamePopover align="right" initial={active.name} label="Numele nou al listei" busy={actions.busy} onCancel={done} onSave={(n) => (actions.rename(active.id, n), done())} />
        )}
      </div>
      {/* A wide screen: the column of lists, in their order (drag, or Alt + ↑ / ↓); "+" on top makes a new one. */}
      <aside className="panel hidden min-w-0 flex-col self-start lg:flex" aria-label="Listele mele">
        <header className="relative flex items-center gap-2 border-b border-line py-2 pr-2 pl-3.5">
          <h2 className="flex-1 text-[13px] font-semibold">
            Listele mele <span className="num font-normal text-faint">{lists.length}</span>
          </h2>
          <button className="btn h-8 w-8 px-0" data-name-anchor onClick={() => toggle('new')} aria-label="Listă nouă" title="Listă nouă" aria-expanded={editing === 'new'}>
            <Plus size={16} aria-hidden />
          </button>
          {create('left')}
        </header>
        <FavoritesDnd ids={ids} layout="rows" reorder={reorder} label={(id) => lists.find((l) => String(l.id) === id)?.name ?? id}>
          {(order) => (
            <ul className="flex flex-col gap-0.5 p-1.5">
              {lists.map((l) => (
                <SortableFavorite key={l.id} id={String(l.id)}>
                  {(srt) => (
                    <li
                      ref={srt.setNodeRef}
                      style={srt.style}
                      className={clsx('group flex min-h-9 items-center gap-1 rounded-md pr-1', l.id === active?.id && 'bg-hover ring-1 ring-line-strong', srt.isDragging && 'bg-panel-2 shadow-drag')}
                    >
                      <button
                        ref={srt.setActivatorNodeRef}
                        {...srt.attributes}
                        {...srt.listeners}
                        type="button"
                        className="cursor-grab px-1 py-2 text-faint transition-colors hover:text-accent active:cursor-grabbing"
                        aria-label={`Trage ca să muți lista ${l.name}`}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        title="Trage ca să muți"
                        onKeyDown={order.keyMove(String(l.id), 'y')}
                      >
                        <GripVertical size={14} aria-hidden />
                      </button>
                      {editing === l.id ? (
                        // Renamed in its own row, at its height: nothing below moves.
                        <div className="min-w-0 flex-1 py-0.5">
                          <NameField initial={l.name} label="Numele nou al listei" busy={actions.busy} onCancel={done} onSave={(n) => (actions.rename(l.id, n), done())} />
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-current={l.id === active?.id ? 'page' : undefined}
                            onClick={() => !order.justDragged() && open(l.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-[13.5px]"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                            <span className="num shrink-0 text-[12px] text-faint">{l.coins.length}</span>
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-accent pointer-coarse:opacity-100"
                            onClick={() => setEditing(l.id)}
                            aria-label={`Redenumește ${l.name}`}
                            title="Redenumește"
                          >
                            <Pencil size={13} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-bear pointer-coarse:opacity-100"
                            onClick={() => actions.remove(l)}
                            aria-label={`Șterge ${l.name}`}
                            title="Șterge lista"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        </>
                      )}
                    </li>
                  )}
                </SortableFavorite>
              ))}
            </ul>
          )}
        </FavoritesDnd>
      </aside>
    </>
  );
}

export default function WatchlistsPage() {
  const view = useWatchlists();
  const apply = useApplyWatchView();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const lists = useMemo(() => view.data?.lists ?? [], [view.data]);
  const wanted = Number(params.get('list'));
  const active = lists.find((l) => l.id === wanted) ?? lists[0] ?? null;
  const byCoin = useMemo(() => new Map((view.data?.items ?? []).map((w) => [w.coin, w])), [view.data]);
  const items = (active?.coins ?? []).map((c) => byCoin.get(c)).filter((w): w is WatchItem => w !== undefined);
  const order = items.map((w) => w.coin);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [message, setMessage] = useState<{ text: string; bad?: boolean; at: number } | null>(null);
  const say = (text: string, bad = false) => setMessage({ text, bad, at: Date.now() });
  const quiet = useCallback(() => setMessage(null), []);
  const [info, setInfo] = useState<WatchItem | null>(null);
  const reorder = useReorderList(active?.id ?? null);
  const rowOf = usePriceRows(items);
  const activeId = active?.id ?? null;
  // A selection is of the open list (FD-WATCHLISTS §2): another list starts with none.
  useEffect(() => setSel(EMPTY_SELECTION), [activeId]);
  // Symbols gone meanwhile (a delete, a move, another tab) leave the selection.
  const orderKey = order.join(',');
  useEffect(() => {
    setSel((s) => keepPresent(orderKey ? orderKey.split(',') : [], s));
  }, [orderKey]);

  /** Another list opened: the last action's message goes (one that opens a list sets its own after). */
  const open = (id: number) => {
    setMessage(null);
    setParams({ list: String(id) }, { replace: false });
  };
  type Answer = WatchView & { gone?: string[]; added?: unknown[]; note?: string | null };
  /**
   * A change (FD-WATCHLISTS): shown at once (`guess`), then sent; the changes go one after the other, and an answer is
   * put in place only when no later change waits (its guess is already on screen). An error says why and reads the
   * lists again.
   */
  interface Change {
    guess?: (v: WatchView) => WatchView;
    send: () => Promise<Answer>;
    done?: (v: Answer) => void;
  }
  const changeKey = ['watchlists', 'change'];
  const change = useMutation({
    mutationKey: changeKey,
    scope: { id: 'watchlists-change' },
    mutationFn: (c: Change) => c.send(),
    onSuccess: (v, c) => {
      const followed = (v.gone?.length ?? 0) > 0 || (v.added?.length ?? 0) > 0;
      if (qc.isMutating({ mutationKey: changeKey }) <= 1) apply(v, followed);
      else if (followed) for (const k of ['scanner', 'news', 'sources', 'calendar']) void qc.invalidateQueries({ queryKey: [k] });
      c.done?.(v);
    },
    onError: (err) => {
      say(errorMessage(err), true);
      void qc.invalidateQueries({ queryKey: WATCHLISTS_KEY });
    },
  });
  const act = (c: Change) => {
    if (c.guess) {
      void qc.cancelQueries({ queryKey: WATCHLISTS_KEY });
      const prev = qc.getQueryData<WatchView>(WATCHLISTS_KEY);
      if (prev) apply(c.guess(prev), false);
    }
    change.mutate(c);
  };
  const leavingNote = (leaving: string[]) =>
    leaving.length
      ? `\n\n${listOf(leaving)} nu ${leaving.length === 1 ? 'mai e' : 'mai sunt'} în nicio altă listă: ${leaving.length === 1 ? 'dispare' : 'dispar'} și din Azi, din bandă, din scanner, din filtrul de știri și din calendar.`
      : '';

  const actions: ListActions = {
    busy: change.isPending,
    // A new list needs its id from the server: no guess.
    create: (name) =>
      act({
        send: () => api.post<Answer & { id: number }>('/api/watchlists', { name }),
        done: (v) => {
          open((v as Answer & { id: number }).id);
          say(`Lista „${name}” e gata.`);
        },
      }),
    rename: (id, name) => act({ guess: (v) => guessRename(v, id, name), send: () => api.put<Answer>(`/api/watchlists/${id}`, { name }) }),
    remove: (list) => {
      const elsewhere = new Set(lists.filter((l) => l.id !== list.id).flatMap((l) => l.coins));
      if (!window.confirm(`Ștergi lista „${list.name}” (${symbolsRo(list.coins.length)})?${leavingNote(list.coins.filter((c) => !elsewhere.has(c)))}`)) return;
      if (list.id === active?.id) setParams({}, { replace: true });
      act({
        guess: (v) => guessDropList(v, list.id),
        send: () => api.del<Answer>(`/api/watchlists/${list.id}`),
        done: () => say(`Lista „${list.name}” a fost ștearsă.`),
      });
    },
  };

  const add = (body: object) => {
    if (!active) return;
    const listId = active.id;
    act({
      guess: (v) => guessAdd(v, listId, body as AddBody),
      send: () => api.post<Answer>(`/api/watchlists/${listId}/items`, body),
      done: (v) => {
        if (v.note) say(v.note);
      },
    });
  };
  const saveAliases = (coin: string, list: string[]) =>
    act({
      send: async () => {
        const union = await api.put<WatchItem[]>(`/api/watchlist/${encodeURIComponent(coin)}`, { aliases: list });
        return { ...(qc.getQueryData<WatchView>(WATCHLISTS_KEY) ?? { lists: [] }), items: union };
      },
    });

  const chosen = order.filter((c) => sel.selected.has(c));
  const others = lists.filter((l) => l.id !== active?.id);
  const bulk = (verb: 'copy' | 'move', to: number) => {
    if (!active || chosen.length === 0) return;
    const from = active.id;
    const coins = chosen;
    const target = lists.find((l) => l.id === to);
    if (verb === 'move') setSel(EMPTY_SELECTION);
    act({
      guess: (v) => guessCopy(v, from, to, coins, verb === 'move'),
      send: () => api.post<Answer & { done: number; already: number; missing: number }>(`/api/watchlists/${from}/items/${verb}`, { coins, to }),
      done: (answer) => {
        const v = answer as Answer & { done: number; already: number; missing: number };
        const head = verb === 'copy' ? `${v.done} ${v.done === 1 ? 'copiat' : 'copiate'} în ${target?.name ?? 'listă'}` : `${v.done} ${v.done === 1 ? 'mutat' : 'mutate'} în ${target?.name ?? 'listă'}`;
        const tail = [v.already ? `${v.already} ${v.already === 1 ? 'era' : 'erau'} deja acolo` : '', v.missing ? `${v.missing} nu mai ${v.missing === 1 ? 'era' : 'erau'} în listă` : '']
          .filter(Boolean)
          .join('; ');
        say(`${head}${tail ? `; ${tail}` : ''}.`);
      },
    });
  };
  const removeChosen = () => {
    if (!active || chosen.length === 0) return;
    const elsewhere = new Set(others.flatMap((l) => l.coins));
    if (!window.confirm(`Ștergi ${chosen.length === 1 ? plainSymbol(chosen[0] as string) : symbolsRo(chosen.length)} din ${active.name}?${leavingNote(chosen.filter((c) => !elsewhere.has(c)))}`)) return;
    const listId = active.id;
    const name = active.name;
    const coins = chosen;
    setSel(EMPTY_SELECTION);
    act({
      guess: (v) => guessRemove(v, listId, coins),
      send: () => api.post<Answer & { done: number }>(`/api/watchlists/${listId}/items/delete`, { coins }),
      done: (answer) => {
        const n = (answer as Answer & { done: number }).done;
        say(`${n === 1 ? '1 simbol șters' : `${n} simboluri șterse`} din ${name}.`);
      },
    });
  };

  const all = selectionState(order, sel);
  return (
    <div className="flex w-full flex-col gap-3.5">
      <h1 className="page-title">Liste de urmărire</h1>
      {!view.data ? (
        view.isError ? (
          <ErrorNote error={view.error} onRetry={() => view.refetch()} />
        ) : (
          <Loading />
        )
      ) : (
        // One column on a phone that never grows past the screen (a grid column grows to its widest content otherwise:
        // the table would widen the page instead of scrolling in its frame).
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Lists lists={lists} active={active} open={open} actions={actions} />
          {/* px-5: the table bleeds by as much (`table-bleed`, −1.25rem), so its rows reach the panel's edges, not past them. */}
          <section className="panel flex min-w-0 flex-col gap-3 px-5 py-4" aria-labelledby="open-list">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="open-list" className="text-[15px] font-semibold">
                {active?.name ?? 'Listă'}
              </h2>
              <span className="text-[12.5px] text-faint">{symbolsRo(items.length)}</span>
              <span className="text-[12px] text-faint">Toate listele împreună sunt simbolurile urmărite în Azi, în bandă, în scanner, în știri și în calendar (cel mult 50 diferite).</span>
            </header>
            <AddSymbol have={new Set(order)} onAdd={add} />
            {/* Always here, whatever is ticked (FD-WATCHLISTS §2): ticking only turns its buttons on, nothing moves. */}
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel-2 px-3 py-2 text-[13px]" role="toolbar" aria-label="Simbolurile selectate">
              <span className={clsx('min-w-[7.5rem]', chosen.length ? 'font-medium' : 'text-faint')}>
                {chosen.length === 0 ? 'Niciunul selectat' : chosen.length === 1 ? '1 selectat' : `${chosen.length} selectate`}
              </span>
              {(['copy', 'move'] as const).map((verb) => (
                <select
                  key={verb}
                  aria-label={verb === 'copy' ? 'Copiază în lista' : 'Mută în lista'}
                  title={others.length === 0 ? 'Fă întâi altă listă, ca să copiezi sau să muți în ea' : chosen.length === 0 ? 'Bifează întâi simbolurile' : undefined}
                  value=""
                  disabled={chosen.length === 0 || others.length === 0}
                  onChange={(e) => {
                    const to = Number(e.target.value);
                    if (to) bulk(verb, to);
                  }}
                  className="h-8 w-auto py-0 text-[13px]"
                >
                  <option value="">{verb === 'copy' ? 'Copiază în…' : 'Mută în…'}</option>
                  {others.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ))}
              <button className="btn btn-danger h-8" onClick={removeChosen} disabled={chosen.length === 0}>
                <Trash2 size={14} aria-hidden /> Șterge
              </button>
              <button className="btn h-8" onClick={() => setSel(EMPTY_SELECTION)} disabled={chosen.length === 0}>
                Anulează selecția
              </button>
            </div>
            {items.length === 0 ? (
              <p className="text-[13px] text-faint">Lista e goală. Adaugă simboluri cu căutarea de mai sus.</p>
            ) : (
              <FavoritesDnd ids={order} layout="rows" reorder={reorder} label={plainSymbol}>
                {(o) => (
                  // `relative`: the hidden header text (sr-only, absolute) is placed in this frame; without it, it would sit
                  // at the table's far end outside the scrolling frame and widen the page on a phone.
                  <div className="table-bleed relative overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="w-8">
                            {/* A block flex: the box on the row's middle (an inline one sits on the text's baseline). */}
                            <span className="flex items-center">
                              <input
                                type="checkbox"
                                aria-label="Selectează tot"
                                checked={all === 'all'}
                                ref={(el) => {
                                  if (el) el.indeterminate = all === 'some';
                                }}
                                onChange={() => setSel((s) => toggleAll(order, s))}
                              />
                            </span>
                          </th>
                          <th>Ordine</th>
                          <th>Simbol</th>
                          <th>Tip</th>
                          <th>Pereche / bursă</th>
                          <th className="text-right">Ultimul</th>
                          <th className="text-right">Var%</th>
                          <th>Aliasuri în știri (separate prin virgulă)</th>
                          <th>
                            <span className="sr-only">Date financiare</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((w, i) => {
                          const r = rowOf(w);
                          const shown = plainSymbol(w.coin);
                          return (
                            <SortableFavorite key={w.coin} id={w.coin}>
                              {(srt) => (
                                <tr ref={srt.setNodeRef} style={srt.style} className={clsx('[&>td]:align-middle', sel.selected.has(w.coin) && 'bg-hover-soft', srt.isDragging && 'bg-panel-2 shadow-drag')}>
                                  <td>
                                    <span className="flex items-center">
                                      <input
                                        type="checkbox"
                                        aria-label={`Selectează ${shown}`}
                                        checked={sel.selected.has(w.coin)}
                                        onChange={() => undefined}
                                        onClick={(e) => setSel((s) => clickBox(order, s, w.coin, e.shiftKey))}
                                      />
                                    </span>
                                  </td>
                                  <td className="w-28 whitespace-nowrap">
                                    <div className="flex items-center">
                                      <button
                                        ref={srt.setActivatorNodeRef}
                                        {...srt.attributes}
                                        {...srt.listeners}
                                        type="button"
                                        className="cursor-grab text-faint transition-colors hover:text-accent active:cursor-grabbing"
                                        aria-label={`Trage ca să muți ${shown}`}
                                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                                        title="Trage ca să muți"
                                        onKeyDown={o.keyMove(w.coin, 'y')}
                                      >
                                        <GripVertical size={15} aria-hidden />
                                      </button>
                                      <button className="ml-1.5 text-muted transition-colors hover:text-accent" aria-label={`Mută ${shown} mai sus`} onClick={() => o.move(w.coin, -1)} disabled={i === 0}>
                                        <ArrowUp size={14} aria-hidden />
                                      </button>
                                      <button className="ml-1 text-muted transition-colors hover:text-accent" aria-label={`Mută ${shown} mai jos`} onClick={() => o.move(w.coin, 1)} disabled={i === items.length - 1}>
                                        <ArrowDown size={14} aria-hidden />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="font-semibold">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <CoinLogo coin={w.coin} size={18} badge={w.kind === 'stock'} square={w.kind === 'stock'} />
                                      {shown}
                                      {w.name && <span className="max-w-[200px] truncate font-normal text-faint">{w.name}</span>}
                                    </div>
                                  </td>
                                  <td className="text-muted">{w.kind === 'stock' ? 'Acțiune' : w.kind === 'index' ? 'Indice' : 'Crypto'}</td>
                                  <td className="whitespace-nowrap text-muted">{w.kind === 'stock' ? (w.exchange ?? 'SUA') : w.kind === 'index' ? 'indice SUA' : `${w.coin}/${w.quote}`}</td>
                                  <td className="num text-right whitespace-nowrap" title={r.error ?? undefined}>
                                    {r.last !== null ? fmtPrice(r.last, r.precision) : r.error ? '—' : '…'}
                                  </td>
                                  <td className={clsx('num text-right whitespace-nowrap', tone(r.pct))}>{r.pct !== null ? fmtPct(r.pct) : '—'}</td>
                                  <td>
                                    <AliasInput initial={w.aliases} onSave={(list) => saveAliases(w.coin, list)} label={shown} />
                                  </td>
                                  <td>
                                    <div className="flex justify-end">
                                      <button className="btn h-8 px-2.5" onClick={() => setInfo(w)} aria-label={`Date financiare ${shown}`} title="Date financiare">
                                        <Info size={14} aria-hidden />
                                        <span className="hidden xl:inline">Date</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </SortableFavorite>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </FavoritesDnd>
            )}
          </section>
        </div>
      )}
      {info && <SymbolInfo item={info} onClose={() => setInfo(null)} />}
      <Toast message={message} onDone={quiet} />
    </div>
  );
}
