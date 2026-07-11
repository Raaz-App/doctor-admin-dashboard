import { NextResponse } from "next/server";
import { reassignPatient, isScopeError } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Move a patient to a different doctor's dashboard queue. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contactId = String(body.contactId ?? "");
  const doctorId = String(body.doctorId ?? "");
  if (!/^\d{6,}$/.test(contactId) || !/^\d{6,}$/.test(doctorId)) {
    return NextResponse.json({ ok: false, message: "Valid patient + doctor ids are required." }, { status: 400 });
  }
  try {
    await reassignPatient(contactId, doctorId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isScopeError(e)) return NextResponse.json({ ok: false, message: "Zoho write access isn't enabled (write-scoped token needed)." }, { status: 503 });
    return NextResponse.json({ ok: false, message: "Couldn't reassign right now." }, { status: 502 });
  }
}
