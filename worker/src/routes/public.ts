import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { badgeColor, badgeMessage, badgeSvg } from '../badge';
import { getRepo, type PushStatus } from '../db';
import { renderRepoPage, type PagePush } from '../page';
import { repoStats } from '../stats';

const NAME = /^[\w.-]+$/;

export const publicPages = new Hono<AppEnv>();

publicPages.get('/badge/:owner/:file', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('file').replace(/\.svg$/, '');
  const repo = NAME.test(owner) && NAME.test(name) ? await getRepo(c.env.DB, owner, name) : null;
  const pct = repo ? (await repoStats(c.env.DB, repo.id)).overall.verifiedPct : null;
  return c.body(badgeSvg('ownit', badgeMessage(pct, Boolean(repo)), badgeColor(pct)), 200, {
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
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.status, p.created_at, u.login AS pusher,
            (SELECT count(*) FROM commits c WHERE c.push_id = p.id AND c.pushed_at IS NOT NULL) AS commits
     FROM pushes p LEFT JOIN users u ON u.github_id = p.user_github_id
     WHERE p.repo_id = ? AND EXISTS (SELECT 1 FROM commits c WHERE c.push_id = p.id AND c.pushed_at IS NOT NULL)
     ORDER BY p.created_at DESC LIMIT 30`,
  )
    .bind(repo.id)
    .all<Omit<PagePush, 'questions'> & { status: PushStatus }>();
  const pushes: PagePush[] = [];
  for (const push of results) {
    const questions = await c.env.DB.prepare('SELECT kind, text, passed, attempts FROM questions WHERE push_id = ? ORDER BY idx')
      .bind(push.id)
      .all<PagePush['questions'][number]>();
    pushes.push({ ...push, questions: questions.results });
  }
  const origin = (c.env.PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
  c.header('cache-control', 'public, max-age=60');
  return c.html(renderRepoPage(origin, repo, stats, pushes));
});
