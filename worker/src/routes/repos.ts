import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { checkAccess } from '../access';
import { getRepo, setRepoSettings, upsertRepo, type RepoRow } from '../db';
import { installUrl, repoPageUrl } from '../links';
import { log } from '../log';
import { readJson, repoName, requireRepo } from './shared';

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
    show_questions: existing?.show_questions ?? 1,
    show_answers: existing?.show_answers ?? 0,
    allow_backfill: existing?.allow_backfill ?? 0,
  };
  const denied = await checkAccess(c, candidate);
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

const settingsBody = z.object({
  repo: repoName,
  show_questions: z.boolean().optional(),
  show_answers: z.boolean().optional(),
  allow_backfill: z.boolean().optional(),
});

function settingsJson(c: Context<AppEnv>, repo: RepoRow) {
  return {
    repo: `${repo.owner}/${repo.name}`,
    private: Boolean(repo.private),
    show_questions: Boolean(repo.show_questions),
    show_answers: Boolean(repo.show_answers),
    allow_backfill: Boolean(repo.allow_backfill),
    page_url: repoPageUrl(c.env.PUBLIC_URL || new URL(c.req.url).origin, repo),
  };
}

/** The repo's settings. Anyone who can push may look. */
repos.get('/settings', async (c) => {
  const parsed = repoName.safeParse(c.req.query('repo'));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Pass ?repo=owner/name.' }, 400);
  const repo = await requireRepo(c, parsed.data);
  if (repo instanceof Response) return repo;
  return c.json(settingsJson(c, repo));
});

/**
 * Changes the repo's settings (from `ownit settings`). Admins and maintainers
 * only. Showing answers also shows questions; hiding questions hides answers;
 * hiding answers deletes the stored ones. `allow_backfill` lets debriefs of
 * commits from before tracking count once verified.
 */
repos.put('/settings', async (c) => {
  const body = await readJson(
    c,
    settingsBody,
    'Pass {"repo": "owner/name", "show_questions"?: boolean, "show_answers"?: boolean, "allow_backfill"?: boolean}.',
  );
  if (body instanceof Response) return body;
  const repo = await requireRepo(c, body.repo, 'admin');
  if (repo instanceof Response) return repo;
  const pageChange = body.show_questions !== undefined || body.show_answers !== undefined;
  if (repo.private && pageChange) {
    return c.json({ error: 'private_repo', message: `${body.repo} is private, so its page never shows questions or answers.` }, 400);
  }
  const showAnswers = body.show_answers ?? (body.show_questions === false ? false : Boolean(repo.show_answers));
  const showQuestions = body.show_answers ? true : (body.show_questions ?? Boolean(repo.show_questions));
  const allowBackfill = body.allow_backfill ?? Boolean(repo.allow_backfill);
  await setRepoSettings(c.env.DB, repo.id, { showQuestions, showAnswers, allowBackfill });
  log('repo.settings', { repo: body.repo, questions: showQuestions, answers: showAnswers && showQuestions, backfill: allowBackfill });
  return c.json(settingsJson(c, (await getRepo(c.env.DB, repo.owner, repo.name))!));
});
