import { parseArgs } from 'node:util';
import { createApi, type ApiClient, type PushStatus } from '../api.js';
import { buildDiff } from '../diff.js';
import { runDebrief, type DebriefOutcome } from '../debrief.js';
import { githubRepo, listCommits, objectExists, resolveCommit } from '../git.js';
import { rangeForRecordedPush } from '../pushRange.js';
import { createPrompter, paint, plural, type Prompter } from '../ui.js';

interface OpenPush {
  id: number;
  status: PushStatus;
  base_sha: string | null;
  head_sha: string;
  created_at: string;
  commits: string[];
}

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
  const api = createApi();
  const prompter = createPrompter(process.stdin, out);
  try {
    if (values.range) return exitCode(await debriefRange(api, prompter, repo, values.range));
    return await debriefOpenPushes(api, prompter, repo);
  } finally {
    prompter.close();
  }
}

function exitCode(outcome: DebriefOutcome | null): number {
  return outcome && (outcome.status === 'verified' || outcome.status === 'skipped') ? 0 : 1;
}

async function debriefRange(api: ApiClient, prompter: Prompter, repo: string, range: string): Promise<DebriefOutcome | null> {
  const match = range.match(/^(.+?)\.\.(.+)$/);
  if (!match) {
    prompter.out.write('Ownit: --range must look like A..B.\n');
    return null;
  }
  const base = resolveCommit(match[1]!);
  const head = resolveCommit(match[2]!);
  const commits = listCommits([`${base}..${head}`]);
  if (!commits.length) {
    prompter.out.write(`Ownit: no commits in ${range}.\n`);
    return null;
  }
  return runDebrief(api, prompter, { repo, baseSha: base, headSha: head, commits, diff: buildDiff([{ base, head }]) });
}

/** Resolves pending and provider_error pushes, newest first. */
async function debriefOpenPushes(api: ApiClient, prompter: Prompter, repo: string): Promise<number> {
  const out = prompter.out;
  const c = paint(out);
  const { pushes } = await api.request<{ pushes: OpenPush[] }>('GET', `/api/pushes/open?repo=${encodeURIComponent(repo)}`);
  if (!pushes.length) {
    out.write(`${c.green('✓')} Nothing to debrief for ${repo}.\n`);
    return 0;
  }
  out.write(`${pushes.length} ${plural(pushes.length, 'push', 'pushes')} waiting for a debrief in ${repo}.\n`);
  let code = 0;
  for (const push of pushes) {
    const missing = [push.head_sha, ...push.commits].find((sha) => !objectExists(sha));
    if (missing) {
      out.write(c.yellow(`Ownit: commit ${missing.slice(0, 7)} is not in this clone. Run "git fetch" and try again.\n`));
      code = 1;
      continue;
    }
    const range = rangeForRecordedPush(push.base_sha, push.head_sha, push.commits);
    const known = new Set(push.commits);
    const commits = listCommits([range.base ? `${range.base}..${range.head}` : range.head]).filter((x) => known.has(x.sha));
    const outcome = await runDebrief(api, prompter, {
      repo,
      baseSha: range.base,
      headSha: range.head,
      commits: commits.length ? commits : listCommits(['-1', range.head]),
      diff: buildDiff([range]),
      pushId: push.id,
    });
    if (outcome.status === 'pending' || outcome.status === 'provider_error') return 1;
  }
  return code;
}
