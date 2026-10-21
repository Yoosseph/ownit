import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanEnv, fakeServer, run } from './helpers.js';

// The built CLI; test/build.ts compiles it before the suite runs.
const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('ownit login', () => {
  it('completes the device flow and saves the session token', async () => {
    const s = await fakeServer({
      'POST /auth/device/start': () => ({ device_code: 'dc', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 0 }),
      'POST /auth/device/poll': [
        () => ({ status: 'authorization_pending', interval: null }),
        () => ({ status: 'ok', token: 'ownit_issued-session-token-abcdefghij', login: 'mona' }),
      ],
    });
    servers.push(s);
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const result = await run(process.execPath, [CLI, 'login', '--server', s.url], home, cleanEnv({ OWNIT_HOME: home }));
    expect(result.code).toBe(0);
    expect(result.output).toContain('WXYZ-9876');
    expect(result.output).toContain('https://github.com/login/device');
    expect(result.output).toContain('Logged in as mona');
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    expect(config).toMatchObject({ server: s.url, token: 'ownit_issued-session-token-abcdefghij', login: 'mona' });
    expect(s.requests.filter((r) => r.path === '/auth/device/poll')).toHaveLength(2);
    expect(s.requests.every((r) => !r.headers.authorization)).toBe(true);
  }, 30_000);

  it('stops when the user cancels on GitHub', async () => {
    const s = await fakeServer({
      'POST /auth/device/start': () => ({ device_code: 'dc', user_code: 'A', verification_uri: 'u', expires_in: 60, interval: 0 }),
      'POST /auth/device/poll': () => ({ status: 'access_denied', interval: null }),
    });
    servers.push(s);
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const result = await run(process.execPath, [CLI, 'login', '--server', s.url], home, cleanEnv({ OWNIT_HOME: home }));
    expect(result.code).toBe(1);
    expect(result.output).toContain('cancelled');
  }, 30_000);
});
