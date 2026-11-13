import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

process.env.CRM_DB = ":memory:";
const { totp } = await import("../server/security.mjs");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
const file = resolve(mkdtempSync(resolve(work, "round5-")), "test.sqlite");
let server, base, admin;
async function request(path, body, method = "POST", cookie = admin) {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    json: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
const login = (email, password, code) =>
  request("/login", { email, password, ...(code ? { code } : {}) }, "POST", "");
before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: file,
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "1",
      MAIL_DRY_RUN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((ok) =>
    server.stdout.on("data", (c) => {
      const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) ok(m[0]);
    }),
  );
  admin = (await login("admin@luminol.demo", "RealAdminPassword!2026")).cookie;
});
after(() => server?.kill());
const lastMail = () => {
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT value FROM meta WHERE key='last_mail'").get();
  db.close();
  return row && JSON.parse(row.value);
};

test("forgotten password: same answer for unknown e-mails, one-time link works", async () => {
  const unknown = await request(
    "/password/forgot",
    { email: "nobody@x.test" },
    "POST",
    "",
  );
  const known = await request(
    "/password/forgot",
    { email: "amel@luminol.demo" },
    "POST",
    "",
  );
  assert.equal(unknown.json.message, known.json.message);
  const mail = lastMail();
  assert.equal(mail.to, "amel@luminol.demo");
  const token = mail.text.match(/token=([a-f0-9]+)/)[1];
  assert.equal(
    (await request("/password/reset", { token, password: "short" }, "POST", ""))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/password/reset",
        { token, password: "NewAmelPassword!1" },
        "POST",
        "",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/password/reset",
        { token, password: "Another!Password2" },
        "POST",
        "",
      )
    ).status,
    400,
  );
  assert.equal(
    (await login("amel@luminol.demo", "NewAmelPassword!1")).status,
    200,
  );
});

test("two-step sign-in asks for the authenticator code", async () => {
  const setup = await request("/account/2fa/setup", {});
  assert.equal(setup.status, 200);
  assert.equal(
    (await request("/account/2fa/enable", { code: "000000" })).status,
    400,
  );
  assert.equal(
    (await request("/account/2fa/enable", { code: totp(setup.json.secret) }))
      .status,
    200,
  );
  const noCode = await login("admin@luminol.demo", "RealAdminPassword!2026");
  assert.equal(noCode.status, 401);
  assert.equal(noCode.json.need_code, true);
  const ok = await login(
    "admin@luminol.demo",
    "RealAdminPassword!2026",
    totp(setup.json.secret),
  );
  assert.equal(ok.status, 200);
  admin = ok.cookie;
  assert.equal(
    (
      await request("/account/2fa/disable", {
        password: "RealAdminPassword!2026",
      })
    ).status,
    200,
  );
});

test("receipts are numbered within the year", async () => {
  const s = (await request("/state")).json;
  const charge = s.charges.find((c) => c.balance > 1000);
  await request("/payments", {
    charge_id: charge.id,
    amount: 1000,
    method: "Cash",
  });
  const after = (await request("/state")).json;
  const numbers = after.payments.map((p) => p.receipt_no).sort((a, b) => a - b);
  assert.equal(numbers[numbers.length - 1], numbers.length);
});

test("psychology: intake file and session notes stay private to the author", async () => {
  const c = (await request("/state")).json.contacts[0];
  assert.equal(
    (
      await request(`/contacts/${c.id}/intake`, {
        answers: { Goals: "Sleep better" },
      })
    ).status,
    200,
  );
  const appt = await request("/appointments", {
    kind: "Psychology consultation",
    title: "S1",
    contact_id: c.id,
    staff_id: 1,
    starts_at: "2027-03-01T09:00:00.000Z",
    ends_at: "2027-03-01T10:00:00.000Z",
  });
  assert.equal(
    (
      await request(`/appointments/${appt.json.id}/note`, {
        text: "Very private",
      })
    ).status,
    200,
  );
  let s = (await request("/state")).json;
  assert.equal(s.intake[0].answers.Goals, "Sleep better");
  assert.equal(s.sessionNotes[0].text, "Very private");
  const yacine = (await login("yacine@luminol.demo", "RealAdminPassword!2026"))
    .cookie;
  const other = (await request("/state", undefined, "GET", yacine)).json;
  assert.equal(other.intake.length, 0);
  assert.equal(other.sessionNotes.length, 0);
  assert.equal(
    (
      await request(
        `/appointments/${appt.json.id}/note`,
        { text: "overwrite" },
        "POST",
        yacine,
      )
    ).status,
    403,
  );
});

test("languages: placement, marks, next level and verifiable certificate", async () => {
  let s = (await request("/state")).json;
  const e = s.enrollments.find((x) => x.status === "Active");
  const contact = e.contact_id;
  assert.equal(
    (
      await request("/placement", {
        contact_id: contact,
        test_name: "Test Cambridge",
        score: 32,
        max_score: 50,
        level: "A2",
      })
    ).status,
    200,
  );
  const bulk = await request("/grades/bulk", {
    cohort_id: e.cohort_id,
    title: "Test 1",
    max_score: 20,
    marks: [{ enrollment_id: e.id, score: 15.5 }],
  });
  assert.equal(bulk.json.count, 1);
  assert.equal(
    (
      await request("/grades/bulk", {
        cohort_id: e.cohort_id,
        title: "Bad",
        max_score: 20,
        marks: [{ enrollment_id: e.id, score: 25 }],
      })
    ).status,
    400,
  );
  const target = s.cohorts.find((c) => c.id !== e.cohort_id);
  const promoted = await request(`/enrollments/${e.id}/promote`, {
    cohort_id: target.id,
    level: "B1",
  });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.json));
  s = (await request("/state")).json;
  assert.equal(s.contacts.find((c) => c.id === contact).level, "B1");
  assert.equal(s.enrollments.find((x) => x.id === e.id).status, "Completed");
  const cert = await request(`/enrollments/${e.id}/certificate`, {});
  assert.ok(cert.json.code);
  const check = await request(
    `/public/certificate/${cert.json.code}`,
    undefined,
    "GET",
    "",
  );
  assert.equal(check.json.valid, true);
  assert.equal(check.json.level, "B1");
  assert.equal(
    (await request("/public/certificate/NOPE", undefined, "GET", "")).json
      .valid,
    false,
  );
});

test("pay rates are stored per staff member", async () => {
  assert.equal(
    (
      await request(
        "/users/4/pay",
        { pay_mode: "hour", pay_rate: 150000 },
        "PATCH",
      )
    ).status,
    200,
  );
  const s = (await request("/state")).json;
  assert.equal(s.users.find((u) => u.id === 4).pay_rate, 150000);
});
