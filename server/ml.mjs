/**
 * Predictions computed inside the CRM, free and without outside services:
 * logistic regression trained on the academy's own history, with simple
 * rules while there is not enough data yet.
 */
import { all, one, run, now, chargeRows } from "./db.mjs";

const day = 86400000;
const json = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Gradient descent with L2; features are standardised first. */
export function trainLogistic(
  rows,
  labels,
  { iterations = 600, rate = 0.3, l2 = 0.01 } = {},
) {
  const n = rows.length;
  const k = rows[0]?.length || 0;
  const mean = Array(k).fill(0);
  const std = Array(k).fill(0);
  for (const r of rows) r.forEach((v, j) => (mean[j] += v / n));
  for (const r of rows) r.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n));
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j]) || 1;
  const x = rows.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  const w = Array(k).fill(0);
  let b = Math.log(
    (labels.reduce((a, c) => a + c, 0) + 1) /
      (n - labels.reduce((a, c) => a + c, 0) + 1),
  );
  for (let it = 0; it < iterations; it++) {
    const gw = Array(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b + x[i].reduce((s, v, j) => s + v * w[j], 0));
      const e = p - labels[i];
      gb += e / n;
      for (let j = 0; j < k; j++) gw[j] += (e * x[i][j]) / n;
    }
    b -= rate * gb;
    for (let j = 0; j < k; j++) w[j] -= rate * (gw[j] + l2 * w[j]);
  }
  return { w, b, mean, std };
}
export function predict(model, row) {
  const z = row.map((v, j) => (v - model.mean[j]) / model.std[j]);
  const parts = z.map((v, j) => v * model.w[j]);
  return { p: sigmoid(model.b + parts.reduce((a, c) => a + c, 0)), parts };
}
/** Area under the ROC curve (how well the model ranks cases). */
function auc(scores, labels) {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos)
    for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

// No-show -------------------------------------------------------------------
const noShowNames = [
  "past_no_show",
  "visits",
  "lead_days",
  "hour",
  "weekend",
  "not_confirmed",
  "first_visit",
  "has_debt",
  "online",
];
function noShowRows() {
  const appts = all(
    "SELECT * FROM appointments WHERE contact_id IS NOT NULL AND status IN ('Done','No-show','Scheduled','Pending') ORDER BY starts_at",
  );
  const debt = new Set(
    chargeRows()
      .filter((c) => c.balance > 0)
      .map((c) => c.contact_id),
  );
  const history = {};
  const out = [];
  for (const a of appts) {
    const h = (history[a.contact_id] ||= { done: 0, missed: 0 });
    const past = h.done + h.missed;
    const start = new Date(a.starts_at);
    const features = [
      (h.missed + 0.5) / (past + 3),
      Math.log1p(past),
      Math.log1p(
        Math.max(0, (Date.parse(a.starts_at) - Date.parse(a.created_at)) / day),
      ),
      start.getUTCHours() + 1,
      [5, 6].includes(start.getUTCDay()) ? 1 : 0,
      a.confirmed_at ? 0 : 1,
      past === 0 ? 1 : 0,
      debt.has(a.contact_id) ? 1 : 0,
      a.source === "booking" ? 1 : 0,
    ];
    out.push({
      a,
      features,
      label: a.status === "No-show" ? 1 : a.status === "Done" ? 0 : null,
    });
    if (a.status === "Done") h.done++;
    if (a.status === "No-show") h.missed++;
  }
  return out;
}
function heuristicNoShow(f) {
  return Math.min(
    0.95,
    0.06 +
      0.55 * f[0] +
      (f[5] ? 0.08 : 0) +
      (f[2] > 2.7 ? 0.05 : 0) +
      (f[6] ? 0.05 : 0) +
      (f[7] ? 0.04 : 0),
  );
}

// Requests turning into clients ------------------------------------------------
const leadSources = [
  "instagram",
  "facebook",
  "whatsapp",
  "website",
  "referral",
  "formulaire",
  "phone",
  "api",
];
const leadNames = [
  ...leadSources.map((s) => `source_${s}`),
  "response_hours",
  "has_email",
  "has_phone",
  "psychology",
  "language",
];
function leadRows() {
  const opps = all(
    "SELECT o.*, c.email, c.phone FROM opportunities o JOIN contacts c ON c.id=o.contact_id ORDER BY o.created_at",
  );
  return opps.map((o) => {
    const src = String(o.source || "").toLowerCase();
    const first = one(
      "SELECT MIN(created_at) t FROM activities WHERE contact_id=? AND created_at>? AND kind NOT IN ('inquiry','update')",
      o.contact_id,
      o.created_at,
    )?.t;
    const reply = one(
      "SELECT MIN(created_at) t FROM messages WHERE contact_id=? AND created_at>? AND direction IN ('out','call')",
      o.contact_id,
      o.created_at,
    )?.t;
    const firstTouch = [first, reply].filter(Boolean).sort()[0];
    const hours = firstTouch
      ? (Date.parse(firstTouch) - Date.parse(o.created_at)) / 3600000
      : 72;
    const service = `${o.service_type} ${o.interest}`.toLowerCase();
    return {
      o,
      features: [
        ...leadSources.map((s) => (src.includes(s) ? 1 : 0)),
        Math.log1p(Math.max(0, hours)),
        o.email ? 1 : 0,
        o.phone ? 1 : 0,
        /psycho/.test(service) ? 1 : 0,
        /lang|anglais|english|fran|arab|allemand|espagnol/.test(service)
          ? 1
          : 0,
      ],
      label: o.stage === "Enrolled" ? 1 : o.stage === "Lost" ? 0 : null,
    };
  });
}
function heuristicLead(row, rates) {
  const src = String(row.o.source || "").toLowerCase();
  const base = rates[src] ?? rates.__all ?? 0.3;
  const hours = Math.expm1(row.features[leadSources.length]);
  return Math.max(
    0.03,
    Math.min(
      0.95,
      base +
        (hours < 2 ? 0.1 : hours > 48 ? -0.1 : 0) +
        (row.o.phone ? 0.03 : 0),
    ),
  );
}

/** Train both models when there is enough history; keeps them in ml_models. */
export function trainAll() {
  const result = {};
  for (const [kind, rows, names] of [
    ["no_show", noShowRows(), noShowNames],
    ["lead", leadRows(), leadNames],
  ]) {
    const labelled = rows.filter((r) => r.label != null);
    const positives = labelled.filter((r) => r.label === 1).length;
    if (
      labelled.length < 40 ||
      positives < 5 ||
      labelled.length - positives < 5
    ) {
      run("DELETE FROM ml_models WHERE kind=?", kind);
      result[kind] = { trained: false, samples: labelled.length, positives };
      continue;
    }
    // Train on the oldest 80 %, measure on the newest 20 %, then refit on all.
    const cut = Math.floor(labelled.length * 0.8);
    const train = labelled.slice(0, cut);
    const test = labelled.slice(cut);
    const m = trainLogistic(
      train.map((r) => r.features),
      train.map((r) => r.label),
    );
    const scores = test.map((r) => predict(m, r.features).p);
    const accuracy = test.length
      ? test.filter((r, i) => (scores[i] >= 0.5 ? 1 : 0) === r.label).length /
        test.length
      : null;
    const full = trainLogistic(
      labelled.map((r) => r.features),
      labelled.map((r) => r.label),
    );
    const metrics = {
      accuracy,
      auc: auc(
        scores,
        test.map((r) => r.label),
      ),
      positives,
      names,
    };
    run(
      "INSERT INTO ml_models(kind, weights, metrics, samples, trained_at) VALUES (?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET weights=excluded.weights, metrics=excluded.metrics, samples=excluded.samples, trained_at=excluded.trained_at",
      kind,
      JSON.stringify(full),
      JSON.stringify(metrics),
      labelled.length,
      now(),
    );
    result[kind] = { trained: true, samples: labelled.length, ...metrics };
  }
  return result;
}
/** Retrain once a week (called by the daily cron and page loads). */
export function trainIfOld() {
  const last = one("SELECT MIN(trained_at) t FROM ml_models")?.t;
  const meta = one("SELECT value FROM meta WHERE key='ml_last_try'")?.value;
  if (meta && Date.now() - Date.parse(meta) < 7 * day && (last || meta))
    return null;
  run(
    "INSERT INTO meta(key,value) VALUES ('ml_last_try',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    now(),
  );
  return trainAll();
}
const model = (kind) => {
  const m = one("SELECT * FROM ml_models WHERE kind=?", kind);
  return m
    ? { ...m, weights: json(m.weights, null), metrics: json(m.metrics, {}) }
    : null;
};
function reasons(parts, names, top = 3) {
  return parts
    .map((v, j) => [names[j], v])
    .filter(([, v]) => v > 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k]) => `reason:${k}`);
}

/** Everything the "Predictions" page shows, limited to what the user may see. */
export function predictions(ids) {
  const nowIso = now();
  const ns = model("no_show");
  const noShow = noShowRows()
    .filter(
      (r) =>
        r.label == null &&
        r.a.starts_at > nowIso &&
        r.a.starts_at < new Date(Date.now() + 14 * day).toISOString() &&
        ids.has(r.a.contact_id),
    )
    .map((r) => {
      if (ns?.weights) {
        const { p, parts } = predict(ns.weights, r.features);
        return {
          appointment_id: r.a.id,
          contact_id: r.a.contact_id,
          starts_at: r.a.starts_at,
          score: p,
          reasons: reasons(parts, noShowNames),
        };
      }
      const why = [];
      if (r.features[0] > 0.3) why.push("reason:past_no_show");
      if (r.features[5]) why.push("reason:not_confirmed");
      if (r.features[6]) why.push("reason:first_visit");
      if (r.features[2] > 2.7) why.push("reason:lead_days");
      if (r.features[7]) why.push("reason:has_debt");
      return {
        appointment_id: r.a.id,
        contact_id: r.a.contact_id,
        starts_at: r.a.starts_at,
        score: heuristicNoShow(r.features),
        reasons: why.slice(0, 3),
      };
    })
    .sort((a, b) => b.score - a.score);

  const lm = model("lead");
  const lrows = leadRows();
  const rates = {};
  const bySrc = {};
  for (const r of lrows.filter((x) => x.label != null)) {
    const s = String(r.o.source || "").toLowerCase();
    (bySrc[s] ||= [0, 0])[r.label]++;
    (bySrc.__all ||= [0, 0])[r.label]++;
  }
  for (const [s, [lost, won]] of Object.entries(bySrc))
    rates[s] = (won + 1) / (won + lost + 3);
  const leads = lrows
    .filter(
      (r) =>
        r.label == null &&
        !["Nurture"].includes(r.o.stage) &&
        ids.has(r.o.contact_id),
    )
    .map((r) => {
      if (lm?.weights) {
        const { p, parts } = predict(lm.weights, r.features);
        return {
          opportunity_id: r.o.id,
          contact_id: r.o.contact_id,
          score: p,
          reasons: reasons(parts, leadNames),
        };
      }
      const why = [];
      const hours = Math.expm1(r.features[leadSources.length]);
      if (hours < 2) why.push("reason:fast_answer");
      if (hours > 48) why.push("reason:slow_answer");
      if (
        (rates[String(r.o.source || "").toLowerCase()] ?? 0) >
        (rates.__all ?? 0.3)
      )
        why.push("reason:good_source");
      return {
        opportunity_id: r.o.id,
        contact_id: r.o.contact_id,
        score: heuristicLead(r, rates),
        reasons: why,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Clients who may leave: long gap compared with their usual rhythm.
  const visits = {};
  for (const v of all(
    `SELECT contact_id, ends_at at FROM appointments WHERE status='Done'
     UNION ALL SELECT a.contact_id, s.starts_at FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.status IN ('Present','Late')`,
  ))
    (visits[v.contact_id] ||= []).push(v.at);
  const absences = {};
  for (const a of all(
    "SELECT contact_id, COUNT(*) n FROM attendance WHERE status='Absent' GROUP BY contact_id",
  ))
    absences[a.contact_id] = a.n;
  const debts = {};
  for (const c of chargeRows())
    if (c.balance > 0 && c.due_date < nowIso.slice(0, 10))
      debts[c.contact_id] = (debts[c.contact_id] || 0) + c.balance;
  const ratings = {};
  for (const f of all(
    "SELECT contact_id, AVG(rating) r FROM feedback WHERE rating IS NOT NULL GROUP BY contact_id",
  ))
    ratings[f.contact_id] = f.r;
  const upcoming = new Set(
    all(
      "SELECT contact_id FROM appointments WHERE starts_at>? AND status IN ('Scheduled','Pending')",
      nowIso,
    ).map((r) => r.contact_id),
  );
  const churn = [];
  for (const [cid, list] of Object.entries(visits)) {
    const id = Number(cid);
    if (!ids.has(id) || upcoming.has(id) || list.length < 2) continue;
    list.sort();
    const gaps = list
      .slice(1)
      .map((x, i) => (Date.parse(x) - Date.parse(list[i])) / day);
    const usual = Math.max(7, gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const since = (Date.now() - Date.parse(list[list.length - 1])) / day;
    if (since > 240) continue;
    let score = Math.min(0.7, (since / usual - 1) * 0.25);
    const why = [];
    if (since > usual * 1.5) why.push("reason:long_gap");
    if (absences[id] >= 2) {
      score += 0.12;
      why.push("reason:absences");
    }
    if (debts[id]) {
      score += 0.1;
      why.push("reason:has_debt");
    }
    if (ratings[id] && ratings[id] < 3.5) {
      score += 0.12;
      why.push("reason:low_rating");
    }
    if (score > 0.25)
      churn.push({
        contact_id: id,
        score: Math.min(0.97, score),
        days: Math.round(since),
        reasons: why,
      });
  }
  churn.sort((a, b) => b.score - a.score);

  // Best times: when clients really come, and when they write.
  const best = {};
  const zone = one("SELECT timezone FROM settings WHERE id=1").timezone;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const a of all(
    "SELECT starts_at, status FROM appointments WHERE status IN ('Done','No-show')",
  )) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(a.starts_at)).map((x) => [x.type, x.value]),
    );
    const k = `${days[p.weekday]}-${Number(p.hour) % 24}`;
    (best[k] ||= [0, 0])[a.status === "Done" ? 0 : 1]++;
  }
  const bestTimes = Object.entries(best)
    .map(([k, [done, missed]]) => ({
      day: Number(k.split("-")[0]),
      hour: Number(k.split("-")[1]),
      total: done + missed,
      rate: (done + 1) / (done + missed + 2),
    }))
    .filter((x) => x.total >= 2)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 5);
  const writeHours = all(
    "SELECT CAST(substr(created_at,12,2) AS INTEGER) h, COUNT(*) n FROM messages WHERE direction='in' GROUP BY h ORDER BY n DESC LIMIT 3",
  );

  // Load of the next 4 weeks per specialist (booked hours / working hours).
  const load = [];
  const hours = all(
    "SELECT user_id, SUM(end_min-start_min)/60.0 h FROM staff_hours GROUP BY user_id",
  );
  for (const u of all("SELECT id, name FROM users WHERE active=1")) {
    const weekly = hours.find((h) => h.user_id === u.id)?.h || 0;
    const weeks = [0, 1, 2, 3].map((w) => {
      const from = new Date(Date.now() + w * 7 * day).toISOString();
      const to = new Date(Date.now() + (w + 1) * 7 * day).toISOString();
      const booked =
        all(
          "SELECT starts_at, ends_at FROM appointments WHERE staff_id=? AND starts_at>=? AND starts_at<? AND status IN ('Scheduled','Pending')",
          u.id,
          from,
          to,
        ).reduce(
          (n, a) =>
            n + (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 3600000,
          0,
        ) +
        all(
          "SELECT s.starts_at, s.ends_at FROM sessions s JOIN cohorts h ON h.id=s.cohort_id WHERE h.instructor_id=? AND s.starts_at>=? AND s.starts_at<? AND s.status='Scheduled'",
          u.id,
          from,
          to,
        ).reduce(
          (n, a) =>
            n + (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 3600000,
          0,
        );
      return {
        booked: Math.round(booked * 10) / 10,
        percent: weekly ? Math.round((booked / weekly) * 100) : null,
      };
    });
    if (weeks.some((w) => w.booked > 0) || weekly)
      load.push({ user_id: u.id, name: u.name, weekly, weeks });
  }

  const meta = (m) =>
    m
      ? {
          trained: true,
          samples: m.samples,
          trained_at: m.trained_at,
          accuracy: m.metrics.accuracy,
          auc: m.metrics.auc,
        }
      : { trained: false };
  return {
    noShow,
    leads,
    churn: churn.slice(0, 40),
    bestTimes,
    writeHours,
    load,
    models: { no_show: meta(ns), lead: meta(lm) },
  };
}
