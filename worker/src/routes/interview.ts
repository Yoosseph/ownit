import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { attachCommits, createPush, findPushForCommits, getPush, recordAttempt, replaceQuestions, setPushStatus, upsertRepo } from '../db';
import { gradeAnswer, MAX_ANSWER_CHARS, writeFollowUp, writeQuestions, type Question } from '../debrief';
import { cappedDemoModel, rateLimit } from '../limits';
import { log } from '../log';
import { createModel, ProviderError, type ChatModel } from '../model';
import { countChangedLines, questionCount } from '../questionCount';
import { seal, unseal } from '../seal';

const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const commit = z.object({ sha, message: z.string().max(20_000) });

const startBody = z.object({
  repo: repoName,
  base_sha: sha.nullish(),
  head_sha: sha,
  commits: z.array(commit).min(1).max(500),
  diff: z.string().max(200_000),
  diff_truncated: z.boolean(),
  changed_lines: z.number().int().min(0),
  push_id: z.number().int().positive().optional(),
});

const answerBody = z.object({
  session: z.string().min(1).max(20_000),
  idx: z.number().int().min(0).max(2),
  answer: z.string().max(MAX_ANSWER_CHARS * 2),
  // The diff is resent with each answer so a follow-up can be written without storing code.
  commits: z.array(commit).min(1).max(500),
  diff: z.string().max(200_000),
  diff_truncated: z.boolean(),
});

const skipBody = z.object({ session: z.string().min(1).max(20_000) });

/** Debrief state sealed into the token the CLI carries between requests. */
export interface DebriefState {
  v: 1;
  pushId: number;
  repoId: number;
  uid: number | null;
  exp: number;
  questions: (Question & { passed: boolean })[];
}

const STATE_TTL_MS = 6 * 60 * 60 * 1000;

function sessionSecret(c: Context<AppEnv>): string {
  const secret = c.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return secret;
}

/** The request's own key, else the capped demo key, else a provider error. */
export function modelFor(c: Context<AppEnv>): ChatModel {
  const key = c.req.header('x-nebius-key')?.trim();
  if (key || c.env.MODEL_BACKEND === 'fixture') return createModel(c.env, key ?? '');
  if (c.env.DEMO_NEBIUS_KEY) {
    return cappedDemoModel(c.env.DB, Number(c.env.DEMO_DAILY_CALL_CAP) || 0, createModel(c.env, c.env.DEMO_NEBIUS_KEY));
  }
  throw new ProviderError('no_key');
}

export const publicQuestion = (q: Question, idx: number) => ({ idx, kind: q.kind, text: q.question });

/** Opens a debrief token for the current user, or explains why it cannot be used. */
async function openState(c: Context<AppEnv>, token: string): Promise<DebriefState | Response> {
  const state = await unseal<DebriefState>(sessionSecret(c), token);
  if (!state || state.v !== 1 || state.uid !== c.get('userId')) {
    return c.json({ error: 'bad_session', message: 'This debrief session is invalid. Run "ownit interview" again.' }, 400);
  }
  if (state.exp < Date.now()) {
    return c.json({ error: 'expired_session', message: 'This debrief session expired. Run "ownit interview" again.' }, 410);
  }
  const push = await getPush(c.env.DB, state.pushId);
  if (!push || (push.status !== 'pending' && push.status !== 'provider_error')) {
    return c.json({ error: 'already_resolved', status: push?.status, message: `This push is already ${push?.status ?? 'gone'}.` }, 409);
  }
  return state;
}

export const interview = new Hono<AppEnv>();

interview.post('/start', async (c) => {
  const parsed = startBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid debrief request.' }, 400);
  const body = parsed.data;
  const [owner, name] = body.repo.split('/') as [string, string];
  const started = Date.now();

  const repo = await upsertRepo(c.env.DB, { owner, name, installationId: null, private: false });
  if (!(await rateLimit(c.env.DB, `start:repo:${repo.id}`, 60, 3600))) {
    return c.json({ error: 'rate_limited', message: 'Too many debriefs for this repo. Try again later.' }, 429);
  }

  const shas = body.commits.map((x) => x.sha);
  let push = body.push_id ? await getPush(c.env.DB, body.push_id) : await findPushForCommits(c.env.DB, repo.id, body.head_sha, shas);
  if (body.push_id && push?.repo_id !== repo.id) return c.json({ error: 'not_found', message: 'No such push in this repo.' }, 404);
  if (push && (push.status === 'verified' || push.status === 'skipped')) {
    return c.json({ error: 'already_resolved', status: push.status, push_id: push.id, message: `This push is already ${push.status}.` }, 409);
  }
  push ??= await createPush(c.env.DB, {
    repoId: repo.id,
    userId: c.get('userId'),
    baseSha: body.base_sha ?? null,
    headSha: body.head_sha,
    status: 'pending',
  });
  await attachCommits(c.env.DB, repo.id, push.id, shas);

  const n = questionCount(Math.max(body.changed_lines, countChangedLines(body.diff)));
  let questions: Question[];
  try {
    questions = await writeQuestions(modelFor(c), n, { commits: body.commits, diff: body.diff, truncated: body.diff_truncated });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await setPushStatus(c.env.DB, push.id, 'provider_error');
    log('interview.start', { repo: body.repo, push: push.id, status: 'provider_error', reason: error.kind, ms: Date.now() - started });
    return c.json({ error: 'provider_error', reason: error.kind, message: error.message, push_id: push.id }, 502);
  }

  await replaceQuestions(c.env.DB, push.id, questions);
  if (push.status === 'provider_error') await setPushStatus(c.env.DB, push.id, 'pending');

  const state: DebriefState = {
    v: 1,
    pushId: push.id,
    repoId: repo.id,
    uid: c.get('userId'),
    exp: Date.now() + STATE_TTL_MS,
    questions: questions.map((q) => ({ ...q, passed: false })),
  };
  log('interview.start', { repo: body.repo, push: push.id, status: 'ok', questions: n, ms: Date.now() - started });
  return c.json({
    push_id: push.id,
    total: n,
    session: await seal(sessionSecret(c), state),
    questions: questions.map(publicQuestion),
  });
});

interview.post('/answer', async (c) => {
  const parsed = answerBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid answer request.' }, 400);
  const body = parsed.data;
  const state = await openState(c, body.session);
  if (state instanceof Response) return state;
  const question = state.questions[body.idx];
  if (!question) return c.json({ error: 'bad_request', message: 'No such question.' }, 400);
  if (question.passed) return c.json({ error: 'already_passed', message: 'That question is already passed.' }, 409);
  const started = Date.now();

  const model = modelFor(c);
  const push = { commits: body.commits, diff: body.diff, truncated: body.diff_truncated };
  let pass: boolean;
  let feedback: string;
  let followUp: Question | undefined;
  try {
    ({ pass, feedback } = await gradeAnswer(model, question, body.answer));
    if (!pass) followUp = await writeFollowUp(model, push, question, feedback);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await setPushStatus(c.env.DB, state.pushId, 'provider_error');
    log('interview.answer', { push: state.pushId, status: 'provider_error', reason: error.kind, ms: Date.now() - started });
    return c.json({ error: 'provider_error', reason: error.kind, message: error.message, push_id: state.pushId }, 502);
  }

  await recordAttempt(c.env.DB, state.pushId, body.idx, pass, followUp?.question);
  if (pass) question.passed = true;
  if (followUp) state.questions[body.idx] = { ...followUp, passed: false };
  const done = state.questions.every((q) => q.passed);
  await setPushStatus(c.env.DB, state.pushId, done ? 'verified' : 'pending');

  log('interview.answer', { push: state.pushId, status: pass ? 'pass' : 'fail', done, ms: Date.now() - started });
  return c.json({
    pass,
    feedback,
    done,
    status: done ? 'verified' : 'pending',
    followup: followUp ? publicQuestion(followUp, body.idx) : null,
    session: await seal(sessionSecret(c), state),
  });
});

interview.post('/skip', async (c) => {
  const parsed = skipBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'Invalid skip request.' }, 400);
  const state = await openState(c, parsed.data.session);
  if (state instanceof Response) return state;
  await setPushStatus(c.env.DB, state.pushId, 'skipped');
  log('interview.skip', { push: state.pushId, status: 'skipped' });
  return c.json({ status: 'skipped', push_id: state.pushId });
});
