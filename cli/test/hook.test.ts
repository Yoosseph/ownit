import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { interpretChoice, isAgentEnvironment } from '../src/commands/hook.js';
import { hookScript, installHook, isOwnitHook, uninstallHook } from '../src/hooks.js';
import { computePush, parseRefs } from '../src/pushRange.js';
import { cleanEnv, fakeServer, makeRepo, run, sh } from './helpers.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');
const fallback = { node: process.execPath.replaceAll('\\', '/'), cli: CLI.replaceAll('\\', '/') };


const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const START = {
  push_id: 1,
  total: 1,
  session: 'sess',
  questions: [{ idx: 0, kind: 'why', text: 'Why does the cart round totals now?' }],
};

async function server(routes: Parameters<typeof fakeServer>[0] = {}) {
  const s = await fakeServer({
    'POST /api/pushes/lookup': () => ({ push_id: null, status: null }),
    'POST /api/pushes': (body) => ({ push_id: 1, status: body.status }),
    'POST /api/interview/start': () => START,
    'POST /api/interview/answer': () => ({ pass: true, feedback: 'Good.', done: true, status: 'verified', followup: null, session: 's2' }),
    'POST /api/interview/skip': () => ({ status: 'skipped' }),
    ...routes,
  });
  servers.push(s);
  return s;
}

/** A repo with one pushed commit and one new commit, with the Ownit hook installed. */
function setup() {
  const repo = makeRepo();
  repo.commit('cart.js', 'export const total = (xs) => xs.reduce((s, x) => s + x.price, 0);\n', 'Add cart');
  sh(repo.work, 'push', '-q', 'origin', 'main');
  repo.commit('cart.js', 'export const total = (xs) => Math.round(xs.reduce((s, x) => s + x.price * x.qty, 0) * 100) / 100;\n', 'Round totals');
  installHook(join(repo.work, '.git', 'hooks'), hookScript(fallback));
  return repo;
}

const TOKEN = 'ownit_test-session-token-0123456789';

function push(repo: ReturnType<typeof setup>, env: Record<string, string>, { loggedIn = true } = {}) {
  const home = join(repo.root, 'home');
  if (loggedIn) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ token: TOKEN, login: 'mona', apiKey: 'nb-secret-key' }));
  }
  return run('git', ['push', 'origin', 'main'], repo.work, cleanEnv({ OWNIT_HOME: home, ...env }));
}

function ttyFile(repo: ReturnType<typeof setup>, lines: string[]) {
  const file = join(repo.root, 'tty.txt');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file.replaceAll('\\', '/');
}

const remoteHead = (repo: ReturnType<typeof setup>) => execFileSync('git', ['--git-dir', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
const localHead = (repo: ReturnType<typeof setup>) => sh(repo.work, 'rev-parse', 'HEAD');

describe('pre-push hook (real git push)', () => {
  it('Y runs the debrief inline, then the push continues', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['y', 'Totals were off for several items.']) });
    expect(result.code).toBe(0);
    expect(result.output).toContain('Debrief now? [Y/n/s=skip]');
    expect(result.output).toContain('Question 1/1');
    expect(result.output).toContain('Push verified');
    expect(remoteHead(repo)).toBe(localHead(repo));
    const start = s.requests.find((r) => r.path === '/api/interview/start')!;
    expect(start.body.repo).toBe('demo/shop');
    expect(start.body.commits.map((c: any) => c.message)).toEqual(['Round totals']);
    expect(start.body.diff).toContain('diff --git a/cart.js b/cart.js');
    expect(start.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(start.headers['x-model-key']).toBe('nb-secret-key');
    expect(start.headers['x-model-provider']).toBe('nebius');
    // The key goes only to debrief calls.
    expect(s.requests.find((r) => r.path === '/api/pushes/lookup')!.headers['x-model-key']).toBeUndefined();
  }, 60_000);

  it('when logged out, says so and pushes without contacting the server', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['y']) }, { loggedIn: false });
    expect(result.code).toBe(0);
    expect(result.output).toContain('not logged in');
    expect(s.requests).toHaveLength(0);
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('a rejected session prints the reason and pushes', async () => {
    const repo = setup();
    const s = await fakeServer({});
    servers.push(s);
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: join(repo.root, 'no-tty') });
    expect(result.code).toBe(0);
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('n records the push as pending, prints the hint, and pushes', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['n']) });
    expect(result.code).toBe(0);
    expect(result.output).toContain('Run "ownit interview" when you\'re ready');
    expect(s.requests.find((r) => r.path === '/api/pushes')?.body.status).toBe('pending');
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('s records a skip and pushes', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['s']) });
    expect(result.code).toBe(0);
    expect(s.requests.find((r) => r.path === '/api/pushes')?.body.status).toBe('skipped');
    expect(s.requests.some((r) => r.path === '/api/interview/start')).toBe(false);
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('without a TTY marks the push pending and succeeds', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: join(repo.root, 'no-such-tty') });
    expect(result.code).toBe(0);
    expect(result.output).not.toContain('Debrief now?');
    expect(result.output).toContain('pending');
    expect(s.requests.find((r) => r.path === '/api/pushes')?.body.status).toBe('pending');
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('a coding agent environment is treated as no TTY', async () => {
    const repo = setup();
    const s = await server();
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['y']), CLAUDECODE: '1' });
    expect(result.output).not.toContain('Debrief now?');
    expect(s.requests.find((r) => r.path === '/api/pushes')?.body.status).toBe('pending');
  }, 60_000);

  it('with the worker unreachable prints a reason and succeeds', async () => {
    const repo = setup();
    const result = await push(repo, { OWNIT_SERVER: 'http://127.0.0.1:9', OWNIT_TTY_DEVICE: ttyFile(repo, ['y']) });
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/Ownit: Ownit server unreachable .* The push continues/);
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('a provider error during the debrief lets the push continue', async () => {
    const repo = setup();
    const s = await fakeServer({
      'POST /api/pushes/lookup': () => ({ push_id: null, status: null }),
    });
    servers.push(s);
    // The fake server 404s /start; any non-2xx must not block the push.
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['y']) });
    expect(result.code).toBe(0);
    expect(remoteHead(repo)).toBe(localHead(repo));
  }, 60_000);

  it('does not ask again for commits that were already debriefed', async () => {
    const repo = setup();
    const s = await server({ 'POST /api/pushes/lookup': () => ({ push_id: 1, status: 'verified' }) });
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['y']) });
    expect(result.output).toContain('already verified');
    expect(result.output).not.toContain('Debrief now?');
  }, 60_000);

  it('asks again for commits that were only skipped, since they are still unverified', async () => {
    const repo = setup();
    const s = await server({ 'POST /api/pushes/lookup': () => ({ push_id: 1, status: 'skipped' }) });
    const result = await push(repo, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo, ['n']) });
    expect(result.output).toContain('Debrief now?');
    expect(result.output).not.toContain('already skipped');
  }, 60_000);

  it('runs an existing pre-push hook first, with the same refs', async () => {
    const repo = makeRepo();
    repo.commit('a.txt', 'a\n', 'first');
    const hooks = join(repo.work, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    const marker = join(repo.root, 'original-ran.txt').replaceAll('\\', '/');
    writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\ncat > '${marker}'\necho "original hook: $1"\n`);
    chmodSync(join(hooks, 'pre-push'), 0o755);
    const result = installHook(hooks, hookScript(fallback));
    expect(result.chained).toBe(true);

    const s = await server();
    const pushed = await push(repo as any, { OWNIT_SERVER: s.url, OWNIT_TTY_DEVICE: ttyFile(repo as any, ['n']) });
    expect(pushed.code).toBe(0);
    expect(pushed.output).toContain('original hook: origin');
    expect(readFileSync(marker, 'utf8')).toMatch(/^refs\/heads\/main [0-9a-f]{40} refs\/heads\/main 0{40}\n$/);
    expect(pushed.output.indexOf('original hook')).toBeLessThan(pushed.output.indexOf('Ownit'));
  }, 60_000);

  it('a failing original hook still blocks the push', async () => {
    const repo = makeRepo();
    repo.commit('a.txt', 'a\n', 'first');
    const hooks = join(repo.work, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\necho "lint failed" >&2\nexit 3\n');
    chmodSync(join(hooks, 'pre-push'), 0o755);
    installHook(hooks, hookScript(fallback));
    const s = await server();
    const pushed = await push(repo as any, { OWNIT_SERVER: s.url });
    expect(pushed.code).not.toBe(0);
    expect(pushed.output).toContain('lint failed');
    expect(s.requests).toHaveLength(0);
  }, 60_000);
});

describe('hook install', () => {
  it('chains, updates in place, and uninstalls back to the original hook', () => {
    const repo = makeRepo();
    const hooks = join(repo.work, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\nexit 0\n');
    expect(installHook(hooks, hookScript(fallback))).toMatchObject({ chained: true, updated: false });
    expect(installHook(hooks, hookScript(fallback))).toMatchObject({ chained: true, updated: true });
    expect(isOwnitHook(join(hooks, 'pre-push'))).toBe(true);
    expect(uninstallHook(hooks)).toEqual({ removed: true, restored: true });
    expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toBe('#!/bin/sh\nexit 0\n');
    expect(existsSync(join(hooks, 'pre-push.local'))).toBe(false);
  });

  it('refuses to clobber when both pre-push and pre-push.local exist', () => {
    const repo = makeRepo();
    const hooks = join(repo.work, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\n');
    writeFileSync(join(hooks, 'pre-push.local'), '#!/bin/sh\n');
    expect(() => installHook(hooks)).toThrow(/Merge them by hand/);
  });
});

describe('ref parsing', () => {
  it('parses pre-push stdin and ignores junk', () => {
    const z = '0'.repeat(40);
    const a = 'a'.repeat(40);
    expect(parseRefs(`refs/heads/main ${a} refs/heads/main ${z}\n\nnot a line\n`)).toEqual([
      { localRef: 'refs/heads/main', localSha: a, remoteRef: 'refs/heads/main', remoteSha: z },
    ]);
  });

  it('computes new commits for an existing branch, a new branch, and skips deletions', () => {
    const repo = makeRepo();
    const first = repo.commit('a.txt', '1\n', 'one');
    sh(repo.work, 'push', '-q', 'origin', 'main');
    const second = repo.commit('a.txt', '2\n', 'two');
    const third = repo.commit('a.txt', '3\n', 'three');
    const z = '0'.repeat(40);

    const existing = computePush(parseRefs(`refs/heads/main ${third} refs/heads/main ${first}`), 'origin', repo.work)!;
    expect(existing.commits.map((c) => c.message)).toEqual(['two', 'three']);
    expect(existing.base).toBe(first);

    const fresh = computePush(parseRefs(`refs/heads/feature ${third} refs/heads/feature ${z}`), 'origin', repo.work)!;
    expect(fresh.commits.map((c) => c.sha)).toEqual([second, third]);
    expect(fresh.base).toBe(first);

    expect(computePush(parseRefs(`(delete) ${z} refs/heads/old ${first}`), 'origin', repo.work)).toBeNull();
    expect(computePush(parseRefs(`refs/heads/main ${first} refs/heads/main ${first}`), 'origin', repo.work)).toBeNull();
  });
});

describe('prompt handling', () => {
  it('maps answers to choices', () => {
    expect(interpretChoice('')).toBe('debrief');
    expect(interpretChoice('Y')).toBe('debrief');
    expect(interpretChoice('n')).toBe('later');
    expect(interpretChoice('s')).toBe('skip');
    expect(interpretChoice(null)).toBe('later');
    expect(interpretChoice('whatever')).toBe('later');
  });

  it('detects coding agents', () => {
    expect(isAgentEnvironment({ CLAUDECODE: '1' })).toBe(true);
    expect(isAgentEnvironment({ CI: 'false' })).toBe(false);
    expect(isAgentEnvironment({})).toBe(false);
  });
});
