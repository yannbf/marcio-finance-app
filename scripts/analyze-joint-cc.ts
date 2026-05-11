/**
 * One-off: every "Incasso ING creditcard" row on the joint account.
 * The user says there's no CC on joint, so figure out what's actually
 * happening (real charges via joint? duplicate ingestion? mislabeled
 * accounts?).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  const rows = await db.execute<{
    booking_date: string;
    amount_cents: string;
    counterparty: string | null;
    description: string | null;
    owner: string;
    bank: string;
    nickname: string;
    iban: string | null;
    matched_to: string | null;
  }>(sql`
    SELECT t.booking_date::text AS booking_date,
           t.amount_cents::text AS amount_cents,
           t.counterparty,
           t.description,
           ba.owner::text AS owner,
           ba.bank,
           ba.nickname,
           ba.iban,
           bi.name AS matched_to
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    LEFT JOIN budget_item bi ON bi.id = tm.budget_item_id
    WHERE COALESCE(t.description, '') ~* 'incasso\\s*ing\\s*creditcard'
    ORDER BY t.booking_date DESC
  `);

  const list = rows as unknown as Array<{
    booking_date: string;
    amount_cents: string;
    counterparty: string | null;
    description: string | null;
    owner: string;
    bank: string;
    nickname: string;
    iban: string | null;
    matched_to: string | null;
  }>;

  console.log(`\n${list.length} 'Incasso ING creditcard' rows total:\n`);

  const byOwner = new Map<string, number>();
  for (const r of list) {
    byOwner.set(r.owner, (byOwner.get(r.owner) ?? 0) + 1);
    const d = r.booking_date.slice(0, 10);
    const amt = (Number(r.amount_cents) / 100).toFixed(2);
    console.log(
      `  ${d}  [${r.owner.padEnd(5)}]  ${r.nickname.padEnd(20)} ${(r.iban ?? "—").padEnd(8)}  €${amt.padStart(8)}  ${r.matched_to ?? "UNMATCHED"}`,
    );
  }

  console.log("\nBy owner scope:");
  for (const [scope, n] of byOwner) console.log(`  ${scope}: ${n}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
