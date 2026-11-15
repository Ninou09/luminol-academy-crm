-- Online booking, working hours, time off and reminder tracking.

-- Weekly working hours. Several rows per day allow a lunch break.
-- weekday: 0 = Monday … 6 = Sunday; minutes from midnight in the academy time zone.
CREATE TABLE staff_hours (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL CHECK(start_min BETWEEN 0 AND 1440),
  end_min INTEGER NOT NULL CHECK(end_min BETWEEN 0 AND 1440 AND end_min > start_min)
);
CREATE INDEX staff_hours_user ON staff_hours(user_id, weekday);

-- Holidays, sick days, training days…
CREATE TABLE time_off (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- What clients can book themselves on the public page.
CREATE TABLE booking_services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Consultation',
  duration_min INTEGER NOT NULL DEFAULT 60 CHECK(duration_min BETWEEN 10 AND 480),
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE booking_service_staff (
  service_id INTEGER NOT NULL REFERENCES booking_services(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY(service_id, user_id)
);

-- Public title shown to clients (for example “Psychologue clinicienne”).
ALTER TABLE users ADD COLUMN public_title TEXT NOT NULL DEFAULT '';

-- Booking page switch and welcome text.
ALTER TABLE settings ADD COLUMN booking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN booking_intro TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN booking_notice_hours INTEGER NOT NULL DEFAULT 2;

-- Appointments can wait for confirmation and remember where they came from.
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
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Pending','Scheduled','Done','No-show','Cancelled')),
  source TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL
);
INSERT INTO appointments_new (id,kind,title,contact_id,staff_id,package_id,starts_at,ends_at,location,notes,status,created_at)
  SELECT id,kind,title,contact_id,staff_id,package_id,starts_at,ends_at,location,notes,status,created_at FROM appointments;
DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
CREATE INDEX appointments_start ON appointments(starts_at);
CREATE INDEX appointments_staff ON appointments(staff_id, starts_at);

-- Reminders sent by WhatsApp (who, what, when).
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('appointment','payment')),
  ref_id INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  sent_at TEXT NOT NULL
);
CREATE INDEX reminders_ref ON reminders(kind, ref_id);
