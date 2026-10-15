import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  db,
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
  const u = one("SELECT id,role FROM users WHERE id=?", integer(id, "Owner"));
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
      ? one("SELECT * FROM users WHERE email=?", email.trim().toLowerCase())
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
        "SELECT u.id,u.name,u.email,u.role FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token=? AND a.expires>?",
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

function state(u) {
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
    users: all("SELECT id,name,email,role FROM users").filter(
      (s) => !instructor || s.id === u.id,
    ),
    opportunities: canAdmissions(u) ? all("SELECT * FROM opportunities") : [],
    enrollments: all("SELECT * FROM enrollments").filter((e) =>
      cohortIds.has(e.cohort_id),
    ),
    waitlists: all("SELECT * FROM waitlists").filter((w) =>
      cohortIds.has(w.cohort_id),
    ),
    sessions: all("SELECT * FROM sessions ORDER BY starts_at").filter((s) =>
      cohortIds.has(s.cohort_id),
    ),
    attendance,
    tasks: all("SELECT * FROM tasks ORDER BY due_at").filter(
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
    demo: true,
    hosted: isHosted,
    maxDocumentMb: isHosted ? 3 : 4,
    today,
  };
}
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

write("/api/opportunities", ["admin", "admissions"], (req) => {
  const b = req.body;
  const p = program(b.program_id);
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
    const name = text(b.name, "Name", 100);
    const email = text(b.email, "Email", 254).toLowerCase();
    must(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "Enter a valid email address.",
    );
    const phone = text(b.phone || "", "Phone", 40, false);
    const normal = phone.replace(/\D/g, "");
    const duplicate = all("SELECT * FROM contacts").find(
      (c) =>
        c.email.toLowerCase() === email ||
        (normal.length >= 7 && c.phone.replace(/\D/g, "") === normal),
    );
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
      language: b.language === "العربية" ? "العربية" : "English",
      consent: b.consent ? 1 : 0,
      guardian: "",
      created_at: now(),
    });
    contact = one("SELECT * FROM contacts WHERE id=?", id);
  }
  const id = insert("opportunities", {
    contact_id: contact.id,
    program_id: p.id,
    owner_id: advisor,
    stage: "New inquiry",
    source: text(b.source || "Website", "Source", 100),
    campaign: text(b.campaign || "", "Campaign", 100, false),
    tags: text(b.tags || "", "Tags", 100, false),
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
  audit(req.user.id, contact.id, `New inquiry for ${p.name}.`, "admissions");
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
    run(
      "UPDATE opportunities SET stage=?,owner_id=?,reason=?,stage_at=?,version=version+1 WHERE id=?",
      stage,
      assigned,
      reason,
      stage !== o.stage ? now() : o.stage_at,
      o.id,
    );
    audit(
      req.user.id,
      o.contact_id,
      stage !== o.stage
        ? `Stage changed: ${o.stage} → ${stage}.`
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
  must(c.program_id === o.program_id, "Choose a cohort for the same program.");
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
    "UPDATE opportunities SET stage='Enrolled',stage_at=?,version=version+1 WHERE id=?",
    now(),
    o.id,
  );
  const p = program(o.program_id);
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
      run("UPDATE enrollments SET status='Completed' WHERE id=?", e.id);
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
      ["general", "internal", "finance"].includes(visibility),
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
    run(
      "UPDATE contacts SET name=?,phone=?,language=?,consent=?,guardian=? WHERE id=?",
      text(b.name ?? c.name, "Name", 100),
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
write("/api/cohorts", ["admin", "academic"], (req) => {
  const b = req.body;
  const p = program(b.program_id);
  const instructor = one(
    "SELECT id FROM users WHERE id=? AND role='instructor'",
    integer(b.instructor_id, "Instructor"),
  );
  must(instructor, "Choose an instructor.");
  const start = date(b.start_date, "Start date"),
    end = date(b.end_date, "End date");
  must(end >= start, "End date must follow start date.");
  const id = insert("cohorts", {
    name: text(b.name, "Cohort name", 100),
    program_id: p.id,
    instructor_id: instructor.id,
    capacity: integer(b.capacity, "Capacity", 1, 500),
    start_date: start,
    end_date: end,
    room: text(b.room, "Room or meeting link", 300),
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
  const room = text(b.room || c.room, "Room", 300);
  const title = text(b.title, "Session title", 120);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const starts = new Date(Date.parse(start) + i * 7 * 86400000).toISOString(),
      ends = new Date(Date.parse(end) + i * 7 * 86400000).toISOString();
    const conflict = one(
      `SELECT s.id FROM sessions s JOIN cohorts c ON c.id=s.cohort_id WHERE s.status='Scheduled' AND s.starts_at<? AND s.ends_at>? AND (s.room=? OR c.instructor_id=? OR c.id=?)`,
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
    b.language === "ar" ? "ar" : "en",
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
