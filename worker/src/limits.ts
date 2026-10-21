import { ProviderError, type ChatModel } from './model';

/** Fixed-window counter. Returns false once `limit` hits within the window. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSeconds: number): Promise<boolean> {
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
  return (row?.count ?? 0) <= limit;
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
