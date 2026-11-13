import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Languages,
  LoaderCircle,
  User,
} from "lucide-react";
import { api } from "./types";
import { arabic } from "./i18n";
import { french } from "./french";

type Service = {
  id: number;
  name: string;
  kind: string;
  duration_min: number;
  description: string;
  staff: { id: number; name: string; title: string }[];
};
type Day = { day: string; slots: { time: string; staff: number[] }[] };
const locales: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ",
  en: "en-GB",
};

/** Public page: clients choose a service, a person and a free time. */
export default function BookingPage() {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem("luminol-language") || "fr";
    } catch {
      return "fr";
    }
  });
  const t = (s: string) =>
    lang === "ar" ? arabic[s] || s : lang === "fr" ? french[s] || s : s;
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("luminol-language", lang);
    } catch {}
  }, [lang]);
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [service, setService] = useState<Service | null>(null);
  const [staff, setStaff] = useState<number | 0 | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    note: "",
    website: "",
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    document.title = "Rendez-vous";
    api("/public/booking")
      .then((r) => {
        setInfo(r);
        document.title = `${r.academy} · ${t("Book an appointment")}`;
        if (r.services?.length === 1) setService(r.services[0]);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (service && service.staff.length === 1) setStaff(service.staff[0].id);
  }, [service]);
  useEffect(() => {
    if (!service || staff === null) return;
    setDays(null);
    setDay("");
    setTime("");
    api(
      `/public/booking/slots?service=${service.id}${staff ? `&staff=${staff}` : ""}`,
    )
      .then((r) => {
        setDays(r.days);
        setDay(r.days.find((d: Day) => d.slots.length)?.day || "");
      })
      .catch((e) => setError(e.message));
  }, [service, staff]);

  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locales[lang], { timeZone: "UTC", ...o }).format(
      new Date(d + "T12:00:00Z"),
    );
  const slots = useMemo(
    () => days?.find((d) => d.day === day)?.slots || [],
    [days, day],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service) return;
    setBusy(true);
    setError("");
    try {
      const r = await api("/public/booking", {
        ...form,
        service_id: service.id,
        staff_id: staff || undefined,
        day,
        time,
        consent,
        lang,
      });
      setDone(r);
    } catch (err: any) {
      setError(t(err.message));
      if (err.status === 409 && service) {
        // The time was taken meanwhile: reload the free times.
        const r = await api(
          `/public/booking/slots?service=${service.id}${staff ? `&staff=${staff}` : ""}`,
        );
        setDays(r.days);
        setTime("");
      }
    } finally {
      setBusy(false);
    }
  }

  const picker = (
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
  );

  return (
    <div className="booking-page">
      <header className="booking-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>{info?.academy || "Luminol Academy"}</span>
        </div>
        {picker}
      </header>
      <main className="booking-main">
        {!info && !error && <LoaderCircle className="spin" />}
        {info && !info.enabled && (
          <div className="booking-card center">
            <CalendarCheck size={40} />
            <h1>{t("Online booking is not open yet.")}</h1>
            <p>{t("Please contact the academy by phone or WhatsApp.")}</p>
          </div>
        )}
        {done && (
          <div className="booking-card center">
            <CheckCircle2 size={48} className="ok" />
            <h1>{t("Request sent!")}</h1>
            <p>
              {service?.name} ·{" "}
              {fmt(done.day, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}{" "}
              · {done.time}
              <br />
              {done.staff}
            </p>
            <p className="muted">
              {t("We will confirm your appointment by phone or WhatsApp.")}
            </p>
          </div>
        )}
        {info?.enabled && !done && (
          <>
            <h1>{t("Book an appointment")}</h1>
            {info.intro && <p className="booking-intro">{info.intro}</p>}

            <section className="booking-step">
              <h2>
                <span>1</span> {t("Choose a service")}
              </h2>
              <div className="booking-options">
                {info.services.map((s: Service) => (
                  <button
                    key={s.id}
                    className={service?.id === s.id ? "active" : ""}
                    onClick={() => {
                      setService(s);
                      setStaff(s.staff.length === 1 ? s.staff[0].id : null);
                    }}
                  >
                    <strong>{s.name}</strong>
                    <small>
                      <Clock size={13} /> {s.duration_min} min
                    </small>
                    {s.description && <span>{s.description}</span>}
                  </button>
                ))}
                {!info.services.length && (
                  <p>{t("No services are open for booking yet.")}</p>
                )}
              </div>
            </section>

            {service && service.staff.length > 1 && (
              <section className="booking-step">
                <h2>
                  <span>2</span> {t("With whom?")}
                </h2>
                <div className="booking-options">
                  <button
                    className={staff === 0 ? "active" : ""}
                    onClick={() => setStaff(0)}
                  >
                    <strong>{t("No preference")}</strong>
                    <small>{t("First available")}</small>
                  </button>
                  {service.staff.map((u) => (
                    <button
                      key={u.id}
                      className={staff === u.id ? "active" : ""}
                      onClick={() => setStaff(u.id)}
                    >
                      <strong>
                        <User size={14} /> {u.name}
                      </strong>
                      {u.title && <small>{u.title}</small>}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {service && staff !== null && (
              <section className="booking-step">
                <h2>
                  <span>{service.staff.length > 1 ? 3 : 2}</span>{" "}
                  {t("Choose a day and time")}
                </h2>
                {!days && <LoaderCircle className="spin" />}
                {days && !days.some((d) => d.slots.length) && (
                  <p>
                    {t(
                      "No free time in the next two weeks. Please call the academy.",
                    )}
                  </p>
                )}
                {days && days.some((d) => d.slots.length) && (
                  <>
                    <div className="booking-days">
                      {days.map((d) => (
                        <button
                          key={d.day}
                          disabled={!d.slots.length}
                          className={day === d.day ? "active" : ""}
                          onClick={() => {
                            setDay(d.day);
                            setTime("");
                          }}
                        >
                          <small>{fmt(d.day, { weekday: "short" })}</small>
                          <strong>{fmt(d.day, { day: "numeric" })}</strong>
                          <small>{fmt(d.day, { month: "short" })}</small>
                        </button>
                      ))}
                    </div>
                    <div className="booking-times">
                      {slots.map((s) => (
                        <button
                          key={s.time}
                          className={time === s.time ? "active" : ""}
                          onClick={() => setTime(s.time)}
                        >
                          {s.time}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {time && (
              <form className="booking-step booking-form" onSubmit={submit}>
                <h2>
                  <span>{service!.staff.length > 1 ? 4 : 3}</span>{" "}
                  {t("Your details")}
                </h2>
                <p className="booking-summary">
                  <CalendarCheck size={18} /> {service!.name} ·{" "}
                  {fmt(day, { weekday: "long", day: "numeric", month: "long" })}{" "}
                  · {time}
                </p>
                <label>
                  <span>{t("Full name")} *</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoComplete="name"
                    maxLength={100}
                  />
                </label>
                <label>
                  <span>{t("Phone")} (WhatsApp) *</span>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    autoComplete="tel"
                    placeholder="05 / 06 / 07 …"
                    maxLength={40}
                  />
                </label>
                <label>
                  <span>{t("Email")}</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    autoComplete="email"
                    maxLength={254}
                  />
                </label>
                <label>
                  <span>{t("Message (optional)")}</span>
                  <textarea
                    rows={3}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    maxLength={1000}
                  />
                </label>
                {/* Hidden from people; bots fill it in. */}
                <input
                  className="booking-trap"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) =>
                    setForm({ ...form, website: e.target.value })
                  }
                  aria-hidden="true"
                  name="website"
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    required
                  />
                  <span>
                    {t(
                      "I agree to be contacted by the academy about this appointment.",
                    )}
                  </span>
                </label>
                {error && <div className="form-error">{error}</div>}
                <div className="booking-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setTime("")}
                  >
                    <ArrowLeft size={16} /> {t("Back")}
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <CalendarCheck size={16} />
                    )}
                    {t("Send my request")}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {error && !time && <div className="form-error">{error}</div>}
      </main>
    </div>
  );
}
