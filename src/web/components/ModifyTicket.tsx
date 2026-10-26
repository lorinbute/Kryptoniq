// FD-ORDEREDIT: changing an open order, or a position's stop loss / take profit. The form (with what each level does to
// the PnL), "Verifică" (the server reads the orders again, rounds, checks and plans how each change goes out), the
// confirmation (old → new, how, the warnings), "Confirmă și trimite", the result of each request. The chart's dragged
// lines go through the same check and send.
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { orderEditFields, type ModifyChange, type ModifyHow, type ModifyPreview, type ModifyResult, type ModifyStepPlan, type ModifyTicket as Ticket, type TradeMarket } from '../../shared/trading.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { pnlImpact, type PnlBasis } from '../chart/pnl.ts';
import { Modal } from './Modal.tsx';
import { DemoBadge, TRADING_KEY, TRADING_LOG_KEY, uuid } from './OrderTicket.tsx';
import { stepImpact, type ModifySeed } from './modify-seeds.ts';
import { settlePortfolio } from '../portfolio-settle.ts';

export const HOW_RO: Record<ModifyHow, string> = {
  amend: 'modificare directă',
  position: 'direct pe poziție',
  place: 'ordin nou',
  cancel: 'anulare',
  'place-then-cancel': 'ordin nou, apoi anularea celui vechi',
  'cancel-then-place': 'anularea celui vechi, apoi ordin nou',
};
const STATUS_RO: Record<ModifyResult['status'], string> = { done: 'Modificat', partial: 'Modificat în parte', failed: 'Nu s-a modificat', unknown: 'Rezultat necunoscut' };

const parseNum = (s: string): number | undefined => {
  const v = Number(s.replace(',', '.').trim());
  return s.trim() !== '' && Number.isFinite(v) && v > 0 ? v : undefined;
};
const plain = (v: number | null | undefined, d = 8) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Number(v.toFixed(d))));
const FIELDS = ['triggerPrice', 'price', 'stopLoss', 'takeProfit', 'amount'] as const;
const FIELD_RO: Record<(typeof FIELDS)[number], string> = { triggerPrice: 'Declanșare', price: 'Preț', stopLoss: 'Stop loss', takeProfit: 'Take profit', amount: 'Cantitate' };

/**
 * "Stop loss 57000 → 58000" for a step: what it changes, before and after. A position's SL / TP is named so whatever
 * value of its order it is (a trigger, a limit price); a new order has only its values.
 */
export function stepLines(s: ModifyStepPlan, market?: TradeMarket): { label: string; before?: number | null; after: number | null }[] {
  const protect = s.kind === 'sl' || s.kind === 'tp';
  const fresh = s.orderId === null;
  const label = (f: (typeof FIELDS)[number]) =>
    protect && (f === 'triggerPrice' || f === 'price') ? (s.kind === 'sl' ? 'Stop loss' : 'Take profit') : f === 'amount' && market === 'futures' ? 'Cantitate (contracte)' : FIELD_RO[f];
  const out = FIELDS.filter((f) => (fresh ? s.after[f] !== null : s.before[f] !== s.after[f])).map((f) => ({ label: label(f), ...(fresh ? {} : { before: s.before[f] }), after: s.after[f] }));
  return out.length ? out : [{ label: s.kind === 'sl' ? 'Stop loss' : s.kind === 'tp' ? 'Take profit' : 'Ordin', after: null }];
}

/**
 * The check and the send, with one key per version of the changes: the same changes sent twice go out once, a changed
 * one is a new action. The send takes the ticket the check gave back (with its key).
 */
export function useModifySend(accountId: number) {
  const qc = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const keyFor = (body: object) => {
    const k = JSON.stringify(body);
    if (!keys.current.has(k)) keys.current.set(k, uuid());
    return keys.current.get(k) as string;
  };
  // A refusal that found trading off (or switched it off): the page reads the switch again.
  const onError = (err: Error) => {
    if (err instanceof ApiError && (err.code === 'PERMISSION' || err.code === 'DISABLED')) {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: TRADING_KEY });
    }
  };
  const check = useMutation({ mutationFn: (b: Omit<Ticket, 'idemKey'>) => api.post<ModifyPreview>(`/api/trading/${accountId}/modify/preview`, { ...b, idemKey: keyFor(b) }), onError });
  const send = useMutation({
    mutationFn: (t: Ticket) => api.post<ModifyResult>(`/api/trading/${accountId}/modify`, t),
    onError,
    onSettled: () => {
      settlePortfolio(qc, accountId);
      void qc.invalidateQueries({ queryKey: TRADING_LOG_KEY });
    },
  });
  /** After a send: the same changes made again are a new action, not this one given back. */
  const fresh = () => keys.current.clear();
  return { check, send, fresh };
}

/** The confirmation: each change (old → new, how it goes out), the warnings, the errors. */
export function ModifyConfirm({ preview, impact }: { preview: ModifyPreview; impact?: (s: ModifyStepPlan) => string | null }) {
  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      <ul className="flex flex-col gap-2">
        {preview.steps.map((s, i) => (
          <li key={i} className="rounded-[10px] border border-line bg-panel-2 px-3 py-2">
            {stepLines(s, preview.ticket.market).map((l) => (
              <div key={l.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-faint">{l.label}</span>
                <span className="num text-text">
                  {l.before !== undefined && <>{plain(l.before)} → </>}
                  {s.removes ? <span className="text-bear">șters</span> : <span className="font-semibold">{plain(l.after)}</span>}
                </span>
              </div>
            ))}
            <div className="mt-1 text-[12px] text-faint">{HOW_RO[s.how]}</div>
            {/* Wraps on a phone (the figures stay mono). */}
            {impact?.(s) && <div className="num mt-0.5 text-[12px] whitespace-normal text-muted">PnL: {impact(s)}</div>}
          </li>
        ))}
      </ul>
      {preview.last !== null && (
        <div className="text-[12.5px] text-faint">
          Prețul de acum: <span className="num text-text">{plain(preview.last)}</span>
        </div>
      )}
      {preview.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-[10px] border border-warn/40 bg-warn/[0.06] px-3 py-2.5 text-[12.5px]">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {preview.errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
          {preview.errors.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What came back: overall (in the action's own words, `labels`), then each request. */
export function ModifyOutcome({ result, labels }: { result: ModifyResult; labels?: Partial<Record<ModifyResult['status'], string>> }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px]">
      <div className={clsx('flex items-center gap-2 font-semibold', result.status === 'done' ? 'text-bull' : result.status === 'failed' ? 'text-bear' : 'text-warn')}>
        {result.status === 'done' && <CheckCircle2 size={16} aria-hidden />}
        {labels?.[result.status] ?? STATUS_RO[result.status]}
      </div>
      <ul className="flex flex-col gap-1 text-[12.5px]">
        {result.steps.map((s, i) => (
          <li key={i} className={s.ok ? 'text-muted' : 'text-bear'}>
            {s.ok ? '✓' : '✗'} {s.what}
            {s.orderId ? <span className="num text-faint"> ({s.orderId})</span> : null}
            {s.message ? <div className="text-[12px]">{s.message}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LevelField({ label, value, onChange, removed, onRemove, canRemove, impact, id }: { label: string; value: string; onChange: (v: string) => void; removed: boolean; onRemove: (v: boolean) => void; canRemove: boolean; impact: string; id: string }) {
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <label htmlFor={id} className="text-faint">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input id={id} inputMode="decimal" className="num min-w-0 flex-1" value={removed ? '' : value} placeholder={removed ? 'șters' : '—'} disabled={removed} onChange={(e) => onChange(e.target.value)} />
        {canRemove && (
          <button type="button" className={clsx('btn h-9 shrink-0 px-2 text-[12px]', removed && 'btn-primary')} aria-pressed={removed} onClick={() => onRemove(!removed)} title={removed ? 'Păstrează' : 'Șterge'}>
            {removed ? 'Păstrează' : (<><X size={13} aria-hidden /> Șterge</>)}
          </button>
        )}
      </div>
      {impact && <span className="num text-[12px] whitespace-normal text-muted">{impact}</span>}
    </div>
  );
}

export function ModifyTicket({ seed, onClose }: { seed: ModifySeed; onClose: () => void }) {
  const { check, send } = useModifySend(seed.account.id);
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [preview, setPreview] = useState<ModifyPreview | null>(null);
  const [result, setResult] = useState<ModifyResult | null>(null);

  // A position's stop losses / take profits: each order its row; a missing one can be added.
  const initialRows = () => {
    if (seed.kind !== 'protection') return [];
    const rows = seed.rows.map((r) => ({ ...r, text: r.level === null ? '' : plain(r.level), removed: false }));
    if (seed.add) for (const what of ['sl', 'tp'] as const) if (!rows.some((r) => r.what === what)) rows.push({ what, orderId: null, level: null, basis: seed.basis, text: '', removed: false });
    return rows;
  };
  const [rows, setRows] = useState(initialRows);
  // An order's fields.
  const order = seed.kind === 'order' ? seed.order : null;
  const fields = order ? orderEditFields(seed.account.exchange, order) : null;
  const [f, setF] = useState(() => ({
    price: plain(order?.price ?? null).replace('—', ''),
    triggerPrice: plain(order?.triggerPrice ?? null).replace('—', ''),
    amount: plain(order?.amount ?? null).replace('—', ''),
    takeProfit: plain(order?.takeProfit ?? null).replace('—', ''),
    stopLoss: plain(order?.stopLoss ?? null).replace('—', ''),
    tpRemoved: false,
    slRemoved: false,
  }));

  const changes = (): ModifyChange[] => {
    if (seed.kind === 'protection') {
      const out: ModifyChange[] = [];
      for (const r of rows) {
        const v = parseNum(r.text);
        if (r.orderId === null) {
          if (v !== undefined) out.push({ what: r.what, orderId: null, level: v });
        } else if (r.removed) out.push({ what: r.what, orderId: r.orderId, level: null });
        else if (v !== undefined && v !== r.level) out.push({ what: r.what, orderId: r.orderId, level: v });
      }
      return out;
    }
    const o = seed.order;
    const c: Extract<ModifyChange, { what: 'order' }> = { what: 'order', orderId: o.id, trigger: o.triggerPrice !== null };
    const num = (s: string) => parseNum(s);
    if (fields?.price && num(f.price) !== undefined && num(f.price) !== o.price) c.price = num(f.price);
    if (fields?.triggerPrice && num(f.triggerPrice) !== undefined && num(f.triggerPrice) !== o.triggerPrice) c.triggerPrice = num(f.triggerPrice);
    if (fields?.amount && num(f.amount) !== undefined && num(f.amount) !== o.amount) c.amount = num(f.amount);
    if (fields?.tpsl) {
      if (f.tpRemoved && o.takeProfit != null) c.takeProfit = null;
      else if (num(f.takeProfit) !== undefined && num(f.takeProfit) !== o.takeProfit) c.takeProfit = num(f.takeProfit);
      if (f.slRemoved && o.stopLoss != null) c.stopLoss = null;
      else if (num(f.stopLoss) !== undefined && num(f.stopLoss) !== o.stopLoss) c.stopLoss = num(f.stopLoss);
    }
    return Object.keys(c).length > 3 ? [c] : [];
  };
  const body = (): Omit<Ticket, 'idemKey'> => ({
    accountId: seed.account.id,
    market: seed.market,
    symbol: seed.symbol,
    ...(seed.kind === 'protection' ? { position: seed.position } : {}),
    changes: changes(),
  });

  // The PnL each level gives: a protection's from its position; an order's from what it closes or opens, at the amount
  // typed (an entry: at the price typed too).
  const orderBasis = (): PnlBasis | null => {
    if (seed.kind !== 'order' || !seed.basis) return null;
    const amount = parseNum(f.amount);
    const qty = amount !== undefined && seed.order.amount ? (seed.basis.qty * amount) / seed.order.amount : seed.basis.qty;
    if (seed.closes) return { ...seed.basis, qty };
    return { ...seed.basis, entry: parseNum(f.price) ?? parseNum(f.triggerPrice) ?? seed.basis.entry, qty };
  };
  const closes = seed.kind === 'order' && seed.closes;
  const impactOf = (s: ModifyStepPlan): string | null =>
    stepImpact(
      s,
      seed.kind === 'protection'
        ? { kind: 'protection', basisOf: (orderId, what) => seed.rows.find((x) => x.orderId === orderId && x.what === what)?.basis ?? seed.basis }
        : { kind: 'order', basis: seed.basis, closes: seed.closes, amount: seed.order.amount },
    );

  const title = (
    <span className="inline-flex items-center gap-2">
      {seed.title}
      <DemoBadge env={seed.account.env} />
    </span>
  );

  if (step === 'done' && result) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="flex flex-col gap-3.5">
          <ModifyOutcome result={result} />
          <div className="flex gap-2 pt-1">
            <button className="btn btn-primary" onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'confirm' && preview) {
    const err = send.error;
    const unknown = err instanceof ApiError && err.code === 'UNKNOWN_OUTCOME';
    return (
      <Modal title={title} onClose={onClose} locked={send.isPending}>
        <div className="flex flex-col gap-3.5">
          <ModifyConfirm preview={preview} impact={impactOf} />
          {err && (
            <div role="alert" className={clsx('rounded-[10px] border px-3 py-2.5 text-[12.5px]', unknown ? 'border-warn/50 bg-warn/[0.08]' : 'border-bear/40 bg-bear/[0.07]')}>
              {errorMessage(err)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {preview.errors.length === 0 && !unknown && (
              <button
                className="btn btn-primary"
                disabled={send.isPending}
                onClick={() =>
                  send.mutate(preview.ticket, {
                    onSuccess: (r) => {
                      setResult(r);
                      setStep('done');
                    },
                  })
                }
              >
                {send.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Confirmă și trimite
              </button>
            )}
            <button
              className="btn"
              disabled={send.isPending}
              onClick={() => {
                send.reset();
                setStep('form');
              }}
            >
              Înapoi
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const nothing = changes().length === 0;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (nothing) return;
          check.mutate(body(), {
            onSuccess: (p) => {
              setPreview(p);
              setStep('confirm');
            },
          });
        }}
      >
        {seed.kind === 'protection' &&
          rows.map((r, i) => {
            const n = rows.filter((x) => x.what === r.what).length;
            const k = rows.slice(0, i).filter((x) => x.what === r.what).length + 1;
            const label = `${r.what === 'sl' ? 'Stop loss' : 'Take profit'}${n > 1 ? ` ${k}` : ''}${r.orderId === null ? ' (nou)' : ''}`;
            const basis = r.basis ?? seed.basis;
            const v = parseNum(r.text);
            const impact = basis ? (r.removed ? pnlImpact(basis, r.level, null) : v !== undefined ? pnlImpact(basis, r.level, v) : r.level !== null ? pnlImpact(basis, r.level, r.level) : '') : '';
            const set = (patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <LevelField
                key={`${r.what}-${r.orderId ?? 'new'}-${i}`}
                id={`mod-${r.what}-${i}`}
                label={label}
                value={r.text}
                onChange={(text) => set({ text })}
                removed={r.removed}
                onRemove={(removed) => set({ removed })}
                canRemove={r.orderId !== null}
                impact={impact}
              />
            );
          })}
        {order &&
          fields &&
          (() => {
            const b = orderBasis();
            const was = seed.kind === 'order' ? seed.basis : null;
            const price = parseNum(f.price);
            const trigger = parseNum(f.triggerPrice);
            // A closing order: the PnL at its level (its trigger, else its limit price) for the amount typed.
            const closeImpact = (old: number | null, typed: number | undefined) => (closes && b && was && typed !== undefined ? pnlImpact(b, old, typed, was) : '');
            // An entry: what it is worth at its price, and the PnL at its TP / SL.
            const at = price ?? trigger;
            const value = !closes && b && was && at !== undefined ? `valoare ${plain(at * b.qty, 2)} ${b.quote}${Math.abs(at * b.qty - was.entry * was.qty) > 1e-9 ? ` (era ${plain(was.entry * was.qty, 2)})` : ''}` : '';
            const levelImpact = (old: number | null | undefined, typed: string, removed: boolean) => {
              const v = parseNum(typed);
              return closes || !b || removed || v === undefined ? '' : pnlImpact(b, old ?? null, v, was ?? b);
            };
            return (
              <>
                {fields.triggerPrice && <LevelField id="mod-trigger" label="Preț de declanșare" value={f.triggerPrice} onChange={(triggerPrice) => setF({ ...f, triggerPrice })} removed={false} onRemove={() => undefined} canRemove={false} impact={closeImpact(order.triggerPrice, trigger) || (fields.price ? '' : value)} />}
                {fields.price && <LevelField id="mod-price" label="Preț limită" value={f.price} onChange={(price) => setF({ ...f, price })} removed={false} onRemove={() => undefined} canRemove={false} impact={order.triggerPrice === null ? closeImpact(order.price, price) || value : value} />}
                {fields.amount && <LevelField id="mod-amount" label={seed.market === 'futures' ? 'Cantitate (contracte)' : 'Cantitate'} value={f.amount} onChange={(amount) => setF({ ...f, amount })} removed={false} onRemove={() => undefined} canRemove={false} impact="" />}
                {fields.tpsl && (
                  <>
                    <LevelField id="mod-tp" label="Take profit" value={f.takeProfit} onChange={(takeProfit) => setF({ ...f, takeProfit })} removed={f.tpRemoved} onRemove={(tpRemoved) => setF({ ...f, tpRemoved })} canRemove={order.takeProfit != null} impact={levelImpact(order.takeProfit, f.takeProfit, f.tpRemoved)} />
                    <LevelField id="mod-sl" label="Stop loss" value={f.stopLoss} onChange={(stopLoss) => setF({ ...f, stopLoss })} removed={f.slRemoved} onRemove={(slRemoved) => setF({ ...f, slRemoved })} canRemove={order.stopLoss != null} impact={levelImpact(order.stopLoss, f.stopLoss, f.slRemoved)} />
                  </>
                )}
              </>
            );
          })()}
        {check.error && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
            {errorMessage(check.error)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button className="btn btn-primary" disabled={nothing || check.isPending}>
            {check.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Verifică
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Renunță
          </button>
          {nothing && <span className="text-[12px] text-faint">Schimbă un nivel ca să verifici.</span>}
        </div>
      </form>
    </Modal>
  );
}
