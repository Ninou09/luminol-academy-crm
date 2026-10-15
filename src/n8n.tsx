import { useState, type FormEvent } from "react";
import { useApp } from "./context";
import { Button, Badge, Panel, DataTable, Dialog, Empty } from "./ui";
import { type Row } from "./types";

export function N8nInbox() {
  const { data, t, perform, toast, profile, date, refresh } = useApp();
  const [review, setReview] = useState<Row | null>(null);
  const [email, setEmail] = useState("");
  const [program, setProgram] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = data.incoming || [];
  function open(row: Row) {
    setReview(row);
    setEmail(row.email);
    setProgram("");
    setOwner(String(row.owner_id));
    setError("");
  }
  function close() {
    if (busy) return;
    const changed =
      review &&
      (email !== review.email ||
        program !== "" ||
        owner !== String(review.owner_id));
    if (
      !changed ||
      window.confirm(t("You have unsaved changes. Discard changes?"))
    )
      setReview(null);
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
          email,
          program_id: Number(program),
          owner_id: Number(owner),
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
  return (
    <>
      <Panel
        title="Incoming from n8n"
        subtitle="Review the program and advisor before adding an inquiry to the pipeline."
        action={
          <div className="n8n-actions">
            <Badge tone={data.n8n?.configured ? "teal" : "neutral"}>
              {t(data.n8n?.configured ? "Ready to receive" : "Setup required")}{" "}
              · {rows.length}
            </Badge>
            <Button
              variant="small"
              onClick={() => refresh().catch((e) => toast(e.message))}
            >
              {t("Refresh")}
            </Button>
          </div>
        }
      >
        {rows.length ? (
          <DataTable
            rows={rows}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (row) => <strong>{row.name}</strong>,
              },
              {
                key: "interest",
                label: "Program of interest",
                render: (row) => (
                  <span>
                    {row.course_interest || row.service_type || t("To confirm")}
                  </span>
                ),
              },
              {
                key: "contact",
                label: "Contact",
                render: (row) => <span>{row.email || row.phone}</span>,
              },
              {
                key: "received",
                label: "Received",
                render: (row) => date(row.received_at),
              },
              {
                key: "review",
                label: "Review",
                render: (row) =>
                  data.permissions.editAdmissions ? (
                    <Button variant="small" onClick={() => open(row)}>
                      {t("Review inquiry")}
                    </Button>
                  ) : (
                    t("Read only")
                  ),
              },
            ]}
          />
        ) : (
          <Empty
            title="No incoming inquiries"
            text="New inquiries from your n8n lead table will appear here."
          />
        )}
      </Panel>
      {review && (
        <Dialog title={t("Review inquiry")} onClose={close}>
          <form onSubmit={submit}>
            <div className="detail-content">
              <h3>{review.name}</h3>
              <p>{review.course_interest || review.service_type}</p>
              <p className="muted">
                {review.phone} ·{" "}
                {t(
                  review.consent
                    ? "Communication consent recorded"
                    : "Communication consent not recorded",
                )}
              </p>
              <p className="muted">
                {t(
                  "Existing contact details and consent are preserved when a match is found.",
                )}
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>{t("Email")}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                  />
                </label>
                <label className="field">
                  <span>{t("Program of interest")} *</span>
                  <select
                    required
                    value={program}
                    onChange={(e) => setProgram(e.target.value)}
                  >
                    <option value="">{t("Choose…")}</option>
                    {data.programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("Assign advisor")} *</span>
                  <select
                    required
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                  >
                    <option value="">{t("Choose…")}</option>
                    {data.users
                      .filter((u) => ["admin", "admissions"].includes(u.role))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <Button disabled={busy} onClick={close}>
                {t("Cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t(busy ? "Saving…" : "Add to admissions")}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
