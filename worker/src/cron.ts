import type { Env } from './env';
import { syncCheckRun } from './checks';
import type { GitHub } from './github';
import { log } from './log';

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Hourly: pending pushes older than 24 hours become skipped, and their check runs follow. */
export async function expirePending(env: Env, github: GitHub, now = Date.now()): Promise<number[]> {
  const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
  const { results } = await env.DB.prepare(
    `UPDATE pushes SET status = 'skipped', resolved_at = ?
     WHERE id IN (SELECT id FROM pushes WHERE status = 'pending' AND created_at < ? ORDER BY created_at LIMIT 500)
     RETURNING id`,
  )
    .bind(new Date(now).toISOString(), cutoff)
    .all<{ id: number }>();
  const ids = results.map((r) => r.id);
  for (const id of ids) await syncCheckRun(env, github, id);
  log('cron.expire', { expired: ids.length });
  return ids;
}
