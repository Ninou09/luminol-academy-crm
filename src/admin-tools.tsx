import { useEffect, useState } from "react";
import {
  Plus,
  Play,
  Trash2,
  Copy,
  ExternalLink,
  Zap,
  KeyRound,
  Webhook,
  CalendarSync,
  Activity,
  Pencil,
  Save,
} from "lucide-react";
import { useApp } from "./context";
import { api } from "./types";
type Row = Record<string, any>;
import { Badge, Button, Dialog, Empty, Panel } from "./ui";
import { defaultTemplates } from "./platform";

const copy = (
  text: string,
  toast: (s: string) => void,
  t: (s: string) => string,
) => {
  navigator.clipboard?.writeText(text);
  toast(t("Copied"));
};
const triggerLabel: Record<string, string> = {
  inquiry_created: "A new request arrives",
  appointment_created: "An appointment is created",
  appointment_upcoming: "Before an appointment",
  appointment_cancelled: "An appointment is cancelled",
  appointment_no_show: "The client did not come",
  appointment_done: "After an appointment",
  payment_received: "A payment is received",
  payment_overdue: "A payment is late",
  package_ending: "A package is almost used",
  session_missed: "A group session is missed",
  birthday: "Birthday of the client",
  cohort_ended: "A group has ended",
  inactive: "The client has not come for a while",
};
const actionLabel: Record<string, string> = {
  task: "Create a task",
  whatsapp: "Prepare a WhatsApp message",
  stage: "Change the request stage",
  tag: "Add a tag",
  notify: "Notify a staff member",
};

// 2. Automation builder ----------------------------------------------------
export function FlowsPanel() {
  const { data, t, date, time, perform, toast } = useApp();
  const flows = data.flows || [];
  const [edit, setEdit] = useState<Row | null>(null);
  const [result, setResult] = useState<Record<number, string>>({});
  return (
    <div className="settings-stack">
      <Panel
        title="Scenarios: When → If → Do"
        subtitle="The CRM watches events and does the work for you. Each scenario runs once per client and event."
        action={
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() =>
              setEdit({
                name: "",
                trigger: "inquiry_created",
                delay_minutes: 0,
                conditions: {},
                actions: [{ type: "task", title: "" }],
              })
            }
          >
            {t("New scenario")}
          </Button>
        }
      >
        <div className="preset-row">
          <span>{t("Ready-made, one click:")}</span>
          {(data.flowPresets || []).map((p) => (
            <Button
              key={p.key}
              variant="small"
              icon={<Zap size={14} />}
              disabled={flows.some((f) => f.name === t(p.name))}
              onClick={async () => {
                try {
                  await perform("/flows", { ...p, name: t(p.name) });
                  toast(t("Scenario added"));
                } catch (e: any) {
                  toast(e.message);
                }
              }}
            >
              {t(p.name)}
            </Button>
          ))}
        </div>
        {flows.length === 0 ? (
          <Empty
            title="No scenario yet"
            text="Start with a ready-made one or create your own."
          />
        ) : (
          <div className="flow-list">
            {flows.map((f) => (
              <article
                key={f.id}
                className={`flow-card ${f.enabled ? "" : "off"}`}
              >
                <header>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={!!f.enabled}
                      onChange={(e) =>
                        perform(
                          `/flows/${f.id}`,
                          { enabled: e.target.checked },
                          "PATCH",
                        )
                      }
                    />
                    <span>{f.enabled ? t("On") : t("Off")}</span>
                  </label>
                  <h3>{f.name}</h3>
                  <Badge tone="neutral">
                    {f.total} {t("run(s)")}
                  </Badge>
                </header>
                <p className="flow-sentence">
                  <b>{t("When")}</b> {t(triggerLabel[f.trigger] || f.trigger)}
                  {f.delay_minutes > 0 &&
                    ` · ${f.trigger === "appointment_upcoming" ? "" : t("after") + " "}${delayText(f.delay_minutes, t)}${
                      f.trigger === "appointment_upcoming"
                        ? " " + t("before")
                        : ""
                    }`}
                  {conditionText(f.conditions, data, t) && (
                    <>
                      {" "}
                      <b>{t("If")}</b> {conditionText(f.conditions, data, t)}
                    </>
                  )}{" "}
                  <b>{t("Do")}</b>{" "}
                  {f.actions.map((a: Row) => t(actionLabel[a.type])).join(", ")}
                </p>
                {result[f.id] && <p className="flow-test">{result[f.id]}</p>}
                {f.runs.length > 0 && (
                  <details>
                    <summary>{t("Log of runs")}</summary>
                    <ul className="flow-log">
                      {f.runs.map((r: Row) => (
                        <li key={r.id}>
                          <small>
                            {date(r.created_at)} {time(r.created_at)}
                          </small>{" "}
                          {r.test ? (
                            <Badge tone="blue">{t("Test")}</Badge>
                          ) : null}{" "}
                          {r.detail}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <footer>
                  <Button
                    variant="small"
                    icon={<Play size={14} />}
                    onClick={async () => {
                      try {
                        const r = await perform(`/flows/${f.id}/test`, {});
                        setResult({
                          ...result,
                          [f.id]: r.found
                            ? `${t("Test on the last case")}: ${r.detail}`
                            : t(r.detail),
                        });
                      } catch (e: any) {
                        toast(e.message);
                      }
                    }}
                  >
                    {t("Test")}
                  </Button>
                  <Button
                    variant="small"
                    icon={<Pencil size={14} />}
                    onClick={() => setEdit(f)}
                  >
                    {t("Edit")}
                  </Button>
                  <Button
                    variant="small"
                    icon={<Trash2 size={14} />}
                    onClick={() =>
                      window.confirm(t("Delete this scenario?")) &&
                      perform(`/flows/${f.id}`, {}, "DELETE")
                    }
                  >
                    {t("Delete")}
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        )}
        <div className="panel-foot">
          <Button
            icon={<Play size={15} />}
            onClick={async () => {
              const r = await perform("/flows/run", {});
              toast(`${r.ran} ${t("action(s) done now")}`);
            }}
          >
            {t("Run the scenarios now")}
          </Button>
          <span className="form-hint">
            {t(
              "They also run by themselves when someone opens the CRM and every morning.",
            )}
          </span>
        </div>
      </Panel>
      {edit && <FlowDialog flow={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
function delayText(min: number, t: (s: string) => string) {
  return min % 1440 === 0
    ? `${min / 1440} ${t("day(s)")}`
    : `${Math.round(min / 60)} ${t("hour(s)")}`;
}
function conditionText(c: Row, data: any, t: (s: string) => string) {
  const parts: string[] = [];
  if (c.service) parts.push(`${t("service")} « ${c.service} »`);
  if (c.staff_id)
    parts.push(
      `${t("with")} ${data.users.find((u: Row) => u.id === Number(c.staff_id))?.name || ""}`,
    );
  if (c.source) parts.push(`${t("source")} « ${c.source} »`);
  if (c.min_amount) parts.push(`${t("amount")} ≥ ${c.min_amount / 100}`);
  if (c.language) parts.push(`${t("language")} ${t(c.language)}`);
  if (c.tag_id)
    parts.push(
      `${t("tag")} ${(data.tags || []).find((x: Row) => x.id === Number(c.tag_id))?.name || ""}`,
    );
  if (c.segment_id)
    parts.push(
      `${t("segment")} ${(data.segments || []).find((x: Row) => x.id === Number(c.segment_id))?.name || ""}`,
    );
  if (c.days) parts.push(`${c.days} ${t("days without a visit")}`);
  return parts.join(", ");
}
function FlowDialog({ flow, onClose }: { flow: Row; onClose: () => void }) {
  const { data, t, perform, toast } = useApp();
  const [f, setF] = useState<Row>({
    ...flow,
    conditions: { ...flow.conditions },
    actions: flow.actions.map((a: Row) => ({ ...a })),
  });
  const [unit, setUnit] = useState(
    flow.delay_minutes && flow.delay_minutes % 1440 === 0 ? "days" : "hours",
  );
  const amount = f.delay_minutes
    ? unit === "days"
      ? f.delay_minutes / 1440
      : f.delay_minutes / 60
    : 0;
  const cond = (k: string, v: any) =>
    setF({ ...f, conditions: { ...f.conditions, [k]: v } });
  const act = (i: number, v: Row) =>
    setF({
      ...f,
      actions: f.actions.map((a: Row, j: number) =>
        j === i ? { ...a, ...v } : a,
      ),
    });
  async function save() {
    try {
      const body = { ...f };
      delete body.runs;
      delete body.total;
      if (flow.id) await perform(`/flows/${flow.id}`, body, "PATCH");
      else await perform("/flows", body);
      toast(t("Scenario saved"));
      onClose();
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <Dialog
      title={t(flow.id ? "Edit the scenario" : "New scenario")}
      onClose={onClose}
      wide
    >
      <div className="form-body flow-builder">
        <label className="field">
          <span>{t("Name")}</span>
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder={t("Example: thank you after the first consultation")}
          />
        </label>
        <fieldset className="flow-step">
          <legend>1. {t("When")}</legend>
          <select
            value={f.trigger}
            onChange={(e) => setF({ ...f, trigger: e.target.value })}
          >
            {(data.flowTriggers || []).map((k) => (
              <option key={k} value={k}>
                {t(triggerLabel[k] || k)}
              </option>
            ))}
          </select>
          <div className="inline-form">
            <label className="field">
              <span>
                {t(
                  f.trigger === "appointment_upcoming"
                    ? "How long before"
                    : "Wait",
                )}
              </span>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) =>
                  setF({
                    ...f,
                    delay_minutes: Math.round(
                      Number(e.target.value || 0) *
                        (unit === "days" ? 1440 : 60),
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span>{t("Unit")}</span>
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setF({
                    ...f,
                    delay_minutes: Math.round(
                      amount * (e.target.value === "days" ? 1440 : 60),
                    ),
                  });
                }}
              >
                <option value="hours">{t("hours")}</option>
                <option value="days">{t("days")}</option>
              </select>
            </label>
            {f.trigger === "inactive" && (
              <label className="field">
                <span>{t("Days without a visit")}</span>
                <input
                  type="number"
                  min="7"
                  value={f.conditions.days || 60}
                  onChange={(e) => cond("days", Number(e.target.value))}
                />
              </label>
            )}
          </div>
        </fieldset>
        <fieldset className="flow-step">
          <legend>2. {t("If (optional)")}</legend>
          <div className="form-grid">
            <label className="field">
              <span>{t("Service contains")}</span>
              <input
                value={f.conditions.service || ""}
                onChange={(e) => cond("service", e.target.value)}
                placeholder={t("Example: English")}
              />
            </label>
            <label className="field">
              <span>{t("Specialist")}</span>
              <select
                value={f.conditions.staff_id || ""}
                onChange={(e) =>
                  cond("staff_id", e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">{t("All")}</option>
                {data.users
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Source contains")}</span>
              <input
                value={f.conditions.source || ""}
                onChange={(e) => cond("source", e.target.value)}
                placeholder="Instagram"
              />
            </label>
            <label className="field">
              <span>
                {t("Amount at least")} ({data.settings.currency})
              </span>
              <input
                type="number"
                min="0"
                value={
                  f.conditions.min_amount ? f.conditions.min_amount / 100 : ""
                }
                onChange={(e) =>
                  cond(
                    "min_amount",
                    Math.round(Number(e.target.value || 0) * 100),
                  )
                }
              />
            </label>
            <label className="field">
              <span>{t("Language of the client")}</span>
              <select
                value={f.conditions.language || ""}
                onChange={(e) => cond("language", e.target.value)}
              >
                <option value="">{t("All")}</option>
                {Array.from(new Set(data.contacts.map((c) => c.language))).map(
                  (l) => (
                    <option key={l} value={l}>
                      {t(l)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>{t("Tag")}</span>
              <select
                value={f.conditions.tag_id || ""}
                onChange={(e) =>
                  cond("tag_id", e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">{t("All")}</option>
                {(data.tags || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {(data.segments || []).length > 0 && (
              <label className="field">
                <span>{t("Saved segment")}</span>
                <select
                  value={f.conditions.segment_id || ""}
                  onChange={(e) =>
                    cond(
                      "segment_id",
                      e.target.value ? Number(e.target.value) : "",
                    )
                  }
                >
                  <option value="">{t("All")}</option>
                  {(data.segments || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </fieldset>
        <fieldset className="flow-step">
          <legend>3. {t("Do")}</legend>
          {f.actions.map((a: Row, i: number) => (
            <div key={i} className="flow-action">
              <select
                value={a.type}
                onChange={(e) => act(i, { type: e.target.value })}
              >
                {Object.entries(actionLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
              {a.type === "task" && (
                <>
                  <input
                    value={a.title || ""}
                    placeholder={t("Task, for example: Call {name}")}
                    onChange={(e) => act(i, { title: e.target.value })}
                  />
                  <input
                    type="number"
                    min="0"
                    className="narrow"
                    title={t("Due in (days)")}
                    value={a.days || 0}
                    onChange={(e) => act(i, { days: Number(e.target.value) })}
                  />
                </>
              )}
              {a.type === "whatsapp" && (
                <>
                  <select
                    value={a.template_id || ""}
                    onChange={(e) =>
                      act(i, {
                        template_id: e.target.value
                          ? Number(e.target.value)
                          : "",
                      })
                    }
                  >
                    <option value="">{t("My own text")}</option>
                    {data.templates.map((x) => (
                      <option key={x.id} value={x.id}>
                        {t(x.name)}
                      </option>
                    ))}
                  </select>
                  {!a.template_id && (
                    <textarea
                      rows={2}
                      value={a.text || ""}
                      placeholder="Bonjour {name}, …"
                      onChange={(e) => act(i, { text: e.target.value })}
                    />
                  )}
                </>
              )}
              {a.type === "stage" && (
                <select
                  value={a.stage || ""}
                  onChange={(e) => act(i, { stage: e.target.value })}
                >
                  <option value="">—</option>
                  {data.stages.map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </select>
              )}
              {a.type === "tag" && (
                <select
                  value={a.tag_id || ""}
                  onChange={(e) => act(i, { tag_id: Number(e.target.value) })}
                >
                  <option value="">—</option>
                  {(data.tags || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
              {a.type === "notify" && (
                <>
                  <select
                    value={a.user_id || ""}
                    onChange={(e) =>
                      act(i, {
                        user_id: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                  >
                    <option value="">{t("The person in charge")}</option>
                    {data.users
                      .filter((u) => u.active)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                  <input
                    value={a.text || ""}
                    placeholder={t("Message")}
                    onChange={(e) => act(i, { text: e.target.value })}
                  />
                </>
              )}
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() =>
                  setF({
                    ...f,
                    actions: f.actions.filter((_: Row, j: number) => j !== i),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <Button
            variant="small"
            icon={<Plus size={14} />}
            onClick={() =>
              setF({
                ...f,
                actions: [...f.actions, { type: "task", title: "" }],
              })
            }
          >
            {t("Add an action")}
          </Button>
          <p className="form-hint">
            {t(
              "You can use {name}, {date}, {time}, {service}, {amount} and {academy} in the texts.",
            )}{" "}
            {!data.integrations?.whatsapp &&
              t(
                "Without the Meta key, WhatsApp messages are prepared in Drafts to send by hand.",
              )}
          </p>
        </fieldset>
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" icon={<Save size={15} />} onClick={save}>
          {t("Save the scenario")}
        </Button>
      </div>
    </Dialog>
  );
}

// 3. Custom fields, tags, segments ------------------------------------------
export function FieldsTagsPanel() {
  const { data, t, perform, toast } = useApp();
  const [form, setForm] = useState({
    entity: "contact",
    label: "",
    kind: "text",
    options: "",
  });
  const [tag, setTag] = useState("");
  return (
    <div className="settings-stack">
      {data.permissions.admin && (
        <Panel
          title="Your own fields"
          subtitle="Add the information you need on each client, request or group: Wilaya, profession, how they found you…"
        >
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await perform("/custom-fields", form);
                setForm({ ...form, label: "", options: "" });
                toast(t("Field added"));
              } catch (err: any) {
                toast(err.message);
              }
            }}
          >
            <label className="field">
              <span>{t("Field name")}</span>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Wilaya"
              />
            </label>
            <label className="field">
              <span>{t("On")}</span>
              <select
                value={form.entity}
                onChange={(e) => setForm({ ...form, entity: e.target.value })}
              >
                <option value="contact">{t("Client")}</option>
                <option value="opportunity">{t("Request")}</option>
                <option value="cohort">{t("Group")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("Type")}</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                <option value="text">{t("Text")}</option>
                <option value="number">{t("Number")}</option>
                <option value="date">{t("Date")}</option>
                <option value="list">{t("List of choices")}</option>
                <option value="yesno">{t("Yes / No")}</option>
              </select>
            </label>
            {form.kind === "list" && (
              <label className="field grow">
                <span>{t("Choices (one per line or comma)")}</span>
                <input
                  value={form.options}
                  onChange={(e) =>
                    setForm({ ...form, options: e.target.value })
                  }
                  placeholder="Alger, Blida, Oran"
                />
              </label>
            )}
            <Button variant="primary" type="submit">
              {t("Add")}
            </Button>
          </form>
          <div className="today-list">
            {(data.customFields || []).map((f) => (
              <div key={f.id} className="today-row">
                <div className="today-main">
                  <strong>{f.label}</strong>
                  <small>
                    {t(
                      {
                        contact: "Client",
                        opportunity: "Request",
                        cohort: "Group",
                      }[f.entity as string] || f.entity,
                    )}{" "}
                    ·{" "}
                    {t(
                      {
                        text: "Text",
                        number: "Number",
                        date: "Date",
                        list: "List of choices",
                        yesno: "Yes / No",
                      }[f.kind as string] || f.kind,
                    )}
                    {f.options.length ? ` · ${f.options.join(", ")}` : ""}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label={t("Delete")}
                  onClick={() =>
                    window.confirm(t("Delete this field and its values?")) &&
                    perform(`/custom-fields/${f.id}`, {}, "DELETE")
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel
        title="Tags"
        subtitle="Colour labels on clients. Click a tag on the client card to add or remove it."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await perform("/tags", { name: tag });
              setTag("");
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field">
            <span>{t("New tag")}</span>
            <input
              required
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="VIP"
            />
          </label>
          <Button variant="primary" type="submit">
            {t("Add")}
          </Button>
        </form>
        <div className="tag-editor padded">
          {(data.tags || []).map((g) => (
            <span key={g.id} className={`tag-toggle on ${g.color}`}>
              {g.name} ·{" "}
              {(data.contactTags || []).filter((x) => x.tag_id === g.id).length}
              {data.permissions.admin && (
                <button
                  aria-label={t("Delete")}
                  onClick={() =>
                    window.confirm(t("Delete this tag?")) &&
                    perform(`/tags/${g.id}`, {}, "DELETE")
                  }
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </Panel>
      <SegmentsPanel />
    </div>
  );
}
export function SegmentsPanel() {
  const { data, t, perform, toast, go } = useApp();
  const empty = {
    tag_ids: [] as number[],
    service: "",
    source: "",
    language: "",
    inactive_days: "",
    consent: false,
    fields: {} as Record<string, string>,
  };
  const [f, setF] = useState(empty);
  const [name, setName] = useState("");
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      api("/segments/preview", { filters: f })
        .then((r) => setCount(r.contact_ids.length))
        .catch(() => setCount(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [JSON.stringify(f)]);
  const fields = (data.customFields || []).filter(
    (x) => x.entity === "contact",
  );
  return (
    <Panel
      title="Segments"
      subtitle="Save a group of clients, for example: Psychology + Blida + no visit for 60 days. Use it in campaigns and scenarios."
    >
      <div className="form-grid padded-grid">
        <label className="field">
          <span>{t("Service or course")}</span>
          <input
            value={f.service}
            onChange={(e) => setF({ ...f, service: e.target.value })}
            placeholder={t("Example: Psychology")}
          />
        </label>
        <label className="field">
          <span>{t("Source contains")}</span>
          <input
            value={f.source}
            onChange={(e) => setF({ ...f, source: e.target.value })}
            placeholder="Instagram"
          />
        </label>
        <label className="field">
          <span>{t("No visit for (days)")}</span>
          <input
            type="number"
            min="0"
            value={f.inactive_days}
            onChange={(e) => setF({ ...f, inactive_days: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("Preferred language")}</span>
          <select
            value={f.language}
            onChange={(e) => setF({ ...f, language: e.target.value })}
          >
            <option value="">{t("All")}</option>
            {Array.from(new Set(data.contacts.map((c) => c.language))).map(
              (l) => (
                <option key={l} value={l}>
                  {t(l)}
                </option>
              ),
            )}
          </select>
        </label>
        {fields.map((x) => (
          <label key={x.id} className="field">
            <span>{x.label}</span>
            {x.kind === "list" ? (
              <select
                value={f.fields[x.id] || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    fields: { ...f.fields, [x.id]: e.target.value },
                  })
                }
              >
                <option value="">{t("All")}</option>
                {x.options.map((o: string) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                value={f.fields[x.id] || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    fields: { ...f.fields, [x.id]: e.target.value },
                  })
                }
              />
            )}
          </label>
        ))}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={f.consent}
            onChange={(e) => setF({ ...f, consent: e.target.checked })}
          />
          <span>{t("Only clients who agreed to be contacted")}</span>
        </label>
      </div>
      {(data.tags || []).length > 0 && (
        <div className="tag-editor padded">
          {(data.tags || []).map((g) => {
            const on = f.tag_ids.includes(g.id);
            return (
              <button
                key={g.id}
                className={`tag-toggle ${g.color} ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  setF({
                    ...f,
                    tag_ids: on
                      ? f.tag_ids.filter((x) => x !== g.id)
                      : [...f.tag_ids, g.id],
                  })
                }
              >
                {g.name}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await perform("/segments", { name, filters: f });
            setName("");
            setF(empty);
            toast(t("Segment saved"));
          } catch (err: any) {
            toast(err.message);
          }
        }}
      >
        <strong className="segment-count">
          {count ?? "…"} {t("client(s)")}
        </strong>
        <label className="field grow">
          <span>{t("Segment name")}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button variant="primary" type="submit">
          {t("Save the segment")}
        </Button>
      </form>
      <div className="today-list">
        {(data.segments || []).map((s) => (
          <div key={s.id} className="today-row">
            <div className="today-main">
              <strong>{s.name}</strong>
              <small>
                {s.contact_ids.length} {t("client(s)")}
              </small>
            </div>
            {data.permissions.editAdmissions && (
              <Button variant="small" onClick={() => go("Campaigns")}>
                {t("Campaign")}
              </Button>
            )}
            <button
              className="icon-button"
              aria-label={t("Delete")}
              onClick={() => perform(`/segments/${s.id}`, {}, "DELETE")}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// 4. Form builder -------------------------------------------------------------
const fieldTypes = [
  "text",
  "phone",
  "email",
  "textarea",
  "select",
  "date",
  "number",
  "checkbox",
];
const newForm = (): Row =>
  ({
    title: "",
    title_ar: "",
    intro: "",
    intro_ar: "",
    consent_text:
      "J'accepte que l'académie me contacte au sujet de ma demande.",
    service: "",
    fields: [
      {
        key: "name",
        label: "Nom et prénom",
        label_ar: "الاسم واللقب",
        type: "text",
        required: true,
        map: "name",
      },
      {
        key: "phone",
        label: "Téléphone",
        label_ar: "الهاتف",
        type: "phone",
        required: true,
        map: "phone",
      },
      {
        key: "email",
        label: "E-mail",
        label_ar: "البريد الإلكتروني",
        type: "email",
        required: false,
        map: "email",
      },
      {
        key: "message",
        label: "Votre message",
        label_ar: "رسالتك",
        type: "textarea",
        required: false,
        map: "message",
      },
    ],
  }) as Row;
export function FormsPanel() {
  const { data, t, perform, toast } = useApp();
  const [edit, setEdit] = useState<Row | null>(null);
  const link = (f: Row) => `${location.origin}/f/${f.slug}`;
  return (
    <div className="settings-stack">
      <Panel
        title="Your forms"
        subtitle="Replace Google Forms and Tally. Each answer creates the client and the request directly in the CRM."
        action={
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setEdit(newForm())}
          >
            {t("New form")}
          </Button>
        }
      >
        {(data.forms || []).length === 0 ? (
          <Empty
            title="No form yet"
            text="Create one, then share its link on Instagram, Facebook or your website."
          />
        ) : (
          <div className="form-cards">
            {(data.forms || []).map((f) => (
              <article
                key={f.id}
                className={`form-card ${f.active ? "" : "off"}`}
              >
                <h3>{f.title}</h3>
                <div className="form-stats">
                  <span>
                    <b>{f.views}</b> {t("opened")}
                  </span>
                  <span>
                    <b>{f.submissions}</b> {t("sent")}
                  </span>
                  <span>
                    <b>
                      {f.views
                        ? Math.round((f.submissions / f.views) * 100)
                        : 0}
                      %
                    </b>{" "}
                    {t("conversion")}
                  </span>
                  <span>
                    <b>{f.spam}</b> {t("spam blocked")}
                  </span>
                </div>
                <code className="form-link">{link(f)}</code>
                <footer>
                  <Button
                    variant="small"
                    icon={<Copy size={14} />}
                    onClick={() => copy(link(f), toast, t)}
                  >
                    {t("Copy the link")}
                  </Button>
                  <Button
                    variant="small"
                    icon={<Copy size={14} />}
                    onClick={() =>
                      copy(
                        `<iframe src="${link(f)}?embed=1" style="width:100%;min-height:720px;border:0" title="${f.title}"></iframe>`,
                        toast,
                        t,
                      )
                    }
                  >
                    {t("Code for the website")}
                  </Button>
                  <a
                    className="button small"
                    href={`/f/${f.slug}?preview=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} /> {t("Open")}
                  </a>
                  <Button
                    variant="small"
                    icon={<Pencil size={14} />}
                    onClick={() => setEdit(f)}
                  >
                    {t("Edit")}
                  </Button>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={!!f.active}
                      onChange={(e) =>
                        perform(
                          `/forms/${f.id}`,
                          { active: e.target.checked },
                          "PATCH",
                        )
                      }
                    />
                    <span>{f.active ? t("On") : t("Off")}</span>
                  </label>
                </footer>
              </article>
            ))}
          </div>
        )}
      </Panel>
      {edit && <FormDialog form={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
function FormDialog({ form, onClose }: { form: Row; onClose: () => void }) {
  const { data, t, perform, toast } = useApp();
  const [f, setF] = useState<Row>({
    ...form,
    fields: form.fields.map((x: Row) => ({
      ...x,
      options: Array.isArray(x.options)
        ? x.options.join(", ")
        : x.options || "",
    })),
  });
  const field = (i: number, v: Row) =>
    setF({
      ...f,
      fields: f.fields.map((x: Row, j: number) =>
        j === i ? { ...x, ...v } : x,
      ),
    });
  const custom = (data.customFields || []).filter(
    (x) => x.entity === "contact",
  );
  return (
    <Dialog
      title={t(form.id ? "Edit the form" : "New form")}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        <div className="form-grid">
          <label className="field">
            <span>{t("Title (French)")}</span>
            <input
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="Inscription — cours d'anglais"
            />
          </label>
          <label className="field">
            <span>{t("Title (Arabic)")}</span>
            <input
              dir="rtl"
              value={f.title_ar}
              onChange={(e) => setF({ ...f, title_ar: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Introduction (French)")}</span>
            <textarea
              rows={2}
              value={f.intro}
              onChange={(e) => setF({ ...f, intro: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Introduction (Arabic)")}</span>
            <textarea
              dir="rtl"
              rows={2}
              value={f.intro_ar}
              onChange={(e) => setF({ ...f, intro_ar: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Request type")}</span>
            <select
              value={f.service}
              onChange={(e) => setF({ ...f, service: e.target.value })}
            >
              <option value="">{t("Other")}</option>
              {data.serviceTypes.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("Program (optional)")}</span>
            <select
              value={f.program_id || ""}
              onChange={(e) =>
                setF({
                  ...f,
                  program_id: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">—</option>
              {data.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="form-label">{t("Questions")}</p>
        {f.fields.map((x: Row, i: number) => (
          <div key={i} className="form-field-row">
            <input
              value={x.label}
              placeholder={t("Question")}
              onChange={(e) => field(i, { label: e.target.value })}
            />
            <input
              dir="rtl"
              value={x.label_ar}
              placeholder="بالعربية"
              onChange={(e) => field(i, { label_ar: e.target.value })}
            />
            <select
              value={x.type}
              onChange={(e) => field(i, { type: e.target.value })}
            >
              {fieldTypes.map((k) => (
                <option key={k} value={k}>
                  {t(`field:${k}`)}
                </option>
              ))}
            </select>
            <select
              value={x.map || ""}
              onChange={(e) => field(i, { map: e.target.value })}
              title={t("Saved as")}
            >
              <option value="">{t("Saved in the notes")}</option>
              <option value="name">{t("Name")}</option>
              <option value="phone">{t("Phone")}</option>
              <option value="email">{t("Email")}</option>
              <option value="interest">{t("Interest")}</option>
              {custom.map((c) => (
                <option key={c.id} value={`custom:${c.id}`}>
                  {c.label}
                </option>
              ))}
            </select>
            {x.type === "select" && (
              <input
                value={x.options}
                placeholder={t("Choices, separated by commas")}
                onChange={(e) => field(i, { options: e.target.value })}
              />
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!x.required}
                onChange={(e) => field(i, { required: e.target.checked })}
              />
              <span>{t("Required")}</span>
            </label>
            <button
              className="icon-button"
              aria-label={t("Delete")}
              onClick={() =>
                setF({
                  ...f,
                  fields: f.fields.filter((_: Row, j: number) => j !== i),
                })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <Button
          variant="small"
          icon={<Plus size={14} />}
          onClick={() =>
            setF({
              ...f,
              fields: [
                ...f.fields,
                {
                  key: `q${Date.now() % 100000}`,
                  label: "",
                  label_ar: "",
                  type: "text",
                  required: false,
                  map: "",
                },
              ],
            })
          }
        >
          {t("Add a question")}
        </Button>
        <label className="field">
          <span>{t("Consent text (leave empty if not needed)")}</span>
          <input
            value={f.consent_text}
            onChange={(e) => setF({ ...f, consent_text: e.target.value })}
          />
        </label>
        <p className="form-hint">
          {t(
            "Spam protection is automatic: hidden trap field, minimum filling time and a limit per visitor.",
          )}
        </p>
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          icon={<Save size={15} />}
          onClick={async () => {
            try {
              if (form.id) await perform(`/forms/${form.id}`, f, "PATCH");
              else await perform("/forms", f);
              toast(t("Form saved"));
              onClose();
            } catch (e: any) {
              toast(e.message);
            }
          }}
        >
          {t("Save the form")}
        </Button>
      </div>
    </Dialog>
  );
}

// 5. Document templates ------------------------------------------------------
export function DocTemplatesPanel() {
  const { data, t, perform, toast } = useApp();
  const [edit, setEdit] = useState<Row | null>(null);
  const list = data.docTemplates || [];
  return (
    <Panel
      title="Document templates"
      subtitle="Contracts, agreements, attendance certificates. Variables: {name}, {course}, {price}, {date}, {birth_date}, {today}, {academy}. Open a client card → Document to fill, sign and save as PDF."
      action={
        <Button
          variant="primary"
          icon={<Plus size={15} />}
          onClick={() => setEdit({ name: "", kind: "contract", body: "" })}
        >
          {t("New template")}
        </Button>
      }
    >
      {list.length === 0 && (
        <div className="preset-row">
          <span>{t("Start from a model:")}</span>
          {defaultTemplates.map((d) => (
            <Button
              key={d.name}
              variant="small"
              onClick={() =>
                perform("/doc-templates", { ...d, name: t(d.name) }).catch(
                  (e: any) => toast(e.message),
                )
              }
            >
              {t(d.name)}
            </Button>
          ))}
        </div>
      )}
      <div className="today-list">
        {list.map((d) => (
          <div key={d.id} className="today-row">
            <div className="today-main">
              <strong>{d.name}</strong>
              <small>{String(d.body).slice(0, 90)}…</small>
            </div>
            <Button
              variant="small"
              icon={<Pencil size={14} />}
              onClick={() => setEdit(d)}
            >
              {t("Edit")}
            </Button>
            {data.permissions.admin && (
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() =>
                  window.confirm(t("Delete this template?")) &&
                  perform(`/doc-templates/${d.id}`, {}, "DELETE")
                }
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {edit && (
        <Dialog
          title={t("Document template")}
          onClose={() => setEdit(null)}
          wide
        >
          <div className="form-body">
            <label className="field">
              <span>{t("Name")}</span>
              <input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("Text")}</span>
              <textarea
                rows={14}
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              />
            </label>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => setEdit(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await perform("/doc-templates", edit);
                  setEdit(null);
                  toast(t("Changes saved"));
                } catch (e: any) {
                  toast(e.message);
                }
              }}
            >
              {t("Save")}
            </Button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

// 11. Branches and access -------------------------------------------------------
const rightsList: [string, string][] = [
  ["finance", "Sees finances"],
  ["delete", "Can delete"],
  ["export", "Can export"],
  ["phones", "Sees phone numbers"],
];
export function BranchesAccessPanel() {
  const { data, t, perform, toast } = useApp();
  const [b, setB] = useState({ name: "", address: "", rooms: "" });
  const rights = (id: number) =>
    (data.users_rights || []).find((r) => r.id === id) || {
      rights: {},
      branch_id: null,
    };
  const defaults = (role: string): Record<string, boolean> => ({
    finance: ["admin", "finance", "manager", "admissions"].includes(role),
    delete: role !== "manager",
    export: true,
    phones: true,
  });
  const save = (u: Row, next: Row) =>
    perform(`/users/${u.id}/access`, next, "PATCH").catch((e: any) =>
      toast(e.message),
    );
  return (
    <div className="settings-stack">
      <Panel
        title="Branches"
        subtitle="Several addresses: each one with its rooms and its team. The director sees the totals of all branches."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await perform("/branches", b);
              setB({ name: "", address: "", rooms: "" });
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field">
            <span>{t("Branch")}</span>
            <input
              required
              value={b.name}
              onChange={(e) => setB({ ...b, name: e.target.value })}
              placeholder="Blida"
            />
          </label>
          <label className="field grow">
            <span>{t("Address")}</span>
            <input
              value={b.address}
              onChange={(e) => setB({ ...b, address: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("Rooms (comma)")}</span>
            <input
              value={b.rooms}
              onChange={(e) => setB({ ...b, rooms: e.target.value })}
            />
          </label>
          <Button variant="primary" type="submit">
            {t("Add")}
          </Button>
        </form>
        <div className="today-list">
          {(data.branches || []).map((x) => (
            <div key={x.id} className="today-row">
              <div className="today-main">
                <strong>{x.name}</strong>
                <small>
                  {[x.address, x.rooms].filter(Boolean).join(" · ")} ·{" "}
                  {
                    data.users.filter((u) => rights(u.id).branch_id === x.id)
                      .length
                  }{" "}
                  {t("staff")}
                </small>
              </div>
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() =>
                  window.confirm(t("Delete this branch?")) &&
                  perform(`/branches/${x.id}`, {}, "DELETE")
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Access of each person"
        subtitle="On top of the role, tick or untick what each person may do. Changes apply at their next page load."
      >
        <div className="table-scroll">
          <table className="access-table">
            <thead>
              <tr>
                <th>{t("Staff member")}</th>
                {(data.branches || []).length > 0 && <th>{t("Branch")}</th>}
                {rightsList.map(([k, l]) => (
                  <th key={k}>{t(l)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.users
                .filter((u) => u.active && u.role !== "admin")
                .map((u) => {
                  const r = rights(u.id);
                  const d = defaults(u.role);
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                      </td>
                      {(data.branches || []).length > 0 && (
                        <td>
                          <select
                            value={r.branch_id || ""}
                            onChange={(e) =>
                              save(u, {
                                rights: r.rights,
                                branch_id: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                          >
                            <option value="">{t("All")}</option>
                            {(data.branches || []).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {rightsList.map(([k]) => {
                        const on = r.rights[k] ?? d[k];
                        return (
                          <td key={k}>
                            <input
                              type="checkbox"
                              aria-label={`${u.name} — ${t(k)}`}
                              checked={on}
                              onChange={(e) =>
                                save(u, {
                                  rights: {
                                    ...r.rights,
                                    [k]: e.target.checked,
                                  },
                                  branch_id: r.branch_id,
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// 12. System status --------------------------------------------------------------
export function StatusPanel() {
  const { t, date, time, toast } = useApp();
  const [s, setS] = useState<Row | null>(null);
  const load = () =>
    api("/system/status")
      .then(setS)
      .catch((e: any) => toast(e.message));
  useEffect(() => {
    load();
  }, []);
  if (!s) return <p className="form-hint padded-hint">{t("Loading…")}</p>;
  const ok = (v: boolean, label: string) => (
    <li key={label} className={v ? "ok" : "off"}>
      <span className="dot" /> {t(label)} — {t(v ? "connected" : "not set up")}
    </li>
  );
  return (
    <div className="settings-stack">
      <Panel
        title="System status"
        subtitle="Everything that keeps the CRM running. Green is fine; grey only means the service is not connected yet."
        action={
          <Button icon={<Activity size={15} />} onClick={load}>
            {t("Refresh")}
          </Button>
        }
      >
        <div className="status-grid">
          <div className="status-card">
            <small>{t("Last backup")}</small>
            <strong>
              {s.lastBackup
                ? date(s.lastBackup, { day: "numeric", month: "long" })
                : s.hosted
                  ? "—"
                  : t("On this computer")}
            </strong>
          </div>
          <div className="status-card">
            <small>{t("Database size")}</small>
            <strong>
              {s.databaseBytes
                ? `${(s.databaseBytes / 1048576).toFixed(1)} MB`
                : "—"}
            </strong>
          </div>
          <div className="status-card">
            <small>{t("Errors (last 30)")}</small>
            <strong className={s.errors.length ? "warn" : ""}>
              {s.errors.length}
            </strong>
          </div>
          <div className="status-card">
            <small>{t("Last scenario run")}</small>
            <strong>
              {s.lastFlowRun
                ? `${date(s.lastFlowRun)} ${time(s.lastFlowRun)}`
                : "—"}
            </strong>
          </div>
        </div>
        <ul className="status-list">
          {ok(
            s.integrations.blob || !s.hosted,
            "Cloud storage and daily backups",
          )}
          {ok(s.integrations.cron, "Daily automatic tasks (cron)")}
          {ok(s.integrations.whatsapp, "WhatsApp Business")}
          {ok(s.integrations.mail, "E-mail sending")}
          {ok(s.integrations.chargily, "Online payment (Chargily)")}
          {ok(s.integrations.ai, "AI assistant (Claude)")}
          {ok(s.integrations.push, "Push notifications on the phone")}
        </ul>
        <dl className="settings-list">
          {Object.entries(s.counts).map(([k, v]) => (
            <div key={k}>
              <dt>{t(`count:${k}`)}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
          <div>
            <dt>{t("Database version")}</dt>
            <dd>{s.migrations.length}</dd>
          </div>
        </dl>
      </Panel>
      {s.errors.length > 0 && (
        <Panel
          title="Recent errors"
          subtitle="Technical messages. Send them to the person who maintains the CRM if something does not work."
        >
          <ul className="flow-log padded">
            {s.errors.map((e: Row) => (
              <li key={e.id}>
                <small>
                  {date(e.created_at)} {time(e.created_at)} · {e.path}
                </small>{" "}
                {e.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// 13. API keys and webhooks --------------------------------------------------
export function ApiPanel() {
  const { data, t, date, perform, toast } = useApp();
  const [name, setName] = useState("");
  const [shown, setShown] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["inquiry.created"]);
  return (
    <div className="settings-stack">
      <Panel
        title="API keys"
        subtitle="For your website, n8n or Zapier: read clients, requests, appointments and payments, and send new requests."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await perform("/api-keys", { name });
              setShown(r.key);
              setName("");
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field grow">
            <span>{t("What is it for?")}</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Website")}
            />
          </label>
          <Button variant="primary" type="submit" icon={<KeyRound size={15} />}>
            {t("Create a key")}
          </Button>
        </form>
        {shown && (
          <div className="secret-box">
            <p>{t("Copy this key now: it will not be shown again.")}</p>
            <code>{shown}</code>
            <Button
              variant="small"
              icon={<Copy size={14} />}
              onClick={() => copy(shown, toast, t)}
            >
              {t("Copy")}
            </Button>
          </div>
        )}
        <div className="today-list">
          {(data.apiKeys || []).map((k) => (
            <div
              key={k.id}
              className={`today-row ${k.revoked_at ? "muted" : ""}`}
            >
              <div className="today-main">
                <strong>{k.name}</strong>
                <small>
                  {k.prefix}… · {t("created")} {date(k.created_at)}
                  {k.last_used_at
                    ? ` · ${t("last used")} ${date(k.last_used_at)}`
                    : ""}
                  {k.revoked_at ? ` · ${t("revoked")}` : ""}
                </small>
              </div>
              {!k.revoked_at && (
                <Button
                  variant="small"
                  onClick={() =>
                    window.confirm(
                      t("Revoke this key? Tools using it will stop working."),
                    ) && perform(`/api-keys/${k.id}/revoke`, {})
                  }
                >
                  {t("Revoke")}
                </Button>
              )}
            </div>
          ))}
        </div>
        <details className="api-doc">
          <summary>{t("How to use the API")}</summary>
          <pre>{`GET  ${location.origin}/api/v1/contacts?limit=50&after=0
GET  ${location.origin}/api/v1/inquiries
GET  ${location.origin}/api/v1/appointments
GET  ${location.origin}/api/v1/payments
POST ${location.origin}/api/v1/inquiries
     {"name":"…","phone":"0555…","interest":"Anglais B1","source":"Site web"}

Header: Authorization: Bearer lum_…`}</pre>
        </details>
      </Panel>
      <Panel
        title="Outgoing webhooks"
        subtitle="The CRM calls your address at each event: new request, payment, appointment, new client. Each call is signed (X-Luminol-Signature)."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await perform("/webhooks", { url, events });
              setShown(r.secret);
              setUrl("");
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field grow">
            <span>{t("Address (https://…)")}</span>
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://n8n.example.com/webhook/…"
            />
          </label>
          <Button variant="primary" type="submit" icon={<Webhook size={15} />}>
            {t("Add")}
          </Button>
        </form>
        <div className="chip-row padded">
          {(data.webhookEvents || []).map((ev) => (
            <label key={ev} className="checkbox-label">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents(
                    e.target.checked
                      ? [...events, ev]
                      : events.filter((x) => x !== ev),
                  )
                }
              />
              <span>{t(`event:${ev}`)}</span>
            </label>
          ))}
        </div>
        <div className="today-list">
          {(data.webhooks || []).map((w) => (
            <div key={w.id} className="today-row">
              <div className="today-main">
                <strong className="break">{w.url}</strong>
                <small>
                  {w.events.map((e: string) => t(`event:${e}`)).join(", ")}
                  {w.last_at
                    ? ` · ${t("last call")} ${date(w.last_at)} → ${w.last_status}`
                    : ""}
                </small>
              </div>
              <Button
                variant="small"
                onClick={async () => {
                  const r = await api(`/webhooks/${w.id}/test`, {});
                  toast(`${t("Test sent")}: ${r.status}`);
                }}
              >
                {t("Test")}
              </Button>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={!!w.active}
                  onChange={(e) =>
                    perform(
                      `/webhooks/${w.id}`,
                      { active: e.target.checked },
                      "PATCH",
                    )
                  }
                />
                <span>{w.active ? t("On") : t("Off")}</span>
              </label>
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() => perform(`/webhooks/${w.id}`, {}, "DELETE")}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// 8. Calendar on the phone / Google Calendar --------------------------------
export function CalendarFeedPanel() {
  const { data, t, perform, toast } = useApp();
  const [path, setPath] = useState("");
  const url = path ? `${location.origin}${path}` : "";
  return (
    <Panel
      title="My appointments in Google Calendar"
      subtitle="Subscribe once: your CRM appointments and groups appear in Google Calendar or on the phone, and stay up to date."
    >
      <div className="form-body">
        {url ? (
          <div className="secret-box">
            <p>
              {t(
                "Copy this address, then in Google Calendar: Other calendars → + → From URL → paste.",
              )}
            </p>
            <code>{url}</code>
            <div className="chip-row">
              <Button
                variant="small"
                icon={<Copy size={14} />}
                onClick={() => copy(url, toast, t)}
              >
                {t("Copy")}
              </Button>
              <a
                className="button small"
                href={url.replace(/^https?:/, "webcal:")}
              >
                <CalendarSync size={14} /> {t("Open on the phone")}
              </a>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            icon={<CalendarSync size={15} />}
            onClick={async () => {
              try {
                const r = await perform("/me/calendar-feed", {});
                setPath(r.path);
              } catch (e: any) {
                toast(e.message);
              }
            }}
          >
            {t(
              data.calendarFeed
                ? "Create a new link (the old one stops)"
                : "Create my calendar link",
            )}
          </Button>
        )}
        {data.calendarFeed && !url && (
          <Button
            variant="small"
            onClick={() => perform("/me/calendar-feed", { off: true })}
          >
            {t("Stop the link")}
          </Button>
        )}
        <p className="form-hint">
          {t(
            "Two-way sync (busy times from Google blocking the CRM) needs a Google Cloud project; see the list of what to do.",
          )}
        </p>
      </div>
    </Panel>
  );
}
