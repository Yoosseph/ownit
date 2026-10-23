-- What a repo's public page shows, chosen by its admins with `ownit page`.
-- Answers are stored only while show_answers is on, and deleted when it is turned off.
-- Private repos never show questions or answers, whatever these say.
ALTER TABLE repos ADD COLUMN show_questions INTEGER NOT NULL DEFAULT 1;
ALTER TABLE repos ADD COLUMN show_answers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN answer TEXT;
