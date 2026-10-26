// FD-TRADEUI: what the × of a trade's box on the chart asks before it acts. A stop loss / take profit (or an order's
// attached one) removed: the server's check first, then the confirmation with what changes and its warnings. An order
// cancelled: the order, then "Anulează ordinul". Nothing goes out without the second click. (Closing a position opens
// the order form, with its own confirmation.)
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { AccountView, OrderRow } from '../../shared/api-types.ts';
import type { ModifyPreview, ModifyStepPlan, ModifyTicket as Ticket, OrderResult } from '../../shared/trading.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { fmtNum } from '../format.ts';
import { Modal } from './Modal.tsx';
import { ModifyConfirm, useModifySend } from './ModifyTicket.tsx';
import { DemoBadge, TRADING_LOG_KEY } from './OrderTicket.tsx';
import { settlePortfolio } from '../portfolio-settle.ts';

export type LineAction =
  | { kind: 'modify'; account: AccountView; ticket: Omit<Ticket, 'idemKey'>; title: string; impact?: (s: ModifyStepPlan) => string | null }
  | { kind: 'cancel'; account: AccountView; order: OrderRow; market: 'spot' | 'futures' | 'stock'; title: string };

export function LineActionDialog({ action, onClose, onDone }: { action: LineAction; onClose: () => void; onDone: (message: string, bad: boolean) => void }) {
  const title = (
    <span className="inline-flex items-center gap-2">
      {action.title}
      <DemoBadge env={action.account.env} />
    </span>
  );
  return action.kind === 'modify' ? <RemoveLevel action={action} title={title} onClose={onClose} onDone={onDone} /> : <CancelOrder action={action} title={title} onClose={onClose} onDone={onDone} />;
}

function RemoveLevel({ action, title, onClose, onDone }: { action: Extract<LineAction, { kind: 'modify' }>; title: React.ReactNode; onClose: () => void; onDone: (message: string, bad: boolean) => void }) {
  const { check, send } = useModifySend(action.account.id);
  const [preview, setPreview] = useState<ModifyPreview | null>(null);
  // Checked once, as the dialog opens.
  const { mutate } = check;
  useEffect(() => {
    mutate(action.ticket, { onSuccess: setPreview });
  }, [mutate, action.ticket]);
  const err = send.error ?? check.error;
  const unknown = err instanceof ApiError && err.code === 'UNKNOWN_OUTCOME';
  return (
    <Modal title={title} onClose={onClose} locked={send.isPending}>
      <div className="flex flex-col gap-3.5">
        {!preview && !check.error && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Se verifică…
          </div>
        )}
        {preview && <ModifyConfirm preview={preview} impact={action.impact} />}
        {err && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
            {errorMessage(err)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {preview && preview.errors.length === 0 && !unknown && (
            <button
              className="btn btn-primary"
              disabled={send.isPending}
              onClick={() =>
                send.mutate(preview.ticket, {
                  onSuccess: (r) => {
                    onDone(r.status === 'done' ? 'Șters.' : r.status === 'partial' ? 'Șters în parte: vezi pașii în Tranzacții, la jurnal.' : r.status === 'failed' ? `Nu s-a șters: ${r.steps.map((s) => s.message ?? s.what).join(' ')}` : 'Rezultat necunoscut: verifică ordinele deschise.', r.status !== 'done');
                    onClose();
                  },
                })
              }
            >
              {send.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Confirmă și trimite
            </button>
          )}
          <button className="btn" disabled={send.isPending} onClick={onClose}>
            Renunță
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CancelOrder({ action, title, onClose, onDone }: { action: Extract<LineAction, { kind: 'cancel' }>; title: React.ReactNode; onClose: () => void; onDone: (message: string, bad: boolean) => void }) {
  const qc = useQueryClient();
  const o = action.order;
  const cancel = useMutation({
    mutationFn: () => api.post<OrderResult>(`/api/trading/${action.account.id}/cancel`, { orderId: o.id, symbol: o.symbol, market: action.market, trigger: o.triggerPrice !== null }),
    onSuccess: () => {
      onDone('Anularea ordinului a fost cerută.', false);
      onClose();
    },
    onSettled: () => {
      settlePortfolio(qc, action.account.id);
      void qc.invalidateQueries({ queryKey: TRADING_LOG_KEY });
    },
  });
  const level = o.triggerPrice ?? o.price;
  return (
    <Modal title={title} onClose={onClose} locked={cancel.isPending}>
      <div className="flex flex-col gap-3.5 text-[13.5px]">
        <p>
          {o.side === 'buy' ? 'Cumpărare' : 'Vânzare'} {o.symbol}, {fmtNum(o.amount, 8)} la <span className="num">{fmtNum(level, 8)}</span>
          {o.triggerPrice !== null ? ' (declanșare)' : ''}.
        </p>
        {cancel.error && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
            {errorMessage(cancel.error)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn btn-primary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Anulează ordinul
          </button>
          <button className="btn" disabled={cancel.isPending} onClick={onClose}>
            Renunță
          </button>
        </div>
      </div>
    </Modal>
  );
}
