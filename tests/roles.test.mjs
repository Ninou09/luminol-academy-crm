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
      CRM_DB: resolve(mkdtempSync(resolve(work, "roles-")), "test.sqlite"),
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

test("each sign-in gets its own role", async () => {
  assert.equal((await state()).permissions.role, "director");
  assert.equal(
    (await state(await login("amel"))).permissions.role,
    "secretary",
  );
  assert.equal(
    (await state(await login("nadia"))).permissions.role,
    "administrator",
  );
  assert.equal((await state(await login("sarah"))).permissions.role, "teacher");
  // Only the four roles can be given.
  const r = await request("/users", { name: "X", role: "finance" });
  assert.equal(r.status, 400);
});

test("sign-ins are recorded, failures included", async () => {
  await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "amel@luminol.demo",
      password: "wrong-password",
    }),
  });
  const events = (await state()).loginEvents;
  assert.ok(
    events.some((e) => e.email === "amel@luminol.demo" && e.success === 0),
  );
  assert.ok(events.some((e) => e.success === 1 && /iPhone/.test(e.device)));
  assert.deepEqual((await state(await login("amel"))).loginEvents, []);
});

test("a client cannot be booked twice at the same time", async () => {
  const s = await state();
  const c = s.contacts[0];
  const first = await request("/appointments", {
    kind: "Psychology consultation",
    title: "A",
    contact_id: c.id,
    staff_id: null,
    starts_at: inDays(3, 9),
    ends_at: inDays(3, 10),
    status: "Scheduled",
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const clash = await request("/appointments", {
    kind: "Psychology consultation",
    title: "B",
    contact_id: c.id,
    staff_id: null,
    starts_at: inDays(3, 9),
    ends_at: inDays(3, 10),
    status: "Scheduled",
  });
  assert.equal(clash.status, 409);
  assert.ok(clash.json.overlap);
});

test("a cancelled slot is offered to the waiting list", async () => {
  const s = await state();
  const waiting = s.contacts[1];
  const r = await request("/appointment-waitlist", {
    contact_id: waiting.id,
    kind: "Psychology consultation",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const other = s.contacts[2];
  const a = await request("/appointments", {
    kind: "Psychology consultation",
    title: "To cancel",
    contact_id: other.id,
    staff_id: null,
    starts_at: inDays(4, 11),
    ends_at: inDays(4, 12),
    status: "Scheduled",
  });
  await request(`/appointments/${a.json.id}`, { status: "Cancelled" }, "PATCH");
  const after = await state();
  assert.ok(
    after.tasks.some(
      (t) => t.contact_id === waiting.id && /Créneau libéré/.test(t.title),
    ),
  );
  assert.ok(after.appointmentWaitlist.some((w) => w.contact_id === waiting.id));
});

test("WhatsApp replies 1 and 2 confirm or cancel the next appointment", async () => {
  const s = await state();
  const c =
    s.contacts.find((x) => x.phone && x.id !== s.contacts[0].id) ||
    s.contacts[3];
  const a = await request("/appointments", {
    kind: "Psychology consultation",
    title: "Reply test",
    contact_id: c.id,
    staff_id: null,
    starts_at: inDays(1, 14),
    ends_at: inDays(1, 15),
    status: "Scheduled",
  });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const send = async (text, secret = "meta-app-secret") => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: c.phone.replace(/\D/g, ""),
                    type: "text",
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return fetch(base + "/api/integrations/whatsapp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256":
          "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
      },
      body,
    });
  };
  assert.equal((await send("1", "forged")).status, 403);
  assert.equal((await send("1")).status, 200);
  let appt = (await state()).appointments.find((x) => x.id === a.json.id);
  assert.ok(appt.confirmed_at);
  await send("2");
  appt = (await state()).appointments.find((x) => x.id === a.json.id);
  assert.equal(appt.status, "Cancelled");
  const verify = await fetch(
    base +
      "/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-word&hub.challenge=42",
  );
  assert.equal(await verify.text(), "42");
});

test("goals, weekly report and automatic sign-out setting", async () => {
  const month = new Date().toISOString().slice(0, 7);
  assert.equal(
    (await request("/goals", { month, revenue: 30000000, new_clients: 20 }))
      .status,
    200,
  );
  assert.equal(
    (await state()).goals.find((g) => g.month === month).new_clients,
    20,
  );
  const secretary = await login("amel");
  assert.equal(
    (await request("/goals", { month, revenue: 1 }, "POST", secretary)).status,
    403,
  );
  const report = (await request("/reports/weekly")).json;
  assert.match(report.text, /Encaissé/);
  const s = await state();
  const r = await request("/settings", {
    academy: s.settings.academy,
    currency: "DZD",
    timezone: "Africa/Algiers",
    language: "fr",
    idle_minutes: 30,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await state()).settings.idle_minutes, 30);
});

test("teachers add materials to their own groups and their own days off", async () => {
  const teacher = await login("sarah");
  const s = await state(teacher);
  const mine = s.cohorts[0];
  const ok = await request(
    `/cohorts/${mine.id}/materials`,
    { title: "Leçon 1", url: "https://example.com/l1.pdf" },
    "POST",
    teacher,
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const all = await state();
  const notMine = all.cohorts.find((c) => c.instructor_id !== s.user.id);
  if (notMine)
    assert.equal(
      (
        await request(
          `/cohorts/${notMine.id}/materials`,
          { title: "X", url: "https://x.test" },
          "POST",
          teacher,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await request(
        `/cohorts/${mine.id}/materials`,
        { title: "Bad", url: "javascript:alert(1)" },
        "POST",
        teacher,
      )
    ).status,
    400,
  );
  assert.ok(
    (await state(teacher)).materials.some((m) => m.title === "Leçon 1"),
  );
  const off = await request(
    `/users/${s.user.id}/time-off`,
    { start_date: "2026-12-24", end_date: "2026-12-26", reason: "Congé" },
    "POST",
    teacher,
  );
  assert.equal(off.status, 200, JSON.stringify(off.json));
});
