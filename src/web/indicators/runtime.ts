// Loading the indicator code (TD-INDICATORS §5): once, when the chart has an indicator to draw or the list is opened.
import { useEffect, useState } from 'react';

export type StudyRuntime = typeof import('./runtime-impl.ts');

let loading: Promise<StudyRuntime> | null = null;
let loaded: StudyRuntime | null = null;

/** The indicator chunk; a failed load (offline) is tried again on the next call. */
export function loadStudyRuntime(): Promise<StudyRuntime> {
  loading ??= import('./runtime-impl.ts').then(
    (m) => (loaded = m),
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** The runtime once `needed` (null until then, or while it loads); `error` when the chunk could not be loaded. */
export function useStudyRuntime(needed: boolean): { runtime: StudyRuntime | null; error: unknown } {
  const [state, setState] = useState<{ runtime: StudyRuntime | null; error: unknown }>({ runtime: loaded, error: null });
  useEffect(() => {
    if (!needed || state.runtime) return;
    let live = true;
    loadStudyRuntime().then(
      (runtime) => live && setState({ runtime, error: null }),
      (error: unknown) => live && setState({ runtime: null, error }),
    );
    return () => {
      live = false;
    };
  }, [needed, state.runtime]);
  return state;
}
