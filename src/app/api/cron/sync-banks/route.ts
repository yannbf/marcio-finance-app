import { NextResponse } from "next/server";
import { syncAllConnections } from "@/lib/enable_banking/sync.ts";

/**
 * Daily Enable Banking sync cron.
 *
 * Triggered by Vercel Cron a few minutes after import-sheet so matching has
 * the latest budget items to resolve against. Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically.
 *
 * For every `linked` bank_connection: fetch each account's transactions since
 * the last cursor, dedupe-insert into `transaction`, advance cursor, run
 * matching. Expired/errored connections surface via tRPC for the UI banner.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 401 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !process.env.ENABLE_BANKING_APP_ID ||
    !process.env.ENABLE_BANKING_PRIVATE_KEY_BASE64
  ) {
    return NextResponse.json(
      { skipped: true, reason: "no Enable Banking credentials configured" },
      { status: 200 },
    );
  }

  try {
    const result = await syncAllConnections();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
