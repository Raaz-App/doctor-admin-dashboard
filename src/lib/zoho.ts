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
}

/** Every doctor with a login summary, sorted by name. Never exposes the password hash. */
export async function listDoctors(): Promise<DoctorSummary[]> {
  const rows = await zohoCoql(
    "SELECT id, Name, Phone_Number, Login_Id, Password_Hash FROM Doctors WHERE id is not null ORDER BY Name ASC LIMIT 200",
  );
  return rows
    .filter((r) => isId(r.id))
    .map((r) => ({
      id: String(r.id),
      name: String(r.Name ?? ""),
      phone: String(r.Phone_Number ?? ""),
      loginId: String(r.Login_Id ?? ""),
      hasPassword: Boolean(String(r.Password_Hash ?? "").trim()),
    }));
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
  const rows = await zohoCoql(
    "SELECT id, Full_Name, Dashboard_Status, Triage_Color, Modified_Time FROM Contacts " +
      `WHERE Assigned_Doctor = ${doctorId} ` +
      "AND Dashboard_Status in ('Queued', 'In Review', 'Resolved', 'Returned to Concierge') " +
      "ORDER BY Modified_Time DESC LIMIT 200",
  );
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
