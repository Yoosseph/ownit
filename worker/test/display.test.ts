import { describe, expect, it } from 'vitest';
import { badgeColor, badgeSvg, repoBadge } from '../src/badge';
import { esc } from '../src/page';
import { computeStats } from '../src/stats';
import { call, sha, testEnv, type TestEnv } from './helpers/env';

const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let shaCounter = 100;
/** Inserts a push with `n` commits by `author`. Landed commits have pushed_at set. */
function seedPush(env: TestEnv, opts: { status: string; author: string; n: number; createdAgo?: number; landed?: boolean; landedAt?: string; questions?: [string, string, number][] }) {
  const db = env.DB.raw;
  const created = iso(opts.createdAgo ?? HOUR);
  const push = db
    .prepare("INSERT INTO pushes (repo_id, user_github_id, head_sha, status, created_at) VALUES (1, NULL, ?, ?, ?) RETURNING id")
    .get(sha(shaCounter + opts.n), opts.status, created) as { id: number };
  for (let i = 0; i < opts.n; i++) {
    db.prepare('INSERT INTO commits (sha, repo_id, push_id, author_login, pushed_at) VALUES (?, 1, ?, ?, ?)').run(
      sha(++shaCounter),
      push.id,
      opts.author,
      opts.landed === false ? null : (opts.landedAt ?? created),
    );
  }
  (opts.questions ?? []).forEach(([kind, text, passed], idx) =>
    db.prepare('INSERT INTO questions (push_id, idx, kind, text, passed, attempts) VALUES (?, ?, ?, ?, ?, 1)').run(push.id, idx, kind, text, passed),
  );
  return push.id;
}

/** alice: 6 of 9 commits verified; bob: 1 of 5; plus commits that must not count (not landed, or before tracking). */
function seededRepo() {
  const env = testEnv();
  seedPush(env, { status: 'verified', author: 'alice', n: 4, questions: [['why', 'Why add <script>alert(1)</script> retries?', 1]] });
  seedPush(env, { status: 'verified', author: 'alice', n: 2 });
  seedPush(env, { status: 'skipped', author: 'alice', n: 2 });
  seedPush(env, { status: 'verified', author: 'bob', n: 1 });
  seedPush(env, { status: 'skipped', author: 'bob', n: 1 });
  seedPush(env, { status: 'pending', author: 'bob', n: 3 });
  seedPush(env, { status: 'provider_error', author: 'alice', n: 1 });
  seedPush(env, { status: 'verified', author: 'alice', n: 5, landed: false });
  seedPush(env, { status: 'verified', author: 'carol', n: 2, landedAt: '2026-09-01T00:00:00.000Z' });
  return env;
}

describe('stats math', () => {
  it('counts every commit that is not verified as unverified', () => {
    expect(
      computeStats([
        { status: 'verified', commits: 7 },
        { status: 'skipped', commits: 3 },
        { status: 'pending', commits: 3 },
        { status: 'provider_error', commits: 1 },
      ]),
    ).toEqual({ total: 14, verified: 7, unverified: 7, verifiedPct: 50, unverifiedPct: 50 });
  });

  it('has no percentage before there are commits', () => {
    expect(computeStats([])).toMatchObject({ total: 0, verifiedPct: null, unverifiedPct: null });
    expect(computeStats([{ status: 'pending', commits: 2 }])).toMatchObject({ total: 2, verifiedPct: 0, unverifiedPct: 100 });
  });

  it('rounds, and the two percentages always add up to 100', () => {
    const s = computeStats([
      { status: 'verified', commits: 2 },
      { status: 'skipped', commits: 1 },
    ]);
    expect([s.verifiedPct, s.unverifiedPct]).toEqual([67, 33]);
  });
});

describe('badge', () => {
  it('shows the verified and unverified shares of a seeded repo', async () => {
    const res = await call(seededRepo(), 'GET', '/badge/octo/shop.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.text).toContain('<title>Ownit: Verified 50% | Unverified 50%</title>');
    expect(res.text).toContain(badgeColor(50));
  });

  it('handles empty and unknown repos', async () => {
    expect((await call(testEnv(), 'GET', '/badge/octo/shop.svg')).text).toContain('<title>Ownit: no pushes yet</title>');
    expect((await call(testEnv(), 'GET', '/badge/octo/nope.svg')).text).toContain('<title>Ownit: not tracked</title>');
  });

  it('colors by percentage, lays segments side by side, and escapes text', () => {
    expect([100, 90, 75, 60, 40, 20, 0, null].map(badgeColor)).toEqual(['#4c1', '#4c1', '#97ca00', '#a4a61d', '#dfb317', '#fe7d37', '#e05d44', '#9f9f9f']);
    const svg = badgeSvg([{ text: 'a<b', color: '#000' }, { text: 'c&d', color: '#111' }, { text: 'e', color: '#222' }]);
    expect(svg).not.toMatch(/a<b|c&d/);
    expect(svg.match(/<rect x=/g)).toHaveLength(3);
    expect(repoBadge({ total: 4, verified: 1, unverified: 3, verifiedPct: 25, unverifiedPct: 75 }).map((s) => s.text)).toEqual(['Ownit', 'Verified 25%', 'Unverified 75%']);
  });
});

describe('public page', () => {
  it('shows correct overall and per-author percentages for a seeded repo', async () => {
    const res = await call(seededRepo(), 'GET', '/octo/shop');
    expect(res.status).toBe(200);
    const text = res.text.replace(/\s+/g, ' ');
    expect(text).toContain('<div class="big">50% <span>verified</span></div>');
    expect(text).toContain('7 of 14 commits verified · 7 waiting for a debrief');
    expect(text).toContain('<tr><td>alice</td><td class="num">9</td><td class="num">67%</td>');
    expect(text).toContain('<tr><td>bob</td><td class="num">5</td><td class="num">20%</td>');
    expect(text).not.toContain('carol');
    expect(text).toContain('Tracked since Oct 1, 2026');
    expect(text).toContain('href="https://github.com/Yoosseph/ownit"');
    expect(text).toContain('The official server is <strong>ownit.ownit-worker.workers.dev</strong>');
  });

  it('escapes question text and shows no code or answers', async () => {
    const res = await call(seededRepo(), 'GET', '/octo/shop');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('Why add &lt;script&gt;alert(1)&lt;/script&gt; retries?');
    expect(res.text).not.toContain('diff --git');
  });

  it('offers the badge Markdown with a copy button', async () => {
    const res = await call(seededRepo(), 'GET', '/octo/shop');
    expect(res.text).toContain('<code id="badge-md">[![Ownit](');
    expect(res.text).toContain('/badge/octo/shop.svg)](');
    expect(res.text).toContain('data-copy="badge-md">Copy</button>');
  });

  it('hides question text for private repos', async () => {
    const env = seededRepo();
    env.DB.raw.prepare('UPDATE repos SET private = 1').run();
    const res = await call(env, 'GET', '/octo/shop');
    expect(res.text).not.toContain('retries?');
    expect(res.text).toContain('This repo is private, so debrief questions are hidden.');
  });

  it('hides questions when the admins turned them off, and never shows answers unless turned on', async () => {
    const env = seededRepo();
    env.DB.raw.prepare("UPDATE questions SET answer = 'Retries <b>help</b> flaky calls.'").run();
    const shown = await call(env, 'GET', '/octo/shop');
    expect(shown.text).toContain('retries?');
    expect(shown.text).not.toContain('flaky calls');
    expect(shown.text).toContain('No code or answers are shown.');

    env.DB.raw.prepare('UPDATE repos SET show_answers = 1').run();
    const answers = await call(env, 'GET', '/octo/shop');
    expect(answers.text).toContain('<p class="answer">Retries &lt;b&gt;help&lt;/b&gt; flaky calls.</p>');
    expect(answers.text).toContain("Answers appear because this repo's admins chose to show them.");

    env.DB.raw.prepare('UPDATE repos SET show_questions = 0').run();
    const hidden = await call(env, 'GET', '/octo/shop');
    expect(hidden.text).not.toContain('retries?');
    expect(hidden.text).not.toContain('flaky calls');
    expect(hidden.text).toContain("This repo's admins keep debrief questions private.");
  });

  it('links each push to its commit and marks pushes nobody debriefed', async () => {
    const env = testEnv();
    seedPush(env, { status: 'pending', author: 'alice', n: 1 });
    const text = (await call(env, 'GET', '/octo/shop')).text;
    expect(text).toMatch(/<a class="sha" href="https:\/\/github.com\/octo\/shop\/commit\/[0-9a-f]{40}">[0-9a-f]{7}<\/a>/);
    expect(text).toContain('Not debriefed yet.');
    expect(text).not.toContain('By author');
  });

  it('names each author who still owes a debrief, most waiting first', async () => {
    const text = (await call(seededRepo(), 'GET', '/octo/shop')).text.replace(/\s+/g, ' ');
    expect(text).toContain('Waiting on a debrief');
    const bob = text.indexOf('<strong>bob</strong> <span class="meta">4 commits not debriefed yet</span>');
    const alice = text.indexOf('<strong>alice</strong> <span class="meta">3 commits not debriefed yet</span>');
    expect(bob).toBeGreaterThan(-1);
    expect(alice).toBeGreaterThan(bob);
  });

  it('leaves out the waiting list when everything is debriefed', async () => {
    const env = testEnv();
    seedPush(env, { status: 'verified', author: 'alice', n: 2 });
    expect((await call(env, 'GET', '/octo/shop')).text).not.toContain('Waiting on a debrief');
  });

  it('says when older pushes are left out', async () => {
    const env = testEnv();
    for (let i = 0; i < 31; i++) seedPush(env, { status: 'verified', author: 'alice', n: 1, createdAgo: HOUR + i });
    expect((await call(env, 'GET', '/octo/shop')).text).toContain('Showing the latest 30 of 31 pushes.');
  });

  it('404s for untracked repos and leaves API routes alone', async () => {
    expect((await call(testEnv(), 'GET', '/octo/nope')).status).toBe(404);
    expect((await call(testEnv(), 'GET', '/healthz')).json).toEqual({ ok: true });
  });

  it('escapes HTML', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('GET /models', () => {
  it('says which model each provider runs, without a login', async () => {
    const env = testEnv();
    const res = await call({ ...env, token: '' } as TestEnv, 'GET', '/models');
    expect(res.status).toBe(200);
    expect(res.json.providers).toEqual([
      { id: 'nebius', name: 'Nebius', model: env.NEBIUS_MODEL },
      { id: 'nvidia', name: 'NVIDIA', model: env.NVIDIA_MODEL },
    ]);
  });
});
