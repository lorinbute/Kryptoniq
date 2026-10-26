// The order form (FD-TRADING §2–§3): fill in, "Verifică ordinul" (the server rounds and checks it), the confirmation
// with exactly what leaves, "Confirmă și trimite", the result. Opened from Tranzacții (new order, sell a holding,
// close a position) and from a chart. One key per version of the form: sending the same form twice places one order.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { TRADING, ORDER_KIND_RO, isDemoEnv, type InstrumentInfo, type OrderKind, type OrderPreview, type OrderResult, type OrderSide, type OrderTicket as Ticket, type TicketPrefs, type ClosablePosition, type TradeMarket, type TradeSymbol, type TradingCaps } from '../../shared/trading.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { saveSettingsPatch } from '../chart/prefs.ts';
import { useSettings } from '../hooks.ts';
import { accountPatch, initialAccount, isClosing, rememberedFields, ticketPatch } from './ticket-memory.ts';
import { closeRows, pnlPct, rowUnitsProblem } from './close-picker.ts';
import { fmtMoney, fmtPct } from '../format.ts';
import { Modal } from './Modal.tsx';
import { ProviderLogo } from './ProviderLogo.tsx';
import { settlePortfolio } from '../portfolio-settle.ts';

export const TRADING_KEY = ['trading'] as const;
export const TRADING_LOG_KEY = ['trading', 'log'] as const;

export function useTradingCaps(enabled = true) {
  return useQuery({ queryKey: TRADING_KEY, queryFn: () => api.get<{ accounts: TradingCaps[] }>('/api/trading'), staleTime: 30_000, enabled });
}

/** Where the form starts (a chart, a holding, a position). */
export interface TicketSeed {
  accountId?: number;
  /** Only accounts of this kind (a chart of a coin or of a share). */
  kind?: 'crypto' | 'stocks';
  market?: TradeMarket;
  symbol?: string;
  side?: OrderSide;
  orderKind?: OrderKind;
  amount?: number;
  price?: number;
  reduceOnly?: boolean;
  /** Closing a futures position: its margin mode (some exchanges want it with every order). */
  marginMode?: 'cross' | 'isolated';
  /** eToro: closing these positions (all, or `units` of a single one). */
  close?: { positionIds: string[]; units?: number };
  title?: string;
}

/** A v4 UUID, also where `crypto.randomUUID` is missing (a page opened over http on the local network). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const parseNum = (s: string): number | undefined => {
  const v = Number(s.replace(',', '.').trim());
  return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
};
const plain = (v: number | null | undefined, d = 8) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Number(v.toFixed(d))));
const STATUS_RO: Record<OrderResult['status'], string> = {
  filled: 'executat',
  open: 'deschis (în carte)',
  sent: 'trimis',
  pending: 'primit, în așteptare',
  cancelled: 'anulat',
  rejected: 'refuzat',
  unknown: 'necunoscut',
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[13px]">
      <span className="text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

/** "20 nov. 2025", or the position's id when eToro gave no date. */
const openedDay = (p: ClosablePosition) => (p.openedAt !== null ? new Date(p.openedAt).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : `poziția ${p.id}`);
const signedUsd = (v: number) => `${v > 0 ? '+' : ''}${fmtMoney(v, 'USD')}`;

/** What the form shows but cannot change (FD-ETOROROWS §2): text, not a disabled field. */
function ReadOnly({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px]">
      <span className="text-faint">{label}</span>
      <span className="py-2 text-[13.5px] text-text">{children}</span>
    </div>
  );
}

export function DemoBadge({ env }: { env: string }) {
  if (!isDemoEnv(env)) return null;
  return <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-warn">DEMO</span>;
}

export function OrderTicket({ seed, onClose }: { seed: TicketSeed; onClose: () => void }) {
  const qc = useQueryClient();
  const caps = useTradingCaps();
  const eligible = useMemo(
    () => (caps.data?.accounts ?? []).filter((a) => a.enabled && a.markets.length > 0 && (!seed.kind || a.kind === seed.kind) && (!seed.market || a.markets.includes(seed.market))),
    [caps.data, seed.kind, seed.market],
  );
  // FD-TICKETMEMORY: the account and the choices kept from the last forms (not the symbol, the amount or the prices).
  const memory = useSettings().data?.orderTicket;
  /** "Închide" on a position: the market and the side are the position's (and the memory is left alone). */
  const closing = isClosing(seed);
  const [accountId, setAccountId] = useState<number | null>(() => initialAccount(memory, seed, eligible.map((a) => a.accountId)));
  const account = eligible.find((a) => a.accountId === (accountId ?? initialAccount(memory, seed, eligible.map((a) => a.accountId)))) ?? eligible[0] ?? null;
  const platform = account ? TRADING[account.exchange as keyof typeof TRADING] : null;
  const stocks = account?.kind === 'stocks';
  // The choices of the account the form opens on, when the accounts and the settings are already known.
  const [first] = useState<TicketPrefs>(() => (account ? rememberedFields(memory, account.accountId, seed) : {}));
  const [market, setMarket] = useState<TradeMarket>(seed.market ?? first.market ?? 'spot');
  const mkt: TradeMarket = stocks ? 'stock' : account && !account.markets.includes(market) ? (account.markets[0] ?? 'spot') : market;
  const futures = mkt === 'futures';
  const [symbol, setSymbol] = useState(seed.symbol ?? '');
  const [side, setSide] = useState<OrderSide>(seed.side ?? first.side ?? 'buy');
  const kinds = (platform?.kinds[mkt] ?? []) as OrderKind[];
  const [kindSel, setKind] = useState<OrderKind>(seed.orderKind ?? first.kind ?? 'market');
  const kind: OrderKind = seed.close ? 'market' : kinds.includes(kindSel) ? kindSel : (kinds[0] ?? 'market');
  const [amount, setAmount] = useState(seed.amount !== undefined ? String(seed.amount) : '');
  const [amountInSel, setAmountIn] = useState<'base' | 'quote'>(first.amountIn ?? 'base');
  const [price, setPrice] = useState(seed.price !== undefined ? String(seed.price) : '');
  const [trigger, setTrigger] = useState('');
  const [tif, setTif] = useState<'gtc' | 'day'>(first.tif ?? 'gtc');
  const [leverage, setLeverage] = useState(first.leverage !== undefined ? String(first.leverage) : '1');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>(seed.marginMode ?? first.marginMode ?? 'isolated');
  const [reduceOnly, setReduceOnly] = useState(seed.reduceOnly ?? first.reduceOnly ?? false);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [extendedHours, setExtendedHours] = useState(first.extendedHours ?? false);
  const [closeUnits, setCloseUnits] = useState(seed.close?.units !== undefined ? String(seed.close.units) : '');
  const [step, setStep] = useState<'form' | 'confirm' | 'result'>('form');
  // Another account picked in the form, or the accounts / settings known only now: that account's choices, once.
  const appliedFor = useRef<number | null>(account && memory ? account.accountId : null);
  useEffect(() => {
    if (!account || !memory || appliedFor.current === account.accountId) return;
    appliedFor.current = account.accountId;
    const m = rememberedFields(memory, account.accountId, seed);
    if (m.market) setMarket(m.market);
    if (m.side) setSide(m.side);
    if (m.kind) setKind(m.kind);
    if (m.amountIn) setAmountIn(m.amountIn);
    if (m.tif) setTif(m.tif);
    if (m.leverage !== undefined) setLeverage(String(m.leverage));
    if (m.marginMode) setMarginMode(m.marginMode);
    if (m.reduceOnly !== undefined) setReduceOnly(m.reduceOnly);
    if (m.extendedHours !== undefined) setExtendedHours(m.extendedHours);
  }, [account, memory, seed]);
  /** Keeps a choice the user just made (not in a form that closes a position); a failed save changes nothing here. */
  const keep = (prefs: TicketPrefs) => {
    if (!account) return;
    // A choice made here is not overwritten by the memory arriving later (the settings still loading).
    appliedFor.current = account.accountId;
    if (!closing) void saveSettingsPatch(qc, ticketPatch(account.accountId, prefs)).catch(() => undefined);
  };
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  // The pairs of a crypto market (searchable); a broker's symbol is typed.
  const symbols = useQuery({
    queryKey: ['trading', account?.accountId, 'symbols', mkt],
    queryFn: () => api.get<TradeSymbol[]>(`/api/trading/${account!.accountId}/symbols?market=${mkt}`),
    enabled: !!account && !stocks,
    staleTime: 10 * 60_000,
  });
  const symbolSet = useMemo(() => new Set((symbols.data ?? []).map((s) => s.symbol)), [symbols.data]);
  // A chart's BTC/USDT becomes the perpetual BTC/USDT:USDT on futures, and back.
  useEffect(() => {
    if (stocks || !symbol) return;
    if (futures && !symbol.includes(':') && symbol.endsWith('/USDT')) setSymbol(`${symbol}:USDT`);
    if (!futures && symbol.endsWith(':USDT')) setSymbol(symbol.replace(/:USDT$/, ''));
  }, [futures, stocks, symbol]);
  // Kraken and Coinbase list many coins only against USD / USDC: a holding's or a chart's X/USDT becomes the pair there.
  useEffect(() => {
    if (stocks || futures || !symbols.data || symbolSet.has(symbol) || !/\/USDT$/.test(symbol)) return;
    const coin = symbol.replace(/\/USDT$/, '');
    const alt = ['USDC', 'USD', 'EUR'].map((q) => `${coin}/${q}`).find((x) => symbolSet.has(x));
    if (alt) setSymbol(alt);
  }, [stocks, futures, symbols.data, symbolSet, symbol]);
  const typed = useDebounced(symbol.trim(), 400);
  const symbolOk = stocks ? /^[A-Za-z0-9.#/_-]{1,40}$/.test(typed) : symbolSet.has(typed);
  const info = useQuery({
    queryKey: ['trading', account?.accountId, 'instrument', mkt, typed],
    queryFn: () => api.get<InstrumentInfo>(`/api/trading/${account!.accountId}/instrument?market=${mkt}&symbol=${encodeURIComponent(typed)}`),
    enabled: !!account && symbolOk,
    retry: false,
    staleTime: 15_000,
  });
  const ins = info.data;
  const quote = ins?.currency ?? (futures ? 'USDT' : stocks ? 'USD' : (typed.split('/')[1] ?? 'USDT').split(':')[0]);
  const base = ins?.base ?? typed.split('/')[0] ?? '';
  // eToro's leverage limits are per instrument (and are checked there): no maximum shown for it.
  const maxLev = ins?.maxLeverage ?? platform?.futures?.maxLeverage ?? null;
  const showsLeverage = futures || !!platform?.etoro;
  // A value only where the platform takes one (Trading 212: shares only), whatever was chosen on another account.
  const amountIn: 'base' | 'quote' = platform?.amountIn.includes(amountInSel) ? amountInSel : 'base';
  const tpsl = (futures && !reduceOnly && platform?.futures?.tpsl !== 'none' && (platform?.futures?.tpsl !== 'after-market' || kind === 'market')) || !!platform?.etoro || !!platform?.alpaca;

  // FD-ETOROROWS: eToro positions as rows, each with its own "Vinde" and an optional number of units to sell.
  const posRows = useMemo(() => (seed.close && ins?.positions ? closeRows(ins.positions, seed.close.positionIds) : null), [ins?.positions, seed.close]);
  // FD-HEDGEALL: a short is closed by buying it back, not sold: its rows say "Închide".
  const shortsOnly = !!posRows?.length && posRows.every((r) => !r.isBuy);
  const [rowUnits, setRowUnits] = useState<Record<string, string>>({});

  const ticketBody = (): Omit<Ticket, 'idemKey'> => ({
    accountId: account!.accountId,
    market: mkt,
    symbol: typed,
    side,
    kind,
    // Closing (eToro): the units to close, or all of them.
    amount: seed.close ? (parseNum(closeUnits) ?? seed.amount ?? 1) : (parseNum(amount) ?? 0),
    amountIn,
    ...(['limit', 'stop_limit', 'limit_ioc'].includes(kind) && parseNum(price) !== undefined ? { price: parseNum(price) } : {}),
    ...(['stop', 'stop_limit', 'mit'].includes(kind) && parseNum(trigger) !== undefined ? { triggerPrice: parseNum(trigger) } : {}),
    ...(platform && platform.tif.length > 1 && kind !== 'market' ? { tif } : {}),
    // A reduce-only order closes: it neither sets the leverage nor attaches TP / SL.
    ...(showsLeverage && !(futures && reduceOnly) && parseNum(leverage) !== undefined ? { leverage: Math.round(parseNum(leverage) as number) } : {}),
    ...(futures && platform?.futures?.marginModes ? { marginMode } : {}),
    ...(futures && reduceOnly ? { reduceOnly: true } : {}),
    ...(tpsl && parseNum(tp) !== undefined ? { takeProfit: parseNum(tp) } : {}),
    ...(tpsl && parseNum(sl) !== undefined ? { stopLoss: parseNum(sl) } : {}),
    ...(stocks && extendedHours ? { extendedHours: true } : {}),
    ...(seed.close ? { close: { positionIds: seed.close.positionIds, ...(parseNum(closeUnits) !== undefined ? { units: parseNum(closeUnits) } : {}) } } : {}),
  });
  // One key per version of the form: the same form sent twice is one order; any change makes a new one.
  // One key per version of what is sent (the form, or one row's sale): the same thing sent twice is one order.
  const keys = useRef(new Map<string, string>());
  const keyFor = (body: Omit<Ticket, 'idemKey'>) => {
    const sig = JSON.stringify(body);
    let k = keys.current.get(sig);
    if (!k) {
      k = uuid();
      keys.current.set(sig, k);
    }
    return k;
  };
  /** One row's sale: that position only, all of it or the units typed in its row. */
  const rowBody = (p: ClosablePosition): Omit<Ticket, 'idemKey'> => {
    const units = parseNum(rowUnits[p.id] ?? '');
    return { ...ticketBody(), amount: units ?? p.units, close: { positionIds: [p.id], ...(units !== undefined ? { units } : {}) } };
  };

  // A refusal that found trading off, or switched it off (the key can now move funds): the page reads the switch again.
  const onTradingError = (err: Error) => {
    if (err instanceof ApiError && (err.code === 'PERMISSION' || err.code === 'DISABLED')) {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: TRADING_KEY });
    }
  };
  const check = useMutation({
    mutationFn: (body: Omit<Ticket, 'idemKey'> | void) => {
      const b = body ?? ticketBody();
      return api.post<OrderPreview>(`/api/trading/${account!.accountId}/preview`, { ...b, idemKey: keyFor(b) });
    },
    onSuccess: (p) => {
      setPreview(p);
      setStep('confirm');
      // The account an order was made on is the one the chart's "Tranzacționează" opens on next time.
      if (account && !closing && memory?.lastAccount[account.kind] !== account.accountId) void saveSettingsPatch(qc, accountPatch(account.kind, account.accountId)).catch(() => undefined);
    },
    onError: onTradingError,
  });
  const send = useMutation({
    mutationFn: () => api.post<OrderResult>(`/api/trading/${account!.accountId}/orders`, { ...preview!.ticket, idemKey: preview!.ticket.idemKey }),
    onSuccess: (r) => {
      setResult(r);
      setStep('result');
    },
    onError: onTradingError,
    onSettled: () => {
      settlePortfolio(qc, account?.accountId);
      void qc.invalidateQueries({ queryKey: TRADING_LOG_KEY });
    },
  });

  /** A share of what is free: the quote to buy with (futures: margin × leverage), the asset to sell. */
  const fill = (part: number) => {
    if (!ins) return;
    const lev = futures ? (parseNum(leverage) ?? 1) : 1;
    const ref = parseNum(price) ?? parseNum(trigger) ?? ins.last;
    // Selling what is held (eToro's "Short" opens a position: it is paid like a buy).
    if (side === 'sell' && !futures && !platform?.etoro) {
      if (ins.availableBase !== null) {
        setAmountIn('base');
        setAmount(plain(ins.availableBase * part));
      }
      return;
    }
    if (ins.availableQuote === null) return;
    const value = ins.availableQuote * lev * part * 0.995;
    if (platform?.amountIn.includes('quote')) {
      setAmountIn('quote');
      setAmount(plain(value, 2));
    } else if (ref) {
      setAmountIn('base');
      setAmount(plain(Math.floor((value / ref) * 1e6) / 1e6, 6));
    }
  };

  const locked = send.isPending;
  /** After a row's sale: the list read again (the position sold leaves it), to sell another one. */
  const backToRows = () => {
    // A new round of sales: the same row and units sold again are a new order, not the one just sent.
    keys.current.clear();
    send.reset();
    check.reset();
    setPreview(null);
    setResult(null);
    setRowUnits({});
    setStep('form');
    void info.refetch();
  };
  const title = (
    <span className="inline-flex items-center gap-2">
      {account && <ProviderLogo id={account.exchange} size={20} />}
      {step === 'result' ? 'Ordin trimis' : step === 'confirm' ? 'Confirmă ordinul' : (seed.title ?? 'Ordin nou')}
      {account && <DemoBadge env={account.env} />}
    </span>
  );

  if (caps.isPending) return <Modal title="Ordin nou" onClose={onClose}>Se încarcă…</Modal>;
  if (!account || !platform) {
    return (
      <Modal title="Ordin nou" onClose={onClose}>
        <p className="text-[13.5px] text-muted">
          {seed.kind === 'stocks' ? 'Niciun broker' : seed.kind === 'crypto' ? 'Niciun exchange' : 'Niciun cont'} cu tranzacționarea pornită
          {seed.market === 'futures' ? ' pentru futures' : ''}. Pornește tranzacționarea din pagina Tranzacții (la cont, cu passkey-ul sau cu parola și codul 2FA).
        </p>
      </Modal>
    );
  }

  if (step === 'result' && result) {
    const ok = result.status !== 'rejected';
    return (
      <Modal title={title} onClose={onClose}>
        <div className="flex flex-col gap-3 text-[13.5px]">
          <p className="inline-flex items-center gap-2">
            {ok ? <CheckCircle2 size={18} className="text-bull" aria-hidden /> : <AlertTriangle size={18} className="text-bear" aria-hidden />}
            <span>
              Ordinul e <strong>{STATUS_RO[result.status]}</strong>
              {result.orderId ? <span className="text-muted"> · ID {result.orderId}</span> : null}
            </span>
          </p>
          {result.message && <p className="text-muted">{result.message}</p>}
          {result.followUps.map((f) => (
            <p key={f.what} className={f.ok ? 'text-bull' : 'text-bear'}>
              {f.what === 'stop-loss' ? 'Stop loss' : 'Take profit'}: {f.ok ? `plasat${f.orderId ? ` (ID ${f.orderId})` : ''}` : `NU a fost plasat: ${f.message ?? ''}. Poziția e deschisă: pune-l din nou.`}
            </p>
          ))}
          <div className="flex gap-2 pt-1">
            {posRows && (
              <button className="btn" onClick={backToRows}>
                Înapoi la poziții
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'confirm' && preview) {
    const p = preview;
    const long = p.ticket.side === 'buy';
    // FD-KUCOINHEDGE: in hedge mode a reduce-only order closes one of the two positions, named.
    const hedgeOrder = futures && p.positionMode === 'hedge';
    // A reduce-only order closes (all or part of) the position: said so, not "Short" / "Long".
    const sideRo = p.ticket.close
      ? 'Închidere'
      : p.ticket.reduceOnly
        ? hedgeOrder
          ? `Închide ${long ? 'short' : 'long'}`
          : `Închidere (${long ? 'cumpărare' : 'vânzare'})`
        : futures
          ? long
            ? 'Long'
            : 'Short'
          : platform.etoro && !long
            ? 'Short'
            : long
              ? 'Cumpărare'
              : 'Vânzare';
    const rows: [string, React.ReactNode][] = [
      ['Cont', `${account.label}${isDemoEnv(p.env) ? ' (DEMO)' : ''}`],
      ['Instrument', p.displaySymbol],
      ['Direcție', <span className={long && !p.ticket.close ? 'text-bull' : 'text-bear'}>{sideRo}</span>],
      ...(hedgeOrder ? [['Mod poziții', 'hedge (long și short separate)'] as [string, React.ReactNode]] : []),
      ['Tip', ORDER_KIND_RO[p.ticket.kind]],
      ['Cantitate', `${plain(p.amount)} ${base}${p.contracts !== null && p.contracts !== p.amount ? ` (${plain(p.contracts)} contracte)` : ''}`],
    ];
    if (p.price !== null) rows.push(['Preț limită', `${plain(p.price)} ${quote}`]);
    if (p.triggerPrice !== null) rows.push(['Preț de declanșare', `${plain(p.triggerPrice)} ${quote}`]);
    if (p.last !== null) rows.push(['Prețul de acum', `${plain(p.last)} ${quote}`]);
    rows.push(['Valoare estimată', p.value !== null ? `${plain(p.value, 2)} ${p.currency}` : '—']);
    if (p.ticket.leverage && (futures || platform.etoro)) rows.push(['Levier', `${p.ticket.leverage}×${p.ticket.marginMode ? `, marjă ${p.ticket.marginMode}` : ''}`]);
    if (p.margin !== null) rows.push(['Marjă', `${plain(p.margin, 2)} ${p.currency}`]);
    if (p.ticket.takeProfit) rows.push(['Take profit', plain(p.ticket.takeProfit)]);
    if (p.ticket.stopLoss) rows.push(['Stop loss', plain(p.ticket.stopLoss)]);
    if (p.ticket.reduceOnly) rows.push(['Reduce-only', 'da']);
    // FD-ETOROROWS: the position(s) closing, with their P/L now (for a whole sale).
    const closing = posRows?.filter((r) => p.ticket.close?.positionIds.includes(r.id)) ?? [];
    if (closing.length) {
      rows.push([closing.length === 1 ? 'Poziție' : 'Poziții', closing.map((r) => `${openedDay(r)} (${plain(r.units, 6)} unități @ ${plain(r.openRate, 4)})`).join(', ')]);
      const pnl = closing.every((r) => r.pnl !== null) ? closing.reduce((t, r) => t + (r.pnl as number), 0) : null;
      if (pnl !== null && p.ticket.close?.units === undefined) rows.push(['Profit / pierdere (nerealizat)', <span className={pnl >= 0 ? 'text-bull' : 'text-bear'}>{signedUsd(pnl)}</span>]);
    }
    if (p.available !== null) rows.push(['Disponibil', `${plain(p.available, 4)} ${p.ticket.side === 'sell' && !futures && !p.ticket.close ? base : p.currency}`]);
    const sendErr = send.error;
    const unknown = sendErr instanceof ApiError && sendErr.code === 'UNKNOWN_OUTCOME';
    return (
      <Modal title={title} onClose={onClose} locked={locked}>
        <div className="flex flex-col gap-3.5 text-[13.5px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-faint">{k}</dt>
                <dd className="num text-text">{v}</dd>
              </div>
            ))}
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
          {sendErr && (
            <div role="alert" className={clsx('rounded-[10px] border px-3 py-2.5 text-[12.5px]', unknown ? 'border-warn/50 bg-warn/[0.08]' : 'border-bear/40 bg-bear/[0.07]')}>
              {errorMessage(sendErr)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {p.errors.length === 0 && !unknown && (
              <button className={clsx('btn', long && !p.ticket.close ? 'btn-primary' : 'btn-danger')} onClick={() => send.mutate()} disabled={send.isPending}>
                {send.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Confirmă și trimite
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                // The last send's error belongs to that check: a changed form is checked (and confirmed) afresh. The
                // same form sent again still gets "unknown" from the server (its key stays bound).
                send.reset();
                setStep('form');
              }}
              disabled={send.isPending}
            >
              Înapoi
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // FD-KUCOINHEDGE: in hedge mode a buy opens the long and a sell the short; reduce-only, each closes the other side.
  const hedge = futures && ins?.positionMode === 'hedge';
  const sideLabels: [OrderSide, string][] = futures
    ? hedge && reduceOnly
      ? [['buy', 'Închide short'], ['sell', 'Închide long']]
      : [['buy', 'Long'], ['sell', 'Short']]
    : platform.etoro
      ? [['buy', 'Cumpără'], ['sell', 'Short']]
      : [['buy', 'Cumpără'], ['sell', 'Vinde']];
  const needsPrice = ['limit', 'stop_limit', 'limit_ioc'].includes(kind);
  const needsTrigger = ['stop', 'stop_limit', 'mit'].includes(kind);
  return (
    <Modal title={title} onClose={onClose} width={posRows ? 900 : 600}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          check.mutate();
        }}
      >
        <div className={clsx('grid grid-cols-1 gap-3', closing && !stocks ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {closing || eligible.length === 1 ? (
            <ReadOnly label="Cont">
              {account.label}
              {isDemoEnv(account.env) ? ' (DEMO)' : ''}
            </ReadOnly>
          ) : (
            <Field label="Cont">
              <select
                value={account.accountId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setAccountId(id);
                  const a = eligible.find((x) => x.accountId === id);
                  if (a) void saveSettingsPatch(qc, accountPatch(a.kind, id)).catch(() => undefined);
                }}
              >
                {eligible.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.label}
                    {isDemoEnv(a.env) ? ' (DEMO)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!stocks &&
            (closing ? (
              <ReadOnly label="Piață">{mkt === 'futures' ? 'Futures' : 'Spot'}</ReadOnly>
            ) : (
              <Field label="Piață">
                <div className="seg" role="group" aria-label="Piață">
                  {account.markets
                    .filter((m) => m !== 'stock')
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={mkt === m}
                        onClick={() => {
                          setMarket(m);
                          keep({ market: m });
                        }}
                      >
                        {m === 'spot' ? 'Spot' : 'Futures'}
                      </button>
                    ))}
                </div>
              </Field>
            ))}
          {closing && (
            // The position's own instrument: shown, not edited.
            <ReadOnly label={stocks ? 'Simbol' : 'Pereche'}>
              <span className="num">{symbol}</span>
              {ins?.name && <span className="text-muted"> · {ins.name}</span>}
              {info.isError && <span className="block text-[12px] text-bear">{errorMessage(info.error)}</span>}
            </ReadOnly>
          )}
        </div>
        {!closing && (
          <Field label={stocks ? 'Simbol (ex. AAPL)' : 'Pereche'} hint={info.isError ? errorMessage(info.error) : ins?.name ?? (stocks ? undefined : symbol && !symbolSet.has(symbol.trim()) && symbols.data ? 'Alege o pereche din listă.' : undefined)}>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} list={stocks ? undefined : `ticket-symbols-${account.accountId}-${mkt}`} placeholder={stocks ? 'AAPL' : futures ? 'BTC/USDT:USDT' : 'BTC/USDT'} autoComplete="off" spellCheck={false} className="num" required />
            {!stocks && (
              <datalist id={`ticket-symbols-${account.accountId}-${mkt}`}>
                {(symbols.data ?? []).slice(0, 3000).map((s) => (
                  <option key={s.symbol} value={s.symbol} />
                ))}
              </datalist>
            )}
          </Field>
        )}
        {ins && (
          <p className="text-[12.5px] text-muted">
            Preț acum: <span className="num text-text">{plain(ins.last)}</span> {quote}
            {ins.availableQuote !== null && (
              <>
                {' '}
                · Disponibil: <span className="num text-text">{plain(ins.availableQuote, 4)}</span> {futures ? 'USDT' : quote}
              </>
            )}
            {!futures && ins.availableBase !== null && ins.availableBase > 0 && (
              <>
                {' '}
                · Deții: <span className="num text-text">{plain(ins.availableBase)}</span> {base}
              </>
            )}
            {ins.position && (
              <>
                {' '}
                · Poziție: <span className={ins.position.side === 'long' ? 'text-bull' : 'text-bear'}>{ins.position.side}</span> <span className="num">{plain(ins.position.amount)}</span>
              </>
            )}
            {ins.hedgePositions && (
              // FD-KUCOINHEDGE, FD-HEDGEALL: the account's hedge mode (eToro: positions always apart), then the long and
              // the short open on the instrument.
              <>
                {' '}
                · {futures ? 'Mod hedge' : 'Poziții separate'}
                {ins.hedgePositions?.long && (
                  <>
                    {' '}
                    · <span className="text-bull">long</span> <span className="num">{plain(ins.hedgePositions.long.amount)}</span>
                  </>
                )}
                {ins.hedgePositions?.short && (
                  <>
                    {' '}
                    · <span className="text-bear">short</span> <span className="num">{plain(ins.hedgePositions.short.amount)}</span>
                  </>
                )}
              </>
            )}
          </p>
        )}
        {seed.close && posRows ? (
          // FD-ETOROROWS: one row per position, each with its own "Vinde".
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-faint">Pozițiile ({posRows.length})</span>
            {posRows.length === 0 ? (
              <p className="text-[13px] text-muted">Nicio poziție deschisă pe acest instrument.</p>
            ) : (
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[12px] text-faint">
                      <th className="px-3 py-2 font-normal">Deschisă</th>
                      <th className="px-3 py-2 text-right font-normal">Unități</th>
                      <th className="px-3 py-2 text-right font-normal">Preț intrare</th>
                      <th className="px-3 py-2 text-right font-normal">Investit</th>
                      <th className="px-3 py-2 text-right font-normal">Profit / pierdere</th>
                      <th className="px-3 py-2 font-normal">{shortsOnly ? 'De închis' : 'De vândut'}</th>
                      <th className="px-3 py-2" aria-label="Acțiune" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {posRows.map((r) => {
                      const pct = pnlPct(r);
                      const typed = rowUnits[r.id] ?? '';
                      const problem = rowUnitsProblem(typed, r.units);
                      const busy = check.isPending && check.variables?.close?.positionIds[0] === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-hover">
                          <td className="px-3 py-2 text-muted">{openedDay(r)}</td>
                          <td className="num px-3 py-2 text-right">{plain(r.units, 6)}</td>
                          <td className="num px-3 py-2 text-right">{plain(r.openRate, 4)}</td>
                          <td className="num px-3 py-2 text-right text-muted">{r.invested !== null ? fmtMoney(r.invested, 'USD') : '—'}</td>
                          <td className={clsx('num px-3 py-2 text-right', r.pnl === null ? 'text-faint' : r.pnl >= 0 ? 'text-bull' : 'text-bear')}>
                            {r.pnl === null ? '—' : signedUsd(r.pnl)}
                            {pct !== null && <span className="block text-[11.5px]">{fmtPct(pct)}</span>}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={typed}
                              onChange={(e) => setRowUnits((u) => ({ ...u, [r.id]: e.target.value }))}
                              inputMode="decimal"
                              placeholder="toate"
                              aria-label={`Unități de ${shortsOnly ? 'închis' : 'vândut'} din poziția din ${openedDay(r)}`}
                              aria-invalid={problem !== null}
                              title={problem ? `De ${shortsOnly ? 'închis' : 'vândut'}: ${problem}` : 'Gol = toată poziția'}
                              className={clsx('num w-24', problem && 'border-bear')}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" className="btn btn-danger h-8 px-3 text-[12.5px]" disabled={problem !== null || check.isPending} onClick={() => check.mutate(rowBody(r))}>
                              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
                              {shortsOnly ? 'Închide' : 'Vinde'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[12px] text-faint">{shortsOnly ? '„De închis” gol = toată poziția. Fiecare închidere are o confirmare.' : '„De vândut” gol = toată poziția. Fiecare vânzare are o confirmare.'}</p>
          </div>
        ) : seed.close ? (
          <Field
            label={`Unități de închis (gol = toată poziția${seed.close.positionIds.length > 1 ? 'urile' : ''})`}
            hint={seed.close.positionIds.length > 1 ? `${seed.close.positionIds.length} poziții: se închid întâi poziții întregi, apoi o parte din următoarea.` : undefined}
          >
            <input value={closeUnits} onChange={(e) => setCloseUnits(e.target.value)} inputMode="decimal" placeholder={seed.amount !== undefined ? plain(seed.amount) : undefined} className="num" />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {closing ? (
                // Closing a position: the side is the one that reduces it.
                <ReadOnly label="Direcție">
                  <span className={side === 'buy' ? 'text-bull' : 'text-bear'}>
                    {sideLabels.find(([v]) => v === side)?.[1]}
                    {hedge ? '' : ' (închide poziția)'}
                  </span>
                </ReadOnly>
              ) : (
                <Field label="Direcție">
                  <div className="seg" role="group" aria-label="Direcție">
                    {sideLabels.map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={side === v}
                        onClick={() => {
                          setSide(v);
                          keep({ side: v });
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="Tip">
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as OrderKind);
                    keep({ kind: e.target.value as OrderKind });
                  }}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {ORDER_KIND_RO[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {needsTrigger && (
                <Field label={`Preț de declanșare (${quote})`} hint={kind === 'mit' ? 'Se execută la piață când prețul atinge această valoare.' : side === 'buy' ? 'Peste prețul de acum.' : 'Sub prețul de acum.'}>
                  <input value={trigger} onChange={(e) => setTrigger(e.target.value)} inputMode="decimal" required className="num" />
                </Field>
              )}
              {needsPrice && (
                <Field label={`Preț limită (${quote})`}>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required className="num" />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`Cantitate (${amountIn === 'quote' ? quote : base || 'activ'})`}>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="num w-44" />
              </Field>
              {!closing && platform.amountIn.includes('quote') && platform.amountIn.includes('base') && (
                <div className="seg mb-0.5" role="group" aria-label="Cantitatea în">
                  <button
                    type="button"
                    aria-pressed={amountIn === 'base'}
                    onClick={() => {
                      setAmountIn('base');
                      keep({ amountIn: 'base' });
                    }}
                  >
                    {base || 'Activ'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={amountIn === 'quote'}
                    onClick={() => {
                      setAmountIn('quote');
                      keep({ amountIn: 'quote' });
                    }}
                  >
                    {futures ? 'Valoare' : quote}
                  </button>
                </div>
              )}
              {ins && !closing && (
                <div className="mb-0.5 flex gap-1">
                  {[0.25, 0.5, 1].map((x) => (
                    <button key={x} type="button" className="btn h-8 px-2 text-[12px]" onClick={() => fill(x)}>
                      {x * 100}%
                    </button>
                  ))}
                </div>
              )}
            </div>
            {((showsLeverage && !(futures && reduceOnly)) || (futures && platform.futures?.marginModes && !closing) || (platform.tif.length > 1 && kind !== 'market')) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {showsLeverage && !(futures && reduceOnly) && (
                  <Field label={maxLev ? `Levier (max ${maxLev}×)` : 'Levier'}>
                    <input
                      value={leverage}
                      onChange={(e) => {
                        setLeverage(e.target.value);
                        // Kept only as a whole number the form accepts.
                        const v = parseNum(e.target.value);
                        if (v !== undefined && Number.isInteger(v) && v >= 1 && v <= 125) keep({ leverage: v });
                      }}
                      inputMode="numeric"
                      className="num"
                    />
                  </Field>
                )}
                {futures && platform.futures?.marginModes && !closing && (
                  <Field label="Marjă">
                    <select
                      value={marginMode}
                      onChange={(e) => {
                        setMarginMode(e.target.value as 'cross' | 'isolated');
                        keep({ marginMode: e.target.value as 'cross' | 'isolated' });
                      }}
                    >
                      {platform.futures.marginModes.map((m) => (
                        <option key={m} value={m}>
                          {m === 'cross' ? 'Cross' : 'Isolated'}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {platform.tif.length > 1 && kind !== 'market' && (
                  <Field label="Valabil">
                    <select
                      value={tif}
                      onChange={(e) => {
                        setTif(e.target.value as 'gtc' | 'day');
                        keep({ tif: e.target.value as 'gtc' | 'day' });
                      }}
                    >
                      <option value="gtc">până la anulare</option>
                      <option value="day">până la sfârșitul zilei</option>
                    </select>
                  </Field>
                )}
              </div>
            )}
            {tpsl && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Take profit (opțional)" hint={futures && platform.futures?.tpsl === 'after-market' ? 'Trimis ca ordin separat, după intrare.' : undefined}>
                  <input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" className="num" />
                </Field>
                <Field label={platform.etoro ? 'Stop loss (obligatoriu la levier sau short)' : 'Stop loss (opțional)'}>
                  <input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" className="num" />
                </Field>
              </div>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              {futures &&
                (closing ? (
                  // Closing: fixed, so said, not a locked checkbox.
                  <span className="text-muted">Reduce-only: da (doar micșorează poziția)</span>
                ) : (
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={reduceOnly}
                      onChange={(e) => {
                        setReduceOnly(e.target.checked);
                        keep({ reduceOnly: e.target.checked });
                      }}
                    />
                    Reduce-only (doar micșorează poziția)
                  </label>
                ))}
              {stocks && (platform.alpaca ? kind === 'limit' : kind === 'market' && account.exchange === 'trading212') && (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={extendedHours}
                    onChange={(e) => {
                      setExtendedHours(e.target.checked);
                      keep({ extendedHours: e.target.checked });
                    }}
                  />
                  Și în afara orelor de tranzacționare
                </label>
              )}
            </div>
          </>
        )}
        {check.error && (
          <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13px]">
            {errorMessage(check.error)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {/* The rows have their own "Vinde" (FD-ETOROROWS). */}
          {!posRows && (
            <button className="btn btn-primary" disabled={check.isPending || !symbol.trim() || (!seed.close && !(parseNum(amount) ?? 0))}>
              {check.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Verifică ordinul
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Renunță
          </button>
        </div>
      </form>
    </Modal>
  );
}
