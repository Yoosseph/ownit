import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { badgeSvg, repoBadge } from '../badge';
import { getRepo, listQuestionsForPushes, listRecentPushes } from '../db';
import { withoutTrailingSlash } from '../links';
import { renderRepoPage, type PagePush } from '../page';
import { repoStats } from '../stats';

const NAME = /^[\w.-]+$/;

export const publicPages = new Hono<AppEnv>();

publicPages.get('/badge/:owner/:file', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('file').replace(/\.svg$/, '');
  const repo = NAME.test(owner) && NAME.test(name) ? await getRepo(c.env.DB, owner, name) : null;
  const stats = repo ? (await repoStats(c.env.DB, repo.id)).overall : null;
  return c.body(badgeSvg(repoBadge(stats)), 200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    // Short cache so the README badge updates soon after a debrief.
    'cache-control': 'public, max-age=60, s-maxage=60',
  });
});

publicPages.get('/:owner/:repo', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('repo');
  if (!NAME.test(owner) || !NAME.test(name)) return c.notFound();
  const repo = await getRepo(c.env.DB, owner, name);
  if (!repo) return c.html('<!doctype html><title>Not tracked · Ownit</title><p>This repo is not tracked by Ownit.</p>', 404);

  const stats = await repoStats(c.env.DB, repo.id);
  const recent = await listRecentPushes(c.env.DB, repo.id);
  // All questions in one query (D1 free plan: 50 queries per request).
  const questions = await listQuestionsForPushes(c.env.DB, recent.map((p) => p.id));
  const pushes: PagePush[] = recent.map((push) => ({
    ...push,
    questions: questions.filter((q) => q.push_id === push.id).map(({ push_id: _id, ...q }) => q),
  }));
  const origin = withoutTrailingSlash(c.env.PUBLIC_URL || new URL(c.req.url).origin);
  c.header('cache-control', 'public, max-age=60');
  return c.html(renderRepoPage(origin, repo, stats, pushes));
});
