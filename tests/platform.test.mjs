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
      CRM_DB: resolve(mkdtempSync(resolve(work, "platform-")), "test.sqlite"),
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
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

test("inbox: incoming WhatsApp, manual log, status, assignment, call log", async () => {
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [
                { wa_id: "213555909090", profile: { name: "Samira Inbox" } },
              ],
              messages: [
                {
                  id: "wamid.1",
                  from: "213555909090",
                  type: "text",
                  text: { body: "Bonjour, avez-vous une place samedi ?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sig =
    "sha256=" +
    createHmac("sha256", "meta-app-secret").update(body).digest("hex");
  const hook = await fetch(base + "/api/integrations/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
    body,
  });
  assert.equal(hook.status, 200);
  // The same Meta message is not stored twice.
  await fetch(base + "/api/integrations/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
    body,
  });
  let s = await state();
  const samira = s.contacts.find((c) => c.name === "Samira Inbox");
  assert.ok(samira, "unknown number becomes a client");
  const conv = s.conversations.find((c) => c.contact_id === samira.id);
  assert.equal(conv.unread, 1);
  assert.equal(conv.total, 1);
  assert.ok(s.inboxUnread >= 1);
  const thread = await request(`/messages/${samira.id}`, undefined, "GET");
  assert.equal(thread.json.messages[0].direction, "in");
  // Reading marks as read; a manual reply is logged.
  const r = await request("/messages", {
    contact_id: samira.id,
    direction: "out",
    channel: "whatsapp",
    body: "Oui, à 10h.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.sent, false);
  const amel = s.users.find((u) => u.name === "Amel Benali");
  assert.equal(
    (
      await request(
        `/conversations/${samira.id}`,
        { status: "Resolved", assignee_id: amel.id },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/calls", {
        contact_id: samira.id,
        outcome: "call_back",
        body: "Rappeler demain",
      })
    ).status,
    200,
  );
  s = await state();
  const after = s.conversations.find((c) => c.contact_id === samira.id);
  assert.equal(after.unread, 0);
  assert.equal(after.status, "Resolved");
  assert.equal(after.assignee_id, amel.id);
  assert.equal(after.total, 3);
  assert.ok(s.tasks.some((t) => t.title === "Rappeler Samira Inbox"));
  const amelCookie = await login("amel");
  const amelState = await state(amelCookie);
  assert.ok(
    amelState.notifications.some(
      (n) => n.kind === "message" && n.contact_id === samira.id,
    ),
  );
});

test("automation builder: trigger, conditions, delay, test, log, once only", async () => {
  let s = await state();
  const client = s.contacts[0];
  const tag = (await request("/tags", { name: "VIP" })).json.id;
  const f = await request("/flows", {
    name: "Merci",
    trigger: "appointment_done",
    delay_minutes: 60,
    conditions: { service: "Consultation" },
    actions: [
      { type: "task", title: "Demander un avis à {name}" },
      { type: "whatsapp", text: "Merci {name} !" },
      { type: "tag", tag_id: tag },
    ],
  });
  assert.equal(f.status, 200);
  const appt = await request("/appointments", {
    kind: "Consultation",
    title: "Consultation individuelle",
    contact_id: client.id,
    staff_id: s.users.find((u) => u.role === "instructor").id,
    starts_at: inHours(-4),
    ends_at: inHours(-3),
    location: "Salle 9",
    allow_overlap: true,
  });
  assert.equal(appt.status, 200, JSON.stringify(appt.json));
  const id = appt.json.ids?.[0] ?? appt.json.id;
  assert.equal(
    (await request(`/appointments/${id}`, { status: "Done" }, "PATCH")).status,
    200,
  );
  const t = await request(`/flows/${f.json.id}/test`, {});
  assert.ok(t.json.found >= 1);
  assert.match(t.json.detail, /Merci/);
  await request("/flows/run", {});
  await request("/flows/run", {});
  s = await state();
  const flow = s.flows.find((x) => x.id === f.json.id);
  assert.equal(flow.total, 1, "runs once per record");
  assert.ok(s.tasks.some((x) => x.title.startsWith("Demander un avis")));
  assert.ok(
    s.drafts.some((d) => d.subject === "Merci"),
    "no Meta key: message prepared",
  );
  assert.ok(
    s.contactTags.some((x) => x.contact_id === client.id && x.tag_id === tag),
  );
  // Condition not met: nothing happens.
  const g = await request("/flows", {
    name: "Langues",
    trigger: "appointment_done",
    conditions: { service: "Anglais" },
    actions: [{ type: "notify", text: "x" }],
  });
  await request("/flows/run", {});
  assert.equal((await state()).flows.find((x) => x.id === g.json.id).total, 0);
  assert.equal(
    (await request("/flows", { name: "x", trigger: "nope", actions: [] }))
      .status,
    400,
  );
  const manager = await login("nadia");
  assert.equal(
    (
      await request(
        "/flows",
        { name: "x", trigger: "birthday", actions: [{ type: "notify" }] },
        "POST",
        manager,
      )
    ).status,
    403,
  );
});

test("custom fields, tags and segments", async () => {
  let s = await state();
  const c = s.contacts[1];
  const field = await request("/custom-fields", {
    entity: "contact",
    label: "Wilaya",
    kind: "list",
    options: "Alger\nBlida\nOran",
  });
  assert.equal(field.status, 200);
  assert.equal(
    (
      await request(
        "/custom-values",
        { field_id: field.json.id, record_id: c.id, value: "Blida" },
        "PUT",
      )
    ).status,
    200,
  );
  const num = (
    await request("/custom-fields", {
      entity: "contact",
      label: "Enfants",
      kind: "number",
    })
  ).json.id;
  assert.equal(
    (
      await request(
        "/custom-values",
        { field_id: num, record_id: c.id, value: "abc" },
        "PUT",
      )
    ).status,
    400,
  );
  const tag = (await request("/tags", { name: "Blida" })).json.id;
  assert.equal(
    (await request(`/contacts/${c.id}/tags`, { tag_id: tag })).status,
    200,
  );
  const seg = await request("/segments", {
    name: "Blida",
    filters: { tag_ids: [tag], fields: { [field.json.id]: "Blida" } },
  });
  assert.equal(seg.json.count, 1);
  s = await state();
  assert.deepEqual(s.segments.find((x) => x.id === seg.json.id).contact_ids, [
    c.id,
  ]);
  assert.equal(
    s.customValues.find((v) => v.field_id === field.json.id).value,
    "Blida",
  );
  const preview = await request("/segments/preview", {
    filters: { inactive_days: 1 },
  });
  assert.ok(Array.isArray(preview.json.contact_ids));
});

test("own forms: public page, spam protection, client + request created", async () => {
  const f = await request("/forms", {
    title: "Inscription anglais",
    title_ar: "التسجيل في الإنجليزية",
    service: "Language course",
    consent_text: "J'accepte d'être contacté(e).",
    fields: [
      { key: "n", label: "Nom", type: "text", required: true, map: "name" },
      {
        key: "p",
        label: "Téléphone",
        type: "phone",
        required: true,
        map: "phone",
      },
      { key: "w", label: "Wilaya", type: "select", options: "Alger,Blida" },
    ],
  });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  const pub = await fetch(`${base}/api/public/forms/${f.json.slug}`).then((r) =>
    r.json(),
  );
  assert.equal(pub.fields.length, 3);
  const send = (b) =>
    fetch(`${base}/api/public/forms/${f.json.slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
  // Bot: hidden field filled → accepted silently, nothing created.
  assert.equal(
    (
      await send({
        answers: { n: "Bot", p: "0555000111" },
        website: "x",
        elapsed_ms: 9000,
        consent: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await send({ answers: { n: "Rania", p: "0555123987" }, elapsed_ms: 9000 }))
      .status,
    400,
    "consent required",
  );
  const ok = await send({
    answers: { n: "Rania Form", p: "0555123987", w: "Blida" },
    elapsed_ms: 9000,
    consent: true,
  });
  assert.equal(ok.status, 200);
  const s = await state();
  const c = s.contacts.find((x) => x.name === "Rania Form");
  assert.ok(c);
  assert.ok(!s.contacts.some((x) => x.name === "Bot"));
  const opp = s.opportunities.find((o) => o.contact_id === c.id);
  assert.match(opp.source, /Inscription anglais/);
  assert.match(opp.notes, /Wilaya: Blida/);
  const form = s.forms.find((x) => x.id === f.json.id);
  assert.equal(form.views, 1);
  assert.equal(form.submissions, 1);
  assert.equal(form.spam, 1);
});

test("comments with mentions, notifications and the daily summary", async () => {
  const s = await state();
  const c = s.contacts[2];
  const r = await request("/comments", {
    contact_id: c.id,
    body: "@Karim peux-tu vérifier le paiement ?",
  });
  assert.equal(r.json.mentioned, 1);
  const karim = await login("karim");
  let ks = await state(karim);
  const n = ks.notifications.find((x) => x.kind === "mention");
  assert.ok(n);
  assert.ok(
    ks.notifications.some((x) => x.kind === "digest"),
    "daily summary",
  );
  await request("/notifications/read", {}, "POST", karim);
  ks = await state(karim);
  assert.ok(ks.notifications.every((x) => x.read_at));
});

test("calendar feed for each staff member", async () => {
  const sarah = await login("sarah");
  const r = await request("/me/calendar-feed", {}, "POST", sarah);
  const ics = await fetch(base + r.json.path).then((x) => x.text());
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.equal(
    (await fetch(base + "/api/public/calendar/wrong.ics")).status,
    404,
  );
});

test("subscriptions bill monthly, promo codes and gift cards", async () => {
  let s = await state();
  const c = s.contacts[3];
  const sub = await request("/subscriptions", {
    contact_id: c.id,
    label: "4 consultations / mois",
    amount: 1200000,
    sessions: 4,
    day_of_month: 1,
  });
  assert.equal(sub.json.billed, 1);
  assert.equal(
    (await request("/subscriptions/bill", {})).json.billed,
    0,
    "once a month",
  );
  s = await state();
  const ch = s.charges.find(
    (x) => x.contact_id === c.id && x.label.startsWith("4 consultations"),
  );
  assert.ok(ch);
  await request("/promo-codes", {
    code: "rentree10",
    percent: 10,
    max_uses: 1,
  });
  const ap = await request("/promo-codes/apply", {
    code: "RENTREE10",
    charge_id: ch.id,
  });
  assert.equal(ap.json.discount, 120000);
  const ch2 = (
    await request("/charges", {
      contact_id: c.id,
      label: "Test",
      amount: 50000,
      currency: "DZD",
      due_date: new Date().toISOString().slice(0, 10),
    })
  ).json;
  const again = await request("/promo-codes/apply", {
    code: "RENTREE10",
    charge_id: ch2.id || ch.id,
  });
  assert.equal(again.status, 409, "used up");
  const g = await request("/gift-cards", {
    amount: 300000,
    recipient: "Maman",
  });
  assert.match(g.json.code, /^GIFT-/);
  const red = await request("/gift-cards/redeem", {
    code: g.json.code,
    charge_id: ch.id,
  });
  assert.equal(red.json.amount, 300000);
  assert.equal(red.json.balance, 0);
  assert.equal(
    (
      await request("/gift-cards/redeem", {
        code: g.json.code,
        charge_id: ch.id,
      })
    ).status,
    409,
  );
});

test("rights per person, branches, record history with restore", async () => {
  let s = await state();
  const amel = s.users.find((u) => u.name === "Amel Benali");
  const br = await request("/branches", { name: "Blida", rooms: "Salle A" });
  assert.equal(
    (
      await request(
        `/users/${amel.id}/access`,
        { rights: { phones: false, export: false }, branch_id: br.json.id },
        "PATCH",
      )
    ).status,
    200,
  );
  const cookie = await login("amel");
  const as = await state(cookie);
  assert.ok(
    as.contacts.filter((c) => c.phone).every((c) => c.phone === "••••••"),
  );
  assert.equal(as.permissions.canExport, false);
  assert.equal(
    (await request("/export/contacts", undefined, "GET", cookie)).status,
    403,
  );
  // Editing with hidden phones keeps the real number.
  const c = s.contacts.find((x) => x.phone);
  await request(
    `/contacts/${c.id}`,
    { name: c.name + " B", phone: "••••••" },
    "PATCH",
    cookie,
  );
  s = await state();
  const edited = s.contacts.find((x) => x.id === c.id);
  assert.equal(edited.phone, c.phone);
  assert.equal(edited.name, c.name + " B");
  const h = await request(`/history/contacts/${c.id}`, undefined, "GET");
  assert.equal(h.json.versions[0].before.name, c.name);
  await request(`/history/${h.json.versions[0].id}/restore`, {});
  assert.equal(
    (await state()).contacts.find((x) => x.id === c.id).name,
    c.name,
  );
});

test("system status, API keys and outgoing webhooks", async () => {
  const st = await request("/system/status", undefined, "GET");
  assert.equal(st.status, 200);
  assert.ok(st.json.migrations.some((m) => m.name === "015_platform.sql"));
  assert.equal(st.json.integrations.ai, false);
  // A small receiver for the webhook.
  const { createServer } = await import("node:http");
  const got = [];
  const receiver = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      got.push({
        sig: req.headers["x-luminol-signature"],
        body: JSON.parse(b),
      });
      res.end("ok");
    });
  });
  await new Promise((ok) => receiver.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${receiver.address().port}/hook`;
  const w = await request("/webhooks", {
    url,
    events: ["inquiry.created", "payment.received"],
  });
  assert.match(w.json.secret, /^whsec_/);
  const key = (await request("/api-keys", { name: "Site web" })).json.key;
  assert.match(key, /^lum_/);
  const api = (path, init = {}) =>
    fetch(base + "/api/v1" + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  assert.equal((await fetch(base + "/api/v1/contacts")).status, 401);
  const list = await api("/contacts?limit=2").then((r) => r.json());
  assert.equal(list.data.length, 2);
  assert.ok(list.next);
  const created = await api("/inquiries", {
    method: "POST",
    body: JSON.stringify({
      name: "Site Visitor",
      phone: "0555777333",
      interest: "Anglais B1",
    }),
  });
  assert.equal(created.status, 201);
  for (let i = 0; i < 20 && !got.length; i++)
    await new Promise((r) => setTimeout(r, 100));
  const ev = got.find((g) => g.body.event === "inquiry.created");
  assert.ok(ev, "webhook delivered");
  assert.equal(ev.body.data.name, "Site Visitor");
  assert.equal(
    ev.sig,
    "sha256=" +
      createHmac("sha256", w.json.secret)
        .update(JSON.stringify(ev.body))
        .digest("hex"),
  );
  const keyId = (await state()).apiKeys[0].id;
  await request(`/api-keys/${keyId}/revoke`, {});
  assert.equal((await api("/contacts")).status, 401);
  receiver.close();
});

test("AI routes are refused without a key; dashboard layout is saved", async () => {
  const r = await request("/ai/summary", {
    contact_id: (await state()).contacts[0].id,
  });
  assert.equal(r.status, 503);
  assert.equal(
    (await request("/me/dashboard", { layout: ["revenue", "today"] }, "PUT"))
      .status,
    200,
  );
  assert.deepEqual((await state()).dashboardLayout, ["revenue", "today"]);
});
