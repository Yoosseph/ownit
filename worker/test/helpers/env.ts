import { createHash } from 'node:crypto';
import type { Env } from '../../src/env';
import { createApp } from '../../src/app';
import { clearPermissionCache } from '../../src/auth';
import { GitHubError, type CheckRunBody, type GitHub } from '../../src/github';
import { createTestDb } from './d1';

export const INSTALLATION_ID = 99;

/** In-memory GitHub: installations by repo, check runs, and permissions. */
export class FakeGitHub implements GitHub {
  installations = new Map<string, { installationId: number; private: boolean }>([['octo/shop', { installationId: INSTALLATION_ID, private: false }]]);
  checkRuns: (CheckRunBody & { id: number; repo: string })[] = [];
  permissions = new Map<string, string>();

  async repoInstallation(owner: string, repo: string) {
    return this.installations.get(`${owner}/${repo}`.toLowerCase()) ?? null;
  }
  async createCheckRun(_installationId: number, owner: string, repo: string, body: CheckRunBody) {
    const id = this.checkRuns.length + 1;
    this.checkRuns.push({ ...body, id, repo: `${owner}/${repo}` });
    return id;
  }
  async updateCheckRun(_installationId: number, _owner: string, _repo: string, id: number, body: CheckRunBody) {
    const run = this.checkRuns.find((r) => r.id === id)!;
    Object.assign(run, body);
  }
  async permission(_installationId: number, owner: string, repo: string, username: string) {
    return this.permissions.get(`${owner}/${repo}:${username}`) ?? 'write';
  }

  /** GitHub user tokens this fake accepts; any other token is a 401. */
  tokens = new Map([['gho_user_token_123', { id: 42, login: 'mona' }]]);
  async user(accessToken: string) {
    const user = this.tokens.get(accessToken);
    if (!user) throw new GitHubError(401, 'GitHub GET /user returned 401');
    return user;
  }
}

export const USER = { id: 42, login: 'mona' };
export const TOKEN = 'ownit_test-session-token-0123456789';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export type TestEnv = Env & { DB: ReturnType<typeof createTestDb>; github: FakeGitHub; token: string };

/** A fresh database with user mona logged in and `octo/shop` registered with the App installed. */
export function testEnv(overrides: Partial<Env> = {}, { register = true } = {}): TestEnv {
  clearPermissionCache();
  const DB = createTestDb();
  DB.raw.prepare('INSERT INTO users (github_id, login) VALUES (?, ?)').run(USER.id, USER.login);
  DB.raw
    .prepare("INSERT INTO sessions (token_hash, github_id, created_at, expires_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z')")
    .run(hash(TOKEN), USER.id);
  if (register) {
    DB.raw
      .prepare("INSERT INTO repos (owner, name, installation_id, tracked_since, private) VALUES ('octo', 'shop', ?, '2026-10-01T00:00:00.000Z', 0)")
      .run(INSTALLATION_ID);
  }
  return {
    DB,
    github: new FakeGitHub(),
    token: TOKEN,
    NEBIUS_BASE_URL: 'https://nebius.invalid/v1/',
    NEBIUS_MODEL: 'nvidia/test-model',
    NVIDIA_BASE_URL: 'https://nvidia.invalid/v1/',
    NVIDIA_MODEL: 'nvidia/test-model',
    MODEL_BACKEND: 'fixture',
    DEMO_DAILY_CALL_CAP: '5',
    PUBLIC_URL: 'https://ownit.test',
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'ownit-test',
    GITHUB_CLIENT_ID: 'Iv1.test',
    SESSION_SECRET: 'test-secret',
    ...overrides,
  } as TestEnv;
}

export const sha = (n: number) => n.toString(16).padStart(40, 'a');

export const SAMPLE_DIFF = `diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,3 +1,6 @@
 export function total(items: Item[]) {
-  return items.reduce((sum, i) => sum + i.price, 0);
+  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
+  return Math.round(subtotal * 100) / 100;
 }
`;

export function startBody(extra: Record<string, unknown> = {}) {
  return {
    repo: 'octo/shop',
    base_sha: sha(1),
    head_sha: sha(3),
    commits: [
      { sha: sha(2), message: 'Count item quantity in cart total' },
      { sha: sha(3), message: 'Round cart total to cents' },
    ],
    diff: SAMPLE_DIFF,
    diff_truncated: false,
    changed_lines: 3,
    ...extra,
  };
}

/** Calls the app in-process. A string body is sent verbatim (for signed webhooks). */
export async function call(env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const github = (env as Partial<TestEnv>).github ?? new FakeGitHub();
  const app = createApp({ github: () => github });
  const response = await app.request(
    path,
    {
      method,
      headers: {
        'content-type': 'application/json',
        ...((env as Partial<TestEnv>).token ? { authorization: `Bearer ${(env as TestEnv).token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, headers: response.headers };
}
