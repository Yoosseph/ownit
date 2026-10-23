-- A question the developer passed by standing by an answer the grader did not accept.
-- Allowed once per debrief, only on a follow-up; shown as "disputed" on the page and check run.
ALTER TABLE questions ADD COLUMN disputed INTEGER NOT NULL DEFAULT 0;
