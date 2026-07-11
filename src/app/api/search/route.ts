import { NextResponse } from "next/server";
import { searchPatients } from "@/lib/zoho";
import { isDemo, demoSearch } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** Global patient search by name → status + assigned doctor. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const q = String(body.q ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  try {
    if (isDemo(req, body)) return NextResponse.json({ hits: demoSearch(q, Date.now()) });
    return NextResponse.json({ hits: await searchPatients(q) });
  } catch {
    return NextResponse.json({ error: "zoho", message: "Search failed." }, { status: 502 });
  }
}
