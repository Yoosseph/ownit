import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { ApiError, createApi, type ApiClient } from '../api.js';
import { git, githubRepo } from '../git.js';
import { hookLocation, installHook, MANAGED_SNIPPET, uninstallHook } from '../hooks.js';
import { createPrompter, errorMessage, paint, sentence } from '../ui.js';
import { badgeMarkdown } from './badge.js';

interface RegisterResponse {
  repo: string;
  tracked_since: string;
  installed: boolean;
  install_url: string | null;
  page_url: string | null;
}

/** Installs the pre-push hook where git looks for it, or explains how to add it to a hook manager. */
function installHookHere(out: Writable) {
  const c = paint(out);
  const location = hookLocation();
  if (location.kind === 'manual') {
    out.write(`Ownit: ${location.reason}, so add these lines to the end of .husky/pre-push (create the file if needed):\n\n`);
    out.write(`${MANAGED_SNIPPET}\n\n`);
    return;
  }
  const result = installHook(location.dir);
  out.write(`${c.green('✓')} ${result.updated ? 'Updated' : 'Installed'} the pre-push hook in ${location.dir}`);
  out.write(location.via === 'core.hooksPath' ? ' (from core.hooksPath).\n' : '.\n');
  if (result.chained) out.write(`  Your existing hook is now pre-push.local and still runs first.\n`);
}

/** Opens a URL in the default browser. Best effort: the link is printed either way. */
function openBrowser(url: string) {
  if (process.env.OWNIT_NO_BROWSER === '1') return;
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser to open; the printed link is enough.
  }
}

/**
 * Walks the user through installing the GitHub App, then checks again. Only at
 * a terminal: elsewhere the link is printed and init exits so it can be rerun.
 * Resolves to the registration once the App covers the repo, or null if the user quit.
 */
async function waitForApp(api: ApiClient, repo: string, url: string, out: Writable): Promise<RegisterResponse | null> {
  const c = paint(out);
  out.write(`\n${c.bold('One more step:')} install the Ownit GitHub App on ${c.bold(repo)}. It lets Ownit see your pushes and post checks.\n`);
  out.write(`Opening ${url}\n`);
  out.write('On that page, pick the account that owns the repo, choose "Only select repositories", select it, and click Install.\n');
  out.write(c.dim('Not the owner? Send them the link and ask them to install it for this repo (or select your fork if that is where you push).\n'));
  openBrowser(url);
  const prompter = createPrompter(process.stdin, out);
  try {
    for (;;) {
      const answer = await prompter.ask(`\nPress Enter once the App is installed (q to finish later): `);
      if (answer === null || answer.trim().toLowerCase() === 'q') return null;
      const check = await register(api, repo);
      if ('registered' in check && check.registered.installed) return check.registered;
      out.write(`${c.yellow('Not yet:')} the App does not cover ${repo} yet. It can take a few seconds after you click Install.\n`);
    }
  } finally {
    prompter.close();
  }
}

/** One registration attempt. An App that is not installed is an answer, not an error. */
async function register(api: ApiClient, repo: string): Promise<{ registered: RegisterResponse } | { installUrl: string | null }> {
  try {
    return { registered: await api.request<RegisterResponse>('POST', '/api/repos', { repo }, { timeoutMs: 15_000 }) };
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'app_not_installed')) throw error;
    const url = error.body.install_url;
    return { installUrl: typeof url === 'string' && url ? url : null };
  }
}

const interactive = () => Boolean(process.stdin.isTTY) || process.env.OWNIT_TTY === '1';

/** Registers the repo with the Ownit server, getting the GitHub App installed on the way, and shows what to do next. */
async function registerRepo(repo: string, out: Writable): Promise<number> {
  const c = paint(out);
  try {
    const api = createApi();
    const first = await register(api, repo);
    let registered = 'registered' in first && first.registered.installed ? first.registered : null;
    if (!registered) {
      const url = 'registered' in first ? first.registered.install_url : first.installUrl;
      if (url && interactive()) registered = await waitForApp(api, repo, url, out);
      if (!registered) {
        out.write(`${c.yellow('Ownit:')} the hook is installed, but the Ownit GitHub App is not installed on ${repo} yet.\n`);
        out.write('Git pushes still work, but Ownit cannot record debriefs until the GitHub App is enabled for this repo.\n');
        out.write('Ask the repository owner to install the Ownit GitHub App and select this repository (or select your fork if that is where you push).\n');
        out.write(`  ${url ?? 'see docs/github-app.md'}\n`);
        out.write('Then run "ownit init" again in this repo.\n');
        return 1;
      }
      out.write(`${c.green('✓')} The Ownit GitHub App is installed on ${repo}.\n`);
    }
    out.write(`${c.green('✓')} Registered ${c.bold(registered.repo)} with Ownit (tracked since ${registered.tracked_since.slice(0, 10)}).\n`);
    if (registered.page_url) out.write(`\nYour repo's page: ${registered.page_url}\n`);
    // The page URL carries the server's public origin, which can differ from the API address.
    const origin = registered.page_url ? new URL(registered.page_url).origin : api.server;
    out.write(`\nAdd the badge to your README (run "ownit badge" to see this again):\n  ${badgeMarkdown(origin, registered.repo)}\n`);
  } catch (error) {
    out.write(`${c.yellow('Ownit:')} the hook is installed, but registering ${repo} failed: ${sentence(errorMessage(error))}\n`);
    out.write('Run "ownit init" again once that is fixed.\n');
    return 1;
  }
  return 0;
}

/** `ownit init [--repo owner/name]` */
export async function initCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { repo: { type: 'string' } } });
  const out = process.stderr;
  if (values.repo) git(['config', 'ownit.repo', values.repo]);
  const repo = githubRepo();
  if (!repo) {
    out.write('Ownit: no GitHub remote found. Add one, or run "ownit init --repo owner/name".\n');
    return 1;
  }
  installHookHere(out);
  return registerRepo(repo, out);
}

export async function uninstallCommand(): Promise<number> {
  const out = process.stderr;
  const location = hookLocation();
  if (location.kind === 'manual') {
    out.write(`Ownit: remove the Ownit lines from your pre-push hook in ${location.dir}.\n`);
    return 0;
  }
  const result = uninstallHook(location.dir);
  if (!result.removed) out.write('Ownit: no Ownit hook installed here.\n');
  else out.write(`Removed the Ownit pre-push hook.${result.restored ? ' Restored your previous hook.' : ''}\n`);
  return 0;
}
