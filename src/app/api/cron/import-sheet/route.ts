import { NextResponse } from "next/server";
import { readGoogleSheet } from "@/lib/import/source-google.ts";
import { upsertParsedMonth } from "@/lib/import/upsert.ts";
import { runMatchingAllAccounts } from "@/lib/matching/engine.ts";

/**
 * Daily Google Sheets sync cron.
 *
 * Triggered by Vercel Cron at 06:00 UTC (see `vercel.json`). Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically when CRON_SECRET is
 * set in the project env. The same header can be used for manual invocation.
 *
 * Flow mirrors the user-triggered import action in
 * `src/app/[locale]/import/actions.ts`:
 *   1. Read every monthly tab from the configured Google Sheet.
 *   2. Upsert each parsed month into the DB.
 *   3. Re-run matching across all accounts so any previously unmatched
 *      transactions can resolve against freshly imported budget items.
 */

// Cron jobs may take a while when several months are upserted + rematched.
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

  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    return NextResponse.json(
      { skipped: true, reason: "no sheet configured" },
      { status: 200 },
    );
  }

  try {
    const parsedSheets = await readGoogleSheet();

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const sheet of parsedSheets) {
      const r = await upsertParsedMonth(sheet);
      inserted += r.inserted;
      updated += r.updated;
      unchanged += r.unchanged;
    }

    const matchOutcome = await runMatchingAllAccounts();

    return NextResponse.json({
      months: parsedSheets.length,
      inserted,
      updated,
      unchanged,
      matched: matchOutcome.matched,
    });
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
