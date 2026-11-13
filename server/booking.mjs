import { createHash } from "node:crypto";
import { all, one, run, insert, transaction, audit, now } from "./db.mjs";
import { normalizePhone } from "./n8n-intake.mjs";

function fail(message, status = 400, extra = {}) {
  throw Object.assign(new Error(message), { status, extra });
}
const zone = () => one("SELECT timezone FROM settings WHERE id=1").timezone;

/** Wall-clock day + minutes in the academy zone → ISO instant. */
export function zonedToInstant(day, minutes, tz = zone()) {
  const wall = Date.parse(
    `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`,
  );
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess).toISOString(), tz);
    const shown = Date.parse(`${p.day}T00:00:00Z`) + p.minutes * 60000;
    guess += wall - shown;
  }
  return new Date(guess).toISOString();
}
/** ISO instant → { day: "YYYY-MM-DD", minutes } in the academy zone. */
export function parts(iso, tz = zone()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
const weekday = (day) => (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
const addDays = (day, n) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);

/** True when the person has working hours configured at all. */
export function hasHours(userId) {
  return !!one("SELECT id FROM staff_hours WHERE user_id=? LIMIT 1", userId);
}
export function onTimeOff(userId, day) {
  return one(
    "SELECT reason FROM time_off WHERE user_id=? AND start_date<=? AND end_date>=?",
    userId,
    day,
    day,
  );
}
/** Is [start,end) inside the person's working hours and not on leave? */
export function withinHours(userId, startIso, endIso) {
  if (!hasHours(userId)) return { ok: true };
  const tz = zone();
  const s = parts(startIso, tz),
    e = parts(endIso, tz);
  const off = onTimeOff(userId, s.day);
  if (off) return { ok: false, reason: "time off" };
  if (e.day !== s.day) return { ok: false, reason: "hours" };
  const ok = all(
    "SELECT start_min,end_min FROM staff_hours WHERE user_id=? AND weekday=?",
    userId,
    weekday(s.day),
  ).some((r) => r.start_min <= s.minutes && r.end_min >= e.minutes);
  return ok ? { ok: true } : { ok: false, reason: "hours" };
}
/** Busy intervals (minutes) of a person on a given day. */
function busy(userId, day, tz) {
  const from = zonedToInstant(addDays(day, -1), 0, tz),
    to = zonedToInstant(addDays(day, 2), 0, tz);
  const rows = [
    ...all(
      "SELECT starts_at,ends_at FROM appointments WHERE staff_id=? AND status<>'Cancelled' AND starts_at<? AND ends_at>?",
      userId,
      to,
      from,
    ),
    ...all(
      "SELECT s.starts_at,s.ends_at FROM sessions s JOIN cohorts c ON c.id=s.cohort_id WHERE c.instructor_id=? AND s.status='Scheduled' AND s.starts_at<? AND s.ends_at>?",
      userId,
      to,
      from,
    ),
  ];
  return rows
    .map((r) => {
      const a = parts(r.starts_at, tz),
        b = parts(r.ends_at, tz);
      if (a.day > day || b.day < day) return null;
      return [a.day < day ? 0 : a.minutes, b.day > day ? 1440 : b.minutes];
    })
    .filter(Boolean);
}
/** Free start times (minutes) for one person on one day. */
export function freeSlots(userId, day, duration, tz = zone()) {
  if (onTimeOff(userId, day)) return [];
  const notice =
    (one("SELECT booking_notice_hours n FROM settings WHERE id=1").n || 0) *
    3600000;
  const earliest = Date.now() + notice;
  const taken = busy(userId, day, tz);
  const result = [];
  for (const r of all(
    "SELECT start_min,end_min FROM staff_hours WHERE user_id=? AND weekday=? ORDER BY start_min",
    userId,
    weekday(day),
  )) {
    for (let t = r.start_min; t + duration <= r.end_min; t += 30) {
      if (taken.some(([a, b]) => a < t + duration && b > t)) continue;
      if (Date.parse(zonedToInstant(day, t, tz)) < earliest) continue;
      result.push(t);
    }
  }
  return result;
}
function serviceStaff(serviceId) {
  return all(
    `SELECT u.id,u.name,u.public_title FROM booking_service_staff s JOIN users u ON u.id=s.user_id
     WHERE s.service_id=? AND u.active=1 ORDER BY u.name`,
    serviceId,
  );
}
const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Public pages: no login. Only what a client needs is ever returned. */
export function installPublicBooking(app) {
  app.get("/api/public/booking", (req, res, next) => {
    try {
      const s = one("SELECT * FROM settings WHERE id=1");
      if (!s.booking_enabled)
        return res.json({ enabled: false, academy: s.academy });
      const services = all(
        "SELECT id,name,kind,duration_min,description FROM booking_services WHERE active=1 ORDER BY sort,id",
      )
        .map((x) => ({
          ...x,
          staff: serviceStaff(x.id).map((u) => ({
            id: u.id,
            name: u.name,
            title: u.public_title,
          })),
        }))
        .filter((x) => x.staff.length);
      res.json({
        enabled: true,
        academy: s.academy,
        intro: s.booking_intro,
        timezone: s.timezone,
        services,
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/public/booking/slots", (req, res, next) => {
    try {
      const s = one("SELECT * FROM settings WHERE id=1");
      if (!s.booking_enabled) fail("Online booking is closed.", 404);
      const service = one(
        "SELECT * FROM booking_services WHERE id=? AND active=1",
        Number(req.query.service),
      );
      if (!service) fail("Service not found.", 404);
      let staff = serviceStaff(service.id);
      if (req.query.staff)
        staff = staff.filter((u) => u.id === Number(req.query.staff));
      const today = parts(new Date().toISOString(), s.timezone).day;
      const from =
        typeof req.query.from === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) &&
        req.query.from >= today
          ? req.query.from
          : today;
      const days = [];
      for (let i = 0; i < 14; i++) {
        const day = addDays(from, i);
        const map = new Map();
        for (const u of staff)
          for (const t of freeSlots(
            u.id,
            day,
            service.duration_min,
            s.timezone,
          ))
            map.set(t, [...(map.get(t) || []), u.id]);
        days.push({
          day,
          slots: [...map.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([t, ids]) => ({ time: hhmm(t), staff: ids })),
        });
      }
      res.json({ days });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/public/booking", (req, res, next) => {
    try {
      const b = req.body || {};
      // Bots fill hidden fields; answer as if it worked and store nothing.
      if (b.website) return res.json({ ok: true });
      const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "?";
      const key =
        "book:" + createHash("sha256").update(String(ip)).digest("hex");
      const time = Date.now();
      run("DELETE FROM login_attempts WHERE window_start < ?", time - 3600000);
      run(
        "INSERT INTO login_attempts(ip_hash,attempts,window_start) VALUES (?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=attempts+1",
        key,
        time,
      );
      if (
        one("SELECT attempts FROM login_attempts WHERE ip_hash=?", key)
          .attempts > 8
      )
        fail("Too many requests. Please call the academy.", 429);
      const result = transaction(() => {
        const s = one("SELECT * FROM settings WHERE id=1");
        if (!s.booking_enabled) fail("Online booking is closed.", 404);
        const service = one(
          "SELECT * FROM booking_services WHERE id=? AND active=1",
          Number(b.service_id),
        );
        if (!service) fail("Choose a service.");
        const name = String(b.name || "")
          .trim()
          .slice(0, 100);
        if (name.length < 2) fail("Enter your name.");
        let phone;
        try {
          phone = normalizePhone(String(b.phone || ""));
        } catch {
          fail("Enter a valid phone number.");
        }
        if (!phone) fail("Enter your phone number.");
        if (b.consent !== true)
          fail("Please accept to be contacted about this appointment.");
        const day = String(b.day || "");
        const m = String(b.time || "").match(/^(\d{2}):(\d{2})$/);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !m) fail("Choose a time.");
        const start = Number(m[1]) * 60 + Number(m[2]);
        const staffIds = serviceStaff(service.id)
          .map((u) => u.id)
          .filter((id) => !b.staff_id || id === Number(b.staff_id));
        const staffId = staffIds.find((id) =>
          freeSlots(id, day, service.duration_min, s.timezone).includes(start),
        );
        if (!staffId)
          fail("This time was just taken. Please choose another one.", 409);
        const startsAt = zonedToInstant(day, start, s.timezone);
        const endsAt = new Date(
          Date.parse(startsAt) + service.duration_min * 60000,
        ).toISOString();
        let contact = all("SELECT * FROM contacts WHERE phone<>''").find(
          (c) => {
            try {
              return normalizePhone(c.phone) === phone;
            } catch {
              return false;
            }
          },
        );
        if (!contact) {
          const email = String(b.email || "")
            .trim()
            .toLowerCase()
            .slice(0, 254);
          const emailOk =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
            !one("SELECT id FROM contacts WHERE email=? COLLATE NOCASE", email);
          const id = insert("contacts", {
            name,
            email: emailOk ? email : "",
            phone,
            language:
              b.lang === "ar"
                ? "العربية"
                : b.lang === "fr"
                  ? "Français"
                  : "English",
            consent: 1,
            guardian: "",
            notes: "",
            created_at: now(),
          });
          contact = one("SELECT * FROM contacts WHERE id=?", id);
        }
        const id = insert("appointments", {
          kind: service.kind,
          title: service.name,
          contact_id: contact.id,
          staff_id: staffId,
          starts_at: startsAt,
          ends_at: endsAt,
          location: "",
          notes: String(b.note || "")
            .trim()
            .slice(0, 1000),
          status: "Pending",
          source: "booking",
          created_at: now(),
        });
        const owner = one(
          "SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1",
        );
        insert("tasks", {
          contact_id: contact.id,
          owner_id: owner.id,
          title: "Confirm online booking",
          due_at: now(),
          priority: "High",
          status: "Open",
          created_at: now(),
          version: 1,
        });
        audit(
          owner.id,
          contact.id,
          `Online booking request: ${service.name} on ${day} at ${hhmm(start)}.`,
          "appointment",
        );
        return {
          ok: true,
          id,
          day,
          time: hhmm(start),
          staff: one("SELECT name FROM users WHERE id=?", staffId).name,
        };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}
