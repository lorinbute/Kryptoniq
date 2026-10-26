// FIX-INFOTIP: a setting's explanation behind an (i). It shows while the mouse is on the icon and stays open after a
// click, a tap or Enter / Space, until a click elsewhere, Esc or another click on it. Above everything (the settings
// windows included), inside the window, without moving the page. The browser's own tooltip (`title`) showed nothing on a
// click, nothing on a phone and only after a long pause in Safari.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Info } from 'lucide-react';

const MARGIN = 8;
const GAP = 6;
/** One explanation open at a time: the one opening tells the others. */
const OPEN_EVENT = 'sentiq:infotip';

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const tipId = `${id}-tip`;
  const open = hover || pinned;
  const close = () => {
    setHover(false);
    setPinned(false);
  };

  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== id && close();
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [id]);
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [open, id]);

  // Under the icon and centred on it; above it when there is no room below; always inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const p = pop.current;
      if (!b || !p) return;
      // The icon scrolled out of sight takes its explanation with it.
      if (b.bottom < 0 || b.top > innerHeight) return close();
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const left = Math.max(MARGIN, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - MARGIN));
      let top = b.bottom + GAP;
      if (top + h > innerHeight - MARGIN && b.top - GAP - h >= MARGIN) top = b.top - GAP - h;
      setPos({ left, top: Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN)) });
    };
    place();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // The settings scrolled or the window resized (a phone's keyboard): it follows its icon.
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      setPos(null);
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    // Captured on the window, so it runs before the settings window's own Esc, which then stays open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      {/* A wider spot to tap than the icon, with the same place in the line (the padding is taken back by the margin). */}
      <button
        ref={btn}
        type="button"
        aria-label="Explicația setării"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        className={clsx('-m-1 inline-flex shrink-0 cursor-help items-center rounded-full p-1 text-faint hover:text-text', className)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        onClick={(e) => {
          // Inside a checkbox's label: the box does not change.
          e.preventDefault();
          if (pinned) close();
          else setPinned(true);
        }}
      >
        <Info size={13} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={tipId}
            role="tooltip"
            // Measured hidden first, then shown where it fits.
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
            className="theme-page fixed z-[60] w-max max-w-[min(280px,calc(100vw-16px))] rounded-[10px] border border-line-strong bg-panel-2 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-line text-text shadow-pop"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
