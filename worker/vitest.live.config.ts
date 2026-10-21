import { defineConfig } from 'vitest/config';
import { textFiles } from './test/helpers/textFiles';

// Live checks against the real model, run by scripts/live-injection-check. Never part of `npm test`.
export default defineConfig({
  plugins: [textFiles()],
  test: { include: ['test/live/**/*.live.ts'], sequence: { concurrent: false } },
});
