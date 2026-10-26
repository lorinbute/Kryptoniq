// The bot form (FD-BOT §1–§6): where it trades, the strategy's settings, the limits, the period, the safety; under them
// the server's summary of what the bot will do (POST /api/bots/check). A bot that runs edits only what may change (§7).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { CRYPTO_PAIR_RE, defaultBotName, END_ACTION_RO, STOCK_TICKER_RE, WEIGHT_KEYS, WEIGHT_RO, type BotCheck, type BotDetail, type BotEdit, type BotEndAction } from '../../../shared/bot.ts';
import { TIMEFRAMES, type Timeframe } from '../../../shared/time.ts';
import { isDemoEnv, TRADING, type TradingCaps } from '../../../shared/trading.ts';
import { api, errorMessage } from '../../api.ts';
import { useWatchlist } from '../../hooks.ts';
import { fmtNum, fmtPrice, autoDigits } from '../../format.ts';
import { useTradingCaps } from '../OrderTicket.tsx';
import { Seg, Warning } from '../ui.tsx';
import { Check, Field, ReadOnly, Section } from './bot-ui.tsx';
import { longPatch, marketPatch, ratioOf, toInput, zoneText, type BotForm } from './bot-form.ts';

export const BOTS_KEY = ['bots'] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The signals' timeframe (Premium): the same list for a new bot and an edited one (FD-BOTTF). */
const TfSelect = ({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value as Timeframe)}>
    {TIMEFRAMES.map((t) => (
      <option key={t} value={t}>
        {t}
      </option>
    ))}
  </select>
);

const Num = ({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) => (
  <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={clsx('num', className)} placeholder={placeholder} aria-label={label} autoComplete="off" />
);

export function BotFormView({ form, setForm, edit, onDone, onCancel }: { form: BotForm; setForm: (f: BotForm) => void; edit: BotDetail | null; onDone: (bot: BotDetail) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const caps = useTradingCaps();
  const watch = useWatchlist();
  const [ack, setAck] = useState(false);
  const [symbolText, setSymbolText] = useState('');
  const stocks = form.market === 'stock';
  const futures = form.market === 'futures';
  const set = (patch: Partial<BotForm>) => {
    const next = { ...form, ...patch };
    // The name follows the symbols and the strategy until it is typed.
    if (!next.nameTyped) next.name = defaultBotName(next.strategy, next.symbols);
    setForm(next);
  };
  const setGrid = (p: Partial<BotForm['grid']>) => set({ grid: { ...form.grid, ...p } });
  const setDca = (p: Partial<BotForm['dca']>) => set({ dca: { ...form.dca, ...p } });
  const setPremium = (p: Partial<BotForm['premium']>) => set({ premium: { ...form.premium, ...p } });

  // Coins trade on an exchange, shares at a broker (FD-BOT §10): the accounts of the bot's area where trading is on.
  const accounts = (caps.data?.accounts ?? []).filter((a) => a.enabled && (stocks ? a.kind === 'stocks' && a.markets.includes('stock') : a.kind === 'crypto' && a.markets.some((m) => m === 'spot' || m === 'futures')));
  const account = accounts.find((a) => a.accountId === form.accountId) ?? null;
  const etoroOf = (a: TradingCaps | null) => Boolean(a && TRADING[a.exchange as keyof typeof TRADING]?.etoro);
  /** The account picked: its market, and on shares long only unless it is eToro. */
  const accountPatch = (a: TradingCaps): Partial<BotForm> =>
    stocks ? { accountId: a.accountId, ...(etoroOf(a) ? {} : longPatch(form)) } : { accountId: a.accountId, ...marketPatch(form, a.markets.includes(form.market) ? form.market : (a.markets.find((m) => m !== 'stock') ?? 'spot')) };
  const { input, error } = useMemo(() => toInput(form), [form]);
  const body = useDebounced(input ? JSON.stringify(input) : null, 400);
  const check = useQuery({
    queryKey: ['bots', 'check', body],
    queryFn: () => api.post<BotCheck>('/api/bots/check', JSON.parse(body as string)),
    enabled: body !== null && !edit,
    staleTime: 15_000,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => {
      if (!input) throw new Error(error ?? 'Setări invalide.');
      if (!edit) return api.post<BotDetail>('/api/bots', input);
      const patch: BotEdit = { name: input.name, endsAt: input.endsAt, endAction: input.endAction, dailyLoss: input.dailyLoss, lossStop: input.lossStop, fee: input.fee };
      if (edit.strategy !== 'grid') patch.maxAmount = input.maxAmount;
      if (input.strategy === 'premium') {
        patch.premium = input.premium;
        patch.tf = input.tf;
        if (input.market === 'futures') patch.leverage = input.leverage;
      }
      return api.put<BotDetail>(`/api/bots/${edit.id}`, patch);
    },
    onSuccess: (bot) => {
      void qc.invalidateQueries({ queryKey: BOTS_KEY });
      onDone(bot);
    },
  });

  // Real trading: only coins, only on an account where trading is on.
  useEffect(() => {
    if (form.exec === 'real' && !account && accounts[0] && !edit) set(accountPatch(accounts[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the accounts are known
  }, [form.exec, accounts.length]);

  const suggestions = (watch.data ?? []).filter((w) => (stocks ? w.kind === 'stock' : w.kind === 'crypto')).map((w) => (stocks ? w.coin : `${w.coin}/${w.quote}`));
  const addSymbol = () => {
    const s = symbolText.trim().toUpperCase();
    if (!s || form.symbols.includes(s) || form.symbols.length >= 10) return;
    set({ symbols: [...form.symbols, s] });
    setSymbolText('');
  };
  const symbolOk = (s: string) => (stocks ? STOCK_TICKER_RE.test(s) : CRYPTO_PAIR_RE.test(s));
  const many = form.strategy === 'premium';
  const marketOptions = form.exec === 'real' && account ? account.markets.filter((m): m is 'spot' | 'futures' => m === 'spot' || m === 'futures') : (['spot', 'futures'] as const);
  const longOnly = form.market === 'spot' || (stocks && form.exec === 'real' && !etoroOf(account));
  /** The Slingshot bot's direction as the form shows it. */
  const direction = longOnly ? 'long' : form.premium.direction;
  const longOnlyText = (
    <>
      Long <span className="text-faint">· {stocks ? 'short pe acțiuni doar la eToro' : 'short doar pe futures'}</span>
    </>
  );
  const cur = stocks ? 'USD' : (form.symbols[0]?.split('/')[1] ?? 'USDT');
  const ready = input !== null && (edit !== null || (!check.data?.errors.length && check.data !== undefined)) && (form.exec !== 'real' || ack || edit !== null);
  const scheduled = input?.startsAt !== null && input?.startsAt !== undefined;
  const price = check.data?.price ?? null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
    >
      <Section title={edit ? 'Botul' : 'Unde tranzacționează'}>
        <Field label="Nume">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, nameTyped: true })} maxLength={60} />
        </Field>
        {edit ? (
          <>
            <p className="text-[13px] text-muted">
              {edit.symbols.join(', ')} · {edit.market === 'stock' ? 'Acțiuni' : edit.market === 'futures' ? 'Futures' : 'Spot'} · {edit.exec === 'paper' ? 'Simulare' : `Real, ${edit.account?.label ?? 'cont șters'}`}
            </p>
            {edit.strategy === 'premium' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Timeframe-ul semnalelor" hint="Botul îl preia la următoarea verificare (≤ 30 s) și ia semnalele de pe lumânările care se închid după ea; pozițiile deschise își păstrează SL / TP-ul.">
                  <TfSelect value={form.tf} onChange={(tf) => set({ tf })} />
                </Field>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Execuția" hint={form.exec === 'paper' ? 'Nicio comandă nu pleacă: botul face tot, la prețul de atunci.' : stocks ? 'Doar cât bursa e deschisă.' : undefined}>
                <div className="seg" role="group" aria-label="Execuția">
                  <button type="button" aria-pressed={form.exec === 'paper'} onClick={() => set({ exec: 'paper', accountId: null })}>
                    Simulare
                  </button>
                  <button type="button" aria-pressed={form.exec === 'real'} disabled={accounts.length === 0} title={accounts.length === 0 ? `Niciun cont ${stocks ? 'de acțiuni' : 'crypto'} cu tranzacționarea pornită (Tranzacții).` : undefined} onClick={() => set({ exec: 'real' })}>
                    Real
                  </button>
                </div>
              </Field>
              {form.exec === 'real' && (
                <Field label="Contul">
                  <select
                    value={form.accountId ?? ''}
                    onChange={(e) => {
                      const a = accounts.find((x) => x.accountId === Number(e.target.value));
                      if (a) set(accountPatch(a));
                    }}
                  >
                    {accounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.label}
                        {isDemoEnv(a.env) ? ' (DEMO)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {!stocks && (
                <Field label="Piața">
                  <div className="seg" role="group" aria-label="Piața">
                    {marketOptions.map((m) => (
                      <button key={m} type="button" aria-pressed={form.market === m} onClick={() => set(marketPatch(form, m))}>
                        {m === 'spot' ? 'Spot' : 'Futures'}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              {form.strategy === 'premium' && (
                <Field label="Timeframe-ul semnalelor">
                  <TfSelect value={form.tf} onChange={(tf) => set({ tf })} />
                </Field>
              )}
            </div>
            <Field label={many ? `Simbolurile (${form.symbols.length} din 10)` : 'Simbolul'} hint={many ? 'Botul urmărește fiecare simbol; o singură poziție pe simbol.' : undefined}>
              {many ? (
                <div className="flex flex-col gap-2">
                  {form.symbols.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.symbols.map((s) => (
                        <span key={s} className={clsx('chip num', !symbolOk(s) && 'border-bear text-bear')}>
                          {s}
                          <button type="button" className="-mr-1 flex size-5 items-center justify-center rounded-full text-faint hover:text-text" aria-label={`Scoate ${s}`} onClick={() => set({ symbols: form.symbols.filter((x) => x !== s) })}>
                            <X size={12} aria-hidden />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={symbolText}
                      onChange={(e) => setSymbolText(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSymbol();
                        }
                      }}
                      list="bot-symbols"
                      placeholder={stocks ? 'MSFT' : 'ETH/USDT'}
                      className="num min-w-0 flex-1"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Adaugă un simbol"
                    />
                    <button type="button" className="btn" onClick={addSymbol} disabled={!symbolText.trim() || form.symbols.length >= 10}>
                      <Plus size={15} aria-hidden /> Adaugă
                    </button>
                  </div>
                </div>
              ) : (
                <input value={form.symbols[0] ?? ''} onChange={(e) => set({ symbols: [e.target.value.toUpperCase()] })} list="bot-symbols" className="num" autoComplete="off" spellCheck={false} />
              )}
              <datalist id="bot-symbols">
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </>
        )}
      </Section>

      {form.strategy === 'grid' && !edit && (
        <Section title="Grila" aside={price !== null ? <span className="text-[12.5px] text-muted">Prețul acum: <span className="num text-text">{fmtPrice(price, autoDigits(price))}</span></span> : null}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Limita de jos">
              <Num value={form.grid.lower} onChange={(v) => setGrid({ lower: v })} />
            </Field>
            <Field label="Limita de sus">
              <Num value={form.grid.upper} onChange={(v) => setGrid({ upper: v })} />
            </Field>
            <Field label="Grile (2–100)">
              <Num value={form.grid.grids} onChange={(v) => setGrid({ grids: v })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Spațierea">
              <Seg label="Spațierea" value={form.grid.spacing} options={[{ value: 'arithmetic', label: 'Aritmetică' }, { value: 'geometric', label: 'Geometrică' }]} onChange={(v) => setGrid({ spacing: v })} />
            </Field>
            {longOnly ? (
              <ReadOnly label="Direcția">{longOnlyText}</ReadOnly>
            ) : (
              <Field label="Direcția">
                <Seg label="Direcția" value={form.grid.direction} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: 'neutral', label: 'Neutru' }]} onChange={(v) => setGrid({ direction: v })} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Prețul de pornire" hint="Opțional: așteaptă până îl atinge.">
              <Num value={form.grid.trigger} onChange={(v) => setGrid({ trigger: v })} />
            </Field>
            <Field label="Oprește sub" hint="Opțional: închide tot.">
              <Num value={form.grid.stopBelow} onChange={(v) => setGrid({ stopBelow: v })} />
            </Field>
            <Field label="Oprește peste" hint="Opțional: închide tot.">
              <Num value={form.grid.stopAbove} onChange={(v) => setGrid({ stopAbove: v })} />
            </Field>
          </div>
        </Section>
      )}

      {form.strategy === 'dca' && !edit && (
        <Section title="DCA">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {longOnly ? (
              <ReadOnly label="Direcția">{longOnlyText}</ReadOnly>
            ) : (
              <Field label="Direcția">
                <Seg label="Direcția DCA" value={form.dca.direction} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} onChange={(v) => setDca({ direction: v })} />
              </Field>
            )}
            <Field label={`Ordinul de bază (${cur})`}>
              <Num value={form.dca.baseOrder} onChange={(v) => setDca({ baseOrder: v })} />
            </Field>
            <Field label="Ordine de siguranță (0–25)">
              <Num value={form.dca.safetyOrders} onChange={(v) => setDca({ safetyOrders: v })} />
            </Field>
            <Field label={`Primul ordin de siguranță (${cur})`}>
              <Num value={form.dca.safetyOrder} onChange={(v) => setDca({ safetyOrder: v })} />
            </Field>
            <Field label="Multiplicatorul de volum">
              <Num value={form.dca.volumeScale} onChange={(v) => setDca({ volumeScale: v })} />
            </Field>
            <Field label="Abaterea până la primul (%)">
              <Num value={form.dca.deviation} onChange={(v) => setDca({ deviation: v })} />
            </Field>
            <Field label="Multiplicatorul de pas">
              <Num value={form.dca.stepScale} onChange={(v) => setDca({ stepScale: v })} />
            </Field>
            <Field label="Take profit (% din prețul mediu)">
              <Num value={form.dca.takeProfit} onChange={(v) => setDca({ takeProfit: v })} />
            </Field>
            <Field label="Stop loss (% din prețul de bază)" hint="Opțional.">
              <Num value={form.dca.stopLoss} onChange={(v) => setDca({ stopLoss: v })} />
            </Field>
            <Field label="La stop loss">
              <select value={form.dca.slAction} onChange={(e) => setDca({ slAction: e.target.value as 'restart' | 'stop' })}>
                <option value="stop">Închide și oprește botul</option>
                <option value="restart">Închide și începe alt ciclu</option>
              </select>
            </Field>
            <Field label="Cicluri cel mult" hint="Opțional.">
              <Num value={form.dca.maxCycles} onChange={(v) => setDca({ maxCycles: v })} />
            </Field>
            <Field label="Pauza între cicluri (min)">
              <Num value={form.dca.cooldownMin} onChange={(v) => setDca({ cooldownMin: v })} />
            </Field>
          </div>
          <Check checked={form.dca.repeat} onChange={(on) => setDca({ repeat: on })}>
            Repetă după take profit
          </Check>
        </Section>
      )}

      {form.strategy === 'premium' && (
        <>
          <Section title="Semnalele și ieșirea">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {longOnly ? (
                <ReadOnly label="Direcția">{longOnlyText}</ReadOnly>
              ) : (
                <Field label="Direcția">
                  <Seg label="Direcția Slingshot" value={form.premium.direction} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: 'both', label: 'Ambele' }]} onChange={(v) => setPremium({ direction: v })} />
                </Field>
              )}
              <Field label="Tranzacții deschise odată">
                <Num value={form.premium.maxOpen} onChange={(v) => setPremium({ maxOpen: v })} />
              </Field>
              <Field label="Mărimea unei tranzacții">
                <Seg label="Mărimea" value={form.premium.sizing} options={[{ value: 'fixed', label: 'Sumă fixă' }, { value: 'risk', label: 'Risc %' }]} onChange={(v) => setPremium({ sizing: v })} />
              </Field>
              {form.premium.sizing === 'fixed' ? (
                <Field label={`Suma pe tranzacție (${cur}${futures ? ', marjă' : ''})`}>
                  <Num value={form.premium.amount} onChange={(v) => setPremium({ amount: v })} />
                </Field>
              ) : (
                <Field label="Riscul (% din suma maximă, la stop loss)">
                  <Num value={form.premium.riskPct} onChange={(v) => setPremium({ riskPct: v })} />
                </Field>
              )}
              {/* FD-BOTSLRR / FD-BOTPCT: Slingshot's levels as they are, or a stop and a take profit of one's own; never both. */}
              <Field label="Stop loss și take profit">
                <Seg
                  label="Stop loss și take profit"
                  value={form.premium.levels}
                  options={[{ value: 'slingshot', label: 'Slingshot' }, { value: 'percent', label: 'Risc / câștig' }]}
                  onChange={(v) => setPremium({ levels: v })}
                />
              </Field>
              <span className="hidden sm:block" />
              <p className="text-[12.5px] text-muted sm:col-span-2">
                Două variante care se exclud, nu merg împreună. <span className="text-text">Slingshot:</span> botul intră cu stop loss-ul și take profit-ul semnalului, exact ca pe grafic. Slingshot își calculează singur raportul risc / câștig, deci botul nu pune niciun R:R peste el.{' '}
                <span className="text-text">Risc / câștig:</span> nu respectă nivelurile Slingshot. Alegi tu până unde merge stop loss-ul și până unde merge take profit-ul, în procente de la intrare; raportul risc : câștig se calculează din ele (de exemplu 1% și 2% dau 1:2).
              </p>
              {form.premium.levels === 'percent' && (
                <>
                  <Field label="Stop loss (% de la intrare)">
                    <Num value={form.premium.slPct} onChange={(v) => setPremium({ slPct: v })} />
                  </Field>
                  <Field label="Take profit (% de la intrare)">
                    <Num value={form.premium.tpPct} onChange={(v) => setPremium({ tpPct: v })} />
                  </Field>
                  {/* Calculated from the two, risk first (1:2), never typed as one number. */}
                  <p className="text-[13px] text-muted sm:col-span-2">
                    Raportul risc : câștig: <span className="num text-text">{ratioOf(form.premium.slPct, form.premium.tpPct)}</span> (calculat din cele două procente).
                  </p>
                </>
              )}
              <Field label={`Suma maximă pe tranzacție (${cur})`} hint="Opțional.">
                <Num value={form.premium.maxPerTrade} onChange={(v) => setPremium({ maxPerTrade: v })} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <Check checked={form.premium.exitOnTpSignal} onChange={(on) => setPremium({ exitOnTpSignal: on })}>
                Ieși la semnalul de take profit Slingshot
              </Check>
              <Check checked={form.premium.exitOnFlip} onChange={(on) => setPremium({ exitOnFlip: on })}>
                Ieși când trendul se întoarce (invalidarea semnalului)
              </Check>
              <Check checked={form.premium.exitOnOpposite} onChange={(on) => setPremium({ exitOnOpposite: on })}>
                Închide la un semnal în direcția opusă
              </Check>
            </div>
          </Section>
          <Section title="Filtrul Sentiq">
            <p className="text-[12.5px] text-muted">
              Semnalul Slingshot e motivul intrării. Scorul pieței (0–100, 50 neutru) adună scorul zilei, aria, sentimentul pe 7 zile, știrile simbolului și structura pieței: un scor mare favorizează long-urile, unul mic short-urile. De aceea fiecare direcție are pragul ei.
            </p>
            {/* FD-BOTDIR: the thresholds of the sides the bot trades (as the direction above shows them); one side alone keeps the row's second cell empty. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {direction !== 'short' && (
                <Field label="Scorul minim pentru long">
                  <Num value={form.premium.longMin} onChange={(v) => setPremium({ longMin: v })} />
                </Field>
              )}
              {direction !== 'long' && (
                <Field label="Scorul maxim pentru short">
                  <Num value={form.premium.shortMax} onChange={(v) => setPremium({ shortMax: v })} />
                </Field>
              )}
              {direction !== 'both' && <span className="hidden sm:block" />}
              <p className="text-[12.5px] text-muted sm:col-span-2">{zoneText({ ...form.premium, direction })}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* FD-NEWSWIN: named by what it does; a row of its own (the name is long), the field one column wide. */}
              <Field
                label="Evită deschiderea de tranzacții în perioada știrilor economice importante"
                hint="Minutele dinaintea unei știri economice cu impact mare pentru dolar (și încă 15 după ea) în care botul nu deschide tranzacții. Pozițiile deschise merg normal. 0: oprit."
                className="sm:col-span-2"
              >
                <Num value={form.premium.newsWindowMin} onChange={(v) => setPremium({ newsWindowMin: v })} className="sm:w-[calc(50%-6px)]" />
              </Field>
              <Field label="Pauză după o pierdere (min)">
                <Num value={form.premium.cooldownMin} onChange={(v) => setPremium({ cooldownMin: v })} />
              </Field>
            </div>
            <Check checked={form.premium.areaVeto} onChange={(on) => setPremium({ areaVeto: on })}>
              Nu intra împotriva ariei ({stocks ? 'Acțiuni' : 'Crypto'}): long cu aria sub 40, short cu aria de la 60
            </Check>
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted select-none">Ponderile scorului</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
                {WEIGHT_KEYS.map((k) => (
                  <Field key={k} label={WEIGHT_RO[k]}>
                    <Num value={form.premium.weights[k]} onChange={(v) => setPremium({ weights: { ...form.premium.weights, [k]: v } })} />
                  </Field>
                ))}
              </div>
            </details>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="AI">
                <Seg label="AI" value={form.premium.ai} options={[{ value: 'off', label: 'Fără AI' }, { value: 'confirm', label: 'AI confirmă' }]} onChange={(v) => setPremium({ ai: v })} />
              </Field>
              {form.premium.ai === 'confirm' && (
                <Field label="Dacă AI-ul nu răspunde">
                  <select value={form.premium.aiFallback} onChange={(e) => setPremium({ aiFallback: e.target.value as 'skip' | 'rules' })}>
                    <option value="skip">Nu intra</option>
                    <option value="rules">Intră după reguli</option>
                  </select>
                </Field>
              )}
            </div>
            {form.premium.ai === 'confirm' && <p className="text-[12.5px] text-muted">Modelul din Setări → AI se uită la semnal, la scor, la știrile simbolului și la calendar înainte de fiecare intrare aprobată de reguli; poate doar să oprească o intrare.</p>}
          </Section>
        </>
      )}

      <Section title="Limitele">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {!(edit && edit.strategy === 'grid') && (
            <Field label={`Suma maximă (${cur})`} hint={form.strategy === 'grid' ? 'Investiția grilei.' : futures ? 'Marja angajată, cel mult.' : 'Valoarea angajată, cel mult.'}>
              <Num value={form.maxAmount} onChange={(v) => set({ maxAmount: v })} />
            </Field>
          )}
          {futures && !(edit && edit.strategy !== 'premium') && (
            <Field label={form.strategy === 'premium' ? 'Levierul maxim' : 'Levierul'}>
              <Num value={form.leverage} onChange={(v) => set({ leverage: v })} />
            </Field>
          )}
          <Field label={`Pierdere maximă pe zi (${cur})`} hint="Atinsă: nicio intrare până mâine.">
            <Num value={form.dailyLoss} onChange={(v) => set({ dailyLoss: v })} placeholder="fără" />
          </Field>
          <Field label={`Oprește la o pierdere de (${cur})`} hint="Închide tot și se oprește.">
            <Num value={form.lossStop} onChange={(v) => set({ lossStop: v })} placeholder="fără" />
          </Field>
          <Field label="Comision (%)" hint={form.exec === 'paper' ? 'Scăzut la fiecare execuție.' : 'Pentru câștigul afișat.'}>
            <Num value={form.fee} onChange={(v) => set({ fee: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Perioada">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!edit && (
            <Field label="Începe">
              <div className="flex flex-wrap items-center gap-2">
                <Seg label="Începe" value={form.startsAt === null ? 'now' : 'at'} options={[{ value: 'now', label: 'Acum' }, { value: 'at', label: 'La data' }]} onChange={(v) => set({ startsAt: v === 'now' ? null : '' })} />
                {form.startsAt !== null && <input type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} aria-label="Data începutului" className="min-w-0" />}
              </div>
            </Field>
          )}
          <Field label="Se termină">
            <div className="flex flex-wrap items-center gap-2">
              <Seg label="Se termină" value={form.endsAt === null ? 'never' : 'at'} options={[{ value: 'never', label: 'Fără sfârșit' }, { value: 'at', label: 'La data' }]} onChange={(v) => set({ endsAt: v === 'never' ? null : '' })} />
              {form.endsAt !== null && <input type="datetime-local" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} aria-label="Data sfârșitului" className="min-w-0" />}
            </div>
          </Field>
          <Field label="La sfârșit">
            <select value={form.endAction} onChange={(e) => set({ endAction: e.target.value as BotEndAction })}>
              {(form.strategy === 'grid' ? (['close', 'leave'] as const) : (['finish', 'close', 'leave'] as const)).map((a) => (
                <option key={a} value={a}>
                  {END_ACTION_RO[a]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {!edit && (
        <Section title="Ce va face botul">
          {error ? (
            <p className="text-[13px] text-bear">{error}</p>
          ) : check.isError ? (
            <p className="text-[13px] text-bear">{errorMessage(check.error)}</p>
          ) : !check.data ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Se verifică…
            </p>
          ) : (
            <CheckView check={check.data} currency={cur} />
          )}
        </Section>
      )}

      {form.exec === 'real' && !edit && account && (
        <Check checked={ack} onChange={setAck}>
          Înțeleg că botul trimite ordine reale în contul <strong>{account.label}</strong>
          {isDemoEnv(account.env) ? ' (DEMO)' : ''} și le închide el însuși, doar cât timp serverul Sentiq rulează.
        </Check>
      )}

      {save.error && (
        <div role="alert" className="rounded-[10px] border border-bear/40 bg-bear/[0.07] px-3 py-2.5 text-[13px]">
          {errorMessage(save.error)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {edit ? 'Salvează' : scheduled ? 'Programează botul' : 'Pornește botul'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Renunță
        </button>
      </div>
    </form>
  );
}

/** The server's word on the form: what the bot will do, the warnings and what stops it. */
function CheckView({ check, currency }: { check: BotCheck; currency: string }) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-text">
        {check.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {check.dca && check.dca.length > 1 && (
        <div className="overflow-x-auto rounded-[10px] border border-line">
          <table className="table [&_td]:align-middle">
            <thead>
              <tr>
                <th>Ordin</th>
                <th className="text-right">Abatere</th>
                <th className="text-right">Preț</th>
                <th className="text-right">Sumă</th>
                <th className="text-right">Preț mediu</th>
                <th className="text-right">Take profit</th>
              </tr>
            </thead>
            <tbody>
              {check.dca.map((o) => (
                <tr key={o.k}>
                  <td>{o.k === 0 ? 'Bază' : `Siguranță ${o.k}`}</td>
                  <td className="num text-right">{fmtNum(o.deviation, 2)}%</td>
                  <td className="num text-right">{fmtPrice(o.price, autoDigits(o.price))}</td>
                  <td className="num text-right">{fmtNum(o.amount, 2)}</td>
                  <td className="num text-right">{fmtPrice(o.avg, autoDigits(o.avg))}</td>
                  <td className="num text-right">{fmtPrice(o.tp, autoDigits(o.tp))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted">
        Capitalul folosit: <span className="num text-text">{fmtNum(check.capital, 2)}</span> {currency}
      </p>
      {check.warnings.map((w) => (
        <Warning key={w}>{w}</Warning>
      ))}
      {check.errors.map((e) => (
        <div key={e} role="alert" className="flex items-start gap-3 rounded-xl border border-bear/40 bg-bear/[0.06] px-4 py-3 text-[13.5px]">
          <span className="flex h-[1lh] shrink-0 items-center">
            <AlertTriangle size={18} className="text-bear" aria-hidden />
          </span>
          <div className="min-w-0">{e}</div>
        </div>
      ))}
    </div>
  );
}
