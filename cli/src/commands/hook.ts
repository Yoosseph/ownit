import { openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import type { Readable, Writable } from 'node:stream';
import { ApiError, createApi, type ApiClient, type PushStatus } from '../api.js';
import { readConfig } from '../config.js';
import { RESUME_HINT, runDebrief } from '../debrief.js';
import { buildDiff } from '../diff.js';
import { githubRepo } from '../git.js';
import { computePush, parseRefs, type PushRange } from '../pushRange.js';
import { createPrompter, errorMessage, paint, plural, sentence } from '../ui.js';

const PROMPT_TIMEOUT_MS = 120_000;
const QUICK_TIMEOUT_MS = 8_000;

// Coding agents and CI run git without a person at the keyboard.
const AGENT_ENV = ['CI', 'CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_CI', 'CURSOR_AGENT', 'GEMINI_CLI', 'AIDER_MODEL', 'OPENCODE'];

export function isAgentEnvironment(env: NodeJS.ProcessEnv): boolean {
  return AGENT_ENV.some((name) => env[name] && env[name] !== '0' && env[name] !== 'false');
}

/** The terminal to read answers from, or null when nobody can answer. */
function openTerminal(env: NodeJS.ProcessEnv): Readable | null {
  if (env.OWNIT_NO_TTY || isAgentEnvironment(env)) return null;
  // The installed hook script redirects stdin from /dev/tty and says so.
  if (env.OWNIT_TTY === '1') return process.stdin;
  if (process.platform === 'win32') return null;
  try {
    return new ReadStream(openSync('/dev/tty', 'r'));
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Yes (or Enter) debriefs now; anything else, including the old "s", leaves it for later. */
export function interpretChoice(answer: string | null): 'debrief' | 'later' {
  const value = answer?.trim().toLowerCase();
  return value === '' || value === 'y' || value === 'yes' ? 'debrief' : 'later';
}

async function recordPending(api: ApiClient, repo: string, push: PushRange, out: Writable): Promise<number> {
  await api.request(
    'POST',
    '/api/pushes',
    { repo, base_sha: push.base, head_sha: push.head, commits: push.commits.map((c) => ({ sha: c.sha })), status: 'pending' },
    { timeoutMs: QUICK_TIMEOUT_MS },
  );
  out.write(`Ownit: push recorded as pending. ${RESUME_HINT}\n`);
  return 0;
}

/**
 * What the server already recorded for these commits, so a verified push is not
 * asked again. Only an unreachable server is an error; anything else means unknown.
 */
async function knownStatus(api: ApiClient, repo: string, push: PushRange): Promise<PushStatus | null> {
  const known = await api
    .request<{ status: PushStatus | null }>(
      'POST',
      '/api/pushes/lookup',
      { repo, head_sha: push.head, shas: push.commits.map((x) => x.sha) },
      { timeoutMs: QUICK_TIMEOUT_MS },
    )
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'network') throw error;
      return { status: null };
    });
  return known.status;
}

/** Asks whether to debrief now, then debriefs or leaves the push pending for `ownit interview`. */
async function askAndDebrief(api: ApiClient, terminal: Readable, repo: string, push: PushRange, out: Writable): Promise<number> {
  const c = paint(out);
  const prompter = createPrompter(terminal, out);
  try {
    const n = push.commits.length;
    const answer = await prompter.ask(
      `${c.bold('Ownit')} ${c.dim(`(${n} ${plural(n, 'commit')} to ${repo})`)} Debrief now? [Y/n] `,
      PROMPT_TIMEOUT_MS,
    );
    if (interpretChoice(answer) === 'later') return await recordPending(api, repo, push, out);
    await runDebrief(api, prompter, {
      repo,
      baseSha: push.base,
      headSha: push.head,
      commits: push.commits,
      diff: buildDiff(push.ranges),
    });
    return 0;
  } finally {
    prompter.close();
    if (terminal !== process.stdin) terminal.destroy();
  }
}

function continueReason(error: unknown): string {
  return error instanceof ApiError && error.code === 'network'
    ? `${sentence(error.message)} The push continues and will show as pending.`
    : `${sentence(errorMessage(error))} The push continues.`;
}

/** `ownit hook pre-push <remote> <url>`. Always exits 0: the debrief never blocks a push. */
export async function hookCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [event, remote = '', url = ''] = argv;
  if (event !== 'pre-push') return 0;
  const out = process.stderr;
  const c = paint(out);
  try {
    const refs = env.OWNIT_REFS ?? (await readStdin());
    const repo = githubRepo(process.cwd(), url || remote);
    if (!repo) return 0;
    const push = computePush(parseRefs(refs), remote);
    if (!push) return 0;

    const config = readConfig(env);
    if (!config.token) {
      out.write(`Ownit: not logged in, so no debrief this time. Run "ownit login". The push continues.\n`);
      return 0;
    }
    const api = createApi(config, env);
    const known = await knownStatus(api, repo, push);
    // Skipped pushes are asked again: they stay unverified until debriefed.
    if (known === 'verified') {
      out.write(c.dim(`Ownit: this push is already ${known}.\n`));
      return 0;
    }

    const terminal = openTerminal(env);
    if (!terminal) return await recordPending(api, repo, push, out);
    return await askAndDebrief(api, terminal, repo, push, out);
  } catch (error) {
    out.write(`${c.yellow('Ownit:')} ${continueReason(error)} ${RESUME_HINT}\n`);
    return 0;
  }
}
