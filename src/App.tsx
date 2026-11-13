import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  LayoutDashboard,
  Kanban,
  Users,
  GraduationCap,
  CalendarDays,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  Search,
  Plus,
  ChevronDown,
  LogOut,
  ListTodo,
  Bell,
  Menu,
  ArrowRight,
  Languages,
  X,
  Command,
  Check,
  ArrowUpRight,
  Eye,
  EyeOff,
  LoaderCircle,
  ClipboardCheck,
  CircleHelp,
  Moon,
  Sun,
} from "lucide-react";
import { api, ApiError, matchesPerson, type State, type Row } from "./types";
import { arabic, roleNames } from "./i18n";
import { french } from "./french";

const locales: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ",
  en: "en-GB",
};
/** Three interface languages: French, Arabic (right to left) and English. */
function LanguagePicker({
  lang,
  setLang,
}: {
  lang: string;
  setLang: (s: string) => void;
}) {
  return (
    <div
      className="language-picker"
      role="group"
      aria-label="Language / Langue / اللغة"
    >
      <Languages size={17} aria-hidden="true" />
      {[
        ["fr", "FR", "Français"],
        ["ar", "ع", "العربية"],
        ["en", "EN", "English"],
      ].map(([code, short, name]) => (
        <button
          key={code}
          className={lang === code ? "active" : ""}
          aria-pressed={lang === code}
          title={name}
          lang={code}
          onClick={() => setLang(code)}
        >
          {short}
        </button>
      ))}
    </div>
  );
}
import { AppContext, type ModalData } from "./context";
import { Avatar, Button, Dialog, Badge, Empty, TaskRows } from "./ui";
import {
  Overview,
  Admissions,
  Students,
  Programs,
  Calendar,
  Payments,
  Reports,
  SettingsPage,
  Tasks,
} from "./pages";
import Forms from "./forms";
import { AttendancePage } from "./academy";
import Profile from "./profile";

const nav = [
  ["Overview", LayoutDashboard],
  ["Admissions", Kanban],
  ["Students", Users],
  ["Calendar", CalendarDays],
  ["Attendance", ClipboardCheck],
  ["Programs & Cohorts", GraduationCap],
  ["Payments", Wallet],
  ["Reports", ChartNoAxesCombined],
] as const;
/** Plain names shown in the menu; page keys stay stable. */
const navLabels: Record<string, string> = {
  Attendance: "Attendance",
  Admissions: "Requests",
  Students: "Clients & students",
  "Programs & Cohorts": "Programs & groups",
};
export default function App() {
  const [data, setData] = useState<State | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem("luminol-language") || "fr";
    } catch {
      return "fr";
    }
  });
  const t = (s: string) =>
    lang === "ar" ? arabic[s] || s : lang === "fr" ? french[s] || s : s;
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("luminol-theme") || "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("luminol-theme", theme);
    } catch {}
  }, [theme]);
  const [page, setPage] = useState("Overview"),
    [pageFilter, setPageFilter] = useState("");
  const [modal, setModal] = useState<ModalData | null>(null),
    [contactId, setContactId] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [showSearch, setShowSearch] = useState(false),
    [quick, setQuick] = useState(false),
    [mobile, setMobile] = useState(false),
    [panel, setPanel] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    undo?: () => void;
    id: number;
  } | null>(null);
  const toast = (text: string, undo?: () => void) =>
    setNotice({ text, undo, id: Date.now() });
  async function refresh() {
    try {
      const result = await api("/state");
      setData(result);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else throw e;
    }
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("luminol-language", lang);
  }, [lang]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(
        () => setNotice(null),
        notice.undo ? 10000 : 5000,
      );
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  async function perform(path: string, body: unknown, method = "POST") {
    const result = await api(path, body, method);
    await refresh();
    return result;
  }
  function go(name: string, filter = "") {
    setPage(name);
    setPageFilter(filter);
    setMobile(false);
    setPanel("");
  }
  const open = (m: ModalData) => {
    setModal(m);
    setQuick(false);
  };
  const missing: Row = { id: 0, name: "—" };
  const person = (id: number) =>
      data?.contacts.find((c) => c.id === id) || missing,
    program = (id: number) =>
      data?.programs.find((p) => p.id === id) || missing,
    cohort = (id: number) => data?.cohorts.find((c) => c.id === id) || missing,
    user = (id: number) => data?.users.find((u) => u.id === id) || missing;
  const money = (n: number, currency?: string) =>
    new Intl.NumberFormat(locales[lang] || "en-DZ", {
      style: "currency",
      currency: currency || data?.settings.currency || "DZD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(n / 100);
  const date = (
    s: string,
    opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  ) =>
    new Intl.DateTimeFormat(locales[lang] || "en-GB", {
      timeZone: data?.settings.timezone || "Africa/Algiers",
      ...opts,
    }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s));
  const time = (s: string) =>
    date(s, { hour: "2-digit", minute: "2-digit", hour12: false });
  const [period, setPeriod] = useState("month");
  const [isMobile, setIsMobile] = useState(
    window.matchMedia("(max-width:1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width:1024px)");
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const results = useMemo<(Row & { kind: string })[]>(
    () =>
      data && search.trim()
        ? [
            ...data.contacts
              .filter((c) => matchesPerson(c, search))
              .map((c) => ({ ...c, kind: "Contact" })),
            ...data.programs
              .filter(
                (c) =>
                  c.name.toLowerCase().includes(search.toLowerCase()) ||
                  t(c.name).includes(search),
              )
              .map((c) => ({ ...c, kind: "Program" })),
            ...data.cohorts
              .filter((c) =>
                c.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((c) => ({ ...c, kind: "Cohort" })),
          ].slice(0, 12)
        : [],
    [data, search, lang],
  );
  if (loading)
    return (
      <div className="loading-screen">
        <img src="/favicon.svg" width="48" />
        <LoaderCircle className="spin" />
        <p>{t("Loading workspace…")}</p>
      </div>
    );
  if (!data)
    return (
      <Login
        lang={lang}
        setLang={setLang}
        t={t}
        onLogin={refresh}
        error={error}
      />
    );
  const context = {
    data,
    t,
    lang,
    setLang,
    page,
    go,
    pageFilter,
    open,
    profile: (id: number) => setContactId(id),
    toast,
    refresh,
    perform,
    money,
    date,
    time,
    person,
    program,
    cohort,
    user,
  };
  const taskCount = data.tasks.filter((t) => t.status === "Open").length;
  const visibleNav = nav.filter(
    ([name]) =>
      !(name === "Admissions" && !data.permissions.admissions) &&
      !(name === "Payments" && !data.permissions.finance) &&
      !(name === "Attendance" && !data.permissions.attendance),
  );
  const title = navLabels[page] || page;
  const views: Record<string, ReactNode> = {
    Overview: <Overview period={period} setPeriod={setPeriod} />,
    Admissions: <Admissions />,
    Students: <Students />,
    "Programs & Cohorts": <Programs />,
    Calendar: <Calendar />,
    Payments: <Payments />,
    Reports: <Reports period={period} setPeriod={setPeriod} />,
    Settings: <SettingsPage />,
    "My tasks": <Tasks />,
    Attendance: <AttendancePage />,
  };
  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          {t("Overview")}
        </a>
        {mobile && (
          <div className="mobile-scrim" onClick={() => setMobile(false)} />
        )}
        <aside
          inert={(isMobile && !mobile) || !!modal || !!contactId || showSearch}
          className={`sidebar ${mobile ? "is-open" : ""}`}
        >
          <button
            className="brand"
            onClick={() => go("Overview")}
            aria-label="Luminol Academy"
          >
            <img src="/favicon.svg" alt="" />
            <span>
              luminol<span>ACADEMY</span>
            </span>
          </button>
          <button
            className="icon-button sidebar-close"
            aria-label={t("Close")}
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
          <div className="sidebar-scroll">
            <div className="nav-label">{data.settings.academy}</div>
            <nav aria-label={t("Workspace")}>
              {visibleNav.map(([name, Icon]) => (
                <button
                  key={name}
                  className={`nav-item ${page === name ? "active" : ""}`}
                  aria-current={page === name ? "page" : undefined}
                  onClick={() => go(name)}
                >
                  <Icon size={20} />
                  <span>{t(navLabels[name] || name)}</span>
                  {name === "Admissions" &&
                    data.opportunities.filter((o) => o.stage === "New inquiry")
                      .length +
                      (data.incoming || []).length >
                      0 && (
                      <span className="nav-count">
                        {data.opportunities.filter(
                          (o) => o.stage === "New inquiry",
                        ).length + (data.incoming || []).length}
                      </span>
                    )}
                </button>
              ))}
            </nav>
            <div className="nav-divider" />
            <button
              className={`nav-item ${page === "My tasks" ? "active" : ""}`}
              onClick={() => go("My tasks")}
            >
              <ListTodo size={20} />
              <span>{t("My tasks")}</span>
              <span className="nav-count neutral">{taskCount}</span>
            </button>
            <button
              className={`nav-item ${page === "Settings" ? "active" : ""}`}
              aria-current={page === "Settings" ? "page" : undefined}
              onClick={() => go("Settings")}
            >
              <Settings size={20} />
              <span>{t("Settings")}</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            <div className="user-block">
              <button
                className="user-link"
                onClick={() => go("Settings", "My account")}
                title={t("My account")}
              >
                <Avatar name={data.user.name} />
                <div>
                  <strong>{data.user.name}</strong>
                  <small>{t(roleNames[data.user.role])}</small>
                </div>
              </button>
              <button
                className="icon-button"
                title={t("Sign out")}
                aria-label={t("Sign out")}
                onClick={async () => {
                  await api("/logout", {});
                  setData(null);
                  setPage("Overview");
                  setContactId(null);
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <div
          className="main-shell"
          inert={!!modal || !!contactId || showSearch || (isMobile && mobile)}
        >
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label={t("Menu")}
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumbs">
              <span>{t("Workspace")}</span>
              <span>/</span>
              <strong>{t(title)}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="search-trigger"
                aria-label={t("Search")}
                onClick={() => setShowSearch(true)}
              >
                <Search size={17} />
                <span>{t("Search anything…")}</span>
                <kbd>
                  <Command size={10} /> K
                </kbd>
              </button>
              <button
                className="icon-button"
                aria-label={t("How this page works")}
                title={t("How this page works")}
                onClick={() => open({ type: "help", extra: page })}
              >
                <CircleHelp size={20} />
              </button>
              <button
                className="icon-button"
                aria-label={t(theme === "dark" ? "Light theme" : "Dark theme")}
                title={t(theme === "dark" ? "Light theme" : "Dark theme")}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <LanguagePicker lang={lang} setLang={setLang} />
              <div className="popover-anchor">
                <button
                  className="icon-button notification-button"
                  aria-label={t("Notifications")}
                  onClick={() =>
                    setPanel(panel === "notifications" ? "" : "notifications")
                  }
                >
                  <Bell size={19} />
                  {data.flags.length + taskCount > 0 && <i />}
                </button>
                {panel === "notifications" && (
                  <div className="popover notifications">
                    <h3>{t("Notifications")}</h3>
                    {data.flags.slice(0, 3).map((f) => (
                      <button
                        key={`${f.contact_id}${f.kind}`}
                        onClick={() => {
                          setContactId(f.contact_id);
                          setPanel("");
                        }}
                      >
                        <Avatar name={person(f.contact_id).name} />
                        <span>
                          <strong>{person(f.contact_id).name}</strong>
                          <small>
                            {f.kind === "attendance"
                              ? t("Student attention")
                              : t("Overdue")}
                          </small>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                    {data.tasks
                      .filter((t) => t.status === "Open")
                      .slice(0, 3)
                      .map((task) => (
                        <button key={task.id} onClick={() => go("My tasks")}>
                          <ListTodo size={20} />
                          <span>
                            <strong>{t(task.title)}</strong>
                            <small>{date(task.due_at)}</small>
                          </span>
                        </button>
                      ))}
                    {!taskCount && !data.flags.length && (
                      <p>{t("No notifications")}</p>
                    )}
                    <Button variant="ghost full" onClick={() => go("My tasks")}>
                      {t("My tasks")}
                    </Button>
                  </div>
                )}
              </div>
              <span className="topbar-divider" />
              <Avatar name={data.user.name} size="small" />
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {views[page] || views.Overview}
            <footer className="app-footer">
              <span>
                Luminol Academy <span>·</span>{" "}
                {t("Psychology. Languages. Training.")}
              </span>
              <span>
                <span className="saved-dot" />
                {t(
                  data.hosted
                    ? "Changes are saved securely in the cloud."
                    : "All changes are saved locally.",
                )}
              </span>
            </footer>
          </main>
        </div>
        <div
          className="quick-create"
          inert={!!modal || !!contactId || showSearch || (isMobile && mobile)}
        >
          <button
            className="quick-button"
            onClick={() => setQuick(!quick)}
            aria-label={t("Quick create")}
            aria-expanded={quick}
          >
            {quick ? <X size={20} /> : <Plus size={20} />}
            <span>{t("Quick create")}</span>
          </button>
          {quick && (
            <div className="quick-menu">
              {data.permissions.editAdmissions && (
                <button onClick={() => open({ type: "inquiry" })}>
                  <Kanban size={17} />
                  {t("New client request")}
                </button>
              )}
              {["admin", "admissions", "academic"].includes(data.user.role) && (
                <button onClick={() => open({ type: "client" })}>
                  <Users size={17} />
                  {t("Add client")}
                </button>
              )}
              {["admin", "admissions", "academic", "instructor"].includes(
                data.user.role,
              ) && (
                <button onClick={() => open({ type: "appointment" })}>
                  <CalendarDays size={17} />
                  {t("Add to calendar")}
                </button>
              )}
              {data.permissions.write && (
                <button onClick={() => open({ type: "task" })}>
                  <ListTodo size={17} />
                  {t("New task")}
                </button>
              )}
              {data.permissions.editFinance && (
                <button onClick={() => open({ type: "payment" })}>
                  <Wallet size={17} />
                  {t("Record payment")}
                </button>
              )}
            </div>
          )}
        </div>
        {contactId && (
          <div inert={!!modal || showSearch}>
            <Profile
              key={contactId}
              id={contactId}
              onClose={() => setContactId(null)}
            />
          </div>
        )}
        {modal && (
          <Forms
            key={modal.type + String(modal.record?.id || 0)}
            modal={modal}
            onClose={() => setModal(null)}
          />
        )}
        {showSearch && (
          <Dialog
            title={t("Search")}
            onClose={() => {
              setShowSearch(false);
              setSearch("");
            }}
          >
            <div className="search-dialog">
              <div className="search-field">
                <Search size={20} />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Try a name, program, or cohort.")}
                  aria-label={t("Search")}
                />
              </div>
              <div className="search-results">
                {results.map((r) => (
                  <button
                    key={`${r.kind}${r.id}`}
                    onClick={() => {
                      if (r.kind === "Contact") setContactId(r.id);
                      else go("Programs & Cohorts", String(r.id));
                      setShowSearch(false);
                      setSearch("");
                    }}
                  >
                    <Avatar name={r.name} />
                    <span>
                      <strong>{t(r.name)}</strong>
                      <small>
                        {t(r.kind)}
                        {r.email ? ` · ${r.email}` : ""}
                      </small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
                {!results.length && (
                  <Empty
                    title={search ? "No results" : "Search"}
                    text="Try a name, program, or cohort."
                  />
                )}
              </div>
            </div>
          </Dialog>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={18} />
            <span>{notice.text}</span>
            {notice.undo && (
              <button
                onClick={() => {
                  notice.undo?.();
                  setNotice(null);
                }}
              >
                {t("Undo")}
              </button>
            )}
            <button aria-label={t("Close")} onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}

function Login({
  lang,
  setLang,
  t,
  onLogin,
  error: outerError,
}: {
  lang: string;
  setLang: (s: string) => void;
  t: (s: string) => string;
  onLogin: () => Promise<void>;
  error: string;
}) {
  const [email, setEmail] = useState(
      localStorage.getItem("luminol-email") || "",
    ),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(outerError),
    [code, setCode] = useState(""),
    [needCode, setNeedCode] = useState(false),
    [forgot, setForgot] = useState(false),
    [notice, setNotice] = useState("");
  async function sendReset() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/password/forgot", { email });
      setNotice(t(r.message));
    } catch (e: any) {
      setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    if (forgot) return sendReset();
    setBusy(true);
    setError("");
    try {
      await api("/login", { email, password, ...(needCode ? { code } : {}) });
      try {
        localStorage.setItem("luminol-email", email.trim());
      } catch {}
      await onLogin();
    } catch (e: any) {
      if (e instanceof ApiError && e.details?.need_code) {
        if (needCode) setError(t(e.message));
        setNeedCode(true);
      } else setError(t(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>
            luminol<span>ACADEMY</span>
          </span>
        </div>
        <div className="login-message">
          <span className="eyebrow">LUMINOL ACADEMY</span>
          <h1>{t("A brighter way to run your academy.")}</h1>
          <p>{t("Psychology. Languages. Training.")}</p>
          <div className="orbital-art" aria-hidden="true">
            <div className="orbital-ring one" />
            <div className="orbital-ring two" />
            <div className="orbital-ring three" />
            <span className="orbital-core">✳</span>
            <span className="orbital-label label-a">
              <Users size={17} /> {t("Students")}
            </span>
            <span className="orbital-label label-b">
              <GraduationCap size={17} /> {t("Programs")}
            </span>
          </div>
        </div>
        <div className="login-caption">A LUMINOL WORKSPACE</div>
      </div>
      <div className="login-side">
        <div className="login-language">
          <LanguagePicker lang={lang} setLang={setLang} />
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <h2>{t("Welcome to Luminol.")}</h2>
          <p>{t("Sign in to workspace")}</p>
          <label>
            {t("Email")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          {forgot && (
            <p className="form-hint">
              {t(
                "Enter your e-mail. We will send you a link to choose a new password.",
              )}
            </p>
          )}
          {notice && <div className="info-box">{notice}</div>}
          {!forgot && (
            <label>
              {t("Password")}
              <span className="password-input">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShow(!show)}
                  aria-label={t(show ? "Hide password" : "Show password")}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          )}
          {needCode && !forgot && (
            <label>
              {t("6-digit code from your authenticator app")}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                autoFocus
                required
              />
            </label>
          )}
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={busy}
            variant="primary full"
            icon={
              busy ? <LoaderCircle className="spin" size={18} /> : undefined
            }
          >
            {t(forgot ? "Send the link" : "Sign in")}
            <ArrowRight size={17} />
          </Button>
          <button
            type="button"
            className="text-button login-forgot"
            onClick={() => {
              setForgot(!forgot);
              setError("");
              setNotice("");
            }}
          >
            {t(forgot ? "Back to sign in" : "Forgot your password?")}
          </button>
        </form>
      </div>
    </div>
  );
}
