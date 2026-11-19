-- Birthday greetings and the date the consent was signed on the tablet.
ALTER TABLE contacts ADD COLUMN birth_date TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN consent_signed_at TEXT NOT NULL DEFAULT '';
-- Rooms of the academy, one per line (room board in the calendar).
ALTER TABLE settings ADD COLUMN rooms TEXT NOT NULL DEFAULT '';
-- Questionnaire the client fills in before the first consultation.
CREATE TABLE intake_links (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  answered_at TEXT NOT NULL DEFAULT ''
);
