// FD-MODALFIT: the part of the window really seen. A `fixed inset-0` layer is the window without the on-screen keyboard;
// with the keyboard up (or the page zoomed in) the part seen is the visual viewport, which Safari scrolls inside it.
import { useEffect, useState, type CSSProperties } from 'react';

type Viewport = Pick<VisualViewport, 'height' | 'offsetTop'>;

/** The layer's place when less than the whole window is seen; undefined when the whole window is (the CSS holds). */
export function areaStyle(vv: Viewport | null | undefined, innerHeight: number): CSSProperties | undefined {
  if (!vv) return undefined;
  if (vv.height >= innerHeight - 1 && vv.offsetTop <= 0) return undefined;
  return { top: Math.round(Math.max(0, vv.offsetTop)), height: Math.round(vv.height), bottom: 'auto' };
}

/** `areaStyle`, kept up to date while the keyboard comes and goes (or the page is zoomed and moved). */
export function useVisibleArea(): CSSProperties | undefined {
  const read = () => (typeof window === 'undefined' ? undefined : areaStyle(window.visualViewport, window.innerHeight));
  const [style, setStyle] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setStyle((was) => {
        const now = read();
        return was?.top === now?.top && was?.height === now?.height ? was : now;
      });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return style;
}
