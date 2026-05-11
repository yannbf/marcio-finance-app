/**
 * One-shot: ensure the app-managed "Other" budget items exist for
 * every month already in the DB. Idempotent — re-running it is a no-op.
 * After the first run, every future sheet import takes care of it
 * automatically via upsertParsedMonth().
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/index.ts");
  const { month } = await import("../src/db/schema.ts");
  const { ensureOtherBuckets } = await import("../src/lib/import/upsert.ts");

  const months = await db.select({ id: month.id, anchorYear: month.anchorYear, anchorMonth: month.anchorMonth }).from(month);
  console.log(`Backfilling Other buckets for ${months.length} months...`);

  for (const m of months) {
    await ensureOtherBuckets(m.id);
    console.log(`  ✓ ${m.anchorYear}-${String(m.anchorMonth).padStart(2, "0")}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
