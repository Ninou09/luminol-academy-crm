import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
const SECRET = "test_sk_chargily_secret";
let server, base, admin, mock, mockBase;
const sentWhatsApp = [];
async function request(
  path,
  body,
  method = "POST",
  cookie = admin,
  extra = {},
) {
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
      ...extra,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
before(async () => {
  // Fake Chargily and WhatsApp APIs.
  mock = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/checkouts")) {
        const b = JSON.parse(raw);
        return res.end(
          JSON.stringify({
            id: "chk_" + b.metadata.charge_id + "_" + Date.now(),
            checkout_url: "https://pay.test/x",
            amount: b.amount,
          }),
        );
      }
      if (req.url.endsWith("/messages")) {
        sentWhatsApp.push(JSON.parse(raw));
        return res.end(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(mkdtempSync(resolve(work, "round6-")), "test.sqlite"),
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "1",
      CHARGILY_SECRET_KEY: SECRET,
      CHARGILY_API_URL: mockBase,
      WHATSAPP_TOKEN: "wa-token",
      WHATSAPP_PHONE_ID: "123",
      WHATSAPP_API_URL: mockBase,
      CRON_SECRET: "cron-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((ok) =>
    server.stdout.on("data", (c) => {
      const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) ok(m[0]);
    }),
  );
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@luminol.demo",
      password: "RealAdminPassword!2026",
    }),
  });
  admin = r.headers.get("set-cookie").split(";")[0];
});
after(() => {
  server?.kill();
  mock?.close();
});
const state = async () => (await request("/state")).json;

test("Chargily: payment link, signed webhook records the payment once", async () => {
  const s = await state();
  const charge = s.charges.find((c) => c.balance > 0 && c.currency === "DZD");
  const link = await request(`/charges/${charge.id}/checkout`, {});
  assert.equal(link.status, 200, JSON.stringify(link.json));
  const event = JSON.stringify({
    type: "checkout.paid",
    data: { id: link.json.id, amount: charge.balance / 100 },
  });
  const bad = await request(
    "/integrations/chargily/webhook",
    event,
    "POST",
    "",
    { signature: "00" },
  );
  assert.equal(bad.status, 403);
  const sig = createHmac("sha256", SECRET).update(event).digest("hex");
  assert.equal(
    (
      await request("/integrations/chargily/webhook", event, "POST", "", {
        signature: sig,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/integrations/chargily/webhook", event, "POST", "", {
        signature: sig,
      })
    ).status,
    200,
  );
  const after = await state();
  const online = after.payments.filter((p) => p.method === "Card (online)");
  assert.equal(online.length, 1);
  assert.equal(after.charges.find((c) => c.id === charge.id).balance, 0);
});

test("client portal shows only that client's schedule, marks and balance", async () => {
  const s = await state();
  const e = s.enrollments.find((x) => x.status === "Active");
  const link = await request(`/contacts/${e.contact_id}/portal-link`, {});
  const portal = await request(
    `/portal/${link.json.token}`,
    undefined,
    "GET",
    "",
  );
  assert.equal(portal.status, 200);
  assert.equal(
    portal.json.name,
    s.contacts.find((c) => c.id === e.contact_id).name,
  );
  assert.equal(portal.json.groups.length >= 1, true);
  assert.equal(portal.json.payOnline, true);
  assert.equal(
    (await request(`/portal/not-a-token`, undefined, "GET", "")).status,
    404,
  );
  await request(`/contacts/${e.contact_id}/portal-link`, {});
  assert.equal(
    (await request(`/portal/${link.json.token}`, undefined, "GET", "")).status,
    404,
    "old link stops working",
  );
});

test("online consultations get a video link; reminders go out by WhatsApp once", async () => {
  const c = await request("/contacts", {
    name: "Online Client",
    phone: "0661 99 88 77",
    consent: true,
  });
  const todayHere = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
  }).format(new Date());
  const tomorrow = new Date(Date.parse(todayHere + "T10:00:00Z") + 86400000);
  const appt = await request("/appointments", {
    kind: "Psychology consultation",
    title: "Séance",
    contact_id: c.json.id,
    staff_id: 1,
    online: true,
    starts_at: tomorrow.toISOString(),
    ends_at: new Date(tomorrow.getTime() + 3600000).toISOString(),
    allow_overlap: true,
  });
  let s = await state();
  const a = s.appointments.find((x) => x.id === appt.json.id);
  assert.match(a.meeting_url, /^https:\/\/meet\.jit\.si\/Luminol-/);
  const due = await request("/automations/whatsapp/due");
  assert.ok(
    due.json.messages.some(
      (m) =>
        m.kind === "appointment" &&
        m.ref_id === a.id &&
        m.text.includes(a.meeting_url),
    ),
  );
  assert.equal(
    (await request("/cron/daily", undefined, "GET", "")).status,
    401,
  );
  const run = await request("/cron/daily", undefined, "GET", "", {
    authorization: "Bearer cron-secret",
  });
  assert.equal(run.status, 200);
  assert.ok(run.json.sent >= 1);
  assert.ok(sentWhatsApp.some((m) => m.to === "213661998877"));
  const again = await request("/cron/daily", undefined, "GET", "", {
    authorization: "Bearer cron-secret",
  });
  assert.equal(again.json.sent, 0);
});

test("satisfaction survey is answered once on the public page", async () => {
  const s = await state();
  const f = await request("/feedback", {
    contact_id: s.contacts[0].id,
    about: "Cours d'anglais",
  });
  const page = await request(
    `/public/feedback/${f.json.token}`,
    undefined,
    "GET",
    "",
  );
  assert.equal(page.json.answered, false);
  assert.equal(
    (
      await request(
        `/public/feedback/${f.json.token}`,
        { rating: 7 },
        "POST",
        "",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/public/feedback/${f.json.token}`,
        { rating: 5, comment: "Super" },
        "POST",
        "",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/public/feedback/${f.json.token}`,
        { rating: 4 },
        "POST",
        "",
      )
    ).status,
    409,
  );
  assert.equal(
    (await state()).feedback.find((x) => x.about === "Cours d'anglais").rating,
    5,
  );
});

test("expenses, invoice numbers and legal details", async () => {
  const x = await request("/expenses", {
    spent_on: "2026-11-01",
    category: "Loyer",
    amount: 6000000,
  });
  assert.equal(x.status, 200);
  assert.equal((await state()).expenses[0].category, "Loyer");
  assert.equal(
    (
      await request(
        "/settings/legal",
        { legal_name: "SARL Luminol", legal_nif: "0001", vat_rate: 19 },
        "PATCH",
      )
    ).status,
    200,
  );
  const s = await state();
  const [a, b] = s.charges.slice(0, 2);
  const n1 = (await request(`/charges/${a.id}/invoice`, {})).json.invoice_no;
  const n1again = (await request(`/charges/${a.id}/invoice`, {})).json
    .invoice_no;
  const n2 = (await request(`/charges/${b.id}/invoice`, {})).json.invoice_no;
  assert.equal(n1, n1again);
  assert.equal(n2, n1 + 1);
  assert.equal(
    (await request(`/expenses/${x.json.id}`, {}, "DELETE")).status,
    200,
  );
});

test("a freed place creates a task for the first person waiting", async () => {
  let s = await state();
  const full = s.cohorts.find(
    (h) =>
      s.enrollments.filter((e) => e.cohort_id === h.id && e.status === "Active")
        .length >= h.capacity,
  );
  const opp = s.opportunities.find(
    (o) => o.stage !== "Enrolled" && o.program_id === full.program_id,
  );
  const w = await request("/enroll", {
    opportunity_id: opp.id,
    cohort_id: full.id,
    waitlist: true,
    version: opp.version,
  });
  assert.equal(w.json.waitlisted, true);
  const leaving = s.enrollments.find(
    (e) => e.cohort_id === full.id && e.status === "Active",
  );
  await request(`/enrollments/${leaving.id}`, { status: "Completed" }, "PATCH");
  s = await state();
  assert.ok(
    s.tasks.some((t) => t.title.startsWith(`Place available in ${full.name}`)),
  );
});

test("campaigns only include clients who agreed to be contacted", async () => {
  const s = await state();
  const yes = s.contacts
    .filter((c) => c.consent && c.phone)
    .slice(0, 2)
    .map((c) => c.id);
  const no = s.contacts
    .filter((c) => !c.consent)
    .slice(0, 1)
    .map((c) => c.id);
  const camp = await request("/campaigns", {
    name: "Rentrée",
    message: "Bonjour {name}, inscriptions ouvertes !",
    contact_ids: [...yes, ...no],
  });
  assert.equal(camp.json.recipients, yes.length);
  const before = sentWhatsApp.length;
  const sent = await request(`/campaigns/${camp.json.id}/send-auto`, {});
  assert.equal(sent.json.sent, yes.length);
  assert.equal(sentWhatsApp.length, before + yes.length);
});
