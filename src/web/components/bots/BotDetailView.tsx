// A bot's page (FD-BOT §7): its status and numbers, what it can be asked (pause, resume, stop, edit, copy, delete), its
// open positions, the grid or the DCA cycle, the closed trades and the journal of its decisions.
import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, Copy, Pause, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { END_ACTION_RO, TRADE_REASON_RO, WEIGHT_RO, type BotDetail, type BotEndAction, type BotEventRow } from '../../../shared/bot.ts';
import { api, errorMessage } from '../../api.ts';
import { autoDigits, fmtDateTime, fmtNum, fmtPrice } from '../../format.ts';
import { useTz } from '../../hooks.ts';
import { BotTags, Pnl, StatusMark } from './bot-ui.tsx';
import { BOTS_KEY } from './BotFormView.tsx';

const price = (v: number | null) => (v === null ? '—' : fmtPrice(v, autoDigits(v)));
const qty = (v: number) => fmtNum(v, 8);

export function BotDetailView({ bot, onEdit, onCopy, onDeleted }: { bot: BotDetail; onEdit: () => void; onCopy: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const tz = useTz();
  const [stopping, setStopping] = useState(false);
  const act = useMutation({
    mutationFn: async (a: { kind: 'pause' | 'resume' } | { kind: 'stop'; action: BotEndAction } | { kind: 'delete' }) => {
      if (a.kind === 'delete') return api.del<{ ok: true }>(`/api/bots/${bot.id}`);
      return api.post<BotDetail>(`/api/bots/${bot.id}/${a.kind}`, a.kind === 'stop' ? { action: a.action } : {});
    },
    onSuccess: (r, a) => {
      void qc.invalidateQueries({ queryKey: BOTS_KEY });
      setStopping(false);
      if (a.kind === 'delete') onDeleted();
      else qc.setQueryData(['bots', bot.id], r);
    },
  });
  const ended = bot.status === 'ended';
  const winRate = bot.trades > 0 ? (bot.wins / bot.trades) * 100 : null;
  const cur = bot.currency;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BotTags bot={bot} />
        <StatusMark status={bot.status} />
        <span className="text-[12.5px] text-muted">
          {bot.symbols.join(', ')}
          {bot.strategy === 'premium' ? ` · ${bot.tf}` : ''}
          {bot.account ? ` · ${bot.account.label}` : bot.exec === 'real' ? ' · cont șters' : ''}
        </span>
      </div>
      {bot.statusReason && (
        <p className={clsx('rounded-[10px] border px-3 py-2.5 text-[13px]', bot.status === 'problem' ? 'border-bear/40 bg-bear/[0.07]' : 'border-line bg-panel-2')} role={bot.status === 'problem' ? 'alert' : undefined}>
          {bot.statusReason}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-faint">Angajat</dt>
          {/* The maximum goes under the amount when the column is narrow (a phone). */}
          <dd className="flex flex-wrap gap-x-1">
            <span className="num">{fmtNum(bot.committed, 2)}</span>
            <span className="num text-faint">
              / {fmtNum(bot.maxAmount, 2)} {cur}
            </span>
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-faint">Realizat</dt>
          <dd>
            <Pnl value={bot.realized} currency={cur} />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-faint">Nerealizat</dt>
          <dd>
            <Pnl value={bot.unrealized} currency={cur} />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-faint">Tranzacții</dt>
          <dd className="num">
            {bot.trades}
            {winRate !== null && <span className="text-faint"> · {fmtNum(winRate, 0)}% câștigate</span>}
          </dd>
        </div>
      </dl>
      <p className="text-[12px] text-faint">
        {bot.ranAt ? `Ultima verificare: ${fmtDateTime(bot.ranAt, tz)}` : 'Nicio verificare încă: botul se uită la piață o dată la 30 de secunde, pe server.'}
        {bot.endsAt !== null && !ended ? ` · Se termină: ${fmtDateTime(bot.endsAt, tz)} (${END_ACTION_RO[bot.input.endAction].toLowerCase()})` : ''}
      </p>

      <div className="flex flex-wrap gap-2">
        {(bot.status === 'running' || bot.status === 'scheduled') && (
          <button className="btn" disabled={act.isPending} onClick={() => act.mutate({ kind: 'pause' })}>
            <Pause size={15} aria-hidden /> Pauză
          </button>
        )}
        {(bot.status === 'paused' || bot.status === 'problem') && (
          <button className="btn" disabled={act.isPending} onClick={() => act.mutate({ kind: 'resume' })}>
            <Play size={15} aria-hidden /> Reia
          </button>
        )}
        {!ended && (
          <button className="btn" disabled={act.isPending} onClick={() => setStopping(true)}>
            <Square size={14} aria-hidden /> Oprește
          </button>
        )}
        {!ended && (
          <button className="btn" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Editează
          </button>
        )}
        <button className="btn" onClick={onCopy}>
          <Copy size={14} aria-hidden /> Duplică
        </button>
        {ended && (
          <button className="btn btn-danger" disabled={act.isPending} onClick={() => act.mutate({ kind: 'delete' })}>
            <Trash2 size={14} aria-hidden /> Șterge
          </button>
        )}
      </div>
      {stopping && (
        // Inline, not a second window: Esc and the focus stay with the bot's window.
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel-2 px-4 py-3.5 text-[13.5px]">
          <p>Ce face botul cu pozițiile lui?</p>
          <div className="flex flex-wrap gap-2">
            {(bot.strategy === 'grid' ? (['close', 'leave'] as const) : (['finish', 'close', 'leave'] as const)).map((a) => (
              <button key={a} className={clsx('btn', a === 'close' && 'btn-danger')} disabled={act.isPending} onClick={() => act.mutate({ kind: 'stop', action: a })}>
                {END_ACTION_RO[a]}
              </button>
            ))}
            <button className="btn" disabled={act.isPending} onClick={() => setStopping(false)}>
              Renunță
            </button>
          </div>
        </div>
      )}
      {act.error && (
        <p role="alert" className="text-[13px] text-bear">
          {errorMessage(act.error)}
        </p>
      )}

      <Block title={`Poziții deschise (${bot.positions.length})`}>
        {bot.positions.length === 0 ? (
          <p className="text-[13px] text-muted">Nicio poziție deschisă.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="table [&_td]:align-middle">
              <thead>
                <tr>
                  <th>Simbol</th>
                  <th>Latura</th>
                  <th className="text-right">Cantitate</th>
                  <th className="text-right">Intrare</th>
                  <th className="text-right">Preț</th>
                  <th className="text-right">SL / TP</th>
                  <th className="text-right">Nerealizat</th>
                </tr>
              </thead>
              <tbody>
                {bot.positions.map((p) => (
                  <tr key={`${p.symbol}-${p.side}`}>
                    <td className="num">{p.symbol}</td>
                    <td className={p.side === 'long' ? 'text-bull' : 'text-bear'}>
                      {p.side}
                      {p.leverage > 1 ? ` ${p.leverage}×` : ''}
                    </td>
                    <td className="num text-right">{qty(p.qty)}</td>
                    <td className="num text-right">{price(p.entry)}</td>
                    <td className="num text-right">{price(p.price)}</td>
                    <td className="num text-right">
                      {price(p.sl)} / {price(p.tp)}
                    </td>
                    <td className="text-right">
                      <Pnl value={p.unrealized} currency={cur} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      {bot.grid && (
        <Block title={bot.grid.armed ? `Grila așteaptă prețul de pornire (${price(bot.grid.trigger)})` : `Grila: ${bot.grid.slots.filter((s) => s.entry !== null).length} din ${bot.grid.slots.length} intervale pline, ${qty(bot.grid.qty)} pe interval`}>
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="table [&_td]:align-middle">
              <thead>
                <tr>
                  <th>Interval</th>
                  <th>Latura</th>
                  <th>Stare</th>
                  <th className="text-right">Intrare</th>
                </tr>
              </thead>
              <tbody>
                {bot.grid.slots
                  .map((s, i) => ({ s, i }))
                  .reverse()
                  .map(({ s, i }) => (
                    <tr key={i}>
                      <td className="num">
                        {price(bot.grid?.lines[i] ?? null)} – {price(bot.grid?.lines[i + 1] ?? null)}
                      </td>
                      <td className={s.side === 'long' ? 'text-bull' : 'text-bear'}>{s.side}</td>
                      <td className={s.entry !== null ? 'text-text' : 'text-faint'}>{s.entry !== null ? 'plin' : 'gol'}</td>
                      <td className="num text-right">{price(s.entry)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {bot.dca && (
        <Block title={bot.dca.deal ? `Ciclul ${bot.dca.cycle}: ${bot.dca.deal.filled} ordine de siguranță executate` : bot.dca.cooldownUntil ? `Pauză între cicluri, până la ${fmtDateTime(bot.dca.cooldownUntil, tz)}` : `Niciun ciclu deschis (${bot.dca.cycle} până acum)`}>
          {bot.dca.deal && (
            <div className="flex flex-col gap-2 text-[13px]">
              <p className="text-muted">
                Preț de bază <span className="num text-text">{price(bot.dca.deal.basePrice)}</span> · preț mediu <span className="num text-text">{price(bot.dca.deal.avg)}</span> · take profit <span className="num text-bull">{price(bot.dca.deal.tp)}</span>
                {bot.dca.deal.sl !== null && (
                  <>
                    {' '}
                    · stop loss <span className="num text-bear">{price(bot.dca.deal.sl)}</span>
                  </>
                )}
              </p>
              {bot.dca.deal.next.length > 0 && (
                <p className="text-muted">
                  Urmează:{' '}
                  {bot.dca.deal.next.map((n, i) => (
                    <Fragment key={n.k}>
                      {i > 0 && ', '}
                      <span className="num text-text">{price(n.price)}</span> ({fmtNum(n.amount, 2)} {cur})
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          )}
        </Block>
      )}

      <Block title={`Tranzacții încheiate (${bot.trades})`}>
        {bot.history.length === 0 ? (
          <p className="text-[13px] text-muted">Niciuna încă.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="table [&_td]:align-middle">
              <thead>
                <tr>
                  <th>Închisă</th>
                  <th>Simbol</th>
                  <th>Latura</th>
                  <th className="text-right">Intrare</th>
                  <th className="text-right">Ieșire</th>
                  <th className="text-right">Câștig</th>
                  <th>Motiv</th>
                </tr>
              </thead>
              <tbody>
                {bot.history.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(t.closedAt, tz)}</td>
                    <td className="num">{t.symbol}</td>
                    <td className={t.side === 'long' ? 'text-bull' : 'text-bear'}>{t.side}</td>
                    <td className="num text-right">{price(t.entry)}</td>
                    <td className="num text-right">{price(t.exit)}</td>
                    <td className="text-right">
                      <Pnl value={t.pnl} currency={cur} />
                    </td>
                    <td className="text-muted">{TRADE_REASON_RO[t.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <Block title="Jurnalul">
        {bot.events.length === 0 ? <p className="text-[13px] text-muted">Nimic încă.</p> : <Journal events={bot.events} tz={tz} />}
      </Block>

    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-[13.5px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const KIND_TONE: Partial<Record<BotEventRow['kind'], string>> = { enter: 'text-bull', exit: 'text-accent', problem: 'text-bear', skip: 'text-muted', signal: 'text-muted' };

/** A part of the score: on the market's scale, the side it favours (FD-BOTDIR); before it, the agreement with the trade. */
function Lean({ a, market }: { a: number; market: boolean }) {
  const n = <span className={clsx('num', a > 0.05 ? 'text-bull' : a < -0.05 ? 'text-bear' : 'text-text')}>{fmtNum(market ? Math.abs(a) : a, 2)}</span>;
  if (!market) return <>acord {n}</>;
  // What rounds to 0,00 leans nowhere.
  return Math.abs(a) < 0.005 ? <>neutru</> : <>{a > 0 ? 'spre long' : 'spre short'} {n}</>;
}

/** The decisions, newest first; a refused or taken signal opens to show its score part by part. */
function Journal({ events, tz }: { events: BotEventRow[]; tz: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="rows flex flex-col overflow-hidden rounded-[10px] border border-line text-[13px]">
      {events.map((e) => {
        const score = e.detail?.score;
        const ai = e.detail?.ai;
        const more = Boolean(score || ai);
        const shown = open === e.id;
        return (
          <li key={e.id} className="px-3 py-2">
            <div className="flex items-start gap-2">
              {/* The arrow on the first line's middle, however the message wraps. */}
              <span className="flex h-[1lh] w-3.5 shrink-0 items-center">
                {more && (
                  <button type="button" className="text-faint hover:text-text" aria-expanded={shown} aria-label={shown ? 'Ascunde scorul' : 'Arată scorul'} onClick={() => setOpen(shown ? null : e.id)}>
                    {shown ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  </button>
                )}
              </span>
              {/* On a phone the time goes above the message (the row is too narrow for both). */}
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-2">
                <span className="num shrink-0 text-faint">{fmtDateTime(e.at, tz)}</span>
                <span className={clsx('min-w-0 break-words', KIND_TONE[e.kind] ?? 'text-text')}>
                  {e.symbol && <span className="num text-faint">{e.symbol} · </span>}
                  {e.message}
                </span>
              </span>
            </div>
            {shown && (
              <div className="mt-2 ml-5.5 flex flex-col gap-1.5 text-[12.5px] text-muted">
                {score && (
                  <>
                    {/* FD-BOTDIR: the market's score with the side's threshold; the events before it keep the trade's score. */}
                    {score.limit ? (
                      <span>
                        Scorul pieței <span className="num text-text">{fmtNum(score.score, 1)}</span> ({score.limit.side === 'long' ? `long de la ${score.limit.value}` : `short până la ${score.limit.value}`})
                      </span>
                    ) : (
                      <span>
                        Scorul tranzacției <span className="num text-text">{fmtNum(score.score, 1)}</span> (minim {score.min}; calculul de dinainte de pragurile pe direcții: peste 50 în favoarea tranzacției)
                      </span>
                    )}
                    <ul className="flex flex-col gap-0.5">
                      {score.parts.map((p) => (
                        <li key={p.key}>
                          {WEIGHT_RO[p.key]}: {p.value === null ? 'fără date' : p.key === 'slingshot' ? p.note : `${fmtNum(p.value, 0)} (${p.note})`} · <Lean a={p.a} market={Boolean(score.limit)} /> · pondere {p.weight}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {ai && (
                  <span>
                    AI: {ai.decision === 'enter' ? 'intră' : 'nu intra'} ({ai.confidence}%) — {ai.reason}
                    {ai.risks.length > 0 ? ` Riscuri: ${ai.risks.join('; ')}.` : ''}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
