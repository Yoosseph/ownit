import { parseArgs } from 'node:util';
import { ApiError, createApi } from '../api.js';
import { readConfig, serverUrl, updateConfig } from '../config.js';
import { readSecret } from '../secret.js';
import { paint } from '../ui.js';

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

type PollResult = { status: 'ok'; token: string; login: string } | { status: string; interval: number | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `ownit login`: GitHub device flow through the Ownit server, which issues an Ownit session token. */
export async function loginCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { server: { type: 'string' }, 'with-token': { type: 'boolean' } } });
  const out = process.stderr;
  const c = paint(out);
  if (values.server) updateConfig({ server: values.server.replace(/\/+$/, '') });

  if (values['with-token']) {
    // For self-hosted or local servers: read a session token from stdin.
    const token = (await readSecret('Ownit session token: ')).trim();
    if (!/^ownit_[\w-]{20,}$/.test(token)) {
      out.write('Ownit: that does not look like an Ownit session token.\n');
      return 1;
    }
    updateConfig({ token, login: undefined });
    out.write(`${c.green('✓')} Saved the session token.\n`);
    return 0;
  }

  const api = createApi({ ...readConfig(), token: undefined });
  const start = await api.request<DeviceStart>('POST', '/auth/device/start');
  out.write(`\nOpen ${c.bold(start.verification_uri)} and enter the code ${c.bold(c.cyan(start.user_code))}\n`);
  out.write(c.dim('Waiting for you to authorize Ownit on GitHub…\n'));

  let interval = Math.max(start.interval, 0) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const result = await api.request<PollResult>('POST', '/auth/device/poll', { device_code: start.device_code });
    if (result.status === 'ok' && 'token' in result) {
      updateConfig({ token: result.token, login: result.login });
      out.write(`${c.green('✓')} Logged in as ${c.bold(result.login)} on ${serverUrl(readConfig())}.\n`);
      return 0;
    }
    if (result.status === 'authorization_pending') continue;
    if (result.status === 'slow_down') {
      interval = Math.max(interval + 5000, ('interval' in result && result.interval ? result.interval : 0) * 1000);
      continue;
    }
    out.write(`Ownit: login ${result.status === 'access_denied' ? 'was cancelled' : `failed (${result.status})`}. Run "ownit login" to try again.\n`);
    return 1;
  }
  out.write('Ownit: the login code expired. Run "ownit login" to try again.\n');
  return 1;
}

export async function logoutCommand(): Promise<number> {
  const config = readConfig();
  if (config.token) {
    await createApi(config)
      .request('DELETE', '/auth/session', undefined, { timeoutMs: 10_000 })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) throw error;
      });
  }
  updateConfig({ token: undefined, login: undefined });
  process.stderr.write('Logged out. Your Nebius key is still saved; remove it with "ownit key clear".\n');
  return 0;
}

export async function whoamiCommand(): Promise<number> {
  const config = readConfig();
  const out = process.stderr;
  out.write(`Server:     ${serverUrl(config)}\n`);
  out.write(`GitHub:     ${config.token ? (config.login ?? 'logged in') : 'not logged in (run "ownit login")'}\n`);
  const key = process.env.NEBIUS_API_KEY || config.nebiusKey;
  out.write(`Nebius key: ${key ? `set (…${key.slice(-4)})` : 'not set (run "ownit key set")'}\n`);
  return 0;
}
