import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanEnv, makeRepo, run } from './helpers.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

describe('ownit init installation guidance', () => {
  it('shows the installation link and recovery steps when registration requires the App', async () => {
    const installUrl = 'https://github.com/apps/ownit-test/installations/new';
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: 'app_not_installed',
        message: 'Install the Ownit GitHub App on demo/shop first.',
        install_url: installUrl,
      }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address() as { port: number };
      const repo = makeRepo();
      const result = await run(process.execPath, [CLI, 'init'], repo.work, cleanEnv({
        OWNIT_HOME: repo.root, OWNIT_SERVER: `http://127.0.0.1:${address.port}`,
      }));
      expect(result.code).toBe(1);
      expect(result.output).toContain(installUrl);
      expect(result.output).toContain('repository owner');
      expect(result.output).toContain('ownit init');
      expect(result.output).toContain('Git pushes still work');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
