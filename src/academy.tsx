import { useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Clock,
  Download,
  GraduationCap,
  MessageCircle,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import qrcode from "qrcode-generator";
import { useApp } from "./context";
import { api, localDate, type Row } from "./types";
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  Dialog,
  Empty,
  PageHead,
  Panel,
  Tabs,
} from "./ui";
import { useTemplateValues } from "./tools";

/** QR code as an inline SVG (no network, prints sharply). */
export function qrSvg(text: string, cell = 4) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
export function QR({ text, size = 180 }: { text: string; size?: number }) {
  return (
    <span
      className="qr"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: qrSvg(text) }}
    />
  );
}
const csv = (rows: (string | number)[][], name: string) => {
  const body =
    "﻿" +
    rows
      .map((r) =>
        r
          .map(
            (x) =>
              `"${String(x ?? "")
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""')}"`,
          )
          .join(";"),
      )
      .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([body], { type: "text/csv;charset=utf-8" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// ---------------------------------------------------------------------------
// 5. Attendance on the phone
// ---------------------------------------------------------------------------
export function AttendancePage() {
  const { data, t, perform, toast, person, cohort, time, date, open } =
    useApp();
  const [day, setDay] = useState(data.today);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(0);
  const [alerts, setAlerts] = useState<Row[]>([]);
  const zone = data.settings.timezone;
  const mine = data.user.role === "instructor";
  const sessions = data.sessions
    .filter(
      (s) =>
        s.status === "Scheduled" &&
        localDate(new Date(s.starts_at), zone) === day &&
        (!mine || cohort(s.cohort_id).instructor_id === data.user.id),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const statusOf = (sid: number, cid: number) =>
    marks[`${sid}:${cid}`] ||
    data.attendance.find((a) => a.session_id === sid && a.contact_id === cid)
      ?.status ||
    "";
  async function save(s: Row) {
    const students = data.enrollments.filter(
      (e) => e.cohort_id === s.cohort_id && e.status === "Active",
    );
    const records = students.map((e) => ({
      contact_id: e.contact_id,
      status: statusOf(s.id, e.contact_id),
    }));
    if (records.some((r) => !r.status))
      return toast(t("Choose an attendance status for every student."));
    setBusy(s.id);
    try {
      await perform("/attendance", { session_id: s.id, records });
      toast(t("Changes saved"));
      // Two absences in a row → suggest a message to the family / client.
      const worry = records
        .filter((r) => r.status === "Absent")
        .filter((r) => {
          const past = data.attendance
            .filter(
              (a) =>
                a.contact_id === r.contact_id &&
                a.cohort_id === s.cohort_id &&
                a.session_id !== s.id &&
                a.starts_at < s.starts_at,
            )
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
          return past[0]?.status === "Absent";
        })
        .map((r) => person(r.contact_id));
      setAlerts(worry);
    } catch (e: any) {
      toast(t(e.message));
    } finally {
      setBusy(0);
    }
  }
  const choices: [string, string][] = [
    ["Present", "P"],
    ["Late", "R"],
    ["Absent", "A"],
    ["Excused", "E"],
  ];
  return (
    <>
      <PageHead
        title="Attendance"
        subtitle="Mark who is here in a few taps, from your phone."
      >
        <input
          type="date"
          className="date-input"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label={t("Date")}
        />
      </PageHead>
      {alerts.length > 0 && (
        <div className="panel attention-alert">
          <strong>{t("Absent twice in a row")}</strong>
          {alerts.map((c) => (
            <div key={c.id} className="reminder-row">
              <UserX size={18} />
              <div>
                <strong>{c.name}</strong>
                <small>{c.guardian || c.phone}</small>
              </div>
              <Button
                variant="small primary"
                icon={<MessageCircle size={14} />}
                onClick={() => open({ type: "whatsapp", contact: c })}
              >
                WhatsApp
              </Button>
            </div>
          ))}
        </div>
      )}
      {!sessions.length && (
        <div className="panel">
          <Empty
            title="No classes this day"
            text="Choose another date, or add classes in Calendar."
          />
        </div>
      )}
      {sessions.map((s) => {
        const students = data.enrollments.filter(
          (e) => e.cohort_id === s.cohort_id && e.status === "Active",
        );
        const started = Date.parse(s.starts_at) <= Date.now();
        return (
          <section key={s.id} className="panel roll-call">
            <div className="panel-heading">
              <div>
                <h2>{cohort(s.cohort_id).name}</h2>
                <p>
                  <Clock size={13} /> {time(s.starts_at)}–{time(s.ends_at)} ·{" "}
                  {t(s.title)} {s.room ? `· ${s.room}` : ""}
                </p>
              </div>
              <Badge tone="neutral">
                {students.length} {t("students")}
              </Badge>
            </div>
            {!started && (
              <p className="form-hint roll-note">
                {t("Attendance is available after the session starts.")}
              </p>
            )}
            <div className="roll-list">
              {students.map((e) => {
                const c = person(e.contact_id);
                const current = statusOf(s.id, c.id);
                return (
                  <div key={e.id} className="roll-row">
                    <Avatar name={c.name} />
                    <strong>{c.name}</strong>
                    <div
                      className="roll-buttons"
                      role="group"
                      aria-label={c.name}
                    >
                      {choices.map(([value, short]) => (
                        <button
                          key={value}
                          disabled={!started || !data.permissions.attendance}
                          className={`roll-${value.toLowerCase()} ${current === value ? "on" : ""}`}
                          title={t(value)}
                          aria-pressed={current === value}
                          onClick={() =>
                            setMarks({ ...marks, [`${s.id}:${c.id}`]: value })
                          }
                        >
                          <b>{short}</b>
                          <span>{t(value)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {started && data.permissions.attendance && students.length > 0 && (
              <div className="roll-actions">
                <Button
                  onClick={() =>
                    setMarks({
                      ...marks,
                      ...Object.fromEntries(
                        students
                          .filter((e) => !statusOf(s.id, e.contact_id))
                          .map((e) => [`${s.id}:${e.contact_id}`, "Present"]),
                      ),
                    })
                  }
                >
                  {t("Everyone else present")}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy === s.id}
                  icon={<Check size={16} />}
                  onClick={() => save(s)}
                >
                  {t("Save attendance")}
                </Button>
              </div>
            )}
          </section>
        );
      })}
      <p className="muted small-print">
        {date(day, { weekday: "long", day: "numeric", month: "long" })}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Finance: cash book, debts, payroll
// ---------------------------------------------------------------------------
export function CashReport() {
  const { data, t, money, date, person } = useApp();
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const zone = data.settings.timezone;
  const rows = data.payments.filter((p) =>
    localDate(new Date(p.created_at), zone).startsWith(month),
  );
  const refunds = data.refunds.filter((r) =>
    localDate(new Date(r.created_at), zone).startsWith(month),
  );
  const methods = Array.from(new Set(data.payments.map((p) => p.method)));
  const currencies = Array.from(new Set(rows.map((p) => p.currency)));
  const days = Array.from(
    new Set(rows.map((p) => localDate(new Date(p.created_at), zone))),
  )
    .sort()
    .reverse();
  const sum = (list: Row[]) => list.reduce((s, p) => s + p.amount, 0);
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Cash book")}</h2>
          <p>{t("What was received each day, by payment method.")}</p>
        </div>
        <div className="row-actions">
          <input
            type="month"
            className="date-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <Button
            icon={<Download size={15} />}
            onClick={() =>
              csv(
                [
                  [
                    t("Date"),
                    t("Receipt"),
                    t("Client"),
                    t("Payment method"),
                    t("Amount"),
                    t("Currency"),
                  ],
                  ...rows.map((p) => [
                    localDate(new Date(p.created_at), zone),
                    `R-${p.created_at.slice(0, 4)}-${String(p.receipt_no).padStart(4, "0")}`,
                    person(p.contact_id).name,
                    t(p.method),
                    (p.amount / 100).toFixed(2),
                    p.currency,
                  ]),
                ],
                `caisse-${month}.csv`,
              )
            }
          >
            {t("Export CSV")}
          </Button>
        </div>
      </div>
      <div className="cash-totals">
        {currencies.map((c) => (
          <div key={c}>
            <small>
              {t("Total")} {c}
            </small>
            <strong>
              {money(
                sum(rows.filter((p) => p.currency === c)) -
                  refunds
                    .filter(
                      (r) =>
                        data.payments.find((p) => p.id === r.payment_id)
                          ?.currency === c,
                    )
                    .reduce((s, r) => s + r.amount, 0),
                c,
              )}
            </strong>
          </div>
        ))}
        {methods.map((m) => (
          <div key={m}>
            <small>{t(m)}</small>
            <strong>
              {currencies
                .map((c) =>
                  money(
                    sum(rows.filter((p) => p.method === m && p.currency === c)),
                    c,
                  ),
                )
                .join(" · ") || "—"}
            </strong>
          </div>
        ))}
      </div>
      <DataTable
        rows={days.map((d, i) => ({ id: i, day: d }))}
        columns={[
          {
            key: "day",
            label: "Date",
            render: (r) =>
              date(r.day, { weekday: "short", day: "numeric", month: "short" }),
          },
          {
            key: "count",
            label: "Payments",
            render: (r) =>
              rows.filter(
                (p) => localDate(new Date(p.created_at), zone) === r.day,
              ).length,
          },
          ...methods.map((m) => ({
            key: m,
            label: m,
            render: (r: Row) =>
              currencies
                .map((c) =>
                  sum(
                    rows.filter(
                      (p) =>
                        p.method === m &&
                        p.currency === c &&
                        localDate(new Date(p.created_at), zone) === r.day,
                    ),
                  ),
                )
                .map((n, i) => (n ? money(n, currencies[i]) : ""))
                .filter(Boolean)
                .join(" · ") || "—",
          })),
        ]}
        pageSize={31}
      />
    </div>
  );
}

export function DebtsReport() {
  const { data, t, money, date, person, profile, open } = useApp();
  const byClient = new Map<number, Row[]>();
  for (const c of data.charges.filter((c) => c.balance > 0))
    byClient.set(c.contact_id, [...(byClient.get(c.contact_id) || []), c]);
  const rows = [...byClient.entries()]
    .map(([id, list]) => ({
      id,
      list,
      oldest: list.map((c) => c.due_date).sort()[0],
      overdue: list.some((c) => c.due_date < data.today),
    }))
    .sort((a, b) => a.oldest.localeCompare(b.oldest));
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Who owes what")}</h2>
          <p>{t("Open balances per client, the oldest first.")}</p>
        </div>
      </div>
      <DataTable
        rows={rows}
        onRow={(r) => profile(r.id)}
        columns={[
          {
            key: "name",
            label: "Client",
            render: (r) => <strong>{person(r.id).name}</strong>,
          },
          {
            key: "amount",
            label: "Balance",
            render: (r) =>
              Array.from(new Set(r.list.map((c: Row) => c.currency)))
                .map((cur) =>
                  money(
                    r.list
                      .filter((c: Row) => c.currency === cur)
                      .reduce((s: number, c: Row) => s + c.balance, 0),
                    cur as string,
                  ),
                )
                .join(" · "),
          },
          {
            key: "since",
            label: "Due since",
            render: (r) => (
              <Badge tone={r.overdue ? "amber" : "neutral"}>
                {date(r.oldest)}
              </Badge>
            ),
          },
          {
            key: "what",
            label: "For",
            render: (r) => r.list.map((c: Row) => c.label).join(", "),
          },
          {
            key: "remind",
            label: "",
            render: (r) =>
              person(r.id).phone ? (
                <Button
                  variant="small"
                  icon={<MessageCircle size={14} />}
                  onClick={() =>
                    open({ type: "whatsapp", contact: person(r.id) })
                  }
                >
                  WhatsApp
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

/** Teachers paid per hour of group class; psychologists per session done. */
export function PayrollReport() {
  const { data, t, money, cohort, open } = useApp();
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const zone = data.settings.timezone;
  const inMonth = (iso: string) =>
    localDate(new Date(iso), zone).startsWith(month);
  const currency = data.settings.currency;
  const rows = data.users
    .filter((u) => u.active !== 0 && u.role !== "manager")
    .map((u) => {
      const sessions = data.sessions.filter(
        (s) =>
          s.status === "Scheduled" &&
          inMonth(s.starts_at) &&
          s.ends_at <= new Date().toISOString() &&
          cohort(s.cohort_id).instructor_id === u.id,
      );
      const hours = sessions.reduce(
        (h, s) =>
          h + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3600000,
        0,
      );
      const consults = (data.appointments || []).filter(
        (a) =>
          a.staff_id === u.id && a.status === "Done" && inMonth(a.starts_at),
      ).length;
      const units =
        u.pay_mode === "hour" ? hours : u.pay_mode === "session" ? consults : 0;
      return {
        ...u,
        hours,
        consults,
        total: Math.round(units * (u.pay_rate || 0)),
      } as Row;
    })
    .filter((u) => u.hours || u.consults || u.pay_mode !== "none");
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Pay for teachers and psychologists")}</h2>
          <p>
            {t(
              "Group class hours taught and consultations done in the month, times each person's rate.",
            )}
          </p>
        </div>
        <div className="row-actions">
          <input
            type="month"
            className="date-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <Button
            icon={<Download size={15} />}
            onClick={() =>
              csv(
                [
                  [
                    t("Name"),
                    t("Hours taught"),
                    t("Consultations done"),
                    t("Rate"),
                    t("Total"),
                  ],
                  ...rows.map((u) => [
                    u.name,
                    u.hours.toFixed(1),
                    u.consults,
                    (u.pay_rate / 100).toFixed(2),
                    (u.total / 100).toFixed(2),
                  ]),
                ],
                `salaires-${month}.csv`,
              )
            }
          >
            {t("Export CSV")}
          </Button>
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={[
          {
            key: "name",
            label: "Name",
            render: (u) => <strong>{u.name}</strong>,
          },
          {
            key: "hours",
            label: "Hours taught",
            render: (u) => u.hours.toFixed(1),
          },
          { key: "consults", label: "Consultations done" },
          {
            key: "rate",
            label: "Rate",
            render: (u) =>
              u.pay_mode === "none" ? (
                <span className="muted">{t("Not set")}</span>
              ) : (
                `${money(u.pay_rate, currency)} / ${t(u.pay_mode === "hour" ? "hour" : "session")}`
              ),
          },
          {
            key: "total",
            label: "Total",
            render: (u) => <strong>{money(u.total, currency)}</strong>,
          },
          ...(data.permissions.admin
            ? [
                {
                  key: "edit",
                  label: "",
                  render: (u: Row) => (
                    <Button
                      variant="small"
                      onClick={() => open({ type: "pay", record: u })}
                    >
                      {t("Set rate")}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className="form-hint padded-hint">
        {t(
          "Only classes already finished and consultations marked “Done” are counted.",
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Psychology: first consultation file
// ---------------------------------------------------------------------------
export function IntakeDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { data, t, refresh, toast } = useApp();
  const questions: string[] = (() => {
    try {
      return JSON.parse(data.settings.intake_questions || "[]");
    } catch {
      return [];
    }
  })();
  const existing = (data.intake || []).find(
    (x) => x.contact_id === contact.id && x.user_id === data.user.id,
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    existing?.answers || {},
  );
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/contacts/${contact.id}/intake`, { answers });
      await refresh();
      toast(t("Changes saved"));
      onClose();
    } catch (e: any) {
      toast(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${t("First consultation file")} · ${contact.name}`}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        <div className="info-box">
          <ShieldCheck size={17} />
          <span>{t("Private: only you can read this file.")}</span>
        </div>
        <div className="intake-list">
          {[
            ...questions,
            ...Object.keys(answers).filter((k) => !questions.includes(k)),
          ].map((q) => (
            <label key={q} className="template-edit">
              <span>{t(q)}</span>
              <textarea
                rows={3}
                value={answers[q] || ""}
                onChange={(e) =>
                  setAnswers({ ...answers, [q]: e.target.value })
                }
                maxLength={4000}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>
          {t("Save")}
        </Button>
      </div>
    </Dialog>
  );
}

export function IntakeQuestionsDialog({ onClose }: { onClose: () => void }) {
  const { data, t, perform, toast } = useApp();
  const [text, setText] = useState(() => {
    try {
      return JSON.parse(data.settings.intake_questions || "[]").join("\n");
    } catch {
      return "";
    }
  });
  return (
    <Dialog title={t("First consultation questions")} onClose={onClose}>
      <div className="form-body">
        <p className="form-hint">
          {t(
            "One question per line. Psychologists answer them in each client's private file.",
          )}
        </p>
        <textarea
          className="big-textarea"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await perform(
                "/settings/intake",
                {
                  questions: text
                    .split("\n")
                    .map((x: string) => x.trim())
                    .filter(Boolean),
                },
                "PATCH",
              );
              toast(t("Changes saved"));
              onClose();
            } catch (e: any) {
              toast(t(e.message));
            }
          }}
        >
          {t("Save")}
        </Button>
      </div>
    </Dialog>
  );
}

export function PsychologySection({ contact }: { contact: Row }) {
  const { data, t, open, date } = useApp();
  if (
    !["admin", "academic", "instructor", "admissions"].includes(data.user.role)
  )
    return null;
  const mine = (data.intake || []).filter((x) => x.contact_id === contact.id);
  const notes = (data.sessionNotes || [])
    .map(
      (n) =>
        ({
          ...n,
          appt: (data.appointments || []).find(
            (a) => a.id === n.appointment_id,
          ),
        }) as Row,
    )
    .filter((n) => n.appt?.contact_id === contact.id && n.text)
    .sort((a, b) => b.appt.starts_at.localeCompare(a.appt.starts_at));
  return (
    <div className="profile-section">
      <div className="section-label">
        <h3>{t("Psychology file")}</h3>
        <Button
          variant="small"
          icon={<ClipboardList size={14} />}
          onClick={() => open({ type: "intake", contact })}
        >
          {t(
            mine.some((x) => x.user_id === data.user.id)
              ? "Open my file"
              : "First consultation file",
          )}
        </Button>
      </div>
      {contact.emergency_contact && (
        <p className="emergency">
          <strong>{t("Emergency contact")}:</strong> {contact.emergency_contact}
        </p>
      )}
      {notes.length > 0 && (
        <div className="session-notes">
          {notes.map((n) => (
            <button
              key={n.appointment_id}
              className="session-note"
              onClick={() => open({ type: "appointment", record: n.appt })}
            >
              <small>
                {date(n.appt.starts_at, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {n.appt.title}
              </small>
              <span className="pre-line">{n.text}</span>
            </button>
          ))}
        </div>
      )}
      {!notes.length && (
        <p className="form-hint">
          {t(
            "Session notes you write in each appointment appear here. Only you can see them.",
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Languages: placement, marks, next level, certificate
// ---------------------------------------------------------------------------
export function LanguageSection({ contact }: { contact: Row }) {
  const { data, t, open, date, cohort, perform, toast } = useApp();
  const canTeach = ["admin", "academic", "instructor", "admissions"].includes(
    data.user.role,
  );
  const tests = (data.placements || []).filter(
    (p) => p.contact_id === contact.id,
  );
  const enrollments = data.enrollments.filter(
    (e) => e.contact_id === contact.id,
  );
  const grades = (data.grades || []).filter((g) =>
    enrollments.some((e) => e.id === g.enrollment_id),
  );
  if (!canTeach && !tests.length && !grades.length) return null;
  return (
    <div className="profile-section">
      <div className="section-label">
        <h3>
          {t("Level and progress")}{" "}
          {contact.level && <Badge tone="blue">{contact.level}</Badge>}
        </h3>
        {canTeach && (
          <Button
            variant="small"
            icon={<Plus size={14} />}
            onClick={() => open({ type: "placement", contact })}
          >
            {t("Placement test")}
          </Button>
        )}
      </div>
      {tests.map((p) => (
        <div key={p.id} className="payment-line">
          <span>
            <strong>{p.test_name}</strong> · {date(p.taken_on)}
            {p.score != null
              ? ` · ${p.score}${p.max_score ? "/" + p.max_score : ""}`
              : ""}
            {p.level ? ` → ${p.level}` : ""}
            {p.notes ? ` · ${p.notes}` : ""}
          </span>
          {canTeach && (
            <button
              className="icon-button danger"
              aria-label={t("Delete")}
              onClick={async () => {
                if (!window.confirm(t("Delete this result?"))) return;
                await perform(`/placement/${p.id}`, {}, "DELETE").catch(
                  (e: any) => toast(e.message),
                );
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {enrollments.map((e) => {
        const marks = grades.filter((g) => g.enrollment_id === e.id);
        const avg = marks.length
          ? marks.reduce((s, g) => s + (g.score / g.max_score) * 20, 0) /
            marks.length
          : null;
        return (
          <div key={e.id} className="grade-card">
            <div className="package-top">
              <GraduationCap size={18} />
              <strong>{cohort(e.cohort_id).name}</strong>
              <Badge tone={e.status === "Active" ? "teal" : "neutral"}>
                {t(e.status)}
              </Badge>
              {avg != null && (
                <Badge tone="blue">
                  {t("Average")} {avg.toFixed(1)}/20
                </Badge>
              )}
            </div>
            {marks.length > 0 && (
              <div className="marks">
                {marks.map((g) => (
                  <span key={g.id} title={date(g.taken_on)}>
                    {g.title}: <b>{g.score}</b>/{g.max_score}
                  </span>
                ))}
              </div>
            )}
            {canTeach && (
              <div className="row-actions wrap">
                <Button
                  variant="small"
                  onClick={() => open({ type: "grade", record: e, contact })}
                >
                  {t("Add a mark")}
                </Button>
                {e.status === "Active" &&
                  ["admin", "academic", "admissions"].includes(
                    data.user.role,
                  ) && (
                    <Button
                      variant="small primary"
                      onClick={() =>
                        open({ type: "promote", record: e, contact })
                      }
                    >
                      {t("Next level")}
                    </Button>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Group mark sheet: one assessment, a mark per student. */
export function MarkSheetDialog({
  cohortRow,
  onClose,
}: {
  cohortRow: Row;
  onClose: () => void;
}) {
  const { data, t, person, perform, toast } = useApp();
  const students = data.enrollments.filter(
    (e) => e.cohort_id === cohortRow.id && e.status === "Active",
  );
  const [title, setTitle] = useState("");
  const [max, setMax] = useState("20");
  const [marks, setMarks] = useState<Record<number, string>>({});
  const tests = Array.from(
    new Set(
      (data.grades || [])
        .filter((g) => students.some((e) => e.id === g.enrollment_id))
        .map((g) => g.title),
    ),
  );
  async function save() {
    try {
      const r = await perform("/grades/bulk", {
        cohort_id: cohortRow.id,
        title,
        max_score: Number(max),
        marks: students.map((e) => ({
          enrollment_id: e.id,
          score: marks[e.id] ?? "",
        })),
      });
      toast(`${r.count} ${t("marks saved")}`);
      onClose();
    } catch (e: any) {
      toast(t(e.message));
    }
  }
  return (
    <Dialog
      title={`${t("Mark sheet")} · ${cohortRow.name}`}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        {tests.length > 0 && (
          <div className="table-scroll grade-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Student")}</th>
                  {tests.map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((e) => (
                  <tr key={e.id}>
                    <td>{person(e.contact_id).name}</td>
                    {tests.map((x) => {
                      const g = (data.grades || []).find(
                        (g) => g.enrollment_id === e.id && g.title === x,
                      );
                      return (
                        <td key={x}>{g ? `${g.score}/${g.max_score}` : "—"}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="import-title">{t("New assessment")}</h3>
        <div className="form-grid">
          <label>
            <span>{t("Assessment")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Example: Test 1 · Oral")}
            />
          </label>
          <label>
            <span>{t("Out of")}</span>
            <input
              type="number"
              min={1}
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
        </div>
        <div className="roll-list">
          {students.map((e) => (
            <div key={e.id} className="roll-row">
              <Avatar name={person(e.contact_id).name} />
              <strong>{person(e.contact_id).name}</strong>
              <input
                className="mark-input"
                type="number"
                min={0}
                max={Number(max)}
                step="0.25"
                value={marks[e.id] ?? ""}
                onChange={(ev) =>
                  setMarks({ ...marks, [e.id]: ev.target.value })
                }
                aria-label={`${t("Mark")}: ${person(e.contact_id).name}`}
              />
            </div>
          ))}
          {!students.length && (
            <Empty title="No active students in this cohort." text="" />
          )}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Close")}</Button>
        <Button
          variant="primary"
          disabled={!title || !students.length}
          onClick={save}
        >
          {t("Save marks")}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 9. Director's report
// ---------------------------------------------------------------------------
export function DirectorReport({ start }: { start: string }) {
  const { data, t, money, cohort, program, user } = useApp();
  const zone = data.settings.timezone;
  const since = (iso: string) => localDate(new Date(iso), zone) >= start;
  const currency = data.settings.currency;
  const newClients = data.contacts.filter((c) => since(c.created_at)).length;
  const requests = data.opportunities.filter((o) => since(o.created_at));
  const enrolled = requests.filter((o) => o.stage === "Enrolled").length;
  // Revenue by direction: payments → charge → enrollment → program category.
  const direction = (p: Row) => {
    const ch = data.charges.find((c) => c.id === p.charge_id);
    const e = ch?.enrollment_id
      ? data.enrollments.find((x) => x.id === ch.enrollment_id)
      : null;
    if (e)
      return program(cohort(e.cohort_id).program_id).category || t("Other");
    if ((data.packages || []).some((k) => k.charge_id === ch?.id))
      return t("Consultations");
    return t("Other");
  };
  const revenue = new Map<string, number>();
  for (const p of data.payments.filter(
    (p) => since(p.created_at) && p.currency === currency,
  ))
    revenue.set(direction(p), (revenue.get(direction(p)) || 0) + p.amount);
  const totalRevenue = [...revenue.values()].reduce((s, n) => s + n, 0);
  const load = data.users
    .filter((u) => u.active !== 0)
    .map((u) => ({
      id: u.id,
      name: u.name,
      consults: (data.appointments || []).filter(
        (a) => a.staff_id === u.id && a.status === "Done" && since(a.starts_at),
      ).length,
      noShow: (data.appointments || []).filter(
        (a) =>
          a.staff_id === u.id && a.status === "No-show" && since(a.starts_at),
      ).length,
      classes: data.sessions.filter(
        (s) =>
          s.status === "Scheduled" &&
          since(s.starts_at) &&
          s.starts_at <= new Date().toISOString() &&
          cohort(s.cohort_id).instructor_id === u.id,
      ).length,
    }))
    .filter((u) => u.consults || u.classes || u.noShow);
  const max = Math.max(1, ...[...revenue.values()]);
  return (
    <>
      <div className="metrics director">
        {[
          ["New clients", newClients],
          ["Requests", requests.length],
          [
            "Became students",
            requests.length
              ? `${Math.round((enrolled / requests.length) * 100)}%`
              : "—",
          ],
          ["Revenue", money(totalRevenue, currency)],
        ].map(([label, value]) => (
          <div className="metric" key={label as string}>
            <div className="metric-top">
              <span>{t(label as string)}</span>
            </div>
            <strong className={String(value).length > 12 ? "money-value" : ""}>
              {value}
            </strong>
          </div>
        ))}
      </div>
      <div className="reports-grid">
        {data.permissions.finance && (
          <Panel
            title="Revenue by direction"
            subtitle="Payments received in the period, by type of activity."
          >
            <div className="program-bars padded">
              {[...revenue.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <div key={name} className="bar-row">
                    <div>
                      <span>{t(name)}</span>
                      <strong>{money(n, currency)}</strong>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              {!revenue.size && (
                <Empty title="No data in this period" text="" />
              )}
            </div>
          </Panel>
        )}
        <Panel
          title="Team activity"
          subtitle="Consultations done, missed, and classes taught in the period."
        >
          <DataTable
            rows={load}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (u) => <strong>{user(u.id).name}</strong>,
              },
              { key: "consults", label: "Consultations done" },
              { key: "noShow", label: "No-show" },
              { key: "classes", label: "Classes taught" },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 10. Activity journal (who changed what)
// ---------------------------------------------------------------------------
export function JournalPanel() {
  const { data, t, date, time, person, profile } = useApp();
  const [who, setWho] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const rows = useMemo(
    () =>
      data.activities.filter(
        (a) =>
          (!who || String(a.user_id) === who) &&
          (!from || a.created_at.slice(0, 10) >= from) &&
          (!query ||
            `${a.text} ${a.contact_id ? person(a.contact_id).name : ""}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [data.activities, who, query, from],
  );
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Activity journal")}</h2>
          <p>
            {t("Everything the team added, changed or deleted, newest first.")}
          </p>
        </div>
      </div>
      <div className="toolbar">
        <div className="search-field">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search…")}
            aria-label={t("Search")}
          />
        </div>
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label={t("Staff")}
        >
          <option value="">{t("Everyone")}</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="date-input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t("From")}
        />
      </div>
      <DataTable
        rows={rows}
        pageSize={25}
        columns={[
          {
            key: "created_at",
            label: "Date",
            render: (a) => `${date(a.created_at)} · ${time(a.created_at)}`,
          },
          { key: "user_name", label: "Who" },
          {
            key: "client",
            label: "Client",
            render: (a) =>
              a.contact_id ? (
                <button
                  className="cell-link"
                  onClick={() => profile(a.contact_id)}
                >
                  {person(a.contact_id).name}
                </button>
              ) : (
                "—"
              ),
          },
          {
            key: "text",
            label: "What happened",
            render: (a) => <span className="pre-line">{a.text}</span>,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. Two-step sign-in (My account)
// ---------------------------------------------------------------------------
export function TwoStepPanel() {
  const { data, t, refresh, toast } = useApp();
  const me = data.users.find((u) => u.id === data.user.id);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const on = !!me?.totp_enabled;
  async function start() {
    setError("");
    try {
      setSetup(await api("/account/2fa/setup", {}));
    } catch (e: any) {
      setError(t(e.message));
    }
  }
  async function enable() {
    setError("");
    try {
      await api("/account/2fa/enable", { code });
      setSetup(null);
      setCode("");
      await refresh();
      toast(t("Two-step sign-in is on"));
    } catch (e: any) {
      setError(t(e.message));
    }
  }
  async function disable() {
    setError("");
    try {
      await api("/account/2fa/disable", { password });
      setPassword("");
      await refresh();
      toast(t("Two-step sign-in is off"));
    } catch (e: any) {
      setError(t(e.message));
    }
  }
  return (
    <Panel
      title="Two-step sign-in"
      subtitle="After the password, a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator…)."
      action={
        <Badge tone={on ? "teal" : "neutral"}>{t(on ? "On" : "Off")}</Badge>
      }
    >
      <div className="booking-admin">
        {!on && !setup && (
          <Button
            variant="primary"
            icon={<ShieldCheck size={16} />}
            onClick={start}
          >
            {t("Turn on two-step sign-in")}
          </Button>
        )}
        {setup && (
          <div className="twostep-setup">
            <QR text={setup.uri} size={180} />
            <div>
              <p>
                {t("1. Open your authenticator app and scan this QR code.")}
              </p>
              <p className="muted">
                {t("Or type this key:")} <code>{setup.secret}</code>
              </p>
              <p>{t("2. Type the 6-digit code shown in the app:")}</p>
              <div className="row-actions">
                <input
                  className="code-input"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <Button
                  variant="primary"
                  disabled={code.length !== 6}
                  onClick={enable}
                >
                  {t("Confirm")}
                </Button>
              </div>
            </div>
          </div>
        )}
        {on && (
          <div className="row-actions wrap">
            <input
              type="password"
              className="code-input wide"
              placeholder={t("Current password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button variant="danger" disabled={!password} onClick={disable}>
              {t("Turn off")}
            </Button>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 11. Help for each page
// ---------------------------------------------------------------------------
const help: Record<string, string[]> = {
  Overview: [
    "Online bookings to confirm and reminders to send appear at the top.",
    "“Today” shows everyone booked today. Click a line to open it.",
    "Click a number (new requests, payments…) to see the list behind it.",
  ],
  Admissions: [
    "New leads from the website arrive in the first box: Accept, Dismiss or Import all.",
    "Each card is a request. Drag it to the next column, or use ⋯ to change its stage.",
    "The pencil edits the request; the client's name opens their card.",
  ],
  Students: [
    "All clients, including people who only asked a question.",
    "Click a name to open the card: notes, appointments, payments, documents.",
    "Search works with names, e-mails and phone numbers (0…, +213…).",
  ],
  Calendar: [
    "Click an empty time to book. Choose a person at the top to see their hours.",
    "Hatched time = outside working hours or on leave.",
    "List view: mark appointments as done or missed in one tap.",
  ],
  Attendance: [
    "Choose the day, tap P (present), R (late), A (absent) or E (excused), then save.",
    "“Everyone else present” fills the remaining students.",
    "After two absences in a row the CRM suggests a WhatsApp message.",
  ],
  "Programs & Cohorts": [
    "A program is what you sell (with its price). A group is a class of that program.",
    "Open a group to see students, upcoming classes and the mark sheet.",
  ],
  Payments: [
    "Charges = what clients owe. Record a payment when money is received.",
    "Cash book, debts and pay are in the tabs. Each payment has a printable receipt.",
  ],
  Reports: [
    "Choose the period at the top. Use Print to save the report as PDF.",
  ],
  Settings: [
    "Team: add people, their working hours, pay rate and password.",
    "Online booking: open the public page and choose the services.",
    "Trash: restore anything deleted in the last 30 days.",
  ],
  "My tasks": [
    "Tick a task when it is done. The pencil changes its date or person.",
  ],
};
export function HelpDialog({
  page,
  onClose,
}: {
  page: string;
  onClose: () => void;
}) {
  const { t } = useApp();
  const lines = help[page] || help.Overview;
  return (
    <Dialog title={t("How this page works")} onClose={onClose}>
      <div className="form-body">
        <ol className="help-list">
          {lines.map((l) => (
            <li key={l}>{t(l)}</li>
          ))}
        </ol>
      </div>
      <div className="dialog-footer">
        <Button variant="primary" onClick={onClose}>
          {t("Got it")}
        </Button>
      </div>
    </Dialog>
  );
}

export function PrintReportButton() {
  const { t } = useApp();
  return (
    <Button icon={<Printer size={16} />} onClick={() => window.print()}>
      {t("Print / PDF")}
    </Button>
  );
}

/** Helper used by the WhatsApp dialog after an absence. */
export function useAbsenceMessage() {
  const fill = useTemplateValues();
  return fill;
}
