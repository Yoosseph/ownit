import { describe, expect, it } from 'vitest';
import { badgeColor, badgeMessage, badgeSvg } from '../src/badge';
import { expirePending } from '../src/cron';
import { esc } from '../src/page';
import { computeStats } from '../src/stats';
import { call, FakeGitHub, sha, testEnv, type TestEnv } from './helpers/env';

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

/** alice: 6 verified + 2 skipped; bob: 1 verified + 1 skipped; plus pushes that must not count. */
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
  it('is commit-weighted over verified and skipped pushes', () => {
    expect(
      computeStats([
        { status: 'verified', commits: 7 },
        { status: 'skipped', commits: 3 },
        { status: 'pending', commits: 3 },
        { status: 'provider_error', commits: 1 },
      ]),
    ).toEqual({ counted: 10, verified: 7, skipped: 3, waiting: 4, verifiedPct: 70, skippedPct: 30 });
  });

  it('has no percentage before anything counts', () => {
    expect(computeStats([{ status: 'pending', commits: 2 }])).toMatchObject({ counted: 0, verifiedPct: null, skippedPct: null });
  });

  it('rounds, and the two percentages always add up to 100', () => {
    const s = computeStats([
      { status: 'verified', commits: 2 },
      { status: 'skipped', commits: 1 },
    ]);
    expect([s.verifiedPct, s.skippedPct]).toEqual([67, 33]);
  });
});

describe('cron', () => {
  it('flips pending pushes older than 24 hours to skipped and updates their check runs', async () => {
    const env = testEnv();
    const old = seedPush(env, { status: 'pending', author: 'a', n: 1, createdAgo: 25 * HOUR });
    const fresh = seedPush(env, { status: 'pending', author: 'a', n: 1, createdAgo: 23 * HOUR });
    const broken = seedPush(env, { status: 'provider_error', author: 'a', n: 1, createdAgo: 48 * HOUR });
    env.DB.raw.prepare('UPDATE pushes SET check_run_id = 1 WHERE id = ?').run(old);
    const github = new FakeGitHub();
    github.checkRuns.push({ id: 1, repo: 'octo/shop', name: 'Ownit', status: 'in_progress', output: { title: 'Ownit: pending', summary: '' } });

    expect(await expirePending(env, github)).toEqual([old]);
    const statuses = env.DB.raw.prepare('SELECT id, status, resolved_at IS NOT NULL AS resolved FROM pushes ORDER BY id').all();
    expect(statuses).toEqual([
      { id: old, status: 'skipped', resolved: 1 },
      { id: fresh, status: 'pending', resolved: 0 },
      { id: broken, status: 'provider_error', resolved: 0 },
    ]);
    expect(github.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'neutral', output: { title: 'Ownit: skipped' } });
    expect(await expirePending(env, github)).toEqual([]);
  });
});

describe('badge', () => {
  it('shows the verified percentage of a seeded repo', async () => {
    const res = await call(seededRepo(), 'GET', '/badge/octo/shop.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.text).toContain('ownit: 70% verified');
    expect(res.text).toContain(badgeColor(70));
  });

  it('handles empty and unknown repos', async () => {
    expect((await call(testEnv(), 'GET', '/badge/octo/shop.svg')).text).toContain('no pushes yet');
    expect((await call(testEnv(), 'GET', '/badge/octo/nope.svg')).text).toContain('not tracked');
  });

  it('colors by percentage and escapes text', () => {
    expect([100, 90, 75, 60, 40, 20, 0, null].map(badgeColor)).toEqual(['#4c1', '#4c1', '#97ca00', '#a4a61d', '#dfb317', '#fe7d37', '#e05d44', '#9f9f9f']);
    expect(badgeSvg('a<b', 'c&d', '#000')).not.toMatch(/a<b|c&d/);
    expect(badgeMessage(null, true)).toBe('no pushes yet');
  });
});

describe('public page', () => {
  it('shows correct overall and per-author percentages for a seeded repo', async () => {
    const res = await call(seededRepo(), 'GET', '/octo/shop');
    expect(res.status).toBe(200);
    const text = res.text.replace(/\s+/g, ' ');
    expect(text).toContain('<div class="big">70%</div><div class="label">of commits verified</div>');
    expect(text).toContain('<div class="big">30%</div><div class="label">of commits skipped</div>');
    expect(text).toContain('<div class="big">10</div><div class="label">commits counted</div>');
    expect(text).toContain('<div class="big">4</div><div class="label">waiting for a debrief</div>');
    expect(text).toContain('<tr><td>alice</td><td class="num">8</td><td class="num">75%</td><td class="num">25%</td>');
    expect(text).toContain('<tr><td>bob</td><td class="num">2</td><td class="num">50%</td><td class="num">50%</td>');
    expect(text).not.toContain('carol');
    expect(text).toContain('Tracked by Ownit since Oct 1, 2026');
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
    expect(res.text).toContain('question text is hidden');
  });

  it('404s for untracked repos and leaves API routes alone', async () => {
    expect((await call(testEnv(), 'GET', '/octo/nope')).status).toBe(404);
    expect((await call(testEnv(), 'GET', '/healthz')).json).toEqual({ ok: true });
  });

  it('escapes HTML', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
