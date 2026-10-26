// The models a key can use (FD-AIKEYS §2), from the provider's own list: free to ask, so it also checks a new key
// before it is saved. Only the text models worth offering are kept, the current ones (shared/ai.ts) first.
import { z } from 'zod';
import { AI_PROVIDER_INFO, type AiProvider } from '../../shared/ai.ts';
import { explainGemini, GEMINI_URL, geminiKind } from './gemini.ts';
import { callJson, kindOfStatus, type HttpDeps } from './http.ts';
import { OPENAI_URL, openAiKind } from './openai.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1';
const TIMEOUT_MS = 15_000;

const idList = z.object({ data: z.array(z.object({ id: z.string() }).loose()) }).loose();
const geminiList = z
  .object({
    models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).nullish() }).loose()).nullish(),
    nextPageToken: z.string().nullish(),
  })
  .loose();

/** Not chat models (audio, images, embeddings…), dated snapshots, and the old generations being retired. */
const SKIP: Record<AiProvider, RegExp> = {
  anthropic: /^claude-[1-3]-|-\d{8}$/,
  openai: /audio|realtime|transcribe|tts|image|search|codex|chat-latest|instruct|embedding|moderation|cyber|research|computer-use|oss|daybreak|^gpt-[34]|^o1|-\d{4}-\d{2}-\d{2}$/,
  gemini: /image|tts|live|embedding|robotics|audio|native|aqa|computer-use|^gemini-(?:1|2\.0)/,
};

/** The ids worth offering, the current ones (shared/ai.ts) first, then the others newest-looking first. */
export function usableModels(provider: AiProvider, ids: string[]): string[] {
  const info = AI_PROVIDER_INFO[provider];
  const ok = [...new Set(ids)].filter((id) => info.modelRe.test(id) && !SKIP[provider].test(id));
  const known = info.models.map((m) => m.id).filter((id) => ok.includes(id));
  const rest = ok.filter((id) => !known.includes(id)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return [...known, ...rest];
}

/** The key's model list (throws `AiError`: an invalid key says so here). */
export async function listModels(provider: AiProvider, key: string, deps: HttpDeps = {}, signal?: AbortSignal): Promise<string[]> {
  if (provider === 'anthropic') {
    const body = await callJson(
      {
        provider,
        url: `${ANTHROPIC_URL}/models?limit=1000`,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        timeoutMs: TIMEOUT_MS,
        signal,
        classify: (status) => kindOfStatus(status),
      },
      deps,
    );
    return usableModels(provider, idList.parse(body).data.map((m) => m.id));
  }
  if (provider === 'openai') {
    const body = await callJson({ provider, url: `${OPENAI_URL}/models`, headers: { Authorization: `Bearer ${key}` }, timeoutMs: TIMEOUT_MS, signal, classify: openAiKind }, deps);
    return usableModels(provider, idList.parse(body).data.map((m) => m.id));
  }
  const ids: string[] = [];
  let page: string | null | undefined;
  for (let i = 0; i < 5; i++) {
    const body = await callJson(
      {
        provider,
        url: `${GEMINI_URL}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
        headers: { 'x-goog-api-key': key },
        timeoutMs: TIMEOUT_MS,
        signal,
        classify: geminiKind,
        // FD-AIQUOTA: an empty Prepay balance said as such when the key is checked too (no model asked for here).
        explain: (kind, status, b, text) => explainGemini(kind, status, b, text, null),
      },
      deps,
    );
    const list = geminiList.parse(body);
    for (const m of list.models ?? []) {
      if ((m.supportedGenerationMethods ?? []).includes('generateContent')) ids.push(m.name.replace(/^models\//, ''));
    }
    page = list.nextPageToken;
    if (!page) break;
  }
  return usableModels(provider, ids);
}
