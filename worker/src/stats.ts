import type { PushStatus } from './db';

export interface Stats {
  /** Commits GitHub confirmed since tracking began. */
  total: number;
  /** Commits whose push passed a debrief. */
  verified: number;
  /**
   * Every other commit: not debriefed yet, skipped, or stuck on a provider
   * error. There is no deadline; debriefing the push later verifies them.
   */
  unverified: number;
  /** Whole percent, or null when there are no commits yet. verifiedPct + unverifiedPct = 100. */
  verifiedPct: number | null;
  unverifiedPct: number | null;
}

export interface StatusCount {
  status: PushStatus;
  commits: number;
}

/** Commit-weighted share of verified commits. */
export function computeStats(rows: StatusCount[]): Stats {
  let total = 0;
  let verified = 0;
  for (const row of rows) {
    total += row.commits;
    if (row.status === 'verified') verified += row.commits;
  }
  const verifiedPct = total ? Math.round((verified / total) * 100) : null;
  return {
    total,
    verified,
    unverified: total - verified,
    verifiedPct,
    unverifiedPct: verifiedPct === null ? null : 100 - verifiedPct,
  };
}

export interface RepoStats {
  overall: Stats;
  authors: { author: string; stats: Stats }[];
}

/** Stats for one repo: commits GitHub confirmed after tracking began, plus earlier work a debrief verified. */
export async function repoStats(db: D1Database, repoId: number): Promise<RepoStats> {
  const { results } = await db
    .prepare(
      `SELECT p.status AS status, COALESCE(c.author_login, 'unknown') AS author, count(*) AS commits
       FROM commits c
       JOIN pushes p ON p.id = c.push_id
       JOIN repos r ON r.id = c.repo_id
       WHERE c.repo_id = ?
         AND ((c.pushed_at IS NOT NULL AND c.pushed_at >= r.tracked_since) OR (c.backfilled = 1 AND p.status = 'verified'))
       GROUP BY p.status, author`,
    )
    .bind(repoId)
    .all<StatusCount & { author: string }>();
  const byAuthor = new Map<string, StatusCount[]>();
  for (const row of results) {
    const list = byAuthor.get(row.author) ?? [];
    list.push(row);
    byAuthor.set(row.author, list);
  }
  const authors = [...byAuthor.entries()]
    .map(([author, rows]) => ({ author, stats: computeStats(rows) }))
    .sort((a, b) => b.stats.total - a.stats.total || a.author.localeCompare(b.author));
  return { overall: computeStats(results), authors };
}
