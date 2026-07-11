import { NextResponse } from "next/server";
import { listDoctors } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** List every doctor with a login summary. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ doctors: await listDoctors() });
  } catch {
    return NextResponse.json({ error: "zoho", message: "Couldn't load doctors." }, { status: 502 });
  }
}
