/**
 * One-off: rename the app-managed Other budget items to "Outros" in
 * prod. The matching engine resolves by naturalKey, so this is purely
 * cosmetic. Idempotent.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");
  const result = await db.execute(sql`
    UPDATE budget_item
    SET name = 'Outros'
    WHERE natural_key = 'other'
      AND name = 'Other'
    RETURNING id
  `);
  const rows = result as unknown as Array<{ id: string }>;
  console.log(`Renamed ${rows.length} rows.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
