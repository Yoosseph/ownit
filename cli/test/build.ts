import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup() {
  const cli = resolve(import.meta.dirname, '..');
  execFileSync(process.execPath, [resolve(cli, '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: cli, stdio: 'inherit' });
}
