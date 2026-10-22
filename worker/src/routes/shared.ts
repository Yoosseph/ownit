// Helpers shared by the API routes, so route modules never import each other.
import type { Context } from 'hono';
import { z } from 'zod';
import { checkPushAccess } from '../access';
import type { AppEnv } from '../app';
import { background } from '../background';
import { syncCheckRun } from '../checks';
import { getRepo, setPushStatus, type PushStatus, type RepoRow } from '../db';

export const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
export const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
export const commit = z.object({ sha, message: z.string().max(20_000) });

/** The request's JSON body when it matches `schema`, else a 400 response to return as is. */
export async function readJson<T>(c: Context<AppEnv>, schema: z.ZodType<T>, message: string): Promise<T | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : c.json({ error: 'bad_request', message }, 400);
}

/**
 * The registered repo named "owner/name", provided the logged-in user can
 * push to it. Otherwise an error response to return as is.
 */
export async function requireRepo(c: Context<AppEnv>, fullName: string): Promise<RepoRow | Response> {
  const [owner, name] = fullName.split('/') as [string, string];
  const repo = await getRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json({ error: 'not_registered', message: `${fullName} is not set up for Ownit. Run "ownit init" in the repo.` }, 404);
  }
  return (await checkPushAccess(c, repo)) ?? repo;
}

/** Sets a push's status and brings its GitHub check run up to date. */
export async function updateStatus(c: Context<AppEnv>, pushId: number, status: PushStatus) {
  await setPushStatus(c.env.DB, pushId, status);
  await background(c, syncCheckRun(c.env, c.get('github'), pushId));
}
