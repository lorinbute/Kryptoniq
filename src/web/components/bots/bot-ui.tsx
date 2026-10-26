// The small pieces the bot windows share (FD-BOT §1, §7): a labelled field, a box to tick, the status and the tags.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { STATUS_RO, STRATEGY_RO, type BotStatus, type BotView } from '../../../shared/bot.ts';
import { isDemoEnv } from '../../../shared/trading.ts';

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex min-w-0 flex-col gap-1 text-[13px]', className)}>
      <span className="text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

/** What the form shows but cannot change (as the order form's): text, not a disabled field. */
export function ReadOnly({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px]">
      <span className="text-faint">{label}</span>
      <span className="py-2 text-[13.5px] text-text">{children}</span>
    </div>
  );
}

/** A box to tick and its words: the box on the first line's middle, however the words wrap. */
export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex min-w-0 items-start gap-2.5 text-[13px]', disabled && 'opacity-55')}>
      <span className="flex h-[1lh] shrink-0 items-center">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** A part of the form, with its title. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATUS_TONE: Record<BotStatus, string> = {
  scheduled: 'bg-faint',
  running: 'bg-bull',
  paused: 'bg-warn',
  problem: 'bg-bear',
  ending: 'bg-warn',
  ended: 'bg-line-strong',
};

export function StatusMark({ status }: { status: BotStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted">
      <span className={clsx('inline-block size-2 rounded-full', STATUS_TONE[status])} aria-hidden />
      {STATUS_RO[status]}
    </span>
  );
}

/** The strategy, and SIMULARE / REAL (DEMO on a demo account). */
export function BotTags({ bot }: { bot: Pick<BotView, 'strategy' | 'exec' | 'account'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tag">{STRATEGY_RO[bot.strategy]}</span>
      {bot.exec === 'paper' ? (
        <span className="tag text-muted">SIMULARE</span>
      ) : (
        <span className="tag border-bear/50 text-bear">REAL</span>
      )}
      {bot.account && isDemoEnv(bot.account.env) && <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-warn">DEMO</span>}
    </span>
  );
}

/** A profit in the bot's currency, green or red. */
export function Pnl({ value, currency, className }: { value: number | null; currency: string; className?: string }) {
  if (value === null) return <span className={clsx('num text-faint', className)}>—</span>;
  const s = `${value > 0 ? '+' : value < 0 ? '−' : ''}${new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value))} ${currency}`;
  return <span className={clsx('num', value > 0 ? 'text-bull' : value < 0 ? 'text-bear' : 'text-muted', className)}>{s}</span>;
}
