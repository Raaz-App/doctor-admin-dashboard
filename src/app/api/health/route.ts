import { NextResponse } from "next/server";

/** Liveness + a basic readiness check (Zoho creds configured). */
export function GET(): Response {
  const ready = Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      (process.env.ZOHO_WRITE_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN),
  );
  return NextResponse.json({ ok: ready, service: "raaz-admin-dashboard" }, { status: ready ? 200 : 503 });
}
