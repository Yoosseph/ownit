// Who may do what in a repo, checked with the GitHub App's installation token:
// users with push access record debriefs; admins and maintainers change settings.
import type { Context } from 'hono';
import type { AppEnv } from './app';
import type { RepoRow } from './db';
import { GitHubError } from './github';
import { installUrl } from './links';
import { log } from './log';

export type AccessLevel = 'push' | 'admin';

const ROLES: Record<AccessLevel, Set<string>> = {
  push: new Set(['admin', 'maintain', 'write']),
  admin: new Set(['admin', 'maintain']),
};

const DENIED: Record<AccessLevel, string> = {
  push: 'You need push access to {repo} to record debriefs for it.',
  admin: 'Only admins and maintainers of {repo} can change its Ownit settings.',
};

// GitHub's answers are cached briefly per isolate to keep debriefs snappy.
// A user whose access is revoked keeps it for at most five minutes.
const permissionCache = new Map<string, { permission: string; until: number }>();

export function clearPermissionCache() {
  permissionCache.clear();
}

function isLocalRequest(c: Context<AppEnv>) {
  const host = new URL(c.req.url).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

/**
 * Confirms the logged-in user has `level` access to the repo, using the App's
 * installation token. Returns an error response when they do not.
 */
export async function checkAccess(c: Context<AppEnv>, repo: RepoRow, level: AccessLevel = 'push'): Promise<Response | null> {
  // Local development without a GitHub App. Never true on a deployed worker.
  if (c.env.DEV_LOCAL_TRUST === '1' && isLocalRequest(c)) return null;
  const full = `${repo.owner}/${repo.name}`;
  if (!repo.installation_id) {
    const url = installUrl(c.env.GITHUB_APP_SLUG);
    const install = url ? ` Install it: ${url}` : '';
    return c.json({ error: 'app_not_installed', message: `The Ownit GitHub App is not installed on ${full}.${install}` }, 403);
  }
  const login = c.get('login')!;
  const key = `${repo.installation_id}:${full}:${login}`.toLowerCase();
  const cached = permissionCache.get(key);
  let permission = cached && cached.until > Date.now() ? cached.permission : undefined;
  if (permission === undefined) {
    try {
      permission = await c.get('github').permission(repo.installation_id, repo.owner, repo.name, login);
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      log('permission.error', { repo: full, status: error.status });
      return c.json({ error: 'github_unavailable', message: 'Could not check your access with GitHub. Try again.' }, 503);
    }
    permissionCache.set(key, { permission, until: Date.now() + 5 * 60_000 });
  }
  if (ROLES[level].has(permission)) return null;
  log('permission.denied', { repo: full, level });
  return c.json({ error: 'forbidden', message: DENIED[level].replace('{repo}', full) }, 403);
}
