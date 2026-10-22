import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { checkPushAccess } from '../auth';
import { getRepo, upsertRepo, type RepoRow } from '../db';
import { installUrl, repoPageUrl } from '../links';
import { log } from '../log';
import { readJson, repoName } from './shared';

export const repos = new Hono<AppEnv>();

/**
 * Registers a repo (from `ownit init`). Needs the App installed and push
 * access. Tracking starts now; earlier history never counts.
 */
repos.post('/', async (c) => {
  const body = await readJson(c, z.object({ repo: repoName }), 'Pass {"repo": "owner/name"}.');
  if (body instanceof Response) return body;
  const [owner, name] = body.repo.split('/') as [string, string];
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
      return c.json(
        { error: 'app_not_installed', install_url: installUrl(c.env.GITHUB_APP_SLUG), message: `Install the Ownit GitHub App on ${body.repo} first.` },
        403,
      );
    }
    return denied;
  }
  const repo = await upsertRepo(c.env.DB, {
    owner,
    name,
    installationId: candidate.installation_id,
    private: Boolean(candidate.private),
  });
  log('repo.register', { repo: body.repo, installed: Boolean(repo.installation_id) });
  return c.json({
    repo: `${repo.owner}/${repo.name}`,
    tracked_since: repo.tracked_since,
    installed: Boolean(repo.installation_id),
    install_url: repo.installation_id ? null : installUrl(c.env.GITHUB_APP_SLUG),
    page_url: c.env.PUBLIC_URL ? repoPageUrl(c.env.PUBLIC_URL, repo) : null,
  });
});
