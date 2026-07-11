/**
 * Minimal server-side Zoho CRM (v8) client for the admin dashboard — a trimmed copy of the doctor
 * dashboard's client. Reads via COQL, writes the Doctors module. Talks to the SAME CRM + fields
 * (Login_Id / Password_Hash on Doctors).
 */
type ZRec = Record<string, unknown>;

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in";
const API = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.in";
const VER = process.env.ZOHO_API_VERSION || "v8";
const CLIENT_ID = process.env.ZOHO_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET ?? "";
const READ_REFRESH = process.env.ZOHO_REFRESH_TOKEN ?? "";
const WRITE_REFRESH = process.env.ZOHO_WRITE_REFRESH_TOKEN ?? "";

export interface ZohoError {
  code?: string;
  status: number;
  detail: string;
}

// ── OAuth: cache access tokens per refresh token, with in-flight single-flight ──
const tokenCache: Record<string, { access: string; exp: number }> = {};
const tokenInflight: Record<string, Promise<string>> = {};

// The admin app writes the Doctors module and reads via COQL, so it prefers the full-access write
// token for everything, falling back to the read token when a write token isn't configured.
async function accessToken(): Promise<string> {
  const refresh = WRITE_REFRESH || READ_REFRESH;
  if (!refresh) throw { status: 500, detail: "no_refresh_token" } as ZohoError;

  const cached = tokenCache[refresh];
  if (cached && cached.exp > Date.now() + 60_000) return cached.access;
  if (tokenInflight[refresh]) return tokenInflight[refresh];

  const p = (async () => {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
    });
    const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params.toString()}`, { method: "POST", cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!j.access_token) throw { code: "TOKEN_ERROR", status: res.status, detail: j.error || "token_error" } as ZohoError;
    tokenCache[refresh] = { access: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  })().finally(() => {
    delete tokenInflight[refresh];
  });
  tokenInflight[refresh] = p;
  return p;
}

function isId(v: unknown): v is string {
  return typeof v === "string" && /^\d{6,}$/.test(v);
}

async function zohoCoql(selectQuery: string): Promise<ZRec[]> {
  const token = await accessToken();
  const res = await fetch(`${API}/crm/${VER}/coql`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ select_query: selectQuery }),
    cache: "no-store",
  });
  if (res.status === 204) return [];
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try { code = (JSON.parse(text) as ZRec).code as string; } catch { /* non-json */ }
    throw { code, status: res.status, detail: text.slice(0, 300) } as ZohoError;
  }
  try {
    return ((JSON.parse(text) as { data?: ZRec[] }).data ?? []) as ZRec[];
  } catch {
    return [];
  }
}

/** List records via the plain records API (GET). Needs only ZohoCRM.modules.READ — no COQL scope. */
async function zohoGetRecords(module: string, fields: string, query = ""): Promise<ZRec[]> {
  const token = await accessToken();
  const res = await fetch(`${API}/crm/${VER}/${encodeURIComponent(module)}?fields=${encodeURIComponent(fields)}${query}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  if (res.status === 204) return [];
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try { code = (JSON.parse(text) as ZRec).code as string; } catch { /* non-json */ }
    throw { code, status: res.status, detail: text.slice(0, 300) } as ZohoError;
  }
  try { return ((JSON.parse(text) as { data?: ZRec[] }).data ?? []) as ZRec[]; } catch { return []; }
}

/** Filtered read via the Search API (GET). Needs only ZohoCRM.modules.READ — the COQL-less fallback. */
async function zohoSearch(module: string, criteria: string, fields: string): Promise<ZRec[]> {
  const token = await accessToken();
  const url = `${API}/crm/${VER}/${encodeURIComponent(module)}/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent(fields)}&per_page=200`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store" });
  if (res.status === 204) return [];
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try { code = (JSON.parse(text) as ZRec).code as string; } catch { /* non-json */ }
    throw { code, status: res.status, detail: text.slice(0, 300) } as ZohoError;
  }
  try { return ((JSON.parse(text) as { data?: ZRec[] }).data ?? []) as ZRec[]; } catch { return []; }
}

async function zohoUpdate(module: string, id: string, fields: ZRec): Promise<void> {
  const token = await accessToken();
  const res = await fetch(`${API}/crm/${VER}/${encodeURIComponent(module)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [fields] }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try { code = (JSON.parse(text) as ZRec).code as string; } catch { /* non-json */ }
    throw { code, status: res.status, detail: text.slice(0, 300) } as ZohoError;
  }
  // A 200 can still carry a per-record failure (e.g. INVALID_DATA).
  try {
    const row = (JSON.parse(text) as { data?: Array<{ code?: string }> }).data?.[0];
    if (row?.code && row.code !== "SUCCESS") throw { code: row.code, status: 400, detail: text.slice(0, 300) } as ZohoError;
  } catch (e) {
    if ((e as ZohoError)?.code) throw e;
  }
}

// ── Admin data ────────────────────────────────────────────────────────────────
export interface DoctorSummary {
  id: string;
  name: string;
  phone: string;
  loginId: string;
  hasPassword: boolean;
  available: boolean;
}

/** Every doctor with a login summary, sorted by name. Never exposes the password hash. */
export async function listDoctors(): Promise<DoctorSummary[]> {
  const FIELDS = "id,Name,Phone_Number,Login_Id,Password_Hash,Available";
  let rows: ZRec[];
  try {
    rows = await zohoCoql(`SELECT ${FIELDS.replace(/,/g, ", ")} FROM Doctors WHERE id is not null ORDER BY Name ASC LIMIT 200`);
  } catch (e) {
    if (!isScopeError(e)) throw e; // token lacks COQL scope → list via the records API (modules.READ)
    rows = await zohoGetRecords("Doctors", FIELDS, "&per_page=200"); // Name isn't a sortable param here — sort below
  }
  return rows
    .filter((r) => isId(r.id))
    .map((r) => ({
      id: String(r.id),
      name: String(r.Name ?? ""),
      phone: String(r.Phone_Number ?? ""),
      loginId: String(r.Login_Id ?? ""),
      hasPassword: Boolean(String(r.Password_Hash ?? "").trim()),
      available: r.Available !== false, // default to available unless explicitly false
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PatientRow {
  name: string;
  colour: "green" | "amber" | "red" | null;
  status: string;
}
export interface DoctorPatients {
  queued: PatientRow[];
  approved: PatientRow[];
  rejected: PatientRow[];
}

function mapColour(v: unknown): "green" | "amber" | "red" | null {
  const s = String(v ?? "").toLowerCase();
  return s === "green" || s === "amber" || s === "red" ? s : null;
}

/** One doctor's dashboard patients, bucketed queued / approved / rejected. */
export async function doctorPatients(doctorId: string): Promise<DoctorPatients> {
  const out: DoctorPatients = { queued: [], approved: [], rejected: [] };
  if (!isId(doctorId)) return out;
  const FIELDS = "id,Full_Name,Dashboard_Status,Triage_Color,Modified_Time";
  const STATUSES = ["Queued", "In Review", "Resolved", "Returned to Concierge"];
  let rows: ZRec[];
  try {
    rows = await zohoCoql(
      `SELECT ${FIELDS.replace(/,/g, ", ")} FROM Contacts WHERE Assigned_Doctor = ${doctorId} ` +
        `AND Dashboard_Status in (${STATUSES.map((s) => `'${s}'`).join(", ")}) ORDER BY Modified_Time DESC LIMIT 200`,
    );
  } catch (e) {
    if (!isScopeError(e)) throw e; // no COQL scope → filtered read via the Search API (modules.READ)
    const crit = `(Assigned_Doctor:equals:${doctorId})and(${STATUSES.map((s) => `(Dashboard_Status:equals:${s})`).join("or")})`;
    rows = await zohoSearch("Contacts", crit, FIELDS);
  }
  for (const c of rows) {
    const row: PatientRow = { name: String(c.Full_Name ?? "Patient"), colour: mapColour(c.Triage_Color), status: String(c.Dashboard_Status ?? "") };
    if (row.status === "Queued" || row.status === "In Review") out.queued.push(row);
    else if (row.status === "Resolved") out.approved.push(row);
    else if (row.status === "Returned to Concierge") out.rejected.push(row);
  }
  return out;
}

/** Persist a doctor's custom login id + hashed password. Needs a write-scoped token. */
export async function setDoctorCredentials(doctorId: string, loginId: string, passwordHash: string): Promise<void> {
  await zohoUpdate("Doctors", doctorId, { Login_Id: loginId, Password_Hash: passwordHash });
}

export function isScopeError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as ZohoError).code === "OAUTH_SCOPE_MISMATCH";
}

// ── Metrics ─────────────────────────────────────────────────────────────────
const SLA_HOURS = Number(process.env.SLA_HOURS || 24);
const C_FIELDS = "id,Full_Name,Assigned_Doctor,Dashboard_Status,Triage_Color,Created_Time,Modified_Time";
const SAMPLE_LIMIT = 200; // most-recent active contacts scanned for metrics

function lookupId(v: unknown): string {
  if (v && typeof v === "object") return String((v as { id?: unknown }).id ?? "");
  return String(v ?? "");
}
function minsSince(iso: unknown): number | null {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}
function minsBetween(startIso: unknown, endIso: unknown): number | null {
  const a = Date.parse(String(startIso ?? "")), b = Date.parse(String(endIso ?? ""));
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null;
}
function avg(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
const WAIT_BUCKETS: { label: string; max: number }[] = [
  { label: "<1h", max: 60 }, { label: "1–4h", max: 240 }, { label: "4–12h", max: 720 }, { label: "12–24h", max: 1440 }, { label: ">24h", max: Infinity },
];
function istYmd(ms: number): string {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST calendar date
}
/** Zoho COQL/Search datetime literal: IST wall-clock, no milliseconds, explicit +05:30 offset. */
function zohoDateTime(ms: number): string {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "") + "+05:30";
}

const DECISION_WINDOW_DAYS = 8; // resolved/returned scanned this far back — covers today + the 7-day chart

/** Currently WAITING patients (Queued / In Review). Ordered OLDEST-first so if the cap is hit it drops
 *  the newest (not-yet-breaching) rows and KEEPS the oldest — the ones SLA/oldest-wait metrics need. */
async function waitingContacts(): Promise<ZRec[]> {
  try {
    return await zohoCoql(
      `SELECT ${C_FIELDS.replace(/,/g, ", ")} FROM Contacts ` +
        `WHERE Dashboard_Status in ('Queued', 'In Review') ORDER BY Modified_Time ASC LIMIT ${SAMPLE_LIMIT}`,
    );
  } catch (e) {
    if (!isScopeError(e)) throw e;
    return await zohoSearch("Contacts", "((Dashboard_Status:equals:Queued)or(Dashboard_Status:equals:In Review))", C_FIELDS);
  }
}

/** Recent DECISIONS (Resolved / Returned) within the window — feeds today, throughput, approve rate.
 *  Kept SEPARATE from the waiting scan so a burst of decisions can't evict long-waiting patients. */
async function recentDecisions(): Promise<ZRec[]> {
  const since = zohoDateTime(Date.now() - DECISION_WINDOW_DAYS * 86400000);
  try {
    return await zohoCoql(
      `SELECT ${C_FIELDS.replace(/,/g, ", ")} FROM Contacts ` +
        `WHERE Dashboard_Status in ('Resolved', 'Returned to Concierge') and Modified_Time >= '${since}' ORDER BY Modified_Time DESC LIMIT ${SAMPLE_LIMIT}`,
    );
  } catch (e) {
    if (!isScopeError(e)) throw e;
    const crit = `((Dashboard_Status:equals:Resolved)or(Dashboard_Status:equals:Returned to Concierge))and(Modified_Time:greater_equal:${since})`;
    return await zohoSearch("Contacts", crit, C_FIELDS);
  }
}

export interface DoctorLoad {
  id: string;
  name: string;
  available: boolean;
  managed: boolean;
  queued: number;
  inReview: number;
  resolved: number;
  rejected: number;
  waiting: number;
  breaching: number;
  avgWaitMins: number | null;
  oldestWaitMins: number | null;
  approveRatePct: number | null;
}
export interface OrgMetrics {
  totals: { queued: number; inReview: number; resolved: number; rejected: number; active: number };
  waiting: { count: number; avgMins: number | null; medianMins: number | null; maxMins: number | null; breaching: number };
  waitBuckets: { label: string; count: number }[];
  today: { resolved: number; rejected: number };
  approveRatePct: number | null;
  avgResolveMins: number | null;
  byColour: { green: number; amber: number; red: number; none: number };
  throughput: { date: string; resolved: number; rejected: number }[];
  unassigned: number;
  doctorsTotal: number;
  doctorsAvailable: number;
  slaHours: number;
  sampleCapped: boolean;
  byDoctor: DoctorLoad[];
}

/** Org-wide operational metrics computed from one scan of active contacts + the doctor roster. */
export async function orgMetrics(): Promise<OrgMetrics> {
  const [waiting, decisions, doctors] = await Promise.all([waitingContacts(), recentDecisions(), listDoctors()]);
  const contacts = [...waiting, ...decisions];
  const docMap = new Map(doctors.map((d) => [d.id, d]));
  const load = new Map<string, DoctorLoad>();
  const ensure = (id: string): DoctorLoad => {
    let l = load.get(id);
    if (!l) {
      const d = docMap.get(id);
      l = { id, name: d?.name || (id ? "(unknown)" : "Unassigned"), available: d?.available ?? true, managed: Boolean(d?.loginId), queued: 0, inReview: 0, resolved: 0, rejected: 0, waiting: 0, breaching: 0, avgWaitMins: null, oldestWaitMins: null, approveRatePct: null };
      load.set(id, l);
    }
    return l;
  };
  const waitAges: number[] = [];
  const perDoctorWaits = new Map<string, number[]>();
  const resolveMins: number[] = [];
  const totals = { queued: 0, inReview: 0, resolved: 0, rejected: 0, active: contacts.length };
  const byColour = { green: 0, amber: 0, red: 0, none: 0 };
  const today = { resolved: 0, rejected: 0 };
  const todayYmd = istYmd(Date.now());
  const tp = new Map<string, number>(); // istYmd → resolved count
  const tpRej = new Map<string, number>(); // istYmd → rejected count
  let breaching = 0, unassigned = 0;

  for (const c of contacts) {
    const status = String(c.Dashboard_Status ?? "");
    const did = lookupId(c.Assigned_Doctor);
    const l = ensure(did);

    if (status === "Queued" || status === "In Review") {
      if (!did) unassigned++; // only LIVE patients matter for "nobody's handling this"
      const colour = String(c.Triage_Color ?? "").toLowerCase(); // colour mix = the live queue, not decided cases
      if (colour === "green" || colour === "amber" || colour === "red") byColour[colour]++;
      else byColour.none++;
      if (status === "Queued") { totals.queued++; l.queued++; } else { totals.inReview++; l.inReview++; }
      l.waiting++;
      const age = minsSince(c.Modified_Time);
      if (age != null) {
        waitAges.push(age);
        (perDoctorWaits.get(did) ?? perDoctorWaits.set(did, []).get(did)!).push(age);
        if (age > SLA_HOURS * 60) { breaching++; l.breaching++; }
      }
    } else if (status === "Resolved") {
      totals.resolved++; l.resolved++;
      const lat = minsBetween(c.Created_Time, c.Modified_Time);
      if (lat != null) resolveMins.push(lat);
      const ymd = istYmd(Date.parse(String(c.Modified_Time ?? "")) || 0);
      tp.set(ymd, (tp.get(ymd) ?? 0) + 1);
      if (ymd === todayYmd) today.resolved++;
    } else if (status === "Returned to Concierge") {
      totals.rejected++; l.rejected++;
      const rymd = istYmd(Date.parse(String(c.Modified_Time ?? "")) || 0);
      tpRej.set(rymd, (tpRej.get(rymd) ?? 0) + 1);
      if (rymd === todayYmd) today.rejected++;
    }
  }

  for (const [id, ages] of perDoctorWaits) {
    const l = load.get(id);
    if (l) { l.avgWaitMins = avg(ages); l.oldestWaitMins = ages.length ? Math.max(...ages) : null; }
  }
  for (const l of load.values()) {
    const dec = l.resolved + l.rejected;
    l.approveRatePct = dec ? Math.round((l.resolved / dec) * 100) : null;
  }

  const throughput = Array.from({ length: 7 }, (_, i) => {
    const ymd = istYmd(Date.now() - (6 - i) * 86400000);
    return { date: ymd, resolved: tp.get(ymd) ?? 0, rejected: tpRej.get(ymd) ?? 0 };
  });
  const waitBuckets = WAIT_BUCKETS.map((b, i) => ({
    label: b.label,
    count: waitAges.filter((a) => a < b.max && a >= (i === 0 ? 0 : WAIT_BUCKETS[i - 1]!.max)).length,
  }));
  const decided = totals.resolved + totals.rejected;

  return {
    totals,
    waiting: { count: waitAges.length, avgMins: avg(waitAges), medianMins: median(waitAges), maxMins: waitAges.length ? Math.max(...waitAges) : null, breaching },
    waitBuckets,
    today,
    approveRatePct: decided ? Math.round((totals.resolved / decided) * 100) : null,
    avgResolveMins: avg(resolveMins),
    byColour,
    throughput,
    unassigned,
    doctorsTotal: doctors.length,
    doctorsAvailable: doctors.filter((d) => d.available).length,
    slaHours: SLA_HOURS,
    sampleCapped: waiting.length >= SAMPLE_LIMIT || decisions.length >= SAMPLE_LIMIT,
    byDoctor: [...load.values()].filter((l) => l.queued + l.inReview + l.resolved + l.rejected > 0).sort((a, b) => b.waiting - a.waiting || b.queued - a.queued || a.name.localeCompare(b.name)),
  };
}

// ── Global patient search ─────────────────────────────────────────────────────
export interface PatientHit {
  id: string;
  name: string;
  status: string;
  colour: "green" | "amber" | "red" | null;
  doctor: string;
  waitedMins: number | null;
}
/** Find patients by name (starts-with) across the dashboard, with their doctor + status. */
export async function searchPatients(q: string): Promise<PatientHit[]> {
  const term = q.trim().replace(/[()<>:,]/g, ""); // strip Zoho criteria metacharacters
  if (term.length < 2) return [];
  const rows = await zohoSearch("Contacts", `(Full_Name:starts_with:${term})`, "id,Full_Name,Dashboard_Status,Triage_Color,Assigned_Doctor,Modified_Time");
  return rows.slice(0, 50).map((c) => ({
    id: String(c.id),
    name: String(c.Full_Name ?? "Patient"),
    status: String(c.Dashboard_Status ?? "—"),
    colour: mapColour(c.Triage_Color),
    doctor: (c.Assigned_Doctor && typeof c.Assigned_Doctor === "object" ? String((c.Assigned_Doctor as { name?: unknown }).name ?? "") : "") || "Unassigned",
    waitedMins: minsSince(c.Modified_Time),
  }));
}

// ── Write ops (need a write-scoped token; 503 without one) ────────────────────
/** Move a patient to a different doctor's dashboard queue. */
export async function reassignPatient(contactId: string, doctorId: string): Promise<void> {
  await zohoUpdate("Contacts", contactId, { Assigned_Doctor: { id: doctorId } });
}
/** Toggle a doctor in/out of routing (the Doctors.Available flag). */
export async function setAvailability(doctorId: string, available: boolean): Promise<void> {
  await zohoUpdate("Doctors", doctorId, { Available: available });
}
/** Add a CRM doctor to the managed roster by seeding a Login_Id (defaults to their phone). */
export async function addToRoster(doctorId: string, loginId: string): Promise<void> {
  await zohoUpdate("Doctors", doctorId, { Login_Id: loginId });
}
/** Remove a doctor from the managed roster (clear login + password). */
export async function removeFromRoster(doctorId: string): Promise<void> {
  await zohoUpdate("Doctors", doctorId, { Login_Id: null, Password_Hash: null });
}
/** Clear only the password → the doctor logs in with their login id + name (stays on the roster). */
export async function resetPassword(doctorId: string): Promise<void> {
  await zohoUpdate("Doctors", doctorId, { Password_Hash: null });
}
