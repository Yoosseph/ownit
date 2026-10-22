// Who may record debriefs for a repo: users with push access, checked with the
// GitHub App's installation token.
import type { Context } from 'hono';
import type { AppEnv } from './app';
import type { RepoRow } from './db';
import { GitHubError } from './github';
import { installUrl } from './links';
import { log } from './log';

const PUSH_ACCESS = new Set(['admin', 'maintain', 'write']);

// Permission answers are cached briefly per isolate to keep debriefs snappy.
// A user whose access is revoked keeps it for at most five minutes.
const permissionCache = new Map<string, { ok: boolean; until: number }>();

export function clearPermissionCache() {
  permissionCache.clear();
}

function isLocalRequest(c: Context<AppEnv>) {
  const host = new URL(c.req.url).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

/**
 * Confirms the logged-in user can push to the repo, using the App's
 * installation token. Returns an error response when they cannot.
 */
export async function checkPushAccess(c: Context<AppEnv>, repo: RepoRow): Promise<Response | null> {
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
  let ok = cached && cached.until > Date.now() ? cached.ok : undefined;
  if (ok === undefined) {
    try {
      ok = PUSH_ACCESS.has(await c.get('github').permission(repo.installation_id, repo.owner, repo.name, login));
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      log('permission.error', { repo: full, status: error.status });
      return c.json({ error: 'github_unavailable', message: 'Could not check your access with GitHub. Try again.' }, 503);
    }
    permissionCache.set(key, { ok, until: Date.now() + 5 * 60_000 });
  }
  if (ok) return null;
  log('permission.denied', { repo: full });
  return c.json({ error: 'forbidden', message: `You need push access to ${full} to record debriefs for it.` }, 403);
}
