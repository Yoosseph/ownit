import type { PushStatus, RepoRow } from './db';
import { badgeImageUrl, repoPageUrl } from './links';
import type { RepoStats, Stats } from './stats';

export interface PagePush {
  id: number;
  status: PushStatus;
  head_sha: string;
  created_at: string;
  pusher: string | null;
  commits: number;
  /** 1 when the push is earlier work, credited by a later debrief. */
  earlier?: number;
  questions: { kind: string; text: string; passed: number; attempts: number; answer: string | null; disputed?: number }[];
}

/** Escapes text for HTML. Question text is model output about user code, so it is untrusted. */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// A copy hosted elsewhere shows these too, so a visitor can compare them with the address bar.
const SOURCE_URL = 'https://github.com/Yoosseph/ownit';
const OFFICIAL_HOST = 'ownit.ownit-worker.workers.dev';

const STATUS_LABEL: Record<PushStatus, string> = {
  verified: 'Verified',
  skipped: 'Skipped',
  pending: 'Pending',
  provider_error: 'Pending',
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const pct = (stats: Stats) => (stats.verifiedPct === null ? '—' : `${stats.verifiedPct}%`);

function meter(stats: Stats) {
  const v = stats.verifiedPct ?? 0;
  return `<div class="meter" role="img" aria-label="${stats.verifiedPct === null ? 'No data' : `${v}% verified`}"><span style="width:${v}%"></span></div>`;
}

/** What the page shows about debriefs: never code, questions unless hidden, answers only by choice. */
export interface Visibility {
  questions: boolean;
  answers: boolean;
  /** Why questions are hidden, shown above the push list. */
  note: string | null;
}

export function pageVisibility(repo: RepoRow): Visibility {
  if (repo.private) return { questions: false, answers: false, note: 'This repo is private, so debrief questions are hidden.' };
  if (!repo.show_questions) return { questions: false, answers: false, note: "This repo's admins keep debrief questions private." };
  return { questions: true, answers: Boolean(repo.show_answers), note: null };
}

// --- Sections ----------------------------------------------------------------

function headerSection(repo: RepoRow, badgeUrl: string): string {
  return `<header>
  <div>
    <h1>${esc(`${repo.owner}/${repo.name}`)}</h1>
    <p class="sub">Tracked since ${date(repo.tracked_since)}. ${repo.allow_backfill ? 'Earlier commits count once debriefed.' : "Earlier commits don't count."}</p>
  </div>
  <img src="${esc(badgeUrl)}" alt="Ownit badge" height="20">
</header>`;
}

function summarySection(o: Stats): string {
  const detail = o.total
    ? `${o.verified} of ${o.total} ${plural(o.total, 'commit')} verified · ${o.unverified} waiting for a debrief`
    : 'No commits tracked yet.';
  return `<section class="summary" aria-label="Overall">
  <div class="big">${pct(o)} <span>verified</span></div>
  ${meter(o)}
  <p class="sub">${detail}</p>
</section>`;
}

function authorRow({ author, stats }: RepoStats['authors'][number]): string {
  return `<tr><td>${esc(author)}</td><td class="num">${stats.total}</td><td class="num">${pct(stats)}</td><td class="bar">${meter(stats)}</td></tr>`;
}

/** Only worth a table when more than one person pushes. */
function authorsSection(authors: RepoStats['authors']): string {
  if (authors.length < 2) return '';
  return `<h2>By author</h2>
<div class="table-wrap"><table>
<thead><tr><th>Author</th><th class="num">Commits</th><th class="num">Verified</th><th></th></tr></thead>
<tbody>${authors.map(authorRow).join('')}</tbody>
</table></div>`;
}

function questionItem(q: PagePush['questions'][number], showAnswer: boolean): string {
  const passed = q.disputed
    ? ' <span class="tag" title="The developer stood by an answer the grader did not accept">✓ disputed</span>'
    : q.passed
      ? ` <span class="ok" title="Passed after ${q.attempts} ${plural(q.attempts, 'attempt')}">✓</span>`
      : '';
  const answer = showAnswer && q.answer ? `<p class="answer">${esc(q.answer)}</p>` : '';
  return `<li><span class="kind">${esc(q.kind)}</span> ${esc(q.text)}${passed}${answer}</li>`;
}

function pushItem(p: PagePush, repo: RepoRow, visible: Visibility): string {
  const commitUrl = `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commit/${p.head_sha}`;
  const meta = [`${p.commits} ${plural(p.commits, 'commit')}`, ...(p.pusher ? [esc(p.pusher)] : []), date(p.created_at)].join(' · ');
  const questions = visible.questions ? p.questions.map((q) => questionItem(q, visible.answers)).join('') : '';
  let body = '';
  if (questions) body = `<ul class="questions">${questions}</ul>`;
  else if (p.status !== 'verified') body = '<p class="note">Not debriefed yet.</p>';
  return `<li class="push">
  <div class="push-head"><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span>
  <a class="sha" href="${esc(commitUrl)}">${esc(p.head_sha.slice(0, 7))}</a>
  <span class="meta">${meta}</span>${p.earlier ? ' <span class="tag" title="Commits from before tracking, verified by a later debrief">earlier work</span>' : ''}</div>
  ${body}
</li>`;
}

function pushesSection(pushes: PagePush[], totalPushes: number, repo: RepoRow, visible: Visibility): string {
  const items = pushes.length
    ? pushes.map((p) => pushItem(p, repo, visible)).join('\n')
    : '<li class="empty">No pushes yet. Push to this repo with the Ownit hook installed.</li>';
  const more = totalPushes > pushes.length ? `<p class="sub">Showing the latest ${pushes.length} of ${totalPushes} pushes.</p>` : '';
  return `<h2>Recent pushes</h2>
${visible.note ? `<p class="sub notice">${visible.note}</p>` : ''}
<ul>${items}</ul>
${more}`;
}

function badgeSection(markdown: string): string {
  return `<h2>Badge</h2>
<p class="sub">Paste this into your README. It links back to this page.</p>
<div class="embed"><code id="badge-md">${esc(markdown)}</code><button type="button" class="copy" data-copy="badge-md">Copy</button></div>`;
}

function footer(visible: Visibility): string {
  const shown = visible.answers
    ? "No code is shown. Answers appear because this repo's admins chose to show them."
    : 'No code or answers are shown.';
  return `<footer>
  <p>Ownit asks developers a few questions about each push. A commit counts as verified once its push passes a debrief, and there is no deadline. ${shown} A learning tool, not proof of authorship.</p>
  <p><a href="${SOURCE_URL}">Ownit is open source on GitHub</a>. The official server is <strong>${OFFICIAL_HOST}</strong>; a badge that leads anywhere else comes from a copy.</p>
</footer>`;
}

// --- Page --------------------------------------------------------------------

const STYLES = `:root{--bg:#fbfaf7;--card:#fff;--ink:#1d1d1b;--muted:#6b6a65;--line:#e7e4dc;--accent:#2f7d4f;--warn:#b7791f;--skip:#8a8a85;--chip:#f1efe8}
@media (prefers-color-scheme:dark){:root{--bg:#0f1011;--card:#151718;--ink:#e8eaeb;--muted:#9fa4a7;--line:#2a2d30;--accent:#5cbf84;--warn:#e0a84a;--skip:#9b9fa2;--chip:#1e2122}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
h1{font-size:1.6rem;margin:0;word-break:break-word}
h2{font-size:1.05rem;margin:32px 0 12px}
.sub{color:var(--muted);margin:4px 0 0}
.summary{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-top:24px}
.summary .big{font-size:2rem;font-weight:650;font-variant-numeric:tabular-nums;margin-bottom:8px}
.summary .big span{font-size:1rem;font-weight:500;color:var(--muted)}
.summary .sub{font-size:.9rem;margin-top:8px}
.meter{height:8px;background:var(--chip);border-radius:99px;overflow:hidden;min-width:80px}
.meter span{display:block;height:100%;background:var(--accent)}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:.95rem}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{color:var(--muted);font-weight:500;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.num{text-align:right;font-variant-numeric:tabular-nums}
td.bar{width:35%}
ul{list-style:none;margin:0;padding:0}
.push{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:8px}
.push-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.meta{color:var(--muted);font-size:.9rem}
.sha{font:.82rem ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);text-decoration:none}
.sha:hover{color:var(--ink);text-decoration:underline}
.note{color:var(--muted);font-size:.9rem;margin:8px 0 0}
.notice{margin:-4px 0 12px}
.pill{font-size:.78rem;font-weight:600;padding:2px 10px;border-radius:99px;background:var(--chip)}
.pill.verified{color:var(--accent)}.pill.pending,.pill.provider_error{color:var(--warn)}.pill.skipped{color:var(--skip)}
.questions{margin-top:8px}
.questions li{padding:4px 0;color:var(--ink)}
.kind{display:inline-block;min-width:44px;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.answer{margin:4px 0 2px 44px;padding-left:10px;border-left:2px solid var(--line);color:var(--muted);font-size:.92rem;white-space:pre-wrap}
.ok{color:var(--accent)}
.tag{font-size:.75rem;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 8px}
.empty{color:var(--muted)}
.embed{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
code{background:var(--chip);border-radius:6px;padding:6px 8px;font-size:.8rem;word-break:break-all;display:block;flex:1;min-width:0}
footer{margin-top:40px;color:var(--muted);font-size:.85rem}
footer p{margin:0 0 10px}
.copy{font:inherit;font-size:.85rem;padding:6px 14px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.copy:hover{border-color:var(--accent)}
a{color:inherit}`;

/** Copies the badge Markdown; falls back to selecting it where the clipboard API is unavailable. */
const COPY_SCRIPT = `document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  const source = document.getElementById(button.dataset.copy);
  try {
    await navigator.clipboard.writeText(source.textContent);
    button.textContent = 'Copied';
  } catch {
    getSelection().selectAllChildren(source);
    button.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (button.textContent = 'Copy'), 2000);
}));`;

export function renderRepoPage(origin: string, repo: RepoRow, stats: RepoStats, pushes: PagePush[], totalPushes = pushes.length): string {
  const full = `${repo.owner}/${repo.name}`;
  const visible = pageVisibility(repo);
  const badgeUrl = badgeImageUrl(origin, repo);
  const markdown = `[![Ownit](${badgeUrl})](${repoPageUrl(origin, repo)})`;
  const sections = [
    headerSection(repo, badgeUrl),
    summarySection(stats.overall),
    authorsSection(stats.authors),
    pushesSection(pushes, totalPushes, repo, visible),
    badgeSection(markdown),
    footer(visible),
  ].filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)} · Ownit</title>
<meta name="description" content="How much of ${esc(full)} its developers have debriefed with Ownit.">
<style>
${STYLES}
</style>
</head>
<body>
<main>
${sections.join('\n\n')}
</main>
<script>
${COPY_SCRIPT}
</script>
</body>
</html>`;
}
