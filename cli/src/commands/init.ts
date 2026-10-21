import { parseArgs } from 'node:util';
import { createApi } from '../api.js';
import { git, githubRepo } from '../git.js';
import { hookLocation, installHook, MANAGED_SNIPPET, uninstallHook } from '../hooks.js';
import { paint, sentence } from '../ui.js';

export async function initCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { repo: { type: 'string' } } });
  const out = process.stderr;
  const c = paint(out);
  if (values.repo) git(['config', 'ownit.repo', values.repo]);
  const repo = githubRepo();
  if (!repo) {
    out.write('Ownit: no GitHub remote found. Add one, or run "ownit init --repo owner/name".\n');
    return 1;
  }

  const location = hookLocation();
  if (location.kind === 'manual') {
    out.write(`Ownit: ${location.reason}, so add these lines to the end of .husky/pre-push (create the file if needed):\n\n`);
    out.write(`${MANAGED_SNIPPET}\n\n`);
  } else {
    const result = installHook(location.dir);
    out.write(`${c.green('✓')} ${result.updated ? 'Updated' : 'Installed'} the pre-push hook in ${location.dir}`);
    out.write(location.via === 'core.hooksPath' ? ' (from core.hooksPath).\n' : '.\n');
    if (result.chained) out.write(`  Your existing hook is now pre-push.local and still runs first.\n`);
  }

  try {
    const registered = await createApi().request<RegisterResponse>('POST', '/api/repos', { repo }, { timeoutMs: 15_000 });
    out.write(`${c.green('✓')} Registered ${c.bold(registered.repo)} with Ownit (tracked since ${registered.tracked_since.slice(0, 10)}).\n`);
    if (!registered.installed) {
      out.write(`\nNext: install the Ownit GitHub App on ${registered.repo} so pushes get check runs and count on the badge:\n`);
      out.write(`  ${registered.install_url ?? 'see docs/github-app.md'}\n`);
    }
    if (registered.page_url) out.write(`\nYour repo's page: ${registered.page_url}\n`);
  } catch (error) {
    out.write(`${c.yellow('Ownit:')} the hook is installed, but registering ${repo} failed: ${sentence(error instanceof Error ? error.message : String(error))}\n`);
    out.write('Run "ownit init" again once that is fixed.\n');
    return 1;
  }
  return 0;
}

interface RegisterResponse {
  repo: string;
  tracked_since: string;
  installed: boolean;
  install_url: string | null;
  page_url: string | null;
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
