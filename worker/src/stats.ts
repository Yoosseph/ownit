import type { PushStatus } from './db';

export interface Stats {
  /** Commits that count: their push is verified or skipped (expired pending pushes are skipped). */
  counted: number;
  verified: number;
  skipped: number;
  /** Commits waiting on a debrief (pending or provider_error). They do not count yet. */
  waiting: number;
  /** Whole percent, or null when nothing counts yet. verifiedPct + skippedPct = 100. */
  verifiedPct: number | null;
  skippedPct: number | null;
}

export interface StatusCount {
  status: PushStatus;
  commits: number;
}

/** Commit-weighted stats over verified and skipped pushes. */
export function computeStats(rows: StatusCount[]): Stats {
  let verified = 0;
  let skipped = 0;
  let waiting = 0;
  for (const row of rows) {
    if (row.status === 'verified') verified += row.commits;
    else if (row.status === 'skipped') skipped += row.commits;
    else waiting += row.commits;
  }
  const counted = verified + skipped;
  const verifiedPct = counted ? Math.round((verified / counted) * 100) : null;
  return { counted, verified, skipped, waiting, verifiedPct, skippedPct: verifiedPct === null ? null : 100 - verifiedPct };
}

export interface RepoStats {
  overall: Stats;
  authors: { author: string; stats: Stats }[];
}

/** Stats for one repo, counting only commits GitHub confirmed after tracking began. */
export async function repoStats(db: D1Database, repoId: number): Promise<RepoStats> {
  const { results } = await db
    .prepare(
      `SELECT p.status AS status, COALESCE(c.author_login, 'unknown') AS author, count(*) AS commits
       FROM commits c
       JOIN pushes p ON p.id = c.push_id
       JOIN repos r ON r.id = c.repo_id
       WHERE c.repo_id = ? AND c.pushed_at IS NOT NULL AND c.pushed_at >= r.tracked_since
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
    .sort((a, b) => b.stats.counted - a.stats.counted || a.author.localeCompare(b.author));
  return { overall: computeStats(results), authors };
}
