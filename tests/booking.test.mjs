import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(root, "../../work/verification");
mkdirSync(work, { recursive: true });
let server, base, admin, psy, service;
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
const tomorrow = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10);
before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      CRM_DB: resolve(mkdtempSync(resolve(work, "booking-")), "test.sqlite"),
      ADMIN_PASSWORD: "RealAdminPassword!2026",
      SEED_SAMPLE_DATA: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((ok) =>
    server.stdout.on("data", (c) => {
      const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) ok(m[0]);
    }),
  );
  admin = (
    await request(
      "/login",
      { email: "admin@luminol.demo", password: "RealAdminPassword!2026" },
      "POST",
      "",
    )
  ).cookie;
  psy = (await request("/users", { name: "Dr. Booking", role: "academic" }))
    .json.id;
  const ranges = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, start_min: 9 * 60, end_min: 12 * 60 },
    { weekday, start_min: 13 * 60, end_min: 17 * 60 },
  ]);
  assert.equal(
    (
      await request(`/users/${psy}/hours`, {
        ranges,
        public_title: "Psychologue",
      })
    ).status,
    200,
  );
  service = (
    await request("/booking/services", {
      name: "Consultation individuelle",
      kind: "Psychology consultation",
      duration_min: 60,
      staff_ids: [psy],
    })
  ).json.id;
});
after(() => server?.kill());

test("the public page stays closed until booking is switched on", async () => {
  const closed = await request("/public/booking", undefined, "GET", "");
  assert.equal(closed.json.enabled, false);
  assert.equal(
    (
      await request(
        "/booking/settings",
        {
          booking_enabled: true,
          booking_intro: "Bienvenue",
          booking_notice_hours: 0,
        },
        "PATCH",
      )
    ).status,
    200,
  );
  const open = await request("/public/booking", undefined, "GET", "");
  assert.equal(open.json.enabled, true);
  assert.equal(open.json.services[0].staff[0].title, "Psychologue");
  assert.equal(open.json.services[0].staff[0].email, undefined);
});

test("clients book a free slot; it disappears and cannot be taken twice", async () => {
  const day = tomorrow();
  const slots = (
    await request(
      `/public/booking/slots?service=${service}&from=${day}`,
      undefined,
      "GET",
      "",
    )
  ).json.days[0];
  assert.equal(slots.day, day);
  const times = slots.slots.map((s) => s.time);
  assert.ok(times.includes("09:00"));
  assert.ok(!times.includes("12:00"), "lunch break is not bookable");
  assert.ok(!times.includes("16:30"), "a 60 minute session must end by 17:00");
  const booking = {
    service_id: service,
    day,
    time: "09:00",
    name: "Client En Ligne",
    phone: "0550 77 88 99",
    consent: true,
    lang: "fr",
  };
  const first = await request("/public/booking", booking, "POST", "");
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.staff, "Dr. Booking");
  const again = await request(
    "/public/booking",
    { ...booking, name: "Other", phone: "0661 00 00 00" },
    "POST",
    "",
  );
  assert.equal(again.status, 409);
  const after = (
    await request(
      `/public/booking/slots?service=${service}&from=${day}`,
      undefined,
      "GET",
      "",
    )
  ).json.days[0];
  assert.ok(!after.slots.some((s) => s.time === "09:00"));
  assert.ok(
    !after.slots.some((s) => s.time === "09:30"),
    "overlapping start is not offered",
  );
  const s = (await request("/state")).json;
  const appt = s.appointments.find((a) => a.source === "booking");
  assert.equal(appt.status, "Pending");
  assert.ok(s.tasks.some((t) => t.title === "Confirm online booking"));
  assert.equal(
    s.contacts.find((c) => c.id === appt.contact_id).phone,
    "+213550778899",
  );
  assert.equal(
    (
      await request(
        `/appointments/${appt.id}`,
        { status: "Scheduled" },
        "PATCH",
      )
    ).status,
    200,
  );
});

test("bots and missing consent are refused; time off closes the day", async () => {
  const day = tomorrow();
  const bot = await request(
    "/public/booking",
    {
      service_id: service,
      day,
      time: "10:00",
      name: "x",
      phone: "1",
      website: "spam",
    },
    "POST",
    "",
  );
  assert.equal(bot.status, 200);
  assert.equal(
    (
      await request(
        "/public/booking",
        {
          service_id: service,
          day,
          time: "10:00",
          name: "No Consent",
          phone: "0550 12 12 12",
        },
        "POST",
        "",
      )
    ).status,
    400,
  );
  const off = await request(`/users/${psy}/time-off`, {
    start_date: day,
    end_date: day,
    reason: "Congé",
  });
  assert.equal(off.status, 200);
  assert.equal(off.json.clash, 1);
  const slots = (
    await request(
      `/public/booking/slots?service=${service}&from=${day}`,
      undefined,
      "GET",
      "",
    )
  ).json.days[0];
  assert.equal(slots.slots.length, 0);
  const staffBooking = await request("/appointments", {
    kind: "Meeting",
    title: "During leave",
    staff_id: psy,
    starts_at: `${day}T10:00:00.000Z`,
    ends_at: `${day}T11:00:00.000Z`,
  });
  assert.equal(staffBooking.status, 409);
  assert.equal(staffBooking.json.outside, true);
  assert.equal(
    (await request(`/time-off/${off.json.id}`, {}, "DELETE")).status,
    200,
  );
});

test("WhatsApp reminders are recorded on the client", async () => {
  const s = (await request("/state")).json;
  const appt = s.appointments[0];
  assert.equal(
    (await request("/reminders", { kind: "appointment", ref_id: appt.id }))
      .status,
    200,
  );
  const after = (await request("/state")).json;
  assert.ok(after.reminders.some((r) => r.ref_id === appt.id));
  assert.ok(
    after.activities.some((a) => a.text.startsWith("WhatsApp reminder sent")),
  );
});
