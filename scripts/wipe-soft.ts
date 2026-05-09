/**
 * Soft database wipe — clears every transactional / budget / matching
 * table while KEEPING:
 *   - Auth state (user, account, session, verification — Better Auth)
 *   - Bank connections (so you don't have to redo the Enable Banking
 *     OAuth dance)
 *
 * Everything else gets TRUNCATEd. After running this you'll typically
 * want to:
 *   1. `pnpm db:push --force`        ← applies any pending schema changes
 *   2. Open `/import`                ← re-pulls the Google Sheet
 *   3. Trigger a bank sync           ← Enable Banking lists accounts
 *                                       under the kept connection and
 *                                       re-fetches full history
 *
 * Usage:
 *   pnpm tsx scripts/wipe-soft.ts          ← runs against $DATABASE_URL
 *
 * Safeguard: prints the host of the target database and requires you
 * to type that host name back to confirm. There is no `--force` flag
 * on purpose — copy-pasting "localhost" by accident shouldn't be
 * possible against a Neon prod URL.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/** Tables we wipe — kept in sync with truncateAllTables in tests/support/pglite-server.ts. */
const TABLES_TO_WIPE = [
  "transaction_match",
  '"transaction"',
  "bank_sync_cursor",
  "bank_account",
  "match_rule",
  "category_override",
  "savings_account",
  "savings_bucket",
  "budget_item",
  '"month"',
  "household_setting",
];

/** Tables we deliberately keep — printed in the confirmation banner so
 * you can see exactly what survives the wipe. */
const TABLES_TO_KEEP = [
  '"user"',
  '"session"',
  '"account"',
  "verification",
  "bank_connection",
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Check .env.local.");
    process.exit(1);
  }

  const host = hostnameOf(databaseUrl);

  console.log("");
  console.log("┌───────────────────────────────────────────────────────────");
  console.log(`│ Soft wipe target:  ${host}`);
  console.log("│");
  console.log("│ Will TRUNCATE:");
  for (const t of TABLES_TO_WIPE) console.log(`│   - ${t}`);
  console.log("│");
  console.log("│ Will KEEP:");
  for (const t of TABLES_TO_KEEP) console.log(`│   - ${t}`);
  console.log("└───────────────────────────────────────────────────────────");
  console.log("");

  const rl = readline.createInterface({ input, output });
  const answer = (
    await rl.question(`Type the host name to confirm (${host}): `)
  ).trim();
  rl.close();

  if (answer !== host) {
    console.log(
      `\nAborted — got "${answer}", expected "${host}". No changes made.`,
    );
    process.exit(0);
  }

  // Import lazily so dotenv has already loaded by the time we touch the
  // db client (which reads DATABASE_URL at import time).
  const { db } = await import("../src/db/index.ts");
  const { sql } = await import("drizzle-orm");

  const stmt = `TRUNCATE TABLE ${TABLES_TO_WIPE.join(",\n  ")}\nRESTART IDENTITY CASCADE;`;
  console.log("\nRunning:");
  console.log(stmt);
  console.log("");

  await db.execute(sql.raw(stmt));

  console.log("✓ Wipe complete.");
  console.log("");
  console.log("Next steps:");
  console.log("  1. pnpm db:push --force        (applies pending schema)");
  console.log("  2. Open /import in the app     (re-pulls the Google Sheet)");
  console.log("  3. Trigger a bank sync         (re-fetches transactions)");
  console.log("");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
