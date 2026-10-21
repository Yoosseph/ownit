import { listCommits, objectExists, tryGit, ZERO_SHA, type Commit } from './git.js';

export interface RefUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface Range {
  /** null means the empty tree (a root commit). */
  base: string | null;
  head: string;
}

export interface PushRange {
  base: string | null;
  head: string;
  commits: Commit[];
  ranges: Range[];
}

/** Parses the pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" per line. */
export function parseRefs(text: string): RefUpdate[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length === 4 && /^[0-9a-f]{40,64}$/.test(f[1]!) && /^[0-9a-f]{40,64}$/.test(f[3]!))
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef: localRef!, localSha: localSha!, remoteRef: remoteRef!, remoteSha: remoteSha! }));
}

/** First parent of a commit, or null for a root commit. */
function parentOf(sha: string, cwd: string): string | null {
  return tryGit(['rev-parse', '--verify', '--quiet', `${sha}^1`], cwd)?.trim() || null;
}

/**
 * The commits a `git push` will publish, oldest first, across every updated
 * ref. Deletions are ignored. For a new branch, commits already on any
 * remote-tracking branch of that remote are excluded.
 */
export function computePush(updates: RefUpdate[], remote: string, cwd = process.cwd()): PushRange | null {
  const seen = new Set<string>();
  const commits: Commit[] = [];
  const ranges: Range[] = [];
  const isNamedRemote = Boolean(remote) && tryGit(['remote', 'get-url', remote], cwd) !== null;

  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue;
    let revs: string[];
    let base: string | null;
    if (!ZERO_SHA.test(update.remoteSha) && objectExists(update.remoteSha, cwd)) {
      revs = [update.localSha, '--not', update.remoteSha];
      base = tryGit(['merge-base', update.localSha, update.remoteSha], cwd)?.trim() || update.remoteSha;
    } else {
      revs = [update.localSha, '--not', isNamedRemote ? `--remotes=${remote}` : '--remotes'];
      base = null;
    }
    const list = listCommits(revs, cwd).filter((c) => !seen.has(c.sha));
    if (!list.length) continue;
    if (base === null) base = parentOf(list[0]!.sha, cwd);
    for (const c of list) seen.add(c.sha);
    commits.push(...list);
    ranges.push({ base, head: update.localSha });
  }
  if (!ranges.length) return null;
  return { base: ranges[0]!.base, head: ranges[0]!.head, commits, ranges };
}

/** Rebuilds the range of a recorded push from its commit list, for `ownit interview`. */
export function rangeForRecordedPush(baseSha: string | null, headSha: string, shas: string[], cwd = process.cwd()): Range {
  if (baseSha && !ZERO_SHA.test(baseSha) && objectExists(baseSha, cwd)) return { base: baseSha, head: headSha };
  const oldest = shas[0] ?? headSha;
  return { base: parentOf(oldest, cwd), head: headSha };
}
