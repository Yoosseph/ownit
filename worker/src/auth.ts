import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './app';
import { nowIso, upsertUser, type RepoRow } from './db';
import { GitHubError } from './github';
import { rateLimit } from './limits';
import { log } from './log';
import { toBase64Url } from './seal';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PUSH_ACCESS = new Set(['admin', 'maintain', 'write']);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Issues an Ownit session token. Only its hash is stored. */
export async function createSession(db: D1Database, githubId: number): Promise<string> {
  const token = `ownit_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await db
    .prepare('INSERT INTO sessions (token_hash, github_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), githubId, nowIso(), new Date(Date.now() + SESSION_TTL_MS).toISOString())
    .run();
  return token;
}

function bearer(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(ownit_[\w-]{20,})$/);
  return match ? match[1]! : null;
}

/** Rejects API calls without a valid, unexpired Ownit session token. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  const row = token
    ? await c.env.DB.prepare(
        `SELECT s.github_id, u.login FROM sessions s JOIN users u ON u.github_id = s.github_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
        .bind(await sha256(token), nowIso())
        .first<{ github_id: number; login: string }>()
    : null;
  if (!row) return c.json({ error: 'unauthorized', message: 'Not logged in. Run "ownit login".' }, 401);
  c.set('userId', row.github_id);
  c.set('login', row.login);
  if (!(await rateLimit(c.env.DB, `user:${row.github_id}`, 600, 3600))) {
    return c.json({ error: 'rate_limited', message: 'Too many requests. Try again later.' }, 429);
  }
  await next();
};

// Permission answers are cached briefly per isolate to keep debriefs snappy.
// A user whose access is revoked keeps it for at most five minutes.
const permissionCache = new Map<string, { ok: boolean; until: number }>();

export function clearPermissionCache() {
  permissionCache.clear();
}

function isLocalRequest(c: Context<AppEnv>) {
  const host = new URL(c.req.url).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

/**
 * Confirms the logged-in user can push to the repo, using the App's
 * installation token. Returns an error response when they cannot.
 */
export async function checkPushAccess(c: Context<AppEnv>, repo: RepoRow): Promise<Response | null> {
  // Local development without a GitHub App. Never true on a deployed worker.
  if (c.env.DEV_LOCAL_TRUST === '1' && isLocalRequest(c)) return null;
  const full = `${repo.owner}/${repo.name}`;
  if (!repo.installation_id) {
    const install = c.env.GITHUB_APP_SLUG ? ` Install it: https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new` : '';
    return c.json({ error: 'app_not_installed', message: `The Ownit GitHub App is not installed on ${full}.${install}` }, 403);
  }
  const login = c.get('login')!;
  const key = `${repo.installation_id}:${full}:${login}`.toLowerCase();
  const cached = permissionCache.get(key);
  let ok = cached && cached.until > Date.now() ? cached.ok : undefined;
  if (ok === undefined) {
    try {
      ok = PUSH_ACCESS.has(await c.get('github').permission(repo.installation_id, repo.owner, repo.name, login));
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      log('permission.error', { repo: full, status: error.status });
      return c.json({ error: 'github_unavailable', message: 'Could not check your access with GitHub. Try again.' }, 503);
    }
    permissionCache.set(key, { ok, until: Date.now() + 5 * 60_000 });
  }
  if (ok) return null;
  log('permission.denied', { repo: full });
  return c.json({ error: 'forbidden', message: `You need push access to ${full} to record debriefs for it.` }, 403);
}

const pollBody = z.object({ device_code: z.string().min(1).max(200) });

export const auth = new Hono<AppEnv>();

/** Device flow, step 1. The CLI shows the user code and verification URL. */
auth.post('/device/start', async (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: 'not_configured', message: 'This Ownit server has no GitHub App configured.' }, 503);
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(c.env.DB, `login:${ip}`, 30, 3600))) {
    return c.json({ error: 'rate_limited', message: 'Too many login attempts. Try again later.' }, 429);
  }
  const code = await c.get('github').deviceCode(c.env.GITHUB_CLIENT_ID);
  return c.json(code);
});

/**
 * Device flow, step 2. On success the worker reads the GitHub identity,
 * throws the GitHub token away, and issues an Ownit session token.
 */
auth.post('/device/poll', async (c) => {
  const parsed = pollBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Pass {"device_code": "..."}.' }, 400);
  const github = c.get('github');
  const result = await github.deviceToken(c.env.GITHUB_CLIENT_ID, parsed.data.device_code);
  if ('error' in result) return c.json({ status: result.error, interval: result.interval ?? null });
  const user = await github.user(result.accessToken);
  await upsertUser(c.env.DB, user.id, user.login);
  const token = await createSession(c.env.DB, user.id);
  log('auth.login', { user: user.id });
  return c.json({ status: 'ok', token, login: user.login });
});

/** Logout: deletes the session behind the presented token. */
auth.delete('/session', async (c) => {
  const token = bearer(c);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return c.json({ ok: true });
});
