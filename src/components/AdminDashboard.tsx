"use client";

import { useEffect, useMemo, useState } from "react";

interface Doctor {
  id: string;
  name: string;
  phone: string;
  loginId: string;
  hasPassword: boolean;
}
interface PatientRow {
  name: string;
  colour: "green" | "amber" | "red" | null;
  status: string;
}
interface Buckets {
  queued: PatientRow[];
  approved: PatientRow[];
  rejected: PatientRow[];
}

const EMPTY: Buckets = { queued: [], approved: [], rejected: [] };

export function AdminDashboard() {
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [status, setStatus] = useState("Loading doctors…");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Doctor | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/doctors", { method: "GET" });
        const data = (await res.json().catch(() => ({}))) as { doctors?: Doctor[]; message?: string };
        if (!live) return;
        if (res.status !== 200 || !data.doctors) {
          setStatus(data.message || "Couldn't load doctors.");
          return;
        }
        setDoctors(data.doctors);
      } catch {
        if (live) setStatus("Couldn't reach the server.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !doctors) return doctors ?? [];
    return doctors.filter((d) => d.name.toLowerCase().includes(q) || d.phone.includes(q) || d.loginId.toLowerCase().includes(q));
  }, [doctors, query]);

  if (!doctors) return <div className={"status" + (status.startsWith("Loading") ? "" : " status--error")}>{status}</div>;

  return (
    <div className="admin">
      <div className="panel">
        <div className="panel__h">Doctors · {doctors.length}</div>
        <input
          className="docsearch"
          placeholder="Search name / phone / login id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="doclist">
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              className={"docitem" + (selected?.id === d.id ? " docitem--active" : "")}
              onClick={() => setSelected(d)}
            >
              <div className="docitem__name">{d.name || "(no name)"}</div>
              <div className="docitem__meta">
                <span>{d.phone || "no phone"}</span>
                {d.loginId && <span className="pill">id: {d.loginId}</span>}
                <span className={"pill" + (d.hasPassword ? " pill--set" : "")}>
                  {d.hasPassword ? "password set" : "default login"}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="bucket__empty" style={{ padding: "14px 16px" }}>No doctors match.</div>}
        </div>
      </div>

      <div className="detail">
        {selected ? (
          <DoctorDetail
            doctor={selected}
            onSaved={(loginId) =>
              setDoctors((prev) => prev?.map((x) => (x.id === selected.id ? { ...x, loginId, hasPassword: true } : x)) ?? prev)
            }
          />
        ) : (
          <div className="panel detail__empty">Select a doctor to view their patients and manage login.</div>
        )}
      </div>
    </div>
  );
}

function DoctorDetail({ doctor, onSaved }: { doctor: Doctor; onSaved: (loginId: string) => void }) {
  const [buckets, setBuckets] = useState<Buckets>(EMPTY);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientsError, setPatientsError] = useState("");

  const [loginId, setLoginId] = useState(doctor.loginId || doctor.phone);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setLoginId(doctor.loginId || doctor.phone);
    setPassword("");
    setMsg(null);
    setBuckets(EMPTY);
    setPatientsError("");
    setLoadingPatients(true);
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/doctor-patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doctorId: doctor.id }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<Buckets> & { message?: string };
        if (!live) return;
        if (res.status !== 200) setPatientsError(data.message || "Couldn't load patients.");
        else setBuckets({ queued: data.queued ?? [], approved: data.approved ?? [], rejected: data.rejected ?? [] });
      } catch {
        if (live) setPatientsError("Couldn't reach the server.");
      } finally {
        if (live) setLoadingPatients(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [doctor.id, doctor.loginId, doctor.phone]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId: doctor.id, loginId: loginId.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.status === 200 && data.ok) {
        setMsg({ ok: true, text: "Saved. The doctor can now log in with this id + password." });
        setPassword("");
        onSaved(loginId.trim());
      } else {
        setMsg({ ok: false, text: data.message || "Couldn't save." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const canSave = loginId.trim().length > 0 && password.length >= 4 && !busy;

  return (
    <>
      <div className="panel cred">
        <h2 className="detail__name">{doctor.name || "(no name)"}</h2>
        <div className="detail__meta">
          {doctor.phone || "no phone"} · {doctor.hasPassword ? "custom password set" : "using default login (phone + name)"}
        </div>

        <div className="cred__row">
          <label className="cred__field">
            <span className="cred__lbl">Login ID</span>
            <input className="cred__input" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="e.g. phone or a custom id" />
          </label>
          <label className="cred__field">
            <span className="cred__lbl">New password</span>
            <input className="cred__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 characters" autoComplete="new-password" />
          </label>
        </div>
        <div className="cred__hint">
          Initially a doctor logs in with their phone (id) + name (password). Setting a password here replaces that.
          Letters, numbers and <code>. _ @ + -</code> allowed in the id. The password is stored hashed — it can be reset, not viewed.
        </div>
        <div className="cred__actions">
          <button type="button" className="btn" onClick={save} disabled={!canSave}>
            {busy ? "Saving…" : "Save login"}
          </button>
          {msg && <span className={"msg " + (msg.ok ? "msg--ok" : "msg--err")}>{msg.text}</span>}
        </div>
      </div>

      <div className="panel">
        <div className="panel__h">Patients</div>
        {patientsError ? (
          <div className="status status--error">{patientsError}</div>
        ) : loadingPatients ? (
          <div className="status">Loading patients…</div>
        ) : (
          <div className="buckets">
            <Bucket title="Queued" rows={buckets.queued} />
            <Bucket title="Approved" rows={buckets.approved} />
            <Bucket title="Rejected" rows={buckets.rejected} />
          </div>
        )}
      </div>
    </>
  );
}

function Bucket({ title, rows }: { title: string; rows: PatientRow[] }) {
  return (
    <div>
      <div className="bucket__h">
        <span>{title}</span>
        <span className="bucket__count">{rows.length}</span>
      </div>
      <div className="bucket__list">
        {rows.length === 0 && <div className="bucket__empty">None.</div>}
        {rows.map((p, i) => (
          <div key={i} className={"pcard" + (p.colour ? " pcard--" + p.colour : "")}>
            <span className="pcard__dot" aria-hidden="true" />
            <span className="pcard__name">{p.name}</span>
            <span className="pcard__status">{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
