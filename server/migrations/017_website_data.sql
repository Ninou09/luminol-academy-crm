-- Facts published on the Luminol Academy website (luminol-academy-web).
-- Only fills empty values and adds missing rows: nothing already entered is changed.

UPDATE settings SET legal_address = 'Villa No. 2, Ezzayat Street, 09000 Blida'
 WHERE id = 1 AND (legal_address IS NULL OR legal_address = '');

-- Bot answers: replace only the placeholders created by 016_smart.sql.
UPDATE kb_articles SET
  answer = 'Luminol Academy : Villa n° 2, rue Ezzayat, 09000 Blida. Itinéraire : https://www.google.com/maps/dir/?api=1&destination=36.487462285152,2.8340435028076 — Beaucoup de séances ont aussi lieu en ligne (Zoom).',
  answer_ar = 'أكاديمية لومينول: فيلا رقم 2، شارع الزيات، 09000 البليدة. الاتجاهات: https://www.google.com/maps/dir/?api=1&destination=36.487462285152,2.8340435028076 — كثير من الحصص تقام أيضًا عبر الإنترنت (Zoom).'
 WHERE question = 'Où se trouve l''académie ?' AND answer LIKE '%compléter%';
UPDATE kb_articles SET
  answer = 'Nous sommes ouverts du samedi au jeudi, de 8 h à 17 h (heure d''Algérie). Fermé le vendredi. Téléphone : +213 777 07 71 97.',
  answer_ar = 'نحن مفتوحون من السبت إلى الخميس، من 8:00 إلى 17:00 (بتوقيت الجزائر). مغلق يوم الجمعة. الهاتف: 97 71 07 777 213+.'
 WHERE question = 'Quels sont les horaires ?' AND answer LIKE '%adapter%';

INSERT INTO kb_articles (question, answer, answer_ar, keywords, created_at)
SELECT 'Comment vous contacter ?',
  'Téléphone : +213 777 07 71 97 · WhatsApp : +213 556 91 45 17 · E-mail : luminolacademy09@gmail.com · Instagram : @luminol_academy_psy · Facebook : luminol.academy',
  'الهاتف: 97 71 07 777 213+ · واتساب: 17 45 91 556 213+ · البريد: luminolacademy09@gmail.com · إنستغرام: @luminol_academy_psy · فيسبوك: luminol.academy',
  'contact,contacter,telephone,numero,email,mail,instagram,facebook,whatsapp,tel,nemro,رقم,هاتف,تواصل,ايميل',
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE question = 'Comment vous contacter ?');

INSERT INTO kb_articles (question, answer, answer_ar, keywords, created_at)
SELECT 'Quels sont vos services ?',
  'Luminol Academy réunit trois écoles : Psychologie (thérapie et consultations, guidance enfant et famille, coaching), Langues (anglais, français, parcours de fluidité) et Formation professionnelle (leadership, communication, compétences numériques). Dites-nous ce qui vous intéresse et nous vous orientons.',
  'تضم أكاديمية لومينول ثلاث مدارس: علم النفس (علاج واستشارات، توجيه الطفل والأسرة، كوتشينغ)، اللغات (الإنجليزية، الفرنسية) والتكوين المهني (القيادة، التواصل، المهارات الرقمية). أخبرنا بما يهمك وسنوجهك.',
  'service,services,formation,cours,ecole,psychologie,langue,anglais,francais,coaching,therapie,خدمات,تكوين,دروس,علم النفس,لغات',
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE question = 'Quels sont vos services ?');

INSERT INTO kb_articles (question, answer, answer_ar, keywords, created_at)
SELECT 'Prochaines séances et ateliers ?',
  'Nous organisons des séances de sensibilisation gratuites pour les familles et des séances professionnelles pour les praticiens, surtout en ligne sur Zoom. Pour être prévenu(e), rejoignez notre groupe WhatsApp : https://chat.whatsapp.com/D6PadKZe73qDXCr3ZRPzHE',
  'ننظم حصص توعية مجانية للأسر وحصصًا مهنية للممارسين، غالبًا عبر Zoom. للاطلاع على المواعيد انضم إلى مجموعة واتساب: https://chat.whatsapp.com/D6PadKZe73qDXCr3ZRPzHE',
  'atelier,seance,session,evenement,webinaire,zoom,gratuit,groupe,prochain,ورشة,حصة,مجاني,زوم,مجموعة',
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE question = 'Prochaines séances et ateliers ?');

INSERT INTO kb_articles (question, answer, answer_ar, keywords, created_at)
SELECT 'Les formations donnent-elles un diplôme ?',
  'Nos formations donnent une attestation de présence délivrée par Luminol Academy. Elle ne vaut pas accréditation académique ni autorisation d''exercer.',
  'تمنح تكويناتنا شهادة حضور من أكاديمية لومينول، ولا تعادل اعتمادًا أكاديميًا أو رخصة لممارسة المهنة.',
  'diplome,certificat,attestation,accreditation,reconnu,شهادة,ديبلوم,معتمد',
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE question = 'Les formations donnent-elles un diplôme ?');

-- Programmes published on the website (prices to be confirmed by the director).
-- Added only to a workspace that already has data, so a brand-new install starts clean.
INSERT INTO programs (name, category, description, duration, price, currency, color)
SELECT 'Acceptance and Commitment Therapy (ACT)', 'Formation professionnelle',
  'Formation spécialisée en ACT : principes et techniques pratiques (acceptation, défusion cognitive, moment présent, soi comme contexte, valeurs, action engagée). Pour psychologues, étudiants et praticiens. Attestation de présence.',
  'À confirmer', 0, 'DZD', 'purple'
WHERE EXISTS (SELECT 1 FROM contacts) AND NOT EXISTS (SELECT 1 FROM programs WHERE name LIKE '%Acceptance and Commitment%' OR name LIKE '%(ACT)%');
INSERT INTO programs (name, category, description, duration, price, currency, color)
SELECT 'Auto-hypnose — le code de la maîtrise de soi', 'Formation professionnelle',
  'Programme de formation en ligne (Zoom) animé par Linda Guesmi. Date à annoncer.',
  'À confirmer', 0, 'DZD', 'teal'
WHERE EXISTS (SELECT 1 FROM contacts) AND NOT EXISTS (SELECT 1 FROM programs WHERE name LIKE '%hypno%');
INSERT INTO programs (name, category, description, duration, price, currency, color)
SELECT 'Formation aux thérapies brèves', 'Formation professionnelle',
  'Formation professionnelle en ligne (Zoom) animée par Kheddaoui Fettouma. Liste d''attente ouverte.',
  'À confirmer', 0, 'DZD', 'blue'
WHERE EXISTS (SELECT 1 FROM contacts) AND NOT EXISTS (SELECT 1 FROM programs WHERE name LIKE '%thérapies brèves%' OR name LIKE '%short-term therap%');
