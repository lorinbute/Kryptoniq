// Slingshot and LMA on the chart (FD-PREMIUMHIDE): off it, drawn, or kept on it but hidden with the legend's eye.
import type { Settings } from '../../shared/settings.ts';

export type PremiumState = 'off' | 'shown' | 'hidden';

export function premiumState(prefs: Pick<Settings['charts'], 'showSlingshot' | 'slingshotHidden' | 'showLma' | 'lmaHidden'>): { slingshot: PremiumState; lma: PremiumState } {
  const of = (on: boolean, hidden: boolean): PremiumState => (!on ? 'off' : hidden ? 'hidden' : 'shown');
  return { slingshot: of(prefs.showSlingshot, prefs.slingshotHidden), lma: of(prefs.showLma, prefs.lmaHidden) };
}

/** What the row of the "Indicatori" list says on its right. */
export const premiumNote = (state: PremiumState): string | null => (state === 'off' ? null : state === 'hidden' ? 'Pe grafic, ascuns' : 'Pe grafic');
