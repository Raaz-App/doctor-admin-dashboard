import { NextResponse } from "next/server";
import { setAvailability, isScopeError } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Toggle a doctor in/out of routing (Doctors.Available). */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const doctorId = String(body.doctorId ?? "");
  if (!/^\d{6,}$/.test(doctorId) || typeof body.available !== "boolean") {
    return NextResponse.json({ ok: false, message: "A valid doctor id + available flag are required." }, { status: 400 });
  }
  try {
    await setAvailability(doctorId, body.available);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isScopeError(e)) return NextResponse.json({ ok: false, message: "Zoho write access isn't enabled (write-scoped token needed)." }, { status: 503 });
    return NextResponse.json({ ok: false, message: "Couldn't update availability." }, { status: 502 });
  }
}
