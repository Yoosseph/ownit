import { parseArgs } from 'node:util';
import { ApiError, createApi } from '../api.js';
import { readConfig, serverUrl, updateConfig } from '../config.js';
import { describeKey, modelKey } from '../providers.js';
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
 * Polls GitHub until the user authorizes the device code. Returns the GitHub
 * token, or the reason the login ended without one.
 */
async function pollForAccessToken(clientId: string, start: DeviceStart): Promise<{ token: string } | { failure: string }> {
  let interval = Math.max(start.interval, 0) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const reply = await githubOAuth<TokenReply>('/login/oauth/access_token', {
      client_id: clientId,
      device_code: start.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (reply.access_token) return { token: reply.access_token };
    if (reply.error === 'authorization_pending') continue;
    if (reply.error === 'slow_down') {
      interval = Math.max(interval + 5000, (reply.interval ?? 0) * 1000);
      continue;
    }
    return { failure: `login ${reply.error === 'access_denied' ? 'was cancelled' : `failed (${reply.error ?? 'unknown error'})`}.` };
  }
  return { failure: 'the login code expired.' };
}

/** For self-hosted or local servers: reads a session token from stdin. */
async function loginWithToken(): Promise<number> {
  const out = process.stderr;
  const token = (await readSecret('Ownit session token: ')).trim();
  if (!/^ownit_[\w-]{20,}$/.test(token)) {
    out.write('Ownit: that does not look like an Ownit session token.\n');
    return 1;
  }
  updateConfig({ token, login: undefined });
  out.write(`${paint(out).green('✓')} Saved the session token.\n`);
  return 0;
}

/**
 * The GitHub device flow runs here, from the user's own IP (GitHub rate-limits
 * its login endpoints per IP, which shared server IPs hit). The server then
 * verifies the identity, drops the GitHub token, and issues an Ownit session token.
 */
async function deviceFlowLogin(): Promise<number> {
  const out = process.stderr;
  const c = paint(out);
  const api = createApi({ ...readConfig(), token: undefined });
  const { github_client_id: clientId } = await api.request<{ github_client_id: string }>('GET', '/auth/config');
  const start = await githubOAuth<DeviceStart>('/login/device/code', { client_id: clientId });
  out.write(`\nOpen ${c.bold(start.verification_uri)} and enter the code ${c.bold(c.cyan(start.user_code))}\n`);
  out.write(c.dim('Waiting for you to authorize Ownit on GitHub…\n'));

  const result = await pollForAccessToken(clientId, start);
  if ('failure' in result) {
    out.write(`Ownit: ${result.failure} Run "ownit login" to try again.\n`);
    return 1;
  }
  // The GitHub token goes to the Ownit server once, to prove who you are, and is not kept anywhere.
  const session = await api.request<{ token: string; login: string }>('POST', '/auth/github', { access_token: result.token });
  updateConfig({ token: session.token, login: session.login });
  out.write(`${c.green('✓')} Logged in as ${c.bold(session.login)} on ${serverUrl(readConfig())}.\n`);
  return 0;
}

/** `ownit login [--server URL] [--with-token]` */
export async function loginCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { server: { type: 'string' }, 'with-token': { type: 'boolean' } } });
  if (values.server) updateConfig({ server: values.server.replace(/\/+$/, '') });
  return values['with-token'] ? loginWithToken() : deviceFlowLogin();
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
