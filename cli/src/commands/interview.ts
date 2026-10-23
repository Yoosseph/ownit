import { parseArgs } from 'node:util';
import { createApi, type ApiClient, type PushStatus } from '../api.js';
import { buildDiff } from '../diff.js';
import { LATER, runDebrief, type DebriefOutcome } from '../debrief.js';
import { githubRepo, listCommits, objectExists, resolveCommit, type Commit } from '../git.js';
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
    options: { range: { type: 'string' }, repo: { type: 'string' }, all: { type: 'boolean' } },
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
    return await debriefOpenPushes(api, prompter, repo, Boolean(values.all));
  } finally {
    prompter.close();
  }
}

function exitCode(outcome: DebriefOutcome | null): number {
  return outcome && (outcome.status === 'verified' || outcome.reason === LATER) ? 0 : 1;
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

/** An open push as the picker lists it. `commits` is empty when they are not in this clone. */
interface Choice {
  push: OpenPush;
  commits: Commit[];
}

function toChoice(push: OpenPush): Choice {
  if (![push.head_sha, ...push.commits].every((sha) => objectExists(sha))) return { push, commits: [] };
  const range = rangeForRecordedPush(push.base_sha, push.head_sha, push.commits);
  const known = new Set(push.commits);
  const commits = listCommits([range.base ? `${range.base}..${range.head}` : range.head]).filter((x) => known.has(x.sha));
  return { push, commits: commits.length ? commits : listCommits(['-1', range.head]) };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** One line per push: number, status, head commit, date and what the commits say. */
function printChoices(out: Prompter['out'], choices: Choice[]) {
  const c = paint(out);
  const width = Math.min(process.stderr.columns || 80, 100);
  choices.forEach(({ push, commits }, i) => {
    const status = push.status === 'provider_error' ? 'error' : push.status;
    const head = `${String(i + 1).padStart(3)}  ${status.padEnd(7)}  ${push.head_sha.slice(0, 7)}  ${shortDate(push.created_at).padEnd(6)}  `;
    let title: string;
    if (!commits.length) title = c.yellow('not in this clone, run "git fetch"');
    else {
      const subject = commits.at(-1)!.message.split('\n')[0]!;
      const more = commits.length > 1 ? ` (+${commits.length - 1} more)` : '';
      const room = Math.max(20, width - head.length - more.length);
      title = (subject.length > room ? `${subject.slice(0, room - 1)}…` : subject) + c.dim(more);
    }
    out.write(`${c.dim(head)}${title}\n`);
  });
}

/** What the developer picked: a list index, every push, quit (also on end of input), or null when unclear. */
export function parsePick(answer: string | null, count: number): number | 'all' | 'quit' | null {
  const text = answer?.trim().toLowerCase() ?? 'q';
  if (text === '') return 0;
  if (text === 'q' || text === 'quit') return 'quit';
  if (text === 'a' || text === 'all') return 'all';
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}

async function debriefChoice(api: ApiClient, prompter: Prompter, repo: string, { push, commits }: Choice): Promise<DebriefOutcome> {
  const range = rangeForRecordedPush(push.base_sha, push.head_sha, push.commits);
  return runDebrief(api, prompter, { repo, baseSha: range.base, headSha: range.head, commits, diff: buildDiff([range]), pushId: push.id });
}

/** The debrief was cut off or failed, so stop. "s" (later) is not a stop: it moves on to the next push. */
const stopped = (outcome: DebriefOutcome) => outcome.reason !== LATER && (outcome.status === 'pending' || outcome.status === 'provider_error');

/**
 * Lists the pushes still waiting for a debrief, newest first, and debriefs the
 * ones the developer picks, one at a time. `all` keeps going without asking.
 */
async function debriefOpenPushes(api: ApiClient, prompter: Prompter, repo: string, all: boolean): Promise<number> {
  const out = prompter.out;
  const c = paint(out);
  const { pushes } = await api.request<{ pushes: OpenPush[] }>('GET', `/api/pushes/open?repo=${encodeURIComponent(repo)}`);
  if (!pushes.length) {
    out.write(`${c.green('✓')} Nothing to debrief for ${repo}.\n`);
    return 0;
  }
  let choices = pushes.map(toChoice);
  if (all) return debriefInOrder(api, prompter, repo, choices);

  while (choices.length) {
    out.write(`\n${choices.length} ${plural(choices.length, 'push', 'pushes')} waiting for a debrief in ${repo}:\n\n`);
    printChoices(out, choices);
    const pick = parsePick(await prompter.ask(`\nDebrief which one? ${c.dim('[number, Enter for 1, a = all, q = quit]')} `), choices.length);
    if (pick === 'quit') {
      out.write(c.dim('Run "ownit interview" any time to come back.\n'));
      return 0;
    }
    if (pick === null) {
      out.write(c.yellow(`Pick a number from 1 to ${choices.length}, a or q.\n`));
      continue;
    }
    if (pick === 'all') return debriefInOrder(api, prompter, repo, choices);
    const choice = choices[pick]!;
    if (!choice.commits.length) {
      out.write(c.yellow(`Commit ${choice.push.head_sha.slice(0, 7)} is not in this clone. Run "git fetch" and try again.\n`));
      continue;
    }
    const outcome = await debriefChoice(api, prompter, repo, choice);
    if (stopped(outcome)) return 1;
    if (outcome.reason !== LATER) choices = choices.filter((x) => x !== choice);
  }
  out.write(`\n${c.green('✓')} Nothing left to debrief for ${repo}.\n`);
  return 0;
}

/** Debriefs every push in the list, newest first, until one is paused or fails. */
async function debriefInOrder(api: ApiClient, prompter: Prompter, repo: string, choices: Choice[]): Promise<number> {
  for (const choice of choices.filter((x) => x.commits.length)) {
    if (stopped(await debriefChoice(api, prompter, repo, choice))) return 1;
  }
  const missing = choices.filter((x) => !x.commits.length).length;
  if (missing) {
    prompter.out.write(paint(prompter.out).yellow(`Ownit: ${missing} ${plural(missing, 'push', 'pushes')} not in this clone. Run "git fetch" and try again.\n`));
  }
  return missing ? 1 : 0;
}
