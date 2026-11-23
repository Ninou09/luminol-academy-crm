// Home screens for the four sign-ins and the tools they share:
// Secretary "Today", Teacher "My week", the analytics Dashboard
// (director and administrator), the appointment waiting list, monthly goals,
// lesson materials, the weekly report and the sign-in journal.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  Send,
  Target,
  Trash2,
  UserPlus,
  Wallet,
  X,
  Package,
  Tv,
} from "lucide-react";
import { useApp } from "./context";
import { ApiError, localDate, toInstant, type Row } from "./types";
import { Badge, Button, DataTable, Dialog, Empty, PageHead, Panel } from "./ui";
import { PendingBookings, RemindersPanel } from "./schedule";
import { printDocument } from "./tools";
import {
  BirthdaysPanel,
  RoomBoard,
  UnansweredPanel,
  WaitingScreen,
  LowStockPanel,
  roomList,
} from "./reception";

// Validated colours (light and dark): teal = money in / main series,
// amber = money out / second series.
const TEAL = "#00897a";
const AMBER = "#c26f00";

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const samePhone = (a: string, b: string) =>
  digits(a).length >= 8 && digits(a).slice(-9) === digits(b).slice(-9);
const addDays = (day: string, n: number) => {
  const d = new Date(Date.parse(day + "T12:00:00Z"));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.parse(month + "-15T12:00:00Z"));
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const localTime = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

/** Open the appointment form one week after a finished session (idea 3). */
export function useNextSession() {
  const { data, open, person } = useApp();
  const zone = data.settings.timezone;
  return (a: Row) => {
    const minutes = Math.round(
      (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60000,
    );
    open({
      type: "appointment",
      contact: a.contact_id ? person(a.contact_id) : undefined,
      extra: {
        day: addDays(localDate(new Date(a.starts_at), zone), 7),
        time: localTime(a.starts_at, zone),
        kind: a.kind,
        title: a.title,
        staff_id: a.staff_id,
        location: a.location,
        minutes,
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Secretary: "Today"
// ---------------------------------------------------------------------------
export function SecretaryHome() {
  const { data, t, open, perform, toast, person, user, time, profile } =
    useApp();
  const zone = data.settings.timezone;
  const today = data.today;
  const tomorrow = addDays(today, 1);
  const [quick, setQuick] = useState(false);
  const [day, setDay] = useState(today);
  const dayOf = (a: Row) => localDate(new Date(a.starts_at), zone);
  const list = data.appointments
    .filter((a) => dayOf(a) === day)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  async function setStatus(a: Row, status: string) {
    try {
      await perform(`/appointments/${a.id}`, { status }, "PATCH");
      toast(t("Changes saved"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  const state = (a: Row) =>
    a.status === "Done"
      ? ["teal", t("Finished")]
      : a.status === "Cancelled"
        ? ["rose", t("Cancelled")]
        : a.status === "No-show"
          ? ["rose", t("No-show")]
          : a.checked_in_at
            ? ["teal", t("In the waiting room")]
            : ["neutral", t("Expected")];
  const first = (data.user.name || "").split(" ")[0];
  return (
    <>
      <PageHead
        title={`${t("Hello")} ${first}`}
        subtitle="What do you want to do? Click a big button."
      />
      <div className="big-actions">
        <button className="big-action blue" onClick={() => setQuick(true)}>
          <Phone size={34} />
          <strong>{t("Book an appointment")}</strong>
          <small>{t("A client calls you")}</small>
        </button>
        <button
          className="big-action green"
          onClick={() => open({ type: "contact" })}
        >
          <UserPlus size={34} />
          <strong>{t("New client")}</strong>
          <small>{t("Write down a new person")}</small>
        </button>
        <button
          className="big-action amber"
          onClick={() => open({ type: "payment" })}
        >
          <Wallet size={34} />
          <strong>{t("Take a payment")}</strong>
          <small>{t("A client pays you")}</small>
        </button>
      </div>
      <PendingBookings />
      <section className="sheet">
        <div className="sheet-head">
          <h2>{t("Appointments")}</h2>
          <div className="sheet-tabs">
            <button
              className={day === today ? "on" : ""}
              onClick={() => setDay(today)}
            >
              {t("Today")}
            </button>
            <button
              className={day === tomorrow ? "on" : ""}
              onClick={() => setDay(tomorrow)}
            >
              {t("Tomorrow")}
            </button>
          </div>
        </div>
        {list.length ? (
          <div className="sheet-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Time")}</th>
                  <th>{t("Client")}</th>
                  <th>{t("Phone")}</th>
                  <th>{t("With")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a, i) => {
                  const c = a.contact_id ? person(a.contact_id) : null;
                  const [tone, label] = state(a);
                  const waiting =
                    a.status === "Scheduled" || a.status === "Pending";
                  return (
                    <tr key={a.id}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <strong>{time(a.starts_at)}</strong>
                      </td>
                      <td>
                        {c ? (
                          <button
                            className="link"
                            onClick={() => profile(c.id)}
                          >
                            {c.name}
                          </button>
                        ) : (
                          a.title
                        )}
                      </td>
                      <td>{c?.phone || ""}</td>
                      <td>{a.staff_id ? user(a.staff_id).name : ""}</td>
                      <td>
                        <Badge tone={tone}>{label}</Badge>
                      </td>
                      <td>
                        <div className="sheet-actions">
                          {waiting && !a.checked_in_at && (
                            <button
                              className="go"
                              onClick={() =>
                                perform(
                                  `/appointments/${a.id}/checkin`,
                                  {},
                                ).catch((e: any) => toast(e.message))
                              }
                            >
                              <Check size={16} /> {t("Arrived")}
                            </button>
                          )}
                          {waiting && a.checked_in_at && (
                            <button
                              className="go"
                              onClick={() => setStatus(a, "Done")}
                            >
                              <Check size={16} /> {t("Finished")}
                            </button>
                          )}
                          {waiting && !a.checked_in_at && (
                            <button onClick={() => setStatus(a, "No-show")}>
                              {t("Absent")}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              open({ type: "appointment", record: a })
                            }
                          >
                            {t("Change")}
                          </button>
                          {c && (
                            <button
                              onClick={() =>
                                open({ type: "whatsapp", contact: c })
                              }
                            >
                              <MessageCircle size={16} /> WhatsApp
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sheet-empty">
            {t("No appointments on this day.")}{" "}
            <button className="link" onClick={() => setQuick(true)}>
              {t("Book an appointment")}
            </button>
          </p>
        )}
      </section>
      {quick && <QuickBookingDialog onClose={() => setQuick(false)} />}
    </>
  );
}

/** The secretary's client list: one simple table, like a spreadsheet. */
export function SimpleClients() {
  const { data, t, open, profile, date } = useApp();
  const [q, setQ] = useState("");
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\s+.-]/g, "");
  const words = norm(q);
  const rows = data.contacts
    .filter(
      (c) =>
        !words ||
        norm(c.name).includes(words) ||
        norm(c.phone).includes(words.replace(/^0/, "")) ||
        norm(c.email).includes(words),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const nextVisit = (id: number) =>
    data.appointments
      .filter(
        (a) =>
          a.contact_id === id &&
          a.starts_at >= new Date().toISOString() &&
          a.status !== "Cancelled",
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  return (
    <>
      <PageHead title="Clients" subtitle="Click a name to open the client.">
        {data.permissions.editAdmissions && (
          <Button
            variant="primary"
            icon={<UserPlus size={18} />}
            onClick={() => open({ type: "contact" })}
          >
            {t("New client")}
          </Button>
        )}
      </PageHead>
      <section className="sheet">
        <div className="sheet-head">
          <input
            className="sheet-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search: name or phone number")}
            aria-label={t("Search: name or phone number")}
          />
          <span className="sheet-count">
            {rows.length} {t("clients")}
          </span>
        </div>
        <div className="sheet-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("Name")}</th>
                <th>{t("Phone")}</th>
                <th>{t("Email")}</th>
                <th>{t("Next appointment")}</th>
                <th>{t("Added on")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((c, i) => {
                const n = nextVisit(c.id);
                return (
                  <tr key={c.id} onClick={() => profile(c.id)}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <button className="link">{c.name}</button>
                    </td>
                    <td>{c.phone}</td>
                    <td>{c.email}</td>
                    <td>
                      {n
                        ? date(n.starts_at, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </td>
                    <td>{c.created_at ? date(c.created_at) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="sheet-empty">{t("No client found.")}</p>}
      </section>
    </>
  );
}

/** One form for a call: client (found or created) and the appointment. */
export function QuickBookingDialog({ onClose }: { onClose: () => void }) {
  const { data, t, perform, toast, money } = useApp();
  const zone = data.settings.timezone;
  // Bookings are made with teachers and specialists only.
  const active = data.users.filter((u) => u.active !== 0);
  const teachers = active.filter((u) => u.role === "instructor");
  const staff = teachers.length ? teachers : active;
  const kinds = Array.from(
    new Set([
      "Psychology consultation",
      "Trial lesson",
      "Placement test",
      ...(data.bookingServices || []).map((s) => s.name),
      ...data.appointments.map((a) => a.kind),
    ]),
  ).filter(Boolean);
  const [v, setV] = useState({
    name: "",
    phone: "",
    kind: "Psychology consultation",
    staff_id: String(
      (staff.find((u) => u.role === "instructor") || staff[0])?.id || "",
    ),
    day: data.today,
    time: "10:00",
    minutes: "60",
    location: "",
    waitlist: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const known = v.phone
    ? data.contacts.find((c) => samePhone(c.phone, v.phone))
    : null;
  const set = (k: string, value: any) => setV((x) => ({ ...x, [k]: value }));
  async function submit(allowOverlap = false) {
    setBusy(true);
    setError("");
    try {
      let contactId = known?.id;
      if (!contactId) {
        const r = await perform("/contacts", {
          name: v.name.trim(),
          phone: v.phone.trim(),
          language: "العربية",
          consent: false,
        });
        contactId = r.id;
      }
      if (v.waitlist) {
        await perform("/appointment-waitlist", {
          contact_id: contactId,
          staff_id: v.staff_id ? Number(v.staff_id) : null,
          kind: v.kind,
          notes: `${v.day} ${v.time}`,
        });
        toast(t("Added to the waiting list"));
        onClose();
        return;
      }
      const start = toInstant(`${v.day}T${v.time}`, zone);
      const end = new Date(
        Date.parse(start) + Number(v.minutes || 60) * 60000,
      ).toISOString();
      await perform("/appointments", {
        kind: v.kind,
        title: v.kind,
        contact_id: contactId,
        staff_id: v.staff_id ? Number(v.staff_id) : null,
        starts_at: start,
        ends_at: end,
        location: v.location,
        notes: t("Booked by phone"),
        status: "Scheduled",
        allow_overlap: allowOverlap,
      });
      toast(t("Appointment booked"));
      onClose();
    } catch (e: any) {
      if (
        e instanceof ApiError &&
        e.details?.overlap &&
        window.confirm(`${e.message}\n\n${t("Book anyway?")}`)
      )
        return submit(true);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const field = (label: string, input: ReactNode, full = false) => (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{t(label)}</span>
      {input}
    </label>
  );
  return (
    <Dialog title={t("Phone booking")} onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-body">
          <div className="form-grid">
            {field(
              "Phone",
              <input
                value={v.phone}
                onChange={(e) => set("phone", e.target.value)}
                inputMode="tel"
                required
                autoFocus
              />,
            )}
            {field(
              "Name",
              <input
                value={known ? known.name : v.name}
                disabled={!!known}
                onChange={(e) => set("name", e.target.value)}
                required={!known}
              />,
            )}
            {known && (
              <p className="form-hint full">
                {t("Client already in the CRM:")} <strong>{known.name}</strong>
              </p>
            )}
            {known &&
              (() => {
                const owes = data.charges
                  .filter((c) => c.contact_id === known.id && c.balance > 0)
                  .reduce((sum, c) => sum + c.balance, 0);
                const missed = data.appointments.filter(
                  (a) => a.contact_id === known.id && a.status === "No-show",
                ).length;
                return owes || missed >= 2 ? (
                  <p className="form-warning full">
                    {owes > 0 &&
                      `${t("Still owes")} ${money(owes, data.settings.currency)}. `}
                    {missed >= 2 &&
                      `${missed} ${t("missed appointments before — confirm the day before.")}`}
                  </p>
                ) : null;
              })()}
            {field(
              "Service",
              <>
                <input
                  list="quick-kinds"
                  value={v.kind}
                  onChange={(e) => set("kind", e.target.value)}
                  required
                />
                <datalist id="quick-kinds">
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {t(k)}
                    </option>
                  ))}
                </datalist>
              </>,
            )}
            {field(
              "Specialist",
              <select
                value={v.staff_id}
                onChange={(e) => set("staff_id", e.target.value)}
              >
                <option value="">{t("Anyone")}</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Date",
              <input
                type="date"
                value={v.day}
                onChange={(e) => set("day", e.target.value)}
                required
              />,
            )}
            {field(
              "Time",
              <input
                type="time"
                value={v.time}
                onChange={(e) => set("time", e.target.value)}
                required
              />,
            )}
            {field(
              "Duration (minutes)",
              <input
                type="number"
                min="10"
                step="5"
                value={v.minutes}
                onChange={(e) => set("minutes", e.target.value)}
              />,
            )}
            {field(
              "Room or place",
              <>
                <input
                  list="quick-rooms"
                  value={v.location}
                  onChange={(e) => set("location", e.target.value)}
                />
                <datalist id="quick-rooms">
                  {roomList(data).map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </>,
            )}
            <label className="check-field full">
              <input
                type="checkbox"
                checked={v.waitlist}
                onChange={(e) => set("waitlist", e.target.checked)}
              />
              <span>
                {t(
                  "No free slot: put the client on the waiting list instead (the first freed slot will be offered).",
                )}
              </span>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {t(v.waitlist ? "Add to the waiting list" : "Book")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Clients waiting for a freed slot (idea 2). */
export function WaitlistPanel() {
  const { data, t, perform, toast, person, user, open, date } = useApp();
  const rows = data.appointmentWaitlist || [];
  if (!data.permissions.editAdmissions) return null;
  async function status(w: Row, s: string) {
    try {
      await perform(`/appointment-waitlist/${w.id}`, { status: s }, "PATCH");
      toast(t("Changes saved"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <Panel
      title="Waiting list for appointments"
      subtitle="When an appointment is cancelled, a task tells you who to call first."
    >
      {rows.length === 0 ? (
        <p className="form-hint padded-hint">
          {t(
            "Nobody is waiting. Tick “waiting list” in a phone booking to add someone.",
          )}
        </p>
      ) : (
        <div className="today-list">
          {rows.map((w) => (
            <div key={w.id} className="today-row">
              <div className="today-time">
                <small>{date(w.created_at)}</small>
              </div>
              <div className="today-main">
                <strong>{person(w.contact_id).name}</strong>
                <small>
                  {[
                    t(w.kind),
                    w.staff_id ? user(w.staff_id).name : t("Anyone"),
                    w.notes,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <div className="row-actions wrap">
                {w.status === "Offered" && (
                  <Badge tone="amber">{t("Offered")}</Badge>
                )}
                <Button
                  variant="small"
                  icon={<MessageCircle size={14} />}
                  onClick={() => {
                    status(w, "Offered");
                    open({ type: "whatsapp", contact: person(w.contact_id) });
                  }}
                >
                  {t("Offer a slot")}
                </Button>
                <Button
                  variant="small"
                  icon={<CalendarPlus size={14} />}
                  onClick={() => {
                    status(w, "Booked");
                    open({
                      type: "appointment",
                      contact: person(w.contact_id),
                      extra: { kind: w.kind, staff_id: w.staff_id },
                    });
                  }}
                >
                  {t("Book")}
                </Button>
                <button
                  className="icon-button danger"
                  aria-label={t("Remove")}
                  onClick={() => status(w, "Removed")}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Teacher / Specialist: "My week"
// ---------------------------------------------------------------------------
export function TeacherHome() {
  const { data, t, open, perform, toast, person, go, time, date, cohort } =
    useApp();
  const zone = data.settings.timezone;
  const me = data.user.id;
  const [span, setSpan] = useState<"day" | "week" | "month">("week");
  const days = span === "day" ? 1 : span === "week" ? 7 : 31;
  const from = data.today;
  const to = addDays(from, days - 1);
  const dayOf = (iso: string) => localDate(new Date(iso), zone);
  const items = [
    ...data.appointments
      .filter((a) => a.staff_id === me && a.status !== "Cancelled")
      .map((a) => ({
        id: `a${a.id}`,
        at: a.starts_at,
        end: a.ends_at,
        title: a.contact_id ? person(a.contact_id).name : a.title,
        sub: [t(a.kind), a.location].filter(Boolean).join(" · "),
        link: a.meeting_url,
        appt: a,
      })),
    ...data.sessions
      .filter(
        (s) =>
          s.status !== "Cancelled" && cohort(s.cohort_id).instructor_id === me,
      )
      .map((s) => ({
        id: `s${s.id}`,
        at: s.starts_at,
        end: s.ends_at,
        title: cohort(s.cohort_id).name,
        sub: [t("Group class"), s.room || cohort(s.cohort_id).room]
          .filter(Boolean)
          .join(" · "),
        link: "",
        session: s,
      })),
  ]
    .filter((x) => dayOf(x.at) >= from && dayOf(x.at) <= to)
    .sort((a, b) => a.at.localeCompare(b.at));
  const byDay = new Map<string, typeof items>();
  for (const x of items) {
    const d = dayOf(x.at);
    byDay.set(d, [...(byDay.get(d) || []), x]);
  }
  const groups = data.cohorts.filter(
    (c) => c.instructor_id === me && c.status !== "Completed",
  );
  const month = data.today.slice(0, 7);
  const doneConsults = data.appointments.filter(
    (a) =>
      a.staff_id === me &&
      a.status === "Done" &&
      dayOf(a.starts_at).startsWith(month),
  ).length;
  const classHours =
    data.sessions
      .filter(
        (s) =>
          cohort(s.cohort_id).instructor_id === me &&
          s.status !== "Cancelled" &&
          s.ends_at < new Date().toISOString() &&
          dayOf(s.starts_at).startsWith(month),
      )
      .reduce(
        (sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)),
        0,
      ) / 3600000;
  const myTimeOff = (data.timeOff || []).filter(
    (x) => x.user_id === me && x.end_date >= data.today,
  );
  const [off, setOff] = useState({ start: "", end: "", reason: "" });
  const toWrite = data.appointments.filter(
    (a) =>
      a.staff_id === me &&
      a.status === "Done" &&
      a.contact_id &&
      dayOf(a.starts_at) >= addDays(data.today, -14) &&
      !(data.sessionNotes || []).some((n) => n.appointment_id === a.id),
  );
  const first = (data.user.name || "")
    .replace(/^(Dr\.?|Pr\.?)\s+/i, "")
    .split(" ")[0];
  return (
    <>
      <PageHead
        title={`${t("Hello")} ${first}`}
        subtitle="Your consultations and classes. Click a big button."
      />
      <div className="big-actions">
        <button className="big-action blue" onClick={() => setSpan("day")}>
          <CalendarDays size={34} />
          <strong>{t("My day")}</strong>
          <small>
            {items.length && span === "day"
              ? `${items.length} ${t("planned")}`
              : t("What I have today")}
          </small>
        </button>
        {groups.length > 0 && (
          <button className="big-action green" onClick={() => go("Attendance")}>
            <Check size={34} />
            <strong>{t("Take attendance")}</strong>
            <small>{t("Who came to the class")}</small>
          </button>
        )}
        <button className="big-action amber" onClick={() => go("Calendar")}>
          <CalendarPlus size={34} />
          <strong>{t("My calendar")}</strong>
          <small>{t("The whole month")}</small>
        </button>
        <button
          className="big-action purple"
          onClick={() =>
            document
              .getElementById("days-off")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <Plus size={34} />
          <strong>{t("A day off")}</strong>
          <small>{t("Tell the secretary")}</small>
        </button>
      </div>
      <section className="sheet">
        <div className="sheet-head">
          <h2>{t("My schedule")}</h2>
          <div className="sheet-tabs">
            {(
              [
                ["day", "Today"],
                ["week", "Week"],
                ["month", "Month"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={span === k ? "on" : ""}
                onClick={() => setSpan(k)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        {items.length ? (
          <div className="sheet-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Day")}</th>
                  <th>{t("Time")}</th>
                  <th>{t("Client or group")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x, i) => (
                  <tr key={x.id}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {dayOf(x.at) === data.today
                        ? t("Today")
                        : date(x.at, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                    </td>
                    <td>
                      <strong>{time(x.at)}</strong> – {time(x.end)}
                    </td>
                    <td>{x.title}</td>
                    <td>{x.sub}</td>
                    <td>
                      <div className="sheet-actions">
                        {x.link && (
                          <a
                            className="sheet-link-button"
                            href={x.link}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={16} /> {t("Join online")}
                          </a>
                        )}
                        {"session" in x ? (
                          <button
                            className="go"
                            onClick={() => go("Attendance")}
                          >
                            {t("Take attendance")}
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              open({ type: "appointment", record: x.appt })
                            }
                          >
                            {t("Open")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sheet-empty">{t("Nothing planned.")}</p>
        )}
      </section>
      {toWrite.length > 0 && (
        <section className="sheet">
          <div className="sheet-head">
            <h2>{t("Notes to write")}</h2>
            <span className="sheet-count">
              {t("Only you can read your notes.")}
            </span>
          </div>
          <div className="sheet-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Date")}</th>
                  <th>{t("Client")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {toWrite.map((a, i) => (
                  <tr key={a.id}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {date(a.starts_at)} {time(a.starts_at)}
                    </td>
                    <td>{person(a.contact_id).name}</td>
                    <td>
                      <div className="sheet-actions">
                        <button
                          className="go"
                          onClick={() =>
                            open({ type: "appointment", record: a })
                          }
                        >
                          {t("Write the note")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div id="days-off" />
      <Panel
        title="My days off"
        subtitle="The secretary sees them in the calendar and cannot book you then."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await perform(`/users/${me}/time-off`, {
                start_date: off.start,
                end_date: off.end || off.start,
                reason: off.reason,
              });
              toast(
                r.clash
                  ? `${t("Saved. Appointments already booked those days:")} ${r.clash}`
                  : t("Changes saved"),
              );
              setOff({ start: "", end: "", reason: "" });
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field">
            <span>{t("First day")}</span>
            <input
              type="date"
              required
              value={off.start}
              onChange={(e) => setOff({ ...off, start: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Last day")}</span>
            <input
              type="date"
              value={off.end}
              onChange={(e) => setOff({ ...off, end: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Reason")}</span>
            <input
              value={off.reason}
              onChange={(e) => setOff({ ...off, reason: e.target.value })}
            />
          </label>
          <Button variant="primary" type="submit" icon={<Plus size={15} />}>
            {t("Add")}
          </Button>
        </form>
        {myTimeOff.length > 0 && (
          <div className="today-list">
            {myTimeOff.map((x) => (
              <div key={x.id} className="today-row">
                <div className="today-main">
                  <strong>
                    {date(x.start_date + "T12:00:00Z")} →{" "}
                    {date(x.end_date + "T12:00:00Z")}
                  </strong>
                  <small>{x.reason}</small>
                </div>
                <button
                  className="icon-button danger"
                  aria-label={t("Delete")}
                  onClick={() =>
                    perform(`/time-off/${x.id}`, {}, "DELETE").catch((e: any) =>
                      toast(e.message),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

/** A teacher's group: students with phone, and lesson materials (idea 10). */
export function GroupCard({ group }: { group: Row }) {
  const { data, t, perform, toast, person, program } = useApp();
  const students = data.enrollments
    .filter((e) => e.cohort_id === group.id && e.status === "Active")
    .map((e) => person(e.contact_id));
  const materials = (data.materials || []).filter(
    (m) => m.cohort_id === group.id,
  );
  const [m, setM] = useState({ title: "", url: "" });
  return (
    <Panel
      title={group.name}
      subtitle={`${t(program(group.program_id).name || "")} · ${students.length} ${t("students")}`}
    >
      <div className="group-card">
        <div>
          <h3>{t("Students")}</h3>
          {students.length === 0 ? (
            <p className="form-hint">{t("No students yet.")}</p>
          ) : (
            <ul className="student-list">
              {students.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  {s.phone && (
                    <span className="row-actions">
                      <a className="button small" href={`tel:${s.phone}`}>
                        <Phone size={13} /> {s.phone}
                      </a>
                      <a
                        className="button small"
                        href={`https://wa.me/${digits(s.phone)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>{t("Lesson materials")}</h3>
          <p className="form-hint">
            {t("Students see these links in their client space.")}
          </p>
          <ul className="material-list">
            {materials.map((x) => (
              <li key={x.id}>
                <a href={x.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> {x.title}
                </a>
                <button
                  className="icon-button danger"
                  aria-label={t("Delete")}
                  onClick={() =>
                    perform(`/materials/${x.id}`, {}, "DELETE").catch(
                      (e: any) => toast(e.message),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await perform(`/cohorts/${group.id}/materials`, m);
                setM({ title: "", url: "" });
                toast(t("Material added"));
              } catch (err: any) {
                toast(err.message);
              }
            }}
          >
            <label className="field">
              <span>{t("Title")}</span>
              <input
                required
                value={m.title}
                onChange={(e) => setM({ ...m, title: e.target.value })}
                placeholder={t("Lesson 3 — PDF")}
              />
            </label>
            <label className="field">
              <span>{t("Link (Google Drive, PDF, video…)")}</span>
              <input
                required
                type="url"
                value={m.url}
                onChange={(e) => setM({ ...m, url: e.target.value })}
                placeholder="https://"
              />
            </label>
            <Button type="submit" icon={<Plus size={15} />}>
              {t("Add")}
            </Button>
          </form>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Charts (thin bars, rounded data ends, hover tooltip, legend for 2 series)
// ---------------------------------------------------------------------------
type Series = { name: string; color: string; values: number[] };
export function ColumnChart({
  labels,
  series,
  format,
  height = 170,
}: {
  labels: string[];
  series: Series[];
  format: (n: number) => string;
  height?: number;
}) {
  const { t } = useApp();
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...series.flatMap((s) => s.values));
  const slot = 60;
  const bar = Math.min(18, (slot - 16) / series.length - 2);
  const path = (x: number, h: number) => {
    if (h <= 0) return "";
    const r = Math.min(4, h, bar / 2);
    const top = height - h;
    return `M${x},${height}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${height}Z`;
  };
  return (
    <div className="mini-chart">
      {series.length > 1 && (
        <div className="finance-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} /> {t(s.name)}
            </span>
          ))}
        </div>
      )}
      <div className="finance-chart">
        <svg
          viewBox={`0 0 ${labels.length * slot} ${height + 30}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={series.map((s) => t(s.name)).join(", ")}
        >
          {[0.5, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2={labels.length * slot}
              y1={height - height * f}
              y2={height - height * f}
              className="finance-grid"
            />
          ))}
          {labels.map((label, i) => (
            <g
              key={label + i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={i * slot}
                y="0"
                width={slot}
                height={height + 30}
                fill="transparent"
              />
              {hover === i && (
                <rect
                  x={i * slot + 2}
                  y="0"
                  width={slot - 4}
                  height={height}
                  className="finance-hover"
                />
              )}
              {series.map((s, k) => (
                <path
                  key={s.name}
                  d={path(
                    i * slot +
                      (slot - series.length * (bar + 2)) / 2 +
                      k * (bar + 2),
                    (s.values[i] / peak) * height,
                  )}
                  fill={s.color}
                />
              ))}
              <text
                x={i * slot + slot / 2}
                y={height + 20}
                textAnchor="middle"
                className="finance-axis"
              >
                {label}
              </text>
            </g>
          ))}
          <line
            x1="0"
            x2={labels.length * slot}
            y1={height}
            y2={height}
            className="finance-base"
          />
        </svg>
        {hover !== null && (
          <div
            className="finance-tooltip"
            style={{ left: `${((hover + 0.5) / labels.length) * 100}%` }}
          >
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} /> {t(s.name)}{" "}
                <b>{format(s.values[hover])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
export function BarList({
  items,
  format,
  color = TEAL,
  empty = "No data for this period.",
}: {
  items: { name: string; value: number; note?: string }[];
  format: (n: number) => string;
  color?: string;
  empty?: string;
}) {
  const { t } = useApp();
  const peak = Math.max(1, ...items.map((x) => x.value));
  if (!items.length) return <p className="form-hint padded-hint">{t(empty)}</p>;
  return (
    <ul className="finance-breakdown">
      {items.map((x) => (
        <li key={x.name}>
          <div>
            <span>{x.name}</span>
            <strong>
              {format(x.value)} {x.note && <small>{x.note}</small>}
            </strong>
          </div>
          <div className="finance-track">
            <i
              style={{
                width: `${Math.max(2, (x.value / peak) * 100)}%`,
                background: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Dashboard: analytics for the director and the administrator
// ---------------------------------------------------------------------------
type Range = "week" | "month" | "quarter" | "year" | "custom";
function rangeOf(kind: Range, today: string, custom: [string, string]) {
  if (kind === "custom") return { from: custom[0], to: custom[1] };
  if (kind === "week") return { from: addDays(today, -6), to: today };
  if (kind === "month") return { from: today.slice(0, 7) + "-01", to: today };
  if (kind === "quarter") {
    const m = Number(today.slice(5, 7));
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return {
      from: `${today.slice(0, 4)}-${String(q).padStart(2, "0")}-01`,
      to: today,
    };
  }
  return { from: today.slice(0, 4) + "-01-01", to: today };
}

// The administrator sees a short dashboard: the figures she acts on.
const shortTiles = [
  "Money in",
  "New clients",
  "Requests that paid",
  "Still to collect",
  "No-shows",
  "Requests waiting > 24 h",
];
export function Dashboard() {
  const { data, t, money, perform, toast, person, program, cohort, user } =
    useApp();
  const zone = data.settings.timezone;
  const short = data.permissions.role === "administrator";
  const currency = data.settings.currency;
  const fmt = (n: number) => money(n, currency);
  const count = (n: number) => String(Math.round(n));
  const [range, setRange] = useState<Range>("month");
  const [custom, setCustom] = useState<[string, string]>([
    data.today.slice(0, 7) + "-01",
    data.today,
  ]);
  const { from, to } = rangeOf(range, data.today, custom);
  const day = (iso: string) => localDate(new Date(iso), zone);
  const inRange = (d: string) => d >= from && d <= to;

  const m = useMemo(() => {
    const charge = (id: number) => data.charges.find((c) => c.id === id);
    const categoryOf = (ch: Row | undefined) => {
      const enr = ch && data.enrollments.find((e) => e.id === ch.enrollment_id);
      const p = enr ? program(cohort(enr.cohort_id).program_id) : null;
      return p
        ? { cat: t(p.category), prog: p.name }
        : { cat: t("Other"), prog: ch?.label || t("Other") };
    };
    const pays = data.payments.filter((p) => p.currency === currency);
    const moneyIn = (d1: string, d2: string) =>
      pays
        .filter((p) => day(p.created_at) >= d1 && day(p.created_at) <= d2)
        .reduce((s, p) => s + p.amount, 0) -
      data.refunds
        .filter((r) => day(r.created_at) >= d1 && day(r.created_at) <= d2)
        .reduce((s, r) => s + r.amount, 0) +
      (data.expenses || [])
        .filter(
          (x) =>
            x.direction === "in" &&
            x.currency === currency &&
            x.spent_on >= d1 &&
            x.spent_on <= d2,
        )
        .reduce((s, x) => s + x.amount, 0);
    const moneyOut = (d1: string, d2: string) =>
      (data.expenses || [])
        .filter(
          (x) =>
            x.direction !== "in" &&
            x.currency === currency &&
            x.spent_on >= d1 &&
            x.spent_on <= d2,
        )
        .reduce((s, x) => s + x.amount, 0);
    const revenue = moneyIn(from, to);
    const spent = moneyOut(from, to);
    const periodPays = pays.filter((p) => inRange(day(p.created_at)));
    const newClients = data.contacts.filter((c) => inRange(day(c.created_at)));
    const opps = data.opportunities.filter((o) => inRange(day(o.created_at)));
    const appts = data.appointments.filter((a) => inRange(day(a.starts_at)));
    const finished = appts.filter((a) =>
      ["Done", "No-show", "Cancelled"].includes(a.status),
    );
    const noShow = finished.filter((a) => a.status === "No-show").length;
    const cancelled = finished.filter((a) => a.status === "Cancelled").length;
    const outstanding = data.charges
      .filter((c) => c.currency === currency)
      .reduce((s, c) => s + Math.max(0, c.balance), 0);
    // Forecast for this month: received so far + balances due by month end.
    const monthStart = data.today.slice(0, 7) + "-01";
    const monthEnd = addDays(shiftMonth(data.today.slice(0, 7), 1) + "-01", -1);
    const receivedMonth = moneyIn(monthStart, data.today);
    const dueMonth = data.charges
      .filter(
        (c) =>
          c.currency === currency && c.balance > 0 && c.due_date <= monthEnd,
      )
      .reduce((s, c) => s + c.balance, 0);
    // By direction and top programmes.
    const byCat = new Map<string, number>();
    const byProg = new Map<string, number>();
    for (const p of periodPays) {
      const k = categoryOf(charge(p.charge_id));
      byCat.set(k.cat, (byCat.get(k.cat) || 0) + p.amount);
      byProg.set(k.prog, (byProg.get(k.prog) || 0) + p.amount);
    }
    // Funnel on requests created in the period.
    const reached = (stage: string) => {
      const order = data.stages;
      return opps.filter(
        (o) =>
          o.stage !== "Lost" && order.indexOf(o.stage) >= order.indexOf(stage),
      ).length;
    };
    const paidContacts = new Set(
      pays.map((p) => charge(p.charge_id)?.contact_id).filter(Boolean),
    );
    const funnel = [
      { name: t("Requests"), value: opps.length },
      { name: t("Contacted"), value: reached("Contacted") },
      { name: t("Consultation booked"), value: reached("Consultation booked") },
      {
        name: t("Paid"),
        value: opps.filter((o) => paidContacts.has(o.contact_id)).length,
      },
    ];
    // Sources and advertising (idea 8).
    const sources = new Map<
      string,
      { leads: number; clients: Set<number>; revenue: number }
    >();
    for (const o of opps) {
      const s = o.source || t("Unknown");
      const x = sources.get(s) || {
        leads: 0,
        clients: new Set<number>(),
        revenue: 0,
      };
      x.leads++;
      if (paidContacts.has(o.contact_id)) x.clients.add(o.contact_id);
      sources.set(s, x);
    }
    for (const p of periodPays) {
      const cid = charge(p.charge_id)?.contact_id;
      const o = data.opportunities
        .filter((x) => x.contact_id === cid)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!o) continue;
      const s = o.source || t("Unknown");
      const x = sources.get(s) || {
        leads: 0,
        clients: new Set<number>(),
        revenue: 0,
      };
      x.revenue += p.amount;
      if (cid) x.clients.add(cid);
      sources.set(s, x);
    }
    const adSpend = (source: string) =>
      (data.expenses || [])
        .filter(
          (x) =>
            x.direction !== "in" &&
            /advert|publicit|pub|إشهار/i.test(x.category) &&
            x.spent_on >= from &&
            x.spent_on <= to &&
            `${x.party} ${x.label}`
              .toLowerCase()
              .includes(source.toLowerCase()),
        )
        .reduce((s, x) => s + x.amount, 0);
    const ads = Array.from(sources, ([name, x]) => ({
      id: name.length + x.leads * 1000 + x.revenue,
      name,
      leads: x.leads,
      clients: x.clients.size,
      revenue: x.revenue,
      spend: adSpend(name),
    })).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
    // Staff load and group fill.
    const load = data.users
      .filter(
        (u) =>
          u.active !== 0 && ["instructor", "admin", "manager"].includes(u.role),
      )
      .map((u) => {
        const consults = appts.filter(
          (a) => a.staff_id === u.id && a.status === "Done",
        ).length;
        const hours =
          data.sessions
            .filter(
              (s) =>
                cohort(s.cohort_id).instructor_id === u.id &&
                s.status !== "Cancelled" &&
                inRange(day(s.starts_at)),
            )
            .reduce(
              (sum, s) =>
                sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)),
              0,
            ) / 3600000;
        return {
          name: u.name,
          value: consults + hours,
          note: `${consults} ${t("consultations")} · ${Math.round(hours)} h`,
        };
      })
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    const fill = data.cohorts
      .filter((c) => c.status === "Active")
      .map((c) => {
        const n = data.enrollments.filter(
          (e) => e.cohort_id === c.id && e.status === "Active",
        ).length;
        return {
          name: c.name,
          value: Math.round((n / Math.max(1, c.capacity)) * 100),
          note: `${n}/${c.capacity}`,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    // Trends: 12 months of money, 12 weeks of new clients, 6 months attendance.
    const months = Array.from({ length: 12 }, (_, i) =>
      shiftMonth(data.today.slice(0, 7), i - 11),
    );
    const monthEndOf = (mm: string) => addDays(shiftMonth(mm, 1) + "-01", -1);
    const weeks = Array.from({ length: 12 }, (_, i) =>
      addDays(data.today, -7 * (11 - i) - 6),
    );
    const att = Array.from({ length: 6 }, (_, i) =>
      shiftMonth(data.today.slice(0, 7), i - 5),
    );
    // Previous period of the same length, for the arrows on each number.
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const pFrom = addDays(from, -span),
      pTo = addDays(from, -1);
    const inPrev = (d: string) => d >= pFrom && d <= pTo;
    const prevFinished = data.appointments.filter(
      (a) =>
        inPrev(day(a.starts_at)) &&
        ["Done", "No-show", "Cancelled"].includes(a.status),
    );
    const prevPays = pays.filter((p) => inPrev(day(p.created_at)));
    const prevRevenue = moneyIn(pFrom, pTo);
    const prevSpent = moneyOut(pFrom, pTo);
    const prev: Record<string, number> = {
      revenue: prevRevenue,
      spent: prevSpent,
      result: prevRevenue - prevSpent,
      newClients: data.contacts.filter((c) => inPrev(day(c.created_at))).length,
      noShowRate: prevFinished.length
        ? prevFinished.filter((a) => a.status === "No-show").length /
          prevFinished.length
        : 0,
      cancelRate: prevFinished.length
        ? prevFinished.filter((a) => a.status === "Cancelled").length /
          prevFinished.length
        : 0,
      avgTicket: prevPays.length
        ? prevPays.reduce((s2, p) => s2 + p.amount, 0) / prevPays.length
        : 0,
    };
    // Busiest times over the last 90 days (Saturday first, 8:00–20:00).
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const order = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const heat = order.map(() => Array(13).fill(0) as number[]);
    const since = addDays(data.today, -89);
    const mark = (iso: string) => {
      const p = parts.formatToParts(new Date(iso));
      const wd = order.indexOf(p.find((x) => x.type === "weekday")!.value);
      const h = Number(p.find((x) => x.type === "hour")!.value);
      if (wd >= 0 && h >= 8 && h <= 20) heat[wd][h - 8]++;
    };
    for (const a of data.appointments)
      if (
        a.status !== "Cancelled" &&
        day(a.starts_at) >= since &&
        day(a.starts_at) <= data.today
      )
        mark(a.starts_at);
    for (const x of data.sessions)
      if (
        x.status !== "Cancelled" &&
        day(x.starts_at) >= since &&
        day(x.starts_at) <= data.today
      )
        mark(x.starts_at);
    // Loyalty: clients who paid on two different days or more.
    const paidDays = new Map<number, Set<string>>();
    for (const p of pays) {
      if (!p.contact_id) continue;
      const set = paidDays.get(p.contact_id) || new Set<string>();
      set.add(day(p.created_at));
      paidDays.set(p.contact_id, set);
    }
    const repeatRate = paidDays.size
      ? Array.from(paidDays.values()).filter((x) => x.size >= 2).length /
        paidDays.size
      : 0;
    const byClient = new Map<number, number>();
    for (const p of periodPays)
      if (p.contact_id)
        byClient.set(
          p.contact_id,
          (byClient.get(p.contact_id) || 0) + p.amount,
        );
    const topClients = Array.from(byClient, ([id, value]) => ({
      name: person(id).name,
      value,
    }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const answered = (data.feedback || []).filter(
      (f) => f.answered_at && f.rating && inRange(day(f.answered_at)),
    );
    const limit = new Date(Date.now() - 24 * 3600000).toISOString();
    return {
      rated: answered.length,
      avgRating: answered.length
        ? answered.reduce((s2, f) => s2 + f.rating, 0) / answered.length
        : 0,
      unanswered: data.opportunities.filter(
        (o) => o.stage === "New inquiry" && o.created_at < limit,
      ).length,
      prev,
      heat,
      repeatRate,
      payers: paidDays.size,
      topClients,
      revenue,
      spent,
      result: revenue - spent,
      newClients: newClients.length,
      conversion: opps.length ? funnel[3].value / opps.length : 0,
      noShowRate: finished.length ? noShow / finished.length : 0,
      cancelRate: finished.length ? cancelled / finished.length : 0,
      avgTicket: periodPays.length
        ? periodPays.reduce((s, p) => s + p.amount, 0) / periodPays.length
        : 0,
      outstanding,
      forecast: receivedMonth + dueMonth,
      receivedMonth,
      byCat: Array.from(byCat, ([name, value]) => ({ name, value })).sort(
        (a, b) => b.value - a.value,
      ),
      topProg: Array.from(byProg, ([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      funnel,
      ads,
      load,
      fill,
      months,
      moneyMonths: {
        in: months.map((mm) => moneyIn(mm + "-01", monthEndOf(mm))),
        out: months.map((mm) => moneyOut(mm + "-01", monthEndOf(mm))),
      },
      weeks,
      clientsWeeks: weeks.map(
        (w) =>
          data.contacts.filter(
            (c) => day(c.created_at) >= w && day(c.created_at) <= addDays(w, 6),
          ).length,
      ),
      att,
      attendance: att.map((mm) => {
        const rows = data.attendance.filter((a) =>
          day(a.starts_at).startsWith(mm),
        );
        return rows.length
          ? Math.round(
              (rows.filter((a) => a.status === "Present" || a.status === "Late")
                .length /
                rows.length) *
                100,
            )
          : 0;
      }),
      monthStart,
    };
  }, [data, from, to, currency, zone]);

  const goal = (data.goals || []).find(
    (g) => g.month === data.today.slice(0, 7),
  );
  const monthNewClients = data.contacts.filter(
    (c) => day(c.created_at) >= m.monthStart,
  ).length;
  const [editGoal, setEditGoal] = useState(false);
  const [goalForm, setGoalForm] = useState({ revenue: "", clients: "" });
  useEffect(() => {
    setGoalForm({
      revenue: goal ? String(goal.revenue / 100) : "",
      clients: goal ? String(goal.new_clients) : "",
    });
  }, [goal?.revenue, goal?.new_clients]);
  const monthLabel = (mm: string) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(mm + "-15T12:00:00Z"));
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  // [label, value, class, metric key, is a higher value good?]
  const tiles: [string, string, string?, string?, boolean?][] = [
    ["Money in", fmt(m.revenue), "", "revenue", true],
    ["Money out", fmt(m.spent), "", "spent", false],
    [
      m.result < 0 ? "Loss" : "Profit",
      fmt(m.result),
      m.result < 0 ? "is-loss" : "is-gain",
      "result",
      true,
    ],
    ["New clients", count(m.newClients), "", "newClients", true],
    ["Requests that paid", pct(m.conversion)],
    ["No-shows", pct(m.noShowRate), "", "noShowRate", false],
    ["Cancellations", pct(m.cancelRate), "", "cancelRate", false],
    [
      "Average payment",
      fmt(Math.round(m.avgTicket / 100) * 100),
      "",
      "avgTicket",
      true,
    ],
    ["Still to collect", fmt(m.outstanding)],
    ["Forecast for this month", fmt(m.forecast)],
    ["Loyal clients", pct(m.repeatRate)],
    ["Satisfaction", m.rated ? `${m.avgRating.toFixed(1)} / 5 ★` : "—", ""],
    [
      "Requests waiting > 24 h",
      count(m.unanswered),
      m.unanswered ? "is-loss" : "",
    ],
  ];
  const delta = (key?: string, good?: boolean) => {
    if (!key) return null;
    const now = (m as any)[key] as number;
    const before = m.prev[key];
    if (!before) return null;
    const rate = key.endsWith("Rate");
    const change = rate
      ? Math.round((now - before) * 100)
      : before
        ? Math.round(((now - before) / Math.abs(before)) * 100)
        : null;
    if (change === null || change === 0)
      return <small className="kpi-delta">= {t("same as before")}</small>;
    const up = change > 0;
    return (
      <small className={`kpi-delta ${up === good ? "is-good" : "is-bad"}`}>
        {up ? "▲" : "▼"} {Math.abs(change)}
        {rate ? " pts" : " %"} {t("vs previous period")}
      </small>
    );
  };
  function exportCsv() {
    const lines = [
      [t("Indicator"), t("Value")],
      [t("Period"), `${from} → ${to}`],
      ...tiles.map(([k, v]) => [t(k), v]),
      [],
      [
        t("Source"),
        t("Requests"),
        t("Paying clients"),
        t("Revenue"),
        t("Advertising spent"),
      ],
      ...m.ads.map((a) => [
        a.name,
        a.leads,
        a.clients,
        a.revenue / 100,
        a.spend / 100,
      ]),
    ];
    const csv = lines
      .map((l) =>
        l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = `tableau-de-bord-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="dashboard">
      <PageHead
        title="Dashboard"
        subtitle="Money, clients, requests and the team, in charts."
      >
        <Button icon={<Download size={15} />} onClick={exportCsv}>
          {t("Export (Excel)")}
        </Button>
        <Button icon={<Printer size={15} />} onClick={() => window.print()}>
          {t("Print / PDF")}
        </Button>
      </PageHead>
      <div className="finance-toolbar">
        <div className="segmented" role="group" aria-label={t("Period")}>
          {(
            [
              ["week", "7 days"],
              ["month", "This month"],
              ["quarter", "This quarter"],
              ["year", "This year"],
              ["custom", "Custom"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={range === k ? "active" : ""}
              onClick={() => setRange(k)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <>
            <input
              type="date"
              className="date-input"
              value={custom[0]}
              onChange={(e) => setCustom([e.target.value, custom[1]])}
              aria-label={t("From")}
            />
            <input
              type="date"
              className="date-input"
              value={custom[1]}
              onChange={(e) => setCustom([custom[0], e.target.value])}
              aria-label={t("To")}
            />
          </>
        )}
      </div>
      <div className="finance-kpis dashboard-kpis">
        {tiles
          .filter(([k]) => !short || shortTiles.includes(k))
          .map(([k, v, cls, key, good]) => (
            <div key={k} className={`finance-kpi ${cls || ""}`}>
              <span>{t(k)}</span>
              <strong>{v}</strong>
              {delta(key, good)}
            </div>
          ))}
      </div>
      {!short && (
        <>
          <Panel
            title="Goals for this month"
            action={
              data.permissions.expenses && (
                <Button
                  icon={<Target size={15} />}
                  onClick={() => setEditGoal(!editGoal)}
                >
                  {t(goal ? "Change the goals" : "Set the goals")}
                </Button>
              )
            }
          >
            {editGoal && (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await perform("/goals", {
                      month: data.today.slice(0, 7),
                      revenue: Math.round(Number(goalForm.revenue || 0) * 100),
                      new_clients: Number(goalForm.clients || 0),
                    });
                    setEditGoal(false);
                    toast(t("Changes saved"));
                  } catch (err: any) {
                    toast(err.message);
                  }
                }}
              >
                <label className="field">
                  <span>
                    {t("Money in goal")} ({currency})
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={goalForm.revenue}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, revenue: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("New clients goal")}</span>
                  <input
                    type="number"
                    min="0"
                    value={goalForm.clients}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, clients: e.target.value })
                    }
                  />
                </label>
                <Button variant="primary" type="submit">
                  {t("Save")}
                </Button>
              </form>
            )}
            {goal ? (
              <div className="goal-list">
                <Goal
                  label={t("Money in")}
                  value={m.receivedMonth}
                  target={goal.revenue}
                  format={fmt}
                />
                <Goal
                  label={t("New clients")}
                  value={monthNewClients}
                  target={goal.new_clients}
                  format={count}
                />
              </div>
            ) : (
              !editGoal && (
                <p className="form-hint padded-hint">
                  {t(
                    "No goal yet. Example: 300 000 DA and 20 new clients this month.",
                  )}
                </p>
              )
            )}
          </Panel>
          <Panel
            title="Money in and out, month by month"
            subtitle="The last 12 months. Hover a month to see the figures."
          >
            <ColumnChart
              labels={m.months.map(monthLabel)}
              series={[
                { name: "Money in", color: TEAL, values: m.moneyMonths.in },
                { name: "Money out", color: AMBER, values: m.moneyMonths.out },
              ]}
              format={fmt}
            />
          </Panel>
        </>
      )}
      <div className="finance-split">
        {!short && (
          <>
            <Panel title="Money by activity">
              <BarList items={m.byCat} format={fmt} />
            </Panel>
            <Panel title="Top 5 programmes">
              <BarList items={m.topProg} format={fmt} />
            </Panel>
            <Panel title="New clients per week" subtitle="The last 12 weeks.">
              <ColumnChart
                labels={m.weeks.map(
                  (w) => w.slice(8, 10) + "/" + w.slice(5, 7),
                )}
                series={[
                  { name: "New clients", color: TEAL, values: m.clientsWeeks },
                ]}
                format={count}
                height={130}
              />
            </Panel>
          </>
        )}
        <Panel
          title="From request to payment"
          subtitle="Requests received in the period and how far they went."
        >
          <BarList
            items={m.funnel.map((f, i) => ({
              ...f,
              note:
                i && m.funnel[0].value
                  ? pct(f.value / m.funnel[0].value)
                  : undefined,
            }))}
            format={count}
          />
        </Panel>
        <Panel
          title="Team workload"
          subtitle="Consultations done and class hours in the period."
        >
          <BarList
            items={m.load}
            format={(n) => String(Math.round(n * 10) / 10)}
            empty="No consultations or classes in this period."
          />
        </Panel>
        <Panel title="Group fill rate">
          <BarList
            items={m.fill}
            format={(n) => `${n} %`}
            empty="No active group."
          />
        </Panel>
        <Panel
          title="Attendance rate"
          subtitle="Present or late, out of all attendance marks."
        >
          <ColumnChart
            labels={m.att.map(monthLabel)}
            series={[
              { name: "Attendance rate", color: TEAL, values: m.attendance },
            ]}
            format={(n) => `${n} %`}
            height={130}
          />
        </Panel>
      </div>
      {!short && (
        <>
          <Panel
            title="Busiest times"
            subtitle="Appointments and classes over the last 90 days, by day and hour. Darker = busier."
          >
            <Heatmap rows={m.heat} />
          </Panel>
          <Panel
            title="Loyal clients"
            subtitle="Share of paying clients who paid on two different days or more, and the 10 clients who paid the most in the period."
          >
            <div className="goal loyal-goal">
              <div>
                <span>
                  {Math.round(m.repeatRate * m.payers)} / {m.payers}{" "}
                  {t("paying clients came back")}
                </span>
                <strong>{pct(m.repeatRate)}</strong>
              </div>
              <div className="finance-track goal-track">
                <i
                  style={{
                    width: `${Math.max(2, m.repeatRate * 100)}%`,
                    background: TEAL,
                  }}
                />
              </div>
            </div>
            <h3 className="panel-subtitle">{t("Top 10 clients")}</h3>
            <div className="two-columns">
              <BarList items={m.topClients.slice(0, 5)} format={fmt} />
              <BarList items={m.topClients.slice(5)} format={fmt} empty=" " />
            </div>
          </Panel>
          <Panel
            title="Where clients come from and what advertising brings"
            subtitle="Advertising spent = expenses in the “Advertising” category whose “Paid to” or description names the source (e.g. Instagram)."
          >
            <DataTable
              rows={m.ads}
              columns={[
                { key: "name", label: "Source" },
                { key: "leads", label: "Requests" },
                { key: "clients", label: "Paying clients" },
                {
                  key: "revenue",
                  label: "Revenue",
                  render: (r) => fmt(r.revenue),
                },
                {
                  key: "spend",
                  label: "Advertising spent",
                  render: (r) => (r.spend ? fmt(r.spend) : "—"),
                },
                {
                  key: "cost",
                  label: "Cost per client",
                  render: (r) =>
                    r.spend && r.clients ? fmt(r.spend / r.clients) : "—",
                },
              ]}
            />
          </Panel>
          <WeeklyReportPanel />
        </>
      )}
    </div>
  );
}
function Goal({
  label,
  value,
  target,
  format,
}: {
  label: string;
  value: number;
  target: number;
  format: (n: number) => string;
}) {
  const { t } = useApp();
  const share = target ? Math.min(1, value / target) : 0;
  return (
    <div className="goal">
      <div>
        <span>{label}</span>
        <strong>
          {format(value)} / {format(target)}{" "}
          <small>{Math.round(share * 100)} %</small>
        </strong>
      </div>
      <div className="finance-track goal-track">
        <i
          style={{ width: `${Math.max(2, share * 100)}%`, background: TEAL }}
        />
      </div>
      {share >= 1 && <small className="teal-text">{t("Goal reached")}</small>}
    </div>
  );
}

/** Summary of the last 7 days (idea 6): copy, WhatsApp or e-mail. */
export function WeeklyReportPanel() {
  const { data, t, toast, perform } = useApp();
  const [report, setReport] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!data.permissions.finance) return;
    fetch("/api/reports/weekly", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport)
      .catch(() => setReport(null));
  }, [data.payments.length, data.contacts.length, data.appointments.length]);
  if (!data.permissions.finance) return null;
  return (
    <Panel
      title="Report of the week"
      subtitle="Sent automatically by e-mail every Sunday to the director and the administrators (when e-mail is connected)."
    >
      {report ? (
        <>
          <pre className="weekly-report">{report.text}</pre>
          <div className="row-actions wrap">
            <Button
              icon={<Copy size={15} />}
              onClick={() =>
                navigator.clipboard
                  .writeText(report.text)
                  .then(() => toast(t("Copied")))
                  .catch(() => toast(t("Select the text and copy it.")))
              }
            >
              {t("Copy")}
            </Button>
            <a
              className="button"
              href={`https://wa.me/?text=${encodeURIComponent(report.text)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={15} /> {t("Send on WhatsApp")}
            </a>
            <Button
              icon={<Send size={15} />}
              disabled={!data.mailConfigured}
              title={
                data.mailConfigured ? "" : t("E-mail is not connected yet.")
              }
              onClick={async () => {
                try {
                  const r = await perform("/reports/weekly/send", {});
                  toast(`${r.sent || 0} ${t("e-mails sent")}`);
                } catch (e: any) {
                  toast(e.message);
                }
              }}
            >
              {t("Send by e-mail now")}
            </Button>
          </div>
        </>
      ) : (
        <p className="form-hint padded-hint">{t("Loading…")}</p>
      )}
    </Panel>
  );
}

/** Who signed in, when and from which device (idea 11). */
export function LoginJournal() {
  const { data, t, date, time } = useApp();
  const device = (ua: string) =>
    /iPhone|iPad/.test(ua)
      ? "iPhone / iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : ua
                ? t("Other")
                : "—";
  const browser = (ua: string) =>
    /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return (
    <Panel
      title="Sign-ins"
      subtitle="Who signed in, when and from which device. Failed attempts are shown in red."
    >
      <DataTable
        rows={data.loginEvents || []}
        columns={[
          {
            key: "created_at",
            label: "Date",
            render: (r) => `${date(r.created_at)} ${time(r.created_at)}`,
          },
          { key: "name", label: "Person", render: (r) => r.name || r.email },
          {
            key: "success",
            label: "Result",
            render: (r) =>
              r.success ? (
                <Badge tone="teal">{t("Signed in")}</Badge>
              ) : (
                <Badge tone="rose">{t("Wrong password")}</Badge>
              ),
          },
          {
            key: "device",
            label: "Device",
            render: (r) =>
              [device(r.device), browser(r.device)].filter(Boolean).join(" · "),
          },
        ]}
      />
    </Panel>
  );
}

/** Sign out automatically after N minutes without activity (idea 12). */
export function useIdleLogout(minutes: number, onLogout: () => void) {
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const touch = () => (last = Date.now());
    const events = [
      "mousemove",
      "keydown",
      "pointerdown",
      "scroll",
      "touchstart",
    ];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last > minutes * 60000) onLogout();
    }, 30000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [minutes]);
}

/** Days × hours grid; one hue, light to dark (sequential). */
function Heatmap({ rows }: { rows: number[][] }) {
  const { t } = useApp();
  const days = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  const names: Record<string, string> = {
    Sat: "Saturday",
    Sun: "Sunday",
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
  };
  const peak = Math.max(1, ...rows.flat());
  const steps = [
    "#eef7f4",
    "#c6e7de",
    "#8fcfbf",
    "#4fae99",
    "#1f8a76",
    "#0b5e50",
  ];
  const color = (n: number) =>
    n === 0 ? steps[0] : steps[Math.min(5, 1 + Math.floor((n / peak) * 4.999))];
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th />
            {rows[0].map((_, h) => (
              <th key={h}>{h + 8}h</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, d) => (
            <tr key={d}>
              <th>{t(names[days[d]]).slice(0, 3)}</th>
              {r.map((n, h) => (
                <td
                  key={h}
                  style={{
                    background: color(n),
                    color: n / peak > 0.55 ? "#fff" : "#17302b",
                  }}
                  title={`${t(names[days[d]])} ${h + 8}:00 — ${n}`}
                >
                  {n || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heatmap-legend" aria-hidden="true">
        <span>{t("Quiet")}</span>
        {steps.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
        <span>{t("Busy")}</span>
      </div>
    </div>
  );
}

/** End of the day: what was received today, by method, ready to print. */
export function CashClosing() {
  const { data, t, money, person, time, user } = useApp();
  const zone = data.settings.timezone;
  const today = data.today;
  const pays = data.payments.filter(
    (p) => localDate(new Date(p.created_at), zone) === today,
  );
  const refunds = data.refunds.filter(
    (r) => localDate(new Date(r.created_at), zone) === today,
  );
  if (!data.permissions.editFinance) return null;
  const currency = data.settings.currency;
  const byMethod = new Map<string, number>();
  for (const p of pays)
    byMethod.set(p.method, (byMethod.get(p.method) || 0) + p.amount);
  const total =
    pays.reduce((s, p) => s + p.amount, 0) -
    refunds.reduce((s, r) => s + r.amount, 0);
  function print() {
    const esc = (v: string) =>
      String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    printDocument(
      `${t("Cash closing")} ${today}`,
      `<div class="brand"><h1>${esc(data.settings.academy)}</h1><div class="muted">${esc(t("Cash closing"))}<br><b>${esc(today)}</b></div></div>
      <table>${Array.from(byMethod)
        .map(
          ([m, v]) =>
            `<tr><td>${esc(t(m))}</td><td>${esc(money(v, currency))}</td></tr>`,
        )
        .join("")}
      ${
        refunds.length
          ? `<tr><td>${esc(t("Refunds"))}</td><td>− ${esc(
              money(
                refunds.reduce((s, r) => s + r.amount, 0),
                currency,
              ),
            )}</td></tr>`
          : ""
      }
      <tr><td><b>${esc(t("Total of the day"))}</b></td><td class="total">${esc(money(total, currency))}</td></tr></table>
      <table>${pays
        .map(
          (p) =>
            `<tr><td>${esc(time(p.created_at))} · ${esc(person(p.contact_id).name || "")}</td><td>${esc(money(p.amount, p.currency))} · ${esc(t(p.method))}</td></tr>`,
        )
        .join("")}</table>
      <div class="sign"><div>${esc(t("Counted by"))} : ${esc(user(data.user.id).name || data.user.name)}</div><div>${esc(t("Checked by"))}</div></div>`,
    );
  }
  return (
    <Panel
      title="Cash desk of the day"
      subtitle="Everything received today, by payment method. Print it when you close."
      action={
        <Button icon={<Printer size={15} />} onClick={print}>
          {t("Close the cash desk")}
        </Button>
      }
    >
      <div className="cash-totals">
        <div>
          <small>{t("Total of the day")}</small>
          <strong>{money(total, currency)}</strong>
        </div>
        {Array.from(byMethod).map(([m, v]) => (
          <div key={m}>
            <small>{t(m)}</small>
            <strong>{money(v, currency)}</strong>
          </div>
        ))}
        <div>
          <small>{t("Payments")}</small>
          <strong>{pays.length}</strong>
        </div>
      </div>
    </Panel>
  );
}
