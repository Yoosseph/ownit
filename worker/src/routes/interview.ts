import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { attachCommits, createPush, findPushForCommits, replaceQuestions, setPushStatus, upsertRepo } from '../db';
import { writeQuestions, type Question } from '../debrief';
import { cappedDemoModel, rateLimit } from '../limits';
import { log } from '../log';
import { createModel, ProviderError, type ChatModel } from '../model';
import { countChangedLines, questionCount } from '../questionCount';
import { seal } from '../seal';

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
  let push = await findPushForCommits(c.env.DB, repo.id, body.head_sha, shas);
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
