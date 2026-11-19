-- Smart CRM: staff assistant, client bot, knowledge base, predictions,
-- AI usage limits and the first-visit tour. Works without paid services.

CREATE TABLE assistant_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX assistant_messages_user ON assistant_messages(user_id, id);

-- Answers the client bot may give (prices, address, hours…), kept by the director.
CREATE TABLE kb_articles (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_ar TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Bot sessions from the website widget.
CREATE TABLE bot_sessions (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  contact_id INTEGER REFERENCES contacts(id),
  lang TEXT NOT NULL DEFAULT 'fr',
  created_at TEXT NOT NULL
);

-- Intent of each incoming message and the reply the bot suggests.
ALTER TABLE messages ADD COLUMN intent TEXT NOT NULL DEFAULT '';
ALTER TABLE conversations ADD COLUMN suggestion TEXT NOT NULL DEFAULT '';
ALTER TABLE conversations ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;

-- Trained prediction models (weights in JSON, computed inside the CRM).
CREATE TABLE ml_models (
  kind TEXT PRIMARY KEY,
  weights TEXT NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  samples INTEGER NOT NULL DEFAULT 0,
  trained_at TEXT NOT NULL
);

-- AI calls (only when a Claude key is set): who, what, how many tokens.
CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  feature TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

ALTER TABLE settings ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN ai_monthly_tokens INTEGER NOT NULL DEFAULT 2000000;
ALTER TABLE settings ADD COLUMN bot_mode TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE settings ADD COLUMN crisis_text TEXT NOT NULL DEFAULT 'Merci de nous avoir écrit. Un membre de notre équipe vous répond tout de suite. Si vous êtes en danger immédiat, appelez le 14 (Protection civile) ou le 17 (Police), ou rendez-vous aux urgences les plus proches.';
ALTER TABLE users ADD COLUMN tour_done INTEGER NOT NULL DEFAULT 0;

INSERT INTO kb_articles (question, answer, answer_ar, keywords, created_at) VALUES
 ('Où se trouve l''académie ?', 'Notre adresse : à compléter dans Paramètres → Base de connaissances.', 'عنواننا: يُكمل في الإعدادات.', 'adresse,où,ou,situé,localisation,win,fin,blasa,blassa,عنوان,وين,فين,مكان,بلاصة', datetime('now')),
 ('Quels sont les horaires ?', 'Nous sommes ouverts du dimanche au jeudi, de 9 h à 18 h (à adapter).', 'نحن مفتوحون من الأحد إلى الخميس من 9 إلى 18 (يُعدّل).', 'horaire,heure,ouvert,fermé,quand,wakt,waqt,wa9t,waktach,وقت,ساعات,مفتوح,وقتاش', datetime('now')),
 ('Quels sont les prix ?', 'Les tarifs dépendent du service. Dites-nous lequel vous intéresse et nous vous envoyons le prix exact.', 'الأسعار حسب الخدمة. أخبرنا بما يهمك ونرسل لك السعر.', 'prix,tarif,combien,coût,cout,bchhal,bch7al,chhal,ch7al,9adach,qadach,kadach,soum,سعر,ثمن,بشحال,قداه,كم,سومة', datetime('now')),
 ('Comment payer ?', 'Vous pouvez payer sur place (espèces), par CCP/BaridiMob ou par carte CIB/Edahabia avec le lien envoyé.', 'يمكنك الدفع نقدًا، عبر CCP/بريدي موب أو ببطاقة CIB/الذهبية.', 'paiement,payer,ccp,baridimob,cib,edahabia,carte,الدفع,بريدي,بطاقة', datetime('now'));
