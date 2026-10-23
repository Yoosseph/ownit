import type { Env } from './env';
import { getPush, getRepoById, isCommitLanded, listQuestions, setCheckRunId, type PushRow, type RepoRow } from './db';
import type { CheckRunBody, GitHub } from './github';
import { repoPageUrl } from './links';
import { log } from './log';

export function checkRunBody(push: PushRow, repo: RepoRow, questions: string[], publicUrl: string): CheckRunBody {
  const details = publicUrl ? repoPageUrl(publicUrl, repo) : undefined;
  const base = { name: 'Ownit', head_sha: push.head_sha, external_id: String(push.id), details_url: details };
  const asked = questions.length ? `\n\nQuestions:\n${questions.map((q) => `- ${q}`).join('\n')}` : '';
  switch (push.status) {
    case 'verified':
      return {
        ...base,
        status: 'completed',
        conclusion: 'success',
        completed_at: new Date().toISOString(),
        output: { title: 'Ownit: verified', summary: `The pusher debriefed this push and passed.${asked}` },
      };
    case 'skipped':
      return {
        ...base,
        status: 'completed',
        conclusion: 'neutral',
        completed_at: new Date().toISOString(),
        output: { title: 'Ownit: skipped', summary: 'Skipped for now. These commits count as unverified until you run `ownit interview` and pass the debrief.' },
      };
    case 'provider_error':
      return {
        ...base,
        status: 'in_progress',
        output: {
          title: 'Ownit: pending',
          summary: 'The debrief hit a model provider error (key, credit, or availability). Run `ownit interview` to retry. These commits count as unverified until then.',
        },
      };
    default:
      return {
        ...base,
        status: 'in_progress',
        output: {
          title: 'Ownit: pending',
          summary: 'Waiting for a debrief. Run `ownit interview` any time; these commits count as unverified until then.',
        },
      };
  }
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
