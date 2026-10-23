import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePick } from '../src/commands/interview.js';
import { cleanEnv, fakeServer, makeRepo, run } from './helpers.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** A repo with two waiting pushes (newest first), plus one whose commit is not in the clone. */
async function setup() {
  const repo = makeRepo();
  const base = repo.commit('a.txt', 'one\n', 'Start');
  const first = repo.commit('b.txt', 'two\n', 'Add the retry helper');
  const second = repo.commit('c.txt', 'three\n', 'Explain retries in the README');
  const push = (id: number, head: string, baseSha: string, status = 'pending') => ({
    id,
    status,
    base_sha: baseSha,
    head_sha: head,
    created_at: '2026-10-22T10:00:00Z',
    commits: [head],
  });
  const pushes = [push(2, second, first), push(1, first, base, 'skipped'), push(3, 'f'.repeat(40), base)];
  const s = await fakeServer({
    'GET /api/pushes/open': () => ({ pushes }),
    'POST /api/interview/start': (body) => ({
      push_id: body.push_id,
      total: 1,
      session: 'sess',
      questions: [{ idx: 0, kind: 'why', text: 'Why this change?' }],
    }),
    'POST /api/interview/answer': () => ({ pass: true, feedback: 'Good.', done: true, status: 'verified', followup: null, session: 's2' }),
  });
  servers.push(s);
  const interview = (input: string, args: string[] = []) =>
    run(process.execPath, [CLI, 'interview', ...args], repo.work, cleanEnv({ OWNIT_HOME: repo.root, OWNIT_SERVER: s.url }), input);
  return { interview, requests: s.requests };
}

const starts = (requests: { path: string; body: any }[]) => requests.filter((r) => r.path === '/api/interview/start').map((r) => r.body.push_id);

describe('ownit interview', { timeout: 60_000 }, () => {
  it('lists the waiting pushes by commit message and starts nothing until one is picked', async () => {
    const { interview, requests } = await setup();
    const { code, output } = await interview('q\n');
    expect(code).toBe(0);
    expect(output).toContain('3 pushes waiting for a debrief in demo/shop:');
    expect(output).toMatch(/1 {2}pending {2}[0-9a-f]{7} {2}Oct 22 {2}Explain retries in the README/);
    expect(output).toMatch(/2 {2}skipped {2}[0-9a-f]{7} {2}Oct 22 {2}Add the retry helper/);
    expect(output).toContain('not in this clone, run "git fetch"');
    expect(starts(requests)).toEqual([]);
  });

  it('debriefs the picked push, then offers the rest', async () => {
    const { interview, requests } = await setup();
    const { code, output } = await interview('2\nIt retries flaky calls.\nq\n');
    expect(code).toBe(0);
    expect(starts(requests)).toEqual([1]);
    expect(output).toContain('2 pushes waiting for a debrief');
  });

  it('refuses a push whose commits are not in the clone', async () => {
    const { interview, requests } = await setup();
    const { output } = await interview('3\nq\n');
    expect(output).toContain('is not in this clone');
    expect(starts(requests)).toEqual([]);
  });

  it('runs through every push with --all', async () => {
    const { interview, requests } = await setup();
    const { code, output } = await interview('First answer here.\nSecond answer here.\n', ['--all']);
    expect(starts(requests)).toEqual([2, 1]);
    expect(code).toBe(1);
    expect(output).toContain('1 push not in this clone');
  });
});

describe('parsePick', () => {
  it('reads numbers, Enter, all and quit', () => {
    expect(parsePick('2', 3)).toBe(1);
    expect(parsePick('', 3)).toBe(0);
    expect(parsePick('a', 3)).toBe('all');
    expect(parsePick('q', 3)).toBe('quit');
    expect(parsePick(null, 3)).toBe('quit');
    expect(parsePick('4', 3)).toBeNull();
    expect(parsePick('x', 3)).toBeNull();
  });
});

describe('stopping a debrief with "s"', { timeout: 60_000 }, () => {
  it('goes back to the list with the push still there', async () => {
    const { interview, requests } = await setup();
    const { code, output } = await interview('1\ns\nq\n');
    expect(code).toBe(0);
    expect(starts(requests)).toEqual([2]);
    expect(output.match(/3 pushes waiting for a debrief/g)).toHaveLength(2);
  });
});

describe('ownit interview --range', { timeout: 60_000 }, () => {
  it('takes a single commit and debriefs just that one, reporting earlier work it credited', async () => {
    const repo = makeRepo();
    const base = repo.commit('a.txt', 'one\n', 'Start');
    const head = repo.commit('b.txt', 'two\n', 'Add the retry helper');
    const s = await fakeServer({
      'POST /api/interview/start': () => ({ push_id: 7, total: 1, session: 'sess', questions: [{ idx: 0, kind: 'why', text: 'Why?' }] }),
      'POST /api/interview/answer': () => ({ pass: true, feedback: 'Good.', done: true, status: 'verified', followup: null, earlier_credited: 1, session: 's2' }),
    });
    servers.push(s);
    const { code, output } = await run(
      process.execPath,
      [CLI, 'interview', '--range', head.slice(0, 7)],
      repo.work,
      cleanEnv({ OWNIT_HOME: repo.root, OWNIT_SERVER: s.url }),
      'It retries flaky calls.\n',
    );
    expect(code).toBe(0);
    const start = s.requests.find((r) => r.path === '/api/interview/start')!;
    expect(start.body).toMatchObject({ base_sha: base, head_sha: head, commits: [{ sha: head }] });
    expect(output).toContain('1 earlier commit now counts as verified.');
  });
});
