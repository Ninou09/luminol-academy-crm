import { useEffect, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  KeyRound,
  Languages,
  LoaderCircle,
  ShieldX,
} from "lucide-react";
import { api } from "./types";
import { arabic } from "./i18n";
import { french } from "./french";

const locales: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ",
  en: "en-GB",
};
function useLang() {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem("luminol-language") || "fr";
    } catch {
      return "fr";
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("luminol-language", lang);
    } catch {}
  }, [lang]);
  const t = (s: string) =>
    lang === "ar" ? arabic[s] || s : lang === "fr" ? french[s] || s : s;
  return { lang, setLang, t };
}
function Shell({
  lang,
  setLang,
  children,
}: {
  lang: string;
  setLang: (s: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="booking-page">
      <header className="booking-header">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" />
          <span>Luminol Academy</span>
        </a>
        <div
          className="language-picker"
          role="group"
          aria-label="Langue / اللغة / Language"
        >
          <Languages size={17} aria-hidden="true" />
          {[
            ["fr", "FR"],
            ["ar", "ع"],
            ["en", "EN"],
          ].map(([code, label]) => (
            <button
              key={code}
              className={lang === code ? "active" : ""}
              onClick={() => setLang(code)}
              aria-pressed={lang === code}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <main className="booking-main narrow">{children}</main>
    </div>
  );
}

/** Opened from the e-mail link: choose a new password. */
export function ResetPage() {
  const { lang, setLang, t } = useLang();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== again)
      return setError(t("The two passwords are different."));
    setBusy(true);
    try {
      await api("/password/reset", { token, password });
      setDone(true);
    } catch (err: any) {
      setError(t(err.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell lang={lang} setLang={setLang}>
      <div className="booking-card">
        {done ? (
          <div className="center">
            <CheckCircle2 size={44} className="ok" />
            <h1>{t("Password changed")}</h1>
            <p>{t("You can now sign in with your new password.")}</p>
            <a className="button primary" href="/">
              {t("Sign in")}
            </a>
          </div>
        ) : (
          <form className="booking-form" onSubmit={submit}>
            <h1>
              <KeyRound size={26} /> {t("Choose a new password")}
            </h1>
            <label>
              <span>{t("New password")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>{t("Repeat the new password")}</span>
              <input
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                minLength={10}
                required
                autoComplete="new-password"
              />
            </label>
            <p className="form-hint">{t("At least 10 characters.")}</p>
            {error && <div className="form-error">{error}</div>}
            <button className="button primary" disabled={busy || !token}>
              {busy && <LoaderCircle size={16} className="spin" />}
              {t("Save the new password")}
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}

/** Opened by scanning the QR code printed on a certificate. */
export function VerifyPage() {
  const { lang, setLang, t } = useLang();
  const code = window.location.pathname.split("/").pop() || "";
  const [result, setResult] = useState<any>(null);
  useEffect(() => {
    api(`/public/certificate/${encodeURIComponent(code)}`)
      .then(setResult)
      .catch(() => setResult({ valid: false }));
  }, []);
  const fmt = (s: string) =>
    s
      ? new Intl.DateTimeFormat(locales[lang], {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(new Date(s))
      : "";
  return (
    <Shell lang={lang} setLang={setLang}>
      <div className="booking-card center">
        {!result && <LoaderCircle className="spin" />}
        {result?.valid && (
          <>
            <BadgeCheck size={52} className="ok" />
            <h1>{t("Valid certificate")}</h1>
            <p>
              <strong>{result.student}</strong>
              <br />
              {result.program}{" "}
              {result.level ? `· ${t("Level")} ${result.level}` : ""}
              <br />
              {result.cohort} · {fmt(result.completed_at || result.issued_at)}
            </p>
            <p className="muted">
              {result.academy} · N° {result.code}
            </p>
          </>
        )}
        {result && !result.valid && (
          <>
            <ShieldX size={52} className="bad" />
            <h1>{t("Certificate not found")}</h1>
            <p>
              {t(
                "This code does not match any certificate issued by the academy.",
              )}
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

const money = (lang: string, cents: number, currency: string) =>
  new Intl.NumberFormat(locales[lang], {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(cents / 100);
const when = (lang: string, iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locales[lang], {
    timeZone: "Africa/Algiers",
    hourCycle: "h23",
    ...opts,
  }).format(new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso));

/** The client's private page, opened from the link sent by WhatsApp. */
export function PortalPage() {
  const { lang, setLang, t } = useLang();
  const token = window.location.pathname.split("/").pop() || "";
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/portal/${encodeURIComponent(token)}`)
      .then(setD)
      .catch((e) => setError(t(e.message)));
  }, []);
  async function pay(id: number) {
    try {
      window.location.href = (
        await api(`/portal/${encodeURIComponent(token)}/pay/${id}`, {})
      ).url;
    } catch (e: any) {
      setError(t(e.message));
    }
  }
  const dt = (iso: string) =>
    when(lang, iso, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <Shell lang={lang} setLang={setLang}>
      {error && (
        <div className="booking-card center">
          <ShieldX size={44} className="bad" />
          <p>{error}</p>
        </div>
      )}
      {!d && !error && <LoaderCircle className="spin" />}
      {d && (
        <div className="portal">
          <h1>
            {t("Hello")} {d.name.split(" ")[0]} 👋
          </h1>
          <p className="muted">
            {d.academy}
            {d.level ? ` · ${t("Level")} ${d.level}` : ""}
          </p>
          <section className="booking-step">
            <h2>{t("My appointments")}</h2>
            {!d.appointments.length && (
              <p className="muted">{t("No upcoming appointment.")}</p>
            )}
            {d.appointments.map((a: any) => (
              <div key={a.id} className="portal-row">
                <strong>{dt(a.starts_at)}</strong>
                <span>
                  {a.title}
                  {a.staff ? ` · ${a.staff}` : ""}
                  {a.location ? ` · ${a.location}` : ""}
                  {a.status === "Pending" ? ` · ${t("To confirm")}` : ""}
                </span>
                {a.meeting_url && (
                  <a
                    className="button small primary"
                    href={a.meeting_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Join video call")}
                  </a>
                )}
              </div>
            ))}
            <a className="button small" href="/book">
              {t("Book an appointment")}
            </a>
          </section>
          {d.groups.map((g: any) => (
            <section key={g.id} className="booking-step">
              <h2>
                {g.cohort} <small className="muted">· {g.program}</small>
              </h2>
              {!g.sessions.length && (
                <p className="muted">{t("No upcoming class.")}</p>
              )}
              {g.sessions.map((s: any, i: number) => (
                <div key={i} className="portal-row">
                  <strong>{dt(s.starts_at)}</strong>
                  <span>
                    {s.title}
                    {s.room ? ` · ${s.room}` : ""}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {d.packages.length > 0 && (
            <section className="booking-step">
              <h2>{t("Session packages")}</h2>
              {d.packages.map((p: any, i: number) => (
                <div key={i} className="portal-row">
                  <strong>{p.title}</strong>
                  <span>
                    {p.sessions_total - p.used} {t("sessions left")} /{" "}
                    {p.sessions_total}
                  </span>
                </div>
              ))}
            </section>
          )}
          {d.grades.length > 0 && (
            <section className="booking-step">
              <h2>{t("My marks")}</h2>
              {d.grades.map((g: any, i: number) => (
                <div key={i} className="portal-row">
                  <strong>
                    {g.score}/{g.max_score}
                  </strong>
                  <span>
                    {g.title} · {g.cohort} ·{" "}
                    {when(lang, g.taken_on, { day: "numeric", month: "short" })}
                  </span>
                </div>
              ))}
            </section>
          )}
          {d.certificates.length > 0 && (
            <section className="booking-step">
              <h2>{t("My certificates")}</h2>
              {d.certificates.map((c: any) => (
                <div key={c.code} className="portal-row">
                  <strong>{c.program}</strong>
                  <span>
                    {c.cohort}
                    {c.level ? ` · ${c.level}` : ""}
                  </span>
                  <a className="button small" href={`/verify/${c.code}`}>
                    {t("Check")}
                  </a>
                </div>
              ))}
            </section>
          )}
          <section className="booking-step">
            <h2>{t("To pay")}</h2>
            {!d.charges.length && (
              <p className="muted">{t("Nothing to pay. Thank you!")}</p>
            )}
            {d.charges.map((c: any) => (
              <div key={c.id} className="portal-row">
                <strong>{money(lang, c.balance, c.currency)}</strong>
                <span>
                  {c.label} · {t("Due date")}{" "}
                  {when(lang, c.due_date, { day: "numeric", month: "short" })}
                </span>
                {d.payOnline && c.currency === "DZD" && (
                  <button
                    className="button small primary"
                    onClick={() => pay(c.id)}
                  >
                    {t("Pay by card (CIB / Edahabia)")}
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </Shell>
  );
}

/** Short satisfaction survey (1–5 stars + comment). */
export function FeedbackPage() {
  const { lang, setLang, t } = useLang();
  const token = window.location.pathname.split("/").pop() || "";
  const [info, setInfo] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/public/feedback/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setError(t(e.message)));
  }, []);
  async function send() {
    try {
      await api(`/public/feedback/${encodeURIComponent(token)}`, {
        rating,
        comment,
      });
      setDone(true);
    } catch (e: any) {
      setError(t(e.message));
    }
  }
  return (
    <Shell lang={lang} setLang={setLang}>
      <div className="booking-card center">
        {done || info?.answered ? (
          <>
            <CheckCircle2 size={44} className="ok" />
            <h1>{t("Thank you for your feedback!")}</h1>
          </>
        ) : info ? (
          <>
            <h1>{t("How was it?")}</h1>
            <p>
              {info.academy} · {info.about}
            </p>
            <div
              className="star-picker"
              role="radiogroup"
              aria-label={t("Rating")}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={n <= rating ? "on" : ""}
                  onClick={() => setRating(n)}
                  aria-label={`${n}/5`}
                  role="radio"
                  aria-checked={rating === n}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className="big-textarea"
              rows={4}
              placeholder={t("A comment? (optional)")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
            />
            <button
              className="button primary"
              disabled={!rating}
              onClick={send}
            >
              {t("Send")}
            </button>
          </>
        ) : null}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Shell>
  );
}

/** Where Chargily sends the client back after paying. */
export function PaidPage() {
  const { lang, setLang, t } = useLang();
  const failed = new URLSearchParams(window.location.search).has("failed");
  return (
    <Shell lang={lang} setLang={setLang}>
      <div className="booking-card center">
        {failed ? (
          <ShieldX size={48} className="bad" />
        ) : (
          <CheckCircle2 size={48} className="ok" />
        )}
        <h1>
          {t(
            failed
              ? "The payment did not go through"
              : "Payment received, thank you!",
          )}
        </h1>
        <p>
          {t(
            failed
              ? "No money was taken. You can try again from the link."
              : "Your receipt is recorded by the academy.",
          )}
        </p>
      </div>
    </Shell>
  );
}
