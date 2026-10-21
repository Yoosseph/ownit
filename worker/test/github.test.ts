import { createHmac, generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkRunBody } from '../src/checks';
import { appJwt, importAppKey } from '../src/github';
import { verifySignature } from '../src/routes/webhook';
import { call, INSTALLATION_ID, sha, startBody, testEnv, type TestEnv } from './helpers/env';

const SECRET = 'hook-secret';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

function pushEvent(extra: Record<string, unknown> = {}) {
  return {
    ref: 'refs/heads/main',
    before: sha(1),
    after: sha(3),
    repository: { name: 'shop', owner: { login: 'octo' }, private: false },
    installation: { id: INSTALLATION_ID },
    sender: { id: 42, login: 'mona' },
    commits: [
      { id: sha(2), author: { username: 'mona', name: 'Mona' } },
      { id: sha(3), author: { username: 'mona', name: 'Mona' } },
    ],
    ...extra,
  };
}

function deliver(env: TestEnv, payload: unknown, event = 'push', signature?: string) {
  const body = JSON.stringify(payload);
  return call(env, 'POST', '/webhooks/github', body, {
    'x-github-event': event,
    'x-hub-signature-256': signature ?? sign(body),
  });
}

const env4 = () => testEnv({ GITHUB_WEBHOOK_SECRET: SECRET });

async function verifiedPush(env: TestEnv) {
  const start = await call(env, 'POST', '/api/interview/start', startBody());
  const { commits, diff, diff_truncated } = startBody();
  await call(env, 'POST', '/api/interview/answer', { session: start.json.session, idx: 0, answer: 'Totals ignored item quantity before.', commits, diff, diff_truncated });
}

describe('GitHub App auth', () => {
  it.each(['pkcs1', 'pkcs8'] as const)('signs a verifiable RS256 JWT from a %s key', async (type) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type, format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const jwt = await appJwt('123', await importAppKey(privateKey as unknown as string), 1_700_000_000);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: '123' });
    const ok = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey as unknown as string, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('webhook signature', () => {
  it('accepts the right HMAC and rejects anything else', async () => {
    expect(await verifySignature(SECRET, 'body', sign('body'))).toBe(true);
    expect(await verifySignature(SECRET, 'body!', sign('body'))).toBe(false);
    expect(await verifySignature(SECRET, 'body', undefined)).toBe(false);
    expect(await verifySignature(SECRET, 'body', 'sha1=abc')).toBe(false);
  });

  it('rejects unsigned deliveries before reading them', async () => {
    const env = env4();
    const res = await deliver(env, pushEvent(), 'push', 'sha256=' + '0'.repeat(64));
    expect(res.status).toBe(401);
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM pushes').get()).toEqual({ n: 0 });
  });
});

describe('push webhook', () => {
  it('attaches landed commits to their debrief and sets a success check run', async () => {
    const env = env4();
    await verifiedPush(env);
    const res = await deliver(env, pushEvent());
    expect(res.json).toEqual({ ok: true, pushes: [1] });

    const commits = env.DB.raw.prepare('SELECT sha, push_id, author_login, pushed_at FROM commits ORDER BY sha').all() as any[];
    expect(commits).toHaveLength(2);
    for (const c of commits) expect(c).toMatchObject({ push_id: 1, author_login: 'mona', pushed_at: expect.any(String) });

    expect(env.github.checkRuns).toHaveLength(1);
    expect(env.github.checkRuns[0]).toMatchObject({
      name: 'Ownit',
      head_sha: sha(3),
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Ownit: verified' },
      details_url: 'https://ownit.test/octo/shop',
    });
    expect((env.DB.raw.prepare('SELECT check_run_id FROM pushes').get() as any).check_run_id).toBe(1);
  });

  it('marks unmatched commits as a new pending push with an in-progress check', async () => {
    const env = env4();
    await deliver(env, pushEvent());
    const push = env.DB.raw.prepare('SELECT * FROM pushes').get() as any;
    expect(push).toMatchObject({ status: 'pending', user_github_id: 42, base_sha: sha(1), head_sha: sha(3) });
    expect(push.created_at).toEqual(expect.any(String));
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM commits WHERE push_id = ? AND pushed_at IS NOT NULL').get(push.id)).toEqual({ n: 2 });
    expect(env.github.checkRuns[0]).toMatchObject({ status: 'in_progress', output: { title: 'Ownit: pending' } });
    expect(env.DB.raw.prepare('SELECT login FROM users WHERE github_id = 42').get()).toEqual({ login: 'mona' });
  });

  it('updates the check run when a pending push is debriefed later', async () => {
    const env = env4();
    await call(env, 'POST', '/api/pushes', { repo: 'octo/shop', base_sha: sha(1), head_sha: sha(3), commits: [{ sha: sha(2) }, { sha: sha(3) }], status: 'pending' });
    await deliver(env, pushEvent());
    expect(env.github.checkRuns[0]!.status).toBe('in_progress');
    await verifiedPush(env);
    expect(env.github.checkRuns).toHaveLength(1);
    expect(env.github.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  it('skips create a neutral check run', async () => {
    const env = env4();
    await call(env, 'POST', '/api/pushes', { repo: 'octo/shop', base_sha: sha(1), head_sha: sha(3), commits: [{ sha: sha(2) }, { sha: sha(3) }], status: 'skipped' });
    await deliver(env, pushEvent());
    expect(env.github.checkRuns[0]).toMatchObject({ conclusion: 'neutral', output: { title: 'Ownit: skipped' } });
  });

  it('does not create a check run before the head commit lands', async () => {
    const env = env4();
    await verifiedPush(env);
    expect(env.github.checkRuns).toHaveLength(0);
  });

  it('ignores unregistered repos, branch deletions, and other events', async () => {
    const env = env4();
    expect((await deliver(env, pushEvent({ repository: { name: 'other', owner: { login: 'octo' }, private: false } }))).json.ignored).toBe('repo not registered');
    expect((await deliver(env, pushEvent({ after: '0'.repeat(40), deleted: true }))).json.ignored).toBe('branch deleted');
    expect((await deliver(env, {}, 'ping')).json).toEqual({ ok: true });
    expect((await deliver(env, {}, 'issues')).json.ignored).toBe('issues');
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM pushes').get()).toEqual({ n: 0 });
  });
});

describe('check run bodies', () => {
  const repo = { id: 1, owner: 'octo', name: 'shop', installation_id: 1, tracked_since: '', private: 0 };
  const push = (status: string) => ({ id: 5, repo_id: 1, user_github_id: 1, base_sha: null, head_sha: sha(3), status, question_count: 1, created_at: '', resolved_at: null, check_run_id: null }) as any;

  it('lists the questions on a verified push', () => {
    const body = checkRunBody(push('verified'), repo, ['Why round totals?'], 'https://ownit.test/');
    expect(body.output.summary).toContain('- Why round totals?');
    expect(body.details_url).toBe('https://ownit.test/octo/shop');
  });

  it('keeps provider errors pending', () => {
    expect(checkRunBody(push('provider_error'), repo, [], '')).toMatchObject({ status: 'in_progress', details_url: undefined });
  });
});

describe('POST /api/repos', () => {
  it('registers a repo with its installation and tracking date', async () => {
    const env = testEnv({}, { register: false });
    env.github.installations.set('octo/private-app', { installationId: 7, private: true });
    const res = await call(env, 'POST', '/api/repos', { repo: 'octo/private-app' });
    expect(res.json).toMatchObject({ repo: 'octo/private-app', installed: true, install_url: null, tracked_since: expect.any(String) });
    expect(env.DB.raw.prepare('SELECT installation_id, private FROM repos').get()).toEqual({ installation_id: 7, private: 1 });
  });

  it('refuses to register without the App and returns the install link', async () => {
    const env = testEnv({}, { register: false });
    const res = await call(env, 'POST', '/api/repos', { repo: 'octo/elsewhere' });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: 'app_not_installed', install_url: 'https://github.com/apps/ownit-test/installations/new' });
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM repos').get()).toEqual({ n: 0 });
  });

  it('keeps the original tracking date on re-registration', async () => {
    const env = testEnv();
    const res = await call(env, 'POST', '/api/repos', { repo: 'octo/shop' });
    expect(res.json.tracked_since).toBe('2026-10-01T00:00:00.000Z');
  });

  it('debrief routes reject unregistered repos', async () => {
    const env = testEnv({}, { register: false });
    const res = await call(env, 'POST', '/api/interview/start', startBody());
    expect(res.status).toBe(404);
    expect(res.json.error).toBe('not_registered');
  });
});
