-- Reception check-in: the client is in the waiting room (before "Done").
ALTER TABLE appointments ADD COLUMN checked_in_at TEXT NOT NULL DEFAULT '';
