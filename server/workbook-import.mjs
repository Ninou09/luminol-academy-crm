// Import of the full "Luminol Academy CRM Import" workbook (one sheet per object).
// The browser reads the .xlsx file and sends { sheets: { Contacts: [{...}], ... } }.
// Everything runs inside the caller's transaction: either all rows land or none.
import { all, one, run, insert, now, hashPassword } from "./db.mjs";
import { randomBytes } from "node:crypto";

const str = (v, max = 4000) =>
  v === null || v === undefined
    ? ""
    : String(v).replace(/\s+/g, " ").trim().slice(0, max);
const yes = (v) => v === true || /^(yes|true|1|oui|نعم)$/i.test(str(v));
// Excel dates arrive as ISO strings (or serial numbers from some readers).
function day(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number")
    return new Date(Math.round((v - 25569) * 86400000))
      .toISOString()
      .slice(0, 10);
  const m = str(v).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}
function stamp(v, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "number")
    return new Date(Math.round((v - 25569) * 86400000)).toISOString();
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}
function phone(v) {
  let p = str(v, 40)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[\s().\-‎‏]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^0[567]\d{8}$/.test(p)) p = "+213" + p.slice(1);
  if (/^[567]\d{8}$/.test(p)) p = "+213" + p;
  if (/^213[567]\d{8}$/.test(p)) p = "+" + p;
  return p;
}
const money = (dzd) => Math.max(0, Math.round(Number(dzd) || 0)) * 100;
const rowsOf = (sheets, name) =>
  (Array.isArray(sheets?.[name]) ? sheets[name] : []).filter(
    (r) =>
      r &&
      typeof r === "object" &&
      Object.values(r).some((v) => v !== null && v !== ""),
  );

// Labels shown to French-speaking staff for the workbook's status codes.
const contactTypes = {
  lead: "Prospect",
  course_participant: "Participant(e) à une formation",
  social_course_enquiry: "Demande via les réseaux sociaux",
  enquiry: "Demande",
};
const paymentLabels = {
  paid_owner_verified: "Payé (vérifié)",
  payment_not_verified: "Paiement non vérifié",
  payment_pending_owner_allowed_entry: "Paiement en attente (accès autorisé)",
  physical_payment_promised: "Paiement sur place promis",
  guest_no_payment_required: "Invité(e), sans paiement",
};
const categoryOf = {
  free: "Rencontres gratuites",
  professional: "Formation professionnelle",
  family: "Ateliers pour les familles",
  service: "Consultations",
};
const colors = ["teal", "blue", "purple", "amber", "rose", "green"];

export function importWorkbook(sheets, me) {
  const counts = {};
  const bump = (k, n = 1) => (counts[k] = (counts[k] || 0) + n);
  const today = now();
  const company = rowsOf(sheets, "Company")[0] || {};
  const settings = one("SELECT * FROM settings WHERE id=1");

  // 1. Academy profile ------------------------------------------------------
  if (company.company_name)
    run(
      "UPDATE settings SET academy=?, currency=?, timezone=? WHERE id=1",
      str(company.company_name, 120),
      str(company.operating_currency, 3).toUpperCase() || settings.currency,
      str(company.timezone, 60) || settings.timezone,
    );
  const profile = {
    company,
    channels: rowsOf(sheets, "Channels"),
    payment_methods: rowsOf(sheets, "Payment_Methods"),
    knowledge: rowsOf(sheets, "Knowledge"),
    resources: rowsOf(sheets, "Resources"),
    ad_campaigns: rowsOf(sheets, "Campaigns"),
    imported_at: today,
  };
  run(
    "INSERT INTO meta (key,value) VALUES ('academy_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(profile),
  );

  // Payment instructions become a ready WhatsApp template (internal use only).
  const methods = profile.payment_methods
    .map((m) =>
      [
        str(m.method),
        str(m.beneficiary),
        str(m.account_number) +
          (m.account_key ? ` clé ${str(m.account_key)}` : ""),
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean);
  if (methods.length) {
    run("DELETE FROM message_templates WHERE name='Coordonnées de paiement'");
    insert("message_templates", {
      name: "Coordonnées de paiement",
      body: `Bonjour {name}, voici les coordonnées pour régler {course} ({amount}) :\n${methods.join("\n")}\nMerci d'envoyer la preuve de paiement. / مرحبا {name}، هذه معلومات الدفع لـ {course}. يرجى إرسال وصل الدفع.`,
      sort: 5,
    });
    bump("templates");
  }

  // 2. Team -----------------------------------------------------------------
  const staffByKey = new Map();
  const admin = one("SELECT * FROM users WHERE id=?", me);
  for (const t of rowsOf(sheets, "Team")) {
    const key = str(t.person_id, 60);
    const relation = str(t.relationship).toLowerCase();
    if (/owner/.test(relation)) {
      // The owner is the admin account that runs the import.
      if (admin?.name === "Academy Admin" && str(t.full_name))
        run("UPDATE users SET name=? WHERE id=?", str(t.full_name, 100), me);
      staffByKey.set(key, me);
      continue;
    }
    const name = str(t.full_name, 100) || str(t.name_ar, 100);
    if (!name) continue;
    const email =
      str(t.email, 254).toLowerCase() ||
      `${key.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@staff.luminol.local`;
    const past = /past/.test(relation);
    const existing = one(
      "SELECT id FROM users WHERE email=? OR name=? OR name LIKE ?",
      email,
      name,
      `${name} ·%`,
    );
    const id = existing
      ? existing.id
      : insert("users", {
          name: t.name_ar ? `${name} · ${str(t.name_ar, 60)}` : name,
          email,
          role: "instructor",
          // Nobody knows this password: the admin sets a real one before first login.
          password_hash: hashPassword(randomBytes(24).toString("base64url")),
          active: past ? 0 : 1,
          phone: phone(t.phone),
          public_title: str(t.public_title, 80),
        });
    staffByKey.set(key, id);
    staffByKey.set(str(t.name_ar), id);
    if (!existing) bump("staff");
  }
  const trainerId = (label) => {
    const s = str(label);
    for (const [k, id] of staffByKey) if (k && s.includes(k)) return id;
    return null;
  };

  // 3. Programmes (services + courses) and their groups -----------------------
  const programByKey = new Map();
  const cohortByKey = new Map();
  let colorIndex = 0;
  const resourcesFor = (courseId) =>
    profile.resources
      .filter((r) => str(r.course_id) === courseId && r.url)
      .map(
        (r) => `${str(r.resource_type)} — ${str(r.title)} : ${str(r.url, 500)}`,
      );
  for (const s of rowsOf(sheets, "Services")) {
    const key = str(s.service_id, 60);
    if (["PROFESSIONAL-TRAINING", "FREE-EDUCATION"].includes(key)) continue; // umbrella categories
    const min = Number(s.min_price_dzd) || 0;
    const max = Number(s.max_price_dzd) || 0;
    const known = one(
      "SELECT id FROM programs WHERE name=?",
      str(s.name_ar, 120) || key,
    );
    if (known) {
      programByKey.set(key, known.id);
      continue;
    }
    const id = insert("programs", {
      name: str(s.name_ar, 120) || key,
      category: "Consultations",
      description: [
        str(s.audience),
        str(s.delivery),
        min || max
          ? `Tarif : ${min}${max && max !== min ? `–${max}` : ""} DA selon le spécialiste.`
          : "",
        str(s.details),
        s.booking_url ? `Lien de demande : ${str(s.booking_url, 500)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000),
      duration: "Séance",
      price: money(min),
      currency: "DZD",
      color: colors[colorIndex++ % colors.length],
    });
    programByKey.set(key, id);
    bump("programs");
  }
  if (programByKey.has("CONSULTATIONS"))
    programByKey.set("CONSULTATION-REQUEST", programByKey.get("CONSULTATIONS"));

  const todayDay = today.slice(0, 10);
  for (const c of rowsOf(sheets, "Courses")) {
    const key = str(c.course_id, 60);
    if (programByKey.has(key)) continue;
    const hours = Number(c.planned_duration_hours) || 0;
    const dates = (
      str(c.session_dates).match(/\d{4}-\d{2}-\d{2}/g) || []
    ).sort();
    const proposal =
      /proposal/.test(str(c.price_status)) || /proposal/.test(str(c.status));
    const knownProgram = one(
      "SELECT id FROM programs WHERE description LIKE ? OR name=?",
      `%Réf. ${key}`,
      str(c.title_ar, 120) || key,
    );
    const id = knownProgram
      ? knownProgram.id
      : insert("programs", {
          name: str(c.title_ar, 120) || key,
          category: categoryOf[str(c.offer_type)] || "Formation",
          description: [
            proposal ? "Proposition — date et prix à confirmer." : "",
            str(c.schedule_algeria)
              ? `Horaire (Alger) : ${str(c.schedule_algeria)}`
              : "",
            str(c.delivery) ? `Format : ${str(c.delivery)}` : "",
            str(c.audience) ? `Public : ${str(c.audience)}` : "",
            str(c.topics_outcomes),
            str(c.certificate_status) &&
            c.certificate_status !== "not_confirmed"
              ? `Certificat : ${str(c.certificate_status)}`
              : "",
            str(c.registration_url)
              ? `Inscription : ${str(c.registration_url, 500)}`
              : "",
            ...resourcesFor(key),
            str(c.notes),
            `Réf. ${key}`,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000),
          duration: hours
            ? `${dates.length > 1 ? `${dates.length} séances · ` : ""}${hours} h`
            : dates.length > 1
              ? `${dates.length} séances`
              : "À définir",
          price: money(c.price_dzd),
          currency: "DZD",
          color: colors[colorIndex++ % colors.length],
        });
    programByKey.set(key, id);
    if (!knownProgram) bump("programs");
    const start = day(c.first_session_date) || dates[0];
    if (!start) continue;
    const end = dates[dates.length - 1] || start;
    const cohortName = `${str(c.title_ar, 80) || key} · ${start}`;
    const knownCohort = one(
      "SELECT id FROM cohorts WHERE program_id=? AND name=?",
      id,
      cohortName,
    );
    if (knownCohort) {
      cohortByKey.set(key, { id: knownCohort.id, end, past: end < todayDay });
      continue;
    }
    const cohortId = insert("cohorts", {
      program_id: id,
      name: cohortName,
      instructor_id: trainerId(c.trainer),
      capacity: 30,
      start_date: start,
      end_date: end < start ? start : end,
      room: /zoom|online/i.test(str(c.delivery)) ? "Zoom" : "",
      status: proposal ? "Planned" : end < todayDay ? "Completed" : "Active",
    });
    cohortByKey.set(key, { id: cohortId, end, past: end < todayDay });
    bump("groups");
    // Past sessions with a known start time go to the calendar history.
    const schedule = str(c.schedule_algeria);
    const time = schedule.match(/(\d{1,2}):(\d{2})/);
    const until = schedule.match(/\d{1,2}:\d{2}\s*[–-]\s*(\d{1,2}):(\d{2})/);
    if (time && !proposal && dates.length) {
      const first = dates[0];
      const startsAt = new Date(
        `${first}T${time[1].padStart(2, "0")}:${time[2]}:00+01:00`,
      );
      const minutes = until
        ? (Number(until[1]) * 60 +
            Number(until[2]) -
            Number(time[1]) * 60 -
            Number(time[2]) +
            1440) %
            1440 || 60
        : Math.round((dates.length === 1 && hours ? hours : 1.25) * 60);
      insert("appointments", {
        kind: "Group session",
        title: str(c.title_ar, 120) || key,
        contact_id: null,
        staff_id: trainerId(c.trainer),
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + minutes * 60000).toISOString(),
        location: /zoom/i.test(str(c.delivery)) ? "Zoom" : "",
        notes: `Réf. ${key}`,
        status: first < todayDay ? "Done" : "Scheduled",
        source: "import",
        created_at: today,
      });
      bump("calendar");
    }
  }

  // 4. Contacts ----------------------------------------------------------------
  const contactByKey = new Map();
  const byPhone = new Map();
  const existingByPhone = new Map();
  for (const row of all("SELECT id, phone FROM contacts WHERE phone<>''"))
    existingByPhone.set(phone(row.phone), row.id);
  for (const c of rowsOf(sheets, "Contacts")) {
    const key = str(c.contact_id, 60);
    const name = str(c.full_name, 100) || str(c.alternate_names, 100);
    if (!name) continue;
    const p = phone(c.phone || c.phone_raw);
    if (p && byPhone.has(p)) {
      contactByKey.set(key, byPhone.get(p));
      continue;
    }
    const known =
      (p && existingByPhone.get(p)) ||
      one("SELECT id FROM contacts WHERE notes LIKE ?", `%Réf. ${key}`)?.id ||
      (!p &&
        str(c.email) &&
        one(
          "SELECT id FROM contacts WHERE email=?",
          str(c.email, 254).toLowerCase(),
        )?.id);
    if (known) {
      contactByKey.set(key, known);
      if (p) byPhone.set(p, known);
      continue;
    }
    const hold = yes(c.do_not_contact);
    let email = str(c.email, 254).toLowerCase();
    const sharedEmail =
      email && one("SELECT name FROM contacts WHERE email=?", email);
    if (sharedEmail) email = ""; // the CRM keeps one contact per e-mail
    const notes = [
      hold
        ? `⚠ NE PAS CONTACTER${c.contact_hold_reason ? ` : ${str(c.contact_hold_reason)}` : ""}`
        : "",
      yes(c.identity_review_needed)
        ? "⚠ Identité à vérifier (doublon possible)."
        : "",
      contactTypes[str(c.contact_type)] || str(c.contact_type),
      str(c.professional_role) ? `Profil : ${str(c.professional_role)}` : "",
      str(c.city_wilaya) ? `Wilaya : ${str(c.city_wilaya)}` : "",
      str(c.preferred_channel)
        ? `Canal préféré : ${str(c.preferred_channel)}`
        : "",
      paymentLabels[str(c.payment_status)]
        ? `Paiement : ${paymentLabels[str(c.payment_status)]}`
        : "",
      str(c.alternate_names) ? `Autres noms : ${str(c.alternate_names)}` : "",
      sharedEmail
        ? `E-mail ${str(c.email)} (déjà utilisé par ${sharedEmail.name}).`
        : "",
      str(c.alternate_emails)
        ? `Autres e-mails : ${str(c.alternate_emails)}`
        : "",
      yes(c.recording_sent)
        ? `Enregistrement envoyé${day(c.recording_sent_on) ? ` le ${day(c.recording_sent_on)}` : ""}.`
        : "",
      str(c.notes),
      `Source : ${str(c.source_platform) || "Import"} · Réf. ${key}`,
    ]
      .filter(Boolean)
      .join("\n");
    const id = insert("contacts", {
      name,
      email,
      phone: p,
      language: "العربية",
      consent:
        !hold && str(c.marketing_consent).toLowerCase() === "yes" ? 1 : 0,
      guardian: "",
      notes: notes.slice(0, 4000),
      created_at: stamp(c.first_seen_at, stamp(c.data_as_of, today)),
    });
    contactByKey.set(key, id);
    if (p) byPhone.set(p, id);
    bump("contacts");
  }

  // 5. Registrations ---------------------------------------------------------
  const enrolled = new Set();
  const stageFor = {
    request_received: "New inquiry",
    details_sent_awaiting_reply: "Contacted",
    interested_payment_details_sent: "Awaiting payment",
    declined_this_cohort: "Lost",
    waitlist_offer_postponed: "Nurture",
  };
  const participant = [
    "confirmed_participant",
    "owner_authorized_participant",
    "invited_guest",
  ];
  for (const e of rowsOf(sheets, "Enrollments")) {
    const contactId = contactByKey.get(str(e.contact_id));
    if (!contactId) continue;
    const course = str(e.course_id);
    const programId = programByKey.get(course) ?? null;
    const cohort = cohortByKey.get(course);
    const status = str(e.status);
    const type = str(e.record_type);
    const created = stamp(e.submitted_at, today);
    const extra = [
      str(e.participation_mode) ? `Mode : ${str(e.participation_mode)}` : "",
      str(e.lead_source) ? `Connu via : ${str(e.lead_source)}` : "",
      paymentLabels[str(e.payment_status)]
        ? `Paiement : ${paymentLabels[str(e.payment_status)]}`
        : "",
      str(e.notes),
    ]
      .filter(Boolean)
      .join(" · ");
    if (type === "feedback") {
      const text =
        `Avis envoyé sur « ${course} » (formulaire ${str(e.form_id)}).${extra ? " " + extra : ""}`.slice(
          0,
          2000,
        );
      if (
        one(
          "SELECT id FROM activities WHERE contact_id=? AND text=?",
          contactId,
          text,
        )
      )
        continue;
      insert("activities", {
        contact_id: contactId,
        user_id: me,
        kind: "feedback",
        text,
        visibility: "general",
        created_at: created,
      });
      bump("feedback");
      continue;
    }
    const isParticipant =
      participant.includes(status) || (type === "free_registration" && cohort);
    if (isParticipant && cohort) {
      const k = `${contactId}:${cohort.id}`;
      if (enrolled.has(k)) continue;
      enrolled.add(k);
      if (
        one(
          "SELECT id FROM enrollments WHERE contact_id=? AND cohort_id=?",
          contactId,
          cohort.id,
        )
      )
        continue;
      const enrollmentId = insert("enrollments", {
        contact_id: contactId,
        cohort_id: cohort.id,
        opportunity_id: null,
        status: cohort.past ? "Completed" : "Active",
        created_at: created,
        level: "",
        completed_at: cohort.past ? cohort.end : "",
      });
      bump("enrollments");
      const price = money(e.course_price_dzd);
      if (price > 0 && status !== "invited_guest") {
        const chargeId = insert("charges", {
          contact_id: contactId,
          enrollment_id: enrollmentId,
          label: `${one("SELECT name FROM programs WHERE id=?", programId)?.name || course} · Inscription`,
          amount: price,
          discount: 0,
          discount_reason: "",
          currency: "DZD",
          due_date: cohort.end,
          created_at: created,
        });
        bump("charges");
        const paid = money(e.amount_paid_dzd);
        if (str(e.payment_status) === "paid_owner_verified" && paid > 0) {
          insert("payments", {
            charge_id: chargeId,
            amount: Math.min(paid, price),
            method: "Bank transfer",
            reference: "Vérifié par la direction (import)",
            created_at: created,
            user_id: me,
            receipt_no: 0,
          });
          bump("payments");
        }
      }
      if (extra)
        insert("activities", {
          contact_id: contactId,
          user_id: me,
          kind: "enrollment",
          text: extra.slice(0, 2000),
          visibility: "general",
          created_at: created,
        });
      continue;
    }
    const requestKey = `${contactId}:${course}`;
    if (enrolled.has(requestKey)) continue;
    enrolled.add(requestKey);
    if (
      one(
        "SELECT id FROM opportunities WHERE contact_id=? AND COALESCE(program_id,0)=?",
        contactId,
        programId ?? 0,
      )
    )
      continue;
    const consultation =
      course === "CONSULTATION-REQUEST" || type === "appointment_request";
    insert("opportunities", {
      contact_id: contactId,
      program_id: programId,
      owner_id: me,
      service_type: consultation ? "Psychology consultation" : "Course",
      interest:
        one("SELECT name FROM programs WHERE id=?", programId)?.name || course,
      stage: stageFor[status] || "New inquiry",
      source:
        str(e.lead_source, 100) || str(e.source_platform, 100) || "Import",
      campaign: "",
      tags: "import",
      expected_date: cohort ? cohortDate(cohort) : "",
      reason:
        status === "declined_this_cohort" ? "A décliné cette session." : "",
      notes: extra.slice(0, 4000),
      created_at: created,
      stage_at: stamp(e.as_of, created),
    });
    bump("requests");
  }

  // 6. History, tasks --------------------------------------------------------
  for (const a of rowsOf(sheets, "Activities")) {
    const contactId = contactByKey.get(str(a.contact_id)) ?? null;
    const what =
      str(a.activity_type) === "recording_shared"
        ? "Enregistrement envoyé"
        : str(a.activity_type);
    const text =
      `${what} via ${str(a.channel)}${contactId ? "" : ` à « ${str(a.destination)} »`} : ${str(a.resource_url, 500)}${a.notes ? ` — ${str(a.notes)}` : ""}`.slice(
        0,
        2000,
      );
    if (
      one(
        "SELECT id FROM activities WHERE COALESCE(contact_id,0)=? AND text=?",
        contactId ?? 0,
        text,
      )
    )
      continue;
    insert("activities", {
      contact_id: contactId,
      user_id: me,
      kind: "communication",
      text,
      visibility: "general",
      created_at: stamp(a.activity_date, today),
    });
    bump("history");
  }
  for (const t of rowsOf(sheets, "Tasks")) {
    const title = str(t.task, 200);
    if (!title) continue;
    const fullTitle = (t.notes ? `${title} — ${str(t.notes)}` : title).slice(
      0,
      500,
    );
    if (one("SELECT id FROM tasks WHERE title=?", fullTitle)) continue;
    insert("tasks", {
      contact_id: null,
      owner_id: me,
      title: fullTitle,
      due_at: day(t.due_date) ? `${day(t.due_date)}T09:00:00.000Z` : today,
      priority: /high/i.test(str(t.priority)) ? "High" : "Normal",
      status: "Open",
      created_at: today,
    });
    bump("tasks");
  }

  // Website/Google leads already present as contacts are marked as handled.
  for (const lead of all(
    "SELECT id, phone FROM incoming_inquiries WHERE status='Pending'",
  )) {
    const p = phone(lead.phone);
    if (p && byPhone.has(p))
      run(
        "UPDATE incoming_inquiries SET status='Converted', version=version+1 WHERE id=?",
        lead.id,
      );
  }
  if (admin) counts.admin = admin.email;
  return counts;
}
function cohortDate(cohort) {
  return (
    one("SELECT start_date FROM cohorts WHERE id=?", cohort.id)?.start_date ||
    ""
  );
}
