-- Bots cannot debrief, so a bot's commit is owed by whoever pushed or merged it.
UPDATE commits
SET author_login = (
  SELECT u.login FROM pushes p JOIN users u ON u.github_id = p.user_github_id WHERE p.id = commits.push_id
)
WHERE author_login LIKE '%[bot]'
  AND EXISTS (SELECT 1 FROM pushes p JOIN users u ON u.github_id = p.user_github_id WHERE p.id = commits.push_id);
