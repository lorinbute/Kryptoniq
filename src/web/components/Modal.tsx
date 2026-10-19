// A dialog window (as the account wizard's): focus inside, Tab stays inside, Esc closes (unless `locked`, while a
// request is on its way), focus returns to the opener; a click on the backdrop closes too.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../scroll-lock.ts';

export function Modal({ title, onClose, children, width = 560, locked = false, headerExtra }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; locked?: boolean; headerExtra?: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // FD-SCROLLLOCK: only the window scrolls while it is open.
  useScrollLock();
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-3 pt-[6vh] pb-6 backdrop-blur-sm sm:px-4" onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-modal" style={{ maxWidth: width }}>
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="flex-1 text-[16px] font-semibold">
            {title}
          </h2>
          {headerExtra}
          <button className="btn w-[38px] px-0" onClick={onClose} disabled={locked} aria-label="Închide">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
