// FD-REVERSE: a futures position turned the other way (TradingView's ⇅), from the chart's entry line or the Trades page.
// The server's check first (what is closed, what is opened, its leverage and margin, the SL / TP cancelled, the
// warnings), then "Întoarce poziția", then what each order did. One key per dialog: sent twice, it goes out once.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { AccountView } from '../../shared/api-types.ts';
import type { ModifyResult, ReversePreview, ReverseTicket } from '../../shared/trading.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { fmtNum } from '../format.ts';
import { Modal } from './Modal.tsx';
import { ModifyOutcome } from './ModifyTicket.tsx';
import { DemoBadge, TRADING_KEY, TRADING_LOG_KEY, uuid } from './OrderTicket.tsx';
import { settlePortfolio } from '../portfolio-settle.ts';

/** Whether a position can be turned from here: a crypto futures one, with futures trading on. */
export const canReverse = (account: AccountView, symbol: string): boolean => account.kind === 'crypto' && account.trading.enabled && account.trading.markets.includes('futures') && symbol.includes(':');

const SIDE_RO = { long: 'Long', short: 'Short' } as const;
const RESULT_RO: Record<ModifyResult['status'], string> = { done: 'Poziția a fost întoarsă', partial: 'Întoarsă în parte', failed: 'Poziția nu a fost întoarsă', unknown: 'Rezultat necunoscut: verifică pozițiile' };

export function ReverseDialog({ account, symbol, side, onClose, onDone }: { account: AccountView; symbol: string; side: 'long' | 'short'; onClose: () => void; onDone?: (message: string, bad: boolean) => void }) {
  const qc = useQueryClient();
  const [ticket] = useState<ReverseTicket>(() => ({ accountId: account.id, idemKey: uuid(), symbol, side }));
  const [result, setResult] = useState<ModifyResult | null>(null);
  const onError = (err: Error) => {
    if (err instanceof ApiError && (err.code === 'PERMISSION' || err.code === 'DISABLED')) {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: TRADING_KEY });
    }
  };
  const check = useMutation({ mutationFn: () => api.post<ReversePreview>(`/api/trading/${account.id}/reverse/preview`, ticket), onError });
  const send = useMutation({
    mutationFn: () => api.post<ModifyResult>(`/api/trading/${account.id}/reverse`, ticket),
    onError,
    onSuccess: (r) => {
      setResult(r);
      onDone?.(`${RESULT_RO[r.status]}.`, r.status !== 'done');
    },
    onSettled: () => {
      settlePortfolio(qc, account.id);
      void qc.invalidateQueries({ queryKey: TRADING_LOG_KEY });
    },
  });
  // Checked once, as the dialog opens.
  const { mutate } = check;
  useEffect(() => mutate(), [mutate]);
  const p = check.data;
  const err = send.error ?? check.error;
  const unknown = err instanceof ApiError && err.code === 'UNKNOWN_OUTCOME';
  const title = (
    <span className="inline-flex items-center gap-2">
      Întoarce poziția {symbol.split(':')[0]}
      <DemoBadge env={account.env} />
    </span>
  );
  if (result) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="flex flex-col gap-3.5">
          <ModifyOutcome result={result} labels={RESULT_RO} />
          <div className="flex gap-2 pt-1">
            <button className="btn btn-primary" onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={title} onClose={onClose} locked={send.isPending}>
      <div className="flex flex-col gap-3.5 text-[13.5px]">
        {!p && !check.error && (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Se verifică…
          </div>
        )}
        {p && (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-faint">Acum</dt>
              <dd className="num">
                <span className={p.from.side === 'long' ? 'text-bull' : 'text-bear'}>{SIDE_RO[p.from.side]}</span> {fmtNum(p.from.amount, 8)} {p.base}
              </dd>
              <dt className="text-faint">Devine</dt>
              <dd className="num font-semibold">
                <span className={p.to.side === 'long' ? 'text-bull' : 'text-bear'}>{SIDE_RO[p.to.side]}</span> {fmtNum(p.to.amount, 8)} {p.base}
              </dd>
              <dt className="text-faint">Levier, marjă</dt>
              <dd className="num">
                {p.leverage ?? '—'}× {p.marginMode ?? ''}
              </dd>
              {p.last !== null && (
                <>
                  <dt className="text-faint">Prețul de acum</dt>
                  <dd className="num">{fmtNum(p.last, 8)}</dd>
                </>
              )}
            </dl>
            {p.warnings.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-[10px] border border-warn/40 bg-warn/[0.06] px-3 py-2.5 text-[12.5px]">
                {p.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {p.errors.length > 0 && (
              <ul role="alert" className="flex flex-col gap-1 rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
                {p.errors.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {err && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[12.5px]">
            {errorMessage(err)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {p && p.errors.length === 0 && !unknown && (
            <button className="btn btn-primary" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Întoarce poziția
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
