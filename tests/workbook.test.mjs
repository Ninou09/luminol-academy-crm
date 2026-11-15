import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
let server, base, admin;
async function request(path, body) {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
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
      CRM_DB: resolve(mkdtempSync(resolve(work, "workbook-")), "test.sqlite"),
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

// A tiny .xlsx written the way some generators do it: prefixed XML and
// formula-string cells, which the read-excel-file package could not read.
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, dir, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

test("the built-in reader opens prefixed workbooks with string and date cells", async () => {
  const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="m"><x:sheetData>
    <x:row r="1"><x:c r="A1" t="str"><x:v>full_name</x:v></x:c><x:c r="B1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="str"><x:v>seen</x:v></x:c></x:row>
    <x:row r="2"><x:c r="A2" t="str"><x:v>Amina &amp; Co</x:v></x:c><x:c r="B2" t="str"><x:v>0550000001</x:v></x:c><x:c r="C2" t="d"><x:v>2026-11-14T00:00:00</x:v></x:c></x:row>
    <x:row r="3"><x:c r="A3" t="inlineStr"><x:is><x:t>سارة</x:t></x:is></x:c><x:c r="C3"><x:v>46000</x:v></x:c></x:row>
  </x:sheetData></x:worksheet>`;
  const book = await readWorkbook(
    zip({
      "xl/workbook.xml": `<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Contacts" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml" Type="ws"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>phone</t></si></sst>`,
      "xl/worksheets/sheet1.xml": sheet,
    }),
  );
  assert.deepEqual(book.Contacts, [
    {
      full_name: "Amina & Co",
      phone: "0550000001",
      seen: "2026-11-14T00:00:00",
    },
    { full_name: "سارة", phone: null, seen: 46000 },
  ]);
});

const sheets = {
  Company: [
    {
      company_name: "Test Academy",
      operating_currency: "DZD",
      timezone: "Africa/Algiers",
    },
  ],
  Team: [
    {
      person_id: "OWNER",
      full_name: "Owner",
      relationship: "Owner / operator",
    },
    {
      person_id: "SPEC",
      full_name: "Specialist One",
      name_ar: "أخصائية",
      relationship: "Primary presenter",
      phone: "0661111111",
      public_title: "المعالجة",
    },
    {
      person_id: "GUEST",
      full_name: "Old Guest",
      relationship: "Past guest presenter",
    },
  ],
  Services: [
    {
      service_id: "CONSULTATIONS",
      name_ar: "استشارات",
      min_price_dzd: 2000,
      max_price_dzd: 3000,
    },
  ],
  Courses: [
    {
      course_id: "PAST-FREE",
      title_ar: "لقاء مجاني",
      price_dzd: 0,
      session_dates: "2026-01-10",
      schedule_algeria: "20:00",
      trainer: "أخصائية",
      offer_type: "free",
      first_session_date: "2026-01-10T00:00:00Z",
      planned_duration_hours: 1.25,
      delivery: "Zoom",
    },
    {
      course_id: "PAID",
      title_ar: "دورة مدفوعة",
      price_dzd: 2000,
      session_dates: "2099-01-10 + 2099-01-17",
      schedule_algeria: "10 January 20:00–22:00",
      trainer: "أخصائية",
      offer_type: "professional",
      first_session_date: "2099-01-10T00:00:00Z",
      planned_duration_hours: 6,
    },
    {
      course_id: "IDEA",
      title_ar: "مقترح",
      price_dzd: 6000,
      price_status: "proposal_only",
      status: "proposal_not_scheduled",
      session_dates: "2099-03-01",
      offer_type: "professional",
      first_session_date: "2099-03-01T00:00:00Z",
    },
    { course_id: "WAIT", title_ar: "قائمة انتظار", offer_type: "professional" },
  ],
  Contacts: [
    {
      contact_id: "C1",
      full_name: "Client One",
      phone: "0550000001",
      email: "one@example.com",
      marketing_consent: "yes",
      do_not_contact: false,
    },
    {
      contact_id: "C2",
      full_name: "Client Two",
      phone: "+213550000002",
      email: "one@example.com",
      marketing_consent: "yes",
      do_not_contact: false,
    },
    {
      contact_id: "C3",
      full_name: "Do Not Write",
      phone: "0550000003",
      marketing_consent: "yes",
      do_not_contact: true,
      contact_hold_reason: "Asked to stop",
    },
  ],
  Enrollments: [
    {
      contact_id: "C1",
      course_id: "PAST-FREE",
      status: "request_received",
      record_type: "free_registration",
    },
    {
      contact_id: "C1",
      course_id: "PAST-FREE",
      status: "request_received",
      record_type: "free_registration",
    },
    {
      contact_id: "C1",
      course_id: "PAST-FREE",
      status: "request_received",
      record_type: "feedback",
      form_id: "F",
    },
    {
      contact_id: "C1",
      course_id: "PAID",
      status: "confirmed_participant",
      payment_status: "paid_owner_verified",
      course_price_dzd: 2000,
      amount_paid_dzd: 2000,
      record_type: "interest_request",
    },
    {
      contact_id: "C2",
      course_id: "PAID",
      status: "interested_payment_details_sent",
      record_type: "interest_request",
      lead_source: "Instagram",
    },
    {
      contact_id: "C3",
      course_id: "WAIT",
      status: "waitlist_offer_postponed",
      record_type: "interest_request",
    },
    {
      contact_id: "C3",
      course_id: "WAIT",
      status: "waitlist_offer_postponed",
      record_type: "interest_request",
    },
  ],
  Tasks: [{ task: "Confirm the Zoom link", priority: "High" }],
  Payment_Methods: [
    {
      method: "CCP",
      beneficiary: "TEST",
      account_number: "123",
      account_key: "45",
    },
  ],
};

test("the academy workbook replaces the sample data", async () => {
  const refused = await request("/admin/import-workbook", {
    mode: "replace",
    confirm: "no",
    sheets,
  });
  assert.equal(refused.status, 400);
  const r = await request("/admin/import-workbook", {
    mode: "replace",
    confirm: "IMPORT",
    sheets,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.counts.contacts, 3);
  assert.equal(r.json.counts.enrollments, 2); // repeated free sign-up merged
  assert.equal(r.json.counts.requests, 2); // repeated waitlist request merged
  assert.equal(r.json.counts.payments, 1);
  const s = (await request("/state")).json;
  assert.equal(s.settings.academy, "Test Academy");
  assert.ok(s.users.some((u) => u.email === "admin@luminol.com"));
  assert.ok(!s.programs.some((p) => p.name === "Applied Psychology"));
  assert.equal(s.programs.length, 5);
  const one = s.contacts.find((c) => c.name === "Client One");
  const two = s.contacts.find((c) => c.name === "Client Two");
  assert.equal(one.phone, "+213550000001");
  assert.equal(two.email, "");
  assert.match(two.notes, /one@example.com/);
  const stop = s.contacts.find((c) => c.name === "Do Not Write");
  assert.equal(stop.consent, 0);
  assert.match(stop.notes, /NE PAS CONTACTER : Asked to stop/);
  const paid = s.programs.find((p) => p.name === "دورة مدفوعة");
  assert.equal(paid.price, 200000);
  const groups = s.cohorts;
  assert.equal(groups.find((g) => g.program_id === paid.id).status, "Active");
  assert.equal(
    groups.find((g) => g.name.startsWith("لقاء مجاني")).status,
    "Completed",
  );
  assert.equal(
    groups.find((g) => g.name.startsWith("مقترح")).status,
    "Planned",
  );
  const staff = s.users.map((u) => u.name);
  assert.ok(staff.some((n) => n.startsWith("Specialist One")));
  // The owner is the admin account itself, renamed, not a second user.
  assert.deepEqual(
    s.users.filter((u) => u.name === "Owner").map((u) => u.role),
    ["admin"],
  );
  assert.equal(s.users.find((u) => u.name.startsWith("Old Guest")).active, 0);
  assert.ok(s.opportunities.some((o) => o.stage === "Awaiting payment"));
  assert.ok(s.opportunities.some((o) => o.stage === "Nurture"));
  assert.ok(
    s.tasks.some(
      (t) => t.title === "Confirm the Zoom link" && t.priority === "High",
    ),
  );
});

test("a later import only adds what is new and keeps existing records", async () => {
  const before = (await request("/state")).json;
  const kept = await request("/contacts", {
    name: "Added By Hand",
    phone: "0550000099",
    language: "Français",
  });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  const again = await request("/admin/import-workbook", {
    sheets: {
      ...sheets,
      Contacts: [
        ...sheets.Contacts,
        { contact_id: "C4", full_name: "New Person", phone: "0550000004" },
        { contact_id: "C5", full_name: "Facebook Only" },
      ],
      Enrollments: [
        ...sheets.Enrollments,
        {
          contact_id: "C4",
          course_id: "PAID",
          status: "request_received",
          record_type: "interest_request",
        },
      ],
    },
  });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.counts.contacts, 2);
  assert.equal(again.json.counts.requests, 1);
  assert.equal(again.json.counts.enrollments || 0, 0);
  assert.equal(again.json.counts.programs || 0, 0);
  assert.equal(again.json.counts.tasks || 0, 0);
  const after = (await request("/state")).json;
  assert.equal(after.contacts.length, before.contacts.length + 3);
  // Importing the same file once more adds nothing at all.
  const third = await request("/admin/import-workbook", {
    sheets: {
      ...sheets,
      Contacts: [
        ...sheets.Contacts,
        { contact_id: "C4", full_name: "New Person", phone: "0550000004" },
        { contact_id: "C5", full_name: "Facebook Only" },
      ],
    },
  });
  assert.equal(third.json.counts.contacts || 0, 0);
  assert.equal(
    (await request("/state")).json.contacts.length,
    after.contacts.length,
  );
  assert.ok(after.contacts.some((c) => c.name === "Added By Hand"));
  assert.equal(after.programs.length, before.programs.length);
  assert.equal(after.cohorts.length, before.cohorts.length);
  assert.equal(after.tasks.length, before.tasks.length);
  assert.equal(after.charges.length, before.charges.length);
});
