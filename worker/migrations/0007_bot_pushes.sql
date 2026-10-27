-- Pushes a bot made to its own branch (before the webhook ignored them) go to the
-- repo's owner, along with any bot commits still credited to a bot.
UPDATE commits
SET author_login = (
  SELECT u.login FROM repos r JOIN users u ON lower(u.login) = lower(r.owner) WHERE r.id = commits.repo_id
)
WHERE author_login LIKE '%[bot]'
  AND EXISTS (SELECT 1 FROM repos r JOIN users u ON lower(u.login) = lower(r.owner) WHERE r.id = commits.repo_id);

UPDATE pushes
SET user_github_id = (
  SELECT u.github_id FROM repos r JOIN users u ON lower(u.login) = lower(r.owner) WHERE r.id = pushes.repo_id
)
WHERE user_github_id IN (SELECT github_id FROM users WHERE login LIKE '%[bot]')
  AND EXISTS (SELECT 1 FROM repos r JOIN users u ON lower(u.login) = lower(r.owner) WHERE r.id = pushes.repo_id);
