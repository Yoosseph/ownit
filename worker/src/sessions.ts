// Ownit session tokens: issued after a GitHub login, required on every /api route.
// Only a SHA-256 hash of each token is stored.
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './app';
import { nowIso } from './db';
import { LIMITS, rateLimit } from './limits';
import { toBase64Url } from './seal';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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

/** Deletes the session behind a token, if there is one. */
export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

/** The Ownit session token in the Authorization header, or null. */
export function bearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(ownit_[\w-]{20,})$/);
  return match ? match[1]! : null;
}

/** Rejects API calls without a valid, unexpired Ownit session token. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c);
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
  if (!(await rateLimit(c.env.DB, `user:${row.github_id}`, LIMITS.apiPerUser))) {
    return c.json({ error: 'rate_limited', message: 'Too many requests. Try again later.' }, 429);
  }
  await next();
};
