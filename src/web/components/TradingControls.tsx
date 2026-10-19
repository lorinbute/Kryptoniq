// FD-TRADING §1, §4: switching trading on for an account (password and code again, the key's permissions read again)
// or off, cancelling an order, and the journal of what Sentiq sent.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint, Loader2, ScrollText, ShieldAlert, X } from 'lucide-react';
import type { AccountView, OrderRow } from '../../shared/api-types.ts';
import { ORDER_KIND_RO, TRADING, isDemoEnv, type OrderKind, type OrderResult, type TradeLogRow } from '../../shared/trading.ts';
import { providerById } from '../../shared/providers.ts';
import { api, errorMessage } from '../api.ts';
import { fmtDateTime, fmtNum } from '../format.ts';
import { useAccountInfo, useTz } from '../hooks.ts';
import { passkeyMessage } from '../passkey.ts';
import { Modal } from './Modal.tsx';
import { TRADING_KEY, TRADING_LOG_KEY } from './OrderTicket.tsx';
import { Panel } from './ui.tsx';

/** After switching: the accounts, what each can trade and the journal are read again. */
function useAfterSwitch() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['accounts'] });
    void qc.invalidateQueries({ queryKey: TRADING_KEY });
  };
}

export function EnableTradingDialog({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const after = useAfterSwitch();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const platform = TRADING[account.exchange as keyof typeof TRADING];
  const name = providerById(account.exchange)?.name ?? account.exchange;
  // FD-TRADEUNLOCK: a passkey answers for both factors, as at sign-in, when the account has one this browser can use.
  const canPasskey = browserSupportsWebAuthn();
  const me = useAccountInfo(canPasskey);
  const withPasskey = canPasskey && Boolean(me.data?.passkeysHere) && (me.data?.passkeys.length ?? 0) > 0;
  const switchOn = (body: Record<string, unknown>) => api.post<AccountView>(`/api/accounts/${account.id}/trading`, { enabled: true, ...body });
  const done = () => {
    after();
    onClose();
  };
  const enable = useMutation({ mutationFn: () => switchOn({ password, code }), onSuccess: done });
  const byPasskey = useMutation({
    mutationFn: async () => {
      const options = await api.post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/trading/passkey/options');
      let response;
      try {
        response = await startAuthentication({ optionsJSON: options });
      } catch (err) {
        throw new Error(passkeyMessage(err));
      }
      return switchOn({ passkey: response });
    },
    onSuccess: done,
  });
  const busy = enable.isPending || byPasskey.isPending;
  // Each way clears the other's error when it starts: the one shown is the last attempt's.
  const error = byPasskey.error ?? enable.error;
  const demo = isDemoEnv(account.env);
  return (
    <Modal title={`Pornește tranzacționarea: ${account.label}`} onClose={onClose} locked={busy}>
      <form
        className="flex flex-col gap-3.5 text-[13.5px]"
        onSubmit={(e) => {
          e.preventDefault();
          byPasskey.reset();
          enable.mutate();
        }}
      >
        <p>
          {demo
            ? 'Contul e de test (Demo / Paper): ordinele merg pe mediul de test al platformei.'
            : 'Ordinele trimise din Sentiq pe acest cont sunt reale: cumpără și vând cu banii din cont.'}{' '}
          Fiecare ordin cere o confirmare. Sentiq nu face niciodată retrageri sau transferuri.
        </p>
        <div className="rounded-[10px] border border-line-strong bg-panel-2 px-3 py-2.5">
          <div className="mb-1 font-semibold">Cheia trebuie să poată tranzacționa, dar nu și retrage:</div>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            {platform?.tradeSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-1.5 text-muted">Sentiq recitește permisiunile cheii de la {name} înainte de confirmare.</p>
        </div>
        {withPasskey && (
          <>
            <button
              type="button"
              className="btn btn-primary self-start"
              disabled={busy}
              onClick={() => {
                enable.reset();
                byPasskey.mutate();
              }}
            >
              {byPasskey.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Fingerprint size={15} aria-hidden />}
              Confirmă cu passkey
            </button>
            <p className="text-faint">sau cu parola și codul 2FA:</p>
          </>
        )}
        {!withPasskey && <p className="text-muted">Confirmă cu parola și codul 2FA ale contului tău Sentiq (nu cele de la {name}).</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-faint">Parola ta Sentiq</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} />
            <span className="text-[12px] text-faint">Cea cu care intri în Sentiq, nu parola sau passphrase-ul {name}.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint">Codul 2FA Sentiq</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required maxLength={20} spellCheck={false} className="num" />
            <span className="text-[12px] text-faint">Din aplicația de autentificare, intrarea Sentiq (nu codul {name}), sau un cod de recuperare.</span>
          </label>
        </div>
        {error && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13px]">
            {errorMessage(error)}
          </div>
        )}
        <div className="flex gap-2">
          <button className={withPasskey ? 'btn' : 'btn btn-primary'} disabled={busy}>
            {enable.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Pornește cu parola și codul
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Renunță
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function useDisableTrading(account: AccountView) {
  const after = useAfterSwitch();
  return useMutation({ mutationFn: () => api.post<AccountView>(`/api/accounts/${account.id}/trading`, { enabled: false }), onSuccess: after });
}

/** "Anulează" on an open order (a short confirmation first). */
export function CancelOrderButton({ account, order }: { account: AccountView; order: OrderRow }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () =>
      api.post<OrderResult>(`/api/trading/${account.id}/cancel`, {
        orderId: order.id,
        symbol: order.symbol,
        market: account.kind === 'stocks' ? 'stock' : order.market,
        trigger: order.triggerPrice !== null,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio', account.id] });
      void qc.invalidateQueries({ queryKey: TRADING_LOG_KEY });
    },
  });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        className="btn h-8 px-2 text-[12px]"
        disabled={cancel.isPending || cancel.isSuccess}
        onClick={() => {
          if (window.confirm(`Anulezi ordinul ${order.side === 'buy' ? 'de cumpărare' : 'de vânzare'} ${order.symbol} (${order.amount ?? ''})?`)) cancel.mutate();
        }}
        aria-label={`Anulează ordinul ${order.symbol}`}
      >
        {cancel.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <X size={13} aria-hidden />}
        {cancel.isSuccess ? 'Anulare cerută' : 'Anulează'}
      </button>
      {cancel.error && <span className="max-w-[28ch] text-[11.5px] text-bear">{errorMessage(cancel.error)}</span>}
    </span>
  );
}

const STATUS_RO: Record<TradeLogRow['status'], string> = { pending: 'în curs', sent: 'trimis', rejected: 'refuzat', error: 'eroare', unknown: 'necunoscut' };
const ACTION_RO: Record<TradeLogRow['action'], string> = { order: 'Ordin', cancel: 'Anulare', enable: 'Tranzacționare pornită', disable: 'Tranzacționare oprită' };

/** "Ordinele trimise din Sentiq" for one account (the last 50 of the user, this account's). */
export function TradeJournal({ account }: { account: AccountView }) {
  const tz = useTz();
  const q = useQuery({ queryKey: TRADING_LOG_KEY, queryFn: () => api.get<TradeLogRow[]>('/api/trading/log'), staleTime: 10_000 });
  const rows = (q.data ?? []).filter((r) => r.accountId === account.id);
  if (rows.length === 0) return null;
  return (
    <Panel title="Ordinele trimise din Sentiq" icon={ScrollText} flush>
      <table className="table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Acțiune</th>
            <th>Simbol</th>
            <th>Direcție</th>
            <th>Tip</th>
            <th className="text-right">Cantitate</th>
            <th className="text-right">Preț</th>
            <th>Rezultat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num text-[12px] text-muted">{fmtDateTime(r.createdAt, tz)}</td>
              <td>{ACTION_RO[r.action]}</td>
              <td className="num">{r.symbol ?? '—'}</td>
              <td className={r.side === 'buy' ? 'text-bull' : r.side === 'sell' ? 'text-bear' : ''}>{r.side === 'buy' ? 'Cumpărare' : r.side === 'sell' ? 'Vânzare' : '—'}</td>
              <td className="text-muted">{r.kind ? (ORDER_KIND_RO[r.kind as OrderKind] ?? r.kind) : '—'}</td>
              <td className="num text-right">{fmtNum(r.amount, 8)}</td>
              <td className="num text-right">{fmtNum(r.price ?? r.triggerPrice, 8)}</td>
              <td className="text-[12.5px]">
                <span className={r.status === 'sent' ? 'text-bull' : r.status === 'pending' ? 'text-muted' : r.status === 'unknown' ? 'text-warn' : 'text-bear'}>{STATUS_RO[r.status]}</span>
                {r.orderId && <span className="text-faint"> · {r.orderId}</span>}
                {r.message && <div className="max-w-[48ch] text-[11.5px] text-faint">{r.message}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** The key may move funds: such a key never trades through Sentiq (FD-TRADING §1). */
export function FundsRiskNote({ account }: { account: AccountView }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-bear/40 bg-bear/[0.06] px-4 py-3 text-[13.5px]">
      <ShieldAlert size={16} className="mt-0.5 shrink-0 text-bear" aria-hidden />
      <span>
        Cheia „{account.label}” poate retrage sau transfera fonduri ({account.permissions}). Recomandat: înlocuiește-o cu o cheie fără retrageri și transferuri. Sentiq nu pornește
        tranzacționarea cu ea.
      </span>
    </div>
  );
}
