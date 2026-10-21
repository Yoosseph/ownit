import type { Context } from 'hono';

/** Runs work after the response when the runtime allows it (waitUntil), inline otherwise. */
export async function background(c: Context, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}
