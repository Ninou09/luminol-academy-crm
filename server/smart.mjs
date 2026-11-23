/**
 * Staff assistant "Demander à Luminol" and the client bot.
 * Free by default: answers come from the CRM data, the built-in help and the
 * knowledge base. With a Claude key (and within the monthly limit) answers
 * are written by Claude with read-only tools. Psychologist notes, intake
 * answers and medical data are never read by either engine.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { all, one, run, insert, transaction, audit, now } from "./db.mjs";
import { helpArticles } from "./help.mjs";
import { freeSlots } from "./booking.mjs";
import { sendWhatsApp, whatsappConfigured } from "./integrations.mjs";

const day = 86400000;
const settings = () => one("SELECT * FROM settings WHERE id=1");
const str = (v, max = 2000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);

/** Lower case, no accents, Arabic letters unified: for keyword matching. */
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s@+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const isArabic = (s) => /[؀-ۿ]/.test(s);
const words = (s) =>
  normalize(s)
    .split(" ")
    .filter((w) => w.length > 1);
/** Two words match when equal or one starts with the other (tolerant of plurals). */
const near = (a, b) =>
  a === b ||
  (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));

// AI budget -------------------------------------------------------------------
export function aiAvailable() {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const s = settings();
  if (!s.ai_enabled) return false;
  return monthTokens() < (s.ai_monthly_tokens || 0);
}
export function monthTokens() {
  const month = now().slice(0, 7);
  return (
    one(
      "SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM ai_usage WHERE substr(created_at,1,7)=?",
      month,
    )?.n || 0
  );
}
export function recordUsage(userId, feature, usage) {
  try {
    insert("ai_usage", {
      user_id: userId ?? null,
      feature,
      input_tokens:
        (usage?.input_tokens || 0) +
        (usage?.cache_read_input_tokens || 0) +
        (usage?.cache_creation_input_tokens || 0),
      output_tokens: usage?.output_tokens || 0,
      created_at: now(),
    });
  } catch {
    /* never blocks an answer */
  }
}
let client = null;
const claude = () => (client ??= new Anthropic());

// Staff assistant: free engine ------------------------------------------------
const monthNames = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  جانفي: 1,
  يناير: 1,
  فيفري: 2,
  فبراير: 2,
  مارس: 3,
  افريل: 4,
  ابريل: 4,
  ماي: 5,
  مايو: 5,
  جوان: 6,
  يونيو: 6,
  جويليه: 7,
  يوليو: 7,
  اوت: 8,
  اغسطس: 8,
  سبتمبر: 9,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};
function period(q, today) {
  const n = normalize(q);
  const y = Number(today.slice(0, 4));
  for (const [name, m] of Object.entries(monthNames))
    if (n.split(" ").includes(name)) {
      const year = m > Number(today.slice(5, 7)) ? y - 1 : y;
      const from = `${year}-${String(m).padStart(2, "0")}-01`;
      const to = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
      return { from, to, label: name };
    }
  if (/aujourd|today|اليوم|lyoum|lyom/.test(n))
    return { from: today, to: today, label: "today" };
  if (/hier|yesterday|البارح|امس/.test(n)) {
    const d = new Date(Date.parse(today) - day).toISOString().slice(0, 10);
    return { from: d, to: d, label: "yesterday" };
  }
  if (/semaine|week|اسبوع|سمانه/.test(n))
    return {
      from: new Date(Date.parse(today) - 6 * day).toISOString().slice(0, 10),
      to: today,
      label: "week",
    };
  if (/annee|year|عام|سنه/.test(n))
    return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "year" };
  return { from: `${today.slice(0, 7)}-01`, to: today, label: "month" };
}
const inPeriod = (iso, p) =>
  iso && iso.slice(0, 10) >= p.from && iso.slice(0, 10) <= p.to;
const money = (cents, cur) =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} ${cur === "DZD" ? "DA" : cur}`;
const frDate = (iso, tz) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Find clients named in the question. */
function namedClients(q, s) {
  const qw = words(q);
  return s.contacts
    .map((c) => {
      const cw = words(c.name);
      const hits = cw.filter(
        (w) => w.length > 2 && qw.some((x) => near(x, w)),
      ).length;
      return { c, hits, all: hits === cw.length };
    })
    .filter(
      (x) => x.hits >= Math.min(2, words(x.c.name).length) || (x.all && x.hits),
    )
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.c)
    .slice(0, 5);
}
function namedStaff(q, s) {
  const qw = words(q);
  return s.users.filter((u) =>
    words(u.name).some(
      (w) => w.length > 2 && !["dr"].includes(w) && qw.some((x) => near(x, w)),
    ),
  );
}
function clientOverview(c, s) {
  const tz = s.settings.timezone;
  const appts = s.appointments.filter((a) => a.contact_id === c.id);
  const next = appts.filter(
    (a) => a.starts_at > now() && ["Scheduled", "Pending"].includes(a.status),
  )[0];
  const done = appts.filter((a) => a.status === "Done").length;
  const missed = appts.filter((a) => a.status === "No-show").length;
  const due = s.charges.filter((x) => x.contact_id === c.id && x.balance > 0);
  const opp = s.opportunities.filter((o) => o.contact_id === c.id).slice(-1)[0];
  const groups = s.enrollments
    .filter((e) => e.contact_id === c.id && e.status === "Active")
    .map((e) => s.cohorts.find((h) => h.id === e.cohort_id)?.name)
    .filter(Boolean);
  const lines = [
    `**${c.name}**${c.phone ? ` · ${c.phone}` : ""}`,
    `${done} séance(s) faite(s)${missed ? `, ${missed} absence(s)` : ""}.`,
    next
      ? `Prochain rendez-vous : ${frDate(next.starts_at, tz)} — ${next.title}.`
      : "Aucun rendez-vous à venir.",
  ];
  if (groups.length) lines.push(`Groupe(s) : ${groups.join(", ")}.`);
  if (s.permissions.editFinance)
    lines.push(
      due.length
        ? `Reste à payer : ${money(
            due.reduce((n, x) => n + x.balance, 0),
            s.settings.currency,
          )}.`
        : "Rien à payer.",
    );
  if (opp)
    lines.push(
      `Dernière demande : ${opp.interest || opp.service_type} (${opp.stage}).`,
    );
  return lines.join("\n");
}
function helpSearch(q, limit = 2) {
  const qw = words(q);
  return helpArticles
    .map((a) => {
      const kw = words(`${a.title} ${a.keywords}`);
      return {
        a,
        score: qw.filter((w) => w.length > 2 && kw.some((k) => near(w, k)))
          .length,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.a);
}
const linkOf = (a) => ({
  label: a.title,
  page: a.page,
  filter: a.filter || "",
});

export function localAnswer(question, s) {
  const q = str(question, 1000);
  const n = normalize(q);
  const tz = s.settings.timezone;
  const today = s.today;
  const cur = s.settings.currency;
  const p = period(q, today);
  const how =
    /comment|how|كيف|kifach|kifah|ou trouver|ou est|where|اين|وين/.test(n);

  // Create a task: "rappelle-moi d'appeler Amina demain"
  if (
    /rappel(le)? moi|cree(r)? (une )?tache|ajoute(r)? (une )?tache|remind me|create a task|ذكرني|مهمه/.test(
      n,
    )
  ) {
    const c = namedClients(q, s)[0];
    const tomorrow = /demain|tomorrow|غدا|غدوه/.test(n);
    const due = new Date(Date.now() + (tomorrow ? day : 0)).toISOString();
    const title =
      q
        .replace(
          /^(rappelle[- ]moi( de| d')?|cr[ée]+r? une t[âa]che( pour)?|remind me to|ذكرني)\s*/i,
          "",
        )
        .slice(0, 150) || "Tâche";
    return {
      text: `Je prépare cette tâche${c ? ` pour **${c.name}**` : ""}. Vérifiez puis confirmez.`,
      actions: [
        { type: "task", title, contact_id: c?.id ?? null, due_at: due },
      ],
    };
  }
  // Who has not paid
  if (
    /impaye|pas paye|non paye|n a pas paye|not paid|has not paid|doit|dette|retard de paiement|owe|unpaid|debt|لم يدفع|ما خلصش|ما خلص|ديون|دين|مازال ما/.test(
      n,
    )
  ) {
    if (!s.permissions.editFinance)
      return { text: "Votre accès ne comprend pas les paiements." };
    const late = s.charges.filter(
      (c) =>
        c.balance > 0 &&
        c.due_date <= today &&
        (p.label === "month" && !/mois|month|شهر/.test(n)
          ? true
          : inPeriod(c.due_date, p)),
    );
    const by = {};
    for (const c of late)
      by[c.contact_id] = (by[c.contact_id] || 0) + c.balance;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    if (!rows.length)
      return { text: "Personne n'est en retard de paiement. 👍" };
    return {
      text: `${rows.length} client(s) en retard, total ${money(
        rows.reduce((t, r) => t + r[1], 0),
        cur,
      )} :\n${rows
        .slice(0, 10)
        .map(
          ([id, v]) =>
            `• ${s.contacts.find((c) => c.id === Number(id))?.name || "—"} — ${money(v, cur)}`,
        )
        .join("\n")}`,
      links: [{ label: "Dettes", page: "Payments", filter: "Who owes what" }],
      contacts: rows.slice(0, 10).map(([id]) => Number(id)),
    };
  }
  // Free time of a specialist
  if (
    /libre|disponib|creneau|place|free|slot|available|فارغ|متاح|وقت/.test(n) &&
    !how
  ) {
    const staff = namedStaff(q, s);
    const list = staff.length
      ? staff
      : s.users.filter(
          (u) => u.active && ["instructor", "academic"].includes(u.role),
        );
    let date = today;
    if (/demain|tomorrow|غدا|غدوه/.test(n))
      date = new Date(Date.parse(today) + day).toISOString().slice(0, 10);
    const wd = [
      "dimanche",
      "lundi",
      "mardi",
      "mercredi",
      "jeudi",
      "vendredi",
      "samedi",
    ];
    const wdAr = [
      "الاحد",
      "الاثنين",
      "الثلاثاء",
      "الاربعاء",
      "الخميس",
      "الجمعه",
      "السبت",
    ];
    for (let i = 0; i < 7; i++)
      if (n.includes(wd[i]) || n.includes(wdAr[i]) || n.includes(wdEn[i])) {
        for (let k = 0; k < 7; k++) {
          const d = new Date(Date.parse(today) + k * day);
          if (d.getUTCDay() === i) {
            date = d.toISOString().slice(0, 10);
            break;
          }
        }
      }
    const lines = list.slice(0, 4).map((u) => {
      const slots = freeSlots(u.id, date, 60);
      const hh = (m) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      return `• ${u.name} : ${slots.length ? slots.slice(0, 6).map(hh).join(", ") : "pas de créneau (ou horaires non remplis)"}`;
    });
    return {
      text: `Créneaux libres d'une heure le ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z"))} :\n${lines.join("\n")}`,
      links: [{ label: "Agenda", page: "Calendar", filter: "" }],
    };
  }
  // Agenda
  if (
    /agenda|rendez|rdv|planning|programme du jour|appointment|schedule|موعد|مواعيد|رونديفو/.test(
      n,
    ) &&
    !how
  ) {
    const tomorrow = /demain|tomorrow|غدا|غدوه/.test(n);
    const d = tomorrow
      ? new Date(Date.parse(today) + day).toISOString().slice(0, 10)
      : today;
    const local = (iso) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
    const staff = namedStaff(q, s);
    const list = s.appointments
      .filter((a) => local(a.starts_at) === d && a.status !== "Cancelled")
      .filter((a) => !staff.length || staff.some((u) => u.id === a.staff_id))
      .filter(
        (a) =>
          s.user.role !== "instructor" ||
          a.staff_id === s.user.id ||
          /tout|all|كل/.test(n) === false,
      );
    if (!list.length)
      return {
        text: `Aucun rendez-vous ${tomorrow ? "demain" : "aujourd'hui"}.`,
        links: [{ label: "Agenda", page: "Calendar" }],
      };
    return {
      text: `${list.length} rendez-vous ${tomorrow ? "demain" : "aujourd'hui"} :\n${list
        .slice(0, 12)
        .map(
          (a) =>
            `• ${new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(a.starts_at))} — ${s.contacts.find((c) => c.id === a.contact_id)?.name || a.title} (${s.users.find((u) => u.id === a.staff_id)?.name || "—"})`,
        )
        .join("\n")}`,
      links: [{ label: "Agenda", page: "Calendar" }],
    };
  }
  // Numbers: "combien de nouveaux clients d'Instagram en novembre ?"
  if (
    /combien|how many|how much|nombre|total|chiffre|كم|شحال|قداش|بشحال/.test(n)
  ) {
    const source = [
      "instagram",
      "facebook",
      "whatsapp",
      "site",
      "website",
      "google",
      "tiktok",
      "referral",
      "bouche",
      "formulaire",
    ].find((x) => n.includes(x));
    if (
      /encaiss|argent|recette|chiffre d affaire|revenu|revenue|paye|paiement|money|مدخول|فلوس|دراهم|مداخيل/.test(
        n,
      )
    ) {
      if (!s.permissions.finance)
        return { text: "Votre accès ne comprend pas les finances." };
      const total = s.payments
        .filter((x) => inPeriod(x.created_at, p))
        .reduce((t, x) => t + x.amount, 0);
      return {
        text: `Encaissé sur la période (${p.from} → ${p.to}) : **${money(total, cur)}**.`,
        links: [
          {
            label: "Analyse financière",
            page: "Payments",
            filter: "Financial analytics",
          },
        ],
      };
    }
    if (/rendez|rdv|consultation|seance|appointment|session|موعد|حصه/.test(n)) {
      const list = s.appointments.filter((a) => inPeriod(a.starts_at, p));
      return {
        text: `${list.length} rendez-vous du ${p.from} au ${p.to} : ${list.filter((a) => a.status === "Done").length} faits, ${list.filter((a) => a.status === "No-show").length} absences, ${list.filter((a) => a.status === "Cancelled").length} annulés.`,
      };
    }
    if (/demande|prospect|lead|inquir|طلب/.test(n)) {
      const list = s.opportunities.filter(
        (o) =>
          inPeriod(o.created_at, p) &&
          (!source || normalize(o.source).includes(source)),
      );
      return {
        text: `${list.length} demande(s)${source ? ` venant de ${source}` : ""} du ${p.from} au ${p.to}, dont ${list.filter((o) => o.stage === "Enrolled").length} devenue(s) client(s).`,
      };
    }
    const clients = s.contacts.filter((c) => inPeriod(c.created_at, p));
    const filtered = source
      ? clients.filter((c) =>
          s.opportunities.some(
            (o) =>
              o.contact_id === c.id && normalize(o.source).includes(source),
          ),
        )
      : clients;
    return {
      text: `${filtered.length} nouveau(x) client(s)${source ? ` venant de ${source}` : ""} du ${p.from} au ${p.to}.`,
      links: [{ label: "Rapports", page: "Reports" }],
    };
  }
  // New requests
  if (
    /nouvelles demandes|demandes en attente|sans reponse|new request|طلبات جديده/.test(
      n,
    )
  ) {
    const list = s.opportunities.filter((o) => o.stage === "New inquiry");
    return {
      text: list.length
        ? `${list.length} nouvelle(s) demande(s) :\n${list
            .slice(0, 10)
            .map(
              (o) =>
                `• ${s.contacts.find((c) => c.id === o.contact_id)?.name || "—"} — ${o.interest || o.service_type} (${o.source})`,
            )
            .join("\n")}`
        : "Aucune nouvelle demande.",
      links: [{ label: "Demandes", page: "Admissions" }],
    };
  }
  // A client by name
  if (!how) {
    const found = namedClients(q, s);
    if (found.length === 1)
      return { text: clientOverview(found[0], s), contacts: [found[0].id] };
    if (found.length > 1)
      return {
        text: `J'ai trouvé ${found.length} clients :\n${found.map((c) => `• ${c.name}`).join("\n")}`,
        contacts: found.map((c) => c.id),
      };
  }
  // How the CRM works
  const help = helpSearch(q);
  if (help.length)
    return {
      text: help.map((a) => `**${a.title}**\n${a.body}`).join("\n\n"),
      links: help.map(linkOf),
    };
  return {
    text: "Je n'ai pas compris. Essayez par exemple :\n• Qui n'a pas payé ?\n• Mes rendez-vous aujourd'hui\n• Créneaux libres de Sarah jeudi\n• Combien de nouveaux clients d'Instagram en novembre ?\n• Comment créer un scénario ?\n• Le nom d'un client",
    links: [],
  };
}

// Staff assistant: Claude engine (read-only tools) ---------------------------
const tools = [
  {
    name: "search_clients",
    description:
      "Find clients by name, phone or e-mail. Returns id, name, phone.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "client_overview",
    description:
      "Visits, next appointment, groups, amount due and last request of one client. Never includes psychologist notes.",
    input_schema: {
      type: "object",
      properties: { client_id: { type: "integer" } },
      required: ["client_id"],
    },
  },
  {
    name: "agenda",
    description:
      "Appointments on a day (YYYY-MM-DD), optionally for one staff member id.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" }, staff_id: { type: "integer" } },
      required: ["date"],
    },
  },
  {
    name: "unpaid",
    description: "Clients with amounts due and late, with totals.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "stats",
    description:
      "Counts for a period: new clients, requests (by source), appointments (by status), money collected.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "free_slots",
    description: "Free one-hour slots for a staff member on a date.",
    input_schema: {
      type: "object",
      properties: { staff_id: { type: "integer" }, date: { type: "string" } },
      required: ["staff_id", "date"],
    },
  },
  {
    name: "help",
    description: "How to do something in the CRM: returns help pages.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "propose_task",
    description:
      "Propose a task to create. The staff member must confirm it; nothing is created by this tool.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        client_id: { type: "integer" },
        due_date: { type: "string" },
      },
      required: ["title"],
    },
  },
];
function runTool(name, input, s, actions) {
  const id = Number(input?.client_id);
  const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  if (name === "search_clients") {
    const q = normalize(input?.query);
    return s.contacts
      .filter((c) => normalize(`${c.name} ${c.phone} ${c.email}`).includes(q))
      .slice(0, 10)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
  }
  if (name === "client_overview") {
    const c = s.contacts.find((x) => x.id === id);
    return c
      ? clientOverview(c, s)
      : "Client not found or not visible to this user.";
  }
  if (name === "agenda") {
    if (!dateOk(input?.date)) return "Invalid date.";
    const tz = s.settings.timezone;
    const local = (iso) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
    return s.appointments
      .filter(
        (a) =>
          local(a.starts_at) === input.date &&
          (!input.staff_id || a.staff_id === Number(input.staff_id)),
      )
      .map((a) => ({
        time: frDate(a.starts_at, tz),
        title: a.title,
        status: a.status,
        client: s.contacts.find((c) => c.id === a.contact_id)?.name,
        staff: s.users.find((u) => u.id === a.staff_id)?.name,
      }));
  }
  if (name === "unpaid") {
    if (!s.permissions.editFinance) return "This user cannot see payments.";
    return s.charges
      .filter((c) => c.balance > 0 && c.due_date <= s.today)
      .map((c) => ({
        client: s.contacts.find((x) => x.id === c.contact_id)?.name,
        label: c.label,
        remaining: c.balance / 100,
        due: c.due_date,
      }));
  }
  if (name === "stats") {
    if (!dateOk(input?.from) || !dateOk(input?.to)) return "Invalid dates.";
    const p = { from: input.from, to: input.to };
    const bySource = {};
    for (const o of s.opportunities.filter((o) => inPeriod(o.created_at, p)))
      bySource[o.source] = (bySource[o.source] || 0) + 1;
    const byStatus = {};
    for (const a of s.appointments.filter((a) => inPeriod(a.starts_at, p)))
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    return {
      new_clients: s.contacts.filter((c) => inPeriod(c.created_at, p)).length,
      requests_by_source: bySource,
      appointments_by_status: byStatus,
      ...(s.permissions.finance
        ? {
            collected:
              s.payments
                .filter((x) => inPeriod(x.created_at, p))
                .reduce((t, x) => t + x.amount, 0) / 100,
            currency: s.settings.currency,
          }
        : {}),
    };
  }
  if (name === "free_slots") {
    if (!dateOk(input?.date)) return "Invalid date.";
    const u = s.users.find((x) => x.id === Number(input.staff_id));
    if (!u) return "Unknown staff member.";
    return freeSlots(u.id, input.date, 60).map(
      (m) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    );
  }
  if (name === "help")
    return helpSearch(input?.question || "", 3).map((a) => ({
      title: a.title,
      text: a.body,
      page: a.page,
    }));
  if (name === "propose_task") {
    const c = s.contacts.find((x) => x.id === id);
    actions.push({
      type: "task",
      title: str(input?.title, 150),
      contact_id: c?.id ?? null,
      due_at: dateOk(input?.due_date)
        ? `${input.due_date}T08:00:00.000Z`
        : now(),
    });
    return "Proposed. The staff member will confirm it.";
  }
  return "Unknown tool.";
}
const helpText = helpArticles
  .map((a) => `## ${a.title} (page: ${a.page})\n${a.body}`)
  .join("\n\n");
async function claudeAnswer(question, history, s) {
  const actions = [];
  const system = [
    {
      type: "text",
      text: `You are "Luminol", the assistant inside the CRM of an academy in Algeria (psychology consultations, language courses, training). You help staff who are not technical. Answer in the language of the question (French, Arabic or Algerian darija), in short plain sentences; use bullet lists for several items. Use the tools to look up data; never invent names, numbers or dates. You can read only, never change anything: to create a task use propose_task and say the person must confirm. You never see psychologist notes or medical data; if asked, say they are private. How the CRM works:\n\n${helpText}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${question}\n\n(Today: ${s.today}. User: ${s.user.name}, role ${s.permissions.role}.)`,
    },
  ];
  for (let i = 0; i < 6; i++) {
    const r = await claude().beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 3000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools,
      messages,
    });
    recordUsage(s.user.id, "assistant", r.usage);
    if (r.stop_reason === "refusal")
      return { text: "Je ne peux pas répondre à cette demande.", actions };
    const uses = r.content.filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !uses.length) {
      const text = r.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text: text || "…", actions, engine: "claude" };
    }
    messages.push({ role: "assistant", content: r.content });
    messages.push({
      role: "user",
      content: uses.map((u) => ({
        type: "tool_result",
        tool_use_id: u.id,
        content: JSON.stringify(runTool(u.name, u.input, s, actions)).slice(
          0,
          12000,
        ),
      })),
    });
  }
  return {
    text: "La question demande trop d'étapes. Essayez de la découper.",
    actions,
  };
}

// Client bot -------------------------------------------------------------------
const crisis =
  /suicid|me tuer|me suicider|en finir|plus envie de vivre|envie de mourir|me faire du mal|me blesser|kill myself|want to die|end my life|self harm|انتحار|ننتحر|نقتل روحي|نقتل نفسي|اقتل نفسي|نموت روحي|ما نحبش نعيش|لا اريد العيش|نحب نموت|اريد ان اموت/;
const violence =
  /il me frappe|elle me frappe|on me frappe|violence|agress|viol|abus|يضربني|تضربني|عنف|اعتداء|تحرش/;
export function classify(text) {
  const n = normalize(text);
  if (crisis.test(n) || violence.test(n)) return "urgent";
  if (
    /plainte|pas content|pas satisfait|decu|rembourse|scandale|arnaque|inadmissible|honte|complain|refund|شكوى|مش راضي|ماشي راضي|نصب|عيب|ارجاع|ارجعولي/.test(
      n,
    )
  )
    return "complaint";
  if (
    /deplacer|reporter|decaler|changer (le|mon) (rdv|rendez)|annuler|cancel|reschedule|نأجل|ناجل|نبدل|نلغي|الغاء|تأجيل/.test(
      n,
    )
  )
    return "reschedule";
  if (
    /rendez|rdv|reserver|reservation|inscri|place|disponib|nhab ndir|nheb ndir|nsajel|book|appointment|register|موعد|نحجز|حجز|نسجل|تسجيل|رونديفو|بلاصه/.test(
      n,
    )
  )
    return "booking";
  if (
    /prix|tarif|combien|cout|coute|bchhal|bch7al|chhal|ch7al|9adach|qadach|kadach|price|cost|how much|سعر|ثمن|بشحال|قداه|قداش|كم/.test(
      n,
    )
  )
    return "price";
  if (/^(1|2)\b/.test(n)) return "confirm";
  return "info";
}
export function faqMatch(text) {
  const qw = words(text);
  let best = null;
  for (const a of all("SELECT * FROM kb_articles WHERE active=1")) {
    const kw = words(`${a.keywords} ${a.question}`);
    const score = qw.filter(
      (w) => w.length > 1 && kw.some((k) => near(w, k)),
    ).length;
    if (score && (!best || score > best.score)) best = { a, score };
  }
  return best;
}
const publicUrl = () =>
  process.env.PUBLIC_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "");
/** What the bot would answer; `safe` means it may be sent without a person. */
export function botReply(text) {
  const intent = classify(text);
  const ar = isArabic(text);
  const s = settings();
  if (intent === "urgent")
    return { intent, urgent: true, reply: s.crisis_text, safe: true };
  if (intent === "complaint")
    return {
      intent,
      urgent: true,
      reply: ar
        ? "نعتذر عن ذلك. سيتصل بك أحد أعضاء فريقنا قريبًا جدًا."
        : "Nous sommes désolés. Un membre de l'équipe vous recontacte très vite.",
      safe: false,
    };
  if (intent === "confirm") return { intent, reply: "", safe: false };
  const faq = faqMatch(text);
  const booking = s.booking_enabled && publicUrl() ? `${publicUrl()}/book` : "";
  if (intent === "booking" || intent === "reschedule") {
    const reply =
      intent === "reschedule"
        ? ar
          ? "بالطبع. أخبرنا باليوم والساعة المناسبين وسنؤكد لك الموعد الجديد."
          : "Bien sûr. Indiquez-nous le jour et l'heure qui vous conviennent, nous vous confirmons le nouveau rendez-vous."
        : ar
          ? `مرحبًا! ${booking ? `يمكنك الحجز مباشرة هنا: ${booking}` : "أخبرنا بالخدمة واليوم المناسب وسنحجز لك."}`
          : `Bonjour ! ${booking ? `Vous pouvez réserver directement ici : ${booking}` : "Dites-nous le service et le jour qui vous convient, nous vous réservons une place."}`;
    return { intent, reply, safe: intent === "booking" && !!booking };
  }
  if (faq) {
    run("UPDATE kb_articles SET uses=uses+1 WHERE id=?", faq.a.id);
    return {
      intent,
      reply: ar && faq.a.answer_ar ? faq.a.answer_ar : faq.a.answer,
      safe: faq.score >= 2 || intent === "price",
      faq: faq.a.id,
    };
  }
  return { intent, reply: "", safe: false };
}
/** Draft with Claude Haiku when the free engine has no answer (draft only). */
async function aiDraft(text) {
  const kb = all("SELECT question, answer FROM kb_articles WHERE active=1")
    .map((a) => `Q: ${a.question}\nR: ${a.answer}`)
    .join("\n\n");
  const r = await claude().beta.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 400,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `You write short, warm replies to clients of the academy "${settings().academy}" in Algeria, in the client's language (French, Arabic or darija). Use only facts from this knowledge base; if it does not contain the answer, say a team member will reply soon. Never give psychological or medical advice.\n\n${kb}`,
    messages: [{ role: "user", content: text }],
  });
  recordUsage(null, "bot", r.usage);
  if (r.stop_reason === "refusal") return "";
  return r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
/** Called for each incoming WhatsApp message (after it is saved in the inbox). */
export async function handleIncoming(contactId, text, messageId) {
  const s = settings();
  const r = botReply(text);
  transaction(() => {
    if (messageId)
      run("UPDATE messages SET intent=? WHERE id=?", r.intent, messageId);
    if (r.urgent) {
      run(
        "UPDATE conversations SET urgent=1, status='New' WHERE contact_id=?",
        contactId,
      );
      const name =
        one("SELECT name FROM contacts WHERE id=?", contactId)?.name || "";
      const roles =
        r.intent === "urgent"
          ? ["admin", "manager", "instructor", "academic"]
          : ["admin", "manager", "admissions"];
      for (const u of all(
        `SELECT id FROM users WHERE active=1 AND role IN (${roles.map(() => "?").join(",")})`,
        ...roles,
      ))
        insert("notifications", {
          user_id: u.id,
          kind: "urgent",
          text: `${r.intent === "urgent" ? "URGENT" : "Réclamation"} — ${name} : ${text.slice(0, 120)}`,
          contact_id: contactId,
          link: "Messages",
          created_at: now(),
          read_at: null,
        });
    }
  });
  // Severe distress: the referent specialist is warned on WhatsApp at once.
  if (r.intent === "urgent" && s.crisis_alert_phone && whatsappConfigured()) {
    const name =
      one("SELECT name FROM contacts WHERE id=?", contactId)?.name || "";
    await sendWhatsApp(
      s.crisis_alert_phone,
      `URGENT Luminol — ${name} a écrit un message de détresse : « ${text.slice(0, 200)} ». Ouvrez Messages dans le CRM.`,
    ).catch((e) => console.error("Crisis alert:", e?.message));
  }
  let reply = r.reply;
  if (
    !reply &&
    r.intent !== "confirm" &&
    s.bot_mode !== "off" &&
    aiAvailable()
  ) {
    try {
      reply = await aiDraft(text);
    } catch (e) {
      console.error("Bot draft:", e?.message);
    }
  }
  if (!reply || s.bot_mode === "off") return { ...r, sent: false };
  // Safety texts approved by the director go out at once; the rest wait for a person in draft mode.
  const send =
    whatsappConfigured() &&
    ((s.bot_mode === "auto" && r.safe) || r.intent === "urgent");
  if (send) {
    const c = one("SELECT phone FROM contacts WHERE id=?", contactId);
    try {
      await sendWhatsApp(c.phone, reply);
      transaction(() =>
        insert("messages", {
          contact_id: contactId,
          direction: "out",
          channel: "whatsapp",
          body: `🤖 ${reply}`,
          outcome: "",
          user_id: null,
          external_id: "",
          created_at: now(),
          read_at: now(),
          intent: "bot",
        }),
      );
      return { ...r, reply, sent: true };
    } catch (e) {
      console.error("Bot send:", e?.message);
    }
  }
  run(
    "UPDATE conversations SET suggestion=? WHERE contact_id=?",
    reply.slice(0, 2000),
    contactId,
  );
  return { ...r, reply, sent: false };
}

// Free text analysis of reviews ---------------------------------------------
const positive =
  /merci|super|excellent|bravo|genial|parfait|top|satisfait|content|recommande|professionnel|gentil|bien|شكرا|ممتاز|رائع|مليح|بزاف مليح|يعطيك الصحه|احسن/;
const negative =
  /attente|attendre|retard|cher|prix|decu|pas bien|nul|mauvais|sale|bruit|annule|probleme|desorganise|تاخر|غالي|ماشي مليح|سيء|مشكل|انتظار/;
const themes = {
  wait: /attente|attendre|retard|temps|تاخر|انتظار/,
  price: /cher|prix|tarif|cout|غالي|سعر/,
  staff:
    /specialiste|psychologue|prof|professeur|enseignant|formateur|docteur|accueil|secretaire|استاذ|اخصائي|دكتور/,
  place: /salle|local|propre|sale|bruit|parking|clim|قاعه|مكان|نظيف/,
  results: /progres|resultat|ameliore|niveau|aide|تحسن|نتيجه|ساعدني/,
};
export function analyseFeedback(rows) {
  let pos = 0,
    neg = 0,
    neutral = 0;
  const topics = Object.fromEntries(
    Object.keys(themes).map((k) => [k, { count: 0, negative: 0 }]),
  );
  for (const f of rows) {
    const n = normalize(f.comment || "");
    const score =
      (positive.test(n) ? 1 : 0) -
      (negative.test(n) ? 1 : 0) +
      (f.rating ? (f.rating >= 4 ? 1 : f.rating <= 2 ? -1 : 0) : 0);
    if (score > 0) pos++;
    else if (score < 0) neg++;
    else neutral++;
    for (const [k, re] of Object.entries(themes))
      if (re.test(n)) {
        topics[k].count++;
        if (score < 0) topics[k].negative++;
      }
  }
  return { positive: pos, negative: neg, neutral, topics };
}

// Routes -------------------------------------------------------------------------
export function installSmart(
  app,
  { write, del, allow, must, text, integer, found, stateFor, drop },
) {
  const staff = [
    "admin",
    "admissions",
    "academic",
    "instructor",
    "finance",
    "manager",
  ];
  app.get("/api/assistant", (req, res, next) => {
    try {
      allow(req, staff);
      run(
        "DELETE FROM assistant_messages WHERE created_at<?",
        new Date(Date.now() - 30 * day).toISOString(),
      );
      res.json({
        messages: all(
          "SELECT * FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 60",
          req.user.id,
        )
          .reverse()
          .map((m) => ({ ...m, meta: JSON.parse(m.meta || "{}") })),
        ai: aiAvailable(),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/assistant", async (req, res, next) => {
    try {
      allow(req, staff);
      const question = text(req.body?.message, "Question", 1000);
      const s = stateFor(req.user);
      const history = all(
        "SELECT role, content FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 8",
        req.user.id,
      ).reverse();
      let answer;
      if (aiAvailable()) {
        try {
          answer = await claudeAnswer(question, history, s);
        } catch (e) {
          console.error("Assistant:", e?.message);
        }
      }
      answer ||= { ...localAnswer(question, s), engine: "local" };
      transaction(() => {
        insert("assistant_messages", {
          user_id: req.user.id,
          role: "user",
          content: question,
          meta: "{}",
          created_at: now(),
        });
        insert("assistant_messages", {
          user_id: req.user.id,
          role: "assistant",
          content: answer.text,
          meta: JSON.stringify({
            links: answer.links || [],
            actions: answer.actions || [],
            contacts: answer.contacts || [],
            engine: answer.engine,
          }),
          created_at: now(),
        });
      });
      res.json(answer);
    } catch (e) {
      next(e);
    }
  });
  del("/api/assistant", staff, (req) => {
    run("DELETE FROM assistant_messages WHERE user_id=?", req.user.id);
    return { ok: true };
  });
  /** Actions proposed by the assistant run only after this confirmation. */
  write("/api/assistant/confirm", staff, (req) => {
    const b = req.body;
    must(b.type === "task", "Unknown action.");
    const contact = b.contact_id
      ? stateFor(req.user).contacts.find((c) => c.id === Number(b.contact_id))
      : null;
    must(!b.contact_id || contact, "Client not found.", 404);
    const id = insert("tasks", {
      contact_id: contact?.id ?? null,
      owner_id: req.user.id,
      title: text(b.title, "Task", 200),
      due_at:
        b.due_at && !isNaN(Date.parse(b.due_at))
          ? new Date(b.due_at).toISOString()
          : now(),
      priority: "Normal",
      status: "Open",
      created_at: now(),
      version: 1,
    });
    audit(
      req.user.id,
      contact?.id ?? null,
      `Task created from the assistant: ${b.title}.`,
      "task",
    );
    return { id };
  });
  write("/api/me/tour", staff, (req) => {
    run(
      "UPDATE users SET tour_done=? WHERE id=?",
      req.body.done === false ? 0 : 1,
      req.user.id,
    );
    return { ok: true };
  });

  // Knowledge base and bot settings (director).
  write("/api/kb", ["admin", "manager"], (req) => {
    const b = req.body;
    const v = {
      question: text(b.question, "Question", 300),
      answer: text(b.answer, "Answer", 2000),
      answer_ar: text(b.answer_ar || "", "Answer (Arabic)", 2000, false),
      keywords: text(b.keywords || "", "Keywords", 500, false),
      active: b.active === false ? 0 : 1,
    };
    if (b.id) {
      const a = found("kb_articles", b.id, "Answer");
      run(
        "UPDATE kb_articles SET question=?, answer=?, answer_ar=?, keywords=?, active=? WHERE id=?",
        v.question,
        v.answer,
        v.answer_ar,
        v.keywords,
        v.active,
        a.id,
      );
      return { id: a.id };
    }
    return { id: insert("kb_articles", { ...v, created_at: now() }) };
  });
  del("/api/kb/:id", ["admin", "manager"], (req) => {
    const a = found("kb_articles", req.params.id, "Answer");
    drop("DELETE FROM kb_articles WHERE id=?", a.id);
    return { ok: true };
  });
  write("/api/kb/test", ["admin", "manager", "admissions"], (req) => {
    const r = botReply(text(req.body.message, "Message", 1000));
    return { ...r, booking_link: !!publicUrl() };
  });
  write(
    "/api/settings/smart",
    ["admin"],
    (req) => {
      const b = req.body;
      const s = settings();
      run(
        "UPDATE settings SET ai_enabled=?, ai_monthly_tokens=?, bot_mode=?, crisis_text=?, crisis_alert_phone=? WHERE id=1",
        b.ai_enabled === undefined ? s.ai_enabled : b.ai_enabled ? 1 : 0,
        b.ai_monthly_tokens === undefined
          ? s.ai_monthly_tokens
          : integer(b.ai_monthly_tokens, "Monthly limit", 0, 1000000000),
        ["off", "draft", "auto"].includes(b.bot_mode) ? b.bot_mode : s.bot_mode,
        b.crisis_text === undefined
          ? s.crisis_text
          : text(b.crisis_text, "Urgent message", 1000),
        b.crisis_alert_phone === undefined
          ? s.crisis_alert_phone
          : text(b.crisis_alert_phone || "", "Phone", 40, false),
      );
      return { ok: true };
    },
    "patch",
  );
  write(
    "/api/conversations/:contactId/suggestion",
    ["admin", "admissions", "academic", "instructor"],
    (req) => {
      run(
        "UPDATE conversations SET suggestion='', urgent=CASE WHEN ? THEN 0 ELSE urgent END WHERE contact_id=?",
        req.body.clear_urgent ? 1 : 0,
        integer(req.params.contactId, "Client"),
      );
      return { ok: true };
    },
    "patch",
  );

  // Receipt photo → amount, date, reference (Claude vision when available).
  app.post("/api/ai/receipt", async (req, res, next) => {
    try {
      allow(req, ["admin", "admissions", "finance"]);
      must(
        aiAvailable(),
        "Reading photos with AI is not set up; the free reader in the browser is used instead.",
        503,
      );
      const image = String(req.body?.image || "");
      const m = image.match(
        /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/,
      );
      must(
        m && m[2].length < 7_000_000,
        "Send a PNG, JPEG or WebP photo under 5 MB.",
      );
      const r = await claude().beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 500,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: m[1], data: m[2] },
              },
              {
                type: "text",
                text: 'This is a payment receipt from Algeria (CCP, BaridiMob, bank or cash receipt). Reply with JSON only: {"amount_da": number or null, "date": "YYYY-MM-DD" or null, "reference": string or null, "payer": string or null}.',
              },
            ],
          },
        ],
      });
      recordUsage(req.user.id, "receipt", r.usage);
      const raw = r.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      let out = {};
      try {
        out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      } catch {
        out = {};
      }
      res.json({
        amount: out.amount_da ?? null,
        date: out.date ?? null,
        reference: out.reference ?? null,
        payer: out.payer ?? null,
        engine: "claude",
      });
    } catch (e) {
      next(e);
    }
  });
}

/** Public chat for the website widget. Messages are kept once a phone is given. */
export function installPublicBot(app) {
  const hits = new Map();
  app.post("/api/public/bot", (req, res, next) => {
    try {
      const ip = String(
        req.headers["x-real-ip"] || req.socket.remoteAddress || "",
      );
      const recent = (hits.get(ip) || []).filter(
        (t) => Date.now() - t < 600000,
      );
      if (recent.length > 40)
        return res
          .status(429)
          .json({ error: "Too many messages. Try again later." });
      hits.set(ip, [...recent, Date.now()]);
      const b = req.body || {};
      const message = str(b.message, 1000);
      const lang = b.lang === "ar" ? "ar" : "fr";
      let session = b.token
        ? one("SELECT * FROM bot_sessions WHERE token=?", str(b.token, 64))
        : null;
      if (!session) {
        const token = randomBytes(18).toString("base64url");
        insert("bot_sessions", {
          token,
          contact_id: null,
          lang,
          created_at: now(),
        });
        session = one("SELECT * FROM bot_sessions WHERE token=?", token);
      }
      // The visitor leaves a name and phone: a client and a request are created.
      if (b.name && b.phone) {
        const name = str(b.name, 100);
        const phone = str(b.phone, 40);
        if (phone.replace(/\D/g, "").length < 8)
          return res.status(400).json({ error: "Enter a valid phone number." });
        const contactId = transaction(() => {
          const tail = phone.replace(/\D/g, "").slice(-9);
          let c = all("SELECT id, phone FROM contacts WHERE phone<>''").find(
            (x) => x.phone.replace(/\D/g, "").endsWith(tail),
          );
          const id =
            c?.id ??
            insert("contacts", {
              name,
              email: "",
              phone,
              language: lang === "ar" ? "Arabic" : "French",
              consent: 1,
              guardian: "",
              notes: "",
              created_at: now(),
            });
          const owner =
            one(
              "SELECT id FROM users WHERE active=1 AND role='admissions' ORDER BY id",
            )?.id ||
            one("SELECT id FROM users WHERE role='admin' ORDER BY id")?.id;
          insert("opportunities", {
            contact_id: id,
            program_id: null,
            owner_id: owner,
            service_type: "Other",
            interest: str(b.topic, 180) || "Chat du site",
            stage: "New inquiry",
            source: "Chat du site",
            campaign: "",
            tags: "chat",
            notes: (b.transcript || [])
              .map(
                (m) =>
                  `${m.from === "bot" ? "Bot" : "Client"}: ${str(m.text, 500)}`,
              )
              .join("\n")
              .slice(0, 4000),
            expected_date: "",
            created_at: now(),
            stage_at: now(),
            version: 1,
          });
          insert("tasks", {
            contact_id: id,
            owner_id: owner,
            title: "Rappeler (chat du site)",
            due_at: now(),
            priority: "High",
            status: "Open",
            created_at: now(),
            version: 1,
          });
          for (const m of (b.transcript || []).slice(-20))
            insert("messages", {
              contact_id: id,
              direction: m.from === "bot" ? "out" : "in",
              channel: "other",
              body: `${m.from === "bot" ? "🤖 " : ""}${str(m.text, 1000)}`,
              outcome: "",
              user_id: null,
              external_id: "",
              created_at: now(),
              read_at: m.from === "bot" ? now() : null,
              intent: "",
            });
          if (
            !one("SELECT contact_id FROM conversations WHERE contact_id=?", id)
          )
            insert("conversations", {
              contact_id: id,
              status: "New",
              assignee_id: null,
              updated_at: now(),
            });
          run(
            "UPDATE bot_sessions SET contact_id=? WHERE id=?",
            id,
            session.id,
          );
          return id;
        });
        return res.json({
          token: session.token,
          reply:
            lang === "ar"
              ? "شكرًا! سيتصل بك فريقنا قريبًا جدًا."
              : "Merci ! Notre équipe vous rappelle très bientôt.",
          done: true,
          contact_id: contactId,
        });
      }
      if (!message) return res.status(400).json({ error: "Write a message." });
      const r = botReply(message);
      const ask =
        r.intent === "booking" ||
        r.intent === "reschedule" ||
        r.intent === "complaint" ||
        r.intent === "urgent" ||
        !r.reply;
      res.json({
        token: session.token,
        intent: r.intent,
        reply:
          r.reply ||
          (lang === "ar"
            ? "سؤال جيد! اترك اسمك ورقمك وسيجيبك أحد أعضاء الفريق."
            : "Bonne question ! Laissez votre nom et votre numéro, un membre de l'équipe vous répond."),
        ask_contact: ask,
        urgent: !!r.urgent,
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/public/bot/info", (req, res) => {
    const s = settings();
    res.json({
      academy: s.academy,
      questions: all(
        "SELECT question FROM kb_articles WHERE active=1 ORDER BY uses DESC, id LIMIT 4",
      ).map((a) => a.question),
    });
  });
}
