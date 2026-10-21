import type { Env } from './env';
import { toBase64Url } from './seal';

const API = 'https://api.github.com';

export interface CheckRunBody {
  name: string;
  head_sha?: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'neutral' | 'failure';
  completed_at?: string;
  details_url?: string;
  external_id?: string;
  output: { title: string; summary: string };
}

/** The GitHub calls the worker makes. Tests substitute a fake. */
export interface GitHub {
  /** The App installation covering a repo, or null when the App is not installed there. */
  repoInstallation(owner: string, repo: string): Promise<{ installationId: number; private: boolean } | null>;
  createCheckRun(installationId: number, owner: string, repo: string, body: CheckRunBody): Promise<number>;
  updateCheckRun(installationId: number, owner: string, repo: string, id: number, body: CheckRunBody): Promise<void>;
  /** "admin" | "maintain" | "write" | "triage" | "read" | "none". */
  permission(installationId: number, owner: string, repo: string, username: string): Promise<string>;
  /** The identity behind a user token. Ownit discards the token right after. */
  user(accessToken: string): Promise<{ id: number; login: string }>;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

// --- App authentication ---------------------------------------------------

function pemBody(pem: string): Uint8Array {
  const base64 = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: Uint8Array): Uint8Array {
  return new Uint8Array([tag, ...derLength(content.length), ...content]);
}

/** Wraps a PKCS#1 RSAPrivateKey (what GitHub hands out) in a PKCS#8 PrivateKeyInfo for WebCrypto. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithm = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, new Uint8Array([...version, ...rsaAlgorithm, ...der(0x04, pkcs1)]));
}

export function importAppKey(pem: string): Promise<CryptoKey> {
  const body = pemBody(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(body) : body;
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function appJwt(appId: string, key: CryptoKey, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

// --- REST client ----------------------------------------------------------

// Installation tokens last an hour; reuse them within an isolate.
const tokenCache = new Map<number, { token: string; expires: number }>();

export function createGitHub(env: Env, fetcher: typeof fetch = fetch): GitHub {
  let keyPromise: Promise<CryptoKey> | undefined;
  const key = () => {
    if (!env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_ID) throw new Error('GitHub App is not configured');
    return (keyPromise ??= importAppKey(env.GITHUB_APP_PRIVATE_KEY));
  };

  async function call<T>(path: string, auth: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetcher(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${auth}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ownit-worker',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw new GitHubError(response.status, `GitHub ${init.method ?? 'GET'} ${path.split('?')[0]} returned ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  async function installationToken(installationId: number): Promise<string> {
    const cached = tokenCache.get(installationId);
    if (cached && cached.expires > Date.now() + 5 * 60_000) return cached.token;
    const jwt = await appJwt(env.GITHUB_APP_ID, await key());
    const result = await call<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, jwt, { method: 'POST' });
    tokenCache.set(installationId, { token: result.token, expires: Date.parse(result.expires_at) });
    return result.token;
  }

  const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    async repoInstallation(owner, repo) {
      // Without App credentials (local dev) no repo counts as installed.
      if (!env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_ID) return null;
      const jwt = await appJwt(env.GITHUB_APP_ID, await key());
      try {
        const installation = await call<{ id: number }>(`${repoPath(owner, repo)}/installation`, jwt);
        const info = await call<{ private: boolean }>(repoPath(owner, repo), await installationToken(installation.id));
        return { installationId: installation.id, private: info.private };
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      }
    },
    async createCheckRun(installationId, owner, repo, body) {
      const run = await call<{ id: number }>(`${repoPath(owner, repo)}/check-runs`, await installationToken(installationId), { method: 'POST', body });
      return run.id;
    },
    async updateCheckRun(installationId, owner, repo, id, body) {
      const { head_sha: _headSha, ...rest } = body;
      await call(`${repoPath(owner, repo)}/check-runs/${id}`, await installationToken(installationId), { method: 'PATCH', body: rest });
    },
    async permission(installationId, owner, repo, username) {
      try {
        const result = await call<{ permission: string }>(
          `${repoPath(owner, repo)}/collaborators/${encodeURIComponent(username)}/permission`,
          await installationToken(installationId),
        );
        return result.permission;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return 'none';
        throw error;
      }
    },
    async user(accessToken) {
      const user = await call<{ id: number; login: string }>('/user', accessToken);
      return { id: user.id, login: user.login };
    },
  };
}
