import { parseArgs } from 'node:util';
import { ApiError, createApi } from '../api.js';
import { describeKey, modelKey, readConfig, serverUrl, updateConfig } from '../config.js';
import { readSecret } from '../secret.js';
import { paint } from '../ui.js';

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

type TokenReply = { access_token?: string; error?: string; interval?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POSTs a form to github.com's OAuth endpoints. OWNIT_GITHUB_URL overrides the host in tests. */
async function githubOAuth<T>(path: string, form: Record<string, string>): Promise<T> {
  const base = (process.env.OWNIT_GITHUB_URL || 'https://github.com').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'getownit-cli' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('could not reach github.com');
  }
  if (!response.ok) throw new Error(`github.com returned ${response.status}`);
  return (await response.json()) as T;
}

/**
 * `ownit login`: the GitHub device flow runs here, from the user's own IP
 * (GitHub rate-limits its login endpoints per IP, which shared server IPs
 * hit). The server then verifies the identity, drops the GitHub token, and
 * issues an Ownit session token.
 */
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
  const { github_client_id: clientId } = await api.request<{ github_client_id: string }>('GET', '/auth/config');
  const start = await githubOAuth<DeviceStart>('/login/device/code', { client_id: clientId });
  out.write(`\nOpen ${c.bold(start.verification_uri)} and enter the code ${c.bold(c.cyan(start.user_code))}\n`);
  out.write(c.dim('Waiting for you to authorize Ownit on GitHub…\n'));

  let interval = Math.max(start.interval, 0) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const reply = await githubOAuth<TokenReply>('/login/oauth/access_token', {
      client_id: clientId,
      device_code: start.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (reply.access_token) {
      // The GitHub token goes to the Ownit server once, to prove who you are, and is not kept anywhere.
      const session = await api.request<{ token: string; login: string }>('POST', '/auth/github', { access_token: reply.access_token });
      updateConfig({ token: session.token, login: session.login });
      out.write(`${c.green('✓')} Logged in as ${c.bold(session.login)} on ${serverUrl(readConfig())}.\n`);
      return 0;
    }
    if (reply.error === 'authorization_pending') continue;
    if (reply.error === 'slow_down') {
      interval = Math.max(interval + 5000, (reply.interval ?? 0) * 1000);
      continue;
    }
    out.write(`Ownit: login ${reply.error === 'access_denied' ? 'was cancelled' : `failed (${reply.error ?? 'unknown error'})`}. Run "ownit login" to try again.\n`);
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
  process.stderr.write('Logged out. Your API key is still saved; remove it with "ownit key clear".\n');
  return 0;
}

export async function whoamiCommand(): Promise<number> {
  const config = readConfig();
  const out = process.stderr;
  out.write(`Server:     ${serverUrl(config)}\n`);
  out.write(`GitHub:     ${config.token ? (config.login ?? 'logged in') : 'not logged in (run "ownit login")'}\n`);
  const model = modelKey(config);
  out.write(`API key:    ${model ? `set (${describeKey(model)})` : 'not set (run "ownit key set")'}\n`);
  return 0;
}
