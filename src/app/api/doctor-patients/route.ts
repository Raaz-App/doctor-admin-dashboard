import { NextResponse } from "next/server";
import { doctorPatients } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** One doctor's patients, bucketed queued / approved / rejected. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const doctorId = String(body.doctorId ?? "");
  if (!/^\d{6,}$/.test(doctorId)) {
    return NextResponse.json({ error: "bad_request", message: "A valid doctor id is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await doctorPatients(doctorId));
  } catch {
    return NextResponse.json({ error: "zoho", message: "Couldn't load this doctor's patients." }, { status: 502 });
  }
}
