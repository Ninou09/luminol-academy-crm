import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  Send,
  StickyNote,
  CalendarPlus,
  MessageSquare,
  CheckCheck,
  Sparkles,
  Copy,
  Tag,
  Plus,
  AtSign,
  Trash2,
  History,
  FileSignature,
  Printer,
  Save,
  Eraser,
  Bell,
} from "lucide-react";
import { useApp } from "./context";
import { api } from "./types";
type Row = Record<string, any>;
import { Avatar, Badge, Button, Dialog, Empty, PageHead, Panel } from "./ui";
import { SuggestionBox, intentTone } from "./smart";

const channelLabel: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  phone: "Phone",
  sms: "SMS",
  instagram: "Instagram",
  facebook: "Facebook",
  other: "Other",
};
const outcomeLabel: Record<string, string> = {
  reached: "Reached",
  no_answer: "No answer",
  call_back: "Call back",
  wrong_number: "Wrong number",
};
const statusTone: Record<string, string> = {
  New: "amber",
  Open: "blue",
  Resolved: "teal",
};

// 1. Unified inbox ------------------------------------------------------------
export function MessagesPage() {
  const { data, t, person, user, date, time, toast, profile, open, refresh } =
    useApp();
  const convs = data.conversations || [];
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const shown = convs.filter((c) => {
    const p = person(c.contact_id);
    if (q && !`${p.name} ${p.phone}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    if (filter === "Unread") return c.unread > 0;
    if (filter === "Mine") return c.assignee_id === data.user.id;
    if (["New", "Open", "Resolved"].includes(filter))
      return (c.status || "New") === filter;
    return true;
  });
  const active =
    current ?? (window.innerWidth > 900 ? shown[0]?.contact_id : null);
  return (
    <>
      <PageHead
        title="Messages"
        subtitle="Every conversation with each client in one place: WhatsApp, e-mails, calls and notes."
      >
        <Button icon={<Plus size={16} />} onClick={() => setPicking(true)}>
          {t("New conversation")}
        </Button>
      </PageHead>
      {!data.integrations?.whatsapp && (
        <p className="info-banner">
          {t(
            "WhatsApp is not connected yet: this page works as a log. Write down what the client sent and what you answered; once Meta is connected, messages arrive here by themselves.",
          )}
        </p>
      )}
      <div className={`inbox ${active ? "has-thread" : ""}`}>
        <aside className="inbox-list">
          <input
            className="inbox-search"
            placeholder={t("Search a name or a number")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="chip-row">
            {["All", "Unread", "New", "Open", "Resolved", "Mine"].map((f) => (
              <button
                key={f}
                className={`chip ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {t(["New", "Open", "Resolved"].includes(f) ? `conv:${f}` : f)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty
              title="No conversation yet"
              text="Incoming WhatsApp messages and the replies you log will appear here."
            />
          ) : (
            shown.map((c) => {
              const p = person(c.contact_id);
              return (
                <button
                  key={c.contact_id}
                  className={`inbox-item ${active === c.contact_id ? "active" : ""} ${c.unread ? "unread" : ""}`}
                  onClick={() => setCurrent(c.contact_id)}
                >
                  <Avatar name={p.name} />
                  <span className="inbox-item-main">
                    <strong>
                      {c.urgent ? "⚠ " : ""}
                      {p.name}
                    </strong>
                    <small dir="auto">
                      {c.last_direction === "out" ? `${t("You")}: ` : ""}
                      {c.last_direction === "call"
                        ? `📞 ${t("Phone call")}`
                        : c.last_direction === "note"
                          ? `📝 ${String(c.last_body || "").slice(0, 60)}`
                          : String(c.last_body || "").slice(0, 70)}
                    </small>
                  </span>
                  <span className="inbox-item-side">
                    <small>{date(c.last_at)}</small>
                    {c.unread > 0 ? (
                      <span className="nav-count">{c.unread}</span>
                    ) : (
                      <Badge tone={statusTone[c.status || "New"]}>
                        {t(`conv:${c.status || "New"}`)}
                      </Badge>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </aside>
        {active ? (
          <Thread
            key={active}
            contactId={active}
            onBack={() => setCurrent(null)}
          />
        ) : (
          <div className="inbox-empty">
            <MessageSquare size={30} />
            <p>{t("Choose a conversation on the left.")}</p>
          </div>
        )}
      </div>
      {picking && (
        <Dialog title={t("New conversation")} onClose={() => setPicking(false)}>
          <ContactPicker
            onPick={(id) => {
              setCurrent(id);
              setPicking(false);
            }}
          />
        </Dialog>
      )}
    </>
  );
}

export function ContactPicker({ onPick }: { onPick: (id: number) => void }) {
  const { data, t } = useApp();
  const [q, setQ] = useState("");
  const list = data.contacts
    .filter((c) =>
      `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase()),
    )
    .slice(0, 12);
  return (
    <div className="form-body">
      <input
        autoFocus
        className="inbox-search"
        placeholder={t("Search a name or a number")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="pick-list">
        {list.map((c) => (
          <button key={c.id} className="pick-item" onClick={() => onPick(c.id)}>
            <Avatar name={c.name} />
            <span>
              <strong>{c.name}</strong>
              <small>{c.phone || c.email}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Thread({
  contactId,
  onBack,
}: {
  contactId: number;
  onBack: () => void;
}) {
  const { data, t, person, user, date, time, toast, profile, open, refresh } =
    useApp();
  const c = person(contactId);
  const [messages, setMessages] = useState<Row[]>([]);
  const [conv, setConv] = useState<Row>({ status: "New", assignee_id: null });
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState("out");
  const [channel, setChannel] = useState("whatsapp");
  const [busy, setBusy] = useState(false);
  const [call, setCall] = useState(false);
  const [ai, setAi] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  async function load() {
    try {
      const r = await api(`/messages/${contactId}`);
      setMessages(r.messages);
      setConv(r.conversation);
      setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 30);
    } catch (e: any) {
      toast(e.message);
    }
  }
  useEffect(() => {
    load().then(() => refresh());
  }, [contactId]);
  const canSend =
    !!data.integrations?.whatsapp &&
    channel === "whatsapp" &&
    direction === "out";
  async function submit(send: boolean) {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api("/messages", {
        contact_id: contactId,
        direction,
        channel,
        body,
        send,
      });
      setBody("");
      toast(t(send ? "Message sent" : "Saved in the conversation"));
      await load();
      refresh();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function update(values: Row) {
    try {
      await api(`/conversations/${contactId}`, values, "PATCH");
      await load();
      refresh();
    } catch (e: any) {
      toast(e.message);
    }
  }
  const fill = (s: string) =>
    s
      .replaceAll("{name}", String(c.name).split(" ")[0])
      .replaceAll("{academy}", data.settings.academy);
  return (
    <section className="inbox-thread">
      <header className="thread-head">
        <button className="text-button thread-back" onClick={onBack}>
          ← {t("Back")}
        </button>
        <button className="thread-who" onClick={() => profile(contactId)}>
          <Avatar name={c.name} />
          <span>
            <strong>{c.name}</strong>
            <small>{c.phone || c.email}</small>
          </span>
        </button>
        <div className="thread-tools">
          <select
            aria-label={t("Status")}
            value={conv.status || "New"}
            onChange={(e) => update({ status: e.target.value })}
          >
            {["New", "Open", "Resolved"].map((s) => (
              <option key={s} value={s}>
                {t(`conv:${s}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Assigned to")}
            value={conv.assignee_id || ""}
            onChange={(e) =>
              update({
                assignee_id: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">{t("Not assigned")}</option>
            {data.users
              .filter((u) => u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>
      </header>
      <div className="thread-actions">
        <Button icon={<Phone size={15} />} onClick={() => setCall(true)}>
          {t("Call")}
        </Button>
        <Button
          icon={<CalendarPlus size={15} />}
          onClick={() => open({ type: "appointment", contact: c as any })}
        >
          {t("Create an appointment")}
        </Button>
        {data.integrations?.ai && (
          <Button icon={<Sparkles size={15} />} onClick={() => setAi(true)}>
            {t("Write with AI")}
          </Button>
        )}
        {conv.status !== "Resolved" && (
          <Button
            icon={<CheckCheck size={15} />}
            onClick={() => update({ status: "Resolved" })}
          >
            {t("Mark as resolved")}
          </Button>
        )}
      </div>
      <div className="thread-body">
        {messages.length === 0 && (
          <p className="form-hint padded-hint">
            {t("No message yet. Write the first one below.")}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction}`}>
            <div className="bubble-meta">
              {m.direction === "call" ? (
                <>
                  <Phone size={13} /> {t("Phone call")} ·{" "}
                  {t(outcomeLabel[m.outcome] || m.outcome)}
                </>
              ) : m.direction === "note" ? (
                <>
                  <StickyNote size={13} /> {t("Internal note")}
                </>
              ) : (
                t(channelLabel[m.channel] || m.channel)
              )}
              {m.user_name ? ` · ${m.user_name}` : ""}
              {m.direction === "in" && m.intent && m.intent !== "info" && (
                <Badge tone={intentTone[m.intent] || "neutral"}>
                  {t(`intent:${m.intent}`)}
                </Badge>
              )}
            </div>
            {m.body && <p dir="auto">{m.body}</p>}
            <time>
              {date(m.created_at)} {time(m.created_at)}
            </time>
          </div>
        ))}
        <div ref={end} />
      </div>
      <SuggestionBox
        conv={conv}
        onUse={(text) => {
          setBody(text);
          setDirection("out");
          setChannel("whatsapp");
        }}
        onDone={() => {
          load();
          refresh();
        }}
      />
      <div className="composer">
        <div className="composer-row">
          <div className="segmented" role="group" aria-label={t("Type")}>
            {[
              ["out", "We answered"],
              ["in", "The client wrote"],
              ["note", "Note"],
            ].map(([k, l]) => (
              <button
                key={k}
                className={direction === k ? "active" : ""}
                onClick={() => setDirection(k)}
              >
                {t(l)}
              </button>
            ))}
          </div>
          {direction !== "note" && (
            <select
              aria-label={t("Channel")}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {Object.entries(channelLabel)
                .filter(([k]) => k !== "phone")
                .map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
            </select>
          )}
          {data.templates.length > 0 && direction === "out" && (
            <select
              aria-label={t("Quick reply")}
              value=""
              onChange={(e) => {
                const tpl = data.templates.find(
                  (x) => String(x.id) === e.target.value,
                );
                if (tpl) setBody(fill(tpl.body));
              }}
            >
              <option value="">{t("Quick reply…")}</option>
              {data.templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
            </select>
          )}
        </div>
        <textarea
          rows={3}
          value={body}
          placeholder={t(
            direction === "in"
              ? "Paste or write what the client sent"
              : direction === "note"
                ? "Visible to the team only"
                : "Write your answer",
          )}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="composer-row end">
          {canSend && (
            <Button
              variant="primary"
              icon={<Send size={15} />}
              disabled={busy || !body.trim() || !c.consent}
              onClick={() => submit(true)}
            >
              {t("Send on WhatsApp")}
            </Button>
          )}
          <Button
            variant={canSend ? "" : "primary"}
            icon={<Save size={15} />}
            disabled={busy || !body.trim()}
            onClick={() => submit(false)}
          >
            {t(canSend ? "Only save" : "Save in the conversation")}
          </Button>
        </div>
      </div>
      {call && (
        <CallDialog
          contact={c}
          onClose={() => {
            setCall(false);
            load();
          }}
        />
      )}
      {ai && (
        <AiDraftDialog
          contact={c}
          onUse={(text) => {
            setBody(text);
            setDirection("out");
            setAi(false);
          }}
          onClose={() => setAi(false)}
        />
      )}
    </section>
  );
}

// 8. Call log ---------------------------------------------------------------
export function CallDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { t, perform, toast } = useApp();
  const [outcome, setOutcome] = useState("reached");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  return (
    <Dialog title={`${t("Call")} — ${contact.name}`} onClose={onClose}>
      <div className="form-body">
        {contact.phone && (
          <a className="button primary call-now" href={`tel:${contact.phone}`}>
            <Phone size={17} /> {t("Call")} {contact.phone}
          </a>
        )}
        <p className="form-label">{t("How did the call go?")}</p>
        <div className="choice-grid">
          {Object.entries(outcomeLabel).map(([k, l]) => (
            <button
              key={k}
              className={`choice ${outcome === k ? "active" : ""}`}
              onClick={() => setOutcome(k)}
            >
              {t(l)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("What was said")}</span>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {outcome === "call_back" && (
          <label className="field">
            <span>{t("Call back on")}</span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
        )}
        {(outcome === "call_back" || outcome === "no_answer") && (
          <p className="form-hint">
            {t("A task to call back is created for you.")}
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await perform("/calls", {
                contact_id: contact.id,
                outcome,
                body,
                callback_at: when ? new Date(when).toISOString() : undefined,
              });
              toast(t("Call saved in the history"));
              onClose();
            } catch (e: any) {
              toast(e.message);
            }
          }}
        >
          {t("Save the call")}
        </Button>
      </div>
    </Dialog>
  );
}

// 6. AI assistant -------------------------------------------------------------
function useAi() {
  const { toast, lang } = useApp();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  async function run(path: string, body: Row | Record<string, any>) {
    setBusy(true);
    setText("");
    try {
      const r = await api(path, { ...body, lang });
      setText(r.text);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, text, run, setText };
}
export function AiDraftDialog({
  contact,
  onUse,
  onClose,
}: {
  contact: Row;
  onUse?: (text: string) => void;
  onClose: () => void;
}) {
  const { t, toast, lang } = useApp();
  const { busy, text, run, setText } = useAi();
  const [goal, setGoal] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [language, setLanguage] = useState(lang === "ar" ? "ar" : "fr");
  return (
    <Dialog title={`${t("Write with AI")} — ${contact.name}`} onClose={onClose}>
      <div className="form-body">
        <label className="field">
          <span>{t("What is the situation?")}</span>
          <textarea
            rows={2}
            value={goal}
            placeholder={t(
              "Example: remind the payment kindly, offer the next English group…",
            )}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>{t("Channel")}</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </label>
          <label className="field">
            <span>{t("Language")}</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>
        {text && (
          <label className="field">
            <span>{t("Draft — check it before sending")}</span>
            <textarea
              rows={7}
              dir={language === "ar" ? "rtl" : "ltr"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <p className="form-hint">
          {t(
            "Private notes of the psychologist and medical information are never sent to the AI.",
          )}
        </p>
      </div>
      <div className="dialog-footer">
        <Button
          icon={<Sparkles size={15} />}
          disabled={busy}
          onClick={() =>
            run("/ai/draft", {
              contact_id: contact.id,
              goal,
              channel,
              lang: language,
            })
          }
        >
          {t(busy ? "Writing…" : text ? "Write again" : "Write a draft")}
        </Button>
        {text && (
          <Button
            icon={<Copy size={15} />}
            onClick={() => {
              navigator.clipboard?.writeText(text);
              toast(t("Copied"));
            }}
          >
            {t("Copy")}
          </Button>
        )}
        {text && onUse && (
          <Button variant="primary" onClick={() => onUse(text)}>
            {t("Use this text")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
export function AiSummary({ contact }: { contact: Row }) {
  const { data, t } = useApp();
  const { busy, text, run } = useAi();
  if (!data.integrations?.ai) return null;
  return (
    <div className="ai-box">
      <Button
        icon={<Sparkles size={15} />}
        disabled={busy}
        onClick={() => run("/ai/summary", { contact_id: contact.id })}
      >
        {t(busy ? "Reading the file…" : "Summary of the client")}
      </Button>
      {text && <div className="ai-text">{text}</div>}
    </div>
  );
}
export function AiNextActions() {
  const { data, t } = useApp();
  const { busy, text, run } = useAi();
  if (
    !data.integrations?.ai ||
    !["admin", "manager", "admissions", "finance"].includes(data.user.role)
  )
    return null;
  return (
    <Panel
      title="What to do next?"
      subtitle="The assistant reads the requests, payments and visits and suggests today's most useful actions."
      action={
        <Button
          icon={<Sparkles size={15} />}
          disabled={busy}
          onClick={() => run("/ai/next", {})}
        >
          {t(busy ? "Thinking…" : "Suggest")}
        </Button>
      }
    >
      {text ? (
        <div className="ai-text padded">{text}</div>
      ) : (
        <p className="form-hint padded-hint">
          {t(
            "Press “Suggest”: who to call, who may leave, who to offer a package.",
          )}
        </p>
      )}
    </Panel>
  );
}
export function AiAsk() {
  const { data, t } = useApp();
  const { busy, text, run } = useAi();
  const [q, setQ] = useState("");
  if (
    !data.integrations?.ai ||
    !["admin", "manager", "finance"].includes(data.user.role)
  )
    return null;
  return (
    <Panel
      title="Ask a question about your numbers"
      subtitle="Write in plain words, for example: How many new clients from Instagram in November?"
    >
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run("/ai/ask", { question: q });
        }}
      >
        <label className="field grow">
          <span>{t("Your question")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Button
          variant="primary"
          type="submit"
          icon={<Sparkles size={15} />}
          disabled={busy}
        >
          {t(busy ? "Thinking…" : "Ask")}
        </Button>
      </form>
      {text && <div className="ai-text padded">{text}</div>}
    </Panel>
  );
}

// 3. Tags and custom fields on the client card -----------------------------
export function TagChips({
  contactId,
  small = false,
}: {
  contactId: number;
  small?: boolean;
}) {
  const { data } = useApp();
  const tags = (data.contactTags || [])
    .filter((x) => x.contact_id === contactId)
    .map((x) => (data.tags || []).find((g) => g.id === x.tag_id))
    .filter(Boolean) as Row[];
  if (!tags.length) return null;
  return (
    <span className={`tag-chips ${small ? "small" : ""}`}>
      {tags.map((g) => (
        <Badge key={g.id} tone={g.color}>
          {g.name}
        </Badge>
      ))}
    </span>
  );
}
export function TagsAndFields({ contact }: { contact: Row }) {
  const { data, t, perform, toast } = useApp();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const mine = new Set(
    (data.contactTags || [])
      .filter((x) => x.contact_id === contact.id)
      .map((x) => x.tag_id),
  );
  const fields = (data.customFields || []).filter(
    (f) => f.entity === "contact",
  );
  const value = (fid: number) =>
    (data.customValues || []).find(
      (v) => v.field_id === fid && v.record_id === contact.id,
    )?.value ?? "";
  const toggle = (tagId: number, on: boolean) =>
    perform(`/contacts/${contact.id}/tags`, { tag_id: tagId, on }).catch(
      (e: any) => toast(e.message),
    );
  const save = (fid: number, v: string) =>
    perform(
      "/custom-values",
      { field_id: fid, record_id: contact.id, value: v },
      "PUT",
    ).catch((e: any) => toast(e.message));
  return (
    <section className="panel tags-fields">
      <div className="panel-heading">
        <div>
          <h2>{t("Tags")}</h2>
        </div>
      </div>
      <div className="tag-editor">
        {(data.tags || []).map((g) => (
          <button
            key={g.id}
            className={`tag-toggle ${g.color} ${mine.has(g.id) ? "on" : ""}`}
            aria-pressed={mine.has(g.id)}
            onClick={() => toggle(g.id, !mine.has(g.id))}
          >
            <Tag size={13} /> {g.name}
          </button>
        ))}
        {adding ? (
          <form
            className="tag-new"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              try {
                const r = await api("/tags", { name });
                await toggle(r.id, true);
                setName("");
                setAdding(false);
              } catch (err: any) {
                toast(err.message);
              }
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("New tag")}
            />
            <Button variant="small" type="submit">
              {t("Add")}
            </Button>
          </form>
        ) : (
          <button className="tag-toggle add" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t("New tag")}
          </button>
        )}
      </div>
      {fields.length > 0 && (
        <div className="custom-fields">
          {fields.map((f) => (
            <label key={f.id} className="field">
              <span>{f.label}</span>
              {f.kind === "list" ? (
                <select
                  value={value(f.id)}
                  onChange={(e) => save(f.id, e.target.value)}
                >
                  <option value="">—</option>
                  {f.options.map((o: string) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.kind === "yesno" ? (
                <select
                  value={value(f.id)}
                  onChange={(e) => save(f.id, e.target.value)}
                >
                  <option value="">—</option>
                  <option value="1">{t("Yes")}</option>
                  <option value="0">{t("No")}</option>
                </select>
              ) : (
                <input
                  type={
                    f.kind === "number"
                      ? "number"
                      : f.kind === "date"
                        ? "date"
                        : "text"
                  }
                  defaultValue={value(f.id)}
                  onBlur={(e) =>
                    e.target.value !== value(f.id) && save(f.id, e.target.value)
                  }
                />
              )}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

// 7. Comments with @mentions --------------------------------------------------
export function Comments({ contact }: { contact: Row }) {
  const { data, t, perform, toast, date, time } = useApp();
  const list = (data.comments || []).filter((c) => c.contact_id === contact.id);
  const [body, setBody] = useState("");
  const staff = data.users.filter((u) => u.active && u.id !== data.user.id);
  return (
    <section className="panel comments">
      <div className="panel-heading">
        <div>
          <h2>{t("Team comments")}</h2>
          <p>{t("Write @ and a first name to notify a colleague.")}</p>
        </div>
      </div>
      <div className="comment-list">
        {list.map((c) => (
          <div key={c.id} className="comment">
            <Avatar name={c.user_name} />
            <div>
              <strong>{c.user_name}</strong>{" "}
              <small>
                {date(c.created_at)} {time(c.created_at)}
              </small>
              <p>{c.body}</p>
            </div>
            {(c.user_id === data.user.id || data.permissions.admin) && (
              <button
                className="icon-button"
                aria-label={t("Delete")}
                onClick={() =>
                  perform(`/comments/${c.id}`, {}, "DELETE").catch((e: any) =>
                    toast(e.message),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="comment-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          try {
            const r = await perform("/comments", {
              contact_id: contact.id,
              body,
            });
            setBody("");
            toast(
              r.mentioned
                ? `${t("Comment added")} · ${r.mentioned} ${t("notified")}`
                : t("Comment added"),
            );
          } catch (err: any) {
            toast(err.message);
          }
        }}
      >
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("Write a comment for the team")}
        />
        <div className="mention-row">
          {staff.slice(0, 8).map((u) => (
            <button
              type="button"
              key={u.id}
              className="chip"
              onClick={() =>
                setBody(
                  (b) =>
                    `${b}${b && !b.endsWith(" ") ? " " : ""}@${u.name.split(" ")[0]} `,
                )
              }
            >
              <AtSign size={12} />
              {u.name.split(" ")[0]}
            </button>
          ))}
          <Button variant="primary" type="submit" disabled={!body.trim()}>
            {t("Send")}
          </Button>
        </div>
      </form>
    </section>
  );
}

// Client conversation inside the card ------------------------------------
export function ClientConversation({ contact }: { contact: Row }) {
  const { t, go } = useApp();
  return (
    <div className="client-conversation">
      <Thread contactId={contact.id} onBack={() => go("Messages")} />
      <p className="form-hint">
        {t("The same conversation is on the Messages page.")}
      </p>
    </div>
  );
}

// 7. Notification centre -----------------------------------------------------
export function NotificationList({ onDone }: { onDone: () => void }) {
  const { data, t, date, time, profile, go, perform } = useApp();
  const list = data.notifications || [];
  const unread = list.filter((n) => !n.read_at).length;
  if (!list.length) return null;
  return (
    <div className="notification-center">
      <div className="notification-head">
        <strong>
          <Bell size={14} /> {unread ? `${unread} ${t("new")}` : t("All read")}
        </strong>
        {unread > 0 && (
          <button
            className="text-button"
            onClick={() => perform("/notifications/read", {})}
          >
            {t("Mark all as read")}
          </button>
        )}
      </div>
      {list.slice(0, 8).map((n) => (
        <button
          key={n.id}
          className={`notification-item ${n.read_at ? "" : "unread"}`}
          onClick={() => {
            if (!n.read_at)
              perform("/notifications/read", { id: n.id }).catch(() => {});
            onDone();
            if (n.contact_id) profile(n.contact_id);
            else if (n.link) go(n.link);
          }}
        >
          <span>{n.text}</span>
          <small>
            {date(n.created_at)} {time(n.created_at)}
          </small>
        </button>
      ))}
    </div>
  );
}

// 11. Record history ---------------------------------------------------------
const hiddenKeys = new Set([
  "id",
  "version",
  "portal_token_hash",
  "created_at",
]);
export function HistoryDialog({
  table,
  id,
  onClose,
}: {
  table: string;
  id: number;
  onClose: () => void;
}) {
  const { t, date, time, perform, toast } = useApp();
  const [data, setData] = useState<{ versions: Row[]; current: Row } | null>(
    null,
  );
  const load = () =>
    api(`/history/${table}/${id}`)
      .then(setData)
      .catch((e: any) => toast(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <Dialog title={t("History of changes")} onClose={onClose} wide>
      <div className="form-body">
        {!data ? (
          <p>{t("Loading…")}</p>
        ) : data.versions.length === 0 ? (
          <Empty
            title="No change yet"
            text="Each edit is kept here, with who made it."
          />
        ) : (
          data.versions.map((v) => {
            const changed = Object.keys(v.before).filter(
              (k) =>
                !hiddenKeys.has(k) &&
                String(v.before[k] ?? "") !== String(data.current?.[k] ?? ""),
            );
            return (
              <div key={v.id} className="history-row">
                <div>
                  <strong>{v.user_name || "—"}</strong>{" "}
                  <small>
                    {date(v.created_at)} {time(v.created_at)} · {t(v.summary)}
                  </small>
                  {changed.length === 0 ? (
                    <p className="form-hint">{t("Same as now")}</p>
                  ) : (
                    <ul>
                      {changed.slice(0, 8).map((k) => (
                        <li key={k}>
                          <b>{t(k)}</b>:{" "}
                          <s>{String(data.current?.[k] ?? "—").slice(0, 80)}</s>{" "}
                          → {String(v.before[k] ?? "—").slice(0, 80)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {changed.length > 0 && (
                  <Button
                    variant="small"
                    icon={<History size={14} />}
                    onClick={async () => {
                      if (!window.confirm(t("Go back to this version?")))
                        return;
                      try {
                        await perform(`/history/${v.id}/restore`, {});
                        toast(t("Earlier version restored"));
                        load();
                      } catch (e: any) {
                        toast(e.message);
                      }
                    }}
                  >
                    {t("Restore")}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </Dialog>
  );
}

// 5. Documents from templates, signed with a finger, saved as PDF -----------
export const defaultTemplates = [
  {
    name: "Training contract",
    kind: "contract",
    body: "CONTRAT DE FORMATION\n\nEntre {academy}, et {name}, né(e) le {birth_date}.\n\nObjet : formation « {course} ».\nPrix total : {price}.\nDate de début : {date}.\n\nL'apprenant(e) s'engage à suivre les séances et à régler les échéances aux dates prévues. Toute absence doit être signalée au moins 24 heures à l'avance.\n\nFait le {today}.",
  },
  {
    name: "Consultation agreement",
    kind: "agreement",
    body: "ACCORD DE CONSULTATION\n\nJe soussigné(e) {name} accepte les conditions des consultations proposées par {academy} : « {course} », au tarif de {price} par séance.\n\nLes séances annulées moins de 24 heures à l'avance sont dues. Les échanges restent strictement confidentiels.\n\nFait le {today}.",
  },
  {
    name: "Attendance certificate",
    kind: "attendance",
    body: "ATTESTATION DE PRÉSENCE\n\n{academy} atteste que {name} a suivi « {course} » à partir du {date}.\n\nCette attestation est délivrée pour servir et valoir ce que de droit.\n\nFait le {today}.",
  },
  {
    name: "Certificate",
    kind: "certificate",
    body: "CERTIFICAT\n\n{academy} certifie que\n\n{name}\n\na suivi avec succès la formation « {course} ».\n\nFait le {today}.",
  },
];
/** Smallest valid PDF holding one JPEG page (A4). */
function pdfFromJpeg(jpeg: Uint8Array, w: number, h: number) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (x: string | Uint8Array) => {
    const b = typeof x === "string" ? enc.encode(x) : x;
    parts.push(b);
    length += b.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of Array.isArray(body) ? body : [body]) push(p);
    push("\nendobj\n");
  };
  const pw = 595.28,
    ph = 841.89;
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    "\nendstream",
  ]);
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++)
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
export function DocumentDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { data, t, money, date, perform, toast, program, cohort } = useApp();
  const templates = (data.docTemplates || []).length
    ? (data.docTemplates as Row[])
    : (defaultTemplates.map((x, i) => ({ ...x, id: -i - 1 })) as Row[]);
  const [tid, setTid] = useState(templates[0]?.id);
  const tpl = templates.find((x) => x.id === Number(tid)) || templates[0];
  const enr = data.enrollments.filter((e) => e.contact_id === contact.id);
  const lastCohort = enr.length ? cohort(enr[enr.length - 1].cohort_id) : null;
  const charge = data.charges
    .filter((c) => c.contact_id === contact.id)
    .slice(-1)[0];
  const [vals, setVals] = useState<Record<string, string>>({
    name: contact.name,
    course: lastCohort
      ? `${program(lastCohort.program_id).name} — ${lastCohort.name}`
      : "",
    price: charge
      ? money(charge.amount - charge.discount, charge.currency)
      : "",
    date: lastCohort
      ? date(lastCohort.start_date, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "",
    birth_date: contact.birth_date
      ? date(contact.birth_date, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "",
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = String(tpl?.body || "").replace(/\{(\w+)\}/g, (_, k) =>
    k === "academy"
      ? data.settings.legal_name || data.settings.academy
      : k === "today"
        ? date(new Date().toISOString(), {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : vals[k] || "……",
  );
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#10201c";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);
  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  function render() {
    const W = 1240,
      H = 1754;
    const page = document.createElement("canvas");
    page.width = W;
    page.height = H;
    const ctx = page.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#0f4b42";
    ctx.font = "600 30px 'DM Sans Variable', sans-serif";
    ctx.fillText(data.settings.legal_name || data.settings.academy, 110, 130);
    ctx.fillStyle = "#6b7a75";
    ctx.font = "22px 'DM Sans Variable', sans-serif";
    const legal = [
      data.settings.legal_address,
      data.settings.legal_nif && `NIF ${data.settings.legal_nif}`,
    ]
      .filter(Boolean)
      .join(" · ");
    if (legal) ctx.fillText(legal, 110, 168);
    ctx.fillRect(110, 200, W - 220, 2);
    ctx.fillStyle = "#14201d";
    ctx.font = "27px 'DM Sans Variable', sans-serif";
    let y = 280;
    for (const line of wrap(ctx, filled, W - 220)) {
      if (y > H - 420) break;
      if (/^[A-ZÉÈÀ' ]{6,}$/.test(line)) {
        ctx.font = "700 34px 'DM Sans Variable', sans-serif";
        ctx.fillText(line, 110, y);
        ctx.font = "27px 'DM Sans Variable', sans-serif";
      } else ctx.fillText(line, 110, y);
      y += line ? 42 : 26;
    }
    ctx.font = "24px 'DM Sans Variable', sans-serif";
    ctx.fillStyle = "#6b7a75";
    ctx.fillText(t("Signature"), 110, H - 360);
    if (signed && canvas.current)
      ctx.drawImage(canvas.current, 110, H - 340, 520, 200);
    ctx.fillText(contact.name, 110, H - 110);
    return page;
  }
  async function saveDoc() {
    setBusy(true);
    try {
      const page = render();
      const url = page.toDataURL("image/jpeg", 0.86);
      const bin = atob(url.split(",")[1]);
      const jpeg = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const pdf = pdfFromJpeg(jpeg, page.width, page.height);
      let s = "";
      for (let i = 0; i < pdf.length; i += 0x8000)
        s += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
      await perform("/documents", {
        contact_id: contact.id,
        name: `${t(tpl.name)} — ${contact.name}${signed ? ` (${t("signed")})` : ""}.pdf`.slice(
          0,
          150,
        ),
        mime: "application/pdf",
        base64: btoa(s),
      });
      toast(t("Document saved in the client's documents"));
      onClose();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    const img = render().toDataURL("image/png");
    w.document.write(
      `<title>${t(tpl.name)}</title><style>@page{size:A4;margin:0}body{margin:0}img{width:100%}</style><img src="${img}" onload="print()">`,
    );
    w.document.close();
  }
  const keys = Array.from(
    new Set(
      (String(tpl?.body || "").match(/\{(\w+)\}/g) || []).map((x) =>
        x.slice(1, -1),
      ),
    ),
  ).filter((k) => !["academy", "today"].includes(k));
  return (
    <Dialog title={t("Prepare a document")} onClose={onClose} wide>
      <div className="form-body doc-dialog">
        <div className="doc-fields">
          <label className="field">
            <span>{t("Template")}</span>
            <select
              value={tid}
              onChange={(e) => setTid(Number(e.target.value))}
            >
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
            </select>
          </label>
          {keys.map((k) => (
            <label key={k} className="field">
              <span>{t(`{${k}}`)}</span>
              <input
                value={vals[k] || ""}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
              />
            </label>
          ))}
          <p className="form-label">{t("Signature of the client")}</p>
          <canvas
            ref={canvas}
            className="signature-pad small"
            aria-label={t("Sign here with your finger")}
            onPointerDown={(e) => {
              drawing.current = true;
              const [x, y] = point(e);
              const ctx = canvas.current!.getContext("2d")!;
              ctx.beginPath();
              ctx.moveTo(x, y);
              canvas.current!.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const [x, y] = point(e);
              const ctx = canvas.current!.getContext("2d")!;
              ctx.lineTo(x, y);
              ctx.stroke();
              setSigned(true);
            }}
            onPointerUp={() => (drawing.current = false)}
          />
          <button
            className="text-button"
            onClick={() => {
              const c = canvas.current!;
              const ctx = c.getContext("2d")!;
              ctx.fillStyle = "#fff";
              ctx.fillRect(0, 0, c.width, c.height);
              setSigned(false);
            }}
          >
            <Eraser size={14} /> {t("Clear")}
          </button>
        </div>
        <div className="doc-preview" aria-label={t("Preview")}>
          <strong>{data.settings.legal_name || data.settings.academy}</strong>
          <pre>{filled}</pre>
        </div>
      </div>
      <div className="dialog-footer">
        <Button icon={<Printer size={15} />} onClick={print}>
          {t("Print / PDF")}
        </Button>
        <Button
          variant="primary"
          icon={<FileSignature size={15} />}
          disabled={busy}
          onClick={saveDoc}
        >
          {t("Save in the documents")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Buttons added to the client card. */
export function ClientCardTools({ contact }: { contact: Row }) {
  const { data, t } = useApp();
  const [dlg, setDlg] = useState("");
  const desk = ["admin", "admissions", "academic", "manager"].includes(
    data.user.role,
  );
  return (
    <>
      {contact.phone && (
        <Button icon={<Phone size={15} />} onClick={() => setDlg("call")}>
          {t("Call")}
        </Button>
      )}
      {desk && (
        <Button
          icon={<FileSignature size={15} />}
          onClick={() => setDlg("doc")}
        >
          {t("Document")}
        </Button>
      )}
      {data.integrations?.ai && (
        <Button icon={<Sparkles size={15} />} onClick={() => setDlg("ai")}>
          {t("Write with AI")}
        </Button>
      )}
      {data.permissions.admin && (
        <Button icon={<History size={15} />} onClick={() => setDlg("history")}>
          {t("History of changes")}
        </Button>
      )}
      {dlg === "call" && (
        <CallDialog contact={contact} onClose={() => setDlg("")} />
      )}
      {dlg === "doc" && (
        <DocumentDialog contact={contact} onClose={() => setDlg("")} />
      )}
      {dlg === "ai" && (
        <AiDraftDialog contact={contact} onClose={() => setDlg("")} />
      )}
      {dlg === "history" && (
        <HistoryDialog
          table="contacts"
          id={contact.id}
          onClose={() => setDlg("")}
        />
      )}
    </>
  );
}

/** "Referred by" on the client card (loyalty programme). */
export function ReferralField({ contact }: { contact: Row }) {
  const { data, t, perform, toast } = useApp();
  const referred = data.contacts.filter((c) => c.referred_by === contact.id);
  if (!data.permissions.editAdmissions) return null;
  return (
    <div className="referral-field">
      <label className="field">
        <span>{t("Referred by")}</span>
        <select
          value={contact.referred_by || ""}
          onChange={(e) =>
            perform(
              `/contacts/${contact.id}/referral`,
              { referred_by: e.target.value ? Number(e.target.value) : null },
              "PATCH",
            ).catch((err: any) => toast(err.message))
          }
        >
          <option value="">—</option>
          {data.contacts
            .filter((c) => c.id !== contact.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {referred.length > 0 && (
        <p className="form-hint">
          {t("Brought")} {referred.length} {t("client(s)")}:{" "}
          {referred.map((c) => c.name).join(", ")}
        </p>
      )}
      {(() => {
        const every = Number(data.settings.loyalty_every || 0);
        if (!every) return null;
        const done = data.appointments.filter(
          (a) => a.contact_id === contact.id && a.status === "Done",
        ).length;
        const left = every - (done % every);
        return (
          <p className="form-hint">
            {left === 1
              ? `${t("The next session is with the loyalty discount")}: −${data.settings.loyalty_percent}%`
              : `${t("Loyalty")}: ${left} ${t("session(s) before")} −${data.settings.loyalty_percent}%`}
          </p>
        );
      })()}
    </div>
  );
}
