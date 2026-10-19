// Each user's own AI (FD-AIKEYS, TD-AIKEYS §3): the provider, model and key they chose, a client for them, the models
// their key can use, what it spent, and who has their news scored by it. Keys are kept by SettingsService (encrypted).
import { createHash } from 'node:crypto';
import { AI_PROVIDER_INFO, effectiveModel, type AiProvider } from '../../shared/ai.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../log.ts';
import { MAX_ITEM_AGE_MS } from '../news/normalize.ts';
import { checkAiKeyShape, LEGACY_CLAUDE_KEY, ValidationError, type SettingsService } from '../settings.ts';
import { AnthropicClient, type AnthropicSdk } from './anthropic.ts';
import { GeminiClient } from './gemini.ts';
import type { HttpDeps } from './http.ts';
import { listModels } from './models.ts';
import { OpenAiClient } from './openai.ts';
import { AiError, type AiClient } from './types.ts';
import { AiUsage } from './usage.ts';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /** The news are scored by this AI (else by the local model). */
  scoring: boolean;
  /** The user's key of `provider`, or null. */
  key: string | null;
}

export interface AiModelList {
  models: string[];
  /** 'key': the key's own list; 'default': Sentiq's list (no key, or the provider did not answer: `error`). */
  source: 'key' | 'default';
  error: string | null;
}

export interface AiServiceDeps {
  db: Db;
  settings: SettingsService;
  log: Logger;
  usage?: AiUsage;
  /** The network of the OpenAI and Gemini clients and of the model lists (tests). */
  http?: HttpDeps;
  /** Test hook: the client for a provider, key and model. */
  clientFactory?: (provider: AiProvider, key: string, model: string) => AiClient;
  /** Test hook: the Anthropic SDK of a key. */
  anthropicSdk?: (key: string) => AnthropicSdk;
  now?: () => number;
}

/** How long the users' AI choices are reused (another instance may change them, as with the settings). */
const CACHE_MS = 30_000;
const MODELS_MS = 3_600_000;

/** A short fingerprint of a key: a cache tells two keys apart without keeping them. */
export const keyPrint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

export class AiService {
  readonly usage: AiUsage;
  private readonly deps: AiServiceDeps;
  private readonly now: () => number;
  private readonly configs = new Map<number, { at: number; value: AiConfig }>();
  private readonly modelLists = new Map<string, { at: number; models: string[] }>();

  constructor(deps: AiServiceDeps) {
    this.deps = deps;
    this.usage = deps.usage ?? new AiUsage(deps.db);
    this.now = deps.now ?? Date.now;
  }

  /** The user's AI: their provider, the model to use and their key of that provider (null without one). */
  async config(userId: number): Promise<AiConfig> {
    const cached = this.configs.get(userId);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.value;
    const [s, keys] = await Promise.all([this.deps.settings.forUser(userId), this.deps.settings.getAiKeys(userId)]);
    const provider = s.ai.provider;
    const value: AiConfig = { provider, model: effectiveModel(provider, s.ai.model), scoring: s.ai.scoring, key: keys[provider] ?? null };
    this.configs.set(userId, { at: this.now(), value });
    return value;
  }

  /** The user's news are scored by their own AI: they chose it and have the key. */
  async isScoring(userId: number): Promise<boolean> {
    const c = await this.config(userId);
    return c.scoring && c.key !== null;
  }

  /** The users whose news their own AI scores (enabled accounts only). */
  async scoringUsers(): Promise<number[]> {
    const ids = (await this.deps.db.all<{ id: number }>('SELECT id FROM users WHERE disabled_at IS NULL ORDER BY id')).map((r) => r.id);
    const out: number[] = [];
    for (const id of ids) if (await this.isScoring(id)) out.push(id);
    return out;
  }

  /** The user chose another provider, model or scoring: read again (the key's model lists stay). */
  forgetChoice(userId: number): void {
    this.configs.delete(userId);
  }

  /** The user is gone (or tests): everything about them. */
  forget(userId?: number): void {
    if (userId === undefined) {
      this.configs.clear();
      this.modelLists.clear();
      return;
    }
    this.configs.delete(userId);
    for (const k of this.modelLists.keys()) if (k.startsWith(`${userId}|`)) this.modelLists.delete(k);
  }

  client(provider: AiProvider, key: string, model: string): AiClient {
    if (this.deps.clientFactory) return this.deps.clientFactory(provider, key, model);
    if (provider === 'openai') return new OpenAiClient(key, model, this.deps.http);
    if (provider === 'gemini') return new GeminiClient(key, model, this.deps.http);
    return new AnthropicClient(key, model, this.deps.anthropicSdk?.(key));
  }

  /**
   * Checks a new key with its provider (the model list: free) and saves it. A key the provider refuses is not saved
   * (400); one that cannot be checked now (no network, a busy provider) is saved, with `warning` saying so.
   */
  async setKey(userId: number, provider: AiProvider, key: string | null): Promise<{ warning: string | null }> {
    const k = (key ?? '').trim();
    let warning: string | null = null;
    if (k) {
      // The shape first: a malformed key is never sent anywhere.
      checkAiKeyShape(k);
      try {
        const models = await listModels(provider, k, this.deps.http);
        this.modelLists.set(`${userId}|${provider}|${keyPrint(k)}`, { at: this.now(), models });
      } catch (err) {
        if (err instanceof AiError && (err.kind === 'auth' || err.kind === 'permission')) {
          throw new ValidationError(`${AI_PROVIDER_INFO[provider].name} nu a acceptat cheia: ${err.message}.`);
        }
        warning = `Cheia s-a salvat, dar nu a putut fi verificată acum (${err instanceof Error ? err.message : String(err)}).`;
        this.deps.log.warn(`ai: the ${provider} key of user ${userId} could not be checked: ${warning}`);
      }
    }
    await this.deps.settings.setAiKey(userId, provider, k || null);
    // The choice is read again; the model list just read stays (it is kept by the key's fingerprint).
    this.forgetChoice(userId);
    return { warning };
  }

  /** The models the user's key of `provider` can use (Sentiq's list without a key, or when the provider is down). */
  async models(userId: number, provider: AiProvider): Promise<AiModelList> {
    const fallback = AI_PROVIDER_INFO[provider].models.map((m) => m.id);
    const key = (await this.deps.settings.getAiKeys(userId))[provider];
    if (!key) return { models: fallback, source: 'default', error: null };
    const cacheKey = `${userId}|${provider}|${keyPrint(key)}`;
    const cached = this.modelLists.get(cacheKey);
    if (cached && this.now() - cached.at < MODELS_MS) return { models: cached.models, source: 'key', error: null };
    try {
      const models = await listModels(provider, key, this.deps.http);
      if (!models.length) return { models: fallback, source: 'default', error: 'lista de modele a cheii e goală' };
      this.modelLists.set(cacheKey, { at: this.now(), models });
      return { models, source: 'key', error: null };
    } catch (err) {
      return { models: fallback, source: 'default', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run once at start-up (FD-AIKEYS §4): the admin's Claude key and engine, until now everyone's, become the admin's
   * own; the Claude scores already given become the admin's, and the last days' are scored again by the local model
   * (the common one). Nothing to do once the old key and engine are gone. True when it moved something.
   */
  async migrateLegacy(adminId: number): Promise<boolean> {
    const { db } = this.deps;
    const moved = await db.tx(async () => {
      const rows = await db.all<{ key: string; value: string }>('SELECT [key], value FROM settings WHERE [key] IN (?, ?)', ['app', LEGACY_CLAUDE_KEY]);
      const app = rows.find((r) => r.key === 'app');
      const claudeKey = rows.find((r) => r.key === LEGACY_CLAUDE_KEY)?.value ?? null;
      let global: Record<string, unknown> = {};
      try {
        const v = app ? (JSON.parse(app.value) as unknown) : {};
        if (v && typeof v === 'object' && !Array.isArray(v)) global = v as Record<string, unknown>;
      } catch {
        global = {};
      }
      const legacy = global.sentiment && typeof global.sentiment === 'object' ? (global.sentiment as { engine?: unknown; claudeModel?: unknown }) : null;
      if (!legacy && claudeKey === null) return false;
      // The key, encrypted as it was (same master key).
      if (claudeKey !== null) {
        await db.run(
          `IF NOT EXISTS (SELECT 1 FROM user_keys WHERE user_id = @u AND name = N'anthropic')
             INSERT INTO user_keys(user_id, name, secret, updated_at) VALUES (@u, N'anthropic', @s, @t)`,
          { u: adminId, s: claudeKey, t: this.now() },
        );
      }
      // The engine and the model chosen for everyone become the admin's own choice (the rest of their settings stay).
      if (legacy) {
        const own = await db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ?', [adminId]);
        let mine: Record<string, unknown> = {};
        try {
          const v = own ? (JSON.parse(own.value) as unknown) : {};
          if (v && typeof v === 'object' && !Array.isArray(v)) mine = v as Record<string, unknown>;
        } catch {
          mine = {};
        }
        const model = typeof legacy.claudeModel === 'string' ? legacy.claudeModel : undefined;
        mine.ai = { provider: 'anthropic', ...(model ? { model: effectiveModel('anthropic', model) } : {}), scoring: legacy.engine === 'claude' && claudeKey !== null };
        await db.run('UPDATE user_settings SET value = @v WHERE user_id = @u; IF @@ROWCOUNT = 0 INSERT INTO user_settings(user_id, value) VALUES (@u, @v)', { u: adminId, v: JSON.stringify(mine) });
      }
      // Claude's scores become the admin's; the days that can still change get the local model's.
      await db.run(
        `INSERT INTO news_ai_scores(user_id, news_id, score, label, engine, impact, scored_at)
         SELECT @u, n.id, n.sentiment, n.sentiment_label, n.sentiment_engine, n.sentiment_impact, COALESCE(n.scored_at, n.fetched_at)
         FROM news n
         WHERE n.sentiment_engine LIKE N'claude:%' AND n.sentiment IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM news_ai_scores a WHERE a.user_id = @u AND a.news_id = n.id)`,
        { u: adminId },
      );
      await db.run(
        `UPDATE news SET sentiment = NULL, sentiment_label = NULL, sentiment_engine = NULL, sentiment_meta = NULL, sentiment_impact = NULL, scored_at = NULL
         WHERE sentiment_engine LIKE N'claude:%' AND published_at >= @since`,
        { since: this.now() - MAX_ITEM_AGE_MS - 86_400_000 },
      );
      if (legacy) {
        const { sentiment: _, ...rest } = global;
        await db.run('UPDATE settings SET value = ? WHERE [key] = ?', [JSON.stringify(rest), 'app']);
      }
      await db.run('DELETE FROM settings WHERE [key] = ?', [LEGACY_CLAUDE_KEY]);
      // What the old key spent today was everyone's: not the admin's to see as their own.
      await db.run("DELETE FROM market_cache WHERE [key] = N'claude:usage'");
      return true;
    });
    if (moved) {
      this.deps.settings.forget();
      this.forget();
    }
    return moved;
  }
}
