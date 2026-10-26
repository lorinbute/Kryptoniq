// Full screen for the chart (TD-CHARTUX §5): the system's full screen when the browser allows it (never on an iPhone
// or iPad, FD-IPADFS2), otherwise the element covers the app window ("css" mode). Esc leaves the css mode; in the
// native mode the browser handles Esc.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { lockScroll } from '../scroll-lock.ts';

export type FullscreenMode = 'off' | 'native' | 'css';

/**
 * An iPhone, an iPod or an iPad. iPadOS (and an iPhone asking for desktop sites) says "Macintosh" in its user agent; a
 * Mac has no touch points.
 */
export function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * Whether to ask for the system's full screen (FD-IPADFS2): not on an iPhone or iPad. There every browser's (WebKit's)
 * full screen leaves on any pull down, on purpose: no page can stop it (not `preventDefault`, not `touch-action`), and
 * scrolling the symbol list up is a pull down. It also covers the whole screen, under the camera's cut-out, where
 * the top of the symbol list's panel was lost. The chart covers the browser's window instead.
 */
export function nativeFullscreenAllowed(): boolean {
  return !isAppleTouch();
}

/** Sent by the app (e.g. ⌘K) when something must be visible above the chart. */
export const EXIT_FULLSCREEN_EVENT = 'sentiq:exit-fullscreen';

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const fullscreenElement = (): Element | null => document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null;

/** A window is open (a closed panel stays in the page, inert): its Esc and shortcuts are its own. */
export const modalOpen = (): boolean => [...document.querySelectorAll('[aria-modal="true"]')].some((d) => !d.closest('[inert]'));

/** Where something floating is put: the element in full screen (nothing outside it shows then), else the page. */
export const overlayRoot = (): HTMLElement => (fullscreenElement() as HTMLElement | null) ?? document.body;

export function useFullscreen(ref: RefObject<HTMLElement | null>, opts: { blockEsc: boolean }) {
  const [mode, setMode] = useState<FullscreenMode>('off');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const blockEsc = useRef(opts.blockEsc);
  blockEsc.current = opts.blockEsc;
  // The element that entered full screen (the ref is already cleared when the page unmounts).
  const entered = useRef<HTMLElement | null>(null);
  // A request in progress: a second click must not start another one.
  const entering = useRef(false);

  const exit = useCallback(() => {
    if (modeRef.current === 'css') {
      setMode('off');
      return;
    }
    if (modeRef.current !== 'native') return;
    const d = document as FsDocument;
    if (ref.current && fullscreenElement() === ref.current) {
      try {
        const done = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
        void Promise.resolve(done).catch(() => setMode('off'));
      } catch {
        setMode('off');
      }
    } else {
      setMode('off');
    }
  }, [ref]);

  const enter = useCallback(async () => {
    const el = ref.current as FsElement | null;
    if (!el || modeRef.current !== 'off' || entering.current) return;
    entering.current = true;
    entered.current = el;
    try {
      const ask = el.requestFullscreen ? () => el.requestFullscreen() : el.webkitRequestFullscreen ? () => el.webkitRequestFullscreen?.() : null;
      const request = nativeFullscreenAllowed() ? ask : null;
      if (request) {
        try {
          await request();
        } catch {
          // Refused (no user gesture, iframe policy, iPhone): cover the window instead.
        }
      }
      // Older WebKit returns nothing and reports a refusal through an event: what counts is where the browser is now.
      setMode(fullscreenElement() === el ? 'native' : 'css');
    } finally {
      entering.current = false;
    }
  }, [ref]);

  // Follow the browser: Esc in native mode, the macOS green button, the browser's menu.
  useEffect(() => {
    const sync = () => {
      const inside = ref.current !== null && fullscreenElement() === ref.current;
      if (inside) setMode('native');
      else if (modeRef.current === 'native') setMode('off');
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [ref]);

  // Esc (an open dialog closes first: it handles its own Esc) and the app's "exit" request. In native mode the
  // browser usually leaves on Esc by itself; when the key does reach the page, it is handled the same way.
  useEffect(() => {
    if (mode === 'off') return;
    const onKey = (e: KeyboardEvent) => {
      // A window opened in full screen (an order, the chart's settings) closes first: its own listener comes later.
      if (e.key !== 'Escape' || e.defaultPrevented || modeRef.current === 'off' || blockEsc.current || modalOpen()) return;
      e.preventDefault();
      exit();
    };
    const onExit = () => exit();
    window.addEventListener('keydown', onKey);
    window.addEventListener(EXIT_FULLSCREEN_EVENT, onExit);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(EXIT_FULLSCREEN_EVENT, onExit);
    };
  }, [mode, exit]);

  // The page behind the covering element must not scroll (the lock shared with panels and windows, FD-SCROLLLOCK).
  useEffect(() => (mode === 'css' ? lockScroll() : undefined), [mode]);

  // Leaving the page while in full screen.
  useEffect(
    () => () => {
      const el = entered.current;
      if (el && fullscreenElement() === el) {
        const d = document as FsDocument;
        try {
          void Promise.resolve(d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()).catch(() => undefined);
        } catch {
          // already left
        }
      }
    },
    [],
  );

  return { mode, active: mode !== 'off', enter, exit };
}
