// What a Slingshot Premium decision reads besides the chart (FD-BOT §6): the day's index, the area's, the last 7 days',
// the symbol's own news, the high-impact events ahead; and the AI's look at all of it, when the user wants it.
import { z } from 'zod';
import type { BotAiVerdict, BotArea, BotScore, BotSide } from '../../shared/bot.ts';
import { WEIGHT_RO } from '../../shared/bot.ts';
import type { Timeframe } from '../../shared/time.ts';
import type { AiService } from '../ai/service.ts';
import { aiErrorLine, describeAiError } from '../ai/types.ts';
import type { CalendarService } from '../calendar/service.ts';
import type { CalendarEvent } from '../calendar/merge.ts';
import type { Logger } from '../log.ts';
import { computeIndex, confidenceFor } from '../sentiment/daily-index.ts';
import type { DailySentimentService } from '../sentiment/daily.ts';
import type { ScoreInputs } from './score.ts';

const HOUR = 3_600_000;

export interface MarketMood {
  day: ScoreInputs['day'];
  area: ScoreInputs['area'];
  general: number | null;
  /** The day's strongest reasons, both ways (titles), for the AI. */
  drivers: string[];
}

/** The day, the area and the last 7 days, as the user sees them (their AI's scores, their time zone). */
export async function readMood(daily: DailySentimentService, userId: number, tz: string, area: BotArea, now: number): Promise<MarketMood> {
  const scope = await daily.scopeFor(userId);
  const today = await daily.today(tz, now, scope);
  const sub = today.breakdown[area === 'stocks' ? 'stocks' : 'crypto'];
  const history = await daily.history(7, tz, now, scope);
  const counted = today.counts.positive + today.counts.neutral + today.counts.negative;
  return {
    day: counted > 0 ? { index: today.index, confidence: today.confidence } : null,
    area: sub && sub.count > 0 ? { index: sub.index, count: sub.count } : null,
    general: history.length ? history.reduce((a, h) => a + h.index, 0) / history.length : null,
    drivers: [...today.drivers.positive.slice(0, 4), ...today.drivers.negative.slice(0, 4)].map((d) => `${d.sentiment >= 0 ? '+' : '−'} ${d.title}`),
  };
}

export interface SymbolNews {
  score: ScoreInputs['symbol'];
  /** The most important headlines of the last 24 h, with their score (−1…+1). */
  headlines: { title: string; sentiment: number | null }[];
}

/** The symbol's own news of the last 24 h, as one index (the day's formula). */
export async function readSymbolNews(daily: DailySentimentService, userId: number, coin: string, now: number): Promise<SymbolNews> {
  const scope = await daily.scopeFor(userId);
  const items = await daily.coinItems(coin, now - 24 * HOUR, now + 1, scope);
  const r = computeIndex(items, { start: now - 24 * HOUR, end: now + 1 }, now);
  const count = r.counts.positive + r.counts.neutral + r.counts.negative;
  const headlines = items
    .filter((i) => i.relevance > 0)
    .sort((a, b) => b.impact - a.impact || b.publishedAt - a.publishedAt)
    .slice(0, 10)
    .map((i) => ({ title: i.title, sentiment: i.sentiment }));
  return { score: count > 0 ? { index: r.index, confidence: confidenceFor(r.weight), count } : null, headlines };
}

/** High-impact US events from `from` to `to` (FD-BOT §6: the dollar's moves both coins and shares). */
export async function highImpact(calendar: CalendarService, userId: number, from: number, to: number): Promise<CalendarEvent[]> {
  const events = await calendar.query({ userId, from, to, impacts: ['High'], currencies: ['USD'], earnings: false });
  return events.filter((e) => !e.allDay && e.impact === 'High' && e.ts >= from && e.ts < to);
}

const verdictSchema = z.object({
  decision: z.enum(['enter', 'skip']),
  confidence: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(600),
  risks: z.array(z.string().max(200)).max(5),
});

const SYSTEM = `Ești gestionarul de risc al unui bot de tranzacționare. Botul a primit un semnal Slingshot și regulile lui l-au aprobat. Tu decizi dacă intră acum sau nu.

Reguli:
- Răspunzi doar „enter” (intră) sau „skip” (nu intra), cu încrederea 0–100.
- Un motiv concret pentru „skip”: știrile simbolului contrazic semnalul, un eveniment important e foarte aproape, sentimentul s-a întors brusc.
- Nu judeca stop loss-ul, take profit-ul sau raportul risc / câștig: le stabilește strategia.
- Fără un motiv concret, lași regulile să decidă: „enter”.
- „reason”: o singură frază în română, despre acest semnal.
- „risks”: cel mult 5 riscuri scurte, în română.
- Nu inventa date: folosește doar ce primești.`;

export interface AiAsk {
  symbol: string;
  side: BotSide;
  tf: Timeframe;
  price: number;
  sl: number;
  tp: number;
  /** Where the levels come from: the signal's both, or the user's percents from the entry (FD-BOTSLRR, FD-BOTPCT; no R:R). */
  levels: 'slingshot' | 'percent';
  trend: 'up' | 'down';
  structure: string;
  score: BotScore;
  mood: MarketMood;
  news: SymbolNews;
  events: CalendarEvent[];
  /** The bot's last results, in percent of the amount used (no sums: FD-AICLARITY). */
  recent: number[];
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(5));

export function aiPrompt(x: AiAsk, now: number): string {
  const lines = [
    `Simbol: ${x.symbol}, timeframe ${x.tf}, semnal ${x.side.toUpperCase()}.`,
    `Preț acum: ${fmt(x.price)}. Stop loss: ${fmt(x.sl)}. Take profit: ${fmt(x.tp)} (${x.levels === 'slingshot' ? 'ale semnalului Slingshot' : 'procentele utilizatorului de la intrare'}).`,
    `Trend (EMA): ${x.trend === 'up' ? 'în sus' : 'în jos'}. Structura pieței: ${x.structure}.`,
    // FD-BOTDIR: the market's score; the side's threshold says which way the bot reads it.
    `Scorul pieței (0–100, 50 neutru; peste 50 favorizează long-ul, sub 50 short-ul): ${x.score.score}.${x.score.limit ? ` Un ${x.side.toUpperCase()} intră ${x.side === 'long' ? 'de la' : 'până la'} ${x.score.limit.value}.` : ''}`,
    ...x.score.parts.map((p) => `- ${WEIGHT_RO[p.key]}: ${p.value === null ? 'fără date' : p.key === 'slingshot' ? p.note : `${Math.round(p.value)} (${p.note})`}, pondere ${p.weight}.`),
    `Motivele zilei (+ pozitive, − negative):`,
    ...(x.mood.drivers.length ? x.mood.drivers.map((d) => `- ${d}`) : ['- niciunul']),
    `Știrile simbolului din ultimele 24 h (scor −1…+1):`,
    ...(x.news.headlines.length ? x.news.headlines.map((h) => `- ${h.sentiment === null ? 'fără scor' : h.sentiment.toFixed(2)}: ${h.title}`) : ['- niciuna']),
    `Evenimente cu impact mare (USD) în următoarele 24 h:`,
    ...(x.events.length ? x.events.map((e) => `- peste ${Math.max(0, Math.round((e.ts - now) / 60_000))} min: ${e.title}`) : ['- niciunul']),
    `Ultimele rezultate ale botului (% din suma folosită): ${x.recent.length ? x.recent.map((r) => `${r >= 0 ? '+' : ''}${r.toFixed(1)}%`).join(', ') : 'niciunul'}.`,
  ];
  return lines.join('\n');
}

/** The AI's answer, or the reason it gave none (no key, a refusal, an error). */
export async function askAi(ai: AiService, log: Logger, userId: number, x: AiAsk, now: number): Promise<{ verdict: BotAiVerdict } | { error: string }> {
  const cfg = await ai.config(userId);
  if (!cfg.key) return { error: 'Nu e pusă nicio cheie AI (Setări → AI).' };
  try {
    const answer = await ai.client(cfg.provider, cfg.key, cfg.model).generate({
      system: SYSTEM,
      prompt: `${aiPrompt(x, now)}\n\nIntră botul acum?`,
      schema: verdictSchema,
      name: 'bot_verdict',
      maxTokens: 4000,
      effort: 'low',
      timeoutMs: 60_000,
    });
    if (answer.usage) await ai.usage.record(userId, 'bot', { input: answer.usage.input, output: answer.usage.output, model: cfg.model });
    if (!answer.parsed) return { error: answer.stop === 'refusal' ? 'AI-ul a refuzat să răspundă.' : 'Răspunsul AI-ului nu a putut fi citit.' };
    return { verdict: answer.parsed };
  } catch (err) {
    log.warn(`bot: ${cfg.provider} failed (${aiErrorLine(err)})`);
    return { error: `AI-ul nu a răspuns: ${describeAiError(err)}.` };
  }
}
