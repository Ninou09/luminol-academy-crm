import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Send,
  Trash2,
  ArrowUpRight,
  Check,
  Bot,
  RefreshCw,
  Copy,
  Plus,
  ScanLine,
  Save,
  Pencil,
  GraduationCap,
} from "lucide-react";
import { useApp } from "./context";
import { api } from "./types";
import { Badge, Button, Dialog, Empty, PageHead, Panel } from "./ui";
type Row = Record<string, any>;

/** **bold** and line breaks, nothing else (safe). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} dir="auto">
          {line
            .split(/(\*\*[^*]+\*\*)/)
            .map((part, j) =>
              part.startsWith("**") ? (
                <b key={j}>{part.slice(2, -2)}</b>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
        </p>
      ))}
    </>
  );
}

// Staff assistant -----------------------------------------------------------------
export function AssistantBubble() {
  const { data, t, go, profile, toast, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [ai, setAi] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    api("/assistant")
      .then((r) => {
        setMsgs(r.messages);
        setAi(r.ai);
      })
      .catch(() => {});
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);
  async function ask(text: string) {
    if (!text.trim()) return;
    setQ("");
    setMsgs((m) => [
      ...m,
      { id: Date.now(), role: "user", content: text, meta: {} },
    ]);
    setBusy(true);
    try {
      const r = await api("/assistant", { message: text });
      setMsgs((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: r.text,
          meta: {
            links: r.links || [],
            actions: r.actions || [],
            contacts: r.contacts || [],
          },
        },
      ]);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  const examples = [
    ...(data.permissions.editFinance ? ["Who has not paid?"] : []),
    "My appointments today",
    "Free slots on Thursday",
    ...(data.permissions.admissions
      ? ["How many new clients from Instagram this month?"]
      : []),
    "How do I create a scenario?",
  ];
  return (
    <>
      <button
        className="assistant-fab"
        aria-label={t("Ask Luminol")}
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
        <span>{t("Ask Luminol")}</span>
      </button>
      {open && (
        <section
          className="assistant-panel"
          role="dialog"
          aria-label={t("Ask Luminol")}
        >
          <header>
            <span className="assistant-avatar">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>{t("Ask Luminol")}</strong>
              <small>
                {t(
                  ai
                    ? "Claude AI · reads, never changes anything by itself"
                    : "Free assistant · your data and the help",
                )}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label={t("Clear the conversation")}
              title={t("Clear the conversation")}
              onClick={async () => {
                await api("/assistant", {}, "DELETE");
                setMsgs([]);
              }}
            >
              <Trash2 size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={t("Close")}
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="assistant-body">
            {msgs.length === 0 && (
              <div className="assistant-hello">
                <p>
                  {t(
                    "Hello! Ask me a question about your clients, your agenda, payments or how to use the CRM.",
                  )}
                </p>
                <div className="chip-row">
                  {examples.map((x) => (
                    <button key={x} className="chip" onClick={() => ask(t(x))}>
                      {t(x)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`assistant-msg ${m.role}`}>
                <Rich text={m.content} />
                {(m.meta?.contacts || []).length > 0 && (
                  <div className="chip-row">
                    {m.meta.contacts.slice(0, 6).map((id: number) => {
                      const c = data.contacts.find((x) => x.id === id);
                      return c ? (
                        <button
                          key={id}
                          className="chip"
                          onClick={() => profile(id)}
                        >
                          {c.name} <ArrowUpRight size={12} />
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
                {(m.meta?.links || []).length > 0 && (
                  <div className="chip-row">
                    {m.meta.links.map((l: Row, i: number) => (
                      <button
                        key={i}
                        className="chip link"
                        onClick={() => {
                          go(l.page, l.filter || "");
                          setOpen(false);
                        }}
                      >
                        {t("Go to")} : {t(l.label)} <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                )}
                {(m.meta?.actions || []).map((a: Row, i: number) =>
                  a.done ? (
                    <p key={i} className="assistant-done">
                      <Check size={14} /> {t("Task created")}
                    </p>
                  ) : (
                    <div key={i} className="assistant-action">
                      <small>{t("Create a task")}</small>
                      <strong>{a.title}</strong>
                      <div className="chip-row">
                        <Button
                          variant="primary small"
                          icon={<Check size={14} />}
                          onClick={async () => {
                            try {
                              await api("/assistant/confirm", a);
                              a.done = true;
                              setMsgs([...msgs]);
                              toast(t("Task created"));
                              refresh();
                            } catch (e: any) {
                              toast(e.message);
                            }
                          }}
                        >
                          {t("Confirm")}
                        </Button>
                        <Button
                          variant="small"
                          onClick={() => {
                            a.done = true;
                            setMsgs(
                              msgs.map((x) =>
                                x === m
                                  ? { ...m, meta: { ...m.meta, actions: [] } }
                                  : x,
                              ),
                            );
                          }}
                        >
                          {t("Cancel")}
                        </Button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            ))}
            {busy && <div className="assistant-msg assistant typing">…</div>}
            <div ref={end} />
          </div>
          <form
            className="assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input
              autoFocus
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Write your question…")}
              aria-label={t("Write your question…")}
            />
            <button
              className="button primary"
              disabled={busy || !q.trim()}
              aria-label={t("Send")}
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

// Predictions ---------------------------------------------------------------------
const pct = (x: number) => `${Math.round(x * 100)} %`;
const tone = (x: number) => (x >= 0.5 ? "red" : x >= 0.25 ? "amber" : "teal");
function Score({ value }: { value: number }) {
  return (
    <span className={`score ${tone(value)}`}>
      <span style={{ width: `${Math.max(4, value * 100)}%` }} />
      <b>{pct(value)}</b>
    </span>
  );
}
export function PredictionsPage() {
  const { data, t, person, date, time, profile, perform, toast, open } =
    useApp();
  const p = data.predictions as Row | null;
  const [busy, setBusy] = useState(false);
  if (!p)
    return (
      <Empty
        title="Not available"
        text="Predictions are shown to the director, the administrator and the secretary."
      />
    );
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const modelCard = (key: string, title: string) => {
    const m = p.models[key];
    return (
      <div className="status-card" key={key}>
        <small>{t(title)}</small>
        {m.trained ? (
          <>
            <strong>
              {m.accuracy != null ? `${Math.round(m.accuracy * 100)} %` : "—"}
            </strong>
            <span className="form-hint">
              {t("correct on recent cases")} · {m.samples} {t("cases")} ·{" "}
              {date(m.trained_at)}
            </span>
          </>
        ) : (
          <>
            <strong className="muted-strong">{t("Estimate")}</strong>
            <span className="form-hint">
              {t("Simple rules until there are about 40 finished cases.")}
            </span>
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <PageHead
        title="Predictions"
        subtitle="Computed inside the CRM from your own history, free. Each score says why."
      >
        {data.permissions.admin && (
          <Button
            icon={<RefreshCw size={16} />}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await perform("/predictions/train", {});
                toast(t("Models updated"));
              } catch (e: any) {
                toast(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Update the models")}
          </Button>
        )}
      </PageHead>
      <div className="status-grid wide">
        {modelCard("no_show", "Absence model")}
        {modelCard("lead", "Request model")}
        <div className="status-card">
          <small>{t("Clients who may leave")}</small>
          <strong>{p.churn.length}</strong>
          <span className="form-hint">
            {t("Long gap compared with their usual rhythm.")}
          </span>
        </div>
      </div>
      <div className="reports-grid">
        <Panel
          title="Risk of absence — next 14 days"
          subtitle="Send an extra reminder or call the clients at the top."
        >
          {p.noShow.length === 0 ? (
            <Empty
              title="No appointment"
              text="Upcoming appointments will appear here."
            />
          ) : (
            <div className="today-list">
              {p.noShow.slice(0, 12).map((x: Row) => (
                <div key={x.appointment_id} className="today-row">
                  <div className="today-main">
                    <button
                      className="cell-link"
                      onClick={() => profile(x.contact_id)}
                    >
                      <strong>{person(x.contact_id).name}</strong>
                    </button>
                    <small>
                      {date(x.starts_at, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      {time(x.starts_at)}
                      {x.reasons.length
                        ? ` · ${x.reasons.map((r: string) => t(r)).join(", ")}`
                        : ""}
                    </small>
                  </div>
                  <Score value={x.score} />
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title="Clients to call this week"
          subtitle="They used to come regularly and have stopped."
        >
          {p.churn.length === 0 ? (
            <Empty
              title="Nobody for now"
              text="Clients with a long unusual gap will appear here."
            />
          ) : (
            <div className="today-list">
              {p.churn.slice(0, 12).map((x: Row) => (
                <div key={x.contact_id} className="today-row">
                  <div className="today-main">
                    <button
                      className="cell-link"
                      onClick={() => profile(x.contact_id)}
                    >
                      <strong>{person(x.contact_id).name}</strong>
                    </button>
                    <small>
                      {x.days} {t("days without a visit")}
                      {x.reasons.length
                        ? ` · ${x.reasons.map((r: string) => t(r)).join(", ")}`
                        : ""}
                    </small>
                  </div>
                  <Score value={x.score} />
                  <Button
                    variant="small"
                    onClick={() =>
                      open({
                        type: "task",
                        contact: person(x.contact_id) as any,
                      })
                    }
                  >
                    {t("Plan a call")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="reports-grid">
        <Panel
          title="Most promising requests"
          subtitle="Chance that the request becomes a client. Answer the top ones first."
        >
          {p.leads.length === 0 ? (
            <Empty
              title="No open request"
              text="Open requests will appear here."
            />
          ) : (
            <div className="today-list">
              {p.leads.slice(0, 12).map((x: Row) => {
                const o = data.opportunities.find(
                  (y) => y.id === x.opportunity_id,
                );
                return (
                  <div key={x.opportunity_id} className="today-row">
                    <div className="today-main">
                      <button
                        className="cell-link"
                        onClick={() => profile(x.contact_id)}
                      >
                        <strong>{person(x.contact_id).name}</strong>
                      </button>
                      <small>
                        {o
                          ? `${o.interest || t(o.service_type)} · ${o.source} · ${t(o.stage)}`
                          : ""}
                        {x.reasons.length
                          ? ` · ${x.reasons.map((r: string) => t(r)).join(", ")}`
                          : ""}
                      </small>
                    </div>
                    <Score value={x.score} />
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel
          title="Best times"
          subtitle="When clients really come, and when they write to you."
        >
          <div className="padded">
            {p.bestTimes.length === 0 ? (
              <p className="form-hint">
                {t("Not enough finished appointments yet.")}
              </p>
            ) : (
              <ul className="widget-list">
                {p.bestTimes.map((b: Row, i: number) => (
                  <li key={i}>
                    <b>
                      {t(days[b.day])} {String(b.hour).padStart(2, "0")}:00
                    </b>{" "}
                    {pct(b.rate)} {t("come")} ({b.total})
                  </li>
                ))}
              </ul>
            )}
            {p.writeHours.length > 0 && (
              <p className="form-hint">
                {t("Clients write most at")} :{" "}
                {p.writeHours
                  .map((h: Row) => `${String(h.h).padStart(2, "0")}:00`)
                  .join(", ")}{" "}
                — {t("a good time for campaigns.")}
              </p>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="Workload of the next 4 weeks"
        subtitle="Booked hours compared with working hours. Above 90 %: think of a new group or more hours."
      >
        <div className="table-scroll">
          <table className="cohort-table">
            <thead>
              <tr>
                <th>{t("Specialist")}</th>
                {[1, 2, 3, 4].map((w) => (
                  <th key={w}>
                    {t("Week")} {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.load.map((l: Row) => (
                <tr key={l.user_id}>
                  <td>
                    <strong>{l.name}</strong>
                  </td>
                  {l.weeks.map((w: Row, i: number) => (
                    <td
                      key={i}
                      className="load-cell"
                      style={
                        w.percent == null
                          ? {}
                          : {
                              background: `rgba(0,137,122,${0.06 + Math.min(1, w.percent / 100) * 0.55})`,
                            }
                      }
                    >
                      {w.percent == null ? `${w.booked} h` : `${w.percent} %`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// Settings: assistant, bot, knowledge base -------------------------------------------
export function SmartSettingsPanel() {
  const { data, t, perform, toast } = useApp();
  const s = data.settings;
  const [limit, setLimit] = useState(String(s.ai_monthly_tokens ?? 2000000));
  const [crisis, setCrisis] = useState(s.crisis_text || "");
  const [alertPhone, setAlertPhone] = useState(s.crisis_alert_phone || "");
  const [edit, setEdit] = useState<Row | null>(null);
  const [test, setTest] = useState("");
  const [result, setResult] = useState<Row | null>(null);
  const usage = (data as Row).aiUsage || { month: 0, configured: false };
  const save = (v: Row) =>
    perform("/settings/smart", v, "PATCH")
      .then(() => toast(t("Changes saved")))
      .catch((e: any) => toast(e.message));
  const code = `<script src="${location.origin}/widget.js" async></script>`;
  return (
    <div className="settings-stack">
      <Panel
        title="Assistant and AI"
        subtitle="The assistant and the bot work for free with your data and the knowledge base. With a Claude key they write better answers, within the monthly limit below."
      >
        <div className="form-body">
          <ul className="status-list flush">
            <li className={usage.configured ? "ok" : "off"}>
              <span className="dot" /> {t("Claude key")} —{" "}
              {t(usage.configured ? "connected" : "not set up")}
              {!usage.configured &&
                ` (${t("everything still works for free")})`}
            </li>
          </ul>
          <label className="switch">
            <input
              type="checkbox"
              checked={!!s.ai_enabled}
              onChange={(e) => save({ ai_enabled: e.target.checked })}
            />
            <span>{t("Use Claude when the key is set")}</span>
          </label>
          <div className="inline-form flush">
            <label className="field">
              <span>{t("Monthly limit (tokens)")}</span>
              <input
                type="number"
                min="0"
                step="100000"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <Button
              onClick={() => save({ ai_monthly_tokens: Number(limit || 0) })}
            >
              {t("Save")}
            </Button>
            <div className="usage-meter">
              <span>
                {t("Used this month")} : <b>{usage.month.toLocaleString()}</b> /{" "}
                {Number(s.ai_monthly_tokens || 0).toLocaleString()}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${Math.min(100, (usage.month / Math.max(1, s.ai_monthly_tokens)) * 100)}%`,
                    background: "#00897a",
                  }}
                />
              </span>
            </div>
          </div>
          <p className="form-hint">
            {t(
              "About 2 million tokens ≈ a few hundred questions. When the limit is reached, the free assistant answers until next month.",
            )}
          </p>
        </div>
      </Panel>
      <Panel
        title="Bot for clients"
        subtitle="Answers WhatsApp and the chat on your website with your knowledge base, gives the booking link and hands over to a person when needed."
      >
        <div className="form-body">
          <div className="choice-grid three">
            {[
              ["off", "Off", "The bot only sorts messages."],
              [
                "draft",
                "Drafts (recommended)",
                "The bot prepares the answer, a person sends it.",
              ],
              [
                "auto",
                "Automatic",
                "Sure answers are sent at once, the others wait for a person.",
              ],
            ].map(([k, l, h]) => (
              <button
                key={k}
                className={`choice ${s.bot_mode === k ? "active" : ""}`}
                onClick={() => save({ bot_mode: k })}
              >
                {t(l)}
                <small>{t(h)}</small>
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              {t("Message sent at once in an emergency (distress, violence)")}
            </span>
            <textarea
              rows={3}
              value={crisis}
              onChange={(e) => setCrisis(e.target.value)}
            />
          </label>
          <p className="form-hint">
            {t(
              "The bot never gives psychological advice. In an emergency it sends this text, marks the conversation as urgent and notifies the specialists and the director.",
            )}
          </p>
          <label className="field">
            <span>{t("WhatsApp number of the specialist warned at once")}</span>
            <input
              value={alertPhone}
              onChange={(e) => setAlertPhone(e.target.value)}
              placeholder="+213 …"
            />
          </label>
          <Button
            onClick={() =>
              save({ crisis_text: crisis, crisis_alert_phone: alertPhone })
            }
          >
            {t("Save")}
          </Button>
        </div>
      </Panel>
      <Panel
        title="Knowledge base"
        subtitle="Questions clients often ask and your answers. Add the words clients use (French, Arabic, darija) so the bot recognises them."
        action={
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() =>
              setEdit({
                question: "",
                answer: "",
                answer_ar: "",
                keywords: "",
                active: true,
              })
            }
          >
            {t("New answer")}
          </Button>
        }
      >
        <div className="today-list">
          {(data.kb || []).map((a: Row) => (
            <div key={a.id} className={`today-row ${a.active ? "" : "muted"}`}>
              <div className="today-main">
                <strong>{a.question}</strong>
                <small>
                  {a.answer.slice(0, 110)}
                  {a.answer.length > 110 ? "…" : ""} · {a.uses} {t("use(s)")}
                </small>
              </div>
              <Button
                variant="small"
                icon={<Pencil size={14} />}
                onClick={() => setEdit(a)}
              >
                {t("Edit")}
              </Button>
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() =>
                  window.confirm(t("Delete this answer?")) &&
                  perform(`/kb/${a.id}`, {}, "DELETE")
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setResult(await api("/kb/test", { message: test }));
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          <label className="field grow">
            <span>{t("Try the bot: write like a client")}</span>
            <input
              dir="auto"
              value={test}
              onChange={(e) => setTest(e.target.value)}
              placeholder="Salam, bchhal la consultation ?"
            />
          </label>
          <Button type="submit" icon={<Bot size={15} />}>
            {t("Try")}
          </Button>
        </form>
        {result && (
          <div className="bot-test">
            <Badge tone={result.urgent ? "red" : "blue"}>
              {t(`intent:${result.intent}`)}
            </Badge>
            <p dir="auto">
              {result.reply ||
                t("No answer in the knowledge base: a person will answer.")}
            </p>
            <small>
              {t(
                result.safe
                  ? "Can be sent automatically"
                  : "Waits for a person",
              )}
            </small>
          </div>
        )}
      </Panel>
      <Panel
        title="Chat on your website"
        subtitle="Paste this line before </body> on your website. A chat bubble appears; the visitor leaves a name and phone and the request arrives in the CRM."
      >
        <div className="secret-box">
          <code>{code}</code>
          <div className="chip-row">
            <Button
              variant="small"
              icon={<Copy size={14} />}
              onClick={() => {
                navigator.clipboard?.writeText(code);
                toast(t("Copied"));
              }}
            >
              {t("Copy")}
            </Button>
            <a
              className="button small"
              href="/chat"
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={14} /> {t("Open")}
            </a>
          </div>
        </div>
      </Panel>
      {edit && (
        <Dialog title={t("Answer of the bot")} onClose={() => setEdit(null)}>
          <div className="form-body">
            <label className="field">
              <span>{t("Question")}</span>
              <input
                value={edit.question}
                onChange={(e) => setEdit({ ...edit, question: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("Answer (French)")}</span>
              <textarea
                rows={3}
                value={edit.answer}
                onChange={(e) => setEdit({ ...edit, answer: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("Answer (Arabic)")}</span>
              <textarea
                dir="rtl"
                rows={3}
                value={edit.answer_ar}
                onChange={(e) =>
                  setEdit({ ...edit, answer_ar: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>{t("Words clients use (commas)")}</span>
              <input
                dir="auto"
                value={edit.keywords}
                onChange={(e) => setEdit({ ...edit, keywords: e.target.value })}
                placeholder="prix, tarif, bchhal, سعر"
              />
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={!!edit.active}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
              />
              <span>{t(edit.active ? "On" : "Off")}</span>
            </label>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => setEdit(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              icon={<Save size={15} />}
              onClick={async () => {
                try {
                  await perform("/kb", edit);
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
    </div>
  );
}

// Inbox: bot suggestion ---------------------------------------------------------------
export function SuggestionBox({
  conv,
  onUse,
  onDone,
}: {
  conv: Row;
  onUse: (s: string) => void;
  onDone: () => void;
}) {
  const { t } = useApp();
  if (!conv?.suggestion && !conv?.urgent) return null;
  return (
    <div className={`suggestion-box ${conv.urgent ? "urgent" : ""}`}>
      {conv.urgent ? (
        <strong>⚠ {t("Urgent: a person must answer now")}</strong>
      ) : null}
      {conv.suggestion && (
        <>
          <small>
            <Bot size={14} /> {t("Answer suggested by the bot")}
          </small>
          <p dir="auto">{conv.suggestion}</p>
        </>
      )}
      <div className="chip-row">
        {conv.suggestion && (
          <Button
            variant="small primary"
            onClick={() => onUse(conv.suggestion)}
          >
            {t("Use this answer")}
          </Button>
        )}
        <Button
          variant="small"
          onClick={async () => {
            await api(
              `/conversations/${conv.contact_id}/suggestion`,
              { clear_urgent: true },
              "PATCH",
            );
            onDone();
          }}
        >
          {t(conv.urgent ? "Handled" : "Ignore")}
        </Button>
      </div>
    </div>
  );
}
export const intentTone: Record<string, string> = {
  urgent: "red",
  complaint: "red",
  booking: "teal",
  reschedule: "amber",
  price: "blue",
  info: "neutral",
  confirm: "neutral",
  bot: "purple",
};

// Receipt photo → payment -------------------------------------------------------------
/** Reads amount, date and reference written on a receipt (free text after OCR). */
export function parseReceipt(text: string) {
  const clean = text.replace(/\s+/g, " ");
  const amounts = [
    ...clean.matchAll(
      /(\d{1,3}(?:[ . ]\d{3})+|\d{3,7})(?:[,.](\d{2}))?\s*(?:DA|DZD|دج|د\.ج)/gi,
    ),
  ].map((m) => Number(m[1].replace(/[ . ]/g, "")));
  const fallback = [
    ...clean.matchAll(
      /(?:montant|total|somme|amount|المبلغ)\D{0,12}(\d[\d .]{2,10})/gi,
    ),
  ].map((m) => Number(m[1].replace(/[ .]/g, "")));
  const list = (amounts.length ? amounts : fallback).filter(
    (n) => n >= 100 && n < 10000000,
  );
  const d =
    clean.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/) ||
    clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  let date = null as string | null;
  if (d)
    date =
      d[1].length === 4 ? `${d[1]}-${d[2]}-${d[3]}` : `${d[3]}-${d[2]}-${d[1]}`;
  const ref = clean.match(
    /(?:r[ée]f(?:[ée]rence)?|transaction|n[°o]|ID)\s*[:#]?\s*([A-Z0-9-]{5,})/i,
  );
  return {
    amount: list.length ? Math.max(...list) : null,
    date,
    reference: ref ? ref[1] : null,
  };
}
declare global {
  interface Window {
    Tesseract?: any;
  }
}
function loadOcr(): Promise<any> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src =
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => ok(window.Tesseract);
    s.onerror = () =>
      fail(
        new Error(
          "The free reader could not be loaded. Check the internet connection.",
        ),
      );
    document.head.appendChild(s);
  });
}
export function ReceiptScanButton() {
  const { data, t, open, toast } = useApp();
  const [busy, setBusy] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function read(file: File) {
    const url = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(file);
    });
    setBusy(t("Reading the receipt…"));
    try {
      let found: Row | null = null;
      if (data.integrations?.ai) {
        try {
          found = await api("/ai/receipt", { image: url });
        } catch {
          found = null;
        }
      }
      if (!found || found.amount == null) {
        const T = await loadOcr();
        const r = await T.recognize(url, "fra+ara");
        found = parseReceipt(r.data.text || "");
      }
      if (!found || found.amount == null)
        toast(t("No amount found: type it by hand."));
      open({
        type: "payment",
        extra: {
          amount: found?.amount != null ? String(found.amount) : "",
          reference: found?.reference || "",
          paid_on:
            found?.date && found.date <= data.today ? found.date : undefined,
          payer: found?.payer || "",
          method: "CCP / BaridiMob",
        },
      });
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) read(f);
          e.target.value = "";
        }}
      />
      <Button
        icon={<ScanLine size={16} />}
        disabled={!!busy}
        onClick={() => input.current?.click()}
      >
        {busy || t("Scan a receipt")}
      </Button>
    </>
  );
}

// First visit tour ----------------------------------------------------------------------
const tours: Record<string, [string, string, string][]> = {
  director: [
    [
      "Overview",
      "Your home",
      "The month at a glance: new clients, money, requests and alerts.",
    ],
    [
      "Messages",
      "All conversations",
      "WhatsApp, calls and notes of each client in one place. The bot prepares answers.",
    ],
    [
      "Admissions",
      "Requests",
      "Each person who contacts you. Move the cards from one step to the next.",
    ],
    [
      "Payments",
      "Money",
      "Amounts due, payments, receipts, analytics and loyalty.",
    ],
    [
      "Predictions",
      "Predictions",
      "Who may not come, who may leave, which requests to answer first.",
    ],
    [
      "Settings",
      "Settings",
      "Team, scenarios, forms, documents, bot and the system status.",
    ],
  ],
  administrator: [
    [
      "Dashboard",
      "Your dashboard",
      "The numbers of the academy and the goals of the month.",
    ],
    [
      "Messages",
      "All conversations",
      "WhatsApp, calls and notes of each client in one place.",
    ],
    [
      "Admissions",
      "Requests",
      "Each person who contacts you. Move the cards from one step to the next.",
    ],
    [
      "Predictions",
      "Predictions",
      "Who may not come, who may leave, which requests to answer first.",
    ],
  ],
  secretary: [
    [
      "Today",
      "Today",
      "Who arrives, who has to pay, the requests waiting for an answer.",
    ],
    [
      "Messages",
      "Messages",
      "Answer clients; use the answer suggested by the bot after checking it.",
    ],
    [
      "Calendar",
      "Agenda",
      "Click a free slot to book. Mark “Arrived” when the client comes.",
    ],
    [
      "Payments",
      "Payments",
      "Record a payment and print the receipt. “Scan a receipt” reads a CCP photo.",
    ],
  ],
  teacher: [
    [
      "My week",
      "My week",
      "Your appointments and groups, and the notes still to write.",
    ],
    [
      "Attendance",
      "Attendance",
      "Take the roll call of your groups in a few taps.",
    ],
    ["Messages", "Messages", "Conversations of your students."],
  ],
};
export function Tour() {
  const { data, t, go } = useApp();
  const role = (data.permissions as Row).role || "director";
  const steps = tours[role] || tours.director;
  const [i, setI] = useState(0);
  const [closed, setClosed] = useState(false);
  if ((data as Row).tourDone || closed) return null;
  const finish = () => {
    setClosed(true);
    api("/me/tour", {}).catch(() => {});
  };
  const [page, title, text] = steps[i];
  return (
    <Dialog
      title={`${t("Welcome")} · ${i + 1}/${steps.length}`}
      onClose={finish}
    >
      <div className="form-body tour">
        <span className="tour-icon">
          <GraduationCap size={30} />
        </span>
        <h3>{t(title)}</h3>
        <p>{t(text)}</p>
        <div className="tour-dots">
          {steps.map((_, j) => (
            <span key={j} className={j === i ? "on" : ""} />
          ))}
        </div>
        <p className="form-hint">
          {t("The ✨ button at the bottom answers your questions at any time.")}
        </p>
      </div>
      <div className="dialog-footer">
        <Button onClick={() => go(page)}>{t("Show me")}</Button>
        {i < steps.length - 1 ? (
          <Button variant="primary" onClick={() => setI(i + 1)}>
            {t("Next")}
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>
            {t("Start")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
/** Checklist for the director until the academy is fully set up. */
export function FirstSteps() {
  const { data, t, go } = useApp();
  if (!data.permissions.admin) return null;
  const items: [boolean, string, string, string][] = [
    [
      data.users.filter((u) => u.active).length > 1,
      "Add your team",
      "Settings",
      "Team & permissions",
    ],
    [
      data.programs.length > 0 && data.programs.some((p) => p.price > 0),
      "Enter your programs and prices",
      "Programs & Cohorts",
      "",
    ],
    [
      data.staffHours.length > 0,
      "Fill in the working hours",
      "Settings",
      "Team & permissions",
    ],
    [
      (data.flows || []).some((f) => f.enabled),
      "Turn on a scenario",
      "Settings",
      "Scenarios",
    ],
    [
      (data.forms || []).length > 0,
      "Create a form for Instagram",
      "Settings",
      "Forms",
    ],
    [
      (data.kb || []).some((a) => !/compléter|adapter/.test(a.answer)),
      "Write the bot answers (address, hours)",
      "Settings",
      "Assistant & bot",
    ],
    [
      (data.docTemplates || []).length > 0,
      "Prepare your contract template",
      "Settings",
      "Document templates",
    ],
  ];
  const done = items.filter((x) => x[0]).length;
  if (done === items.length) return null;
  return (
    <Panel
      title="First steps"
      subtitle={`${done}/${items.length} ${t("done")}`}
      className="first-steps"
    >
      <ul className="checklist">
        {items.map(([ok, label, page, filter]) => (
          <li key={label} className={ok ? "ok" : ""}>
            <button onClick={() => go(page, filter)} disabled={ok}>
              <span className="check">{ok ? <Check size={14} /> : null}</span>
              {t(label)}
              {!ok && <ArrowUpRight size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Reviews: mood and topics --------------------------------------------------------------
export function FeedbackMoodPanel() {
  const { data, t } = useApp();
  const f = (data as Row).feedbackAnalysis;
  if (!f) return null;
  const total = f.positive + f.negative + f.neutral;
  const names: Record<string, string> = {
    wait: "Waiting time",
    price: "Price",
    staff: "Specialists and welcome",
    place: "Rooms and place",
    results: "Progress and results",
  };
  return (
    <Panel
      title="Reviews: mood and topics"
      subtitle="Read from the comments of your clients, inside the CRM."
    >
      {total === 0 ? (
        <p className="form-hint padded-hint">
          {t("No review with a comment yet.")}
        </p>
      ) : (
        <div className="padded">
          <div className="mood-bar">
            <span className="pos" style={{ flex: f.positive || 0.001 }}>
              😊 {f.positive}
            </span>
            <span className="neu" style={{ flex: f.neutral || 0.001 }}>
              😐 {f.neutral}
            </span>
            <span className="neg" style={{ flex: f.negative || 0.001 }}>
              😟 {f.negative}
            </span>
          </div>
          <ul className="widget-list">
            {Object.entries(f.topics as Row)
              .filter(([, v]) => (v as Row).count)
              .sort((a, b) => (b[1] as Row).count - (a[1] as Row).count)
              .map(([k, v]) => (
                <li key={k}>
                  <b>{t(names[k])}</b> {(v as Row).count} {t("mention(s)")}
                  {(v as Row).negative
                    ? ` · ${(v as Row).negative} ${t("negative")}`
                    : ""}
                </li>
              ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
