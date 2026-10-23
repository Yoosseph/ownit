import { createApi } from '../api.js';
import { githubRepo } from '../git.js';
import { paint } from '../ui.js';

interface PageSettings {
  repo: string;
  private: boolean;
  show_questions: boolean;
  show_answers: boolean;
  page_url: string;
}

const USAGE = 'Usage: ownit page [questions|answers] [on|off]\n';

const SETTING = { questions: 'show_questions', answers: 'show_answers' } as const;

function describe(s: PageSettings): string {
  if (s.private) return 'Questions and answers: hidden (private repo)';
  return `Questions: ${s.show_questions ? 'shown' : 'hidden'}\nAnswers:   ${s.show_answers ? 'shown' : 'hidden'}`;
}

/**
 * `ownit page`: shows what this repo's public page shows.
 * `ownit page questions|answers on|off` changes it (repo admins and maintainers).
 */
export async function pageCommand(args: string[]): Promise<number> {
  const out = process.stderr;
  const [what, value, ...rest] = args;
  const change = what !== undefined;
  if (change && (!Object.hasOwn(SETTING, what) || (value !== 'on' && value !== 'off') || rest.length)) {
    out.write(USAGE);
    return 1;
  }
  const repo = githubRepo();
  if (!repo) {
    out.write('Ownit: no GitHub remote found. Run this in a repo set up with "ownit init".\n');
    return 1;
  }
  const api = createApi();
  const settings = change
    ? await api.request<PageSettings>('PUT', '/api/repos/settings', { repo, [SETTING[what as keyof typeof SETTING]]: value === 'on' })
    : await api.request<PageSettings>('GET', `/api/repos/settings?repo=${encodeURIComponent(repo)}`);

  const c = paint(out);
  out.write(`${c.bold(settings.page_url)}\n${describe(settings)}\n`);
  if (change && what === 'answers' && value === 'on') {
    out.write(c.dim('From now on, passing answers are saved and shown. Developers see a note before they answer.\n'));
  } else if (change && !settings.show_answers) {
    out.write(c.dim('Saved answers, if any, are deleted.\n'));
  } else if (!change && !settings.private) {
    out.write(c.dim('Change with "ownit page questions on|off" or "ownit page answers on|off" (admins and maintainers).\n'));
  }
  return 0;
}
