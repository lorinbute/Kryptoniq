// The symbol list on the right of the chart (FD-CHARTTV §3), as TradingView's watchlist: one of the user's watch lists
// (chosen on top, FD-WATCHLISTS §4) with each symbol's last price, change and change %, the open one framed, reordered
// by dragging (or Alt + ↑ / ↓), and the search on top. On a phone it is a panel sliding in from the right (FD-WATCHDRAWER).
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import type { StockSearchHit, SymbolInfo, WatchItem } from '../../shared/api-types.ts';
import { plainSymbol, searchIndices } from '../../shared/indices.ts';
import { api, qs } from '../api.ts';
import { useScrollLock } from '../scroll-lock.ts';
import { useVisibleArea } from '../visible-area.ts';
import { chartPathOf, indexChartPath, stockChartPath } from '../chart/paths.ts';
import { WATCHLIST_DEFAULT } from '../chart/watchlist-prefs.ts';
import { fmtPct, fmtPrice } from '../format.ts';
import { useReorderList, useSaveSettings, useSettings, useWatchlists } from '../hooks.ts';
import { sparkChange } from '../spark.ts';
import { CoinLogo } from './icons.tsx';
import { useSparks, useStockQuotes } from './MarketStrip.tsx';
import { enterIndex, stepActive } from './search-nav.ts';
import { FavoritesDnd, SortableFavorite } from './SortableFavorites.tsx';

/** Narrower than this, "Var" goes; narrower still, "Ultimul"; a coin's quote ("/USDT") only where there is room. */
const SHOW_CHANGE = 280;
const SHOW_LAST = 220;
const SHOW_QUOTE = 340;

export interface Row {
  last: number | null;
  change: number | null;
  pct: number | null;
  precision: number;
  /** Why the price could not be read. */
  error: string | null;
}

/** The chart a favourite opens, as the chart page names it (FD-CHARTUX: "BTC/USDT", "stock:AAPL", "index:SPX"). */
const chartKeyOf = (w: WatchItem) => (w.kind === 'crypto' ? `${w.coin}/${w.quote}` : `${w.kind}:${plainSymbol(w.coin)}`);

const signed = (v: number, precision: number) => `${v > 0 ? '+' : ''}${fmtPrice(v, precision)}`;
const tone = (v: number | null) => (v === null ? 'text-muted' : v >= 0 ? 'text-bull' : 'text-bear');

function SymbolSearch({ onPick }: { onPick: (path: string) => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  /** The result chosen with ↓ / ↑ (FD-CHARTAUDIT §4); −1 = none (Enter opens the first). */
  const [active, setActive] = useState(-1);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;
  const results = useQuery({
    queryKey: ['symbols', term],
    queryFn: () => api.get<SymbolInfo[]>(`/api/market/symbols${qs({ q: term })}`),
    enabled: term.length >= 1,
    staleTime: 5 * 60_000,
  });
  // Stocks from two letters on (FD-SENTIQ §4.3): one Nasdaq / Twelve Data search per word typed.
  const stocks = useQuery({
    queryKey: ['stocks', 'search', term],
    queryFn: () => api.get<StockSearchHit[]>(`/api/stocks/search${qs({ q: term })}`),
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const pick = (path: string) => {
    onPick(path);
    setQ('');
    setActive(-1);
  };
  const pairs = results.data ?? [];
  const shares = stocks.data ?? [];
  // FD-INDICES: the seven indices are known here, no request needed.
  const indices = term.length >= 2 ? searchIndices(term) : [];
  // Group titles only when more than one kind was found.
  const titled = [pairs, shares, indices].filter((l) => l.length > 0).length > 1;
  const open = term !== '' && !!(results.data || stocks.data || indices.length > 0);
  // The results in the order shown, for the keyboard.
  const paths = [...pairs.map((r) => `/charts/${r.base}/${r.quote}`), ...shares.map((r) => stockChartPath(r.symbol)), ...indices.map((i) => indexChartPath(i.id))];
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      const next = stepActive(active, paths.length, e.key);
      setActive(next);
      if (next >= 0) document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const i = open ? enterIndex(active, paths.length) : -1;
      if (i < 0) return;
      e.preventDefault();
      pick(paths[i] as string);
    } else if (e.key === 'Escape' && q) {
      // Only the search empties: the phone's panel and the page's full screen skip an Esc already used.
      e.preventDefault();
      setQ('');
      setActive(-1);
    }
  };
  const row = (i: number) => clsx('flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] transition-colors hover:bg-hover', i === active && 'bg-hover');
  const opt = (i: number) => ({ id: optionId(i), role: 'option' as const, 'aria-selected': i === active });
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
      <input
        role="combobox"
        aria-label="Caută o pereche, o acțiune sau un indice"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 && active < paths.length ? optionId(active) : undefined}
        placeholder="Pereche, acțiune sau indice"
        value={q}
        onChange={(e) => {
          setQ(e.target.value.toUpperCase());
          setActive(-1);
        }}
        onKeyDown={onKey}
        className="w-full pl-9 text-[13px]"
      />
      {open && (
        // As wide as the list, or wider over the chart when the list is narrow.
        <ul id={listId} className="absolute right-0 z-30 mt-1.5 max-h-80 w-full min-w-[260px] overflow-auto overscroll-contain rounded-xl border border-line-strong bg-panel-2 py-1.5 shadow-pop" role="listbox" aria-label="Rezultate">
          {pairs.length === 0 && shares.length === 0 && indices.length === 0 && (
            <li role="presentation" className="px-3.5 py-2 text-[13px] text-faint">
              {stocks.isFetching || results.isFetching ? 'Se caută…' : 'Nicio pereche, acțiune sau indice'}
            </li>
          )}
          {titled && pairs.length > 0 && (
            <li role="presentation" className="px-3.5 pt-1 pb-0.5 text-[11.5px] text-faint">
              Crypto
            </li>
          )}
          {pairs.map((r, i) => (
            <li key={r.symbol} role="presentation">
              <button type="button" {...opt(i)} className={row(i)} onClick={() => pick(`/charts/${r.base}/${r.quote}`)}>
                <CoinLogo coin={r.base} size={16} />
                {r.symbol}
              </button>
            </li>
          ))}
          {titled && shares.length > 0 && (
            <li role="presentation" className="px-3.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">
              Acțiuni
            </li>
          )}
          {shares.map((r, i) => (
            <li key={`stock:${r.symbol}`} role="presentation">
              <button type="button" {...opt(pairs.length + i)} className={row(pairs.length + i)} onClick={() => pick(stockChartPath(r.symbol))}>
                <CoinLogo coin={r.symbol} size={16} badge square />
                <span className="font-medium">{r.symbol}</span>
                <span className="min-w-0 truncate text-[12.5px] text-faint">
                  {r.name}
                  {r.exchange ? ` · ${r.exchange}` : ''}
                </span>
              </button>
            </li>
          ))}
          {titled && indices.length > 0 && (
            <li role="presentation" className="px-3.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">
              Indici
            </li>
          )}
          {indices.map((x, i) => (
            <li key={x.id} role="presentation">
              <button type="button" {...opt(pairs.length + shares.length + i)} className={row(pairs.length + shares.length + i)} onClick={() => pick(indexChartPath(x.id))}>
                <CoinLogo coin={x.id} size={16} />
                <span className="font-medium">{x.symbol}</span>
                <span className="min-w-0 truncate text-[12.5px] text-faint">{x.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** FD-CHARTPOLISH §1: a drag to the right this far closes the phone's panel; a shorter one lets it slide back. */
const SWIPE_CLOSE_PX = 80;

/**
 * FD-WATCHDRAWER: the list on a phone, a panel sliding in from the right over the page (shaded behind it). Closed by
 * the shade, a drag to the right, Esc or a pick; while open the page stays still and the focus is in the panel. Kept in
 * the page's frame, so it shows in the system's full screen too.
 */
export function ListDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // The drag to the right (FD-CHARTPOLISH §1): where it began, and how far the panel follows the finger now.
  const swipe = useRef<{ id: number; x: number; y: number; on: boolean } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  useScrollLock(open);
  // FD-MODALFIT: above the on-screen keyboard (the search) while it is up.
  const area = useVisibleArea();
  useEffect(() => {
    if (!open) setDragX(null);
  }, [open]);
  const onSwipeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
  };
  const onSwipeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.on) {
      // Mostly sideways and to the right: the panel follows; anything else stays the list's (a scroll, a reorder).
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (dx <= 10 || dx < 2 * Math.abs(dy)) return;
      s.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragX(Math.max(0, dx));
  };
  const onSwipeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    if (!s.on) return;
    const far = e.clientX - s.x > SWIPE_CLOSE_PX;
    setDragX(null);
    if (far) onClose();
  };
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    // The panel itself, not the search: a phone's keyboard does not pop up on its own. Without scrolling: focusing the
    // panel mid-slide would scroll its layer to it, and the panel would jump instead of sliding in.
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      // A modal panel: Tab goes round inside it, never to the shaded page behind.
      if (e.key === 'Tab' && panel.current) {
        const all = [...panel.current.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled'));
        const first = all[0];
        const last = all.at(-1);
        const at = document.activeElement;
        if (!first || !last) return;
        if (e.shiftKey && (at === first || at === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !panel.current.contains(at))) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      // An Esc already used by something above (the ⌘K search) does not close it too.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);
  return (
    // `overflow-clip`, not `hidden`: a clipped layer cannot be scrolled at all, not even by a focus, so the panel always
    // slides; and the closed one never widens the page. (Tailwind 4's browsers, Safari 16.4+, all know `clip`.)
    <div className={clsx('fixed inset-0 z-[46] overflow-clip', !open && 'pointer-events-none')} style={area}>
      <div className={clsx('absolute inset-0 bg-scrim transition-opacity duration-200 motion-reduce:transition-none', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Lista de simboluri"
        tabIndex={-1}
        inert={!open}
        onPointerDown={onSwipeDown}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
        // While dragged, the panel follows the finger without easing; let go, it slides (away or back).
        style={dragX !== null ? { transform: `translateX(${dragX}px)`, transition: 'none' } : undefined}
        className={clsx(
          // `touch-pan-y`: the list's own up / down scroll stays the browser's; sideways comes here as pointer events.
          'panel absolute top-0 right-0 bottom-0 flex w-[min(340px,88vw)] touch-pan-y flex-col rounded-none border-y-0 border-r-0 shadow-pop outline-none transition-transform duration-200 motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * `inDrawer`: in the phone's panel the page behind is locked, so the rows never hand their scroll on; in the side panel
 * they do at their end (FD-CHARTPOLISH §1), as browsers do: a gesture begun in the list stays in it. `contained`: never
 * handed on either (FD-IPADFS: in full screen there is no page to scroll).
 */
/** Each symbol's last price and change, from the same queries as the market strip (no request more). */
export function usePriceRows(items: WatchItem[]): (w: WatchItem) => Row {
  const coins = items.filter((w) => w.kind === 'crypto');
  const stocks = items.filter((w) => w.kind !== 'crypto');
  const sparks = useSparks(coins.map((w) => `${w.coin}/${w.quote}`));
  const quotes = useStockQuotes(stocks.map((w) => w.coin));
  return (w: WatchItem): Row => {
    if (w.kind === 'crypto') {
      const q = sparks[coins.indexOf(w)];
      const closes = q?.data?.closes ?? [];
      const last = closes.at(-1) ?? null;
      // 24 h from the hourly closes, as in the market strip.
      const ref = closes.length >= 25 ? (closes.at(-25) as number) : null;
      return {
        last,
        change: last !== null && ref !== null ? last - ref : null,
        pct: closes.length >= 25 ? sparkChange(closes.slice(-25)) : null,
        precision: q?.data?.precision ?? 2,
        error: q?.isError && !q.data ? 'Prețul nu s-a putut încărca' : null,
      };
    }
    const q = quotes.data?.get(w.coin);
    return { last: q?.last ?? null, change: q?.change ?? null, pct: q?.changePct ?? null, precision: q?.last != null && q.last < 1 ? 4 : 2, error: q?.error ? `Prețul nu s-a putut încărca: ${q.error}` : null };
  };
}

export function Watchlist({ current, onPick, inDrawer = false, contained = false }: { current: string; onPick: (path: string) => void; inDrawer?: boolean; contained?: boolean }) {
  const view = useWatchlists();
  const settings = useSettings();
  const save = useSaveSettings();
  const lists = view.data?.lists ?? [];
  // FD-WATCHLISTS §4: the list chosen here (kept for the user); none chosen, or one deleted since: the first.
  const list = lists.find((l) => l.id === settings.data?.charts?.listId) ?? lists[0] ?? null;
  const byCoin = new Map((view.data?.items ?? []).map((w) => [w.coin, w]));
  const favs = (list?.coins ?? []).map((c) => byCoin.get(c)).filter((w): w is WatchItem => w !== undefined);
  const reorder = useReorderList(list?.id ?? null);
  const rowOf = usePriceRows(favs);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(WATCHLIST_DEFAULT);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const showChange = width >= SHOW_CHANGE;
  const showLast = width >= SHOW_LAST;
  const showQuote = width >= SHOW_QUOTE;

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="sr-only">Lista de urmărire</h2>
        {lists.length > 0 ? (
          <select
            aria-label="Lista de urmărire"
            value={list?.id ?? ''}
            onChange={(e) => save.mutate({ charts: { listId: Number(e.target.value) } })}
            className="h-8 min-w-0 flex-1 py-0 text-[13px] font-semibold"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.coins.length})
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1 text-[13px] font-semibold">Listă</span>
        )}
        <Link to={list ? `/watchlists?list=${list.id}` : '/watchlists'} className="shrink-0 text-[12px] text-accent" title="Deschide listele de urmărire">
          Liste
        </Link>
      </header>
      <div className="border-b border-line px-3 py-2">
        <SymbolSearch onPick={onPick} />
      </div>
      <div className="flex items-center gap-1.5 border-b border-line py-1.5 pr-3 pl-3 text-[11.5px] text-faint" aria-hidden>
        <span className="min-w-0 flex-1">Simbol</span>
        {showLast && <span className="min-w-[70px] shrink-0 text-right">Ultimul</span>}
        {showChange && <span className="min-w-[56px] shrink-0 text-right">Var</span>}
        <span className="min-w-[54px] shrink-0 text-right">Var%</span>
      </div>
      {/* FD-CHARTPOLISH §1: 4 px between the rows, so a framed row and its neighbour's hover never touch. In the phone's
          panel, `touch-pan-y` here too: a scroller starts its own touch-action chain, and a sideways drag must reach the
          panel (its swipe to close) instead of being taken by the browser. */}
      <div className={clsx('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-1', inDrawer && 'touch-pan-y', inDrawer || contained ? 'overscroll-contain' : 'overscroll-auto')}>
        {favs.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-faint">
            {view.isPending ? (
              'Se încarcă…'
            ) : (
              <>
                Lista e goală. Adaugi simboluri în{' '}
                <Link to={list ? `/watchlists?list=${list.id}` : '/watchlists'} className="text-accent">
                  Liste de urmărire
                </Link>
                ; căutarea de mai sus deschide orice grafic.
              </>
            )}
          </p>
        ) : (
          // Drag a row to reorder the list; Alt + ↑ / ↓ does it from the keyboard (FD-CHARTFAV §2).
          <FavoritesDnd ids={favs.map((w) => w.coin)} layout="rows" reorder={reorder} label={plainSymbol}>
            {(order) =>
              favs.map((w) => {
                const key = chartKeyOf(w);
                const r = rowOf(w);
                const on = key === current;
                return (
                  <SortableFavorite key={w.coin} id={w.coin}>
                    {(s) => (
                      <button
                        ref={s.setNodeRef}
                        {...s.attributes}
                        {...s.listeners}
                        style={s.style}
                        type="button"
                        aria-current={on ? 'page' : undefined}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        onClick={() => !order.justDragged() && onPick(chartPathOf(w))}
                        onKeyDown={order.keyMove(w.coin, 'y')}
                        title={`${w.name ? `${w.name}. ` : ''}Trage ca să muți simbolul în listă`}
                        className={clsx(
                          'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover pointer-coarse:py-2.5',
                          on && 'bg-hover ring-1 ring-line-strong',
                          s.isDragging && 'shadow-drag bg-panel-2',
                        )}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <CoinLogo coin={w.coin} size={18} badge={w.kind === 'stock'} square={w.kind === 'stock'} />
                          <span className="truncate font-medium">{plainSymbol(w.coin)}</span>
                          {w.kind === 'crypto' && showQuote && <span className="shrink-0 text-[11.5px] text-faint">/{w.quote}</span>}
                        </span>
                        {showLast && (
                          <span className="num min-w-[70px] shrink-0 text-right" title={r.error ?? undefined}>
                            {r.last !== null ? fmtPrice(r.last, r.precision) : r.error ? '—' : '…'}
                          </span>
                        )}
                        {showChange && <span className={clsx('num min-w-[56px] shrink-0 text-right', tone(r.change))}>{r.change !== null ? signed(r.change, r.precision) : '—'}</span>}
                        <span className={clsx('num min-w-[54px] shrink-0 text-right', tone(r.pct))}>{r.pct !== null ? fmtPct(r.pct) : '—'}</span>
                      </button>
                    )}
                  </SortableFavorite>
                );
              })
            }
          </FavoritesDnd>
        )}
      </div>
    </div>
  );
}
