import { readConfig, serverUrl, type Config } from './config.js';
import { modelKey } from './providers.js';

export type Kind = 'why' | 'how' | 'next';
export type PushStatus = 'verified' | 'skipped' | 'pending' | 'provider_error';

export interface PublicQuestion {
  idx: number;
  kind: Kind;
  text: string;
}

export interface StartResponse {
  push_id: number;
  total: number;
  session: string;
  questions: PublicQuestion[];
  /** Whether passing answers appear on the repo's public page. Older servers omit it. */
  answers_public?: boolean;
}

export interface AnswerResponse {
  pass: boolean;
  feedback: string;
  done: boolean;
  status: PushStatus;
  followup: PublicQuestion | null;
  session: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the server could not be reached. */
    public status: number,
    public code: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isProviderError() {
    return this.code === 'provider_error';
  }
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown, options?: { timeoutMs?: number }): Promise<T>;
  server: string;
}

export function createApi(config: Config = readConfig(), env: NodeJS.ProcessEnv = process.env): ApiClient {
  const server = serverUrl(config, env);
  const model = modelKey(config, env);
  return {
    server,
    async request<T>(method: string, path: string, body?: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
      const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'getownit-cli' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (config.token) headers.authorization = `Bearer ${config.token}`;
      // Only debrief calls need the key; the worker uses it for that request and discards it.
      if (model && path.startsWith('/api/interview/')) {
        headers['x-model-key'] = model.key;
        headers['x-model-provider'] = model.provider;
      }
      let response: Response;
      try {
        response = await fetch(`${server}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'unreachable';
        throw new ApiError(`Ownit server ${reason} (${server})`, 0, 'network');
      }
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof json.message === 'string' ? json.message : `Ownit server returned ${response.status}`;
        throw new ApiError(message, response.status, typeof json.error === 'string' ? json.error : 'http', json);
      }
      return json as T;
    },
  };
}
