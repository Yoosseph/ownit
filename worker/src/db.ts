import type { Kind } from './questionCount';

export type PushStatus = 'verified' | 'skipped' | 'pending' | 'provider_error';

/** Verified and skipped are final. Pending and provider_error pushes still wait for a debrief. */
export const isResolved = (status: PushStatus) => status === 'verified' || status === 'skipped';

export interface RepoRow {
  id: number;
  owner: string;
  name: string;
  installation_id: number | null;
  tracked_since: string;
  private: number;
}

export interface PushRow {
  id: number;
  repo_id: number;
  user_github_id: number | null;
  base_sha: string | null;
  head_sha: string;
  status: PushStatus;
  question_count: number;
  created_at: string;
  resolved_at: string | null;
  check_run_id: number | null;
}

export interface QuestionRow {
  id: number;
  push_id: number;
  idx: number;
  kind: Kind;
  text: string;
  passed: number;
  attempts: number;
}

export const nowIso = () => new Date().toISOString();

const resolvedAt = (status: PushStatus) => (isResolved(status) ? nowIso() : null);

// Lists of SHAs are passed as one JSON parameter and expanded with json_each, so
// each operation is a single statement however many commits a push has. D1's free
// plan allows 50 queries per request and 100 bound parameters per statement.

export function getRepo(db: D1Database, owner: string, name: string): Promise<RepoRow | null> {
  return db.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?').bind(owner, name).first<RepoRow>();
}

export function getRepoById(db: D1Database, id: number): Promise<RepoRow | null> {
  return db.prepare('SELECT * FROM repos WHERE id = ?').bind(id).first<RepoRow>();
}

export async function upsertRepo(
  db: D1Database,
  repo: { owner: string; name: string; installationId: number | null; private: boolean },
): Promise<RepoRow> {
  await db
    .prepare(
      `INSERT INTO repos (owner, name, installation_id, tracked_since, private) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (owner, name) DO UPDATE SET
         installation_id = COALESCE(excluded.installation_id, repos.installation_id),
         private = excluded.private`,
    )
    .bind(repo.owner, repo.name, repo.installationId, nowIso(), repo.private ? 1 : 0)
    .run();
  return (await getRepo(db, repo.owner, repo.name))!;
}

export function upsertUser(db: D1Database, githubId: number, login: string) {
  return db
    .prepare('INSERT INTO users (github_id, login) VALUES (?, ?) ON CONFLICT (github_id) DO UPDATE SET login = excluded.login')
    .bind(githubId, login)
    .run();
}

export function getPush(db: D1Database, id: number): Promise<PushRow | null> {
  return db.prepare('SELECT * FROM pushes WHERE id = ?').bind(id).first<PushRow>();
}

/** The push that already owns the head commit or any of the given commits. */
export async function findPushForCommits(db: D1Database, repoId: number, headSha: string, shas: string[]): Promise<PushRow | null> {
  const byHead = await db
    .prepare('SELECT * FROM pushes WHERE repo_id = ? AND head_sha = ? ORDER BY id DESC LIMIT 1')
    .bind(repoId, headSha)
    .first<PushRow>();
  if (byHead || !shas.length) return byHead;
  return db
    .prepare(
      `SELECT p.* FROM pushes p JOIN commits c ON c.push_id = p.id
       WHERE c.repo_id = ? AND c.sha IN (SELECT value FROM json_each(?)) ORDER BY p.id DESC LIMIT 1`,
    )
    .bind(repoId, JSON.stringify(shas))
    .first<PushRow>();
}

export async function createPush(
  db: D1Database,
  push: { repoId: number; userId: number | null; baseSha: string | null; headSha: string; status: PushStatus },
): Promise<PushRow> {
  const row = await db
    .prepare(
      `INSERT INTO pushes (repo_id, user_github_id, base_sha, head_sha, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(push.repoId, push.userId, push.baseSha, push.headSha, push.status, nowIso(), resolvedAt(push.status))
    .first<PushRow>();
  return row!;
}

/** Attaches commits that no push owns yet. Commits already owned elsewhere are left alone. */
export async function attachCommits(db: D1Database, repoId: number, pushId: number, shas: string[]) {
  if (!shas.length) return;
  await db
    .prepare('INSERT INTO commits (sha, repo_id, push_id) SELECT value, ?, ? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING')
    .bind(repoId, pushId, JSON.stringify(shas))
    .run();
}

export function setPushStatus(db: D1Database, pushId: number, status: PushStatus) {
  return db.prepare('UPDATE pushes SET status = ?, resolved_at = ? WHERE id = ?').bind(status, resolvedAt(status), pushId).run();
}

export async function replaceQuestions(db: D1Database, pushId: number, questions: { kind: Kind; question: string }[]) {
  await db.batch([
    db.prepare('DELETE FROM questions WHERE push_id = ?').bind(pushId),
    db.prepare('UPDATE pushes SET question_count = ? WHERE id = ?').bind(questions.length, pushId),
    ...questions.map((q, idx) =>
      db.prepare('INSERT INTO questions (push_id, idx, kind, text) VALUES (?, ?, ?, ?)').bind(pushId, idx, q.kind, q.question),
    ),
  ]);
}

/** Records one graded attempt. A follow-up replaces the question text shown on the public page. */
export function recordAttempt(db: D1Database, pushId: number, idx: number, passed: boolean, nextText?: string) {
  return db
    .prepare(
      `UPDATE questions SET attempts = attempts + 1, passed = ?, text = COALESCE(?, text)
       WHERE push_id = ? AND idx = ?`,
    )
    .bind(passed ? 1 : 0, nextText ?? null, pushId, idx)
    .run();
}

export async function listQuestions(db: D1Database, pushId: number): Promise<QuestionRow[]> {
  const { results } = await db.prepare('SELECT * FROM questions WHERE push_id = ? ORDER BY idx').bind(pushId).all<QuestionRow>();
  return results;
}
