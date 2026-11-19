-- Waiting list for freed appointment slots (idea 2).
CREATE TABLE appointment_waitlist (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  staff_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting','Offered','Booked','Removed')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
-- Monthly goals shown on the dashboard (idea 5). Amounts in cents.
CREATE TABLE goals (
  month TEXT PRIMARY KEY,
  revenue INTEGER NOT NULL DEFAULT 0,
  new_clients INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
-- Lesson materials attached to a group, visible in the client space (idea 10).
CREATE TABLE cohort_materials (
  id INTEGER PRIMARY KEY,
  cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
-- Sign-in journal (idea 11).
CREATE TABLE login_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  email TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX login_events_time ON login_events(created_at);
-- Automatic sign-out after inactivity, in minutes; 0 = off (idea 12).
ALTER TABLE settings ADD COLUMN idle_minutes INTEGER NOT NULL DEFAULT 0;
-- Confirmation received from the client (WhatsApp reply "1", idea 1).
ALTER TABLE appointments ADD COLUMN confirmed_at TEXT NOT NULL DEFAULT '';
UPDATE message_templates
  SET body = body || ' Répondez 1 pour confirmer, 2 pour annuler. / أرسل 1 للتأكيد أو 2 للإلغاء.'
  WHERE name = 'Appointment reminder' AND body NOT LIKE '%Répondez 1%';
