// The indicators of the chart on screen (FD-INDICATORS §2, §5; TD-INDICATORS §6–§7): their inputs checked, the extra
// bars they read loaded, and each one calculated in turn, off the click that changed it, so the page stays fluid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Bar } from 'oakscriptjs';
import type { CandlesResult } from '../../shared/api-types.ts';
import type { Candle } from '../../shared/indicator/slingshot.ts';
import type { Study, StudyId } from '../../shared/studies.ts';
import type { Timeframe } from '../../shared/time.ts';
import { api, qs } from '../api.ts';
import { chartContext, runStudy, sanitizeInputs, toBars, type ChartInfo, type StudyRun } from './compute.ts';
import { monthlyBars, planRun, resolveRequest, type ExtraLoad, type LoadState, type Resolved } from './extra-bars.ts';
import type { StudyRuntime } from './runtime.ts';

export interface StudyState extends StudyRun {
  uid: string;
  id: StudyId;
  /** The inputs it ran with (saved values that fit, the defaults for the rest). */
  inputs: Record<string, unknown>;
  /** Another symbol's bars are still loading: nothing to draw yet. */
  waiting: boolean;
}

export interface StudiesEnv {
  /** The chart's candle limit. */
  chartLimit: number;
  /** Timeframes of the chart's source (null: unknown). */
  chartTfs: readonly Timeframe[] | null;
  /** Timeframes a stock has for this user (null: unknown). */
  stockTfs: readonly Timeframe[] | null;
}

interface Plan {
  study: Study;
  inputs: Record<string, unknown>;
  resolved: Resolved[] | null;
}

/** What identifies the candles for a recalculation: their number, first and last time, last close. */
const barsSig = (bars: readonly Bar[]) => (bars.length ? `${bars.length}|${bars[0]?.time}|${bars.at(-1)?.time}|${bars.at(-1)?.close}` : '0');

const EXTRA_REFRESH_MS = 5 * 60_000;

export function useStudies({
  runtime,
  studies,
  info,
  candles,
  env,
  visibleRange,
}: {
  runtime: StudyRuntime | null;
  studies: readonly Study[];
  info: ChartInfo | null;
  candles: readonly Candle[] | null;
  env: StudiesEnv;
  /** Times (ms) of the first and last visible bar, for the indicators that read them; null when none does. */
  visibleRange: { from: number; to: number } | null;
}): ReadonlyMap<string, StudyState> {
  const bars = useMemo(() => (candles ? toBars(candles) : null), [candles]);
  const infoKey = info ? `${info.kind}|${info.exchange}|${info.symbol}|${info.tf}|${info.precision}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => (info ? chartContext(info) : null), [infoKey]);
  const visible = useMemo(() => studies.filter((s) => s.visible), [studies]);
  const spanSec = bars && bars.length > 1 ? (bars.at(-1)?.time ?? 0) - (bars[0]?.time ?? 0) : 0;
  const envKey = `${env.chartLimit}|${env.chartTfs?.join(',') ?? '*'}|${env.stockTfs?.join(',') ?? '*'}|${Math.round(spanSec / 3600)}`;

  // Inputs and extra requests of each visible indicator.
  const plans = useMemo((): Plan[] => {
    if (!runtime || !ctx || !info) return [];
    return visible.map((study) => {
      const mod = runtime.STUDY_MODULES[study.id];
      const inputs = sanitizeInputs(mod, study.inputs);
      let resolved: Resolved[] | null = null;
      if (mod.requiredSymbols) {
        let requests: { symbol: string; timeframe: string }[] = [];
        try {
          requests = mod.requiredSymbols(inputs, ctx);
        } catch {
          requests = [];
        }
        resolved = requests.map((r) => resolveRequest(r, { info, spanSec, chartLimit: env.chartLimit, chartTfs: env.chartTfs, stockTfs: env.stockTfs }));
      }
      return { study, inputs, resolved };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, ctx, visible, envKey]);

  // The extra bars, once per load (several indicators may read the same).
  const loads = useMemo(() => {
    const byKey = new Map<string, ExtraLoad>();
    for (const p of plans) for (const r of p.resolved ?? []) if (r.load) byKey.set(r.load.key, r.load);
    return [...byKey.values()];
  }, [plans]);
  const queries = useQueries({
    queries: loads.map((l) => ({
      queryKey: ['candles', l.asset === 'crypto' ? (l.exchange ?? '') : l.asset, l.symbol, l.tf, l.limit],
      queryFn: () =>
        api.get<CandlesResult>(`/api/market/candles${qs({ ...(l.asset === 'crypto' ? { exchange: l.exchange } : { asset: l.asset }), symbol: l.symbol, tf: l.tf, limit: l.limit })}`),
      refetchInterval: EXTRA_REFRESH_MS,
      retry: 1,
    })),
  });
  const loadStates = useMemo(() => {
    const out = new Map<string, LoadState>();
    loads.forEach((l, i) => {
      const q = queries[i];
      if (q?.data) {
        const b = toBars(q.data.candles);
        out.set(l.key, { bars: l.monthly ? monthlyBars(b, l.timezone) : b });
      } else out.set(l.key, q?.isError ? 'failed' : 'loading');
    });
    return out;
    // `queries` is a new array on every render: its content is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, queries.map((q) => `${q.dataUpdatedAt}|${q.status}`).join(',')]);

  // Each indicator calculated in turn; a result is kept until something it reads changes.
  const cache = useRef(new Map<string, { key: string; state: StudyState }>());
  const [states, setStates] = useState<ReadonlyMap<string, StudyState>>(() => new Map());
  const generation = useRef(0);
  const sig = bars ? barsSig(bars) : '';
  const visKey = visibleRange ? `${visibleRange.from}|${visibleRange.to}` : '';
  useEffect(() => {
    const gen = ++generation.current;
    if (!runtime || !ctx || !bars) {
      setStates((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const out = new Map<string, StudyState>();
    const keep = new Set<string>();
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      if (gen !== generation.current) return;
      const started = performance.now();
      // Several quick ones per macrotask; a slow one yields to the page before the next.
      while (i < plans.length && performance.now() - started < 12) {
        const p = plans[i++] as Plan;
        const mod = runtime.STUDY_MODULES[p.study.id];
        const loadSig = (p.resolved ?? []).map((r) => {
          const s = r.load ? loadStates.get(r.load.key) : 'none';
          return typeof s === 'object' ? `${r.load?.key}:${barsSig(s.bars)}` : `${r.load?.key ?? '-'}:${s}`;
        });
        const key = JSON.stringify([p.study.id, p.inputs, sig, loadSig, mod.usesVisibleRange ? visKey : '']);
        keep.add(p.study.uid);
        const hit = cache.current.get(p.study.uid);
        if (hit && hit.key === key) {
          out.set(p.study.uid, hit.state);
          continue;
        }
        const c = { ...ctx } as typeof ctx & Record<string, unknown>;
        if (mod.usesVisibleRange && visibleRange) {
          c.leftVisibleBarTime = visibleRange.from;
          c.rightVisibleBarTime = visibleRange.to;
        }
        let state: StudyState;
        const base = { uid: p.study.uid, id: p.study.id, inputs: p.inputs };
        const plan = p.resolved ? planRun(p.resolved, loadStates) : null;
        if (plan?.mode === 'wait') {
          state = { ...base, result: null, error: null, approximated: false, missing: null, waiting: true };
        } else {
          if (plan?.mode === 'bars') c.bars = plan.bars;
          state = { ...base, ...runStudy(mod, p.study.id, bars, p.inputs, c, plan?.mode === 'approximate'), waiting: false };
        }
        cache.current.set(p.study.uid, { key, state });
        out.set(p.study.uid, state);
      }
      if (i < plans.length) {
        timer = setTimeout(step, 0);
        return;
      }
      for (const uid of [...cache.current.keys()]) if (!keep.has(uid)) cache.current.delete(uid);
      // Nothing recalculated: the same map stays (the chart is not redrawn for nothing).
      setStates((prev) => (prev.size === out.size && [...out].every(([uid, s]) => prev.get(uid) === s) ? prev : out));
    };
    step();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [runtime, ctx, bars, sig, plans, loadStates, visKey, visibleRange]);
  return states;
}
