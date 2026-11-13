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
const state = async () => (await request("/state")).json;
async function start(env) {
  const folder = mkdtempSync(resolve(work, "admin-"));
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(folder, "test.sqlite"),
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((ok, fail) => {
    const timer = setTimeout(
      () => fail(new Error("server did not start")),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      const m = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
    });
  });
  const r = await request(
    "/login",
    { email: "admin@luminol.demo", password: "RealAdminPassword!2026" },
    "POST",
    "",
  );
  assert.equal(r.status, 200);
  admin = r.cookie;
}
before(() => start());
after(() => server?.kill());

test("a real workspace starts empty with one administrator", async () => {
  const s = await state();
  assert.equal(s.contacts.length, 0);
  assert.equal(s.programs.length, 0);
  assert.equal(s.users.length, 1);
  assert.equal(s.demo, false);
});

test("consultations and free-text courses need no program; everything can be edited and deleted", async () => {
  const consult = await request("/opportunities", {
    name: "Real Client",
    phone: "0550 11 22 33",
    service_type: "Psychology consultation",
    interest: "Individual session",
    owner_id: 1,
    source: "Facebook ad",
  });
  assert.equal(consult.status, 200, JSON.stringify(consult.json));
  const course = await request("/opportunities", {
    name: "Second Client",
    email: "second@example.test",
    service_type: "Language course",
    interest: "German B1",
    owner_id: 1,
    source: "Walk-in",
  });
  assert.equal(course.status, 200);
  let s = await state();
  const o = s.opportunities.find((x) => x.id === course.json.id);
  assert.equal(o.program_id, null);
  assert.equal(o.interest, "German B1");

  const program = await request("/programs", {
    name: "German B1",
    category: "Languages",
    duration: "10 weeks",
    price: 2500000,
    currency: "DZD",
  });
  const teacherGroup = await request("/cohorts", {
    name: "German evenings",
    program_id: program.json.id,
    instructor_name: "Real Teacher",
    capacity: 10,
    start_date: "2026-12-01",
    end_date: "2027-02-01",
    room: "",
  });
  assert.equal(teacherGroup.status, 200, JSON.stringify(teacherGroup.json));
  s = await state();
  const teacher = s.users.find((u) => u.name === "Real Teacher");
  assert.equal(teacher.role, "instructor");

  const edited = await request(
    `/opportunities/${o.id}`,
    {
      version: o.version,
      interest: "German B1",
      service_type: "Language course",
      program_id: program.json.id,
    },
    "PATCH",
  );
  assert.equal(edited.status, 200);
  const enrolled = await request("/enroll", {
    opportunity_id: o.id,
    cohort_id: teacherGroup.json.id,
  });
  assert.equal(enrolled.status, 200);
  assert.equal(
    (await request(`/cohorts/${teacherGroup.json.id}`, {}, "DELETE")).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/cohorts/${teacherGroup.json.id}`,
        { name: "German Tue/Thu", capacity: 12 },
        "PATCH",
      )
    ).status,
    200,
  );

  const appt = await request("/appointments", {
    kind: "Consultation",
    title: "First consultation",
    contact_id: consult.json.contact_id,
    staff_id: 1,
    starts_at: "2026-12-02T09:00:00.000Z",
    ends_at: "2026-12-02T10:00:00.000Z",
    location: "Office 2",
  });
  assert.equal(appt.status, 200);
  assert.equal(
    (
      await request(
        `/appointments/${appt.json.id}`,
        { status: "Done" },
        "PATCH",
      )
    ).status,
    200,
  );
  s = await state();
  assert.equal(s.appointments[0].status, "Done");

  assert.equal(
    (await request(`/contacts/${consult.json.contact_id}`, {}, "DELETE"))
      .status,
    200,
  );
  s = await state();
  assert.ok(!s.contacts.some((c) => c.id === consult.json.contact_id));
  assert.equal(s.appointments.length, 0);
});

test("staff can be added, given a password, and removed or deactivated", async () => {
  const add = await request("/users", {
    name: "New Advisor",
    email: "advisor@academy.test",
    role: "admissions",
    password: "AdvisorPass!2026",
  });
  assert.equal(add.status, 200);
  const login = await request(
    "/login",
    { email: "advisor@academy.test", password: "AdvisorPass!2026" },
    "POST",
    "",
  );
  assert.equal(login.status, 200);
  await request(
    "/opportunities",
    {
      name: "Advisor Lead",
      phone: "0770 00 00 01",
      interest: "Anything",
      owner_id: add.json.id,
    },
    "POST",
    login.cookie,
  );
  const removed = await request(`/users/${add.json.id}`, {}, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal(removed.json.deactivated, true);
  assert.equal(
    (
      await request(
        "/login",
        { email: "advisor@academy.test", password: "AdvisorPass!2026" },
        "POST",
        "",
      )
    ).status,
    401,
  );
  assert.equal((await request("/users/1", {}, "DELETE")).status, 400);
});

test("account password change requires the current password", async () => {
  assert.equal(
    (
      await request(
        "/account",
        { current_password: "wrong", new_password: "x".repeat(12) },
        "PATCH",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/account",
        { current_password: "RealAdminPassword!2026", name: "Director" },
        "PATCH",
      )
    ).status,
    200,
  );
});

test("packages count sessions; double bookings need confirmation; weekly repeats", async () => {
  const c = await request("/contacts", {
    name: "Package Client",
    phone: "0555 99 88 77",
  });
  const pack = await request("/packages", {
    contact_id: c.json.id,
    title: "Therapy pack",
    sessions_total: 3,
    price: 1500000,
  });
  assert.equal(pack.status, 200, JSON.stringify(pack.json));
  const slot = {
    kind: "Psychology consultation",
    title: "Session",
    contact_id: c.json.id,
    staff_id: 1,
    package_id: pack.json.id,
    starts_at: "2027-01-05T09:00:00.000Z",
    ends_at: "2027-01-05T10:00:00.000Z",
    repeat: 3,
  };
  const series = await request("/appointments", slot);
  assert.equal(series.status, 200);
  assert.equal(series.json.ids.length, 3);
  const clash = await request("/appointments", {
    ...slot,
    repeat: 1,
    package_id: null,
    title: "Other",
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.overlap, true);
  assert.equal(
    (
      await request("/appointments", {
        ...slot,
        repeat: 1,
        package_id: null,
        title: "Other",
        allow_overlap: true,
      })
    ).status,
    200,
  );
  await request(
    `/appointments/${series.json.ids[0]}`,
    { status: "Done" },
    "PATCH",
  );
  await request(
    `/appointments/${series.json.ids[1]}`,
    { status: "No-show" },
    "PATCH",
  );
  const s = await state();
  const p = s.packages.find((x) => x.id === pack.json.id);
  assert.equal(p.used, 2);
  assert.equal(p.booked, 1);
  assert.ok(
    s.charges.some((ch) => ch.id === p.charge_id && ch.amount === 1500000),
  );
});

test("private notes are visible only to their author", async () => {
  const c = await request("/contacts", {
    name: "Private Client",
    phone: "0555 10 20 30",
  });
  await request("/notes", {
    contact_id: c.json.id,
    text: "Confidential observation",
    visibility: "private",
  });
  assert.ok(
    (await state()).activities.some(
      (a) => a.text === "Confidential observation",
    ),
  );
  await request("/users", {
    name: "Second Admin",
    email: "second@academy.test",
    role: "admin",
    password: "SecondAdmin!2026",
  });
  const other = await request(
    "/login",
    { email: "second@academy.test", password: "SecondAdmin!2026" },
    "POST",
    "",
  );
  const theirs = (await request("/state", undefined, "GET", other.cookie)).json;
  assert.ok(
    !theirs.activities.some((a) => a.text === "Confidential observation"),
  );
});

test("deleted clients go to the trash and can be restored", async () => {
  const c = await request("/contacts", {
    name: "Restore Me",
    email: "restore@academy.test",
  });
  await request("/notes", { contact_id: c.json.id, text: "keep me" });
  assert.equal(
    (await request(`/contacts/${c.json.id}`, {}, "DELETE")).status,
    200,
  );
  let s = await state();
  const item = s.trash.find((t) => t.label.startsWith("Restore Me"));
  assert.ok(item);
  assert.equal((await request(`/trash/${item.id}/restore`, {})).status, 200);
  s = await state();
  assert.ok(s.contacts.some((x) => x.id === c.json.id));
  assert.ok(s.activities.some((a) => a.text === "keep me"));
});

test("clients import from a spreadsheet, skipping duplicates and bad rows", async () => {
  const r = await request("/import/contacts", {
    create_requests: true,
    rows: [
      {
        name: "Imported One",
        phone: "661223355",
        interest: "Arabic for kids",
        service_type: "Language course",
        level: "A2",
      },
      { name: "Imported Two", email: "two@import.test" },
      { name: "", phone: "0770000000" },
      { name: "Duplicate", phone: "0661 22 33 55" },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.created, 2);
  assert.equal(r.json.requests, 1);
  assert.equal(r.json.skippedCount, 2);
  const s = await state();
  const one = s.contacts.find((c) => c.name === "Imported One");
  assert.equal(one.phone, "0661223355");
  assert.equal(one.level, "A2");
});

test("templates can be edited and a backup can be downloaded", async () => {
  const s = await state();
  assert.ok(s.templates.length >= 4);
  assert.equal(
    (
      await request(
        `/templates/${s.templates[0].id}`,
        { body: "Hello {name}" },
        "PATCH",
      )
    ).status,
    200,
  );
  const res = await fetch(base + "/api/admin/backup", {
    headers: { cookie: admin },
  });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), "SQLite format 3");
});

test("clean start removes sample records from an old demo workspace", async () => {
  server.kill();
  await start({
    SEED_SAMPLE_DATA: "1",
    ADMIN_PASSWORD: "RealAdminPassword!2026",
  });
  let s = await state();
  assert.ok(s.contacts.length > 10);
  assert.equal(
    (await request("/admin/clean-start", { confirm: "no" })).status,
    400,
  );
  const r = await request("/admin/clean-start", { confirm: "DELETE" });
  assert.equal(r.status, 200);
  s = await state();
  assert.equal(s.contacts.length, 0);
  assert.equal(s.programs.length, 0);
  assert.equal(s.cohorts.length, 0);
  assert.equal(s.users.length, 1);
  assert.equal(s.tasks.length, 0);
});
