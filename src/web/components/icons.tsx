// Relevant icons for everything the UI lists (FD-ICONS): coin logos, news topics, calendar events, Slingshot
// alerts and signal outcomes. Purely decorative for screen readers: the text next to them says it all.
import { useState } from 'react';
import { clsx } from 'clsx';
import {
  Ban,
  Banknote,
  Bitcoin,
  Blocks,
  BriefcaseBusiness,
  CalendarDays,
  CalendarOff,
  ChartCandlestick,
  ChartNoAxesCombined,
  ChartPie,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  Cpu,
  Crosshair,
  Factory,
  Fuel,
  Gavel,
  Gem,
  Globe,
  House,
  Landmark,
  OctagonX,
  Percent,
  ScrollText,
  ShieldAlert,
  Ship,
  ShoppingCart,
  Smile,
  Star,
  Swords,
  Target,
  TrendingUp,
  Vote,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  type LucideIcon,
} from 'lucide-react';
import { coinHue, eventKind, newsTopic, type EventKind, type NewsTopic } from '../icons.ts';

/** Tickers whose logo failed once in this page: shown as a badge from then on, without asking again. */
const failedLogos = new Set<string>();

/** The coin's real logo (served by /api/logo), or a badge with its initials in a stable colour. */
export function CoinLogo({ coin, size = 20, className }: { coin: string; size?: number; className?: string }) {
  const sym = coin.toUpperCase();
  const [failedNow, setFailedNow] = useState<string | null>(null);
  const valid = /^[A-Z0-9]{1,15}$/.test(sym);
  if (!valid || failedNow === sym || failedLogos.has(sym)) {
    const hue = coinHue(sym);
    return (
      <span
        className={clsx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * (sym.length > 2 ? 0.34 : 0.42))), background: `hsl(${hue} 40% 24%)`, color: `hsl(${hue} 75% 78%)` }}
        aria-hidden
      >
        {sym.slice(0, sym.length > 2 ? 3 : 2)}
      </span>
    );
  }
  return (
    <img
      src={`/api/logo/${sym}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={clsx('shrink-0 rounded-full', className)}
      onError={() => {
        failedLogos.add(sym);
        setFailedNow(sym);
      }}
    />
  );
}

const TOPIC_ICON: Record<Exclude<NewsTopic, 'coin'>, [LucideIcon, string]> = {
  hack: [ShieldAlert, 'text-bear'],
  'central-bank': [Landmark, 'text-brass'],
  inflation: [Percent, 'text-warn'],
  jobs: [BriefcaseBusiness, 'text-link'],
  etf: [ChartPie, 'text-link'],
  stablecoin: [CircleDollarSign, 'text-bull'],
  regulation: [Gavel, 'text-muted'],
  energy: [Fuel, 'text-warn'],
  war: [Swords, 'text-bear'],
  growth: [Factory, 'text-link'],
  gold: [Gem, 'text-brass'],
  bonds: [ScrollText, 'text-muted'],
  fx: [Banknote, 'text-bull'],
  politics: [Vote, 'text-muted'],
  earnings: [ChartCandlestick, 'text-link'],
  ai: [Cpu, 'text-link'],
  defi: [Blocks, 'text-brass'],
  crypto: [Bitcoin, 'text-brass'],
  macro: [ChartNoAxesCombined, 'text-muted'],
  geopolitics: [Globe, 'text-muted'],
};

export const TOPIC_LABEL: Record<NewsTopic, string> = {
  hack: 'hack sau fraudă',
  'central-bank': 'bănci centrale și dobânzi',
  inflation: 'inflație',
  jobs: 'piața muncii',
  etf: 'ETF-uri și fonduri',
  stablecoin: 'stablecoin',
  regulation: 'reglementare și justiție',
  energy: 'petrol și energie',
  war: 'conflict',
  growth: 'economie',
  gold: 'metale prețioase',
  bonds: 'obligațiuni și randamente',
  fx: 'dolar și valute',
  politics: 'politică',
  earnings: 'acțiuni și rezultate',
  ai: 'AI și tehnologie',
  defi: 'DeFi și rețele',
  coin: 'monedă',
  crypto: 'crypto',
  macro: 'macro',
  geopolitics: 'geopolitică',
};

/**
 * The icon of a news item: the coin's logo for a story about a coin, otherwise its topic in a small tile
 * (`boxed`) or bare.
 */
export function TopicIcon({
  title,
  summary,
  category,
  coins,
  size = 16,
  boxed = false,
}: {
  title: string;
  summary?: string | null;
  category?: string;
  coins?: readonly string[];
  size?: number;
  boxed?: boolean;
}) {
  const list = coins ?? [];
  const topic = newsTopic(title, summary, category ?? 'macro', list);
  const box = boxed ? Math.round(size * 1.9) : size;
  if (topic === 'coin' && list[0]) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={{ width: box, height: box }} title={TOPIC_LABEL.coin} aria-hidden>
        <CoinLogo coin={list[0]} size={boxed ? Math.round(size * 1.5) : size} />
      </span>
    );
  }
  const [Icon, tone] = TOPIC_ICON[topic === 'coin' ? 'crypto' : topic];
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center', boxed && 'rounded-[9px] bg-panel-2', tone)}
      style={{ width: box, height: box }}
      title={TOPIC_LABEL[topic]}
      aria-hidden
    >
      <Icon size={size} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

const EVENT_ICON: Record<EventKind, LucideIcon> = {
  inflation: Percent,
  jobs: BriefcaseBusiness,
  growth: ChartNoAxesCombined,
  manufacturing: Factory,
  retail: ShoppingCart,
  housing: House,
  'central-bank': Landmark,
  sentiment: Smile,
  trade: Ship,
  energy: Fuel,
  holiday: CalendarOff,
  custom: Star,
  other: CalendarDays,
};

export const EVENT_LABEL: Record<EventKind, string> = {
  inflation: 'inflație',
  jobs: 'piața muncii',
  growth: 'creștere economică',
  manufacturing: 'producție',
  retail: 'consum',
  housing: 'imobiliare',
  'central-bank': 'bancă centrală',
  sentiment: 'încredere',
  trade: 'comerț exterior',
  energy: 'energie',
  holiday: 'sărbătoare',
  custom: 'eveniment personal',
  other: 'eveniment',
};

export function EventIcon({ title, impact, source, size = 15, className }: { title: string; impact: string; source: string; size?: number; className?: string }) {
  const kind = eventKind(title, impact, source);
  const Icon = EVENT_ICON[kind];
  return (
    <span className={clsx('inline-flex shrink-0', className)} title={EVENT_LABEL[kind]} aria-hidden>
      <Icon size={size} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

const ALERT_ICON: Record<string, [LucideIcon, string]> = {
  longSignal: [TrendingUp, 'text-bull'],
  takeProfitSignal: [Target, 'text-bull'],
  atrTakeProfit: [Crosshair, 'text-bull'],
  atrStopLoss: [OctagonX, 'text-bear'],
  msBullish: [ArrowUpFromLine, 'text-bull'],
  msBearish: [ArrowDownToLine, 'text-bear'],
};

export function AlertIcon({ type, size = 15 }: { type: string; size?: number }) {
  const [Icon, tone] = ALERT_ICON[type] ?? [Activity, 'text-muted'];
  return <Icon size={size} strokeWidth={1.9} className={clsx('shrink-0', tone)} aria-hidden />;
}

const OUTCOME_ICON: Record<string, [LucideIcon, string]> = {
  tp: [CircleCheck, 'text-bull'],
  sl: [CircleX, 'text-bear'],
  invalidated: [Ban, 'text-bear'],
  active: [Activity, 'text-text'],
};

export function OutcomeIcon({ outcome, size = 14 }: { outcome: string; size?: number }) {
  const [Icon, tone] = OUTCOME_ICON[outcome] ?? [Activity, 'text-muted'];
  return <Icon size={size} strokeWidth={2} className={clsx('inline shrink-0 align-[-2px]', tone)} aria-hidden />;
}
