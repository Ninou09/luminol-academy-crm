import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  all,
  one,
  run,
  insert,
  transaction,
  audit,
  now,
  chargeRows,
} from "./db.mjs";
import { sendMail, mailConfigured } from "./security.mjs";

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, extra });
};
export const tokenHash = (t) =>
  createHash("sha256").update(String(t)).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");
export const originOf = (req, isHosted) =>
  process.env.PUBLIC_URL ||
  `${isHosted ? "https" : "http"}://${req.headers.host}`;

// ---------------------------------------------------------------------------
// Chargily Pay (CIB / Edahabia)
// ---------------------------------------------------------------------------
export const chargilyConfigured = () => !!process.env.CHARGILY_SECRET_KEY;
const chargilyBase = () =>
  process.env.CHARGILY_API_URL ||
  (process.env.CHARGILY_MODE === "live"
    ? "https://pay.chargily.net/api/v2"
    : "https://pay.chargily.net/test/api/v2");

/** Create a payment page for what is left to pay on a charge (DZD only). */
export async function createCheckout(chargeId, origin, userId) {
  if (!chargilyConfigured())
    fail("Online payment is not set up yet (Chargily key missing).", 503);
  const ch = chargeRows().find((c) => c.id === Number(chargeId));
  if (!ch) fail("Charge not found.", 404);
  if (ch.balance <= 0) fail("This charge is already paid.", 409);
  if (ch.currency !== "DZD") fail("Online payment works only for DZD amounts.");
  const amount = Math.ceil(ch.balance / 100);
  if (amount < 50) fail("The minimum online payment is 50 DZD.");
  const response = await fetch(`${chargilyBase()}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CHARGILY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "dzd",
      locale: "fr",
      description: ch.label,
      success_url: `${origin}/paid`,
      failure_url: `${origin}/paid?failed=1`,
      webhook_endpoint: `${origin}/api/integrations/chargily/webhook`,
      metadata: { charge_id: ch.id },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id || !body.checkout_url)
    fail(
      "Chargily refused the payment request. Check the key and try again.",
      502,
    );
  insert("checkouts", {
    id: body.id,
    charge_id: ch.id,
    amount: amount * 100,
    url: body.checkout_url,
    status: "pending",
    user_id: userId || null,
    created_at: now(),
  });
  return { url: body.checkout_url, id: body.id };
}

function recordOnlinePayment(checkout, paidAmount) {
  if (one("SELECT id FROM payments WHERE checkout_id=?", checkout.id))
    return null;
  const ch = chargeRows().find((c) => c.id === checkout.charge_id);
  if (!ch) return null;
  const amount = Math.min(paidAmount, ch.balance);
  run("UPDATE checkouts SET status='paid' WHERE id=?", checkout.id);
  if (amount <= 0) return null;
  const year = now().slice(0, 4);
  const owner =
    checkout.user_id ||
    one(
      "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1",
    ).id;
  const id = insert("payments", {
    receipt_no: one(
      "SELECT MAX(COALESCE(MAX(receipt_no),0), COUNT(*))+1 n FROM payments WHERE substr(created_at,1,4)=?",
      year,
    ).n,
    charge_id: ch.id,
    amount,
    method: "Card (online)",
    reference: `Chargily ${checkout.id}`,
    checkout_id: checkout.id,
    created_at: now(),
    user_id: owner,
  });
  audit(
    owner,
    ch.contact_id,
    `Online card payment received: ${(amount / 100).toFixed(2)} ${ch.currency}.`,
    "finance",
    "finance",
  );
  return id;
}

// ---------------------------------------------------------------------------
// WhatsApp Business (Meta Cloud API)
// ---------------------------------------------------------------------------
export const whatsappConfigured = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
export const waDigits = (phone) =>
  String(phone || "")
    .replace(/\D/g, "")
    .replace(/^00/, "")
    .replace(/^0(?=[567])/, "213");

/**
 * Sends a message. Outside the 24-hour window Meta only accepts approved
 * templates, so when WHATSAPP_TEMPLATE is set the text goes as its {{1}}.
 */
export async function sendWhatsApp(phone, text) {
  if (!whatsappConfigured()) fail("WhatsApp sending is not set up yet.", 503);
  const to = waDigits(phone);
  if (to.length < 9) fail("This client has no valid phone number.");
  const template = process.env.WHATSAPP_TEMPLATE;
  const payload = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "fr" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: text.slice(0, 1000) }],
            },
          ],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  const base =
    process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v21.0";
  const response = await fetch(
    `${base}/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) fail("WhatsApp refused the message.", 502);
  return true;
}

/** Same placeholders as the templates in the app. */
export function fillTemplate(body, values) {
  return String(body).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function frDate(iso, opts) {
  const tz = one("SELECT timezone FROM settings WHERE id=1").timezone;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...opts }).format(
    new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso),
  );
}
const templateBody = (name) =>
  one("SELECT body FROM message_templates WHERE name=?", name)?.body || "";
const academy = () => one("SELECT academy FROM settings WHERE id=1").academy;

/** Messages the daily job would send right now (also used for the preview). */
export function dueMessages() {
  const tz = one("SELECT timezone FROM settings WHERE id=1").timezone;
  const day = (iso) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const today = day(new Date().toISOString());
  // The next calendar day in the academy's time zone (not "now + 24 h").
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  const out = [];
  for (const a of all(
    "SELECT a.*, c.name, c.phone, c.consent FROM appointments a JOIN contacts c ON c.id=a.contact_id WHERE a.status IN ('Scheduled','Pending') AND a.starts_at > ?",
    new Date().toISOString(),
  )) {
    if (day(a.starts_at) !== tomorrow || !a.phone || !a.consent) continue;
    if (
      one(
        "SELECT id FROM reminders WHERE kind='appointment' AND ref_id=?",
        a.id,
      )
    )
      continue;
    out.push({
      kind: "appointment",
      ref_id: a.id,
      contact_id: a.contact_id,
      phone: a.phone,
      text: fillTemplate(
        templateBody(
          a.meeting_url ? "Online consultation link" : "Appointment reminder",
        ),
        {
          name: a.name.split(" ")[0],
          academy: academy(),
          date: frDate(a.starts_at, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
          time: frDate(a.starts_at, { hour: "2-digit", minute: "2-digit" }),
          link: a.meeting_url,
          course: a.title,
        },
      ),
    });
  }
  for (const ch of chargeRows()) {
    if (ch.balance <= 0) continue;
    const days = (Date.parse(ch.due_date) - Date.parse(today)) / 86400000;
    if (days > 3) continue;
    const c = one("SELECT * FROM contacts WHERE id=?", ch.contact_id);
    if (!c?.phone || !c.consent) continue;
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    if (
      one(
        "SELECT id FROM reminders WHERE kind='payment' AND ref_id=? AND sent_at>?",
        ch.id,
        week,
      )
    )
      continue;
    out.push({
      kind: "payment",
      ref_id: ch.id,
      contact_id: c.id,
      phone: c.phone,
      text: fillTemplate(templateBody("Payment reminder"), {
        name: c.name.split(" ")[0],
        academy: academy(),
        amount: `${(ch.balance / 100).toLocaleString("fr-FR")} ${ch.currency === "DZD" ? "DA" : ch.currency}`,
        due: frDate(ch.due_date, { day: "numeric", month: "long" }),
        course: ch.label,
      }),
    });
  }
  for (const w of waitlistOpenings()) {
    if (
      one("SELECT id FROM reminders WHERE kind='waitlist' AND ref_id=?", w.id)
    )
      continue;
    const c = one("SELECT * FROM contacts WHERE id=?", w.contact_id);
    if (!c?.phone || !c.consent) continue;
    out.push({
      kind: "waitlist",
      ref_id: w.id,
      contact_id: c.id,
      phone: c.phone,
      text: fillTemplate(templateBody("Place available"), {
        name: c.name.split(" ")[0],
        academy: academy(),
        course: w.cohort_name,
      }),
    });
  }
  return out;
}

/** First person waiting for each group that now has a free place. */
export function waitlistOpenings() {
  return all(
    `SELECT w.*, h.name cohort_name FROM waitlists w JOIN cohorts h ON h.id=w.cohort_id
     WHERE h.capacity > (SELECT COUNT(*) FROM enrollments e WHERE e.cohort_id=h.id AND e.status='Active')
       AND w.id = (SELECT MIN(w2.id) FROM waitlists w2 WHERE w2.cohort_id=w.cohort_id)`,
  );
}
/** Create a task the first time a place frees up for someone waiting. */
export function waitlistTasks() {
  const admin = one(
    "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1",
  );
  for (const w of waitlistOpenings()) {
    const c = one("SELECT name FROM contacts WHERE id=?", w.contact_id);
    const title = `Place available in ${w.cohort_name}: tell ${c.name}`;
    if (one("SELECT id FROM tasks WHERE title=? AND status='Open'", title))
      continue;
    insert("tasks", {
      contact_id: w.contact_id,
      owner_id: admin.id,
      title,
      due_at: now(),
      priority: "High",
      status: "Open",
      created_at: now(),
      version: 1,
    });
  }
}

/** Send everything due by WhatsApp and record it. */
export async function runDailyMessages(userId = null) {
  waitlistTasks();
  if (!whatsappConfigured()) return { sent: 0, failed: 0, configured: false };
  let sent = 0,
    failed = 0;
  for (const m of dueMessages()) {
    try {
      await sendWhatsApp(m.phone, m.text);
      insert("reminders", {
        kind: m.kind,
        ref_id: m.ref_id,
        contact_id: m.contact_id,
        user_id: userId,
        channel: "whatsapp-api",
        sent_at: now(),
      });
      audit(
        userId ||
          one("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").id,
        m.contact_id,
        `WhatsApp sent automatically (${m.kind}).`,
        "communication",
        m.kind === "payment" ? "finance" : "general",
      );
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed, configured: true };
}

// ---------------------------------------------------------------------------
// Public routes: Chargily webhook, daily job, client portal, surveys
// ---------------------------------------------------------------------------
export function installPublicIntegrations(app, { isHosted }) {
  app.post("/api/integrations/chargily/webhook", (req, res) => {
    const secret = process.env.CHARGILY_SECRET_KEY || "";
    const signature = String(req.headers.signature || "");
    const expected = createHmac("sha256", secret)
      .update(req.rawBody || "")
      .digest("hex");
    if (
      !secret ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return res.status(403).json({ error: "Invalid signature." });
    const event = req.body || {};
    if (event.type === "checkout.paid") {
      const checkout = one(
        "SELECT * FROM checkouts WHERE id=?",
        String(event.data?.id || ""),
      );
      if (checkout)
        transaction(() =>
          recordOnlinePayment(
            checkout,
            Math.round(Number(event.data.amount || 0) * 100),
          ),
        );
    } else if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled"
    ) {
      run(
        "UPDATE checkouts SET status=? WHERE id=? AND status='pending'",
        event.type.split(".")[1],
        String(event.data?.id || ""),
      );
    }
    res.json({ ok: true });
  });

  // Vercel calls this every day (vercel.json → crons) with CRON_SECRET.
  app.get("/api/cron/daily", async (req, res, next) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== `Bearer ${secret}`)
        return res.status(401).json({ error: "Unauthorized." });
      const messages = await runDailyMessages(null);
      const weekly = await sendWeeklyReport();
      res.json({ ...messages, weekly });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/portal/:token", (req, res, next) => {
    try {
      const c = one(
        "SELECT * FROM contacts WHERE portal_token_hash=? AND portal_token_hash<>''",
        tokenHash(req.params.token),
      );
      if (!c)
        fail(
          "This link is no longer valid. Ask the academy for a new one.",
          404,
        );
      const nowIso = new Date().toISOString();
      const enrollments = all(
        `SELECT e.*, h.name cohort, h.room, p.name program FROM enrollments e
         JOIN cohorts h ON h.id=e.cohort_id JOIN programs p ON p.id=h.program_id WHERE e.contact_id=?`,
        c.id,
      );
      res.json({
        academy: academy(),
        name: c.name,
        level: c.level,
        payOnline: chargilyConfigured(),
        appointments: all(
          `SELECT a.id,a.title,a.kind,a.starts_at,a.ends_at,a.location,a.meeting_url,a.status,u.name staff
           FROM appointments a LEFT JOIN users u ON u.id=a.staff_id
           WHERE a.contact_id=? AND a.ends_at>? AND a.status IN ('Scheduled','Pending') ORDER BY a.starts_at`,
          c.id,
          nowIso,
        ),
        groups: enrollments
          .filter((e) => e.status === "Active")
          .map((e) => ({
            id: e.id,
            cohort: e.cohort,
            program: e.program,
            room: e.room,
            materials: all(
              "SELECT title, url FROM cohort_materials WHERE cohort_id=? ORDER BY id",
              e.cohort_id,
            ),
            sessions: all(
              "SELECT title,starts_at,ends_at,room FROM sessions WHERE cohort_id=? AND status='Scheduled' AND ends_at>? ORDER BY starts_at LIMIT 8",
              e.cohort_id,
              nowIso,
            ),
          })),
        grades: all(
          `SELECT g.title,g.score,g.max_score,g.taken_on,h.name cohort FROM grades g
           JOIN enrollments e ON e.id=g.enrollment_id JOIN cohorts h ON h.id=e.cohort_id
           WHERE e.contact_id=? ORDER BY g.taken_on DESC`,
          c.id,
        ),
        certificates: all(
          `SELECT ce.code, h.name cohort, p.name program, e.level FROM certificates ce
           JOIN enrollments e ON e.id=ce.enrollment_id JOIN cohorts h ON h.id=e.cohort_id
           JOIN programs p ON p.id=h.program_id WHERE e.contact_id=?`,
          c.id,
        ),
        charges: chargeRows()
          .filter((ch) => ch.contact_id === c.id && ch.balance > 0)
          .map((ch) => ({
            id: ch.id,
            label: ch.label,
            balance: ch.balance,
            currency: ch.currency,
            due_date: ch.due_date,
          })),
        packages: all(
          `SELECT p.title, p.sessions_total,
            (SELECT COUNT(*) FROM appointments a WHERE a.package_id=p.id AND a.status IN ('Done','No-show')) used
           FROM packages p WHERE p.contact_id=? AND p.status='Active'`,
          c.id,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/portal/:token/pay/:charge", async (req, res, next) => {
    try {
      const c = one(
        "SELECT * FROM contacts WHERE portal_token_hash=? AND portal_token_hash<>''",
        tokenHash(req.params.token),
      );
      if (!c) fail("This link is no longer valid.", 404);
      const ch = one(
        "SELECT * FROM charges WHERE id=? AND contact_id=?",
        Number(req.params.charge),
        c.id,
      );
      if (!ch) fail("Charge not found.", 404);
      res.json(await createCheckout(ch.id, originOf(req, isHosted), null));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/public/feedback/:token", (req, res, next) => {
    try {
      const f = one(
        "SELECT * FROM feedback WHERE token_hash=?",
        tokenHash(req.params.token),
      );
      if (!f) fail("This survey link is not valid.", 404);
      res.json({
        academy: academy(),
        about: f.about,
        answered: !!f.answered_at,
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/public/feedback/:token", (req, res, next) => {
    try {
      const f = one(
        "SELECT * FROM feedback WHERE token_hash=?",
        tokenHash(req.params.token),
      );
      if (!f) fail("This survey link is not valid.", 404);
      if (f.answered_at)
        fail("Thank you, your answer was already recorded.", 409);
      const rating = Number(req.body?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5)
        fail("Choose from 1 to 5 stars.");
      run(
        "UPDATE feedback SET rating=?, comment=?, answered_at=? WHERE id=?",
        rating,
        String(req.body?.comment || "")
          .trim()
          .slice(0, 2000),
        now(),
        f.id,
      );
      const owner = one(
        "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1",
      );
      audit(
        owner.id,
        f.contact_id,
        `Feedback received: ${rating}/5 (${f.about}).`,
        "feedback",
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Freed slots, weekly report and WhatsApp replies ("1" confirm / "2" cancel)
// ---------------------------------------------------------------------------
const firstAdmin = () =>
  one(
    "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1",
  )?.id;

/** When an appointment is cancelled, offer the slot to the waiting list. */
export function slotFreed(appointment, userId) {
  const waiting = all(
    `SELECT w.*, c.name FROM appointment_waitlist w JOIN contacts c ON c.id=w.contact_id
     WHERE w.status='Waiting' AND (w.staff_id IS NULL OR w.staff_id=?)
     ORDER BY w.created_at LIMIT 3`,
    appointment.staff_id ?? 0,
  );
  if (!waiting.length) return 0;
  const owner =
    one(
      "SELECT id FROM users WHERE role='admissions' AND active=1 ORDER BY id LIMIT 1",
    )?.id ||
    userId ||
    firstAdmin();
  const when = new Intl.DateTimeFormat("fr-FR", {
    timeZone: one("SELECT timezone FROM settings WHERE id=1").timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(appointment.starts_at));
  insert("tasks", {
    contact_id: waiting[0].contact_id,
    owner_id: owner,
    title:
      `Créneau libéré (${when}, ${appointment.title}) : proposer à ${waiting
        .map((w) => w.name)
        .join(", ")} — liste d'attente`.slice(0, 500),
    due_at: now(),
    priority: "High",
    status: "Open",
    created_at: now(),
  });
  return waiting.length;
}

/** Figures of the last 7 days (academy time zone), as text and numbers. */
export function weeklyReport() {
  const settings = one("SELECT * FROM settings WHERE id=1");
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000).toISOString();
  const sum = (sql, ...p) => one(sql, ...p).n || 0;
  const received =
    sum(
      "SELECT COALESCE(SUM(p.amount),0) n FROM payments p JOIN charges c ON c.id=p.charge_id WHERE p.created_at>=? AND c.currency=?",
      start,
      settings.currency,
    ) +
    sum(
      "SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE direction='in' AND spent_on>=? AND currency=?",
      start.slice(0, 10),
      settings.currency,
    ) -
    sum(
      "SELECT COALESCE(SUM(r.amount),0) n FROM refunds r WHERE r.created_at>=?",
      start,
    );
  const spent = sum(
    "SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE direction<>'in' AND spent_on>=? AND currency=?",
    start.slice(0, 10),
    settings.currency,
  );
  const count = (sql, ...p) => one(sql, ...p).n;
  const figures = {
    received,
    spent,
    result: received - spent,
    newClients: count(
      "SELECT COUNT(*) n FROM contacts WHERE created_at>=?",
      start,
    ),
    newRequests: count(
      "SELECT COUNT(*) n FROM opportunities WHERE created_at>=?",
      start,
    ),
    done: count(
      "SELECT COUNT(*) n FROM appointments WHERE status='Done' AND starts_at>=? AND starts_at<?",
      start,
      end.toISOString(),
    ),
    noShow: count(
      "SELECT COUNT(*) n FROM appointments WHERE status='No-show' AND starts_at>=? AND starts_at<?",
      start,
      end.toISOString(),
    ),
    cancelled: count(
      "SELECT COUNT(*) n FROM appointments WHERE status='Cancelled' AND starts_at>=? AND starts_at<?",
      start,
      end.toISOString(),
    ),
  };
  const money = (v) =>
    `${new Intl.NumberFormat("fr-FR").format(Math.round(v / 100))} ${settings.currency === "DZD" ? "DA" : settings.currency}`;
  const text = [
    `${settings.academy} — semaine du ${start.slice(0, 10)} au ${end.toISOString().slice(0, 10)}`,
    `Encaissé : ${money(figures.received)}`,
    `Dépensé : ${money(figures.spent)}`,
    `Résultat : ${money(figures.result)}`,
    `Nouveaux clients : ${figures.newClients} · Nouvelles demandes : ${figures.newRequests}`,
    `Rendez-vous faits : ${figures.done} · Absents : ${figures.noShow} · Annulés : ${figures.cancelled}`,
  ].join("\n");
  return { figures, text };
}

/** On Sundays, e-mail the weekly report to the director and administrators. */
export async function sendWeeklyReport(force = false) {
  const zone = one("SELECT timezone FROM settings WHERE id=1").timezone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(
    new Date(),
  );
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
  }).format(new Date());
  const last = one(
    "SELECT value FROM meta WHERE key='weekly_report_last'",
  )?.value;
  if (!force && (weekday !== "Sun" || last === today))
    return { sent: 0, skipped: true };
  if (!mailConfigured()) return { sent: 0, configured: false };
  const { text } = weeklyReport();
  let sent = 0;
  for (const u of all(
    "SELECT email FROM users WHERE active=1 AND role IN ('admin','manager') AND email NOT LIKE '%.local'",
  )) {
    try {
      await sendMail(u.email, "Rapport de la semaine — Luminol Academy", text);
      sent++;
    } catch {
      /* one failed address does not stop the others */
    }
  }
  run(
    "INSERT INTO meta (key,value) VALUES ('weekly_report_last',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    today,
  );
  return { sent };
}

/** A client answered a reminder on WhatsApp: "1" confirms, "2" cancels. */
export function whatsappReply(from, body) {
  const answer = String(body || "").trim();
  if (!/^[12]\b/.test(answer)) return { handled: false };
  const digits = String(from || "").replace(/\D/g, "");
  if (digits.length < 8) return { handled: false };
  const tail = digits.slice(-9);
  const contact = all(
    "SELECT id, phone, name FROM contacts WHERE phone<>''",
  ).find((c) => c.phone.replace(/\D/g, "").endsWith(tail));
  if (!contact) return { handled: false };
  const nowIso = new Date().toISOString();
  const week = new Date(Date.now() + 7 * 86400000).toISOString();
  const a = one(
    `SELECT * FROM appointments WHERE contact_id=? AND status IN ('Scheduled','Pending')
     AND starts_at>? AND starts_at<? ORDER BY starts_at LIMIT 1`,
    contact.id,
    nowIso,
    week,
  );
  if (!a) return { handled: false };
  const by = firstAdmin();
  return transaction(() => {
    if (answer.startsWith("1")) {
      run("UPDATE appointments SET confirmed_at=? WHERE id=?", nowIso, a.id);
      audit(
        by,
        contact.id,
        `Rendez-vous confirmé par WhatsApp : ${a.title}.`,
        "appointment",
      );
      return { handled: true, confirmed: a.id };
    }
    run("UPDATE appointments SET status='Cancelled' WHERE id=?", a.id);
    audit(
      by,
      contact.id,
      `Rendez-vous annulé par le client sur WhatsApp : ${a.title}.`,
      "appointment",
    );
    slotFreed(a, null);
    return { handled: true, cancelled: a.id };
  });
}

export function installWhatsAppWebhook(app) {
  // Meta checks the address once with a verify token.
  app.get("/api/integrations/whatsapp/webhook", (req, res) => {
    const token = process.env.WHATSAPP_VERIFY_TOKEN || "";
    if (
      token &&
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === token
    )
      return res
        .type("text/plain")
        .send(String(req.query["hub.challenge"] || ""));
    res.status(403).json({ error: "Forbidden." });
  });
  // Incoming messages, signed by Meta with the app secret.
  app.post("/api/integrations/whatsapp/webhook", (req, res) => {
    const secret = process.env.WHATSAPP_APP_SECRET || "";
    const given = String(req.headers["x-hub-signature-256"] || "");
    const expected =
      "sha256=" +
      createHmac("sha256", secret)
        .update(req.rawBody || "")
        .digest("hex");
    if (
      !secret ||
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    )
      return res.status(403).json({ error: "Invalid signature." });
    const results = [];
    for (const entry of req.body?.entry || [])
      for (const change of entry.changes || [])
        for (const m of change.value?.messages || [])
          if (m.type === "text")
            results.push(whatsappReply(m.from, m.text?.body));
    res.json({ ok: true, results });
  });
}
