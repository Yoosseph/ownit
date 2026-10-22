import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { syncCheckRun } from '../checks';
import {
  createPush,
  findKnownCommits,
  getRepo,
  insertLandedCommits,
  markCommitsLanded,
  nowIso,
  setRepoInstallation,
  upsertUser,
  type LandedCommit,
  type RepoRow,
} from '../db';
import { log } from '../log';

const ZERO = /^0+$/;

/** Constant-time check of X-Hub-Signature-256 against the raw body. */
export async function verifySignature(secret: string, body: string, header: string | undefined): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

interface PushEvent {
  ref: string;
  before: string;
  after: string;
  deleted?: boolean;
  repository: { name: string; owner: { login?: string; name?: string }; private: boolean };
  installation?: { id: number };
  sender?: { id: number; login: string };
  commits?: { id: string; author?: { username?: string; name?: string } }[];
}

interface Landing {
  /** Every push whose commits this event touched. */
  touched: Set<number>;
  commits: number;
  /** Commits Ownit had not seen; they became a new pending push. */
  unmatched: number;
}

/**
 * Records which commits of a push event landed on GitHub. Known commits now
 * count; commits nobody debriefed (no hook, --no-verify, web edits, GUI
 * clients) become a new pending push.
 */
async function recordLanding(db: D1Database, repo: RepoRow, event: PushEvent): Promise<Landing> {
  const now = nowIso();
  const commits: LandedCommit[] = (event.commits ?? []).map((commit) => ({
    sha: commit.id,
    author: commit.author?.username ?? commit.author?.name ?? null,
  }));
  const touched = new Set<number>();

  // One statement each, whatever the commit count (D1 free plan: 50 queries per request).
  const known = await findKnownCommits(db, repo.id, commits);
  if (known.length) {
    await markCommitsLanded(db, repo.id, commits, now);
    for (const row of known) touched.add(row.push_id);
  }

  const knownShas = new Set(known.map((k) => k.sha));
  const unmatched = commits.filter((commit) => !knownShas.has(commit.sha));
  if (unmatched.length) {
    const head = unmatched.some((u) => u.sha === event.after) ? event.after : unmatched.at(-1)!.sha;
    const push = await createPush(db, {
      repoId: repo.id,
      userId: event.sender?.id ?? null,
      baseSha: ZERO.test(event.before) ? null : event.before,
      headSha: head,
      status: 'pending',
    });
    await insertLandedCommits(db, repo.id, push.id, unmatched, now);
    touched.add(push.id);
  }
  return { touched, commits: commits.length, unmatched: unmatched.length };
}

export const webhook = new Hono<AppEnv>();

webhook.post('/github', async (c) => {
  const raw = await c.req.text();
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !(await verifySignature(secret, raw, c.req.header('x-hub-signature-256')))) {
    log('webhook.rejected', { reason: 'bad_signature' });
    return c.json({ error: 'bad_signature' }, 401);
  }
  const event = c.req.header('x-github-event');
  if (event === 'ping') return c.json({ ok: true });
  if (event !== 'push') return c.json({ ignored: event ?? 'unknown' });

  const payload = JSON.parse(raw) as PushEvent;
  const owner = payload.repository.owner.login ?? payload.repository.owner.name ?? '';
  const repo = await getRepo(c.env.DB, owner, payload.repository.name);
  if (!repo) return c.json({ ignored: 'repo not registered' });
  if (payload.deleted || ZERO.test(payload.after)) return c.json({ ignored: 'branch deleted' });

  const db = c.env.DB;
  await setRepoInstallation(db, repo.id, payload.installation?.id ?? repo.installation_id, payload.repository.private);
  if (payload.sender) await upsertUser(db, payload.sender.id, payload.sender.login);
  const landing = await recordLanding(db, repo, payload);

  const github = c.get('github');
  for (const pushId of landing.touched) await syncCheckRun(c.env, github, pushId);
  log('webhook.push', { repo: `${repo.owner}/${repo.name}`, commits: landing.commits, unmatched: landing.unmatched });
  return c.json({ ok: true, pushes: [...landing.touched] });
});
