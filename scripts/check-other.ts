import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");
  const rows = await db.execute(sql`
    SELECT bi.scope::text AS scope, bi.section::text AS section, bi.name, bi.natural_key, m.anchor_year, m.anchor_month
    FROM budget_item bi
    JOIN "month" m ON m.id = bi.month_id
    WHERE bi.natural_key = 'other'
    ORDER BY m.anchor_year, m.anchor_month, bi.scope
  `);
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    console.log(`  ${r.anchor_year}-${String(r.anchor_month).padStart(2, "0")}  ${r.scope}/${r.section}  "${r.name}"`);
  }
  process.exit(0);
}
main();
