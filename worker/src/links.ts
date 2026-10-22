// Every public URL the worker hands out, built in one place.

export const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

interface RepoName {
  owner: string;
  name: string;
}

const repoPath = (repo: RepoName) => `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** The repo's public stats page. */
export function repoPageUrl(origin: string, repo: RepoName): string {
  return `${withoutTrailingSlash(origin)}/${repoPath(repo)}`;
}

/** The repo's README badge image. */
export function badgeImageUrl(origin: string, repo: RepoName): string {
  return `${withoutTrailingSlash(origin)}/badge/${repoPath(repo)}.svg`;
}

/** Where to install the Ownit GitHub App, or null when the server has no App configured. */
export function installUrl(appSlug: string | undefined): string | null {
  return appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null;
}
