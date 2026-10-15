import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  LoaderCircle,
  Upload,
  Users,
  CalendarDays,
  Clock,
  ArrowRight,
  Shield,
  ExternalLink,
} from "lucide-react";
import { useApp, type ModalData } from "./context";
import { api, ApiError, toInstant, type Row } from "./types";
import { roleNames } from "./i18n";
import { Dialog, Button, Badge, Avatar, Empty, DataTable } from "./ui";

type Field = {
  key: string;
  label: string;
  type?: string;
  options?: [string | number, string][];
  required?: boolean;
  full?: boolean;
  hint?: string;
  min?: string | number;
  max?: string | number;
  step?: string;
  disabled?: boolean;
};
function cents(value: unknown) {
  const s = String(value || "0").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 10000000000)
    throw new Error("Amount is too large.");
  return result;
}
export default function Forms({
  modal,
  onClose,
}: {
  modal: ModalData;
  onClose: () => void;
}) {
  const {
    data,
    t,
    person,
    program,
    cohort,
    user,
    money,
    date,
    time,
    open,
    profile,
    refresh,
    toast,
    perform,
    setLang,
  } = useApp();
  const r = modal.record || ({ id: 0 } as Row),
    c = modal.contact;
  const defaultValues = () => {
    const common: any = {
      contact_id: c?.id || "",
      owner_id: data.user.role === "admin" ? 2 : data.user.id,
      program_id: data.programs[0]?.id || "",
      currency: data.settings.currency,
      language: "English",
      consent: false,
    };
    switch (modal.type) {
      case "inquiry":
        return {
          ...common,
          name: c?.name || "",
          email: c?.email || "",
          phone: c?.phone || "",
          source: "Website",
          campaign: "",
          tags: "",
          expected_date: "",
        };
      case "task":
      case "bulkTask":
        return {
          ...common,
          title: "",
          due_at: `${data.today}T16:00`,
          priority: "Normal",
        };
      case "stage":
        return {
          stage: modal.extra || r.stage,
          owner_id: r.owner_id,
          reason: r.reason || "",
        };
      case "bulkAssign":
        return { owner_id: 2 };
      case "enroll":
        return {
          cohort_id:
            data.cohorts.find((h) => h.program_id === r.program_id)?.id || "",
          due_date: data.today,
          waitlist: true,
        };
      case "note":
      case "consultation":
        return {
          text: "",
          visibility: data.user.role === "finance" ? "finance" : "general",
        };
      case "contact":
        return { ...r, consent: !!r.consent };
      case "payment":
        return {
          charge_id:
            r.id ||
            data.charges.find(
              (ch) => ch.balance > 0 && (!c || ch.contact_id === c.id),
            )?.id ||
            "",
          amount: r.balance ? (r.balance / 100).toFixed(2) : "",
          method: "Bank transfer",
          reference: "",
        };
      case "charge":
        return {
          ...common,
          label: "",
          amount: "",
          discount: "0",
          discount_reason: "",
          due_date: data.today,
        };
      case "refund":
        return { amount: "", reason: "" };
      case "split":
        return {
          dates: `${data.today}, ${new Date(Date.parse(data.today) + 30 * 86400000).toISOString().slice(0, 10)}`,
        };
      case "program":
        return r.id
          ? { ...r, price: (r.price / 100).toFixed(2) }
          : {
              name: "",
              category: "Psychology",
              description: "",
              duration: "8 weeks",
              price: "",
              currency: data.settings.currency,
              color: "teal",
            };
      case "role":
        return { role: r.role };
      case "cohort":
        return {
          ...common,
          name: "",
          instructor_id:
            data.users.find((u) => u.role === "instructor")?.id || "",
          capacity: 12,
          start_date: data.today,
          end_date: new Date(Date.parse(data.today) + 56 * 86400000)
            .toISOString()
            .slice(0, 10),
          room: "",
        };
      case "session":
        return {
          cohort_id: r.cohort_id || data.cohorts[0]?.id || "",
          title: "",
          starts_at: `${data.today}T10:00`,
          ends_at: `${data.today}T11:30`,
          repeat: 1,
          room: "",
        };
      case "settings":
        return { ...r };
      case "flag":
        return { reason: "" };
      case "draft":
        return { channel: "Email", subject: "", body: "" };
      case "saveView":
        return { name: "" };
      case "transfer":
        return {
          cohort_id:
            data.cohorts.find(
              (h) =>
                h.program_id === cohort(r.cohort_id).program_id &&
                h.id !== r.cohort_id,
            )?.id || "",
        };
      default:
        return {};
    }
  };
  const [values, setValues] = useState<any>(defaultValues),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [duplicate, setDuplicate] = useState<Row | null>(null),
    [checkMessage, setCheckMessage] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [attendance, setAttendance] = useState<Record<number, string>>({});
  const keyRef = useRef({ signature: "", key: "" });
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  const close = () => {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          t("You have unsaved changes.") + " " + t("Discard changes") + "?",
        ))
    )
      onClose();
  };
  const set = (key: string, value: any) => {
    setValues((v: any) => ({ ...v, [key]: value }));
    setDirty(true);
    setError("");
  };
  const staffOptions = data.users
    .filter((u) => ["admin", "admissions"].includes(u.role))
    .map((u) => [u.id, u.name] as [number, string]);
  const contacts = data.contacts.map((c) => [c.id, c.name] as [number, string]);
  const programs = data.programs.map(
    (p) => [p.id, t(p.name)] as [number, string],
  );
  const textField = (
    key: string,
    label: string,
    extra: Partial<Field> = {},
  ): Field => ({ key, label, required: true, ...extra });
  const select = (
    key: string,
    label: string,
    options: [string | number, string][],
    extra: Partial<Field> = {},
  ): Field => ({
    key,
    label,
    type: "select",
    options,
    required: true,
    ...extra,
  });
  let title = "",
    button = "Save",
    fields: Field[] = [];
  switch (modal.type) {
    case "inquiry":
      title = "New inquiry";
      button = "Create inquiry";
      fields = [
        textField("name", "Full name"),
        textField("email", "Email", { type: "email" }),
        textField("phone", "Phone", { type: "tel", required: false }),
        select("program_id", "Program of interest", programs),
        select("owner_id", "Assign advisor", staffOptions),
        select(
          "source",
          "Source",
          ["Website", "Instagram", "WhatsApp", "Referral", "Walk-in"].map(
            (s) => [s, t(s)],
          ),
        ),
        textField("expected_date", "Expected enrollment", {
          type: "date",
          required: false,
        }),
        select("language", "Preferred language", [
          ["English", "English"],
          ["العربية", "العربية"],
        ]),
        textField("campaign", "Campaign", { required: false }),
        textField("tags", "Tags", { required: false }),
        {
          key: "consent",
          label: "Communication consent",
          type: "checkbox",
          hint: "Permission to prepare outbound messages",
          full: true,
        },
      ];
      break;
    case "task":
    case "bulkTask":
      title = "Schedule follow-up";
      fields = [
        textField("title", "Title", { full: true }),
        ...(modal.type === "task"
          ? [select("contact_id", "Contact", contacts, { required: false })]
          : []),
        ...(data.user.role === "admin"
          ? [
              select(
                "owner_id",
                "Owner",
                data.users
                  .filter((u) => u.role !== "manager")
                  .map((u) => [u.id, u.name]),
              ),
            ]
          : []),
        textField("due_at", "Due time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        select("priority", "Priority", [
          ["Normal", t("Normal")],
          ["High", t("High")],
        ]),
      ];
      break;
    case "stage":
      title = "Update stage";
      fields = [
        select(
          "stage",
          "Stage",
          data.stages
            .filter((s) => s !== "Enrolled" || r.stage === "Enrolled")
            .map((s) => [s, t(s)]),
        ),
        select("owner_id", "Advisor", staffOptions),
        textField("reason", "Outcome reason", {
          type: "textarea",
          full: true,
          required: ["Lost", "Nurture"].includes(values.stage),
        }),
      ];
      break;
    case "bulkAssign":
      title = "Assign advisor";
      fields = [select("owner_id", "Advisor", staffOptions, { full: true })];
      break;
    case "enroll":
      title = "Enroll in cohort";
      button = "Confirm enrollment";
      fields = [
        select(
          "cohort_id",
          "Choose a cohort",
          data.cohorts
            .filter((h) => h.program_id === r.program_id)
            .map((h) => {
              const used = data.enrollments.filter(
                (e) => e.cohort_id === h.id && e.status === "Active",
              ).length;
              return [
                h.id,
                `${h.name} · ${used}/${h.capacity} ${t("students")}`,
              ];
            }),
          { full: true },
        ),
        textField("due_date", "Payment due date", { type: "date", full: true }),
        {
          key: "waitlist",
          label: "Add to waitlist if full",
          type: "checkbox",
          full: true,
        },
      ];
      break;
    case "note":
    case "consultation":
      title =
        modal.type === "consultation" ? "Record consultation" : "Add note";
      fields = [
        textField(
          "text",
          modal.type === "consultation" ? "Consultation notes" : "Note",
          { type: "textarea", full: true },
        ),
        select(
          "visibility",
          "Visibility",
          [
            ["general", t("General staff")],
            ...(data.permissions.admissions
              ? [["internal", t("Admissions only")] as [string, string]]
              : []),
            ...(data.permissions.finance
              ? [["finance", t("Finance only")] as [string, string]]
              : []),
          ],
          { full: true },
        ),
      ];
      break;
    case "contact":
      title = "Edit details";
      fields = [
        textField("name", "Full name"),
        textField("phone", "Phone", { required: false }),
        select("language", "Preferred language", [
          ["English", "English"],
          ["العربية", "العربية"],
          ["French", "Français"],
        ]),
        textField("guardian", "Guardian or sponsor", { required: false }),
        {
          key: "consent",
          label: "Communication consent",
          type: "checkbox",
          full: true,
        },
      ];
      break;
    case "payment":
      title = "Record payment";
      button = "Record payment";
      fields = [
        select(
          "charge_id",
          "Charge",
          data.charges
            .filter((ch) => ch.balance > 0 && (!c || ch.contact_id === c.id))
            .map((ch) => [
              ch.id,
              `${person(ch.contact_id).name} · ${ch.label} · ${money(ch.balance, ch.currency)}`,
            ]),
          { full: true },
        ),
        textField("amount", "Amount", {
          type: "number",
          min: "0.01",
          step: "0.01",
        }),
        select(
          "method",
          "Payment method",
          ["Bank transfer", "Cash", "Card (external)"].map((s) => [s, t(s)]),
        ),
        textField("reference", "Reference", { required: false, full: true }),
      ];
      break;
    case "charge":
      title = "Add charge";
      fields = [
        select("contact_id", "Contact", contacts, { full: true }),
        textField("label", "Description", { full: true }),
        textField("amount", "Amount", {
          type: "number",
          step: "0.01",
          min: "0.01",
        }),
        select(
          "currency",
          "Currency",
          ["DZD", "EUR", "USD", "GBP"].map((s) => [s, s]),
        ),
        textField("due_date", "Due date", { type: "date" }),
        textField("discount", "Discount", {
          type: "number",
          step: "0.01",
          min: 0,
        }),
        textField("discount_reason", "Discount reason", {
          required: Number(values.discount) > 0,
          full: true,
        }),
      ];
      break;
    case "refund":
      title = "Record refund";
      button = "Record refund";
      fields = [
        textField("amount", "Refund amount", {
          type: "number",
          min: "0.01",
          step: "0.01",
          full: true,
        }),
        textField("reason", "Refund reason", { type: "textarea", full: true }),
      ];
      break;
    case "split":
      title = "Split into installments";
      fields = [
        textField("dates", "Installment dates", {
          type: "textarea",
          full: true,
          hint: "Separate dates with commas. Total stays unchanged.",
        }),
      ];
      break;
    case "program":
      title = "New program";
      button = "Create program";
      fields = [
        textField("name", "Program name", { full: true }),
        select(
          "category",
          "Category",
          ["Psychology", "Languages", "Training"].map((s) => [s, t(s)]),
        ),
        textField("duration", "Duration"),
        textField("description", "Description", {
          type: "textarea",
          required: false,
          full: true,
        }),
        textField("price", "Tuition", { type: "number", min: 0, step: "0.01" }),
        select(
          "currency",
          "Currency",
          ["DZD", "EUR", "USD", "GBP"].map((s) => [s, s]),
        ),
      ];
      break;
    case "cohort":
      title = "New cohort";
      button = "Create cohort";
      fields = [
        textField("name", "Cohort name", { full: true }),
        select("program_id", "Program", programs),
        select(
          "instructor_id",
          "Instructor",
          data.users
            .filter((u) => u.role === "instructor")
            .map((u) => [u.id, u.name]),
        ),
        textField("capacity", "Capacity", { type: "number", min: 1, max: 500 }),
        textField("room", "Room or meeting link"),
        textField("start_date", "Start date", { type: "date" }),
        textField("end_date", "End date", { type: "date" }),
      ];
      break;
    case "session":
      title = "Schedule session";
      button = "Schedule session";
      fields = [
        select(
          "cohort_id",
          "Cohort",
          data.cohorts.map((h) => [h.id, h.name]),
          { full: true },
        ),
        textField("title", "Session title", { full: true }),
        textField("starts_at", "Start time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        textField("ends_at", "End time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        textField("room", "Room", {
          required: false,
          hint: cohort(Number(values.cohort_id)).room,
        }),
        textField("repeat", "Weekly occurrences", {
          type: "number",
          min: 1,
          max: 16,
        }),
      ];
      break;
    case "settings":
      title = "Workspace settings";
      button = "Save settings";
      fields = [
        textField("academy", "Academy name", { full: true }),
        select(
          "currency",
          "Default currency",
          ["DZD", "EUR", "USD", "GBP"].map((s) => [s, s]),
        ),
        textField("timezone", "Time zone"),
        select(
          "language",
          "Default language",
          [
            ["en", "English"],
            ["ar", "العربية"],
          ],
          { full: true },
        ),
      ];
      break;
    case "flag":
      title = "Review attention flag";
      button = "Mark reviewed";
      fields = [
        textField("reason", "Resolution note", {
          type: "textarea",
          full: true,
        }),
      ];
      break;
    case "draft":
      title = "Draft message";
      button = "Save draft";
      fields = [
        select(
          "channel",
          "Channel",
          [
            ["Email", t("Email")],
            ["WhatsApp", "WhatsApp"],
          ],
          { full: true },
        ),
        textField("subject", "Subject", { full: true }),
        textField("body", "Message", { type: "textarea", full: true }),
      ];
      break;
    case "saveView":
      title = "Save view";
      fields = [textField("name", "View name", { full: true })];
      break;
    case "role":
      title = "Team & permissions";
      fields = [
        select(
          "role",
          "Staff",
          Object.entries(roleNames).map(([key, value]) => [key, t(value)]),
          { full: true },
        ),
      ];
      break;
    case "transfer":
      title = "Move student to another cohort";
      fields = [
        select(
          "cohort_id",
          "Cohort",
          data.cohorts
            .filter(
              (h) =>
                h.program_id === cohort(r.cohort_id).program_id &&
                h.id !== r.cohort_id,
            )
            .map((h) => [h.id, h.name]),
          { full: true },
        ),
      ];
      break;
    case "document":
      title = "Upload document";
      button = "Upload document";
      break;
  }
  if (modal.type === "program" && r.id) {
    title = "Edit details";
    button = "Save";
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let path = "",
        body: any = values,
        method = "POST";
      switch (modal.type) {
        case "inquiry":
          path = "/opportunities";
          break;
        case "task":
          path = "/tasks";
          body = {
            ...values,
            due_at: toInstant(values.due_at, data.settings.timezone),
          };
          break;
        case "bulkTask":
          path = "/tasks/bulk";
          body = {
            ...values,
            opportunity_ids: modal.extra.map((o: Row) => o.id),
            due_at: toInstant(values.due_at, data.settings.timezone),
          };
          break;
        case "stage":
          path = `/opportunities/${r.id}`;
          body = { ...values, version: r.version };
          method = "PATCH";
          break;
        case "bulkAssign":
          path = "/opportunities/bulk/assign";
          body = { ...values, ids: modal.extra };
          break;
        case "enroll":
          path = "/enroll";
          body = { ...values, opportunity_id: r.id, version: r.version };
          break;
        case "note":
        case "consultation":
          path = "/notes";
          body = {
            ...values,
            contact_id: c?.id,
            kind: modal.type === "consultation" ? "consultation" : "note",
          };
          break;
        case "contact":
          path = `/contacts/${r.id}`;
          method = "PATCH";
          break;
        case "payment":
          path = "/payments";
          body = { ...values, amount: cents(values.amount) };
          break;
        case "charge":
          path = "/charges";
          body = {
            ...values,
            amount: cents(values.amount),
            discount: cents(values.discount),
          };
          break;
        case "refund":
          path = "/refunds";
          body = { ...values, payment_id: r.id, amount: cents(values.amount) };
          break;
        case "split":
          path = `/charges/${r.id}/split`;
          body = {
            dates: values.dates
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean),
          };
          break;
        case "program":
          path = r.id ? `/programs/${r.id}` : "/programs";
          body = { ...values, price: cents(values.price) };
          method = r.id ? "PATCH" : "POST";
          break;
        case "role":
          path = `/users/${r.id}/role`;
          method = "PATCH";
          break;
        case "cohort":
          path = "/cohorts";
          break;
        case "session":
          path = "/sessions";
          body = {
            ...values,
            starts_at: toInstant(values.starts_at, data.settings.timezone),
            ends_at: toInstant(values.ends_at, data.settings.timezone),
          };
          break;
        case "settings":
          path = "/settings";
          break;
        case "flag":
          path = "/flags/resolve";
          body = { ...values, contact_id: c?.id, kind: modal.extra.kind };
          break;
        case "draft":
          path = "/drafts";
          body = { ...values, contact_id: c?.id };
          break;
        case "saveView":
          path = "/saved-views";
          body = { name: values.name, filters: modal.extra };
          break;
        case "transfer":
          path = `/enrollments/${r.id}`;
          method = "PATCH";
          break;
        case "document": {
          if (!file) throw new Error("Choose a file to upload.");
          if (file.size > (data.maxDocumentMb || 4) * 1024 * 1024)
            throw new Error(
              `File exceeds the ${data.maxDocumentMb || 4} MB limit.`,
            );
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          path = "/documents";
          body = {
            contact_id: c?.id,
            name: file.name,
            mime: file.type || "text/plain",
            base64,
          };
          break;
        }
      }
      const signature = path + JSON.stringify(body);
      if (keyRef.current.signature !== signature)
        keyRef.current = { signature, key: crypto.randomUUID() };
      const result = await api(path, body, method, keyRef.current.key);
      await refresh();
      if (modal.type === "settings") setLang(values.language);
      toast(
        t(
          result.waitlisted
            ? "Waitlisted"
            : modal.type === "inquiry"
              ? "Inquiry created"
              : "Changes saved",
        ),
      );
      onClose();
    } catch (e: any) {
      setError(e.message);
      if (e instanceof ApiError && e.details.duplicate)
        setDuplicate(e.details.duplicate);
    } finally {
      setBusy(false);
    }
  }

  if (modal.type === "sessionDetail") {
    const session = r;
    const h = cohort(session.cohort_id);
    const students = data.enrollments
      .filter((e) => e.cohort_id === h.id && e.status === "Active")
      .map((e) => person(e.contact_id));
    const existing = data.attendance.filter((a) => a.session_id === session.id);
    async function saveAttendance() {
      setBusy(true);
      setError("");
      try {
        const records = students.map((c) => ({
          contact_id: c.id,
          status:
            attendance[c.id] ||
            existing.find((a) => a.contact_id === c.id)?.status ||
            "",
        }));
        if (records.some((r) => !r.status))
          throw new Error("Choose an attendance status for every student.");
        await perform("/attendance", { session_id: session.id, records });
        toast(t("Changes saved"));
        onClose();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    }
    return (
      <Dialog title={session.title} onClose={close} wide>
        <div className="detail-content">
          <Badge tone={program(h.program_id).color}>{h.name}</Badge>
          <div className="detail-meta">
            <span>
              <CalendarDays size={16} />
              {date(session.starts_at, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <span>
              <Clock size={16} />
              {time(session.starts_at)}–{time(session.ends_at)}
            </span>
            <span>
              {session.room} · {data.settings.timezone}
            </span>
          </div>
          <div className="section-label">
            <h3>{t("Attendance")}</h3>
            <Badge tone="neutral">
              {students.length} {t("students")}
            </Badge>
          </div>
          <div className="attendance-roster">
            {students.map((c) => (
              <div key={c.id}>
                <Avatar name={c.name} />
                <strong>{c.name}</strong>
                <select
                  disabled={
                    !data.permissions.attendance ||
                    Date.parse(session.starts_at) > Date.now()
                  }
                  aria-label={`${t("Attendance")}: ${c.name}`}
                  value={
                    attendance[c.id] ||
                    existing.find((a) => a.contact_id === c.id)?.status ||
                    ""
                  }
                  onChange={(e) => {
                    setAttendance({ ...attendance, [c.id]: e.target.value });
                    setDirty(true);
                  }}
                >
                  <option value="">{t("Choose…")}</option>
                  {["Present", "Absent", "Late", "Excused"].map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {!students.length && (
            <Empty title="No active students in this cohort." text="" />
          )}
          {Date.parse(session.starts_at) > Date.now() && (
            <p className="form-hint">
              {t("Attendance is available after the session starts.")}
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          {data.permissions.editAcademic && existing.length === 0 && (
            <Button
              variant="danger-ghost"
              onClick={async () => {
                if (!window.confirm(t("Cancel session") + "?")) return;
                try {
                  await perform(`/sessions/${r.id}/cancel`, {});
                  onClose();
                  toast(t("Changes saved"));
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              {t("Cancel session")}
            </Button>
          )}
          <Button onClick={close}>{t("Close")}</Button>
          {data.permissions.attendance && (
            <Button
              variant="primary"
              disabled={
                busy ||
                !students.length ||
                Date.parse(session.starts_at) > Date.now()
              }
              onClick={saveAttendance}
            >
              {t("Save attendance")}
            </Button>
          )}
        </div>
      </Dialog>
    );
  }
  if (modal.type === "cohortDetail") {
    const students = data.enrollments.filter(
      (e) => e.cohort_id === r.id && e.status === "Active",
    );
    return (
      <Dialog title={r.name} onClose={onClose} wide>
        <div className="detail-content">
          <div className="detail-meta">
            <Badge tone={program(r.program_id).color}>
              {t(program(r.program_id).name)}
            </Badge>
            <span>{user(r.instructor_id).name}</span>
            <span>{r.room}</span>
          </div>
          <div className="cohort-summary">
            <strong>
              {students.length} / {r.capacity}
            </strong>
            <span>{t("Capacity")}</span>
            <Badge tone={students.length >= r.capacity ? "amber" : "teal"}>
              {students.length >= r.capacity
                ? t("Full")
                : `${r.capacity - students.length} ${t("spots available")}`}
            </Badge>
          </div>
          <h3>{t("Students")}</h3>
          {students.map((e) => (
            <button
              className="roster-link"
              key={e.id}
              onClick={() => {
                onClose();
                profile(e.contact_id);
              }}
            >
              <Avatar name={person(e.contact_id).name} />
              <strong>{person(e.contact_id).name}</strong>
              <ArrowRight size={16} />
            </button>
          ))}
          {!students.length && <Empty title="No records yet" />}
          <h3>{t("Upcoming")}</h3>
          {data.sessions
            .filter(
              (s) =>
                s.cohort_id === r.id &&
                s.status === "Scheduled" &&
                s.starts_at > new Date().toISOString(),
            )
            .slice(0, 5)
            .map((s) => (
              <button
                className="roster-link"
                key={s.id}
                onClick={() => open({ type: "sessionDetail", record: s })}
              >
                <CalendarDays size={20} />
                <span>
                  <strong>{s.title}</strong>
                  <small className="block muted">
                    {date(s.starts_at)} · {time(s.starts_at)}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
        </div>
      </Dialog>
    );
  }
  if (modal.type === "integration")
    return (
      <Dialog
        title={`${modal.extra} · ${t("Connection details")}`}
        onClose={onClose}
      >
        <div className="detail-content">
          <Badge
            tone={
              modal.extra === "n8n" && data.n8n?.configured ? "teal" : "neutral"
            }
          >
            {t(
              modal.extra === "n8n" && data.n8n?.configured
                ? "Ready to receive"
                : "Not configured",
            )}
          </Badge>
          <h3>
            {t(
              "Provider adapters and credentials are required to enable delivery.",
            )}
          </h3>
          <p className="muted">{t("No external message has been sent.")}</p>
          <div className="integration-requirements">
            {modal.extra === "n8n"
              ? t(
                  "n8n sends new inquiries to the CRM intake endpoint. Configure the same dedicated token in Vercel and the n8n Bearer Auth credential. Incoming inquiries create review tasks; choose their program and advisor in Admissions.",
                )
              : modal.extra === "WhatsApp"
                ? "Required: a WhatsApp Business provider adapter, phone number ID, access token, webhook verification, and approved templates."
                : modal.extra === "Email"
                  ? "Required: an email provider adapter, verified sending domain, server-side API key, bounce handling, and consent checks."
                  : modal.extra === "Payments"
                    ? "Required: a payment provider adapter, signed webhooks, currency support, and reconciliation rules."
                    : modal.extra === "Calendar"
                      ? "Required: a calendar provider adapter, OAuth credentials, staff mapping, and conflict reconciliation."
                      : "Required: a signed form submission endpoint, field mapping, spam protection, and duplicate detection."}
          </div>
          {checkMessage && (
            <div role="alert" className="form-error">
              {checkMessage}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <Button onClick={onClose}>{t("Close")}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await perform(
                  `/integrations/${modal.extra}/check`,
                  {},
                );
                setCheckMessage(result.message);
              } catch (e: any) {
                setCheckMessage(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Check connection")}
          </Button>
        </div>
      </Dialog>
    );
  if (modal.type === "draftDetail")
    return (
      <Dialog title={r.subject} onClose={onClose}>
        <div className="detail-content">
          <Badge tone="amber">
            {t("Draft")} · {t("Not sent")}
          </Badge>
          <p>
            {person(r.contact_id).name} · {r.channel}
          </p>
          <div className="message-body">{r.body}</div>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={t(title)}
      onClose={close}
      wide={[
        "inquiry",
        "cohort",
        "program",
        "session",
        "task",
        "charge",
      ].includes(modal.type)}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          {c && (
            <div className="form-person">
              <Avatar name={c.name} />
              <div>
                <strong>{c.name}</strong>
                <small>{c.email}</small>
              </div>
            </div>
          )}
          {modal.type === "enroll" && (
            <div className="info-box">
              <GraduationCapIcon />
              <span>
                {t(program(r.program_id).name)} ·{" "}
                {money(
                  program(r.program_id).price,
                  program(r.program_id).currency,
                )}
              </span>
            </div>
          )}
          {["payment", "refund", "charge", "split"].includes(modal.type) && (
            <div className="info-box">
              <Shield size={17} />
              <span>{t("Manual record only. No money is moved.")}</span>
            </div>
          )}
          {modal.type === "draft" && (
            <div className="info-box">
              <AlertCircle size={17} />
              {t(
                "Messaging is not configured. Drafts remain available for review.",
              )}
            </div>
          )}
          <div className="form-grid">
            {fields.map((f) => (
              <label
                key={f.key}
                className={`${f.full ? "full-field" : ""} ${f.type === "checkbox" ? "checkbox-label" : ""}`}
              >
                {f.type === "checkbox" ? (
                  <>
                    <input
                      type="checkbox"
                      checked={!!values[f.key]}
                      onChange={(e) => set(f.key, e.target.checked)}
                    />
                    <span>
                      {t(f.label)}
                      {f.hint && <small>{t(f.hint)}</small>}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {t(f.label)}
                      {f.required && <span className="required-dot">*</span>}
                    </span>
                    {f.type === "select" ? (
                      <select
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        required={f.required}
                        disabled={f.disabled}
                      >
                        <option value="">{t("Choose…")}</option>
                        {f.options?.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        rows={4}
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        required={f.required}
                        maxLength={f.key === "body" ? 5000 : 4000}
                      />
                    ) : (
                      <input
                        type={f.type || "text"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        required={f.required}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        maxLength={f.type ? undefined : 300}
                        disabled={f.disabled}
                      />
                    )}{" "}
                    {f.hint && <small className="form-hint">{t(f.hint)}</small>}
                  </>
                )}
              </label>
            ))}
          </div>
          {modal.type === "document" && (
            <label className="upload-box">
              <Upload size={28} />
              <strong>{t("Upload document")}</strong>
              <span>
                {t(
                  data.hosted
                    ? "PDF, PNG, JPEG, or TXT. Up to 3 MB."
                    : "PDF, PNG, JPEG, or TXT. Up to 4 MB.",
                )}
              </span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                required
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setDirty(true);
                }}
              />
            </label>
          )}
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          )}
          {duplicate && (
            <div className="duplicate-card">
              <Avatar name={duplicate.name} />
              <div>
                <strong>{duplicate.name}</strong>
                <small>{duplicate.email}</small>
              </div>
              <Button
                type="button"
                onClick={() => {
                  setValues({
                    ...values,
                    contact_id: duplicate.id,
                    name: duplicate.name,
                    email: duplicate.email,
                    phone: duplicate.phone,
                  });
                  setDuplicate(null);
                  setError("");
                  setDirty(true);
                }}
              >
                {t("Reuse this contact")}
              </Button>
            </div>
          )}
          {values.contact_id && modal.type === "inquiry" && (
            <p className="form-hint teal-text">
              {t("No duplicate contact will be created.")}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <Button type="button" onClick={close} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            icon={
              busy ? <LoaderCircle size={17} className="spin" /> : undefined
            }
          >
            {t(busy ? "Saving…" : button)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function GraduationCapIcon() {
  return <Users size={18} />;
}
