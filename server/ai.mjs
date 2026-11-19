/**
 * AI assistant (Claude API). Hidden unless ANTHROPIC_API_KEY is set.
 * Psychologist notes, intake answers, session notes and medical data are
 * never sent: only names, dates, services, amounts and request stages.
 */
import Anthropic from "@anthropic-ai/sdk";
import { all, one, chargeRows } from "./db.mjs";
import { aiAvailable, recordUsage } from "./smart.mjs";

export const aiConfigured = () => aiAvailable();
let client = null;
const MODEL = "claude-opus-5-5";

async function ask(
  system,
  content,
  maxTokens = 4000,
  userId = null,
  feature = "ai",
) {
  if (!aiConfigured())
    throw Object.assign(new Error("The AI assistant is not set up yet."), {
      status: 503,
    });
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // If the main model declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content }],
  });
  recordUsage(userId, feature, response.usage);
  if (response.stop_reason === "refusal")
    throw Object.assign(
      new Error("The assistant could not answer this request."),
      { status: 422 },
    );
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const languageName = (lang) =>
  lang === "ar" ? "Arabic" : lang === "en" ? "English" : "French";

/** Facts about one client, without private or clinical notes. */
function clientFacts(contactId) {
  const c = one(
    "SELECT id, name, language, level, birth_date, created_at FROM contacts WHERE id=?",
    contactId,
  );
  if (!c) return null;
  const money = (n) => (n / 100).toFixed(0);
  return {
    client: {
      first_name: String(c.name).split(" ")[0],
      language: c.language,
      level: c.level,
      client_since: c.created_at.slice(0, 10),
    },
    appointments: all(
      "SELECT title, kind, starts_at, status FROM appointments WHERE contact_id=? ORDER BY starts_at DESC LIMIT 30",
      c.id,
    ).map((a) => ({
      service: a.title,
      kind: a.kind,
      date: a.starts_at.slice(0, 16),
      status: a.status,
    })),
    requests: all(
      "SELECT service_type, interest, stage, source, created_at FROM opportunities WHERE contact_id=? ORDER BY id DESC LIMIT 10",
      c.id,
    ),
    groups: all(
      `SELECT h.name, e.status, h.start_date, h.end_date FROM enrollments e JOIN cohorts h ON h.id=e.cohort_id WHERE e.contact_id=?`,
      c.id,
    ),
    attendance: one(
      `SELECT SUM(a.status IN ('Present','Late')) present, SUM(a.status='Absent') absent FROM attendance a WHERE a.contact_id=?`,
      c.id,
    ),
    money: chargeRows()
      .filter((x) => x.contact_id === c.id)
      .map((x) => ({
        label: x.label,
        amount: money(x.amount - x.discount),
        remaining: money(x.balance),
        due: x.due_date,
      })),
    packages: all(
      "SELECT title, sessions_total, status FROM packages WHERE contact_id=?",
      c.id,
    ),
    feedback: all(
      "SELECT rating FROM feedback WHERE contact_id=? AND rating IS NOT NULL",
      c.id,
    ).map((f) => f.rating),
  };
}

/** Numbers about the academy for "what next" and data questions. */
function academyFacts() {
  const since = new Date(Date.now() - 400 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const contacts = all("SELECT id, name, created_at FROM contacts");
  const first = (id) =>
    String(contacts.find((c) => c.id === id)?.name || "").split(" ")[0];
  const lastVisit = all(
    "SELECT contact_id, MAX(starts_at) last FROM appointments WHERE status='Done' GROUP BY contact_id",
  );
  return {
    today,
    currency: one("SELECT currency FROM settings").currency,
    clients_total: contacts.length,
    new_clients_by_month: all(
      "SELECT substr(created_at,1,7) month, COUNT(*) n FROM contacts WHERE created_at>? GROUP BY month",
      since,
    ),
    requests_by_month_and_source: all(
      "SELECT substr(created_at,1,7) month, source, stage, service_type, COUNT(*) n FROM opportunities WHERE created_at>? GROUP BY month, source, stage, service_type",
      since,
    ),
    appointments_by_month: all(
      "SELECT substr(starts_at,1,7) month, status, title service, COUNT(*) n FROM appointments WHERE starts_at>? GROUP BY month, status, service",
      since,
    ),
    revenue_by_month: all(
      "SELECT substr(created_at,1,7) month, SUM(amount)/100 amount FROM payments WHERE created_at>? GROUP BY month",
      since,
    ),
    overdue: chargeRows()
      .filter((c) => c.balance > 0 && c.due_date < today)
      .slice(0, 30)
      .map((c) => ({
        client: first(c.contact_id),
        client_id: c.contact_id,
        remaining: c.balance / 100,
        due: c.due_date,
      })),
    open_requests: all(
      "SELECT contact_id, stage, interest, stage_at FROM opportunities WHERE stage NOT IN ('Enrolled','Lost') ORDER BY stage_at LIMIT 40",
    ).map((o) => ({ ...o, client: first(o.contact_id) })),
    not_seen_for_60_days: lastVisit
      .filter(
        (v) => v.last < new Date(Date.now() - 60 * 86400000).toISOString(),
      )
      .slice(0, 30)
      .map((v) => ({
        client: first(v.contact_id),
        client_id: v.contact_id,
        last_visit: v.last.slice(0, 10),
      })),
    packages_almost_used: all(
      `SELECT p.contact_id, p.title, p.sessions_total, (SELECT COUNT(*) FROM appointments a WHERE a.package_id=p.id AND a.status IN ('Done','No-show')) used FROM packages p WHERE p.status='Active'`,
    )
      .filter((p) => p.sessions_total - p.used <= 1)
      .map((p) => ({
        client: first(p.contact_id),
        client_id: p.contact_id,
        package: p.title,
      })),
    frequent_clients_without_package: all(
      `SELECT contact_id, COUNT(*) n FROM appointments WHERE status='Done' AND package_id IS NULL AND starts_at>? GROUP BY contact_id HAVING n>=3`,
      new Date(Date.now() - 90 * 86400000).toISOString(),
    ).map((r) => ({
      client: first(r.contact_id),
      client_id: r.contact_id,
      visits_90_days: r.n,
    })),
  };
}

const rules =
  "You help the staff of an academy in Algeria (psychology consultations, language courses, training). Staff are not technical: write short, plain sentences. Never invent facts that are not in the data.";

export function installAi(app, { allow, contactAccess, must, text }) {
  const staff = ["admin", "admissions", "academic", "instructor", "finance"];
  const route = (path, roles, fn) =>
    app.post(path, async (req, res, next) => {
      try {
        allow(req, roles);
        res.json(await fn(req));
      } catch (e) {
        next(e);
      }
    });
  route("/api/ai/summary", staff, async (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const facts = clientFacts(c.id);
    const answer = await ask(
      `${rules} Answer in ${languageName(req.body.lang)}.`,
      `Summarise this client's file for a colleague in 4 to 6 bullet points: what they come for, how regularly, what is paid or still due, and what to do next. Data:\n${JSON.stringify(facts)}`,
    );
    return { text: answer };
  });
  route("/api/ai/draft", staff, async (req) => {
    const c = contactAccess(req.user, req.body.contact_id);
    const goal = text(req.body.goal || "", "Situation", 500, false);
    const channel =
      req.body.channel === "email" ? "e-mail" : "WhatsApp message";
    const answer = await ask(
      `${rules} You write messages to clients on behalf of the academy "${one("SELECT academy FROM settings").academy}". Write only the message, ready to send, polite and warm, in ${req.body.lang === "ar" ? "Arabic" : "French"}. No placeholders in brackets.`,
      `Write a ${channel} for the client ${String(c.name).split(" ")[0]}. Situation: ${goal || "follow-up after the last contact"}. Client data:\n${JSON.stringify(clientFacts(c.id))}`,
      2000,
    );
    return { text: answer };
  });
  route("/api/ai/next", ["admin", "admissions", "finance"], async (req) => {
    const answer = await ask(
      `${rules} Answer in ${languageName(req.body.lang)}.`,
      `From this data, list the 5 most useful actions for today, most important first. For each: who (first name), why, and what to do (call, offer a package, remind a payment...). Use a numbered list. Data:\n${JSON.stringify(academyFacts())}`,
    );
    return { text: answer };
  });
  route("/api/ai/ask", ["admin", "finance"], async (req) => {
    const question = text(req.body.question, "Question", 500);
    must(question.length >= 3, "Write a question.");
    const answer = await ask(
      `${rules} Answer in ${languageName(req.body.lang)} with the number first, then one short sentence of explanation. If the data cannot answer, say so.`,
      `Question: ${question}\nData (monthly totals; amounts in the academy currency):\n${JSON.stringify(academyFacts())}`,
    );
    return { text: answer };
  });
}
