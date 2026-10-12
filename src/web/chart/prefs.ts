// Saving settings from the Charts page (TD-CHARTUX §4): optimistic for the quick toggles (timeframe, pair, LMA on/off,
// pane height), one request at a time so the last choice is the one the server keeps.
import type { QueryClient } from '@tanstack/react-query';
import type { SettingsView } from '../../shared/settings.ts';
import { api } from '../api.ts';

export type SettingsPatch = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge of plain objects (arrays and values are replaced); prototype keys are ignored. */
export function mergePatch<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = mergePatch(out[k], v);
  }
  return out as T;
}

interface Job {
  patch: SettingsPatch;
  optimistic: boolean;
  waiters: { resolve: (s: SettingsView) => void; reject: (e: unknown) => void }[];
}

const queue: Job[] = [];
let running = false;

/**
 * Saves a partial settings update. `optimistic` applies it to the cache at once (for toggles whose values are always
 * valid); otherwise the cache changes only with the server's answer (forms, where the server may refuse a value).
 * Consecutive optimistic patches waiting for their turn are merged into one request.
 */
export function saveSettingsPatch(qc: QueryClient, patch: SettingsPatch, opts: { optimistic?: boolean } = {}): Promise<SettingsView> {
  const optimistic = opts.optimistic ?? true;
  if (optimistic) {
    void qc.cancelQueries({ queryKey: ['settings'] });
    qc.setQueryData<SettingsView>(['settings'], (old) => (old ? mergePatch(old, patch) : old));
  }
  return new Promise<SettingsView>((resolve, reject) => {
    const last = queue.at(-1);
    if (optimistic && last?.optimistic) {
      last.patch = mergePatch(last.patch, patch);
      last.waiters.push({ resolve, reject });
    } else {
      queue.push({ patch, optimistic, waiters: [{ resolve, reject }] });
    }
    if (!running) void flush(qc);
  });
}

async function flush(qc: QueryClient): Promise<void> {
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const saved = await api.put<SettingsView>('/api/settings', job.patch);
        // A newer optimistic change may still be waiting: its own answer will bring the final state.
        if (!queue.some((j) => j.optimistic)) qc.setQueryData(['settings'], saved);
        for (const w of job.waiters) w.resolve(saved);
      } catch (err) {
        for (const w of job.waiters) w.reject(err);
        // The cache may hold an optimistic value the server refused: read the truth back.
        if (job.optimistic) void qc.invalidateQueries({ queryKey: ['settings'] });
      }
    }
  } finally {
    running = false;
  }
}
