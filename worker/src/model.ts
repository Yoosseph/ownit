import type { Env } from './env';
import type { ChatPrompt } from './prompts';
import { fixtureModel } from './fixtureModel';

export type ProviderErrorKind = 'no_key' | 'invalid_key' | 'no_credit' | 'rate_limited' | 'unavailable' | 'bad_output' | 'demo_cap';

const REASONS: Record<ProviderErrorKind, string> = {
  no_key: 'No Nebius API key. Run "ownit key set".',
  invalid_key: 'Nebius rejected the API key. Check it with "ownit key set".',
  no_credit: 'Your Nebius account has no credit left.',
  rate_limited: 'Nebius is rate limiting this key. Try again in a minute.',
  unavailable: 'Nebius is unreachable right now.',
  bad_output: 'The model returned an invalid reply twice.',
  demo_cap: 'The shared demo key hit its daily limit. Set your own key with "ownit key set".',
};

/** A billing, key, or availability problem. The push is kept out of the stats. */
export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind) {
    super(REASONS[kind]);
    this.name = 'ProviderError';
  }
}

export interface ChatModel {
  /** Returns the raw text content of the reply. */
  complete(prompt: ChatPrompt, maxTokens: number): Promise<string>;
}

export function createModel(env: Env, apiKey: string): ChatModel {
  if (env.MODEL_BACKEND === 'fixture') return fixtureModel;
  return nebiusModel(env.NEBIUS_BASE_URL, env.NEBIUS_MODEL, apiKey);
}

function errorKind(status: number, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402 || /insufficient|balance|credit|quota/i.test(body)) return 'no_credit';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

export function nebiusModel(baseUrl: string, model: string, apiKey: string, fetcher: typeof fetch = fetch): ChatModel {
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
        throw new ProviderError('unavailable');
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ProviderError(errorKind(response.status, body));
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
