import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");
  const rows = await db.execute(sql`
    SELECT ref, nickname, owner::text AS owner, default_budget_item_natural_key
    FROM savings_account
    ORDER BY ref
  `);
  console.log("savings_account rows:");
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    console.log(`  ${r.ref}  ${r.owner}  "${r.nickname}"  → ${r.default_budget_item_natural_key ?? "—"}`);
  }
  process.exit(0);
}
main();
