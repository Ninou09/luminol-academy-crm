// Financial analytics: every movement of money in one place.
// Money in  = client payments (minus refunds) + other income typed by hand.
// Money out = expenses typed by hand (salaries, rent, materials, advertising…).
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { useApp } from "./context";
import { localDate, type Row } from "./types";
import { Badge, Button, DataTable, Panel } from "./ui";

// Validated pair (light and dark): teal = money in, amber = money out.
const IN = "#00897a";
const OUT = "#c26f00";

type Movement = {
  id: number;
  day: string;
  direction: "in" | "out";
  category: string;
  party: string;
  label: string;
  method: string;
  amount: number;
  currency: string;
  expenseId?: number;
};

const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.parse(month + "-15T12:00:00Z"));
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

export function FinanceDashboard() {
  const {
    data,
    t,
    money,
    date,
    open,
    perform,
    toast,
    person,
    program,
    cohort,
  } = useApp();
  const zone = data.settings.timezone;
  const currency = data.settings.currency;
  const [scope, setScope] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [year, setYear] = useState(data.today.slice(0, 4));
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  // Every movement, newest first, in the academy currency.
  const movements = useMemo<Movement[]>(() => {
    const list: Movement[] = [];
    const sourceOf = (charge: Row | undefined) => {
      if (!charge) return t("Client payments");
      const enr = data.enrollments.find((e) => e.id === charge.enrollment_id);
      const prog = enr ? program(cohort(enr.cohort_id).program_id) : null;
      return prog?.category ? t(prog.category) : t("Client payments");
    };
    for (const p of data.payments) {
      if (p.currency !== currency) continue;
      const charge = data.charges.find((c) => c.id === p.charge_id);
      list.push({
        id: p.id,
        day: localDate(new Date(p.created_at), zone),
        direction: "in",
        category: sourceOf(charge),
        party: charge ? person(charge.contact_id).name : "",
        label: charge?.label || "",
        method: t(p.method),
        amount: p.amount,
        currency: p.currency,
      });
    }
    for (const r of data.refunds) {
      const p = data.payments.find((x) => x.id === r.payment_id);
      if (!p || p.currency !== currency) continue;
      const charge = data.charges.find((c) => c.id === p.charge_id);
      list.push({
        id: 1e9 + r.id,
        day: localDate(new Date(r.created_at), zone),
        direction: "out",
        category: t("Refunds"),
        party: charge ? person(charge.contact_id).name : "",
        label: r.reason,
        method: t(p.method),
        amount: r.amount,
        currency: p.currency,
      });
    }
    for (const x of data.expenses || []) {
      if (x.currency !== currency) continue;
      list.push({
        id: 2e9 + x.id,
        day: x.spent_on,
        direction: x.direction === "in" ? "in" : "out",
        category: t(x.category),
        party: x.party || "",
        label: x.label || "",
        method: x.method ? t(x.method) : "",
        amount: x.amount,
        currency: x.currency,
        expenseId: x.id,
      });
    }
    return list.sort((a, b) => b.day.localeCompare(a.day));
  }, [data, currency, zone]);

  const prefix = scope === "month" ? month : year;
  const previous =
    scope === "month" ? shiftMonth(month, -1) : String(Number(year) - 1);
  const inPeriod = (m: Movement, p: string) => m.day.startsWith(p);
  const sum = (p: string, dir: "in" | "out") =>
    movements
      .filter((m) => inPeriod(m, p) && m.direction === dir)
      .reduce((s, m) => s + m.amount, 0);
  const moneyIn = sum(prefix, "in");
  const moneyOut = sum(prefix, "out");
  const result = moneyIn - moneyOut;
  const lastResult = sum(previous, "in") - sum(previous, "out");
  const owed = data.charges
    .filter((c) => c.currency === currency)
    .reduce((s, c) => s + Math.max(0, c.balance), 0);

  // 12 months ending with the chosen month (or the chosen year).
  const months = Array.from({ length: 12 }, (_, i) =>
    scope === "month"
      ? shiftMonth(month, i - 11)
      : `${year}-${String(i + 1).padStart(2, "0")}`,
  );
  const series = months.map((m) => ({
    month: m,
    in: sum(m, "in"),
    out: sum(m, "out"),
  }));
  const peak = Math.max(1, ...series.flatMap((s) => [s.in, s.out]));
  const monthName = (m: string, style: "short" | "long" = "short") =>
    new Intl.DateTimeFormat(undefined, {
      month: style,
      ...(style === "long" ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(m + "-15T12:00:00Z"));

  const breakdown = (dir: "in" | "out") => {
    const totals = new Map<string, number>();
    for (const m of movements)
      if (inPeriod(m, prefix) && m.direction === dir)
        totals.set(m.category, (totals.get(m.category) || 0) + m.amount);
    const total = Array.from(totals.values()).reduce((s, v) => s + v, 0);
    return Array.from(totals, ([name, value]) => ({
      name,
      value,
      share: total ? value / total : 0,
    })).sort((a, b) => b.value - a.value);
  };

  const rows = movements.filter(
    (m) =>
      inPeriod(m, prefix) &&
      (filter === "all" || m.direction === filter) &&
      (!query ||
        `${m.category} ${m.party} ${m.label} ${m.method}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );

  function exportCsv() {
    const head = [
      "Date",
      "Type",
      "Category",
      "Who",
      "Description",
      "Method",
      "Amount",
    ];
    const lines = rows.map((m) =>
      [
        m.day,
        m.direction === "in" ? t("Money in") : t("Money out"),
        m.category,
        m.party,
        m.label,
        m.method,
        ((m.direction === "in" ? 1 : -1) * m.amount) / 100,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob(
      ["﻿" + [head.map(t).join(","), ...lines].join("\n")],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `finances-${prefix}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const delta = result - lastResult;
  const chartHeight = 180;
  return (
    <div className="finance-page">
      <div className="finance-toolbar">
        <div className="segmented" role="group" aria-label={t("Period")}>
          <button
            className={scope === "month" ? "active" : ""}
            onClick={() => setScope("month")}
          >
            {t("Month")}
          </button>
          <button
            className={scope === "year" ? "active" : ""}
            onClick={() => setScope("year")}
          >
            {t("Year")}
          </button>
        </div>
        {scope === "month" ? (
          <input
            type="month"
            className="date-input"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label={t("Month")}
          />
        ) : (
          <select
            className="date-input"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label={t("Year")}
          >
            {Array.from({ length: 5 }, (_, i) =>
              String(Number(data.today.slice(0, 4)) - i),
            ).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        )}
        <div className="row-actions finance-add">
          <Button
            icon={<ArrowDownLeft size={15} />}
            onClick={() =>
              open({ type: "expense", record: { id: 0, direction: "in" } })
            }
          >
            {t("Money in")}
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() =>
              open({ type: "expense", record: { id: 0, direction: "out" } })
            }
          >
            {t("Add an expense")}
          </Button>
        </div>
      </div>

      <div className="finance-kpis">
        <div className="finance-kpi">
          <span>
            <ArrowDownLeft size={16} style={{ color: IN }} /> {t("Money in")}
          </span>
          <strong>{money(moneyIn, currency)}</strong>
          <small>{t("Client payments and other income")}</small>
        </div>
        <div className="finance-kpi">
          <span>
            <ArrowUpRight size={16} style={{ color: OUT }} /> {t("Money out")}
          </span>
          <strong>{money(moneyOut, currency)}</strong>
          <small>{t("Salaries, rent, materials, refunds…")}</small>
        </div>
        <div className={`finance-kpi ${result < 0 ? "is-loss" : "is-gain"}`}>
          <span>{result < 0 ? t("Loss") : t("Profit")}</span>
          <strong>{money(result, currency)}</strong>
          <small>
            {moneyIn
              ? `${t("Margin")} ${Math.round((result / moneyIn) * 100)} %`
              : t("No money in yet")}
            {" · "}
            {delta >= 0 ? "▲" : "▼"} {money(Math.abs(delta), currency)}{" "}
            {t(scope === "month" ? "vs last month" : "vs last year")}
          </small>
        </div>
        <div className="finance-kpi">
          <span>
            <Wallet size={16} /> {t("Still to collect")}
          </span>
          <strong>{money(owed, currency)}</strong>
          <small>{t("Unpaid balances of clients (all periods)")}</small>
        </div>
      </div>

      <Panel
        title="Money in and out, month by month"
        subtitle={
          scope === "month"
            ? "The last 12 months. Hover a month to see the figures."
            : "Every month of the year. Hover a month to see the figures."
        }
      >
        <div className="finance-legend" aria-hidden="true">
          <span>
            <i style={{ background: IN }} /> {t("Money in")}
          </span>
          <span>
            <i style={{ background: OUT }} /> {t("Money out")}
          </span>
        </div>
        <div
          className="finance-chart"
          role="img"
          aria-label={t("Money in and out, month by month")}
        >
          <svg
            viewBox={`0 0 ${months.length * 60} ${chartHeight + 34}`}
            preserveAspectRatio="none"
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1="0"
                x2={months.length * 60}
                y1={chartHeight - chartHeight * f}
                y2={chartHeight - chartHeight * f}
                className="finance-grid"
              />
            ))}
            {series.map((s, i) => {
              const hIn = (s.in / peak) * chartHeight;
              const hOut = (s.out / peak) * chartHeight;
              const x = i * 60 + 12;
              const active = hover === s.month;
              return (
                <g
                  key={s.month}
                  onMouseEnter={() => setHover(s.month)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    setScope("month");
                    setMonth(s.month);
                  }}
                  className={`finance-bar ${s.month === prefix ? "is-current" : ""}`}
                >
                  <rect
                    x={i * 60}
                    y="0"
                    width="60"
                    height={chartHeight + 34}
                    fill="transparent"
                  />
                  {active && (
                    <rect
                      x={i * 60 + 2}
                      y="0"
                      width="56"
                      height={chartHeight}
                      className="finance-hover"
                    />
                  )}
                  <path d={bar(x, chartHeight, 16, hIn)} fill={IN} />
                  <path d={bar(x + 18, chartHeight, 16, hOut)} fill={OUT} />
                  <text
                    x={i * 60 + 30}
                    y={chartHeight + 22}
                    textAnchor="middle"
                    className="finance-axis"
                  >
                    {monthName(s.month)}
                  </text>
                </g>
              );
            })}
            <line
              x1="0"
              x2={months.length * 60}
              y1={chartHeight}
              y2={chartHeight}
              className="finance-base"
            />
          </svg>
          {hover &&
            (() => {
              const s = series.find((x) => x.month === hover)!;
              const index = months.indexOf(hover);
              return (
                <div
                  className="finance-tooltip"
                  style={{
                    left: `${((index + 0.5) / months.length) * 100}%`,
                  }}
                >
                  <strong>{monthName(hover, "long")}</strong>
                  <span>
                    <i style={{ background: IN }} /> {t("Money in")}{" "}
                    <b>{money(s.in, currency)}</b>
                  </span>
                  <span>
                    <i style={{ background: OUT }} /> {t("Money out")}{" "}
                    <b>{money(s.out, currency)}</b>
                  </span>
                  <span>
                    {t("Result")} <b>{money(s.in - s.out, currency)}</b>
                  </span>
                </div>
              );
            })()}
        </div>
      </Panel>

      <div className="finance-split">
        <Breakdown
          title="Where the money comes from"
          items={breakdown("in")}
          color={IN}
          empty="No money in for this period."
        />
        <Breakdown
          title="Where the money goes"
          items={breakdown("out")}
          color={OUT}
          empty="No expenses for this period."
        />
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t("All money movements")}</h2>
            <p>
              {scope === "month" ? monthName(month, "long") : year} ·{" "}
              {rows.length} {t("movements")}
            </p>
          </div>
          <div className="row-actions">
            <select
              className="date-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              aria-label={t("Type")}
            >
              <option value="all">{t("All")}</option>
              <option value="in">{t("Money in")}</option>
              <option value="out">{t("Money out")}</option>
            </select>
            <input
              className="date-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search…")}
              aria-label={t("Search…")}
            />
            <Button icon={<Download size={15} />} onClick={exportCsv}>
              {t("Export (Excel)")}
            </Button>
          </div>
        </div>
        <DataTable
          rows={rows}
          columns={[
            { key: "day", label: "Date", render: (m) => date(m.day) },
            {
              key: "direction",
              label: "Type",
              render: (m) =>
                m.direction === "in" ? (
                  <Badge tone="teal">{t("Money in")}</Badge>
                ) : (
                  <Badge tone="amber">{t("Money out")}</Badge>
                ),
            },
            { key: "category", label: "Category" },
            { key: "party", label: "Who" },
            { key: "label", label: "Description" },
            { key: "method", label: "Payment method" },
            {
              key: "amount",
              label: "Amount",
              render: (m) => (
                <strong
                  className={m.direction === "in" ? "teal-text" : "amber-text"}
                >
                  {m.direction === "in" ? "+" : "−"}
                  {money(m.amount, m.currency)}
                </strong>
              ),
            },
            {
              key: "del",
              label: "",
              render: (m) =>
                m.expenseId ? (
                  <button
                    className="icon-button danger"
                    aria-label={t("Delete")}
                    onClick={async () => {
                      if (!window.confirm(t("Delete this movement?"))) return;
                      await perform(
                        `/expenses/${m.expenseId}`,
                        {},
                        "DELETE",
                      ).catch((e: any) => toast(e.message));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null,
            },
          ]}
        />
      </div>
    </div>
  );
}

/** A bar with 4px rounded top corners, anchored to the baseline. */
function bar(x: number, base: number, width: number, height: number) {
  if (height <= 0) return "";
  const r = Math.min(4, height, width / 2);
  const top = base - height;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

function Breakdown({
  title,
  items,
  color,
  empty,
}: {
  title: string;
  items: { name: string; value: number; share: number }[];
  color: string;
  empty: string;
}) {
  const { t, money, data } = useApp();
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="form-hint padded-hint">{t(empty)}</p>
      ) : (
        <ul className="finance-breakdown">
          {items.map((x) => (
            <li key={x.name}>
              <div>
                <span>{x.name}</span>
                <strong>
                  {money(x.value, data.settings.currency)}{" "}
                  <small>{Math.round(x.share * 100)} %</small>
                </strong>
              </div>
              <div className="finance-track">
                <i
                  style={{
                    width: `${Math.max(2, x.share * 100)}%`,
                    background: color,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
