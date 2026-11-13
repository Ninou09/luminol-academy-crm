import { useMemo, useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  MessageCircle,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useApp } from "./context";
import { api, type Row } from "./types";
import { Badge, Button, DataTable, Dialog, Empty } from "./ui";

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Open a clean printable page (the browser's print dialog can save it as PDF). */
export function printDocument(title: string, body: string, rtl = false) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("Allow pop-ups for this site to print.");
    return;
  }
  w.document
    .write(`<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1f2f2a; margin: 0; }
  .sheet { max-width: 760px; margin: 0 auto; padding: 24px; }
  .brand { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid #167e70; padding-bottom: 14px; }
  .brand h1 { margin:0; font-size: 26px; color:#167e70; letter-spacing: -0.5px; }
  .muted { color:#6b7a72; font-size: 13px; }
  table { width:100%; border-collapse: collapse; margin-top: 22px; font-size: 15px; }
  td { padding: 10px 6px; border-bottom: 1px solid #e3e8e4; }
  td:first-child { color:#6b7a72; width: 40%; }
  .total { font-size: 22px; font-weight: 700; }
  .cert { text-align:center; border: 6px double #167e70; padding: 50px 40px; margin-top: 30px; }
  .cert h2 { font-size: 36px; margin: 10px 0 6px; letter-spacing: 1px; }
  .cert .name { font-size: 32px; font-weight: 700; margin: 26px 0 10px; border-bottom: 1px solid #c9d6cf; display:inline-block; padding: 0 30px 8px; }
  .cert p { font-size: 17px; line-height: 1.7; }
  .sign { display:flex; justify-content:space-between; margin-top: 60px; font-size: 14px; }
  .sign div { border-top: 1px solid #1f2f2a; padding-top: 6px; width: 40%; }
  button { margin: 20px auto; display:block; padding: 10px 18px; font-size: 15px; }
  @media print { button { display:none; } }
</style></head><body><div class="sheet">${body}<button onclick="print()">Print / Save as PDF</button></div>
<script>setTimeout(() => print(), 300);</script></body></html>`);
  w.document.close();
}

export function useReceipt() {
  const { data, person, money, date } = useApp();
  return (payment: Row) => {
    const charge = data.charges.find((c) => c.id === payment.charge_id);
    const client = person(payment.contact_id);
    const number = `R-${new Date(payment.created_at).getFullYear()}-${String(payment.id).padStart(5, "0")}`;
    printDocument(
      `Receipt ${number}`,
      `<div class="brand"><h1>${escapeHtml(data.settings.academy)}</h1><div class="muted">Reçu de paiement / وصل دفع<br><b>${number}</b></div></div>
      <table>
        <tr><td>Client / العميل</td><td><b>${escapeHtml(client.name)}</b><br><span class="muted">${escapeHtml(client.phone || client.email || "")}</span></td></tr>
        <tr><td>Objet / البيان</td><td>${escapeHtml(charge?.label || "")}</td></tr>
        <tr><td>Date / التاريخ</td><td>${escapeHtml(date(payment.created_at, { day: "numeric", month: "long", year: "numeric" }))}</td></tr>
        <tr><td>Mode de paiement / طريقة الدفع</td><td>${escapeHtml(payment.method)}${payment.reference ? " · " + escapeHtml(payment.reference) : ""}</td></tr>
        <tr><td>Montant payé / المبلغ المدفوع</td><td class="total">${escapeHtml(money(payment.amount, payment.currency))}</td></tr>
        ${charge ? `<tr><td>Reste à payer / المتبقي</td><td>${escapeHtml(money(charge.balance, charge.currency))}</td></tr>` : ""}
      </table>
      <div class="sign"><div>Signature & cachet</div><div>${escapeHtml(data.user.name)}</div></div>`,
    );
  };
}

export function useCertificate() {
  const { data, person, cohort, program, date, user } = useApp();
  return (enrollment: Row) => {
    const h = cohort(enrollment.cohort_id);
    const p = program(h.program_id);
    const student = person(enrollment.contact_id);
    const level = enrollment.level || student.level;
    printDocument(
      `Certificate ${student.name}`,
      `<div class="brand"><h1>${escapeHtml(data.settings.academy)}</h1><div class="muted">N° C-${String(enrollment.id).padStart(5, "0")}</div></div>
      <div class="cert">
        <div class="muted">CERTIFICAT DE RÉUSSITE · CERTIFICATE OF COMPLETION · شهادة إتمام</div>
        <h2>${escapeHtml(p.name)}</h2>
        <p>Ce certificat est décerné à / This certificate is awarded to</p>
        <div class="name">${escapeHtml(student.name)}</div>
        <p>pour avoir suivi avec succès la formation<br><b>${escapeHtml(p.name)}</b> (${escapeHtml(p.duration)})${level ? `<br>Niveau / Level / المستوى : <b>${escapeHtml(level)}</b>` : ""}</p>
        <p class="muted">${escapeHtml(h.name)} · ${escapeHtml(date(h.start_date, { day: "numeric", month: "long", year: "numeric" }))} – ${escapeHtml(date(enrollment.completed_at || h.end_date, { day: "numeric", month: "long", year: "numeric" }))}</p>
        <div class="sign"><div>${h.instructor_id ? escapeHtml(user(h.instructor_id).name) : "Formateur / Teacher"}</div><div>Direction · ${escapeHtml(data.settings.academy)}</div></div>
      </div>`,
    );
  };
}

/** Fill a template with the client's next appointment, open balance, course… */
export function useTemplateValues() {
  const { data, money, time, cohort } = useApp();
  // Messages go to clients, so dates are written in French (as in the templates).
  const date = (s: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: data.settings.timezone,
      ...opts,
    }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s));
  return (contact: Row, appointment?: Row) => {
    const next =
      appointment ||
      (data.appointments || [])
        .filter(
          (a) =>
            a.contact_id === contact.id &&
            a.status === "Scheduled" &&
            a.starts_at > new Date().toISOString(),
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    const charge = data.charges.find(
      (c) => c.contact_id === contact.id && c.balance > 0,
    );
    const enrollment = data.enrollments.find(
      (e) => e.contact_id === contact.id && e.status === "Active",
    );
    const opportunity = data.opportunities.find(
      (o) => o.contact_id === contact.id,
    );
    const values: Record<string, string> = {
      name: contact.name.split(" ")[0],
      academy: data.settings.academy,
      date: next
        ? date(next.starts_at, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : enrollment
          ? date(cohort(enrollment.cohort_id).start_date, {
              day: "numeric",
              month: "long",
            })
          : "",
      time: next ? time(next.starts_at) : "",
      amount: charge ? money(charge.balance, charge.currency) : "",
      due: charge
        ? date(charge.due_date, { day: "numeric", month: "long" })
        : "",
      course: enrollment
        ? cohort(enrollment.cohort_id).name
        : charge?.label || opportunity?.interest || "",
    };
    return (body: string) =>
      body.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
  };
}

export function WhatsAppDialog({
  contact,
  appointment,
  onClose,
}: {
  contact: Row;
  appointment?: Row;
  onClose: () => void;
}) {
  const { data, t, go } = useApp();
  const fill = useTemplateValues()(contact, appointment);
  const [text, setText] = useState("");
  const digits = contact.phone.replace(/\D/g, "").replace(/^0(?=[567])/, "213");
  return (
    <Dialog title={`WhatsApp · ${contact.name}`} onClose={onClose} wide>
      <div className="form-body">
        {!contact.phone && (
          <div className="form-error">
            {t("This client has no phone number.")}
          </div>
        )}
        {!contact.consent && (
          <div className="info-box">
            {t("Communication consent is not recorded for this client.")}
          </div>
        )}
        <p className="form-hint">
          {t("Choose a message, check it, then open WhatsApp.")}
        </p>
        <div className="template-list">
          {data.templates.map((tpl) => (
            <button
              key={tpl.id}
              className={`template-option ${text === fill(tpl.body) ? "active" : ""}`}
              onClick={() => setText(fill(tpl.body))}
            >
              <strong>{t(tpl.name)}</strong>
              <span>{fill(tpl.body)}</span>
            </button>
          ))}
        </div>
        <label className="full-field template-edit">
          <span>{t("Message")}</span>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      <div className="dialog-footer">
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            go("Settings", "Message templates");
          }}
        >
          {t("Edit templates")}
        </Button>
        <Button onClick={onClose}>{t("Close")}</Button>
        <a
          className={`button primary ${!digits || !text ? "disabled" : ""}`}
          href={
            digits && text
              ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
              : undefined
          }
          target="_blank"
          rel="noreferrer"
          onClick={() => digits && text && onClose()}
        >
          <MessageCircle size={17} />
          {t("Open WhatsApp")}
        </a>
      </div>
    </Dialog>
  );
}

/** Prepaid consultation packages shown on the client's card. */
export function PackagesSection({ contact }: { contact: Row }) {
  const { data, t, open, money } = useApp();
  const list = (data.packages || []).filter((p) => p.contact_id === contact.id);
  const canEdit = ["admin", "admissions", "academic", "finance"].includes(
    data.user.role,
  );
  if (!list.length && !canEdit) return null;
  return (
    <div className="profile-section">
      <div className="section-label">
        <h3>{t("Session packages")}</h3>
        {canEdit && (
          <Button
            variant="small"
            icon={<Plus size={14} />}
            onClick={() => open({ type: "package", contact })}
          >
            {t("New package")}
          </Button>
        )}
      </div>
      {!list.length && (
        <p className="form-hint">
          {t(
            "For example 5 consultations paid in advance. Each done or missed session is counted automatically.",
          )}
        </p>
      )}
      {list.map((p) => {
        const left = p.sessions_total - p.used;
        const charge = data.charges.find((c) => c.id === p.charge_id);
        return (
          <div className="package-card" key={p.id}>
            <div className="package-top">
              <Package size={18} />
              <strong>{p.title}</strong>
              <Badge
                tone={
                  p.status === "Finished" || left <= 0
                    ? "neutral"
                    : left <= 1
                      ? "amber"
                      : "teal"
                }
              >
                {p.status === "Finished" || left <= 0
                  ? t("Finished")
                  : `${left} ${t("sessions left")}`}
              </Badge>
            </div>
            <div
              className="package-dots"
              aria-label={`${p.used}/${p.sessions_total}`}
            >
              {Array.from({ length: p.sessions_total }, (_, i) => (
                <i
                  key={i}
                  className={
                    i < p.used ? "used" : i < p.used + p.booked ? "booked" : ""
                  }
                />
              ))}
            </div>
            <small className="muted">
              {p.used} {t("done")} · {p.booked} {t("booked")} ·{" "}
              {p.sessions_total} {t("in total")}
              {charge
                ? ` · ${t("Balance")}: ${money(charge.balance, charge.currency)}`
                : ""}
            </small>
            {canEdit && (
              <div className="row-actions wrap">
                {left > 0 && p.status === "Active" && (
                  <Button
                    variant="small primary"
                    onClick={() =>
                      open({
                        type: "appointment",
                        contact,
                        extra: { title: p.title },
                      })
                    }
                  >
                    {t("Book next session")}
                  </Button>
                )}
                <Button
                  variant="small"
                  onClick={() => open({ type: "package", record: p, contact })}
                >
                  {t("Edit")}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Settings → Trash: restore anything deleted in the last 30 days. */
export function TrashPanel() {
  const { data, t, date, time, perform, toast } = useApp();
  async function restore(row: Row) {
    try {
      await perform(`/trash/${row.id}/restore`, {});
      toast(t("Restored"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  async function purge(row: Row) {
    if (!window.confirm(t("Delete forever? This cannot be undone."))) return;
    try {
      await perform(`/trash/${row.id}`, {}, "DELETE");
      toast(t("Deleted"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  const kinds: Record<string, string> = {
    contacts: "Client",
    opportunities: "Request",
    programs: "Program",
    cohorts: "Group",
    sessions: "Class session",
    appointments: "Appointment",
    tasks: "Task",
    charges: "Charge",
    payments: "Payment",
    activities: "Note",
    documents: "Document",
    packages: "Package",
    message_templates: "Template",
  };
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Trash")}</h2>
          <p>
            {t(
              "Everything deleted in the last 30 days. Restore it with one click.",
            )}
          </p>
        </div>
      </div>
      <DataTable
        rows={data.trash || []}
        columns={[
          {
            key: "label",
            label: "Name",
            render: (r) => <strong>{r.label}</strong>,
          },
          {
            key: "kind",
            label: "Type",
            render: (r) => t(kinds[r.kind] || r.kind),
          },
          { key: "user_name", label: "Deleted by" },
          {
            key: "deleted_at",
            label: "Date",
            render: (r) => `${date(r.deleted_at)} · ${time(r.deleted_at)}`,
          },
          {
            key: "actions",
            label: "",
            render: (r) => (
              <div className="row-actions">
                <Button
                  variant="small"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restore(r)}
                >
                  {t("Restore")}
                </Button>
                <button
                  className="icon-button danger"
                  aria-label={t("Delete forever")}
                  title={t("Delete forever")}
                  onClick={() => purge(r)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export function TemplatesPanel() {
  const { data, t, open } = useApp();
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Message templates")}</h2>
          <p>
            {t("Ready texts for WhatsApp. You can use:")}{" "}
            <code>
              {"{name} {date} {time} {course} {amount} {due} {academy}"}
            </code>
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={16} />}
          onClick={() => open({ type: "template" })}
        >
          {t("New template")}
        </Button>
      </div>
      <div className="template-list padded">
        {data.templates.map((tpl) => (
          <button
            key={tpl.id}
            className="template-option"
            onClick={() => open({ type: "template", record: tpl })}
          >
            <strong>{t(tpl.name)}</strong>
            <span>{tpl.body}</span>
          </button>
        ))}
        {!data.templates.length && <Empty title="No templates yet" text="" />}
      </div>
    </div>
  );
}

// Import from Excel / CSV ----------------------------------------------------
const fields: [string, string, RegExp][] = [
  [
    "name",
    "Full name",
    /^(name|full ?name|nom|nom complet|prénom|client|student|élève|الاسم|اسم|имя|фио|клиент)/i,
  ],
  ["phone", "Phone", /(phone|tel|mobile|whats|téléphone|هاتف|رقم|телефон)/i],
  ["email", "Email", /(e-?mail|courriel|بريد|почта)/i],
  [
    "interest",
    "Course, language or topic",
    /(course|cours|formation|program|langue|language course|interest|subject|الدورة|التكوين|курс|интерес)/i,
  ],
  [
    "service_type",
    "What does the client want?",
    /(type|service|besoin|نوع|услуга|тип)/i,
  ],
  ["level", "Level", /(level|niveau|المستوى|уровень)/i],
  ["language", "Preferred language", /^(language|langue|اللغة|язык)$/i],
  ["source", "Where did they find us?", /(source|canal|how|المصدر|источник)/i],
  ["notes", "Notes", /(note|comment|remarque|ملاحظ|коммент|заметк)/i],
  ["consent", "Communication consent", /(consent|accord|موافقة|согласие)/i],
];
function parseCsv(text: string) {
  const sep =
    (text.split("\n")[0].match(/;/g) || []).length >
    (text.split("\n")[0].match(/,/g) || []).length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      ((row = []), (cell = ""));
    } else cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { data, t, refresh, toast } = useApp();
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [requests, setRequests] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const header = table[0] || [];
  async function load(file: File) {
    setError("");
    setResult(null);
    try {
      let rows: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { default: readXlsxFile } = await import("read-excel-file");
        rows = (await readXlsxFile(file)).map((r) =>
          r.map((c) =>
            c instanceof Date
              ? c.toISOString().slice(0, 10)
              : c == null
                ? ""
                : String(c),
          ),
        );
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        rows = parseCsv(await file.text());
      } else
        throw new Error(
          t(
            "Use an Excel (.xlsx) or CSV file. Old .xls files: open them in Excel and save as .xlsx.",
          ),
        );
      if (rows.length < 2)
        throw new Error(t("The file has no rows under the header."));
      setTable(rows);
      const guess: Record<string, number> = {};
      for (const [key, , pattern] of fields) {
        const index = rows[0].findIndex(
          (h, i) =>
            pattern.test(String(h).trim()) && !Object.values(guess).includes(i),
        );
        if (index >= 0) guess[key] = index;
      }
      setMap(guess);
    } catch (e: any) {
      setError(e.message);
    }
  }
  const rows = useMemo(
    () =>
      table.slice(1).map((r) =>
        Object.fromEntries(
          Object.entries(map)
            .filter(([, i]) => i >= 0)
            .map(([k, i]) => [k, String(r[i] ?? "").trim()]),
        ),
      ),
    [table, map],
  );
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await api("/import/contacts", {
        rows,
        create_requests: requests,
        owner_id: data.user.id,
      });
      setResult(res);
      await refresh();
      toast(`${res.created} ${t("clients imported")}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t("Import clients from Excel")}
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="form-body">
        {!result && (
          <>
            <label className="upload-box">
              <FileSpreadsheet size={28} />
              <strong>{t("Choose an Excel or CSV file")}</strong>
              <span>
                {t(
                  "First row = column names (Name, Phone, Email, Course…). Up to 2000 rows.",
                )}
              </span>
              <input
                type="file"
                accept=".xlsx,.csv,.txt"
                onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
              />
            </label>
            {table.length > 0 && (
              <>
                <h3 className="import-title">
                  {table.length - 1} {t("rows found")} ·{" "}
                  {t("Check which column is which")}
                </h3>
                <div className="form-grid">
                  {fields.map(([key, label]) => (
                    <label key={key}>
                      <span>{t(label)}</span>
                      <select
                        value={map[key] ?? -1}
                        onChange={(e) =>
                          setMap({ ...map, [key]: Number(e.target.value) })
                        }
                      >
                        <option value={-1}>{t("— None —")}</option>
                        {header.map((h, i) => (
                          <option key={i} value={i}>
                            {String(h) || `${t("Column")} ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="table-scroll import-preview">
                  <table>
                    <thead>
                      <tr>
                        {fields
                          .filter(([k]) => map[k] >= 0)
                          .map(([k, label]) => (
                            <th key={k}>{t(label)}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          {fields
                            .filter(([k]) => map[k] >= 0)
                            .map(([k]) => (
                              <td key={k}>{r[k]}</td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={requests}
                    onChange={(e) => setRequests(e.target.checked)}
                  />
                  <span>
                    {t(
                      "Also create a request for rows with a course or request type",
                    )}
                    <small>
                      {t("They appear in Requests as “New inquiry”.")}
                    </small>
                  </span>
                </label>
              </>
            )}
          </>
        )}
        {result && (
          <div className="import-result">
            <CheckCircle2 size={34} />
            <h3>
              {result.created} {t("clients imported")}
              {result.requests ? ` · ${result.requests} ${t("requests")}` : ""}
            </h3>
            {result.skippedCount > 0 && (
              <>
                <p>
                  {result.skippedCount} {t("rows skipped:")}
                </p>
                <ul>
                  {result.skipped.map((s: any) => (
                    <li key={s.line}>
                      {t("Row")} {s.line} {s.name ? `(${s.name})` : ""} —{" "}
                      {t(s.reason)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose} disabled={busy}>
          {t(result ? "Close" : "Cancel")}
        </Button>
        {!result && (
          <Button
            variant="primary"
            icon={<Upload size={16} />}
            disabled={busy || !rows.length || map.name == null || map.name < 0}
            onClick={submit}
          >
            {t(busy ? "Saving…" : "Import")}{" "}
            {rows.length ? `(${rows.length})` : ""}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

export function PrintButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  const { t } = useApp();
  return (
    <Button variant="small" icon={<Printer size={14} />} onClick={onClick}>
      {t(label)}
    </Button>
  );
}
