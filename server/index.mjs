import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installPublicBooking,
  withinHours,
  parts as zonedParts,
} from "./booking.mjs";
import {
  installN8nIntake,
  installN8nReview,
  incomingInquiries,
  n8nConnection,
} from "./n8n-intake.mjs";
import {
  db,
  hashPassword,
  all,
  one,
  run,
  insert,
  transaction,
  audit,
  now,
  verifyPassword,
  stages,
  chargeRows,
  isHosted,
} from "./db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (!isHosted && !["127.0.0.1", "localhost", "[::1]"].includes(req.hostname))
    return res
      .status(403)
      .json({ error: "This workspace only accepts local connections." });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !==
      `${isHosted ? "https" : "http"}://${req.headers.host}`
  )
    return res
      .status(403)
      .json({ error: "Cross-origin writes are not allowed." });
  next();
});
class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
function must(ok, message, status = 400, extra = {}) {
  if (!ok) throw new ApiError(status, message, extra);
}
function text(v, name, max = 500, required = true) {
  must(typeof v === "string", `${name} must be text.`);
  const s = v.trim();
  must(
    (!required || s.length > 0) && s.length <= max,
    `${name} is required and must be at most ${max} characters.`,
  );
  return s;
}
function integer(v, name, min = 1, max = 10000000000) {
  must(
    Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max,
    `${name} must be between ${min} and ${max}.`,
  );
  return Number(v);
}
function date(v, name) {
  must(
    typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    `${name} must be a valid date.`,
  );
  return v;
}
function instant(v, name) {
  must(
    typeof v === "string" && /T/.test(v) && !isNaN(Date.parse(v)),
    `${name} must be a valid time.`,
  );
  return new Date(v).toISOString();
}
const canFinance = (u) => ["admin", "finance", "manager"].includes(u.role);
const canAdmissions = (u) =>
  ["admin", "admissions", "manager"].includes(u.role);
const canAcademic = (u) =>
  ["admin", "academic", "instructor", "manager"].includes(u.role);
const permissions = (u) => ({
  admissions: canAdmissions(u),
  finance: canFinance(u),
  academic: canAcademic(u),
  editAdmissions: ["admin", "admissions"].includes(u.role),
  editAcademic: ["admin", "academic"].includes(u.role),
  editFinance: ["admin", "finance"].includes(u.role),
  attendance: ["admin", "academic", "instructor"].includes(u.role),
  admin: u.role === "admin",
  write: u.role !== "manager",
});
function allow(req, roles) {
  must(
    roles.includes(req.user.role),
    "Your role does not have access to this action.",
    403,
  );
}
function cohortAccess(u, id) {
  const c = one("SELECT * FROM cohorts WHERE id=?", integer(id, "Cohort"));
  must(c, "Cohort not found.", 404);
  must(
    u.role !== "instructor" || c.instructor_id === u.id,
    "This cohort is not assigned to you.",
    403,
  );
  return c;
}
function contactAccess(u, id) {
  const c = one("SELECT * FROM contacts WHERE id=?", integer(id, "Contact"));
  must(c, "Contact not found.", 404);
  if (u.role === "instructor")
    must(
      one(
        `SELECT e.id FROM enrollments e JOIN cohorts c ON c.id=e.cohort_id WHERE e.contact_id=? AND c.instructor_id=?`,
        c.id,
        u.id,
      ),
      "This student is not assigned to you.",
      403,
    );
  return c;
}
function owner(id) {
  const u = one(
    "SELECT id,role FROM users WHERE id=? AND active=1",
    integer(id, "Owner"),
  );
  must(
    u &&
      ["admin", "admissions", "academic", "instructor", "finance"].includes(
        u.role,
      ),
    "Choose an active staff member.",
  );
  return u.id;
}
function program(id) {
  const p = one("SELECT * FROM programs WHERE id=?", integer(id, "Program"));
  must(p, "Program not found.", 404);
  return p;
}
function mutate(req, fn) {
  const key = req.headers["idempotency-key"];
  must(
    typeof key === "string" && key.length >= 8 && key.length < 150,
    "An idempotency key is required.",
  );
  const fingerprint = createHash("sha256")
    .update(req.method + req.path + JSON.stringify(req.body))
    .digest("hex");
  return transaction(() => {
    const previous = one(
      "SELECT * FROM idempotency WHERE key=? AND user_id=?",
      key,
      req.user.id,
    );
    if (previous) {
      must(
        previous.fingerprint === fingerprint,
        "This request key was already used for another operation.",
        409,
      );
      return JSON.parse(previous.response);
    }
    const result = fn() ?? { ok: true };
    insert("idempotency", {
      key,
      user_id: req.user.id,
      fingerprint,
      response: JSON.stringify(result),
    });
    return result;
  });
}
const write = (path, roles, fn, method = "post") =>
  app[method](path, (req, res, next) => {
    try {
      allow(req, roles);
      res.json(mutate(req, () => fn(req)));
    } catch (e) {
      next(e);
    }
  });
installN8nIntake(app);
installPublicBooking(app);
app.post("/api/login", (req, res) => {
  const ip = isHosted
    ? req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown"
    : req.socket.remoteAddress;
  const key = createHash("sha256").update(String(ip)).digest("hex");
  const time = Date.now();
  run("DELETE FROM login_attempts WHERE window_start < ?", time - 600000);
  run(
    "INSERT INTO login_attempts(ip_hash,attempts,window_start) VALUES (?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=attempts+1",
    key,
    time,
  );
  if (
    one("SELECT attempts FROM login_attempts WHERE ip_hash=?", key).attempts >
    40
  )
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in ten minutes." });
  const { email, password } = req.body || {};
  const u =
    typeof email === "string"
      ? one(
          "SELECT * FROM users WHERE email=? AND active=1",
          email.trim().toLowerCase(),
        )
      : null;
  if (
    !u ||
    typeof password !== "string" ||
    password.length > 200 ||
    !verifyPassword(password, u.password_hash)
  )
    return res.status(401).json({ error: "Email or password is incorrect." });
  run("DELETE FROM login_attempts WHERE ip_hash=?", key);
  const token = randomBytes(32).toString("hex");
  run("DELETE FROM auth_sessions WHERE expires<?", Date.now());
  insert("auth_sessions", {
    token: createHash("sha256").update(token).digest("hex"),
    user_id: u.id,
    expires: Date.now() + 12 * 3600000,
  });
  res.cookie("luminol_session", token, {
    httpOnly: true,
    secure: isHosted,
    sameSite: "strict",
    maxAge: 12 * 3600000,
    path: "/",
  });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("luminol_session="))
    ?.slice(16);
  const session = token
    ? one(
        "SELECT u.id,u.name,u.email,u.role FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token=? AND a.expires>? AND u.active=1",
        createHash("sha256").update(token).digest("hex"),
        Date.now(),
      )
    : null;
  if (!session)
    return res.status(401).json({ error: "Please sign in to your workspace." });
  req.user = session;
  next();
});
app.post("/api/logout", (req, res) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("luminol_session="))
    ?.slice(16);
  if (token)
    run(
      "DELETE FROM auth_sessions WHERE token=?",
      createHash("sha256").update(token).digest("hex"),
    );
  res.clearCookie("luminol_session", { path: "/" });
  res.json({ ok: true });
});

function packageRows() {
  return all(
    `SELECT p.*, (SELECT COUNT(*) FROM appointments a WHERE a.package_id=p.id AND a.status IN ('Done','No-show')) used,
      (SELECT COUNT(*) FROM appointments a WHERE a.package_id=p.id AND a.status='Scheduled') booked
     FROM packages p ORDER BY p.id DESC`,
  );
}
function state(u) {
  run(
    "DELETE FROM trash WHERE deleted_at < ?",
    new Date(Date.now() - 30 * 86400000).toISOString(),
  );
  const instructor = u.role === "instructor";
  const contacts = instructor
    ? all(
        "SELECT DISTINCT c.* FROM contacts c JOIN enrollments e ON e.contact_id=c.id JOIN cohorts h ON h.id=e.cohort_id WHERE h.instructor_id=?",
        u.id,
      )
    : all("SELECT * FROM contacts");
  const ids = new Set(contacts.map((c) => c.id));
  const cohorts = instructor
    ? all("SELECT * FROM cohorts WHERE instructor_id=?", u.id)
    : all("SELECT * FROM cohorts");
  const cohortIds = new Set(cohorts.map((c) => c.id));
  const activities = all(
    "SELECT a.*,u.name user_name FROM activities a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC",
  ).filter(
    (a) =>
      (!instructor || ids.has(a.contact_id)) &&
      (a.visibility !== "finance" || canFinance(u)) &&
      (a.visibility !== "private" || a.user_id === u.id) &&
      (a.visibility !== "internal" || canAdmissions(u)),
  );
  const charges = canFinance(u) ? chargeRows() : [];
  const payments = canFinance(u)
    ? all(
        "SELECT p.*,ch.contact_id,ch.currency FROM payments p JOIN charges ch ON ch.id=p.charge_id",
      )
    : [];
  const attendance = all(
    "SELECT a.*,s.starts_at,s.cohort_id FROM attendance a JOIN sessions s ON s.id=a.session_id",
  ).filter((a) => cohortIds.has(a.cohort_id));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: one("SELECT timezone FROM settings WHERE id=1").timezone,
  }).format(new Date());
  const resolutions = all("SELECT * FROM flag_resolutions");
  const flags = [];
  for (const c of contacts) {
    const absences = attendance.filter(
      (a) => a.contact_id === c.id && a.status === "Absent",
    );
    if (absences.length >= 2) {
      const fingerprint = absences.map((a) => a.id).join(",");
      if (
        !resolutions.some(
          (r) =>
            r.contact_id === c.id &&
            r.kind === "attendance" &&
            r.fingerprint === fingerprint,
        )
      )
        flags.push({
          contact_id: c.id,
          kind: "attendance",
          text: `${absences.length} recorded absences`,
          fingerprint,
        });
    }
    const overdue = charges.filter(
      (ch) => ch.contact_id === c.id && ch.balance > 0 && ch.due_date < today,
    );
    if (overdue.length) {
      const fingerprint = overdue
        .map((ch) => `${ch.id}:${ch.balance}`)
        .join(",");
      if (
        !resolutions.some(
          (r) =>
            r.contact_id === c.id &&
            r.kind === "payment" &&
            r.fingerprint === fingerprint,
        )
      )
        flags.push({
          contact_id: c.id,
          kind: "payment",
          text: `${overdue.length} overdue installment(s)`,
          fingerprint,
        });
    }
  }
  return {
    user: u,
    permissions: permissions(u),
    settings: one("SELECT * FROM settings"),
    stages,
    contacts,
    cohorts,
    programs: all("SELECT * FROM programs").filter(
      (p) => !instructor || cohorts.some((c) => c.program_id === p.id),
    ),
    users: all(
      "SELECT id,name,email,role,active,phone,public_title FROM users",
    ).filter((s) => !instructor || s.id === u.id),
    opportunities: canAdmissions(u) ? all("SELECT * FROM opportunities") : [],
    incoming: incomingInquiries(u),
    n8n: canAdmissions(u) ? n8nConnection() : undefined,
    enrollments: all("SELECT * FROM enrollments").filter((e) =>
      cohortIds.has(e.cohort_id),
    ),
    waitlists: all("SELECT * FROM waitlists").filter((w) =>
      cohortIds.has(w.cohort_id),
    ),
    sessions: all("SELECT * FROM sessions ORDER BY starts_at").filter((s) =>
      cohortIds.has(s.cohort_id),
    ),
    appointments: all("SELECT * FROM appointments ORDER BY starts_at").filter(
      (a) =>
        !instructor ||
        a.staff_id === u.id ||
        (a.contact_id && ids.has(a.contact_id)),
    ),
    serviceTypes,
    packages: packageRows().filter((p) => ids.has(p.contact_id)),
    templates: all("SELECT * FROM message_templates ORDER BY sort, id"),
    staffHours: all(
      "SELECT * FROM staff_hours ORDER BY user_id, weekday, start_min",
    ),
    timeOff: all(
      "SELECT * FROM time_off WHERE end_date >= ? ORDER BY start_date",
      today,
    ),
    bookingServices: all(
      "SELECT * FROM booking_services ORDER BY sort, id",
    ).map((x) => ({
      ...x,
      staff_ids: all(
        "SELECT user_id FROM booking_service_staff WHERE service_id=?",
        x.id,
      ).map((r) => r.user_id),
    })),
    reminders: all(
      "SELECT * FROM reminders WHERE sent_at >= ? ORDER BY id DESC",
      new Date(Date.now() - 14 * 86400000).toISOString(),
    ),
    trash:
      u.role === "admin"
        ? all(
            "SELECT t.id,t.kind,t.label,t.deleted_at,u.name user_name FROM trash t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200",
          )
        : [],
    attendance,
    tasks: all(
      "SELECT t.*,i.id intake_id FROM tasks t LEFT JOIN incoming_inquiries i ON i.task_id=t.id ORDER BY t.due_at",
    ).filter(
      (t) => u.role === "admin" || u.role === "manager" || t.owner_id === u.id,
    ),
    charges,
    payments,
    refunds: canFinance(u) ? all("SELECT * FROM refunds") : [],
    activities,
    documents: all(
      "SELECT id,contact_id,name,mime,size,user_id,created_at FROM documents",
    ).filter((d) => ids.has(d.contact_id)),
    drafts: canAdmissions(u) ? all("SELECT * FROM drafts") : [],
    automations:
      u.role === "admin"
        ? all("SELECT * FROM automation_runs ORDER BY id DESC LIMIT 100")
        : [],
    savedViews: all("SELECT * FROM saved_views WHERE user_id=?", u.id).map(
      (v) => ({ ...v, filters: JSON.parse(v.filters) }),
    ),
    flags,
    demo: false,
    hosted: isHosted,
    maxDocumentMb: isHosted ? 3 : 4,
    today,
  };
}
installN8nReview(app);
app.get("/api/state", (req, res) => res.json(state(req.user)));
app.get("/api/contacts/:id", (req, res, next) => {
  try {
    contactAccess(req.user, req.params.id);
    const s = state(req.user);
    const id = Number(req.params.id);
    res.json({
      contact: s.contacts.find((c) => c.id === id),
      activities: s.activities.filter((a) => a.contact_id === id),
      charges: s.charges.filter((c) => c.contact_id === id),
      enrollments: s.enrollments.filter((e) => e.contact_id === id),
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/export/:kind", (req, res, next) => {
  try {
    const s = state(req.user);
    must(
      ["contacts", "opportunities", "charges", "enrollments"].includes(
        req.params.kind,
      ),
      "Unknown export.",
      404,
    );
    if (req.params.kind === "charges")
      must(canFinance(req.user), "Financial exports are restricted.", 403);
    if (req.params.kind === "opportunities")
      must(canAdmissions(req.user), "Admissions exports are restricted.", 403);
    const rows = s[req.params.kind];
    const keys = Object.keys(rows[0] || {});
    const quote = (x) =>
      '"' +
      String(x ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="luminol-${req.params.kind}.csv"`,
    );
    res
      .type("text/csv")
      .send(
        "\uFEFF" +
          [
            keys.map(quote).join(","),
            ...rows.map((r) => keys.map((k) => quote(r[k])).join(",")),
          ].join("\r\n"),
      );
  } catch (e) {
    next(e);
  }
});

const serviceTypes = [
  "Psychology consultation",
  "Psychology course",
  "Language course",
  "Training",
  "Course",
  "Other",
];
/** A program is optional; free-text interest is kept and linked when it matches. */
function interestAndProgram(b, fallback = {}) {
  const interest = text(
    b.interest ?? fallback.interest ?? "",
    "Interest",
    180,
    false,
  );
  let p = null;
  if (b.program_id) p = program(b.program_id);
  else if (b.program_id === undefined && fallback.program_id)
    p = program(fallback.program_id);
  else if (interest)
    p =
      all("SELECT * FROM programs").find(
        (x) => x.name.toLowerCase() === interest.toLowerCase(),
      ) || null;
  const serviceType = text(
    b.service_type ?? fallback.service_type ?? "Course",
    "Request type",
    80,
  );
  must(p || interest, "Write what the client is asking about.");
  return { p, interest: interest || p?.name || "", serviceType };
}
function contactFields(b, existing = {}) {
  const name = text(b.name ?? existing.name, "Name", 100);
  const email = text(
    b.email ?? existing.email ?? "",
    "Email",
    254,
    false,
  ).toLowerCase();
  must(
    !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Enter a valid email address.",
  );
  const phone = text(b.phone ?? existing.phone ?? "", "Phone", 40, false);
  must(email || phone, "Enter a phone number or an email.");
  return { name, email, phone };
}
function findDuplicate(email, phone, exceptId = 0) {
  const normal = phone.replace(/\D/g, "");
  return all("SELECT * FROM contacts WHERE id<>?", exceptId).find(
    (c) =>
      (email && c.email.toLowerCase() === email) ||
      (normal.length >= 7 && c.phone.replace(/\D/g, "") === normal),
  );
}
write("/api/opportunities", ["admin", "admissions"], (req) => {
  const b = req.body;
  const { p, interest, serviceType } = interestAndProgram(b);
  const advisor = owner(b.owner_id);
  must(
    ["admin", "admissions"].includes(
      one("SELECT role FROM users WHERE id=?", advisor).role,
    ),
    "Choose an admissions advisor.",
  );
  let contact;
  if (b.contact_id) contact = contactAccess(req.user, b.contact_id);
  else {
    const { name, email, phone } = contactFields(b);
    const duplicate = findDuplicate(email, phone);
    must(
      !duplicate,
      "This person already exists. Reuse their contact to create a new opportunity.",
      409,
      { duplicate },
    );
    const id = insert("contacts", {
      name,
      email,
      phone,
      language: text(b.language || "English", "Language", 40),
      consent: b.consent ? 1 : 0,
      guardian: "",
      notes: text(b.contact_notes || "", "Notes", 4000, false),
      created_at: now(),
    });
    contact = one("SELECT * FROM contacts WHERE id=?", id);
  }
  const id = insert("opportunities", {
    contact_id: contact.id,
    program_id: p?.id ?? null,
    owner_id: advisor,
    service_type: serviceType,
    interest,
    stage: "New inquiry",
    source: text(b.source || "Website", "Source", 100),
    campaign: text(b.campaign || "", "Campaign", 100, false),
    tags: text(b.tags || "", "Tags", 100, false),
    notes: text(b.notes || "", "Notes", 4000, false),
    expected_date: b.expected_date
      ? date(b.expected_date, "Expected date")
      : "",
    created_at: now(),
    stage_at: now(),
    version: 1,
  });
  insert("tasks", {
    contact_id: contact.id,
    owner_id: advisor,
    title: "Make first contact",
    due_at: now(),
    priority: "High",
    status: "Open",
    created_at: now(),
    version: 1,
  });
  insert("automation_runs", {
    event_key: `inquiry:${id}`,
    rule: "New inquiry → advisor task",
    status: "Success",
    detail: `First-contact task created for ${contact.name}.`,
    created_at: now(),
  });
  audit(
    req.user.id,
    contact.id,
    `New request: ${serviceType} · ${p?.name || interest}.`,
    "admissions",
  );
  return { id, contact_id: contact.id };
});
write(
  "/api/opportunities/:id",
  ["admin", "admissions"],
  (req) => {
    const o = one(
      "SELECT * FROM opportunities WHERE id=?",
      integer(req.params.id, "Opportunity"),
    );
    must(o, "Opportunity not found.", 404);
    must(
      req.body.version === o.version,
      "This inquiry changed in another session. Refresh and try again.",
      409,
    );
    const stage = req.body.stage || o.stage;
    must(stages.includes(stage), "Choose a valid stage.");
    must(
      stage !== "Enrolled" || o.stage === "Enrolled",
      "Use Enroll in cohort to confirm an enrollment.",
    );
    must(
      o.stage !== "Enrolled" || stage === "Enrolled",
      "An enrolled opportunity cannot be moved backwards. Manage its enrollment instead.",
    );
    const reason = text(
      req.body.reason ?? o.reason ?? "",
      "Reason",
      500,
      false,
    );
    must(
      !["Lost", "Nurture"].includes(stage) || reason,
      "Please add a reason for this outcome.",
    );
    const assigned = req.body.owner_id ? owner(req.body.owner_id) : o.owner_id;
    must(
      ["admin", "admissions"].includes(
        one("SELECT role FROM users WHERE id=?", assigned).role,
      ),
      "Choose an admissions advisor.",
    );
    const b = req.body;
    const details =
      "interest" in b || "program_id" in b || "service_type" in b
        ? interestAndProgram({ ...b, program_id: b.program_id || null }, o)
        : null;
    run(
      "UPDATE opportunities SET stage=?,owner_id=?,reason=?,stage_at=?,program_id=?,interest=?,service_type=?,source=?,notes=?,expected_date=?,version=version+1 WHERE id=?",
      stage,
      assigned,
      reason,
      stage !== o.stage ? now() : o.stage_at,
      details ? (details.p?.id ?? null) : o.program_id,
      details ? details.interest : o.interest,
      details ? details.serviceType : o.service_type,
      b.source != null ? text(b.source, "Source", 100) : o.source,
      b.notes != null ? text(b.notes, "Notes", 4000, false) : o.notes,
      b.expected_date
        ? date(b.expected_date, "Expected date")
        : b.expected_date === ""
          ? ""
          : o.expected_date,
      o.id,
    );
    audit(
      req.user.id,
      o.contact_id,
      stage !== o.stage
        ? `Stage changed: ${o.stage} → ${stage}.`
        : details
          ? "Request details updated."
          : "Advisor assignment updated.",
      "admissions",
    );
    return { id: o.id };
  },
  "patch",
);
write("/api/opportunities/bulk/assign", ["admin", "admissions"], (req) => {
  const ids = req.body.ids;
  must(
    Array.isArray(ids) && ids.length > 0 && ids.length <= 100,
    "Choose up to 100 inquiries.",
  );
  const assigned = owner(req.body.owner_id);
  must(
    ["admin", "admissions"].includes(
      one("SELECT role FROM users WHERE id=?", assigned).role,
    ),
    "Choose an admissions advisor.",
  );
  for (const id of ids) {
    const o = one(
      "SELECT * FROM opportunities WHERE id=?",
      integer(id, "Opportunity"),
    );
    must(o, "Opportunity not found.", 404);
    run(
      "UPDATE opportunities SET owner_id=?,version=version+1 WHERE id=?",
      assigned,
      id,
    );
    audit(req.user.id, o.contact_id, "Advisor assigned in bulk.", "admissions");
  }
  return { ok: true };
});
write("/api/enroll", ["admin", "admissions", "academic"], (req) => {
  const o = one(
    "SELECT * FROM opportunities WHERE id=?",
    integer(req.body.opportunity_id, "Opportunity"),
  );
  must(o, "Opportunity not found.", 404);
  must(o.stage !== "Enrolled", "This opportunity is already enrolled.", 409);
  if (req.body.version != null)
    must(
      req.body.version === o.version,
      "This inquiry has changed. Refresh before enrolling.",
      409,
    );
  const c = cohortAccess(req.user, req.body.cohort_id);
  must(
    !o.program_id || c.program_id === o.program_id,
    "Choose a cohort for the same program.",
  );
  must(
    !one(
      "SELECT id FROM enrollments WHERE contact_id=? AND cohort_id=? AND status=?",
      o.contact_id,
      c.id,
      "Active",
    ),
    "This student is already enrolled in the cohort.",
    409,
  );
  const used = one(
    "SELECT COUNT(*) n FROM enrollments WHERE cohort_id=? AND status=?",
    c.id,
    "Active",
  ).n;
  if (used >= c.capacity) {
    must(
      req.body.waitlist,
      "This cohort is full. Add the student to the waitlist or choose another cohort.",
      409,
      { full: true },
    );
    run(
      "INSERT OR IGNORE INTO waitlists(contact_id,cohort_id,opportunity_id,created_at) VALUES (?,?,?,?)",
      o.contact_id,
      c.id,
      o.id,
      now(),
    );
    audit(
      req.user.id,
      o.contact_id,
      `Added to the waitlist for ${c.name}.`,
      "enrollment",
    );
    return { waitlisted: true };
  }
  const id = insert("enrollments", {
    contact_id: o.contact_id,
    cohort_id: c.id,
    opportunity_id: o.id,
    status: "Active",
    created_at: now(),
  });
  run(
    "DELETE FROM waitlists WHERE contact_id=? AND cohort_id=?",
    o.contact_id,
    c.id,
  );
  run(
    "UPDATE opportunities SET stage='Enrolled',program_id=?,stage_at=?,version=version+1 WHERE id=?",
    c.program_id,
    now(),
    o.id,
  );
  const p = program(c.program_id);
  if (p.price > 0)
    insert("charges", {
      contact_id: o.contact_id,
      enrollment_id: id,
      label: `${p.name} · Tuition`,
      amount: p.price,
      currency: p.currency,
      due_date: req.body.due_date
        ? date(req.body.due_date, "Due date")
        : now().slice(0, 10),
      created_at: now(),
    });
  insert("tasks", {
    contact_id: o.contact_id,
    owner_id: o.owner_id,
    title: "Welcome student and share cohort details",
    due_at: now(),
    priority: "Normal",
    status: "Open",
    created_at: now(),
    version: 1,
  });
  insert("automation_runs", {
    event_key: `enrollment:${id}`,
    rule: "Enrollment → onboarding task",
    status: "Success",
    detail: `Onboarding task created for enrollment ${id}.`,
    created_at: now(),
  });
  audit(req.user.id, o.contact_id, `Enrolled in ${c.name}.`, "enrollment");
  return { id };
});
write(
  "/api/enrollments/:id",
  ["admin", "academic"],
  (req) => {
    const e = one(
      "SELECT * FROM enrollments WHERE id=?",
      integer(req.params.id, "Enrollment"),
    );
    must(e, "Enrollment not found.", 404);
    must(e.status === "Active", "Only active enrollments can be changed.", 409);
    if (req.body.status === "Completed") {
      run(
        "UPDATE enrollments SET status='Completed', completed_at=?, level=? WHERE id=?",
        now(),
        text(req.body.level || e.level || "", "Level", 40, false),
        e.id,
      );
      audit(
        req.user.id,
        e.contact_id,
        "Enrollment marked completed.",
        "enrollment",
      );
      return { ok: true };
    }
    const previous = cohortAccess(req.user, e.cohort_id);
    const target = cohortAccess(req.user, req.body.cohort_id);
    must(
      target.program_id === previous.program_id && target.id !== previous.id,
      "Choose a different cohort in the same program.",
    );
    must(
      one(
        "SELECT COUNT(*) n FROM enrollments WHERE cohort_id=? AND status='Active'",
        target.id,
      ).n < target.capacity,
      "Target cohort is full.",
      409,
    );
    must(
      !one(
        "SELECT id FROM enrollments WHERE contact_id=? AND cohort_id=? AND status='Active'",
        e.contact_id,
        target.id,
      ),
      "Student is already enrolled there.",
      409,
    );
    run("UPDATE enrollments SET status='Transferred' WHERE id=?", e.id);
    const id = insert("enrollments", {
      contact_id: e.contact_id,
      cohort_id: target.id,
      status: "Active",
      created_at: now(),
    });
    audit(
      req.user.id,
      e.contact_id,
      `Transferred from ${previous.name} to ${target.name}. Previous enrollment and charges retained.`,
      "enrollment",
    );
    return { id };
  },
  "patch",
);
write(
  "/api/tasks",
  ["admin", "admissions", "academic", "instructor", "finance"],
  (req) => {
    const b = req.body;
    if (b.contact_id) contactAccess(req.user, b.contact_id);
    const assigned =
      req.user.role === "admin"
        ? owner(b.owner_id || req.user.id)
        : req.user.id;
    const id = insert("tasks", {
      contact_id: b.contact_id ? Number(b.contact_id) : null,
      owner_id: assigned,
      title: text(b.title, "Task", 200),
      due_at: instant(b.due_at, "Due time"),
      priority: b.priority === "High" ? "High" : "Normal",
      status: "Open",
      created_at: now(),
      version: 1,
    });
    audit(
      req.user.id,
      b.contact_id ? Number(b.contact_id) : null,
      `Follow-up scheduled: ${b.title}.`,
      "task",
      req.user.role === "finance" ? "finance" : "general",
    );
    return { id };
  },
);
write(
  "/api/tasks/:id",
  ["admin", "admissions", "academic", "instructor", "finance"],
  (req) => {
    const t = one(
      "SELECT * FROM tasks WHERE id=?",
      integer(req.params.id, "Task"),
    );
    must(t, "Task not found.", 404);
    must(
      req.user.role === "admin" || t.owner_id === req.user.id,
      "Only the owner can update this task.",
      403,
    );
    must(
      req.body.version === t.version,
      "This task has changed. Refresh and try again.",
      409,
    );
    must(["Open", "Done"].includes(req.body.status), "Choose a valid status.");
    run(
      "UPDATE tasks SET status=?,version=version+1 WHERE id=?",
      req.body.status,
      t.id,
    );
    audit(
      req.user.id,
      t.contact_id,
      `Task ${req.body.status === "Done" ? "completed" : "reopened"}: ${t.title}.`,
      "task",
      req.user.role === "finance" ? "finance" : "general",
    );
    return { ok: true };
  },
  "patch",
);
write("/api/tasks/bulk", ["admin", "admissions"], (req) => {
  const b = req.body;
  must(
    Array.isArray(b.opportunity_ids) &&
      b.opportunity_ids.length > 0 &&
      b.opportunity_ids.length <= 100,
    "Choose up to 100 inquiries.",
  );
  const title = text(b.title, "Task", 200),
    due = instant(b.due_at, "Due time"),
    assigned =
      req.user.role === "admin"
        ? owner(b.owner_id || req.user.id)
        : req.user.id;
  const contacts = new Set(
    b.opportunity_ids.map((id) => {
      const o = one(
        "SELECT contact_id FROM opportunities WHERE id=?",
        integer(id, "Opportunity"),
      );
      must(o, "Opportunity not found.", 404);
      return o.contact_id;
    }),
  );
  const ids = [];
  for (const contact of contacts) {
    ids.push(
      insert("tasks", {
        contact_id: contact,
        owner_id: assigned,
        title,
        due_at: due,
        priority: b.priority === "High" ? "High" : "Normal",
        status: "Open",
        created_at: now(),
        version: 1,
      }),
    );
    audit(req.user.id, contact, `Follow-up scheduled: ${title}.`, "task");
  }
  return { ids };
});
write(
  "/api/notes",
  ["admin", "admissions", "academic", "instructor", "finance"],
  (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const visibility = req.body.visibility || "general";
    must(
      ["general", "internal", "finance", "private"].includes(visibility),
      "Invalid visibility.",
    );
    if (visibility === "internal")
      must(
        canAdmissions(req.user),
        "Admissions-only notes are restricted.",
        403,
      );
    if (visibility === "finance")
      must(canFinance(req.user), "Financial notes are restricted.", 403);
    audit(
      req.user.id,
      c.id,
      text(req.body.text, "Note", 4000),
      req.body.kind === "consultation" ? "consultation" : "note",
      visibility,
    );
    return { ok: true };
  },
);
write(
  "/api/contacts/:id",
  ["admin", "admissions", "academic"],
  (req) => {
    const c = contactAccess(req.user, req.params.id);
    const b = req.body;
    const phone = text(b.phone ?? c.phone, "Phone", 40, false);
    const normalized = phone.replace(/\D/g, "");
    must(
      !normalized ||
        !all("SELECT id,phone FROM contacts WHERE id<>?", c.id).some(
          (x) => x.phone.replace(/\D/g, "") === normalized,
        ),
      "This phone number belongs to another contact.",
      409,
    );
    const email = text(
      b.email ?? c.email ?? "",
      "Email",
      254,
      false,
    ).toLowerCase();
    must(
      !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "Enter a valid email address.",
    );
    must(
      !email ||
        !one(
          "SELECT id FROM contacts WHERE email=? COLLATE NOCASE AND id<>?",
          email,
          c.id,
        ),
      "This email belongs to another contact.",
      409,
    );
    run(
      "UPDATE contacts SET level=?,name=?,email=?,notes=?,phone=?,language=?,consent=?,guardian=? WHERE id=?",
      text(b.level ?? c.level ?? "", "Level", 40, false),
      text(b.name ?? c.name, "Name", 100),
      email,
      text(b.notes ?? c.notes ?? "", "Notes", 4000, false),
      phone,
      text(b.language ?? c.language, "Language", 40),
      b.consent == null ? c.consent : b.consent ? 1 : 0,
      text(b.guardian ?? c.guardian, "Guardian or sponsor", 300, false),
      c.id,
    );
    audit(
      req.user.id,
      c.id,
      "Contact details and preferences updated.",
      "contact",
    );
    return { ok: true };
  },
  "patch",
);
write("/api/charges", ["admin", "finance"], (req) => {
  const c = contactAccess(req.user, req.body.contact_id);
  const amount = integer(req.body.amount, "Amount");
  const discount = integer(req.body.discount || 0, "Discount", 0, amount - 1);
  const reason = text(
    req.body.discount_reason || "",
    "Discount reason",
    300,
    false,
  );
  must(!discount || reason, "A discount reason is required.");
  const currency = text(req.body.currency, "Currency", 3).toUpperCase();
  must(
    ["DZD", "EUR", "USD", "GBP"].includes(currency),
    "Unsupported currency.",
  );
  const id = insert("charges", {
    contact_id: c.id,
    enrollment_id: null,
    label: text(req.body.label, "Charge description", 200),
    amount,
    discount,
    discount_reason: reason,
    currency,
    due_date: date(req.body.due_date, "Due date"),
    created_at: now(),
  });
  audit(
    req.user.id,
    c.id,
    `Charge added: ${req.body.label}.`,
    "finance",
    "finance",
  );
  return { id };
});
write("/api/charges/:id/split", ["admin", "finance"], (req) => {
  const ch = chargeRows().find((x) => x.id === Number(req.params.id));
  must(ch, "Charge not found.", 404);
  must(
    ch.paid === 0 && ch.discount === 0,
    "Only unpaid charges without discounts can be split.",
  );
  const dates = req.body.dates;
  must(
    Array.isArray(dates) && dates.length >= 2 && dates.length <= 12,
    "Choose between 2 and 12 installments.",
  );
  dates.forEach((d) => date(d, "Installment date"));
  must(ch.amount >= dates.length, "Charge too small to split.");
  const part = Math.floor(ch.amount / dates.length);
  run(
    "UPDATE charges SET amount=?,label=?,due_date=? WHERE id=?",
    part,
    `${ch.label} · 1/${dates.length}`,
    dates[0],
    ch.id,
  );
  for (let i = 1; i < dates.length; i++)
    insert("charges", {
      contact_id: ch.contact_id,
      enrollment_id: ch.enrollment_id,
      label: `${ch.label} · ${i + 1}/${dates.length}`,
      amount:
        i === dates.length - 1 ? ch.amount - part * (dates.length - 1) : part,
      currency: ch.currency,
      due_date: dates[i],
      created_at: now(),
    });
  audit(
    req.user.id,
    ch.contact_id,
    `Tuition split into ${dates.length} installments; total unchanged.`,
    "finance",
    "finance",
  );
  return { ok: true };
});
write("/api/payments", ["admin", "finance"], (req) => {
  const ch = chargeRows().find((x) => x.id === Number(req.body.charge_id));
  must(ch, "Charge not found.", 404);
  const amount = integer(req.body.amount, "Payment");
  must(amount <= ch.balance, "Payment exceeds the outstanding balance.", 409);
  const method = text(req.body.method, "Payment method", 40);
  must(
    ["Bank transfer", "Cash", "Card (external)"].includes(method),
    "Choose a payment method.",
  );
  const id = insert("payments", {
    charge_id: ch.id,
    amount,
    method,
    reference: text(req.body.reference || "", "Reference", 100, false),
    created_at: now(),
    user_id: req.user.id,
  });
  audit(
    req.user.id,
    ch.contact_id,
    `Manual payment recorded: ${(amount / 100).toFixed(2)} ${ch.currency}.`,
    "finance",
    "finance",
  );
  return { id };
});
write("/api/refunds", ["admin", "finance"], (req) => {
  const p = one(
    "SELECT p.*,c.contact_id,c.currency FROM payments p JOIN charges c ON c.id=p.charge_id WHERE p.id=?",
    integer(req.body.payment_id, "Payment"),
  );
  must(p, "Payment not found.", 404);
  const amount = integer(req.body.amount, "Refund");
  const refunded = one(
    "SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE payment_id=?",
    p.id,
  ).n;
  must(
    amount <= p.amount - refunded,
    "Refund exceeds the refundable payment balance.",
    409,
  );
  const reason = text(req.body.reason, "Refund reason", 300);
  const id = insert("refunds", {
    payment_id: p.id,
    amount,
    reason,
    user_id: req.user.id,
    created_at: now(),
  });
  audit(
    req.user.id,
    p.contact_id,
    `Manual refund recorded: ${(amount / 100).toFixed(2)} ${p.currency}. ${reason}`,
    "finance",
    "finance",
  );
  return { id };
});
write("/api/programs", ["admin", "academic"], (req) => {
  const b = req.body;
  const currency = text(b.currency, "Currency", 3).toUpperCase();
  must(
    ["DZD", "EUR", "USD", "GBP"].includes(currency),
    "Unsupported currency.",
  );
  const id = insert("programs", {
    name: text(b.name, "Program name", 100),
    category: text(b.category, "Category", 60),
    description: text(b.description || "", "Description", 2000, false),
    duration: text(b.duration, "Duration", 60),
    price: integer(b.price, "Price", 0),
    currency,
    color: ["teal", "blue", "purple", "amber"].includes(b.color)
      ? b.color
      : "teal",
  });
  audit(req.user.id, null, `Program created: ${b.name}.`, "program");
  return { id };
});
/** Teacher by id, or by typed name (a teacher record is created if new). */
function teacher(b) {
  if (b.instructor_id) {
    const u = one(
      "SELECT id FROM users WHERE id=? AND active=1 AND role IN ('instructor','academic','admin')",
      integer(b.instructor_id, "Teacher"),
    );
    must(u, "Choose a teacher.");
    return u.id;
  }
  const name = text(b.instructor_name || "", "Teacher", 100, false);
  if (!name) return null;
  const existing = one(
    "SELECT id FROM users WHERE lower(name)=lower(?) AND active=1",
    name,
  );
  if (existing) return existing.id;
  return insert("users", {
    name,
    email: `teacher-${randomBytes(6).toString("hex")}@no-login.local`,
    role: "instructor",
    password_hash: hashPassword(randomBytes(32).toString("base64url")),
  });
}
function cohortFields(b, existing = {}) {
  const start = date(b.start_date ?? existing.start_date, "Start date"),
    end = date(b.end_date ?? existing.end_date, "End date");
  must(end >= start, "End date must follow start date.");
  return {
    name: text(b.name ?? existing.name, "Group name", 100),
    capacity: integer(b.capacity ?? existing.capacity, "Capacity", 1, 500),
    start_date: start,
    end_date: end,
    room: text(
      b.room ?? existing.room ?? "",
      "Room or meeting link",
      300,
      false,
    ),
  };
}
write("/api/cohorts", ["admin", "academic"], (req) => {
  const b = req.body;
  const p = program(b.program_id);
  const id = insert("cohorts", {
    ...cohortFields(b),
    program_id: p.id,
    instructor_id: teacher(b),
    status: "Active",
  });
  audit(req.user.id, null, `Cohort created: ${b.name}.`, "cohort");
  return { id };
});
write(
  "/api/programs/:id",
  ["admin", "academic"],
  (req) => {
    const p = program(req.params.id);
    const b = req.body;
    const currency = text(b.currency, "Currency", 3).toUpperCase();
    must(
      ["DZD", "EUR", "USD", "GBP"].includes(currency),
      "Unsupported currency.",
    );
    run(
      "UPDATE programs SET name=?,category=?,description=?,duration=?,price=?,currency=? WHERE id=?",
      text(b.name, "Program name", 100),
      text(b.category, "Category", 60),
      text(b.description || "", "Description", 2000, false),
      text(b.duration, "Duration", 60),
      integer(b.price, "Price", 0),
      currency,
      p.id,
    );
    audit(
      req.user.id,
      null,
      `Program updated: ${b.name}. Existing charges are unchanged.`,
      "program",
    );
    return { ok: true };
  },
  "patch",
);
write(
  "/api/users/:id/role",
  ["admin"],
  (req) => {
    const u = one(
      "SELECT * FROM users WHERE id=?",
      integer(req.params.id, "Staff member"),
    );
    must(u, "Staff member not found.", 404);
    const role = req.body.role;
    must(
      [
        "admin",
        "admissions",
        "academic",
        "instructor",
        "finance",
        "manager",
      ].includes(role),
      "Choose a valid staff role.",
    );
    if (u.role === "admin" && role !== "admin")
      must(
        one("SELECT COUNT(*) n FROM users WHERE role='admin'").n > 1,
        "At least one administrator must remain.",
      );
    if (u.role === "instructor" && role !== "instructor")
      must(
        !one("SELECT id FROM cohorts WHERE instructor_id=?", u.id),
        "Reassign this instructor’s cohorts before changing their role.",
      );
    if (
      ["admissions", "admin"].includes(u.role) &&
      !["admissions", "admin"].includes(role)
    )
      must(
        !one("SELECT id FROM opportunities WHERE owner_id=?", u.id),
        "Reassign this advisor’s inquiries before changing their role.",
      );
    run("UPDATE users SET role=? WHERE id=?", role, u.id);
    run("DELETE FROM auth_sessions WHERE user_id=?", u.id);
    audit(
      req.user.id,
      null,
      `Staff role changed: ${u.name}, ${u.role} → ${role}. Existing sessions revoked.`,
      "security",
      "internal",
    );
    return { ok: true };
  },
  "patch",
);
write("/api/sessions", ["admin", "academic"], (req) => {
  const b = req.body;
  const c = cohortAccess(req.user, b.cohort_id);
  const start = instant(b.starts_at, "Start time"),
    end = instant(b.ends_at, "End time");
  must(end > start, "Session must end after it starts.");
  const count = integer(b.repeat || 1, "Repeat count", 1, 16);
  const room = text(b.room || c.room || "", "Room", 300, false);
  const title = text(b.title, "Session title", 120);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const starts = new Date(Date.parse(start) + i * 7 * 86400000).toISOString(),
      ends = new Date(Date.parse(end) + i * 7 * 86400000).toISOString();
    const conflict = one(
      `SELECT s.id FROM sessions s JOIN cohorts c ON c.id=s.cohort_id WHERE s.status='Scheduled' AND s.starts_at<? AND s.ends_at>? AND ((s.room=? AND s.room<>'') OR c.instructor_id=? OR c.id=?)`,
      ends,
      starts,
      room,
      c.instructor_id,
      c.id,
    );
    must(
      !conflict,
      "Schedule conflict: the room, instructor, or cohort is already booked.",
      409,
    );
    ids.push(
      insert("sessions", {
        cohort_id: c.id,
        title,
        starts_at: starts,
        ends_at: ends,
        room,
        status: "Scheduled",
      }),
    );
  }
  audit(
    req.user.id,
    null,
    `${count} session(s) scheduled for ${c.name}.`,
    "session",
  );
  return { ids };
});
write("/api/sessions/:id/cancel", ["admin", "academic"], (req) => {
  const s = one(
    "SELECT * FROM sessions WHERE id=?",
    integer(req.params.id, "Session"),
  );
  must(s, "Session not found.", 404);
  must(
    !one("SELECT id FROM attendance WHERE session_id=?", s.id),
    "A session with attendance cannot be cancelled.",
  );
  run("UPDATE sessions SET status='Cancelled' WHERE id=?", s.id);
  audit(req.user.id, null, `Session cancelled: ${s.title}.`, "session");
  return { ok: true };
});
write("/api/attendance", ["admin", "academic", "instructor"], (req) => {
  const s = one(
    "SELECT * FROM sessions WHERE id=?",
    integer(req.body.session_id, "Session"),
  );
  must(s && s.status === "Scheduled", "Session not found or cancelled.", 404);
  cohortAccess(req.user, s.cohort_id);
  must(
    Date.parse(s.starts_at) <= Date.now(),
    "Attendance can be recorded once a session starts.",
  );
  const rows = req.body.records;
  must(
    Array.isArray(rows) && rows.length <= 500,
    "Attendance records are required.",
  );
  for (const r of rows) {
    must(
      ["Present", "Absent", "Late", "Excused"].includes(r.status),
      "Invalid attendance status.",
    );
    must(
      one(
        "SELECT id FROM enrollments WHERE contact_id=? AND cohort_id=? AND status='Active'",
        integer(r.contact_id, "Contact"),
        s.cohort_id,
      ),
      "Student is not active in this cohort.",
    );
    run(
      "INSERT INTO attendance(session_id,contact_id,status) VALUES (?,?,?) ON CONFLICT(session_id,contact_id) DO UPDATE SET status=excluded.status",
      s.id,
      r.contact_id,
      r.status,
    );
    audit(req.user.id, r.contact_id, `${r.status} · ${s.title}.`, "attendance");
  }
  return { ok: true };
});
write(
  "/api/flags/resolve",
  ["admin", "academic", "instructor", "finance"],
  (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const flag = state(req.user).flags.find(
      (f) => f.contact_id === c.id && f.kind === req.body.kind,
    );
    must(flag, "This attention flag is no longer active.", 409);
    const reason = text(req.body.reason, "Resolution note", 500);
    run(
      "INSERT INTO flag_resolutions(contact_id,kind,fingerprint,reason,user_id,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(contact_id,kind) DO UPDATE SET fingerprint=excluded.fingerprint,reason=excluded.reason,user_id=excluded.user_id,created_at=excluded.created_at",
      c.id,
      flag.kind,
      flag.fingerprint,
      reason,
      req.user.id,
      now(),
    );
    audit(
      req.user.id,
      c.id,
      `Attention flag reviewed: ${reason}.`,
      "review",
      flag.kind === "payment" ? "finance" : "general",
    );
    return { ok: true };
  },
);
write("/api/drafts", ["admin", "admissions"], (req) => {
  const c = contactAccess(req.user, req.body.contact_id);
  must(
    c.consent,
    "Communication consent is required before preparing an outbound message.",
  );
  const channel = req.body.channel;
  must(["Email", "WhatsApp"].includes(channel), "Choose a channel.");
  const id = insert("drafts", {
    contact_id: c.id,
    channel,
    subject: text(req.body.subject, "Subject", 200),
    body: text(req.body.body, "Message", 5000),
    status: "Draft",
    user_id: req.user.id,
    created_at: now(),
  });
  audit(
    req.user.id,
    c.id,
    `${channel} draft prepared for review. Not sent.`,
    "communication",
  );
  return { id };
});
write("/api/integrations/:name/check", ["admin"], (req) => {
  if (req.params.name === "n8n") {
    const connection = n8nConnection();
    const message = connection.configured
      ? "Intake endpoint ready. This checks server configuration; verify delivery from the n8n workflow separately."
      : "Set N8N_INTAKE_TOKEN as a server-side secret of at least 32 characters, then connect the workflow credentials.";
    insert("automation_runs", {
      event_key: `check:${randomBytes(8).toString("hex")}`,
      rule: "n8n connection check",
      status: connection.configured ? "Success" : "Error",
      detail: message,
      created_at: now(),
    });
    return {
      ...connection,
      status: connection.configured ? "Ready to receive" : "Not configured",
      message,
    };
  }
  must(
    ["Email", "WhatsApp", "Forms", "Calendar", "Payments", "n8n"].includes(
      req.params.name,
    ),
    "Integration not found.",
    404,
  );
  insert("automation_runs", {
    event_key: `check:${randomBytes(8).toString("hex")}`,
    rule: `${req.params.name} connection check`,
    status: "Error",
    detail:
      "Not configured. Add a provider adapter and credentials before enabling delivery.",
    created_at: now(),
  });
  return {
    status: "Not configured",
    message:
      "No provider adapter or credentials configured. No external request was sent.",
  };
});
write("/api/automations/run", ["admin"], (req) => {
  let count = 0;
  const s = state(req.user);
  for (const t of s.tasks.filter(
    (t) => t.status === "Open" && t.due_at < now(),
  )) {
    const key = `overdue-task:${t.id}:${t.due_at}`;
    if (!one("SELECT id FROM automation_runs WHERE event_key=?", key)) {
      insert("automation_runs", {
        event_key: key,
        rule: "Overdue follow-up → internal reminder",
        status: "Success",
        detail: `Reminder: ${t.title}.`,
        created_at: now(),
      });
      count++;
    }
  }
  for (const flag of s.flags.filter((f) => f.kind === "attendance")) {
    const key = `absence:${flag.contact_id}:${flag.fingerprint}`;
    if (!one("SELECT id FROM automation_runs WHERE event_key=?", key)) {
      insert("tasks", {
        contact_id: flag.contact_id,
        owner_id: 3,
        title: "Review repeated absences",
        due_at: now(),
        priority: "High",
        status: "Open",
        created_at: now(),
        version: 1,
      });
      insert("automation_runs", {
        event_key: key,
        rule: "Repeated absences → staff review",
        status: "Success",
        detail: "Academic review task created.",
        created_at: now(),
      });
      count++;
    }
  }
  for (const ch of s.charges.filter(
    (c) =>
      c.balance > 0 &&
      c.due_date <=
        new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  )) {
    const key = `payment-reminder:${ch.id}:${ch.due_date}`;
    if (!one("SELECT id FROM automation_runs WHERE event_key=?", key)) {
      const c = one("SELECT * FROM contacts WHERE id=?", ch.contact_id);
      if (c.consent)
        insert("drafts", {
          contact_id: c.id,
          channel: "Email",
          subject: "Your upcoming Luminol Academy installment",
          body: `Hello ${c.name}, your ${ch.label} balance is ${(ch.balance / 100).toFixed(2)} ${ch.currency}, due ${ch.due_date}. Please contact the academy if you need help.`,
          status: "Draft",
          user_id: req.user.id,
          created_at: now(),
        });
      insert("automation_runs", {
        event_key: key,
        rule: "Installment → reminder draft",
        status: c.consent ? "Success" : "Skipped",
        detail: c.consent
          ? "Draft prepared for human review. Not sent."
          : "Skipped because communication consent is not recorded.",
        created_at: now(),
      });
      count++;
    }
  }
  return { count };
});
write("/api/saved-views", ["admin", "admissions", "manager"], (req) => {
  const name = text(req.body.name, "View name", 50);
  const filters = {
    query: String(req.body.filters?.query || "").slice(0, 100),
    stage: String(req.body.filters?.stage || ""),
    owner: String(req.body.filters?.owner || ""),
    source: String(req.body.filters?.source || ""),
  };
  return {
    id: insert("saved_views", {
      user_id: req.user.id,
      name,
      filters: JSON.stringify(filters),
    }),
  };
});
write("/api/settings", ["admin"], (req) => {
  const b = req.body;
  const currency = text(b.currency, "Currency", 3);
  must(
    ["DZD", "EUR", "USD", "GBP"].includes(currency),
    "Unsupported currency.",
  );
  const zone = text(b.timezone, "Time zone", 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date());
  } catch {
    throw new ApiError(400, "Enter a valid IANA time zone.");
  }
  run(
    "UPDATE settings SET academy=?,currency=?,timezone=?,language=? WHERE id=1",
    text(b.academy, "Academy name", 80),
    currency,
    zone,
    ["ar", "fr"].includes(b.language) ? b.language : "en",
  );
  audit(
    req.user.id,
    null,
    "Workspace settings updated. Existing financial records retain their original currency.",
    "settings",
  );
  return { ok: true };
});
write("/api/documents", ["admin", "admissions", "academic"], (req) => {
  const c = contactAccess(req.user, req.body.contact_id);
  const name = text(req.body.name, "Filename", 150);
  const mime = req.body.mime;
  must(
    ["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(mime),
    "Use PDF, PNG, JPEG, or plain text.",
  );
  must(
    typeof req.body.base64 === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(req.body.base64),
    "Invalid file encoding.",
  );
  const bytes = Buffer.from(req.body.base64, "base64");
  must(
    bytes.length > 0 && bytes.length <= (isHosted ? 3 : 4) * 1024 * 1024,
    `Files must be between 1 byte and ${isHosted ? 3 : 4} MB.`,
  );
  const id = insert("documents", {
    contact_id: c.id,
    name,
    mime,
    bytes,
    size: bytes.length,
    user_id: req.user.id,
    created_at: now(),
  });
  audit(req.user.id, c.id, `Document uploaded: ${name}.`, "document");
  return { id };
});
app.get("/api/documents/:id", (req, res, next) => {
  try {
    const d = one(
      "SELECT * FROM documents WHERE id=?",
      integer(req.params.id, "Document"),
    );
    must(d, "Document not found.", 404);
    contactAccess(req.user, d.contact_id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${d.name.replace(/[^\w. -]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,
    );
    res.type(d.mime).send(Buffer.from(d.bytes));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Everyday administration: edit, remove and add records directly in the CRM.
// ---------------------------------------------------------------------------
/**
 * Deletions go through drop(): the rows are copied into the trash first, so
 * an administrator can restore them for 30 days.
 */
let bin = null;
function encodeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row))
    out[k] =
      v instanceof Uint8Array
        ? { __b64: Buffer.from(v).toString("base64") }
        : v;
  return out;
}
function drop(sql, ...params) {
  const m = sql.match(/^DELETE FROM (\w+)( WHERE .*)?$/s);
  must(m, "Invalid delete.", 500);
  const rows = all(`SELECT * FROM ${m[1]}${m[2] || ""}`, ...params);
  if (rows.length && bin) bin.push({ table: m[1], rows: rows.map(encodeRow) });
  return run(sql, ...params);
}
const del = (path, roles, fn) =>
  write(
    path,
    roles,
    (req) => {
      bin = [];
      try {
        const result = fn(req) ?? { ok: true };
        if (bin.length && !result.deactivated) {
          // The main record is deleted last; its rows describe the entry.
          const main = bin[bin.length - 1];
          const r = main.rows[0];
          const label =
            r.name || r.title || r.label || r.subject || r.text || `#${r.id}`;
          const extra = bin.reduce((n, x) => n + x.rows.length, 0) - 1;
          insert("trash", {
            kind: main.table,
            label: `${String(label).slice(0, 150)}${extra ? ` (+${extra})` : ""}`,
            payload: JSON.stringify(bin),
            user_id: req.user.id,
            deleted_at: now(),
          });
        }
        return result;
      } finally {
        bin = null;
      }
    },
    "delete",
  );
function found(table, id, label) {
  const row = one(`SELECT * FROM ${table} WHERE id=?`, integer(id, label));
  must(row, `${label} not found.`, 404);
  return row;
}
/** Remove a client and everything recorded about them (kept in the trash). */
function deleteContactRecords(contactId) {
  drop("DELETE FROM reminders WHERE contact_id=?", contactId);
  drop("DELETE FROM appointments WHERE contact_id=?", contactId);
  drop("DELETE FROM packages WHERE contact_id=?", contactId);
  drop(
    "DELETE FROM refunds WHERE payment_id IN (SELECT p.id FROM payments p JOIN charges c ON c.id=p.charge_id WHERE c.contact_id=?)",
    contactId,
  );
  drop(
    "DELETE FROM payments WHERE charge_id IN (SELECT id FROM charges WHERE contact_id=?)",
    contactId,
  );
  drop("DELETE FROM attendance WHERE contact_id=?", contactId);
  drop("DELETE FROM waitlists WHERE contact_id=?", contactId);
  drop("DELETE FROM charges WHERE contact_id=?", contactId);
  drop("DELETE FROM enrollments WHERE contact_id=?", contactId);
  run(
    "UPDATE incoming_inquiries SET opportunity_id=NULL WHERE opportunity_id IN (SELECT id FROM opportunities WHERE contact_id=?)",
    contactId,
  );
  drop("DELETE FROM opportunities WHERE contact_id=?", contactId);
  drop("DELETE FROM tasks WHERE contact_id=?", contactId);
  drop("DELETE FROM activities WHERE contact_id=?", contactId);
  drop("DELETE FROM documents WHERE contact_id=?", contactId);
  drop("DELETE FROM drafts WHERE contact_id=?", contactId);
  drop("DELETE FROM flag_resolutions WHERE contact_id=?", contactId);
  drop("DELETE FROM contacts WHERE id=?", contactId);
}

// Clients ------------------------------------------------------------------
write("/api/contacts", ["admin", "admissions", "academic"], (req) => {
  const b = req.body;
  const { name, email, phone } = contactFields(b);
  const duplicate = findDuplicate(email, phone);
  must(!duplicate, "This person already exists.", 409, { duplicate });
  const id = insert("contacts", {
    name,
    email,
    phone,
    language: text(b.language || "English", "Language", 40),
    consent: b.consent ? 1 : 0,
    guardian: text(b.guardian || "", "Guardian or sponsor", 300, false),
    notes: text(b.notes || "", "Notes", 4000, false),
    created_at: now(),
  });
  audit(req.user.id, id, "Client added.", "contact");
  return { id };
});
del("/api/contacts/:id", ["admin"], (req) => {
  const c = contactAccess(req.user, req.params.id);
  deleteContactRecords(c.id);
  audit(
    req.user.id,
    null,
    `Client deleted with all related records: ${c.name}.`,
    "security",
    "internal",
  );
  return { ok: true };
});

// Requests (opportunities) ------------------------------------------------
del("/api/opportunities/:id", ["admin", "admissions"], (req) => {
  const o = found("opportunities", req.params.id, "Request");
  run(
    "UPDATE enrollments SET opportunity_id=NULL WHERE opportunity_id=?",
    o.id,
  );
  run("UPDATE waitlists SET opportunity_id=NULL WHERE opportunity_id=?", o.id);
  run(
    "UPDATE incoming_inquiries SET opportunity_id=NULL WHERE opportunity_id=?",
    o.id,
  );
  drop("DELETE FROM opportunities WHERE id=?", o.id);
  audit(req.user.id, o.contact_id, "Request deleted.", "admissions");
  return { ok: true };
});

// Programs & groups -----------------------------------------------------------
del("/api/programs/:id", ["admin", "academic"], (req) => {
  const p = program(req.params.id);
  must(
    !one(
      "SELECT e.id FROM enrollments e JOIN cohorts c ON c.id=e.cohort_id WHERE c.program_id=?",
      p.id,
    ),
    "Students are enrolled in this program. Remove or move them first.",
    409,
  );
  drop(
    "DELETE FROM attendance WHERE session_id IN (SELECT s.id FROM sessions s JOIN cohorts c ON c.id=s.cohort_id WHERE c.program_id=?)",
    p.id,
  );
  drop(
    "DELETE FROM sessions WHERE cohort_id IN (SELECT id FROM cohorts WHERE program_id=?)",
    p.id,
  );
  drop(
    "DELETE FROM waitlists WHERE cohort_id IN (SELECT id FROM cohorts WHERE program_id=?)",
    p.id,
  );
  drop("DELETE FROM cohorts WHERE program_id=?", p.id);
  run(
    "UPDATE opportunities SET program_id=NULL, interest=CASE WHEN interest='' THEN ? ELSE interest END WHERE program_id=?",
    p.name,
    p.id,
  );
  drop("DELETE FROM programs WHERE id=?", p.id);
  audit(req.user.id, null, `Program deleted: ${p.name}.`, "program");
  return { ok: true };
});
write(
  "/api/cohorts/:id",
  ["admin", "academic"],
  (req) => {
    const c = found("cohorts", req.params.id, "Group");
    const b = req.body;
    const fields = cohortFields(b, c);
    const used = one(
      "SELECT COUNT(*) n FROM enrollments WHERE cohort_id=? AND status='Active'",
      c.id,
    ).n;
    must(
      fields.capacity >= used,
      `This group already has ${used} students. Capacity cannot be lower.`,
    );
    const p = b.program_id ? program(b.program_id) : program(c.program_id);
    must(
      p.id === c.program_id || !used,
      "Students are enrolled. The program of this group cannot change.",
    );
    run(
      "UPDATE cohorts SET name=?,capacity=?,start_date=?,end_date=?,room=?,program_id=?,instructor_id=?,status=? WHERE id=?",
      fields.name,
      fields.capacity,
      fields.start_date,
      fields.end_date,
      fields.room,
      p.id,
      "instructor_id" in b || "instructor_name" in b
        ? teacher(b)
        : c.instructor_id,
      ["Active", "Completed", "Planned"].includes(b.status)
        ? b.status
        : c.status,
      c.id,
    );
    audit(req.user.id, null, `Group updated: ${fields.name}.`, "cohort");
    return { ok: true };
  },
  "patch",
);
del("/api/cohorts/:id", ["admin", "academic"], (req) => {
  const c = found("cohorts", req.params.id, "Group");
  must(
    !one("SELECT id FROM enrollments WHERE cohort_id=?", c.id),
    "Students are enrolled in this group. Move or complete them first.",
    409,
  );
  drop(
    "DELETE FROM attendance WHERE session_id IN (SELECT id FROM sessions WHERE cohort_id=?)",
    c.id,
  );
  drop("DELETE FROM sessions WHERE cohort_id=?", c.id);
  drop("DELETE FROM waitlists WHERE cohort_id=?", c.id);
  drop("DELETE FROM cohorts WHERE id=?", c.id);
  audit(req.user.id, null, `Group deleted: ${c.name}.`, "cohort");
  return { ok: true };
});
del("/api/waitlists/:id", ["admin", "admissions", "academic"], (req) => {
  const w = found("waitlists", req.params.id, "Waitlist entry");
  drop("DELETE FROM waitlists WHERE id=?", w.id);
  audit(req.user.id, w.contact_id, "Removed from the waitlist.", "enrollment");
  return { ok: true };
});

// Class sessions ---------------------------------------------------------------
write(
  "/api/sessions/:id",
  ["admin", "academic"],
  (req) => {
    const s = found("sessions", req.params.id, "Session");
    const b = req.body;
    const start = instant(b.starts_at ?? s.starts_at, "Start time"),
      end = instant(b.ends_at ?? s.ends_at, "End time");
    must(end > start, "Session must end after it starts.");
    run(
      "UPDATE sessions SET title=?,starts_at=?,ends_at=?,room=? WHERE id=?",
      text(b.title ?? s.title, "Session title", 120),
      start,
      end,
      text(b.room ?? s.room ?? "", "Room", 300, false),
      s.id,
    );
    audit(
      req.user.id,
      null,
      `Session updated: ${b.title ?? s.title}.`,
      "session",
    );
    return { ok: true };
  },
  "patch",
);
del("/api/sessions/:id", ["admin", "academic"], (req) => {
  const s = found("sessions", req.params.id, "Session");
  drop("DELETE FROM attendance WHERE session_id=?", s.id);
  drop("DELETE FROM sessions WHERE id=?", s.id);
  audit(req.user.id, null, `Session deleted: ${s.title}.`, "session");
  return { ok: true };
});

// Calendar appointments (consultations, meetings, anything not tied to a group)
function appointmentFields(b, existing = {}) {
  const start = instant(b.starts_at ?? existing.starts_at, "Start time"),
    end = instant(b.ends_at ?? existing.ends_at, "End time");
  must(end > start, "The appointment must end after it starts.");
  const contactId =
    b.contact_id !== undefined ? b.contact_id : existing.contact_id;
  const staffId = b.staff_id !== undefined ? b.staff_id : existing.staff_id;
  const packageId =
    b.package_id !== undefined ? b.package_id : existing.package_id;
  const contact = contactId ? found("contacts", contactId, "Client") : null;
  let pack = null;
  if (packageId) {
    pack = found("packages", packageId, "Package");
    must(
      contact && pack.contact_id === contact.id,
      "This package belongs to another client.",
    );
  }
  return {
    kind: text(b.kind ?? existing.kind ?? "Consultation", "Type", 60),
    title: text(b.title ?? existing.title, "Title", 150),
    contact_id: contact?.id ?? null,
    staff_id: staffId ? found("users", staffId, "Staff member").id : null,
    package_id: pack?.id ?? null,
    starts_at: start,
    ends_at: end,
    location: text(b.location ?? existing.location ?? "", "Place", 300, false),
    notes: text(b.notes ?? existing.notes ?? "", "Notes", 4000, false),
    status: ["Pending", "Scheduled", "Done", "No-show", "Cancelled"].includes(
      b.status,
    )
      ? b.status
      : existing.status || "Scheduled",
  };
}
/** The same person cannot be booked twice at the same time (unless forced). */
function checkOverlap(values, ignoreId, force) {
  if (force || !values.staff_id || values.status === "Cancelled") return;
  const clash = one(
    "SELECT a.title, a.starts_at FROM appointments a WHERE a.staff_id=? AND a.id<>? AND a.status<>'Cancelled' AND a.starts_at<? AND a.ends_at>?",
    values.staff_id,
    ignoreId || 0,
    values.ends_at,
    values.starts_at,
  );
  must(
    !clash,
    `This person already has “${clash?.title}” at that time. Choose another time or confirm the double booking.`,
    409,
    { overlap: true },
  );
  const hours = withinHours(values.staff_id, values.starts_at, values.ends_at);
  must(
    hours.ok,
    hours.reason === "time off"
      ? "This person is on leave that day. Confirm to book anyway."
      : "This time is outside this person's working hours. Confirm to book anyway.",
    409,
    { overlap: true, outside: true },
  );
}
const calendarRoles = ["admin", "admissions", "academic", "instructor"];
write("/api/appointments", calendarRoles, (req) => {
  const values = appointmentFields(req.body);
  const repeat = integer(req.body.repeat || 1, "Weekly repeats", 1, 26);
  const ids = [];
  for (let i = 0; i < repeat; i++) {
    const shift = i * 7 * 86400000;
    const v = {
      ...values,
      starts_at: new Date(Date.parse(values.starts_at) + shift).toISOString(),
      ends_at: new Date(Date.parse(values.ends_at) + shift).toISOString(),
    };
    checkOverlap(v, 0, req.body.allow_overlap);
    ids.push(insert("appointments", { ...v, created_at: now() }));
  }
  audit(
    req.user.id,
    values.contact_id,
    `${values.kind} scheduled: ${values.title}${repeat > 1 ? ` (${repeat} weeks)` : ""}.`,
    "appointment",
  );
  return { id: ids[0], ids };
});
write(
  "/api/appointments/:id",
  calendarRoles,
  (req) => {
    const a = found("appointments", req.params.id, "Appointment");
    const values = appointmentFields(req.body, a);
    if (
      values.starts_at !== a.starts_at ||
      values.ends_at !== a.ends_at ||
      values.staff_id !== a.staff_id
    )
      checkOverlap(values, a.id, req.body.allow_overlap);
    run(
      "UPDATE appointments SET kind=?,title=?,contact_id=?,staff_id=?,package_id=?,starts_at=?,ends_at=?,location=?,notes=?,status=? WHERE id=?",
      ...Object.values(values),
      a.id,
    );
    audit(
      req.user.id,
      values.contact_id,
      values.status !== a.status
        ? `${values.title}: ${values.status}.`
        : `${values.kind} updated: ${values.title}.`,
      "appointment",
    );
    return { ok: true };
  },
  "patch",
);
del("/api/appointments/:id", calendarRoles, (req) => {
  const a = found("appointments", req.params.id, "Appointment");
  drop("DELETE FROM appointments WHERE id=?", a.id);
  audit(
    req.user.id,
    a.contact_id,
    `${a.kind} deleted: ${a.title}.`,
    "appointment",
  );
  return { ok: true };
});

// Tasks -------------------------------------------------------------------------
const taskRoles = ["admin", "admissions", "academic", "instructor", "finance"];
function ownTask(req) {
  const t = found("tasks", req.params.id, "Task");
  must(
    req.user.role === "admin" || t.owner_id === req.user.id,
    "Only the owner can change this task.",
    403,
  );
  return t;
}
write(
  "/api/tasks/:id/details",
  taskRoles,
  (req) => {
    const t = ownTask(req);
    const b = req.body;
    if (b.contact_id) contactAccess(req.user, b.contact_id);
    run(
      "UPDATE tasks SET title=?,due_at=?,priority=?,contact_id=?,owner_id=?,version=version+1 WHERE id=?",
      text(b.title ?? t.title, "Task", 200),
      b.due_at ? instant(b.due_at, "Due time") : t.due_at,
      b.priority === "High" ? "High" : "Normal",
      b.contact_id ? Number(b.contact_id) : null,
      req.user.role === "admin" && b.owner_id ? owner(b.owner_id) : t.owner_id,
      t.id,
    );
    return { ok: true };
  },
  "patch",
);
del("/api/tasks/:id", taskRoles, (req) => {
  const t = ownTask(req);
  run("UPDATE incoming_inquiries SET task_id=NULL WHERE task_id=?", t.id);
  drop("DELETE FROM tasks WHERE id=?", t.id);
  return { ok: true };
});

// Money -------------------------------------------------------------------------
write(
  "/api/charges/:id",
  ["admin", "finance"],
  (req) => {
    const ch = chargeRows().find((x) => x.id === Number(req.params.id));
    must(ch, "Charge not found.", 404);
    const b = req.body;
    const amount = b.amount != null ? integer(b.amount, "Amount") : ch.amount;
    must(
      amount - ch.discount >= ch.paid,
      "The new amount is lower than what was already paid.",
    );
    must(ch.discount < amount, "The discount is larger than the amount.");
    run(
      "UPDATE charges SET label=?,due_date=?,amount=? WHERE id=?",
      text(b.label ?? ch.label, "Charge description", 200),
      date(b.due_date ?? ch.due_date, "Due date"),
      amount,
      ch.id,
    );
    audit(
      req.user.id,
      ch.contact_id,
      `Charge updated: ${b.label ?? ch.label}.`,
      "finance",
      "finance",
    );
    return { ok: true };
  },
  "patch",
);
del("/api/charges/:id", ["admin", "finance"], (req) => {
  const ch = found("charges", req.params.id, "Charge");
  must(
    !one("SELECT id FROM payments WHERE charge_id=?", ch.id),
    "Payments are recorded on this charge. Delete the payments first.",
    409,
  );
  run("UPDATE packages SET charge_id=NULL WHERE charge_id=?", ch.id);
  drop("DELETE FROM charges WHERE id=?", ch.id);
  audit(
    req.user.id,
    ch.contact_id,
    `Charge deleted: ${ch.label}.`,
    "finance",
    "finance",
  );
  return { ok: true };
});
del("/api/payments/:id", ["admin", "finance"], (req) => {
  const p = found("payments", req.params.id, "Payment");
  must(
    !one("SELECT id FROM refunds WHERE payment_id=?", p.id),
    "A refund is recorded on this payment and cannot be removed.",
    409,
  );
  const ch = one("SELECT * FROM charges WHERE id=?", p.charge_id);
  drop("DELETE FROM payments WHERE id=?", p.id);
  audit(
    req.user.id,
    ch.contact_id,
    `Payment entry removed: ${(p.amount / 100).toFixed(2)} ${ch.currency}.`,
    "finance",
    "finance",
  );
  return { ok: true };
});

// Notes, files, drafts, saved views -----------------------------------------
del("/api/activities/:id", taskRoles, (req) => {
  const a = found("activities", req.params.id, "Note");
  must(
    ["note", "consultation"].includes(a.kind),
    "Only notes can be deleted. History entries stay for traceability.",
    409,
  );
  must(
    req.user.role === "admin" || a.user_id === req.user.id,
    "Only the author can delete this note.",
    403,
  );
  drop("DELETE FROM activities WHERE id=?", a.id);
  return { ok: true };
});
del("/api/documents/:id", ["admin", "admissions", "academic"], (req) => {
  const d = found("documents", req.params.id, "Document");
  contactAccess(req.user, d.contact_id);
  drop("DELETE FROM documents WHERE id=?", d.id);
  audit(req.user.id, d.contact_id, `Document deleted: ${d.name}.`, "document");
  return { ok: true };
});
del("/api/drafts/:id", ["admin", "admissions"], (req) => {
  const d = found("drafts", req.params.id, "Draft");
  drop("DELETE FROM drafts WHERE id=?", d.id);
  return { ok: true };
});
del("/api/saved-views/:id", ["admin", "admissions", "manager"], (req) => {
  const v = found("saved_views", req.params.id, "Saved view");
  must(v.user_id === req.user.id, "This view belongs to someone else.", 403);
  drop("DELETE FROM saved_views WHERE id=?", v.id);
  return { ok: true };
});

// Staff -------------------------------------------------------------------------
const roles = [
  "admin",
  "admissions",
  "academic",
  "instructor",
  "finance",
  "manager",
];
function staffEmail(value, exceptId = 0) {
  const email = text(value || "", "Email", 254, false).toLowerCase();
  must(
    !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Enter a valid email address.",
  );
  must(
    !email ||
      !one("SELECT id FROM users WHERE email=? AND id<>?", email, exceptId),
    "Another staff member already uses this email.",
    409,
  );
  return email;
}
function strongPassword(value) {
  must(
    typeof value === "string" && value.length >= 10 && value.length <= 200,
    "The password needs at least 10 characters.",
  );
  return hashPassword(value);
}
write("/api/users", ["admin"], (req) => {
  const b = req.body;
  must(roles.includes(b.role), "Choose a valid staff role.");
  const email =
    staffEmail(b.email) ||
    `staff-${randomBytes(6).toString("hex")}@no-login.local`;
  const id = insert("users", {
    name: text(b.name, "Name", 100),
    email,
    role: b.role,
    phone: text(b.phone || "", "Phone", 40, false),
    password_hash: b.password
      ? strongPassword(b.password)
      : hashPassword(randomBytes(32).toString("base64url")),
  });
  audit(
    req.user.id,
    null,
    `Staff member added: ${b.name}.`,
    "security",
    "internal",
  );
  return { id };
});
write(
  "/api/users/:id",
  ["admin"],
  (req) => {
    const u = found("users", req.params.id, "Staff member");
    const b = req.body;
    const email =
      b.email != null ? staffEmail(b.email, u.id) || u.email : u.email;
    run(
      "UPDATE users SET name=?,email=?,phone=? WHERE id=?",
      text(b.name ?? u.name, "Name", 100),
      email,
      text(b.phone ?? u.phone ?? "", "Phone", 40, false),
      u.id,
    );
    if (b.active != null) {
      const active = b.active ? 1 : 0;
      if (!active) {
        must(u.id !== req.user.id, "You cannot deactivate your own account.");
        must(
          u.role !== "admin" ||
            one("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1")
              .n > 1,
          "At least one active administrator must remain.",
        );
        run("DELETE FROM auth_sessions WHERE user_id=?", u.id);
      }
      run("UPDATE users SET active=? WHERE id=?", active, u.id);
    }
    audit(
      req.user.id,
      null,
      `Staff details updated: ${u.name}.`,
      "security",
      "internal",
    );
    return { ok: true };
  },
  "patch",
);
write("/api/users/:id/password", ["admin"], (req) => {
  const u = found("users", req.params.id, "Staff member");
  must(
    !u.email.endsWith("@no-login.local"),
    "Add a real email for this person first so they can sign in.",
  );
  run(
    "UPDATE users SET password_hash=? WHERE id=?",
    strongPassword(req.body.password),
    u.id,
  );
  run("DELETE FROM auth_sessions WHERE user_id=?", u.id);
  audit(
    req.user.id,
    null,
    `Password set for ${u.name}.`,
    "security",
    "internal",
  );
  return { ok: true };
});
del("/api/users/:id", ["admin"], (req) => {
  const u = found("users", req.params.id, "Staff member");
  must(u.id !== req.user.id, "You cannot delete your own account.");
  must(
    u.role !== "admin" ||
      one(
        "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?",
        u.id,
      ).n > 0,
    "At least one active administrator must remain.",
  );
  run("DELETE FROM auth_sessions WHERE user_id=?", u.id);
  run("DELETE FROM saved_views WHERE user_id=?", u.id);
  run("DELETE FROM idempotency WHERE user_id=?", u.id);
  run("UPDATE cohorts SET instructor_id=NULL WHERE instructor_id=?", u.id);
  run("UPDATE appointments SET staff_id=NULL WHERE staff_id=?", u.id);
  run("DELETE FROM booking_service_staff WHERE user_id=?", u.id);
  run("DELETE FROM staff_hours WHERE user_id=?", u.id);
  run("DELETE FROM time_off WHERE user_id=?", u.id);
  try {
    run("SAVEPOINT remove_user");
    run("DELETE FROM users WHERE id=?", u.id);
    run("RELEASE remove_user");
  } catch {
    // The person has history (payments, notes, requests…): keep it, block sign-in.
    run("ROLLBACK TO remove_user");
    run("RELEASE remove_user");
    run("UPDATE users SET active=0 WHERE id=?", u.id);
    audit(
      req.user.id,
      null,
      `Staff member deactivated (history kept): ${u.name}.`,
      "security",
      "internal",
    );
    return { ok: true, deactivated: true };
  }
  audit(
    req.user.id,
    null,
    `Staff member deleted: ${u.name}.`,
    "security",
    "internal",
  );
  return { ok: true, deleted: true };
});

// My account --------------------------------------------------------------------
write(
  "/api/account",
  ["admin", "admissions", "academic", "instructor", "finance", "manager"],
  (req) => {
    const u = one("SELECT * FROM users WHERE id=?", req.user.id);
    const b = req.body;
    must(
      typeof b.current_password === "string" &&
        verifyPassword(b.current_password, u.password_hash),
      "Your current password is incorrect.",
      403,
    );
    const email = b.email ? staffEmail(b.email, u.id) : u.email;
    run(
      "UPDATE users SET name=?,email=?,password_hash=? WHERE id=?",
      text(b.name ?? u.name, "Name", 100),
      email,
      b.new_password ? strongPassword(b.new_password) : u.password_hash,
      u.id,
    );
    audit(u.id, null, "Account details updated.", "security", "internal");
    return { ok: true };
  },
  "patch",
);

// Clean start: remove every sample record, keep leads that came from Google/n8n.
write("/api/admin/clean-start", ["admin"], (req) => {
  must(
    req.body.confirm === "DELETE",
    "Type DELETE to confirm that all sample data should be removed.",
  );
  const me = req.user.id;
  for (const table of [
    "trash",
    "reminders",
    "booking_service_staff",
    "staff_hours",
    "time_off",
    "appointments",
    "packages",
    "refunds",
    "payments",
    "charges",
    "attendance",
    "sessions",
    "waitlists",
    "enrollments",
    "flag_resolutions",
    "drafts",
    "documents",
    "activities",
    "saved_views",
    "automation_runs",
  ])
    run(`DELETE FROM ${table}`);
  // Real leads go back to the inbox so they can be imported again cleanly.
  run(
    "DELETE FROM incoming_inquiries WHERE external_id LIKE 'n8n-connection-check%' OR name LIKE '%Connection Sample%'",
  );
  run(
    "UPDATE incoming_inquiries SET opportunity_id=NULL, task_id=NULL, owner_id=?, status=CASE WHEN status='Converted' THEN 'Pending' ELSE status END, review_fingerprint='', version=version+1",
    me,
  );
  run("DELETE FROM tasks");
  run("DELETE FROM opportunities");
  run("DELETE FROM contacts");
  run("DELETE FROM cohorts");
  run("DELETE FROM programs");
  run("DELETE FROM auth_sessions WHERE user_id<>?", me);
  run("DELETE FROM idempotency WHERE user_id<>?", me);
  run("DELETE FROM booking_services");
  run("UPDATE settings SET booking_enabled=0 WHERE id=1");
  run("DELETE FROM users WHERE id<>?", me);
  run("UPDATE users SET role='admin', active=1 WHERE id=?", me);
  const leads = one(
    "SELECT COUNT(*) n FROM incoming_inquiries WHERE status='Pending'",
  ).n;
  audit(
    me,
    null,
    `Sample data removed. ${leads} lead(s) from the website/Google kept for import.`,
    "system",
  );
  return { ok: true, leads };
});

// ---------------------------------------------------------------------------
// Consultation packages, message templates, trash, backups and import.
// ---------------------------------------------------------------------------
const packageRoles = ["admin", "admissions", "academic", "finance"];
write("/api/packages", packageRoles, (req) => {
  const b = req.body;
  const c = contactAccess(req.user, b.contact_id);
  const title = text(b.title, "Package name", 120);
  const total = integer(b.sessions_total, "Number of sessions", 1, 200);
  let chargeId = null;
  const price = b.price ? integer(b.price, "Price", 0) : 0;
  if (price > 0) {
    must(
      ["admin", "finance", "admissions"].includes(req.user.role),
      "Only finance can add a price.",
      403,
    );
    const currency = text(
      b.currency || one("SELECT currency FROM settings").currency,
      "Currency",
      3,
    ).toUpperCase();
    must(
      ["DZD", "EUR", "USD", "GBP"].includes(currency),
      "Unsupported currency.",
    );
    chargeId = insert("charges", {
      contact_id: c.id,
      enrollment_id: null,
      label: `${title} · ${total} sessions`,
      amount: price,
      currency,
      due_date: b.due_date ? date(b.due_date, "Due date") : now().slice(0, 10),
      created_at: now(),
    });
  }
  const id = insert("packages", {
    contact_id: c.id,
    title,
    sessions_total: total,
    charge_id: chargeId,
    status: "Active",
    created_at: now(),
  });
  audit(
    req.user.id,
    c.id,
    `Package started: ${title} (${total} sessions).`,
    "package",
  );
  return { id };
});
write(
  "/api/packages/:id",
  packageRoles,
  (req) => {
    const p = found("packages", req.params.id, "Package");
    contactAccess(req.user, p.contact_id);
    const b = req.body;
    run(
      "UPDATE packages SET title=?, sessions_total=?, status=? WHERE id=?",
      text(b.title ?? p.title, "Package name", 120),
      integer(
        b.sessions_total ?? p.sessions_total,
        "Number of sessions",
        1,
        200,
      ),
      ["Active", "Finished"].includes(b.status) ? b.status : p.status,
      p.id,
    );
    audit(
      req.user.id,
      p.contact_id,
      `Package updated: ${b.title ?? p.title}.`,
      "package",
    );
    return { ok: true };
  },
  "patch",
);
del("/api/packages/:id", packageRoles, (req) => {
  const p = found("packages", req.params.id, "Package");
  run("UPDATE appointments SET package_id=NULL WHERE package_id=?", p.id);
  drop("DELETE FROM packages WHERE id=?", p.id);
  return { ok: true };
});

// Message templates ---------------------------------------------------------
write("/api/templates", ["admin", "admissions"], (req) => {
  const id = insert("message_templates", {
    name: text(req.body.name, "Template name", 80),
    body: text(req.body.body, "Message", 2000),
    sort: 50,
  });
  return { id };
});
write(
  "/api/templates/:id",
  ["admin", "admissions"],
  (req) => {
    const t = found("message_templates", req.params.id, "Template");
    run(
      "UPDATE message_templates SET name=?, body=? WHERE id=?",
      text(req.body.name ?? t.name, "Template name", 80),
      text(req.body.body ?? t.body, "Message", 2000),
      t.id,
    );
    return { ok: true };
  },
  "patch",
);
del("/api/templates/:id", ["admin", "admissions"], (req) => {
  const t = found("message_templates", req.params.id, "Template");
  drop("DELETE FROM message_templates WHERE id=?", t.id);
  return { ok: true };
});

// Trash ---------------------------------------------------------------------
write("/api/trash/:id/restore", ["admin"], (req) => {
  const t = found("trash", req.params.id, "Deleted item");
  const groups = JSON.parse(t.payload);
  // Rows were deleted children-first, so parents are restored first.
  for (const { table, rows } of [...groups].reverse()) {
    for (const row of rows) {
      const values = {};
      for (const [k, v] of Object.entries(row))
        values[k] =
          v && typeof v === "object" && v.__b64
            ? Buffer.from(v.__b64, "base64")
            : v;
      if (
        values.user_id &&
        !one("SELECT id FROM users WHERE id=?", values.user_id)
      )
        values.user_id = req.user.id;
      if (
        values.owner_id &&
        !one("SELECT id FROM users WHERE id=?", values.owner_id)
      )
        values.owner_id = req.user.id;
      try {
        try {
          insert(table, values);
        } catch (error) {
          // History rows nothing points to get a fresh number if theirs was reused.
          const leaf = [
            "activities",
            "tasks",
            "documents",
            "drafts",
            "attendance",
            "appointments",
            "flag_resolutions",
            "message_templates",
            "waitlists",
          ];
          if (!error.message.includes(`${table}.id`) || !leaf.includes(table))
            throw error;
          const { id, ...rest } = values;
          insert(table, rest);
        }
      } catch (error) {
        throw new ApiError(
          409,
          /UNIQUE/.test(error.message)
            ? "This item cannot be restored because a record with the same email, phone or number now exists."
            : "This item cannot be restored because something it depends on was removed.",
        );
      }
    }
  }
  run("DELETE FROM trash WHERE id=?", t.id);
  audit(
    req.user.id,
    null,
    `Restored from trash: ${t.label}.`,
    "system",
    "internal",
  );
  return { ok: true };
});
write(
  "/api/trash/:id",
  ["admin"],
  (req) => {
    const t = found("trash", req.params.id, "Deleted item");
    run("DELETE FROM trash WHERE id=?", t.id);
    return { ok: true };
  },
  "delete",
);

// Full backup (download) ---------------------------------------------------
app.get("/api/admin/backup", async (req, res, next) => {
  try {
    allow(req, ["admin"]);
    const folder = await mkdtemp(join(tmpdir(), "luminol-backup-"));
    const file = join(folder, "backup.sqlite");
    try {
      db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
      const bytes = await readFile(file);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="luminol-backup-${now().slice(0, 10)}.sqlite"`,
      );
      res.type("application/vnd.sqlite3").send(bytes);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  } catch (e) {
    next(e);
  }
});

// Import clients from Excel / CSV -------------------------------------------
write("/api/import/contacts", ["admin", "admissions"], (req) => {
  const rows = req.body.rows;
  must(
    Array.isArray(rows) && rows.length > 0 && rows.length <= 2000,
    "Choose a file with 1 to 2000 rows.",
  );
  const advisor = req.body.create_requests
    ? owner(req.body.owner_id || req.user.id)
    : null;
  let created = 0,
    requests = 0;
  const skipped = [];
  const clean = (v, max) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  rows.forEach((raw, index) => {
    const line = index + 2; // row 1 is the header in the spreadsheet
    db.exec("SAVEPOINT import_row");
    try {
      const name = clean(raw.name, 100);
      const email = clean(raw.email, 254).toLowerCase();
      let phone = clean(raw.phone, 40);
      if (/^[567]\d{8}$/.test(phone.replace(/\D/g, "")))
        phone = "0" + phone.replace(/\D/g, ""); // Excel removes the leading 0
      must(name, "Name is missing.");
      must(email || phone, "Phone or email is missing.");
      must(
        !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "Email is not valid.",
      );
      must(!findDuplicate(email, phone), "Already in the CRM.");
      const id = insert("contacts", {
        name,
        email,
        phone,
        language: clean(raw.language, 40) || "العربية",
        level: clean(raw.level, 40),
        consent: /^(1|yes|oui|true|نعم|x)$/i.test(clean(raw.consent, 10))
          ? 1
          : 0,
        guardian: clean(raw.guardian, 300),
        notes: clean(raw.notes, 4000),
        created_at: now(),
      });
      created++;
      const interest = clean(raw.interest, 180);
      const service = clean(raw.service_type, 80);
      if (advisor && (interest || service)) {
        const p = interest
          ? all("SELECT * FROM programs").find(
              (x) => x.name.toLowerCase() === interest.toLowerCase(),
            )
          : null;
        insert("opportunities", {
          contact_id: id,
          program_id: p?.id ?? null,
          owner_id: advisor,
          service_type: service || (p ? "Course" : "Other"),
          interest: interest || p?.name || "",
          stage: "New inquiry",
          source: clean(raw.source, 100) || "Import",
          tags: "import",
          created_at: now(),
          stage_at: now(),
          version: 1,
        });
        requests++;
      }
      db.exec("RELEASE import_row");
    } catch (error) {
      db.exec("ROLLBACK TO import_row");
      db.exec("RELEASE import_row");
      skipped.push({ line, name: clean(raw.name, 100), reason: error.message });
    }
  });
  audit(
    req.user.id,
    null,
    `Imported ${created} client(s) from a file${requests ? `, ${requests} request(s)` : ""}.`,
    "contact",
  );
  return {
    created,
    requests,
    skipped: skipped.slice(0, 200),
    skippedCount: skipped.length,
  };
});

// ---------------------------------------------------------------------------
// Online booking settings, working hours, time off and reminders.
// ---------------------------------------------------------------------------
write(
  "/api/booking/settings",
  ["admin"],
  (req) => {
    const b = req.body;
    run(
      "UPDATE settings SET booking_enabled=?, booking_intro=?, booking_notice_hours=? WHERE id=1",
      b.booking_enabled ? 1 : 0,
      text(b.booking_intro ?? "", "Welcome text", 1000, false),
      integer(b.booking_notice_hours ?? 2, "Minimum notice", 0, 168),
    );
    audit(req.user.id, null, "Online booking settings updated.", "settings");
    return { ok: true };
  },
  "patch",
);
function serviceFields(b, existing = {}) {
  return {
    name: text(b.name ?? existing.name, "Service name", 120),
    kind: text(b.kind ?? existing.kind ?? "Consultation", "Type", 60),
    duration_min: integer(
      b.duration_min ?? existing.duration_min ?? 60,
      "Duration (minutes)",
      10,
      480,
    ),
    description: text(
      b.description ?? existing.description ?? "",
      "Description",
      500,
      false,
    ),
    active: (b.active ?? existing.active ?? 1) ? 1 : 0,
  };
}
function setServiceStaff(serviceId, ids) {
  must(Array.isArray(ids) && ids.length, "Choose at least one person.");
  run("DELETE FROM booking_service_staff WHERE service_id=?", serviceId);
  for (const id of ids) {
    const u = found("users", id, "Staff member");
    must(u.active, "Choose active staff members.");
    run(
      "INSERT INTO booking_service_staff(service_id,user_id) VALUES (?,?)",
      serviceId,
      u.id,
    );
  }
}
write("/api/booking/services", ["admin", "admissions"], (req) => {
  const id = insert("booking_services", {
    ...serviceFields(req.body),
    sort: 50,
  });
  setServiceStaff(id, req.body.staff_ids);
  return { id };
});
write(
  "/api/booking/services/:id",
  ["admin", "admissions"],
  (req) => {
    const s = found("booking_services", req.params.id, "Service");
    const v = serviceFields(req.body, s);
    run(
      "UPDATE booking_services SET name=?,kind=?,duration_min=?,description=?,active=? WHERE id=?",
      v.name,
      v.kind,
      v.duration_min,
      v.description,
      v.active,
      s.id,
    );
    if (req.body.staff_ids) setServiceStaff(s.id, req.body.staff_ids);
    return { ok: true };
  },
  "patch",
);
del("/api/booking/services/:id", ["admin", "admissions"], (req) => {
  const s = found("booking_services", req.params.id, "Service");
  drop("DELETE FROM booking_service_staff WHERE service_id=?", s.id);
  drop("DELETE FROM booking_services WHERE id=?", s.id);
  return { ok: true };
});

/** Admins edit anyone's hours; everyone else edits only their own. */
function ownOrAdmin(req) {
  const u = found("users", req.params.id, "Staff member");
  must(
    req.user.role === "admin" || req.user.id === u.id,
    "You can only change your own schedule.",
    403,
  );
  return u;
}
const everyone = [
  "admin",
  "admissions",
  "academic",
  "instructor",
  "finance",
  "manager",
];
write("/api/users/:id/hours", everyone, (req) => {
  const u = ownOrAdmin(req);
  const ranges = req.body.ranges;
  must(Array.isArray(ranges) && ranges.length <= 30, "Invalid working hours.");
  run("DELETE FROM staff_hours WHERE user_id=?", u.id);
  for (const r of ranges) {
    const weekday = integer(r.weekday, "Day", 0, 6);
    const start = integer(r.start_min, "Start", 0, 1439);
    const end = integer(r.end_min, "End", 1, 1440);
    must(end > start, "Each period must end after it starts.");
    insert("staff_hours", {
      user_id: u.id,
      weekday,
      start_min: start,
      end_min: end,
    });
  }
  if (req.body.public_title != null)
    run(
      "UPDATE users SET public_title=? WHERE id=?",
      text(req.body.public_title, "Title shown to clients", 80, false),
      u.id,
    );
  audit(
    req.user.id,
    null,
    `Working hours updated: ${u.name}.`,
    "settings",
    "internal",
  );
  return { ok: true };
});
write("/api/users/:id/time-off", everyone, (req) => {
  const u = ownOrAdmin(req);
  const start = date(req.body.start_date, "First day"),
    end = date(req.body.end_date || req.body.start_date, "Last day");
  must(end >= start, "The last day must be after the first day.");
  const id = insert("time_off", {
    user_id: u.id,
    start_date: start,
    end_date: end,
    reason: text(req.body.reason || "", "Reason", 120, false),
    created_at: now(),
  });
  const clash = one(
    "SELECT COUNT(*) n FROM appointments WHERE staff_id=? AND status IN ('Scheduled','Pending') AND substr(starts_at,1,10) BETWEEN ? AND ?",
    u.id,
    start,
    end,
  ).n;
  audit(
    req.user.id,
    null,
    `Time off added: ${u.name}, ${start} → ${end}.`,
    "settings",
    "internal",
  );
  return { id, clash };
});
del("/api/time-off/:id", everyone, (req) => {
  const t = found("time_off", req.params.id, "Time off");
  must(
    req.user.role === "admin" || req.user.id === t.user_id,
    "You can only change your own schedule.",
    403,
  );
  drop("DELETE FROM time_off WHERE id=?", t.id);
  return { ok: true };
});

/** Record that a WhatsApp reminder was sent (the message itself opens in WhatsApp). */
write(
  "/api/reminders",
  ["admin", "admissions", "academic", "instructor", "finance"],
  (req) => {
    const kind = req.body.kind;
    must(["appointment", "payment"].includes(kind), "Invalid reminder.");
    const row =
      kind === "appointment"
        ? found("appointments", req.body.ref_id, "Appointment")
        : found("charges", req.body.ref_id, "Charge");
    const id = insert("reminders", {
      kind,
      ref_id: row.id,
      contact_id: row.contact_id,
      user_id: req.user.id,
      sent_at: now(),
    });
    audit(
      req.user.id,
      row.contact_id,
      kind === "appointment"
        ? `WhatsApp reminder sent for “${row.title}”.`
        : `WhatsApp payment reminder sent for “${row.label}”.`,
      "communication",
      kind === "payment" ? "finance" : "general",
    );
    return { id };
  },
);

app.use("/api", (req, res) =>
  res.status(404).json({ error: "This endpoint does not exist." }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error:
      status === 500
        ? "The operation could not be saved. Refresh and try again."
        : err.message,
    ...(err.extra || {}),
  });
});
export default app;

if (!isHosted) {
  if (process.argv.includes("--dev")) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    must(
      existsSync(resolve(root, "dist/index.html")),
      "Run npm run build before npm start.",
      500,
    );
    app.use(express.static(resolve(root, "dist")));
    app.get("/{*splat}", (req, res) =>
      res.sendFile(resolve(root, "dist/index.html")),
    );
  }
  const port = Number(process.env.PORT || 4173);
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(
      `Luminol Academy CRM: http://127.0.0.1:${server.address().port}`,
    ),
  );
  const shutdown = () =>
    server.close(() => {
      db.close();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
