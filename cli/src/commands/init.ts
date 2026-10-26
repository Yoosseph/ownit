import type { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { ApiError, createApi } from '../api.js';
import { git, githubRepo } from '../git.js';
import { hookLocation, installHook, MANAGED_SNIPPET, uninstallHook } from '../hooks.js';
import { errorMessage, paint, sentence } from '../ui.js';
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

/** Registers the repo with the Ownit server and shows what to do next. */
async function registerRepo(repo: string, out: Writable): Promise<number> {
  const c = paint(out);
  try {
    const api = createApi();
    const registered = await api.request<RegisterResponse>('POST', '/api/repos', { repo }, { timeoutMs: 15_000 });
    out.write(`${c.green('✓')} Registered ${c.bold(registered.repo)} with Ownit (tracked since ${registered.tracked_since.slice(0, 10)}).\n`);
    if (!registered.installed) {
      out.write(`\nNext: install the Ownit GitHub App on ${registered.repo} so pushes get check runs and count on the badge:\n`);
      out.write(`  ${registered.install_url ?? 'see docs/github-app.md'}\n`);
    }
    if (registered.page_url) out.write(`\nYour repo's page: ${registered.page_url}\n`);
    // The page URL carries the server's public origin, which can differ from the API address.
    const origin = registered.page_url ? new URL(registered.page_url).origin : api.server;
    out.write(`\nAdd the badge to your README (run "ownit badge" to see this again):\n  ${badgeMarkdown(origin, registered.repo)}\n`);
  } catch (error) {
    out.write(`${c.yellow('Ownit:')} the hook is installed, but registering ${repo} failed: ${sentence(errorMessage(error))}\n`);
    if (error instanceof ApiError && error.code === 'app_not_installed') {
      out.write('Git pushes still work, but Ownit cannot record debriefs until the GitHub App is enabled for this repo.\n');
      out.write('Ask the repository owner to install the Ownit GitHub App and select this repository (or select your fork if that is where you push).\n');
      const url = error.body.install_url;
      if (typeof url === 'string' && url) out.write(`  ${url}\n`);
      out.write('Then run "ownit init" again in this repo.\n');
      return 1;
    }
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
