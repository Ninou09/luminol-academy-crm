import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
let server, base, admin;
async function request(path, body, method = "POST", cookie = admin) {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      cookie,
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(mkdtempSync(resolve(work, "reception-")), "test.sqlite"),
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "1",
      DEMO_PASSWORD: "LuminolDemo!2026",
      WHATSAPP_APP_SECRET: "meta-app-secret",
      WHATSAPP_VERIFY_TOKEN: "verify-word",
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
after(() => server?.kill());

async function login(name) {
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (iPhone)",
    },
    body: JSON.stringify({
      email: `${name}@luminol.demo`,
      password: "RealAdminPassword!2026",
    }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const state = async (cookie = admin) =>
  (await request("/state", undefined, "GET", cookie)).json;
const inDays = (d, h = 10) => {
  const x = new Date(Date.now() + d * 86400000);
  x.setUTCHours(h, 0, 0, 0);
  return x.toISOString();
};

// A tiny valid PNG (1x1 white) padded so it is above the minimum size.
const png =
  "data:image/png;base64," +
  Buffer.concat([
    Buffer.from(
      "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
        "1F15C4890000000D49444154789C63F8FFFF3F0005FE02FEA7D605F2" +
        "0000000049454E44AE426082",
      "hex",
    ),
    Buffer.alloc(400),
  ]).toString("base64");

test("a consent signed on the tablet is stored with the client", async () => {
  const c = (await state()).contacts[0];
  assert.equal(
    (await request(`/contacts/${c.id}/signature`, { image: "nope" })).status,
    400,
  );
  const r = await request(`/contacts/${c.id}/signature`, { image: png });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = await state();
  const again = s.contacts.find((x) => x.id === c.id);
  assert.equal(again.consent, 1);
  assert.ok(again.consent_signed_at);
  assert.ok(
    s.documents.some(
      (d) => d.contact_id === c.id && /Consentement signé/.test(d.name),
    ),
  );
});

test("the client fills in the questionnaire by link; the specialist gets it", async () => {
  const s = await state();
  const c = s.contacts[1];
  const r = await request(`/contacts/${c.id}/intake-link`, {});
  assert.equal(r.status, 200);
  const url = base + "/api/public/intake/" + r.json.token;
  const info = await (await fetch(url)).json();
  assert.ok(info.questions.length > 0);
  const answers = { [info.questions[0]]: "Stress au travail" };
  const sent = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  assert.equal(sent.status, 200);
  const twice = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  assert.equal(twice.status, 409);
  const after = await state();
  assert.ok(
    after.intake.some(
      (x) => x.contact_id === c.id && /Stress/.test(JSON.stringify(x.answers)),
    ),
  );
  assert.ok(
    after.tasks.some(
      (t) => t.contact_id === c.id && /Questionnaire/.test(t.title),
    ),
  );
  assert.equal(
    (await fetch(base + "/api/public/intake/wrong-token")).status,
    404,
  );
});

test("two cards of the same person are merged", async () => {
  const keep = await request("/contacts", {
    name: "Merge Keep",
    phone: "0661000001",
    language: "Français",
  });
  const copy = await request("/contacts", {
    name: "Merge Copy",
    phone: "0771000002",
    email: "copy@example.com",
    language: "Français",
    birth_date: "1990-05-04",
  });
  assert.equal(copy.status, 200, JSON.stringify(copy.json));
  const appt = await request("/appointments", {
    kind: "Psychology consultation",
    title: "M",
    contact_id: copy.json.id,
    staff_id: null,
    starts_at: inDays(9, 9),
    ends_at: inDays(9, 10),
    status: "Scheduled",
  });
  assert.equal(appt.status, 200);
  const secretary = await login("amel");
  assert.equal(
    (
      await request(
        `/contacts/${keep.json.id}/merge`,
        { from_id: copy.json.id },
        "POST",
        secretary,
      )
    ).status,
    403,
  );
  const r = await request(`/contacts/${keep.json.id}/merge`, {
    from_id: copy.json.id,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = await state();
  assert.ok(!s.contacts.some((x) => x.id === copy.json.id));
  const kept = s.contacts.find((x) => x.id === keep.json.id);
  assert.equal(kept.email, "copy@example.com");
  assert.equal(kept.birth_date, "1990-05-04");
  assert.equal(
    s.appointments.find((a) => a.id === appt.json.id).contact_id,
    keep.json.id,
  );
});

test("statement payments keep their date; rooms are saved in the settings", async () => {
  const s = await state();
  const ch = s.charges.find((c) => c.balance > 0);
  const r = await request("/payments", {
    charge_id: ch.id,
    amount: 100,
    method: "CCP",
    reference: "VIR CCP 123",
    paid_on: "2026-10-02",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = (await state()).payments.find((x) => x.id === r.json.id);
  assert.equal(p.created_at.slice(0, 10), "2026-10-02");
  const set = await request("/settings", {
    academy: s.settings.academy,
    currency: "DZD",
    timezone: "Africa/Algiers",
    language: "fr",
    rooms: "Salle 1\nCabinet psy, Salle 2",
  });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal((await state()).settings.rooms, "Salle 1\nCabinet psy\nSalle 2");
});

test("automatic rules create each task once and can be switched off", async () => {
  const s = await state();
  const c = s.contacts[10] || s.contacts[2];
  const missed = await request("/appointments", {
    kind: "Psychology consultation",
    title: "Missed",
    contact_id: c.id,
    staff_id: null,
    starts_at: inDays(-1, 9),
    ends_at: inDays(-1, 10),
    status: "No-show",
    allow_overlap: true,
  });
  assert.equal(missed.status, 200, JSON.stringify(missed.json));
  const first = await request("/automations/run", {});
  assert.equal(first.status, 200, JSON.stringify(first.json));
  let tasks = (await state()).tasks.filter(
    (t) => t.contact_id === c.id && /absent\(e\) au rendez-vous/.test(t.title),
  );
  assert.equal(tasks.length, 1);
  await request("/automations/run", {});
  tasks = (await state()).tasks.filter(
    (t) => t.contact_id === c.id && /absent\(e\) au rendez-vous/.test(t.title),
  );
  assert.equal(tasks.length, 1);
  assert.equal(
    (await request("/automations/rules", { noShow: false })).status,
    200,
  );
  assert.equal((await state()).automationRules.noShow, false);
  const secretary = await login("amel");
  assert.equal(
    (await request("/automations/rules", { noShow: true }, "POST", secretary))
      .status,
    403,
  );
});

test("the secretary checks a client in before the appointment ends", async () => {
  const s = await state();
  const a = await request("/appointments", {
    kind: "Psychology consultation",
    title: "Check-in",
    contact_id: s.contacts[11]?.id || s.contacts[4].id,
    staff_id: null,
    starts_at: inDays(0, 23),
    ends_at: inDays(1, 0),
    status: "Scheduled",
    allow_overlap: true,
  });
  const secretary = await login("amel");
  const r = await request(
    `/appointments/${a.json.id}/checkin`,
    {},
    "POST",
    secretary,
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const appt = (await state()).appointments.find((x) => x.id === a.json.id);
  assert.ok(appt.checked_in_at);
  assert.equal(appt.status, "Scheduled");
});

test("stock goes down when an item is sold and creates the amount due", async () => {
  const add = await request("/stock", {
    name: "Livre Anglais A1",
    unit: "livre",
    quantity: 3,
    min_quantity: 2,
    price: 150000,
  });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const s = await state();
  const c = s.contacts[0];
  const sold = await request(`/stock/${add.json.id}/sell`, {
    contact_id: c.id,
    quantity: 2,
  });
  assert.equal(sold.status, 200, JSON.stringify(sold.json));
  const after = await state();
  assert.equal(after.stock.find((x) => x.id === add.json.id).quantity, 1);
  assert.equal(
    after.charges.find((x) => x.id === sold.json.charge_id).amount,
    300000,
  );
  assert.equal(
    (
      await request(`/stock/${add.json.id}/sell`, {
        contact_id: c.id,
        quantity: 5,
      })
    ).status,
    409,
  );
  const teacher = await login("sarah");
  assert.equal(
    (await request("/stock", { name: "X" }, "POST", teacher)).status,
    403,
  );
});
