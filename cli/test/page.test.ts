import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanEnv, fakeServer, makeRepo, run } from './helpers.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const SETTINGS = { repo: 'demo/shop', private: false, show_questions: true, show_answers: false, page_url: 'https://ownit.test/demo/shop' };

async function page(args: string[]) {
  const s = await fakeServer({
    'GET /api/repos/settings': () => SETTINGS,
    'PUT /api/repos/settings': (body) => ({ ...SETTINGS, show_answers: Boolean(body.show_answers) }),
  });
  servers.push(s);
  const repo = makeRepo();
  const result = await run(process.execPath, [CLI, 'page', ...args], repo.work, cleanEnv({ OWNIT_HOME: repo.root, OWNIT_SERVER: s.url }));
  return { ...result, requests: s.requests };
}

describe('ownit page', { timeout: 60_000 }, () => {
  it("shows the repo's page and what it shows", async () => {
    const { code, output } = await page([]);
    expect(code).toBe(0);
    expect(output).toContain('https://ownit.test/demo/shop');
    expect(output).toContain('Questions: shown');
    expect(output).toContain('Answers:   hidden');
  });

  it('turns answers on for the repo', async () => {
    const { code, output, requests } = await page(['answers', 'on']);
    expect(code).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', body: { repo: 'demo/shop', show_answers: true } });
    expect(output).toContain('Answers:   shown');
    expect(output).toContain('passing answers are saved and shown');
  });

  it('rejects anything else', async () => {
    const { code, output } = await page(['answers', 'maybe']);
    expect(code).toBe(1);
    expect(output).toContain('Usage: ownit page');
  });
});
