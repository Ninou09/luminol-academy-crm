import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  X,
  Inbox,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "./context";
import { initials, type Row } from "./types";
export function Button({
  children,
  icon,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: string;
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  );
}
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  return (
    <span
      className={`avatar ${size} color-${name.charCodeAt(0) % 5}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title = "No matching records",
  text = "Try adjusting your filters.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  const { t } = useApp();
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={23} />
      </span>
      <strong>{t(title)}</strong>
      <p>{t(text)}</p>
      {action}
    </div>
  );
}
export function PageHead({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const { t } = useApp();
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">LUMINOL ACADEMY</div>
        <h1>{t(title)}</h1>
        <p>{t(subtitle)}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useApp();
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{t(title)}</h2>
          {subtitle && <p>{t(subtitle)}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: string[];
  value: string;
  onChange: (x: string) => void;
}) {
  const { t } = useApp();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab, i) => (
        <button
          role="tab"
          aria-selected={value === tab}
          tabIndex={value === tab ? 0 : -1}
          key={tab}
          onClick={() => onChange(tab)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              const n =
                (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
              onChange(tabs[n]);
              (
                e.currentTarget.parentElement?.children[n] as HTMLElement
              )?.focus();
            }
          }}
          className={value === tab ? "active" : ""}
        >
          {t(tab)}
        </button>
      ))}
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  drawer = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>(
        'input,button,select,textarea,[tabindex="0"]',
      )
      ?.focus();
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[data-dialog]");
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea,[tabindex="0"]',
          ) || [],
        ).filter((x) => x.offsetParent !== null);
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (!document.querySelector("[data-dialog]"))
        document.body.style.overflow = "";
      if (previous?.isConnected) previous.focus();
      else
        document
          .querySelectorAll<HTMLElement>("[data-dialog] button")[0]
          ?.focus();
    };
  }, []);
  const { t } = useApp();
  return (
    <div
      className={`overlay ${drawer ? "drawer-overlay" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        data-dialog
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${drawer ? "drawer" : "dialog"} ${wide ? "wide" : ""}`}
      >
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Close")}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export type Column = {
  key: string;
  label: string;
  render?: (r: Row) => ReactNode;
  sort?: (r: Row) => string | number;
};
export function DataTable({
  rows,
  columns,
  onRow,
  pageSize = 10,
}: {
  rows: Row[];
  columns: Column[];
  onRow?: (r: Row) => void;
  pageSize?: number;
}) {
  const { t } = useApp();
  const [sort, setSort] = useState("");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [rows.length]);
  const col = columns.find((c) => c.key === sort);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const av = col?.sort ? col.sort(a) : (a[sort] ?? ""),
          bv = col?.sort ? col.sort(b) : (b[sort] ?? "");
        return (
          (typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv))) * (asc ? 1 : -1)
        );
      })
    : rows;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    current = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sort === c.key ? (asc ? "ascending" : "descending") : "none"
                  }
                >
                  {c.label ? (
                    <button
                      onClick={() => {
                        if (sort === c.key) setAsc(!asc);
                        else {
                          setSort(c.key);
                          setAsc(true);
                        }
                      }}
                    >
                      {t(c.label)}
                      {sort === c.key ? (
                        asc ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )
                      ) : null}
                    </button>
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((r) => (
                <tr
                  key={r.id}
                  className={onRow ? "clickable" : ""}
                  onClick={() => onRow?.(r)}
                >
                  {columns.map((c, i) => (
                    <td key={c.key}>
                      {onRow && i === 0 ? (
                        <button
                          className="cell-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRow(r);
                          }}
                        >
                          {c.render ? c.render(r) : r[c.key]}
                        </button>
                      ) : c.render ? (
                        c.render(r)
                      ) : (
                        r[c.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty />}
      <div className="table-footer">
        <span>
          {rows.length ? current * pageSize + 1 : 0}–
          {Math.min((current + 1) * pageSize, rows.length)} {t("of")}{" "}
          {rows.length} {t("Results").toLowerCase()}
        </span>
        <div className="pagination">
          <button
            disabled={current === 0}
            aria-label={t("Previous")}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current >= pages - 1}
            aria-label={t("Next")}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
export function TaskRows({
  tasks,
  limit = 100,
}: {
  tasks: Row[];
  limit?: number;
}) {
  const { data, t, person, profile, perform, toast, date, time, go } = useApp();
  async function done(task: Row) {
    try {
      if (task.status === "Done") {
        await perform(
          `/tasks/${task.id}`,
          { status: "Open", version: task.version },
          "PATCH",
        );
        toast(t("Task reopened"));
        return;
      }
      await perform(
        `/tasks/${task.id}`,
        { status: "Done", version: task.version },
        "PATCH",
      );
      toast(t("Task completed"), () => {
        perform(
          `/tasks/${task.id}`,
          { status: "Open", version: task.version + 1 },
          "PATCH",
        )
          .then(() => toast(t("Task reopened")))
          .catch((e) => toast(e.message));
      });
    } catch (e: any) {
      toast(e.message);
    }
  }
  return (
    <div className="task-list">
      {tasks.slice(0, limit).map((task) => (
        <div className="task-row" key={task.id}>
          <button
            disabled={
              !data.permissions.write ||
              (data.user.role !== "admin" && task.owner_id !== data.user.id)
            }
            className={`task-check ${task.status === "Done" ? "checked" : ""}`}
            aria-label={`${t("Complete")}: ${t(task.title)}`}
            onClick={() => done(task)}
          >
            {task.status === "Done" && <Check size={14} />}
          </button>
          <div className="task-content">
            <strong>{t(task.title)}</strong>
            <div>
              {task.intake_id && (
                <button
                  className="subtle-link"
                  onClick={() => go("Admissions")}
                >
                  {t("Review inquiry")}
                </button>
              )}
              {task.contact_id && (
                <button
                  className="subtle-link"
                  onClick={() => profile(task.contact_id)}
                >
                  {person(task.contact_id).name}
                </button>
              )}
              <span>
                {date(task.due_at)} · {time(task.due_at)}
              </span>
            </div>
          </div>
          <Badge
            tone={task.due_at < new Date().toISOString() ? "amber" : "neutral"}
          >
            {t(
              task.due_at < new Date().toISOString()
                ? "Overdue"
                : task.priority === "High"
                  ? "High"
                  : "Upcoming",
            )}
          </Badge>
        </div>
      ))}
      {!tasks.length && (
        <Empty title="All caught up" text="No tasks match this view." />
      )}
    </div>
  );
}
