import { useMemo, useState } from "react";
import {
  Copy,
  CreditCard,
  ExternalLink,
  Megaphone,
  MessageCircle,
  Plus,
  Send,
  Star,
  Trash2,
  UserRound,
  Video,
} from "lucide-react";
import { useApp } from "./context";
import { api, localDate, type Row } from "./types";
import { Badge, Button, DataTable, Dialog, Empty, PageHead, Panel } from "./ui";
import { printDocument, useTemplateValues } from "./tools";

const waLink = (phone: string, text: string) =>
  `https://wa.me/${String(phone || "")
    .replace(/\D/g, "")
    .replace(/^00/, "")
    .replace(/^0(?=[567])/, "213")}?text=${encodeURIComponent(text)}`;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** A link with copy / WhatsApp buttons. */
function ShareLink({
  url,
  phone,
  message,
}: {
  url: string;
  phone?: string;
  message: string;
}) {
  const { t, toast } = useApp();
  return (
    <div className="share-link">
      <code>{url}</code>
      <div className="row-actions wrap">
        <Button
          variant="small"
          icon={<Copy size={14} />}
          onClick={() =>
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast(t("Link copied")))
          }
        >
          {t("Copy link")}
        </Button>
        <a className="button small" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> {t("Open page")}
        </a>
        {phone && (
          <a
            className="button small primary"
            href={waLink(phone, message)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

// 1. Online payment link (Chargily) ------------------------------------------
export function PayLinkDialog({
  charge,
  onClose,
}: {
  charge: Row;
  onClose: () => void;
}) {
  const { data, t, person, money } = useApp();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const client = person(charge.contact_id);
  async function create() {
    setBusy(true);
    setError("");
    try {
      setUrl((await api(`/charges/${charge.id}/checkout`, {})).url);
    } catch (e: any) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t("Online payment link")} onClose={onClose}>
      <div className="form-body">
        <div className="form-person">
          <CreditCard size={22} />
          <div>
            <strong>{client.name}</strong>
            <small>
              {charge.label} · {money(charge.balance, charge.currency)}
            </small>
          </div>
        </div>
        {!data.integrations?.chargily ? (
          <div className="info-box">
            {t(
              "Online card payment (CIB / Edahabia) is ready but not switched on. Add the Chargily key in Vercel (see Settings → Integrations).",
            )}
          </div>
        ) : url ? (
          <ShareLink
            url={url}
            phone={client.phone}
            message={`Bonjour ${client.name.split(" ")[0]}, voici le lien pour payer « ${charge.label} » (${money(charge.balance, charge.currency)}) par carte CIB / Edahabia : ${url}`}
          />
        ) : (
          <p className="form-hint">
            {t(
              "The client pays by CIB or Edahabia card. The payment is recorded automatically in the CRM.",
            )}
            {data.integrations.chargilyMode === "test"
              ? ` (${t("test mode")})`
              : ""}
          </p>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Close")}</Button>
        {data.integrations?.chargily && !url && (
          <Button variant="primary" disabled={busy} onClick={create}>
            {t("Create the payment link")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

// 7. Invoice (companies) ------------------------------------------------------
export function useInvoice() {
  const { data, person, money, date, refresh, t } = useApp();
  return async (charge: Row) => {
    const win = window.open("", "_blank", "width=900,height=1000");
    const { invoice_no } = await api(`/charges/${charge.id}/invoice`, {});
    refresh();
    const s = data.settings;
    const c = person(charge.contact_id);
    const total = charge.amount - charge.discount;
    const vat = Number(s.vat_rate || 0);
    const ht = vat ? Math.round(total / (1 + vat / 100)) : total;
    const number = `F-${String(invoice_no).padStart(5, "0")}`;
    const legal = [
      s.legal_nif && `NIF : ${s.legal_nif}`,
      s.legal_rc && `RC : ${s.legal_rc}`,
      s.legal_nis && `NIS : ${s.legal_nis}`,
      s.legal_ai && `AI : ${s.legal_ai}`,
    ].filter(Boolean);
    printDocument(
      `Facture ${number}`,
      `<div class="brand"><h1>${esc(s.legal_name || s.academy)}</h1><div class="muted">FACTURE<br><b>${number}</b><br>${esc(date(new Date().toISOString(), { day: "numeric", month: "long", year: "numeric" }))}</div></div>
      <div class="parties"><div><div class="muted">Émetteur</div><b>${esc(s.legal_name || s.academy)}</b><br>${esc(s.legal_address)}<br>${legal.map(esc).join("<br>")}</div>
      <div><div class="muted">Client</div><b>${esc(c.company || c.name)}</b><br>${c.company ? esc(c.name) + "<br>" : ""}${esc(c.company_address)}<br>${c.company_nif ? "NIF : " + esc(c.company_nif) : ""}</div></div>
      <table><tr><td>Désignation</td><td>${esc(charge.label)}</td></tr>
      ${charge.discount ? `<tr><td>Remise</td><td>${esc(money(charge.discount, charge.currency))} (${esc(charge.discount_reason)})</td></tr>` : ""}
      ${vat ? `<tr><td>Total HT</td><td>${esc(money(ht, charge.currency))}</td></tr><tr><td>TVA ${vat} %</td><td>${esc(money(total - ht, charge.currency))}</td></tr>` : `<tr><td>TVA</td><td>Non applicable</td></tr>`}
      <tr><td>Total TTC</td><td class="total">${esc(money(total, charge.currency))}</td></tr>
      <tr><td>Déjà payé</td><td>${esc(money(charge.paid, charge.currency))}</td></tr>
      <tr><td>Reste à payer</td><td><b>${esc(money(charge.balance, charge.currency))}</b> — échéance ${esc(date(charge.due_date, { day: "numeric", month: "long", year: "numeric" }))}</td></tr></table>
      ${s.legal_rib ? `<p class="muted">Paiement par virement — RIB : ${esc(s.legal_rib)}</p>` : ""}
      <div class="sign"><div>Cachet et signature</div><div></div></div>`,
      false,
      win,
    );
    void t;
  };
}

// 3. Client space link --------------------------------------------------------
export function PortalLinkDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { data, t, refresh, toast } = useApp();
  const [url, setUrl] = useState("");
  const fill = useTemplateValues();
  const hasLink = (data.portalLinks || []).includes(contact.id);
  async function create() {
    try {
      const r = await api(`/contacts/${contact.id}/portal-link`, {});
      setUrl(`${window.location.origin}/portal/${r.token}`);
      refresh();
    } catch (e: any) {
      toast(t(e.message));
    }
  }
  async function revoke() {
    await api(`/contacts/${contact.id}/portal-link/revoke`, {});
    await refresh();
    setUrl("");
    toast(t("The link no longer works"));
  }
  const body =
    data.templates.find((x) => x.name === "Client space")?.body || "{link}";
  return (
    <Dialog title={`${t("Client space")} · ${contact.name}`} onClose={onClose}>
      <div className="form-body">
        <p className="form-hint">
          {t(
            "A private page for the client: upcoming appointments and classes, video links, marks, certificates, balance and online payment. No password needed.",
          )}
        </p>
        {url ? (
          <ShareLink
            url={url}
            phone={contact.phone}
            message={fill(contact, undefined, { link: url })(body)}
          />
        ) : hasLink ? (
          <div className="info-box">
            {t("A link already exists. Creating a new one stops the old one.")}
          </div>
        ) : null}
      </div>
      <div className="dialog-footer">
        {hasLink && (
          <Button
            variant="danger-ghost"
            className="footer-delete"
            onClick={revoke}
          >
            {t("Stop the link")}
          </Button>
        )}
        <Button onClick={onClose}>{t("Close")}</Button>
        {!url && (
          <Button
            variant="primary"
            icon={<UserRound size={15} />}
            onClick={create}
          >
            {t(hasLink ? "Create a new link" : "Create the link")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

// 6. Satisfaction survey ------------------------------------------------------
export function useFeedbackRequest() {
  const { t, open, toast } = useApp();
  return async (contact: Row, about: string, staffId?: number) => {
    try {
      const r = await api("/feedback", {
        contact_id: contact.id,
        about,
        staff_id: staffId,
      });
      open({
        type: "whatsapp",
        contact,
        extra: {
          preset: "Feedback request",
          link: `${window.location.origin}/feedback/${r.token}`,
        },
      });
    } catch (e: any) {
      toast(t(e.message));
    }
  };
}
export function FeedbackPanel() {
  const { data, t, person, date } = useApp();
  const answered = (data.feedback || []).filter((f) => f.answered_at);
  const avg = answered.length
    ? answered.reduce((s, f) => s + f.rating, 0) / answered.length
    : 0;
  return (
    <Panel
      title="Client satisfaction"
      subtitle="Answers to the surveys sent after a course or consultations."
      action={
        answered.length ? (
          <Badge tone="teal">
            <Star size={12} /> {avg.toFixed(1)} / 5 · {answered.length}
          </Badge>
        ) : undefined
      }
    >
      <div className="reminder-list">
        {!answered.length && (
          <Empty
            title="No answers yet"
            text="Ask for feedback from a client's card (button “Ask for feedback”)."
          />
        )}
        {answered.slice(0, 8).map((f) => (
          <div key={f.id} className="reminder-row">
            <span className="stars">
              {"★".repeat(f.rating)}
              {"☆".repeat(5 - f.rating)}
            </span>
            <div>
              <strong>
                {person(f.contact_id).name} · {f.about}
              </strong>
              <small>
                {f.comment || "—"} · {date(f.answered_at)}
              </small>
            </div>
          </div>
        ))}
        {(data.feedback || []).length > answered.length && (
          <p className="form-hint">
            {(data.feedback || []).length - answered.length}{" "}
            {t("surveys waiting for an answer")}
          </p>
        )}
      </div>
    </Panel>
  );
}

// 5. Expenses and profit ------------------------------------------------------
export function ExpensesPanel() {
  const { data, t, open, money, date, perform, toast } = useApp();
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const rows = (data.expenses || []).filter((x) =>
    x.spent_on.startsWith(month),
  );
  const currency = data.settings.currency;
  const categories = Array.from(new Set(rows.map((x) => x.category)));
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>{t("Expenses")}</h2>
          <p>
            {t(
              "Rent, salaries, advertising, supplies… to see the real profit.",
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
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => open({ type: "expense" })}
          >
            {t("Add an expense")}
          </Button>
        </div>
      </div>
      <div className="cash-totals">
        <div>
          <small>{t("Total")}</small>
          <strong>
            {money(
              rows
                .filter((x) => x.currency === currency)
                .reduce((s, x) => s + x.amount, 0),
              currency,
            )}
          </strong>
        </div>
        {categories.map((c) => (
          <div key={c}>
            <small>{t(c)}</small>
            <strong>
              {money(
                rows
                  .filter((x) => x.category === c && x.currency === currency)
                  .reduce((s, x) => s + x.amount, 0),
                currency,
              )}
            </strong>
          </div>
        ))}
      </div>
      <DataTable
        rows={rows}
        columns={[
          { key: "spent_on", label: "Date", render: (x) => date(x.spent_on) },
          { key: "category", label: "Category", render: (x) => t(x.category) },
          { key: "label", label: "Description" },
          {
            key: "amount",
            label: "Amount",
            render: (x) => <strong>{money(x.amount, x.currency)}</strong>,
          },
          {
            key: "del",
            label: "",
            render: (x) => (
              <button
                className="icon-button danger"
                aria-label={t("Delete")}
                onClick={async () => {
                  if (!window.confirm(t("Delete this expense?"))) return;
                  await perform(`/expenses/${x.id}`, {}, "DELETE").catch(
                    (e: any) => toast(e.message),
                  );
                }}
              >
                <Trash2 size={15} />
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
export function ProfitPanel() {
  const { data, t, money } = useApp();
  const zone = data.settings.timezone;
  const currency = data.settings.currency;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.parse(data.today.slice(0, 7) + "-15T12:00:00Z"));
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  const rows = months.map((m, i) => {
    const income =
      data.payments
        .filter(
          (p) =>
            p.currency === currency &&
            localDate(new Date(p.created_at), zone).startsWith(m),
        )
        .reduce((s, p) => s + p.amount, 0) -
      data.refunds
        .filter(
          (r) =>
            localDate(new Date(r.created_at), zone).startsWith(m) &&
            data.payments.find((p) => p.id === r.payment_id)?.currency ===
              currency,
        )
        .reduce((s, r) => s + r.amount, 0);
    const spent = (data.expenses || [])
      .filter((x) => x.currency === currency && x.spent_on.startsWith(m))
      .reduce((s, x) => s + x.amount, 0);
    return { id: i, month: m, income, spent, profit: income - spent };
  });
  const fmt = (m: string) =>
    new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(m + "-15T12:00:00Z"));
  return (
    <Panel
      title="Income − expenses"
      subtitle="Money received minus expenses, month by month."
    >
      <DataTable
        rows={rows}
        columns={[
          { key: "month", label: "Month", render: (r) => fmt(r.month) },
          {
            key: "income",
            label: "Received",
            render: (r) => money(r.income, currency),
          },
          {
            key: "spent",
            label: "Expenses",
            render: (r) => money(r.spent, currency),
          },
          {
            key: "profit",
            label: "Result",
            render: (r) => (
              <strong className={r.profit < 0 ? "red-text" : "teal-text"}>
                {money(r.profit, currency)}
              </strong>
            ),
          },
        ]}
      />
      <p className="form-hint padded-hint">
        {t("Salaries count only once you record them as an expense.")}
      </p>
    </Panel>
  );
}

// 9. Campaigns ----------------------------------------------------------------
export function CampaignsPage() {
  const { data, t, perform, toast, person, program, cohort, date } = useApp();
  const [f, setF] = useState({
    service: "",
    interest: "",
    stage: "",
    program: "",
    level: "",
    language: "",
    students: "",
  });
  const [name, setName] = useState("");
  const [message, setMessage] = useState("Bonjour {name}, ");
  const [current, setCurrent] = useState<number | null>(null);
  const matches = useMemo(
    () =>
      data.contacts.filter((c) => {
        if (!c.consent || !c.phone) return false;
        const opps = data.opportunities.filter((o) => o.contact_id === c.id);
        const enr = data.enrollments.filter((e) => e.contact_id === c.id);
        if (f.service && !opps.some((o) => o.service_type === f.service))
          return false;
        if (
          f.interest &&
          !opps.some((o) =>
            `${o.interest} ${program(o.program_id).name}`
              .toLowerCase()
              .includes(f.interest.toLowerCase()),
          )
        )
          return false;
        if (f.stage && !opps.some((o) => o.stage === f.stage)) return false;
        if (
          f.program &&
          !enr.some((e) => String(cohort(e.cohort_id).program_id) === f.program)
        )
          return false;
        if (f.level && c.level !== f.level) return false;
        if (f.language && c.language !== f.language) return false;
        if (f.students === "current" && !enr.some((e) => e.status === "Active"))
          return false;
        if (
          f.students === "former" &&
          (!enr.length || enr.some((e) => e.status === "Active"))
        )
          return false;
        if (f.students === "never" && enr.length) return false;
        return true;
      }),
    [data, f],
  );
  async function create() {
    try {
      const r = await perform("/campaigns", {
        name,
        message,
        filters: f,
        contact_ids: matches.map((c) => c.id),
      });
      toast(`${r.recipients} ${t("recipients")}`);
      setCurrent(r.id);
      setName("");
    } catch (e: any) {
      toast(t(e.message));
    }
  }
  const camp = (data.campaigns || []).find((c) => c.id === current);
  const fill = (c: Row, text: string) =>
    text.replace(
      /\{(\w+)\}/g,
      (_, k) =>
        ({ name: c.name.split(" ")[0], academy: data.settings.academy })[
          k as "name"
        ] ?? "",
    );
  const select = (
    key: keyof typeof f,
    label: string,
    options: [string, string][],
  ) => (
    <label>
      <span>{t(label)}</span>
      <select
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      >
        <option value="">{t("All")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <PageHead
        title="Campaigns"
        subtitle="Send one message to a group of clients: new term, new course, event…"
      />
      <div className="settings-grid campaign-grid">
        <Panel
          title="1. Who receives it?"
          subtitle="Only clients who agreed to be contacted and have a phone number."
        >
          <div className="form-grid padded-grid">
            {select(
              "service",
              "Request type",
              Array.from(
                new Set(data.opportunities.map((o) => o.service_type)),
              ).map((s) => [s, t(s)]),
            )}
            <label>
              <span>{t("Course, language or topic")}</span>
              <input
                value={f.interest}
                onChange={(e) => setF({ ...f, interest: e.target.value })}
                placeholder={t("Example: English")}
              />
            </label>
            {select(
              "stage",
              "Stage",
              data.stages.map((s) => [s, t(s)]),
            )}
            {select(
              "program",
              "Enrolled in",
              data.programs.map((p) => [String(p.id), t(p.name)]),
            )}
            {select("students", "Students", [
              ["current", t("Current students")],
              ["former", t("Former students")],
              ["never", t("Never enrolled")],
            ])}
            {select(
              "level",
              "Level",
              Array.from(
                new Set(data.contacts.map((c) => c.level).filter(Boolean)),
              ).map((l) => [l, l]),
            )}
            {select(
              "language",
              "Preferred language",
              Array.from(new Set(data.contacts.map((c) => c.language))).map(
                (l) => [l, t(l)],
              ),
            )}
          </div>
          <p className="campaign-count">
            <Megaphone size={18} /> <strong>{matches.length}</strong>{" "}
            {t("clients match")}
          </p>
        </Panel>
        <Panel
          title="2. The message"
          subtitle="{name} is replaced by each client's first name."
        >
          <div className="booking-admin">
            <label className="template-edit">
              <span>{t("Campaign name")}</span>
              <input
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Example: Registrations September")}
              />
            </label>
            <div className="row-actions wrap">
              {data.templates.map((tpl) => (
                <button
                  key={tpl.id}
                  className="chip"
                  onClick={() => setMessage(tpl.body)}
                >
                  {t(tpl.name)}
                </button>
              ))}
            </div>
            <label className="template-edit">
              <span>{t("Message")}</span>
              <textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <Button
              variant="primary"
              icon={<Send size={16} />}
              disabled={!name || !message.trim() || !matches.length}
              onClick={create}
            >
              {t("Prepare the campaign")} ({matches.length})
            </Button>
          </div>
        </Panel>
      </div>
      {camp && (
        <Panel
          title={camp.name}
          subtitle={`${camp.recipients.filter((r: Row) => r.status === "sent").length} / ${camp.recipients.length} ${t("sent")}`}
          action={
            data.integrations?.whatsapp ? (
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    const r = await perform(
                      `/campaigns/${camp.id}/send-auto`,
                      {},
                    );
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
            ) : undefined
          }
        >
          <div className="reminder-list">
            {camp.recipients.map((r: Row) => {
              const c = person(r.contact_id);
              return (
                <div
                  key={r.contact_id}
                  className={`reminder-row ${r.status === "sent" ? "sent" : ""}`}
                >
                  <MessageCircle size={18} />
                  <div>
                    <strong>{c.name}</strong>
                    <small>{c.phone}</small>
                  </div>
                  {r.status === "sent" ? (
                    <Badge tone="teal">{t("Sent")}</Badge>
                  ) : (
                    <a
                      className="button small primary"
                      href={waLink(c.phone, fill(c, camp.message))}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        perform(`/campaigns/${camp.id}/sent`, {
                          contact_id: c.id,
                        }).catch(() => undefined);
                      }}
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <Panel title="Previous campaigns">
        <DataTable
          rows={data.campaigns || []}
          onRow={(c) => setCurrent(c.id)}
          columns={[
            {
              key: "name",
              label: "Name",
              render: (c) => <strong>{c.name}</strong>,
            },
            {
              key: "created_at",
              label: "Date",
              render: (c) => date(c.created_at),
            },
            {
              key: "progress",
              label: "Sent",
              render: (c) =>
                `${c.recipients.filter((r: Row) => r.status === "sent").length} / ${c.recipients.length}`,
            },
            {
              key: "del",
              label: "",
              render: (c) => (
                <button
                  className="icon-button danger"
                  aria-label={t("Delete")}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(t("Delete this campaign?"))) return;
                    await perform(`/campaigns/${c.id}`, {}, "DELETE").catch(
                      (err: any) => toast(err.message),
                    );
                    if (current === c.id) setCurrent(null);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

// Settings → Integrations status ------------------------------------------------
export function IntegrationStatus() {
  const { data, t, perform, toast } = useApp();
  const i = data.integrations || {
    chargily: false,
    whatsapp: false,
    chargilyMode: "test",
    cron: false,
  };
  const rows: [string, boolean, string][] = [
    [
      "Online card payment (Chargily)",
      i.chargily,
      "CHARGILY_SECRET_KEY, CHARGILY_MODE=live (after testing)",
    ],
    [
      "Automatic WhatsApp (Meta)",
      i.whatsapp,
      "WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE",
    ],
    [
      "Password e-mails (Resend)",
      !!data.mailConfigured,
      "RESEND_API_KEY, MAIL_FROM",
    ],
    [
      "Daily automatic reminders",
      i.cron && i.whatsapp,
      "CRON_SECRET (+ WhatsApp above)",
    ],
  ];
  return (
    <Panel
      title="Connected services"
      subtitle="Each service works as soon as its key is added in Vercel → Settings → Environment Variables, then redeployed."
    >
      <div className="reminder-list">
        {rows.map(([name, on, keys]) => (
          <div key={name} className="reminder-row">
            <Badge tone={on ? "teal" : "neutral"}>
              {t(on ? "Connected" : "Not connected")}
            </Badge>
            <div>
              <strong>{t(name)}</strong>
              <small>
                <code>{keys}</code>
              </small>
            </div>
          </div>
        ))}
        {i.whatsapp && data.permissions.admin && (
          <Button
            onClick={async () => {
              try {
                const r = await perform("/automations/whatsapp/run", {});
                toast(
                  `${r.sent} ${t("sent")}${r.failed ? ` · ${r.failed} ${t("failed")}` : ""}`,
                );
              } catch (e: any) {
                toast(t(e.message));
              }
            }}
          >
            {t("Send today's reminders now")}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Small video-call link shown in the calendar and appointment form. */
export function MeetingLink({ url }: { url: string }) {
  const { t } = useApp();
  if (!url) return null;
  return (
    <a
      className="meeting-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <Video size={14} /> {t("Join video call")}
    </a>
  );
}
