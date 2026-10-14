// What Claude reads to summarise a user's day (FD-SUMMARY §4, TD-SUMMARY §2), and the chart series it may choose
// from. Only Sentiq's own data about today: nothing is fetched from the internet here.
import { indexById, plainSymbol } from '../../shared/indices.ts';
import { dayBounds, dayKey } from '../../shared/time.ts';
import type { CalendarService } from '../calendar/service.ts';
import type { Db } from '../db/database.ts';
import type { EconIndicator, EconomyService } from '../economy/service.ts';
import { readContext } from '../market/context.ts';
import type { Scanner } from '../scanner/scanner.ts';
import type { DailySentimentService } from '../sentiment/daily.ts';
import type { SettingsService } from '../settings.ts';

const HOUR = 3_600_000;
const NEWS_IN_PROMPT = 40;

/** A chart the summary can show: the app's own numbers, never Claude's (FD-SUMMARY §2). */
export type SummaryChart =
  | {
      id: string;
      kind: 'line';
      title: string;
      unit: string | null;
      scale: string | null;
      /** A reference line (50 for the sentiment index). */
      baseline: number | null;
      points: { label: string; value: number }[];
      /** The forecast of the latest value (economic indicators). */
      forecast: number | null;
      /** 1 = higher is good, -1 = bad, 0 = neither: colours the last point. */
      polarity: number;
      caption?: string;
    }
  | {
      id: string;
      kind: 'bars';
      title: string;
      unit: string | null;
      baseline: number;
      bars: { label: string; value: number }[];
      polarity: number;
      caption?: string;
    };

export interface DayContext {
  day: string;
  tz: string;
  asOf: number;
  prompt: string;
  charts: Record<string, SummaryChart>;
}

export interface DayContextDeps {
  db: Db;
  settings: SettingsService;
  daily: DailySentimentService;
  calendar: CalendarService;
  economy: EconomyService;
  scanner: Scanner;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clock = (ts: number, tz: string) => new Intl.DateTimeFormat('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
const dateTime = (ts: number, tz: string) =>
  new Intl.DateTimeFormat('ro-RO', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
/** A value with its unit for the prompt ("3.4%", "197K", "14.2B €"). */
const withUnit = (v: number | null, unit: string | null, scale: string | null) => (v === null ? 'n/a' : `${r2(v)}${scale ?? ''}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`);
const sense = (p: number) => (p > 0 ? 'creșterea e bună' : p < 0 ? 'creșterea e rea' : 'neutru');

interface NewsRow {
  title: string;
  source: string;
  category: string;
  published_at: number;
  sentiment: number;
  impact: number;
  cluster_id: string;
  coins: string | null;
}

/** Today for this user, as text for Claude and as chart series for the page. */
export async function buildDayContext(deps: DayContextDeps, userId: number, now = Date.now()): Promise<DayContext> {
  const s = await deps.settings.forUser(userId);
  const tz = s.timezone;
  const day = dayKey(now, tz);
  const { start, end } = dayBounds(day, tz);
  const lines: string[] = [];
  const charts: Record<string, SummaryChart> = {};
  const add = (title: string, body: string[]) => {
    lines.push(`## ${title}`, ...(body.length ? body : ['(nimic)']), '');
  };

  // Time and markets.
  const market = await readContext(deps.db);
  const status = market.stocks.market;
  add('Momentul', [
    `Acum: ${dateTime(now, tz)} (fusul utilizatorului: ${tz}). Ziua analizată: ${day}, de la 00:00 până acum.`,
    status ? `Bursa SUA: ${status.label} (${status.state}).` : 'Bursa SUA: stare necunoscută.',
  ]);

  // Sentiment of the day.
  const today = await deps.daily.today(tz, now);
  const history = await deps.daily.history(7, tz, now);
  const counts = today.counts;
  add('Sentimentul zilei (0–100, 50 = neutru; calculat din toate știrile)', [
    `Index: ${today.index} (${today.confidence === 'high' ? 'încredere ridicată' : today.confidence === 'medium' ? 'încredere medie' : 'încredere scăzută'}); știri: ${counts.positive} pozitive, ${counts.neutral} neutre, ${counts.negative} negative, ${counts.pending} în analiză.`,
    `Pe categorii: ${Object.entries(today.breakdown)
      .filter(([, b]) => b.count > 0)
      .map(([k, b]) => `${k} ${b.index} (${b.count} știri)`)
      .join(', ')}.`,
    `Pe ore: ${today.intraday.map((p) => `${clock(p.t, tz)} ${p.index}`).join(', ')}.`,
    `Ultimele zile: ${history.map((h) => `${h.day} ${h.index}`).join(', ')}.`,
    'Știrile care trag cel mai mult în sus:',
    ...today.drivers.positive.map((d) => `- (+${r2(d.sentiment)}) ${d.title} [${d.source}]`),
    'Știrile care trag cel mai mult în jos:',
    ...today.drivers.negative.map((d) => `- (${r2(d.sentiment)}) ${d.title} [${d.source}]`),
  ]);
  if (today.intraday.length >= 2) {
    charts['sentiment-today'] = {
      id: 'sentiment-today',
      kind: 'line',
      title: 'Sentimentul zilei, pe ore',
      unit: null,
      scale: null,
      baseline: 50,
      points: today.intraday.map((p) => ({ label: clock(p.t, tz), value: p.index })),
      forecast: null,
      polarity: 1,
    };
  }
  if (history.length >= 2) {
    charts['sentiment-week'] = {
      id: 'sentiment-week',
      kind: 'line',
      title: 'Sentimentul ultimelor zile',
      unit: null,
      scale: null,
      baseline: 50,
      points: history.map((h) => ({ label: h.day.slice(5).split('-').reverse().join('.'), value: h.index })),
      forecast: null,
      polarity: 1,
    };
  }
  const subs = Object.entries(today.breakdown).filter(([, b]) => b.count > 0);
  const CAT: Record<string, string> = { crypto: 'Crypto', stocks: 'Acțiuni', macro: 'Macro', geopolitics: 'Geopolitică' };
  if (subs.length) {
    charts['sentiment-breakdown'] = {
      id: 'sentiment-breakdown',
      kind: 'bars',
      title: 'Sentimentul pe categorii',
      unit: null,
      baseline: 50,
      bars: subs.map(([k, b]) => ({ label: CAT[k] ?? k, value: b.index })),
      polarity: 1,
    };
  }

  // The day's most weighty news, one per story.
  const news = await deps.db.all<NewsRow>(
    `SELECT TOP (200) n.title, s.name AS source, n.category, n.published_at, n.sentiment, COALESCE(n.sentiment_impact, n.impact) AS impact, n.cluster_id,
            (SELECT STRING_AGG(coin, ',') FROM news_coins c WHERE c.news_id = n.id) AS coins
     FROM news n JOIN sources s ON s.id = n.source_id
     WHERE s.enabled = 1 AND n.published_at >= ? AND n.published_at <= ? AND n.relevance > 0 AND n.sentiment IS NOT NULL
     ORDER BY n.relevance * COALESCE(n.sentiment_impact, n.impact) * (0.3 + abs(n.sentiment)) DESC, n.published_at DESC, n.id`,
    [start, now],
  );
  const seen = new Set<string>();
  const picked = news.filter((n) => (seen.has(n.cluster_id) ? false : (seen.add(n.cluster_id), true))).slice(0, NEWS_IN_PROMPT);
  add(
    `Știrile importante de azi (${picked.length}, cele mai grele întâi; scor −1…+1, importanță 1–3)`,
    picked.map((n) => `- ${clock(n.published_at, tz)} [${n.category}${n.coins ? `; ${n.coins}` : ''}] (${r2(n.sentiment)}, imp. ${r1(n.impact)}) ${n.title} — ${n.source}`),
  );

  // Calendar: today so far, and the next 24 hours.
  const events = await deps.calendar.query({ userId, from: start, to: now + 24 * HOUR, impacts: ['High', 'Medium'] });
  const past = events.filter((e) => e.ts <= now);
  const coming = events.filter((e) => e.ts > now);
  // The user's own calendar notes (any impact) say so: they are reminders, not market data.
  const mark = (e: (typeof events)[number]) => (e.source === 'custom' ? ' (notat de utilizator)' : '');
  add(
    'Calendarul economic de azi, publicat deja (impact High / Medium)',
    past.map((e) => `- ${e.allDay ? 'toată ziua' : clock(e.ts, tz)} ${e.currency} [${e.impact}] ${e.title}${mark(e)}: actual ${e.actual ?? 'n/a'}, prognoză ${e.forecast ?? 'n/a'}, anterior ${e.previous ?? 'n/a'}`),
  );
  add(
    'Ce urmează în următoarele 24 de ore (impact High / Medium)',
    coming.map((e) => `- ${e.allDay ? dateTime(e.ts, tz).replace(/,? \d\d:\d\d$/, '') + ' (toată ziua)' : dateTime(e.ts, tz)} ${e.currency} [${e.impact}] ${e.title}${mark(e)}: prognoză ${e.forecast ?? 'n/a'}, anterior ${e.previous ?? 'n/a'}`),
  );

  // Economic indicators released today (the Economy page) and the important ones still due today.
  const view = await deps.economy.view(now);
  const all = view.countries.flatMap((c) => c.indicators.map((i) => ({ country: c.name, i })));
  const releasedToday = all.filter(({ i }) => i.latest.ts >= start && i.latest.ts <= now).sort((a, b) => Number(b.i.important) - Number(a.i.important));
  const dueToday = all.filter(({ i }) => i.important && i.next && !i.next.overdue && i.next.ts > now && i.next.ts < end);
  add(
    'Indicatori economici publicați azi (id grafic în paranteze)',
    releasedToday.slice(0, 40).map(({ country, i }) => {
      const id = `econ:${i.key}`;
      charts[id] = econChart(id, country, i);
      return `- [${id}] ${country}${i.countryName ? ` / ${i.countryName}` : ''}: ${i.name} (${i.original}), ${i.latest.period ?? ''}: ${withUnit(i.latest.value, i.unit, i.scale)}; anterior ${withUnit(i.previous, i.unit, i.scale)}; prognoză ${withUnit(i.latest.forecast, i.unit, i.scale)}; ${sense(i.polarity)}${i.important ? '; IMPORTANT' : ''}`;
    }),
  );
  add(
    'Indicatori importanți programați pentru restul zilei',
    dueToday.map(({ country, i }) => `- ${clock(i.next!.ts, tz)} ${country}: ${i.name} (${i.original}); ultima ${withUnit(i.latest.value, i.unit, i.scale)}; prognoză ${withUnit(i.next!.forecast, i.unit, i.scale)}`),
  );

  // Market context.
  const ctxLines: string[] = [];
  if (market.fearGreed) ctxLines.push(`Fear & Greed crypto: ${market.fearGreed.value} (${market.fearGreed.classification}).`);
  if (market.global) ctxLines.push(`Capitalizarea crypto: ${r1(market.global.totalMarketCapUsd / 1e12)} tril. USD; dominanța BTC ${r1(market.global.btcDominance)}%.`);
  if (market.stocks.fearGreed) ctxLines.push(`Fear & Greed acțiuni (CNN): ${r1(market.stocks.fearGreed.value)} (${market.stocks.fearGreed.rating}).`);
  for (const q of market.stocks.indices?.items ?? []) ctxLines.push(`${q.name}: ${r2(q.last)}${q.changePct !== null ? ` (${q.changePct >= 0 ? '+' : ''}${r2(q.changePct)}% față de ziua anterioară)` : ''}.`);
  add('Contextul pieței', ctxLines);

  // The user's favourites from the scanner.
  const scan = deps.scanner.result(userId);
  const rows = (scan?.rows ?? []).filter((row) => row.ok);
  add(
    `Favoritele utilizatorului (scanner Slingshot, timeframe ${s.scanner.tf})`,
    rows.map(
      (row) =>
        `- ${plainSymbol(row.coin)}${row.kind === 'stock' ? ' (acțiune)' : row.kind === 'index' ? ` (indice: ${indexById(row.coin)?.name ?? plainSymbol(row.coin)})` : ''}: preț ${row.price ?? 'n/a'}, 24h ${row.change24h === null || row.change24h === undefined ? 'n/a' : `${r2(row.change24h)}%`}, ${row.uptrend ? 'trend ascendent' : 'fără trend ascendent'}${row.liveSignal ? ', semnal LONG activ' : ''}${row.lastSignal ? `; ultimul semnal ${row.lastSignal.outcome}` : ''}`,
    ),
  );
  const movers = rows.filter((row) => typeof row.change24h === 'number');
  if (movers.length) {
    charts['favorites-24h'] = {
      id: 'favorites-24h',
      kind: 'bars',
      title: 'Favoritele: variația pe 24 h (%)',
      unit: '%',
      baseline: 0,
      bars: movers.map((row) => ({ label: plainSymbol(row.coin), value: r2(row.change24h as number) })),
      polarity: 1,
    };
  }

  add('Grafice disponibile (alege după situație)', Object.values(charts).map((c) => `- ${c.id}: ${c.title}`));
  return { day, tz, asOf: now, prompt: lines.join('\n'), charts };
}

function econChart(id: string, country: string, i: EconIndicator): SummaryChart {
  return {
    id,
    kind: 'line',
    title: `${country}${i.countryName ? ` / ${i.countryName}` : ''}: ${i.name}`,
    unit: i.unit,
    scale: i.scale,
    baseline: null,
    points: i.history.map(([period, value]) => ({ label: period ?? '', value })),
    forecast: i.latest.forecast,
    polarity: i.polarity,
  };
}
