import type { Env } from './env';
import { syncCheckRun } from './checks';
import type { GitHub } from './github';
import { log } from './log';

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

// Each expired push costs a few queries and GitHub calls to update its check run.
// The free plan allows 50 of each per run, so expire at most this many per hour.
const BATCH = 10;

/** Hourly: pending pushes older than 24 hours become skipped, and their check runs follow. */
export async function expirePending(env: Env, github: GitHub, now = Date.now()): Promise<number[]> {
  const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
  const { results } = await env.DB.prepare(
    `UPDATE pushes SET status = 'skipped', resolved_at = ?
     WHERE id IN (SELECT id FROM pushes WHERE status = 'pending' AND created_at < ? ORDER BY created_at LIMIT ?)
     RETURNING id`,
  )
    .bind(new Date(now).toISOString(), cutoff, BATCH)
    .all<{ id: number }>();
  const ids = results.map((r) => r.id);
  for (const id of ids) await syncCheckRun(env, github, id);
  log('cron.expire', { expired: ids.length });
  return ids;
}
