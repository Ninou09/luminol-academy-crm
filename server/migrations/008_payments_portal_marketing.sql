-- Online payment, automatic WhatsApp, client portal, online meetings,
-- expenses, feedback, company invoices, waitlist alerts and campaigns.

-- Chargily Pay checkouts (card CIB / Edahabia).
CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  charge_id INTEGER NOT NULL REFERENCES charges(id),
  amount INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
ALTER TABLE payments ADD COLUMN checkout_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX payments_checkout ON payments(checkout_id) WHERE checkout_id <> '';

-- Video meeting link for online consultations.
ALTER TABLE appointments ADD COLUMN meeting_url TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_services ADD COLUMN online INTEGER NOT NULL DEFAULT 0;

-- Client portal (private link) and company details for invoices.
ALTER TABLE contacts ADD COLUMN portal_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN company TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN company_nif TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN company_address TEXT NOT NULL DEFAULT '';

-- The academy's legal details printed on invoices.
ALTER TABLE settings ADD COLUMN legal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_address TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_nif TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_rc TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_nis TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_ai TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_rib TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE charges ADD COLUMN invoice_no INTEGER NOT NULL DEFAULT 0;

-- Expenses (rent, salaries, advertising…) for the profit report.
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  spent_on TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Satisfaction surveys answered on a public page.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  token_hash TEXT NOT NULL UNIQUE,
  about TEXT NOT NULL,
  staff_id INTEGER REFERENCES users(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  answered_at TEXT NOT NULL DEFAULT ''
);

-- Reminders now also cover waitlist places, campaigns and surveys.
CREATE TABLE reminders_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  user_id INTEGER REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp-link',
  sent_at TEXT NOT NULL
);
INSERT INTO reminders_new (id,kind,ref_id,contact_id,user_id,sent_at)
  SELECT id,kind,ref_id,contact_id,user_id,sent_at FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
CREATE INDEX reminders_ref ON reminders(kind, ref_id);

-- Messages to a group of clients.
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  filters TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE campaign_recipients (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(campaign_id, contact_id)
);

INSERT INTO message_templates (name, body, sort) VALUES
 ('Place available', 'Bonjour {name}, une place vient de se libérer dans le groupe {course}. Souhaitez-vous la réserver ? / مرحبا {name}، أصبح هناك مكان شاغر في مجموعة {course}. هل تريد حجزه؟', 5),
 ('Feedback request', 'Bonjour {name}, merci pour votre confiance ! Pouvez-vous nous donner votre avis en 30 secondes ? {link} / شكرا {name}! نرجو تقييم تجربتك: {link}', 6),
 ('Online consultation link', 'Bonjour {name}, voici le lien de votre consultation en ligne du {date} à {time} : {link} / رابط استشارتك عبر الإنترنت: {link}', 7),
 ('Client space', 'Bonjour {name}, voici votre espace personnel (planning, notes, paiements) : {link} / رابط فضائك الشخصي: {link}', 8);
