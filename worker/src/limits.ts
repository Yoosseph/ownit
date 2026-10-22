import { ProviderError, type ChatModel } from './model';

export interface Limit {
  max: number;
  windowSeconds: number;
}

/** Request budgets. Each counter is keyed by who or what it limits. */
export const LIMITS = {
  /** Any API call by one user. */
  apiPerUser: { max: 600, windowSeconds: 3600 },
  /** GitHub login exchanges from one IP. */
  loginPerIp: { max: 30, windowSeconds: 3600 },
  /** Debriefs started by one user. */
  debriefsPerUser: { max: 30, windowSeconds: 3600 },
  /** Debriefs started in one repo. */
  debriefsPerRepo: { max: 60, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

/** Fixed-window counter. Returns false once `limit.max` hits within the window. */
export async function rateLimit(db: D1Database, key: string, { max, windowSeconds }: Limit): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= max;
}

/** Wraps a model paid for by the demo key so every call counts toward the daily cap. */
export function cappedDemoModel(db: D1Database, cap: number, model: ChatModel): ChatModel {
  return {
    async complete(prompt, maxTokens) {
      const day = new Date().toISOString().slice(0, 10);
      const row = await db
        .prepare(
          `INSERT INTO demo_usage (day, calls) VALUES (?, 1)
           ON CONFLICT (day) DO UPDATE SET calls = demo_usage.calls + 1 RETURNING calls`,
        )
        .bind(day)
        .first<{ calls: number }>();
      if ((row?.calls ?? 0) > cap) throw new ProviderError('demo_cap');
      return model.complete(prompt, maxTokens);
    },
  };
}
