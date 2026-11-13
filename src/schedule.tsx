import { useState } from "react";
import {
  Bell,
  CalendarCheck,
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "./context";
import { api, type Row } from "./types";
import { Badge, Button, DataTable, Dialog, Empty, Panel } from "./ui";
import { useTemplateValues } from "./tools";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const toMin = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type DayPlan = { on: boolean; a: [string, string]; b: [string, string] | null };

/** Weekly working hours, title shown to clients, and time off for one person. */
export function HoursDialog({
  person,
  onClose,
}: {
  person: Row;
  onClose: () => void;
}) {
  const { data, t, refresh, toast, date } = useApp();
  const rows = (data.staffHours || []).filter((r) => r.user_id === person.id);
  const [plan, setPlan] = useState<DayPlan[]>(() =>
    weekdays.map((_, i) => {
      const r = rows.filter((x) => x.weekday === i);
      return r.length
        ? {
            on: true,
            a: [toTime(r[0].start_min), toTime(r[0].end_min)],
            b: r[1] ? [toTime(r[1].start_min), toTime(r[1].end_min)] : null,
          }
        : { on: false, a: ["09:00", "17:00"], b: null };
    }),
  );
  const [title, setTitle] = useState(person.public_title || "");
  const [off, setOff] = useState({
    start_date: data.today,
    end_date: data.today,
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (i: number, change: Partial<DayPlan>) =>
    setPlan(plan.map((p, j) => (j === i ? { ...p, ...change } : p)));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const ranges = plan.flatMap((p, weekday) =>
        !p.on
          ? []
          : [p.a, ...(p.b ? [p.b] : [])].map(([s, e]) => ({
              weekday,
              start_min: toMin(s),
              end_min: toMin(e),
            })),
      );
      await api(`/users/${person.id}/hours`, { ranges, public_title: title });
      await refresh();
      toast(t("Changes saved"));
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function addOff() {
    setError("");
    try {
      const r = await api(`/users/${person.id}/time-off`, off);
      await refresh();
      toast(
        r.clash
          ? `${t("Time off added")} · ${r.clash} ${t("appointments to move")}`
          : t("Time off added"),
      );
      setOff({ ...off, reason: "" });
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function removeOff(id: number) {
    try {
      await api(`/time-off/${id}`, {}, "DELETE");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const leave = (data.timeOff || []).filter((x) => x.user_id === person.id);
  return (
    <Dialog
      title={`${t("Working hours")} · ${person.name}`}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        <p className="form-hint">
          {t(
            "Used for online booking and to warn when someone is booked outside their hours. Leave all days off if this person has no fixed hours.",
          )}
        </p>
        <div className="hours-grid">
          {plan.map((p, i) => (
            <div key={i} className={`hours-row ${p.on ? "" : "off"}`}>
              <label className="hours-day">
                <input
                  type="checkbox"
                  checked={p.on}
                  onChange={(e) => update(i, { on: e.target.checked })}
                />
                <strong>{t(weekdays[i])}</strong>
              </label>
              {p.on ? (
                <div className="hours-ranges">
                  <span>
                    <input
                      type="time"
                      value={p.a[0]}
                      onChange={(e) =>
                        update(i, { a: [e.target.value, p.a[1]] })
                      }
                    />
                    –
                    <input
                      type="time"
                      value={p.a[1]}
                      onChange={(e) =>
                        update(i, { a: [p.a[0], e.target.value] })
                      }
                    />
                  </span>
                  {p.b ? (
                    <span>
                      <input
                        type="time"
                        value={p.b[0]}
                        onChange={(e) =>
                          update(i, { b: [e.target.value, p.b![1]] })
                        }
                      />
                      –
                      <input
                        type="time"
                        value={p.b[1]}
                        onChange={(e) =>
                          update(i, { b: [p.b![0], e.target.value] })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={t("Delete")}
                        onClick={() => update(i, { b: null })}
                      >
                        <X size={15} />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() =>
                        update(i, {
                          a: [p.a[0], "12:00"],
                          b: ["13:00", p.a[1]],
                        })
                      }
                    >
                      + {t("Add a break")}
                    </button>
                  )}
                </div>
              ) : (
                <span className="muted">{t("Day off")}</span>
              )}
              {i === 0 && p.on && (
                <button
                  className="text-button copy-days"
                  onClick={() =>
                    setPlan(plan.map((x, j) => (j > 0 && j < 5 ? { ...p } : x)))
                  }
                >
                  {t("Copy to Tue–Fri")}
                </button>
              )}
            </div>
          ))}
        </div>
        <label className="hours-title">
          <span>{t("Title shown to clients")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Example: Clinical psychologist")}
            maxLength={80}
          />
        </label>
        <h3 className="import-title">{t("Time off")}</h3>
        {leave.map((x) => (
          <div key={x.id} className="payment-line">
            <span>
              <strong>
                {date(x.start_date)}
                {x.end_date !== x.start_date ? ` – ${date(x.end_date)}` : ""}
              </strong>{" "}
              {x.reason}
            </span>
            <button
              className="icon-button danger"
              aria-label={t("Delete")}
              onClick={() => removeOff(x.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div className="time-off-add">
          <input
            type="date"
            value={off.start_date}
            onChange={(e) =>
              setOff({
                ...off,
                start_date: e.target.value,
                end_date:
                  e.target.value > off.end_date ? e.target.value : off.end_date,
              })
            }
            aria-label={t("First day")}
          />
          <input
            type="date"
            value={off.end_date}
            onChange={(e) => setOff({ ...off, end_date: e.target.value })}
            aria-label={t("Last day")}
          />
          <input
            value={off.reason}
            onChange={(e) => setOff({ ...off, reason: e.target.value })}
            placeholder={t("Reason (holiday, sick…)")}
            maxLength={120}
          />
          <Button icon={<Plus size={15} />} onClick={addOff}>
            {t("Add time off")}
          </Button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>
          {t("Save working hours")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Settings → Online booking. */
export function BookingSettingsPanel() {
  const { data, t, open, perform, toast, user } = useApp();
  const s = data.settings;
  const [intro, setIntro] = useState(s.booking_intro || "");
  const [notice, setNotice] = useState(String(s.booking_notice_hours ?? 2));
  const link = `${window.location.origin}/book`;
  async function save(enabled = !!s.booking_enabled) {
    try {
      await perform(
        "/booking/settings",
        {
          booking_enabled: enabled,
          booking_intro: intro,
          booking_notice_hours: Number(notice) || 0,
        },
        "PATCH",
      );
      toast(t("Changes saved"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  const noHours = (data.bookingServices || [])
    .flatMap((x) => x.staff_ids)
    .filter((id: number, i: number, a: number[]) => a.indexOf(id) === i)
    .filter(
      (id: number) => !(data.staffHours || []).some((h) => h.user_id === id),
    );
  return (
    <div className="settings-grid">
      <Panel
        title="Online booking"
        subtitle="Clients choose a service, a person and a free time themselves. You confirm each request."
        action={
          <Badge tone={s.booking_enabled ? "teal" : "neutral"}>
            {t(s.booking_enabled ? "Open" : "Closed")}
          </Badge>
        }
      >
        <div className="booking-admin">
          <div className="booking-link">
            <code>{link}</code>
            <Button
              variant="small"
              icon={<Copy size={14} />}
              onClick={() =>
                navigator.clipboard
                  ?.writeText(link)
                  .then(() => toast(t("Link copied")))
              }
            >
              {t("Copy link")}
            </Button>
            <a
              className="button small"
              href="/book"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> {t("Open page")}
            </a>
          </div>
          <p className="form-hint">
            {t(
              "Put this link in your Instagram bio, WhatsApp status or website.",
            )}
          </p>
          <label className="template-edit">
            <span>{t("Welcome text on the page")}</span>
            <textarea
              rows={3}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              maxLength={1000}
              placeholder={t(
                "Example: Consultations in French and Arabic, at the academy or online.",
              )}
            />
          </label>
          <label className="template-edit">
            <span>{t("Minimum notice (hours)")}</span>
            <input
              type="number"
              min={0}
              max={168}
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
            />
          </label>
          <div className="row-actions wrap">
            <Button onClick={() => save()}>{t("Save")}</Button>
            <Button
              variant={s.booking_enabled ? "danger" : "primary"}
              onClick={() => save(!s.booking_enabled)}
            >
              {t(
                s.booking_enabled
                  ? "Close online booking"
                  : "Open online booking",
              )}
            </Button>
          </div>
        </div>
      </Panel>
      <Panel
        title="Services clients can book"
        subtitle="Each service has a duration and the people who provide it."
        action={
          <Button
            variant="small primary"
            icon={<Plus size={14} />}
            onClick={() => open({ type: "bookingService" })}
          >
            {t("New service")}
          </Button>
        }
      >
        {noHours.length > 0 && (
          <div className="info-box danger booking-warning">
            {t("No working hours yet for:")}{" "}
            {noHours.map((id: number) => user(id).name).join(", ")}.{" "}
            {t(
              "Clients cannot book them until hours are set (Settings → Team).",
            )}
          </div>
        )}
        <DataTable
          rows={data.bookingServices || []}
          onRow={(r) => open({ type: "bookingService", record: r })}
          columns={[
            {
              key: "name",
              label: "Name",
              render: (r) => <strong>{r.name}</strong>,
            },
            {
              key: "duration_min",
              label: "Duration",
              render: (r) => `${r.duration_min} min`,
            },
            {
              key: "staff",
              label: "With",
              render: (r) =>
                r.staff_ids.map((id: number) => user(id).name).join(", "),
            },
            {
              key: "active",
              label: "Status",
              render: (r) => (
                <Badge tone={r.active ? "teal" : "neutral"}>
                  {t(r.active ? "Open" : "Closed")}
                </Badge>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

/** Online requests waiting for a yes/no from the team. */
export function PendingBookings() {
  const { data, t, perform, toast, person, user, date, time, open } = useApp();
  const pending = (data.appointments || [])
    .filter((a) => a.status === "Pending")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!pending.length) return null;
  async function decide(a: Row, status: string) {
    try {
      await perform(`/appointments/${a.id}`, { status }, "PATCH");
      toast(
        t(status === "Scheduled" ? "Appointment confirmed" : "Request refused"),
      );
      if (status === "Scheduled" && a.contact_id)
        open({
          type: "whatsapp",
          contact: person(a.contact_id),
          record: { ...a, status },
        });
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <Panel
      title="Online bookings to confirm"
      subtitle="Clients booked these times on the public page."
      className="pending-panel"
      action={<Badge tone="amber">{pending.length}</Badge>}
    >
      <div className="reminder-list">
        {pending.map((a) => (
          <div key={a.id} className="reminder-row">
            <CalendarCheck size={20} />
            <div>
              <strong>
                {a.contact_id ? person(a.contact_id).name : a.title}
              </strong>
              <small>
                {a.title} ·{" "}
                {date(a.starts_at, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}{" "}
                · {time(a.starts_at)}
                {a.staff_id ? ` · ${user(a.staff_id).name}` : ""}
                {a.contact_id ? ` · ${person(a.contact_id).phone}` : ""}
              </small>
              {a.notes && <small className="pre-line">“{a.notes}”</small>}
            </div>
            <div className="row-actions">
              <Button
                variant="small primary"
                icon={<Check size={14} />}
                onClick={() => decide(a, "Scheduled")}
              >
                {t("Confirm")}
              </Button>
              <Button
                variant="small"
                icon={<X size={14} />}
                onClick={() => decide(a, "Cancelled")}
              >
                {t("Refuse")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Who to remind today: tomorrow's appointments and payments due soon. */
export function RemindersPanel() {
  const { data, t, person, time, date, money, refresh, toast } = useApp();
  const fill = useTemplateValues();
  const [showAll, setShowAll] = useState(false);
  if (
    !["admin", "admissions", "academic", "instructor", "finance"].includes(
      data.user.role,
    )
  )
    return null;
  const tomorrow = new Date(Date.parse(data.today + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  const localDay = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: data.settings.timezone,
    }).format(new Date(iso));
  const sent = (kind: string, id: number) =>
    (data.reminders || []).find((r) => r.kind === kind && r.ref_id === id);
  const tpl = (name: string) =>
    data.templates.find((x) => x.name === name)?.body || "";
  const items = [
    ...(data.appointments || [])
      .filter(
        (a) =>
          a.contact_id &&
          ["Scheduled", "Pending"].includes(a.status) &&
          (localDay(a.starts_at) === tomorrow ||
            (localDay(a.starts_at) === data.today &&
              a.starts_at > new Date().toISOString())),
      )
      .map((a) => ({
        key: "a" + a.id,
        kind: "appointment",
        id: a.id,
        contact: person(a.contact_id),
        what: `${a.title} · ${localDay(a.starts_at) === data.today ? t("Today") : t("Tomorrow")} ${time(a.starts_at)}`,
        text: fill(
          person(a.contact_id),
          a,
        )(
          tpl(
            a.meeting_url ? "Online consultation link" : "Appointment reminder",
          ),
        ),
      })),
    ...data.charges
      .filter((c) => {
        if (c.balance <= 0) return false;
        const days =
          (Date.parse(c.due_date) - Date.parse(data.today)) / 86400000;
        return days <= 3;
      })
      .map((c) => ({
        key: "c" + c.id,
        kind: "payment",
        id: c.id,
        contact: person(c.contact_id),
        what: `${c.label} · ${money(c.balance, c.currency)} · ${c.due_date < data.today ? t("Overdue") : date(c.due_date)}`,
        text: fill(person(c.contact_id))(tpl("Payment reminder")),
      })),
    // A place freed up in a full group: tell the first person waiting.
    ...data.cohorts.flatMap((h) => {
      const used = data.enrollments.filter(
        (e) => e.cohort_id === h.id && e.status === "Active",
      ).length;
      const first = data.waitlists
        .filter((w) => w.cohort_id === h.id)
        .sort((a, b) => a.id - b.id)[0];
      if (!first || used >= h.capacity) return [];
      return [
        {
          key: "w" + first.id,
          kind: "waitlist",
          id: first.id,
          contact: person(first.contact_id),
          what: `${t("Place available")} · ${h.name}`,
          text: fill(person(first.contact_id), undefined, { course: h.name })(
            tpl("Place available"),
          ),
        },
      ];
    }),
  ];
  const record = (kind: string, id: number) =>
    api("/reminders", { kind, ref_id: id })
      .then(refresh)
      .catch(() => undefined);
  return (
    <Panel
      title="Reminders to send"
      subtitle="Tomorrow's appointments and payments due within 3 days. One tap opens WhatsApp with the message ready."
      action={
        <span className="row-actions">
          {data.integrations?.whatsapp &&
            data.permissions.admin &&
            items.some((i) => !sent(i.kind, i.id)) && (
              <Button
                variant="small primary"
                onClick={async () => {
                  try {
                    const r = await api("/automations/whatsapp/run", {});
                    await refresh();
                    toast(
                      `${r.sent} ${t("sent")}${r.failed ? ` · ${r.failed} ${t("failed")}` : ""}`,
                    );
                  } catch (e: any) {
                    toast(t(e.message));
                  }
                }}
              >
                {t("Send all automatically")}
              </Button>
            )}
          <Badge
            tone={items.some((i) => !sent(i.kind, i.id)) ? "amber" : "neutral"}
          >
            {items.filter((i) => !sent(i.kind, i.id)).length}
          </Badge>
        </span>
      }
    >
      <div className="reminder-list">
        {!items.length && (
          <Empty
            title="Nothing to remind"
            text="No appointments tomorrow and no payment due soon."
          />
        )}
        {(showAll ? items : items.slice(0, 5)).map((i) => {
          const done = sent(i.kind, i.id);
          const digits = (i.contact.phone || "")
            .replace(/\D/g, "")
            .replace(/^0(?=[567])/, "213");
          return (
            <div key={i.key} className={`reminder-row ${done ? "sent" : ""}`}>
              {i.kind === "appointment" ? (
                <Bell size={19} />
              ) : (
                <MessageCircle size={19} />
              )}
              <div>
                <strong>{i.contact.name}</strong>
                <small>{i.what}</small>
              </div>
              {done ? (
                <Badge tone="teal">
                  <Check size={12} /> {t("Sent")} {time(done.sent_at)}
                </Badge>
              ) : digits ? (
                <a
                  className="button small primary"
                  href={`https://wa.me/${digits}?text=${encodeURIComponent(i.text)}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => record(i.kind, i.id)}
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
              ) : (
                <span className="muted">{t("No phone")}</span>
              )}
            </div>
          );
        })}
        {items.length > 5 && (
          <button className="text-button" onClick={() => setShowAll(!showAll)}>
            {showAll ? t("Show less") : `${t("Show all")} (${items.length})`}
          </button>
        )}
      </div>
    </Panel>
  );
}
