// Queries for the core tables: repos, users, pushes, commits and questions.
// Tables with a single owner keep their SQL there: sessions (sessions.ts),
// rate_limits and demo_usage (limits.ts), and the stats aggregation (stats.ts).
//
// Lists of SHAs are passed as one JSON parameter and expanded with json_each, so
// each operation is a single statement however many commits a push has. D1's free
// plan allows 50 queries per request and 100 bound parameters per statement.
import type { Kind } from './questionCount';

export type PushStatus = 'verified' | 'skipped' | 'pending' | 'provider_error';

/** The developer answered the hook's prompt: debriefed (verified) or skipped. */
export const isResolved = (status: PushStatus) => status === 'verified' || status === 'skipped';

/** Only a verified push is final. Pending, skipped and provider_error pushes can still be debriefed. */
export const isVerified = (status: PushStatus) => status === 'verified';

export interface RepoRow {
  id: number;
  owner: string;
  name: string;
  installation_id: number | null;
  tracked_since: string;
  private: number;
  /** Public page settings (0 or 1). Private repos show neither, whatever these say. */
  show_questions: number;
  show_answers: number;
  /** Whether debriefs of commits from before tracking count once verified (0 or 1). */
  allow_backfill: number;
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
  /** The passing answer, kept only while the repo shows answers. */
  answer: string | null;
  /** 1 when the developer stood by an answer the grader did not accept. */
  disputed: number;
}

/** A commit from a GitHub push webhook. */
export interface LandedCommit {
  sha: string;
  author: string | null;
}

export const nowIso = () => new Date().toISOString();

const resolvedAt = (status: PushStatus) => (isResolved(status) ? nowIso() : null);

// --- Repos -----------------------------------------------------------------

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

export function setRepoInstallation(db: D1Database, repoId: number, installationId: number | null, isPrivate: boolean) {
  return db.prepare('UPDATE repos SET installation_id = ?, private = ? WHERE id = ?').bind(installationId, isPrivate ? 1 : 0, repoId).run();
}

export interface RepoSettings {
  showQuestions: boolean;
  showAnswers: boolean;
  allowBackfill: boolean;
}

/** Saves a repo's settings. Answers need questions, and turning answers off deletes the stored ones. */
export async function setRepoSettings(db: D1Database, repoId: number, settings: RepoSettings) {
  const showAnswers = settings.showQuestions && settings.showAnswers;
  await db.batch([
    db
      .prepare('UPDATE repos SET show_questions = ?, show_answers = ?, allow_backfill = ? WHERE id = ?')
      .bind(settings.showQuestions ? 1 : 0, showAnswers ? 1 : 0, settings.allowBackfill ? 1 : 0, repoId),
    ...(showAnswers
      ? []
      : [db.prepare('UPDATE questions SET answer = NULL WHERE push_id IN (SELECT id FROM pushes WHERE repo_id = ?)').bind(repoId)]),
  ]);
}

// --- Users -----------------------------------------------------------------

export function upsertUser(db: D1Database, githubId: number, login: string) {
  return db
    .prepare('INSERT INTO users (github_id, login) VALUES (?, ?) ON CONFLICT (github_id) DO UPDATE SET login = excluded.login')
    .bind(githubId, login)
    .run();
}

// --- Pushes ----------------------------------------------------------------

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

export function setPushStatus(db: D1Database, pushId: number, status: PushStatus) {
  return db.prepare('UPDATE pushes SET status = ?, resolved_at = ? WHERE id = ?').bind(status, resolvedAt(status), pushId).run();
}

export function setCheckRunId(db: D1Database, pushId: number, checkRunId: number) {
  return db.prepare('UPDATE pushes SET check_run_id = ? WHERE id = ?').bind(checkRunId, pushId).run();
}

/** The user's pushes not verified yet (plus unowned ones), newest first. */
export async function listOpenPushes(db: D1Database, repoId: number, userId: number | null): Promise<PushRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM pushes WHERE repo_id = ? AND status IN ('pending', 'skipped', 'provider_error')
         AND (user_github_id IS NULL OR user_github_id = ?)
       ORDER BY created_at DESC LIMIT 20`,
    )
    .bind(repoId, userId)
    .all<PushRow>();
  return results;
}

/** A push as the public page lists it: only pushes with at least one commit GitHub confirmed. */
export interface PushSummaryRow {
  id: number;
  status: PushStatus;
  head_sha: string;
  created_at: string;
  pusher: string | null;
  commits: number;
  /** 1 when every counted commit is earlier work, credited by a later debrief. */
  earlier: number;
  /** How many pushes the page could list in all, beyond this page's limit. */
  total_pushes: number;
}

export async function listRecentPushes(db: D1Database, repoId: number): Promise<PushSummaryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.status, p.head_sha, p.created_at, u.login AS pusher,
              (SELECT count(*) FROM commits c WHERE c.push_id = p.id AND (c.pushed_at IS NOT NULL OR c.backfilled = 1)) AS commits,
              NOT EXISTS (SELECT 1 FROM commits c WHERE c.push_id = p.id AND c.backfilled = 0 AND c.pushed_at IS NOT NULL) AS earlier,
              count(*) OVER () AS total_pushes
       FROM pushes p LEFT JOIN users u ON u.github_id = p.user_github_id
       WHERE p.repo_id = ? AND EXISTS (SELECT 1 FROM commits c WHERE c.push_id = p.id AND (c.pushed_at IS NOT NULL OR c.backfilled = 1))
       ORDER BY p.created_at DESC LIMIT 30`,
    )
    .bind(repoId)
    .all<PushSummaryRow>();
  return results;
}

// --- Commits ---------------------------------------------------------------

/** Attaches commits that no push owns yet. Commits already owned elsewhere are left alone. */
export async function attachCommits(db: D1Database, repoId: number, pushId: number, shas: string[]) {
  if (!shas.length) return;
  await db
    .prepare('INSERT INTO commits (sha, repo_id, push_id) SELECT value, ?, ? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING')
    .bind(repoId, pushId, JSON.stringify(shas))
    .run();
}

/** The SHAs of each push's commits, in the order they were recorded. */
export async function listCommitShas(db: D1Database, pushIds: number[]): Promise<{ push_id: number; sha: string }[]> {
  const { results } = await db
    .prepare('SELECT push_id, sha FROM commits WHERE push_id IN (SELECT value FROM json_each(?)) ORDER BY rowid')
    .bind(JSON.stringify(pushIds))
    .all<{ push_id: number; sha: string }>();
  return results;
}

/** Whether GitHub has confirmed this commit landed. */
export async function isCommitLanded(db: D1Database, repoId: number, sha: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM commits WHERE repo_id = ? AND sha = ? AND pushed_at IS NOT NULL')
    .bind(repoId, sha)
    .first<{ ok: number }>();
  return Boolean(row);
}

/** Which of these commits Ownit already knows, and the push each belongs to. */
export async function findKnownCommits(db: D1Database, repoId: number, commits: LandedCommit[]): Promise<{ sha: string; push_id: number }[]> {
  const { results } = await db
    .prepare('SELECT sha, push_id FROM commits WHERE repo_id = ? AND sha IN (SELECT json_extract(value, \'$.sha\') FROM json_each(?))')
    .bind(repoId, JSON.stringify(commits))
    .all<{ sha: string; push_id: number }>();
  return results;
}

/** Records that known commits landed on GitHub (first landing time wins), with their authors. */
export function markCommitsLanded(db: D1Database, repoId: number, commits: LandedCommit[], pushedAt: string) {
  return db
    .prepare(
      `UPDATE commits SET pushed_at = COALESCE(pushed_at, ?), author_login = COALESCE(j.author, author_login)
       FROM (SELECT json_extract(value, '$.sha') AS sha, json_extract(value, '$.author') AS author FROM json_each(?)) AS j
       WHERE commits.repo_id = ? AND commits.sha = j.sha`,
    )
    .bind(pushedAt, JSON.stringify(commits), repoId)
    .run();
}

/**
 * Credits a verified push's earlier work: its commits that did not land after
 * tracking began. They count from now on, attributed to `login` when GitHub
 * named no author. Returns how many were credited.
 */
export async function creditEarlierWork(db: D1Database, repo: RepoRow, pushId: number, login: string | null): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE commits SET backfilled = 1, author_login = COALESCE(author_login, ?)
       WHERE push_id = ? AND backfilled = 0 AND (pushed_at IS NULL OR pushed_at < ?)`,
    )
    .bind(login, pushId, repo.tracked_since)
    .run();
  return result.meta.changes ?? 0;
}

/** Adds commits that landed without a debrief to `pushId`, already marked as landed. */
export function insertLandedCommits(db: D1Database, repoId: number, pushId: number, commits: LandedCommit[], pushedAt: string) {
  return db
    .prepare(
      `INSERT INTO commits (sha, repo_id, push_id, author_login, pushed_at)
       SELECT json_extract(value, '$.sha'), ?, ?, json_extract(value, '$.author'), ? FROM json_each(?) WHERE true
       ON CONFLICT DO NOTHING`,
    )
    .bind(repoId, pushId, pushedAt, JSON.stringify(commits))
    .run();
}

// --- Questions -------------------------------------------------------------

export async function replaceQuestions(db: D1Database, pushId: number, questions: { kind: Kind; question: string }[]) {
  await db.batch([
    db.prepare('DELETE FROM questions WHERE push_id = ?').bind(pushId),
    db.prepare('UPDATE pushes SET question_count = ? WHERE id = ?').bind(questions.length, pushId),
    ...questions.map((q, idx) =>
      db.prepare('INSERT INTO questions (push_id, idx, kind, text) VALUES (?, ?, ?, ?)').bind(pushId, idx, q.kind, q.question),
    ),
  ]);
}

/**
 * Records one graded attempt. A follow-up replaces the question text shown on
 * the public page. `answer` is the passing answer to keep, or null to keep none.
 */
export function recordAttempt(
  db: D1Database,
  pushId: number,
  idx: number,
  attempt: { passed: boolean; nextText?: string; answer: string | null; disputed?: boolean },
) {
  return db
    .prepare(
      `UPDATE questions SET attempts = attempts + 1, passed = ?, text = COALESCE(?, text), answer = ?, disputed = ?
       WHERE push_id = ? AND idx = ?`,
    )
    .bind(attempt.passed ? 1 : 0, attempt.nextText ?? null, attempt.answer, attempt.disputed ? 1 : 0, pushId, idx)
    .run();
}

export async function listQuestions(db: D1Database, pushId: number): Promise<QuestionRow[]> {
  const { results } = await db.prepare('SELECT * FROM questions WHERE push_id = ? ORDER BY idx').bind(pushId).all<QuestionRow>();
  return results;
}

export type QuestionSummaryRow = Pick<QuestionRow, 'push_id' | 'kind' | 'text' | 'passed' | 'attempts' | 'answer' | 'disputed'>;

/** The questions of several pushes in one query, ordered by push and position. */
export async function listQuestionsForPushes(db: D1Database, pushIds: number[]): Promise<QuestionSummaryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT push_id, kind, text, passed, attempts, answer, disputed FROM questions
       WHERE push_id IN (SELECT value FROM json_each(?)) ORDER BY push_id, idx`,
    )
    .bind(JSON.stringify(pushIds))
    .all<QuestionSummaryRow>();
  return results;
}
