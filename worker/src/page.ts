import type { PushStatus, RepoRow } from './db';
import { badgeImageUrl, repoPageUrl } from './links';
import type { RepoStats, Stats } from './stats';

export interface PagePush {
  id: number;
  status: PushStatus;
  created_at: string;
  pusher: string | null;
  commits: number;
  questions: { kind: string; text: string; passed: number; attempts: number }[];
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
  provider_error: 'Pending (provider error)',
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

function pct(stats: Stats, key: 'verifiedPct' | 'unverifiedPct') {
  return stats[key] === null ? '—' : `${stats[key]}%`;
}

function meter(stats: Stats) {
  const v = stats.verifiedPct ?? 0;
  return `<div class="meter" role="img" aria-label="${stats.verifiedPct === null ? 'No data' : `${v}% verified`}"><span style="width:${v}%"></span></div>`;
}

// --- Sections ----------------------------------------------------------------

function headerSection(repo: RepoRow, badgeUrl: string): string {
  return `<header>
  <div>
    <h1>${esc(`${repo.owner}/${repo.name}`)}</h1>
    <p class="sub">Tracked by Ownit since ${date(repo.tracked_since)}. Earlier history does not count.</p>
  </div>
  <img src="${esc(badgeUrl)}" alt="Ownit badge" height="20">
</header>`;
}

function cardsSection(o: Stats): string {
  return `<section class="cards" aria-label="Overall">
  <div class="card"><div class="big">${pct(o, 'verifiedPct')}</div><div class="label">of commits verified</div></div>
  <div class="card"><div class="big">${pct(o, 'unverifiedPct')}</div><div class="label">of commits unverified</div></div>
  <div class="card"><div class="big">${o.total}</div><div class="label">${plural(o.total, 'commit')} tracked</div></div>
  <div class="card"><div class="big">${o.unverified}</div><div class="label">waiting for a debrief</div></div>
</section>`;
}

function authorRow({ author, stats }: RepoStats['authors'][number]): string {
  return `<tr><td>${esc(author)}</td><td class="num">${stats.total}</td><td class="num">${pct(stats, 'verifiedPct')}</td><td class="num">${pct(stats, 'unverifiedPct')}</td><td class="bar">${meter(stats)}</td></tr>`;
}

function authorsSection(authors: RepoStats['authors']): string {
  const rows = authors.length ? authors.map(authorRow).join('') : '<tr><td colspan="5" class="empty">No commits tracked yet.</td></tr>';
  return `<h2>By author</h2>
<div class="table-wrap"><table>
<thead><tr><th>Author</th><th class="num">Commits</th><th class="num">Verified</th><th class="num">Unverified</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;
}

function questionItem(q: PagePush['questions'][number]): string {
  const passed = q.passed ? ` <span class="ok" title="Passed after ${q.attempts} ${plural(q.attempts, 'attempt')}">✓</span>` : '';
  return `<li><span class="kind">${esc(q.kind)}</span> ${esc(q.text)}${passed}</li>`;
}

function pushItem(p: PagePush, hideQuestions: boolean): string {
  const questions = hideQuestions ? '' : p.questions.map(questionItem).join('');
  return `<li class="push">
  <div class="push-head"><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span>
  <span class="meta">${date(p.created_at)} · ${p.commits} ${plural(p.commits, 'commit')}${p.pusher ? ` · ${esc(p.pusher)}` : ''}</span></div>
  ${questions ? `<ul class="questions">${questions}</ul>` : ''}
</li>`;
}

/** Question text is hidden for private repos; stats and statuses still show. */
function pushesSection(pushes: PagePush[], hideQuestions: boolean): string {
  const items = pushes.length
    ? pushes.map((p) => pushItem(p, hideQuestions)).join('\n')
    : '<li class="empty">No pushes yet. Push to this repo with the Ownit hook installed.</li>';
  return `<h2>Recent pushes</h2>
${hideQuestions ? '<p class="sub">This repo is private, so question text is hidden.</p>' : ''}
<ul>${items}</ul>`;
}

function badgeSection(markdown: string): string {
  return `<h2>Badge</h2>
<p class="sub">Paste this into your README. The badge links back to this page.</p>
<div class="embed"><code id="badge-md">${esc(markdown)}</code><button type="button" class="copy" data-copy="badge-md">Copy</button></div>`;
}

const FOOTER = `<footer>
  Ownit asks developers a few questions about each push: why, how, and what's next. It shows no code and no answers.
  A commit is verified once its push passes a debrief. Until then it is unverified, with no deadline: debriefing it later still counts.
  A learning tool, not proof of authorship.
  <p class="source"><a href="${SOURCE_URL}">Ownit is open source on GitHub</a>. The official server is <strong>${OFFICIAL_HOST}</strong>; a badge that leads anywhere else comes from a copy.</p>
</footer>`;

// --- Page --------------------------------------------------------------------

const STYLES = `:root{--bg:#fbfaf7;--card:#fff;--ink:#1d1d1b;--muted:#6b6a65;--line:#e7e4dc;--accent:#2f7d4f;--warn:#b7791f;--skip:#8a8a85;--chip:#f1efe8}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1d1d1b;--ink:#ecebe6;--muted:#a3a29b;--line:#33322f;--accent:#5cbf84;--warn:#e0a84a;--skip:#9b9a94;--chip:#2a2927}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
h1{font-size:1.6rem;margin:0;word-break:break-word}
h2{font-size:1.05rem;margin:32px 0 12px}
.sub{color:var(--muted);margin:4px 0 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.card .big{font-size:1.8rem;font-weight:650;font-variant-numeric:tabular-nums}
.card .label{color:var(--muted);font-size:.85rem}
.meter{height:8px;background:var(--chip);border-radius:99px;overflow:hidden;min-width:80px}
.meter span{display:block;height:100%;background:var(--accent)}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:.95rem}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{color:var(--muted);font-weight:500;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.num{text-align:right;font-variant-numeric:tabular-nums}
td.bar{width:30%}
ul{list-style:none;margin:0;padding:0}
.push{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.push-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.meta{color:var(--muted);font-size:.9rem}
.pill{font-size:.78rem;font-weight:600;padding:2px 10px;border-radius:99px;background:var(--chip)}
.pill.verified{color:var(--accent)}.pill.pending,.pill.provider_error{color:var(--warn)}.pill.skipped{color:var(--skip)}
.questions{margin-top:10px}
.questions li{padding:4px 0;color:var(--ink)}
.kind{display:inline-block;min-width:44px;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.ok{color:var(--accent)}
.empty{color:var(--muted)}
.embed{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
code{background:var(--chip);border-radius:6px;padding:6px 8px;font-size:.8rem;word-break:break-all;display:block;flex:1;min-width:0}
footer{margin-top:40px;color:var(--muted);font-size:.85rem}
.source{margin-top:12px}
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

export function renderRepoPage(origin: string, repo: RepoRow, stats: RepoStats, pushes: PagePush[]): string {
  const full = `${repo.owner}/${repo.name}`;
  const badgeUrl = badgeImageUrl(origin, repo);
  const markdown = `[![Ownit](${badgeUrl})](${repoPageUrl(origin, repo)})`;
  const sections = [
    headerSection(repo, badgeUrl),
    cardsSection(stats.overall),
    authorsSection(stats.authors),
    pushesSection(pushes, Boolean(repo.private)),
    badgeSection(markdown),
    FOOTER,
  ];
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
