import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { gitCommonDir, gitConfigGet, repoRoot } from './git.js';

// Hook chaining and core.hooksPath handling follow the approach of
// parthh01/sphinx (MIT): keep the user's hook and run it first, and find the
// directory git actually uses before installing.

export const HOOK_MARKER = '# ownit-managed-hook';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const shPath = (value: string) => (process.platform === 'win32' ? value.replaceAll('\\', '/') : value);

/** The absolute node binary and CLI entry used when `ownit` is not on PATH (e.g. GUI clients). */
export function launcher(): { node: string; cli: string } {
  const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
  return { node: shPath(process.execPath), cli: shPath(entry) };
}

/**
 * The pre-push script. It runs pre-push.local first (its failure blocks the
 * push), then the debrief with the terminal on stdin. Ownit itself never blocks
 * a push: the script always ends with exit 0.
 */
export function hookScript(fallback = launcher()): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by "ownit init". Remove with "ownit uninstall". Your previous hook, if any, is pre-push.local.
hook_dir=$(dirname "$0")
refs=$(cat)
if [ -x "$hook_dir/pre-push.local" ]; then
  if [ -n "$refs" ]; then printf '%s\\n' "$refs"; fi | "$hook_dir/pre-push.local" "$@" || exit $?
fi
[ -n "$refs" ] || exit 0
[ "\${OWNIT_SKIP:-}" = "1" ] && exit 0
[ -n "\${OWNIT_HOOK_ACTIVE:-}" ] && exit 0
OWNIT_REFS=$refs
OWNIT_HOOK_ACTIVE=1
export OWNIT_REFS OWNIT_HOOK_ACTIVE
if command -v ownit >/dev/null 2>&1; then
  set -- ownit hook pre-push "$@"
elif [ -f ${quote(fallback.cli)} ]; then
  set -- ${quote(fallback.node)} ${quote(fallback.cli)} hook pre-push "$@"
else
  echo 'Ownit: CLI not found, so no debrief this time. Push continues.' >&2
  exit 0
fi
tty=\${OWNIT_TTY_DEVICE:-/dev/tty}
if [ -z "\${OWNIT_NO_TTY:-}" ] && (exec <"$tty") 2>/dev/null; then
  OWNIT_TTY=1 "$@" <"$tty"
else
  "$@" </dev/null
fi
exit 0
`;
}

/** Lines to append to a pre-push hook owned by a hook manager such as husky. */
export const MANAGED_SNIPPET = `# Ownit debrief (never blocks the push). Keep this at the end: it reads stdin.
export OWNIT_REFS="$(cat)"
if (exec </dev/tty) 2>/dev/null; then OWNIT_TTY=1 ownit hook pre-push "$@" </dev/tty; else ownit hook pre-push "$@" </dev/null; fi || true`;

export type HookLocation =
  | { kind: 'install'; dir: string; via: 'default' | 'core.hooksPath' }
  | { kind: 'manual'; dir: string; manager: 'husky' | 'other'; reason: string };

/** Where git looks for hooks in this repo, and whether Ownit can install there. */
export function hookLocation(cwd = process.cwd()): HookLocation {
  const root = repoRoot(cwd);
  const configured = gitConfigGet('core.hooksPath', cwd);
  if (!configured) return { kind: 'install', dir: join(gitCommonDir(cwd), 'hooks'), via: 'default' };
  const dir = isAbsolute(configured) ? configured : resolve(root, configured);
  if (/(^|[\\/])\.husky([\\/]|$)/.test(configured) || existsSync(join(root, '.husky'))) {
    return { kind: 'manual', dir, manager: 'husky', reason: 'husky manages this repo\'s hooks' };
  }
  return { kind: 'install', dir, via: 'core.hooksPath' };
}

export function isOwnitHook(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

export interface InstallResult {
  file: string;
  chained: boolean;
  updated: boolean;
}

/** Writes the hook, moving an existing non-Ownit hook to pre-push.local. */
export function installHook(dir: string, script = hookScript()): InstallResult {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'pre-push');
  const local = join(dir, 'pre-push.local');
  const updated = existsSync(file) && isOwnitHook(file);
  if (existsSync(file) && !updated) {
    if (existsSync(local)) {
      throw new Error(`${file} exists and so does ${local}. Merge them by hand, then rerun "ownit init".`);
    }
    renameSync(file, local);
  }
  writeFileSync(file, script, { mode: 0o755 });
  chmodSync(file, 0o755);
  return { file, chained: existsSync(local), updated };
}

/** Removes the Ownit hook and restores pre-push.local as pre-push. */
export function uninstallHook(dir: string): { removed: boolean; restored: boolean } {
  const file = join(dir, 'pre-push');
  const local = join(dir, 'pre-push.local');
  if (!isOwnitHook(file)) return { removed: false, restored: false };
  rmSync(file);
  const restored = existsSync(local);
  if (restored) renameSync(local, file);
  return { removed: true, restored };
}
