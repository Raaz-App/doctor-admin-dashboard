import { NextResponse } from "next/server";
import { addToRoster, removeFromRoster, resetPassword, isScopeError } from "@/lib/zoho";

export const dynamic = "force-dynamic";

const LOGIN_ID_RE = /^[A-Za-z0-9._@+ -]{1,100}$/; // must match the doctor dashboard's LOGIN_ID_RE

/** Manage a doctor's presence on the dashboard roster. action: add | remove | reset-password. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const doctorId = String(body.doctorId ?? "");
  const action = String(body.action ?? "");
  if (!/^\d{6,}$/.test(doctorId)) {
    return NextResponse.json({ ok: false, message: "A valid doctor id is required." }, { status: 400 });
  }
  try {
    if (action === "add") {
      const loginId = String(body.loginId ?? "").trim();
      if (!LOGIN_ID_RE.test(loginId)) return NextResponse.json({ ok: false, message: "A valid login id (usually the phone) is required to add." }, { status: 400 });
      await addToRoster(doctorId, loginId);
    } else if (action === "remove") {
      await removeFromRoster(doctorId);
    } else if (action === "reset-password") {
      await resetPassword(doctorId);
    } else {
      return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isScopeError(e)) return NextResponse.json({ ok: false, message: "Zoho write access isn't enabled (write-scoped token needed)." }, { status: 503 });
    return NextResponse.json({ ok: false, message: "Couldn't update the roster right now." }, { status: 502 });
  }
}
