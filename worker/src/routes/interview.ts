import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { attachCommits, createPush, findPushForCommits, getPush, isVerified, recordAttempt, replaceQuestions, setPushStatus, type PushRow, type RepoRow } from '../db';
import { judgeAnswer, MAX_ANSWER_CHARS, writeQuestions, type Question, type Verdict } from '../debrief';
import { cappedDemoModel, LIMITS, rateLimit } from '../limits';
import { log, type LogFields } from '../log';
import { createModel, isProvider, ProviderError, type ChatModel } from '../model';
import { countChangedLines, questionCount } from '../questionCount';
import { seal, unseal } from '../seal';
import { commit, readJson, repoName, requireRepo, sha, updateStatus } from './shared';

// --- Request bodies ----------------------------------------------------------

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

// --- The model for a request -------------------------------------------------

/** The API key the CLI sent and the provider it named. */
function requestedKey(c: Context<AppEnv>): { key: string | undefined; provider: string } {
  // CLI builds from before the provider choice sent only x-nebius-key.
  const legacy = c.req.header('x-nebius-key')?.trim();
  const key = c.req.header('x-model-key')?.trim() || legacy;
  const provider = (key === legacy ? 'nebius' : c.req.header('x-model-provider')?.trim().toLowerCase()) || 'nebius';
  return { key, provider };
}

/** The request's own key on its chosen provider, else the capped demo key, else a provider error. */
export function modelFor(c: Context<AppEnv>): ChatModel {
  const { key, provider } = requestedKey(c);
  if (key || c.env.MODEL_BACKEND === 'fixture') {
    if (!isProvider(provider)) throw new ProviderError('unknown_provider');
    return createModel(c.env, key ?? '', provider);
  }
  if (c.env.DEMO_NEBIUS_KEY) {
    return cappedDemoModel(c.env.DB, Number(c.env.DEMO_DAILY_CALL_CAP) || 0, createModel(c.env, c.env.DEMO_NEBIUS_KEY, 'nebius'));
  }
  throw new ProviderError('no_key');
}

/**
 * Marks the push provider_error (it stays out of the stats until retried) and
 * explains why. Anything that is not a ProviderError is rethrown.
 */
async function providerFailure(c: Context<AppEnv>, error: unknown, pushId: number, event: string, fields: LogFields, started: number): Promise<Response> {
  if (!(error instanceof ProviderError)) throw error;
  await updateStatus(c, pushId, 'provider_error');
  log(event, { ...fields, push: pushId, status: 'provider_error', reason: error.kind, ms: Date.now() - started });
  return c.json({ error: 'provider_error', reason: error.kind, message: error.message, push_id: pushId }, 502);
}

// --- Sealed debrief state ----------------------------------------------------

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

const sealState = (c: Context<AppEnv>, state: DebriefState) => seal(sessionSecret(c), state);

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
  if (!push || isVerified(push.status)) {
    return c.json({ error: 'already_resolved', status: push?.status, message: `This push is already ${push?.status ?? 'gone'}.` }, 409);
  }
  return state;
}

export const publicQuestion = (q: Question, idx: number) => ({ idx, kind: q.kind, text: q.question });

// --- Routes ------------------------------------------------------------------

/**
 * The push these commits belong to, created when new, provided the current
 * user may debrief it. Otherwise an error response to return as is.
 */
async function claimPush(c: Context<AppEnv>, repo: RepoRow, body: z.infer<typeof startBody>): Promise<PushRow | Response> {
  const shas = body.commits.map((x) => x.sha);
  let push = body.push_id ? await getPush(c.env.DB, body.push_id) : await findPushForCommits(c.env.DB, repo.id, body.head_sha, shas);
  if (body.push_id && push?.repo_id !== repo.id) return c.json({ error: 'not_found', message: 'No such push in this repo.' }, 404);
  if (push?.user_github_id && push.user_github_id !== c.get('userId')) {
    return c.json({ error: 'forbidden', message: 'Another developer pushed these commits, so the debrief is theirs.' }, 403);
  }
  if (push && isVerified(push.status)) {
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
  return push;
}

export const interview = new Hono<AppEnv>();

interview.post('/start', async (c) => {
  const body = await readJson(c, startBody, 'Invalid debrief request.');
  if (body instanceof Response) return body;
  const started = Date.now();

  const repo = await requireRepo(c, body.repo);
  if (repo instanceof Response) return repo;
  const limited =
    !(await rateLimit(c.env.DB, `start:user:${c.get('userId')}`, LIMITS.debriefsPerUser)) ||
    !(await rateLimit(c.env.DB, `start:repo:${repo.id}`, LIMITS.debriefsPerRepo));
  if (limited) {
    return c.json({ error: 'rate_limited', message: 'Too many debriefs for this repo. Try again later.' }, 429);
  }
  const push = await claimPush(c, repo, body);
  if (push instanceof Response) return push;

  const n = questionCount(Math.max(body.changed_lines, countChangedLines(body.diff)));
  let questions: Question[];
  try {
    questions = await writeQuestions(modelFor(c), n, { commits: body.commits, diff: body.diff, truncated: body.diff_truncated });
  } catch (error) {
    return providerFailure(c, error, push.id, 'interview.start', { repo: body.repo }, started);
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
    session: await sealState(c, state),
    questions: questions.map(publicQuestion),
  });
});

interview.post('/answer', async (c) => {
  const body = await readJson(c, answerBody, 'Invalid answer request.');
  if (body instanceof Response) return body;
  const state = await openState(c, body.session);
  if (state instanceof Response) return state;
  const question = state.questions[body.idx];
  if (!question) return c.json({ error: 'bad_request', message: 'No such question.' }, 400);
  if (question.passed) return c.json({ error: 'already_passed', message: 'That question is already passed.' }, 409);
  const started = Date.now();

  const model = modelFor(c);
  const push = { commits: body.commits, diff: body.diff, truncated: body.diff_truncated };
  let verdict: Verdict;
  try {
    verdict = await judgeAnswer(model, push, question, body.answer);
  } catch (error) {
    return providerFailure(c, error, state.pushId, 'interview.answer', {}, started);
  }
  const { pass, feedback, followUp } = verdict;

  await recordAttempt(c.env.DB, state.pushId, body.idx, pass, followUp?.question);
  if (pass) question.passed = true;
  if (followUp) state.questions[body.idx] = { ...followUp, passed: false };
  const done = state.questions.every((q) => q.passed);
  if (done) await updateStatus(c, state.pushId, 'verified');
  else await setPushStatus(c.env.DB, state.pushId, 'pending');

  log('interview.answer', { push: state.pushId, status: pass ? 'pass' : 'fail', done, ms: Date.now() - started });
  return c.json({
    pass,
    feedback,
    done,
    status: done ? 'verified' : 'pending',
    followup: followUp ? publicQuestion(followUp, body.idx) : null,
    session: await sealState(c, state),
  });
});

interview.post('/skip', async (c) => {
  const body = await readJson(c, skipBody, 'Invalid skip request.');
  if (body instanceof Response) return body;
  const state = await openState(c, body.session);
  if (state instanceof Response) return state;
  await updateStatus(c, state.pushId, 'skipped');
  log('interview.skip', { push: state.pushId, status: 'skipped' });
  return c.json({ status: 'skipped', push_id: state.pushId });
});
