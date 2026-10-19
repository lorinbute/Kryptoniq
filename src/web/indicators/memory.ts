// The last settings of each indicator (FD-STUDYMEMORY): taken when it is saved or removed, given back when it is added.
import type { Study, StudyId, StudyMemoryEntry } from '../../shared/studies.ts';

/** What is remembered of one copy: everything but which copy it was and whether it was shown. */
export function memoryOf(st: Study): StudyMemoryEntry {
  return {
    id: st.id,
    inputs: st.inputs,
    ...(st.plots ? { plots: st.plots } : {}),
    ...(st.hlines ? { hlines: st.hlines } : {}),
    ...(st.height !== undefined ? { height: st.height } : {}),
  };
}

/** The memory with this indicator's entry replaced (or added). */
export function rememberStudy(list: readonly StudyMemoryEntry[], entry: StudyMemoryEntry): StudyMemoryEntry[] {
  return [...list.filter((m) => m.id !== entry.id), entry];
}

/** A new copy: with the remembered settings when there are any, else TradingView's; always shown. */
export function fromMemory(id: StudyId, list: readonly StudyMemoryEntry[], uid: string): Study {
  const m = list.find((x) => x.id === id);
  return {
    uid,
    id,
    inputs: m?.inputs ?? {},
    visible: true,
    ...(m?.plots ? { plots: m.plots } : {}),
    ...(m?.hlines ? { hlines: m.hlines } : {}),
    ...(m?.height !== undefined ? { height: m.height } : {}),
  };
}
