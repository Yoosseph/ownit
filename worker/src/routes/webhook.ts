import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { syncCheckRun } from '../checks';
import { createPush, getRepo, nowIso, upsertUser } from '../db';
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
  const installationId = payload.installation?.id ?? repo.installation_id;
  await db.prepare('UPDATE repos SET installation_id = ?, private = ? WHERE id = ?')
    .bind(installationId, payload.repository.private ? 1 : 0, repo.id)
    .run();
  if (payload.sender) await upsertUser(db, payload.sender.id, payload.sender.login);

  const now = nowIso();
  const commits = payload.commits ?? [];
  const unmatched: { sha: string; author: string | null }[] = [];
  const touched = new Set<number>();
  for (const commit of commits) {
    const author = commit.author?.username ?? commit.author?.name ?? null;
    const row = await db.prepare('SELECT push_id FROM commits WHERE repo_id = ? AND sha = ?').bind(repo.id, commit.id).first<{ push_id: number }>();
    if (!row) {
      unmatched.push({ sha: commit.id, author });
      continue;
    }
    await db.prepare('UPDATE commits SET pushed_at = COALESCE(pushed_at, ?), author_login = COALESCE(?, author_login) WHERE repo_id = ? AND sha = ?')
      .bind(now, author, repo.id, commit.id)
      .run();
    touched.add(row.push_id);
  }

  // Commits nobody debriefed (no hook, --no-verify, web edits, GUI clients) become a pending push.
  if (unmatched.length) {
    const head = unmatched.some((u) => u.sha === payload.after) ? payload.after : unmatched.at(-1)!.sha;
    const push = await createPush(db, {
      repoId: repo.id,
      userId: payload.sender?.id ?? null,
      baseSha: ZERO.test(payload.before) ? null : payload.before,
      headSha: head,
      status: 'pending',
    });
    await db.batch(
      unmatched.map((u) =>
        db.prepare('INSERT INTO commits (sha, repo_id, push_id, author_login, pushed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
          .bind(u.sha, repo.id, push.id, u.author, now),
      ),
    );
    touched.add(push.id);
  }

  const github = c.get('github');
  for (const pushId of touched) await syncCheckRun(c.env, github, pushId);
  log('webhook.push', { repo: `${repo.owner}/${repo.name}`, commits: commits.length, unmatched: unmatched.length });
  return c.json({ ok: true, pushes: [...touched] });
});
