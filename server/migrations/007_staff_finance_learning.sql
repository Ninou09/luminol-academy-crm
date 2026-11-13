-- Password recovery, two-step sign-in, psychology files, language progress,
-- certificates, payroll rates and receipt numbers.

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
-- Payroll: 'hour' (group classes, per hour), 'session' (per consultation), or 'none'.
ALTER TABLE users ADD COLUMN pay_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN pay_rate INTEGER NOT NULL DEFAULT 0;

ALTER TABLE contacts ADD COLUMN emergency_contact TEXT NOT NULL DEFAULT '';

-- First consultation file (answers stored as JSON, questions are editable).
CREATE TABLE intake_forms (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE settings ADD COLUMN intake_questions TEXT NOT NULL DEFAULT '["Reason for consultation","History and context","Goals","Current treatment or medication","Referred by"]';

-- One private note per session, visible only to its author.
CREATE TABLE session_notes (
  appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Treatment / session plan on a package.
ALTER TABLE packages ADD COLUMN plan TEXT NOT NULL DEFAULT '';

-- Placement tests and grades.
CREATE TABLE placement_results (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  test_name TEXT NOT NULL,
  score REAL,
  max_score REAL,
  level TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  taken_on TEXT NOT NULL
);
CREATE TABLE grades (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  title TEXT NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL DEFAULT 20,
  taken_on TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id)
);

-- Certificates that anyone can verify by scanning the QR code.
CREATE TABLE certificates (
  code TEXT PRIMARY KEY,
  enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
  issued_at TEXT NOT NULL
);

-- Receipts are numbered 1, 2, 3… within each year.
ALTER TABLE payments ADD COLUMN receipt_no INTEGER NOT NULL DEFAULT 0;
UPDATE payments SET receipt_no = (
  SELECT COUNT(*) FROM payments p2
  WHERE substr(p2.created_at,1,4) = substr(payments.created_at,1,4) AND p2.id <= payments.id
);
