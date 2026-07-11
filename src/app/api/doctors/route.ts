import { NextResponse } from "next/server";
import { listDoctors } from "@/lib/zoho";
import { isDemo, demoDoctors } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** List every doctor with a login summary. */
export async function GET(req: Request): Promise<Response> {
  try {
    if (isDemo(req)) return NextResponse.json({ doctors: demoDoctors() });
    return NextResponse.json({ doctors: await listDoctors() });
  } catch {
    return NextResponse.json({ error: "zoho", message: "Couldn't load doctors." }, { status: 502 });
  }
}
