import { parseArgs } from 'node:util';
import { git, githubRepo } from '../git.js';
import { hookLocation, installHook, MANAGED_SNIPPET, uninstallHook } from '../hooks.js';
import { paint } from '../ui.js';

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
  out.write(`\nOwnit will debrief pushes to ${c.bold(repo)}.\n`);
  return 0;
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
