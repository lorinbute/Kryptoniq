// FD-CHARTAUDIT §14: on a touch screen the library has a cross mode (a long press puts the cross; while it is on, a
// drag moves the cross, not the chart), which only a tap on the chart ends. A cross taken away from outside (the "+"
// gone after a touch on its menu or elsewhere on the page) left the mode on: the next swipe brought the cross back
// instead of moving the chart.
import type { IChartApi } from 'lightweight-charts';

/** Far off the chart: the library's tap there does nothing, and a real tap is never "the second of a double tap". */
const FAR = -10_000;
const ID = 0x5e47;

/** Ends the library's cross mode on every pane: a tap of its own on each pane's touch target (nothing where it is off). */
export function endTouchCross(chart: Pick<IChartApi, 'panes'>): void {
  if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') return;
  for (const pane of chart.panes()) {
    // The pane's top canvas (its second): the element the library listens to for touches.
    const target = pane.getHTMLElement()?.querySelectorAll('canvas')[1];
    if (!target) continue;
    try {
      const t = new Touch({ identifier: ID, target, clientX: FAR, clientY: FAR });
      target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
      target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
    } catch {
      // A browser that cannot make touches: it has no touch cross mode either.
    }
  }
}
