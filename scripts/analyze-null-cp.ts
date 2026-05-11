/**
 * NULL-counterparty unmatched txns — the original aggregation was
 * misleading because it grouped all NULLs into one bucket. This lists
 * them individually so we see what's really there.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  const rows = await db.execute<{
    booking_date: string;
    amount_cents: string;
    description: string | null;
    owner: string;
  }>(sql`
    SELECT t.booking_date::text AS booking_date,
           t.amount_cents::text AS amount_cents,
           t.description,
           ba.owner::text AS owner
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    WHERE tm.id IS NULL
      AND t.booking_date > NOW() - INTERVAL '120 days'
      AND t.amount_cents < 0
      AND (t.counterparty IS NULL OR t.counterparty = '')
      AND NOT (COALESCE(t.description, '') ~* 'afronding|spaarrekening|savings')
    ORDER BY t.booking_date DESC
  `);

  const list = rows as unknown as Array<{
    booking_date: string;
    amount_cents: string;
    description: string | null;
    owner: string;
  }>;

  console.log(`\n${list.length} unmatched NULL-counterparty rows in last 120 days:\n`);
  let total = 0;
  for (const r of list) {
    const amt = Number(r.amount_cents) / 100;
    total += amt;
    const d = r.booking_date.slice(0, 10);
    console.log(`  ${d}  [${r.owner.padEnd(5)}]  €${amt.toFixed(2).padStart(9)}`);
    console.log(`             ${(r.description ?? "—").slice(0, 130)}`);
  }
  console.log(`\nTotal: €${total.toFixed(2)}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
