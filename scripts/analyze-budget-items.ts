/**
 * List distinct (scope, section, naturalKey, name) for every budget
 * item across all imported months — so we know what real targets the
 * sheet provides for new seed rules.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  const rows = await db.execute<{
    scope: string;
    section: string;
    natural_key: string;
    name: string;
    months_seen: string;
  }>(sql`
    SELECT scope::text AS scope,
           section::text AS section,
           natural_key,
           MAX(name) AS name,
           COUNT(DISTINCT month_id)::text AS months_seen
    FROM budget_item
    GROUP BY scope, section, natural_key
    ORDER BY scope, section, natural_key
  `);

  const list = rows as unknown as Array<{
    scope: string;
    section: string;
    natural_key: string;
    name: string;
    months_seen: string;
  }>;

  let lastGroup = "";
  for (const r of list) {
    const group = `${r.scope}/${r.section}`;
    if (group !== lastGroup) {
      console.log(`\n--- ${group} ---`);
      lastGroup = group;
    }
    console.log(
      `  ${r.natural_key.padEnd(38)} (${r.months_seen}x)  ${r.name}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
