/**
 * Demo data — synthetic doctors + a month of patient activity, so the dashboard can be evaluated with
 * realistic volume WITHOUT touching Zoho. Enabled per-request via `?demo=1`; deterministic (seeded) so
 * numbers stay stable across the 30s poll. NEVER used unless the request explicitly asks for it.
 */
import type { DoctorSummary, DoctorPatients, PatientHit, ZRec } from "./zoho";

const NAMES = [
  "Dr. Anaya Rao", "Dr. Vikram Nair", "Dr. Meera Iyer", "Dr. Arjun Menon", "Dr. Kavya Reddy", "Dr. Rohan Gupta",
  "Dr. Sneha Pillai", "Dr. Aditya Verma", "Dr. Priya Sharma", "Dr. Karan Malhotra", "Dr. Isha Desai",
  "Dr. Nikhil Joshi", "Dr. Tara Bose", "Dr. Sameer Khan", "Dr. Divya Menon", "Dr. Rahul Sinha",
];
const COLOURS = ["red", "amber", "amber", "green", "amber", "red", "green"]; // amber-weighted live queue

/** Deterministic PRNG (mulberry32) — same seed → same data every call. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
const iso = (ms: number) => new Date(ms).toISOString();
const colourOf = (v: unknown): "green" | "amber" | "red" | null => {
  const s = String(v ?? "");
  return s === "green" || s === "amber" || s === "red" ? s : null;
};

export function demoDoctors(): DoctorSummary[] {
  return NAMES.map((name, i) => {
    const id = String(9000000001 + i);
    const phone = "9" + String(800000017 + i * 111317).slice(0, 9);
    return { id, name, phone, loginId: i % 3 === 0 ? phone : "", hasPassword: i % 6 === 1, available: i % 5 !== 0 };
  });
}

/** Synthetic contacts: a live waiting queue (with some SLA breaches + unassigned) + 30 days of decisions. */
export function demoContacts(nowMs: number): { waiting: ZRec[]; decisions: ZRec[] } {
  const r = rng(0x5ea50711);
  const docs = demoDoctors();
  const busy = docs.slice(0, 11); // load concentrated on ~11 doctors; a couple carry more
  const waiting: ZRec[] = [];
  for (let i = 0; i < 55; i++) {
    const unassigned = r() < 0.06;
    const doc = unassigned ? null : (r() < 0.28 ? busy[1]! : pick(r, busy)); // doctor #1 overloaded
    const ageMin = r() < 0.16 ? 1440 + Math.floor(r() * 2200) : Math.floor(r() * 720); // ~16% breach 24h SLA
    waiting.push({
      id: `w${i}`,
      Full_Name: `Patient ${1000 + i}`,
      Assigned_Doctor: doc ? { id: doc.id, name: doc.name } : null,
      Dashboard_Status: r() < 0.5 ? "Queued" : "In Review",
      Triage_Color: pick(r, COLOURS),
      Created_Time: iso(nowMs - ageMin * 60000 - 86400000),
      Modified_Time: iso(nowMs - ageMin * 60000),
    });
  }
  const decisions: ZRec[] = [];
  for (let day = 0; day < 30; day++) {
    const dayMs = nowMs - day * 86400000;
    const dow = new Date(dayMs).getDay();
    const res = (dow === 0 || dow === 6 ? 5 : 15) + Math.floor(r() * 11); // weekend dip
    const rej = Math.floor(r() * 4);
    for (let k = 0; k < res + rej; k++) {
      const doc = pick(r, docs.slice(0, 13));
      const t = dayMs - Math.floor(r() * 79000000);
      decisions.push({
        id: `d${day}-${k}`,
        Full_Name: `Patient ${day}-${k}`,
        Assigned_Doctor: { id: doc.id, name: doc.name },
        Dashboard_Status: k < res ? "Resolved" : "Returned to Concierge",
        Triage_Color: pick(r, COLOURS),
        Created_Time: iso(t - 600000 - Math.floor(r() * 5) * 86400000),
        Modified_Time: iso(t),
      });
    }
  }
  return { waiting, decisions };
}

export function demoDoctorPatients(doctorId: string, nowMs: number): DoctorPatients {
  const { waiting, decisions } = demoContacts(nowMs);
  const out: DoctorPatients = { queued: [], approved: [], rejected: [] };
  const mine = (c: ZRec) => (c.Assigned_Doctor as { id?: string } | null)?.id === doctorId;
  for (const c of waiting) if (mine(c)) out.queued.push({ name: String(c.Full_Name), colour: colourOf(c.Triage_Color), status: String(c.Dashboard_Status) });
  for (const c of decisions) if (mine(c)) {
    const row = { name: String(c.Full_Name), colour: colourOf(c.Triage_Color), status: String(c.Dashboard_Status) };
    if (c.Dashboard_Status === "Resolved") out.approved.push(row); else out.rejected.push(row);
  }
  out.approved = out.approved.slice(0, 40);
  out.rejected = out.rejected.slice(0, 40);
  return out;
}

export function demoSearch(q: string, nowMs: number): PatientHit[] {
  const { waiting } = demoContacts(nowMs);
  const term = q.trim().toLowerCase();
  return waiting
    .filter((c) => String(c.Full_Name).toLowerCase().includes(term))
    .slice(0, 30)
    .map((c) => {
      const doc = c.Assigned_Doctor as { name?: string } | null;
      return {
        id: String(c.id),
        name: String(c.Full_Name),
        status: String(c.Dashboard_Status),
        colour: colourOf(c.Triage_Color),
        doctor: doc?.name || "Unassigned",
        waitedMins: Math.round((nowMs - Date.parse(String(c.Modified_Time))) / 60000),
      };
    });
}

/** True when the request opted into demo mode (?demo query or a demo flag in the JSON body). */
export function isDemo(req: Request, body?: Record<string, unknown>): boolean {
  try {
    if (new URL(req.url).searchParams.has("demo")) return true;
  } catch { /* ignore */ }
  return Boolean(body?.demo);
}
