// The AI providers a user can bring their own key for (FD-AIKEYS): the day summary always, the news scores if they
// choose. Shared by the server (validation, defaults) and the web (the settings panel).

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiModelInfo {
  id: string;
  label: string;
  /** Short Romanian note shown next to it ("cel mai capabil", "cel mai ieftin"…). */
  note?: string;
}

export interface AiProviderInfo {
  /** The company. */
  name: string;
  /** The models' family, as people know it. */
  product: string;
  keyPlaceholder: string;
  /** Where the key is made. */
  keysUrl: string;
  defaultModel: string;
  /** The current ones (16 Oct 2026), first the default; the key's own list (its `/models`) can offer more. */
  models: AiModelInfo[];
  /** Which model ids belong to the provider. */
  modelRe: RegExp;
}

export const AI_PROVIDER_INFO: Record<AiProvider, AiProviderInfo> = {
  anthropic: {
    name: 'Anthropic',
    product: 'Claude',
    keyPlaceholder: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'cel mai capabil' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'cel mai ieftin' },
    ],
    modelRe: /^claude-/,
  },
  openai: {
    name: 'OpenAI',
    product: 'ChatGPT',
    keyPlaceholder: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-6.1-sol',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'echilibrat' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'cel mai capabil' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'cel mai ieftin' },
    ],
    modelRe: /^(?:gpt-|o\d)/,
  },
  gemini: {
    name: 'Google',
    product: 'Gemini',
    keyPlaceholder: 'AIza…',
    keysUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'echilibrat' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', note: 'cel mai capabil' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'cel mai ieftin' },
    ],
    modelRe: /^gemini-/,
  },
};

/** What a model id looks like (any provider): checked before it is saved or sent anywhere. */
export const AI_MODEL_RE = /^[a-z0-9][a-z0-9._:-]{1,99}$/;

export const isAiProvider = (v: unknown): v is AiProvider => typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);

/** The model to use: the saved one when it is the provider's, else the provider's default. */
export function effectiveModel(provider: AiProvider, model: string | undefined): string {
  const info = AI_PROVIDER_INFO[provider];
  return model && AI_MODEL_RE.test(model) && info.modelRe.test(model) ? model : info.defaultModel;
}

/** The provider a model id belongs to (summaries keep only the model). */
export function providerOfModel(model: string): AiProvider | null {
  return AI_PROVIDERS.find((p) => AI_PROVIDER_INFO[p].modelRe.test(model)) ?? null;
}

/** "Claude Opus 5.5" for a known id, the id itself otherwise. */
export function modelLabel(model: string): string {
  for (const p of AI_PROVIDERS) {
    const m = AI_PROVIDER_INFO[p].models.find((x) => x.id === model);
    if (m) return m.label;
  }
  return model;
}

/**
 * The engine of a news score: 'local', 'rules', or '<provider>:<model>' for a user's own AI (the Anthropic ones keep
 * the 'claude:' prefix they always had).
 */
export function aiEngineId(provider: AiProvider, model: string): string {
  return `${provider === 'anthropic' ? 'claude' : provider}:${model}`;
}

/** "Claude (claude-haiku-5-5)", "Gemini (gemini-3.8-flash)", "model local + reguli"… for an engine id. */
export function engineLabel(engine: string): string {
  if (engine === 'local') return 'model local + reguli';
  if (engine === 'rules') return 'doar reguli';
  const m = /^(claude|openai|gemini):(.+)$/.exec(engine);
  if (!m) return engine;
  const product = m[1] === 'claude' ? 'Claude' : m[1] === 'openai' ? 'ChatGPT' : 'Gemini';
  return `${product} (${m[2]})`;
}
