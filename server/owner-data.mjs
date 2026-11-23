// Answers given by the academy's owner (prices, services, payment details,
// loyalty). Applied once per version at start-up; values already entered by
// hand in the CRM are never overwritten.
import { all, one, run, insert, transaction, now } from "./db.mjs";

const VERSION = "owner-answers-2";
const DA = (n) => n * 100; // amounts are stored in centimes

const kheddaoui =
  "lower(name) LIKE '%kheddaoui%' OR lower(name) LIKE '%fettouma%' OR lower(name) LIKE '%fatma%'";

const trainingNote =
  "Formatrice : Kheddaoui Fettouma. Durée : 12 h ou 18 h selon le programme. Démarrage dès 8 à 10 inscrits, pas de limite de places. Attestation de présence.";

const trainings = [
  {
    match: ["%Acceptance and Commitment%", "%(ACT)%"],
    name: "Acceptance and Commitment Therapy (ACT)",
    description:
      "Formation spécialisée en ACT : acceptation, défusion cognitive, moment présent, soi comme contexte, valeurs, action engagée. Pour psychologues, étudiants et praticiens.",
    color: "purple",
  },
  {
    match: ["%hypno%"],
    name: "Auto-hypnose — le code de la maîtrise de soi",
    description: "Programme de formation, en présentiel ou en ligne (Zoom).",
    color: "teal",
  },
  {
    match: ["%thérapies brèves%", "%short-term therap%"],
    name: "Formation aux thérapies brèves",
    description: "Formation professionnelle, en présentiel ou en ligne (Zoom).",
    color: "blue",
  },
];

// Programmes published on luminolacademy.nl (Mme Kheddaoui Fettouma's site).
const sitePrograms = [
  [
    "دورة فنيات العلاج المعرفي السلوكي (CBT)",
    "Training",
    "40 h",
    "purple",
    "Introduction pratique à la thérapie cognitivo-comportementale : formulation de cas, plan de traitement, conduite des séances. Pour psychologues. Présentiel ou en ligne ; enregistrements 6 mois et support de cours.",
  ],
  [
    "دورة تقنية تحرير المشاعر السلبية (EFT)",
    "Training",
    "2 jours",
    "teal",
    "Technique EFT contre le stress et les émotions négatives, 100 % pratique. Pour psychologues et médecins. Présentiel ou en ligne.",
  ],
  [
    "دورة الإرشاد الزواجي (تشخيص وتكفل)",
    "Training",
    "24 h et plus",
    "rose",
    "Diagnostic des difficultés conjugales et programmes de conseil et de thérapie du couple. Pour psychologues. Présentiel (2 week-ends) ou en ligne (2 fois par semaine).",
  ],
  [
    "دورة مستشار أسري",
    "Training",
    "40 h",
    "amber",
    "Conseil familial centré sur les solutions : relations conjugales, parents-enfants, entretien familial. Pour psychologues, conseillers familiaux, travailleurs sociaux. Supervision incluse.",
  ],
  [
    "دورة العلاج بالمخططات المعرفية (Schema therapy)",
    "Training",
    "12 h ou 18 h",
    "blue",
    "Formation spécialisée en thérapie des schémas pour approfondir la compréhension des troubles psychologiques.",
  ],
  [
    "دورة صعوبات التعلم (تشخيص وتكفل)",
    "Training",
    "12 h ou 18 h",
    "teal",
    "Diagnostic des difficultés d'apprentissage avec des échelles psychologiques et techniques actuelles de prise en charge.",
  ],
  [
    "علم نفس الطفل: تقنيات التشخيص وبرامج التكفل",
    "Training",
    "12 h ou 18 h",
    "purple",
    "Évaluation psychologique de l'enfant, techniques de diagnostic et construction de programmes d'intervention, avec applications pratiques.",
  ],
  [
    "برنامج التنشئة الفعالة",
    "Grand public",
    "12 h ou 18 h",
    "amber",
    "Programme complet de parentalité positive et de communication efficace avec les enfants de tout âge. Pour les parents.",
  ],
  [
    "دورة صعوبات التعلم (للأولياء والمعلمين)",
    "Grand public",
    "12 h ou 18 h",
    "blue",
    "Aider parents et enseignants à comprendre les difficultés d'apprentissage et à accompagner l'enfant avec des méthodes éducatives efficaces.",
  ],
];

const languages = [
  ["Anglais — cours par niveaux", "blue"],
  ["Français — cours par niveaux", "teal"],
  ["Espagnol — cours par niveaux", "amber"],
  ["Allemand — cours par niveaux", "purple"],
  ["Expression orale (speaking) — toutes langues", "rose"],
];

const kb = [
  [
    "Quels sont les prix ?",
    "Nos tarifs — consultation psychologique (1 h, au cabinet ou en ligne sur Zoom) : 3 000 DA avec Mme Kheddaoui Fettouma, 2 000 DA avec nos autres psychologues. La première séance est au même tarif. Formations professionnelles : 12 000 DA. Cours de langues : demandez-nous le tarif du niveau qui vous intéresse.",
    "الاستشارة النفسية (ساعة، في العيادة أو عبر Zoom): 3000 دج مع السيدة خداوي فطومة، و2000 دج مع باقي الأخصائيين. الحصة الأولى بنفس السعر. التكوينات المهنية: 12000 دج. دروس اللغات: اسألنا عن سعر المستوى الذي يهمك.",
  ],
  [
    "Quels sont les horaires ?",
    "Nous sommes ouverts du dimanche au jeudi, de 8 h à 17 h (heure d'Algérie) : nos psychologues reçoivent sur rendez-vous. Fermé le vendredi et le samedi. Téléphone : +213 777 07 71 97.",
    "نحن مفتوحون من الأحد إلى الخميس، من 8:00 إلى 17:00 (بتوقيت الجزائر)، ويستقبل أخصائيونا بموعد. مغلق يومي الجمعة والسبت. الهاتف: 97 71 07 777 213+.",
  ],
  [
    "Comment payer ?",
    "Vous pouvez payer en espèces, par CCP, BaridiMob, virement bancaire, carte CIB ou carte Edahabia. BaridiMob — RIP : 00799999000280929957. CCP : 2809299 clé 57. Au nom de KHEDDAOUI FETTOUMA. Envoyez-nous la preuve de paiement.",
    "يمكنك الدفع نقدًا أو عبر CCP أو بريدي موب أو تحويل بنكي أو بطاقة CIB أو البطاقة الذهبية. بريدي موب — RIP: 00799999000280929957. CCP: 2809299 المفتاح 57. باسم KHEDDAOUI FETTOUMA. أرسل لنا وصل الدفع.",
  ],
];

const kbNew = [
  [
    "Quelles consultations proposez-vous ?",
    "Nous proposons tous les types de consultations psychologiques (adultes, enfants, couples, familles, coaching), au cabinet ou en ligne sur Zoom. Une séance dure 1 heure. Nos psychologues : Mme Kheddaoui Fettouma et notre équipe.",
    "نقدم جميع أنواع الاستشارات النفسية (بالغين، أطفال، أزواج، عائلات، كوتشينغ)، في العيادة أو عبر Zoom. مدة الحصة ساعة واحدة. أخصائيونا: السيدة خداوي فطومة وفريقنا.",
    "consultation,psychologue,therapie,seance,zoom,enfant,couple,famille,استشارة,اخصائي,نفساني,حصة,علاج",
  ],
  [
    "Quelles langues enseignez-vous ?",
    "Anglais, français, espagnol et allemand : cours par niveaux et cours d'expression orale (speaking). Dites-nous votre niveau, nous vous orientons vers le bon groupe.",
    "الإنجليزية والفرنسية والإسبانية والألمانية: دروس حسب المستوى ودروس التعبير الشفهي. أخبرنا بمستواك ونوجهك إلى الفوج المناسب.",
    "langue,anglais,francais,espagnol,allemand,english,speaking,niveau,cours,لغة,انجليزية,فرنسية,اسبانية,المانية,مستوى",
  ],
  [
    "Comment se passent les formations ?",
    "Nos formations professionnelles coûtent 12 000 DA, durent 12 h ou 18 h et sont animées surtout par Mme Kheddaoui Fettouma. Un groupe démarre dès 8 à 10 inscrits. Vous recevez une attestation de présence.",
    "تكويناتنا المهنية بسعر 12000 دج، مدتها 12 أو 18 ساعة، وتقدمها غالبًا السيدة خداوي فطومة. يبدأ الفوج عند تسجيل 8 إلى 10 مشاركين. تحصل على شهادة حضور.",
    "formation,programme,atelier,inscription,groupe,attestation,trainer,تكوين,برنامج,تسجيل,فوج,شهادة",
  ],
  [
    "Avez-vous une réduction ou un parrainage ?",
    "Pas de réduction sur les consultations. Fidélité : 10 % sur chaque 5e séance. Parrainage : 500 DA de réduction sur votre prochaine séance pour chaque ami qui vient grâce à vous. Formations : 10 % pour une inscription anticipée ou à partir de 3 personnes inscrites ensemble.",
    "لا تخفيض على الاستشارات. الوفاء: 10% على كل حصة خامسة. الإحالة: خصم 500 دج على حصتك القادمة عن كل صديق يأتي عن طريقك. التكوينات: 10% للتسجيل المبكر أو لمجموعة من 3 أشخاص.",
    "reduction,remise,promo,parrainage,fidelite,ami,tkhfid,تخفيض,خصم,تخفيضات,صديق,وفاء",
  ],
];

const promo = [
  ["AVANCE10", 10, "Formations : inscription anticipée"],
  ["GROUPE3", 10, "Formations : 3 personnes inscrites ensemble"],
];

/** The two consultation services, linked to the specialists once their
 * accounts exist (checked at every start, so accounts created later count). */
function consultationServices() {
  // Consultations: 1 hour, same price at the academy or on Zoom.
  const services = [
    [
      "Consultation psychologique — Mme Kheddaoui Fettouma",
      "1 heure, au cabinet ou en ligne (Zoom). 3 000 DA. Première séance au même tarif.",
      all(`SELECT id FROM users WHERE active=1 AND (${kheddaoui})`),
    ],
    [
      "Consultation psychologique",
      "1 heure, au cabinet ou en ligne (Zoom). 2 000 DA. Première séance au même tarif.",
      // Teachers are instructors too: the director ticks the psychologists.
      [],
    ],
  ];
  services.forEach(([name, description, staff], i) => {
    let id = one("SELECT id FROM booking_services WHERE name=?", name)?.id;
    if (!id)
      id = insert("booking_services", {
        name,
        kind: "Consultation",
        duration_min: 60,
        description,
        active: 1,
        sort: i,
      });
    // Linked once: the director can change the list afterwards.
    if (one("SELECT 1 FROM booking_service_staff WHERE service_id=?", id))
      return;
    for (const u of staff)
      run(
        "INSERT OR IGNORE INTO booking_service_staff (service_id, user_id) VALUES (?, ?)",
        id,
        u.id,
      );
  });
}

export function applyOwnerData() {
  transaction(consultationServices);
  if (one("SELECT value FROM meta WHERE key=?", VERSION)) return;
  transaction(() => {
    const s = one("SELECT * FROM settings WHERE id=1");
    if (!s) return;
    // Payment details for invoices and receipts.
    if (!s.legal_rib)
      run(
        "UPDATE settings SET legal_rib=? WHERE id=1",
        "BaridiMob RIP 00799999000280929957 · CCP 2809299 clé 57 · KHEDDAOUI FETTOUMA",
      );
    // Loyalty: 10 % on every 5th session; 500 DA for each friend brought.
    if (!s.loyalty_every)
      run("UPDATE settings SET loyalty_every=5, loyalty_percent=10 WHERE id=1");
    if (!s.referral_amount)
      run("UPDATE settings SET referral_amount=? WHERE id=1", DA(500));

    // Training programmes: 12 000 DA, trainer and format.
    for (const p of trainings) {
      const found = one(
        `SELECT * FROM programs WHERE ${p.match.map(() => "name LIKE ?").join(" OR ")}`,
        ...p.match,
      );
      const description = `${p.description} ${trainingNote}`;
      if (found) {
        run(
          "UPDATE programs SET price=CASE WHEN price=0 THEN ? ELSE price END, duration=CASE WHEN duration IN ('', 'À confirmer') THEN '12 h ou 18 h' ELSE duration END, description=? WHERE id=?",
          DA(12000),
          description,
          found.id,
        );
      } else {
        insert("programs", {
          name: p.name,
          category: "Training",
          description,
          duration: "12 h ou 18 h",
          price: DA(12000),
          currency: "DZD",
          color: p.color,
        });
      }
    }
    for (const [name, category, duration, color, description] of sitePrograms)
      if (!one("SELECT id FROM programs WHERE name=?", name))
        insert("programs", {
          name,
          category,
          description: `${description} Formatrice : Kheddaoui Fettouma. Démarrage dès 8 à 10 inscrits. Attestation de présence.`,
          duration,
          price: DA(12000),
          currency: "DZD",
          color,
        });
    // Languages: courses by level and speaking courses (prices to confirm).
    for (const [name, color] of languages)
      if (!one("SELECT id FROM programs WHERE name=?", name))
        insert("programs", {
          name,
          category: "Languages",
          description:
            "Cours par niveaux (débutant à avancé), en petits groupes. Tarif à confirmer par la direction.",
          duration: "Selon le niveau",
          price: 0,
          currency: "DZD",
          color,
        });

    // Specialists receive Sunday to Thursday, 8:00 to 17:00
    // (weekday 0 = Monday … 6 = Sunday).
    for (const u of all(
      "SELECT id FROM users WHERE active=1 AND role='instructor'",
    ))
      if (!one("SELECT id FROM staff_hours WHERE user_id=?", u.id))
        for (const d of [6, 0, 1, 2, 3])
          insert("staff_hours", {
            user_id: u.id,
            weekday: d,
            start_min: 480,
            end_min: 1020,
          });

    // Bot answers.
    for (const [question, answer, answer_ar] of kb)
      run(
        "UPDATE kb_articles SET answer=?, answer_ar=? WHERE question=?",
        answer,
        answer_ar,
        question,
      );
    for (const [question, answer, answer_ar, keywords] of kbNew)
      if (!one("SELECT id FROM kb_articles WHERE question=?", question))
        insert("kb_articles", {
          question,
          answer,
          answer_ar,
          keywords,
          created_at: now(),
        });

    // Training discounts.
    for (const [code, percent] of promo)
      run(
        "INSERT OR IGNORE INTO promo_codes (code, percent, amount, max_uses, used, expires_on, active, created_at) VALUES (?, ?, 0, 0, 0, '', 1, ?)",
        code,
        percent,
        now(),
      );

    run("INSERT INTO meta (key, value) VALUES (?, ?)", VERSION, now());
  });
}
