// The three providers' clients and model lists (TD-AIKEYS §2), on fake answers shaped as each provider documents them:
// nothing leaves the machine.
import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AnthropicClient, fromAnthropic } from './anthropic.ts';
import { GeminiClient, geminiKind } from './gemini.ts';
import { jsonSchemaOf, type HttpDeps } from './http.ts';
import { listModels, usableModels } from './models.ts';
import { OpenAiClient, openAiKind } from './openai.ts';
import { AiError, type AiRequest } from './types.ts';

const schema = z.object({ results: z.array(z.object({ n: z.number().describe('number'), score: z.number() })) });
const req = (over: Partial<AiRequest<z.infer<typeof schema>>> = {}): AiRequest<z.infer<typeof schema>> => ({
  system: 'SYS',
  prompt: 'PROMPT',
  schema,
  name: 'scores',
  maxTokens: 1000,
  effort: 'low',
  timeoutMs: 5000,
  ...over,
});

interface Call {
  url: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/** A fake network: each call gets the next answer (a status and a JSON body, or an error to throw). */
function net(...answers: ({ status?: number; body: unknown; headers?: Record<string, string> } | Error)[]): HttpDeps & { calls: Call[]; waits: number[] } {
  const calls: Call[] = [];
  const waits: number[] = [];
  return {
    calls,
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      const a = answers.shift();
      if (!a) throw new Error('no more answers');
      if (a instanceof Error) throw a;
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json', ...a.headers } });
    }) as typeof fetch,
  };
}

const answer = { results: [{ n: 1, score: 0.5 }] };

describe('the JSON Schema sent to the providers', () => {
  it("is zod's, closed on every object, without the $schema line", () => {
    expect(jsonSchemaOf(schema)).toEqual({
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: { type: 'object', properties: { n: { type: 'number', description: 'number' }, score: { type: 'number' } }, required: ['n', 'score'], additionalProperties: false },
        },
      },
      required: ['results'],
      additionalProperties: false,
    });
  });
});

describe('OpenAI (Responses API)', () => {
  it('asks for a strict JSON Schema, nothing stored, with the effort; reads the text and the tokens', async () => {
    const n = net({
      body: {
        status: 'completed',
        output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
        ],
        usage: { input_tokens: 120, output_tokens: 40 },
      },
    });
    const out = await new OpenAiClient('sk-test', 'gpt-6-luna', n).generate(req());
    expect(out).toEqual({ parsed: answer, stop: 'done', usage: { input: 120, output: 40 } });
    expect(n.calls[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(n.calls[0]!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(n.calls[0]!.body).toMatchObject({
      model: 'gpt-6-luna',
      instructions: 'SYS',
      input: 'PROMPT',
      max_output_tokens: 1000,
      store: false,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'scores', strict: true, schema: { type: 'object', additionalProperties: false } } },
    });
  });

  it('says a refusal, a cut-off answer and a filtered one apart from an answer', async () => {
    const refusal = net({ body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }], usage: { input_tokens: 5, output_tokens: 3 } } });
    expect(await new OpenAiClient('k', 'gpt-6-luna', refusal).generate(req())).toEqual({ parsed: null, stop: 'refusal', usage: { input: 5, output: 3 } });
    const cut = net({ body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"res' }] }] } });
    expect(await new OpenAiClient('k', 'gpt-6-luna', cut).generate(req())).toMatchObject({ parsed: null, stop: 'max_tokens', usage: null });
    const filtered = net({ body: { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] } });
    expect((await new OpenAiClient('k', 'gpt-6-luna', filtered).generate(req())).stop).toBe('refusal');
    const off = net({ body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"results": "nope"}' }] }] } });
    expect((await new OpenAiClient('k', 'gpt-6-luna', off).generate(req())).stop).toBe('other');
  });

  it('asks again without the reasoning setting when the model has none (once)', async () => {
    const n = net(
      { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: 'invalid_request_error', code: 'unsupported_parameter' } } },
      { body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] } },
      { body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] } },
    );
    const client = new OpenAiClient('k', 'gpt-4.1', n);
    expect((await client.generate(req())).parsed).toEqual(answer);
    await client.generate(req());
    expect(n.calls.map((c) => 'reasoning' in (c.body ?? {}))).toEqual([true, false, false]);
  });

  it('tells an empty account, a wrong key and an unknown model apart; retries a busy provider, not a wrong key', async () => {
    expect(openAiKind(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } })).toBe('quota');
    expect(openAiKind(429, { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } })).toBe('rate');
    expect(openAiKind(404, { error: { message: 'The model `gpt-9` does not exist', code: 'model_not_found' } })).toBe('model');
    expect(openAiKind(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })).toBe('auth');
    const busy = net(
      { status: 429, body: { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '2' } },
      { status: 503, body: { error: { message: 'Service unavailable' } } },
      { body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] } },
    );
    expect((await new OpenAiClient('k', 'gpt-6-luna', busy).generate(req())).parsed).toEqual(answer);
    expect(busy.waits).toEqual([2000, 4000]);
    const wrong = net({ status: 401, body: { error: { message: 'Incorrect API key provided: sk-…', code: 'invalid_api_key' } } });
    const err = await new OpenAiClient('k', 'gpt-6-luna', wrong).generate(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ kind: 'auth', permanent: true, message: 'cheia API OpenAI nu este validă' });
    expect(wrong.calls).toHaveLength(1);
    const gone = net(new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed'));
    await expect(new OpenAiClient('k', 'gpt-6-luna', gone).generate(req())).rejects.toMatchObject({ kind: 'connection', message: 'nu se poate conecta la OpenAI (fetch failed)' });
    expect(gone.calls).toHaveLength(3);
  });

  it('stops when the caller gives up', async () => {
    const ctl = new AbortController();
    const n: HttpDeps = {
      fetch: ((_: unknown, init?: RequestInit) =>
        new Promise((_r, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          ctl.abort();
        })) as typeof fetch,
    };
    await expect(new OpenAiClient('k', 'gpt-6-luna', n).generate(req({ signal: ctl.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Google Gemini (generateContent)', () => {
  it('sends the key in a header, the schema and the thinking level; skips the thoughts; counts them as output', async () => {
    const n = net({
      body: {
        candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(answer) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 50, thoughtsTokenCount: 70 },
      },
    });
    const out = await new GeminiClient('AIza-test', 'gemini-3.8-flash', n).generate(req());
    expect(out).toEqual({ parsed: answer, stop: 'done', usage: { input: 300, output: 120 } });
    expect(n.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(n.calls[0]!.url).not.toContain('AIza');
    expect(n.calls[0]!.headers.get('x-goog-api-key')).toBe('AIza-test');
    expect(n.calls[0]!.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'PROMPT' }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1000, thinkingConfig: { thinkingLevel: 'low' }, responseJsonSchema: { type: 'object' } },
    });
  });

  it('sends no thinking level to 2.5, and drops it for a model that refuses it', async () => {
    const ok = { body: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] } };
    const old = net(ok);
    await new GeminiClient('k', 'gemini-2.5-flash', old).generate(req());
    expect(old.calls[0]!.body?.generationConfig).not.toHaveProperty('thinkingConfig');
    const refuses = net({ status: 400, body: { error: { code: 400, message: 'Invalid value at generation_config.thinking_config.thinking_level', status: 'INVALID_ARGUMENT' } } }, ok);
    expect((await new GeminiClient('k', 'gemini-3.6-flash', refuses).generate(req())).parsed).toEqual(answer);
    expect(refuses.calls[1]!.body?.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('says a blocked prompt, a safety stop and a cut-off answer apart', async () => {
    const blocked = net({ body: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 10 } } });
    expect(await new GeminiClient('k', 'gemini-3.8-flash', blocked).generate(req())).toEqual({ parsed: null, stop: 'refusal', usage: { input: 10, output: 0 } });
    const safety = net({ body: { candidates: [{ finishReason: 'SAFETY' }] } });
    expect((await new GeminiClient('k', 'gemini-3.8-flash', safety).generate(req())).stop).toBe('refusal');
    const cut = net({ body: { candidates: [{ content: { parts: [{ text: '{"res' }] }, finishReason: 'MAX_TOKENS' }] } });
    expect((await new GeminiClient('k', 'gemini-3.8-flash', cut).generate(req())).stop).toBe('max_tokens');
  });

  it("reads Google's errors: a bad key is a 400, a daily quota is not a per-minute one", () => {
    expect(geminiKind(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, '')).toBe('auth');
    expect(geminiKind(429, { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0', status: 'RESOURCE_EXHAUSTED' } }, '')).toBe('quota');
    expect(geminiKind(429, { error: { message: 'You exceeded your current quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, '')).toBe('quota');
    expect(geminiKind(429, { error: { message: 'You exceeded your current quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } }, '')).toBe('rate');
    expect(geminiKind(400, { error: { message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }, '')).toBe('permission');
    expect(geminiKind(404, { error: { message: 'models/gemini-9 is not found', status: 'NOT_FOUND' } }, '')).toBe('model');
    expect(geminiKind(503, { error: { message: 'The model is overloaded.', status: 'UNAVAILABLE' } }, '')).toBe('overloaded');
  });
});

describe('Anthropic (the SDK)', () => {
  it('scores through parse with the server-side fallback (not on Haiku), summarises through a stream', async () => {
    const parsed: unknown[] = [];
    const streamed: unknown[] = [];
    const sdk = {
      beta: { messages: { parse: async (p: unknown) => (parsed.push(p), { stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 3 }, parsed_output: answer }) } },
      messages: { stream: (p: unknown) => (streamed.push(p), { finalMessage: async () => ({ stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 99 }, parsed_output: null }) }) },
    } as never;
    expect(await new AnthropicClient('k', 'claude-opus-5-5', sdk).generate(req())).toEqual({ parsed: answer, stop: 'done', usage: { input: 7, output: 3 } });
    expect(parsed[0]).toMatchObject({ model: 'claude-opus-5-5', system: 'SYS', output_config: { effort: 'low' }, fallbacks: 'default' });
    await new AnthropicClient('k', 'claude-haiku-5-5', sdk).generate(req());
    expect(parsed[1]).not.toHaveProperty('fallbacks');
    expect(await new AnthropicClient('k', 'claude-opus-5-5', sdk).generate(req({ long: true, effort: 'medium' }))).toEqual({ parsed: null, stop: 'max_tokens', usage: { input: 9, output: 99 } });
    expect(streamed[0]).toMatchObject({ output_config: { effort: 'medium' } });
  });

  it("turns the SDK's errors into the same Romanian ones", () => {
    const h = new Headers();
    expect(fromAnthropic(new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', h))).toMatchObject({ kind: 'auth', message: 'cheia API Anthropic nu este validă' });
    const body = (message: string) => ({ type: 'error', error: { type: 'invalid_request_error', message } });
    expect(fromAnthropic(new Anthropic.BadRequestError(400, body('Your credit balance is too low to access the Anthropic API.'), undefined, h))).toMatchObject({ kind: 'quota' });
    expect(fromAnthropic(new Anthropic.BadRequestError(400, body('max_tokens: too large'), undefined, h))).toMatchObject({ kind: 'bad_request', message: 'cerere respinsă de Anthropic: max_tokens: too large' });
    expect(fromAnthropic(new Anthropic.NotFoundError(404, { type: 'error' }, 'model: claude-x', h), 'claude-x')).toMatchObject({
      kind: 'model',
      message: 'modelul claude-x nu există sau nu e disponibil pentru cheia ta Anthropic',
    });
    expect(fromAnthropic(new Anthropic.InternalServerError(529, { type: 'error' }, 'Overloaded', h))).toMatchObject({ kind: 'overloaded', transient: true });
    const plain = new Error('x');
    expect(fromAnthropic(plain)).toBe(plain);
  });
});

describe('the models a key can use', () => {
  it("keeps each provider's text models, the current ones first", () => {
    expect(usableModels('anthropic', ['claude-haiku-5-5', 'claude-3-haiku-20240307', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-4-1-20250805'])).toEqual([
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
    ]);
    expect(usableModels('gemini', ['gemini-3.8-flash', 'gemini-3.8-flash-tts', 'gemini-2.0-flash', 'gemini-3.6-flash', 'gemini-4-argon', 'text-embedding-004'])).toEqual([
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-3.6-flash',
    ]);
  });

  it("reads each provider's list with the key where it belongs (Gemini page by page)", async () => {
    const a = net({ body: { data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false } });
    expect(await listModels('anthropic', 'sk-ant-x', a)).toEqual(['claude-opus-5-5']);
    expect(a.calls[0]!.headers.get('x-api-key')).toBe('sk-ant-x');
    expect(a.calls[0]!.headers.get('anthropic-version')).toBe('2023-06-01');
    const g = net(
      { body: { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] }], nextPageToken: 'p2' } },
      { body: { models: [{ name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-4-argon', supportedGenerationMethods: ['generateContent'] }] } },
    );
    expect(await listModels('gemini', 'AIza-x', g)).toEqual(['gemini-3.8-flash', 'gemini-4-argon']);
    expect(g.calls[1]!.url).toContain('pageToken=p2');
    const refused = net({ status: 401, body: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } } });
    await expect(listModels('openai', 'sk-bad', refused)).rejects.toMatchObject({ kind: 'auth' });
  });
});
