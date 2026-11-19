-- Platform tools: inbox, automation builder, custom fields, tags, segments,
-- forms, document templates, comments, notifications, loyalty, branches,
-- record history, API keys and webhooks. Nothing existing is changed.

-- 1. One conversation per client (WhatsApp, e-mail, calls, notes).
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out','note','call')),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  body TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  external_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX messages_contact ON messages(contact_id, created_at);
CREATE TABLE conversations (
  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Open','Resolved')),
  assignee_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- 2. Automation builder: When -> If -> Do, with a delay and a log.
CREATE TABLE flows (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',
  actions TEXT NOT NULL DEFAULT '[]',
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE flow_runs (
  id INTEGER PRIMARY KEY,
  flow_id INTEGER NOT NULL REFERENCES flows(id),
  record_key TEXT NOT NULL,
  contact_id INTEGER,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX flow_runs_once ON flow_runs(flow_id, record_key) WHERE test = 0;

-- 3. Custom fields, colour tags and saved segments.
CREATE TABLE custom_fields (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('contact','opportunity','cohort')),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','number','date','list','yesno')),
  options TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE custom_values (
  field_id INTEGER NOT NULL REFERENCES custom_fields(id),
  record_id INTEGER NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (field_id, record_id)
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'teal'
);
CREATE TABLE contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- 4. Own forms (replace Google Forms / Tally).
CREATE TABLE forms (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  intro_ar TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  consent_text TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  program_id INTEGER REFERENCES programs(id),
  active INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  submissions INTEGER NOT NULL DEFAULT 0,
  spam INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 5. Document templates with {name}, {course}, {price}, {date}.
CREATE TABLE doc_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contract',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 7. Comments with @mentions and the notification centre.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  contact_id INTEGER,
  link TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notifications_user ON notifications(user_id, read_at);

-- 8. Calendar feed (subscribe in Google Calendar / phone).
ALTER TABLE users ADD COLUMN calendar_token TEXT NOT NULL DEFAULT '';

-- 9. Personal dashboard layout.
CREATE TABLE user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  dashboard TEXT NOT NULL DEFAULT '[]'
);

-- 10. Subscriptions, promo codes, gift cards, referrals, loyalty.
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  label TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  sessions INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_billed TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  percent INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE gift_cards (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  balance INTEGER NOT NULL,
  buyer_id INTEGER REFERENCES contacts(id),
  recipient TEXT NOT NULL DEFAULT '',
  expires_on TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
ALTER TABLE contacts ADD COLUMN referred_by INTEGER;
ALTER TABLE settings ADD COLUMN loyalty_every INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN loyalty_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN referral_amount INTEGER NOT NULL DEFAULT 0;

-- 11. Branches, fine-grained rights, record history.
CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  rooms TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
ALTER TABLE users ADD COLUMN branch_id INTEGER;
ALTER TABLE users ADD COLUMN rights TEXT NOT NULL DEFAULT '{}';
ALTER TABLE appointments ADD COLUMN branch_id INTEGER;
ALTER TABLE payments ADD COLUMN branch_id INTEGER;
CREATE TABLE record_versions (
  id INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  before TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX record_versions_record ON record_versions(table_name, record_id);

-- 12. Errors shown on the system status page.
CREATE TABLE error_log (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 13. API keys and outgoing webhooks.
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_status TEXT NOT NULL DEFAULT '',
  last_at TEXT,
  created_at TEXT NOT NULL
);
