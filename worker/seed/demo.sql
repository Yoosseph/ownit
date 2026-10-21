-- Demo data for local development: `npx wrangler d1 execute ownit --local --file seed/demo.sql`
-- Repo demo/seeded: alice has 6 verified + 2 skipped commits, bob 1 verified + 1 skipped,
-- and bob has a 3-commit push pending for 30 hours that the hourly cron turns into a skip.
-- Before the cron: 70% verified. After it: 7 of 13 = 54% verified.

DELETE FROM questions WHERE push_id IN (SELECT p.id FROM pushes p JOIN repos r ON r.id = p.repo_id WHERE r.owner = 'demo' AND r.name = 'seeded');
DELETE FROM commits WHERE repo_id IN (SELECT id FROM repos WHERE owner = 'demo' AND name = 'seeded');
DELETE FROM pushes WHERE repo_id IN (SELECT id FROM repos WHERE owner = 'demo' AND name = 'seeded');
DELETE FROM repos WHERE owner = 'demo' AND name = 'seeded';

INSERT INTO repos (owner, name, installation_id, tracked_since, private)
VALUES ('demo', 'seeded', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), 0);
INSERT INTO users (github_id, login) VALUES (9001, 'alice'), (9002, 'bob') ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS _ownit_seed;
CREATE TABLE _ownit_seed (n INTEGER, author TEXT, uid INTEGER, status TEXT, hours INTEGER, q TEXT);
INSERT INTO _ownit_seed VALUES
  (4, 'alice', 9001, 'verified', 100, 'Why does checkout now retry failed card payments instead of failing the order?'),
  (2, 'alice', 9001, 'verified', 80, 'How does the new cart total avoid floating point drift?'),
  (2, 'alice', 9001, 'skipped', 60, NULL),
  (1, 'bob', 9002, 'verified', 50, 'Why move rate limiting in front of the search endpoint?'),
  (1, 'bob', 9002, 'skipped', 40, NULL),
  (3, 'bob', 9002, 'pending', 30, NULL);

INSERT INTO pushes (repo_id, user_github_id, head_sha, status, question_count, created_at, resolved_at)
SELECT r.id, s.uid, printf('%040x', s.rowid), s.status, CASE WHEN s.q IS NULL THEN 0 ELSE 1 END,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', printf('-%d hours', s.hours)),
       CASE WHEN s.status IN ('verified', 'skipped') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', printf('-%d hours', s.hours)) END
FROM _ownit_seed s, repos r WHERE r.owner = 'demo' AND r.name = 'seeded';

WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 4)
INSERT INTO commits (sha, repo_id, push_id, author_login, pushed_at)
SELECT printf('%08x%032x', p.id, k.i), p.repo_id, p.id, s.author, p.created_at
FROM pushes p
JOIN repos r ON r.id = p.repo_id AND r.owner = 'demo' AND r.name = 'seeded'
JOIN _ownit_seed s ON printf('%040x', s.rowid) = p.head_sha
JOIN k ON k.i <= s.n;

INSERT INTO questions (push_id, idx, kind, text, passed, attempts)
SELECT p.id, 0, 'why', s.q, 1, 1
FROM pushes p JOIN _ownit_seed s ON printf('%040x', s.rowid) = p.head_sha
JOIN repos r ON r.id = p.repo_id AND r.owner = 'demo' AND r.name = 'seeded'
WHERE s.q IS NOT NULL;

DROP TABLE _ownit_seed;
