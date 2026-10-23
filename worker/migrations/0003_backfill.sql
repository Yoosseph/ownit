-- Earlier work: commits from before tracking began count once a debrief verifies them,
-- if the repo's admins allow it. They never count as unverified.
ALTER TABLE repos ADD COLUMN allow_backfill INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commits ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0;
