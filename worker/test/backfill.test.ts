import { describe, expect, it } from 'vitest';
import { clearPermissionCache } from '../src/access';
import { call, sha, startBody, testEnv, type TestEnv } from './helpers/env';

/** Debriefs the sample commits (sha 2 and 3, head 3) and passes; returns the answer response. */
async function debrief(env: TestEnv, answer = 'Totals ignored item quantity before.') {
  const start = await call(env, 'POST', '/api/interview/start', startBody());
  const { commits, diff, diff_truncated } = startBody();
  return (await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer, commits, diff, diff_truncated })).json;
}

function allowBackfill(env: TestEnv) {
  env.DB.raw.prepare('UPDATE repos SET allow_backfill = 1').run();
  env.github.commits.add(`octo/shop:${sha(3)}`);
}

const summary = async (env: TestEnv) => (await call(env, 'GET', '/octo/shop')).text.replace(/\s+/g, ' ');

describe('earlier work (backfill)', () => {
  it('does not count unless the repo allows it', async () => {
    const env = testEnv();
    env.github.commits.add(`octo/shop:${sha(3)}`);
    const res = await debrief(env);
    expect(res).toMatchObject({ done: true, earlier_credited: 0 });
    expect(await summary(env)).toContain('No commits tracked yet.');
  });

  it('counts commits from before tracking as verified once a debrief passes', async () => {
    const env = testEnv();
    allowBackfill(env);
    const res = await debrief(env);
    expect(res).toMatchObject({ done: true, status: 'verified', earlier_credited: 2 });
    const page = await summary(env);
    expect(page).toContain('2 of 2 commits verified · 0 waiting for a debrief');
    expect(page).toContain('earlier work');
    expect(env.DB.raw.prepare('SELECT DISTINCT author_login AS a FROM commits').all()).toEqual([{ a: 'mona' }]);
  });

  it('credits commits that landed before tracking began', async () => {
    const env = testEnv();
    allowBackfill(env);
    await debrief(env);
    env.DB.raw.prepare("UPDATE commits SET backfilled = 0, pushed_at = '2026-09-01T00:00:00.000Z'").run();
    env.DB.raw.prepare("UPDATE pushes SET status = 'pending'").run();
    const res = await debrief(env);
    expect(res.earlier_credited).toBe(2);
  });

  it('never counts earlier work as unverified', async () => {
    const env = testEnv();
    allowBackfill(env);
    const fail = await debrief(env, "I don't know");
    expect(fail.done).toBe(false);
    expect(await summary(env)).toContain('No commits tracked yet.');
  });

  it('needs the head commit to exist on GitHub', async () => {
    const env = testEnv();
    env.DB.raw.prepare('UPDATE repos SET allow_backfill = 1').run();
    expect((await debrief(env)).earlier_credited).toBe(0);
  });

  it('is an admin setting, allowed on private repos too', async () => {
    const env = testEnv();
    env.DB.raw.prepare('UPDATE repos SET private = 1').run();
    expect((await call(env, 'PUT', '/api/repos/settings', { repo: 'octo/shop', allow_backfill: true })).status).toBe(403);
    env.github.permissions.set('octo/shop:mona', 'admin');
    clearPermissionCache();
    const res = await call(env, 'PUT', '/api/repos/settings', { repo: 'octo/shop', allow_backfill: true });
    expect(res.json).toMatchObject({ private: true, allow_backfill: true, show_answers: false });
  });
});
