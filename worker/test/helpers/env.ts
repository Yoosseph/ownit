import type { Env } from '../../src/env';
import { createApp } from '../../src/app';
import { createTestDb } from './d1';

export function testEnv(overrides: Partial<Env> = {}): Env & { DB: ReturnType<typeof createTestDb> } {
  return {
    DB: createTestDb(),
    NEBIUS_BASE_URL: 'https://nebius.invalid/v1/',
    NEBIUS_MODEL: 'nvidia/test-model',
    MODEL_BACKEND: 'fixture',
    DEMO_DAILY_CALL_CAP: '5',
    PUBLIC_URL: 'https://ownit.test',
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'ownit-test',
    GITHUB_CLIENT_ID: 'Iv1.test',
    SESSION_SECRET: 'test-secret',
    ...overrides,
  } as Env & { DB: ReturnType<typeof createTestDb> };
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

export async function call(env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const app = createApp();
  const response = await app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
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
