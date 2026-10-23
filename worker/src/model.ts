import type { Env } from './env';
import { fixtureModel } from './fixtureModel';
import type { ChatPrompt } from './prompts';

export interface ChatModel {
  /** Returns the raw text content of the reply. */
  complete(prompt: ChatPrompt, maxTokens: number): Promise<string>;
}

// --- Errors ------------------------------------------------------------------

export type ProviderErrorKind =
  | 'no_key'
  | 'unknown_provider'
  | 'invalid_key'
  | 'no_credit'
  | 'rate_limited'
  | 'model_unavailable'
  | 'unavailable'
  | 'bad_output'
  | 'demo_cap';

function reason(kind: ProviderErrorKind, name: string): string {
  switch (kind) {
    case 'no_key':
      return 'No model API key. Run "ownit key set" with a Nebius or NVIDIA key.';
    case 'unknown_provider':
      return 'The server does not support that key\'s provider. Run "ownit key set" again.';
    case 'invalid_key':
      return `${name} rejected the API key. Check it with "ownit key set".`;
    case 'no_credit':
      return `Your ${name} account has no credit left.`;
    case 'rate_limited':
      return `${name} is rate limiting this key. Try again in a minute.`;
    case 'model_unavailable':
      return `${name} says this key's account can't use the Nemotron model. Make a key on the model's page (build.nvidia.com for NVIDIA), or switch provider with "ownit key set".`;
    case 'unavailable':
      return `${name} is unreachable right now.`;
    case 'bad_output':
      return 'The model returned an invalid reply twice.';
    case 'demo_cap':
      return 'The shared demo key hit its daily limit. Set your own key with "ownit key set".';
  }
}

/** A billing, key, or availability problem. The push is kept out of the stats. */
export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    /** The provider's display name, used in the message. */
    providerName = 'Nebius',
    /** The provider's HTTP status, logged so a vague message never hides the cause. */
    public httpStatus?: number,
  ) {
    super(reason(kind, providerName));
    this.name = 'ProviderError';
  }
}

// --- Providers ---------------------------------------------------------------

interface ProviderSpec {
  /** Display name, used in error messages. */
  name: string;
  /** The model this server uses for the provider, as `ownit model` shows it. */
  model(env: Env): string;
  /** A client for this provider, using the endpoint and model the server chose. */
  create(env: Env, apiKey: string): ChatModel;
}

/** A provider that serves the model through an OpenAI-compatible chat completions API. */
function openAiCompatible(name: string, endpoint: (env: Env) => { baseUrl: string; model: string }, options: RequestOptions = {}): ProviderSpec {
  return {
    name,
    model: (env) => endpoint(env).model,
    create(env, apiKey) {
      const { baseUrl, model } = endpoint(env);
      return openAiCompatibleModel(name, baseUrl, model, apiKey, fetch, options);
    },
  };
}

/**
 * Model providers a user's key can be for, chosen with `ownit key set`. To add
 * one: an entry here, one in the CLI's providers.ts, and its endpoint and model
 * in wrangler.toml. A provider with a different API needs its own client.
 */
export const PROVIDERS = {
  nebius: openAiCompatible('Nebius', (env) => ({ baseUrl: env.NEBIUS_BASE_URL, model: env.NEBIUS_MODEL })),
  // NVIDIA's free endpoint serves Nemotron 3.5 Super. It usually answers in about a second but
  // sometimes stalls for a minute or fails with a 5xx, so copies go out at 3s and 6s (or at once
  // after a failure) and nothing waits past 10s (measured 2026-10-23 with one copy at 3s: 20/20
  // answered, median 0.9s, max 4.9s). Thinking off keeps the JSON whole.
  nvidia: openAiCompatible('NVIDIA', (env) => ({ baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL }), {
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    hedgesMs: [3_000, 6_000],
    timeoutMs: 10_000,
  }),
} satisfies Record<string, ProviderSpec>;

export type Provider = keyof typeof PROVIDERS;

export function isProvider(value: string): value is Provider {
  return Object.hasOwn(PROVIDERS, value);
}

export function createModel(env: Env, apiKey: string, provider: Provider = 'nebius'): ChatModel {
  if (env.MODEL_BACKEND === 'fixture') return fixtureModel;
  return PROVIDERS[provider].create(env, apiKey);
}

// --- OpenAI-compatible client ------------------------------------------------

function errorKind(status: number, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402 || /insufficient|balance|credit|quota/i.test(body)) return 'no_credit';
  if (status === 429) return 'rate_limited';
  // NVIDIA answers 404 "Function ... Not found for account" when the account lacks the model.
  if (status === 404) return 'model_unavailable';
  return 'unavailable';
}

export interface RequestOptions {
  /** Provider-specific request fields. */
  extraBody?: Record<string, unknown>;
  /**
   * When to send extra copies of a request that has not answered yet; the first good answer wins.
   * A copy also goes out at once when an earlier one fails with a network error or a 5xx.
   */
  hedgesMs?: number[];
  /** Give up after this long. */
  timeoutMs?: number;
}

/**
 * The first good response from `send`. Extra copies start at each of `hedgesMs`,
 * or at once when an earlier copy fails (network error or 5xx); the others are
 * cancelled when one answers. Some free endpoints answer in about a second but
 * now and then stall for a minute or fail; copies turn that into a few seconds.
 * When every copy fails, the last 5xx is returned (or the last error thrown).
 */
export function firstResponse(send: (signal: AbortSignal) => Promise<Response>, hedgesMs: number[], timeoutMs: number): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const maxCopies = hedgesMs.length + 1;
  const controllers = new Set<AbortController>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let launched = 0;
  let pending = 0;
  let settled = false;
  let lastFailure: Response | undefined;
  let lastError: unknown = new Error('no response');

  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      settle();
    };
    const giveUpIfDone = () => {
      if (pending === 0 && launched >= maxCopies) finish(() => (lastFailure ? resolve(lastFailure) : reject(lastError)));
    };
    const launch = () => {
      if (settled || launched >= maxCopies) return;
      launched++;
      pending++;
      const controller = new AbortController();
      controllers.add(controller);
      send(AbortSignal.any([controller.signal, deadline])).then(
        (response) => {
          pending--;
          if (response.status >= 500) {
            lastFailure = response;
            launch();
            return giveUpIfDone();
          }
          for (const other of controllers) if (other !== controller) other.abort();
          finish(() => resolve(response));
        },
        (error: unknown) => {
          pending--;
          lastError = error;
          if (!deadline.aborted) launch();
          giveUpIfDone();
        },
      );
    };
    for (const ms of hedgesMs) timers.push(setTimeout(launch, ms));
    deadline.addEventListener('abort', () => finish(() => (lastFailure ? resolve(lastFailure) : reject(deadline.reason))));
    launch();
  });
}

export function openAiCompatibleModel(
  name: string,
  baseUrl: string,
  model: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  { extraBody = {}, hedgesMs = [], timeoutMs = 90_000 }: RequestOptions = {},
): ChatModel {
  const url = new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  return {
    async complete(prompt, maxTokens) {
      const body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: prompt.temperature ?? 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        ...extraBody,
      });
      const send = (signal: AbortSignal) =>
        fetcher(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, signal });
      let response: Response;
      try {
        response = await firstResponse(send, hedgesMs, timeoutMs);
      } catch {
        throw new ProviderError('unavailable', name);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ProviderError(errorKind(response.status, body), name, response.status);
      }
      const data = (await response.json().catch(() => null)) as
        | { choices?: { message?: { content?: string | null } }[] }
        | null;
      return stripThinking(data?.choices?.[0]?.message?.content ?? '');
    },
  };
}

/** Reasoning models may prefix the reply with a <think> block. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
