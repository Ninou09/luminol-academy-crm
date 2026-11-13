import { useState, type FormEvent } from "react";
import { Check, Download, RefreshCw, X } from "lucide-react";
import { useApp } from "./context";
import { Button, Badge, Panel, DataTable, Dialog } from "./ui";
import { api, type Row } from "./types";

const guess = (text: string) => {
  const v = text.toLowerCase();
  if (/consult|استشار|therap/.test(v)) return "Psychology consultation";
  if (/psych|نفس/.test(v)) return "Psychology course";
  if (/lang|english|french|anglais|إنجليز|فرنس|لغ/.test(v))
    return "Language course";
  if (/train|formation|تدريب|تكوين/.test(v)) return "Training";
  return "Course";
};

/** Leads that arrive from the website / Google form through n8n. */
export function N8nInbox() {
  const { data, t, perform, toast, profile, date, refresh } = useApp();
  const [review, setReview] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = data.incoming || [];
  const editable = data.permissions.editAdmissions;
  const advisors = data.users.filter(
    (u) => u.active !== 0 && ["admin", "admissions"].includes(u.role),
  );
  function open(row: Row) {
    setReview(row);
    const programMatch = data.programs.find(
      (p) => p.name.toLowerCase() === (row.course_interest || "").toLowerCase(),
    );
    setForm({
      email: row.email,
      service_type: guess(`${row.service_type} ${row.course_interest}`),
      interest: row.course_interest || row.service_type || "",
      program_id: programMatch ? String(programMatch.id) : "",
      owner_id: String(
        advisors.some((u) => u.id === row.owner_id)
          ? row.owner_id
          : data.user.id,
      ),
    });
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const result = await perform(
        `/integrations/n8n/inquiries/${review.id}/convert`,
        {
          ...form,
          program_id: form.program_id ? Number(form.program_id) : null,
          owner_id: Number(form.owner_id),
          version: review.version,
        },
      );
      setReview(null);
      toast(t("Inquiry added to admissions"));
      profile(result.contact_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function importAll() {
    if (
      !window.confirm(
        t(
          "Add every waiting lead to the requests board? You can edit each one afterwards.",
        ),
      )
    )
      return;
    setBusy(true);
    try {
      const result = await perform("/integrations/n8n/inquiries/import-all", {
        owner_id: data.user.id,
      });
      toast(
        `${result.imported} ${t("leads imported")}` +
          (result.skipped.length
            ? ` · ${result.skipped.length} ${t("need a manual review")}`
            : ""),
      );
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss(row: Row) {
    if (!window.confirm(t("Dismiss this lead (spam, duplicate or test)?")))
      return;
    try {
      await api(`/integrations/n8n/inquiries/${row.id}/dismiss`, {});
      await refresh();
      toast(t("Lead dismissed"));
    } catch (e: any) {
      toast(e.message);
    }
  }
  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  if (!rows.length && !data.permissions.admin) return null;
  return (
    <>
      <Panel
        title="New leads from the website / Google"
        subtitle="Check each lead and add it to your requests, or import them all at once."
        className="inbox-panel"
        action={
          <div className="n8n-actions">
            <Badge tone={rows.length ? "amber" : "neutral"}>
              {rows.length} {t("waiting")}
            </Badge>
            <Button
              variant="small"
              icon={<RefreshCw size={14} />}
              onClick={() => refresh().catch((e) => toast(e.message))}
            >
              {t("Refresh")}
            </Button>
            {editable && rows.length > 0 && (
              <Button
                variant="small primary"
                icon={<Download size={14} />}
                disabled={busy}
                onClick={importAll}
              >
                {t("Import all")}
              </Button>
            )}
          </div>
        }
      >
        {rows.length ? (
          <DataTable
            rows={rows}
            pageSize={5}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (row) => (
                  <span>
                    <strong>{row.name}</strong>
                    <small className="block muted">
                      {row.phone || row.email}
                    </small>
                  </span>
                ),
              },
              {
                key: "interest",
                label: "Asked about",
                render: (row) => (
                  <span>
                    {row.course_interest || row.service_type || t("To confirm")}
                  </span>
                ),
              },
              {
                key: "received",
                label: "Received",
                render: (row) => date(row.submitted_at || row.received_at),
              },
              {
                key: "review",
                label: "",
                render: (row) =>
                  editable ? (
                    <div className="row-actions">
                      <Button
                        variant="small primary"
                        icon={<Check size={14} />}
                        onClick={() => open(row)}
                      >
                        {t("Accept")}
                      </Button>
                      <Button
                        variant="small"
                        icon={<X size={14} />}
                        onClick={() => dismiss(row)}
                      >
                        {t("Dismiss")}
                      </Button>
                    </div>
                  ) : (
                    t("Read only")
                  ),
              },
            ]}
          />
        ) : (
          <p className="inbox-empty">
            {t(
              data.n8n?.configured
                ? "No new leads right now. New requests from your website form appear here automatically."
                : "No new leads. The website connection is not configured on this server yet.",
            )}
          </p>
        )}
      </Panel>
      {review && (
        <Dialog
          title={t("Accept lead")}
          onClose={() => !busy && setReview(null)}
          wide
        >
          <form onSubmit={submit}>
            <div className="form-body">
              <div className="form-person">
                <div>
                  <strong>{review.name}</strong>
                  <small>
                    {[review.phone, review.email].filter(Boolean).join(" · ")} ·{" "}
                    {t(
                      review.consent
                        ? "Communication consent recorded"
                        : "Communication consent not recorded",
                    )}
                  </small>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>{t("What does the client want?")}</span>
                  <input
                    list="lead-service"
                    required
                    value={form.service_type}
                    onChange={(e) => set("service_type", e.target.value)}
                  />
                  <datalist id="lead-service">
                    {(data.serviceTypes || []).map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span>{t("Course, language or topic")}</span>
                  <input
                    list="lead-interest"
                    value={form.interest}
                    onChange={(e) => set("interest", e.target.value)}
                  />
                  <datalist id="lead-interest">
                    {data.programs.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span>{t("Linked program (optional)")}</span>
                  <select
                    value={form.program_id}
                    onChange={(e) => set("program_id", e.target.value)}
                  >
                    <option value="">{t("— None —")}</option>
                    {data.programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("Responsible person")} *</span>
                  <select
                    required
                    value={form.owner_id}
                    onChange={(e) => set("owner_id", e.target.value)}
                  >
                    {advisors.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full-field">
                  <span>{t("Email")}</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    maxLength={254}
                  />
                  <small className="form-hint">
                    {t(
                      "Optional. Existing contact details and consent are preserved when a match is found.",
                    )}
                  </small>
                </label>
              </div>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                {t("Cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t(busy ? "Saving…" : "Add to requests")}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
