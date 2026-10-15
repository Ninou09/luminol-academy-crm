import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
const folder = mkdtempSync(resolve(work, "api-"));
let server, base, admin, created;
async function request(
  path,
  body,
  cookie = admin,
  method = "POST",
  key = crypto.randomUUID(),
  origin,
) {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", "Idempotency-Key": key }),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await res.text();
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    json = content;
  }
  return {
    status: res.status,
    json,
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(email) {
  const r = await request(
    "/login",
    { email: `${email}@luminol.demo`, password: "LuminolDemo!2026" },
    "",
  );
  assert.equal(r.status, 200);
  return r.cookie;
}
before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(folder, "test.sqlite"),
      DEMO_PASSWORD: "LuminolDemo!2026",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let logs = "";
  server.stderr.on("data", (d) => (logs += String(d)));
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Test server failed to start: " + logs)),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error("Server exited " + code + ": " + logs));
    });
  });
  admin = await login("admin");
});
after(() => {
  server?.kill();
});

test("authentication required; incorrect password and cross-origin writes rejected", async () => {
  assert.equal((await request("/state", undefined, "")).status, 401);
  assert.equal(
    (
      await request(
        "/login",
        { email: "admin@luminol.demo", password: "wrong" },
        "",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/tasks",
        { title: "bad" },
        admin,
        "POST",
        crypto.randomUUID(),
        "https://example.invalid",
      )
    ).status,
    403,
  );
});
test("inquiry → advisor → follow-up → consultation → enrollment → payment persists", async () => {
  const before = (await request("/state")).json;
  const inquiry = await request("/opportunities", {
    name: "QA Journey Student",
    email: "journey@example.test",
    phone: "+213555999111",
    program_id: 1,
    owner_id: 1,
    source: "Website",
    language: "English",
    consent: true,
  });
  assert.equal(inquiry.status, 200);
  created = inquiry.json;
  let state = (await request("/state")).json;
  let opp = state.opportunities.find((o) => o.id === created.id);
  assert.equal(state.contacts.length, before.contacts.length + 1);
  assert.equal(
    state.tasks.filter((t) => t.contact_id === created.contact_id).length,
    1,
  );
  assert.equal(
    (
      await request(
        `/opportunities/${opp.id}`,
        { owner_id: 2, stage: "Contacted", version: opp.version },
        admin,
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/tasks", {
        contact_id: created.contact_id,
        owner_id: 2,
        title: "Call about autumn intake",
        due_at: new Date(Date.now() + 3600000).toISOString(),
        priority: "High",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/notes", {
        contact_id: created.contact_id,
        text: "Consultation complete. Student chose psychology.",
        kind: "consultation",
        visibility: "internal",
      })
    ).status,
    200,
  );
  opp = (await request("/state")).json.opportunities.find(
    (o) => o.id === created.id,
  );
  const enrolled = await request("/enroll", {
    opportunity_id: opp.id,
    version: opp.version,
    cohort_id: 1,
    waitlist: false,
  });
  assert.equal(enrolled.status, 200);
  state = (await request("/state")).json;
  assert.equal(
    state.opportunities.find((o) => o.id === opp.id).stage,
    "Enrolled",
  );
  assert.equal(state.contacts.length, before.contacts.length + 1);
  assert.equal(
    state.enrollments.filter((e) => e.cohort_id === 1 && e.status === "Active")
      .length,
    5,
  );
  const charge = state.charges.find(
    (ch) => ch.contact_id === created.contact_id,
  );
  assert.equal(charge.balance, 3600000);
  const pay = await request("/payments", {
    charge_id: charge.id,
    amount: 1250050,
    method: "Bank transfer",
    reference: "QA-PARTIAL",
  });
  assert.equal(pay.status, 200);
  state = (await request("/state")).json;
  assert.equal(
    state.charges.find((ch) => ch.id === charge.id).balance,
    2349950,
  );
  assert(
    state.activities.some(
      (a) => a.contact_id === created.contact_id && a.kind === "consultation",
    ),
  );
  assert(
    state.activities.some(
      (a) => a.contact_id === created.contact_id && a.kind === "finance",
    ),
  );
  const anotherSession = await login("admin");
  assert.equal(
    (await request("/state", undefined, anotherSession)).json.charges.find(
      (ch) => ch.id === charge.id,
    ).balance,
    2349950,
  );
});
test("duplicate email and phone detected; reuse supports multiple programs without duplicate contacts", async () => {
  const baseContact = {
    name: "Duplicate Name",
    email: "JOURNEY@example.test",
    phone: "",
    program_id: 2,
    owner_id: 2,
    source: "Referral",
  };
  const duplicate = await request("/opportunities", baseContact);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.duplicate.id, created.contact_id);
  const phone = await request("/opportunities", {
    ...baseContact,
    email: "different@example.test",
    phone: "+213 555 999 111",
  });
  assert.equal(phone.status, 409);
  const before = (await request("/state")).json.contacts.length;
  const reuse = await request("/opportunities", {
    contact_id: created.contact_id,
    program_id: 2,
    owner_id: 2,
    source: "Referral",
  });
  assert.equal(reuse.status, 200);
  assert.equal((await request("/state")).json.contacts.length, before);
});
test("capacity enforced; waitlist is idempotent and does not charge or enroll", async () => {
  const o = await request("/opportunities", {
    name: "QA Waitlist",
    email: "waitlist@example.test",
    program_id: 4,
    owner_id: 2,
    source: "Website",
  });
  assert.equal(o.status, 200);
  const input = { opportunity_id: o.json.id, cohort_id: 4, version: 1 };
  const full = await request("/enroll", input);
  assert.equal(full.status, 409);
  assert.equal(full.json.full, true);
  const key = crypto.randomUUID();
  const result = await request(
    "/enroll",
    { ...input, waitlist: true },
    admin,
    "POST",
    key,
  );
  assert.equal(result.json.waitlisted, true);
  assert.deepEqual(
    (await request("/enroll", { ...input, waitlist: true }, admin, "POST", key))
      .json,
    result.json,
  );
  const s = (await request("/state")).json;
  assert.equal(
    s.waitlists.filter((w) => w.contact_id === o.json.contact_id).length,
    1,
  );
  assert.equal(
    s.charges.filter((c) => c.contact_id === o.json.contact_id).length,
    0,
  );
  assert.equal(
    s.enrollments.filter((e) => e.cohort_id === 4 && e.status === "Active")
      .length,
    4,
  );
});
test("payment retries do not duplicate; overpayments, over-refunds and mixed-key reuse rejected", async () => {
  const charge = (await request("/state")).json.charges.find(
    (ch) => ch.contact_id === created.contact_id,
  );
  const body = {
    charge_id: charge.id,
    amount: 100000,
    method: "Cash",
    reference: "Retry test",
  };
  const key = crypto.randomUUID();
  const first = await request("/payments", body, admin, "POST", key);
  const again = await request("/payments", body, admin, "POST", key);
  assert.deepEqual(again.json, first.json);
  assert.equal(
    (
      await request(
        "/payments",
        { ...body, amount: 200000 },
        admin,
        "POST",
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/payments", { ...body, amount: 99999999 })).status,
    409,
  );
  const rkey = crypto.randomUUID();
  const refundBody = {
    payment_id: first.json.id,
    amount: 50000,
    reason: "Test partial refund",
  };
  const refund = await request("/refunds", refundBody, admin, "POST", rkey);
  assert.equal(refund.status, 200);
  assert.deepEqual(
    (await request("/refunds", refundBody, admin, "POST", rkey)).json,
    refund.json,
  );
  assert.equal(
    (await request("/refunds", { ...refundBody, amount: 50001 })).status,
    409,
  );
});
test("instructor cannot retrieve unrelated students, admissions, finance, or restricted notes", async () => {
  const cookie = await login("sarah");
  const s = (await request("/state", undefined, cookie)).json;
  assert.equal(s.user.role, "instructor");
  assert.equal(s.charges.length, 0);
  assert.equal(s.payments.length, 0);
  assert.equal(s.opportunities.length, 0);
  assert(s.cohorts.every((c) => c.instructor_id === 4));
  assert(
    s.contacts.every((c) => s.enrollments.some((e) => e.contact_id === c.id)),
  );
  assert(s.activities.every((a) => a.visibility === "general"));
  assert.equal((await request("/contacts/2", undefined, cookie)).status, 403);
  assert.equal(
    (await request("/export/charges", undefined, cookie)).status,
    403,
  );
  assert.equal(
    (await request("/export/opportunities", undefined, cookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/payments",
        { charge_id: 1, amount: 100, method: "Cash" },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/notes",
        { contact_id: 17, text: "restricted", visibility: "internal" },
        cookie,
      )
    ).status,
    403,
  );
  const csv = (await request("/export/contacts", undefined, cookie)).json;
  assert(!csv.includes("student2@example.test"));
});
test("read-only manager cannot mutate and finance cannot edit admissions", async () => {
  const manager = await login("nadia");
  assert.equal(
    (
      await request(
        "/tasks",
        { title: "Forbidden", due_at: new Date().toISOString() },
        manager,
      )
    ).status,
    403,
  );
  const finance = await login("karim");
  assert.equal(
    (await request("/opportunities", { name: "Forbidden" }, finance)).status,
    403,
  );
  assert.equal(
    (await request("/state", undefined, finance)).json.opportunities.length,
    0,
  );
});
test("optimistic versions reject stale updates and impossible enrolled stage shortcuts", async () => {
  const s = (await request("/state")).json;
  const o = s.opportunities.find((o) => o.stage === "New inquiry");
  assert.equal(
    (
      await request(
        `/opportunities/${o.id}`,
        { stage: "Contacted", version: o.version },
        admin,
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/opportunities/${o.id}`,
        { stage: "Qualified", version: o.version },
        admin,
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/opportunities/${o.id}`,
        { stage: "Enrolled", version: o.version + 1 },
        admin,
        "PATCH",
      )
    ).status,
    400,
  );
});
test("calendar conflicts rollback recurring schedules; assigned instructors can record attendance", async () => {
  const s = (await request("/state")).json;
  const session = s.sessions.find(
    (s) => s.cohort_id === 1 && s.status === "Scheduled",
  );
  const conflict = await request("/sessions", {
    cohort_id: 1,
    title: "Conflict",
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    repeat: 2,
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    (await request("/state")).json.sessions.length,
    s.sessions.length,
  );
  const cookie = await login("sarah");
  const past = s.sessions.find(
    (s) => s.cohort_id === 1 && s.starts_at < new Date().toISOString(),
  );
  assert.equal(
    (
      await request(
        "/attendance",
        {
          session_id: past.id,
          records: [{ contact_id: 17, status: "Present" }],
        },
        cookie,
      )
    ).status,
    200,
  );
  const other = s.sessions.find(
    (s) => s.cohort_id === 2 && s.starts_at < new Date().toISOString(),
  );
  assert.equal(
    (
      await request(
        "/attendance",
        {
          session_id: other.id,
          records: [{ contact_id: 18, status: "Present" }],
        },
        cookie,
      )
    ).status,
    403,
  );
});
test("installment split preserves exact integer total; independent currencies stay distinct", async () => {
  const ch = await request("/charges", {
    contact_id: created.contact_id,
    label: "QA installments",
    amount: 10001,
    discount: 0,
    currency: "EUR",
    due_date: "2026-12-01",
  });
  assert.equal(ch.status, 200);
  const result = await request(`/charges/${ch.json.id}/split`, {
    dates: ["2026-12-01", "2027-01-01", "2027-02-01"],
  });
  assert.equal(result.status, 200);
  const rows = (await request("/state")).json.charges.filter((c) =>
    c.label.startsWith("QA installments"),
  );
  assert.equal(rows.length, 3);
  assert.equal(
    rows.reduce((s, c) => s + c.amount, 0),
    10001,
  );
  assert(rows.every((c) => c.currency === "EUR"));
});
test("unconfigured integration gives actionable recorded error; internal rules deduplicate", async () => {
  const check = await request("/integrations/n8n/check", {});
  assert.equal(check.json.status, "Not configured");
  let state = (await request("/state")).json;
  assert.equal(state.automations[0].status, "Error");
  assert.match(state.automations[0].detail, /credentials/);
  const first = await request("/automations/run", {});
  assert.equal(first.status, 200);
  const second = await request("/automations/run", {});
  assert.equal(second.status, 200);
  const third = await request("/automations/run", {});
  assert.equal(third.json.count, 0);
  state = (await request("/state")).json;
  assert(state.drafts.every((d) => d.status === "Draft"));
});
test("consent required for drafts, documents are persisted and scope protected", async () => {
  const contact = (await request("/state")).json.contacts.find(
    (c) => !c.consent,
  );
  assert.equal(
    (
      await request("/drafts", {
        contact_id: contact.id,
        channel: "Email",
        subject: "test",
        body: "test",
      })
    ).status,
    400,
  );
  const doc = await request("/documents", {
    contact_id: 2,
    name: "demo.txt",
    mime: "text/plain",
    base64: Buffer.from("Fictional document only").toString("base64"),
  });
  assert.equal(doc.status, 200);
  assert.equal(
    (await request(`/documents/${doc.json.id}`)).json,
    "Fictional document only",
  );
  const instructor = await login("sarah");
  assert.equal(
    (await request(`/documents/${doc.json.id}`, undefined, instructor)).status,
    403,
  );
});
test("program pricing updates do not rewrite existing charges; role changes revoke sessions", async () => {
  const s = (await request("/state")).json,
    p = s.programs[0],
    charge = s.charges.find((c) => c.contact_id === created.contact_id);
  assert.equal(
    (
      await request(
        `/programs/${p.id}`,
        { ...p, price: p.price + 10000 },
        admin,
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/state")).json.charges.find((c) => c.id === charge.id)
      .amount,
    charge.amount,
  );
  assert.equal(
    (await request("/users/1/role", { role: "manager" }, admin, "PATCH"))
      .status,
    400,
  );
  const manager = await login("nadia");
  assert.equal(
    (await request("/users/6/role", { role: "academic" }, admin, "PATCH"))
      .status,
    200,
  );
  assert.equal((await request("/state", undefined, manager)).status, 401);
  assert.equal(
    (await request("/users/4/role", { role: "manager" }, admin, "PATCH"))
      .status,
    400,
  );
});
test("bulk follow-ups save atomically and retry without duplicate tasks", async () => {
  const before = (await request("/state")).json;
  const ids = before.opportunities.slice(0, 3).map((o) => o.id);
  const body = {
      opportunity_ids: ids,
      title: "QA bulk follow-up",
      due_at: new Date().toISOString(),
      owner_id: 2,
      priority: "Normal",
    },
    key = crypto.randomUUID();
  const first = await request("/tasks/bulk", body, admin, "POST", key);
  assert.equal(first.status, 200);
  assert.deepEqual(
    (await request("/tasks/bulk", body, admin, "POST", key)).json,
    first.json,
  );
  assert.equal(
    (await request("/state")).json.tasks.filter((t) => t.title === body.title)
      .length,
    3,
  );
  assert.equal(
    (
      await request("/tasks/bulk", {
        ...body,
        opportunity_ids: [ids[0], 999999],
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/state")).json.tasks.filter((t) => t.title === body.title)
      .length,
    3,
  );
});
