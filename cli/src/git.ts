import { spawnSync } from 'node:child_process';

export const ZERO_SHA = /^0+$/;
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

class GitError extends Error {}

/** Runs git and returns stdout. Throws GitError with stderr on a non-zero exit. */
export function git(args: string[], cwd = process.cwd()): string {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new GitError(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) throw new GitError(result.stderr.trim() || `git ${args.join(' ')} exited with ${result.status}`);
  return result.stdout;
}

/** Like git(), but returns null instead of throwing. */
export function tryGit(args: string[], cwd = process.cwd()): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function objectExists(sha: string, cwd = process.cwd()): boolean {
  return tryGit(['cat-file', '-e', `${sha}^{commit}`], cwd) !== null;
}

export function repoRoot(cwd = process.cwd()): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export function resolveCommit(rev: string, cwd = process.cwd()): string {
  return git(['rev-parse', '--verify', `${rev}^{commit}`], cwd).trim();
}

export interface Commit {
  sha: string;
  message: string;
}

/** Commits in `revs` (rev-list syntax), oldest first. */
export function listCommits(revs: string[], cwd = process.cwd()): Commit[] {
  const out = git(['log', '--reverse', '--format=%H%x1f%B%x1e', ...revs, '--'], cwd);
  return out
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((chunk) => {
      const [sha, message = ''] = chunk.split('\x1f');
      return { sha: sha!.trim(), message: message.trim() };
    });
}

/** "owner/name" from a GitHub remote URL, or null for other hosts. */
function parseGitHubRemote(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The GitHub repo for this checkout: `ownit.repo` config, else the given remote, else origin. */
export function githubRepo(cwd = process.cwd(), remote?: string): string | null {
  const configured = tryGit(['config', '--get', 'ownit.repo'], cwd)?.trim();
  if (configured) return configured;
  for (const name of [remote, 'origin']) {
    if (!name) continue;
    const url = /[:/]/.test(name) ? name : tryGit(['remote', 'get-url', name], cwd)?.trim();
    const parsed = url ? parseGitHubRemote(url) : null;
    if (parsed) return parsed;
  }
  return null;
}

export function gitConfigGet(key: string, cwd = process.cwd()): string | null {
  return tryGit(['config', '--get', key], cwd)?.trim() || null;
}

/** The shared .git directory (the same for every worktree). */
export function gitCommonDir(cwd = process.cwd()): string {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim();
}
