import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../src/api.js';
import { runDebrief, type DebriefTarget } from '../src/debrief.js';
import { createPrompter } from '../src/ui.js';

const target: DebriefTarget = {
  repo: 'demo/shop',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), message: 'Round totals' }],
  diff: { diff: 'diff --git a/x b/x\n', truncated: false, changedLines: 120, files: 1, omitted: [] },
};

type Handler = (body: any) => unknown;

function fakeApi(handlers: Record<string, Handler | Handler[]>) {
  const calls: { path: string; body: any }[] = [];
  const counters: Record<string, number> = {};
  const api: ApiClient = {
    server: 'http://test',
    async request<T>(_method: string, path: string, body?: unknown) {
      calls.push({ path, body });
      const handler = handlers[path];
      const n = (counters[path] = (counters[path] ?? 0) + 1);
      const fn = Array.isArray(handler) ? handler[Math.min(n - 1, handler.length - 1)] : handler;
      if (!fn) throw new Error(`unexpected ${path}`);
      return fn(body) as T;
    },
  };
  return { api, calls };
}

function run(api: ApiClient, input: string) {
  const out = new PassThrough();
  let text = '';
  out.on('data', (d) => (text += d));
  const prompter = createPrompter(Readable.from([input]), out);
  return runDebrief(api, prompter, target).then((outcome) => ({ outcome, text }));
}

const start = {
  push_id: 7,
  total: 2,
  session: 's0',
  questions: [
    { idx: 0, kind: 'why', text: 'Why round totals?' },
    { idx: 1, kind: 'how', text: 'How does rounding work here?' },
  ],
};

describe('runDebrief', () => {
  it('walks every question, shows progress, and offers a follow-up on a fail', async () => {
    const { api, calls } = fakeApi({
      '/api/interview/start': () => start,
      '/api/interview/answer': [
        () => ({ pass: true, feedback: 'Right.', done: false, status: 'pending', followup: null, session: 's1' }),
        () => ({
          pass: false,
          feedback: 'Missing the rounding step.',
          done: false,
          status: 'pending',
          followup: { idx: 1, kind: 'how', text: 'What happens to 0.1 + 0.2?' },
          session: 's2',
        }),
        () => ({ pass: true, feedback: 'Yes.', done: true, status: 'verified', followup: null, session: 's3' }),
      ],
    });
    const { outcome, text } = await run(api, 'Totals drifted.\n\nno idea\nIt rounds to cents.\n');
    expect(outcome.status).toBe('verified');
    expect(text).toContain('Question 1/2');
    expect(text).toContain('Question 2/2');
    expect(text).toContain('Missing the rounding step.');
    expect(text).toContain('What happens to 0.1 + 0.2?');
    expect(text).toContain('follow-up');
    const answers = calls.filter((c) => c.path === '/api/interview/answer');
    expect(answers.map((c) => [c.body.idx, c.body.session, c.body.answer])).toEqual([
      [0, 's0', 'Totals drifted.'],
      [1, 's1', 'no idea'],
      [1, 's2', 'It rounds to cents.'],
    ]);
    expect(answers[0]!.body.diff).toBe(target.diff.diff);
  });

  it('skips on "s"', async () => {
    const { api, calls } = fakeApi({
      '/api/interview/start': () => start,
      '/api/interview/skip': () => ({ status: 'skipped' }),
    });
    const { outcome } = await run(api, 's\n');
    expect(outcome.status).toBe('skipped');
    expect(calls.at(-1)).toEqual({ path: '/api/interview/skip', body: { session: 's0' } });
  });

  it('pauses as pending when input ends', async () => {
    const { api } = fakeApi({ '/api/interview/start': () => start });
    const { outcome, text } = await run(api, '');
    expect(outcome.status).toBe('pending');
    expect(text).toContain('ownit interview');
  });

  it('reports provider errors without failing the push', async () => {
    const { api } = fakeApi({
      '/api/interview/start': () => {
        throw new ApiError('Nebius rejected the API key.', 502, 'provider_error');
      },
    });
    const { outcome, text } = await run(api, '');
    expect(outcome).toEqual({ status: 'provider_error', reason: 'Nebius rejected the API key.' });
    expect(text).toContain("won't count until you retry");
  });
});
