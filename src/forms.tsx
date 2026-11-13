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
import { WhatsAppDialog, ImportDialog } from "./tools";
import { HoursDialog } from "./schedule";
import { PayLinkDialog, PortalLinkDialog } from "./growth";
import {
  HelpDialog,
  IntakeDialog,
  IntakeQuestionsDialog,
  MarkSheetDialog,
} from "./academy";

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
  suggestions?: string[];
};
/** Show a stored instant as a wall-clock value in the academy time zone. */
export function toLocalInput(iso: string, zone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .replace(" ", "T");
}
const unique = (items: string[]) =>
  Array.from(new Set(items.map((x) => (x || "").trim()).filter(Boolean)));
export const appointmentKinds = [
  "Psychology consultation",
  "Consultation",
  "Trial lesson",
  "Placement test",
  "Meeting",
  "Exam",
  "Other",
];
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
    const zone = data.settings.timezone;
    const common: any = {
      contact_id: c?.id || "",
      owner_id: data.user.id,
      program_id: data.programs[0]?.id || "",
      currency: data.settings.currency,
      language: "العربية",
      consent: false,
    };
    switch (modal.type) {
      case "inquiry":
        return {
          ...common,
          name: c?.name || "",
          email: c?.email || "",
          phone: c?.phone || "",
          service_type: modal.extra?.service_type || "",
          interest: "",
          source: "",
          campaign: "",
          tags: "",
          notes: "",
          expected_date: "",
        };
      case "request":
        return {
          service_type: r.service_type || "",
          interest: r.interest || program(r.program_id).name || "",
          program_id: r.program_id || "",
          owner_id: r.owner_id,
          source: r.source || "",
          expected_date: r.expected_date || "",
          notes: r.notes || "",
        };
      case "client":
        return {
          name: "",
          phone: "",
          email: "",
          language: "العربية",
          guardian: "",
          notes: "",
          consent: false,
        };
      case "task":
      case "bulkTask":
        return r.id
          ? {
              title: r.title,
              contact_id: r.contact_id || "",
              owner_id: r.owner_id,
              due_at: toLocalInput(r.due_at, zone),
              priority: r.priority,
            }
          : {
              ...common,
              title: "",
              due_at: `${data.today}T16:00`,
              priority: "Normal",
            };
      case "appointment":
        return r.id
          ? {
              ...r,
              contact_id: r.contact_id || "",
              staff_id: r.staff_id || "",
              package_id: r.package_id || "",
              online: !!r.meeting_url,
              meeting_url: r.meeting_url || "",
              session_note:
                (data.sessionNotes || []).find((n) => n.appointment_id === r.id)
                  ?.text || "",
              starts_at: toLocalInput(r.starts_at, zone),
              ends_at: toLocalInput(r.ends_at, zone),
            }
          : (() => {
              const day = modal.extra?.day || data.today;
              const start = modal.extra?.time || "10:00";
              const [h, m] = start.split(":").map(Number);
              const endMin = Math.min(h * 60 + m + 60, 23 * 60 + 59);
              const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
              const pack = c
                ? (data.packages || []).find(
                    (p) =>
                      p.contact_id === c.id &&
                      p.status === "Active" &&
                      p.used + p.booked < p.sessions_total,
                  )
                : null;
              return {
                kind: modal.extra?.kind || "Psychology consultation",
                title: modal.extra?.title || (pack ? pack.title : ""),
                contact_id: c?.id || "",
                staff_id: data.user.id,
                package_id: pack?.id || "",
                starts_at: `${day}T${start}`,
                ends_at: `${day}T${end}`,
                location: "",
                notes: "",
                status: "Scheduled",
                repeat: 1,
              };
            })();
      case "staff":
        return r.id
          ? {
              name: r.name,
              email: r.email.endsWith("@no-login.local") ? "" : r.email,
              phone: r.phone || "",
              role: r.role,
            }
          : {
              name: "",
              email: "",
              phone: "",
              role: modal.extra?.role || "instructor",
              password: "",
            };
      case "password":
        return { password: "" };
      case "account":
        return {
          name: data.user.name,
          email: data.user.email,
          current_password: "",
          new_password: "",
        };
      case "cleanStart":
        return { confirm: "" };
      case "stage":
        return {
          stage: modal.extra || r.stage,
          owner_id: r.owner_id,
          reason: r.reason || "",
        };
      case "bulkAssign":
        return { owner_id: data.user.id };
      case "enroll":
        return {
          cohort_id:
            data.cohorts.find(
              (h) => !r.program_id || h.program_id === r.program_id,
            )?.id || "",
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
        return {
          ...r,
          notes: r.notes || "",
          level: r.level || "",
          consent: !!r.consent,
        };
      case "package":
        return r.id
          ? {
              title: r.title,
              sessions_total: r.sessions_total,
              status: r.status,
              plan: r.plan || "",
            }
          : {
              title: "",
              sessions_total: 5,
              price: "",
              currency: data.settings.currency,
              due_date: data.today,
            };
      case "template":
        return r.id ? { name: r.name, body: r.body } : { name: "", body: "" };
      case "placement":
        return {
          test_name: "Placement test",
          score: "",
          max_score: "",
          level: c?.level || "",
          taken_on: data.today,
          notes: "",
        };
      case "grade":
        return { title: "", score: "", max_score: 20, taken_on: data.today };
      case "promote":
        return { cohort_id: "", level: c?.level || "", charge: true };
      case "pay":
        return {
          pay_mode: r.pay_mode || "hour",
          pay_rate: r.pay_rate ? (r.pay_rate / 100).toFixed(2) : "",
        };
      case "bookingService":
        return r.id
          ? { ...r, active: !!r.active, online: !!r.online }
          : {
              name: "",
              kind: "Psychology consultation",
              duration_min: 60,
              description: "",
              staff_ids: [],
              active: true,
            };
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
        if (r.id)
          return {
            label: r.label,
            amount: (r.amount / 100).toFixed(2),
            due_date: r.due_date,
          };
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
              name: modal.extra?.name || "",
              category: "",
              description: "",
              duration: "",
              price: "",
              currency: data.settings.currency,
              color: "teal",
            };
      case "role":
        return { role: r.role };
      case "cohort":
        if (r.id)
          return {
            ...r,
            instructor_name: r.instructor_id ? user(r.instructor_id).name : "",
          };
        return {
          ...common,
          program_id: modal.extra?.program_id || common.program_id,
          name: "",
          instructor_name: "",
          capacity: 12,
          start_date: data.today,
          end_date: new Date(Date.parse(data.today) + 56 * 86400000)
            .toISOString()
            .slice(0, 10),
          room: "",
        };
      case "session":
        if (r.id)
          return {
            title: r.title,
            starts_at: toLocalInput(r.starts_at, zone),
            ends_at: toLocalInput(r.ends_at, zone),
            room: r.room || "",
          };
        return {
          cohort_id: r.cohort_id || data.cohorts[0]?.id || "",
          title: "",
          starts_at: `${data.today}T10:00`,
          ends_at: `${data.today}T11:30`,
          repeat: 1,
          room: "",
        };
      case "expense":
        return {
          spent_on: data.today,
          category: "",
          label: "",
          amount: "",
          currency: data.settings.currency,
        };
      case "legal":
        return {
          legal_name: data.settings.legal_name || "",
          legal_address: data.settings.legal_address || "",
          legal_nif: data.settings.legal_nif || "",
          legal_rc: data.settings.legal_rc || "",
          legal_nis: data.settings.legal_nis || "",
          legal_ai: data.settings.legal_ai || "",
          legal_rib: data.settings.legal_rib || "",
          vat_rate: String(data.settings.vat_rate ?? 0),
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
  const overlapRef = useRef(false);
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
  const activeUsers = data.users.filter((u) => u.active !== 0);
  const staffOptions = activeUsers
    .filter((u) => ["admin", "admissions"].includes(u.role))
    .map((u) => [u.id, u.name] as [number, string]);
  const suggestions = {
    service: unique([
      ...(data.serviceTypes || []),
      ...data.opportunities.map((o) => o.service_type),
    ]),
    interest: unique([
      ...data.programs.map((p) => p.name),
      ...data.opportunities.map((o) => o.interest),
      ...(data.incoming || []).map((i) => i.course_interest),
    ]),
    source: unique([
      "Website",
      "Google form",
      "Instagram",
      "Facebook",
      "WhatsApp",
      "Phone call",
      "Referral",
      "Walk-in",
      ...data.opportunities.map((o) => o.source),
    ]),
    language: unique([
      "العربية",
      "Français",
      "English",
      ...data.contacts.map((c) => c.language),
    ]),
    category: unique([
      "Psychology",
      "Languages",
      "Training",
      ...data.programs.map((p) => p.category),
    ]),
    teacher: unique(
      activeUsers
        .filter((u) => ["instructor", "academic"].includes(u.role))
        .map((u) => u.name),
    ),
    duration: unique([
      "4 weeks",
      "8 weeks",
      "12 weeks",
      "3 months",
      "6 months",
      ...data.programs.map((p) => p.duration),
    ]),
    room: unique([
      ...data.cohorts.map((h) => h.room),
      ...(data.appointments || []).map((a) => a.location),
    ]),
    kind: unique([
      ...appointmentKinds,
      ...(data.appointments || []).map((a) => a.kind),
    ]),
  };
  const combo = (
    key: string,
    label: string,
    list: string[],
    extra: Partial<Field> = {},
  ): Field => ({
    key,
    label,
    type: "combo",
    suggestions: list,
    required: true,
    ...extra,
  });
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
    fields: Field[] = [],
    sessionNoteField = false;
  switch (modal.type) {
    case "inquiry":
      title = "New client request";
      button = "Save request";
      fields = [
        textField("name", "Full name", { disabled: !!c }),
        textField("phone", "Phone", {
          type: "tel",
          required: false,
          disabled: !!c,
          hint: "Phone or email is enough",
        }),
        textField("email", "Email", {
          type: "email",
          required: false,
          disabled: !!c,
        }),
        combo(
          "service_type",
          "What does the client want?",
          suggestions.service,
          {
            hint: "Choose or type your own",
          },
        ),
        combo("interest", "Course, language or topic", suggestions.interest, {
          hint: "Type any name, even if it is not in Programs",
        }),
        select("owner_id", "Responsible person", staffOptions),
        combo("source", "Where did they find us?", suggestions.source, {
          required: false,
        }),
        ...(!c
          ? [combo("language", "Preferred language", suggestions.language)]
          : []),
        textField("expected_date", "Expected start", {
          type: "date",
          required: false,
        }),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
        ...(!c
          ? [
              {
                key: "consent",
                label: "Communication consent",
                type: "checkbox",
                hint: "Permission to prepare outbound messages",
                full: true,
              } as Field,
            ]
          : []),
      ];
      break;
    case "request":
      title = "Edit request";
      fields = [
        combo(
          "service_type",
          "What does the client want?",
          suggestions.service,
        ),
        combo("interest", "Course, language or topic", suggestions.interest),
        select("program_id", "Linked program (optional)", programs, {
          required: false,
        }),
        select("owner_id", "Responsible person", staffOptions),
        combo("source", "Where did they find us?", suggestions.source),
        textField("expected_date", "Expected start", {
          type: "date",
          required: false,
        }),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
      ];
      break;
    case "client":
      title = "Add client";
      button = "Save client";
      fields = [
        textField("name", "Full name"),
        textField("phone", "Phone", {
          type: "tel",
          required: false,
          hint: "Phone or email is enough",
        }),
        textField("email", "Email", { type: "email", required: false }),
        combo("language", "Preferred language", suggestions.language),
        textField("guardian", "Guardian or sponsor", { required: false }),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
        {
          key: "consent",
          label: "Communication consent",
          type: "checkbox",
          full: true,
        },
      ];
      break;
    case "appointment":
      title = r.id ? "Edit appointment" : "Add to calendar";
      sessionNoteField =
        !!r.id &&
        !!r.contact_id &&
        ["admin", "academic", "instructor", "admissions"].includes(
          data.user.role,
        );
      fields = [
        combo("kind", "Type", suggestions.kind),
        textField("title", "Title"),
        select("contact_id", "Client", contacts, { required: false }),
        select(
          "staff_id",
          "With",
          activeUsers.map((u) => [u.id, u.name]),
          { required: false },
        ),
        ...((data.packages || []).some(
          (p) => String(p.contact_id) === String(values.contact_id),
        )
          ? [
              select(
                "package_id",
                "Counts in package",
                (data.packages || [])
                  .filter(
                    (p) => String(p.contact_id) === String(values.contact_id),
                  )
                  .map((p) => [
                    p.id,
                    `${p.title} · ${p.used}/${p.sessions_total} ${t("used")}`,
                  ]),
                { required: false },
              ),
            ]
          : []),
        textField("starts_at", "Start time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        textField("ends_at", "End time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        combo("location", "Place or link", suggestions.room, {
          required: false,
        }),
        {
          key: "online",
          label: "Online consultation (video link)",
          type: "checkbox",
          hint: "A free video room is created (Jitsi Meet). You can paste a Google Meet or Zoom link below instead.",
          full: true,
        },
        ...(values.online
          ? [
              textField("meeting_url", "Video link", {
                required: false,
                full: true,
                hint: "Leave empty to create one automatically",
              }),
            ]
          : []),
        ...(r.id
          ? [
              select("status", "Status", [
                ...(r.status === "Pending"
                  ? [["Pending", t("To confirm")] as [string, string]]
                  : []),
                ["Scheduled", t("Scheduled")],
                ["Done", t("Done")],
                ["No-show", t("No-show")],
                ["Cancelled", t("Cancelled")],
              ]),
            ]
          : [
              select(
                "repeat",
                "Repeat",
                [1, 2, 4, 6, 8, 10, 12].map((n) => [
                  n,
                  n === 1 ? t("Only once") : `${t("Every week")} × ${n}`,
                ]),
              ),
            ]),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
      ];
      break;
    case "staff":
      title = r.id ? "Edit staff member" : "Add staff member";
      fields = [
        textField("name", "Full name"),
        select(
          "role",
          "Role",
          Object.entries(roleNames).map(([key, value]) => [key, t(value)]),
        ),
        textField("email", "Email", {
          type: "email",
          required: false,
          hint: "Needed only if this person signs in",
        }),
        textField("phone", "Phone", { type: "tel", required: false }),
        ...(!r.id
          ? [
              textField("password", "Password", {
                type: "password",
                required: false,
                hint: "At least 10 characters. Leave empty if they do not sign in.",
                full: true,
              }),
            ]
          : []),
      ];
      break;
    case "password":
      title = "Set password";
      fields = [
        textField("password", "New password", {
          type: "password",
          full: true,
          hint: "At least 10 characters. Share it privately with the person.",
        }),
      ];
      break;
    case "account":
      title = "My account";
      fields = [
        textField("name", "Full name"),
        textField("email", "Email (sign-in)", { type: "email" }),
        textField("current_password", "Current password", {
          type: "password",
          full: true,
        }),
        textField("new_password", "New password", {
          type: "password",
          required: false,
          full: true,
          hint: "Leave empty to keep your password. At least 10 characters.",
        }),
      ];
      break;
    case "cleanStart":
      title = "Remove all sample data";
      button = "Delete sample data";
      fields = [textField("confirm", "Type DELETE to confirm", { full: true })];
      break;
    case "task":
    case "bulkTask":
      title = r.id ? "Edit task" : "Schedule follow-up";
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
                activeUsers
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
            .filter((h) => !r.program_id || h.program_id === r.program_id)
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
            ["private", t("Only me (private)")],
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
        textField("email", "Email", { type: "email", required: false }),
        combo("language", "Preferred language", suggestions.language),
        combo(
          "level",
          "Level",
          [
            "A1",
            "A2",
            "B1",
            "B2",
            "C1",
            "C2",
            "Beginner",
            "Intermediate",
            "Advanced",
          ],
          { required: false },
        ),
        textField("guardian", "Guardian or sponsor", { required: false }),
        textField("emergency_contact", "Emergency contact", {
          required: false,
          hint: "Name and phone of someone to call if needed",
        }),
        textField("company", "Company (for invoices)", { required: false }),
        textField("company_nif", "Company NIF", { required: false }),
        textField("company_address", "Company address", {
          required: false,
          full: true,
        }),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
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
      if (r.id) {
        title = "Edit charge";
        fields = [
          textField("label", "Description", { full: true }),
          textField("amount", "Amount", {
            type: "number",
            step: "0.01",
            min: "0.01",
          }),
          textField("due_date", "Due date", { type: "date" }),
        ];
        break;
      }
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
        combo("category", "Category", suggestions.category),
        combo("duration", "Duration", suggestions.duration),
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
        select(
          "color",
          "Color",
          ["teal", "blue", "purple", "amber"].map((s) => [s, t(s)]),
        ),
      ];
      break;
    case "cohort":
      title = r.id ? "Edit group" : "New group";
      button = r.id ? "Save" : "Create group";
      fields = [
        textField("name", "Group name", {
          full: true,
          hint: "Example: English A1 · Evening",
        }),
        select("program_id", "Program", programs),
        combo("instructor_name", "Teacher", suggestions.teacher, {
          required: false,
          hint: "Choose or type a new teacher's name",
        }),
        textField("capacity", "Capacity", { type: "number", min: 1, max: 500 }),
        combo("room", "Room or meeting link", suggestions.room, {
          required: false,
        }),
        textField("start_date", "Start date", { type: "date" }),
        textField("end_date", "End date", { type: "date" }),
        ...(r.id
          ? [
              select("status", "Status", [
                ["Planned", t("Planned")],
                ["Active", t("Active")],
                ["Completed", t("Completed")],
              ]),
            ]
          : []),
      ];
      break;
    case "session":
      title = "Schedule group class";
      button = "Schedule session";
      if (r.id) {
        title = "Edit class session";
        button = "Save";
        fields = [
          textField("title", "Session title", { full: true }),
          textField("starts_at", "Start time", {
            type: "datetime-local",
            hint: data.settings.timezone,
          }),
          textField("ends_at", "End time", {
            type: "datetime-local",
            hint: data.settings.timezone,
          }),
          combo("room", "Room", suggestions.room, { required: false }),
        ];
        break;
      }
      fields = [
        select(
          "cohort_id",
          "Cohort",
          data.cohorts.map((h) => [h.id, h.name]),
          { full: true },
        ),
        textField("title", "Session title", {
          full: true,
          hint: "Example: Lesson 3 · Grammar",
        }),
        textField("starts_at", "Start time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        textField("ends_at", "End time", {
          type: "datetime-local",
          hint: data.settings.timezone,
        }),
        combo("room", "Room", suggestions.room, {
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
        combo("timezone", "Time zone", [
          "Africa/Algiers",
          "Europe/Paris",
          "Europe/Moscow",
          "UTC",
        ]),
        select(
          "language",
          "Default language",
          [
            ["fr", "Français"],
            ["ar", "العربية"],
            ["en", "English"],
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
    case "package":
      title = r.id ? "Edit package" : "New session package";
      fields = [
        combo(
          "title",
          "Package name",
          [
            "Psychology consultations",
            "Couple therapy",
            "Child follow-up",
            "Private lessons",
          ],
          { full: true },
        ),
        textField("sessions_total", "Number of sessions", {
          type: "number",
          min: 1,
          max: 200,
        }),
        ...(r.id
          ? [
              select("status", "Status", [
                ["Active", t("Active")],
                ["Finished", t("Finished")],
              ]),
              textField("plan", "Session plan", {
                type: "textarea",
                required: false,
                full: true,
                hint: "Goals and steps planned for these sessions",
              }),
            ]
          : [
              textField("price", "Price for the whole package", {
                type: "number",
                min: 0,
                step: "0.01",
                required: false,
                hint: "Creates a charge in Payments. Leave empty if free or paid per session.",
              }),
              textField("due_date", "Payment due date", { type: "date" }),
            ]),
      ];
      break;
    case "bookingService":
      title = r.id ? "Edit service" : "New service";
      fields = [
        textField("name", "Service name", {
          full: true,
          hint: "Shown to clients. Example: Individual consultation (60 min)",
        }),
        combo("kind", "Type", suggestions.kind),
        textField("duration_min", "Duration (minutes)", {
          type: "number",
          min: 10,
          max: 480,
          step: "5",
        }),
        textField("description", "Short description", {
          type: "textarea",
          required: false,
          full: true,
        }),
        {
          key: "online",
          label: "Online (a video link is created for each booking)",
          type: "checkbox",
          full: true,
        },
        {
          key: "staff_ids",
          label: "Who provides it",
          type: "checks",
          full: true,
          options: activeUsers
            .filter((u) => u.role !== "finance")
            .map((u) => [u.id, u.name] as [number, string]),
        },
        ...(r.id
          ? [
              {
                key: "active",
                label: "Open for booking",
                type: "checkbox",
                full: true,
              } as Field,
            ]
          : []),
      ];
      break;
    case "placement":
      title = "Placement test";
      fields = [
        combo("test_name", "Test", [
          "Placement test",
          "Oral interview",
          "Written test",
          "Cambridge",
          "DELF",
          "TOEFL",
        ]),
        textField("taken_on", "Date", { type: "date" }),
        textField("score", "Score", {
          type: "number",
          step: "0.25",
          min: 0,
          required: false,
        }),
        textField("max_score", "Out of", {
          type: "number",
          step: "0.25",
          min: 0,
          required: false,
        }),
        combo(
          "level",
          "Level reached",
          [
            "A1",
            "A2",
            "B1",
            "B2",
            "C1",
            "C2",
            "Beginner",
            "Intermediate",
            "Advanced",
          ],
          { required: false },
        ),
        textField("notes", "Notes", {
          type: "textarea",
          required: false,
          full: true,
        }),
      ];
      break;
    case "grade":
      title = "Add a mark";
      fields = [
        textField("title", "Assessment", {
          full: true,
          hint: "Example: Test 1 · Oral",
        }),
        textField("score", "Mark", { type: "number", step: "0.25", min: 0 }),
        textField("max_score", "Out of", {
          type: "number",
          step: "0.25",
          min: 1,
        }),
        textField("taken_on", "Date", { type: "date" }),
      ];
      break;
    case "promote":
      title = "Next level";
      button = "Move to the next level";
      fields = [
        combo(
          "level",
          "Level reached",
          [
            "A1",
            "A2",
            "B1",
            "B2",
            "C1",
            "C2",
            "Beginner",
            "Intermediate",
            "Advanced",
          ],
          {
            required: false,
            hint: "Printed on the certificate of the level just finished",
          },
        ),
        select(
          "cohort_id",
          "Group of the next level",
          data.cohorts
            .filter((h) => h.id !== r.cohort_id && h.status !== "Completed")
            .map((h) => [h.id, `${h.name} · ${t(program(h.program_id).name)}`]),
          { full: true },
        ),
        {
          key: "charge",
          label: "Add the tuition of the new group to Payments",
          type: "checkbox",
          full: true,
        },
      ];
      break;
    case "pay":
      title = `${t("Pay rate")} · ${r.name}`;
      fields = [
        select("pay_mode", "Paid", [
          ["hour", t("Per hour of group class")],
          ["session", t("Per consultation done")],
          ["none", t("Not paid through the CRM")],
        ]),
        textField("pay_rate", "Rate", {
          type: "number",
          step: "0.01",
          min: 0,
          required: false,
          hint: data.settings.currency,
        }),
      ];
      break;
    case "expense":
      title = "Add an expense";
      fields = [
        textField("spent_on", "Date", { type: "date" }),
        combo(
          "category",
          "Category",
          [
            "Rent",
            "Salaries",
            "Advertising",
            "Supplies",
            "Electricity, water, internet",
            "Taxes",
            "Other",
            ...(data.expenses || []).map((x) => x.category),
          ].filter((x, i, a) => a.indexOf(x) === i),
        ),
        textField("label", "Description", { required: false, full: true }),
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
      ];
      break;
    case "legal":
      title = "Invoice details";
      fields = [
        textField("legal_name", "Company name", {
          required: false,
          full: true,
          hint: "Example: SARL Luminol Academy",
        }),
        textField("legal_address", "Address", { required: false, full: true }),
        textField("legal_nif", "NIF", { required: false }),
        textField("legal_rc", "RC", { required: false }),
        textField("legal_nis", "NIS", { required: false }),
        textField("legal_ai", "AI", { required: false }),
        textField("legal_rib", "RIB", { required: false, full: true }),
        textField("vat_rate", "VAT (%)", {
          type: "number",
          min: 0,
          max: 30,
          step: "0.5",
          hint: "0 = VAT not applicable",
        }),
      ];
      break;
    case "template":
      title = r.id ? "Edit template" : "New template";
      fields = [
        textField("name", "Template name", { full: true }),
        textField("body", "Message", {
          type: "textarea",
          full: true,
          hint: "You can use {name} {date} {time} {course} {amount} {due} {academy}",
        }),
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
  if (sessionNoteField)
    fields.push(
      textField("session_note", "Session note (private)", {
        type: "textarea",
        required: false,
        full: true,
        hint: "Only you can read it. It also appears in the client's psychology file.",
      }),
    );
  if (modal.type === "program" && r.id) {
    title = "Edit program";
    button = "Save";
  }
  // Every saved record can be removed from its own edit form.
  let removal: { path: string; warning: string } | null = null;
  if (r.id) {
    const map: Record<string, [string, string, boolean]> = {
      request: [
        `/opportunities/${r.id}`,
        "Delete this request? The client stays in the CRM.",
        data.permissions.editAdmissions,
      ],
      contact: [
        `/contacts/${r.id}`,
        "Delete this client and ALL their requests, payments, notes and files? This cannot be undone.",
        data.permissions.admin,
      ],
      program: [
        `/programs/${r.id}`,
        "Delete this program and its empty groups and sessions?",
        data.permissions.editAcademic,
      ],
      cohort: [
        `/cohorts/${r.id}`,
        "Delete this group and its sessions?",
        data.permissions.editAcademic,
      ],
      session: [
        `/sessions/${r.id}`,
        "Delete this class session and its attendance?",
        data.permissions.editAcademic,
      ],
      appointment: [`/appointments/${r.id}`, "Delete this appointment?", true],
      task: [`/tasks/${r.id}`, "Delete this task?", true],
      package: [
        `/packages/${r.id}`,
        "Delete this package? Its sessions stay in the calendar.",
        true,
      ],
      template: [`/templates/${r.id}`, "Delete this template?", true],
      bookingService: [
        `/booking/services/${r.id}`,
        "Delete this service?",
        true,
      ],
      charge: [
        `/charges/${r.id}`,
        "Delete this charge?",
        data.permissions.editFinance,
      ],
      staff: [
        `/users/${r.id}`,
        "Remove this staff member? If they have history, their account is deactivated instead.",
        data.permissions.admin && r.id !== data.user.id,
      ],
    };
    const entry = map[modal.type];
    if (entry && entry[2]) removal = { path: entry[0], warning: entry[1] };
  }
  async function remove() {
    if (!removal || !window.confirm(t(removal.warning))) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(removal.path, {}, "DELETE");
      await refresh();
      toast(
        t(result.deactivated ? "Account deactivated; history kept" : "Deleted"),
      );
      onClose();
    } catch (e: any) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
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
        case "request":
          path = `/opportunities/${r.id}`;
          method = "PATCH";
          body = {
            ...values,
            stage: r.stage,
            version: r.version,
            program_id: values.program_id ? Number(values.program_id) : null,
          };
          break;
        case "client":
          path = "/contacts";
          break;
        case "appointment":
          path = r.id ? `/appointments/${r.id}` : "/appointments";
          method = r.id ? "PATCH" : "POST";
          body = {
            kind: values.kind,
            title: values.title,
            contact_id: values.contact_id ? Number(values.contact_id) : null,
            staff_id: values.staff_id ? Number(values.staff_id) : null,
            package_id:
              values.package_id &&
              (data.packages || []).some(
                (p) =>
                  p.id === Number(values.package_id) &&
                  String(p.contact_id) === String(values.contact_id),
              )
                ? Number(values.package_id)
                : null,
            repeat: r.id ? undefined : Number(values.repeat || 1),
            allow_overlap: overlapRef.current || undefined,
            location: values.location || "",
            online: !!values.online,
            meeting_url: values.online ? values.meeting_url || "" : "",
            notes: values.notes || "",
            status: values.status,
            starts_at: toInstant(values.starts_at, data.settings.timezone),
            ends_at: toInstant(values.ends_at, data.settings.timezone),
          };
          break;
        case "staff":
          path = r.id ? `/users/${r.id}` : "/users";
          method = r.id ? "PATCH" : "POST";
          if (r.id && values.role !== r.role)
            await api(`/users/${r.id}/role`, { role: values.role }, "PATCH");
          break;
        case "password":
          path = `/users/${r.id}/password`;
          break;
        case "account":
          path = "/account";
          method = "PATCH";
          break;
        case "cleanStart":
          path = "/admin/clean-start";
          body = { confirm: values.confirm.trim().toUpperCase() };
          break;
        case "task":
          path = r.id ? `/tasks/${r.id}/details` : "/tasks";
          method = r.id ? "PATCH" : "POST";
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
          if (r.id) {
            path = `/charges/${r.id}`;
            method = "PATCH";
            body = { ...values, amount: cents(values.amount) };
            break;
          }
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
          path = r.id ? `/cohorts/${r.id}` : "/cohorts";
          method = r.id ? "PATCH" : "POST";
          body = {
            name: values.name,
            program_id: Number(values.program_id),
            instructor_name: values.instructor_name || "",
            capacity: Number(values.capacity),
            room: values.room || "",
            start_date: values.start_date,
            end_date: values.end_date,
            status: values.status,
          };
          break;
        case "session":
          if (r.id) {
            path = `/sessions/${r.id}`;
            method = "PATCH";
            body = {
              ...values,
              starts_at: toInstant(values.starts_at, data.settings.timezone),
              ends_at: toInstant(values.ends_at, data.settings.timezone),
            };
            break;
          }
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
        case "package":
          path = r.id ? `/packages/${r.id}` : "/packages";
          method = r.id ? "PATCH" : "POST";
          body = r.id
            ? { ...values, sessions_total: Number(values.sessions_total) }
            : {
                ...values,
                contact_id: c?.id,
                sessions_total: Number(values.sessions_total),
                price: values.price ? cents(values.price) : 0,
              };
          break;
        case "template":
          path = r.id ? `/templates/${r.id}` : "/templates";
          method = r.id ? "PATCH" : "POST";
          break;
        case "expense":
          path = "/expenses";
          body = { ...values, amount: cents(values.amount) };
          break;
        case "legal":
          path = "/settings/legal";
          method = "PATCH";
          body = { ...values, vat_rate: Number(values.vat_rate || 0) };
          break;
        case "placement":
          path = "/placement";
          body = { ...values, contact_id: c?.id };
          break;
        case "grade":
          path = "/grades";
          body = { ...values, enrollment_id: r.id };
          break;
        case "promote":
          path = `/enrollments/${r.id}/promote`;
          body = { ...values, cohort_id: Number(values.cohort_id) };
          break;
        case "pay":
          path = `/users/${r.id}/pay`;
          method = "PATCH";
          body = {
            pay_mode: values.pay_mode,
            pay_rate: values.pay_rate ? cents(values.pay_rate) : 0,
          };
          break;
        case "bookingService":
          path = r.id ? `/booking/services/${r.id}` : "/booking/services";
          method = r.id ? "PATCH" : "POST";
          body = {
            name: values.name,
            kind: values.kind,
            duration_min: Number(values.duration_min),
            description: values.description || "",
            staff_ids: values.staff_ids,
            active: values.active,
            online: !!values.online,
          };
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
      if (
        sessionNoteField &&
        values.session_note !==
          ((data.sessionNotes || []).find((n) => n.appointment_id === r.id)
            ?.text || "")
      )
        await api(`/appointments/${r.id}/note`, { text: values.session_note });
      await refresh();
      if (modal.type === "settings") setLang(values.language);
      toast(
        t(
          result.waitlisted
            ? "Waitlisted"
            : modal.type === "inquiry"
              ? "Request saved"
              : modal.type === "cleanStart"
                ? "Sample data removed"
                : "Changes saved",
        ),
      );
      onClose();
      if (modal.type === "client" && result.id) profile(result.id);
    } catch (e: any) {
      if (
        e instanceof ApiError &&
        e.details.overlap &&
        !overlapRef.current &&
        window.confirm(t(e.message) + "\n\n" + t("Book anyway?"))
      ) {
        overlapRef.current = true;
        setBusy(false);
        return submit(new Event("submit") as any);
      }
      overlapRef.current = false;
      setError(t(e.message));
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
        setError(t(e.message));
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
          {data.permissions.editAcademic && (
            <Button onClick={() => open({ type: "session", record: session })}>
              {t("Edit")}
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
            <span>
              {r.instructor_id
                ? user(r.instructor_id).name
                : t("No teacher yet")}
            </span>
            <span>{r.room}</span>
            {data.permissions.editAcademic && (
              <Button
                variant="small"
                onClick={() => open({ type: "cohort", record: r })}
              >
                {t("Edit")}
              </Button>
            )}
            {["admin", "academic", "instructor"].includes(data.user.role) && (
              <Button
                variant="small"
                onClick={() => open({ type: "grades", record: r })}
              >
                {t("Mark sheet")}
              </Button>
            )}
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
  if (modal.type === "whatsapp")
    return (
      <WhatsAppDialog
        contact={modal.contact!}
        appointment={modal.record?.id ? modal.record : undefined}
        options={modal.extra || {}}
        onClose={onClose}
      />
    );
  if (modal.type === "import") return <ImportDialog onClose={onClose} />;
  if (modal.type === "intake")
    return <IntakeDialog contact={modal.contact!} onClose={onClose} />;
  if (modal.type === "intakeQuestions")
    return <IntakeQuestionsDialog onClose={onClose} />;
  if (modal.type === "grades")
    return <MarkSheetDialog cohortRow={modal.record!} onClose={onClose} />;
  if (modal.type === "paylink")
    return <PayLinkDialog charge={modal.record!} onClose={onClose} />;
  if (modal.type === "portal")
    return <PortalLinkDialog contact={modal.contact!} onClose={onClose} />;
  if (modal.type === "help")
    return <HelpDialog page={modal.extra} onClose={onClose} />;
  if (modal.type === "hours")
    return <HoursDialog person={modal.record!} onClose={onClose} />;
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
        "request",
        "client",
        "appointment",
        "staff",
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
                {r.program_id
                  ? `${t(program(r.program_id).name)} · ${money(program(r.program_id).price, program(r.program_id).currency)}`
                  : `${r.interest || t(r.service_type)} · ${t("Choose the group; its program and price are used.")}`}
              </span>
            </div>
          )}
          {["payment", "refund", "charge", "split"].includes(modal.type) && (
            <div className="info-box">
              <Shield size={17} />
              <span>{t("Manual record only. No money is moved.")}</span>
            </div>
          )}
          {modal.type === "cleanStart" && (
            <div className="info-box danger">
              <AlertCircle size={17} />
              <span>
                {t(
                  "This deletes every client, request, program, group, session, payment, task and staff account except yours. Leads received from the website / Google stay and return to the inbox so you can import them.",
                )}
              </span>
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
                    {f.type === "checks" ? (
                      <div className="checks">
                        {f.options?.map(([value, label]) => {
                          const list: number[] = values[f.key] || [];
                          const on = list.includes(Number(value));
                          return (
                            <label key={value} className={on ? "on" : ""}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  set(
                                    f.key,
                                    on
                                      ? list.filter((x) => x !== Number(value))
                                      : [...list, Number(value)],
                                  )
                                }
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    ) : f.type === "combo" ? (
                      <>
                        {/* Suggestions show in the interface language; the
                            stored value stays the same in every language. */}
                        <input
                          list={`list-${f.key}`}
                          value={t(values[f.key] ?? "")}
                          onChange={(e) => {
                            const typed = e.target.value;
                            const known = f.suggestions?.find(
                              (x) => t(x) === typed,
                            );
                            set(f.key, known ?? typed);
                          }}
                          required={f.required}
                          maxLength={180}
                          autoComplete="off"
                          placeholder={t("Choose or type…")}
                        />
                        <datalist id={`list-${f.key}`}>
                          {f.suggestions?.map((x) => (
                            <option key={x} value={t(x)} />
                          ))}
                        </datalist>
                      </>
                    ) : f.type === "select" ? (
                      <select
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        required={f.required}
                        disabled={f.disabled}
                      >
                        <option value="">
                          {t(f.required ? "Choose…" : "— None —")}
                        </option>
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
          {removal && (
            <Button
              type="button"
              variant="danger-ghost"
              className="footer-delete"
              onClick={remove}
              disabled={busy}
            >
              {t("Delete")}
            </Button>
          )}
          {modal.type === "appointment" && r.id && r.contact_id && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                open({
                  type: "whatsapp",
                  contact: person(r.contact_id),
                  record: r,
                })
              }
            >
              {t("WhatsApp reminder")}
            </Button>
          )}
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
