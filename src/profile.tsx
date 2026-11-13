import { useState } from "react";
import {
  Mail,
  Phone,
  Plus,
  CalendarDays,
  MessageSquare,
  ArrowUpRight,
  FileText,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  GraduationCap,
  Wallet,
  Shield,
  Languages,
  Pencil,
  Trash2,
} from "lucide-react";
import { useApp } from "./context";
import { Dialog, Button, Badge, Avatar, Tabs, Empty, TaskRows } from "./ui";
import { useRequestLabel, serviceTone, useRemove } from "./pages";

export default function Profile({
  id,
  onClose,
}: {
  id: number;
  onClose: () => void;
}) {
  const {
    data,
    t,
    person,
    program,
    cohort,
    user,
    date,
    time,
    money,
    open,
    perform,
    toast,
  } = useApp();
  const contact = person(id);
  const label = useRequestLabel();
  const remove = useRemove();
  const appointments = (data.appointments || []).filter(
    (a) => a.contact_id === id,
  );
  const [tab, setTab] = useState("Overview");
  const enrollments = data.enrollments.filter((e) => e.contact_id === id);
  const opportunities = data.opportunities.filter((o) => o.contact_id === id);
  const charges = data.charges.filter((ch) => ch.contact_id === id);
  const attendance = data.attendance.filter((a) => a.contact_id === id);
  const tasks = data.tasks.filter(
    (task) => task.contact_id === id && task.status === "Open",
  );
  const tabs = [
    "Overview",
    "Enrollments",
    "Attendance",
    ...(data.permissions.finance ? ["Payments"] : []),
    "Activity",
    "Documents",
  ];
  return (
    <Dialog title={t("Contact")} onClose={onClose} drawer>
      <div className="profile-hero">
        <Avatar name={contact.name} size="large" />
        <div>
          <h2>{contact.name}</h2>
          <p>
            {enrollments.length ? t("Student") : t("Client")} <span>·</span> LA-
            {String(id).padStart(4, "0")}
          </p>
        </div>
        <Badge tone={enrollments.length ? "teal" : "neutral"}>
          {t(enrollments.length ? "Enrolled" : "Client")}
        </Badge>
      </div>
      <div className="profile-contact">
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>
            <Phone size={14} />
            <bdi>{contact.phone}</bdi>
          </a>
        )}
        {contact.phone && (
          <a
            href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageSquare size={14} />
            WhatsApp
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`}>
            <Mail size={14} />
            <bdi>{contact.email}</bdi>
          </a>
        )}
      </div>
      <div className="profile-actions">
        {data.permissions.write && (
          <>
            <Button
              icon={<CalendarDays size={15} />}
              onClick={() => open({ type: "task", contact })}
            >
              {t("Schedule follow-up")}
            </Button>
            <Button
              icon={<MessageSquare size={15} />}
              onClick={() => open({ type: "note", contact })}
            >
              {t("Add note")}
            </Button>
          </>
        )}
        {["admin", "admissions", "academic", "instructor"].includes(
          data.user.role,
        ) && (
          <Button
            icon={<CalendarDays size={15} />}
            onClick={() => open({ type: "appointment", contact })}
          >
            {t("Book appointment")}
          </Button>
        )}
        {data.permissions.editAdmissions && (
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => open({ type: "inquiry", contact })}
          >
            {t("New request")}
          </Button>
        )}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="profile-content">
        {tab === "Overview" && (
          <>
            {data.flags
              .filter((f) => f.contact_id === id)
              .map((f) => (
                <div className="student-flag" key={f.kind}>
                  <AlertCircle size={19} />
                  <div>
                    <strong>
                      {t(
                        f.kind === "attendance"
                          ? "Student attention"
                          : "Overdue",
                      )}
                    </strong>
                    <p>
                      {f.kind === "attendance"
                        ? `${attendance.filter((a) => a.status === "Absent").length} ${t("Absent")}`
                        : t("Outstanding balance")}
                    </p>
                  </div>
                  {["admin", "academic", "instructor", "finance"].includes(
                    data.user.role,
                  ) && (
                    <Button
                      variant="small"
                      onClick={() => open({ type: "flag", contact, extra: f })}
                    >
                      {t("Mark reviewed")}
                    </Button>
                  )}
                </div>
              ))}
            <div className="profile-section">
              <div className="section-label">
                <h3>{t("Contact details")}</h3>
                {["admin", "admissions", "academic"].includes(
                  data.user.role,
                ) && (
                  <button
                    className="text-button"
                    onClick={() => open({ type: "contact", record: contact })}
                  >
                    {t("Edit details")}
                  </button>
                )}
              </div>
              <dl className="profile-info">
                <div>
                  <dt>{t("Preferred language")}</dt>
                  <dd>{contact.language}</dd>
                </div>
                <div>
                  <dt>{t("Communication consent")}</dt>
                  <dd>
                    <Badge tone={contact.consent ? "teal" : "neutral"}>
                      {t(
                        contact.consent
                          ? "Consent recorded"
                          : "No communication consent",
                      )}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>{t("Guardian or sponsor")}</dt>
                  <dd>{contact.guardian || "—"}</dd>
                </div>
                {contact.notes && (
                  <div className="wide-info">
                    <dt>{t("Notes")}</dt>
                    <dd className="pre-line">{contact.notes}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("Date")}</dt>
                  <dd>{date(contact.created_at)}</dd>
                </div>
              </dl>
            </div>
            {opportunities.length > 0 && (
              <div className="profile-section">
                <div className="section-label">
                  <h3>{t("Requests")}</h3>
                </div>
                {opportunities.map((o) => (
                  <div className="opportunity-detail" key={o.id}>
                    <div>
                      <Badge tone={serviceTone(o.service_type)}>
                        {t(o.service_type)}
                      </Badge>
                      <strong>{label(o)}</strong>
                      <Badge tone={o.stage === "Enrolled" ? "teal" : "neutral"}>
                        {t(o.stage)}
                      </Badge>
                    </div>
                    <dl>
                      <div>
                        <dt>{t("Advisor")}</dt>
                        <dd>{user(o.owner_id).name}</dd>
                      </div>
                      <div>
                        <dt>{t("Source")}</dt>
                        <dd>{t(o.source)}</dd>
                      </div>
                      {o.reason && (
                        <div>
                          <dt>{t("Outcome reason")}</dt>
                          <dd>{o.reason}</dd>
                        </div>
                      )}
                      {o.notes && (
                        <div>
                          <dt>{t("Notes")}</dt>
                          <dd className="pre-line">{o.notes}</dd>
                        </div>
                      )}
                    </dl>
                    {data.permissions.editAdmissions && (
                      <div className="row-actions wrap">
                        <Button
                          variant="small"
                          icon={<Pencil size={14} />}
                          onClick={() => open({ type: "request", record: o })}
                        >
                          {t("Edit")}
                        </Button>
                        <Button
                          variant="small"
                          onClick={() => open({ type: "stage", record: o })}
                        >
                          {t("Update stage")}
                        </Button>
                        <Button
                          variant="small"
                          onClick={() =>
                            open({ type: "consultation", record: o, contact })
                          }
                        >
                          {t("Record consultation")}
                        </Button>
                        {o.stage !== "Enrolled" && (
                          <Button
                            variant="primary small"
                            onClick={() =>
                              open({ type: "enroll", record: o, contact })
                            }
                          >
                            {t("Enroll in cohort")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {appointments.length > 0 && (
              <div className="profile-section">
                <div className="section-label">
                  <h3>{t("Appointments")}</h3>
                </div>
                {appointments.map((a) => (
                  <button
                    className="profile-list-row clickable"
                    key={a.id}
                    onClick={() => open({ type: "appointment", record: a })}
                  >
                    <CalendarDays size={18} />
                    <div>
                      <strong>{a.title}</strong>
                      <small>
                        {t(a.kind)} · {date(a.starts_at)} · {time(a.starts_at)}
                      </small>
                    </div>
                    <Badge
                      tone={
                        a.status === "Done"
                          ? "teal"
                          : a.status === "Cancelled"
                            ? "neutral"
                            : "amber"
                      }
                    >
                      {t(a.status)}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
            <div className="profile-section">
              <div className="section-label">
                <h3>{t("Follow-ups")}</h3>
                <Badge tone="neutral">{tasks.length}</Badge>
              </div>
              <TaskRows tasks={tasks} />
            </div>
            {data.permissions.editAdmissions && (
              <div className="profile-section">
                <Button
                  disabled={!contact.consent}
                  icon={<Mail size={16} />}
                  onClick={() => open({ type: "draft", contact })}
                >
                  {t("Prepare message")}
                </Button>
                <p className="form-hint">
                  {t(
                    "Messaging is not configured. Drafts remain available for review.",
                  )}
                </p>
              </div>
            )}
          </>
        )}
        {tab === "Enrollments" && (
          <>
            <div className="section-label">
              <h3>{t("Enrollment history")}</h3>
            </div>
            {enrollments.map((e) => {
              const h = cohort(e.cohort_id);
              return (
                <div className="enrollment-card" key={e.id}>
                  <div>
                    <span
                      className={`large-program-icon ${program(h.program_id).color}`}
                    >
                      <GraduationCap size={23} />
                    </span>
                    <div>
                      <h3>{t(program(h.program_id).name)}</h3>
                      <p>{h.name}</p>
                    </div>
                    <Badge tone={e.status === "Active" ? "teal" : "neutral"}>
                      {t(e.status)}
                    </Badge>
                  </div>
                  <dl className="profile-info">
                    <div>
                      <dt>{t("Instructor")}</dt>
                      <dd>
                        {h.instructor_id ? user(h.instructor_id).name : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Date")}</dt>
                      <dd>{date(e.created_at)}</dd>
                    </div>
                    <div>
                      <dt>{t("Room")}</dt>
                      <dd>{h.room}</dd>
                    </div>
                  </dl>
                  {data.permissions.editAcademic && e.status === "Active" && (
                    <div className="row-actions">
                      <Button
                        variant="small"
                        onClick={() =>
                          open({ type: "transfer", record: e, contact })
                        }
                      >
                        {t("Transfer")}
                      </Button>
                      <Button
                        variant="small"
                        onClick={async () => {
                          if (!window.confirm(t("Complete enrollment") + "?"))
                            return;
                          try {
                            await perform(
                              `/enrollments/${e.id}`,
                              { status: "Completed" },
                              "PATCH",
                            );
                            toast(t("Changes saved"));
                          } catch (err: any) {
                            toast(err.message);
                          }
                        }}
                      >
                        {t("Complete")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!enrollments.length && (
              <Empty title="No enrollments yet" text="" />
            )}
            {data.waitlists
              .filter((w) => w.contact_id === id)
              .map((w) => (
                <div className="info-box" key={w.id}>
                  <Clock size={18} />
                  {t("Waitlisted")} · {cohort(w.cohort_id).name}
                </div>
              ))}
          </>
        )}
        {tab === "Attendance" && (
          <>
            <div className="profile-stat-strip">
              {["Present", "Absent", "Late"].map((status) => (
                <div key={status}>
                  <strong>
                    {attendance.filter((a) => a.status === status).length}
                  </strong>
                  <span>{t(status)}</span>
                </div>
              ))}
            </div>
            {attendance
              .sort((a, b) => b.id - a.id)
              .map((a) => (
                <div className="profile-list-row" key={a.id}>
                  <CalendarDays size={18} />
                  <div>
                    <strong>
                      {data.sessions.find((s) => s.id === a.session_id)?.title}
                    </strong>
                    <small>
                      {date(a.starts_at)} · {cohort(a.cohort_id).name}
                    </small>
                  </div>
                  <Badge
                    tone={
                      a.status === "Present"
                        ? "teal"
                        : a.status === "Absent"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {t(a.status)}
                  </Badge>
                </div>
              ))}
            {!attendance.length && (
              <Empty title="No attendance recorded" text="" />
            )}
          </>
        )}
        {tab === "Payments" && (
          <>
            <div className="section-label">
              <h3>{t("Payment history")}</h3>
              {data.permissions.editFinance && (
                <Button
                  variant="small"
                  onClick={() => open({ type: "charge", contact })}
                >
                  {t("Add charge")}
                </Button>
              )}
            </div>
            {charges.map((ch) => (
              <div className="charge-card" key={ch.id}>
                <div>
                  <strong>{ch.label}</strong>
                  <Badge
                    tone={
                      ch.balance === 0
                        ? "teal"
                        : ch.due_date < data.today
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {t(
                      ch.balance === 0
                        ? "Settled"
                        : ch.due_date < data.today
                          ? "Overdue"
                          : "Unpaid",
                    )}
                  </Badge>
                </div>
                <div className="profile-stat-strip">
                  <div>
                    <small>{t("Amount")}</small>
                    <strong>
                      {money(ch.amount - ch.discount, ch.currency)}
                    </strong>
                  </div>
                  <div>
                    <small>{t("Paid")}</small>
                    <strong>{money(ch.paid, ch.currency)}</strong>
                  </div>
                  <div>
                    <small>{t("Balance")}</small>
                    <strong>{money(ch.balance, ch.currency)}</strong>
                  </div>
                </div>
                <div className="charge-footer">
                  <span>
                    {t("Due date")} · {date(ch.due_date)}
                  </span>
                  {data.permissions.editFinance && ch.balance > 0 && (
                    <Button
                      variant="small primary"
                      onClick={() =>
                        open({ type: "payment", record: ch, contact })
                      }
                    >
                      {t("Record payment")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!charges.length && <Empty title="No records yet" text="" />}
          </>
        )}
        {tab === "Activity" && (
          <div className="profile-timeline">
            {data.activities
              .filter((a) => a.contact_id === id)
              .map((a) => (
                <div key={a.id}>
                  <span className="timeline-node">
                    <CheckCircle2 size={15} />
                  </span>
                  <div>
                    <strong>{a.user_name}</strong>
                    {["note", "consultation"].includes(a.kind) &&
                      (data.user.role === "admin" ||
                        a.user_id === data.user.id) && (
                        <button
                          className="icon-button danger timeline-delete"
                          aria-label={t("Delete note")}
                          title={t("Delete note")}
                          onClick={() =>
                            remove(`/activities/${a.id}`, "Delete this note?")
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    <p className="pre-line">{a.text}</p>
                    <small>
                      {date(a.created_at)} · {time(a.created_at)}{" "}
                      {a.visibility !== "general" &&
                        `· ${t(a.visibility === "finance" ? "Finance only" : "Admissions only")}`}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        )}
        {tab === "Documents" && (
          <>
            <div className="section-label">
              <h3>{t("Documents")}</h3>
              {["admin", "admissions", "academic"].includes(data.user.role) && (
                <Button
                  variant="small"
                  icon={<Upload size={15} />}
                  onClick={() => open({ type: "document", contact })}
                >
                  {t("Upload document")}
                </Button>
              )}
            </div>
            <p className="form-hint">
              {t(
                data.hosted
                  ? "PDF, PNG, JPEG, or TXT. Up to 3 MB."
                  : "PDF, PNG, JPEG, or TXT. Up to 4 MB.",
              )}
            </p>
            {data.documents
              .filter((d) => d.contact_id === id)
              .map((d) => (
                <a
                  className="document-link"
                  key={d.id}
                  href={`/api/documents/${d.id}`}
                  download
                >
                  <FileText size={25} />
                  <span>
                    <strong>{d.name}</strong>
                    <small>
                      {Math.ceil(d.size / 1024)} KB · {date(d.created_at)}
                    </small>
                  </span>
                  <Download size={18} />
                  {["admin", "admissions", "academic"].includes(
                    data.user.role,
                  ) && (
                    <button
                      className="icon-button danger"
                      aria-label={t("Delete")}
                      onClick={(e) => {
                        e.preventDefault();
                        remove(`/documents/${d.id}`, "Delete this document?");
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </a>
              ))}
            {!data.documents.some((d) => d.contact_id === id) && (
              <Empty title="No documents yet" text="" />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
