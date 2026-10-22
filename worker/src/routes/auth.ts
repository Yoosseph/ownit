import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { upsertUser } from '../db';
import { GitHubError } from '../github';
import { LIMITS, rateLimit } from '../limits';
import { log } from '../log';
import { bearerToken, createSession, deleteSession } from '../sessions';
import { readJson } from './shared';

const exchangeBody = z.object({ access_token: z.string().min(10).max(500) });

export const auth = new Hono<AppEnv>();

/**
 * The GitHub App's public client ID. The CLI runs the device flow against
 * github.com itself: GitHub rate-limits its login endpoints by IP, and
 * Cloudflare Workers share outbound IPs, so the worker cannot do it.
 */
auth.get('/config', (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: 'not_configured', message: 'This Ownit server has no GitHub App configured.' }, 503);
  return c.json({ github_client_id: c.env.GITHUB_CLIENT_ID });
});

/**
 * Exchanges a GitHub user token from the device flow for an Ownit session.
 * The worker verifies the identity with GET /user (rate-limited per token,
 * not per IP), discards the GitHub token, and issues its own token.
 */
auth.post('/github', async (c) => {
  const body = await readJson(c, exchangeBody, 'Pass {"access_token": "..."}.');
  if (body instanceof Response) return body;
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(c.env.DB, `login:${ip}`, LIMITS.loginPerIp))) {
    return c.json({ error: 'rate_limited', message: 'Too many login attempts. Try again later.' }, 429);
  }
  let user: { id: number; login: string };
  try {
    user = await c.get('github').user(body.access_token);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      return c.json({ error: 'invalid_github_token', message: 'GitHub did not accept that token. Run "ownit login" again.' }, 401);
    }
    throw error;
  }
  await upsertUser(c.env.DB, user.id, user.login);
  const token = await createSession(c.env.DB, user.id);
  log('auth.login', { user: user.id });
  return c.json({ token, login: user.login });
});

/** Logout: deletes the session behind the presented token. */
auth.delete('/session', async (c) => {
  const token = bearerToken(c);
  if (token) await deleteSession(c.env.DB, token);
  return c.json({ ok: true });
});
