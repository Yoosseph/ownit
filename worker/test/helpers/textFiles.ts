import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Loads .txt imports as strings in tests, the way Wrangler bundles them for the worker. */
export function textFiles(): Plugin {
  return {
    name: 'ownit-text-files',
    // Before Vite's asset plugin, which would turn the import into a file URL.
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.txt')) return null;
      return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
    },
  };
}
