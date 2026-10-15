CREATE TABLE incoming_inquiries (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  review_fingerprint TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL,
  consent INTEGER NOT NULL,
  service_type TEXT NOT NULL DEFAULT '',
  course_interest TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  task_id INTEGER REFERENCES tasks(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Converted')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX incoming_status ON incoming_inquiries(status,received_at);
