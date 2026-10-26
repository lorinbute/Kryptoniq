// FD-CHARTSETTINGS: the chart's own menu on a right click, as TradingView's: at the pointer (flipped left / up when it
// would leave the window), a row each with its icon, name and shortcut, groups split by a line. The arrows move the
// selection, Enter / Space choose, Esc, Tab, a click outside, a scroll or a resize close it.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ChartMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The key that does the same, shown on the right ("⌥R"). */
  shortcut?: string;
  /** A line above it (a new group). */
  separated?: boolean;
  onSelect: () => void;
}

const EDGE = 8;

export function ChartMenu({ at, items, onClose }: { at: { x: number; y: number }; items: readonly ChartMenuItem[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const m = menu.current;
    if (!m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const left = at.x + w > innerWidth - EDGE ? Math.max(EDGE, at.x - w) : at.x;
    const top = at.y + h > innerHeight - EDGE ? Math.max(EDGE, at.y - h) : at.y;
    setPos({ left, top });
  }, [at]);
  // Once placed (a hidden element takes no focus), the keyboard starts on the first row.
  useLayoutEffect(() => {
    if (pos) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [pos]);

  useLayoutEffect(() => {
    const close = () => onCloseRef.current();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    // Esc is the menu's own: nothing behind it (full screen, a panel) takes it too.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: i + 1, ArrowUp: i < 0 ? rows.length - 1 : i - 1, Home: 0, End: rows.length - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      rows[(next + rows.length) % rows.length]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Meniul graficului"
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[55] min-w-[240px] rounded-xl border border-line-strong bg-panel py-1.5 shadow-pop"
      // Measured first (hidden), then placed: it never shows for a frame at the wrong place.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {items.map((it) => (
        <div key={it.id}>
          {it.separated && <div role="separator" className="my-1.5 border-t border-line" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            // The pointer moves the selection, as the arrows do: one row lit at a time.
            onPointerMove={(e) => e.pointerType === 'mouse' && e.currentTarget.focus()}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className="flex h-9 w-full items-center gap-3 px-3.5 text-left text-[13.5px] whitespace-nowrap text-text outline-none focus:bg-hover"
          >
            <it.icon size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="pl-6 text-[12.5px] text-faint">{it.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
