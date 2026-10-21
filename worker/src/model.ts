import type { Env } from './env';
import type { ChatPrompt } from './prompts';
import { fixtureModel } from './fixtureModel';

export type ProviderErrorKind = 'no_key' | 'invalid_key' | 'no_credit' | 'rate_limited' | 'unavailable' | 'bad_output' | 'demo_cap';

/** Both serve the same Nemotron model through an OpenAI-compatible API. */
export type Provider = 'nebius' | 'nvidia';

const PROVIDER_NAMES: Record<Provider, string> = { nebius: 'Nebius', nvidia: 'NVIDIA' };

/** NVIDIA API catalog keys start with "nvapi-"; anything else is treated as a Nebius key. */
export function providerForKey(key: string): Provider {
  return key.startsWith('nvapi-') ? 'nvidia' : 'nebius';
}

function reason(kind: ProviderErrorKind, provider: Provider): string {
  const name = PROVIDER_NAMES[provider];
  switch (kind) {
    case 'no_key':
      return 'No model API key. Run "ownit key set" with a Nebius or NVIDIA key.';
    case 'invalid_key':
      return `${name} rejected the API key. Check it with "ownit key set".`;
    case 'no_credit':
      return `Your ${name} account has no credit left.`;
    case 'rate_limited':
      return `${name} is rate limiting this key. Try again in a minute.`;
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
    provider: Provider = 'nebius',
  ) {
    super(reason(kind, provider));
    this.name = 'ProviderError';
  }
}

export interface ChatModel {
  /** Returns the raw text content of the reply. */
  complete(prompt: ChatPrompt, maxTokens: number): Promise<string>;
}

export function createModel(env: Env, apiKey: string): ChatModel {
  if (env.MODEL_BACKEND === 'fixture') return fixtureModel;
  const provider = providerForKey(apiKey);
  if (provider === 'nvidia') return providerModel(provider, env.NVIDIA_BASE_URL, env.NVIDIA_MODEL, apiKey);
  return providerModel(provider, env.NEBIUS_BASE_URL, env.NEBIUS_MODEL, apiKey);
}

function errorKind(status: number, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402 || /insufficient|balance|credit|quota/i.test(body)) return 'no_credit';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

export function providerModel(provider: Provider, baseUrl: string, model: string, apiKey: string, fetcher: typeof fetch = fetch): ChatModel {
  const url = new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  return {
    async complete(prompt, maxTokens) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            temperature: prompt.temperature ?? 0.3,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch {
        throw new ProviderError('unavailable', provider);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ProviderError(errorKind(response.status, body), provider);
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
