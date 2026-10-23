import { describe, expect, it } from 'vitest';
import { clearPermissionCache } from '../src/access';
import { call, startBody, testEnv, type TestEnv } from './helpers/env';

const settings = (env: TestEnv, body: Record<string, unknown>) => call(env, 'PUT', '/api/repos/settings', { repo: 'octo/shop', ...body });

function adminEnv() {
  const env = testEnv();
  env.github.permissions.set('octo/shop:mona', 'admin');
  return env;
}

async function passFirstQuestion(env: TestEnv) {
  const start = await call(env, 'POST', '/api/interview/start', startBody());
  const { commits, diff, diff_truncated } = startBody();
  await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer: '  Totals ignored item quantity.  ', commits, diff, diff_truncated });
  return start.json;
}

const storedAnswer = (env: TestEnv) => (env.DB.raw.prepare('SELECT answer FROM questions').get() as { answer: string | null }).answer;

describe('page settings', () => {
  it('shows questions and hides answers by default', async () => {
    const res = await call(testEnv(), 'GET', '/api/repos/settings?repo=octo/shop');
    expect(res.json).toEqual({ repo: 'octo/shop', private: false, show_questions: true, show_answers: false, page_url: 'https://ownit.test/octo/shop' });
  });

  it('lets only admins and maintainers change them', async () => {
    const env = testEnv();
    const denied = await settings(env, { show_answers: true });
    expect(denied.status).toBe(403);
    expect(denied.json.message).toContain('Only admins and maintainers');

    env.github.permissions.set('octo/shop:mona', 'maintain');
    clearPermissionCache();
    expect((await settings(env, { show_answers: true })).json.show_answers).toBe(true);
  });

  it('turns questions on with answers, and answers off with questions', async () => {
    const env = adminEnv();
    await settings(env, { show_questions: false });
    expect((await settings(env, { show_answers: true })).json).toMatchObject({ show_questions: true, show_answers: true });
    expect((await settings(env, { show_questions: false })).json).toMatchObject({ show_questions: false, show_answers: false });
  });

  it('refuses for private repos', async () => {
    const env = adminEnv();
    env.DB.raw.prepare('UPDATE repos SET private = 1').run();
    const res = await settings(env, { show_answers: true });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('private_repo');
  });
});

describe('stored answers', () => {
  it('are not kept while the page hides answers', async () => {
    const env = testEnv();
    const start = await passFirstQuestion(env);
    expect(start.answers_public).toBe(false);
    expect(storedAnswer(env)).toBeNull();
  });

  it('keep the passing answer once answers are shown, and are deleted when turned off', async () => {
    const env = adminEnv();
    await settings(env, { show_answers: true });
    const start = await passFirstQuestion(env);
    expect(start.answers_public).toBe(true);
    expect(storedAnswer(env)).toBe('Totals ignored item quantity.');
    env.DB.raw.prepare('UPDATE commits SET pushed_at = ?').run(new Date().toISOString());
    expect((await call(env, 'GET', '/octo/shop')).text).toContain('Totals ignored item quantity.');

    await settings(env, { show_answers: false });
    expect(storedAnswer(env)).toBeNull();
  });

  it('never keeps a failed answer', async () => {
    const env = adminEnv();
    await settings(env, { show_answers: true });
    const start = await call(env, 'POST', '/api/interview/start', startBody());
    const { commits, diff, diff_truncated } = startBody();
    await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer: "I don't know", commits, diff, diff_truncated });
    expect(storedAnswer(env)).toBeNull();
  });
});
