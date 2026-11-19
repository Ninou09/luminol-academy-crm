import { useMemo, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  GripVertical,
  FileSpreadsheet,
  Printer,
  Gift,
  Ticket,
  Repeat,
  QrCode,
} from "lucide-react";
import qrcode from "qrcode-generator";
import { useApp } from "./context";
import { localDate } from "./types";
type Row = Record<string, any>;
import { Badge, Button, Dialog, Empty, PageHead, Panel } from "./ui";
import { AiAsk, AiNextActions } from "./platform";
import { FeedbackMoodPanel, FirstSteps } from "./smart";

const TEAL = "#00897a";
const day = 86400000;
const monthKey = (iso: string) => iso.slice(0, 7);
function lastMonths(n: number, from = new Date()) {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}
function addMonths(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function useMonthName() {
  const { date } = useApp();
  return (key: string) =>
    date(`${key}-15`, { month: "short", year: "2-digit" });
}

/** Simple horizontal bar list, readable on a phone. */
export function Bars({
  rows,
  format,
}: {
  rows: [string, number][];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="bars">
      {rows.map(([label, v]) => (
        <div key={label} className="bar-row">
          <span className="bar-label" title={label}>
            {label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(v / max) * 100}%`, background: TEAL }}
            />
          </span>
          <span className="bar-value">{format ? format(v) : v}</span>
        </div>
      ))}
    </div>
  );
}

// 9. Personal dashboard made of widgets -------------------------------------------
type Widget = {
  key: string;
  title: string;
  finance?: boolean;
  desk?: boolean;
  render: () => React.ReactNode;
};
function useWidgets(): Widget[] {
  const { data, t, money, date, time, person, profile, go } = useApp();
  const today = data.today;
  const month = today.slice(0, 7);
  const paid = data.payments
    .filter((p) => monthKey(p.created_at) === month)
    .reduce((n, p) => n + p.amount, 0);
  const overdue = data.charges.filter(
    (c) => c.balance > 0 && c.due_date < today,
  );
  const todayAppts = data.appointments.filter(
    (a) =>
      localDate(new Date(a.starts_at), data.settings.timezone) === today &&
      a.status !== "Cancelled",
  );
  const myTasks = data.tasks.filter(
    (x) => x.status === "Open" && x.owner_id === data.user.id,
  );
  const stat = (
    value: React.ReactNode,
    label: string,
    onClick?: () => void,
  ) => (
    <button className="widget-stat" onClick={onClick} disabled={!onClick}>
      <strong>{value}</strong>
      <span>{t(label)}</span>
    </button>
  );
  const months = lastMonths(6);
  const mn = useMonthName();
  return [
    {
      key: "today",
      title: "Appointments today",
      render: () =>
        stat(todayAppts.length, "appointments today", () => go("Calendar")),
    },
    {
      key: "tasks",
      title: "My open tasks",
      render: () => stat(myTasks.length, "tasks to do", () => go("My tasks")),
    },
    {
      key: "unread",
      title: "Unread messages",
      render: () =>
        stat(data.inboxUnread || 0, "unread messages", () => go("Messages")),
    },
    {
      key: "requests",
      title: "New requests",
      desk: true,
      render: () =>
        stat(
          data.opportunities.filter((o) => o.stage === "New inquiry").length,
          "new requests",
          () => go("Admissions"),
        ),
    },
    {
      key: "newclients",
      title: "New clients this month",
      render: () =>
        stat(
          data.contacts.filter((c) => monthKey(c.created_at) === month).length,
          "new clients this month",
          () => go("Students"),
        ),
    },
    {
      key: "revenue",
      title: "Collected this month",
      finance: true,
      render: () =>
        stat(money(paid), "collected this month", () => go("Payments")),
    },
    {
      key: "overdue",
      title: "Late payments",
      finance: true,
      render: () =>
        stat(
          money(overdue.reduce((n, c) => n + c.balance, 0)),
          `${overdue.length} ${t("late payment(s)")}`,
          () => go("Payments"),
        ),
    },
    {
      key: "agenda",
      title: "Today's agenda",
      render: () =>
        todayAppts.length ? (
          <ul className="widget-list">
            {todayAppts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <button onClick={() => a.contact_id && profile(a.contact_id)}>
                  <b>{time(a.starts_at)}</b>{" "}
                  {a.contact_id ? person(a.contact_id).name : a.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-hint">{t("No appointment today.")}</p>
        ),
    },
    {
      key: "tasklist",
      title: "My tasks",
      render: () =>
        myTasks.length ? (
          <ul className="widget-list">
            {myTasks.slice(0, 6).map((x) => (
              <li key={x.id}>
                <button
                  onClick={() =>
                    x.contact_id ? profile(x.contact_id) : go("My tasks")
                  }
                >
                  <b>{date(x.due_at)}</b> {t(x.title)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-hint">{t("Nothing to do. Well done!")}</p>
        ),
    },
    {
      key: "revenuechart",
      title: "Revenue, last 6 months",
      finance: true,
      render: () => (
        <Bars
          rows={months.map((m) => [
            mn(m),
            data.payments
              .filter((p) => monthKey(p.created_at) === m)
              .reduce((n, p) => n + p.amount, 0),
          ])}
          format={(n) => money(n)}
        />
      ),
    },
    {
      key: "sources",
      title: "Requests by source",
      desk: true,
      render: () => {
        const by: Record<string, number> = {};
        for (const o of data.opportunities)
          by[o.source || "—"] = (by[o.source || "—"] || 0) + 1;
        return (
          <Bars
            rows={Object.entries(by)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)}
          />
        );
      },
    },
    {
      key: "debtors",
      title: "Who owes the most",
      finance: true,
      render: () => {
        const by: Record<number, number> = {};
        for (const c of overdue)
          by[c.contact_id] = (by[c.contact_id] || 0) + c.balance;
        const rows = Object.entries(by)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6);
        return rows.length ? (
          <ul className="widget-list">
            {rows.map(([id, v]) => (
              <li key={id}>
                <button onClick={() => profile(Number(id))}>
                  <b>{money(v)}</b> {person(Number(id)).name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-hint">{t("Nobody is late.")}</p>
        );
      },
    },
  ];
}
const defaultLayout = (role: string) =>
  role === "teacher"
    ? ["today", "agenda", "tasks", "tasklist"]
    : role === "secretary"
      ? ["today", "unread", "requests", "agenda", "tasklist"]
      : [
          "revenue",
          "newclients",
          "requests",
          "overdue",
          "revenuechart",
          "sources",
          "debtors",
        ];
export function CustomDashboard() {
  const { data, t, perform, toast } = useApp();
  const all = useWidgets().filter(
    (w) =>
      (!w.finance || data.permissions.finance) &&
      (!w.desk || data.permissions.admissions),
  );
  const saved = (data.dashboardLayout || []).filter((k) =>
    all.some((w) => w.key === k),
  );
  const [layout, setLayout] = useState<string[]>(
    saved.length
      ? saved
      : defaultLayout(data.permissions.role).filter((k) =>
          all.some((w) => w.key === k),
        ),
  );
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const save = (next: string[]) => {
    setLayout(next);
    perform("/me/dashboard", { layout: next }, "PUT").catch((e: any) =>
      toast(e.message),
    );
  };
  const move = (k: string, d: number) => {
    const i = layout.indexOf(k);
    const j = i + d;
    if (j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  return (
    <>
      <PageHead
        title="My dashboard"
        subtitle="Choose the numbers and lists you want to see first. Drag them to change the order."
      >
        <Button
          variant={editing ? "primary" : ""}
          onClick={() => setEditing(!editing)}
        >
          {t(editing ? "Done" : "Customise")}
        </Button>
      </PageHead>
      <FirstSteps />
      <AiNextActions />
      <div className="widget-grid">
        {layout.map((k) => {
          const w = all.find((x) => x.key === k)!;
          const wide = [
            "agenda",
            "tasklist",
            "revenuechart",
            "sources",
            "debtors",
          ].includes(k);
          return (
            <section
              key={k}
              className={`panel widget ${wide ? "wide" : ""} ${drag === k ? "dragging" : ""}`}
              draggable={editing}
              onDragStart={() => setDrag(k)}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => {
                if (!drag || drag === k) return;
                const next = layout.filter((x) => x !== drag);
                next.splice(next.indexOf(k), 0, drag);
                setDrag(null);
                save(next);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <div className="widget-head">
                {editing && <GripVertical size={16} className="grip" />}
                <h2>{t(w.title)}</h2>
                {editing && (
                  <span className="widget-tools">
                    <button
                      className="icon-button"
                      aria-label={t("Move up")}
                      onClick={() => move(k, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t("Move down")}
                      onClick={() => move(k, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t("Remove")}
                      onClick={() => save(layout.filter((x) => x !== k))}
                    >
                      <X size={15} />
                    </button>
                  </span>
                )}
              </div>
              <div className="widget-body">{w.render()}</div>
            </section>
          );
        })}
      </div>
      {editing && (
        <Panel title="Add a widget">
          <div className="chip-row padded">
            {all
              .filter((w) => !layout.includes(w.key))
              .map((w) => (
                <Button
                  key={w.key}
                  variant="small"
                  icon={<Plus size={14} />}
                  onClick={() => save([...layout, w.key])}
                >
                  {t(w.title)}
                </Button>
              ))}
          </div>
        </Panel>
      )}
    </>
  );
}

// 9. Report builder, retention, forecast, specialists -----------------------------
const metrics = [
  ["revenue", "Money collected", true],
  ["payments", "Number of payments", true],
  ["clients", "New clients", false],
  ["requests", "Requests", false],
  ["enrolled", "Requests turned into clients", false],
  ["appointments", "Appointments", false],
  ["done", "Appointments done", false],
  ["noshow", "Clients who did not come", false],
  ["expenses", "Expenses", true],
] as const;
const dims = [
  ["month", "Month"],
  ["week", "Week"],
  ["source", "Source"],
  ["service", "Service"],
  ["staff", "Specialist"],
  ["method", "Payment method"],
  ["status", "Status"],
  ["branch", "Branch"],
] as const;
export function ReportBuilder() {
  const { data, t, money, user, program } = useApp();
  const [metric, setMetric] = useState("revenue");
  const [dim, setDim] = useState("month");
  const [from, setFrom] = useState(
    new Date(Date.now() - 180 * day).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(data.today);
  const mn = useMonthName();
  const branchOf = (uid: number) => {
    const r = (data.users_rights || []).find((x) => x.id === uid);
    return (
      (data.branches || []).find((b) => b.id === r?.branch_id)?.name ||
      t("Main")
    );
  };
  const rows = useMemo(() => {
    const inRange = (iso: string) =>
      iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
    const week = (iso: string) => {
      const d = new Date(iso);
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * day);
      return monday.toISOString().slice(0, 10);
    };
    let items: {
      at: string;
      v: number;
      source?: string;
      service?: string;
      staff?: number;
      method?: string;
      status?: string;
    }[] = [];
    const contactSource = (id: number) =>
      data.opportunities.find((o) => o.contact_id === id)?.source || "—";
    if (metric === "revenue" || metric === "payments")
      items = data.payments.map((p) => {
        const ch = data.charges.find((c) => c.id === p.charge_id);
        return {
          at: p.created_at,
          v: metric === "revenue" ? p.amount : 1,
          source: contactSource(p.contact_id),
          service: ch?.label,
          staff: p.user_id,
          method: p.method,
          status: "Paid",
        };
      });
    if (metric === "clients")
      items = data.contacts.map((c) => ({
        at: c.created_at,
        v: 1,
        source: contactSource(c.id),
        service: "",
        status: c.consent ? "Consent" : "No consent",
      }));
    if (metric === "requests" || metric === "enrolled")
      items = data.opportunities
        .filter((o) => metric === "requests" || o.stage === "Enrolled")
        .map((o) => ({
          at: o.created_at,
          v: 1,
          source: o.source,
          service: o.interest || program(o.program_id).name,
          staff: o.owner_id,
          status: o.stage,
        }));
    if (["appointments", "done", "noshow"].includes(metric))
      items = data.appointments
        .filter(
          (a) =>
            metric === "appointments" ||
            a.status === (metric === "done" ? "Done" : "No-show"),
        )
        .map((a) => ({
          at: a.starts_at,
          v: 1,
          source: a.source,
          service: a.title,
          staff: a.staff_id,
          status: a.status,
        }));
    if (metric === "expenses")
      items = data.expenses.map((e) => ({
        at: e.spent_on,
        v: e.amount,
        service: e.category,
        staff: e.user_id,
        method: e.method,
        status: e.category,
      }));
    const by: Record<string, number> = {};
    for (const x of items) {
      if (!inRange(x.at)) continue;
      const k =
        dim === "month"
          ? monthKey(x.at)
          : dim === "week"
            ? week(x.at)
            : dim === "source"
              ? x.source || "—"
              : dim === "service"
                ? x.service || "—"
                : dim === "staff"
                  ? x.staff
                    ? user(x.staff).name
                    : "—"
                  : dim === "method"
                    ? x.method || "—"
                    : dim === "branch"
                      ? x.staff
                        ? branchOf(x.staff)
                        : "—"
                      : x.status || "—";
      by[k] = (by[k] || 0) + x.v;
    }
    const list = Object.entries(by);
    return dim === "month" || dim === "week"
      ? list.sort((a, b) => a[0].localeCompare(b[0]))
      : list.sort((a, b) => b[1] - a[1]);
  }, [data, metric, dim, from, to]);
  const isMoney = metric === "revenue" || metric === "expenses";
  const fmt = (n: number) => (isMoney ? money(n) : String(n));
  const label = (k: string) => (dim === "month" ? mn(k) : t(k));
  const total = rows.reduce((n, r) => n + r[1], 0);
  function exportExcel() {
    const head = [
      t(dims.find((d) => d[0] === dim)![1]),
      t(metrics.find((m) => m[0] === metric)![1]),
    ];
    const body = rows.map(([k, v]) => [
      label(k),
      isMoney ? (v / 100).toFixed(2) : String(v),
    ]);
    const csv =
      "﻿" +
      [head, ...body]
        .map((r) =>
          r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";"),
        )
        .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = `rapport-${metric}-${dim}.csv`;
    a.click();
  }
  return (
    <Panel
      title="Report builder"
      subtitle="What to count × how to split it × which period. Export to Excel or print as PDF."
    >
      <div className="form-grid padded-grid report-controls">
        <label className="field">
          <span>{t("What to count")}</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {metrics
              .filter((m) => !m[2] || data.permissions.finance)
              .map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>{t("Split by")}</span>
          <select value={dim} onChange={(e) => setDim(e.target.value)}>
            {dims
              .filter((d) => d[0] !== "branch" || (data.branches || []).length)
              .map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>{t("From")}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("To")}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty
          title="Nothing in this period"
          text="Choose a longer period or another measure."
        />
      ) : (
        <div className="padded printable">
          <Bars rows={rows.map(([k, v]) => [label(k), v])} format={fmt} />
          <p className="report-total">
            {t("Total")}: <b>{fmt(total)}</b>
          </p>
        </div>
      )}
      <div className="panel-foot">
        <Button
          icon={<FileSpreadsheet size={15} />}
          onClick={exportExcel}
          disabled={!rows.length || !data.permissions.canExport}
        >
          {t("Excel")}
        </Button>
        <Button
          icon={<Printer size={15} />}
          onClick={() => window.print()}
          disabled={!rows.length}
        >
          {t("PDF")}
        </Button>
      </div>
    </Panel>
  );
}
export function RetentionPanel() {
  const { data, t } = useApp();
  const mn = useMonthName();
  const months = lastMonths(9);
  const cohorts = useMemo(() => {
    const visits: Record<number, string[]> = {};
    const add = (id: number, iso: string) =>
      id && (visits[id] ||= []).push(monthKey(iso));
    for (const a of data.appointments)
      if (a.status === "Done") add(a.contact_id, a.starts_at);
    for (const a of data.attendance)
      if (a.status === "Present" || a.status === "Late")
        add(a.contact_id, a.starts_at);
    for (const p of data.payments) add(p.contact_id, p.created_at);
    const groups: Record<string, number[]> = {};
    for (const [id, list] of Object.entries(visits)) {
      const first = list.sort()[0];
      (groups[first] ||= []).push(Number(id));
    }
    return months.map((m) => {
      const ids = groups[m] || [];
      const back = (n: number) => {
        const target = addMonths(m, n);
        if (target > data.today.slice(0, 7)) return null;
        if (!ids.length) return 0;
        return Math.round(
          (ids.filter((id) => visits[id].some((x) => x >= target)).length /
            ids.length) *
            100,
        );
      };
      return { m, size: ids.length, r1: back(1), r3: back(3), r6: back(6) };
    });
  }, [data]);
  const cell = (v: number | null) => (
    <td
      className="heat"
      style={
        v == null
          ? {}
          : { background: `rgba(0,137,122,${0.08 + (v / 100) * 0.6})` }
      }
    >
      {v == null ? "—" : `${v}%`}
    </td>
  );
  return (
    <Panel
      title="Do clients come back?"
      subtitle="For the clients whose first visit or payment was in a month: how many came back after 1, 3 and 6 months."
    >
      <div className="table-scroll">
        <table className="cohort-table">
          <thead>
            <tr>
              <th>{t("First visit")}</th>
              <th>{t("Clients")}</th>
              <th>{t("After 1 month")}</th>
              <th>{t("After 3 months")}</th>
              <th>{t("After 6 months")}</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.m}>
                <td>{mn(c.m)}</td>
                <td>{c.size}</td>
                {cell(c.size ? c.r1 : null)}
                {cell(c.size ? c.r3 : null)}
                {cell(c.size ? c.r6 : null)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
export function ForecastPanel() {
  const { data, t, money } = useApp();
  const mn = useMonthName();
  const next = [1, 2, 3].map((n) => addMonths(data.today.slice(0, 7), n - 1));
  const rows = useMemo(() => {
    // Average money per appointment done in the last 90 days.
    const since = new Date(Date.now() - 90 * day).toISOString();
    const done = data.appointments.filter(
      (a) => a.status === "Done" && a.starts_at > since,
    ).length;
    const paid = data.payments
      .filter((p) => p.created_at > since)
      .reduce((n, p) => n + p.amount, 0);
    const perVisit = done ? paid / Math.max(done, 1) : 0;
    const subs = (data.subscriptions || [])
      .filter((s) => s.active)
      .reduce((n, s) => n + s.amount, 0);
    return next.map((m) => {
      const due = data.charges
        .filter((c) => c.balance > 0 && monthKey(c.due_date) === m)
        .reduce((n, c) => n + c.balance, 0);
      const appts = data.appointments.filter(
        (a) =>
          ["Scheduled", "Pending"].includes(a.status) &&
          monthKey(a.starts_at) === m,
      ).length;
      const booked = Math.round(appts * perVisit * 0.85);
      return { m, due, subs, booked, appts, total: due + subs + booked };
    });
  }, [data]);
  if (!data.permissions.finance) return null;
  return (
    <Panel
      title="Expected money, next 3 months"
      subtitle="Amounts already due + monthly subscriptions + booked appointments (at the average of the last 90 days, minus 15% of absences)."
    >
      <div className="table-scroll">
        <table className="cohort-table">
          <thead>
            <tr>
              <th>{t("Month")}</th>
              <th>{t("Already due")}</th>
              <th>{t("Subscriptions")}</th>
              <th>{t("Booked appointments")}</th>
              <th>{t("Total expected")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m}>
                <td>{mn(r.m)}</td>
                <td>{money(r.due)}</td>
                <td>{money(r.subs)}</td>
                <td>
                  {money(r.booked)} <small>({r.appts})</small>
                </td>
                <td>
                  <b>{money(r.total)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
export function SpecialistsPanel() {
  const { data, t, money } = useApp();
  const since = new Date(Date.now() - 90 * day).toISOString();
  const rows = data.users
    .filter(
      (u) => u.active && ["instructor", "academic", "admin"].includes(u.role),
    )
    .map((u) => {
      const appts = data.appointments.filter(
        (a) =>
          a.staff_id === u.id &&
          a.starts_at > since &&
          a.starts_at < new Date().toISOString(),
      );
      const done = appts.filter((a) => a.status === "Done");
      const noShow = appts.filter((a) => a.status === "No-show").length;
      const hours = done.reduce(
        (n, a) =>
          n + (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 3600000,
        0,
      );
      const weekly = data.staffHours
        .filter((h) => h.user_id === u.id)
        .reduce((n, h) => n + (h.end_min - h.start_min) / 60, 0);
      const load = weekly
        ? Math.min(100, Math.round((hours / (weekly * 13)) * 100))
        : null;
      const clients = new Set(done.map((a) => a.contact_id));
      // Money of the clients seen, shared by the number of their visits with each specialist.
      let revenue = 0;
      for (const cid of clients) {
        const theirs = data.appointments.filter(
          (a) =>
            a.contact_id === cid && a.status === "Done" && a.starts_at > since,
        );
        const share =
          theirs.filter((a) => a.staff_id === u.id).length /
          Math.max(theirs.length, 1);
        revenue +=
          data.payments
            .filter((p) => p.contact_id === cid && p.created_at > since)
            .reduce((n, p) => n + p.amount, 0) * share;
      }
      const ratings = data.feedback
        .filter((f) => f.staff_id === u.id && f.rating)
        .map((f) => f.rating);
      return {
        u,
        done: done.length,
        hours: Math.round(hours),
        load,
        noShow,
        clients: clients.size,
        revenue: Math.round(revenue),
        rating: ratings.length
          ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
          : "—",
      };
    })
    .filter((r) => r.done || r.noShow);
  return (
    <Panel
      title="Specialists compared"
      subtitle="Last 90 days: sessions done, hours, how full their week was, money of their clients and the average rating."
    >
      {rows.length === 0 ? (
        <Empty
          title="No session yet"
          text="Sessions marked as done will appear here."
        />
      ) : (
        <div className="table-scroll">
          <table className="cohort-table">
            <thead>
              <tr>
                <th>{t("Specialist")}</th>
                <th>{t("Sessions")}</th>
                <th>{t("Hours")}</th>
                <th>{t("Workload")}</th>
                <th>{t("Clients")}</th>
                <th>{t("No-shows")}</th>
                {data.permissions.finance && <th>{t("Revenue")}</th>}
                <th>{t("Rating")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.u.id}>
                  <td>
                    <strong>{r.u.name}</strong>
                  </td>
                  <td>{r.done}</td>
                  <td>{r.hours}</td>
                  <td>{r.load == null ? "—" : `${r.load}%`}</td>
                  <td>{r.clients}</td>
                  <td>{r.noShow}</td>
                  {data.permissions.finance && <td>{money(r.revenue)}</td>}
                  <td>{r.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
export function InsightsTab() {
  return (
    <div className="settings-stack">
      <AiAsk />
      <ReportBuilder />
      <ForecastPanel />
      <RetentionPanel />
      <SpecialistsPanel />
      <FeedbackMoodPanel />
    </div>
  );
}

// 10. Subscriptions, promo codes, gift cards, loyalty -----------------------------
function Qr({ text }: { text: string }) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return (
    <span
      className="qr"
      dangerouslySetInnerHTML={{
        __html: q.createSvgTag({ cellSize: 4, margin: 2 }),
      }}
    />
  );
}
export function LoyaltyPanel() {
  const { data, t, money, date, perform, toast, person } = useApp();
  const currency = data.settings.currency;
  const [sub, setSub] = useState({
    contact_id: "",
    label: "",
    amount: "",
    sessions: "4",
    day_of_month: "1",
  });
  const [promo, setPromo] = useState({
    code: "",
    percent: "",
    amount: "",
    max_uses: "",
    expires_on: "",
  });
  const [gift, setGift] = useState({
    amount: "",
    recipient: "",
    buyer_id: "",
    charge_buyer: true,
    expires_on: "",
  });
  const [apply, setApply] = useState<{
    kind: string;
    code: string;
    charge_id: string;
  } | null>(null);
  const [card, setCard] = useState<Row | null>(null);
  const [loyal, setLoyal] = useState({
    loyalty_every: String(data.settings.loyalty_every || ""),
    loyalty_percent: String(data.settings.loyalty_percent || ""),
    referral_amount: data.settings.referral_amount
      ? String(data.settings.referral_amount / 100)
      : "",
  });
  const open = data.charges.filter((c) => c.balance > 0);
  const referrers = Object.entries(
    data.contacts.reduce((acc: Record<number, number>, c) => {
      if (c.referred_by) acc[c.referred_by] = (acc[c.referred_by] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const submit =
    (fn: () => Promise<any>, done: () => void) =>
    async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await fn();
        done();
        toast(t("Changes saved"));
      } catch (err: any) {
        toast(err.message);
      }
    };
  return (
    <div className="finance-page">
      <Panel
        title="Monthly subscriptions"
        subtitle="For example “4 consultations per month”: the amount is added automatically every month on the chosen day, then reminded like any payment."
      >
        <form
          className="inline-form"
          onSubmit={submit(
            () =>
              perform("/subscriptions", {
                ...sub,
                contact_id: Number(sub.contact_id),
                amount: Math.round(Number(sub.amount) * 100),
                sessions: Number(sub.sessions || 0),
                day_of_month: Number(sub.day_of_month || 1),
              }),
            () => setSub({ ...sub, contact_id: "", label: "", amount: "" }),
          )}
        >
          <label className="field">
            <span>{t("Client")}</span>
            <select
              required
              value={sub.contact_id}
              onChange={(e) => setSub({ ...sub, contact_id: e.target.value })}
            >
              <option value="">—</option>
              {data.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>{t("Subscription")}</span>
            <input
              required
              value={sub.label}
              onChange={(e) => setSub({ ...sub, label: e.target.value })}
              placeholder={t("4 consultations per month")}
            />
          </label>
          <label className="field">
            <span>
              {t("Per month")} ({currency})
            </span>
            <input
              required
              type="number"
              min="1"
              value={sub.amount}
              onChange={(e) => setSub({ ...sub, amount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Billing day")}</span>
            <input
              type="number"
              min="1"
              max="28"
              value={sub.day_of_month}
              onChange={(e) => setSub({ ...sub, day_of_month: e.target.value })}
            />
          </label>
          <Button variant="primary" type="submit" icon={<Repeat size={15} />}>
            {t("Start")}
          </Button>
        </form>
        <div className="today-list">
          {(data.subscriptions || []).map((s) => (
            <div key={s.id} className={`today-row ${s.active ? "" : "muted"}`}>
              <div className="today-main">
                <strong>
                  {person(s.contact_id).name} — {s.label}
                </strong>
                <small>
                  {money(s.amount)} / {t("month")} · {t("day")} {s.day_of_month}
                  {s.last_billed
                    ? ` · ${t("last billed")} ${s.last_billed}`
                    : ""}
                </small>
              </div>
              <Button
                variant="small"
                onClick={() =>
                  perform(
                    `/subscriptions/${s.id}`,
                    { active: !s.active },
                    "PATCH",
                  )
                }
              >
                {t(s.active ? "Stop" : "Resume")}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Promo codes"
        subtitle="For a campaign: a percentage or an amount off. Apply the code to an amount due."
      >
        <form
          className="inline-form"
          onSubmit={submit(
            () =>
              perform("/promo-codes", {
                code: promo.code,
                percent: Number(promo.percent || 0),
                amount: Math.round(Number(promo.amount || 0) * 100),
                max_uses: Number(promo.max_uses || 0),
                expires_on: promo.expires_on || undefined,
              }),
            () =>
              setPromo({
                code: "",
                percent: "",
                amount: "",
                max_uses: "",
                expires_on: "",
              }),
          )}
        >
          <label className="field">
            <span>{t("Code")}</span>
            <input
              required
              value={promo.code}
              onChange={(e) =>
                setPromo({ ...promo, code: e.target.value.toUpperCase() })
              }
              placeholder="RENTREE10"
            />
          </label>
          <label className="field">
            <span>%</span>
            <input
              type="number"
              min="0"
              max="100"
              value={promo.percent}
              onChange={(e) => setPromo({ ...promo, percent: e.target.value })}
            />
          </label>
          <label className="field">
            <span>
              {t("or amount")} ({currency})
            </span>
            <input
              type="number"
              min="0"
              value={promo.amount}
              onChange={(e) => setPromo({ ...promo, amount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Max uses")}</span>
            <input
              type="number"
              min="0"
              value={promo.max_uses}
              onChange={(e) => setPromo({ ...promo, max_uses: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Valid until")}</span>
            <input
              type="date"
              value={promo.expires_on}
              onChange={(e) =>
                setPromo({ ...promo, expires_on: e.target.value })
              }
            />
          </label>
          <Button
            variant="primary"
            type="submit"
            icon={<Ticket size={15} />}
            disabled={!data.permissions.expenses}
          >
            {t("Create")}
          </Button>
        </form>
        <div className="today-list">
          {(data.promoCodes || []).map((p) => (
            <div key={p.id} className={`today-row ${p.active ? "" : "muted"}`}>
              <div className="today-main">
                <strong>{p.code}</strong>
                <small>
                  {p.percent ? `−${p.percent}%` : `−${money(p.amount)}`} ·{" "}
                  {p.used}
                  {p.max_uses ? `/${p.max_uses}` : ""} {t("used")}
                  {p.expires_on ? ` · ${t("until")} ${date(p.expires_on)}` : ""}
                </small>
              </div>
              <Button
                variant="small"
                onClick={() =>
                  setApply({ kind: "promo", code: p.code, charge_id: "" })
                }
                disabled={!p.active}
              >
                {t("Apply")}
              </Button>
              {data.permissions.expenses && (
                <Button
                  variant="small"
                  onClick={() =>
                    perform(
                      `/promo-codes/${p.id}`,
                      { active: !p.active },
                      "PATCH",
                    )
                  }
                >
                  {t(p.active ? "Stop" : "Resume")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Gift cards"
        subtitle="Sell a gift card with a QR code. The person who receives it pays with the code."
      >
        <form
          className="inline-form"
          onSubmit={submit(
            async () => {
              const r = await perform("/gift-cards", {
                amount: Math.round(Number(gift.amount) * 100),
                recipient: gift.recipient,
                buyer_id: gift.buyer_id ? Number(gift.buyer_id) : undefined,
                charge_buyer: gift.charge_buyer,
                expires_on: gift.expires_on || undefined,
              });
              setCard({
                code: r.code,
                amount: Math.round(Number(gift.amount) * 100),
                recipient: gift.recipient,
              });
            },
            () => setGift({ ...gift, amount: "", recipient: "", buyer_id: "" }),
          )}
        >
          <label className="field">
            <span>
              {t("Amount")} ({currency})
            </span>
            <input
              required
              type="number"
              min="1"
              value={gift.amount}
              onChange={(e) => setGift({ ...gift, amount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("For")}</span>
            <input
              value={gift.recipient}
              onChange={(e) => setGift({ ...gift, recipient: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Bought by")}</span>
            <select
              value={gift.buyer_id}
              onChange={(e) => setGift({ ...gift, buyer_id: e.target.value })}
            >
              <option value="">—</option>
              {data.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("Valid until")}</span>
            <input
              type="date"
              value={gift.expires_on}
              onChange={(e) => setGift({ ...gift, expires_on: e.target.value })}
            />
          </label>
          <Button variant="primary" type="submit" icon={<Gift size={15} />}>
            {t("Create")}
          </Button>
        </form>
        <div className="today-list">
          {(data.giftCards || []).map((g) => (
            <div key={g.id} className="today-row">
              <div className="today-main">
                <strong>{g.code}</strong>
                <small>
                  {money(g.balance)} / {money(g.amount)}
                  {g.recipient ? ` · ${g.recipient}` : ""}
                  {g.expires_on ? ` · ${t("until")} ${date(g.expires_on)}` : ""}
                </small>
              </div>
              <Button
                variant="small"
                icon={<QrCode size={14} />}
                onClick={() => setCard(g)}
              >
                {t("Card")}
              </Button>
              <Button
                variant="small"
                disabled={!g.balance}
                onClick={() =>
                  setApply({ kind: "gift", code: g.code, charge_id: "" })
                }
              >
                {t("Pay with it")}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Loyalty and referrals"
        subtitle="Every N-th session with a discount and a reward for clients who bring a friend."
      >
        <form
          className="inline-form"
          onSubmit={submit(
            () =>
              perform(
                "/settings/loyalty",
                {
                  loyalty_every: Number(loyal.loyalty_every || 0),
                  loyalty_percent: Number(loyal.loyalty_percent || 0),
                  referral_amount: Math.round(
                    Number(loyal.referral_amount || 0) * 100,
                  ),
                },
                "PATCH",
              ),
            () => {},
          )}
        >
          <label className="field">
            <span>{t("Every N-th session")}</span>
            <input
              type="number"
              min="0"
              value={loyal.loyalty_every}
              onChange={(e) =>
                setLoyal({ ...loyal, loyalty_every: e.target.value })
              }
              placeholder="5"
            />
          </label>
          <label className="field">
            <span>{t("Discount %")}</span>
            <input
              type="number"
              min="0"
              max="100"
              value={loyal.loyalty_percent}
              onChange={(e) =>
                setLoyal({ ...loyal, loyalty_percent: e.target.value })
              }
              placeholder="50"
            />
          </label>
          <label className="field">
            <span>
              {t("Reward per friend")} ({currency})
            </span>
            <input
              type="number"
              min="0"
              value={loyal.referral_amount}
              onChange={(e) =>
                setLoyal({ ...loyal, referral_amount: e.target.value })
              }
            />
          </label>
          <Button type="submit" disabled={!data.permissions.admin}>
            {t("Save")}
          </Button>
        </form>
        {referrers.length === 0 ? (
          <p className="form-hint padded-hint">
            {t(
              "Choose “Referred by” on a client card to count who brings friends.",
            )}
          </p>
        ) : (
          <div className="today-list">
            {referrers.slice(0, 10).map(([id, n]) => (
              <div key={id} className="today-row">
                <div className="today-main">
                  <strong>{person(Number(id)).name}</strong>
                  <small>
                    {n} {t("friend(s) brought")}
                    {data.settings.referral_amount
                      ? ` · ${t("reward")} ${money(n * data.settings.referral_amount)}`
                      : ""}
                  </small>
                </div>
                <Badge tone="teal">{n}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {apply && (
        <Dialog
          title={t(
            apply.kind === "gift"
              ? "Pay with a gift card"
              : "Apply a promo code",
          )}
          onClose={() => setApply(null)}
        >
          <div className="form-body">
            <p>
              <b>{apply.code}</b>
            </p>
            <label className="field">
              <span>{t("Amount due")}</span>
              <select
                value={apply.charge_id}
                onChange={(e) =>
                  setApply({ ...apply, charge_id: e.target.value })
                }
              >
                <option value="">—</option>
                {open.map((c) => (
                  <option key={c.id} value={c.id}>
                    {person(c.contact_id).name} — {c.label} — {money(c.balance)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => setApply(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={!apply.charge_id}
              onClick={async () => {
                try {
                  const r = await perform(
                    apply.kind === "gift"
                      ? "/gift-cards/redeem"
                      : "/promo-codes/apply",
                    {
                      code: apply.code,
                      charge_id: Number(apply.charge_id),
                    },
                  );
                  toast(
                    apply.kind === "gift"
                      ? `${t("Paid")}: ${money(r.amount)}`
                      : `${t("Discount")}: ${money(r.discount)}`,
                  );
                  setApply(null);
                } catch (e: any) {
                  toast(e.message);
                }
              }}
            >
              {t("Confirm")}
            </Button>
          </div>
        </Dialog>
      )}
      {card && (
        <Dialog title={t("Gift card")} onClose={() => setCard(null)}>
          <div className="gift-card printable">
            <strong>{data.settings.academy}</strong>
            <span className="gift-amount">{money(card.amount)}</span>
            {card.recipient && (
              <span>
                {t("For")} {card.recipient}
              </span>
            )}
            <Qr text={card.code} />
            <code>{card.code}</code>
          </div>
          <div className="dialog-footer">
            <Button icon={<Printer size={15} />} onClick={() => window.print()}>
              {t("Print")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
