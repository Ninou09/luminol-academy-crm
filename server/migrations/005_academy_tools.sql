-- Everyday tools for a psychology and language academy.

-- Deleted records are kept 30 days so a mistake can be undone.
CREATE TABLE trash (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  deleted_at TEXT NOT NULL
);

-- Prepaid consultation packages (for example 5 sessions).
CREATE TABLE packages (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  title TEXT NOT NULL,
  sessions_total INTEGER NOT NULL CHECK(sessions_total > 0 AND sessions_total <= 200),
  charge_id INTEGER REFERENCES charges(id),
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Finished')),
  created_at TEXT NOT NULL
);

-- Appointments gain "No-show" and an optional package.
CREATE TABLE appointments_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'Consultation',
  title TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  staff_id INTEGER REFERENCES users(id),
  package_id INTEGER REFERENCES packages(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Scheduled','Done','No-show','Cancelled')),
  created_at TEXT NOT NULL
);
INSERT INTO appointments_new (id,kind,title,contact_id,staff_id,starts_at,ends_at,location,notes,status,created_at)
  SELECT id,kind,title,contact_id,staff_id,starts_at,ends_at,location,notes,status,created_at FROM appointments;
DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
CREATE INDEX appointments_start ON appointments(starts_at);
CREATE INDEX appointments_staff ON appointments(staff_id, starts_at);

-- Language level (A1…C2) and completion certificates.
ALTER TABLE contacts ADD COLUMN level TEXT NOT NULL DEFAULT '';
ALTER TABLE enrollments ADD COLUMN level TEXT NOT NULL DEFAULT '';
ALTER TABLE enrollments ADD COLUMN completed_at TEXT NOT NULL DEFAULT '';

-- Ready-made WhatsApp / SMS texts the team can edit.
CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO message_templates (name, body, sort) VALUES
 ('Appointment reminder', 'Bonjour {name}, nous vous rappelons votre rendez-vous à {academy} le {date} à {time}. Merci de confirmer. / مرحبا {name}، نذكركم بموعدكم في {academy} يوم {date} على الساعة {time}.', 1),
 ('Payment reminder', 'Bonjour {name}, le solde de {amount} pour {course} est à régler avant le {due}. Merci ! / مرحبا {name}، المبلغ المتبقي {amount} لـ {course} قبل {due}.', 2),
 ('Welcome to the group', 'Bienvenue {name} ! Votre groupe {course} commence le {date}. À bientôt à {academy}. / مرحبا بك {name}! تبدأ مجموعتك {course} يوم {date}.', 3),
 ('First contact', 'Bonjour {name}, merci pour votre intérêt pour {course}. Quand pouvons-nous vous appeler ? / مرحبا {name}، شكرا لاهتمامك بـ {course}. متى يمكننا الاتصال بك؟', 4);

-- Small key/value store (last automatic backup, …).
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
