import { createApi } from '../api.js';
import { githubRepo } from '../git.js';
import { paint } from '../ui.js';

interface RepoSettings {
  repo: string;
  private: boolean;
  show_questions: boolean;
  show_answers: boolean;
  allow_backfill: boolean;
  page_url: string;
}

const USAGE = 'Usage: ownit settings [questions|answers|earlier] [on|off]\n';

/** The setting each name changes on the server. */
const SETTING = { questions: 'show_questions', answers: 'show_answers', earlier: 'allow_backfill' } as const;
type SettingName = keyof typeof SETTING;

function describe(s: RepoSettings): string {
  const page = s.private
    ? 'Questions and answers: hidden (private repo)'
    : `Questions:       ${s.show_questions ? 'shown' : 'hidden'}\nAnswers:         ${s.show_answers ? 'shown' : 'hidden'}`;
  return `${page}\nEarlier commits: ${s.allow_backfill ? 'count once debriefed' : 'not counted'}`;
}

/** A line about what just changed, or how to change things. */
function note(s: RepoSettings, changed: SettingName | undefined, on: boolean): string {
  if (changed === 'answers' && on) return 'From now on, passing answers are saved and shown. Developers see a note before they answer.';
  if (changed === 'earlier' && on) return 'Debrief older commits with "ownit interview --range A..B" (or a single commit SHA). They count once verified, never as unverified.';
  if (changed === 'earlier') return 'New debriefs of older commits no longer count. Ones already verified stay.';
  if (changed && !s.show_answers) return 'Saved answers, if any, are deleted.';
  if (changed) return '';
  return 'Change with "ownit settings questions|answers|earlier on|off" (repo admins and maintainers).';
}

/**
 * `ownit settings`: shows this repo's Ownit settings and page link.
 * `ownit settings questions|answers|earlier on|off` changes one (admins and maintainers).
 */
export async function settingsCommand(args: string[]): Promise<number> {
  const out = process.stderr;
  const [what, value, ...rest] = args;
  const changed = what as SettingName | undefined;
  if (changed !== undefined && (!Object.hasOwn(SETTING, changed) || (value !== 'on' && value !== 'off') || rest.length)) {
    out.write(USAGE);
    return 1;
  }
  const repo = githubRepo();
  if (!repo) {
    out.write('Ownit: no GitHub remote found. Run this in a repo set up with "ownit init".\n');
    return 1;
  }
  const api = createApi();
  const settings = changed
    ? await api.request<RepoSettings>('PUT', '/api/repos/settings', { repo, [SETTING[changed]]: value === 'on' })
    : await api.request<RepoSettings>('GET', `/api/repos/settings?repo=${encodeURIComponent(repo)}`);

  const c = paint(out);
  out.write(`${c.bold(settings.page_url)}\n${describe(settings)}\n`);
  const line = note(settings, changed, value === 'on');
  if (line) out.write(`${c.dim(line)}\n`);
  return 0;
}
