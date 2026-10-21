import { defineConfig } from 'vitest/config';

// Live checks against the real model, run by scripts/live-injection-check. Never part of `npm test`.
export default defineConfig({
  test: { include: ['test/live/**/*.live.ts'], sequence: { concurrent: false } },
});
