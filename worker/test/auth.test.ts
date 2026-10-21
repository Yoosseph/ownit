import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, sha, startBody, testEnv, USER } from './helpers/env';

const record = { repo: 'octo/shop', base_sha: sha(1), head_sha: sha(3), commits: [{ sha: sha(3) }], status: 'pending' };

describe('device flow login', () => {
  it('issues a session token after GitHub authorizes, storing only its hash', async () => {
    const env = testEnv();
    env.github.deviceReplies = [{ error: 'authorization_pending' }, { accessToken: 'gho_user' }];
    const start = await call(env, 'POST', '/auth/device/start');
    expect(start.json).toMatchObject({ user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', device_code: 'dev-code' });

    const pending = await call(env, 'POST', '/auth/device/poll', { device_code: 'dev-code' });
    expect(pending.json).toEqual({ status: 'authorization_pending', interval: null });

    const done = await call(env, 'POST', '/auth/device/poll', { device_code: 'dev-code' });
    expect(done.json).toMatchObject({ status: 'ok', login: 'mona', token: expect.stringMatching(/^ownit_[\w-]{40,}$/) });

    const hashes = (env.DB.raw.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[]).map((r) => r.token_hash);
    expect(hashes).toContain(createHash('sha256').update(done.json.token).digest('hex'));
    expect(JSON.stringify(env.DB.raw.prepare('SELECT * FROM sessions').all())).not.toContain('gho_user');

    // The new token works.
    const api = await call(env, 'GET', '/api/pushes/open?repo=octo/shop', undefined, { authorization: `Bearer ${done.json.token}` });
    expect(api.status).toBe(200);
  });

  it('logout revokes the token', async () => {
    const env = testEnv();
    await call(env, 'DELETE', '/auth/session');
    expect((await call(env, 'GET', '/api/pushes/open?repo=octo/shop')).status).toBe(401);
  });
});

describe('API authentication', () => {
  it.each([
    ['POST', '/api/interview/start', startBody()],
    ['POST', '/api/interview/answer', { session: 'x', idx: 0, answer: 'a', commits: [{ sha: sha(1), message: 'm' }], diff: '', diff_truncated: false }],
    ['POST', '/api/interview/skip', { session: 'x' }],
    ['POST', '/api/pushes', record],
    ['POST', '/api/pushes/lookup', { repo: 'octo/shop', head_sha: sha(3), shas: [sha(3)] }],
    ['GET', '/api/pushes/open?repo=octo/shop', undefined],
    ['POST', '/api/repos', { repo: 'octo/shop' }],
  ])('%s %s rejects missing and invalid tokens', async (method, path, body) => {
    const env = testEnv();
    for (const authorization of ['', 'Bearer nope', 'Bearer ownit_not-a-real-session-token-xxxxxxxx', 'Basic abc']) {
      const res = await call(env, method, path, body, { authorization });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe('unauthorized');
    }
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM pushes').get()).toEqual({ n: 0 });
  });

  it('rejects expired sessions', async () => {
    const env = testEnv();
    env.DB.raw.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    expect((await call(env, 'POST', '/api/pushes', record)).status).toBe(401);
  });

  it('leaves public pages, the badge, and the webhook open', async () => {
    const env = testEnv();
    const anon = { authorization: '' };
    expect((await call(env, 'GET', '/badge/octo/shop.svg', undefined, anon)).status).toBe(200);
    expect((await call(env, 'GET', '/octo/shop', undefined, anon)).status).toBe(200);
  });
});

describe('push access', () => {
  for (const permission of ['read', 'triage', 'none']) {
    it(`a user with "${permission}" access cannot record debriefs`, async () => {
      const env = testEnv();
      env.github.permissions.set('octo/shop:mona', permission);
      const start = await call(env, 'POST', '/api/interview/start', startBody());
      expect(start.status).toBe(403);
      expect(start.json.error).toBe('forbidden');
      expect((await call(env, 'POST', '/api/pushes', record)).status).toBe(403);
      expect((await call(env, 'POST', '/api/repos', { repo: 'octo/shop' })).status).toBe(403);
      expect(env.DB.raw.prepare('SELECT count(*) AS n FROM pushes').get()).toEqual({ n: 0 });
    });
  }

  for (const permission of ['write', 'maintain', 'admin']) {
    it(`"${permission}" access can`, async () => {
      const env = testEnv();
      env.github.permissions.set('octo/shop:mona', permission);
      expect((await call(env, 'POST', '/api/interview/start', startBody())).status).toBe(200);
    });
  }

  it('records the push under the logged-in user', async () => {
    const env = testEnv();
    await call(env, 'POST', '/api/interview/start', startBody());
    expect(env.DB.raw.prepare('SELECT user_github_id FROM pushes').get()).toEqual({ user_github_id: USER.id });
  });

  it("does not let one user take over another user's push", async () => {
    const env = testEnv();
    await call(env, 'POST', '/api/interview/start', startBody());
    env.DB.raw.prepare('UPDATE pushes SET user_github_id = 7').run();
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(403);
  });

  it('a debrief session only works for the user who started it', async () => {
    const env = testEnv();
    const start = await call(env, 'POST', '/api/interview/start', startBody());
    env.DB.raw.prepare("INSERT INTO users (github_id, login) VALUES (7, 'eve')").run();
    env.DB.raw
      .prepare("INSERT INTO sessions (token_hash, github_id, created_at, expires_at) VALUES (?, 7, '2026-01-01', '2999-01-01')")
      .run(createHash('sha256').update('ownit_eve-session-token-0123456789').digest('hex'));
    const { commits, diff, diff_truncated } = startBody();
    const res = await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer: 'Totals were wrong.', commits, diff, diff_truncated }, {
      authorization: 'Bearer ownit_eve-session-token-0123456789',
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('bad_session');
  });

  it('requires the App on the repo', async () => {
    const env = testEnv();
    env.DB.raw.prepare('UPDATE repos SET installation_id = NULL').run();
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('app_not_installed');
  });

  it('DEV_LOCAL_TRUST skips the check only for localhost requests', async () => {
    const env = testEnv({ DEV_LOCAL_TRUST: '1' });
    env.DB.raw.prepare('UPDATE repos SET installation_id = NULL').run();
    expect((await call(env, 'POST', 'http://127.0.0.1:8787/api/interview/start', startBody())).status).toBe(200);
    expect((await call(env, 'POST', 'https://ownit.example.com/api/interview/start', startBody())).status).toBe(403);
  });
});
