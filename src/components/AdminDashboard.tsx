"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Doctor { id: string; name: string; phone: string; loginId: string; hasPassword: boolean; available: boolean }
interface PatientRow { name: string; colour: "green" | "amber" | "red" | null; status: string; id?: string }
interface Buckets { queued: PatientRow[]; approved: PatientRow[]; rejected: PatientRow[] }
interface DoctorLoad {
  id: string; name: string; available: boolean; managed: boolean;
  queued: number; inReview: number; resolved: number; rejected: number;
  waiting: number; breaching: number; avgWaitMins: number | null; oldestWaitMins: number | null; approveRatePct: number | null;
}
interface Metrics {
  totals: { queued: number; inReview: number; resolved: number; rejected: number; active: number };
  waiting: { count: number; avgMins: number | null; medianMins: number | null; maxMins: number | null; breaching: number };
  waitBuckets: { label: string; count: number }[];
  today: { resolved: number; rejected: number };
  approveRatePct: number | null;
  byColour: { green: number; amber: number; red: number; none: number };
  throughput: { date: string; resolved: number; rejected: number }[];
  unassigned: number; doctorsTotal: number; doctorsAvailable: number; slaHours: number; sampleCapped: boolean;
  byDoctor: DoctorLoad[];
}

const EMPTY: Buckets = { queued: [], approved: [], rejected: [] };

function fmtMins(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/** Shared metrics fetch + 30s refresh. */
function useMetrics(): { m: Metrics | null; status: string } {
  const [m, setM] = useState<Metrics | null>(null);
  const [status, setStatus] = useState("Loading…");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/metrics");
        const data = (await res.json().catch(() => ({}))) as Metrics & { message?: string };
        if (!live) return;
        if (res.status !== 200 || !data.totals) setStatus(data.message || "Couldn't load metrics.");
        else setM(data);
      } catch { if (live) setStatus("Couldn't reach the server."); }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);
  return { m, status };
}

/** Shared doctor-roster fetch. */
function useDoctors(): { doctors: Doctor[] | null; status: string; patch: (id: string, p: Partial<Doctor>) => void; reload: () => void } {
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [status, setStatus] = useState("Loading doctors…");
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/doctors");
      const data = (await res.json().catch(() => ({}))) as { doctors?: Doctor[]; message?: string };
      if (res.status !== 200 || !data.doctors) { setStatus(data.message || "Couldn't load doctors."); return; }
      setDoctors(data.doctors);
    } catch { setStatus("Couldn't reach the server."); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const patch = (id: string, p: Partial<Doctor>) => setDoctors((prev) => prev?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? prev);
  return { doctors, status, patch, reload };
}

export function AdminDashboard() {
  const [tab, setTab] = useState<"home" | "metrics" | "security">("home");
  const [focusDoctorId, setFocusDoctorId] = useState<string | null>(null);
  const NAV = [
    { k: "home", label: "Home", icon: "🏠" },
    { k: "metrics", label: "Metrics", icon: "📊" },
    { k: "security", label: "Security", icon: "🔑" },
  ] as const;
  return (
    <div className="shell">
      <aside className="sidenav">
        {NAV.map((n) => (
          <button key={n.k} type="button" className={"navitem" + (tab === n.k ? " navitem--on" : "")} onClick={() => setTab(n.k)}>
            <span className="navitem__ic" aria-hidden="true">{n.icon}</span>
            <span className="navitem__lbl">{n.label}</span>
          </button>
        ))}
      </aside>
      <main className="content">
        {tab === "home" && <Home />}
        {tab === "metrics" && <MetricsModule focusDoctorId={focusDoctorId} setFocusDoctorId={setFocusDoctorId} />}
        {tab === "security" && <SecurityModule />}
      </main>
    </div>
  );
}

/* ─────────────────────────── HOME — combined totals ─────────────────────────── */

/** Small ⓘ that explains how a (possibly non-obvious) metric is calculated. Native title = tooltip. */
function Info({ text }: { text: string }) {
  return <span className="info" tabIndex={0} role="img" aria-label={"How it's calculated — " + text} title={text}>ⓘ</span>;
}

function Kpi({ label, value, sub, tone, info }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "good" | "bad"; info?: string }) {
  return (
    <div className={"kpi" + (tone ? " kpi--" + tone : "")}>
      <div className="kpi__v">{value}</div>
      <div className="kpi__l">{label}{info && <Info text={info} />}</div>
      {sub && <div className="kpi__s">{sub}</div>}
    </div>
  );
}

function Home() {
  const { m, status } = useMetrics();
  if (!m) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;
  const tpMax = Math.max(1, ...m.throughput.map((t) => t.resolved + t.rejected));
  const colTotal = Math.max(1, m.byColour.green + m.byColour.amber + m.byColour.red);
  const wbMax = Math.max(1, ...m.waitBuckets.map((b) => b.count));
  const docWait = [...m.byDoctor].filter((d) => d.waiting > 0).sort((a, b) => b.waiting - a.waiting).slice(0, 8);
  const docMax = Math.max(1, ...docWait.map((d) => d.waiting));
  return (
    <div className="ov">
      <div className="kpis">
        <Kpi label="Waiting now" value={m.waiting.count} sub={`avg ${fmtMins(m.waiting.avgMins)} · median ${fmtMins(m.waiting.medianMins)} · oldest ${fmtMins(m.waiting.maxMins)}`} tone={m.waiting.count ? "warn" : undefined} info="Patients whose status is Queued or In Review. Wait = time since last actioned (Modified_Time). Median is the middle wait — less skewed by one very old patient than the average." />
        <Kpi label={`SLA breaches (>${m.slaHours}h)`} value={m.waiting.breaching} tone={m.waiting.breaching ? "bad" : "good"} info={`Waiting patients whose wait exceeds the ${m.slaHours}h SLA. Tune with the SLA_HOURS env var.`} />
        <Kpi label="Queued" value={m.totals.queued} info="Contacts with Dashboard_Status = Queued (sent to a doctor, not yet opened)." />
        <Kpi label="In review" value={m.totals.inReview} info="Contacts a doctor has opened (In Review) but not yet resolved." />
        <Kpi label="Resolved today" value={m.today.resolved} tone="good" info="Contacts moved to Resolved (approved) whose last change is today (IST)." />
        <Kpi label="Rejected today" value={m.today.rejected} info="Contacts moved to Returned to Concierge today (IST)." />
        <Kpi label="Approve rate" value={m.approveRatePct == null ? "—" : `${m.approveRatePct}%`} info="Resolved ÷ (Resolved + Returned to Concierge), across the scanned sample. Still-waiting patients are excluded." />
        <Kpi label="Active doctors" value={m.byDoctor.length} info="Doctors currently handling at least one active patient (queued / in review / recently resolved)." />
        <Kpi label="Unassigned" value={m.unassigned} tone={m.unassigned ? "warn" : undefined} info="Active patients with no Assigned_Doctor — nobody is routed to review them." />
        <Kpi label="Active patients" value={m.totals.active} sub={m.sampleCapped ? `latest ${m.totals.active} scanned` : "all live"} info={`All Queued / In Review / Resolved / Returned contacts scanned (most recent ${m.totals.active}).`} />
      </div>

      <div className="ov__row">
        <div className="panel ov__card">
          <div className="panel__h">Live queue by triage colour</div>
          <div className="colbar">
            {(["red", "amber", "green"] as const).map((c) => (
              <div key={c} className="colbar__row">
                <span className={"dot dot--" + c} /><span className="colbar__lbl">{c}</span>
                <div className="colbar__track"><div className={"colbar__fill colbar__fill--" + c} style={{ width: `${(m.byColour[c] / colTotal) * 100}%` }} /></div>
                <span className="colbar__n">{m.byColour[c]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel ov__card">
          <div className="panel__h">Wait-time distribution <Info text="How long the currently-waiting patients have each been waiting, bucketed. A tall >24h bar = SLA risk." /></div>
          <div className="spark">
            {m.waitBuckets.map((b) => (
              <div key={b.label} className="spark__col" title={`${b.label}: ${b.count}`}>
                <div className={"spark__bar" + (b.label === ">24h" && b.count ? " spark__bar--bad" : "")} style={{ height: `${(b.count / wbMax) * 100}%` }} />
                <span className="spark__n">{b.count}</span><span className="spark__x">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ov__row">
        <div className="panel ov__card">
          <div className="panel__h">Resolved vs rejected · last 7 days <Info text="Daily throughput. Green = resolved (approved), red = returned to concierge, stacked per day (IST)." /></div>
          <div className="spark">
            {m.throughput.map((t) => (
              <div key={t.date} className="spark__col" title={`${t.date}: ${t.resolved} resolved, ${t.rejected} rejected`}>
                <div className="spark__stack" style={{ height: `${((t.resolved + t.rejected) / tpMax) * 100}%` }}>
                  <div className="spark__seg spark__seg--rej" style={{ flex: t.rejected }} />
                  <div className="spark__seg spark__seg--res" style={{ flex: t.resolved }} />
                </div>
                <span className="spark__n">{t.resolved + t.rejected}</span><span className="spark__x">{t.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel ov__card">
          <div className="panel__h">Waiting patients by doctor <Info text="Who has the biggest live backlog — top doctors by number of Queued + In Review patients." /></div>
          <div className="hbar">
            {docWait.length === 0 && <div className="bucket__empty" style={{ padding: "6px 2px" }}>No one waiting.</div>}
            {docWait.map((d) => (
              <div key={d.id} className="hbar__row">
                <span className="hbar__lbl" title={d.name}>{d.name}</span>
                <div className="hbar__track"><div className={"hbar__fill" + (d.breaching ? " hbar__fill--bad" : "")} style={{ width: `${(d.waiting / docMax) * 100}%` }} /></div>
                <span className="hbar__n">{d.waiting}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── METRICS — per doctor ─────────────────────────── */

function MetricsModule({ focusDoctorId, setFocusDoctorId }: { focusDoctorId: string | null; setFocusDoctorId: (id: string | null) => void }) {
  const { m, status } = useMetrics();
  const { doctors, patch } = useDoctors();
  if (!m) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;

  const focus = focusDoctorId ? m.byDoctor.find((d) => d.id === focusDoctorId) ?? null : null;
  if (focus) {
    return <DoctorPerformance load={focus} doctors={doctors ?? []} onPatch={patch} onBack={() => setFocusDoctorId(null)} />;
  }
  return (
    <div className="panel">
      <div className="panel__h">Doctor performance {m.sampleCapped && <span className="cap">· latest {m.totals.active} scanned</span>} — click a row</div>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead><tr><th>Doctor</th><th>Status</th><th className="num">Queued</th><th className="num">In review</th><th className="num">Waiting</th><th className="num">Avg wait</th><th className="num">Oldest</th><th className="num">Resolved</th><th className="num">Rejected</th></tr></thead>
          <tbody>
            {m.byDoctor.map((d) => (
              <tr key={d.id} className={d.id ? "tbl__click" : ""} onClick={() => d.id && setFocusDoctorId(d.id)}>
                <td>{d.name}</td>
                <td><span className={"badge " + (d.available ? "badge--on" : "badge--off")}>{d.available ? "available" : "off"}</span></td>
                <td className="num">{d.queued}</td><td className="num">{d.inReview}</td>
                <td className={"num" + (d.oldestWaitMins != null && d.oldestWaitMins > m.slaHours * 60 ? " num--bad" : "")}>{d.waiting}</td>
                <td className="num">{fmtMins(d.avgWaitMins)}</td><td className="num">{fmtMins(d.oldestWaitMins)}</td>
                <td className="num">{d.resolved}</td><td className="num">{d.rejected}</td>
              </tr>
            ))}
            {m.byDoctor.length === 0 && <tr><td colSpan={9} className="bucket__empty">No active patients right now.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DoctorPerformance({ load, doctors, onPatch, onBack }: { load: DoctorLoad; doctors: Doctor[]; onPatch: (id: string, p: Partial<Doctor>) => void; onBack: () => void }) {
  const [buckets, setBuckets] = useState<Buckets>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const doc = doctors.find((d) => d.id === load.id);
  const available = doc?.available ?? load.available;

  const loadPatients = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/doctor-patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctorId: load.id }) });
      const data = (await res.json().catch(() => ({}))) as Partial<Buckets> & { message?: string };
      if (res.status !== 200) setError(data.message || "Couldn't load patients.");
      else setBuckets({ queued: data.queued ?? [], approved: data.approved ?? [], rejected: data.rejected ?? [] });
    } catch { setError("Couldn't reach the server."); } finally { setLoading(false); }
  }, [load.id]);
  useEffect(() => { loadPatients(); }, [loadPatients]);

  async function toggleAvailable() {
    const next = !available;
    onPatch(load.id, { available: next });
    const res = await fetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctorId: load.id, available: next }) }).catch(() => null);
    if (!res || !res.ok) { onPatch(load.id, { available: !next }); const d = await res?.json().catch(() => ({})); alert((d as { message?: string })?.message || "Couldn't update availability."); }
  }

  return (
    <div className="perf">
      <button type="button" className="back" onClick={onBack}>← All doctors</button>
      <div className="perf__head panel">
        <div>
          <h2 className="detail__name">{load.name}</h2>
          <div className="detail__meta">{load.waiting} waiting · avg {fmtMins(load.avgWaitMins)} · oldest {fmtMins(load.oldestWaitMins)}</div>
        </div>
        <button type="button" className={"avtoggle " + (available ? "avtoggle--on" : "avtoggle--off")} onClick={toggleAvailable} title="Toggle routing availability">
          {available ? "● Available" : "○ Off"}
        </button>
      </div>
      <div className="kpis kpis--tight">
        <Kpi label="Queued" value={load.queued} info="This doctor's Queued patients (sent, not yet opened)." />
        <Kpi label="In review" value={load.inReview} info="Opened by this doctor (In Review), not yet resolved." />
        <Kpi label="Waiting" value={load.waiting} tone={load.waiting ? "warn" : undefined} info="Queued + In Review for this doctor — everyone still awaiting a decision." />
        <Kpi label="Avg wait" value={fmtMins(load.avgWaitMins)} info="Mean time-since-last-action across this doctor's waiting patients." />
        <Kpi label="Oldest wait" value={fmtMins(load.oldestWaitMins)} tone={load.breaching ? "bad" : undefined} info="The single longest-waiting patient for this doctor." />
        <Kpi label="SLA breaches" value={load.breaching} tone={load.breaching ? "bad" : "good"} info="This doctor's waiting patients past the SLA." />
        <Kpi label="Resolved" value={load.resolved} tone="good" info="Approved by this doctor in the scanned sample." />
        <Kpi label="Rejected" value={load.rejected} info="Returned to Concierge by this doctor in the sample." />
        <Kpi label="Approve rate" value={load.approveRatePct == null ? "—" : `${load.approveRatePct}%`} info="Resolved ÷ (Resolved + Rejected) for this doctor." />
      </div>
      <div className="panel">
        <div className="panel__h">Patients</div>
        {error ? <div className="status status--error">{error}</div>
          : loading ? <div className="status">Loading patients…</div>
          : (
            <div className="buckets">
              <Bucket title="Queued" rows={buckets.queued} doctors={doctors} currentId={load.id} onReassigned={loadPatients} />
              <Bucket title="Approved" rows={buckets.approved} />
              <Bucket title="Rejected" rows={buckets.rejected} />
            </div>
          )}
      </div>
    </div>
  );
}

function Bucket({ title, rows, doctors, currentId, onReassigned }: { title: string; rows: PatientRow[]; doctors?: Doctor[]; currentId?: string; onReassigned?: () => void }) {
  return (
    <div>
      <div className="bucket__h"><span>{title}</span><span className="bucket__count">{rows.length}</span></div>
      <div className="bucket__list">
        {rows.length === 0 && <div className="bucket__empty">None.</div>}
        {rows.map((p, i) => (
          <div key={p.id ?? i} className={"pcard" + (p.colour ? " pcard--" + p.colour : "")}>
            <span className="pcard__dot" aria-hidden="true" />
            <span className="pcard__name">{p.name}</span>
            <span className="pcard__status">{p.status}</span>
            {doctors && p.id && currentId && onReassigned && <Reassign patientId={p.id} doctors={doctors} currentId={currentId} onDone={onReassigned} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Reassign({ patientId, doctors, currentId, onDone }: { patientId: string; doctors: Doctor[]; currentId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function move(toId: string) {
    if (!toId || toId === currentId) return;
    setBusy(true);
    const res = await fetch("/api/reassign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: patientId, doctorId: toId }) }).catch(() => null);
    setBusy(false);
    if (res && res.ok) onDone();
    else { const d = await res?.json().catch(() => ({})); alert((d as { message?: string })?.message || "Couldn't reassign."); }
  }
  return (
    <select className="reassign" disabled={busy} defaultValue="" onChange={(e) => move(e.target.value)} title="Reassign to another doctor">
      <option value="">{busy ? "…" : "→ move"}</option>
      {doctors.filter((d) => d.id !== currentId && d.available).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}

/* ─────────────────────────── SECURITY — login + password ─────────────────────────── */

function SecurityModule() {
  const { doctors, status, patch, reload } = useDoctors();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const managed = useMemo(() => (doctors ?? []).filter((d) => d.loginId), [doctors]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return managed;
    return managed.filter((d) => d.name.toLowerCase().includes(q) || d.phone.includes(q) || d.loginId.toLowerCase().includes(q));
  }, [managed, query]);
  const selected = doctors?.find((d) => d.id === selectedId) ?? null;
  if (!doctors) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;

  return (
    <div className="admin">
      <div className="panel">
        <div className="panel__h panel__h--row"><span>On dashboard · {managed.length}</span><button type="button" className="addbtn" onClick={() => setAdding(true)}>＋ Add doctor</button></div>
        <input className="docsearch" placeholder="Search name / phone / login id" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="doclist">
          {filtered.map((d) => (
            <button key={d.id} type="button" className={"docitem" + (selectedId === d.id ? " docitem--active" : "")} onClick={() => setSelectedId(d.id)}>
              <div className="docitem__name">{d.name || "(no name)"}</div>
              <div className="docitem__meta">
                <span>{d.phone || "no phone"}</span>
                {d.loginId && <span className="pill">id: {d.loginId}</span>}
                <span className={"pill" + (d.hasPassword ? " pill--set" : "")}>{d.hasPassword ? "password set" : "default login"}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="bucket__empty" style={{ padding: "14px 16px" }}>{managed.length ? "No doctors match." : "No doctors added yet — use ＋ Add doctor."}</div>}
        </div>
      </div>
      <div className="detail">
        {selected ? <DoctorCredentials doctor={selected} onPatch={patch} onRemoved={() => { setSelectedId(null); reload(); }} /> : <div className="panel detail__empty">Select a doctor to manage their login id + password, or add one from the CRM.</div>}
      </div>
      {adding && <AddDoctor doctors={doctors} onClose={() => setAdding(false)} onPatch={patch} onAdded={(id) => { reload(); setAdding(false); setSelectedId(id); }} />}
    </div>
  );
}

/** Picker to add an existing CRM doctor to the managed roster (seeds their Login_Id = phone). */
function AddDoctor({ doctors, onClose, onAdded, onPatch }: { doctors: Doctor[]; onClose: () => void; onAdded: (id: string) => void; onPatch: (id: string, p: Partial<Doctor>) => void }) {
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const candidates = useMemo(() => {
    const un = doctors.filter((d) => !d.loginId); // not on the dashboard yet
    const term = q.trim().toLowerCase();
    return term ? un.filter((d) => d.name.toLowerCase().includes(term) || d.phone.includes(term)) : un;
  }, [doctors, q]);
  async function add(d: Doctor) {
    if (!d.phone) { alert("This doctor has no phone number to seed a login id."); return; }
    setBusyId(d.id);
    const res = await fetch("/api/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctorId: d.id, action: "add", loginId: d.phone }) }).catch(() => null);
    setBusyId(null);
    if (res && res.ok) { onPatch(d.id, { loginId: d.phone }); onAdded(d.id); }
    else { const j = await res?.json().catch(() => ({})); alert((j as { message?: string })?.message || "Couldn't add this doctor."); }
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <div className="modal__h"><span>Add a doctor from the CRM</span><button type="button" className="modal__x" onClick={onClose} aria-label="Close">✕</button></div>
        <input className="docsearch" placeholder="Search all CRM doctors by name / phone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="doclist doclist--modal">
          {candidates.map((d) => (
            <div key={d.id} className="addrow">
              <div><div className="docitem__name">{d.name || "(no name)"}</div><div className="docitem__meta"><span>{d.phone || "no phone"}</span></div></div>
              <button type="button" className="btn btn--sm" disabled={busyId === d.id || !d.phone} onClick={() => add(d)}>{busyId === d.id ? "…" : "Add"}</button>
            </div>
          ))}
          {candidates.length === 0 && <div className="bucket__empty" style={{ padding: 14 }}>All CRM doctors are already on the dashboard.</div>}
        </div>
      </div>
    </div>
  );
}

function DoctorCredentials({ doctor, onPatch, onRemoved }: { doctor: Doctor; onPatch: (id: string, p: Partial<Doctor>) => void; onRemoved: () => void }) {
  const [loginId, setLoginId] = useState(doctor.loginId || doctor.phone);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setLoginId(doctor.loginId || doctor.phone); setPassword(""); setMsg(null); }, [doctor.id, doctor.loginId, doctor.phone]);

  async function post(url: string, body: object) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return { ...data, status: res.status };
  }
  async function saveLogin() {
    setBusy(true); setMsg(null);
    const r = await post("/api/credentials", { doctorId: doctor.id, loginId: loginId.trim(), password }).catch(() => ({ status: 0, ok: false, message: "Network error." }));
    if (r.status === 200 && r.ok) { setMsg({ ok: true, text: "Saved. The doctor can log in with this id + password." }); setPassword(""); onPatch(doctor.id, { loginId: loginId.trim(), hasPassword: true }); }
    else setMsg({ ok: false, text: r.message || "Couldn't save." });
    setBusy(false);
  }
  async function resetPassword() {
    setBusy(true); setMsg(null);
    const r = await post("/api/roster", { doctorId: doctor.id, action: "reset-password" }).catch(() => ({ status: 0, ok: false, message: "Network error." }));
    if (r.status === 200 && r.ok) { setMsg({ ok: true, text: "Password cleared — the doctor logs in with their id + name." }); setPassword(""); onPatch(doctor.id, { hasPassword: false }); }
    else setMsg({ ok: false, text: r.message || "Couldn't reset." });
    setBusy(false);
  }
  async function removeDoctor() {
    if (!confirm(`Remove ${doctor.name || "this doctor"} from the dashboard roster? (They can still log in with their phone.)`)) return;
    setBusy(true); setMsg(null);
    const r = await post("/api/roster", { doctorId: doctor.id, action: "remove" }).catch(() => ({ status: 0, ok: false, message: "Network error." }));
    if (r.status === 200 && r.ok) onRemoved();
    else { setMsg({ ok: false, text: r.message || "Couldn't remove." }); setBusy(false); }
  }
  const canSave = loginId.trim().length > 0 && password.length >= 4 && !busy;
  return (
    <div className="panel cred">
      <h2 className="detail__name">{doctor.name || "(no name)"}</h2>
      <div className="detail__meta">{doctor.phone || "no phone"} · {doctor.hasPassword ? "custom password set" : "logs in with id + name"}</div>
      <div className="cred__row">
        <label className="cred__field"><span className="cred__lbl">Login ID</span><input className="cred__input" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="phone or a custom id" /></label>
        <label className="cred__field"><span className="cred__lbl">New password</span><input className="cred__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 characters" autoComplete="new-password" /></label>
      </div>
      <div className="cred__hint">The password is stored hashed — it can be reset, not viewed. Letters, numbers and <code>. _ @ + -</code> allowed in the id.</div>
      <div className="cred__actions">
        <button type="button" className="btn" onClick={saveLogin} disabled={!canSave}>{busy ? "Saving…" : "Save login"}</button>
        <button type="button" className="btn btn--ghost" onClick={resetPassword} disabled={busy}>Reset password</button>
        <button type="button" className="btn btn--danger" onClick={removeDoctor} disabled={busy}>Remove</button>
        {msg && <span className={"msg " + (msg.ok ? "msg--ok" : "msg--err")}>{msg.text}</span>}
      </div>
    </div>
  );
}
