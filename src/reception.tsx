// Reception tools: signed consent on a tablet, questionnaire link,
// birthdays, room board, duplicate clients, bank statement import,
// unanswered requests.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cake,
  Copy,
  Eraser,
  FileSpreadsheet,
  MessageCircle,
  PenLine,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useApp } from "./context";
import { api, localDate, type Row } from "./types";
import { Badge, Button, Dialog, Panel } from "./ui";

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const wa = (phone: string, text: string) =>
  `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}`;

// ---------------------------------------------------------------------------
// Consent signed with the finger on a tablet or phone
// ---------------------------------------------------------------------------
export function SignatureDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { data, t, perform, toast } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
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
  const text = `${t("I agree that")} ${data.settings.academy} ${t(
    "keeps my contact details and the information I give, uses them only for my follow-up, reminders and messages from the academy, and never shares them. I can ask at any time to see, correct or delete them.",
  )}`;
  async function save() {
    setBusy(true);
    try {
      await perform(`/contacts/${contact.id}/signature`, {
        image: canvas.current!.toDataURL("image/png"),
      });
      toast(t("Consent signed and saved in the documents"));
      onClose();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t("Consent to be signed")} onClose={onClose}>
      <div className="form-body">
        <p className="consent-text">
          <strong>{contact.name}</strong> — {text}
        </p>
        <p className="consent-text" dir="rtl" lang="ar">
          أوافق على أن تحتفظ الأكاديمية ببيانات الاتصال والمعلومات التي أقدمها،
          وأن تستخدمها فقط لمتابعتي والتذكيرات ورسائل الأكاديمية، دون مشاركتها
          مع أي طرف. يمكنني طلب الاطلاع عليها أو تصحيحها أو حذفها في أي وقت.
        </p>
        <canvas
          ref={canvas}
          className="signature-pad"
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
        <p className="form-hint">{t("Sign here with your finger")}</p>
      </div>
      <div className="dialog-footer">
        <Button
          icon={<Eraser size={15} />}
          onClick={() => {
            const c = canvas.current!;
            const ctx = c.getContext("2d")!;
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, c.width, c.height);
            setSigned(false);
          }}
        >
          {t("Clear")}
        </Button>
        <Button
          variant="primary"
          icon={<PenLine size={15} />}
          disabled={!signed || busy}
          onClick={save}
        >
          {t("Save the signature")}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Questionnaire link sent before the first consultation
// ---------------------------------------------------------------------------
export function IntakeLinkDialog({
  contact,
  onClose,
}: {
  contact: Row;
  onClose: () => void;
}) {
  const { data, t, toast } = useApp();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/contacts/${contact.id}/intake-link`, {})
      .then((r) => setUrl(`${window.location.origin}/intake/${r.token}`))
      .catch((e) => setError(e.message));
  }, []);
  const message = `${t("Hello")} ${contact.name.split(" ")[0]}, ${t(
    "before your consultation, please answer a few questions here:",
  )} ${url} — ${data.settings.academy}`;
  return (
    <Dialog
      title={t("Questionnaire before the consultation")}
      onClose={onClose}
    >
      <div className="form-body">
        <p>
          {t(
            "The client answers on their phone. The answers go to the specialist of their next appointment, in the private file.",
          )}
        </p>
        {error && <p className="form-error">{error}</p>}
        {url && (
          <div className="share-link">
            <code>{url}</code>
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button
          icon={<Copy size={15} />}
          disabled={!url}
          onClick={() =>
            navigator.clipboard
              .writeText(url)
              .then(() => toast(t("Copied")))
              .catch(() => toast(t("Select the text and copy it.")))
          }
        >
          {t("Copy")}
        </Button>
        {contact.phone && (
          <a
            className={`button primary ${url ? "" : "disabled"}`}
            href={url ? wa(contact.phone, message) : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={15} /> {t("Send on WhatsApp")}
          </a>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Birthdays of the next 7 days, with a greeting ready on WhatsApp
// ---------------------------------------------------------------------------
export function BirthdaysPanel() {
  const { data, t, profile } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(data.today + "T12:00:00Z") + i * 86400000);
    return d.toISOString().slice(5, 10);
  });
  const list = data.contacts
    .filter((c) => c.birth_date && days.includes(c.birth_date.slice(5, 10)))
    .sort(
      (a, b) =>
        days.indexOf(a.birth_date.slice(5, 10)) -
        days.indexOf(b.birth_date.slice(5, 10)),
    );
  if (!list.length) return null;
  return (
    <Panel
      title="Birthdays this week"
      subtitle="A short message on their birthday keeps clients close to the academy."
    >
      <div className="today-list">
        {list.map((c) => {
          const today = c.birth_date.slice(5, 10) === days[0];
          const age =
            Number(data.today.slice(0, 4)) - Number(c.birth_date.slice(0, 4));
          return (
            <div key={c.id} className="today-row">
              <div className="today-time">
                <Cake size={20} className="teal-text" />
              </div>
              <div className="today-main">
                <button className="cell-link" onClick={() => profile(c.id)}>
                  {c.name}
                </button>
                <small>
                  {today
                    ? t("Today")
                    : c.birth_date.slice(8, 10) +
                      "/" +
                      c.birth_date.slice(5, 7)}
                  {age > 0 && age < 120 ? ` · ${age} ${t("years")}` : ""}
                </small>
              </div>
              {today && <Badge tone="amber">{t("Today")}</Badge>}
              {c.phone && c.consent ? (
                <a
                  className="button small"
                  href={wa(
                    c.phone,
                    `${t("Happy birthday")} ${c.name.split(" ")[0]} ! ${t("The whole team of")} ${data.settings.academy} ${t("wishes you a wonderful year.")} 🎉 / عيد ميلاد سعيد!`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={14} /> {t("Wish happy birthday")}
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Which room is taken when, for one day
// ---------------------------------------------------------------------------
export function roomList(data: any): string[] {
  const set = new Set<string>(
    String(data.settings.rooms || "")
      .split("\n")
      .map((x: string) => x.trim())
      .filter(Boolean),
  );
  for (const a of data.appointments)
    if (
      a.location &&
      !/zoom|meet|jitsi|online|en ligne|whatsapp|téléphone|phone/i.test(
        a.location,
      )
    )
      set.add(a.location.trim());
  for (const c of data.cohorts)
    if (c.room && !/zoom|online/i.test(c.room)) set.add(c.room.trim());
  return Array.from(set).slice(0, 20);
}
export function RoomBoard() {
  const { data, t, person, cohort, open } = useApp();
  const zone = data.settings.timezone;
  const [day, setDay] = useState(data.today);
  const rooms = roomList(data);
  const hm = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
    const [h, m] = p.split(":").map(Number);
    return h * 60 + m;
  };
  const start = 8 * 60,
    end = 21 * 60;
  const blocks = [
    ...data.appointments
      .filter(
        (a) =>
          a.status !== "Cancelled" &&
          a.location &&
          localDate(new Date(a.starts_at), zone) === day,
      )
      .map((a) => ({
        room: a.location.trim(),
        from: hm(a.starts_at),
        to: hm(a.ends_at),
        label: a.contact_id ? person(a.contact_id).name : a.title,
        kind: "appt",
        record: a,
      })),
    ...data.sessions
      .filter(
        (s) =>
          s.status !== "Cancelled" &&
          localDate(new Date(s.starts_at), zone) === day,
      )
      .map((s) => ({
        room: String(s.room || cohort(s.cohort_id).room || "").trim(),
        from: hm(s.starts_at),
        to: hm(s.ends_at),
        label: cohort(s.cohort_id).name,
        kind: "class",
        record: null as Row | null,
      })),
  ].filter((b) => rooms.includes(b.room));
  if (!rooms.length)
    return (
      <Panel
        title="Rooms"
        subtitle="Add your rooms in Settings → Workspace settings to see who uses which room."
      >
        <p className="form-hint padded-hint">{t("No room yet.")}</p>
      </Panel>
    );
  const pct = (m: number) =>
    `${((Math.max(start, Math.min(end, m)) - start) / (end - start)) * 100}%`;
  return (
    <Panel
      title="Rooms"
      subtitle="Who uses which room. Click a free space to book it."
      action={
        <input
          type="date"
          className="date-input"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          aria-label={t("Date")}
        />
      }
    >
      <div className="room-board">
        <div className="room-hours">
          <span />
          <div>
            {Array.from({ length: 13 }, (_, i) => (
              <small key={i} style={{ insetInlineStart: pct(start + i * 60) }}>
                {8 + i}h
              </small>
            ))}
          </div>
        </div>
        {rooms.map((room) => (
          <div key={room} className="room-row">
            <span>{room}</span>
            <div
              className="room-track"
              onClick={(e) => {
                const r = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const rtl = document.documentElement.dir === "rtl";
                const x = rtl ? r.right - e.clientX : e.clientX - r.left;
                const minute =
                  start + Math.floor(((x / r.width) * (end - start)) / 30) * 30;
                open({
                  type: "appointment",
                  extra: {
                    day,
                    time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
                    location: room,
                  },
                });
              }}
            >
              {blocks
                .filter((b) => b.room === room)
                .map((b, i) => (
                  <button
                    key={i}
                    className={`room-block ${b.kind}`}
                    style={{
                      insetInlineStart: pct(b.from),
                      width: `calc(${pct(b.to)} - ${pct(b.from)})`,
                    }}
                    title={`${b.label} · ${String(Math.floor(b.from / 60)).padStart(2, "0")}:${String(b.from % 60).padStart(2, "0")}–${String(Math.floor(b.to / 60)).padStart(2, "0")}:${String(b.to % 60).padStart(2, "0")}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (b.record)
                        open({ type: "appointment", record: b.record });
                    }}
                  >
                    {b.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Requests nobody answered for more than 24 hours
// ---------------------------------------------------------------------------
export function UnansweredPanel() {
  const { data, t, person, go, profile, date } = useApp();
  const limit = new Date(Date.now() - 24 * 3600000).toISOString();
  const late = data.opportunities
    .filter((o) => o.stage === "New inquiry" && o.created_at < limit)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!late.length) return null;
  return (
    <Panel
      title="Requests waiting for more than 24 hours"
      subtitle="A quick answer doubles the chance that the client comes. Call or write to them first."
      action={
        <Button onClick={() => go("Admissions")}>
          {t("Open the requests")}
        </Button>
      }
    >
      <div className="today-list">
        {late.slice(0, 6).map((o) => {
          const c = person(o.contact_id);
          return (
            <div key={o.id} className="today-row is-late">
              <div className="today-time">
                <TriangleAlert size={18} className="amber-text" />
              </div>
              <div className="today-main">
                <button className="cell-link" onClick={() => profile(c.id)}>
                  {c.name}
                </button>
                <small>
                  {[
                    t(o.service_type),
                    o.interest,
                    `${t("since")} ${date(o.created_at)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              {c.phone && (
                <a className="button small" href={`tel:${c.phone}`}>
                  {t("Call")}
                </a>
              )}
            </div>
          );
        })}
      </div>
      {late.length > 6 && (
        <p className="form-hint padded-hint">
          + {late.length - 6} {t("more")}
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Possible duplicate clients (same phone, or same name) and merge
// ---------------------------------------------------------------------------
export function DuplicatesDialog({ onClose }: { onClose: () => void }) {
  const { data, t, perform, toast, date } = useApp();
  const pairs = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const c of data.contacts) {
      const keys = [
        digits(c.phone).length >= 8 ? "p" + digits(c.phone).slice(-9) : "",
        c.name.trim().length > 3
          ? "n" +
            c.name
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/\s+/g, " ")
              .trim()
          : "",
      ].filter(Boolean);
      for (const k of keys) groups.set(k, [...(groups.get(k) || []), c]);
    }
    const seen = new Set<string>();
    const out: [Row, Row, string][] = [];
    for (const [k, list] of groups)
      if (list.length > 1) {
        const sorted = [...list].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
        for (const other of sorted.slice(1)) {
          const id = `${sorted[0].id}-${other.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push([
            sorted[0],
            other,
            k[0] === "p" ? "Same phone" : "Same name",
          ]);
        }
      }
    return out;
  }, [data.contacts]);
  const [busy, setBusy] = useState(0);
  const facts = (c: Row) => {
    const n = (rows: Row[]) => rows.filter((x) => x.contact_id === c.id).length;
    return [
      c.phone,
      c.email,
      `${n(data.appointments)} ${t("appointments")}`,
      `${n(data.enrollments)} ${t("registrations")}`,
      `${n(data.charges)} ${t("charges")}`,
      `${t("since")} ${date(c.created_at)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return (
    <Dialog title={t("Possible duplicates")} onClose={onClose} wide>
      <div className="form-body">
        <p>
          {t(
            "Merging keeps the first card and moves everything from the second one into it (appointments, payments, groups, notes, documents). The second card is then removed.",
          )}
        </p>
        {pairs.length === 0 ? (
          <p className="form-hint">{t("No duplicates found.")}</p>
        ) : (
          <div className="today-list">
            {pairs.map(([a, b, why]) => (
              <div key={`${a.id}-${b.id}`} className="duplicate-row">
                <div>
                  <Badge tone="teal">{t("Keep")}</Badge>{" "}
                  <strong>{a.name}</strong>
                  <small>{facts(a)}</small>
                </div>
                <div>
                  <Badge tone="amber">{t("Merge into the first")}</Badge>{" "}
                  <strong>{b.name}</strong>
                  <small>{facts(b)}</small>
                </div>
                <div className="row-actions">
                  <Badge>{t(why)}</Badge>
                  <Button
                    variant="small"
                    icon={<Users size={14} />}
                    disabled={!!busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `${t("Merge")} « ${b.name} » → « ${a.name} » ?`,
                        )
                      )
                        return;
                      setBusy(b.id);
                      try {
                        await perform(`/contacts/${a.id}/merge`, {
                          from_id: b.id,
                        });
                        toast(t("Clients merged"));
                      } catch (e: any) {
                        toast(e.message);
                      } finally {
                        setBusy(0);
                      }
                    }}
                  >
                    {t("Merge")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose}>{t("Close")}</Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Import a CCP / BaridiMob / bank statement and match the payments
// ---------------------------------------------------------------------------
type Line = {
  key: number;
  day: string;
  amount: number;
  label: string;
  charge: string;
  take: boolean;
};
function parseAmount(v: any): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "")
    .replace(/[^\d,.\-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  return Number(s) || 0;
}
function parseDay(v: any): string {
  if (typeof v === "number")
    return new Date(Math.round((v - 25569) * 86400000))
      .toISOString()
      .slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m)
    return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}
export function StatementImportDialog({ onClose }: { onClose: () => void }) {
  const { data, t, money, person, perform, toast } = useApp();
  const [grid, setGrid] = useState<any[][]>([]);
  const [cols, setCols] = useState({ day: -1, amount: -1, label: -1 });
  const [method, setMethod] = useState("CCP");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = data.charges.filter((c) => c.balance > 0);
  async function load(file: File) {
    setError("");
    try {
      let rows: any[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readGrids } = await import("./xlsx");
        rows =
          Object.values(await readGrids(await file.arrayBuffer()))[0] || [];
      } else {
        rows = (await file.text())
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) =>
            l
              .split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
              .map((c) => c.replace(/^"|"$/g, "")),
          );
      }
      if (rows.length < 2)
        throw new Error(t("The file has no rows under the header."));
      const head = rows[0].map((h: any) => String(h ?? "").toLowerCase());
      const find = (re: RegExp) => head.findIndex((h) => re.test(h));
      setGrid(rows);
      setCols({
        day: find(/date|تاريخ/),
        amount: find(/montant|amount|crédit|credit|المبلغ|somme/),
        label: find(
          /libell|label|descr|motif|nom|name|référence|reference|البيان/,
        ),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (!grid.length || cols.amount < 0) return;
    const used = new Set<string>();
    setLines(
      grid
        .slice(1)
        .map((r, i) => {
          const amount = Math.round(parseAmount(r[cols.amount]) * 100);
          const label = cols.label >= 0 ? String(r[cols.label] ?? "") : "";
          const low = label.toLowerCase();
          const match =
            open.find((c) => {
              const p = person(c.contact_id);
              const nameHit =
                p.name &&
                low.includes(p.name.toLowerCase().split(" ").slice(-1)[0]);
              const phoneHit =
                digits(p.phone).length >= 8 &&
                digits(label).includes(digits(p.phone).slice(-8));
              return (
                !used.has(String(c.id)) &&
                (nameHit || phoneHit) &&
                c.balance >= amount
              );
            }) ||
            open.find((c) => !used.has(String(c.id)) && c.balance === amount);
          if (match) used.add(String(match.id));
          return {
            key: i,
            day: cols.day >= 0 ? parseDay(r[cols.day]) : "",
            amount,
            label,
            charge: match ? String(match.id) : "",
            take: !!match,
          };
        })
        .filter((l) => l.amount > 0),
    );
  }, [grid, cols]);
  const head = (grid[0] || []).map(
    (h: any, i: number) => [i, String(h ?? `#${i + 1}`)] as [number, string],
  );
  const chosen = lines.filter((l) => l.take && l.charge);
  async function submit() {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const l of chosen) {
      try {
        const ch = data.charges.find((c) => String(c.id) === l.charge);
        await perform("/payments", {
          charge_id: Number(l.charge),
          amount: Math.min(l.amount, ch?.balance || l.amount),
          method,
          reference: l.label.slice(0, 100),
          paid_on: l.day || undefined,
        });
        ok++;
      } catch (e: any) {
        failed.push(`${l.label || money(l.amount)} : ${e.message}`);
      }
    }
    setBusy(false);
    toast(`${ok} ${t("payments recorded")}`);
    if (failed.length) setError(failed.join("\n"));
    else onClose();
  }
  return (
    <Dialog
      title={t("Import a bank statement")}
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="form-body">
        <p>
          {t(
            "Export the statement of your CCP / BaridiMob or bank account as Excel or CSV. The CRM suggests which client each amount belongs to; check, tick and record.",
          )}
        </p>
        <label className="upload-box">
          <FileSpreadsheet size={26} />
          <strong>{t("Choose the statement (.xlsx or .csv)")}</strong>
          <input
            type="file"
            accept=".xlsx,.csv,.txt"
            onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          />
        </label>
        {grid.length > 0 && (
          <div className="form-grid">
            {(
              [
                ["day", "Date column"],
                ["amount", "Amount column"],
                ["label", "Description column"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="field">
                <span>{t(label)}</span>
                <select
                  value={cols[k]}
                  onChange={(e) =>
                    setCols({ ...cols, [k]: Number(e.target.value) })
                  }
                >
                  <option value={-1}>—</option>
                  {head.map(([i, h]) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              <span>{t("Payment method")}</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {["CCP", "BaridiMob", "Bank transfer", "Cash"].map((m) => (
                  <option key={m} value={m}>
                    {t(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {lines.length > 0 && (
          <div className="statement-lines">
            {lines.map((l) => (
              <div
                key={l.key}
                className={`statement-line ${l.take && l.charge ? "is-on" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={l.take}
                  onChange={(e) =>
                    setLines(
                      lines.map((x) =>
                        x.key === l.key ? { ...x, take: e.target.checked } : x,
                      ),
                    )
                  }
                  aria-label={t("Record")}
                />
                <div>
                  <strong>{money(l.amount, data.settings.currency)}</strong>
                  <small>
                    {l.day} · {l.label}
                  </small>
                </div>
                <select
                  value={l.charge}
                  onChange={(e) =>
                    setLines(
                      lines.map((x) =>
                        x.key === l.key
                          ? {
                              ...x,
                              charge: e.target.value,
                              take: !!e.target.value,
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">{t("Not a client payment — skip")}</option>
                  {open.map((c) => (
                    <option key={c.id} value={c.id}>
                      {person(c.contact_id).name} · {c.label} ·{" "}
                      {money(c.balance, c.currency)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {error && <p className="form-error pre-line">{error}</p>}
      </div>
      <div className="dialog-footer">
        <Button onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!chosen.length || busy}
          onClick={submit}
        >
          {busy
            ? t("Importing…")
            : `${t("Record")} ${chosen.length} ${t("payments")}`}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Automatic rules (director): switch each rule on or off
// ---------------------------------------------------------------------------
export function RulesPanel() {
  const { data, t, perform, toast } = useApp();
  const rules = (data as any).automationRules || {};
  const catalog: [string, string][] = (data as any).automationCatalog || [];
  if (!data.permissions.admin || !catalog.length) return null;
  return (
    <Panel
      title="Automatic rules"
      subtitle="Checked every evening (and when you press “Run now”). Each rule only creates a task for the team — nothing is sent to clients without you."
    >
      <div className="rule-list">
        {catalog.map(([key, label]) => (
          <label key={key} className={`rule ${rules[key] ? "is-on" : ""}`}>
            <input
              type="checkbox"
              checked={!!rules[key]}
              onChange={async (e) => {
                try {
                  await perform("/automations/rules", {
                    [key]: e.target.checked,
                  });
                } catch (err: any) {
                  toast(err.message);
                }
              }}
            />
            <span>{t(label)}</span>
          </label>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Hot / warm / cold request, from how fresh and how complete it is
// ---------------------------------------------------------------------------
export function leadHeat(o: Row, contact: Row): "hot" | "warm" | "cold" {
  if (["Enrolled", "Lost"].includes(o.stage)) return "cold";
  const days = (Date.now() - Date.parse(o.created_at)) / 86400000;
  let score = days < 3 ? 3 : days < 14 ? 2 : days < 45 ? 1 : 0;
  if (contact.phone) score++;
  if (contact.consent) score++;
  if (
    [
      "Qualified",
      "Consultation booked",
      "Application pending",
      "Awaiting payment",
    ].includes(o.stage)
  )
    score += 2;
  if (o.stage === "Nurture") score -= 2;
  return score >= 5 ? "hot" : score >= 3 ? "warm" : "cold";
}
export function HeatBadge({ o, contact }: { o: Row; contact: Row }) {
  const { t } = useApp();
  const heat = leadHeat(o, contact);
  const text = { hot: "Hot", warm: "Warm", cold: "Cold" }[heat];
  return (
    <span
      className={`heat heat-${heat}`}
      title={t("Chance that this request becomes a client")}
    >
      {heat === "hot" ? "🔥" : heat === "warm" ? "◐" : "❄"} {t(text)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Waiting-room screen (TV or tablet at the reception)
// ---------------------------------------------------------------------------
export function WaitingScreen({ onClose }: { onClose: () => void }) {
  const { data, t, person, user, time, refresh, lang } = useApp();
  const zone = data.settings.timezone;
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-GB";
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const a = window.setInterval(() => setClock(new Date()), 1000);
    const b = window.setInterval(() => refresh().catch(() => {}), 60000);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  const short = (name: string) => {
    const [first, ...rest] = String(name || "").split(" ");
    return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
  };
  const list = data.appointments
    .filter(
      (a) =>
        localDate(new Date(a.starts_at), zone) === data.today &&
        !["Done", "Cancelled", "No-show"].includes(a.status) &&
        a.ends_at > new Date().toISOString(),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 7);
  return (
    <div className="waiting-screen" onDoubleClick={onClose}>
      <header>
        <img src="/logo-mark.png" alt="" />
        <div>
          <strong>{data.settings.academy}</strong>
          <span>
            {new Intl.DateTimeFormat(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: zone,
            }).format(clock)}
          </span>
        </div>
        <time>
          {new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone: zone,
          }).format(clock)}
        </time>
      </header>
      <h1>{t("Next appointments")}</h1>
      <ul>
        {list.map((a) => (
          <li key={a.id} className={a.checked_in_at ? "is-here" : ""}>
            <b>{time(a.starts_at)}</b>
            <span>
              {a.contact_id ? short(person(a.contact_id).name) : a.title}
            </span>
            <small>
              {[a.location, a.staff_id ? user(a.staff_id).name : ""]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <em>
              {a.checked_in_at ? t("In the waiting room") : t("Expected")}
            </em>
          </li>
        ))}
        {!list.length && (
          <li className="empty-line">{t("No more appointments today.")}</li>
        )}
      </ul>
      <button className="waiting-close" onClick={onClose}>
        {t("Close")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock of books, tests and materials
// ---------------------------------------------------------------------------
export function StockPanel() {
  const { data, t, money, perform, toast, open } = useApp();
  const items: Row[] = (data as any).stock || [];
  const currency = data.settings.currency;
  const [form, setForm] = useState({
    name: "",
    unit: "",
    quantity: "",
    min_quantity: "",
    price: "",
  });
  const [sell, setSell] = useState<{
    id: number;
    contact: string;
    qty: string;
  } | null>(null);
  const change = (x: Row, delta: number) =>
    perform(`/stock/${x.id}`, { delta }, "PATCH").catch((e: any) =>
      toast(e.message),
    );
  return (
    <div className="finance-page">
      <Panel
        title="Stock"
        subtitle="Books, tests and materials. When an item goes below its alert level, the secretary sees it on the home page."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await perform("/stock", {
                name: form.name,
                unit: form.unit,
                quantity: Number(form.quantity || 0),
                min_quantity: Number(form.min_quantity || 0),
                price: Math.round(Number(form.price || 0) * 100),
              });
              setForm({
                name: "",
                unit: "",
                quantity: "",
                min_quantity: "",
                price: "",
              });
              toast(t("Changes saved"));
            } catch (err: any) {
              toast(err.message);
            }
          }}
        >
          {(
            [
              ["name", "Item", "text", true],
              ["unit", "Unit (book, box…)", "text", false],
              ["quantity", "Quantity", "number", false],
              ["min_quantity", "Alert below", "number", false],
              ["price", `${t("Sale price")} (${currency})`, "number", false],
            ] as const
          ).map(([k, label, type, required]) => (
            <label key={k} className="field">
              <span>{t(label)}</span>
              <input
                type={type}
                min={type === "number" ? "0" : undefined}
                required={required}
                value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <Button variant="primary" type="submit">
            {t("Add")}
          </Button>
        </form>
        {items.length === 0 ? (
          <p className="form-hint padded-hint">{t("No item yet.")}</p>
        ) : (
          <div className="today-list">
            {items.map((x) => {
              const low = x.quantity <= x.min_quantity;
              return (
                <div key={x.id} className={`today-row ${low ? "is-late" : ""}`}>
                  <div className="today-main">
                    <strong>
                      {x.name}
                      {low && <Badge tone="amber">{t("Low stock")}</Badge>}
                    </strong>
                    <small>
                      {x.price ? money(x.price, currency) : t("Not sold")}
                      {x.unit ? ` · ${x.unit}` : ""} · {t("alert below")}{" "}
                      {x.min_quantity}
                    </small>
                  </div>
                  <div className="stock-qty">
                    <button
                      className="icon-button"
                      aria-label="−1"
                      onClick={() => change(x, -1)}
                      disabled={x.quantity <= 0}
                    >
                      −
                    </button>
                    <strong>{x.quantity}</strong>
                    <button
                      className="icon-button"
                      aria-label="+1"
                      onClick={() => change(x, 1)}
                    >
                      +
                    </button>
                  </div>
                  <Button
                    variant="small"
                    disabled={x.quantity <= 0}
                    onClick={() => setSell({ id: x.id, contact: "", qty: "1" })}
                  >
                    {t("Sell to a client")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {sell && (
        <Dialog title={t("Sell to a client")} onClose={() => setSell(null)}>
          <div className="form-body">
            <div className="form-grid">
              <label className="field full">
                <span>{t("Client")}</span>
                <select
                  value={sell.contact}
                  onChange={(e) =>
                    setSell({ ...sell, contact: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {data.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("Quantity")}</span>
                <input
                  type="number"
                  min="1"
                  value={sell.qty}
                  onChange={(e) => setSell({ ...sell, qty: e.target.value })}
                />
              </label>
            </div>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => setSell(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={!sell.contact}
              onClick={async () => {
                try {
                  const item = items.find((x) => x.id === sell.id)!;
                  const qty = Number(sell.qty || 1);
                  const r = await perform(`/stock/${sell.id}/sell`, {
                    contact_id: Number(sell.contact),
                    quantity: qty,
                  });
                  setSell(null);
                  if (r.charge_id)
                    open({
                      type: "payment",
                      record: { id: r.charge_id, balance: item.price * qty },
                    });
                  else toast(t("Changes saved"));
                } catch (e: any) {
                  toast(e.message);
                }
              }}
            >
              {t("Sell and take the payment")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
export function LowStockPanel() {
  const { data, t, go } = useApp();
  const low = ((data as any).stock || []).filter(
    (x: Row) => x.quantity <= x.min_quantity,
  );
  if (!low.length) return null;
  return (
    <Panel
      title="Stock running low"
      subtitle="Tell the director to order more."
      action={
        <Button onClick={() => go("Payments", "stock")}>
          {t("Open the stock")}
        </Button>
      }
    >
      <div className="today-list">
        {low.map((x: Row) => (
          <div key={x.id} className="today-row is-late">
            <div className="today-main">
              <strong>{x.name}</strong>
              <small>
                {x.quantity} {x.unit} · {t("alert below")} {x.min_quantity}
              </small>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
