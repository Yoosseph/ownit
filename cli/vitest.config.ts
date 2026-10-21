import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests that run real `git push` invoke the built CLI, so build it once first.
    globalSetup: ['./test/build.ts'],
  },
});
