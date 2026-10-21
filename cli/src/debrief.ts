import { ApiError, type AnswerResponse, type ApiClient, type PublicQuestion, type PushStatus, type StartResponse } from './api.js';
import type { PreparedDiff } from './diff.js';
import type { Commit } from './git.js';
import type { Writable } from 'node:stream';
import { paint, sentence, spinner, wrap, type Prompter } from './ui.js';

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

function isSkip(answer: string) {
  return /^(s|skip|:skip)$/i.test(answer.trim());
}

/** Runs one debrief: asks each question, grades answers, and offers follow-ups until every question passes. */
export async function runDebrief(api: ApiClient, prompter: Prompter, target: DebriefTarget): Promise<DebriefOutcome> {
  const out = prompter.out;
  const c = paint(out);
  const commitWord = target.commits.length === 1 ? 'commit' : 'commits';
  out.write(`\n${c.bold('Ownit debrief')} ${c.dim(`· ${target.repo} · ${target.commits.length} ${commitWord} · ${target.diff.changedLines} changed ${target.diff.changedLines === 1 ? 'line' : 'lines'}`)}\n`);

  const payload = {
    commits: target.commits,
    diff: target.diff.diff,
    diff_truncated: target.diff.truncated,
  };

  let start: StartResponse;
  const spin = spinner(out, 'Nemotron is reading your push…');
  try {
    start = await api.request<StartResponse>('POST', '/api/interview/start', {
      repo: target.repo,
      base_sha: target.baseSha,
      head_sha: target.headSha,
      changed_lines: target.diff.changedLines,
      push_id: target.pushId,
      ...payload,
    });
  } catch (error) {
    spin.stop();
    return failure(out, error);
  }
  spin.stop();

  let session = start.session;
  out.write(c.dim(`Answer in your own words, up to 5 sentences. Rough is fine. Type "s" to skip.\n`));
  for (const first of start.questions) {
    let question: PublicQuestion = first;
    let followUp = false;
    for (;;) {
      const label = `Question ${question.idx + 1}/${start.total}`;
      out.write(`\n${c.bold(c.cyan(label))} ${c.dim(`(${KIND_LABEL[question.kind]}${followUp ? ', follow-up' : ''})`)}\n`);
      out.write(`${wrap(question.text)}\n`);
      let answer: string | null;
      do answer = await prompter.ask(c.bold('> '));
      while (answer !== null && !answer.trim());
      if (answer === null) {
        out.write(`\n${c.yellow('Debrief paused.')} ${RESUME_HINT}\n`);
        return { status: 'pending', reason: 'debrief paused' };
      }
      if (isSkip(answer)) return skip(api, out, session);

      const grading = spinner(out, 'Checking your answer…');
      let result: AnswerResponse;
      try {
        result = await api.request<AnswerResponse>('POST', '/api/interview/answer', {
          session,
          idx: question.idx,
          answer: answer.slice(0, MAX_ANSWER_CHARS),
          ...payload,
        });
      } catch (error) {
        grading.stop();
        return failure(out, error);
      }
      grading.stop();
      session = result.session;
      if (result.pass) {
        out.write(`${c.green('✓ Passed.')}\n${c.dim(wrap(result.feedback))}\n`);
        break;
      }
      out.write(`${c.yellow('Not quite yet.')}\n${wrap(result.feedback)}\n`);
      if (!result.followup) return { status: 'pending', reason: 'no follow-up question' };
      out.write(c.dim("Here's another angle on the same topic:\n"));
      question = result.followup;
      followUp = true;
    }
  }
  out.write(`\n${c.green(c.bold('✓ Push verified.'))} ${c.dim(`${target.commits.length} ${commitWord} owned. Nice work.`)}\n`);
  return { status: 'verified' };
}

async function skip(api: ApiClient, out: Writable, session: string): Promise<DebriefOutcome> {
  try {
    await api.request('POST', '/api/interview/skip', { session });
  } catch (error) {
    return failure(out, error);
  }
  out.write(`${paint(out).dim('Skipped. This push is recorded as skipped.')}\n`);
  return { status: 'skipped' };
}

/** Prints a one-line reason. Provider problems stay out of the stats until retried. */
function failure(out: Writable, error: unknown): DebriefOutcome {
  const c = paint(out);
  if (error instanceof ApiError) {
    if (error.isProviderError) {
      out.write(`${c.yellow('Ownit:')} ${error.message} This push won't count until you retry. ${RESUME_HINT}\n`);
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
  const message = error instanceof Error ? error.message : String(error);
  out.write(`${c.yellow('Ownit:')} ${sentence(message)} ${RESUME_HINT}\n`);
  return { status: 'pending', reason: message };
}
