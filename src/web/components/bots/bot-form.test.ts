import { describe, expect, it } from 'vitest';
import { defaultGrid, formOf, initialForm, localInput, marketPatch, numText, ratioOf, readNum, toInput, zoneText, type BotSeed } from './bot-form.ts';

const seed: BotSeed = { kind: 'crypto', symbol: 'BTC/USDT', tf: '4h', price: 101.37, low: 93.12, high: 108.9 };

describe('the bot form (FD-BOT §1)', () => {
  it("starts from the chart: its symbol, timeframe, the last candles' range; a simulation", () => {
    const g = initialForm(seed, 'grid');
    expect(g).toMatchObject({ strategy: 'grid', name: 'BTC/USDT · Grid', exec: 'paper', market: 'spot', symbols: ['BTC/USDT'], tf: '4h', endAction: 'close', fee: '0,1' });
    expect(g.grid).toMatchObject({ lower: '93,12', upper: '108,9', grids: '10', spacing: 'arithmetic', direction: 'long', trigger: '' });
    expect(initialForm(seed, 'premium').endAction).toBe('finish');
    expect(initialForm({ ...seed, kind: 'stocks', symbol: 'AAPL' }, 'premium').market).toBe('stock');
    // Without a range: ±8% around the price.
    expect(defaultGrid({ ...seed, low: null, high: null })).toMatchObject({ lower: 93.26, upper: 109.48 });
  });

  it('reads the typed numbers: a comma, spaces, empty optional fields; says what is wrong in Romanian', () => {
    expect(readNum(' 1 234,5 ')).toBe(1234.5);
    expect(readNum('')).toBeNull();
    expect(readNum('abc')).toBeNaN();
    expect(numText(0.1 + 0.2)).toBe('0,3');
    const f = initialForm(seed, 'grid');
    const ok = toInput(f, Date.parse('2026-10-21T12:00:00Z'));
    expect(ok.error).toBeNull();
    expect(ok.input).toMatchObject({ strategy: 'grid', maxAmount: 1000, leverage: 1, fee: 0.1, startsAt: null, endsAt: null, grid: { lower: 93.12, upper: 108.9, grids: 10, trigger: null, stopBelow: null } });
    expect(toInput({ ...f, maxAmount: '' }).error).toBe('Suma maximă: lipsește.');
    expect(toInput({ ...f, grid: { ...f.grid, grids: 'zece' } }).error).toBe('Grilele: nu e un număr.');
    expect(toInput({ ...f, grid: { ...f.grid, lower: '120' } }).error).toBe('Limita de sus trebuie să fie peste cea de jos.');
    const p = initialForm(seed, 'premium');
    expect(toInput({ ...p, premium: { ...p.premium, weights: { ...p.premium.weights, area: '' } } }).error).toBe('Ponderea „Aria”: lipsește.');
    expect(toInput({ ...p, premium: { ...p.premium, cooldownMin: '' } }).error).toBe('Pauza după o pierdere: lipsește.');
  });

  it('a start in the past is now; the end must come after it; leverage only on futures', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    const f = initialForm(seed, 'dca');
    expect(toInput({ ...f, startsAt: localInput(now - 60_000) }, now).input?.startsAt).toBeNull();
    expect(toInput({ ...f, startsAt: localInput(now + 3_600_000) }, now).input?.startsAt).toBe(Math.floor((now + 3_600_000) / 60_000) * 60_000);
    expect(toInput({ ...f, startsAt: '' }, now).error).toBe('Începutul: alege data și ora.');
    expect(toInput({ ...f, startsAt: localInput(now + 7_200_000), endsAt: localInput(now + 3_600_000) }, now).error).toBe('Sfârșitul trebuie să fie după început.');
    expect(toInput({ ...f, leverage: '7' }, now).input?.leverage).toBe(1);
    expect(toInput({ ...f, ...marketPatch(f, 'futures'), leverage: '7' }, now).input?.leverage).toBe(7);
  });

  it('leaving futures makes every strategy long; a bot read back gives the same settings', () => {
    const p = initialForm(seed, 'premium');
    const fut = { ...p, ...marketPatch(p, 'futures'), premium: { ...p.premium, direction: 'both' as const } };
    expect(toInput(fut).input).toMatchObject({ market: 'futures', premium: { direction: 'both' } });
    expect(toInput({ ...fut, ...marketPatch(fut, 'spot') }).input).toMatchObject({ market: 'spot', premium: { direction: 'long' } });
    const input = toInput(initialForm(seed, 'dca')).input!;
    const back = toInput(formOf(input)).input;
    expect(back).toEqual(input);
  });

  it('FD-BOTPCT: Slingshot by default; "Risc / câștig" is two percents from the entry, the ratio shown as 1:x', () => {
    const p = initialForm(seed, 'premium');
    expect(p.premium).toMatchObject({ levels: 'slingshot', slPct: '1', tpPct: '2' });
    for (const k of ['sl', 'tp', 'rrRisk', 'rrReward', 'minRr']) expect(k in p.premium).toBe(false);
    const pct = { ...p, premium: { ...p.premium, levels: 'percent' as const, slPct: '1,5', tpPct: '3' } };
    const input = toInput(pct).input!;
    expect(input).toMatchObject({ premium: { levels: 'percent', slPct: 1.5, tpPct: 3 } });
    expect(formOf(input).premium).toMatchObject({ slPct: '1,5', tpPct: '3' });
    expect(ratioOf('1', '2')).toBe('1:2');
    expect(ratioOf('1,5', '2')).toBe('1:1,33');
    expect(ratioOf('', '2')).toBe('—');
    expect(ratioOf('0', '2')).toBe('—');
    expect(toInput({ ...pct, premium: { ...pct.premium, tpPct: '' } }).error).toBe('Take profit-ul: lipsește.');
    // The percents hidden by "Slingshot", emptied or wrong before, do not block the save: a valid one stays, else the default.
    expect(toInput({ ...p, premium: { ...p.premium, slPct: '', tpPct: '0' } }).input).toMatchObject({ premium: { levels: 'slingshot', slPct: 1, tpPct: 2 } });
    expect(toInput({ ...p, premium: { ...p.premium, slPct: '3', tpPct: '4' } }).input).toMatchObject({ premium: { slPct: 3, tpPct: 4 } });
  });

  it('FD-BOTDIR: a threshold per side, 50 by default; the hidden one does not block the save; the sentence under them', () => {
    const p = initialForm(seed, 'premium');
    expect(p.premium).toMatchObject({ longMin: '50', shortMax: '50' });
    expect('minScore' in p.premium).toBe(false);
    // Long only: the short's threshold is hidden; emptied or wrong, its default; valid, kept.
    expect(toInput({ ...p, premium: { ...p.premium, shortMax: '' } }).input).toMatchObject({ premium: { longMin: 50, shortMax: 50 } });
    expect(toInput({ ...p, premium: { ...p.premium, shortMax: '2,5' } }).input).toMatchObject({ premium: { shortMax: 50 } });
    expect(toInput({ ...p, premium: { ...p.premium, shortMax: '30' } }).input).toMatchObject({ premium: { shortMax: 30 } });
    expect(toInput({ ...p, premium: { ...p.premium, longMin: '' } }).error).toBe('Scorul minim pentru long: lipsește.');
    const futures = { ...p, market: 'futures' as const, leverage: '3' };
    expect(toInput({ ...futures, premium: { ...p.premium, direction: 'short', longMin: 'x', shortMax: '40' } }).input).toMatchObject({ premium: { longMin: 50, shortMax: 40 } });
    expect(toInput({ ...futures, premium: { ...p.premium, direction: 'both', shortMax: '' } }).error).toBe('Scorul maxim pentru short: lipsește.');
    expect(toInput({ ...futures, premium: { ...p.premium, direction: 'both', shortMax: '101' } }).error).toBe('Scorul maxim pentru short: cel mult 100');
    const both = toInput({ ...futures, premium: { ...p.premium, direction: 'both', longMin: '39', shortMax: '61' } }).input!;
    expect(both).toMatchObject({ premium: { longMin: 39, shortMax: 61 } });
    expect(formOf(both).premium).toMatchObject({ longMin: '39', shortMax: '61' });
    expect(zoneText({ direction: 'long', longMin: '50', shortMax: '50' })).toBe('Long de la scorul 50 în sus.');
    expect(zoneText({ direction: 'short', longMin: '50', shortMax: '45' })).toBe('Short de la scorul 45 în jos.');
    expect(zoneText({ direction: 'both', longMin: '39', shortMax: '61' })).toBe('Long de la scorul 39 în sus, short de la 61 în jos: între 39 și 61 pot intra amândouă.');
    expect(zoneText({ direction: 'both', longMin: '55', shortMax: '45' })).toBe('Long de la scorul 55 în sus, short de la 45 în jos: peste 45 și sub 55, botul nu intră.');
    expect(zoneText({ direction: 'both', longMin: '50', shortMax: '50' })).toBe('Long de la scorul 50 în sus, short de la 50 în jos: la 50 pot intra amândouă.');
    expect(zoneText({ direction: 'both', longMin: '', shortMax: '2,5' })).toBe('Long de la scorul — în sus, short de la — în jos.');
    expect(zoneText({ direction: 'long', longMin: '101', shortMax: '50' })).toBe('Long de la scorul — în sus.');
  });

  it('FD-NEWSWIN: the minutes before important economic news, named so in the errors; 0 turns it off', () => {
    const p = initialForm(seed, 'premium');
    expect(p.premium.newsWindowMin).toBe('60');
    expect(toInput({ ...p, premium: { ...p.premium, newsWindowMin: '' } }).error).toBe('Minutele dinaintea știrilor economice importante: lipsește.');
    expect(toInput({ ...p, premium: { ...p.premium, newsWindowMin: '721' } }).error).toBe('Minutele dinaintea știrilor economice importante: cel mult 720');
    expect(toInput({ ...p, premium: { ...p.premium, newsWindowMin: '0' } }).input).toMatchObject({ premium: { newsWindowMin: 0 } });
  });
});
