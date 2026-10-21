import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { checkPushAccess } from '../auth';
import { getRepo, upsertRepo, type RepoRow } from '../db';
import { log } from '../log';

export const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);

export function installUrl(env: AppEnv['Bindings']): string | null {
  return env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null;
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

export const repos = new Hono<AppEnv>();

/**
 * Registers a repo (from `ownit init`). Needs the App installed and push
 * access. Tracking starts now; earlier history never counts.
 */
repos.post('/', async (c) => {
  const parsed = z.object({ repo: repoName }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Pass {"repo": "owner/name"}.' }, 400);
  const [owner, name] = parsed.data.repo.split('/') as [string, string];
  const installation = await c.get('github').repoInstallation(owner, name);
  const existing = await getRepo(c.env.DB, owner, name);
  const candidate: RepoRow = {
    id: existing?.id ?? 0,
    owner,
    name,
    installation_id: installation?.installationId ?? existing?.installation_id ?? null,
    tracked_since: existing?.tracked_since ?? '',
    private: installation?.private ? 1 : (existing?.private ?? 0),
  };
  const denied = await checkPushAccess(c, candidate);
  if (denied) {
    if (denied.status === 403 && !candidate.installation_id) {
      return c.json({ error: 'app_not_installed', install_url: installUrl(c.env), message: `Install the Ownit GitHub App on ${parsed.data.repo} first.` }, 403);
    }
    return denied;
  }
  const repo = await upsertRepo(c.env.DB, {
    owner,
    name,
    installationId: candidate.installation_id,
    private: Boolean(candidate.private),
  });
  log('repo.register', { repo: parsed.data.repo, installed: Boolean(repo.installation_id) });
  return c.json({
    repo: `${repo.owner}/${repo.name}`,
    tracked_since: repo.tracked_since,
    installed: Boolean(repo.installation_id),
    install_url: repo.installation_id ? null : installUrl(c.env),
    page_url: c.env.PUBLIC_URL ? `${c.env.PUBLIC_URL.replace(/\/+$/, '')}/${repo.owner}/${repo.name}` : null,
  });
});
