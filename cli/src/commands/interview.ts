import { parseArgs } from 'node:util';
import { createApi } from '../api.js';
import { buildDiff } from '../diff.js';
import { runDebrief } from '../debrief.js';
import { githubRepo, listCommits, resolveCommit } from '../git.js';
import { createPrompter } from '../ui.js';

export async function interviewCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { range: { type: 'string' }, repo: { type: 'string' } },
    allowPositionals: false,
  });
  const out = process.stderr;
  const repo = values.repo ?? githubRepo();
  if (!repo) {
    out.write('Ownit: cannot tell which GitHub repo this is. Run "ownit init" or pass --repo owner/name.\n');
    return 1;
  }
  if (!values.range) {
    out.write('Ownit: pass --range A..B to debrief a commit range.\n');
    return 1;
  }
  const match = values.range.match(/^(.+?)\.\.(.+)$/);
  if (!match) {
    out.write('Ownit: --range must look like A..B.\n');
    return 1;
  }
  const base = resolveCommit(match[1]!);
  const head = resolveCommit(match[2]!);
  const commits = listCommits([`${base}..${head}`]);
  if (!commits.length) {
    out.write(`Ownit: no commits in ${values.range}.\n`);
    return 1;
  }

  const prompter = createPrompter(process.stdin, out);
  try {
    const outcome = await runDebrief(createApi(), prompter, { repo, baseSha: base, headSha: head, commits, diff: buildDiff(base, head) });
    return outcome.status === 'verified' || outcome.status === 'skipped' ? 0 : 1;
  } finally {
    prompter.close();
  }
}
