// A dialog window (as the account wizard's): focus inside, Tab stays inside, Esc closes (unless `locked`, while a
// request is on its way), focus returns to the opener; a click on the backdrop closes too. `clear`: the page stays sharp
// behind it (a live preview); `flush`: the body lays itself out (its own scrolling, padding and footer).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useScrollLock } from '../scroll-lock.ts';
import { useVisibleArea } from '../visible-area.ts';

export function Modal({
  title,
  onClose,
  children,
  width = 560,
  locked = false,
  headerExtra,
  clear = false,
  flush = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  locked?: boolean;
  headerExtra?: ReactNode;
  clear?: boolean;
  flush?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // FD-SCROLLLOCK: only the window scrolls while it is open.
  useScrollLock();
  const area = useVisibleArea();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select:not(:disabled), a[href]') ?? [])];
    requestAnimationFrame(() => (dialog.current?.querySelector<HTMLElement>('input:not(:disabled), select, button:not(:disabled)') ?? dialog.current)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        if (!lockedRef.current) onClose();
      } else if (e.key === 'Tab') {
        const els = focusable();
        if (!els.length) return;
        const first = els[0] as HTMLElement;
        const last = els[els.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    // FD-MODALFIT: as tall as the part of the window seen at most (`vh` is more than that on iPhone / iPad), above the keyboard.
    <div className={clsx('fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] pb-6 sm:px-4', !clear && 'bg-scrim backdrop-blur-sm')} style={area} onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-modal" style={{ maxWidth: width }}>
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          {/* A flex title: what it holds (a logo, a badge) on the header's middle, as the × beside it. */}
          <h2 id={titleId} className="flex min-w-0 flex-1 items-center text-[16px] font-semibold">
            {title}
          </h2>
          {headerExtra}
          <button className="btn w-[38px] px-0" onClick={onClose} disabled={locked} aria-label="Închide">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className={flush ? 'flex min-h-0 flex-1 flex-col' : 'flex-1 overflow-y-auto overscroll-contain px-5 py-5'}>{children}</div>
      </div>
    </div>
  );
}
