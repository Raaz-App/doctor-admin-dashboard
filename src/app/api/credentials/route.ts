import { NextResponse } from "next/server";
import { setDoctorCredentials, isScopeError } from "@/lib/zoho";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

// Login ids get spliced into Zoho search criteria (in the doctor app), so constrain the charset —
// no Zoho metacharacters like ( ) : , — MUST match the doctor dashboard's LOGIN_ID_RE.
const LOGIN_ID_RE = /^[A-Za-z0-9._@+ -]{1,100}$/;

/** Set a doctor's dashboard login id + password (the password is hashed before storage). */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const doctorId = String(body.doctorId ?? "");
  const loginId = String(body.loginId ?? "").trim();
  const password = body.password == null ? "" : String(body.password); // do NOT trim — spaces may matter

  if (!/^\d{6,}$/.test(doctorId)) {
    return NextResponse.json({ ok: false, message: "A valid doctor id is required." }, { status: 400 });
  }
  if (!LOGIN_ID_RE.test(loginId)) {
    return NextResponse.json({ ok: false, message: "Login id may use letters, numbers and . _ @ + - only (max 100)." }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json({ ok: false, message: "Password must be at least 4 characters." }, { status: 400 });
  }

  try {
    await setDoctorCredentials(doctorId, loginId, hashPassword(password));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isScopeError(e)) {
      return NextResponse.json({ ok: false, message: "Zoho write access isn't enabled (a write-scoped token is needed)." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, message: "Couldn't save to Zoho right now. Please try again." }, { status: 502 });
  }
}
