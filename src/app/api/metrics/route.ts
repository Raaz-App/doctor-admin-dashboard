import { NextResponse } from "next/server";
import { orgMetrics } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Org-wide operational metrics for the overview dashboard. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(await orgMetrics());
  } catch {
    return NextResponse.json({ error: "zoho", message: "Couldn't load metrics." }, { status: 502 });
  }
}
