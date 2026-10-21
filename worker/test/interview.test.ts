import { describe, expect, it } from 'vitest';
import { unseal } from '../src/seal';
import { call, sha, startBody, testEnv } from './helpers/env';

describe('POST /api/interview/start', () => {
  it('returns validated questions and records a pending push with its commits', async () => {
    const env = testEnv();
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(1);
    expect(res.json.questions).toEqual([{ idx: 0, kind: 'why', text: expect.any(String) }]);
    expect(JSON.stringify(res.json)).not.toContain('reference');

    const push = env.DB.raw.prepare('SELECT * FROM pushes').get() as any;
    expect(push).toMatchObject({ status: 'pending', question_count: 1, head_sha: sha(3) });
    const commits = env.DB.raw.prepare('SELECT sha FROM commits WHERE push_id = ?').all(push.id);
    expect(commits).toHaveLength(2);
    const questions = env.DB.raw.prepare('SELECT * FROM questions').all() as any[];
    expect(questions[0]).toMatchObject({ idx: 0, kind: 'why', passed: 0, attempts: 0 });
  });

  it('scales the question count with changed lines', async () => {
    const res = await call(testEnv(), 'POST', '/api/interview/start', startBody({ changed_lines: 301 }));
    expect(res.json.questions.map((q: any) => q.kind)).toEqual(['why', 'how', 'next']);
  });

  it('seals references into the session token', async () => {
    const env = testEnv();
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    const state = await unseal<any>('test-secret', res.json.session);
    expect(state.pushId).toBe(res.json.push_id);
    expect(state.questions[0].reference).toEqual(expect.any(String));
    expect(await unseal('other-secret', res.json.session)).toBeUndefined();
  });

  it('rejects malformed requests', async () => {
    const res = await call(testEnv(), 'POST', '/api/interview/start', startBody({ head_sha: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('marks the push provider_error when no key is available', async () => {
    const env = testEnv({ MODEL_BACKEND: 'nebius' });
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ error: 'provider_error', reason: 'no_key' });
    expect((env.DB.raw.prepare('SELECT status FROM pushes').get() as any).status).toBe('provider_error');
  });

  it('reuses the same push on retry instead of creating another', async () => {
    const env = testEnv({ MODEL_BACKEND: 'nebius' });
    await call(env, 'POST', '/api/interview/start', startBody());
    env.MODEL_BACKEND = 'fixture';
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(200);
    const pushes = env.DB.raw.prepare('SELECT status FROM pushes').all() as any[];
    expect(pushes).toEqual([{ status: 'pending' }]);
  });
});
