import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const isHosted = process.env.VERCEL === "1";
export const dbPath =
  process.env.CRM_DB || resolve(root, "data/luminol.sqlite");
const databaseScope = new AsyncLocalStorage();
let localDatabase;
if (!isHosted) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  localDatabase = new DatabaseSync(dbPath);
  localDatabase.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
}
function currentDatabase() {
  const connection = databaseScope.getStore() || localDatabase;
  if (!connection)
    throw new Error("A request database has not been initialized.");
  return connection;
}
export function withDatabase(connection, callback) {
  return databaseScope.run(connection, callback);
}
export const db = {
  prepare(sql) {
    return currentDatabase().prepare(sql);
  },
  exec(sql) {
    return currentDatabase().exec(sql);
  },
  close() {
    return currentDatabase().close();
  },
};
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const now = () => new Date().toISOString();
export const insert = (table, values) =>
  Number(
    run(
      `INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(
        values,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(values),
    ).lastInsertRowid,
  );
export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}
export function audit(
  user,
  contact,
  text,
  kind = "update",
  visibility = "general",
) {
  return insert("activities", {
    user_id: user,
    contact_id: contact,
    kind,
    text,
    visibility,
    created_at: now(),
  });
}

export function initializeDatabase() {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const file of readdirSync(resolve(root, "server/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (!one("SELECT name FROM schema_migrations WHERE name=?", file))
      transaction(() => {
        db.exec(readFileSync(resolve(root, "server/migrations", file), "utf8"));
        run("INSERT INTO schema_migrations VALUES (?,?)", file, now());
      });
  }

  if (!one("SELECT id FROM settings WHERE id=1"))
    transaction(() => {
      insert("settings", {
        id: 1,
        academy: "Luminol Academy",
        currency: "DZD",
        timezone: "Africa/Algiers",
        language: "en",
      });
      const password = hashPassword(
        process.env.DEMO_PASSWORD || "LuminolDemo!2026",
      );
      const staff = [
        ["Academy Admin", "admin", "admin"],
        ["Amel Benali", "amel", "admissions"],
        ["Yacine Saadi", "yacine", "academic"],
        ["Dr. Sarah Amrani", "sarah", "instructor"],
        ["Karim Bensalem", "karim", "finance"],
        ["Nadia Mansouri", "nadia", "manager"],
        ["Lina Haddad", "lina", "instructor"],
      ];
      staff.forEach(([name, email, role], i) =>
        insert("users", {
          id: i + 1,
          name,
          email: `${email}@luminol.demo`,
          role,
          password_hash:
            isHosted && role !== "admin"
              ? hashPassword(randomBytes(32).toString("base64url"))
              : password,
        }),
      );
      const base = new Date();
      const iso = (days = 0, hour = 10) => {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + days);
        d.setUTCHours(hour, 0, 0, 0);
        return d.toISOString();
      };
      const day = (n = 0) => iso(n).slice(0, 10);
      const programs = [
        [
          "Applied Psychology",
          "Psychology",
          "Practical foundations for understanding people and behavior. Sample training program; not a clinical qualification.",
          "12 weeks",
          3600000,
          "teal",
        ],
        [
          "English for Communication",
          "Languages",
          "Build confidence in everyday and professional English.",
          "8 weeks",
          1800000,
          "blue",
        ],
        [
          "French Conversation",
          "Languages",
          "Guided practice for clear, confident French conversation.",
          "8 weeks",
          1600000,
          "purple",
        ],
        [
          "Training of Trainers",
          "Training",
          "Design engaging sessions and facilitate effective learning.",
          "6 weeks",
          2400000,
          "amber",
        ],
      ];
      programs.forEach(
        ([name, category, description, duration, price, color], i) =>
          insert("programs", {
            id: i + 1,
            name,
            category,
            description,
            duration,
            price,
            currency: "DZD",
            color,
          }),
      );
      const cohorts = [
        ["Psychology · Autumn", 1, 4, 12, "Room 01"],
        ["English · Evening A", 2, 7, 10, "Room 02"],
        ["French · Weekend", 3, 7, 8, "Room 03"],
        ["Trainers · October", 4, 4, 4, "Studio 01"],
      ];
      cohorts.forEach(([name, program, instructor, capacity, room], i) =>
        insert("cohorts", {
          id: i + 1,
          name,
          program_id: program,
          instructor_id: instructor,
          capacity,
          start_date: day(-14),
          end_date: day(56),
          room,
          status: "Active",
        }),
      );
      const names = [
        "Inès Boudiaf",
        "Mehdi Cherif",
        "Yasmine Kaci",
        "Rayan Belkacem",
        "Nour Aït Ali",
        "Sofia Rahmani",
        "Adam Touati",
        "Lina Bouzid",
        "Anis Bensaïd",
        "Meriem Ferhat",
        "Sami Dahmani",
        "Aya Meziane",
        "Walid Benyahia",
        "Sarah Hamidi",
        "Amine Ziani",
        "Rania Haddad",
        "Yanis Saïdi",
        "Leïla Bouchareb",
        "Ilyes Azzouz",
        "Dina Mansouri",
        "Bilal Kadri",
        "Amira Tabet",
        "Farès Lounis",
        "Salma Abbès",
        "Nabil Djebbar",
        "Hana Meddah",
        "Imane Djellal",
        "Omar Bouali",
        "Lydia Haroun",
        "Youcef Amani",
        "Malak Sahli",
        "Hichem Bellil",
      ];
      names.forEach((name, i) =>
        insert("contacts", {
          id: i + 1,
          name,
          email: `student${i + 1}@example.test`,
          phone: `+213 555 01 ${String(i + 1).padStart(4, "0")}`,
          language: i % 3 ? "English" : "العربية",
          consent: i % 4 ? 1 : 0,
          guardian: "",
          created_at: iso(-(i % 22)),
        }),
      );
      const stages = [
        "New inquiry",
        "Contacted",
        "Qualified",
        "Consultation booked",
        "Application pending",
        "Awaiting payment",
      ];
      for (let i = 1; i <= 16; i++) {
        insert("opportunities", {
          contact_id: i,
          program_id: ((i - 1) % 4) + 1,
          owner_id: 2,
          stage: stages[(i - 1) % 6],
          source: ["Instagram", "Website", "Referral", "WhatsApp"][i % 4],
          campaign: i % 2 ? "Autumn intake" : "",
          tags: i % 5 === 0 ? "Priority" : "",
          expected_date: day(8),
          reason: "",
          created_at: iso(-(i % 12)),
          stage_at: iso(-(i % 3)),
          version: 1,
        });
        if (i < 9)
          insert("tasks", {
            contact_id: i,
            owner_id: 2,
            title: [
              "Discuss program options",
              "Follow up after consultation",
              "Confirm trial session",
              "Send enrollment details",
            ][i % 4],
            due_at: iso(i < 4 ? -1 : i < 7 ? 0 : 1, 9 + i),
            priority: i < 4 ? "High" : "Normal",
            status: "Open",
            created_at: iso(-2),
            version: 1,
          });
        audit(
          2,
          i,
          i % 3 === 0
            ? "Consultation recorded: interested in the next cohort."
            : "Inquiry received and assigned to Amel.",
          "admissions",
        );
      }
      for (let i = 17; i <= 32; i++) {
        const cohort = ((i - 17) % 4) + 1;
        const p = programs[cohort - 1];
        const op = insert("opportunities", {
          contact_id: i,
          program_id: cohort,
          owner_id: 2,
          stage: "Enrolled",
          source: ["Instagram", "Website", "Referral", "WhatsApp"][i % 4],
          created_at: iso(-20),
          stage_at: iso(-10),
          version: 1,
        });
        const en = insert("enrollments", {
          contact_id: i,
          cohort_id: cohort,
          opportunity_id: op,
          status: "Active",
          created_at: iso(-10),
        });
        const ch = insert("charges", {
          contact_id: i,
          enrollment_id: en,
          label: `${p[0]} · Tuition`,
          amount: p[4],
          currency: "DZD",
          due_date: day(i % 3 === 0 ? -5 : 10),
          created_at: iso(-10),
        });
        const amount = i % 3 === 0 ? Math.round(p[4] / 2) : p[4];
        insert("payments", {
          charge_id: ch,
          amount,
          method: "Bank transfer",
          reference: `DEMO-${i}`,
          created_at: iso(-(i % 7)),
          user_id: 5,
        });
        audit(2, i, `Enrolled in ${cohorts[cohort - 1][0]}.`, "enrollment");
      }
      for (let offset = -7; offset <= 14; offset++) {
        if (offset % 2 !== 0 && offset !== 0) continue;
        for (let c = 1; c <= 4; c++) {
          const id = insert("sessions", {
            cohort_id: c,
            title: [
              "Foundations of behavior",
              "Everyday conversations",
              "Parlons ensemble",
              "Facilitation workshop",
            ][c - 1],
            starts_at: iso(offset, 8 + c * 2),
            ends_at: iso(offset, 9 + c * 2),
            room: cohorts[c - 1][4],
            status: "Scheduled",
          });
          if (offset < 0)
            for (let contact = 16 + c; contact <= 32; contact += 4)
              insert("attendance", {
                session_id: id,
                contact_id: contact,
                status: contact === 19 || contact === 23 ? "Absent" : "Present",
              });
        }
      }
      audit(
        1,
        null,
        "Demo workspace created with fictional academy records.",
        "system",
      );
    });
}
if (!isHosted) initializeDatabase();

export const stages = [
  "New inquiry",
  "Contacted",
  "Qualified",
  "Consultation booked",
  "Application pending",
  "Awaiting payment",
  "Enrolled",
  "Lost",
  "Nurture",
];
export function chargeRows() {
  return all(
    `SELECT ch.*, co.name contact_name, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.charge_id=ch.id),0)-COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.charge_id=ch.id),0) paid FROM charges ch JOIN contacts co ON co.id=ch.contact_id`,
  ).map((c) => ({ ...c, balance: c.amount - c.discount - c.paid }));
}
