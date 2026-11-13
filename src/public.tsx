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
