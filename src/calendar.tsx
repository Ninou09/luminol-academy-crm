import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  List,
  MapPin,
  Plus,
  User,
  UserX,
} from "lucide-react";
import { useApp } from "./context";
import { Badge, Button, Empty, PageHead } from "./ui";
import type { Row } from "./types";

/** Distinct, readable colours for each staff member's bookings. */
const staffPalette = [
  "#7c4dbb",
  "#167e70",
  "#c0612b",
  "#2f6fc0",
  "#b8366b",
  "#5f7d1f",
  "#8a6a12",
  "#3b5a6e",
];
const HOUR = 56; // pixels per hour in day / week views
const DAY_MS = 86400000;

type Item = {
  key: string;
  type: "session" | "appointment";
  start: string;
  end: string;
  day: string;
  startMin: number;
  endMin: number;
  title: string;
  sub: string;
  who: string;
  place: string;
  color: string;
  status: string;
  record: Row;
  lane?: number;
  lanes?: number;
};

function useZone(zone: string) {
  return useMemo(() => {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return (iso: string) => {
      const p = Object.fromEntries(
        f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
      );
      return {
        day: `${p.year}-${p.month}-${p.day}`,
        minutes: Number(p.hour) * 60 + Number(p.minute),
      };
    };
  }, [zone]);
}
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Put overlapping bookings side by side instead of on top of each other. */
function layout(items: Item[]) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  let group: Item[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes: number[] = [];
    for (const it of group) {
      let lane = lanes.findIndex((end) => end <= it.startMin);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = it.endMin;
      it.lane = lane;
    }
    group.forEach((it) => (it.lanes = lanes.length));
    group = [];
  };
  for (const it of sorted) {
    if (it.startMin >= groupEnd) (flush(), (groupEnd = -1));
    group.push(it);
    groupEnd = Math.max(groupEnd, it.endMin);
  }
  flush();
  return sorted;
}

export function Calendar() {
  const {
    data,
    t,
    open,
    cohort,
    program,
    date,
    time,
    person,
    user,
    perform,
    toast,
  } = useApp();
  const zone = data.settings.timezone;
  const zoned = useZone(zone);
  const canBook = ["admin", "admissions", "academic", "instructor"].includes(
    data.user.role,
  );
  const phone = window.matchMedia("(max-width:760px)").matches;
  const [view, setView] = useState(phone ? "List" : "Week"),
    [anchor, setAnchor] = useState(data.today),
    [show, setShow] = useState(""),
    [staff, setStaff] = useState(
      data.user.role === "instructor" ? String(data.user.id) : "",
    );
  const people = data.users.filter((u) => u.active !== 0);
  const colorOf = (id?: number | null) =>
    id
      ? staffPalette[
          people.findIndex((u) => u.id === id) % staffPalette.length
        ] || "#6b7a72"
      : "#6b7a72";

  // Every booking and class as one list of calendar items.
  const items: Item[] = useMemo(() => {
    const list: Item[] = [];
    for (const a of data.appointments || []) {
      if (a.status === "Cancelled") continue;
      if (show && show !== "appointments") continue;
      if (staff && String(a.staff_id) !== staff) continue;
      const s = zoned(a.starts_at),
        e = zoned(a.ends_at);
      list.push({
        key: "a" + a.id,
        type: "appointment",
        start: a.starts_at,
        end: a.ends_at,
        day: s.day,
        startMin: s.minutes,
        endMin: e.day === s.day ? Math.max(e.minutes, s.minutes + 15) : 24 * 60,
        title: a.contact_id ? person(a.contact_id).name : a.title,
        sub: a.contact_id ? `${t(a.kind)} · ${a.title}` : t(a.kind),
        who: a.staff_id ? user(a.staff_id).name : "",
        place: a.location,
        color: colorOf(a.staff_id),
        status: a.status,
        record: a,
      });
    }
    for (const s of data.sessions) {
      if (s.status !== "Scheduled") continue;
      if (show === "appointments" || (show && String(s.cohort_id) !== show))
        continue;
      const h = cohort(s.cohort_id);
      if (staff && String(h.instructor_id) !== staff) continue;
      const a = zoned(s.starts_at),
        b = zoned(s.ends_at);
      const colors: Record<string, string> = {
        teal: "#167e70",
        blue: "#2f6fc0",
        purple: "#7c4dbb",
        amber: "#b7791f",
      };
      list.push({
        key: "s" + s.id,
        type: "session",
        start: s.starts_at,
        end: s.ends_at,
        day: a.day,
        startMin: a.minutes,
        endMin: b.day === a.day ? Math.max(b.minutes, a.minutes + 15) : 24 * 60,
        title: h.name,
        sub: t(s.title),
        who: h.instructor_id ? user(h.instructor_id).name : "",
        place: s.room,
        color: colors[program(h.program_id).color] || "#167e70",
        status: "Scheduled",
        record: s,
      });
    }
    return list;
  }, [data, show, staff, zone]);

  // Visible days for the chosen view.
  const base = new Date(anchor + "T12:00:00Z");
  let first = anchor,
    count = 1;
  if (view === "Week") {
    first = addDays(anchor, -((base.getUTCDay() + 6) % 7));
    count = 7;
  } else if (view === "Month") {
    const m1 = anchor.slice(0, 8) + "01";
    first = addDays(m1, -((new Date(m1 + "T12:00:00Z").getUTCDay() + 6) % 7));
    count = 42;
  } else if (view === "List") count = 30;
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  const byDay = (day: string) => items.filter((it) => it.day === day);

  const move = (n: number) => {
    if (view === "Month") {
      const d = new Date(anchor + "T12:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + n, 1);
      setAnchor(d.toISOString().slice(0, 10));
    } else
      setAnchor(
        addDays(anchor, n * (view === "Day" ? 1 : view === "Week" ? 7 : 30)),
      );
  };
  const openItem = (it: Item) =>
    open(
      it.type === "appointment"
        ? { type: "appointment", record: it.record }
        : { type: "sessionDetail", record: it.record },
    );
  async function setStatus(it: Item, status: string) {
    try {
      await perform(`/appointments/${it.record.id}`, { status }, "PATCH");
      toast(t(status === "Done" ? "Marked as done" : "Marked as no-show"));
    } catch (e: any) {
      toast(e.message);
    }
  }

  // Hours shown in the time grid: 8:00–20:00, widened for early/late bookings.
  const visible = days.flatMap(byDay);
  const fromHour = Math.min(
    8,
    ...visible.map((i) => Math.floor(i.startMin / 60)),
  );
  const toHour = Math.max(20, ...visible.map((i) => Math.ceil(i.endMin / 60)));
  const hours = Array.from(
    { length: toHour - fromHour },
    (_, i) => fromHour + i,
  );
  const [nowMin, setNowMin] = useState(
    () => zoned(new Date().toISOString()).minutes,
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowMin(zoned(new Date().toISOString()).minutes),
      60000,
    );
    return () => clearInterval(timer);
  }, [zoned]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current)
      scroller.current.scrollTop = Math.max(
        0,
        (Math.max(fromHour, 8) - fromHour) * HOUR - 8,
      );
  }, [view]);

  const title =
    view === "Month"
      ? date(anchor, { month: "long", year: "numeric" })
      : view === "Day"
        ? date(anchor, { weekday: "long", day: "numeric", month: "long" })
        : `${date(days[0], { day: "numeric", month: "short" })} – ${date(days[days.length - 1], { day: "numeric", month: "short", year: "numeric" })}`;

  const todayCount = items.filter(
    (i) => i.day === data.today && i.type === "appointment",
  ).length;

  return (
    <>
      <PageHead
        title="Calendar"
        subtitle="Who is booked, when and where: consultations, meetings and classes."
      >
        {data.permissions.editAcademic && (
          <Button
            icon={<Plus size={17} />}
            disabled={!data.cohorts.length}
            title={!data.cohorts.length ? t("Create a group first") : undefined}
            onClick={() => open({ type: "session" })}
          >
            {t("Group class")}
          </Button>
        )}
        {canBook && (
          <Button
            variant="primary"
            icon={<Plus size={17} />}
            onClick={() =>
              open({ type: "appointment", extra: { day: anchor } })
            }
          >
            {t("Add to calendar")}
          </Button>
        )}
      </PageHead>
      <div className="panel calendar-panel v2">
        <div className="calendar-toolbar">
          <div className="calendar-navigation">
            <Button onClick={() => setAnchor(data.today)}>{t("Today")}</Button>
            <button
              className="icon-button"
              aria-label={t("Previous")}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button"
              aria-label={t("Next")}
              onClick={() => move(1)}
            >
              <ChevronRight size={20} />
            </button>
            <h2>{title}</h2>
          </div>
          <div className="heading-actions calendar-filters">
            <select
              aria-label={t("Whose calendar")}
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
            >
              <option value="">{t("Everyone")}</option>
              {people
                .filter((u) => u.role !== "finance")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={t("Show")}
              value={show}
              onChange={(e) => setShow(e.target.value)}
            >
              <option value="">{t("Everything")}</option>
              <option value="appointments">
                {t("Consultations & meetings")}
              </option>
              {data.cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="segmented">
              {["Day", "Week", "Month", "List"].map((v) => (
                <button
                  className={view === v ? "active" : ""}
                  key={v}
                  onClick={() => setView(v)}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="staff-legend">
          <span className="muted">
            <CalendarDays size={14} /> {t("Today")}: {todayCount}{" "}
            {t("appointments")}
          </span>
          {people
            .filter((u) =>
              (data.appointments || []).some((a) => a.staff_id === u.id),
            )
            .map((u) => (
              <button
                key={u.id}
                className={`staff-chip ${staff === String(u.id) ? "active" : ""}`}
                style={{ "--chip": colorOf(u.id) } as React.CSSProperties}
                onClick={() =>
                  setStaff(staff === String(u.id) ? "" : String(u.id))
                }
              >
                <i />
                {u.name}
              </button>
            ))}
        </div>

        {(view === "Week" || view === "Day") && (
          <div className="time-grid-scroll" ref={scroller}>
            <div
              className={`time-grid ${view.toLowerCase()}`}
              style={{ "--days": days.length } as React.CSSProperties}
            >
              <div className="tg-corner" />
              {days.map((day) => (
                <button
                  key={day}
                  className={`tg-head ${day === data.today ? "is-today" : ""}`}
                  onClick={() => {
                    setAnchor(day);
                    setView("Day");
                  }}
                >
                  <span>{date(day, { weekday: "short" })}</span>
                  <strong>{date(day, { day: "numeric" })}</strong>
                  {byDay(day).length > 0 && (
                    <small>
                      {byDay(day).length} {t("booked")}
                    </small>
                  )}
                </button>
              ))}
              <div className="tg-hours" style={{ height: hours.length * HOUR }}>
                {hours.map((h) => (
                  <span key={h} style={{ top: (h - fromHour) * HOUR }}>
                    {pad(h)}:00
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  className={`tg-col ${day === data.today ? "is-today" : ""}`}
                  style={{ height: hours.length * HOUR }}
                  onClick={(e) => {
                    if (!canBook || e.target !== e.currentTarget) return;
                    const y = e.nativeEvent.offsetY;
                    const min = fromHour * 60 + Math.floor((y / HOUR) * 2) * 30;
                    open({
                      type: "appointment",
                      extra: { day, time: hhmm(min) },
                    });
                  }}
                  title={canBook ? t("Click an empty time to book") : undefined}
                >
                  {hours.map((h) => (
                    <i
                      key={h}
                      className="tg-line"
                      style={{ top: (h - fromHour) * HOUR }}
                    />
                  ))}
                  {day === data.today &&
                    nowMin >= fromHour * 60 &&
                    nowMin <= toHour * 60 && (
                      <i
                        className="tg-now"
                        style={{ top: ((nowMin - fromHour * 60) / 60) * HOUR }}
                      />
                    )}
                  {layout(byDay(day)).map((it) => {
                    const top = ((it.startMin - fromHour * 60) / 60) * HOUR;
                    const height = Math.max(
                      ((it.endMin - it.startMin) / 60) * HOUR - 2,
                      24,
                    );
                    const width = 100 / (it.lanes || 1);
                    // Side-by-side bookings in a week column are narrow: show less.
                    const narrow = view === "Week" && (it.lanes || 1) > 1;
                    return (
                      <button
                        key={it.key}
                        title={`${hhmm(it.startMin)}–${hhmm(it.endMin % (24 * 60))} · ${it.title} · ${it.sub}${it.who ? " · " + it.who : ""}`}
                        className={`tg-event ${it.type} status-${it.status.toLowerCase()} ${narrow ? "narrow" : ""}`}
                        style={
                          {
                            top,
                            height,
                            insetInlineStart: `calc(${width * (it.lane || 0)}% + 2px)`,
                            width: `calc(${width}% - 4px)`,
                            "--ev": it.color,
                          } as React.CSSProperties
                        }
                        onClick={() => openItem(it)}
                      >
                        <small>
                          {hhmm(it.startMin)}
                          {!narrow && `–${hhmm(it.endMin % (24 * 60))}`}
                          {it.status === "Done" && <Check size={12} />}
                          {it.status === "No-show" && <UserX size={12} />}
                        </small>
                        <strong>{it.title}</strong>
                        {!narrow && height > 44 && <span>{it.sub}</span>}
                        {!narrow && height > 64 && (it.who || it.place) && (
                          <span className="tg-meta">
                            {[it.who, it.place].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "Month" && (
          <div className="month-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
              <div key={d} className="month-weekday">
                {date(days[i], { weekday: "short" })}
              </div>
            ))}
            {days.map((day) => {
              const list = byDay(day).sort((a, b) => a.startMin - b.startMin);
              return (
                <div
                  key={day}
                  className={`month-cell ${day === data.today ? "is-today" : ""} ${day.slice(0, 7) !== anchor.slice(0, 7) ? "outside-month" : ""}`}
                >
                  <button
                    className="month-day"
                    onClick={() => {
                      setAnchor(day);
                      setView("Day");
                    }}
                  >
                    {date(day, { day: "numeric" })}
                  </button>
                  {list.slice(0, 3).map((it) => (
                    <button
                      key={it.key}
                      className={`month-chip status-${it.status.toLowerCase()}`}
                      style={{ "--ev": it.color } as React.CSSProperties}
                      onClick={() => openItem(it)}
                    >
                      <b>{hhmm(it.startMin)}</b> {it.title}
                    </button>
                  ))}
                  {list.length > 3 && (
                    <button
                      className="month-more"
                      onClick={() => {
                        setAnchor(day);
                        setView("Day");
                      }}
                    >
                      +{list.length - 3} {t("more")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {view === "List" && (
          <div className="agenda">
            {days.filter((d) => byDay(d).length).length === 0 && (
              <Empty
                title="Nothing booked"
                text="No appointments or classes in the next 30 days."
              />
            )}
            {days
              .filter((d) => byDay(d).length)
              .map((day) => (
                <section
                  key={day}
                  className={day === data.today ? "is-today" : ""}
                >
                  <h3>
                    {date(day, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    {day === data.today && (
                      <Badge tone="teal">{t("Today")}</Badge>
                    )}
                  </h3>
                  {byDay(day)
                    .sort((a, b) => a.startMin - b.startMin)
                    .map((it) => (
                      <div
                        key={it.key}
                        className={`agenda-row status-${it.status.toLowerCase()}`}
                        style={{ "--ev": it.color } as React.CSSProperties}
                      >
                        <button
                          className="agenda-main"
                          onClick={() => openItem(it)}
                        >
                          <span className="agenda-time">
                            {hhmm(it.startMin)}
                            <small>{hhmm(it.endMin % (24 * 60))}</small>
                          </span>
                          <span className="agenda-text">
                            <strong>{it.title}</strong>
                            <small>{it.sub}</small>
                            <small className="agenda-meta">
                              {it.who && (
                                <span>
                                  <User size={12} /> {it.who}
                                </span>
                              )}
                              {it.place && (
                                <span>
                                  <MapPin size={12} /> {it.place}
                                </span>
                              )}
                            </small>
                          </span>
                        </button>
                        {it.type === "appointment" &&
                        it.status === "Scheduled" &&
                        canBook ? (
                          <span className="agenda-actions">
                            <Button
                              variant="small"
                              icon={<Check size={14} />}
                              onClick={() => setStatus(it, "Done")}
                            >
                              {t("Done")}
                            </Button>
                            <Button
                              variant="small"
                              icon={<UserX size={14} />}
                              onClick={() => setStatus(it, "No-show")}
                            >
                              {t("No-show")}
                            </Button>
                          </span>
                        ) : (
                          it.type === "appointment" && (
                            <Badge
                              tone={it.status === "Done" ? "teal" : "amber"}
                            >
                              {t(it.status)}
                            </Badge>
                          )
                        )}
                      </div>
                    ))}
                </section>
              ))}
          </div>
        )}

        <div className="panel-bottom">
          <span className="muted">
            <Globe size={13} /> {zone}
          </span>
          <span className="muted">
            <Clock size={13} /> {t("Click an empty time to book")} ·{" "}
            <List size={13} /> {t("List shows the next 30 days")}
          </span>
        </div>
      </div>
    </>
  );
}
