import { NextResponse } from "next/server";
import { resetCredentials, isScopeError } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Clear a doctor's custom login → back to the default (phone id + name password). */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const doctorId = String(body.doctorId ?? "");
  if (!/^\d{6,}$/.test(doctorId)) {
    return NextResponse.json({ ok: false, message: "A valid doctor id is required." }, { status: 400 });
  }
  try {
    await resetCredentials(doctorId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isScopeError(e)) return NextResponse.json({ ok: false, message: "Zoho write access isn't enabled (write-scoped token needed)." }, { status: 503 });
    return NextResponse.json({ ok: false, message: "Couldn't reset login." }, { status: 502 });
  }
}
