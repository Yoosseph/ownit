import type { Env } from './env';
import { getPush, getRepoById, isCommitLanded, listQuestions, setCheckRunId, type PushRow, type RepoRow } from './db';
import type { CheckRunBody, GitHub } from './github';
import { repoPageUrl } from './links';
import { log } from './log';

/**
 * The check run for a push. It is always completed and green: Ownit never
 * blocks a merge or leaves a commit marked in progress. The title tells a
 * verified push from one still waiting, and the badge and repo page count
 * the waiting ones as unverified.
 */
export function checkRunBody(push: PushRow, repo: RepoRow, questions: string[], publicUrl: string): CheckRunBody {
  const details = publicUrl ? repoPageUrl(publicUrl, repo) : undefined;
  const base = {
    name: 'Ownit',
    head_sha: push.head_sha,
    external_id: String(push.id),
    details_url: details,
    status: 'completed',
    conclusion: 'success',
    completed_at: new Date().toISOString(),
  } as const;
  if (push.status === 'verified') {
    const asked = questions.length ? `\n\nQuestions:\n${questions.map((q) => `- ${q}`).join('\n')}` : '';
    return { ...base, output: { title: 'Ownit: verified', summary: `The pusher debriefed this push and passed.${asked}` } };
  }
  const why =
    push.status === 'provider_error'
      ? 'The debrief hit a model provider error (key, credit, or availability).'
      : 'Nobody has debriefed this push yet.';
  return {
    ...base,
    output: {
      title: 'Ownit: not debriefed yet',
      summary: `${why} Run \`ownit interview\` any time. These commits count as unverified on the badge and repo page until the debrief passes.`,
    },
  };
}

/**
 * Creates or updates the push's check run on its head commit. Does nothing
 * until GitHub has confirmed the head commit landed, or when the App is absent.
 */
export async function syncCheckRun(env: Env, github: GitHub, pushId: number): Promise<void> {
  const push = await getPush(env.DB, pushId);
  if (!push) return;
  const repo = await getRepoById(env.DB, push.repo_id);
  if (!repo?.installation_id) return;
  if (!(await isCommitLanded(env.DB, repo.id, push.head_sha))) return;
  const questions = push.status === 'verified' ? (await listQuestions(env.DB, push.id)).map((q) => q.text) : [];
  const body = checkRunBody(push, repo, questions, env.PUBLIC_URL);
  try {
    if (push.check_run_id) {
      await github.updateCheckRun(repo.installation_id, repo.owner, repo.name, push.check_run_id, body);
    } else {
      const id = await github.createCheckRun(repo.installation_id, repo.owner, repo.name, body);
      await setCheckRunId(env.DB, push.id, id);
    }
    log('check_run.sync', { repo: `${repo.owner}/${repo.name}`, push: push.id, status: push.status });
  } catch (error) {
    log('check_run.error', { push: push.id, message: error instanceof Error ? error.message : 'unknown' });
  }
}
