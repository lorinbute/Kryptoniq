// FD-PREMIUMHIDE: Slingshot and LMA off the chart, drawn, or hidden with the eye.
import { describe, expect, it } from 'vitest';
import { settingsSchema } from '../../shared/settings.ts';
import { premiumNote, premiumState } from './premium.ts';

describe('Slingshot and LMA hidden with the eye', () => {
  it('are shown unless hidden, also for settings saved before the switch existed', () => {
    expect(settingsSchema.parse({}).charts).toMatchObject({ slingshotHidden: false, lmaHidden: false });
    expect(settingsSchema.parse({ charts: { showLma: false } }).charts).toMatchObject({ slingshotHidden: false, lmaHidden: false });
    expect(settingsSchema.parse({ charts: { slingshotHidden: true } }).charts).toMatchObject({ slingshotHidden: true, lmaHidden: false });
    expect(settingsSchema.safeParse({ charts: { lmaHidden: 'yes' } }).success).toBe(false);
  });

  it('off the chart, drawn or hidden, each on its own', () => {
    const base = { showSlingshot: true, slingshotHidden: false, showLma: true, lmaHidden: false };
    expect(premiumState(base)).toEqual({ slingshot: 'shown', lma: 'shown' });
    expect(premiumState({ ...base, slingshotHidden: true })).toEqual({ slingshot: 'hidden', lma: 'shown' });
    expect(premiumState({ ...base, lmaHidden: true })).toEqual({ slingshot: 'shown', lma: 'hidden' });
    // Off wins: removed with × is off whatever the eye said.
    expect(premiumState({ ...base, showSlingshot: false, slingshotHidden: true, showLma: false })).toEqual({ slingshot: 'off', lma: 'off' });
  });

  it('the list says whether it is on the chart and hidden', () => {
    expect(premiumNote('off')).toBeNull();
    expect(premiumNote('shown')).toBe('Pe grafic');
    expect(premiumNote('hidden')).toBe('Pe grafic, ascuns');
  });
});
