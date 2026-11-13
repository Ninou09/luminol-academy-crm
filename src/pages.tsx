import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Plus,
  Search,
  Download,
  LayoutGrid,
  List,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Clock,
  Users,
  CalendarDays,
  Check,
  BookOpen,
  GraduationCap,
  Wallet,
  TrendingUp,
  Target,
  MoreHorizontal,
  CheckCircle2,
  AlertCircle,
  Mail,
  MessageCircle,
  Link,
  RefreshCw,
  Globe,
  Workflow,
  FileText,
  Shield,
  Save,
  RotateCcw,
  Pencil,
  Trash2,
  HeartHandshake,
  UserPlus,
  KeyRound,
  Database,
  Upload,
  Stethoscope,
} from "lucide-react";
import { useApp } from "./context";
import {
  Button,
  Badge,
  Avatar,
  Empty,
  PageHead,
  Panel,
  LinkButton,
  Tabs,
  DataTable,
  TaskRows,
} from "./ui";
import { type Row, localDate } from "./types";
import { roleNames } from "./i18n";
import { N8nInbox } from "./n8n";
import { api, matchesPerson } from "./types";
import { PrintButton, TemplatesPanel, TrashPanel, useReceipt } from "./tools";
import {
  BookingSettingsPanel,
  PendingBookings,
  RemindersPanel,
} from "./schedule";

/** What the client asked for: the linked program, or the free-text interest. */
export function useRequestLabel() {
  const { t, program } = useApp();
  return (o: Row) =>
    o.program_id
      ? t(program(o.program_id).name)
      : o.interest || t(o.service_type || "Other");
}
export function serviceTone(service: string) {
  return /consult/i.test(service)
    ? "purple"
    : /lang/i.test(service)
      ? "blue"
      : /psych/i.test(service)
        ? "teal"
        : "amber";
}
/** Small delete helper for list rows that have no edit form. */
export function useRemove() {
  const { t, refresh, toast } = useApp();
  return async (path: string, warning: string) => {
    if (!window.confirm(t(warning))) return;
    try {
      await api(path, {}, "DELETE");
      await refresh();
      toast(t("Deleted"));
    } catch (e: any) {
      toast(e.message);
    }
  };
}

export function periodStart(period: string, today: string) {
  return period === "all"
    ? "0000"
    : period === "month"
      ? today.slice(0, 7) + "-01"
      : new Date(Date.parse(today + "T12:00:00Z") - 29 * 86400000)
          .toISOString()
          .slice(0, 10);
}
function PeriodSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const { t } = useApp();
  return (
    <label className="select-button">
      <CalendarDays size={16} />
      <select
        aria-label={t("Date")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="month">{t("This month")}</option>
        <option value="30">{t("Last 30 days")}</option>
        <option value="all">{t("All time")}</option>
      </select>
    </label>
  );
}
function useStats(period: string) {
  const { data } = useApp();
  const start = periodStart(period, data.today);
  const since = (s: string) =>
    localDate(new Date(s), data.settings.timezone) >= start;
  const leads = data.opportunities.filter((o) => since(o.created_at));
  const enrollments = data.enrollments.filter(
    (e) => e.opportunity_id && since(e.created_at),
  );
  const payments = data.payments.filter((p) => since(p.created_at));
  const refunds = data.refunds.filter((r) => since(r.created_at));
  const byCurrency = (currency: string) => ({
    received:
      payments
        .filter((p) => p.currency === currency)
        .reduce((s, p) => s + p.amount, 0) -
      refunds
        .filter(
          (r) =>
            data.payments.find((p) => p.id === r.payment_id)?.currency ===
            currency,
        )
        .reduce((s, r) => s + r.amount, 0),
    balance: data.charges
      .filter((c) => c.currency === currency)
      .reduce((s, c) => s + c.balance, 0),
  });
  return {
    start,
    leads,
    enrollments,
    payments,
    refunds,
    byCurrency,
    conversion: leads.length
      ? Math.round(
          (leads.filter((o) => o.stage === "Enrolled").length / leads.length) *
            100,
        )
      : 0,
  };
}
export function Overview({
  period,
  setPeriod,
}: {
  period: string;
  setPeriod: (s: string) => void;
}) {
  const {
    data,
    t,
    go,
    open,
    money,
    date,
    time,
    person,
    cohort,
    program,
    profile,
  } = useApp();
  const stats = useStats(period);
  const [attention, setAttention] = useState("Follow-ups");
  const tasks = data.tasks.filter((t) => t.status === "Open");
  const sessions = data.sessions.filter(
    (s) =>
      s.status === "Scheduled" &&
      localDate(new Date(s.starts_at), data.settings.timezone) === data.today,
  );
  const active = data.opportunities.filter(
    (o) => !["Enrolled", "Lost", "Nurture"].includes(o.stage),
  );
  const currency = data.settings.currency;
  const { person: who, user: staffName } = useApp();
  const today = [
    ...(data.appointments || [])
      .filter(
        (a) =>
          a.status !== "Cancelled" &&
          localDate(new Date(a.starts_at), data.settings.timezone) ===
            data.today,
      )
      .map((a) => ({
        key: "a" + a.id,
        kind: "appointment",
        record: a,
        status: a.status,
        color: "appointment",
        title: a.contact_id ? who(a.contact_id).name : a.title,
        sub: `${t(a.kind)}${a.contact_id ? " · " + a.title : ""}`,
        meta: [a.staff_id ? staffName(a.staff_id).name : "", a.location]
          .filter(Boolean)
          .join(" · "),
      })),
    ...sessions.map((s) => ({
      key: "s" + s.id,
      kind: "session",
      record: s,
      status: "Scheduled",
      color: program(cohort(s.cohort_id).program_id).color,
      title: cohort(s.cohort_id).name,
      sub: t(s.title),
      meta: `${s.room} · ${data.enrollments.filter((e) => e.cohort_id === s.cohort_id && e.status === "Active").length} ${t("students")}`,
    })),
  ].sort((x, y) => x.record.starts_at.localeCompare(y.record.starts_at));
  return (
    <>
      <PageHead
        title="Your academy, at a glance."
        subtitle="Here’s what needs your attention today."
      >
        <PeriodSelect value={period} onChange={setPeriod} />
        {data.permissions.editAdmissions && (
          <Button
            variant="primary"
            icon={<Plus size={17} />}
            onClick={() => open({ type: "inquiry" })}
          >
            {t("New client request")}
          </Button>
        )}
      </PageHead>
      {data.permissions.admin && !data.programs.length && (
        <div className="setup-guide panel">
          <div>
            <h2>{t("Let's set up your academy")}</h2>
            <p>{t("Three short steps. You can change everything later.")}</p>
          </div>
          <ol>
            <li>
              <button onClick={() => go("Settings", "Team & permissions")}>
                <UserPlus size={18} />
                <span>
                  <strong>{t("1. Add your team and teachers")}</strong>
                  <small>{t("Advisors, teachers, psychologists")}</small>
                </span>
              </button>
            </li>
            <li>
              <button onClick={() => open({ type: "program" })}>
                <BookOpen size={18} />
                <span>
                  <strong>{t("2. Add your courses with real prices")}</strong>
                  <small>{t("Languages, psychology, training")}</small>
                </span>
              </button>
            </li>
            <li>
              <button onClick={() => go("Admissions")}>
                <Upload size={18} />
                <span>
                  <strong>
                    {t("3. Import leads from the website / Google")}
                  </strong>
                  <small>
                    {(data.incoming || []).length} {t("waiting in the inbox")}
                  </small>
                </span>
              </button>
            </li>
          </ol>
        </div>
      )}
      <PendingBookings />
      <RemindersPanel />
      <div className={`metrics ${!data.permissions.finance ? "compact" : ""}`}>
        {data.permissions.admissions && (
          <Metric
            title="New leads"
            value={stats.leads.length}
            label={
              period === "month"
                ? "This month"
                : period === "30"
                  ? "Last 30 days"
                  : "All time"
            }
            icon={<Users size={18} />}
            onClick={() => go("Admissions", `since:${stats.start}`)}
            accent="blue"
          />
        )}
        <Metric
          title="Confirmed enrollments"
          value={stats.enrollments.length}
          label={
            period === "month"
              ? "This month"
              : period === "30"
                ? "Last 30 days"
                : "All time"
          }
          icon={<GraduationCap size={18} />}
          onClick={() => go("Students", `since:${stats.start}`)}
          accent="teal"
        />
        {data.permissions.admissions && (
          <Metric
            title="Conversion rate"
            value={`${stats.conversion}%`}
            label="Inquiry cohort conversion"
            icon={<TrendingUp size={18} />}
            onClick={() => go("Reports")}
            accent="purple"
          />
        )}
        {data.permissions.finance && (
          <>
            <Metric
              title="Payments received"
              value={money(stats.byCurrency(currency).received, currency)}
              label="Net of recorded refunds"
              icon={<Wallet size={18} />}
              onClick={() => go("Payments", `received:${stats.start}`)}
              accent="teal"
            />
            <Metric
              title="Outstanding balance"
              value={money(stats.byCurrency(currency).balance, currency)}
              label="All open charges"
              icon={<Clock size={18} />}
              onClick={() => go("Payments", "outstanding")}
              accent="amber"
            />
          </>
        )}
      </div>
      <div className="overview-grid">
        <Panel
          title="Needs your attention"
          subtitle="Your next steps, in one place."
          action={
            <span className="count-pill">
              {tasks.length + data.flags.length}
            </span>
          }
        >
          <Tabs
            tabs={["Follow-ups", "Student attention"]}
            value={attention}
            onChange={setAttention}
          />
          {attention === "Follow-ups" ? (
            <TaskRows tasks={tasks} limit={5} />
          ) : (
            <div className="attention-list">
              {data.flags.slice(0, 5).map((f) => (
                <button
                  className="attention-row"
                  key={`${f.contact_id}${f.kind}`}
                  onClick={() => profile(f.contact_id)}
                >
                  <Avatar name={person(f.contact_id).name} />
                  <span>
                    <strong>{person(f.contact_id).name}</strong>
                    <small>
                      {f.kind === "attendance"
                        ? `${data.attendance.filter((a) => a.contact_id === f.contact_id && a.status === "Absent").length} ${t("Absent")}`
                        : t("Overdue")}
                    </small>
                  </span>
                  <Badge tone="amber">
                    {t(f.kind === "attendance" ? "Attendance" : "Payment")}
                  </Badge>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {!data.flags.length && (
                <Empty title="All caught up" text="No active attention flags" />
              )}
            </div>
          )}
          <div className="panel-bottom">
            <LinkButton
              onClick={() =>
                go(
                  attention === "Follow-ups" ? "My tasks" : "Students",
                  attention === "Student attention" ? "attention" : "",
                )
              }
            >
              {t("View all")}
            </LinkButton>
            <span className="muted">
              {date(data.today, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </Panel>
        <Panel
          title="Today"
          subtitle="Who is booked today, and when."
          action={
            <div className="date-tile">
              <span>{date(data.today, { month: "short" })}</span>
              <strong>{date(data.today, { day: "numeric" })}</strong>
            </div>
          }
        >
          <div className="schedule-list">
            {today.slice(0, 6).map((it) => (
              <button
                className={`schedule-row status-${it.status.toLowerCase()}`}
                key={it.key}
                onClick={() =>
                  open(
                    it.kind === "appointment"
                      ? { type: "appointment", record: it.record }
                      : { type: "sessionDetail", record: it.record },
                  )
                }
              >
                <div className="schedule-time">
                  {time(it.record.starts_at)}
                  <small>{time(it.record.ends_at)}</small>
                </div>
                <div className={`schedule-line ${it.color}`} />
                <div>
                  <strong>{it.title}</strong>
                  <p>{it.sub}</p>
                  <small>{it.meta}</small>
                </div>
              </button>
            ))}
            {today.length > 6 && (
              <LinkButton onClick={() => go("Calendar")}>
                +{today.length - 6} {t("more")}
              </LinkButton>
            )}
            {!today.length && (
              <Empty
                title="Nothing booked today"
                text="Add a consultation or class from the calendar."
              />
            )}
          </div>
          <div className="panel-bottom">
            <LinkButton onClick={() => go("Calendar")}>
              {t("View calendar")}
            </LinkButton>
            <Badge tone="neutral">{data.settings.timezone}</Badge>
          </div>
        </Panel>
      </div>
      {data.permissions.admissions && (
        <Panel
          title="Admissions snapshot"
          subtitle="From first hello to first class."
          className="pipeline-panel"
          action={
            <LinkButton onClick={() => go("Admissions")}>
              {t("View pipeline")}
            </LinkButton>
          }
        >
          <div className="pipeline-track">
            {data.stages.slice(0, 6).map((stage, i) => {
              const n = active.filter((o) => o.stage === stage).length;
              return (
                <button
                  key={stage}
                  className={`pipeline-step step-${i}`}
                  onClick={() => go("Admissions", stage)}
                >
                  <div>
                    <span className="stage-dot" />
                    <span>{t(stage)}</span>
                  </div>
                  <strong>
                    {n}
                    <span>{i < 5 && <ArrowRight size={18} />}</span>
                  </strong>
                  <div className="stage-bar">
                    <span
                      style={{
                        width: `${active.length ? (n / active.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      <div className="overview-grid lower-grid">
        <Panel
          title="Recent activity"
          subtitle="A shared history of your academy."
          action={<Badge tone="neutral">{t("All time")}</Badge>}
        >
          <div className="activity-feed">
            {!data.activities.length && (
              <Empty title="No activity yet" text="" />
            )}
            {data.activities.slice(0, 5).map((a) => (
              <div className="activity-item" key={a.id}>
                <span
                  className={`activity-icon ${a.kind === "enrollment" ? "teal" : ""}`}
                >
                  {a.kind === "enrollment" ? (
                    <GraduationCap size={16} />
                  ) : a.kind === "finance" ? (
                    <Wallet size={16} />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                </span>
                <div>
                  {a.contact_id ? (
                    <button
                      className="subtle-link strong"
                      onClick={() => profile(a.contact_id)}
                    >
                      {person(a.contact_id).name}
                    </button>
                  ) : (
                    <strong>{a.user_name}</strong>
                  )}
                  <p>{a.text}</p>
                </div>
                <small>{date(a.created_at)}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Enrollment by program" subtitle="Active students">
          <div className="program-bars">
            {!data.programs.length && (
              <Empty
                title="No programs yet"
                text="Add your first program in Programs & Groups."
              />
            )}
            {data.programs.map((p) => {
              const n = data.enrollments.filter(
                (e) =>
                  e.status === "Active" &&
                  cohort(e.cohort_id).program_id === p.id,
              ).length;
              const max = Math.max(
                1,
                ...data.programs.map(
                  (p) =>
                    data.enrollments.filter(
                      (e) =>
                        e.status === "Active" &&
                        cohort(e.cohort_id).program_id === p.id,
                    ).length,
                ),
              );
              return (
                <button
                  key={p.id}
                  onClick={() => go("Students", `program:${p.id}`)}
                >
                  <div>
                    <span>
                      <i className={`program-dot ${p.color}`} />
                      {t(p.name)}
                    </span>
                    <strong>{n}</strong>
                  </div>
                  <div className="progress">
                    <span
                      className={p.color}
                      style={{ width: `${(n / max) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </>
  );
}
function Metric({
  title,
  value,
  label,
  icon,
  onClick,
  accent,
}: {
  title: string;
  value: string | number;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent: string;
}) {
  const { t } = useApp();
  return (
    <button className="metric" onClick={onClick}>
      <div className="metric-top">
        <span>{t(title)}</span>
        <span className={`metric-icon ${accent}`}>{icon}</span>
      </div>
      <strong
        className={
          typeof value === "string" && value.length > 12 ? "money-value" : ""
        }
      >
        {value}
      </strong>
      <div className="metric-bottom">
        <span>{t(label)}</span>
        <ArrowUpRight size={14} />
      </div>
    </button>
  );
}

export function Admissions() {
  const {
    data,
    t,
    pageFilter,
    open,
    person,
    program,
    user,
    date,
    profile,
    perform,
    toast,
  } = useApp();
  const label = useRequestLabel();
  const [view, setView] = useState(
      window.matchMedia("(max-width:760px)").matches ? "Table" : "Board",
    ),
    [service, setService] = useState(""),
    [query, setQuery] = useState(""),
    [stage, setStage] = useState(
      data.stages.includes(pageFilter) ? pageFilter : "",
    ),
    [owner, setOwner] = useState(""),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState<number[]>([]);
  useEffect(
    () => setStage(data.stages.includes(pageFilter) ? pageFilter : ""),
    [pageFilter],
  );
  const since = pageFilter.startsWith("since:") ? pageFilter.slice(6) : "";
  const rows = data.opportunities.filter(
    (o) =>
      (!query ||
        matchesPerson(person(o.contact_id), query) ||
        `${label(o)} ${o.service_type}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!service || o.service_type === service) &&
      (!stage || o.stage === stage) &&
      (!owner || o.owner_id === Number(owner)) &&
      (!source || o.source === source) &&
      (!since ||
        localDate(new Date(o.created_at), data.settings.timezone) >= since),
  );
  const clear = () => {
    setQuery("");
    setStage("");
    setOwner("");
    setSource("");
    setService("");
  };
  const nextTask = (o: Row) =>
    data.tasks.find(
      (x) => x.contact_id === o.contact_id && x.status === "Open",
    );
  async function move(id: number, target: string) {
    const o = data.opportunities.find((o) => o.id === id);
    if (!o || target === o.stage) return;
    if (target === "Enrolled") {
      open({ type: "enroll", record: o, contact: person(o.contact_id) });
      return;
    }
    if (["Lost", "Nurture"].includes(target)) {
      open({ type: "stage", record: o, extra: target });
      return;
    }
    try {
      await perform(
        `/opportunities/${id}`,
        { stage: target, version: o.version },
        "PATCH",
      );
      toast(t("Record updated"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <>
      <PageHead
        title="Client requests"
        subtitle="Consultations, courses and languages: from first call to enrollment."
      >
        <Button
          icon={<Download size={16} />}
          onClick={() => window.open("/api/export/opportunities", "_self")}
        >
          {t("Export CSV")}
        </Button>
        {data.permissions.editAdmissions && (
          <>
            <Button
              icon={<HeartHandshake size={17} />}
              onClick={() =>
                open({
                  type: "inquiry",
                  extra: { service_type: "Psychology consultation" },
                })
              }
            >
              {t("Consultation request")}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() =>
                open({
                  type: "inquiry",
                  extra: { service_type: "Language course" },
                })
              }
            >
              {t("Course / language request")}
            </Button>
          </>
        )}
      </PageHead>
      <N8nInbox />
      <div className="panel toolbar-panel">
        <div className="toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search inquiries…")}
              aria-label={t("Search inquiries…")}
            />
          </div>
          <select
            aria-label={t("Stage")}
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">{t("All stages")}</option>
            {data.stages
              .map((s) => <option key={s}>{t(s)}</option>)
              .map((el, i) => (
                <option key={data.stages[i]} value={data.stages[i]}>
                  {t(data.stages[i])}
                </option>
              ))}
          </select>
          <select
            aria-label={t("Request type")}
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <option value="">{t("All request types")}</option>
            {Array.from(
              new Set(data.opportunities.map((o) => o.service_type)),
            ).map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Advisor")}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">{t("All advisors")}</option>
            {data.users
              .filter((u) => ["admin", "admissions"].includes(u.role))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <select
            aria-label={t("Source")}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">{t("All sources")}</option>
            {Array.from(new Set(data.opportunities.map((o) => o.source))).map(
              (s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ),
            )}
          </select>
          <div className="view-toggle">
            {[
              ["Board", LayoutGrid],
              ["Table", List],
            ].map(([v, I]: any) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
                aria-label={t(v)}
                aria-pressed={view === v}
              >
                <I size={17} />
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-secondary">
          <span>
            {rows.length} {t("Opportunities").toLowerCase()}
          </span>
          <div>
            {(query || stage || owner || source || service) && (
              <button className="subtle-link" onClick={clear}>
                {t("Clear filters")}
              </button>
            )}
            <select
              aria-label={t("Saved views")}
              value=""
              onChange={(e) => {
                const v = data.savedViews.find(
                  (v) => v.id === Number(e.target.value),
                );
                if (v) {
                  setQuery(v.filters.query);
                  setStage(v.filters.stage);
                  setOwner(v.filters.owner);
                  setSource(v.filters.source);
                }
              }}
            >
              <option value="">{t("Saved views")}</option>
              {data.savedViews.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              className="text-button"
              onClick={() =>
                open({
                  type: "saveView",
                  extra: { query, stage, owner, source },
                })
              }
            >
              <Save size={14} />
              {t("Save view")}
            </button>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span>
              {selected.length} {t("selected")}
            </span>
            <Button
              onClick={() => open({ type: "bulkAssign", extra: selected })}
            >
              {t("Assign advisor")}
            </Button>
            <Button
              onClick={() =>
                open({
                  type: "bulkTask",
                  extra: data.opportunities.filter((o) =>
                    selected.includes(o.id),
                  ),
                })
              }
            >
              {t("Add follow-up")}
            </Button>
            <button
              className="icon-button"
              aria-label={t("Close")}
              onClick={() => setSelected([])}
            >
              <XIcon />
            </button>
          </div>
        )}
      </div>
      {view === "Board" ? (
        <div className="kanban" aria-label={t("Admissions")}>
          {(stage ? [stage] : data.stages).map((s, index) => (
            <section
              className="kanban-column"
              key={s}
              onDragOver={(e) => {
                if (data.permissions.editAdmissions) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (data.permissions.editAdmissions)
                  move(Number(e.dataTransfer.getData("text/plain")), s);
              }}
            >
              <div className="kanban-heading">
                <span className={`column-dot dot-${index % 6}`} />
                <h2>{t(s)}</h2>
                <span>{rows.filter((o) => o.stage === s).length}</span>
              </div>
              <div className="kanban-cards">
                {rows
                  .filter((o) => o.stage === s)
                  .map((o) => {
                    const contact = person(o.contact_id),
                      task = nextTask(o);
                    return (
                      <article
                        className="lead-card"
                        key={o.id}
                        draggable={
                          data.permissions.editAdmissions &&
                          o.stage !== "Enrolled"
                        }
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", String(o.id))
                        }
                      >
                        <button
                          className="lead-name"
                          onClick={() => profile(contact.id)}
                        >
                          <Avatar name={contact.name} />
                          <span>
                            {contact.name}
                            <small>{t(o.source)}</small>
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                        <div className="lead-request">
                          <Badge tone={serviceTone(o.service_type)}>
                            {t(o.service_type)}
                          </Badge>
                          <span>{label(o)}</span>
                        </div>
                        <div
                          className={`lead-followup ${task && task.due_at < new Date().toISOString() ? "overdue" : ""}`}
                        >
                          <Clock size={13} />
                          <span>
                            {task
                              ? `${t(task.title)} · ${date(task.due_at)}`
                              : t("Follow-up needed")}
                          </span>
                        </div>
                        <div className="lead-footer">
                          <span>
                            <Avatar name={user(o.owner_id).name} size="tiny" />
                            {user(o.owner_id).name.split(" ")[0]}
                          </span>
                          <span>
                            {Math.max(
                              0,
                              Math.floor(
                                (Date.now() - Date.parse(o.stage_at)) /
                                  86400000,
                              ),
                            )}
                            d
                          </span>
                          {data.permissions.editAdmissions && (
                            <>
                              <button
                                className="icon-button"
                                title={t("Edit request")}
                                aria-label={`${t("Edit request")}: ${contact.name}`}
                                onClick={() =>
                                  open({ type: "request", record: o })
                                }
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon-button"
                                title={t("Update stage")}
                                aria-label={`${t("Update stage")}: ${contact.name}`}
                                onClick={() =>
                                  open({ type: "stage", record: o })
                                }
                              >
                                <MoreHorizontal size={17} />
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                {!rows.some((o) => o.stage === s) && (
                  <div className="kanban-empty">{t("No records yet")}</div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="panel">
          <DataTable
            rows={rows}
            columns={[
              ...(data.permissions.editAdmissions
                ? [
                    {
                      key: "select",
                      label: "",
                      render: (o: Row) => (
                        <input
                          type="checkbox"
                          aria-label={`${t("Contact")}: ${person(o.contact_id).name}`}
                          checked={selected.includes(o.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, o.id]
                                : selected.filter((id) => id !== o.id),
                            )
                          }
                        />
                      ),
                    },
                  ]
                : []),
              {
                key: "name",
                label: "Name",
                sort: (o) => person(o.contact_id).name,
                render: (o) => (
                  <button
                    className="person-cell cell-link"
                    onClick={() => profile(o.contact_id)}
                  >
                    <Avatar name={person(o.contact_id).name} />
                    <span>
                      <strong>{person(o.contact_id).name}</strong>
                      <small>
                        {person(o.contact_id).phone ||
                          person(o.contact_id).email}
                      </small>
                    </span>
                  </button>
                ),
              },
              {
                key: "program",
                label: "Request",
                sort: (o) => label(o),
                render: (o) => (
                  <span className="request-cell">
                    <Badge tone={serviceTone(o.service_type)}>
                      {t(o.service_type)}
                    </Badge>
                    <small className="block">{label(o)}</small>
                  </span>
                ),
              },
              {
                key: "stage",
                label: "Stage",
                render: (o) => (
                  <Badge tone={o.stage === "Enrolled" ? "teal" : "neutral"}>
                    {t(o.stage)}
                  </Badge>
                ),
              },
              {
                key: "owner",
                label: "Advisor",
                render: (o) => user(o.owner_id).name,
              },
              { key: "source", label: "Source", render: (o) => t(o.source) },
              {
                key: "next",
                label: "Next action",
                render: (o) =>
                  nextTask(o) ? (
                    <span className="small">
                      {t(nextTask(o)!.title)}
                      <small className="block muted">
                        {date(nextTask(o)!.due_at)}
                      </small>
                    </span>
                  ) : (
                    <span className="muted">{t("No follow-up")}</span>
                  ),
              },
              ...(data.permissions.editAdmissions
                ? [
                    {
                      key: "edit",
                      label: "",
                      render: (o: Row) => (
                        <div className="row-actions">
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
                            {t("Stage")}
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </>
  );
}
function XIcon() {
  return <span aria-hidden="true">×</span>;
}

export function Students() {
  const { data, t, pageFilter, profile, program, cohort, money, open } =
    useApp();
  const label = useRequestLabel();
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState(
      pageFilter === "attention"
        ? "Need attention"
        : pageFilter.startsWith("program:") || pageFilter.startsWith("since:")
          ? "Students"
          : "All clients",
    ),
    [filter, setFilter] = useState(
      pageFilter.startsWith("program:") ? pageFilter.slice(8) : "",
    );
  const enrolled = new Set(
    data.enrollments
      .filter(
        (e) =>
          !pageFilter.startsWith("since:") ||
          e.created_at.slice(0, 10) >= pageFilter.slice(6),
      )
      .map((e) => e.contact_id),
  );
  const rows = data.contacts
    .filter(
      (c) =>
        (tab !== "Students" || enrolled.has(c.id)) &&
        (tab !== "Need attention" ||
          data.flags.some((f) => f.contact_id === c.id)) &&
        (!query || matchesPerson(c, query)) &&
        (!filter ||
          data.enrollments.some(
            (e) =>
              e.contact_id === c.id &&
              cohort(e.cohort_id).program_id === Number(filter),
          )),
    )
    .sort((a, b) => b.id - a.id);
  return (
    <>
      <PageHead
        title="Clients & students"
        subtitle="Everyone who contacted the academy, in one list."
      >
        <Button
          icon={<Download size={16} />}
          onClick={() => window.open("/api/export/contacts", "_self")}
        >
          {t("Export CSV")}
        </Button>
        {["admin", "admissions", "academic"].includes(data.user.role) && (
          <Button
            variant="primary"
            icon={<UserPlus size={17} />}
            onClick={() => open({ type: "client" })}
          >
            {t("Add client")}
          </Button>
        )}
      </PageHead>
      <div className="panel">
        <Tabs
          tabs={["All clients", "Students", "Need attention"]}
          value={tab}
          onChange={setTab}
        />
        <div className="toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search by name, phone or email…")}
              aria-label={t("Search by name, phone or email…")}
            />
          </div>
          {tab === "Students" && (
            <select
              aria-label={t("Program")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">{t("All programs")}</option>
              {data.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.name)}
                </option>
              ))}
            </select>
          )}
        </div>
        <DataTable
          rows={rows}
          onRow={(c) => profile(c.id)}
          columns={[
            {
              key: "name",
              label: "Name",
              render: (c) => (
                <span className="person-cell">
                  <Avatar name={c.name} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.phone || c.email || "—"}</small>
                  </span>
                </span>
              ),
            },
            {
              key: "program",
              label: "Request / program",
              render: (c) => {
                const active = data.enrollments.filter(
                  (e) => e.contact_id === c.id && e.status === "Active",
                );
                const requests = data.opportunities.filter(
                  (o) => o.contact_id === c.id && o.stage !== "Enrolled",
                );
                return (
                  <div className="stacked-badges">
                    {active.map((e) => (
                      <Badge
                        key={"e" + e.id}
                        tone={program(cohort(e.cohort_id).program_id).color}
                      >
                        {cohort(e.cohort_id).name}
                      </Badge>
                    ))}
                    {requests.map((o) => (
                      <Badge key={"o" + o.id} tone="neutral">
                        {label(o)}
                      </Badge>
                    ))}
                    {!active.length && !requests.length && "—"}
                  </div>
                );
              },
            },
            {
              key: "attendance",
              label: "Attendance",
              sort: (c) =>
                data.attendance.filter(
                  (a) => a.contact_id === c.id && a.status === "Present",
                ).length,
              render: (c) => {
                const a = data.attendance.filter(
                  (a) => a.contact_id === c.id && a.status !== "Excused",
                );
                return a.length ? (
                  <span>
                    {Math.round(
                      (a.filter((a) => ["Present", "Late"].includes(a.status))
                        .length /
                        a.length) *
                        100,
                    )}
                    %
                  </span>
                ) : (
                  "—"
                );
              },
            },
            {
              key: "status",
              label: "Status",
              render: (c) =>
                data.flags.some((f) => f.contact_id === c.id) ? (
                  <Badge tone="amber">{t("Student attention")}</Badge>
                ) : enrolled.has(c.id) ? (
                  <Badge tone="teal">{t("Student")}</Badge>
                ) : (
                  <Badge tone="neutral">{t("Client")}</Badge>
                ),
            },
            ...(data.permissions.finance
              ? [
                  {
                    key: "balance",
                    label: "Balance",
                    render: (c: Row) => (
                      <span className="amount">
                        {Array.from(
                          new Set(
                            data.charges
                              .filter((ch) => ch.contact_id === c.id)
                              .map((ch) => ch.currency),
                          ),
                        ).map((currency) => (
                          <span className="block" key={currency}>
                            {money(
                              data.charges
                                .filter(
                                  (ch) =>
                                    ch.contact_id === c.id &&
                                    ch.currency === currency,
                                )
                                .reduce((s, ch) => s + ch.balance, 0),
                              currency,
                            )}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </>
  );
}

export function Programs() {
  const { data, t, open, program, user, money, date } = useApp();
  const [tab, setTab] = useState("Programs");
  return (
    <>
      <PageHead
        title="Programs & groups"
        subtitle="Your courses with their prices, and the groups that study them."
      >
        {data.permissions.editAcademic && (
          <>
            <Button
              icon={<Plus size={17} />}
              disabled={!data.programs.length}
              title={
                !data.programs.length ? t("Add a program first") : undefined
              }
              onClick={() => open({ type: "cohort" })}
            >
              {t("New group")}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => open({ type: "program" })}
            >
              {t("New program")}
            </Button>
          </>
        )}
      </PageHead>
      <div className="page-tabs">
        <Tabs
          tabs={["Programs", "Cohorts", "Waitlist"]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "Programs" && !data.programs.length && (
        <div className="panel">
          <Empty
            title="No programs yet"
            text="Add each course you sell (for example English A1, Applied Psychology) with its real price."
            action={
              data.permissions.editAcademic ? (
                <Button
                  variant="primary"
                  icon={<Plus size={17} />}
                  onClick={() => open({ type: "program" })}
                >
                  {t("New program")}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {tab === "Programs" ? (
        <div className="program-grid">
          {data.programs.map((p) => (
            <article key={p.id} className="panel program-card">
              <div className="program-card-top">
                <span className={`large-program-icon ${p.color}`}>
                  <BookOpen size={25} />
                </span>
                <Badge tone={p.color}>{t(p.category)}</Badge>
              </div>
              <h2>{t(p.name)}</h2>
              <p>{p.description}</p>
              <div className="program-facts">
                <span>
                  <Clock size={15} />
                  {p.duration}
                </span>
                <span>
                  <Users size={15} />
                  {
                    data.cohorts.filter((c) => c.program_id === p.id).length
                  }{" "}
                  {t("Cohorts")}
                </span>
              </div>
              <div className="program-card-bottom">
                <div>
                  <small>{t("Tuition")}</small>
                  <strong>{money(p.price, p.currency)}</strong>
                </div>
                <div className="row-actions">
                  {data.permissions.editAcademic && (
                    <>
                      <Button
                        icon={<Pencil size={15} />}
                        onClick={() => open({ type: "program", record: p })}
                      >
                        {t("Edit")}
                      </Button>
                      <Button
                        icon={<Plus size={15} />}
                        onClick={() =>
                          open({ type: "cohort", extra: { program_id: p.id } })
                        }
                      >
                        {t("New group")}
                      </Button>
                    </>
                  )}
                  <Button
                    onClick={() => {
                      setTab("Cohorts");
                    }}
                    icon={<ArrowUpRight size={16} />}
                  >
                    {t("Groups")}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : tab === "Cohorts" ? (
        <div className="panel">
          <DataTable
            rows={data.cohorts}
            onRow={(c) => open({ type: "cohortDetail", record: c })}
            columns={[
              {
                key: "name",
                label: "Cohort",
                render: (c) => (
                  <span>
                    <strong>{c.name}</strong>
                    <small className="block muted">
                      {t(program(c.program_id).name)}
                    </small>
                  </span>
                ),
              },
              {
                key: "instructor",
                label: "Instructor",
                render: (c) =>
                  c.instructor_id ? (
                    <span className="person-cell">
                      <Avatar name={user(c.instructor_id).name} size="small" />
                      {user(c.instructor_id).name}
                    </span>
                  ) : (
                    <span className="muted">{t("No teacher yet")}</span>
                  ),
              },
              {
                key: "capacity",
                label: "Capacity",
                render: (c) => {
                  const n = data.enrollments.filter(
                    (e) => e.cohort_id === c.id && e.status === "Active",
                  ).length;
                  return (
                    <div className="capacity-cell">
                      <span>
                        {n} / {c.capacity}
                        {n >= c.capacity && (
                          <Badge tone="amber">{t("Full")}</Badge>
                        )}
                      </span>
                      <div className="progress">
                        <span
                          style={{
                            width: `${Math.min(100, (n / c.capacity) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                },
              },
              {
                key: "start_date",
                label: "Start date",
                render: (c) => date(c.start_date),
              },
              { key: "room", label: "Room" },
              {
                key: "status",
                label: "Status",
                render: (c) => (
                  <Badge tone={c.status === "Active" ? "teal" : "neutral"}>
                    {t(c.status)}
                  </Badge>
                ),
              },
              ...(data.permissions.editAcademic
                ? [
                    {
                      key: "edit",
                      label: "",
                      render: (c: Row) => (
                        <Button
                          variant="small"
                          icon={<Pencil size={14} />}
                          onClick={() => open({ type: "cohort", record: c })}
                        >
                          {t("Edit")}
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : (
        <div className="panel">
          <WaitlistTable />
        </div>
      )}
    </>
  );
}
function WaitlistTable() {
  const { data, person, cohort, open, date, t } = useApp();
  const remove = useRemove();
  return (
    <DataTable
      rows={data.waitlists}
      columns={[
        {
          key: "name",
          label: "Name",
          render: (w) => person(w.contact_id).name,
        },
        {
          key: "cohort",
          label: "Cohort",
          render: (w) => cohort(w.cohort_id).name,
        },
        { key: "created_at", label: "Date", render: (w) => date(w.created_at) },
        {
          key: "action",
          label: "Next action",
          render: (w) =>
            data.permissions.editAdmissions ? (
              <div className="row-actions">
                {w.opportunity_id && (
                  <Button
                    variant="small"
                    onClick={() =>
                      open({
                        type: "enroll",
                        record: data.opportunities.find(
                          (o) => o.id === w.opportunity_id,
                        ),
                        contact: person(w.contact_id),
                      })
                    }
                  >
                    {t("Enroll in cohort")}
                  </Button>
                )}
                <button
                  className="icon-button danger"
                  aria-label={t("Delete")}
                  onClick={() =>
                    remove(`/waitlists/${w.id}`, "Remove from the waitlist?")
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              t("Waitlisted")
            ),
        },
      ]}
    />
  );
}

export { Calendar } from "./calendar";

export function Payments() {
  const { data, t, open, money, date, person, profile, pageFilter } = useApp();
  const receipt = useReceipt();
  const remove = useRemove();
  const [tab, setTab] = useState(
      pageFilter.startsWith("received:") ? "Payment history" : "All charges",
    ),
    [filter, setFilter] = useState(
      pageFilter === "outstanding" ? "outstanding" : "",
    ),
    [query, setQuery] = useState("");
  const currencies = Array.from(new Set(data.charges.map((c) => c.currency)));
  const rows = data.charges.filter(
    (c) =>
      (!query ||
        `${person(c.contact_id).name} ${c.label}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!filter ||
        (filter === "outstanding" && c.balance > 0) ||
        (filter === "overdue" && c.balance > 0 && c.due_date < data.today) ||
        (filter === "settled" && c.balance === 0)),
  );
  return (
    <>
      <PageHead
        title="A clear picture of payments."
        subtitle="Track charges, installments, and recorded payments."
      >
        <Button
          icon={<Download size={16} />}
          onClick={() => window.open("/api/export/charges", "_self")}
        >
          {t("Export CSV")}
        </Button>
        {data.permissions.editFinance && (
          <>
            <Button
              icon={<Plus size={16} />}
              onClick={() => open({ type: "charge" })}
            >
              {t("Add charge")}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => open({ type: "payment" })}
            >
              {t("Record payment")}
            </Button>
          </>
        )}
      </PageHead>
      <div className="finance-summary">
        {currencies.map((currency) => (
          <div className="finance-summary-currency" key={currency}>
            <Badge tone="neutral">{currency}</Badge>
            <div>
              <span>
                {t("Net received")} · {t("All time")}
              </span>
              <strong>
                {money(
                  data.charges
                    .filter((c) => c.currency === currency)
                    .reduce((s, c) => s + c.paid, 0),
                  currency,
                )}
              </strong>
            </div>
            <div>
              <span>{t("Outstanding")}</span>
              <strong>
                {money(
                  data.charges
                    .filter((c) => c.currency === currency)
                    .reduce((s, c) => s + c.balance, 0),
                  currency,
                )}
              </strong>
            </div>
            <div>
              <span>{t("Overdue")}</span>
              <strong className="amber-text">
                {money(
                  data.charges
                    .filter(
                      (c) => c.currency === currency && c.due_date < data.today,
                    )
                    .reduce((s, c) => s + c.balance, 0),
                  currency,
                )}
              </strong>
            </div>
          </div>
        ))}
      </div>
      <div className="panel">
        <Tabs
          tabs={["All charges", "Payment history"]}
          value={tab}
          onChange={setTab}
        />
        <div className="toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search students…")}
              aria-label={t("Search students…")}
            />
          </div>
          {tab === "All charges" && (
            <select
              aria-label={t("Status")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">{t("All charges")}</option>
              <option value="outstanding">{t("Outstanding")}</option>
              <option value="overdue">{t("Overdue")}</option>
              <option value="settled">{t("Settled")}</option>
            </select>
          )}
          <span className="toolbar-note">
            <Shield size={14} />
            {t("Money is recorded, never processed here.")}
          </span>
        </div>
        {tab === "All charges" ? (
          <DataTable
            rows={rows}
            columns={[
              {
                key: "name",
                label: "Name",
                sort: (c) => person(c.contact_id).name,
                render: (c) => (
                  <button
                    className="person-cell cell-link"
                    onClick={() => profile(c.contact_id)}
                  >
                    <Avatar name={person(c.contact_id).name} />
                    <span>
                      <strong>{person(c.contact_id).name}</strong>
                      <small>{c.label}</small>
                    </span>
                  </button>
                ),
              },
              {
                key: "amount",
                label: "Amount",
                render: (c) => (
                  <span className="amount">
                    {money(c.amount - c.discount, c.currency)}
                  </span>
                ),
              },
              {
                key: "paid",
                label: "Paid",
                render: (c) => money(c.paid, c.currency),
              },
              {
                key: "balance",
                label: "Balance",
                render: (c) => (
                  <strong className={c.balance ? "" : "teal-text"}>
                    {money(c.balance, c.currency)}
                  </strong>
                ),
              },
              {
                key: "due_date",
                label: "Due date",
                render: (c) => date(c.due_date),
              },
              {
                key: "status",
                label: "Status",
                render: (c) => (
                  <Badge
                    tone={
                      !c.balance
                        ? "teal"
                        : c.due_date < data.today
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {t(
                      !c.balance
                        ? "Settled"
                        : c.due_date < data.today
                          ? "Overdue"
                          : c.paid
                            ? "Partial"
                            : "Unpaid",
                    )}
                  </Badge>
                ),
              },
              {
                key: "actions",
                label: "Next action",
                render: (c) =>
                  data.permissions.editFinance ? (
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={t("Edit charge")}
                        title={t("Edit charge")}
                        onClick={() => open({ type: "charge", record: c })}
                      >
                        <Pencil size={15} />
                      </button>
                      {c.balance > 0 && (
                        <Button
                          variant="small"
                          onClick={() => open({ type: "payment", record: c })}
                        >
                          {t("Record payment")}
                        </Button>
                      )}
                      {c.paid === 0 && c.discount === 0 && (
                        <button
                          className="icon-button"
                          aria-label={t("Split into installments")}
                          onClick={() => open({ type: "split", record: c })}
                        >
                          <SlidersHorizontal size={16} />
                        </button>
                      )}
                    </div>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        ) : (
          <DataTable
            rows={data.payments
              .filter(
                (p) =>
                  (!query ||
                    person(p.contact_id)
                      .name.toLowerCase()
                      .includes(query.toLowerCase())) &&
                  (!pageFilter.startsWith("received:") ||
                    localDate(new Date(p.created_at), data.settings.timezone) >=
                      pageFilter.slice(9)),
              )
              .sort((a, b) => b.id - a.id)}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (p) => (
                  <button
                    className="cell-link"
                    onClick={() => profile(p.contact_id)}
                  >
                    {person(p.contact_id).name}
                  </button>
                ),
              },
              {
                key: "amount",
                label: "Amount",
                render: (p) => money(p.amount, p.currency),
              },
              {
                key: "method",
                label: "Payment method",
                render: (p) => t(p.method),
              },
              { key: "reference", label: "Reference" },
              {
                key: "created_at",
                label: "Date",
                render: (p) => date(p.created_at),
              },
              {
                key: "refund",
                label: "Record refund",
                render: (p) => (
                  <div>
                    <PrintButton label="Receipt" onClick={() => receipt(p)} />
                    <small className="block muted">
                      {money(
                        data.refunds
                          .filter((r) => r.payment_id === p.id)
                          .reduce((s, r) => s + r.amount, 0),
                        p.currency,
                      )}
                    </small>
                    {data.permissions.editFinance && (
                      <div className="row-actions">
                        <Button
                          variant="small ghost"
                          onClick={() => open({ type: "refund", record: p })}
                        >
                          {t("Record refund")}
                        </Button>
                        <button
                          className="icon-button danger"
                          aria-label={t("Delete payment entry")}
                          title={t("Delete payment entry")}
                          onClick={() =>
                            remove(
                              `/payments/${p.id}`,
                              "Delete this payment entry? Use this only to fix a mistake.",
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}

export function Reports({
  period,
  setPeriod,
}: {
  period: string;
  setPeriod: (s: string) => void;
}) {
  const { data, t, money, cohort, program, go } = useApp();
  const stats = useStats(period);
  const currency = Array.from(new Set(data.charges.map((c) => c.currency)));
  const sources = Array.from(new Set(stats.leads.map((o) => o.source)));
  const attendance = data.attendance.filter(
    (a) => a.status !== "Excused" && a.starts_at.slice(0, 10) >= stats.start,
  );
  return (
    <>
      <PageHead
        title="Understand what’s working."
        subtitle="Useful numbers, connected to real records."
      >
        <PeriodSelect value={period} onChange={setPeriod} />
      </PageHead>
      <div className="reports-grid">
        {data.permissions.admissions && (
          <Panel
            title="Source performance"
            subtitle="Enrollment conversion uses inquiries created in the selected period."
          >
            <DataTable
              rows={sources.map((s, i) => ({
                id: i,
                source: s,
                leads: stats.leads.filter((o) => o.source === s).length,
                enrolled: stats.leads.filter(
                  (o) => o.source === s && o.stage === "Enrolled",
                ).length,
              }))}
              columns={[
                { key: "source", label: "Source", render: (r) => t(r.source) },
                { key: "leads", label: "Leads" },
                { key: "enrolled", label: "Enrolled" },
                {
                  key: "conversion",
                  label: "Conversion",
                  render: (r) => (
                    <div className="conversion-cell">
                      <div className="progress">
                        <span
                          style={{ width: `${(r.enrolled / r.leads) * 100}%` }}
                        />
                      </div>
                      <strong>
                        {Math.round((r.enrolled / r.leads) * 100)}%
                      </strong>
                    </div>
                  ),
                },
              ]}
            />
          </Panel>
        )}
        {data.permissions.finance && (
          <Panel
            title="Received by currency"
            subtitle="Balances include all open charges. Currencies are never combined."
          >
            <div className="currency-report">
              {currency.map((c) => (
                <div key={c}>
                  <Badge tone="neutral">{c}</Badge>
                  <div>
                    <small>{t("Net received")}</small>
                    <strong>{money(stats.byCurrency(c).received, c)}</strong>
                  </div>
                  <div>
                    <small>{t("Outstanding")}</small>
                    <strong>{money(stats.byCurrency(c).balance, c)}</strong>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel-bottom">
              <LinkButton onClick={() => go("Payments")}>
                {t("Payments")}
              </LinkButton>
            </div>
          </Panel>
        )}
        <Panel title="Cohort occupancy" subtitle="Active students">
          <div className="program-bars">
            {data.cohorts.map((c) => {
              const n = data.enrollments.filter(
                (e) => e.cohort_id === c.id && e.status === "Active",
              ).length;
              return (
                <button key={c.id} onClick={() => go("Programs & Cohorts")}>
                  <div>
                    <span>{c.name}</span>
                    <strong>
                      {n} / {c.capacity}
                    </strong>
                  </div>
                  <div className="progress">
                    <span
                      className={program(c.program_id).color}
                      style={{ width: `${(n / c.capacity) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel
          title="Attendance rate"
          subtitle="Present + late / recorded, excluding excused"
        >
          <div className="attendance-report">
            <div
              className="attendance-donut"
              style={
                {
                  "--percent": `${attendance.length ? (attendance.filter((a) => ["Present", "Late"].includes(a.status)).length / attendance.length) * 100 : 0}%`,
                } as React.CSSProperties
              }
            >
              <span>
                <strong>
                  {attendance.length
                    ? Math.round(
                        (attendance.filter((a) =>
                          ["Present", "Late"].includes(a.status),
                        ).length /
                          attendance.length) *
                          100,
                      )
                    : 0}
                  %
                </strong>
                <small>{t("Attendance")}</small>
              </span>
            </div>
            <div className="attendance-legend">
              {["Present", "Late", "Absent"].map((s, i) => (
                <div key={s}>
                  <i
                    className={`program-dot ${["teal", "amber", "purple"][i]}`}
                  />
                  <span>{t(s)}</span>
                  <strong>
                    {attendance.filter((a) => a.status === s).length}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { data, t, open, perform, toast, date, time, pageFilter, go } =
    useApp();
  const tabs = [
    "Workspace settings",
    "Team & permissions",
    "My account",
    ...(data.permissions.editAdmissions ? ["Message templates"] : []),
    ...(data.permissions.admin ? ["Online booking"] : []),
    ...(data.permissions.admin ? ["Data & import", "Trash"] : []),
    "Integrations",
    "Automation history",
  ];
  const [tab, setTab] = useState(
    tabs.includes(pageFilter) ? pageFilter : "Workspace settings",
  );
  useEffect(() => {
    if (tabs.includes(pageFilter)) setTab(pageFilter);
  }, [pageFilter]);
  const [busy, setBusy] = useState(false);
  async function runRules() {
    setBusy(true);
    try {
      const r = await perform("/automations/run", {});
      toast(`${r.count} ${t("Automation history")}`);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reactivate(u: Row) {
    try {
      await perform(`/users/${u.id}`, { active: true }, "PATCH");
      toast(t("Changes saved"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  const noLogin = (u: Row) => u.email.endsWith("@no-login.local");
  return (
    <>
      <PageHead
        title="Settings"
        subtitle="Your academy, your team, your account and your data."
      />
      <div className="page-tabs">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>
      {tab === "Workspace settings" ? (
        <div className="settings-grid">
          <Panel title="Workspace settings">
            <dl className="settings-list">
              {[
                ["Academy name", data.settings.academy],
                ["Default currency", data.settings.currency],
                ["Time zone", data.settings.timezone],
                [
                  "Default language",
                  ({ ar: "العربية", fr: "Français" } as Record<string, string>)[
                    data.settings.language
                  ] || "English",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {data.permissions.admin && (
              <div className="panel-bottom">
                <Button
                  variant="primary"
                  icon={<Pencil size={16} />}
                  onClick={() =>
                    open({ type: "settings", record: data.settings })
                  }
                >
                  {t("Edit")}
                </Button>
              </div>
            )}
          </Panel>
          <div className="settings-note">
            <span className="large-program-icon teal">
              <Shield size={25} />
            </span>
            <h2>{t(data.hosted ? "Hosted workspace" : "Local workspace")}</h2>
            <p>
              {t(
                data.hosted
                  ? "Changes are saved securely in the cloud."
                  : "All changes are saved locally.",
              )}
            </p>
            <p>
              {t(
                "Balances include all open charges. Currencies are never combined.",
              )}
            </p>
          </div>
        </div>
      ) : tab === "Team & permissions" ? (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t("Team & permissions")}</h2>
              <p>
                {t(
                  "Add advisors, teachers and psychologists. Teachers do not need a login.",
                )}
              </p>
            </div>
            {data.permissions.admin && (
              <Button
                variant="primary"
                icon={<UserPlus size={16} />}
                onClick={() => open({ type: "staff" })}
              >
                {t("Add staff member")}
              </Button>
            )}
          </div>
          <DataTable
            rows={data.users}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (u) => (
                  <span className="person-cell">
                    <Avatar name={u.name} />
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        {noLogin(u) ? t("No login") : u.email}
                        {u.phone ? ` · ${u.phone}` : ""}
                      </small>
                    </span>
                  </span>
                ),
              },
              {
                key: "role",
                label: "Role",
                render: (u) => (
                  <Badge tone={u.role === "admin" ? "teal" : "neutral"}>
                    {t(roleNames[u.role])}
                  </Badge>
                ),
              },
              {
                key: "active",
                label: "Status",
                render: (u) =>
                  u.active === 0 ? (
                    <Badge tone="amber">{t("Deactivated")}</Badge>
                  ) : noLogin(u) ? (
                    <Badge tone="neutral">{t("No login")}</Badge>
                  ) : (
                    <Badge tone="teal">{t("Can sign in")}</Badge>
                  ),
              },
              {
                key: "edit",
                label: "",
                render: (u) =>
                  data.permissions.admin ? (
                    <div className="row-actions">
                      <Button
                        variant="small"
                        icon={<Pencil size={14} />}
                        onClick={() => open({ type: "staff", record: u })}
                      >
                        {t("Edit")}
                      </Button>
                      {u.active !== 0 && u.role !== "finance" && (
                        <Button
                          variant="small"
                          icon={<Clock size={14} />}
                          onClick={() => open({ type: "hours", record: u })}
                        >
                          {t("Hours")}
                          {data.staffHours?.some((h) => h.user_id === u.id)
                            ? ""
                            : " ·"}
                        </Button>
                      )}
                      {u.id !== data.user.id && !noLogin(u) && (
                        <Button
                          variant="small"
                          icon={<KeyRound size={14} />}
                          onClick={() => open({ type: "password", record: u })}
                        >
                          {t("Set password")}
                        </Button>
                      )}
                      {u.active === 0 && (
                        <Button variant="small" onClick={() => reactivate(u)}>
                          {t("Reactivate")}
                        </Button>
                      )}
                    </div>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : tab === "My account" ? (
        <div className="settings-grid">
          <Panel title="My account">
            <dl className="settings-list">
              <div>
                <dt>{t("Full name")}</dt>
                <dd>{data.user.name}</dd>
              </div>
              <div>
                <dt>{t("Email (sign-in)")}</dt>
                <dd>{data.user.email}</dd>
              </div>
              <div>
                <dt>{t("Role")}</dt>
                <dd>{t(roleNames[data.user.role])}</dd>
              </div>
            </dl>
            <div className="panel-bottom">
              <Button
                variant="primary"
                icon={<KeyRound size={16} />}
                onClick={() => open({ type: "account" })}
              >
                {t("Change name, email or password")}
              </Button>
              <Button
                icon={<Clock size={16} />}
                onClick={() =>
                  open({
                    type: "hours",
                    record: data.users.find((u) => u.id === data.user.id),
                  })
                }
              >
                {t("My working hours and time off")}
              </Button>
            </div>
          </Panel>
        </div>
      ) : tab === "Data & import" ? (
        <div className="settings-grid">
          <Panel
            title="Leads from the website / Google"
            subtitle="New requests from your form arrive automatically through n8n."
          >
            <div className="data-actions">
              <div>
                <strong>{(data.incoming || []).length}</strong>
                <span>{t("waiting in the inbox")}</span>
              </div>
              <Button
                variant="primary"
                icon={<Upload size={16} />}
                onClick={() => go("Admissions")}
              >
                {t("Open the inbox")}
              </Button>
            </div>
          </Panel>
          <Panel
            title="Import clients from Excel"
            subtitle="Upload your existing list of clients or students (.xlsx or .csv). Duplicates are skipped."
          >
            <div className="data-actions">
              <span>{t("Name, phone, email, course, level, notes…")}</span>
              <Button
                variant="primary"
                icon={<Upload size={16} />}
                onClick={() => open({ type: "import" })}
              >
                {t("Import from Excel")}
              </Button>
            </div>
          </Panel>
          <Panel
            title="Backups"
            subtitle="A copy of the whole database is saved automatically every day and kept 30 days. You can also download one now."
          >
            <div className="data-actions">
              <span>{t("File type: SQLite database (keep it private).")}</span>
              <Button
                icon={<Database size={16} />}
                onClick={() => window.open("/api/admin/backup", "_self")}
              >
                {t("Download backup")}
              </Button>
            </div>
          </Panel>
          <Panel
            title="Export"
            subtitle="Download your data as spreadsheets (CSV, opens in Excel)."
          >
            <div className="row-actions wrap">
              {[
                ["contacts", "Clients"],
                ["opportunities", "Requests"],
                ["enrollments", "Enrollments"],
                ["charges", "Payments"],
              ].map(([kind, label]) => (
                <Button
                  key={kind}
                  icon={<Download size={15} />}
                  onClick={() => window.open(`/api/export/${kind}`, "_self")}
                >
                  {t(label)}
                </Button>
              ))}
            </div>
          </Panel>
          <Panel
            title="Start fresh"
            subtitle="Remove all example records (fake students, teachers, prices) and keep only your account and real leads."
            className="danger-panel"
          >
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              onClick={() => open({ type: "cleanStart" })}
            >
              {t("Remove all sample data")}
            </Button>
          </Panel>
        </div>
      ) : tab === "Online booking" ? (
        <BookingSettingsPanel />
      ) : tab === "Message templates" ? (
        <TemplatesPanel />
      ) : tab === "Trash" ? (
        <TrashPanel />
      ) : tab === "Integrations" ? (
        <>
          <div className="integration-grid">
            {[
              ["Email", Mail],
              ["WhatsApp", MessageCircle],
              ["Forms", FileText],
              ["Calendar", CalendarDays],
              ["Payments", Wallet],
              ["n8n", Workflow],
            ].map(([name, Icon]: any) => (
              <div key={name} className="panel integration-card">
                <div>
                  <span className="integration-icon">
                    <Icon size={23} />
                  </span>
                  <Badge
                    tone={
                      name === "n8n" && data.n8n?.configured
                        ? "teal"
                        : "neutral"
                    }
                  >
                    {t(
                      name === "n8n" && data.n8n?.configured
                        ? "Ready to receive"
                        : "Not configured",
                    )}
                  </Badge>
                </div>
                <h2>{t(name)}</h2>
                <p>
                  {t(
                    "Provider adapters and credentials are required to enable delivery.",
                  )}
                </p>
                {data.permissions.admin ? (
                  <Button
                    onClick={() => open({ type: "integration", extra: name })}
                  >
                    {t("Connection details")}
                    <ArrowUpRight size={15} />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {data.permissions.admissions && (
            <Panel
              title="Message drafts"
              subtitle="Messaging is not configured. Drafts remain available for review."
            >
              <DataTable
                rows={data.drafts}
                columns={[
                  {
                    key: "subject",
                    label: "Subject",
                    render: (d) => (
                      <button
                        className="cell-link"
                        onClick={() => open({ type: "draftDetail", record: d })}
                      >
                        {d.subject}
                      </button>
                    ),
                  },
                  { key: "channel", label: "Channel" },
                  {
                    key: "status",
                    label: "Status",
                    render: () => <Badge tone="amber">{t("Not sent")}</Badge>,
                  },
                  {
                    key: "created_at",
                    label: "Date",
                    render: (d) => date(d.created_at),
                  },
                ]}
              />
            </Panel>
          )}
        </>
      ) : (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t("Automation history")}</h2>
              <p>{t("No external message has been sent.")}</p>
            </div>
            {data.permissions.admin && (
              <Button
                disabled={busy}
                icon={<RefreshCw size={16} className={busy ? "spin" : ""} />}
                onClick={runRules}
              >
                {t("Run internal rules")}
              </Button>
            )}
          </div>
          <DataTable
            rows={data.automations}
            columns={[
              { key: "rule", label: "Rule" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <Badge
                    tone={
                      r.status === "Success"
                        ? "teal"
                        : r.status === "Error"
                          ? "red"
                          : "amber"
                    }
                  >
                    {t(r.status)}
                  </Badge>
                ),
              },
              { key: "detail", label: "Detail" },
              {
                key: "created_at",
                label: "Date",
                render: (r) => `${date(r.created_at)} · ${time(r.created_at)}`,
              },
            ]}
          />
        </div>
      )}
    </>
  );
}

export function Tasks() {
  const { data, t, open } = useApp();
  const [filter, setFilter] = useState("Open");
  return (
    <>
      <PageHead
        title="Your next steps, in one place."
        subtitle={data.user.role === "admin" ? "All team tasks" : "Your tasks"}
      >
        {data.permissions.write && (
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => open({ type: "task" })}
          >
            {t("New task")}
          </Button>
        )}
      </PageHead>
      <div className="panel tasks-page">
        <Tabs tabs={["Open", "Done"]} value={filter} onChange={setFilter} />
        <TaskRows tasks={data.tasks.filter((t) => t.status === filter)} />
      </div>
    </>
  );
}
