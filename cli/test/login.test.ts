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
  // One fake plays both the Ownit server and github.com (via OWNIT_GITHUB_URL).
  const device = () => ({ device_code: 'dc', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 0 });

  it('runs the device flow with GitHub, then exchanges the token for an Ownit session', async () => {
    const s = await fakeServer({
      'GET /auth/config': () => ({ github_client_id: 'Iv23test' }),
      'POST /login/device/code': device,
      'POST /login/oauth/access_token': [() => ({ error: 'authorization_pending' }), () => ({ access_token: 'gho_from_github', token_type: 'bearer' })],
      'POST /auth/github': () => ({ token: 'ownit_issued-session-token-abcdefghij', login: 'mona' }),
    });
    servers.push(s);
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const result = await run(process.execPath, [CLI, 'login', '--server', s.url], home, cleanEnv({ OWNIT_HOME: home, OWNIT_GITHUB_URL: s.url }));
    expect(result.code).toBe(0);
    expect(result.output).toContain('WXYZ-9876');
    expect(result.output).toContain('https://github.com/login/device');
    expect(result.output).toContain('Logged in as mona');

    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    expect(config).toMatchObject({ server: s.url, token: 'ownit_issued-session-token-abcdefghij', login: 'mona' });
    expect(JSON.stringify(config)).not.toContain('gho_from_github');

    expect(s.requests.find((r) => r.path === '/login/device/code')!.body).toEqual({ client_id: 'Iv23test' });
    const polls = s.requests.filter((r) => r.path === '/login/oauth/access_token');
    expect(polls).toHaveLength(2);
    expect(polls[0]!.body).toMatchObject({ client_id: 'Iv23test', device_code: 'dc', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    expect(s.requests.find((r) => r.path === '/auth/github')!.body).toEqual({ access_token: 'gho_from_github' });
  }, 30_000);

  it('stops when the user cancels on GitHub', async () => {
    const s = await fakeServer({
      'GET /auth/config': () => ({ github_client_id: 'Iv23test' }),
      'POST /login/device/code': device,
      'POST /login/oauth/access_token': () => ({ error: 'access_denied' }),
    });
    servers.push(s);
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const result = await run(process.execPath, [CLI, 'login', '--server', s.url], home, cleanEnv({ OWNIT_HOME: home, OWNIT_GITHUB_URL: s.url }));
    expect(result.code).toBe(1);
    expect(result.output).toContain('cancelled');
    expect(s.requests.some((r) => r.path === '/auth/github')).toBe(false);
  }, 30_000);
});
