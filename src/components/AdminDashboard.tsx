"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Doctor { id: string; name: string; phone: string; loginId: string; hasPassword: boolean; available: boolean }
interface PatientRow { name: string; colour: "green" | "amber" | "red" | null; status: string; id?: string }
interface Buckets { queued: PatientRow[]; approved: PatientRow[]; rejected: PatientRow[] }
interface DoctorLoad {
  id: string; name: string; available: boolean; hasLogin: boolean;
  queued: number; inReview: number; resolved: number; rejected: number;
  waiting: number; avgWaitMins: number | null; oldestWaitMins: number | null;
}
interface Metrics {
  totals: { queued: number; inReview: number; resolved: number; rejected: number; active: number };
  waiting: { count: number; avgMins: number | null; maxMins: number | null; breaching: number };
  today: { resolved: number; rejected: number };
  approveRatePct: number | null;
  byColour: { green: number; amber: number; red: number; none: number };
  throughput: { date: string; resolved: number }[];
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
  const TABS = [{ k: "home", label: "Home" }, { k: "metrics", label: "Metrics" }, { k: "security", label: "Security" }] as const;
  return (
    <div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.k} type="button" className={"tab" + (tab === t.k ? " tab--on" : "")} onClick={() => setTab(t.k)}>{t.label}</button>
        ))}
      </nav>
      {tab === "home" && <Home />}
      {tab === "metrics" && <MetricsModule focusDoctorId={focusDoctorId} setFocusDoctorId={setFocusDoctorId} />}
      {tab === "security" && <SecurityModule />}
    </div>
  );
}

/* ─────────────────────────── HOME — combined totals ─────────────────────────── */

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "good" | "bad" }) {
  return (
    <div className={"kpi" + (tone ? " kpi--" + tone : "")}>
      <div className="kpi__v">{value}</div>
      <div className="kpi__l">{label}</div>
      {sub && <div className="kpi__s">{sub}</div>}
    </div>
  );
}

function Home() {
  const { m, status } = useMetrics();
  if (!m) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;
  const tpMax = Math.max(1, ...m.throughput.map((t) => t.resolved));
  const colTotal = Math.max(1, m.byColour.green + m.byColour.amber + m.byColour.red);
  return (
    <div className="ov">
      <div className="kpis">
        <Kpi label="Waiting now" value={m.waiting.count} sub={`avg ${fmtMins(m.waiting.avgMins)} · oldest ${fmtMins(m.waiting.maxMins)}`} tone={m.waiting.count ? "warn" : undefined} />
        <Kpi label={`SLA breaches (>${m.slaHours}h)`} value={m.waiting.breaching} tone={m.waiting.breaching ? "bad" : "good"} />
        <Kpi label="Queued" value={m.totals.queued} />
        <Kpi label="In review" value={m.totals.inReview} />
        <Kpi label="Resolved today" value={m.today.resolved} tone="good" />
        <Kpi label="Rejected today" value={m.today.rejected} />
        <Kpi label="Approve rate" value={m.approveRatePct == null ? "—" : `${m.approveRatePct}%`} sub="resolved ÷ decided" />
        <Kpi label="Doctors available" value={`${m.doctorsAvailable}/${m.doctorsTotal}`} />
        <Kpi label="Unassigned" value={m.unassigned} tone={m.unassigned ? "warn" : undefined} />
        <Kpi label="Active patients" value={m.totals.active} sub={m.sampleCapped ? `latest ${m.totals.active} scanned` : "all live"} />
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
          <div className="panel__h">Resolved · last 7 days</div>
          <div className="spark">
            {m.throughput.map((t) => (
              <div key={t.date} className="spark__col" title={`${t.date}: ${t.resolved}`}>
                <div className="spark__bar" style={{ height: `${(t.resolved / tpMax) * 100}%` }} />
                <span className="spark__n">{t.resolved}</span><span className="spark__x">{t.date.slice(5)}</span>
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
        <Kpi label="Queued" value={load.queued} />
        <Kpi label="In review" value={load.inReview} />
        <Kpi label="Resolved" value={load.resolved} tone="good" />
        <Kpi label="Rejected" value={load.rejected} />
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
  const { doctors, status, patch } = useDoctors();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !doctors) return doctors ?? [];
    return doctors.filter((d) => d.name.toLowerCase().includes(q) || d.phone.includes(q) || d.loginId.toLowerCase().includes(q));
  }, [doctors, query]);
  const selected = doctors?.find((d) => d.id === selectedId) ?? null;
  if (!doctors) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;
  return (
    <div className="admin">
      <div className="panel">
        <div className="panel__h">Doctors · {doctors.length}</div>
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
          {filtered.length === 0 && <div className="bucket__empty" style={{ padding: "14px 16px" }}>No doctors match.</div>}
        </div>
      </div>
      <div className="detail">
        {selected ? <DoctorCredentials doctor={selected} onPatch={patch} /> : <div className="panel detail__empty">Select a doctor to manage their login id + password.</div>}
      </div>
    </div>
  );
}

function DoctorCredentials({ doctor, onPatch }: { doctor: Doctor; onPatch: (id: string, p: Partial<Doctor>) => void }) {
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
  async function resetLogin() {
    setBusy(true); setMsg(null);
    const r = await post("/api/reset-login", { doctorId: doctor.id }).catch(() => ({ status: 0, ok: false, message: "Network error." }));
    if (r.status === 200 && r.ok) { setMsg({ ok: true, text: "Reset. Doctor is back to the default login (phone + name)." }); setPassword(""); setLoginId(doctor.phone); onPatch(doctor.id, { loginId: "", hasPassword: false }); }
    else setMsg({ ok: false, text: r.message || "Couldn't reset." });
    setBusy(false);
  }
  const canSave = loginId.trim().length > 0 && password.length >= 4 && !busy;
  return (
    <div className="panel cred">
      <h2 className="detail__name">{doctor.name || "(no name)"}</h2>
      <div className="detail__meta">{doctor.phone || "no phone"} · {doctor.hasPassword ? "custom password set" : "using default login (phone + name)"}</div>
      <div className="cred__row">
        <label className="cred__field"><span className="cred__lbl">Login ID</span><input className="cred__input" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="phone or a custom id" /></label>
        <label className="cred__field"><span className="cred__lbl">New password</span><input className="cred__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 characters" autoComplete="new-password" /></label>
      </div>
      <div className="cred__hint">The password is stored hashed — it can be reset, not viewed. Letters, numbers and <code>. _ @ + -</code> allowed in the id.</div>
      <div className="cred__actions">
        <button type="button" className="btn" onClick={saveLogin} disabled={!canSave}>{busy ? "Saving…" : "Save login"}</button>
        <button type="button" className="btn btn--ghost" onClick={resetLogin} disabled={busy}>Reset to default</button>
        {msg && <span className={"msg " + (msg.ok ? "msg--ok" : "msg--err")}>{msg.text}</span>}
      </div>
    </div>
  );
}
