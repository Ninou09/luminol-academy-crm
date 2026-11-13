import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
const folder = mkdtempSync(resolve(work, "n8n-"));
const token = "n8n-intake-isolated-test-credential-2026";
let server, base, admin, manager, instructor, finance;
async function request(path, body, { cookie, bearer, method, origin } = {}) {
  const response = await fetch(base + "/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: "Bearer " + bearer } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const inquiry = (key, extras = {}) => ({
  external_id: "test:" + key,
  name: "Automation Sample " + key,
  email: key + "@example.test",
  phone: "",
  language: "English",
  consent: true,
  source: "n8n",
  course_interest: "Program to be confirmed",
  service_type: "training",
  campaign: "integration-test",
  submitted_at: "2026-10-15T13:00:00.000Z",
  ...extras,
});
const capture = (body) =>
  request("/integrations/n8n/inquiries", body, { bearer: token });
const state = async (cookie = admin) =>
  (await request("/state", undefined, { cookie })).json;
before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(folder, "test.sqlite"),
      DEMO_PASSWORD: "LuminolDemo!2026",
      SEED_SAMPLE_DATA: "1",
      N8N_INTAKE_TOKEN: token,
      N8N_INTAKE_OWNER_ID: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((resolve, reject) => {
    let logs = "";
    server.stderr.on("data", (d) => (logs += d));
    const timer = setTimeout(
      () => reject(new Error("Startup failed: " + logs)),
      15000,
    );
    server.stdout.on("data", (d) => {
      const match = String(d).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Server exited " + code + logs));
    });
  });
  async function login(name) {
    const result = await request("/login", {
      email: name + "@luminol.demo",
      password: "LuminolDemo!2026",
    });
    assert.equal(result.status, 200);
    return result.cookie;
  }
  admin = await login("admin");
  manager = await login("nadia");
  instructor = await login("sarah");
  finance = await login("karim");
});
after(() => server?.kill());

test("integration credential is scoped; browser sessions alone cannot submit intake", async () => {
  assert.equal(
    (
      await request("/integrations/n8n/inquiries", inquiry("unauthorized"), {
        cookie: admin,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/integrations/n8n/inquiries", inquiry("wrong-key"), {
        bearer: "wrong-key-that-is-longer-than-thirty-two-characters",
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/state", undefined, { bearer: token })).status,
    401,
  );
  assert.equal(
    (
      await request("/integrations/n8n/inquiries", inquiry("origin"), {
        bearer: token,
        origin: "https://example.invalid",
      })
    ).status,
    403,
  );
  const s = await state();
  assert.equal(s.incoming.length, 0);
  assert.equal(s.n8n.configured, true);
});

test("intake retries create exactly one review task, without an opportunity or raw sensitive fields", async () => {
  const before = await state();
  const body = inquiry("dedup", {
    notes: "PRIVATE NOTES MUST NOT BE COPIED",
    metadata_json: "SECRET RAW METADATA",
  });
  const first = await capture(body);
  assert.equal(first.status, 200);
  assert.equal(first.json.replayed, false);
  const repeat = await capture(body);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.json.replayed, true);
  assert.equal(repeat.json.task_id, first.json.task_id);
  assert.equal(
    (await capture({ ...body, name: "Changed source data" })).status,
    409,
  );
  const after = await state();
  assert.equal(after.tasks.length, before.tasks.length + 1);
  assert.equal(after.contacts.length, before.contacts.length);
  assert.equal(after.opportunities.length, before.opportunities.length);
  const row = after.incoming.find((x) => x.id === first.json.intake_id);
  assert.equal(row.name, body.name);
  assert.equal(row.notes, undefined);
  assert.equal(row.metadata_json, undefined);
  assert.equal(row.fingerprint, undefined);
  assert.equal(
    JSON.stringify(after).includes("PRIVATE NOTES MUST NOT BE COPIED"),
    false,
  );
  assert.equal((await state(instructor)).incoming.length, 0);
  assert.equal((await state(finance)).incoming.length, 0);
  assert.equal((await state(manager)).incoming.length, 1);
  assert.equal(
    (
      await request(
        `/integrations/n8n/inquiries/${row.id}/convert`,
        { program_id: 1, owner_id: 1, version: row.version },
        { cookie: manager },
      )
    ).status,
    403,
  );
});

test("phone-only intake is captured; review may add an email and avoids duplicate conversions", async () => {
  const submitted = await capture(
    inquiry("phone", { email: "", phone: "٠٥٥٥ ١٢٣ ٩٨٨", consent: false }),
  );
  assert.equal(submitted.status, 200);
  const before = await state();
  const row = before.incoming.find((x) => x.id === submitted.json.intake_id);
  assert.equal(row.phone, "+213555123988");
  const path = `/integrations/n8n/inquiries/${row.id}/convert`;
  const assignment = { program_id: 1, owner_id: 1, version: row.version };
  assert.equal(
    (
      await request(
        path,
        { ...assignment, version: 99, email: "phone-review@example.test" },
        { cookie: admin },
      )
    ).status,
    409,
  );
  assert.equal((await state()).contacts.length, before.contacts.length);
  const first = await request(
    path,
    { ...assignment, email: "phone-review@example.test" },
    { cookie: admin },
  );
  assert.equal(first.status, 200);
  const second = await request(
    path,
    { ...assignment, email: "phone-review@example.test" },
    { cookie: admin },
  );
  assert.equal(second.status, 200);
  assert.equal(second.json.id, first.json.id);
  const after = await state();
  const contact = after.contacts.find((c) => c.id === first.json.contact_id);
  assert.equal(contact.consent, 0);
  assert.equal(after.contacts.length, before.contacts.length + 1);
  assert.equal(after.opportunities.length, before.opportunities.length + 1);
  assert.equal(after.tasks.find((t) => t.id === row.task_id).status, "Done");
  assert.equal(
    after.tasks.filter(
      (t) => t.contact_id === contact.id && t.status === "Open",
    ).length,
    1,
  );
  assert.equal(
    after.tasks.find((t) => t.contact_id === contact.id).title,
    "Review communication consent",
  );
  assert.equal(
    (
      await request(
        path,
        { ...assignment, program_id: 2, email: contact.email },
        { cookie: admin },
      )
    ).status,
    409,
  );
});

test("matching existing contacts preserves manual consent and does not restart an enrollment", async () => {
  const initial = await state();
  const opportunity = initial.opportunities.find((o) => o.stage === "Enrolled");
  const contact = initial.contacts.find((c) => c.id === opportunity.contact_id);
  const result = await capture(
    inquiry("existing", {
      name: "Replacement name",
      email: contact.email,
      phone: contact.phone,
      consent: !contact.consent,
    }),
  );
  const row = (await state()).incoming.find(
    (x) => x.id === result.json.intake_id,
  );
  const converted = await request(
    `/integrations/n8n/inquiries/${row.id}/convert`,
    {
      program_id: opportunity.program_id,
      owner_id: opportunity.owner_id,
      version: row.version,
    },
    { cookie: admin },
  );
  assert.equal(converted.status, 200);
  assert.equal(converted.json.id, opportunity.id);
  const after = await state();
  assert.deepEqual(
    after.contacts.find((c) => c.id === contact.id),
    contact,
  );
  assert.equal(after.opportunities.length, initial.opportunities.length);
  assert.equal(
    after.tasks.filter((t) => t.contact_id === contact.id).length,
    initial.tasks.filter((t) => t.contact_id === contact.id).length,
  );
});

test("malformed intake is rejected without side effects", async () => {
  const before = await state();
  for (const body of [
    inquiry("bad-email", { email: "not an email" }),
    inquiry("bad-phone", { phone: "abc" }),
    inquiry("no-contact", { email: "" }),
    inquiry("bad-consent", { consent: "true" }),
    inquiry("bad-time", { submitted_at: "yesterday" }),
  ]) {
    assert.equal((await capture(body)).status, 400);
  }
  const after = await state();
  assert.equal(after.incoming.length, before.incoming.length);
  assert.equal(after.tasks.length, before.tasks.length);
});

test("phone-only leads import in bulk without a program and can be dismissed", async () => {
  const a = await capture(
    inquiry("bulk-a", {
      email: "",
      phone: "0661 22 33 44",
      service_type: "psychological consultation",
      course_interest: "",
    }),
  );
  const b = await capture(inquiry("bulk-b", { course_interest: "Spanish A1" }));
  const c = await capture(inquiry("bulk-c"));
  assert.equal(
    (
      await request(
        `/integrations/n8n/inquiries/${c.json.intake_id}/dismiss`,
        {},
        { cookie: admin },
      )
    ).status,
    200,
  );
  const result = await request(
    "/integrations/n8n/inquiries/import-all",
    {},
    { cookie: admin },
  );
  assert.equal(result.status, 200);
  assert.ok(result.json.imported >= 2);
  const s = await state();
  assert.ok(!s.incoming.some((x) => x.id === c.json.intake_id));
  const phoneOnly = s.contacts.find((x) => x.phone === "+213661223344");
  assert.equal(phoneOnly.email, "");
  const consult = s.opportunities.find((o) => o.contact_id === phoneOnly.id);
  assert.equal(consult.service_type, "Psychology consultation");
  assert.equal(consult.program_id, null);
  const spanish = s.opportunities.find((o) => o.interest === "Spanish A1");
  assert.equal(spanish.program_id, null);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});
