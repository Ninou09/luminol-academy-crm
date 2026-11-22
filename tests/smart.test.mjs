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
      CRM_DB: resolve(mkdtempSync(resolve(work, "smart-")), "test.sqlite"),
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
const ask = async (message, cookie = admin) =>
  (await request("/assistant", { message }, "POST", cookie)).json;

test("assistant answers from the data and the help, for free", async () => {
  const s = await state();
  const unpaid = await ask("Qui n'a pas payé ?");
  assert.match(unpaid.text, /retard|Personne/);
  assert.equal(unpaid.engine, "local");
  const how = await ask("Comment créer un scénario automatique ?");
  assert.match(how.text, /Scénarios/);
  assert.equal(how.links[0].page, "Settings");
  const c = s.contacts.find((x) => x.name.split(" ").length >= 2);
  const who = await ask(`Montre-moi ${c.name}`);
  assert.match(who.text, new RegExp(c.name));
  const count = await ask("Combien de nouveaux clients ce mois ?");
  assert.match(count.text, /nouveau\(x\) client/);
  const agenda = await ask("Mes rendez-vous aujourd'hui");
  assert.match(agenda.text, /rendez-vous/);
  const ar = await ask("كم عدد العملاء الجدد هذا الشهر");
  assert.match(ar.text, /client/);
  // Tasks are only proposed; confirming creates them.
  const t = await ask(`Rappelle-moi d'appeler ${c.name} demain`);
  assert.equal(t.actions[0].type, "task");
  assert.equal(t.actions[0].contact_id, c.id);
  const before = (await state()).tasks.length;
  assert.equal((await request("/assistant/confirm", t.actions[0])).status, 200);
  assert.equal((await state()).tasks.length, before + 1);
  const hist = await request("/assistant", undefined, "GET");
  assert.ok(hist.json.messages.length >= 14);
  assert.equal(hist.json.ai, false);
});

test("assistant respects the role: a teacher does not see payments", async () => {
  const sarah = await login("sarah");
  const r = await ask("Qui n'a pas payé ?", sarah);
  assert.match(r.text, /accès/);
});

test("client bot: FAQ, booking, complaint and crisis", async () => {
  const price = (
    await request("/kb/test", { message: "Bonjour, c'est combien le prix ?" })
  ).json;
  assert.equal(price.intent, "price");
  assert.match(price.reply, /tarif/i);
  const ar = (await request("/kb/test", { message: "وين راكم؟ العنوان" })).json;
  assert.match(ar.reply, /البليدة/);
  const complaint = (
    await request("/kb/test", {
      message: "Je ne suis pas content, je veux être remboursé",
    })
  ).json;
  assert.equal(complaint.intent, "complaint");
  assert.equal(complaint.safe, false);
  const crisis = (
    await request("/kb/test", { message: "je n'ai plus envie de vivre" })
  ).json;
  assert.equal(crisis.intent, "urgent");
  assert.match(crisis.reply, /14|17/);
  // Through WhatsApp: urgent conversation, notification, suggested reply in draft mode.
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [
                { wa_id: "213555123000", profile: { name: "Client Prix" } },
              ],
              messages: [
                {
                  id: "wamid.p1",
                  from: "213555123000",
                  type: "text",
                  text: { body: "Salam, quels sont vos horaires ?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await fetch(base + "/api/integrations/whatsapp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256":
        "sha256=" +
        createHmac("sha256", "meta-app-secret").update(body).digest("hex"),
    },
    body,
  });
  const body2 = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [
                { wa_id: "213555123001", profile: { name: "Client Urgent" } },
              ],
              messages: [
                {
                  id: "wamid.p2",
                  from: "213555123001",
                  type: "text",
                  text: { body: "je veux en finir" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await fetch(base + "/api/integrations/whatsapp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256":
        "sha256=" +
        createHmac("sha256", "meta-app-secret").update(body2).digest("hex"),
    },
    body: body2,
  });
  const s = await state();
  const a = s.contacts.find((c) => c.name === "Client Prix");
  const b = s.contacts.find((c) => c.name === "Client Urgent");
  const ca = s.conversations.find((c) => c.contact_id === a.id);
  const cb = s.conversations.find((c) => c.contact_id === b.id);
  assert.match(ca.suggestion, /ouverts/);
  assert.equal(cb.urgent, 1);
  assert.ok(
    s.notifications.some((n) => n.kind === "urgent" && n.contact_id === b.id),
  );
  const thread = (await request(`/messages/${a.id}`, undefined, "GET")).json;
  assert.equal(thread.messages[0].intent, "info");
});

test("website chat: answers, then creates the client and the request", async () => {
  const send = (b) =>
    fetch(base + "/api/public/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => r.json());
  const r1 = await send({
    message: "Je voudrais un rendez-vous avec la psychologue",
  });
  assert.equal(r1.intent, "booking");
  assert.equal(r1.ask_contact, true);
  const r2 = await send({
    token: r1.token,
    name: "Visiteur Chat",
    phone: "0555 66 77 88",
    transcript: [
      { from: "client", text: "Je voudrais un rendez-vous" },
      { from: "bot", text: r1.reply },
    ],
  });
  assert.equal(r2.done, true);
  const s = await state();
  const c = s.contacts.find((x) => x.name === "Visiteur Chat");
  assert.ok(c);
  assert.ok(
    s.opportunities.some(
      (o) => o.contact_id === c.id && o.source === "Chat du site",
    ),
  );
  assert.ok(s.conversations.some((x) => x.contact_id === c.id));
});

test("knowledge base and smart settings", async () => {
  const k = await request("/kb", {
    question: "Avez-vous un parking ?",
    answer: "Oui, un parking gratuit devant l'académie.",
    keywords: "parking,voiture,stationner,باركينغ",
  });
  assert.equal(k.status, 200);
  const r = (
    await request("/kb/test", {
      message: "il y a un parking pour la voiture ?",
    })
  ).json;
  assert.match(r.reply, /parking gratuit/);
  assert.equal(
    (
      await request(
        "/settings/smart",
        { bot_mode: "auto", ai_monthly_tokens: 500000 },
        "PATCH",
      )
    ).status,
    200,
  );
  const s = await state();
  assert.equal(s.settings.bot_mode, "auto");
  assert.equal(s.settings.ai_monthly_tokens, 500000);
  assert.equal(s.aiUsage.month, 0);
  assert.ok(s.kb.length >= 5);
  const manager = await login("nadia");
  assert.equal(
    (await request("/settings/smart", { bot_mode: "off" }, "PATCH", manager))
      .status,
    403,
  );
});

test("predictions: model trained on history, risks with reasons", async () => {
  let s = await state();
  const staffId = s.users.find((u) => u.role === "instructor").id;
  // History: clients who often miss, and clients who always come.
  const people = s.contacts.slice(0, 12);
  for (let i = 0; i < 60; i++) {
    const c = people[i % people.length];
    const start = new Date(Date.now() - (70 - i) * 86400000);
    start.setUTCHours(8 + (i % 8), 0, 0, 0);
    const r = await request("/appointments", {
      kind: "Consultation",
      title: "Consultation",
      contact_id: c.id,
      staff_id: staffId,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 3600000).toISOString(),
      location: "Salle " + (i % 3),
      allow_overlap: true,
    });
    const id = r.json.ids?.[0] ?? r.json.id;
    await request(
      `/appointments/${id}`,
      { status: i % people.length < 3 ? "No-show" : "Done" },
      "PATCH",
    );
  }
  const next = new Date(Date.now() + 2 * 86400000);
  next.setUTCHours(10, 0, 0, 0);
  await request("/appointments", {
    kind: "Consultation",
    title: "Consultation",
    contact_id: people[0].id,
    staff_id: staffId,
    starts_at: next.toISOString(),
    ends_at: new Date(next.getTime() + 3600000).toISOString(),
    location: "Salle 1",
    allow_overlap: true,
  });
  await request("/appointments", {
    kind: "Consultation",
    title: "Consultation",
    contact_id: people[5].id,
    staff_id: staffId,
    starts_at: new Date(next.getTime() + 7200000).toISOString(),
    ends_at: new Date(next.getTime() + 10800000).toISOString(),
    location: "Salle 1",
    allow_overlap: true,
  });
  const t = await request("/predictions/train", {});
  assert.equal(t.json.no_show.trained, true);
  assert.ok(t.json.no_show.samples >= 60);
  s = await state();
  const p = s.predictions;
  assert.equal(p.models.no_show.trained, true);
  const risky = p.noShow.find((x) => x.contact_id === people[0].id);
  const safe = p.noShow.find((x) => x.contact_id === people[5].id);
  assert.ok(risky.score > safe.score, "the client who often misses is riskier");
  assert.ok(risky.reasons.includes("reason:past_no_show"));
  assert.ok(Array.isArray(p.churn));
  assert.ok(Array.isArray(p.load));
  assert.ok(p.bestTimes.length > 0);
  const sarah = await login("sarah");
  assert.equal((await state(sarah)).predictions, null);
});

test("first-visit tour and feedback analysis", async () => {
  assert.equal((await state()).tourDone, false);
  await request("/me/tour", {});
  const s = await state();
  assert.equal(s.tourDone, true);
  assert.equal(typeof s.feedbackAnalysis.positive, "number");
  assert.ok("wait" in s.feedbackAnalysis.topics);
});

test("the bot understands darija written in Latin letters", async () => {
  const r = (
    await request("/kb/test", { message: "Salam, bchhal la consultation ?" })
  ).json;
  assert.equal(r.intent, "price");
  assert.match(r.reply, /tarif/i);
});

test("the administrator creates secretary and teacher accounts, not directors", async () => {
  const manager = await login("nadia");
  const ok = await request(
    "/users",
    {
      name: "Nouvelle Secrétaire",
      role: "admissions",
      email: "secretaire.test@luminol.com",
      password: "UnMotDePasse!2026",
    },
    "POST",
    manager,
  );
  assert.equal(ok.status, 200);
  const t = await request(
    "/users",
    {
      name: "Nouveau Prof",
      role: "instructor",
      email: "prof.test@luminol.com",
    },
    "POST",
    manager,
  );
  assert.equal(t.status, 200);
  assert.equal(
    (
      await request(
        `/users/${t.json.id}/password`,
        { password: "AutreMotDePasse!26" },
        "POST",
        manager,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/users",
        { name: "X", role: "admin", email: "x.test@luminol.com" },
        "POST",
        manager,
      )
    ).status,
    403,
  );
  const s = await state();
  const director = s.users.find((u) => u.role === "admin");
  assert.equal(
    (
      await request(
        `/users/${director.id}`,
        { active: false },
        "PATCH",
        manager,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/users/${ok.json.id}/role`,
        { role: "manager" },
        "PATCH",
        manager,
      )
    ).status,
    403,
  );
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "secretaire.test@luminol.com",
      password: "UnMotDePasse!2026",
    }),
  });
  assert.equal(r.status, 200);
});

test("the secretary gets a simple workspace with no money in it", async () => {
  const amel = await login("amel");
  const s = (await request("/state", undefined, "GET", amel)).json;
  assert.equal(s.permissions.seeMoney, false);
  assert.equal(s.payments.length, 0);
  assert.equal(s.refunds.length, 0);
  assert.equal(s.predictions, null);
  const money = /^(price|amount|balance|paid|discount)$/;
  const leaks = [];
  (function walk(v, path) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        if (money.test(k) && typeof x === "number" && x !== 0)
          leaks.push(`${path}.${k}`);
        else walk(x, `${path}.${k}`);
  })(s, "state");
  assert.deepEqual(leaks, []);
  // She can still take a payment on an open charge, without seeing its amount.
  const open = s.charges.find((c) => c.open);
  assert.ok(open);
  const paid = await request(
    "/payments",
    { charge_id: open.id, amount: 100, method: "Cash" },
    "POST",
    amel,
  );
  assert.equal(paid.status, 200);
  // The director still sees the real amounts.
  const d = await state();
  assert.ok(d.charges.some((c) => c.amount > 0));
  assert.notEqual(d.permissions.seeMoney, false);
});
