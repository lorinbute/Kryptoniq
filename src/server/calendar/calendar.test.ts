import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Db } from '../db/database.ts';
import { silentLogger } from '../log.ts';
import { explain } from './glossary.ts';
import { ffWeekRange, formatTv, matchEvents, mergeCalendar, normalizeTitle, parseValue } from './merge.ts';
import { CalendarService, FF_JOB } from './service.ts';
import { parseForexFactory, parseTradingView, RateLimitedError, type RawEvent } from './sources.ts';
import { readJobData } from '../jobs/scheduler.ts';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');
const ff = parseForexFactory(fixture('ff-thisweek.json'));
const tv = parseTradingView(fixture('tv-events.json'));

describe('ForexFactory parser', () => {
  it('parses the weekly JSON (offsets, impact, holidays, "All")', () => {
    expect(ff).toHaveLength(109);
    const cpi = ff.find((e) => e.title === 'CPI m/m' && e.currency === 'USD')!;
    expect(cpi).toMatchObject({ impact: 'High', forecast: '0.6%', previous: '0.4%', ts: Date.parse('2026-10-14T12:30:00Z'), allDay: false });
    expect(ff.find((e) => e.title === 'Bank Holiday' && e.currency === 'USD')).toMatchObject({ impact: 'Holiday', allDay: true });
    expect(ff.some((e) => e.currency === 'ALL')).toBe(true);
    expect(ff.filter((e) => e.forecast === '').length).toBe(0);
  });
  it('treats an HTML body as a rate limit and skips invalid rows', () => {
    expect(() => parseForexFactory('<html>Please wait five minutes</html>')).toThrow(RateLimitedError);
    expect(parseForexFactory('[{"title":"x"},{"title":"A","country":"USD","date":"2026-10-14T08:30:00-04:00","impact":"High"}]')).toHaveLength(1);
  });
});

describe('TradingView parser', () => {
  it('parses events with numeric actual/forecast and maps importance', () => {
    const ism = tv.find((e) => e.title === 'ISM Services PMI')!;
    expect(ism).toMatchObject({ currency: 'USD', impact: 'High', actual: '54.9', forecast: '55', previous: '55.4' });
    expect(tv.some((e) => e.impact === 'Low')).toBe(true);
  });
});

describe('matching FF ↔ TV', () => {
  const range = ffWeekRange(Math.min(...ff.map((e) => e.ts)));
  const matches = matchEvents(
    ff.filter((e) => e.ts >= range.start && e.ts < range.end),
    tv,
  );
  const tvTitleFor = (title: string, currency = 'USD') => {
    const f = ff.find((e) => e.title === title && e.currency === currency)!;
    return matches.get(f.extId)?.title ?? null;
  };
  it('matches the same release despite different names', () => {
    expect(tvTitleFor('CPI m/m')).toBe('Inflation Rate MoM');
    expect(tvTitleFor('CPI y/y')).toBe('Inflation Rate YoY');
    expect(tvTitleFor('Core CPI m/m')).toBe('Core Inflation Rate MoM');
    expect(tvTitleFor('Core CPI y/y')).toBe('Core Inflation Rate YoY');
    expect(tvTitleFor('Unemployment Claims')).toBe('Initial Jobless Claims');
    expect(tvTitleFor('Retail Sales m/m')).toBe('Retail Sales MoM');
    expect(tvTitleFor('Core Retail Sales m/m')).toBe('Retail Sales Ex Autos MoM');
    expect(tvTitleFor('PPI m/m')).toBe('PPI MoM');
    expect(tvTitleFor('Empire State Manufacturing Index')).toBe('NY Empire State Manufacturing Index');
    expect(tvTitleFor('Philly Fed Manufacturing Index')).toBe('Philadelphia Fed Manufacturing Index');
  });
  it('never matches one TV event twice', () => {
    const ids = [...matches.values()].map((e) => e.extId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('normalizes periods', () => {
    expect(normalizeTitle('CPI y/y').period).toBe('yoy');
    expect(normalizeTitle('GDP q/q').period).toBe('qoq');
    expect(normalizeTitle('Inflation Rate MoM')).toEqual({ tokens: new Set(['cpi']), period: 'mom' });
  });
  it('refuses ambiguous matches', () => {
    const base = { source: 'tv' as const, currency: 'USD', country: 'US', ts: 1000, allDay: false, impact: 'High' as const, forecast: null, previous: null, actual: null, unit: null, scale: null, period: null };
    const f: RawEvent = { ...base, source: 'ff', extId: 'f', title: 'Speech' };
    const m = matchEvents([f], [
      { ...base, extId: 'a', title: 'Speech' },
      { ...base, extId: 'b', title: 'Speech' },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('values', () => {
  it('parses and formats numbers with units and scales', () => {
    expect(parseValue('0.3%')).toBe(0.3);
    expect(parseValue('20.0K')).toBe(20000);
    expect(parseValue('-105.6B')).toBeCloseTo(-105.6e9);
    expect(parseValue('197', 'K')).toBe(197000);
    expect(parseValue('n/a')).toBeNull();
    expect(formatTv('197', null, 'K')).toBe('197K');
    expect(formatTv('3.6', '%', null)).toBe('3.6%');
    expect(formatTv('-105.6', '$', 'B')).toBe('-105.6B $');
  });
});

describe('mergeCalendar', () => {
  const ts = Date.parse('2026-10-14T12:30:00Z');
  const ffEv: RawEvent = { source: 'ff', extId: 'f1', title: 'CPI m/m', currency: 'USD', country: null, ts, allDay: false, impact: 'High', forecast: '0.6%', previous: '0.4%', actual: null, unit: null, scale: null, period: null };
  const tvEv: RawEvent = { source: 'tv', extId: 't1', title: 'Inflation Rate MoM', currency: 'USD', country: 'US', ts, allDay: false, impact: 'High', forecast: '0.5', previous: '0.4', actual: '0.8', unit: '%', scale: null, period: 'Sep' };
  const tvNextWeek: RawEvent = { ...tvEv, extId: 't2', title: 'Retail Sales MoM', ts: ts + 7 * 86_400_000, impact: 'Medium', actual: null };
  const coverage = [ffWeekRange(ts)];

  it('uses FF in covered weeks with the TV actual, and TV elsewhere', () => {
    const out = mergeCalendar({ ff: [ffEv], tv: [tvEv, tvNextWeek], ffCoverage: coverage });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'ff', title: 'CPI m/m', actual: '0.8%', forecast: '0.6%', previous: '0.4%', matched: true, deviation: 0.3 });
    expect(out[1]).toMatchObject({ source: 'tv', title: 'Retail Sales MoM', impact: 'Medium', forecast: '0.5%' });
  });
  it('without FF coverage everything comes from TV', () => {
    const out = mergeCalendar({ ff: [ffEv], tv: [tvEv], ffCoverage: [] });
    expect(out.map((e) => e.source)).toEqual(['tv']);
  });
  it('ffWeekRange spans Sunday→Sunday in New York', () => {
    const r = ffWeekRange(Date.parse('2026-10-14T12:30:00Z'));
    expect(new Date(r.start).toISOString()).toBe('2026-10-11T04:00:00.000Z');
    expect(new Date(r.end).toISOString()).toBe('2026-10-18T04:00:00.000Z');
    const dst = ffWeekRange(Date.parse('2026-11-03T12:00:00Z')); // US DST ends 2026-11-01
    expect(new Date(dst.start).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(new Date(dst.end).toISOString()).toBe('2026-11-08T05:00:00.000Z');
  });
});

describe('CalendarService', () => {
  const now = Date.parse('2026-10-12T16:00:00Z');
  it('respects the FF hourly limit and backs off when rate limited', async () => {
    const db = new Db(':memory:');
    const svc = new CalendarService(db, silentLogger);
    expect(await svc.refreshForexFactory(now, async () => ff)).toBe(109);
    expect(await svc.refreshForexFactory(now + 30 * 60_000, async () => ff)).toBeNull(); // < 1h
    await expect(svc.refreshForexFactory(now + 61 * 60_000, async () => Promise.reject(new RateLimitedError('x')))).rejects.toThrow();
    expect(readJobData(db, FF_JOB, { blockedUntil: 0 }).blockedUntil).toBe(now + 61 * 60_000 + 60 * 60_000);
    expect(await svc.refreshForexFactory(now + 90 * 60_000, async () => ff)).toBeNull(); // still blocked
    db.close();
  });

  it('queries merged events with filters, custom events and explanations', async () => {
    const db = new Db(':memory:');
    const svc = new CalendarService(db, silentLogger);
    await svc.refreshForexFactory(now, async () => ff);
    await svc.refreshTradingView(now, async () => tv);
    const id = svc.addCustom({ title: 'ETH upgrade', ts: Date.parse('2026-10-15T10:00:00Z'), impact: 'High' });
    const from = Date.parse('2026-10-14T00:00:00Z');
    const to = Date.parse('2026-10-16T00:00:00Z');
    const events = svc.query({ from, to, impacts: ['High'], currencies: ['USD'] });
    expect(events.every((e) => e.ts >= from && e.ts < to)).toBe(true);
    expect(events.every((e) => e.source === 'custom' || (e.impact === 'High' && e.currency === 'USD'))).toBe(true);
    const cpi = events.find((e) => e.title === 'CPI m/m')!;
    expect(cpi.matched).toBe(true);
    expect(cpi.note).toMatch(/Inflația/);
    expect(events.find((e) => e.id === `custom:${id}`)).toMatchObject({ title: 'ETH upgrade', currency: 'CRYPTO' });
    expect(svc.deleteCustom(id)).toBe(true);
    expect(() => svc.addCustom({ title: '', ts: 1 })).toThrow();
    db.close();
  });

  it('replacing a week removes events that disappeared from the source', async () => {
    const db = new Db(':memory:');
    const svc = new CalendarService(db, silentLogger);
    await svc.refreshForexFactory(now, async () => ff);
    await svc.refreshForexFactory(now + 2 * 3600_000, async () => ff.slice(0, 10));
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM calendar_raw WHERE source = 'ff'")!.n).toBe(10);
    db.close();
  });
});

describe('glossary', () => {
  it('explains key events in Romanian, most specific first', () => {
    expect(explain('Core CPI m/m')).toMatch(/de bază/);
    expect(explain('ADP Non-Farm Employment Change')).toMatch(/ADP/);
    expect(explain('Non-Farm Employment Change')).toMatch(/NFP/);
    expect(explain('ECB Lane Speech')).toMatch(/Discurs/);
    expect(explain('Random thing')).toBeNull();
  });
});
