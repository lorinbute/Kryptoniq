// The top bar's menu on one row (FD-NAVOVERFLOW): as many pages as fit, in order; the rest behind "»", in a floating
// list. Measured on a hidden ruler (every page at its width), again on every resize and once the fonts are in.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router';
import { clsx } from 'clsx';
import { ChevronsRight } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;
  end?: boolean;
}

/** Between two pages, px (`gap-1`). */
const GAP = 4;

/**
 * How many items (of the given widths) fit in `avail` px with `gap` between them: all of them, or the most that leave
 * room for "»" (`more` px) after them.
 */
export function fitCount(widths: readonly number[], avail: number, gap: number, more: number): number {
  const all = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= avail) return widths.length;
  let used = more;
  let k = 0;
  for (const w of widths) {
    if (used + w + gap > avail) break;
    used += w + gap;
    k++;
  }
  return k;
}

const ITEM = 'inline-flex h-[34px] shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] whitespace-nowrap no-underline transition-colors hover:no-underline';
const ACTIVE = 'bg-nav-active font-semibold text-on-nav-active [&>svg]:text-nav-active-icon';
const IDLE = 'text-muted hover:bg-nav-hover hover:text-text';

const isActive = (item: NavItem, path: string) => matchPath({ path: item.to, end: item.end ?? false }, path) !== null;

export function PriorityNav({ items }: { items: readonly NavItem[] }) {
  const row = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const el = row.current;
    const r = ruler.current;
    if (!el || !r) return;
    const measure = () => {
      const widths = [...r.children].map((c) => c.getBoundingClientRect().width);
      // The last ruler child is "»" itself (fitCount counts the gap before it, after the last page shown).
      const more = widths.pop() ?? 34;
      setFit(fitCount(widths, el.clientWidth, GAP, more));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [items]);

  // Closed on another page, and once nothing is hidden any more.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (fit >= items.length) setOpen(false);
  }, [fit, items.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !moreRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      moreRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = items.slice(0, fit);
  const hidden = items.slice(fit);
  const hiddenActive = hidden.some((i) => isActive(i, pathname));
  // ↓ / ↑ between the list's pages; opened from the keyboard, the first one takes the focus.
  const links = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = links();
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };
  const onMoreKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => links()[0]?.focus());
  };

  return (
    // At least "»"'s room: the pages may all go behind it, but it never does.
    <div ref={row} className="relative flex min-w-[38px] flex-1 items-center">
      {/* The ruler: every page at its width (bold, as the open one), then "»"; never seen nor read. In a box of no size
          that clips it: laid out (so measured) without widening the page. */}
      <div aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        <div ref={ruler} className="flex w-max">
          {items.map(({ to, label, icon: Icon }) => (
            <span key={to} className={clsx(ITEM, 'font-semibold')}>
              <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
              {label}
            </span>
          ))}
          <span className={clsx(ITEM, 'px-2.5')}>
            <ChevronsRight size={16} aria-hidden />
          </span>
        </div>
      </div>
      <nav aria-label="Navigare" className="flex min-w-0 items-center gap-1">
        {shown.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive: on }) => clsx(ITEM, on ? ACTIVE : IDLE)}>
            <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
            {label}
          </NavLink>
        ))}
        {hidden.length > 0 && (
          <div className="relative">
            <button
              ref={moreRef}
              type="button"
              className={clsx(ITEM, 'px-2.5', hiddenActive ? ACTIVE : IDLE)}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Mai multe pagini (${hidden.length})`}
              title={hidden.map((i) => i.label).join(' · ')}
              onClick={() => setOpen((o) => !o)}
              onKeyDown={onMoreKey}
            >
              <ChevronsRight size={16} aria-hidden />
            </button>
            {open && (
              <div ref={list} role="menu" aria-label="Mai multe pagini" onKeyDown={onListKey} className="theme-page absolute top-full left-0 z-40 mt-2 flex w-max min-w-[200px] flex-col gap-0.5 rounded-[14px] border border-line-strong bg-panel-2 p-1.5 shadow-pop">
                {hidden.map(({ to, label, icon: Icon, end }) => (
                  <NavLink key={to} to={to} end={end} role="menuitem" className={({ isActive: on }) => clsx(ITEM, 'w-full', on ? ACTIVE : IDLE)}>
                    <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
