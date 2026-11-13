-- luminol:rebuild (runs with foreign keys temporarily off, then checked)
-- Real-workspace changes:
--  * contacts: email becomes optional (phone-only clients), free-text notes
--  * opportunities: program becomes optional, request type + free-text interest
--  * cohorts: teacher becomes optional
--  * incoming inquiries can be dismissed
--  * appointments: calendar events not tied to a cohort (consultations, meetings…)
--  * users can be deactivated instead of deleted when they have history

CREATE TABLE contacts_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'English',
  consent INTEGER NOT NULL DEFAULT 0,
  guardian TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
INSERT INTO contacts_new (id,name,email,phone,language,consent,guardian,created_at)
  SELECT id,name,email,phone,language,consent,guardian,created_at FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;
CREATE UNIQUE INDEX contacts_email_unique ON contacts(email) WHERE email <> '';

CREATE TABLE opportunities_new (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  program_id INTEGER REFERENCES programs(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  service_type TEXT NOT NULL DEFAULT 'Course',
  interest TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  source TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  expected_date TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  stage_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO opportunities_new (id,contact_id,program_id,owner_id,service_type,interest,stage,source,campaign,tags,expected_date,reason,created_at,stage_at,version)
  SELECT o.id,o.contact_id,o.program_id,o.owner_id,
    CASE WHEN p.category='Psychology' THEN 'Psychology course' WHEN p.category='Languages' THEN 'Language course' ELSE 'Course' END,
    COALESCE(p.name,''),o.stage,o.source,o.campaign,o.tags,o.expected_date,o.reason,o.created_at,o.stage_at,o.version
  FROM opportunities o LEFT JOIN programs p ON p.id=o.program_id;
DROP TABLE opportunities;
ALTER TABLE opportunities_new RENAME TO opportunities;
CREATE INDEX opportunities_contact ON opportunities(contact_id);

CREATE TABLE cohorts_new (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL,
  instructor_id INTEGER REFERENCES users(id),
  capacity INTEGER NOT NULL CHECK(capacity>0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active'
);
INSERT INTO cohorts_new SELECT id,program_id,name,instructor_id,capacity,start_date,end_date,room,status FROM cohorts;
DROP TABLE cohorts;
ALTER TABLE cohorts_new RENAME TO cohorts;

CREATE TABLE incoming_new (
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
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Converted','Dismissed')),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO incoming_new SELECT * FROM incoming_inquiries;
DROP TABLE incoming_inquiries;
ALTER TABLE incoming_new RENAME TO incoming_inquiries;
CREATE INDEX incoming_status ON incoming_inquiries(status,received_at);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'Consultation',
  title TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  staff_id INTEGER REFERENCES users(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Scheduled','Done','Cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX appointments_start ON appointments(starts_at);

ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
