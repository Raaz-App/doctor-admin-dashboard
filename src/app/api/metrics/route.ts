import { NextResponse } from "next/server";
import { orgMetrics, computeMetrics } from "@/lib/zoho";
import { isDemo, demoContacts, demoDoctors } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** Org-wide operational metrics for the overview dashboard. */
export async function GET(req: Request): Promise<Response> {
  try {
    if (isDemo(req)) {
      const { waiting, decisions } = demoContacts(Date.now());
      return NextResponse.json(computeMetrics(waiting, decisions, demoDoctors()));
    }
    return NextResponse.json(await orgMetrics());
  } catch {
    return NextResponse.json({ error: "zoho", message: "Couldn't load metrics." }, { status: 502 });
  }
}
