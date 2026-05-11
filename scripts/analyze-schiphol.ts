/**
 * One-off: Schiphol Parking deep-dive — every row in last 180 days
 * with date + amount + which account.
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
    bank: string;
    matched_to: string | null;
  }>(sql`
    SELECT t.booking_date::text AS booking_date,
           t.amount_cents::text AS amount_cents,
           t.description,
           ba.owner::text AS owner,
           ba.bank,
           bi.name AS matched_to
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    LEFT JOIN budget_item bi ON bi.id = tm.budget_item_id
    WHERE (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')) ~* 'schiphol'
      AND t.booking_date > NOW() - INTERVAL '180 days'
    ORDER BY t.booking_date DESC
  `);

  const list = rows as unknown as Array<{
    booking_date: string;
    amount_cents: string;
    description: string | null;
    owner: string;
    bank: string;
    matched_to: string | null;
  }>;

  console.log(`\n${list.length} Schiphol-related rows in last 180 days:\n`);
  let total = 0;
  for (const r of list) {
    const amt = Number(r.amount_cents) / 100;
    total += amt;
    const d = r.booking_date.slice(0, 10);
    const mark = r.matched_to ? `→ ${r.matched_to}` : "UNMATCHED";
    console.log(
      `  ${d}  [${r.owner.padEnd(5)}]  €${amt.toFixed(2).padStart(8)}  ${mark}`,
    );
    console.log(`             ${(r.description ?? "—").slice(0, 100)}`);
  }
  console.log(`\nTotal: €${total.toFixed(2)}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
