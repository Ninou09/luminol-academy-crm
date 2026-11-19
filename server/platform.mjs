/**
 * Platform tools: inbox, automation builder, custom fields, tags, segments,
 * own forms, document templates, comments and notifications, calendar feed,
 * personal dashboards, subscriptions, promo codes, gift cards, branches,
 * fine-grained rights, record history, system status, API keys, webhooks.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import {
  all,
  one,
  run,
  insert,
  transaction,
  audit,
  now,
  chargeRows,
  isHosted,
} from "./db.mjs";
import {
  sendWhatsApp,
  whatsappConfigured,
  fillTemplate,
  chargilyConfigured,
} from "./integrations.mjs";
import { mailConfigured } from "./security.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const json = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
const str = (v, max = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const day = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const hash = (s) => createHash("sha256").update(s).digest("hex");
export const getMeta = (key) =>
  one("SELECT value FROM meta WHERE key=?", key)?.value;
export const setMeta = (key, value) =>
  run(
    "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    String(value),
  );
const settings = () => one("SELECT * FROM settings WHERE id=1");
const zoneDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: settings().timezone }).format(d);
const frWhen = (value, opts) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: settings().timezone,
    ...opts,
  }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
const firstAdmin = () =>
  one("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id")?.id ??
  one("SELECT id FROM users ORDER BY id")?.id;
const digits = (p) => String(p || "").replace(/\D/g, "");

/** Find a client by phone (last 9 digits) or e-mail. */
export function findContact(phone, email) {
  const tail = digits(phone).slice(-9);
  const mail = str(email, 254).toLowerCase();
  return all("SELECT * FROM contacts").find(
    (c) =>
      (tail.length >= 8 && digits(c.phone).endsWith(tail)) ||
      (mail && c.email.toLowerCase() === mail),
  );
}

// Notifications -------------------------------------------------------------
export function notify(userId, kind, text, contactId = null, link = "") {
  if (!userId) return;
  insert("notifications", {
    user_id: userId,
    kind,
    text: str(text, 300),
    contact_id: contactId,
    link,
    created_at: now(),
    read_at: null,
  });
}
function notifyRoles(roles, kind, text, contactId = null, link = "") {
  for (const u of all(
    `SELECT id FROM users WHERE active=1 AND role IN (${roles.map(() => "?").join(",")})`,
    ...roles,
  ))
    notify(u.id, kind, text, contactId, link);
}

// 1. Inbox ------------------------------------------------------------------
function touchConversation(contactId, status) {
  const c = one("SELECT * FROM conversations WHERE contact_id=?", contactId);
  if (!c)
    insert("conversations", {
      contact_id: contactId,
      status: status || "New",
      assignee_id: null,
      updated_at: now(),
    });
  else
    run(
      "UPDATE conversations SET status=?, updated_at=? WHERE contact_id=?",
      status || c.status,
      now(),
      contactId,
    );
}
export function logMessage({
  contact_id,
  direction,
  channel = "whatsapp",
  body = "",
  outcome = "",
  user_id = null,
  external_id = "",
}) {
  const id = insert("messages", {
    contact_id,
    direction,
    channel,
    body: str(body, 4000),
    outcome,
    user_id,
    external_id,
    created_at: now(),
    read_at: direction === "in" ? null : now(),
  });
  touchConversation(contact_id, direction === "out" ? "Open" : undefined);
  return id;
}
/** A WhatsApp message came in: it is added to the client's conversation. */
export function logIncoming(from, body, profileName = "", externalId = "") {
  const d = digits(from);
  if (d.length < 8) return null;
  if (
    externalId &&
    one("SELECT id FROM messages WHERE external_id=?", externalId)
  )
    return null;
  let contact = findContact(d, "");
  if (!contact) {
    const id = insert("contacts", {
      name: str(profileName, 100) || `WhatsApp +${d}`,
      email: "",
      phone: `+${d}`,
      language: "French",
      consent: 1,
      guardian: "",
      notes: "Created from an incoming WhatsApp message.",
      created_at: now(),
    });
    contact = one("SELECT * FROM contacts WHERE id=?", id);
  }
  const conv = one(
    "SELECT * FROM conversations WHERE contact_id=?",
    contact.id,
  );
  const messageId = logMessage({
    contact_id: contact.id,
    direction: "in",
    body,
    external_id: externalId,
  });
  if (conv?.status === "Resolved")
    run("UPDATE conversations SET status='New' WHERE contact_id=?", contact.id);
  const text = `${contact.name} : ${str(body, 120)}`;
  if (conv?.assignee_id) notify(conv.assignee_id, "message", text, contact.id);
  else notifyRoles(["admissions", "manager"], "message", text, contact.id);
  return { contactId: contact.id, messageId };
}

// 2. Automation builder -----------------------------------------------------
export const flowTriggers = [
  "inquiry_created",
  "appointment_created",
  "appointment_upcoming",
  "appointment_cancelled",
  "appointment_no_show",
  "appointment_done",
  "payment_received",
  "payment_overdue",
  "package_ending",
  "session_missed",
  "birthday",
  "cohort_ended",
  "inactive",
];
export const flowPresets = [
  {
    key: "reminder",
    name: "Reminder the day before",
    trigger: "appointment_upcoming",
    delay_minutes: 1440,
    conditions: {},
    actions: [
      {
        type: "whatsapp",
        text: "Bonjour {name}, nous vous rappelons votre rendez-vous demain {date} à {time} ({service}). Répondez 1 pour confirmer ou 2 pour annuler. — {academy}",
      },
    ],
  },
  {
    key: "thanks",
    name: "Thank you after the consultation + review",
    trigger: "appointment_done",
    delay_minutes: 120,
    conditions: {},
    actions: [
      {
        type: "whatsapp",
        text: "Merci {name} pour votre visite aujourd'hui. Votre avis nous aide beaucoup : répondez simplement avec une note de 1 à 5. — {academy}",
      },
    ],
  },
  {
    key: "winback",
    name: "Bring back a client who has not come for 60 days",
    trigger: "inactive",
    delay_minutes: 0,
    conditions: { days: 60 },
    actions: [
      { type: "task", title: "Call {name}: no visit for 60 days", days: 0 },
      {
        type: "whatsapp",
        text: "Bonjour {name}, cela fait un moment ! Nous serions ravis de vous revoir. Voulez-vous réserver un créneau cette semaine ? — {academy}",
      },
    ],
  },
];
function contactLanguage(id) {
  return one("SELECT language FROM contacts WHERE id=?", id)?.language || "";
}
/** Records that can start a scenario, with the moment they happened. */
function candidates(trigger, conditions = {}) {
  const since = iso(Date.now() - 30 * day);
  const out = [];
  const appt = (a, key, at) => ({
    key,
    contact_id: a.contact_id,
    at,
    ctx: {
      service: `${a.title} ${a.kind}`,
      staff_id: a.staff_id,
      owner_id: a.staff_id,
      starts_at: a.starts_at,
      appointment_id: a.id,
    },
  });
  if (trigger === "inquiry_created")
    for (const o of all(
      `SELECT o.*, p.name program FROM opportunities o LEFT JOIN programs p ON p.id=o.program_id WHERE o.created_at>?`,
      since,
    ))
      out.push({
        key: `opp:${o.id}`,
        contact_id: o.contact_id,
        at: o.created_at,
        ctx: {
          service: `${o.service_type} ${o.interest} ${o.program || ""}`,
          source: o.source,
          owner_id: o.owner_id,
          opportunity_id: o.id,
        },
      });
  if (trigger === "appointment_created")
    for (const a of all(
      "SELECT * FROM appointments WHERE created_at>? AND contact_id IS NOT NULL",
      since,
    ))
      out.push(appt(a, `appt:${a.id}`, a.created_at));
  if (trigger === "appointment_upcoming")
    for (const a of all(
      "SELECT * FROM appointments WHERE status IN ('Scheduled','Pending') AND starts_at>? AND starts_at<? AND contact_id IS NOT NULL",
      iso(Date.now() - day),
      iso(Date.now() + 31 * day),
    ))
      out.push({
        ...appt(a, `up:${a.id}:${a.starts_at}`, a.starts_at),
        before: true,
      });
  for (const [t, status, prefix] of [
    ["appointment_cancelled", "Cancelled", "cx"],
    ["appointment_no_show", "No-show", "ns"],
    ["appointment_done", "Done", "done"],
  ])
    if (trigger === t)
      for (const a of all(
        "SELECT * FROM appointments WHERE status=? AND starts_at>? AND contact_id IS NOT NULL",
        status,
        since,
      ))
        out.push(
          appt(
            a,
            `${prefix}:${a.id}`,
            status === "Cancelled" ? a.created_at : a.ends_at,
          ),
        );
  if (trigger === "payment_received")
    for (const p of all(
      "SELECT p.*, c.contact_id, c.label FROM payments p JOIN charges c ON c.id=p.charge_id WHERE p.created_at>?",
      since,
    ))
      out.push({
        key: `pay:${p.id}`,
        contact_id: p.contact_id,
        at: p.created_at,
        ctx: { amount: p.amount, service: p.label },
      });
  if (trigger === "payment_overdue") {
    const today = zoneDate();
    for (const c of chargeRows())
      if (
        c.balance > 0 &&
        c.due_date < today &&
        c.due_date > zoneDate(new Date(Date.now() - 60 * day))
      )
        out.push({
          key: `due:${c.id}`,
          contact_id: c.contact_id,
          at: `${c.due_date}T09:00:00.000Z`,
          ctx: { amount: c.balance, service: c.label },
        });
  }
  if (trigger === "package_ending")
    for (const p of all(
      `SELECT p.*, (SELECT COUNT(*) FROM appointments a WHERE a.package_id=p.id AND a.status IN ('Done','No-show')) used FROM packages p WHERE p.status='Active'`,
    ))
      if (p.sessions_total - p.used <= 1)
        out.push({
          key: `pkg:${p.id}`,
          contact_id: p.contact_id,
          at: now(),
          ctx: { service: p.title },
        });
  if (trigger === "session_missed")
    for (const a of all(
      `SELECT a.*, s.starts_at, h.instructor_id, h.name cohort FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN cohorts h ON h.id=s.cohort_id
       WHERE a.status='Absent' AND s.starts_at>?`,
      since,
    ))
      out.push({
        key: `abs:${a.id}`,
        contact_id: a.contact_id,
        at: a.starts_at,
        ctx: {
          service: a.cohort,
          staff_id: a.instructor_id,
          owner_id: a.instructor_id,
        },
      });
  if (trigger === "birthday") {
    const today = zoneDate();
    for (const c of all(
      "SELECT id, birth_date FROM contacts WHERE birth_date<>''",
    ))
      if (c.birth_date.slice(5) === today.slice(5))
        out.push({
          key: `bday:${c.id}:${today.slice(0, 4)}`,
          contact_id: c.id,
          at: `${today}T07:00:00.000Z`,
          ctx: {},
        });
  }
  if (trigger === "cohort_ended") {
    const today = zoneDate();
    for (const e of all(
      `SELECT e.contact_id, h.id cohort_id, h.name, h.end_date, h.instructor_id FROM enrollments e JOIN cohorts h ON h.id=e.cohort_id
       WHERE h.end_date<=? AND h.end_date>?`,
      today,
      zoneDate(new Date(Date.now() - 30 * day)),
    ))
      out.push({
        key: `end:${e.cohort_id}:${e.contact_id}`,
        contact_id: e.contact_id,
        at: `${e.end_date}T17:00:00.000Z`,
        ctx: {
          service: e.name,
          staff_id: e.instructor_id,
          owner_id: e.instructor_id,
        },
      });
  }
  if (trigger === "inactive") {
    const days = Math.max(7, Number(conditions.days) || 60);
    const limit = iso(Date.now() - days * day);
    for (const c of all(
      `SELECT c.id, MAX(x.at) last FROM contacts c JOIN (
         SELECT contact_id, ends_at at FROM appointments WHERE status='Done'
         UNION ALL SELECT a.contact_id, s.starts_at FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.status IN ('Present','Late')
       ) x ON x.contact_id=c.id GROUP BY c.id`,
    ))
      if (
        c.last < limit &&
        !one(
          "SELECT id FROM appointments WHERE contact_id=? AND starts_at>? AND status IN ('Scheduled','Pending')",
          c.id,
          now(),
        )
      )
        out.push({
          key: `idle:${c.id}:${c.last.slice(0, 10)}`,
          contact_id: c.id,
          at: now(),
          ctx: {},
        });
  }
  return out;
}
function matches(candidate, cond = {}) {
  const ctx = candidate.ctx;
  const has = (a, b) =>
    !b ||
    String(a || "")
      .toLowerCase()
      .includes(String(b).toLowerCase());
  if (!has(ctx.service, cond.service)) return false;
  if (!has(ctx.source, cond.source)) return false;
  if (cond.staff_id && Number(cond.staff_id) !== Number(ctx.staff_id))
    return false;
  if (cond.min_amount && (ctx.amount || 0) < Number(cond.min_amount))
    return false;
  if (
    cond.language &&
    !has(contactLanguage(candidate.contact_id), cond.language)
  )
    return false;
  if (
    cond.tag_id &&
    !one(
      "SELECT 1 FROM contact_tags WHERE contact_id=? AND tag_id=?",
      candidate.contact_id,
      Number(cond.tag_id),
    )
  )
    return false;
  if (cond.segment_id) {
    const s = one("SELECT * FROM segments WHERE id=?", Number(cond.segment_id));
    if (!s || !segmentMembers(json(s.filters, {})).has(candidate.contact_id))
      return false;
  }
  return true;
}
function dueTime(candidate, flow) {
  const at = Date.parse(candidate.at);
  return candidate.before
    ? at - flow.delay_minutes * 60000
    : at + flow.delay_minutes * 60000;
}
function values(candidate) {
  const c =
    one("SELECT * FROM contacts WHERE id=?", candidate.contact_id) || {};
  const s = settings();
  const when = candidate.ctx.starts_at;
  return {
    name: String(c.name || "").split(" ")[0],
    full_name: c.name || "",
    service: String(candidate.ctx.service || "").trim(),
    date: when
      ? frWhen(when, { weekday: "long", day: "numeric", month: "long" })
      : "",
    time: when
      ? frWhen(when, { hour: "2-digit", minute: "2-digit", hour12: false })
      : "",
    amount: candidate.ctx.amount
      ? `${(candidate.ctx.amount / 100).toLocaleString("fr-FR")} ${s.currency}`
      : "",
    academy: s.academy,
  };
}
/** Run the actions of one scenario for one record. Sends happen afterwards. */
function perform(flow, candidate, sends) {
  const v = values(candidate);
  const done = [];
  const contact = one(
    "SELECT * FROM contacts WHERE id=?",
    candidate.contact_id,
  );
  if (!contact) return "Client not found";
  for (const a of json(flow.actions, [])) {
    if (a.type === "task") {
      const owner =
        Number(a.owner_id) ||
        candidate.ctx.owner_id ||
        candidate.ctx.staff_id ||
        firstAdmin();
      insert("tasks", {
        contact_id: contact.id,
        owner_id: owner,
        title: str(fillTemplate(a.title || flow.name, v), 200),
        due_at: iso(Date.now() + (Number(a.days) || 0) * day),
        priority: a.priority === "High" ? "High" : "Normal",
        status: "Open",
        created_at: now(),
        version: 1,
      });
      done.push("task");
    }
    if (a.type === "whatsapp") {
      const tpl = a.template_id
        ? one(
            "SELECT body FROM message_templates WHERE id=?",
            Number(a.template_id),
          )?.body
        : a.text;
      const body = fillTemplate(tpl || "", v).slice(0, 2000);
      if (!body) continue;
      if (
        whatsappConfigured() &&
        contact.consent &&
        digits(contact.phone).length >= 9
      ) {
        sends.push({ contact, body, flow: flow.name });
        done.push("whatsapp sent");
      } else {
        insert("drafts", {
          contact_id: contact.id,
          channel: "WhatsApp",
          subject: flow.name,
          body,
          status: "Draft",
          user_id: flow.created_by || firstAdmin(),
          created_at: now(),
        });
        done.push("whatsapp prepared");
      }
    }
    if (a.type === "stage" && a.stage) {
      const opp = candidate.ctx.opportunity_id
        ? one(
            "SELECT * FROM opportunities WHERE id=?",
            candidate.ctx.opportunity_id,
          )
        : one(
            "SELECT * FROM opportunities WHERE contact_id=? AND stage NOT IN ('Enrolled','Lost') ORDER BY id DESC LIMIT 1",
            contact.id,
          );
      if (opp) {
        run(
          "UPDATE opportunities SET stage=?, stage_at=?, version=version+1 WHERE id=?",
          str(a.stage, 60),
          now(),
          opp.id,
        );
        done.push("stage");
      }
    }
    if (a.type === "tag" && a.tag_id) {
      run(
        "INSERT OR IGNORE INTO contact_tags(contact_id, tag_id) VALUES (?,?)",
        contact.id,
        Number(a.tag_id),
      );
      done.push("tag");
    }
    if (a.type === "notify") {
      const target =
        Number(a.user_id) ||
        candidate.ctx.owner_id ||
        candidate.ctx.staff_id ||
        firstAdmin();
      notify(
        target,
        "flow",
        fillTemplate(a.text || `${flow.name} : {full_name}`, v),
        contact.id,
      );
      done.push("notify");
    }
  }
  return done.join(", ") || "nothing to do";
}
/** Check every active scenario; called by the daily cron and on page loads. */
export async function runFlows() {
  const sends = [];
  const flows = all("SELECT * FROM flows WHERE enabled=1");
  let ran = 0;
  transaction(() => {
    for (const flow of flows) {
      const cond = json(flow.conditions, {});
      const created = Date.parse(flow.created_at) - day;
      for (const c of candidates(flow.trigger, cond)) {
        const due = dueTime(c, flow);
        if (due > Date.now() || due < created) continue;
        if (
          one(
            "SELECT id FROM flow_runs WHERE flow_id=? AND record_key=? AND test=0",
            flow.id,
            c.key,
          )
        )
          continue;
        if (!matches(c, cond)) continue;
        const detail = perform(flow, c, sends);
        insert("flow_runs", {
          flow_id: flow.id,
          record_key: c.key,
          contact_id: c.contact_id,
          status: "done",
          detail,
          test: 0,
          created_at: now(),
        });
        ran++;
      }
    }
  });
  for (const s of sends) {
    try {
      await sendWhatsApp(s.contact.phone, s.body);
      logMessage({ contact_id: s.contact.id, direction: "out", body: s.body });
    } catch (e) {
      insert("drafts", {
        contact_id: s.contact.id,
        channel: "WhatsApp",
        subject: s.flow,
        body: s.body,
        status: "Draft",
        user_id: firstAdmin(),
        created_at: now(),
      });
    }
  }
  return { ran };
}
function testFlow(flow) {
  const cond = json(flow.conditions, {});
  const list = candidates(flow.trigger, cond).filter((c) => matches(c, cond));
  const c = list[list.length - 1];
  if (!c)
    return { found: 0, detail: "No matching record in the last 30 days." };
  const v = values(c);
  const lines = json(flow.actions, []).map((a) =>
    a.type === "task"
      ? `Task: ${fillTemplate(a.title || flow.name, v)}`
      : a.type === "whatsapp"
        ? `WhatsApp: ${fillTemplate(
            (a.template_id
              ? one(
                  "SELECT body FROM message_templates WHERE id=?",
                  Number(a.template_id),
                )?.body
              : a.text) || "",
            v,
          )}`
        : a.type === "stage"
          ? `Stage: ${a.stage}`
          : a.type === "tag"
            ? `Tag: ${one("SELECT name FROM tags WHERE id=?", Number(a.tag_id))?.name || ""}`
            : `Notify: ${fillTemplate(a.text || flow.name, v)}`,
  );
  const detail = `${v.full_name} — ${lines.join(" | ")}`;
  insert("flow_runs", {
    flow_id: flow.id,
    record_key: `test:${Date.now()}`,
    contact_id: c.contact_id,
    status: "test",
    detail,
    test: 1,
    created_at: now(),
  });
  return { found: list.length, detail };
}

// 3. Segments -----------------------------------------------------------------
/** Clients matching saved filters (tags, service, source, language, inactivity, fields). */
export function segmentMembers(f = {}) {
  let ids = new Set(all("SELECT id FROM contacts").map((r) => r.id));
  const keep = (rows) => {
    const s = new Set(rows.map((r) => r.id));
    ids = new Set([...ids].filter((x) => s.has(x)));
  };
  for (const tag of f.tag_ids || [])
    keep(
      all("SELECT contact_id id FROM contact_tags WHERE tag_id=?", Number(tag)),
    );
  if (f.service) {
    const q = `%${str(f.service, 100)}%`;
    keep(
      all(
        `SELECT contact_id id FROM appointments WHERE title LIKE ? OR kind LIKE ?
         UNION SELECT contact_id FROM opportunities WHERE interest LIKE ? OR service_type LIKE ?
         UNION SELECT e.contact_id FROM enrollments e JOIN cohorts h ON h.id=e.cohort_id JOIN programs p ON p.id=h.program_id WHERE p.name LIKE ? OR p.category LIKE ?`,
        q,
        q,
        q,
        q,
        q,
        q,
      ),
    );
  }
  if (f.source)
    keep(
      all(
        "SELECT contact_id id FROM opportunities WHERE source LIKE ?",
        `%${str(f.source, 100)}%`,
      ),
    );
  if (f.language)
    keep(
      all(
        "SELECT id FROM contacts WHERE language LIKE ?",
        `%${str(f.language, 40)}%`,
      ),
    );
  if (f.inactive_days) {
    const limit = iso(Date.now() - Number(f.inactive_days) * day);
    const recent = new Set(
      all(
        `SELECT contact_id id FROM appointments WHERE starts_at>? AND status IN ('Done','Scheduled','Pending')
         UNION SELECT a.contact_id FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.starts_at>?`,
        limit,
        limit,
      ).map((r) => r.id),
    );
    ids = new Set([...ids].filter((x) => !recent.has(x)));
  }
  for (const [fid, value] of Object.entries(f.fields || {}))
    if (String(value).trim())
      keep(
        all(
          "SELECT record_id id FROM custom_values WHERE field_id=? AND value LIKE ?",
          Number(fid),
          `%${str(value, 200)}%`,
        ),
      );
  if (f.consent) keep(all("SELECT id FROM contacts WHERE consent=1"));
  return ids;
}

// 7. Event pump: webhooks and notifications for new records ------------------
const events = {
  "contact.created": {
    sql: "SELECT id, name, phone, email, language, created_at FROM contacts WHERE id>? ORDER BY id LIMIT 200",
  },
  "inquiry.created": {
    sql: `SELECT o.id, o.contact_id, o.owner_id, o.stage, o.source, o.service_type, o.interest, o.created_at, c.name, c.phone, c.email
          FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.id>? ORDER BY o.id LIMIT 200`,
    notify: (r) =>
      notify(
        r.owner_id,
        "inquiry",
        `Nouvelle demande : ${r.name} — ${r.interest || r.service_type}`,
        r.contact_id,
      ),
  },
  "appointment.created": {
    sql: `SELECT a.id, a.contact_id, a.staff_id, a.title, a.kind, a.starts_at, a.ends_at, a.status, a.source, a.created_at, c.name
          FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.id>? ORDER BY a.id LIMIT 200`,
    notify: (r) =>
      notify(
        r.staff_id,
        "appointment",
        `Nouveau rendez-vous : ${r.name || r.title} — ${frWhen(r.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        r.contact_id,
        "Calendar",
      ),
  },
  "payment.received": {
    sql: `SELECT p.id, p.amount, p.method, p.created_at, p.user_id, ch.contact_id, ch.label, ch.currency, c.name
          FROM payments p JOIN charges ch ON ch.id=p.charge_id JOIN contacts c ON c.id=ch.contact_id WHERE p.id>? ORDER BY p.id LIMIT 200`,
    notify: (r) => {
      for (const u of all(
        "SELECT id FROM users WHERE active=1 AND role='admin'",
      ))
        if (u.id !== r.user_id)
          notify(
            u.id,
            "payment",
            `Paiement reçu : ${(r.amount / 100).toLocaleString("fr-FR")} ${r.currency} — ${r.name}`,
            r.contact_id,
            "Payments",
          );
    },
  },
  "task.created": {
    internal: true,
    sql: "SELECT id, owner_id, contact_id, title, due_at FROM tasks WHERE id>? ORDER BY id LIMIT 200",
    notify: (r) =>
      notify(
        r.owner_id,
        "task",
        `Nouvelle tâche : ${r.title}`,
        r.contact_id,
        "My tasks",
      ),
  },
};
export const webhookEvents = Object.keys(events).filter(
  (e) => !events[e].internal,
);
/** Find new records since the last run; returns deliveries to send. */
function collectEvents() {
  const hooks = all("SELECT * FROM webhooks WHERE active=1").map((h) => ({
    ...h,
    events: json(h.events, []),
  }));
  const out = [];
  transaction(() => {
    for (const [name, ev] of Object.entries(events)) {
      const key = `cursor:${name}`;
      const table = ev.sql.match(/FROM (\w+)/)[1];
      let cursor = getMeta(key);
      if (cursor == null) {
        // First run: start from now, earlier records are not replayed.
        setMeta(key, one(`SELECT COALESCE(MAX(id),0) n FROM ${table}`).n);
        continue;
      }
      const rows = all(ev.sql, Number(cursor));
      if (!rows.length) continue;
      setMeta(key, rows[rows.length - 1].id);
      for (const r of rows) {
        ev.notify?.(r);
        if (!ev.internal)
          for (const h of hooks)
            if (h.events.includes(name) || h.events.includes("*"))
              out.push({
                hook: h,
                body: JSON.stringify({ event: name, at: now(), data: r }),
              });
      }
    }
  });
  return out;
}
async function deliver({ hook, body }) {
  let status;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Luminol-Signature":
          "sha256=" +
          createHmac("sha256", hook.secret).update(body).digest("hex"),
      },
      body,
      signal: AbortSignal.timeout(4000),
    });
    status = String(res.status);
  } catch (e) {
    status = "error";
  }
  try {
    run(
      "UPDATE webhooks SET last_status=?, last_at=? WHERE id=?",
      status,
      now(),
      hook.id,
    );
  } catch {
    /* the connection may already be closed */
  }
  return status;
}
/** Called after each saved change and page load. Never throws. */
export async function pumpEvents() {
  try {
    const list = collectEvents();
    if (list.length) await Promise.all(list.map(deliver));
  } catch (e) {
    console.error("Event pump:", e?.message);
  }
}

// 10. Subscriptions billed every month ---------------------------------------
export function billSubscriptions() {
  const today = zoneDate();
  const month = today.slice(0, 7);
  let n = 0;
  transaction(() => {
    for (const s of all(
      "SELECT * FROM subscriptions WHERE active=1 AND start_date<=? AND last_billed<>?",
      today,
      month,
    )) {
      if (Number(today.slice(8)) < Math.min(s.day_of_month, 28)) continue;
      insert("charges", {
        contact_id: s.contact_id,
        enrollment_id: null,
        label: `${s.label} — ${month}`,
        amount: s.amount,
        discount: 0,
        discount_reason: "",
        currency: settings().currency,
        due_date: today,
        created_at: now(),
      });
      run("UPDATE subscriptions SET last_billed=? WHERE id=?", month, s.id);
      audit(
        firstAdmin(),
        s.contact_id,
        `Monthly subscription billed: ${s.label}.`,
        "finance",
        "finance",
      );
      n++;
    }
  });
  return n;
}
/** Every staff member gets one summary per day for their role. */
export function dailyDigest() {
  const today = zoneDate();
  if (getMeta("digest_last") === today) return 0;
  setMeta("digest_last", today);
  let n = 0;
  for (const u of all("SELECT id, role FROM users WHERE active=1")) {
    const appts = one(
      "SELECT COUNT(*) n FROM appointments WHERE substr(starts_at,1,10)=? AND status IN ('Scheduled','Pending') AND (staff_id=? OR ? IN ('admin','manager','admissions'))",
      today,
      u.id,
      u.role,
    ).n;
    const tasks = one(
      "SELECT COUNT(*) n FROM tasks WHERE owner_id=? AND status='Open' AND substr(due_at,1,10)<=?",
      u.id,
      today,
    ).n;
    let text = `Votre journée : ${appts} rendez-vous, ${tasks} tâche(s) à faire`;
    if (["admin", "manager", "finance"].includes(u.role)) {
      const late = chargeRows().filter(
        (c) => c.balance > 0 && c.due_date < today,
      ).length;
      text += `, ${late} paiement(s) en retard`;
    }
    if (["admin", "manager", "admissions"].includes(u.role)) {
      const fresh = one(
        "SELECT COUNT(*) n FROM opportunities WHERE stage='New inquiry'",
      ).n;
      text += `, ${fresh} nouvelle(s) demande(s)`;
    }
    notify(u.id, "digest", text + ".");
    n++;
  }
  // Sunday: a summary of the week for the director (free, from the data).
  if (new Date(`${today}T12:00:00Z`).getUTCDay() === 0) {
    const since = iso(Date.now() - 7 * day);
    const before = iso(Date.now() - 14 * day);
    const sum = (a, b) =>
      one(
        "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE created_at>=? AND created_at<?",
        a,
        b,
      ).n;
    const week = sum(since, now());
    const prev = sum(before, since);
    const clients = one(
      "SELECT COUNT(*) n FROM contacts WHERE created_at>=?",
      since,
    ).n;
    const missed = one(
      "SELECT COUNT(*) n FROM appointments WHERE status='No-show' AND starts_at>=?",
      since,
    ).n;
    const top = one(
      "SELECT source, COUNT(*) n FROM opportunities WHERE created_at>=? GROUP BY source ORDER BY n DESC LIMIT 1",
      since,
    );
    const cur = settings().currency;
    const change = prev ? Math.round(((week - prev) / prev) * 100) : null;
    const text = `Résumé de la semaine : ${(week / 100).toLocaleString("fr-FR")} ${cur} encaissés${
      change == null ? "" : ` (${change >= 0 ? "+" : ""}${change} %)`
    }, ${clients} nouveau(x) client(s), ${missed} absence(s)${top ? `, meilleure source : ${top.source}` : ""}.`;
    for (const u of all(
      "SELECT id FROM users WHERE active=1 AND role IN ('admin','manager')",
    ))
      notify(u.id, "weekly", text, null, "Reports");
  }
  return n;
}
let lastTick = 0;
/** Light background work, at most once a minute. */
export async function tick() {
  if (Date.now() - lastTick < 60000) return;
  lastTick = Date.now();
  try {
    billSubscriptions();
    dailyDigest();
    await runFlows();
  } catch (e) {
    console.error("Platform tick:", e?.message);
  }
}

// Record history ------------------------------------------------------------
export function remember(table, id, userId, summary = "") {
  const row = one(`SELECT * FROM ${table} WHERE id=?`, Number(id));
  if (!row) return;
  for (const k of Object.keys(row))
    if (row[k] instanceof Uint8Array) delete row[k];
  insert("record_versions", {
    table_name: table,
    record_id: row.id,
    before: JSON.stringify(row),
    summary,
    user_id: userId,
    created_at: now(),
  });
  run(
    "DELETE FROM record_versions WHERE table_name=? AND record_id=? AND id NOT IN (SELECT id FROM record_versions WHERE table_name=? AND record_id=? ORDER BY id DESC LIMIT 30)",
    table,
    row.id,
    table,
    row.id,
  );
}

// State for the interface ----------------------------------------------------
export function platformState(u, ids, perms) {
  const admin = u.role === "admin";
  const desk = ["admin", "manager", "admissions"].includes(u.role);
  const conv = all(
    `SELECT m.contact_id, MAX(m.created_at) last_at, COUNT(*) total,
       SUM(CASE WHEN m.direction='in' AND m.read_at IS NULL THEN 1 ELSE 0 END) unread,
       (SELECT body FROM messages x WHERE x.contact_id=m.contact_id ORDER BY x.id DESC LIMIT 1) last_body,
       (SELECT direction FROM messages x WHERE x.contact_id=m.contact_id ORDER BY x.id DESC LIMIT 1) last_direction,
       (SELECT channel FROM messages x WHERE x.contact_id=m.contact_id ORDER BY x.id DESC LIMIT 1) last_channel,
       v.status, v.assignee_id, v.suggestion, v.urgent
     FROM messages m LEFT JOIN conversations v ON v.contact_id=m.contact_id GROUP BY m.contact_id ORDER BY last_at DESC`,
  ).filter(
    (c) =>
      ids.has(c.contact_id) &&
      (desk || c.assignee_id === u.id || u.role === "instructor"),
  );
  const segments = all("SELECT * FROM segments ORDER BY name").map((s) => {
    const filters = json(s.filters, {});
    return {
      ...s,
      filters,
      contact_ids: [...segmentMembers(filters)].filter((x) => ids.has(x)),
    };
  });
  return {
    conversations: conv,
    inboxUnread: conv.reduce((n, c) => n + (c.unread || 0), 0),
    flows: admin
      ? all("SELECT * FROM flows ORDER BY id DESC").map((f) => ({
          ...f,
          conditions: json(f.conditions, {}),
          actions: json(f.actions, []),
          runs: all(
            "SELECT * FROM flow_runs WHERE flow_id=? ORDER BY id DESC LIMIT 15",
            f.id,
          ),
          total: one(
            "SELECT COUNT(*) n FROM flow_runs WHERE flow_id=? AND test=0",
            f.id,
          ).n,
        }))
      : [],
    flowTriggers,
    flowPresets,
    customFields: all(
      "SELECT * FROM custom_fields ORDER BY entity, sort, id",
    ).map((f) => ({ ...f, options: json(f.options, []) })),
    customValues: all("SELECT * FROM custom_values"),
    tags: all("SELECT * FROM tags ORDER BY name"),
    contactTags: all("SELECT * FROM contact_tags").filter((t) =>
      ids.has(t.contact_id),
    ),
    segments,
    forms: desk
      ? all("SELECT * FROM forms ORDER BY id DESC").map((f) => ({
          ...f,
          fields: json(f.fields, []),
        }))
      : [],
    docTemplates: all("SELECT * FROM doc_templates ORDER BY name"),
    comments: all(
      "SELECT c.*, u.name user_name FROM comments c JOIN users u ON u.id=c.user_id ORDER BY c.id",
    ).filter((c) => ids.has(c.contact_id)),
    notifications: all(
      "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60",
      u.id,
    ),
    dashboardLayout: json(
      one("SELECT dashboard FROM user_prefs WHERE user_id=?", u.id)?.dashboard,
      [],
    ),
    calendarFeed: !!one(
      "SELECT calendar_token FROM users WHERE id=? AND calendar_token<>''",
      u.id,
    ),
    subscriptions: perms.editFinance
      ? all("SELECT * FROM subscriptions ORDER BY id DESC").filter((s) =>
          ids.has(s.contact_id),
        )
      : [],
    promoCodes: perms.editFinance
      ? all("SELECT * FROM promo_codes ORDER BY id DESC")
      : [],
    giftCards: perms.editFinance
      ? all("SELECT * FROM gift_cards ORDER BY id DESC")
      : [],
    branches: all("SELECT * FROM branches ORDER BY name"),
    apiKeys: admin
      ? all(
          "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY id DESC",
        )
      : [],
    webhooks: admin
      ? all(
          "SELECT id, url, events, active, last_status, last_at, created_at FROM webhooks ORDER BY id DESC",
        ).map((h) => ({ ...h, events: json(h.events, []) }))
      : [],
    webhookEvents,
  };
}

// Routes ----------------------------------------------------------------------
export function installPlatformPublic(app) {
  // 4. Public forms.
  const hits = new Map();
  const ipKey = (req) =>
    hash(String(req.headers["x-real-ip"] || req.socket.remoteAddress || ""));
  app.get("/api/public/forms/:slug", (req, res, next) => {
    try {
      const f = one(
        "SELECT * FROM forms WHERE slug=? AND active=1",
        str(req.params.slug, 80),
      );
      if (!f) fail("This form is not available.", 404);
      if (req.query.preview !== "1")
        run("UPDATE forms SET views=views+1 WHERE id=?", f.id);
      res.json({
        title: f.title,
        title_ar: f.title_ar,
        intro: f.intro,
        intro_ar: f.intro_ar,
        consent_text: f.consent_text,
        fields: json(f.fields, []),
        academy: settings().academy,
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/public/forms/:slug", (req, res, next) => {
    try {
      const f = one(
        "SELECT * FROM forms WHERE slug=? AND active=1",
        str(req.params.slug, 80),
      );
      if (!f) fail("This form is not available.", 404);
      const b = req.body || {};
      // Spam: hidden field filled, sent too fast, or too many from one address.
      const key = ipKey(req);
      const recent = (hits.get(key) || []).filter(
        (t) => Date.now() - t < 600000,
      );
      if (b.website || Number(b.elapsed_ms) < 2500 || recent.length >= 5) {
        run("UPDATE forms SET spam=spam+1 WHERE id=?", f.id);
        return res.json({ ok: true });
      }
      hits.set(key, [...recent, Date.now()]);
      const fields = json(f.fields, []);
      const answers =
        b.answers && typeof b.answers === "object" ? b.answers : {};
      const get = (map) => {
        const field = fields.find((x) => x.map === map);
        return field ? str(answers[field.key], 1000) : "";
      };
      for (const field of fields)
        if (field.required && !str(answers[field.key]))
          fail(`${field.label} is required.`);
      if (f.consent_text && !b.consent) fail("Please accept the consent.");
      const name = get("name") || "Client";
      const phone = get("phone");
      const email = get("email").toLowerCase();
      if (!phone && !email) fail("Enter a phone number or an email.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail("Enter a valid email address.");
      const result = transaction(() => {
        let c = findContact(phone, email);
        if (!c) {
          const id = insert("contacts", {
            name: str(name, 100),
            email,
            phone: str(phone, 40),
            language: b.lang === "ar" ? "Arabic" : "French",
            consent: b.consent ? 1 : 0,
            guardian: "",
            notes: "",
            created_at: now(),
          });
          c = one("SELECT * FROM contacts WHERE id=?", id);
        }
        const extra = fields
          .filter((x) => !["name", "phone", "email"].includes(x.map))
          .map((x) => `${x.label}: ${str(answers[x.key], 1000)}`)
          .filter((l) => !l.endsWith(": "))
          .join("\n");
        const owner =
          one(
            "SELECT id FROM users WHERE active=1 AND role='admissions' ORDER BY id",
          )?.id || firstAdmin();
        const program = f.program_id
          ? one("SELECT * FROM programs WHERE id=?", f.program_id)
          : null;
        const opp = insert("opportunities", {
          contact_id: c.id,
          program_id: program?.id ?? null,
          owner_id: owner,
          service_type: f.service || "Other",
          interest: program?.name || get("interest") || f.title,
          stage: "New inquiry",
          source: `Formulaire : ${f.title}`.slice(0, 100),
          campaign: str(b.utm || "", 100),
          tags: "form",
          notes: extra,
          expected_date: "",
          created_at: now(),
          stage_at: now(),
          version: 1,
        });
        for (const x of fields)
          if (String(x.map || "").startsWith("custom:") && str(answers[x.key]))
            run(
              "INSERT INTO custom_values(field_id, record_id, value) VALUES (?,?,?) ON CONFLICT(field_id, record_id) DO UPDATE SET value=excluded.value",
              Number(x.map.slice(7)),
              c.id,
              str(answers[x.key], 1000),
            );
        insert("tasks", {
          contact_id: c.id,
          owner_id: owner,
          title: "Make first contact",
          due_at: now(),
          priority: "High",
          status: "Open",
          created_at: now(),
          version: 1,
        });
        run("UPDATE forms SET submissions=submissions+1 WHERE id=?", f.id);
        audit(owner, c.id, `Form sent: ${f.title}.`, "inquiry");
        return { contact_id: c.id, opportunity_id: opp };
      });
      pumpEvents();
      res.json({ ok: true, ...result });
    } catch (e) {
      next(e);
    }
  });

  // 8. Calendar feed: subscribe once in Google Calendar or on the phone.
  app.get("/api/public/calendar/:token", (req, res, next) => {
    try {
      const token = str(req.params.token, 100).replace(/\.ics$/, "");
      const u = token
        ? one(
            "SELECT id, name FROM users WHERE calendar_token=? AND active=1",
            hash(token),
          )
        : null;
      if (!u) fail("Unknown calendar.", 404);
      const from = iso(Date.now() - 30 * day);
      const esc = (s) =>
        String(s || "")
          .replace(/[\\;,]/g, (m) => "\\" + m)
          .replace(/\n/g, "\\n");
      const stamp = (s) => s.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const items = [
        ...all(
          `SELECT a.id, a.title, a.starts_at, a.ends_at, a.location, a.meeting_url, c.name FROM appointments a
           LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.staff_id=? AND a.starts_at>? AND a.status IN ('Scheduled','Pending','Done')`,
          u.id,
          from,
        ).map((a) => ({
          uid: `appt-${a.id}`,
          title: `${a.title}${a.name ? " — " + a.name.split(" ")[0] : ""}`,
          ...a,
        })),
        ...all(
          `SELECT s.id, s.title, s.starts_at, s.ends_at, s.room location, h.name FROM sessions s JOIN cohorts h ON h.id=s.cohort_id
           WHERE h.instructor_id=? AND s.starts_at>? AND s.status='Scheduled'`,
          u.id,
          from,
        ).map((s) => ({
          uid: `session-${s.id}`,
          title: `${s.name} — ${s.title}`,
          ...s,
        })),
      ];
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Luminol Academy//CRM//FR",
        `X-WR-CALNAME:${esc(settings().academy)} — ${esc(u.name)}`,
        ...items.flatMap((x) => [
          "BEGIN:VEVENT",
          `UID:${x.uid}@luminol`,
          `DTSTAMP:${stamp(now())}`,
          `DTSTART:${stamp(new Date(x.starts_at).toISOString())}`,
          `DTEND:${stamp(new Date(x.ends_at).toISOString())}`,
          `SUMMARY:${esc(x.title)}`,
          ...(x.location ? [`LOCATION:${esc(x.location)}`] : []),
          ...(x.meeting_url ? [`URL:${x.meeting_url}`] : []),
          "END:VEVENT",
        ]),
        "END:VCALENDAR",
      ];
      res.type("text/calendar; charset=utf-8").send(lines.join("\r\n"));
    } catch (e) {
      next(e);
    }
  });

  // 13. REST API with a key: Authorization: Bearer lum_...
  const apiAuth = (req, res, next) => {
    const given = String(req.headers.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const k = given.startsWith("lum_")
      ? one(
          "SELECT * FROM api_keys WHERE key_hash=? AND revoked_at IS NULL",
          hash(given),
        )
      : null;
    if (!k)
      return res.status(401).json({ error: "A valid API key is required." });
    run("UPDATE api_keys SET last_used_at=? WHERE id=?", now(), k.id);
    req.apiKey = k;
    next();
  };
  const page = (req) => ({
    limit: Math.min(200, Math.max(1, Number(req.query.limit) || 50)),
    after: Math.max(0, Number(req.query.after) || 0),
  });
  const list = (sql) => (req, res) => {
    const { limit, after } = page(req);
    const rows = all(sql + " ORDER BY id LIMIT ?", after, limit);
    res.json({
      data: rows,
      next: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  };
  app.get(
    "/api/v1/contacts",
    apiAuth,
    list(
      "SELECT id, name, email, phone, language, consent, birth_date, created_at FROM contacts WHERE id>?",
    ),
  );
  app.get(
    "/api/v1/inquiries",
    apiAuth,
    list(
      "SELECT id, contact_id, program_id, owner_id, service_type, interest, stage, source, campaign, created_at, stage_at FROM opportunities WHERE id>?",
    ),
  );
  app.get(
    "/api/v1/appointments",
    apiAuth,
    list(
      "SELECT id, kind, title, contact_id, staff_id, starts_at, ends_at, status, location, source, created_at FROM appointments WHERE id>?",
    ),
  );
  app.get(
    "/api/v1/payments",
    apiAuth,
    list(
      "SELECT * FROM (SELECT p.id, p.amount, p.method, p.reference, p.created_at, p.receipt_no, ch.contact_id, ch.label, ch.currency FROM payments p JOIN charges ch ON ch.id=p.charge_id) WHERE id>?",
    ),
  );
  app.post("/api/v1/inquiries", apiAuth, (req, res, next) => {
    try {
      const b = req.body || {};
      const name = str(b.name, 100);
      const phone = str(b.phone, 40);
      const email = str(b.email, 254).toLowerCase();
      if (!name) fail("name is required.");
      if (!phone && !email) fail("phone or email is required.");
      const out = transaction(() => {
        let c = findContact(phone, email);
        if (!c) {
          const id = insert("contacts", {
            name,
            email,
            phone,
            language: str(b.language, 40) || "French",
            consent: b.consent ? 1 : 0,
            guardian: "",
            notes: "",
            created_at: now(),
          });
          c = one("SELECT * FROM contacts WHERE id=?", id);
        }
        const owner =
          one(
            "SELECT id FROM users WHERE active=1 AND role='admissions' ORDER BY id",
          )?.id || firstAdmin();
        const id = insert("opportunities", {
          contact_id: c.id,
          program_id: null,
          owner_id: owner,
          service_type: str(b.service_type, 80) || "Other",
          interest: str(b.interest, 180) || "Website",
          stage: "New inquiry",
          source: str(b.source, 100) || `API : ${req.apiKey.name}`,
          campaign: str(b.campaign, 100),
          tags: "api",
          notes: str(b.message, 4000),
          expected_date: "",
          created_at: now(),
          stage_at: now(),
          version: 1,
        });
        audit(
          owner,
          c.id,
          `Request received through the API (${req.apiKey.name}).`,
          "inquiry",
        );
        return { contact_id: c.id, inquiry_id: id };
      });
      pumpEvents();
      res.status(201).json(out);
    } catch (e) {
      next(e);
    }
  });
}

export function installPlatform(app, h) {
  const {
    write,
    del,
    allow,
    must,
    text,
    integer,
    date,
    found,
    contactAccess,
    drop,
  } = h;
  const staff = ["admin", "admissions", "academic", "instructor", "finance"];
  const desk = ["admin", "admissions"];
  const money = ["admin", "admissions", "finance"];

  // 1. Inbox
  app.get("/api/messages/:contactId", (req, res, next) => {
    try {
      allow(req, staff);
      const c = contactAccess(req.user, req.params.contactId);
      run(
        "UPDATE messages SET read_at=? WHERE contact_id=? AND direction='in' AND read_at IS NULL",
        now(),
        c.id,
      );
      res.json({
        messages: all(
          "SELECT m.*, u.name user_name FROM messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.contact_id=? ORDER BY m.id",
          c.id,
        ),
        conversation: one(
          "SELECT * FROM conversations WHERE contact_id=?",
          c.id,
        ) || {
          contact_id: c.id,
          status: "New",
          assignee_id: null,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/messages", async (req, res, next) => {
    try {
      allow(req, staff);
      const c = contactAccess(req.user, req.body.contact_id);
      const direction = ["in", "out", "note"].includes(req.body.direction)
        ? req.body.direction
        : "out";
      const channel = [
        "whatsapp",
        "email",
        "phone",
        "sms",
        "instagram",
        "facebook",
        "other",
      ].includes(req.body.channel)
        ? req.body.channel
        : "whatsapp";
      const body = text(req.body.body, "Message", 4000);
      let sent = false;
      if (direction === "out" && req.body.send && channel === "whatsapp") {
        must(
          c.consent,
          "Communication consent is required before sending a message.",
        );
        await sendWhatsApp(c.phone, body);
        sent = true;
      }
      const id = transaction(() =>
        logMessage({
          contact_id: c.id,
          direction,
          channel,
          body,
          user_id: req.user.id,
        }),
      );
      res.json({ id, sent });
    } catch (e) {
      next(e);
    }
  });
  write(
    "/api/conversations/:contactId",
    staff,
    (req) => {
      const c = contactAccess(req.user, req.params.contactId);
      touchConversation(c.id);
      const b = req.body;
      if (b.status) {
        must(["New", "Open", "Resolved"].includes(b.status), "Unknown status.");
        run(
          "UPDATE conversations SET status=? WHERE contact_id=?",
          b.status,
          c.id,
        );
      }
      if (b.assignee_id !== undefined) {
        const to = b.assignee_id
          ? integer(b.assignee_id, "Staff member")
          : null;
        run(
          "UPDATE conversations SET assignee_id=? WHERE contact_id=?",
          to,
          c.id,
        );
        if (to && to !== req.user.id)
          notify(
            to,
            "message",
            `${req.user.name} vous a confié la conversation avec ${c.name}.`,
            c.id,
            "Messages",
          );
      }
      return { ok: true };
    },
    "patch",
  );
  // 8. Call log: outcome + optional call-back task.
  write("/api/calls", staff, (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const outcome = [
      "reached",
      "no_answer",
      "call_back",
      "wrong_number",
    ].includes(req.body.outcome)
      ? req.body.outcome
      : "reached";
    logMessage({
      contact_id: c.id,
      direction: "call",
      channel: "phone",
      body: text(req.body.body || "", "Summary", 2000, false),
      outcome,
      user_id: req.user.id,
    });
    if (outcome === "call_back" || outcome === "no_answer")
      insert("tasks", {
        contact_id: c.id,
        owner_id: req.user.id,
        title:
          outcome === "call_back"
            ? `Rappeler ${c.name}`
            : `Rappeler ${c.name} (pas de réponse)`,
        due_at: req.body.callback_at
          ? new Date(req.body.callback_at).toISOString()
          : iso(Date.now() + day),
        priority: "Normal",
        status: "Open",
        created_at: now(),
        version: 1,
      });
    audit(req.user.id, c.id, `Call: ${outcome.replace("_", " ")}.`, "call");
    return { ok: true };
  });

  // 2. Automation builder
  const flowBody = (b) => {
    must(flowTriggers.includes(b.trigger), "Choose when the scenario starts.");
    const actions = Array.isArray(b.actions) ? b.actions.slice(0, 6) : [];
    must(actions.length, "Add at least one action.");
    for (const a of actions)
      must(
        ["task", "whatsapp", "stage", "tag", "notify"].includes(a.type),
        "Unknown action.",
      );
    return {
      name: text(b.name, "Name", 120),
      trigger: b.trigger,
      conditions: JSON.stringify(b.conditions || {}).slice(0, 2000),
      actions: JSON.stringify(actions).slice(0, 8000),
      delay_minutes: integer(b.delay_minutes || 0, "Delay", 0, 60 * 24 * 90),
      enabled: b.enabled === false ? 0 : 1,
    };
  };
  write("/api/flows", ["admin"], (req) => {
    const id = insert("flows", {
      ...flowBody(req.body),
      created_by: req.user.id,
      created_at: now(),
    });
    audit(
      req.user.id,
      null,
      `Automation created: ${req.body.name}.`,
      "automation",
    );
    return { id };
  });
  write(
    "/api/flows/:id",
    ["admin"],
    (req) => {
      const f = found("flows", req.params.id, "Scenario");
      if (Object.keys(req.body).length === 1 && "enabled" in req.body) {
        run(
          "UPDATE flows SET enabled=? WHERE id=?",
          req.body.enabled ? 1 : 0,
          f.id,
        );
        return { ok: true };
      }
      const v = flowBody(req.body);
      run(
        "UPDATE flows SET name=?, trigger=?, conditions=?, actions=?, delay_minutes=?, enabled=? WHERE id=?",
        v.name,
        v.trigger,
        v.conditions,
        v.actions,
        v.delay_minutes,
        v.enabled,
        f.id,
      );
      return { ok: true };
    },
    "patch",
  );
  write("/api/flows/:id/test", ["admin"], (req) =>
    testFlow(found("flows", req.params.id, "Scenario")),
  );
  app.post("/api/flows/run", async (req, res, next) => {
    try {
      allow(req, ["admin"]);
      res.json(await runFlows());
    } catch (e) {
      next(e);
    }
  });
  del("/api/flows/:id", ["admin"], (req) => {
    const f = found("flows", req.params.id, "Scenario");
    drop("DELETE FROM flow_runs WHERE flow_id=?", f.id);
    drop("DELETE FROM flows WHERE id=?", f.id);
    return { ok: true };
  });

  // 3. Custom fields, tags, segments
  write("/api/custom-fields", ["admin"], (req) => {
    const b = req.body;
    must(
      ["contact", "opportunity", "cohort"].includes(b.entity),
      "Choose where the field appears.",
    );
    must(
      ["text", "number", "date", "list", "yesno"].includes(b.kind),
      "Choose a field type.",
    );
    const id = insert("custom_fields", {
      entity: b.entity,
      label: text(b.label, "Field name", 80),
      kind: b.kind,
      options: JSON.stringify(
        (Array.isArray(b.options)
          ? b.options
          : String(b.options || "").split(/\n|,/)
        )
          .map((x) => str(x, 80))
          .filter(Boolean)
          .slice(0, 60),
      ),
      sort: one("SELECT COUNT(*) n FROM custom_fields").n,
    });
    return { id };
  });
  del("/api/custom-fields/:id", ["admin"], (req) => {
    const f = found("custom_fields", req.params.id, "Field");
    drop("DELETE FROM custom_values WHERE field_id=?", f.id);
    drop("DELETE FROM custom_fields WHERE id=?", f.id);
    return { ok: true };
  });
  write(
    "/api/custom-values",
    ["admin", "admissions", "academic", "instructor"],
    (req) => {
      const f = found("custom_fields", req.body.field_id, "Field");
      const recordId = integer(req.body.record_id, "Record");
      if (f.entity === "contact") contactAccess(req.user, recordId);
      if (f.entity === "opportunity") {
        allow(req, ["admin", "admissions"]);
        found("opportunities", recordId, "Request");
      }
      if (f.entity === "cohort") {
        allow(req, ["admin", "academic"]);
        found("cohorts", recordId, "Group");
      }
      let value = text(String(req.body.value ?? ""), f.label, 1000, false);
      if (value && f.kind === "number")
        must(!isNaN(Number(value)), `${f.label} must be a number.`);
      if (value && f.kind === "date") date(value, f.label);
      if (f.kind === "yesno")
        value = value === "1" || value === "true" ? "1" : value ? "0" : "";
      run(
        "INSERT INTO custom_values(field_id, record_id, value) VALUES (?,?,?) ON CONFLICT(field_id, record_id) DO UPDATE SET value=excluded.value",
        f.id,
        recordId,
        value,
      );
      return { ok: true };
    },
    "put",
  );
  const colors = ["teal", "amber", "red", "purple", "blue", "neutral"];
  write("/api/tags", ["admin", "admissions", "academic"], (req) => {
    const name = text(req.body.name, "Tag", 40);
    const existing = one(
      "SELECT id FROM tags WHERE name=? COLLATE NOCASE",
      name,
    );
    if (existing) return { id: existing.id };
    return {
      id: insert("tags", {
        name,
        color: colors.includes(req.body.color)
          ? req.body.color
          : colors[one("SELECT COUNT(*) n FROM tags").n % colors.length],
      }),
    };
  });
  del("/api/tags/:id", ["admin"], (req) => {
    const t = found("tags", req.params.id, "Tag");
    drop("DELETE FROM contact_tags WHERE tag_id=?", t.id);
    drop("DELETE FROM tags WHERE id=?", t.id);
    return { ok: true };
  });
  write(
    "/api/contacts/:id/tags",
    ["admin", "admissions", "academic", "instructor"],
    (req) => {
      const c = contactAccess(req.user, req.params.id);
      const t = found("tags", req.body.tag_id, "Tag");
      if (req.body.on === false)
        run(
          "DELETE FROM contact_tags WHERE contact_id=? AND tag_id=?",
          c.id,
          t.id,
        );
      else
        run(
          "INSERT OR IGNORE INTO contact_tags(contact_id, tag_id) VALUES (?,?)",
          c.id,
          t.id,
        );
      return { ok: true };
    },
  );
  write("/api/segments", ["admin", "admissions", "manager"], (req) => {
    const f = req.body.filters || {};
    const id = insert("segments", {
      name: text(req.body.name, "Segment name", 100),
      filters: JSON.stringify({
        tag_ids: (f.tag_ids || []).map(Number).filter(Boolean).slice(0, 10),
        service: str(f.service, 100),
        source: str(f.source, 100),
        language: str(f.language, 40),
        inactive_days: Number(f.inactive_days) || 0,
        consent: !!f.consent,
        fields: Object.fromEntries(
          Object.entries(f.fields || {}).map(([k, v]) => [
            Number(k),
            str(v, 200),
          ]),
        ),
      }),
      user_id: req.user.id,
      created_at: now(),
    });
    return {
      id,
      count: segmentMembers(
        JSON.parse(one("SELECT filters FROM segments WHERE id=?", id).filters),
      ).size,
    };
  });
  write("/api/segments/preview", ["admin", "admissions", "manager"], (req) => ({
    contact_ids: [...segmentMembers(req.body.filters || {})],
  }));
  del("/api/segments/:id", ["admin", "admissions", "manager"], (req) => {
    const s = found("segments", req.params.id, "Segment");
    drop("DELETE FROM segments WHERE id=?", s.id);
    return { ok: true };
  });

  // 4. Forms
  const formBody = (b) => {
    const fields = (Array.isArray(b.fields) ? b.fields : [])
      .slice(0, 30)
      .map((x, i) => ({
        key: str(x.key, 40) || `f${i + 1}`,
        label: text(x.label, "Field label", 120),
        label_ar: str(x.label_ar, 120),
        type: [
          "text",
          "phone",
          "email",
          "textarea",
          "select",
          "date",
          "number",
          "checkbox",
        ].includes(x.type)
          ? x.type
          : "text",
        required: !!x.required,
        options: (Array.isArray(x.options)
          ? x.options
          : String(x.options || "").split(/\n|,/)
        )
          .map((o) => str(o, 80))
          .filter(Boolean)
          .slice(0, 40),
        map:
          ["name", "phone", "email", "interest", "message"].includes(x.map) ||
          /^custom:\d+$/.test(x.map || "")
            ? x.map
            : "",
      }));
    must(
      fields.some((x) => x.map === "phone" || x.map === "email"),
      "The form needs a phone or e-mail field.",
    );
    return {
      title: text(b.title, "Title", 120),
      title_ar: str(b.title_ar, 120),
      intro: str(b.intro, 1000),
      intro_ar: str(b.intro_ar, 1000),
      fields: JSON.stringify(fields),
      consent_text: str(b.consent_text, 500),
      service: str(b.service, 80),
      program_id: b.program_id ? integer(b.program_id, "Program") : null,
      active: b.active === false ? 0 : 1,
    };
  };
  write("/api/forms", desk, (req) => {
    const v = formBody(req.body);
    let slug =
      (str(req.body.slug, 60) || v.title)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) || "form";
    if (one("SELECT id FROM forms WHERE slug=?", slug))
      slug += "-" + randomBytes(2).toString("hex");
    const id = insert("forms", { ...v, slug, created_at: now() });
    audit(req.user.id, null, `Form created: ${v.title}.`, "inquiry");
    return { id, slug };
  });
  write(
    "/api/forms/:id",
    desk,
    (req) => {
      const f = found("forms", req.params.id, "Form");
      if (Object.keys(req.body).length === 1 && "active" in req.body) {
        run(
          "UPDATE forms SET active=? WHERE id=?",
          req.body.active ? 1 : 0,
          f.id,
        );
        return { ok: true };
      }
      const v = formBody(req.body);
      run(
        "UPDATE forms SET title=?, title_ar=?, intro=?, intro_ar=?, fields=?, consent_text=?, service=?, program_id=?, active=? WHERE id=?",
        v.title,
        v.title_ar,
        v.intro,
        v.intro_ar,
        v.fields,
        v.consent_text,
        v.service,
        v.program_id,
        v.active,
        f.id,
      );
      return { ok: true };
    },
    "patch",
  );
  del("/api/forms/:id", ["admin"], (req) => {
    const f = found("forms", req.params.id, "Form");
    drop("DELETE FROM forms WHERE id=?", f.id);
    return { ok: true };
  });

  // 5. Document templates (the document is rendered and signed in the browser)
  write("/api/doc-templates", ["admin", "manager"], (req) => {
    const b = req.body;
    const v = {
      name: text(b.name, "Name", 120),
      kind: [
        "contract",
        "agreement",
        "attendance",
        "certificate",
        "other",
      ].includes(b.kind)
        ? b.kind
        : "other",
      body: text(b.body, "Text", 20000),
    };
    if (b.id) {
      const t = found("doc_templates", b.id, "Template");
      run(
        "UPDATE doc_templates SET name=?, kind=?, body=? WHERE id=?",
        v.name,
        v.kind,
        v.body,
        t.id,
      );
      return { id: t.id };
    }
    return { id: insert("doc_templates", { ...v, created_at: now() }) };
  });
  del("/api/doc-templates/:id", ["admin"], (req) => {
    const t = found("doc_templates", req.params.id, "Template");
    drop("DELETE FROM doc_templates WHERE id=?", t.id);
    return { ok: true };
  });

  // 7. Comments with @mentions, notifications
  write("/api/comments", [...staff, "manager"], (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const body = text(req.body.body, "Comment", 2000);
    const id = insert("comments", {
      contact_id: c.id,
      user_id: req.user.id,
      body,
      created_at: now(),
    });
    const mentioned = new Set((req.body.mentions || []).map(Number));
    for (const u of all("SELECT id, name FROM users WHERE active=1"))
      if (body.toLowerCase().includes("@" + u.name.split(" ")[0].toLowerCase()))
        mentioned.add(u.id);
    mentioned.delete(req.user.id);
    for (const uid of mentioned)
      notify(
        uid,
        "mention",
        `${req.user.name} vous a mentionné(e) : « ${body.slice(0, 120)} »`,
        c.id,
      );
    return { id, mentioned: mentioned.size };
  });
  del("/api/comments/:id", [...staff, "manager"], (req) => {
    const c = found("comments", req.params.id, "Comment");
    must(
      c.user_id === req.user.id || req.user.role === "admin",
      "You can only delete your own comments.",
      403,
    );
    drop("DELETE FROM comments WHERE id=?", c.id);
    return { ok: true };
  });
  write("/api/notifications/read", [...staff, "manager"], (req) => {
    if (req.body.id)
      run(
        "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
        now(),
        integer(req.body.id, "Notification"),
        req.user.id,
      );
    else
      run(
        "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
        now(),
        req.user.id,
      );
    return { ok: true };
  });

  // 8. Calendar feed link (shown once)
  write("/api/me/calendar-feed", [...staff, "manager"], (req) => {
    if (req.body.off) {
      run("UPDATE users SET calendar_token='' WHERE id=?", req.user.id);
      return { ok: true };
    }
    const token = randomBytes(18).toString("base64url");
    run(
      "UPDATE users SET calendar_token=? WHERE id=?",
      hash(token),
      req.user.id,
    );
    return { path: `/api/public/calendar/${token}.ics` };
  });

  // 9. Personal dashboard
  write(
    "/api/me/dashboard",
    [...staff, "manager"],
    (req) => {
      const layout = (Array.isArray(req.body.layout) ? req.body.layout : [])
        .map((x) => str(x, 40))
        .filter(Boolean)
        .slice(0, 30);
      run(
        "INSERT INTO user_prefs(user_id, dashboard) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET dashboard=excluded.dashboard",
        req.user.id,
        JSON.stringify(layout),
      );
      return { ok: true };
    },
    "put",
  );

  // 10. Subscriptions, promo codes, gift cards, loyalty
  write("/api/subscriptions", money, (req) => {
    const b = req.body;
    const c = contactAccess(req.user, b.contact_id);
    const id = insert("subscriptions", {
      contact_id: c.id,
      label: text(b.label, "Subscription", 120),
      amount: integer(b.amount, "Monthly amount", 1),
      sessions: integer(b.sessions || 0, "Sessions per month", 0, 100),
      day_of_month: integer(b.day_of_month || 1, "Billing day", 1, 28),
      start_date: b.start_date ? date(b.start_date, "Start date") : zoneDate(),
      active: 1,
      last_billed: "",
      created_at: now(),
    });
    audit(
      req.user.id,
      c.id,
      `Monthly subscription started: ${b.label}.`,
      "finance",
      "finance",
    );
    return { id, billed: billSubscriptions() };
  });
  write(
    "/api/subscriptions/:id",
    money,
    (req) => {
      const s = found("subscriptions", req.params.id, "Subscription");
      run(
        "UPDATE subscriptions SET active=? WHERE id=?",
        req.body.active ? 1 : 0,
        s.id,
      );
      audit(
        req.user.id,
        s.contact_id,
        `Subscription ${req.body.active ? "resumed" : "stopped"}: ${s.label}.`,
        "finance",
        "finance",
      );
      return { ok: true };
    },
    "patch",
  );
  write("/api/subscriptions/bill", money, () => ({
    billed: billSubscriptions(),
  }));
  write("/api/promo-codes", ["admin", "finance"], (req) => {
    const b = req.body;
    const percent = integer(b.percent || 0, "Percent", 0, 100);
    const amount = integer(b.amount || 0, "Amount", 0);
    must(percent || amount, "Choose a percentage or an amount.");
    const code = text(b.code, "Code", 30).toUpperCase().replace(/\s+/g, "");
    must(
      !one("SELECT id FROM promo_codes WHERE code=?", code),
      "This code already exists.",
      409,
    );
    return {
      id: insert("promo_codes", {
        code,
        percent,
        amount,
        max_uses: integer(b.max_uses || 0, "Uses", 0, 100000),
        used: 0,
        expires_on: b.expires_on ? date(b.expires_on, "Valid until") : "",
        active: 1,
        created_at: now(),
      }),
    };
  });
  write(
    "/api/promo-codes/:id",
    ["admin", "finance"],
    (req) => {
      const p = found("promo_codes", req.params.id, "Code");
      run(
        "UPDATE promo_codes SET active=? WHERE id=?",
        req.body.active ? 1 : 0,
        p.id,
      );
      return { ok: true };
    },
    "patch",
  );
  /** Apply a promo code to an amount due: it becomes a discount. */
  write("/api/promo-codes/apply", money, (req) => {
    const code = text(req.body.code, "Code", 30)
      .toUpperCase()
      .replace(/\s+/g, "");
    const p = one("SELECT * FROM promo_codes WHERE code=? AND active=1", code);
    must(p, "This code does not exist or is no longer active.", 404);
    must(
      !p.expires_on || p.expires_on >= zoneDate(),
      "This code has expired.",
      409,
    );
    must(
      !p.max_uses || p.used < p.max_uses,
      "This code has been used up.",
      409,
    );
    const ch = chargeRows().find((x) => x.id === Number(req.body.charge_id));
    must(ch, "Charge not found.", 404);
    contactAccess(req.user, ch.contact_id);
    must(ch.discount === 0, "This amount already has a discount.", 409);
    const discount = Math.min(
      ch.amount - 1,
      p.percent ? Math.round((ch.amount * p.percent) / 100) : p.amount,
    );
    must(
      discount <= ch.balance,
      "The discount is larger than what remains to pay.",
      409,
    );
    run(
      "UPDATE charges SET discount=?, discount_reason=? WHERE id=?",
      discount,
      `Code ${p.code}`,
      ch.id,
    );
    run("UPDATE promo_codes SET used=used+1 WHERE id=?", p.id);
    audit(
      req.user.id,
      ch.contact_id,
      `Promo code ${p.code} applied: −${(discount / 100).toFixed(2)}.`,
      "finance",
      "finance",
    );
    return { discount };
  });
  write("/api/gift-cards", money, (req) => {
    const b = req.body;
    const amount = integer(b.amount, "Amount", 100);
    const code = "GIFT-" + randomBytes(4).toString("hex").toUpperCase();
    const buyer = b.buyer_id ? contactAccess(req.user, b.buyer_id) : null;
    const id = insert("gift_cards", {
      code,
      amount,
      balance: amount,
      buyer_id: buyer?.id ?? null,
      recipient: str(b.recipient, 120),
      expires_on: b.expires_on ? date(b.expires_on, "Valid until") : "",
      created_at: now(),
    });
    if (buyer && b.charge_buyer)
      insert("charges", {
        contact_id: buyer.id,
        enrollment_id: null,
        label: `Carte cadeau ${code}`,
        amount,
        discount: 0,
        discount_reason: "",
        currency: settings().currency,
        due_date: zoneDate(),
        created_at: now(),
      });
    audit(
      req.user.id,
      buyer?.id ?? null,
      `Gift card ${code} created.`,
      "finance",
      "finance",
    );
    return { id, code };
  });
  /** Pay part of an amount due with a gift card. */
  write("/api/gift-cards/redeem", money, (req) => {
    const g = one(
      "SELECT * FROM gift_cards WHERE code=?",
      text(req.body.code, "Code", 30).toUpperCase(),
    );
    must(g, "This gift card does not exist.", 404);
    must(
      !g.expires_on || g.expires_on >= zoneDate(),
      "This gift card has expired.",
      409,
    );
    must(g.balance > 0, "This gift card has been used up.", 409);
    const ch = chargeRows().find((x) => x.id === Number(req.body.charge_id));
    must(ch && ch.balance > 0, "Choose an amount that is still due.", 404);
    contactAccess(req.user, ch.contact_id);
    const amount = Math.min(g.balance, ch.balance);
    const year = now().slice(0, 4);
    insert("payments", {
      receipt_no: one(
        "SELECT MAX(COALESCE(MAX(receipt_no),0), COUNT(*))+1 n FROM payments WHERE substr(created_at,1,4)=?",
        year,
      ).n,
      charge_id: ch.id,
      amount,
      method: "Gift card",
      reference: g.code,
      created_at: now(),
      user_id: req.user.id,
    });
    run("UPDATE gift_cards SET balance=balance-? WHERE id=?", amount, g.id);
    audit(
      req.user.id,
      ch.contact_id,
      `Paid with gift card ${g.code}: ${(amount / 100).toFixed(2)}.`,
      "finance",
      "finance",
    );
    return { amount, balance: g.balance - amount };
  });
  write(
    "/api/contacts/:id/referral",
    ["admin", "admissions"],
    (req) => {
      const c = contactAccess(req.user, req.params.id);
      const by = req.body.referred_by
        ? contactAccess(req.user, req.body.referred_by)
        : null;
      must(!by || by.id !== c.id, "A client cannot refer themselves.");
      run("UPDATE contacts SET referred_by=? WHERE id=?", by?.id ?? null, c.id);
      if (by) audit(req.user.id, c.id, `Referred by ${by.name}.`, "update");
      return { ok: true };
    },
    "patch",
  );
  write(
    "/api/settings/loyalty",
    ["admin"],
    (req) => {
      run(
        "UPDATE settings SET loyalty_every=?, loyalty_percent=?, referral_amount=? WHERE id=1",
        integer(req.body.loyalty_every || 0, "Every N sessions", 0, 100),
        integer(req.body.loyalty_percent || 0, "Discount", 0, 100),
        integer(req.body.referral_amount || 0, "Referral reward", 0),
      );
      return { ok: true };
    },
    "patch",
  );

  // 11. Branches, rights, record history
  write("/api/branches", ["admin"], (req) => {
    const b = req.body;
    const v = {
      name: text(b.name, "Branch", 100),
      address: str(b.address, 300),
      rooms: str(b.rooms, 1000),
    };
    if (b.id) {
      const x = found("branches", b.id, "Branch");
      run(
        "UPDATE branches SET name=?, address=?, rooms=? WHERE id=?",
        v.name,
        v.address,
        v.rooms,
        x.id,
      );
      return { id: x.id };
    }
    return { id: insert("branches", { ...v, created_at: now() }) };
  });
  del("/api/branches/:id", ["admin"], (req) => {
    const x = found("branches", req.params.id, "Branch");
    run("UPDATE users SET branch_id=NULL WHERE branch_id=?", x.id);
    drop("DELETE FROM branches WHERE id=?", x.id);
    return { ok: true };
  });
  write(
    "/api/users/:id/access",
    ["admin"],
    (req) => {
      const u = found("users", req.params.id, "Staff member");
      const r = req.body.rights || {};
      const rights = {};
      for (const k of ["finance", "delete", "export", "phones"])
        if (r[k] === true || r[k] === false) rights[k] = r[k];
      must(
        u.role !== "admin" || Object.keys(rights).length === 0,
        "The director always has every right.",
      );
      run(
        "UPDATE users SET rights=?, branch_id=? WHERE id=?",
        JSON.stringify(rights),
        req.body.branch_id
          ? found("branches", req.body.branch_id, "Branch").id
          : null,
        u.id,
      );
      audit(req.user.id, null, `Access changed for ${u.name}.`, "admin");
      return { ok: true };
    },
    "patch",
  );
  const historyTables = {
    contacts: "Client",
    opportunities: "Request",
    appointments: "Appointment",
  };
  app.get("/api/history/:table/:id", (req, res, next) => {
    try {
      allow(req, ["admin"]);
      must(historyTables[req.params.table], "Unknown record type.", 404);
      res.json({
        versions: all(
          "SELECT v.*, u.name user_name FROM record_versions v LEFT JOIN users u ON u.id=v.user_id WHERE table_name=? AND record_id=? ORDER BY v.id DESC",
          req.params.table,
          integer(req.params.id, "Record"),
        ).map((v) => ({ ...v, before: json(v.before, {}) })),
        current: one(
          `SELECT * FROM ${req.params.table} WHERE id=?`,
          integer(req.params.id, "Record"),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  write("/api/history/:versionId/restore", ["admin"], (req) => {
    const v = found("record_versions", req.params.versionId, "Version");
    must(historyTables[v.table_name], "Unknown record type.", 404);
    const before = json(v.before, {});
    const current = one(
      `SELECT * FROM ${v.table_name} WHERE id=?`,
      v.record_id,
    );
    must(
      current,
      "This record no longer exists. Restore it from the trash.",
      404,
    );
    remember(
      v.table_name,
      v.record_id,
      req.user.id,
      "Before restoring an earlier version",
    );
    const cols = Object.keys(before).filter(
      (k) => k !== "id" && k in current && !(current[k] instanceof Uint8Array),
    );
    run(
      `UPDATE ${v.table_name} SET ${cols.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
      ...cols.map((k) => before[k]),
      v.record_id,
    );
    audit(
      req.user.id,
      v.table_name === "contacts" ? v.record_id : (before.contact_id ?? null),
      `Earlier version restored (${historyTables[v.table_name]} #${v.record_id}).`,
      "admin",
    );
    return { ok: true };
  });

  // 12. System status
  app.get("/api/system/status", (req, res, next) => {
    try {
      allow(req, ["admin"]);
      let size = 0;
      try {
        size = statSync(process.env.CRM_DB || "data/luminol.sqlite").size;
      } catch {
        /* hosted copy */
      }
      const count = (t) => one(`SELECT COUNT(*) n FROM ${t}`).n;
      res.json({
        time: now(),
        node: process.version,
        hosted: isHosted,
        databaseBytes: size,
        lastBackup: getMeta("last_backup") || "",
        lastDigest: getMeta("digest_last") || "",
        weeklyReport: getMeta("weekly_report_last") || "",
        migrations: all(
          "SELECT name, applied_at FROM schema_migrations ORDER BY name",
        ),
        counts: Object.fromEntries(
          [
            "contacts",
            "opportunities",
            "appointments",
            "payments",
            "messages",
            "tasks",
            "documents",
            "users",
          ].map((t) => [t, count(t)]),
        ),
        integrations: {
          whatsapp: whatsappConfigured(),
          chargily: chargilyConfigured(),
          mail: mailConfigured(),
          ai: !!process.env.ANTHROPIC_API_KEY,
          cron: !!process.env.CRON_SECRET,
          blob: !!(
            process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
          ),
          push: !!process.env.VAPID_PUBLIC_KEY,
        },
        errors: all("SELECT * FROM error_log ORDER BY id DESC LIMIT 30"),
        lastFlowRun:
          one(
            "SELECT created_at FROM flow_runs WHERE test=0 ORDER BY id DESC LIMIT 1",
          )?.created_at || "",
      });
    } catch (e) {
      next(e);
    }
  });

  // 13. API keys and webhooks
  write("/api/api-keys", ["admin"], (req) => {
    const key = "lum_" + randomBytes(24).toString("base64url");
    const id = insert("api_keys", {
      name: text(req.body.name, "Name", 80),
      prefix: key.slice(0, 10),
      key_hash: hash(key),
      created_at: now(),
    });
    audit(req.user.id, null, `API key created: ${req.body.name}.`, "admin");
    return { id, key };
  });
  write("/api/api-keys/:id/revoke", ["admin"], (req) => {
    const k = found("api_keys", req.params.id, "Key");
    run("UPDATE api_keys SET revoked_at=? WHERE id=?", now(), k.id);
    audit(req.user.id, null, `API key revoked: ${k.name}.`, "admin");
    return { ok: true };
  });
  write("/api/webhooks", ["admin"], (req) => {
    const url = text(req.body.url, "Address", 500);
    must(
      /^https?:\/\/[^\s]+$/.test(url),
      "Enter an address starting with https://",
    );
    must(
      !isHosted || url.startsWith("https://"),
      "The address must start with https://",
    );
    const list = (req.body.events || []).filter(
      (e) => webhookEvents.includes(e) || e === "*",
    );
    must(list.length, "Choose at least one event.");
    const secret = "whsec_" + randomBytes(18).toString("base64url");
    const id = insert("webhooks", {
      url,
      events: JSON.stringify(list),
      secret,
      active: 1,
      created_at: now(),
    });
    // Make sure the pump has a starting point for every event.
    collectEvents();
    return { id, secret };
  });
  write(
    "/api/webhooks/:id",
    ["admin"],
    (req) => {
      const w = found("webhooks", req.params.id, "Webhook");
      run(
        "UPDATE webhooks SET active=? WHERE id=?",
        req.body.active ? 1 : 0,
        w.id,
      );
      return { ok: true };
    },
    "patch",
  );
  app.post("/api/webhooks/:id/test", async (req, res, next) => {
    try {
      allow(req, ["admin"]);
      const w = found("webhooks", req.params.id, "Webhook");
      const status = await deliver({
        hook: w,
        body: JSON.stringify({ event: "test", at: now(), data: { ok: true } }),
      });
      res.json({ status });
    } catch (e) {
      next(e);
    }
  });
  del("/api/webhooks/:id", ["admin"], (req) => {
    const w = found("webhooks", req.params.id, "Webhook");
    drop("DELETE FROM webhooks WHERE id=?", w.id);
    return { ok: true };
  });
}
