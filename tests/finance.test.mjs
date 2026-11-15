import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
let server, base, admin;
async function request(path, body, method = "POST") {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      cookie: admin,
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
      CRM_DB: resolve(mkdtempSync(resolve(work, "finance-")), "test.sqlite"),
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "1",
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

test("a payment can be typed freely: new client, any label and method", async () => {
  const r = await request("/payments", {
    charge_id: "new",
    payer: "Walk-in Client",
    label: "Livre de psychologie",
    amount: 150000,
    method: "CCP",
    reference: "",
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = (await request("/state")).json;
  const c = s.contacts.find((x) => x.name === "Walk-in Client");
  assert.ok(c);
  const ch = s.charges.find((x) => x.contact_id === c.id);
  assert.equal(ch.label, "Livre de psychologie");
  assert.equal(ch.balance, 0);
  assert.equal(s.payments.find((p) => p.charge_id === ch.id).method, "CCP");
  // The same name again reuses the client.
  await request("/payments", {
    charge_id: "new",
    payer: "walk-in client",
    label: "Consultation",
    amount: 300000,
    method: "BaridiMob",
  });
  const again = (await request("/state")).json;
  assert.equal(
    again.contacts.filter((x) => /walk-in client/i.test(x.name)).length,
    1,
  );
});

test("money in and money out are both recorded", async () => {
  const out = await request("/expenses", {
    direction: "out",
    spent_on: "2026-11-01",
    category: "Salaries",
    party: "Trainer",
    label: "Salaire 2026-11",
    amount: 4000000,
    currency: "DZD",
    method: "Cash",
  });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const inn = await request("/expenses", {
    direction: "in",
    spent_on: "2026-11-02",
    category: "Sale of materials",
    amount: 500000,
    currency: "DZD",
  });
  assert.equal(inn.status, 200);
  const s = (await request("/state")).json;
  const salary = s.expenses.find((x) => x.label === "Salaire 2026-11");
  assert.equal(salary.direction, "out");
  assert.equal(salary.party, "Trainer");
  assert.equal(salary.method, "Cash");
  assert.equal(
    s.expenses.find((x) => x.category === "Sale of materials").direction,
    "in",
  );
});

test("an active staff member can be deactivated and reactivated", async () => {
  const s = (await request("/state")).json;
  const other = s.users.find((u) => u.role !== "admin" && u.active !== 0);
  let r = await request(`/users/${other.id}`, { active: false }, "PATCH");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(
    (await request("/state")).json.users.find((u) => u.id === other.id).active,
    0,
  );
  r = await request(`/users/${other.id}`, { active: true }, "PATCH");
  assert.equal(
    (await request("/state")).json.users.find((u) => u.id === other.id).active,
    1,
  );
  const me = s.users.find((u) => u.email === "admin@luminol.demo");
  r = await request(`/users/${me.id}`, { active: false }, "PATCH");
  assert.equal(r.status, 400);
});
