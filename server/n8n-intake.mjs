import { createHash, timingSafeEqual } from "node:crypto";
import { all, one, run, insert, transaction, audit, now } from "./db.mjs";

function requireValue(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
function field(value, label, max, required = false) {
  requireValue(
    value == null || typeof value === "string",
    `${label} must be text.`,
  );
  const result = (value || "").trim();
  requireValue(
    result.length <= max && (!required || result.length),
    `Check ${label}.`,
  );
  return result;
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizePhone(value) {
  let phone = field(value, "Phone", 40)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[\s().\-\u200e\u200f]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^0[567]\d{8}$/.test(phone)) phone = "+213" + phone.slice(1);
  if (/^213[567]\d{8}$/.test(phone)) phone = "+" + phone;
  requireValue(
    !phone || /^\+[1-9]\d{7,14}$/.test(phone),
    "Use an international phone number.",
  );
  return phone;
}
export function n8nConnection() {
  return {
    configured:
      typeof process.env.N8N_INTAKE_TOKEN === "string" &&
      process.env.N8N_INTAKE_TOKEN.length >= 32 &&
      process.env.N8N_INTAKE_TOKEN.length <= 256,
    lastReceivedAt: one(
      "SELECT MAX(received_at) AS value FROM incoming_inquiries",
    ).value,
    pending: one(
      "SELECT COUNT(*) AS value FROM incoming_inquiries WHERE status='Pending'",
    ).value,
  };
}
function authenticate(req) {
  const expected = process.env.N8N_INTAKE_TOKEN || "";
  requireValue(
    expected.length >= 32 && expected.length <= 256,
    "The n8n intake connection is not configured.",
    503,
  );
  const header = req.headers.authorization || "";
  requireValue(
    typeof header === "string" && /^Bearer .{32,256}$/.test(header),
    "Invalid integration credential.",
    401,
  );
  const hash = (s) => createHash("sha256").update(s).digest();
  requireValue(
    timingSafeEqual(hash(header.slice(7)), hash(expected)),
    "Invalid integration credential.",
    401,
  );
}
function payload(body) {
  requireValue(
    body && typeof body === "object" && !Array.isArray(body),
    "An inquiry object is required.",
  );
  requireValue(
    Buffer.byteLength(JSON.stringify(body)) <= 8192,
    "Inquiry payload is too large.",
    413,
  );
  const email = field(body.email, "Email", 254).toLowerCase();
  requireValue(
    !email || emailPattern.test(email),
    "Enter a valid email address.",
  );
  const phone = normalizePhone(body.phone);
  requireValue(email || phone, "An email or phone number is required.");
  requireValue(
    typeof body.consent === "boolean",
    "Consent must be true or false.",
  );
  const submitted = field(body.submitted_at, "Submission time", 40, true);
  requireValue(
    /T/.test(submitted) && Number.isFinite(Date.parse(submitted)),
    "A valid submission time is required.",
  );
  return {
    external_id: field(body.external_id, "External ID", 150, true),
    name: field(body.name, "Name", 100, true),
    email,
    phone,
    language: body.language === "العربية" ? "العربية" : "English",
    consent: body.consent ? 1 : 0,
    service_type: field(body.service_type, "Service", 80),
    course_interest: field(body.course_interest, "Course interest", 180),
    source: field(body.source || "n8n", "Source", 100, true),
    campaign: field(body.campaign, "Campaign", 100),
    submitted_at: new Date(submitted).toISOString(),
  };
}
function intakeOwner() {
  const configured = process.env.N8N_INTAKE_OWNER_ID;
  const owner = configured
    ? one(
        "SELECT id FROM users WHERE id=? AND role IN ('admin','admissions')",
        Number(configured),
      )
    : one("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");
  requireValue(
    owner,
    "Choose an administrator or admissions owner for n8n intake.",
    503,
  );
  return owner.id;
}

/** Service credentials authorize only this intake endpoint, never browser APIs. */
export function installN8nIntake(app) {
  app.post("/api/integrations/n8n/inquiries", (req, res, next) => {
    try {
      authenticate(req);
      const values = payload(req.body);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(values))
        .digest("hex");
      const result = transaction(() => {
        const previous = one(
          "SELECT * FROM incoming_inquiries WHERE external_id=?",
          values.external_id,
        );
        if (previous) {
          requireValue(
            previous.fingerprint === fingerprint,
            "This source inquiry already exists with different data. Review it in the CRM.",
            409,
          );
          return {
            ok: true,
            external_id: previous.external_id,
            intake_id: previous.id,
            task_id: previous.task_id,
            replayed: true,
          };
        }
        const owner = intakeOwner();
        const id = insert("incoming_inquiries", {
          ...values,
          fingerprint,
          received_at: now(),
          owner_id: owner,
        });
        const task = insert("tasks", {
          contact_id: null,
          owner_id: owner,
          title: `Review incoming n8n inquiry #${id}`,
          due_at: new Date(Date.now() + 86400000).toISOString(),
          priority: "Normal",
          status: "Open",
          created_at: now(),
          version: 1,
        });
        run("UPDATE incoming_inquiries SET task_id=? WHERE id=?", task, id);
        insert("automation_runs", {
          event_key: `n8n-intake:${id}`,
          rule: "n8n inquiry → review task",
          status: "Success",
          detail: `Incoming inquiry #${id} captured for admissions review.`,
          created_at: now(),
        });
        audit(
          owner,
          null,
          `Incoming n8n inquiry #${id} captured for review.`,
          "admissions",
          "internal",
        );
        return {
          ok: true,
          external_id: values.external_id,
          intake_id: id,
          task_id: task,
          replayed: false,
        };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
}

export function incomingInquiries(user) {
  return ["admin", "admissions", "manager"].includes(user.role)
    ? all(
        "SELECT * FROM incoming_inquiries WHERE status='Pending' ORDER BY received_at DESC",
      ).map(({ fingerprint, review_fingerprint, ...row }) => row)
    : [];
}

/** Called after normal session authentication. Intake tokens cannot approve leads. */
export function installN8nReview(app) {
  app.post("/api/integrations/n8n/inquiries/:id/convert", (req, res, next) => {
    try {
      requireValue(
        ["admin", "admissions"].includes(req.user.role),
        "Admissions access is required.",
        403,
      );
      requireValue(
        req.body && typeof req.body === "object" && !Array.isArray(req.body),
        "An assignment is required.",
      );
      const result = transaction(() => {
        const incoming = one(
          "SELECT * FROM incoming_inquiries WHERE id=?",
          Number(req.params.id),
        );
        requireValue(incoming, "Incoming inquiry not found.", 404);
        const program = one(
          "SELECT * FROM programs WHERE id=?",
          Number(req.body.program_id),
        );
        const owner = one(
          "SELECT * FROM users WHERE id=? AND role IN ('admin','admissions')",
          Number(req.body.owner_id),
        );
        requireValue(
          program && owner,
          "Choose a program and an admissions advisor.",
        );
        const email = field(
          req.body.email ?? incoming.email,
          "Email",
          254,
        ).toLowerCase();
        requireValue(
          !email || emailPattern.test(email),
          "Enter a valid email address.",
        );
        const reviewFingerprint = createHash("sha256")
          .update(
            JSON.stringify({ program: program.id, owner: owner.id, email }),
          )
          .digest("hex");
        if (incoming.status === "Converted") {
          const previous = one(
            "SELECT * FROM opportunities WHERE id=?",
            incoming.opportunity_id,
          );
          requireValue(
            previous && incoming.review_fingerprint === reviewFingerprint,
            "This inquiry was already reviewed with a different assignment.",
            409,
          );
          return {
            ok: true,
            id: previous.id,
            contact_id: previous.contact_id,
            replayed: true,
          };
        }
        requireValue(
          req.body.version === incoming.version,
          "This inquiry changed. Refresh before reviewing it.",
          409,
        );
        const emailMatch = email
          ? one("SELECT * FROM contacts WHERE email=? COLLATE NOCASE", email)
          : null;
        const phoneMatches = incoming.phone
          ? all("SELECT * FROM contacts WHERE phone<>''").filter((c) => {
              try {
                return normalizePhone(c.phone) === incoming.phone;
              } catch {
                return false;
              }
            })
          : [];
        requireValue(
          phoneMatches.length <= 1,
          "Several contacts match this phone. Resolve duplicates before importing.",
          409,
        );
        const phoneMatch = phoneMatches[0];
        requireValue(
          !emailMatch || !phoneMatch || emailMatch.id === phoneMatch.id,
          "Email and phone match different contacts. Review the duplicate records.",
          409,
        );
        let contact = emailMatch || phoneMatch;
        if (!contact) {
          requireValue(
            emailPattern.test(email),
            "Confirm an email address before creating the contact.",
          );
          const id = insert("contacts", {
            name: incoming.name,
            email,
            phone: incoming.phone,
            language: incoming.language,
            consent: incoming.consent,
            guardian: "",
            created_at: now(),
          });
          contact = one("SELECT * FROM contacts WHERE id=?", id);
        }
        let opportunity = one(
          "SELECT * FROM opportunities WHERE contact_id=? AND program_id=? AND stage NOT IN ('Lost','Nurture') ORDER BY id DESC LIMIT 1",
          contact.id,
          program.id,
        );
        if (!opportunity) {
          const id = insert("opportunities", {
            contact_id: contact.id,
            program_id: program.id,
            owner_id: owner.id,
            stage: "New inquiry",
            source: incoming.source,
            campaign: incoming.campaign,
            tags: "n8n",
            expected_date: "",
            created_at: now(),
            stage_at: now(),
            version: 1,
          });
          opportunity = one("SELECT * FROM opportunities WHERE id=?", id);
        }
        run(
          "UPDATE incoming_inquiries SET opportunity_id=?,review_fingerprint=?,status='Converted',version=version+1 WHERE id=?",
          opportunity.id,
          reviewFingerprint,
          incoming.id,
        );
        run(
          "UPDATE tasks SET status='Done',version=version+1 WHERE id=?",
          incoming.task_id,
        );
        const existingTask = one(
          "SELECT id FROM tasks WHERE contact_id=? AND status='Open' LIMIT 1",
          contact.id,
        );
        if (!existingTask && opportunity.stage !== "Enrolled")
          insert("tasks", {
            contact_id: contact.id,
            owner_id: opportunity.owner_id,
            title: contact.consent
              ? "Make first contact"
              : "Review communication consent",
            due_at: new Date(Date.now() + 86400000).toISOString(),
            priority: "Normal",
            status: "Open",
            created_at: now(),
            version: 1,
          });
        audit(
          req.user.id,
          contact.id,
          `Incoming n8n inquiry #${incoming.id} reviewed for ${program.name}.`,
          "admissions",
        );
        return {
          ok: true,
          id: opportunity.id,
          contact_id: contact.id,
          replayed: false,
        };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
}
