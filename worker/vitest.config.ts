import { defineConfig } from 'vitest/config';
import { textFiles } from './test/helpers/textFiles';

export default defineConfig({
  plugins: [textFiles()],
  test: { include: ['test/**/*.test.ts'] },
});
