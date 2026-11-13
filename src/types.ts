export type Row = { id: number; [key: string]: any };
export type State = {
  user: Row;
  permissions: Record<string, boolean>;
  settings: Row;
  stages: string[];
  contacts: Row[];
  cohorts: Row[];
  programs: Row[];
  users: Row[];
  opportunities: Row[];
  incoming: Row[];
  n8n?: { configured: boolean; pending: number; lastReceivedAt: string | null };
  enrollments: Row[];
  waitlists: Row[];
  sessions: Row[];
  appointments: Row[];
  packages: Row[];
  templates: Row[];
  trash: Row[];
  staffHours: Row[];
  timeOff: Row[];
  bookingServices: Row[];
  reminders: Row[];
  intake: Row[];
  sessionNotes: Row[];
  placements: Row[];
  grades: Row[];
  certificates: Row[];
  mailConfigured?: boolean;
  serviceTypes: string[];
  attendance: Row[];
  tasks: Row[];
  charges: Row[];
  payments: Row[];
  refunds: Row[];
  activities: Row[];
  documents: Row[];
  drafts: Row[];
  automations: Row[];
  savedViews: Row[];
  flags: any[];
  demo: boolean;
  hosted?: boolean;
  maxDocumentMb?: number;
  today: string;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: any,
  ) {
    super(message);
  }
}
export async function api(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
  retry = 2,
): Promise<any> {
  const idempotencyKey = key || crypto.randomUUID();
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : method,
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  // Two people saved at the same moment: the cloud rejected this copy without
  // saving it, so the same request (same key) can safely be sent again.
  if (
    response.status === 409 &&
    retry > 0 &&
    /Another request saved first/.test(result.error || "")
  ) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
    return api(path, body, method, idempotencyKey, retry - 1);
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error || "Request failed.",
      result,
    );
  return result;
}
export const initials = (name: string) =>
  name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
export const localDate = (date: Date, zone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
export function toInstant(local: string, zone: string) {
  // Resolve a wall-clock value using the configured academy zone, not the browser zone.
  const target = new Date(local + "Z");
  let guess = target.getTime();
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (k: string) => p.find((x) => x.type === k)?.value;
    const represented = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    guess += target.getTime() - represented;
  }
  const result = new Date(guess);
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(result)
    .replace(" ", "T");
  if (p !== local.slice(0, 16))
    throw new Error("That local time does not exist in the academy time zone.");
  return result.toISOString();
}

/** Compare phone numbers however they were typed: spaces, +213, 00213 or 0. */
export function phoneKey(value: string) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("213")) d = "0" + d.slice(3);
  return d;
}
/** True when a search box text matches a person by name, email or phone. */
export function matchesPerson(person: Row, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (`${person.name} ${person.email}`.toLowerCase().includes(q)) return true;
  const digits = phoneKey(q);
  return (
    digits.length >= 3 &&
    phoneKey(person.phone || "").includes(digits.replace(/^0/, ""))
  );
}
