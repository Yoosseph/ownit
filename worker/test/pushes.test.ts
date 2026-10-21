import { describe, expect, it } from 'vitest';
import { call, sha, startBody, testEnv } from './helpers/env';

const record = (status: 'pending' | 'skipped', extra: Record<string, unknown> = {}) => ({
  repo: 'octo/shop',
  base_sha: sha(1),
  head_sha: sha(3),
  commits: [{ sha: sha(2) }, { sha: sha(3) }],
  status,
  ...extra,
});

describe('POST /api/pushes', () => {
  it('records a pending push with its commits', async () => {
    const env = testEnv();
    const res = await call(env, 'POST', '/api/pushes', record('pending'));
    expect(res.json).toEqual({ push_id: 1, status: 'pending' });
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM commits WHERE push_id = 1').get()).toEqual({ n: 2 });
  });

  it('records a skip, and a later skip of a pending push', async () => {
    const env = testEnv();
    expect((await call(env, 'POST', '/api/pushes', record('skipped'))).json.status).toBe('skipped');

    const other = testEnv();
    await call(other, 'POST', '/api/pushes', record('pending'));
    expect((await call(other, 'POST', '/api/pushes', record('skipped'))).json).toEqual({ push_id: 1, status: 'skipped' });
    expect(other.DB.raw.prepare('SELECT count(*) AS n FROM pushes').get()).toEqual({ n: 1 });
  });

  it('never downgrades a verified push', async () => {
    const env = testEnv();
    const start = await call(env, 'POST', '/api/interview/start', startBody());
    const { commits, diff, diff_truncated } = startBody();
    await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer: 'Totals ignored quantity before.', commits, diff, diff_truncated });
    const res = await call(env, 'POST', '/api/pushes', record('skipped'));
    expect(res.json.status).toBe('verified');
  });
});

describe('POST /api/pushes/lookup', () => {
  it('finds the push that owns the commits', async () => {
    const env = testEnv();
    expect((await call(env, 'POST', '/api/pushes/lookup', { repo: 'octo/shop', head_sha: sha(3), shas: [sha(3)] })).json).toEqual({ push_id: null, status: null });
    await call(env, 'POST', '/api/pushes', record('skipped'));
    const res = await call(env, 'POST', '/api/pushes/lookup', { repo: 'octo/shop', head_sha: sha(9), shas: [sha(2)] });
    expect(res.json).toEqual({ push_id: 1, status: 'skipped' });
  });
});

describe('GET /api/pushes/open', () => {
  it('lists pending and provider_error pushes with their commits', async () => {
    const env = testEnv();
    await call(env, 'POST', '/api/pushes', record('pending'));
    await call(env, 'POST', '/api/pushes', record('skipped', { head_sha: sha(5), commits: [{ sha: sha(5) }] }));
    const res = await call(env, 'GET', '/api/pushes/open?repo=octo/shop');
    expect(res.json.pushes).toEqual([
      expect.objectContaining({ id: 1, status: 'pending', base_sha: sha(1), head_sha: sha(3), commits: [sha(2), sha(3)] }),
    ]);
  });
});
