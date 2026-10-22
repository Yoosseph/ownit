import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { attachCommits, createPush, findPushForCommits, type PushRow } from '../db';
import { log } from '../log';
import { readJson, repoName, requireRepo, sha, updateStatus } from './shared';

const recordBody = z.object({
  repo: repoName,
  base_sha: sha.nullish(),
  head_sha: sha,
  commits: z.array(z.object({ sha })).min(1).max(500),
  status: z.enum(['pending', 'skipped']),
});

const lookupBody = z.object({ repo: repoName, head_sha: sha, shas: z.array(sha).min(1).max(500) });

const isResolved = (push: PushRow) => push.status === 'verified' || push.status === 'skipped';

export const pushes = new Hono<AppEnv>();

/** Records a push without a debrief: the hook's "n" (pending) and "s" (skipped) answers. */
pushes.post('/', async (c) => {
  const body = await readJson(c, recordBody, 'Invalid push record.');
  if (body instanceof Response) return body;
  const repo = await requireRepo(c, body.repo);
  if (repo instanceof Response) return repo;
  const shas = body.commits.map((x) => x.sha);

  let push = await findPushForCommits(c.env.DB, repo.id, body.head_sha, shas);
  if (push && isResolved(push)) return c.json({ push_id: push.id, status: push.status });
  if (push?.user_github_id && push.user_github_id !== c.get('userId')) return c.json({ push_id: push.id, status: push.status });
  push ??= await createPush(c.env.DB, {
    repoId: repo.id,
    userId: c.get('userId'),
    baseSha: body.base_sha ?? null,
    headSha: body.head_sha,
    status: body.status,
  });
  await attachCommits(c.env.DB, repo.id, push.id, shas);
  if (body.status === 'skipped' && push.status !== 'skipped') await updateStatus(c, push.id, 'skipped');
  log('push.record', { repo: body.repo, push: push.id, status: body.status });
  return c.json({ push_id: push.id, status: body.status === 'skipped' ? 'skipped' : push.status });
});

/** Tells the hook whether these commits were already debriefed, so a retried push is not asked twice. */
pushes.post('/lookup', async (c) => {
  const body = await readJson(c, lookupBody, 'Invalid lookup.');
  if (body instanceof Response) return body;
  const repo = await requireRepo(c, body.repo);
  if (repo instanceof Response) return repo;
  const push = await findPushForCommits(c.env.DB, repo.id, body.head_sha, body.shas);
  return c.json(push ? { push_id: push.id, status: push.status } : { push_id: null, status: null });
});

/** Pushes still waiting for a debrief (pending or provider_error), newest first. */
pushes.get('/open', async (c) => {
  const parsed = repoName.safeParse(c.req.query('repo'));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Pass ?repo=owner/name.' }, 400);
  const repo = await requireRepo(c, parsed.data);
  if (repo instanceof Response) return repo;
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM pushes WHERE repo_id = ? AND status IN ('pending', 'provider_error')
       AND (user_github_id IS NULL OR user_github_id = ?)
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(repo.id, userId)
    .all<PushRow>();
  const { results: commits } = await c.env.DB.prepare(
    'SELECT push_id, sha FROM commits WHERE push_id IN (SELECT value FROM json_each(?)) ORDER BY rowid',
  )
    .bind(JSON.stringify(results.map((p) => p.id)))
    .all<{ push_id: number; sha: string }>();
  return c.json({
    pushes: results.map((push) => ({
      id: push.id,
      status: push.status,
      base_sha: push.base_sha,
      head_sha: push.head_sha,
      created_at: push.created_at,
      commits: commits.filter((r) => r.push_id === push.id).map((r) => r.sha),
    })),
  });
});
