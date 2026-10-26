// The "Boți" window of the charts (FD-BOT §1, §7): the user's bots, a new one (Clasic: Grid or DCA; Premium: Slingshot),
// a bot's page and its editing. A user without bots starts on the choice of a new one.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, Grid3x3, Layers, Plus, Sparkles } from 'lucide-react';
import { MAX_ACTIVE_BOTS, type BotDetail, type BotView } from '../../../shared/bot.ts';
import { api } from '../../api.ts';
import { Modal } from '../Modal.tsx';
import { ErrorNote, Loading } from '../ui.tsx';
import { BotDetailView } from './BotDetailView.tsx';
import { BotFormView, BOTS_KEY } from './BotFormView.tsx';
import { BotTags, Pnl, StatusMark } from './bot-ui.tsx';
import { formOf, initialForm, type BotForm, type BotSeed } from './bot-form.ts';

type View = { kind: 'list' } | { kind: 'choose' } | { kind: 'form'; form: BotForm } | { kind: 'detail'; id: number } | { kind: 'edit'; id: number; form: BotForm };

export function BotsDialog({ seed, onClose }: { seed: BotSeed; onClose: () => void }) {
  const list = useQuery({ queryKey: BOTS_KEY, queryFn: () => api.get<BotView[]>('/api/bots'), refetchInterval: 20_000 });
  const [view, setView] = useState<View | null>(null);
  // Without bots, the window opens on the choice of a new one.
  useEffect(() => {
    if (view === null && list.data) setView(list.data.length === 0 ? { kind: 'choose' } : { kind: 'list' });
  }, [view, list.data]);
  const detailId = view?.kind === 'detail' || view?.kind === 'edit' ? view.id : null;
  const detail = useQuery({ queryKey: ['bots', detailId], queryFn: () => api.get<BotDetail>(`/api/bots/${detailId}`), enabled: detailId !== null, refetchInterval: view?.kind === 'detail' ? 15_000 : false });
  const active = (list.data ?? []).filter((b) => b.status !== 'ended').length;
  const back = (
    <button type="button" className="btn mb-1 self-start" onClick={() => setView({ kind: 'list' })}>
      <ArrowLeft size={15} aria-hidden /> Boții mei
    </button>
  );

  const title =
    view?.kind === 'choose'
      ? 'Bot nou'
      : view?.kind === 'form'
        ? `Bot nou · ${view.form.strategy === 'grid' ? 'Grid' : view.form.strategy === 'dca' ? 'DCA' : 'Slingshot Premium'}`
        : view?.kind === 'detail'
          ? (detail.data?.name ?? 'Bot')
          : view?.kind === 'edit'
            ? `Editează · ${detail.data?.name ?? ''}`
            : 'Boți';

  let body: React.ReactNode;
  if (!view) body = list.isError ? <ErrorNote error={list.error} onRetry={() => list.refetch()} /> : <Loading />;
  else if (view.kind === 'list')
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-muted">
            {active} {active === 1 ? 'bot activ' : 'boți activi'} din {MAX_ACTIVE_BOTS}
          </span>
          <button className="btn btn-primary" disabled={active >= MAX_ACTIVE_BOTS} title={active >= MAX_ACTIVE_BOTS ? `Cel mult ${MAX_ACTIVE_BOTS} boți activi` : undefined} onClick={() => setView({ kind: 'choose' })}>
            <Plus size={15} aria-hidden /> Bot nou
          </button>
        </div>
        {(list.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">Niciun bot încă.</p>
        ) : (
          <ul className="rows flex flex-col overflow-hidden rounded-[10px] border border-line">
            {(list.data ?? []).map((b) => (
              <li key={b.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 py-3 text-left" onClick={() => setView({ kind: 'detail', id: b.id })}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[13.5px] font-semibold">{b.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <BotTags bot={b} />
                      <StatusMark status={b.status} />
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5 text-[13px]">
                    <Pnl value={b.realized + (b.unrealized ?? 0)} currency={b.currency} className="font-semibold" />
                    <span className="text-[12px] text-faint">
                      {b.trades} {b.trades === 1 ? 'tranzacție' : 'tranzacții'}
                      {b.openPositions > 0 ? ` · ${b.openPositions} deschise` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  else if (view.kind === 'choose')
    body = (
      <div className="flex flex-col gap-4">
        {(list.data ?? []).length > 0 && back}
        <p className="text-[13px] text-muted">
          Pentru <span className="num text-text">{seed.symbol}</span>. Alege un tip: cele clasice sunt setările obișnuite ale boților; Premium e metoda Sentiq. Nu se combină.
        </p>
        <div className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-semibold tracking-wide text-faint uppercase">Clasic</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Choice icon={Grid3x3} title="Grid" text="Cumpără sub preț și vinde peste, pe linii între o limită de jos și una de sus. Câștigă din oscilații." onClick={() => setView({ kind: 'form', form: initialForm(seed, 'grid') })} />
            <Choice icon={Layers} title="DCA" text="Un ordin de bază și ordine de siguranță la scăderi; take profit din prețul mediu, în cicluri." onClick={() => setView({ kind: 'form', form: initialForm(seed, 'dca') })} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-semibold tracking-wide text-faint uppercase">Premium</h3>
          <Choice
            icon={Sparkles}
            title="Slingshot + sentimentul Sentiq"
            text="Intră pe semnalele Slingshot doar când scorul pieței (scorul zilei, aria, sentimentul general, știrile simbolului și structura) e de partea lor: long-urile de la pragul lor în sus, short-urile de la pragul lor în jos; opțional, AI-ul tău confirmă. Ieșirea: SL-ul și TP-ul semnalului, sau ale tale, în procente de la intrare (de exemplu 1% și 2%, adică 1:2)."
            onClick={() => setView({ kind: 'form', form: initialForm(seed, 'premium') })}
          />
        </div>
      </div>
    );
  else if (view.kind === 'form')
    body = (
      <div className="flex flex-col gap-3">
        <button type="button" className="btn mb-1 self-start" onClick={() => setView({ kind: 'choose' })}>
          <ArrowLeft size={15} aria-hidden /> Alt tip
        </button>
        <BotFormView form={view.form} setForm={(form) => setView({ kind: 'form', form })} edit={null} onDone={(b) => setView({ kind: 'detail', id: b.id })} onCancel={() => setView({ kind: 'list' })} />
      </div>
    );
  else if (!detail.data) body = detail.isError ? <ErrorNote error={detail.error} onRetry={() => detail.refetch()} /> : <Loading />;
  else if (view.kind === 'detail')
    body = (
      <div className="flex flex-col gap-3">
        {back}
        <BotDetailView
          bot={detail.data}
          onEdit={() => setView({ kind: 'edit', id: view.id, form: formOf(detail.data!.input) })}
          onCopy={() => {
            const form = formOf(detail.data!.input);
            setView({ kind: 'form', form: { ...form, name: `${form.name} (copie)`.slice(0, 60), endsAt: null } });
          }}
          onDeleted={() => setView({ kind: 'list' })}
        />
      </div>
    );
  else
    body = (
      <div className="flex flex-col gap-3">
        <button type="button" className="btn mb-1 self-start" onClick={() => setView({ kind: 'detail', id: view.id })}>
          <ArrowLeft size={15} aria-hidden /> Înapoi
        </button>
        <BotFormView form={view.form} setForm={(form) => setView({ kind: 'edit', id: view.id, form })} edit={detail.data} onDone={(b) => setView({ kind: 'detail', id: b.id })} onCancel={() => setView({ kind: 'detail', id: view.id })} />
      </div>
    );

  return (
    <Modal
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Bot size={18} className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">{title}</span>
        </span>
      }
      onClose={onClose}
      width={780}
    >
      {body}
    </Modal>
  );
}

function Choice({ icon: Icon, title, text, onClick }: { icon: typeof Bot; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className="flex items-start gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3.5 text-left transition-colors hover:border-accent hover:bg-hover" onClick={onClick}>
      <span className="flex h-[1lh] shrink-0 items-center text-[14px]">
        <Icon size={18} className="text-accent" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[12.5px] text-muted">{text}</span>
      </span>
    </button>
  );
}
