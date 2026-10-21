import { readConfig, serverUrl } from '../config.js';
import { githubRepo } from '../git.js';

/** The README Markdown for a repo's badge: the badge image, linking to the repo's page. */
export function badgeMarkdown(origin: string, repo: string): string {
  const [owner = '', name = ''] = repo.split('/');
  const path = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  return `[![Ownit](${origin}/badge/${path}.svg)](${origin}/${path})`;
}

/** `ownit badge`: prints the Markdown on stdout, so it can be piped (`ownit badge | clip`). */
export function badgeCommand(): number {
  const repo = githubRepo();
  if (!repo) {
    process.stderr.write('Ownit: no GitHub remote found. Run this in a repo set up with "ownit init".\n');
    return 1;
  }
  process.stderr.write(`Add this to your README to show ${repo}'s Ownit badge:\n\n`);
  process.stdout.write(`${badgeMarkdown(serverUrl(readConfig()), repo)}\n`);
  return 0;
}
