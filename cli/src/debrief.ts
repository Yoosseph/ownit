import type { Writable } from 'node:stream';
import { ApiError, type AnswerResponse, type ApiClient, type PublicQuestion, type PushStatus, type StartResponse } from './api.js';
import type { PreparedDiff } from './diff.js';
import type { Commit } from './git.js';
import { errorMessage, paint, plural, sentence, spinner, wrap, type Prompter } from './ui.js';

export interface DebriefTarget {
  repo: string;
  baseSha: string | null;
  headSha: string;
  commits: Commit[];
  diff: PreparedDiff;
  pushId?: number;
}

export interface DebriefOutcome {
  status: PushStatus;
  /** One-line reason for pending or provider_error outcomes. */
  reason?: string;
}

const MAX_ANSWER_CHARS = 2000;
export const RESUME_HINT = 'Run "ownit interview" when you\'re ready.';

const KIND_LABEL = { why: 'why', how: 'how', next: "what's next" } as const;

/** What every request in one debrief shares. The sealed session token changes with each answer. */
interface Debrief {
  api: ApiClient;
  prompter: Prompter;
  total: number;
  /** Sent with every request, so the server never has to store the code. */
  payload: { commits: Commit[]; diff: string; diff_truncated: boolean };
  session: string;
  /** Older commits the final passing answer credited (repos that count earlier work). */
  earlierCredited: number;
}

/** "s" (or the older "skip") stops the debrief for now. */
function isLater(answer: string) {
  return /^(s|skip|:skip)$/i.test(answer.trim());
}

/** The reason on a debrief the developer stopped with "s", as opposed to one that was cut off. */
export const LATER = 'later';

/** Shows a spinner while `work` runs. */
async function withSpinner<T>(out: Writable, text: string, work: () => Promise<T>): Promise<T> {
  const spin = spinner(out, text);
  try {
    return await work();
  } finally {
    spin.stop();
  }
}

/** A provider error worth retrying: the model did not answer in time or failed on its side. */
const isUnavailable = (error: unknown) => error instanceof ApiError && error.isProviderError && error.body.reason === 'unavailable';

/**
 * Runs a model request. When the model doesn't answer, it tries once more by
 * itself, then asks before each further try, so a slow moment never throws
 * away a debrief in progress.
 */
async function withRetry<T>(prompter: Prompter, request: () => Promise<T>): Promise<T> {
  const c = paint(prompter.out);
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!isUnavailable(error)) throw error;
      if (attempt === 1) {
        prompter.out.write(c.dim('The model did not answer in time. Trying again…\n'));
        continue;
      }
      const again = await prompter.ask(`${c.yellow((error as ApiError).message)} Try again? [Y/n] `);
      if (again === null || /^n/i.test(again.trim())) throw error;
    }
  }
}

function printQuestion(out: Writable, question: PublicQuestion, total: number, followUp: boolean) {
  const c = paint(out);
  const label = `Question ${question.idx + 1}/${total}`;
  out.write(`\n${c.bold(c.cyan(label))} ${c.dim(`(${KIND_LABEL[question.kind]}${followUp ? ', follow-up' : ''})`)}\n`);
  out.write(`${wrap(question.text)}\n`);
}

/** The next non-blank answer, or null when the input ends. */
async function readAnswer(prompter: Prompter): Promise<string | null> {
  const c = paint(prompter.out);
  let answer: string | null;
  do answer = await prompter.ask(c.bold('> '));
  while (answer !== null && !answer.trim());
  return answer;
}

/**
 * Asks a question, and follow-ups after a miss, until an answer passes (null)
 * or the debrief ends early (its outcome).
 */
async function askUntilPassed(debrief: Debrief, first: PublicQuestion): Promise<DebriefOutcome | null> {
  const { api, prompter } = debrief;
  const out = prompter.out;
  const c = paint(out);
  let question = first;
  let followUp = false;
  for (;;) {
    printQuestion(out, question, debrief.total, followUp);
    const answer = await readAnswer(prompter);
    if (answer === null) {
      out.write(`\n${c.yellow('Debrief paused.')} ${RESUME_HINT}\n`);
      return { status: 'pending', reason: 'debrief paused' };
    }
    if (isLater(answer)) return later(out);

    let result: AnswerResponse;
    try {
      result = await withRetry(prompter, () =>
        withSpinner(out, 'Checking your answer…', () =>
          api.request<AnswerResponse>('POST', '/api/interview/answer', {
            session: debrief.session,
            idx: question.idx,
            answer: answer.slice(0, MAX_ANSWER_CHARS),
            ...debrief.payload,
          }),
        ),
      );
    } catch (error) {
      return failure(out, error);
    }
    debrief.session = result.session;
    debrief.earlierCredited = result.earlier_credited ?? 0;
    if (result.pass) {
      out.write(`${c.green('✓ Passed.')}\n${c.dim(wrap(result.feedback))}\n`);
      return null;
    }
    out.write(`${c.yellow('Not quite yet.')}\n${wrap(result.feedback)}\n`);
    if (!result.followup) return { status: 'pending', reason: 'no follow-up question' };
    out.write(c.dim("Here's another angle on the same topic:\n"));
    question = result.followup;
    followUp = true;
  }
}

/** Runs one debrief: asks each question, grades answers, and offers follow-ups until every question passes. */
export async function runDebrief(api: ApiClient, prompter: Prompter, target: DebriefTarget): Promise<DebriefOutcome> {
  const out = prompter.out;
  const c = paint(out);
  const commitWord = plural(target.commits.length, 'commit');
  out.write(`\n${c.bold('Ownit debrief')} ${c.dim(`· ${target.repo} · ${target.commits.length} ${commitWord} · ${target.diff.changedLines} changed ${plural(target.diff.changedLines, 'line')}`)}\n`);

  const payload = {
    commits: target.commits,
    diff: target.diff.diff,
    diff_truncated: target.diff.truncated,
  };

  let start: StartResponse;
  try {
    start = await withRetry(prompter, () =>
      withSpinner(out, 'Nemotron is reading your push…', () =>
        api.request<StartResponse>('POST', '/api/interview/start', {
          repo: target.repo,
          base_sha: target.baseSha,
          head_sha: target.headSha,
          changed_lines: target.diff.changedLines,
          push_id: target.pushId,
          ...payload,
        }),
      ),
    );
  } catch (error) {
    return failure(out, error);
  }

  out.write(c.dim(`Answer in your own words, up to 5 sentences. Rough is fine. Type "s" to stop and finish later.\n`));
  if (start.answers_public) out.write(c.yellow('Note: this repo shows passing answers on its public Ownit page.\n'));
  const debrief: Debrief = { api, prompter, total: start.total, payload, session: start.session, earlierCredited: 0 };
  for (const question of start.questions) {
    const ended = await askUntilPassed(debrief, question);
    if (ended) return ended;
  }
  out.write(`\n${c.green(c.bold('✓ Push verified.'))} ${c.dim(`${target.commits.length} ${commitWord} owned. Nice work.`)}\n`);
  const earlier = debrief.earlierCredited;
  if (earlier) out.write(c.dim(`${earlier} earlier ${plural(earlier, 'commit')} now ${earlier === 1 ? 'counts' : 'count'} as verified.\n`));
  return { status: 'verified' };
}

/** "s" stops for now. Nothing is recorded: the push stays pending, so it waits in `ownit interview`. */
function later(out: Writable): DebriefOutcome {
  out.write(`${paint(out).dim(`Stopped. This push stays unverified until you debrief it. ${RESUME_HINT}`)}\n`);
  return { status: 'pending', reason: LATER };
}

/** Prints a one-line reason. Provider problems stay out of the stats until retried. */
function failure(out: Writable, error: unknown): DebriefOutcome {
  const c = paint(out);
  if (error instanceof ApiError) {
    if (error.isProviderError) {
      out.write(`${c.yellow('Ownit:')} ${error.message} These commits stay unverified until you retry. ${RESUME_HINT}\n`);
      return { status: 'provider_error', reason: error.message };
    }
    if (error.code === 'already_resolved') {
      const status = (error.body.status as PushStatus) ?? 'verified';
      out.write(`${c.dim(`Ownit: this push is already ${status}.`)}\n`);
      return { status };
    }
    out.write(`${c.yellow('Ownit:')} ${sentence(error.message)} ${RESUME_HINT}\n`);
    return { status: 'pending', reason: error.message };
  }
  const message = errorMessage(error);
  out.write(`${c.yellow('Ownit:')} ${sentence(message)} ${RESUME_HINT}\n`);
  return { status: 'pending', reason: message };
}
