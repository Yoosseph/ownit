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

  it('waits at a terminal while the App gets installed, then finishes registering', async () => {
    const installUrl = 'https://github.com/apps/ownit-test/installations/new';
    let calls = 0;
    const server = createServer((req, res) => {
      req.resume();
      calls++;
      if (calls < 3) {
        res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({
          error: 'app_not_installed', message: 'Install the Ownit GitHub App on demo/shop first.', install_url: installUrl,
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        repo: 'demo/shop', tracked_since: '2026-10-26T00:00:00.000Z', installed: true, install_url: null, page_url: null,
      }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address() as { port: number };
      const repo = makeRepo();
      const result = await run(process.execPath, [CLI, 'init'], repo.work, cleanEnv({
        OWNIT_HOME: repo.root, OWNIT_SERVER: `http://127.0.0.1:${address.port}`, OWNIT_TTY: '1', OWNIT_NO_BROWSER: '1',
      }), '\n\n');
      expect(result.code).toBe(0);
      expect(calls).toBe(3);
      expect(result.output).toContain(installUrl);
      expect(result.output).toContain('Not yet');
      expect(result.output).toContain('The Ownit GitHub App is installed on demo/shop');
      expect(result.output).toContain('Registered demo/shop');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('lets the user finish later from the install prompt', async () => {
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: 'app_not_installed', install_url: 'https://github.com/apps/ownit-test/installations/new',
      }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address() as { port: number };
      const repo = makeRepo();
      const result = await run(process.execPath, [CLI, 'init'], repo.work, cleanEnv({
        OWNIT_HOME: repo.root, OWNIT_SERVER: `http://127.0.0.1:${address.port}`, OWNIT_TTY: '1', OWNIT_NO_BROWSER: '1',
      }), 'q\n');
      expect(result.code).toBe(1);
      expect(result.output).toContain('Then run "ownit init" again');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
