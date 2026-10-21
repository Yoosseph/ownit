import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { attachCommits, createPush, findPushForCommits, getRepo, setPushStatus, upsertRepo, type PushRow } from '../db';
import { log } from '../log';

const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);

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
  const parsed = recordBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid push record.' }, 400);
  const body = parsed.data;
  const [owner, name] = body.repo.split('/') as [string, string];
  const repo = await upsertRepo(c.env.DB, { owner, name, installationId: null, private: false });
  const shas = body.commits.map((x) => x.sha);

  let push = await findPushForCommits(c.env.DB, repo.id, body.head_sha, shas);
  if (push && isResolved(push)) return c.json({ push_id: push.id, status: push.status });
  push ??= await createPush(c.env.DB, {
    repoId: repo.id,
    userId: c.get('userId'),
    baseSha: body.base_sha ?? null,
    headSha: body.head_sha,
    status: body.status,
  });
  await attachCommits(c.env.DB, repo.id, push.id, shas);
  if (body.status === 'skipped' && push.status !== 'skipped') await setPushStatus(c.env.DB, push.id, 'skipped');
  log('push.record', { repo: body.repo, push: push.id, status: body.status });
  return c.json({ push_id: push.id, status: body.status === 'skipped' ? 'skipped' : push.status });
});

/** Tells the hook whether these commits were already debriefed, so a retried push is not asked twice. */
pushes.post('/lookup', async (c) => {
  const parsed = lookupBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid lookup.' }, 400);
  const [owner, name] = parsed.data.repo.split('/') as [string, string];
  const repo = await getRepo(c.env.DB, owner, name);
  const push = repo ? await findPushForCommits(c.env.DB, repo.id, parsed.data.head_sha, parsed.data.shas) : null;
  return c.json(push ? { push_id: push.id, status: push.status } : { push_id: null, status: null });
});

/** Pushes still waiting for a debrief (pending or provider_error), newest first. */
pushes.get('/open', async (c) => {
  const parsed = repoName.safeParse(c.req.query('repo'));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Pass ?repo=owner/name.' }, 400);
  const [owner, name] = parsed.data.split('/') as [string, string];
  const repo = await getRepo(c.env.DB, owner, name);
  if (!repo) return c.json({ pushes: [] });
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM pushes WHERE repo_id = ? AND status IN ('pending', 'provider_error')
       AND (? IS NULL OR user_github_id IS NULL OR user_github_id = ?)
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(repo.id, userId, userId)
    .all<PushRow>();
  const out = [];
  for (const push of results) {
    const commits = await c.env.DB.prepare('SELECT sha FROM commits WHERE push_id = ? ORDER BY rowid').bind(push.id).all<{ sha: string }>();
    out.push({
      id: push.id,
      status: push.status,
      base_sha: push.base_sha,
      head_sha: push.head_sha,
      created_at: push.created_at,
      commits: commits.results.map((r) => r.sha),
    });
  }
  return c.json({ pushes: out });
});
